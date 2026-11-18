/**
 * 微信公众号粘贴兼容（学习自 huasheng_editor / raphael-publish）
 *
 * 关键约束：
 * - 不依赖 CSS class / Grid / 部分 Flex
 * - 必须内联 style，关键属性加 !important
 * - 根节点用 <section>
 * - li 内不要嵌套 <p>
 * - 容器字体要下发到 p/li，防止微信覆盖
 */

export function ensureImportant(style: string): string {
  return String(style || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/!important/i.test(part)) return part;
      // 颜色、字号、行高、背景、边框等易被微信覆盖
      if (
        /^(color|font-size|font-family|line-height|background|background-color|border-left|border-bottom|margin|padding|text-align|font-weight)\s*:/i.test(
          part
        )
      ) {
        return `${part} !important`;
      }
      return part;
    })
    .join("; ");
}

/** 列表项内 <p>…</p> → 内容扁平化，避免微信列表塌陷 */
export function flattenListParagraphs(html: string): string {
  return html.replace(/<li([^>]*)>([\s\S]*?)<\/li>/gi, (_m, attrs, inner) => {
    const flat = String(inner)
      .replace(/<\/?p[^>]*>/gi, "")
      .replace(/\n+/g, " ")
      .trim();
    return `<li${attrs}>${flat}</li>`;
  });
}

/** 中文标点贴紧强调词，避免换行断成「标题 ：」 */
export function attachCjkPunctuation(html: string): string {
  return html.replace(
    /(<\/(?:strong|b|em|span|a|code)>)\s*([：；，。！？、:])/g,
    "$1\u2060$2"
  );
}

/** 给块级标签补字体继承（从 container 解析） */
export function injectFontInheritance(html: string, containerStyle: string): string {
  const font = containerStyle.match(/font-family\s*:\s*([^;]+)/i)?.[1]?.trim();
  const size = containerStyle.match(/font-size\s*:\s*([^;]+)/i)?.[1]?.trim();
  const color = containerStyle.match(/color\s*:\s*([^;]+)/i)?.[1]?.trim();
  const lh = containerStyle.match(/line-height\s*:\s*([^;]+)/i)?.[1]?.trim();

  let out = html;
  for (const tag of ["p", "li", "blockquote", "span"]) {
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, "gi"), (full, attrs = "") => {
      const styleMatch = String(attrs).match(/style\s*=\s*"([^"]*)"/i);
      let style = styleMatch?.[1] || "";
      if (font && !/font-family\s*:/i.test(style)) style += `;font-family:${font}`;
      if (lh && !/line-height\s*:/i.test(style)) style += `;line-height:${lh}`;
      if (color && !/color\s*:/i.test(style)) style += `;color:${color}`;
      if (size && !/font-size\s*:/i.test(style)) style += `;font-size:${size}`;
      style = ensureImportant(style);
      if (styleMatch) return full.replace(/style\s*=\s*"[^"]*"/i, `style="${style}"`);
      const rest = String(attrs).replace(/^\s+/, " ");
      return `<${tag} style="${style}"${rest}>`;
    });
  }
  return out;
}

/** 首个块元素去掉上边距，避免公众号多出一截空白 */
export function zeroFirstBlockMargin(html: string): string {
  return html.replace(
    /^(\s*<(?:h[1-6]|p|section|blockquote|ul|ol)[^>]*style=")([^"]*)(")/i,
    (_m, a, style, c) => `${a}${style};margin-top:0 !important${c}`
  );
}

export function wrapSection(innerHtml: string, containerStyle: string): string {
  const style = ensureImportant(containerStyle);
  return `<section style="${style}">${innerHtml}</section>`;
}

export function makeWeChatCompatible(pasteHtml: string, containerStyle: string): string {
  let html = pasteHtml.trim();
  // 若已是 section，取出内容再统一处理
  const m = html.match(/^<section[^>]*>([\s\S]*)<\/section>$/i);
  if (m) html = m[1];

  html = flattenListParagraphs(html);
  html = injectFontInheritance(html, containerStyle);
  html = zeroFirstBlockMargin(html);
  html = attachCjkPunctuation(html);
  html = wrapSection(html, containerStyle);
  return html;
}
