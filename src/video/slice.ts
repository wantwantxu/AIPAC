import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logJob } from "../db/index.js";

export type SliceOptions = {
  /** 本地视频路径，或 http(s) URL */
  source: string;
  /** 每段秒数，默认 30，抖音建议 15–60 */
  clipSeconds?: number;
  /** 最多切几段，默认 5（2G 机器别太多） */
  maxClips?: number;
  /** 从第几秒开始，默认 0 */
  startAt?: number;
  /** 竖屏 720x1280，默认 true */
  vertical?: boolean;
  /** 输出目录名 */
  jobName?: string;
};

export type SliceResult = {
  ok: boolean;
  ffmpeg: boolean;
  dir: string;
  clips: { file: string; path: string; url: string; start: number; duration: number }[];
  error?: string;
};

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function hasFfmpeg(): Promise<boolean> {
  const r = await run("ffmpeg", ["-version"]);
  return r.code === 0;
}

async function probeDuration(file: string): Promise<number> {
  const r = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const v = parseFloat((r.stdout || r.stderr).trim());
  return Number.isFinite(v) ? v : 0;
}

async function downloadIfRemote(source: string, destDir: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) {
    if (!fs.existsSync(source)) throw new Error(`本地文件不存在: ${source}`);
    return source;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(new URL(source).pathname) || ".mp4";
  const dest = path.join(destDir, `source${ext.split("?")[0] || ".mp4"}`);
  logJob("video", `下载视频中…`);
  const res = await fetch(source, {
    headers: { "User-Agent": "pac-video/1.0" },
    signal: AbortSignal.timeout(300000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 200 * 1024 * 1024) {
    throw new Error("视频超过 200MB，2G 机器请先本地压缩再上传");
  }
  fs.writeFileSync(dest, buf);
  return dest;
}

export async function sliceVideo(opts: SliceOptions): Promise<SliceResult> {
  const ffmpegOk = await hasFfmpeg();
  if (!ffmpegOk) {
    return {
      ok: false,
      ffmpeg: false,
      dir: "",
      clips: [],
      error:
        "未检测到 ffmpeg。请先安装：Windows 用 scoop/choco 装 ffmpeg，Linux: apt install ffmpeg",
    };
  }

  const clipSeconds = Math.min(Math.max(Number(opts.clipSeconds || 30), 8), 60);
  const maxClips = Math.min(Math.max(Number(opts.maxClips || 5), 1), 12);
  const startAt = Math.max(Number(opts.startAt || 0), 0);
  const vertical = opts.vertical !== false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jobName = opts.jobName || stamp;
  const dir = path.join(config.DATA_DIR, "exports", "douyin", jobName);
  const inbox = path.join(config.DATA_DIR, "videos", "inbox", jobName);
  fs.mkdirSync(dir, { recursive: true });

  let input: string;
  try {
    input = await downloadIfRemote(opts.source, inbox);
  } catch (err) {
    return {
      ok: false,
      ffmpeg: true,
      dir,
      clips: [],
      error: (err as Error).message,
    };
  }

  const duration = await probeDuration(input);
  const usable = duration > 0 ? Math.max(duration - startAt, clipSeconds) : clipSeconds * maxClips;
  const count = Math.min(maxClips, Math.max(1, Math.ceil(usable / clipSeconds)));

  const vf = vertical
    ? "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black"
    : "scale=1280:-2";

  const clips: SliceResult["clips"] = [];
  for (let i = 0; i < count; i += 1) {
    const start = startAt + i * clipSeconds;
    if (duration > 0 && start >= duration - 1) break;
    const outName = `clip_${String(i + 1).padStart(2, "0")}_${start}s.mp4`;
    const outPath = path.join(dir, outName);
    logJob("video", `切片 ${i + 1}/${count} @${start}s`);
    const r = await run("ffmpeg", [
      "-y",
      "-ss",
      String(start),
      "-i",
      input,
      "-t",
      String(clipSeconds),
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    if (r.code !== 0 || !fs.existsSync(outPath)) {
      logJob("video", `切片失败: ${r.stderr.slice(-300)}`, "error");
      continue;
    }
    const rel = path.relative(config.DATA_DIR, outPath).replace(/\\/g, "/");
    clips.push({
      file: outName,
      path: outPath,
      url: `/api/exports/file?path=${encodeURIComponent(rel)}`,
      start,
      duration: clipSeconds,
    });
  }

  // 清理 inbox 下载缓存，省磁盘
  try {
    fs.rmSync(inbox, { recursive: true, force: true });
  } catch {
    // ignore
  }

  if (!clips.length) {
    return {
      ok: false,
      ffmpeg: true,
      dir,
      clips: [],
      error: "没有生成任何切片，请检查视频地址或 ffmpeg 日志",
    };
  }

  return { ok: true, ffmpeg: true, dir, clips };
}
