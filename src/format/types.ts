export type FormatPlatform =
  | "wechat_mp"
  | "zhihu"
  | "xiaohongshu"
  | "toutiao"
  | "wordpress"
  | "general";

export type StylePreset =
  | "wechat_classic"
  | "wechat_tech"
  | "wechat_latepost"
  | "zhihu_clean"
  | "xhs_note"
  | "toutiao_news"
  | "wp_semantic";

export type FormatInput = {
  title: string;
  summary?: string;
  content: string;
  tags?: string[];
  sourceUrl?: string;
  imageUrl?: string;
  platform?: FormatPlatform;
  style?: StylePreset;
};

export type FormatOutput = {
  platform: FormatPlatform;
  style: StylePreset;
  markdown: string;
  html: string;
  plain: string;
  /** 公众号等可直接粘贴的 HTML 片段 */
  pasteHtml: string;
};

export const STYLE_OPTIONS: {
  id: StylePreset;
  name: string;
  platforms: FormatPlatform[];
  desc: string;
}[] = [
  {
    id: "wechat_classic",
    name: "公众号·经典",
    platforms: ["wechat_mp"],
    desc: "花生默认风：居中标题、绿强调、段落缩进，粘贴后台可用",
  },
  {
    id: "wechat_tech",
    name: "公众号·科技",
    platforms: ["wechat_mp"],
    desc: "蓝色色块小标题，适合科技资讯",
  },
  {
    id: "wechat_latepost",
    name: "公众号·晚点",
    platforms: ["wechat_mp"],
    desc: "红色强调标题块，适合深度稿（参考花生晚点风）",
  },
  {
    id: "zhihu_clean",
    name: "知乎·干净",
    platforms: ["zhihu", "general"],
    desc: "标准语义 HTML / Markdown，知乎编辑器友好",
  },
  {
    id: "xhs_note",
    name: "小红书·笔记",
    platforms: ["xiaohongshu"],
    desc: "短段、空行多、文末标签，适合笔记体",
  },
  {
    id: "toutiao_news",
    name: "头条·资讯",
    platforms: ["toutiao"],
    desc: "清晰小标题 + 短段落 HTML",
  },
  {
    id: "wp_semantic",
    name: "WordPress·语义",
    platforms: ["wordpress", "general"],
    desc: "语义化 HTML，适合 WP 草稿",
  },
];

export function defaultStyleFor(platform: FormatPlatform): StylePreset {
  switch (platform) {
    case "wechat_mp":
      return "wechat_classic";
    case "zhihu":
      return "zhihu_clean";
    case "xiaohongshu":
      return "xhs_note";
    case "toutiao":
      return "toutiao_news";
    case "wordpress":
      return "wp_semantic";
    default:
      return "zhihu_clean";
  }
}

export function isWechatStyle(style: StylePreset): boolean {
  return style === "wechat_classic" || style === "wechat_tech" || style === "wechat_latepost";
}
