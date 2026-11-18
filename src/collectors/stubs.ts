import type { CollectedItem, Collector } from "./base.js";

/** 需 Cookie / 开放平台的源：先留接口，避免空跑报错刷屏 */
function disabled(type: string, hint: string): Collector {
  return {
    type,
    async collect() {
      // 返回空数组，不抛错；真正接入后替换实现
      if (process.env.AIPAC_DEBUG_STUBS === "1") {
        console.warn(`[collector:${type}] ${hint}`);
      }
      return [] as CollectedItem[];
    },
  };
}

export const stubCollectors: Collector[] = [
  disabled("twitter", "Twitter/X 需 API Key 或第三方服务"),
  disabled("wechat_mp_source", "微信公众号采集需搜狗/第三方或手工 url_import"),
  disabled("zhihu_source", "知乎采集需 Cookie / 开放平台；可用 rss/web_list 代替"),
];
