import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { PublishPayload, PublishResult, Publisher } from "./base.js";
import { makeDouyinCaption } from "../video/caption.js";

/**
 * 抖音：默认只导出口播文案包（切片请走 /api/video/douyin）。
 * 不自动发帖——需抖音开放平台；人工上传更稳。
 */
export const douyinPublisher: Publisher = {
  type: "douyin",
  async publish(cfg, payload: PublishPayload): Promise<PublishResult> {
    const dir = path.join(config.DATA_DIR, "exports", "douyin", "captions");
    fs.mkdirSync(dir, { recursive: true });
    const caption = await makeDouyinCaption({
      title: payload.title,
      summary: payload.summary,
      content: payload.content,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}_caption.md`);
    const body = [
      `# ${caption.title}`,
      "",
      caption.caption,
      "",
      payload.sourceUrl ? `关联原文：${payload.sourceUrl}` : "",
      "",
      "提示：若要切片，请在后台「抖音切片」填入视频 URL/本地路径。",
      cfg.note ? String(cfg.note) : "",
      "",
    ].join("\n");
    fs.writeFileSync(file, body, "utf8");
    const rel = path.relative(config.DATA_DIR, file).replace(/\\/g, "/");
    return {
      remoteId: path.basename(file),
      remoteUrl: `/api/exports/file?path=${encodeURIComponent(rel)}`,
    };
  },
};
