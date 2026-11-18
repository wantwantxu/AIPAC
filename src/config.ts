import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  AI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_IMAGE_MODEL: z.string().default("dall-e-3"),
  AI_ENABLE_IMAGE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  WP_URL: z.string().default(""),
  WP_USER: z.string().default(""),
  WP_APP_PASSWORD: z.string().default(""),
  CRON_COLLECT: z.string().default("*/30 * * * *"),
  CRON_PROCESS: z.string().default("*/10 * * * *"),
  CRON_PUBLISH: z.string().default("*/15 * * * *"),
  AUTO_RUN: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  ADMIN_TOKEN: z.string().default(""),
});

const parsed = schema.parse(process.env);

/** 可变运行时配置：环境变量为底，SQLite settings 可覆盖 */
export const config = {
  PORT: parsed.PORT,
  HOST: parsed.HOST,
  DATA_DIR: parsed.DATA_DIR,
  AI_BASE_URL: parsed.AI_BASE_URL,
  AI_API_KEY: parsed.AI_API_KEY,
  AI_MODEL: parsed.AI_MODEL,
  AI_IMAGE_MODEL: parsed.AI_IMAGE_MODEL,
  AI_ENABLE_IMAGE: parsed.AI_ENABLE_IMAGE,
  WP_URL: parsed.WP_URL,
  WP_USER: parsed.WP_USER,
  WP_APP_PASSWORD: parsed.WP_APP_PASSWORD,
  CRON_COLLECT: parsed.CRON_COLLECT,
  CRON_PROCESS: parsed.CRON_PROCESS,
  CRON_PUBLISH: parsed.CRON_PUBLISH,
  AUTO_RUN: parsed.AUTO_RUN,
  ADMIN_TOKEN: parsed.ADMIN_TOKEN,
};

export type RuntimeConfig = typeof config;

const OVERLAY_KEYS = [
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_ENABLE_IMAGE",
  "WP_URL",
  "WP_USER",
  "WP_APP_PASSWORD",
  "CRON_COLLECT",
  "CRON_PROCESS",
  "CRON_PUBLISH",
  "AUTO_RUN",
  "ADMIN_TOKEN",
] as const;

export type SettingKey = (typeof OVERLAY_KEYS)[number];

export function applySettingOverlay(map: Record<string, string>) {
  for (const key of OVERLAY_KEYS) {
    if (!(key in map)) continue;
    const v = map[key];
    if (key === "AI_ENABLE_IMAGE" || key === "AUTO_RUN") {
      (config as Record<string, unknown>)[key] = v === "true" || v === "1";
    } else {
      (config as Record<string, unknown>)[key] = v;
    }
  }
}

export function publicSettings() {
  return {
    AI_BASE_URL: config.AI_BASE_URL,
    AI_API_KEY: config.AI_API_KEY
      ? `${config.AI_API_KEY.slice(0, 4)}…${config.AI_API_KEY.slice(-4)}`
      : "",
    AI_API_KEY_SET: Boolean(config.AI_API_KEY),
    AI_MODEL: config.AI_MODEL,
    AI_ENABLE_IMAGE: config.AI_ENABLE_IMAGE,
    WP_URL: config.WP_URL,
    WP_USER: config.WP_USER,
    WP_APP_PASSWORD_SET: Boolean(config.WP_APP_PASSWORD),
    CRON_COLLECT: config.CRON_COLLECT,
    CRON_PROCESS: config.CRON_PROCESS,
    CRON_PUBLISH: config.CRON_PUBLISH,
    AUTO_RUN: config.AUTO_RUN,
    ADMIN_TOKEN_SET: Boolean(config.ADMIN_TOKEN),
  };
}
