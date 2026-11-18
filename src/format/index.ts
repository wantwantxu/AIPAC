import {
  blocksToMarkdown,
  blocksToPlain,
  escapeHtml,
  inlineHtml,
  parseBlocks,
  type Block,
} from "./parse.js";
import {
  STYLE_OPTIONS,
  defaultStyleFor,
  isWechatStyle,
  type FormatInput,
  type FormatOutput,
  type FormatPlatform,
  type StylePreset,
} from "./types.js";
import { ensureImportant, makeWeChatCompatible } from "./wechatCompat.js";

type Theme = {
  title: string;
  h2: string;
  h3: string;
  p: string;
  quote: string;
  ul: string;
  li: string;
  summary: string;
  footer: string;
  wrap: string;
  strong?: string;
  em?: string;
  a?: string;
  img?: string;
};

/** 主题内联样式（关键声明带 !important，对齐花生 / Raphael 公众号粘贴策略） */
const THEMES: Record<StylePreset, Theme> = {
  wechat_classic: {
    wrap: "max-width:677px;margin:0 auto;padding:10px 12px 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.8;color:#3f3f3f;background-color:#fff;word-wrap:break-word;",
    title:
      "display:block;text-align:center;font-size:22px;font-weight:700;line-height:1.4;margin:24px 0 16px;color:#1a1a1a;padding-bottom:8px;border-bottom:2px solid #07c160;",
    summary:
      "margin:0 0 20px;padding:12px 14px;background-color:#f7f7f7;border-left:4px solid #07c160;color:#666;font-size:15px;line-height:1.7;",
    h2: "margin:28px 0 14px;padding-left:12px;border-left:4px solid #07c160;font-size:18px;font-weight:600;color:#2c3e50;line-height:1.4;",
    h3: "margin:24px 0 12px;font-size:17px;font-weight:600;color:#34495e;line-height:1.4;",
    p: "margin:16px 0;text-align:justify;text-indent:2em;color:#3f3f3f;font-size:16px;line-height:1.8;",
    quote:
      "margin:16px 0;padding:8px 16px;background-color:#fafafa;border-left:3px solid #999;color:#666;font-size:15px;line-height:1.5;",
    ul: "margin:16px 0;padding-left:24px;",
    li: "margin:8px 0;line-height:1.8;color:#3f3f3f;",
    strong: "font-weight:600;color:#2c3e50;",
    em: "font-style:italic;color:#555;",
    a: "color:#07c160;text-decoration:none;border-bottom:1px solid #07c160;",
    img: "max-width:100%;max-height:600px;height:auto;display:block;margin:20px auto;border-radius:8px;",
    footer:
      "margin-top:28px;padding-top:14px;border-top:1px solid #e0e0e0;color:#999;font-size:13px;line-height:1.6;",
  },
  wechat_tech: {
    wrap: "max-width:677px;margin:0 auto;padding:10px 12px 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.8;color:#222;background-color:#fff;word-wrap:break-word;",
    title:
      "display:block;font-size:22px;font-weight:700;line-height:1.35;margin:20px 0 12px;color:#111;",
    summary:
      "margin:0 0 22px;padding:14px 16px;background-color:#f0f7ff;border-radius:8px;color:#445;font-size:15px;line-height:1.7;",
    h2: "margin:26px 0 12px;padding:8px 12px;background-color:#1f6feb;color:#fff;font-size:16px;font-weight:700;border-radius:6px;line-height:1.4;",
    h3: "margin:18px 0 8px;font-size:16px;font-weight:700;color:#1f6feb;line-height:1.4;",
    p: "margin:14px 0;color:#222;font-size:16px;line-height:1.85;",
    quote:
      "margin:16px 0;padding:12px 14px;background-color:#f5f8fc;border-radius:6px;color:#456;font-size:15px;line-height:1.6;",
    ul: "margin:16px 0;padding-left:24px;",
    li: "margin:8px 0;line-height:1.75;color:#222;",
    strong: "font-weight:700;color:#1f6feb;",
    em: "font-style:italic;color:#555;",
    a: "color:#1f6feb;text-decoration:none;border-bottom:1px solid #1f6feb;",
    img: "max-width:100%;height:auto;display:block;margin:20px auto;border-radius:6px;",
    footer: "margin-top:28px;color:#888;font-size:13px;line-height:1.6;",
  },
  wechat_latepost: {
    wrap: "max-width:700px;margin:0 auto;padding:16px 12px 36px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:17px;line-height:1.8;color:#1a1a1a;background-color:#fff;word-wrap:break-word;",
    title:
      "display:block;font-size:26px;font-weight:700;color:#1a1a1a;line-height:1.3;margin:36px 0 18px;padding-left:16px;border-left:5px solid #d32f2f;",
    summary:
      "margin:0 0 20px;padding:12px 18px;background-color:#f5f5f5;border-left:4px solid #d32f2f;color:#1a1a1a;font-size:16px;line-height:1.6;border-radius:4px;",
    h2: "margin:32px 0 16px;padding:12px 20px;background-color:#d32f2f;color:#fff;font-size:20px;font-weight:600;line-height:1.4;border-radius:4px;",
    h3: "margin:28px 0 14px;padding-left:14px;border-left:4px solid #d32f2f;font-size:18px;font-weight:600;color:#d32f2f;line-height:1.45;",
    p: "margin:18px 0;color:#1a1a1a;font-size:17px;line-height:1.85;",
    quote:
      "margin:20px 0;padding:12px 18px;background-color:#f5f5f5;border-left:4px solid #d32f2f;color:#1a1a1a;font-size:16px;line-height:1.6;border-radius:4px;",
    ul: "margin:20px 0;padding-left:28px;list-style-type:disc;",
    li: "margin:10px 0;line-height:1.8;color:#1a1a1a;",
    strong:
      "font-weight:700;color:#d32f2f;background-color:rgba(211,47,47,0.08);padding:2px 6px;border-radius:3px;",
    em: "font-style:italic;color:#666;",
    a: "color:#d32f2f;text-decoration:none;border-bottom:1px solid #d32f2f;",
    img: "max-width:100%;max-height:500px;height:auto;display:block;margin:24px auto;border-radius:6px;border:2px solid #d32f2f;",
    footer:
      "margin-top:32px;padding-top:14px;border-top:1px solid #e0e0e0;color:#999;font-size:13px;line-height:1.6;",
  },
  zhihu_clean: {
    wrap: "max-width:720px;margin:0 auto;color:#1a1a1a;font-size:16px;line-height:1.8;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;",
    title: "font-size:24px;font-weight:700;margin:0 0 12px;line-height:1.35;",
    summary: "margin:0 0 20px;color:#646464;font-size:15px;padding:0;border:0;",
    h2: "margin:28px 0 12px;font-size:20px;font-weight:700;",
    h3: "margin:20px 0 10px;font-size:17px;font-weight:700;",
    p: "margin:0 0 16px;line-height:1.8;",
    quote: "margin:16px 0;padding-left:12px;border-left:3px solid #ebebeb;color:#646464;",
    ul: "margin:0 0 16px;padding-left:1.4em;",
    li: "margin:0 0 6px;",
    footer: "margin-top:24px;color:#8590a6;font-size:13px;",
  },
  xhs_note: {
    wrap: "max-width:640px;margin:0 auto;color:#333;font-size:16px;line-height:1.9;font-family:-apple-system,'PingFang SC',sans-serif;",
    title: "font-size:20px;font-weight:700;margin:0 0 14px;line-height:1.4;",
    summary: "margin:0 0 18px;color:#666;font-size:15px;",
    h2: "margin:22px 0 10px;font-size:17px;font-weight:700;color:#ff2442;",
    h3: "margin:16px 0 8px;font-size:16px;font-weight:700;",
    p: "margin:0 0 16px;line-height:1.9;",
    quote: "margin:14px 0;color:#666;",
    ul: "margin:0 0 16px;padding-left:1.2em;",
    li: "margin:0 0 10px;",
    footer: "margin-top:20px;color:#999;font-size:13px;",
  },
  toutiao_news: {
    wrap: "max-width:720px;margin:0 auto;color:#222;font-size:17px;line-height:1.8;font-family:'PingFang SC','Microsoft YaHei',sans-serif;",
    title: "font-size:22px;font-weight:700;margin:0 0 14px;",
    summary: "margin:0 0 18px;padding:10px 12px;background:#fafafa;color:#555;font-size:15px;",
    h2: "margin:24px 0 10px;font-size:18px;font-weight:700;border-bottom:1px solid #eee;padding-bottom:6px;",
    h3: "margin:18px 0 8px;font-size:16px;font-weight:700;",
    p: "margin:0 0 14px;text-align:justify;",
    quote: "margin:14px 0;padding:10px;background:#f7f7f7;color:#555;",
    ul: "margin:0 0 14px;padding-left:1.4em;",
    li: "margin:0 0 6px;",
    footer: "margin-top:24px;color:#999;font-size:13px;",
  },
  wp_semantic: {
    wrap: "",
    title: "",
    summary: "",
    h2: "",
    h3: "",
    p: "",
    quote: "",
    ul: "",
    li: "",
    footer: "",
  },
};

