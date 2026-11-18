import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { FOREIGN_SOURCES } from "../collectors/presets.js";

fs.mkdirSync(config.DATA_DIR, { recursive: true });

const dbPath = path.join(config.DATA_DIR, "aipac.db");
const legacyDbPath = path.join(config.DATA_DIR, "pac.db");
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  fs.renameSync(legacyDbPath, dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const from = legacyDbPath + suffix;
    const to = dbPath + suffix;
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  }
}
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  content TEXT,
  raw_json TEXT,
  status TEXT NOT NULL DEFAULT 'raw',
  summary TEXT,
  rewritten TEXT,
  ai_title TEXT,
  tags_json TEXT,
  image_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, external_id),
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS publish_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  remote_id TEXT,
  remote_url TEXT,
  error TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, target_id),
  FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES publish_targets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);
`);

export type SourceRow = {
  id: number;
  name: string;
  type: string;
  config_json: string;
  enabled: number;
};

export type ItemRow = {
  id: number;
  source_id: number | null;
  external_id: string;
  title: string;
  url: string | null;
  content: string | null;
  raw_json: string | null;
  status: string;
  summary: string | null;
  rewritten: string | null;
  ai_title: string | null;
  tags_json: string | null;
  image_url: string | null;
  error: string | null;
};

export type TargetRow = {
  id: number;
  name: string;
  type: string;
  config_json: string;
  enabled: number;
};

export function logJob(job: string, message: string, level: "info" | "error" | "warn" = "info") {
  db.prepare(`INSERT INTO job_logs (job, level, message) VALUES (?, ?, ?)`).run(
    job,
    level,
    message
  );
  const prefix = `[${job}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}

export function seedDefaults() {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM sources`).get() as { c: number };
  if (count.c === 0) {
    seedFresh();
  }
  migrateTargets();
}

export function clearLogs() {
  const info = db.prepare(`DELETE FROM job_logs`).run();
  logJob("settings", `已清空历史日志`);
  return Number(info.changes);
}

function seedFresh() {
  const insertSource = db.prepare(
    `INSERT INTO sources (name, type, config_json, enabled) VALUES (?, ?, ?, ?)`
  );
  for (const s of FOREIGN_SOURCES) {
    insertSource.run(s.name, s.type, JSON.stringify(s.config), s.enabled);
  }

  const insertTarget = db.prepare(
    `INSERT INTO publish_targets (name, type, config_json, enabled) VALUES (?, ?, ?, ?)`
  );
  if (config.WP_URL && config.WP_USER && config.WP_APP_PASSWORD) {
    insertTarget.run(
      "WordPress",
      "wordpress",
      JSON.stringify({
        url: config.WP_URL,
        user: config.WP_USER,
        appPassword: config.WP_APP_PASSWORD,
      }),
      1
    );
  } else {
    insertTarget.run(
      "WordPress (请配置)",
      "wordpress",
      JSON.stringify({ url: "", user: "", appPassword: "" }),
      0
    );
  }

  insertTarget.run(
    "公众号 · Markdown导出",
    "wechat_mp",
    JSON.stringify({ platform: "wechat_mp", style: "wechat_classic" }),
    1
  );
  insertTarget.run(
    "小红书 · Markdown导出",
    "xiaohongshu",
    JSON.stringify({ platform: "xiaohongshu", style: "xhs_note" }),
    0
  );
  insertTarget.run(
    "知乎 · Markdown导出",
    "zhihu",
    JSON.stringify({ platform: "zhihu", style: "zhihu_clean" }),
    0
  );
  insertTarget.run(
    "头条 · Markdown导出",
    "toutiao",
    JSON.stringify({ platform: "toutiao", style: "toutiao_news" }),
    0
  );
  insertTarget.run(
    "抖音 · 文案导出",
    "douyin",
    JSON.stringify({ platform: "douyin" }),
    0
  );

  logJob("seed", "已写入资讯预置源与发布目标");
}

/** 重置为 AI / 科技资讯预置源 */
export function resetForeignSources() {
  db.prepare(`DELETE FROM sources`).run();
  const insertSource = db.prepare(
    `INSERT INTO sources (name, type, config_json, enabled) VALUES (?, ?, ?, ?)`
  );
  for (const s of FOREIGN_SOURCES) {
    insertSource.run(s.name, s.type, JSON.stringify(s.config), s.enabled);
  }
  // 仅清掉「仓库 trending」类噪音，保留 github.blog 等文章
  const cleaned = db
    .prepare(
      `DELETE FROM items WHERE status IN ('raw','processing','error')
       AND url GLOB 'https://github.com/*/*'
       AND url NOT LIKE '%github.com/blog%'
       AND url NOT LIKE '%github.blog%'`
    )
    .run();
  logJob(
    "seed",
    `已重置 AI/科技预置源 ${FOREIGN_SOURCES.length} 个，清理旧仓库稿 ${Number(cleaned.changes)} 条`
  );
  return FOREIGN_SOURCES.length;
}

/** 旧库升级：占位目标改为 Markdown 导出 */
function migrateTargets() {
  const rows = db.prepare(`SELECT id, type, name, config_json FROM publish_targets`).all() as {
    id: number;
    type: string;
    name: string;
    config_json: string;
  }[];
  const map: Record<string, string> = {
    wechat_mp: "公众号 · Markdown导出",
    xiaohongshu: "小红书 · Markdown导出",
    zhihu: "知乎 · Markdown导出",
    toutiao: "头条 · Markdown导出",
    douyin: "抖音 · 文案导出",
  };
  const existingTypes = new Set(rows.map((r) => r.type));
  if (!existingTypes.has("douyin")) {
    db.prepare(
      `INSERT INTO publish_targets (name, type, config_json, enabled) VALUES (?, ?, ?, 0)`
    ).run("抖音 · 文案导出", "douyin", JSON.stringify({ platform: "douyin" }));
  }
  for (const row of rows) {
    if (!map[row.type]) continue;
    const cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    let changed = false;
    if (!row.name.includes("Markdown") && !cfg.platform) {
      cfg.platform = row.type;
      changed = true;
    }
    if (!cfg.style) {
      const styleMap: Record<string, string> = {
        wechat_mp: "wechat_classic",
        xiaohongshu: "xhs_note",
        zhihu: "zhihu_clean",
        toutiao: "toutiao_news",
      };
      cfg.style = styleMap[row.type];
      changed = true;
    }
    if (!cfg.platform) {
      cfg.platform = row.type;
      changed = true;
    }
    if (changed) {
      db.prepare(
        `UPDATE publish_targets SET name = CASE WHEN name LIKE '%占位%' OR name NOT LIKE '%导出%' THEN ? ELSE name END,
         config_json = ?,
         enabled = CASE WHEN type = 'wechat_mp' THEN 1 ELSE enabled END
         WHERE id = ?`
      ).run(map[row.type], JSON.stringify(cfg), row.id);
    }
  }
}
