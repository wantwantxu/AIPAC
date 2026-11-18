import { db, logJob, type SourceRow } from "../db/index.js";
import type { Collector } from "./base.js";
import { rssCollector } from "./rss.js";
import { githubTrendingCollector } from "./github.js";
import { urlImportCollector, webListCollector } from "./web.js";
import { arxivCollector } from "./arxiv.js";
import { stubCollectors } from "./stubs.js";

const collectors: Record<string, Collector> = {
  [rssCollector.type]: rssCollector,
  [githubTrendingCollector.type]: githubTrendingCollector,
  [webListCollector.type]: webListCollector,
  [urlImportCollector.type]: urlImportCollector,
  [arxivCollector.type]: arxivCollector,
};

for (const c of stubCollectors) collectors[c.type] = c;

const upsert = db.prepare(`
INSERT INTO items (source_id, external_id, title, url, content, raw_json, status)
VALUES (?, ?, ?, ?, ?, ?, 'raw')
ON CONFLICT(source_id, external_id) DO NOTHING
`);

export async function runCollectJob(sourceId?: number) {
  const sources = (
    sourceId
      ? db.prepare(`SELECT * FROM sources WHERE id = ? AND enabled = 1`).all(sourceId)
      : db.prepare(`SELECT * FROM sources WHERE enabled = 1`).all()
  ) as SourceRow[];

  let inserted = 0;
  for (const source of sources) {
    const collector = collectors[source.type];
    if (!collector) {
      logJob("collect", `未知源类型: ${source.type}`, "warn");
      continue;
    }
    try {
      const cfg = JSON.parse(source.config_json || "{}") as Record<string, unknown>;
      const items = await collector.collect(cfg);
      let sourceInserted = 0;
      db.exec("BEGIN");
      try {
        for (const item of items) {
          const info = upsert.run(
            source.id,
            item.externalId,
            item.title,
            item.url ?? null,
            item.content ?? null,
            item.raw ? JSON.stringify(item.raw) : null
          );
          sourceInserted += Number(info.changes);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      inserted += sourceInserted;
      logJob(
        "collect",
        `${source.name}: 拉取 ${items.length} 条，新增 ${sourceInserted} 条`
      );
    } catch (err) {
      logJob("collect", `${source.name} 失败: ${(err as Error).message}`, "error");
    }
  }
  return { sources: sources.length, inserted };
}

export function listCollectorTypes() {
  return Object.keys(collectors);
}

export function insertItems(
  rows: {
    externalId: string;
    title: string;
    url?: string;
    content?: string;
    raw?: unknown;
  }[],
  sourceId: number | null = null
) {
  let inserted = 0;
  const stmt = db.prepare(`
    INSERT INTO items (source_id, external_id, title, url, content, raw_json, status)
    VALUES (?, ?, ?, ?, ?, ?, 'raw')
    ON CONFLICT(source_id, external_id) DO NOTHING
  `);
  for (const row of rows) {
    const exists = db
      .prepare(`SELECT id FROM items WHERE external_id = ? LIMIT 1`)
      .get(row.externalId);
    if (exists) continue;
    const info = stmt.run(
      sourceId,
      row.externalId,
      row.title,
      row.url ?? null,
      row.content ?? null,
      row.raw ? JSON.stringify(row.raw) : null
    );
    inserted += Number(info.changes);
  }
  return inserted;
}
