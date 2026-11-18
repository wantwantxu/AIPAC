import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { db, logJob } from "../db/index.js";
import { makeDouyinCaption } from "./caption.js";
import { hasFfmpeg, sliceVideo, type SliceOptions, type SliceResult } from "./slice.js";

export type DouyinJobInput = SliceOptions & {
  itemId?: number;
  title?: string;
  summary?: string;
  content?: string;
};

export type DouyinJobResult = SliceResult & {
  captionFile?: string;
  captionUrl?: string;
  caption?: { title: string; caption: string; tags: string[] };
};

export async function runDouyinSliceJob(input: DouyinJobInput): Promise<DouyinJobResult> {
  let title = input.title || "抖音切片";
  let summary = input.summary || "";
  let content = input.content || "";

  if (input.itemId) {
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(input.itemId) as
      | {
          title: string;
          ai_title: string | null;
          summary: string | null;
          rewritten: string | null;
          content: string | null;
        }
      | undefined;
    if (item) {
      title = item.ai_title || item.title;
      summary = item.summary || "";
      content = item.rewritten || item.content || "";
    }
  }

  const sliced = await sliceVideo({
    source: input.source,
    clipSeconds: input.clipSeconds,
    maxClips: input.maxClips,
    startAt: input.startAt,
    vertical: input.vertical,
    jobName: input.jobName,
  });

  if (!sliced.ok) {
    logJob("video", sliced.error || "切片失败", "error");
    return sliced;
  }

  const caption = await makeDouyinCaption({ title, summary, content });
  const captionBody = [
    `# ${caption.title}`,
    "",
    caption.caption,
    "",
    "---",
    "发布说明：",
    "1. 打开同目录切片 mp4，用抖音 APP / 创作者中心上传",
    "2. 标题与话题复制本文件",
    "3. 默认不自动发抖音（需开放平台）；人工上传更稳、也更合规",
    "",
    "切片列表：",
    ...sliced.clips.map((c, i) => `${i + 1}. ${c.file}  (from ${c.start}s, ${c.duration}s)`),
    "",
  ].join("\n");

  const captionPath = path.join(sliced.dir, "caption.md");
  fs.writeFileSync(captionPath, captionBody, "utf8");
  const relData = path.relative(config.DATA_DIR, captionPath).replace(/\\/g, "/");

  logJob("video", `抖音切片完成 ${sliced.clips.length} 段 → ${sliced.dir}`);
  return {
    ...sliced,
    caption,
    captionFile: "caption.md",
    captionUrl: `/api/exports/file?path=${encodeURIComponent(relData)}`,
  };
}

export { hasFfmpeg };
