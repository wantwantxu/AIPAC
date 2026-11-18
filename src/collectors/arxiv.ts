import type { CollectedItem, Collector } from "./base.js";

/**
 * arXiv 论文采集（免费 API，无需 Key）
 * config:
 *  - query: 搜索式，如 cat:cs.AI 或 all:transformer
 *  - category: 简写，如 cs.AI / cs.LG / cs.CL（有则优先生效拼成 cat:xxx）
 *  - maxResults: 默认 15，最大 30
 *  - sortBy: submittedDate | relevance | lastUpdatedDate
 */
export const arxivCollector: Collector = {
  type: "arxiv",
  async collect(config) {
    const category = String(config.category || "").trim();
    const query = category
      ? `cat:${category}`
      : String(config.query || "cat:cs.AI").trim();
    const maxResults = Math.min(Number(config.maxResults || 15), 30);
    const sortBy = String(config.sortBy || "submittedDate");
    const sortOrder = String(config.sortOrder || "descending");

    const api =
      `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
      `&start=0&max_results=${maxResults}` +
      `&sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}`;

    const res = await fetch(api, {
      headers: {
        Accept: "application/atom+xml",
        "User-Agent": "pac-arxiv/1.0 (research summarizer; mailto:local@pac)",
      },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`arXiv API ${res.status}`);
    const xml = await res.text();
    return parseArxivAtom(xml);
  },
};

/** 按 arXiv id 拉取单篇，如 2401.12345 或 2401.12345v2 */
export async function fetchArxivById(id: string): Promise<CollectedItem | null> {
  const clean = id.replace(/^arxiv:/i, "").trim();
  if (!clean) return null;
  const api = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(clean)}`;
  const res = await fetch(api, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "pac-arxiv/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`arXiv API ${res.status}`);
  const items = parseArxivAtom(await res.text());
  return items[0] || null;
}

function parseArxivAtom(xml: string): CollectedItem[] {
  const entries = xml.split(/<entry>/i).slice(1);
  const items: CollectedItem[] = [];

  for (const chunk of entries) {
    const entry = chunk.split(/<\/entry>/i)[0] || chunk;
    const idUrl = textOf(entry, "id");
    const title = decodeXml(textOf(entry, "title")).replace(/\s+/g, " ").trim();
    const summary = decodeXml(textOf(entry, "summary")).replace(/\s+/g, " ").trim();
    const published = textOf(entry, "published");
    const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/gi)].map((m) =>
      decodeXml(m[1]).trim()
    );
    const cats = [...entry.matchAll(/term="([^"]+)"/gi)].map((m) => m[1]);
    const pdf =
      entry.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/i)?.[1] ||
      entry.match(/<link[^>]+href="([^"]+)"[^>]+title="pdf"/i)?.[1] ||
      (idUrl ? idUrl.replace("/abs/", "/pdf/") + ".pdf" : "");

    const absUrl = idUrl.includes("/abs/")
      ? idUrl
      : idUrl.replace("http://arxiv.org/abs/", "https://arxiv.org/abs/");
    const arxivId =
      absUrl.match(/arxiv\.org\/abs\/([^\s/?]+)/i)?.[1] ||
      idUrl.split("/").pop() ||
      title;

    if (!title) continue;

    const content = [
      `Authors: ${authors.join(", ") || "N/A"}`,
      `Categories: ${cats.join(", ") || "N/A"}`,
      `Published: ${published || "N/A"}`,
      `PDF: ${pdf || "N/A"}`,
      "",
      "Abstract:",
      summary,
    ].join("\n");

    items.push({
      externalId: `arxiv:${arxivId}`,
      title,
      url: absUrl.startsWith("http") ? absUrl : `https://arxiv.org/abs/${arxivId}`,
      content,
      raw: {
        kind: "arxiv",
        arxivId,
        authors,
        categories: cats,
        pdf,
        published,
      },
    });
  }
  return items;
}

function textOf(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1]?.trim() || "";
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
