import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import {
  defaultStyleFor,
  formatArticle,
  type FormatPlatform,
  type StylePreset,
} from "../format/index.js";
import type { PublishPayload, PublishResult, Publisher } from "./base.js";

function slugify(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function writeExports(
  platform: string,
  baseName: string,
  files: { ext: string; body: string }[]
): { mdRel?: string; htmlRel?: string } {
  const dir = path.join(config.DATA_DIR, "exports", platform);
  fs.mkdirSync(dir, { recursive: true });
  const out: { mdRel?: string; htmlRel?: string } = {};
  for (const f of files) {
    const full = path.join(dir, `${baseName}.${f.ext}`);
    fs.writeFileSync(full, f.body, "utf8");
    const rel = path.relative(config.DATA_DIR, full).replace(/\\/g, "/");
    if (f.ext === "md") out.mdRel = rel;
    if (f.ext === "html") out.htmlRel = rel;
  }
  return out;
}

/**
 * 按平台样式格式化后导出：.md + .html（公众号优先粘贴 html）
 */
export const markdownExportPublisher: Publisher = {
  type: "markdown_export",
  async publish(cfg, payload: PublishPayload): Promise<PublishResult> {
    const platform = String(cfg.platform || "general") as FormatPlatform;
    const style = (cfg.style as StylePreset) || defaultStyleFor(platform);
    const formatted = formatArticle({
      title: payload.title,
      summary: payload.summary,
      content: payload.content,
      tags: payload.tags,
      sourceUrl: payload.sourceUrl,
      imageUrl: payload.imageUrl,
      platform,
      style,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${stamp}_${slugify(payload.title)}`;
    const written = writeExports(platform, baseName, [
      { ext: "md", body: formatted.markdown },
      { ext: "html", body: formatted.html },
      // 纯片段，方便复制到公众号
      { ext: "paste.html", body: formatted.pasteHtml },
    ]);

    // 小红书再写一份纯文本
    if (platform === "xiaohongshu") {
      writeExports(platform, baseName, [{ ext: "txt", body: formatted.plain }]);
    }

    const prefer =
      platform === "wechat_mp" || platform === "toutiao"
        ? written.htmlRel
        : written.mdRel;

    return {
      remoteId: `${baseName}.html`,
      remoteUrl: prefer
        ? `/api/exports/file?path=${encodeURIComponent(prefer)}`
        : undefined,
    };
  },
};

function alias(type: string, platform: FormatPlatform): Publisher {
  return {
    type,
    publish(cfg, payload) {
      return markdownExportPublisher.publish({ ...cfg, platform }, payload);
    },
  };
}

export const exportAliases: Publisher[] = [
  alias("wechat_mp", "wechat_mp"),
  alias("xiaohongshu", "xiaohongshu"),
  alias("zhihu", "zhihu"),
  alias("toutiao", "toutiao"),
];
