import Parser from "rss-parser";
import type { CollectedItem, Collector } from "./base.js";
import { fetchArticleFulltext, isThinContent, stripTags } from "./article.js";

type RssItem = {
  title?: string;
  link?: string;
  guid?: string;
  id?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  contentEncoded?: string;
  "content:encoded"?: string;
};

const parser = new Parser({
  timeout: 30000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["content:encoded", "content:encoded"],
    ],
  },
});

function feedBody(item: RssItem): string {
  const raw =
    item.contentEncoded ||
    item["content:encoded"] ||
    item.content ||
    item.summary ||
    item.contentSnippet ||
    "";
  // content 可能是 HTML
  const text = /</.test(raw) ? stripTags(raw) : String(raw);
  return text.trim();
}

/**
 * RSS 采集：优先用全文字段；若只有摘要则打开原文链接抓取全文。
 * config:
 *  - url: feed 地址
 *  - maxItems: 默认 15
 *  - fetchFulltext: 默认 true
 *  - minLength: 低于此长度视为摘要并抓原文，默认 1500（RSS 常给 500–800 字导语）
 */
export const rssCollector: Collector = {
  type: "rss",
  async collect(config) {
    const url = String(config.url || "");
    if (!url) throw new Error("RSS 源缺少 url");

    const maxItems = Math.min(Number(config.maxItems || 15), 30);
    const fetchFulltext = config.fetchFulltext !== false;
    const minLength = Number(config.minLength || 1500);

    const feed = await parser.parseURL(url);
    const items: CollectedItem[] = [];

    for (const item of (feed.items || []).slice(0, maxItems) as RssItem[]) {
      const externalId =
        item.guid || item.link || item.id || `${item.title}-${item.isoDate || item.pubDate}`;
      let content = feedBody(item);
      let fulltext = !isThinContent(content, minLength);

      if (fetchFulltext && item.link && isThinContent(content, minLength)) {
        const before = content.length;
        const got = await fetchArticleFulltext(item.link, content);
        if (got.content && got.content.length > content.length) {
          content = got.content;
          fulltext = got.fulltext;
        } else if (!got.fulltext) {
          console.warn(
            `[rss] 全文未拿到 ${item.link}（摘要 ${before} 字 → ${got.content?.length || 0}）`
          );
        }
      }

      items.push({
        externalId: String(externalId),
        title: item.title || "(无标题)",
        url: item.link,
        content,
        raw: { ...item, fulltext },
      });
    }

    return items;
  },
};