function hardenTheme(theme: Theme): Theme {
  const out = { ...theme };
  for (const key of Object.keys(out) as (keyof Theme)[]) {
    const v = out[key];
    if (typeof v === "string" && v) out[key] = ensureImportant(v);
  }
  return out;
}

function styledInline(text: string, theme: Theme): string {
  let html = inlineHtml(text);
  if (theme.strong) {
    html = html.replace(/<strong>/gi, `<strong style="${theme.strong}">`);
  }
  if (theme.em) {
    html = html.replace(/<em>/gi, `<em style="${theme.em}">`);
  }
  if (theme.a) {
    html = html.replace(/<a(\s+)/gi, `<a style="${theme.a}"$1`);
  }
  return html;
}

function renderBlocksHtml(blocks: Block[], theme: Theme, semantic: boolean): string {
  return blocks
    .map((b) => {
      if (semantic) {
        switch (b.type) {
          case "h2":
            return `<h2>${inlineHtml(b.text)}</h2>`;
          case "h3":
            return `<h3>${inlineHtml(b.text)}</h3>`;
          case "quote":
            return `<blockquote><p>${inlineHtml(b.text)}</p></blockquote>`;
          case "ul":
            return `<ul>${b.items.map((x) => `<li>${inlineHtml(x)}</li>`).join("")}</ul>`;
          case "ol":
            return `<ol>${b.items.map((x) => `<li>${inlineHtml(x)}</li>`).join("")}</ol>`;
          default:
            return `<p>${inlineHtml(b.text)}</p>`;
        }
      }
      const inline = (t: string) => styledInline(t, theme);
      switch (b.type) {
        case "h2":
          return `<h2 style="${theme.h2}">${inline(b.text)}</h2>`;
        case "h3":
          return `<h3 style="${theme.h3}">${inline(b.text)}</h3>`;
        case "quote":
          // 不用 li/p 嵌套：blockquote 内直接文本，降低微信塌陷概率
          return `<blockquote style="${theme.quote}">${inline(b.text)}</blockquote>`;
        case "ul":
          return `<ul style="${theme.ul}">${b.items
            .map((x) => `<li style="${theme.li}">${inline(x)}</li>`)
            .join("")}</ul>`;
        case "ol":
          return `<ol style="${theme.ul}">${b.items
            .map((x) => `<li style="${theme.li}">${inline(x)}</li>`)
            .join("")}</ol>`;
        default:
          return `<p style="${theme.p}">${inline(b.text)}</p>`;
      }
    })
    .join("\n");
}

