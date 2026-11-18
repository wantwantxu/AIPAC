import { formatArticle } from "../format/index.js";
import type { PublishPayload, PublishResult, Publisher } from "./base.js";

export const wordpressPublisher: Publisher = {
  type: "wordpress",
  async publish(config, payload: PublishPayload): Promise<PublishResult> {
    const base = String(config.url || "").replace(/\/$/, "");
    const user = String(config.user || "");
    const appPassword = String(config.appPassword || "");
    if (!base || !user || !appPassword) {
      throw new Error("WordPress 未配置 url/user/appPassword");
    }

    const formatted = formatArticle({
      title: payload.title,
      summary: payload.summary,
      content: payload.content,
      tags: payload.tags,
      sourceUrl: payload.sourceUrl,
      imageUrl: payload.imageUrl,
      platform: "wordpress",
      style: "wp_semantic",
    });

    const auth = Buffer.from(`${user}:${appPassword}`).toString("base64");
    const body = {
      title: payload.title,
      content: formatted.pasteHtml,
      status: "draft",
      excerpt: payload.summary || "",
    };

    const res = await fetch(`${base}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WordPress ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: number; link?: string };
    return {
      remoteId: data.id != null ? String(data.id) : undefined,
      remoteUrl: data.link,
    };
  },
};
