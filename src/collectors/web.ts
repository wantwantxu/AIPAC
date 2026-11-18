import type { CollectedItem, Collector } from "./base.js";
import {
  fetchArticleFulltext,
  fetchHtml,
  pickContent,
  pickTitle,
} from "./article.js";

/**
 * 通用列表页采集：政府站 / 行业站可配 linkPattern。
 */
export const webListCollector: Collector = {
  type: "web_list",
  async collect(config) {
    const listUrl = String(config.listUrl || "");
    const linkPattern = String(config.linkPattern || "");
    if (!listUrl || !linkPattern) {
      throw new Error("web_list 需要 listUrl 与 linkPattern");
    }
    const baseUrl = String(config.baseUrl || listUrl);
    const maxItems = Math.min(Number(config.maxItems || 20), 50);
    const fetchDetail = config.fetchDetail !== false;

    const listHtml = await fetchHtml(listUrl);
    const re = new RegExp(linkPattern, "gi");
    const seen = new Set<string>();
    const candidates: { url: string; title?: string }[] = [];

    let m: RegExpExecArray | null;
    while ((m = re.exec(listHtml)) && candidates.length < maxItems * 2) {
      const href = m[1];
      if (!href || href.startsWith("javascript:")) continue;
      let url = href;
      try {
        url = new URL(href, baseUrl).href;
      } catch {
        // keep
      }
      if (seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        url,
        title: m[2] ? m[2].replace(/<[^>]+>/g, "").trim() : undefined,
      });
    }

    const items: CollectedItem[] = [];
    for (const c of candidates.slice(0, maxItems)) {
      if (!fetchDetail) {
        items.push({
          externalId: c.url,
          title: c.title || c.url,
          url: c.url,
          content: c.title || "",
        });
        continue;
      }
      const got = await fetchArticleFulltext(c.url, "");
      items.push({
        externalId: c.url,
        title: c.title || got.title || c.url,
        url: c.url,
        content: got.content || `详情拉取失败`,
        raw: { fulltext: got.fulltext },
      });
    }
    return items;
  },
};

export const urlImportCollector: Collector = {
  type: "url_import",
  async collect(config) {
    const urls = Array.isArray(config.urls)
      ? config.urls.map(String)
      : String(config.urls || "")
          .split(/\n|,/)
          .map((s) => s.trim())
          .filter(Boolean);
    const items: CollectedItem[] = [];
    for (const url of urls.slice(0, 30)) {
      try {
        const html = await fetchHtml(url);
        items.push({
          externalId: url,
          title: pickTitle(html, url),
          url,
          content: pickContent(html),
          raw: { fulltext: true },
        });
      } catch (err) {
        items.push({
          externalId: url,
          title: url,
          url,
          content: `拉取失败: ${(err as Error).message}`,
        });
      }
    }
    return items;
  },
};
