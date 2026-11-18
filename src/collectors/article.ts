const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(35000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const ctype = res.headers.get("content-type") || "";
  if (/gbk|gb2312|gb18030/i.test(ctype)) {
    return new TextDecoder("gbk").decode(bytes);
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (utf8.includes("\uFFFD") && /charset\s*=\s*gb/i.test(utf8.slice(0, 2000))) {
    return new TextDecoder("gbk").decode(bytes);
  }
  return utf8;
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function pickTitle(html: string, fallback: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return stripTags(h1).slice(0, 200);
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  )?.[1];
  if (og) return og.slice(0, 200);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (t) return stripTags(t).slice(0, 200);
  return fallback;
}

const CONTENT_SELECTORS = [
  /itemprop=["']articleBody["'][^>]*>([\s\S]*?)(?:<\/div>|<\/section>|<\/article>)/i,
  /<article[^>]*>([\s\S]*?)<\/article>/i,
  /class=["'][^"']*(?:article-body|article__body|article-content|post-content|entry-content|story-body|story__body|content__body|rich-text|article_content|post_body|news-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/i,
  /id=["'](?:article-body|content|story|main-content|js_content)["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/i,
  /<main[^>]*>([\s\S]*?)<\/main>/i,
];

export function pickContent(html: string): string {
  for (const re of CONTENT_SELECTORS) {
    const m = html.match(re);
    if (m?.[1]) {
      const text = stripTags(m[1]);
      if (text.length >= 200) return text.slice(0, 20000);
    }
  }
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  // 去掉常见导航噪音后再抽
  const cleaned = body
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");
  return stripTags(cleaned).slice(0, 20000);
}

export function isThinContent(text: string | null | undefined, minLen = 400): boolean {
  const t = String(text || "").trim();
  if (t.length < minLen) return true;
  // RSS 常见「Read more」残片
  if (/read more|continue reading|点击查看|详见原文/i.test(t) && t.length < 800) return true;
  return false;
}

/** 打开原文页抓取全文；失败则返回原摘要 */
export async function fetchArticleFulltext(
  url: string,
  fallback = ""
): Promise<{ title?: string; content: string; fulltext: boolean }> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { content: fallback, fulltext: false };
  }
  try {
    const html = await fetchHtml(url);
    const content = pickContent(html);
    if (!content || content.length < Math.max(fallback.length, 120)) {
      return { content: fallback || content, fulltext: false };
    }
    return {
      title: pickTitle(html, ""),
      content,
      fulltext: content.length >= 400,
    };
  } catch {
    return { content: fallback, fulltext: false };
  }
}
