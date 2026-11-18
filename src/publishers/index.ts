import { db, logJob, type ItemRow, type TargetRow } from "../db/index.js";
import type { Publisher } from "./base.js";
import { wordpressPublisher } from "./wordpress.js";
import { exportAliases, markdownExportPublisher } from "./markdown.js";
import { douyinPublisher } from "./douyin.js";

const publishers: Record<string, Publisher> = {
  [wordpressPublisher.type]: wordpressPublisher,
  [markdownExportPublisher.type]: markdownExportPublisher,
  [douyinPublisher.type]: douyinPublisher,
};
for (const p of exportAliases) publishers[p.type] = p;

async function publishOneItem(item: ItemRow, targets: TargetRow[]) {
  let published = 0;
  let allOk = true;
  let attempted = false;

  for (const target of targets) {
    const existing = db
      .prepare(`SELECT status FROM publications WHERE item_id = ? AND target_id = ?`)
      .get(item.id, target.id) as { status: string } | undefined;
    if (existing?.status === "published") continue;

    const publisher = publishers[target.type];
    if (!publisher) {
      allOk = false;
      continue;
    }

    attempted = true;
    db.prepare(
      `INSERT INTO publications (item_id, target_id, status)
       VALUES (?, ?, 'pending')
       ON CONFLICT(item_id, target_id) DO UPDATE SET status = 'pending', error = NULL`
    ).run(item.id, target.id);

    try {
      const cfg = JSON.parse(target.config_json || "{}") as Record<string, unknown>;
      const tags = item.tags_json ? (JSON.parse(item.tags_json) as string[]) : [];
      const result = await publisher.publish(cfg, {
        title: item.ai_title || item.title,
        content: item.rewritten || item.content || item.title,
        summary: item.summary || undefined,
        tags,
        imageUrl: item.image_url || undefined,
        sourceUrl: item.url || undefined,
      });
      db.prepare(
        `UPDATE publications SET status = 'published', remote_id = ?, remote_url = ?,
         published_at = datetime('now'), error = NULL WHERE item_id = ? AND target_id = ?`
      ).run(result.remoteId ?? null, result.remoteUrl ?? null, item.id, target.id);
      published += 1;
      logJob("publish", `#${item.id} → ${target.name} 成功`);
    } catch (err) {
      allOk = false;
      db.prepare(
        `UPDATE publications SET status = 'error', error = ? WHERE item_id = ? AND target_id = ?`
      ).run((err as Error).message, item.id, target.id);
      logJob(
        "publish",
        `#${item.id} → ${target.name} 失败: ${(err as Error).message}`,
        "error"
      );
    }
  }

  if (allOk && attempted) {
    db.prepare(
      `UPDATE items SET status = 'published', updated_at = datetime('now') WHERE id = ?`
    ).run(item.id);
  }

  return { published, attempted, allOk };
}

export async function publishItemById(id: number) {
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
  if (!item) throw new Error("稿件不存在");
  if (!item.rewritten) {
    throw new Error("请先完成 AI 加工再发布");
  }

  const targets = db
    .prepare(`SELECT * FROM publish_targets WHERE enabled = 1`)
    .all() as TargetRow[];
  if (!targets.length) throw new Error("无启用的发布目标");

  // 允许对已发布稿件强制重发：清掉成功记录
  db.prepare(
    `DELETE FROM publications WHERE item_id = ? AND status = 'published'`
  ).run(id);

  const fresh = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow;
  const result = await publishOneItem(fresh, targets);
  return { ok: true, id, ...result };
}

export async function runPublishJob(limit = 5) {
  const targets = db
    .prepare(`SELECT * FROM publish_targets WHERE enabled = 1`)
    .all() as TargetRow[];
  if (!targets.length) {
    logJob("publish", "无启用的发布目标", "warn");
    return { published: 0 };
  }

  const items = db
    .prepare(`SELECT * FROM items WHERE status = 'ready' ORDER BY id ASC LIMIT ?`)
    .all(limit) as ItemRow[];

  let published = 0;
  for (const item of items) {
    const r = await publishOneItem(item, targets);
    published += r.published;
  }
  return { published };
}

export function listPublisherTypes() {
  return Object.keys(publishers);
}
