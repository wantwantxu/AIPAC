import { config } from "../config.js";

/** 生成抖音标题 + 话题文案（短） */
export async function makeDouyinCaption(input: {
  title: string;
  summary?: string;
  content?: string;
}): Promise<{ title: string; caption: string; tags: string[] }> {
  const fallbackTags = ["资讯", "科技", "海外热点"];
  const fallback = {
    title: input.title.slice(0, 30),
    caption: [input.summary || input.title, "", "#资讯 #科技 #海外"].join("\n"),
    tags: fallbackTags,
  };

  if (!config.AI_API_KEY) return fallback;

  try {
    const res = await fetch(`${config.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.AI_MODEL,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `你是抖音短视频文案助手。根据资讯写适合竖屏口播/字幕的文案。
输出 JSON：
title: 20字内钩子标题
caption: 80-150字口播稿，短句，可带语气，末尾留 3-5 个 #话题
tags: 3-5 个中文话题（不要带#）`,
          },
          {
            role: "user",
            content: `标题: ${input.title}\n摘要: ${input.summary || ""}\n正文: ${(input.content || "").slice(0, 2000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}") as {
      title?: string;
      caption?: string;
      tags?: string[];
    };
    return {
      title: String(parsed.title || fallback.title).slice(0, 40),
      caption: String(parsed.caption || fallback.caption),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : fallbackTags,
    };
  } catch {
    return fallback;
  }
}
