/** 把 AI 正文规范成结构化块，方便套样式 */

export type Block =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "quote"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function cleanLine(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^【|】$/g, "")
    .trim();
}

/** 统一换行、标题、列表 */
export function normalizeContent(raw: string): string {
  let text = String(raw || "").replace(/\r\n/g, "\n").trim();
  // 全角符号标题 → markdown
  text = text.replace(/^［(.+?)］\s*$/gm, "## $1");
  text = text.replace(/^【(.+?)】\s*$/gm, "## $1");
  text = text.replace(/^（(\d+)）\s*/gm, "$1. ");
  // 多余空行压成最多两个
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

export function parseBlocks(raw: string): Block[] {
  const text = normalizeContent(raw);
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = cleanLine(line);
    if (!t) {
      i += 1;
      continue;
    }

    if (/^###\s+/.test(t)) {
      blocks.push({ type: "h3", text: t.replace(/^###\s+/, "") });
      i += 1;
      continue;
    }
    if (/^##\s+/.test(t)) {
      blocks.push({ type: "h2", text: t.replace(/^##\s+/, "") });
      i += 1;
      continue;
    }
    if (/^#\s+/.test(t)) {
      blocks.push({ type: "h2", text: t.replace(/^#\s+/, "") });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(t)) {
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(cleanLine(lines[i]) || "x")) {
        parts.push(cleanLine(lines[i]).replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", text: parts.join(" ") });
      continue;
    }
    if (/^[-*•]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(cleanLine(lines[i]))) {
        items.push(cleanLine(lines[i]).replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+[\.、]\s*/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[\.、]\s*/.test(cleanLine(lines[i]))) {
        items.push(cleanLine(lines[i]).replace(/^\d+[\.、]\s*/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // 段落：合并到空行
    const parts: string[] = [t];
    i += 1;
    while (i < lines.length) {
      const n = cleanLine(lines[i]);
      if (!n) break;
      if (/^(#|>|[-*•]|\d+[\.、])/.test(n)) break;
      parts.push(n);
      i += 1;
    }
    blocks.push({ type: "p", text: parts.join("") });
  }

  return blocks;
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "h2":
          return `## ${b.text}`;
        case "h3":
          return `### ${b.text}`;
        case "quote":
          return `> ${b.text}`;
        case "ul":
          return b.items.map((x) => `- ${x}`).join("\n");
        case "ol":
          return b.items.map((x, idx) => `${idx + 1}. ${x}`).join("\n");
        default:
          return b.text;
      }
    })
    .join("\n\n");
}

export function blocksToPlain(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "h2":
        case "h3":
          return `\n【${b.text}】\n`;
        case "quote":
          return `「${b.text}」`;
        case "ul":
          return b.items.map((x) => `• ${x}`).join("\n");
        case "ol":
          return b.items.map((x, idx) => `${idx + 1}. ${x}`).join("\n");
        default:
          return b.text;
      }
    })
    .join("\n\n")
    .trim();
}

export function escapeHtml(s: string): string {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 行内：粗体 **x** / 链接 */
export function inlineHtml(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(
    /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  return s;
}
