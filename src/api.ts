import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { config, publicSettings } from "./config.js";
import { clearLogs, db, resetForeignSources } from "./db/index.js";
import { insertItems, listCollectorTypes, runCollectJob } from "./collectors/index.js";
import { fetchArxivById } from "./collectors/arxiv.js";
import { runProcessJob, processItemById } from "./ai/jobs.js";
import { listPublisherTypes, runPublishJob, publishItemById } from "./publishers/index.js";
import { urlImportCollector } from "./collectors/web.js";
import { FOREIGN_SOURCES } from "./collectors/presets.js";
import {
  defaultStyleFor,
  formatArticle,
  listStyles,
  type FormatPlatform,
  type StylePreset,
} from "./format/index.js";
import { hasFfmpeg, runDouyinSliceJob } from "./video/jobs.js";
import { readiness, saveSettings } from "./settings.js";
import { reloadScheduler, schedulerStatus } from "./scheduler.js";

function auth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.ADMIN_TOKEN) return true;
  const token =
    (req.headers["x-admin-token"] as string | undefined) ||
    (typeof req.query === "object" && req.query && "token" in req.query
      ? String((req.query as { token?: string }).token || "")
      : "");
  if (token !== config.ADMIN_TOKEN) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

export async function registerRoutes(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const text = !body || body === "" ? "{}" : String(body);
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(null, {});
    }
  });
  app.get("/api/health", async () => ({
    ok: true,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  }));

  app.get("/api/meta", async (req, reply) => {
    if (!auth(req, reply)) return;
    const ready = readiness();
    return {
      collectors: listCollectorTypes(),
      publishers: listPublisherTypes(),
      aiConfigured: Boolean(config.AI_API_KEY),
      aiModel: config.AI_MODEL,
      aiBaseUrl: config.AI_BASE_URL,
      foreignPresets: FOREIGN_SOURCES.map((s) => ({
        name: s.name,
        type: s.type,
        enabled: s.enabled,
        category: s.category,
      })),
      readiness: ready,
      scheduler: schedulerStatus(),
      howTo: [
        "① 打开「设置」填写 AI API Key",
        "② 点「恢复预置」加载 AI/科技资讯源（部分默认关闭，可在源列表开启）",
        "③ 打开「自动运行」，定时采集→中文加工→排版导出",
      ],
    };
  });

  app.get("/api/settings", async (req, reply) => {
    if (!auth(req, reply)) return;
    return {
      settings: publicSettings(),
      readiness: readiness(),
      scheduler: schedulerStatus(),
      presets: {
        cronCollect: [
          { label: "每 15 分钟", value: "*/15 * * * *" },
          { label: "每 30 分钟", value: "*/30 * * * *" },
          { label: "每小时", value: "0 * * * *" },
          { label: "每 2 小时", value: "0 */2 * * *" },
        ],
        cronProcess: [
          { label: "每 5 分钟", value: "*/5 * * * *" },
          { label: "每 10 分钟", value: "*/10 * * * *" },
          { label: "每 20 分钟", value: "*/20 * * * *" },
        ],
        cronPublish: [
          { label: "每 10 分钟", value: "*/10 * * * *" },
          { label: "每 15 分钟", value: "*/15 * * * *" },
          { label: "每 30 分钟", value: "*/30 * * * *" },
        ],
        aiProviders: [
          { label: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-chat" },
          { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
          { label: "通义兼容", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
        ],
      },
    };
  });

  app.put<{
    Body: Record<string, string | boolean>;
  }>("/api/settings", async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body || {};
    const settings = saveSettings(body);
    reloadScheduler();
    // 同步 WordPress 目标配置（若填了）
    if (body.WP_URL || body.WP_USER || body.WP_APP_PASSWORD) {
      const wp = db
        .prepare(`SELECT id, config_json FROM publish_targets WHERE type = 'wordpress' LIMIT 1`)
        .get() as { id: number; config_json: string } | undefined;
      if (wp) {
        const cfg = JSON.parse(wp.config_json || "{}") as Record<string, string>;
        if (typeof body.WP_URL === "string" && body.WP_URL) cfg.url = body.WP_URL;
        if (typeof body.WP_USER === "string" && body.WP_USER) cfg.user = body.WP_USER;
        if (
          typeof body.WP_APP_PASSWORD === "string" &&
          body.WP_APP_PASSWORD &&
          !body.WP_APP_PASSWORD.includes("…")
        ) {
          cfg.appPassword = body.WP_APP_PASSWORD;
        }
        const enabled =
          cfg.url && cfg.user && cfg.appPassword ? 1 : 0;
        db.prepare(
          `UPDATE publish_targets SET name = ?, config_json = ?, enabled = ? WHERE id = ?`
        ).run(
          enabled ? "WordPress" : "WordPress (请配置)",
          JSON.stringify(cfg),
          enabled,
          wp.id
        );
      }
    }
    return { ok: true, settings, readiness: readiness(), scheduler: schedulerStatus() };
  });

  app.get("/api/dashboard", async (req, reply) => {
    if (!auth(req, reply)) return;
    const byStatus = db
      .prepare(`SELECT status, COUNT(*) AS c FROM items GROUP BY status`)
      .all() as { status: string; c: number }[];
    const recent = db
      .prepare(
        `SELECT id, title, ai_title, status, summary, url, created_at, updated_at
         FROM items ORDER BY id DESC LIMIT 30`
      )
      .all();
    const logs = db
      .prepare(`SELECT * FROM job_logs ORDER BY id DESC LIMIT 40`)
      .all();
    const sources = db
      .prepare(`SELECT id, name, type, enabled FROM sources ORDER BY id`)
      .all();
    const targets = db
      .prepare(`SELECT id, name, type, enabled, config_json FROM publish_targets ORDER BY id`)
      .all();
    return {
      readiness: readiness(),
      scheduler: schedulerStatus(),
      byStatus,
      recent,
      logs,
      sources,
      targets,
    };
  });

  app.delete("/api/logs", async (req, reply) => {
    if (!auth(req, reply)) return;
    return { ok: true, deleted: clearLogs() };
  });

  app.post("/api/setup/foreign-sources", async (req, reply) => {
    if (!auth(req, reply)) return;
    const count = resetForeignSources();
    return { ok: true, count, sources: FOREIGN_SOURCES.map((s) => s.name) };
  });

  app.get("/api/stats", async (req, reply) => {
    if (!auth(req, reply)) return;
    const byStatus = db
      .prepare(`SELECT status, COUNT(*) AS c FROM items GROUP BY status`)
      .all();
    const sources = db.prepare(`SELECT COUNT(*) AS c FROM sources`).get();
    const targets = db
      .prepare(`SELECT COUNT(*) AS c FROM publish_targets WHERE enabled = 1`)
      .get();
    return { byStatus, sources, targets };
  });

  app.get("/api/sources", async (req, reply) => {
    if (!auth(req, reply)) return;
    return db.prepare(`SELECT * FROM sources ORDER BY id`).all();
  });

  app.post<{
    Body: { name: string; type: string; config?: Record<string, unknown>; enabled?: boolean };
  }>("/api/sources", async (req, reply) => {
    if (!auth(req, reply)) return;
    const { name, type, config: cfg = {}, enabled = true } = req.body || {};
    if (!name || !type) return reply.code(400).send({ error: "name/type required" });
    const info = db
      .prepare(
        `INSERT INTO sources (name, type, config_json, enabled) VALUES (?, ?, ?, ?)`
      )
      .run(name, type, JSON.stringify(cfg), enabled ? 1 : 0);
    return { id: info.lastInsertRowid };
  });

  app.patch<{
    Params: { id: string };
    Body: { enabled?: boolean; name?: string; config?: Record<string, unknown> };
  }>("/api/sources/:id", async (req, reply) => {
    if (!auth(req, reply)) return;
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const body = req.body || {};
    const current = row as {
      name: string;
      config_json: string;
      enabled: number;
    };
    db.prepare(
      `UPDATE sources SET name = ?, config_json = ?, enabled = ? WHERE id = ?`
    ).run(
      body.name ?? current.name,
      body.config ? JSON.stringify(body.config) : current.config_json,
      body.enabled == null ? current.enabled : body.enabled ? 1 : 0,
      id
    );
    return { ok: true };
  });

  app.get("/api/targets", async (req, reply) => {
    if (!auth(req, reply)) return;
    return db.prepare(`SELECT * FROM publish_targets ORDER BY id`).all();
  });

  app.post<{
    Body: { name: string; type: string; config?: Record<string, unknown>; enabled?: boolean };
  }>("/api/targets", async (req, reply) => {
    if (!auth(req, reply)) return;
    const { name, type, config: cfg = {}, enabled = true } = req.body || {};
    if (!name || !type) return reply.code(400).send({ error: "name/type required" });
    const info = db
      .prepare(
        `INSERT INTO publish_targets (name, type, config_json, enabled) VALUES (?, ?, ?, ?)`
      )
      .run(name, type, JSON.stringify(cfg), enabled ? 1 : 0);
    return { id: info.lastInsertRowid };
  });

  app.patch<{
    Params: { id: string };
    Body: { enabled?: boolean; name?: string; config?: Record<string, unknown> };
  }>("/api/targets/:id", async (req, reply) => {
    if (!auth(req, reply)) return;
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM publish_targets WHERE id = ?`).get(id) as
      | { name: string; config_json: string; enabled: number }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    const body = req.body || {};
    db.prepare(
      `UPDATE publish_targets SET name = ?, config_json = ?, enabled = ? WHERE id = ?`
    ).run(
      body.name ?? row.name,
      body.config ? JSON.stringify(body.config) : row.config_json,
      body.enabled == null ? row.enabled : body.enabled ? 1 : 0,
      id
    );
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    "/api/items",
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const limit = Math.min(Number(req.query.limit || 50), 200);
      const status = req.query.status;
      if (status) {
        return db
          .prepare(
            `SELECT id, source_id, title, url, status, ai_title, summary, tags_json, image_url, error, created_at, updated_at
             FROM items WHERE status = ? ORDER BY id DESC LIMIT ?`
          )
          .all(status, limit);
      }
      return db
        .prepare(
          `SELECT id, source_id, title, url, status, ai_title, summary, tags_json, image_url, error, created_at, updated_at
           FROM items ORDER BY id DESC LIMIT ?`
        )
        .all(limit);
    }
  );

  app.post<{ Params: { id: string } }>("/api/items/:id/reprocess", async (req, reply) => {
    if (!auth(req, reply)) return;
    const id = Number(req.params.id);
    try {
      const result = await processItemById(id);
      return result;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/process", async (req, reply) => {
    if (!auth(req, reply)) return;
    try {
      return await processItemById(Number(req.params.id));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/items/:id/publish", async (req, reply) => {
    if (!auth(req, reply)) return;
    try {
      return await publishItemById(Number(req.params.id));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => {
    if (!auth(req, reply)) return;
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(Number(req.params.id));
    if (!item) return reply.code(404).send({ error: "not found" });
    const pubs = db
      .prepare(`SELECT * FROM publications WHERE item_id = ?`)
      .all(Number(req.params.id));
    return { item, publications: pubs };
  });

  app.post("/api/items/reprocess-all-ready", async (req, reply) => {
    if (!auth(req, reply)) return;
    // 把已有成稿也允许重新翻译（无 AI Key 时产出的待译稿）
    const info = db
      .prepare(
        `UPDATE items SET status = 'raw', error = NULL, updated_at = datetime('now')
         WHERE status IN ('ready', 'error') OR (status = 'published' AND (ai_title LIKE '[待译]%' OR summary LIKE '【待翻译】%'))`
      )
      .run();
    return { ok: true, reset: Number(info.changes) };
  });

  app.get("/api/logs", async (req, reply) => {
    if (!auth(req, reply)) return;
    return db
      .prepare(`SELECT * FROM job_logs ORDER BY id DESC LIMIT 100`)
      .all();
  });

  app.post("/api/jobs/collect", async (req, reply) => {
    if (!auth(req, reply)) return;
    const result = await runCollectJob();
    return result;
  });

  app.post("/api/jobs/process", async (req, reply) => {
    if (!auth(req, reply)) return;
    return runProcessJob(5);
  });

  app.post("/api/jobs/publish", async (req, reply) => {
    if (!auth(req, reply)) return;
    return runPublishJob(5);
  });

  app.post("/api/jobs/pipeline", async (req, reply) => {
    if (!auth(req, reply)) return;
    const collect = await runCollectJob();
    const process = await runProcessJob(5);
    const publish = await runPublishJob(5);
    return { collect, process, publish };
  });

  app.post<{
    Body: { urls?: string[] | string; text?: string };
  }>("/api/items/import", async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body || {};
    let urls: string[] = [];
    if (Array.isArray(body.urls)) urls = body.urls.map(String);
    else if (typeof body.urls === "string") {
      urls = body.urls.split(/\n/).map((s) => s.trim()).filter(Boolean);
    } else if (body.text) {
      urls = String(body.text)
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (!urls.length) return reply.code(400).send({ error: "urls required" });
    const collected = await urlImportCollector.collect({ urls });
    const inserted = insertItems(
      collected.map((c) => ({
        externalId: c.externalId,
        title: c.title,
        url: c.url,
        content: c.content,
      }))
    );
    return { fetched: collected.length, inserted };
  });

  app.post<{
    Body: { ids?: string[] | string; text?: string };
  }>("/api/papers/arxiv", async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body || {};
    let ids: string[] = [];
    const raw =
      typeof body.text === "string"
        ? body.text
        : typeof body.ids === "string"
          ? body.ids
          : Array.isArray(body.ids)
            ? body.ids.join("\n")
            : "";
    ids = raw
      .split(/[\n,\s]+/)
      .map((s) =>
        s
          .trim()
          .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
          .replace(/\.pdf$/i, "")
      )
      .filter(Boolean);
    if (!ids.length) {
      return reply.code(400).send({ error: "请提供 arXiv id，如 2401.12345" });
    }

    const collected = [];
    for (const id of ids.slice(0, 20)) {
      const item = await fetchArxivById(id);
      if (item) collected.push(item);
    }
    const inserted = insertItems(
      collected.map((c) => ({
        externalId: c.externalId,
        title: c.title,
        url: c.url,
        content: c.content,
        raw: c.raw,
      }))
    );
    return { fetched: collected.length, inserted, ids: collected.map((c) => c.externalId) };
  });

  app.get("/api/exports", async (req, reply) => {
    if (!auth(req, reply)) return;
    const root = path.join(config.DATA_DIR, "exports");
    if (!fs.existsSync(root)) return [];
    const out: {
      platform: string;
      file: string;
      url: string;
      size: number;
      mtime: string;
      kind: string;
    }[] = [];
    for (const platform of fs.readdirSync(root)) {
      const dir = path.join(root, platform);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        const kind = file.endsWith(".paste.html")
          ? "paste"
          : file.endsWith(".html")
            ? "html"
            : file.endsWith(".md")
              ? "md"
              : file.endsWith(".txt")
                ? "txt"
                : file.endsWith(".mp4")
                  ? "mp4"
                  : "";
        if (!kind) continue;
        const full = path.join(dir, file);
        const st = fs.statSync(full);
        const rel = path.relative(config.DATA_DIR, full).replace(/\\/g, "/");
        out.push({
          platform,
          file,
          kind,
          url: `/api/exports/file?path=${encodeURIComponent(rel)}`,
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      }
    }
    out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return out.slice(0, 150);
  });

  app.get("/api/format/styles", async (req, reply) => {
    if (!auth(req, reply)) return;
    const platform = (req.query as { platform?: string }).platform as
      | FormatPlatform
      | undefined;
    return listStyles(platform);
  });

  app.post<{
    Body: {
      itemId?: number;
      platform?: FormatPlatform;
      style?: StylePreset;
      title?: string;
      summary?: string;
      content?: string;
      tags?: string[];
      sourceUrl?: string;
    };
  }>("/api/format/preview", async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body || {};
    let title = body.title || "";
    let summary = body.summary || "";
    let content = body.content || "";
    let tags = body.tags || [];
    let sourceUrl = body.sourceUrl || "";
    let imageUrl = "";

    if (body.itemId) {
      const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(body.itemId) as
        | {
            title: string;
            ai_title: string | null;
            summary: string | null;
            rewritten: string | null;
            content: string | null;
            tags_json: string | null;
            url: string | null;
            image_url: string | null;
          }
        | undefined;
      if (!item) return reply.code(404).send({ error: "not found" });
      title = item.ai_title || item.title;
      summary = item.summary || "";
      content = item.rewritten || item.content || "";
      tags = item.tags_json ? (JSON.parse(item.tags_json) as string[]) : [];
      sourceUrl = item.url || "";
      imageUrl = item.image_url || "";
    }

    const platform = body.platform || "wechat_mp";
    const style = body.style || defaultStyleFor(platform);
    return formatArticle({
      title,
      summary,
      content,
      tags,
      sourceUrl,
      imageUrl,
      platform,
      style,
    });
  });

  app.patch<{
    Params: { id: string };
    Body: { style?: string };
  }>("/api/targets/:id/style", async (req, reply) => {
    if (!auth(req, reply)) return;
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM publish_targets WHERE id = ?`).get(id) as
      | { config_json: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    const cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    if (req.body?.style) cfg.style = req.body.style;
    db.prepare(`UPDATE publish_targets SET config_json = ? WHERE id = ?`).run(
      JSON.stringify(cfg),
      id
    );
    return { ok: true, config: cfg };
  });

  app.get<{ Querystring: { path?: string } }>("/api/exports/file", async (req, reply) => {
    if (!auth(req, reply)) return;
    const rel = String(req.query.path || "");
    if (!rel || rel.includes("..")) return reply.code(400).send({ error: "bad path" });
    const root = path.resolve(config.DATA_DIR);
    const full = path.resolve(config.DATA_DIR, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      return reply.code(400).send({ error: "bad path" });
    }
    if (!fs.existsSync(full)) return reply.code(404).send({ error: "not found" });
    if (full.endsWith(".mp4")) {
      return reply.type("video/mp4").send(fs.readFileSync(full));
    }
    const text = fs.readFileSync(full, "utf8");
    if (full.endsWith(".html")) {
      return reply.type("text/html; charset=utf-8").send(text);
    }
    if (full.endsWith(".txt")) {
      return reply.type("text/plain; charset=utf-8").send(text);
    }
    if (full.endsWith(".md")) {
      return reply.type("text/markdown; charset=utf-8").send(text);
    }
    return reply.type("application/octet-stream").send(text);
  });

  app.get("/api/video/status", async (req, reply) => {
    if (!auth(req, reply)) return;
    return {
      ffmpeg: await hasFfmpeg(),
      tip: "切片需要本机/服务器安装 ffmpeg；抖音默认导出切片+文案，人工上传更稳。",
    };
  });

  app.post<{
    Body: {
      source?: string;
      clipSeconds?: number;
      maxClips?: number;
      startAt?: number;
      vertical?: boolean;
      itemId?: number;
      title?: string;
      summary?: string;
      content?: string;
    };
  }>("/api/video/douyin", async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body || {};
    if (!body.source) {
      return reply.code(400).send({ error: "请提供 source（视频 URL 或服务器本地路径）" });
    }
    const result = await runDouyinSliceJob({
      source: String(body.source),
      clipSeconds: body.clipSeconds,
      maxClips: body.maxClips,
      startAt: body.startAt,
      vertical: body.vertical,
      itemId: body.itemId,
      title: body.title,
      summary: body.summary,
      content: body.content,
    });
    if (!result.ok) return reply.code(400).send(result);
    return result;
  });
}
