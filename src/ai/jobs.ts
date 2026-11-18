import { db, logJob, type ItemRow } from "../db/index.js";
import { fetchArticleFulltext, isThinContent } from "../collectors/article.js";
import { enrichGithubContent } from "../collectors/github.js";
import { processContent } from "./pipeline.js";

const updateStmt = db.prepare(`
UPDATE items SET
  status = 'ready',
  summary = ?,
  rewritten = ?,
  ai_title = ?,
  tags_json = ?,
  image_url = ?,
  error = NULL,
  updated_at = datetime('now')
WHERE id = ?
`);

const failStmt = db.prepare(`
UPDATE items SET status = 'error', error = ?, updated_at = datetime('now')
WHERE id = ?
`);

function looksThinGithub(item: ItemRow): boolean {
  const url = item.url || "";
  if (!/github\.com\//i.test(url)) return false;
  const c = item.content || "";
  if (/--- README ---/i.test(c) && c.length > 400) return false;
  return c.length < 500 || /Stars:\s*\d+/i.test(c);
}

async function ensureFulltext(item: ItemRow): Promise<string> {
  let content = item.content || "";

  if (looksThinGithub(item)) {
    logJob("process", `#${item.id} GitHub 内容过薄，补拉 README…`);
    content = await enrichGithubContent({
      title: item.title,
      url: item.url,
      content: item.content,
    });
  } else if (item.url && isThinContent(content, 1500)) {
    logJob("process", `#${item.id} 摘要过短（${content.length} 字），抓取原文全文…`);
    const got = await fetchArticleFulltext(item.url, content);
    if (got.content.length > content.length) {
      content = got.content;
      logJob("process", `#${item.id} 全文已补到 ${content.length} 字`);
    } else {
      logJob("process", `#${item.id} 全文抓取失败，仍用摘要 ${content.length} 字`);
    }
  }

  if (content !== (item.content || "")) {
    db.prepare(
      `UPDATE items SET content = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(content, item.id);
  }
  return content;
}

export async function processItemById(id: number) {
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
  if (!item) throw new Error("稿件不存在");

  db.prepare(
    `UPDATE items SET status = 'processing', error = NULL, updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  try {
    const content = await ensureFulltext(item);
    const result = await processContent({
      title: item.title,
      content,
      url: item.url,
      rawJson: item.raw_json,
    });
    updateStmt.run(
      result.summary,
      result.rewritten,
      result.title,
      JSON.stringify(result.tags),
      result.imageUrl ?? null,
      item.id
    );
    logJob("process", `单篇完成 #${item.id} ${result.title}`);
    return { ok: true, id, title: result.title, summary: result.summary };
  } catch (err) {
    failStmt.run((err as Error).message, item.id);
    logJob("process", `#${item.id} 失败: ${(err as Error).message}`, "error");
    throw err;
  }
}

export async function runProcessJob(limit = 5) {
  const items = db
    .prepare(`SELECT * FROM items WHERE status = 'raw' ORDER BY id ASC LIMIT ?`)
    .all(limit) as ItemRow[];

  let ok = 0;
  for (const item of items) {
    try {
      await processItemById(item.id);
      ok += 1;
    } catch {
      // already logged
    }
  }
  return { processed: items.length, ok };
}
