import { applySettingOverlay, config, publicSettings, type SettingKey } from "./config.js";
import { db, logJob } from "./db/index.js";

export function loadSettingsFromDb() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  if (!rows.length) return;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  applySettingOverlay(map);
  logJob("settings", `已加载 ${rows.length} 项运行时配置`);
}

export function getSettingMap(): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export function saveSettings(partial: Partial<Record<SettingKey, string | boolean>>) {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );

  const written: string[] = [];
  for (const [key, raw] of Object.entries(partial)) {
    if (raw === undefined || raw === null) continue;
    // 空字符串且是密钥类：表示不修改
    if (
      (key === "AI_API_KEY" || key === "WP_APP_PASSWORD" || key === "ADMIN_TOKEN") &&
      raw === ""
    ) {
      continue;
    }
    // 掩码回显不要写回
    if (typeof raw === "string" && raw.includes("…")) continue;

    const value = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
    upsert.run(key, value);
    written.push(key);
  }

  loadSettingsFromDb();
  logJob("settings", `已更新配置: ${written.join(", ") || "(无变更)"}`);
  return publicSettings();
}

export function readiness() {
  const enabledSources = db
    .prepare(`SELECT COUNT(*) AS c FROM sources WHERE enabled = 1`)
    .get() as { c: number };
  const enabledTargets = db
    .prepare(`SELECT COUNT(*) AS c FROM publish_targets WHERE enabled = 1`)
    .get() as { c: number };

  const checks = [
    {
      id: "ai",
      ok: Boolean(config.AI_API_KEY),
      label: "AI API Key",
      tip: "设置页填写 DeepSeek / OpenAI 兼容密钥",
    },
    {
      id: "sources",
      ok: enabledSources.c > 0,
      label: "采集源",
      tip: "至少启用一个预置数据源",
    },
    {
      id: "targets",
      ok: enabledTargets.c > 0,
      label: "发布渠道",
      tip: "至少启用公众号或小红书等导出渠道",
    },
    {
      id: "autorun",
      ok: config.AUTO_RUN,
      label: "自动运行",
      tip: "开启后按定时自动采集→加工→发布",
    },
  ];

  const ready = checks.filter((c) => c.id !== "autorun").every((c) => c.ok);
  return {
    ready,
    autoRun: config.AUTO_RUN,
    aiConfigured: Boolean(config.AI_API_KEY),
    checks,
    cron: {
      collect: config.CRON_COLLECT,
      process: config.CRON_PROCESS,
      publish: config.CRON_PUBLISH,
    },
  };
}