function buildMarkdownDoc(input: FormatInput, bodyMd: string, platform: FormatPlatform): string {
  const tags = (input.tags || []).map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  if (platform === "xiaohongshu") {
    return [
      input.title,
      "",
      input.summary || "",
      "",
      bodyMd.replace(/^##\s+/gm, "【").replace(/\n/g, "\n\n"),
      "",
      tags,
      input.sourceUrl ? `\n来源见评论区 / ${input.sourceUrl}` : "",
    ]
      .filter((x) => x !== undefined)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  return [
    `# ${input.title}`,
    "",
    input.summary ? `> ${input.summary}` : "",
    "",
    input.imageUrl ? `![cover](${input.imageUrl})` : "",
    "",
    bodyMd,
    "",
    "---",
    input.sourceUrl ? `来源：${input.sourceUrl}` : "",
    tags ? `标签：${tags}` : "",
    "",
  ]
    .filter((x) => x !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function formatArticle(input: FormatInput): FormatOutput {
  const platform = (input.platform || "general") as FormatPlatform;
  const style = (input.style || defaultStyleFor(platform)) as StylePreset;
  const rawTheme = THEMES[style] || THEMES.zhihu_clean;
  const theme = isWechatStyle(style) ? hardenTheme(rawTheme) : rawTheme;
  const semantic = style === "wp_semantic" || style === "zhihu_clean";

  const blocks = parseBlocks(input.content || "");
  const bodyMd = blocksToMarkdown(blocks);
  const plain = [
    input.title,
    "",
    input.summary || "",
    "",
    blocksToPlain(blocks),
    "",
    (input.tags || []).map((t) => `#${t}`).join(" "),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const bodyHtml = renderBlocksHtml(blocks, theme, semantic);
  const titleHtml = semantic
    ? `<h1>${escapeHtml(input.title)}</h1>`
    : `<h1 style="${theme.title}">${escapeHtml(input.title)}</h1>`;
  const summaryHtml = input.summary
    ? semantic
      ? `<p><em>${escapeHtml(input.summary)}</em></p>`
      : `<section style="${theme.summary}">${escapeHtml(input.summary)}</section>`
    : "";
  const imgStyle = theme.img || "max-width:100%;height:auto;display:block;margin:16px auto;";
  const coverHtml = input.imageUrl
    ? `<p style="text-align:center;margin:16px 0;"><img src="${escapeHtml(
        input.imageUrl
      )}" alt="cover" style="${ensureImportant(imgStyle)}" /></p>`
    : "";
  const footerBits = [
    input.sourceUrl
      ? `来源：<a href="${escapeHtml(input.sourceUrl)}"${
          theme.a ? ` style="${theme.a}"` : ""
        }>${escapeHtml(input.sourceUrl)}</a>`
      : "",
    (input.tags || []).length
      ? `标签：${(input.tags || []).map((t) => `#${escapeHtml(t)}`).join(" ")}`
      : "",
  ].filter(Boolean);
  const footerHtml = footerBits.length
    ? semantic
      ? `<hr/><p>${footerBits.join("<br/>")}</p>`
      : `<section style="${theme.footer}">${footerBits.join("<br/>")}</section>`
    : "";

  let pasteHtml = semantic
    ? [titleHtml, summaryHtml, coverHtml, bodyHtml, footerHtml].filter(Boolean).join("\n")
    : [titleHtml, summaryHtml, coverHtml, bodyHtml, footerHtml].filter(Boolean).join("\n");

  if (isWechatStyle(style) || platform === "wechat_mp") {
    pasteHtml = makeWeChatCompatible(pasteHtml, theme.wrap);
  } else if (!semantic) {
    pasteHtml = `<section style="${theme.wrap}">${pasteHtml}</section>`;
  }

  const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(
    input.title
  )}</title></head><body style="margin:0;padding:24px;background:#f5f5f5;">${pasteHtml}</body></html>`;

  return {
    platform,
    style,
    markdown: buildMarkdownDoc(input, bodyMd, platform),
    html: htmlDoc,
    plain,
    pasteHtml,
  };
}

export function listStyles(platform?: FormatPlatform) {
  if (!platform) return STYLE_OPTIONS;
  return STYLE_OPTIONS.filter(
    (s) => s.platforms.includes(platform) || s.platforms.includes("general")
  );
}

export { defaultStyleFor, STYLE_OPTIONS, isWechatStyle };
export type { FormatInput, FormatOutput, FormatPlatform, StylePreset };
