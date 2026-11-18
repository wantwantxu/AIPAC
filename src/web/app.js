const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const STATUS_LABEL = {
  raw: "待加工",
  processing: "加工中",
  ready: "已成稿",
  published: "已导出",
  error: "失败",
};

let currentStatus = "";
let currentItem = null;
let currentView = "origin";
let lastFormat = null;
let settingsCache = null;
let wechatStyle =
  localStorage.getItem("aipac_wechat_style") ||
  localStorage.getItem("pac_wechat_style") ||
  "wechat_classic";

function headers() {
  return { "Content-Type": "application/json" };
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...headers(), ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/") && !ct.includes("json")) return res.text();
  return res.json();
}

function setJob(msg, isErr = false) {
  const el = $("#job-status");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function badge(status) {
  return `<span class="badge ${status}">${STATUS_LABEL[status] || status}</span>`;
}

/* ---------- dashboard ---------- */
async function refresh() {
  const dash = await api("/api/dashboard");
  renderReadiness(dash.readiness);
  renderAuto(dash.scheduler);
  renderStats(dash.byStatus || []);
  renderItems(dash.recent || []);
  renderSources(dash.sources || []);
  renderTargets(dash.targets || []);
  renderLogs(dash.logs || []);
}

function renderReadiness(r) {
  const box = $("#ready-banner");
  if (r.ready && r.aiConfigured) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const missing = (r.checks || []).filter((c) => !c.ok && c.id !== "autorun");
  box.innerHTML = `
    <strong>还差几步即可自动运行</strong>
    <ul>${missing.map((c) => `<li><b>${escapeHtml(c.label)}</b> — ${escapeHtml(c.tip)}</li>`).join("")}</ul>
    <button type="button" class="primary sm" id="banner-settings">打开设置</button>
  `;
  $("#banner-settings").onclick = () => openSettings();
}

function renderAuto(scheduler) {
  const pill = $("#auto-pill");
  const on = !!scheduler?.autoRun;
  pill.textContent = on ? "自动运行 · 开" : "自动运行 · 关";
  pill.className = `pill ${on ? "on" : "off"}`;
  pill.title = on
    ? `采集 ${scheduler.cron.collect} / 加工 ${scheduler.cron.process} / 导出 ${scheduler.cron.publish}`
    : "请在设置中开启自动运行";
}

function renderStats(byStatus) {
  const map = Object.fromEntries(byStatus.map((x) => [x.status, x.c]));
  $("#s-raw").textContent = (map.raw || 0) + (map.processing || 0);
  $("#s-ready").textContent = map.ready || 0;
  $("#s-published").textContent = map.published || 0;

  const keys = ["", "raw", "ready", "published", "error"];
  $("#status-tabs").innerHTML = keys
    .map((k) => {
      const label = k ? STATUS_LABEL[k] : "全部";
      return `<button data-status="${k}" class="${currentStatus === k ? "active" : ""}">${label}</button>`;
    })
    .join("");
  $("#status-tabs").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    currentStatus = btn.dataset.status || "";
    void loadItems();
  };
}

async function loadItems() {
  const q = currentStatus ? `?status=${encodeURIComponent(currentStatus)}&limit=50` : "?limit=50";
  const items = await api(`/api/items${q}`);
  renderItems(items);
}

function renderItems(items) {
  const filtered = currentStatus
    ? items.filter((it) => it.status === currentStatus)
    : items;
  $("#items").innerHTML = filtered.length
    ? filtered
        .map(
          (it) => `
      <button class="item ${currentItem?.id === it.id ? "on" : ""}" data-id="${it.id}">
        <div class="t">${escapeHtml(it.ai_title || it.title)}</div>
        <div class="m">${badge(it.status)} <span>${escapeHtml((it.summary || it.title || "").slice(0, 60))}</span></div>
      </button>`
        )
        .join("")
    : `<div class="empty">暂无稿件。配置 AI Key 后点「立即跑一轮」。</div>`;

  $("#items").onclick = async (e) => {
    const btn = e.target.closest("[data-id]");
    if (!btn) return;
    await openItem(Number(btn.dataset.id));
  };
}

function renderSources(rows) {
  $("#sources").innerHTML = rows
    .map(
      (s) => `
    <button class="mini ${s.enabled ? "on" : ""}" data-source-id="${s.id}">
      <span>${escapeHtml(s.name)}</span>
      <em>${s.enabled ? "开" : "关"}</em>
    </button>`
    )
    .join("");
  $("#sources").onclick = async (e) => {
    const btn = e.target.closest("[data-source-id]");
    if (!btn) return;
    const id = Number(btn.dataset.sourceId);
    const cur = rows.find((x) => x.id === id);
    if (!cur) return;
    await api(`/api/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !cur.enabled }),
    });
    await refresh();
  };
}

function renderTargets(rows) {
  $("#targets").innerHTML = rows
    .map(
      (t) => `
    <button class="mini ${t.enabled ? "on" : ""}" data-target-id="${t.id}">
      <span>${escapeHtml(t.name)}</span>
      <em>${t.enabled ? "开" : "关"}</em>
    </button>`
    )
    .join("");
  $("#targets").onclick = async (e) => {
    const btn = e.target.closest("[data-target-id]");
    if (!btn) return;
    const id = Number(btn.dataset.targetId);
    const cur = rows.find((x) => x.id === id);
    if (!cur) return;
    await api(`/api/targets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !cur.enabled }),
    });
    await refresh();
  };
}

function renderLogs(rows) {
  $("#logs").innerHTML = rows.length
    ? rows
        .map(
          (l) => `
      <div class="log ${l.level}">
        <time>${escapeHtml((l.created_at || "").replace("T", " ").slice(0, 19))}</time>
        <b>${escapeHtml(l.job)}</b>
        <span>${escapeHtml(l.message)}</span>
      </div>`
        )
        .join("")
    : `<div class="empty">暂无日志</div>`;
}

/* ---------- item preview tri-pane ---------- */
async function openItem(id) {
  const data = await api(`/api/items/${id}`);
  currentItem = data.item;
  lastFormat = null;
  $$(".item").forEach((el) => el.classList.toggle("on", Number(el.dataset.id) === id));
  $("#preview-title").textContent = currentItem.ai_title || currentItem.title;
  $("#preview-actions").hidden = false;
  $("#preview-footer").hidden = false;
  $("#preview-empty").hidden = true;
  const originLink = $("#btn-origin");
  if (currentItem.url) {
    originLink.hidden = false;
    originLink.href = currentItem.url;
  } else {
    originLink.hidden = true;
  }
  renderOrigin();
  renderAi();
  setView(currentView === "origin" ? "origin" : currentView);
}

function renderOrigin() {
  const it = currentItem;
  $("#preview-origin").innerHTML = `
    <div class="meta-line">${badge(it.status)} <span>原文标题</span></div>
    <h3>${escapeHtml(it.title)}</h3>
    ${it.url ? `<p class="link"><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.url)}</a></p>` : ""}
    <pre class="article">${escapeHtml(it.content || "（无正文）")}</pre>
  `;
}

function renderAi() {
  const it = currentItem;
  let tags = [];
  try {
    tags = it.tags_json ? JSON.parse(it.tags_json) : [];
  } catch {
    tags = [];
  }
  $("#preview-ai").innerHTML = `
    <div class="meta-line">${badge(it.status)} <span>AI 成稿</span></div>
    <h3>${escapeHtml(it.ai_title || "（尚未加工）")}</h3>
    <p class="summary">${escapeHtml(it.summary || "—")}</p>
    <div class="tags">${tags.map((t) => `<span>#${escapeHtml(t)}</span>`).join(" ")}</div>
    <pre class="article">${escapeHtml(it.rewritten || "点「重新 AI 加工」或等待定时任务")}</pre>
  `;
}

async function loadFormat(platform) {
  if (!currentItem) return null;
  const style =
    platform === "xiaohongshu"
      ? "xhs_note"
      : platform === "wechat_mp"
        ? wechatStyle
        : "zhihu_clean";
  lastFormat = await api("/api/format/preview", {
    method: "POST",
    body: JSON.stringify({
      itemId: currentItem.id,
      platform,
      style,
    }),
  });
  $("#preview-frame").srcdoc = lastFormat.html;
  return lastFormat;
}

async function setView(view) {
  currentView = view;
  $$("#view-tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  const styleSel = $("#wechat-style");
  if (styleSel) {
    styleSel.hidden = view !== "wechat";
    styleSel.value = wechatStyle;
  }
  $("#preview-origin").hidden = view !== "origin";
  $("#preview-ai").hidden = view !== "ai";
  const needFrame = view === "wechat" || view === "xhs";
  $("#preview-frame").hidden = !needFrame;
  if (!currentItem) {
    $("#preview-empty").hidden = false;
    return;
  }
  $("#preview-empty").hidden = true;
  if (view === "wechat") await loadFormat("wechat_mp");
  if (view === "xhs") await loadFormat("xiaohongshu");
}

$("#wechat-style")?.addEventListener("change", async (e) => {
  wechatStyle = e.target.value;
  localStorage.setItem("aipac_wechat_style", wechatStyle);
  if (currentView === "wechat") await loadFormat("wechat_mp");
});

$("#view-tabs").onclick = (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  void setView(btn.dataset.view);
};

$("#btn-reprocess").onclick = async () => {
  if (!currentItem) return;
  try {
    setJob(`#${currentItem.id} AI 加工中…`);
    await api(`/api/items/${currentItem.id}/process`, { method: "POST", body: "{}" });
    await openItem(currentItem.id);
    await refresh();
    setJob(`#${currentItem.id} AI 加工完成`);
  } catch (err) {
    setJob(err.message, true);
  }
};

$("#btn-publish-one").onclick = async () => {
  if (!currentItem) return;
  try {
    setJob(`#${currentItem.id} 发布中…`);
    const r = await api(`/api/items/${currentItem.id}/publish`, {
      method: "POST",
      body: "{}",
    });
    await openItem(currentItem.id);
    await refresh();
    setJob(`#${currentItem.id} 已发布到 ${r.published || 0} 个渠道`);
  } catch (err) {
    setJob(err.message, true);
  }
};

async function copyText(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    setJob(ok);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setJob(ok);
  }
}

/** 花生 / Raphael：同时写入 text/html + text/plain，公众号后台才能吃到内联样式 */
async function copyRichHtml(html, plain, ok) {
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain || html], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      setJob(ok);
      return;
    }
  } catch {
    /* fall through */
  }
  await copyText(html, ok);
}

$("#btn-copy-html").onclick = async () => {
  if (!currentItem) return;
  if (currentView === "wechat") await loadFormat("wechat_mp");
  else if (currentView === "xhs") await loadFormat("xiaohongshu");
  else await loadFormat("wechat_mp");
  if (lastFormat) {
    await copyRichHtml(
      lastFormat.pasteHtml,
      lastFormat.plain || lastFormat.markdown,
      "已复制排版 HTML（富文本），可直接粘贴到公众号编辑器"
    );
  }
};

$("#btn-copy-md").onclick = async () => {
  if (!currentItem) return;
  if (!lastFormat) await loadFormat("wechat_mp");
  if (lastFormat) await copyText(lastFormat.markdown, "已复制 Markdown");
};

/* ---------- jobs ---------- */
async function runJob(path, label) {
  $("#btn-pipeline").disabled = true;
  setJob(`${label}…`);
  try {
    const result = await api(path, { method: "POST", body: "{}" });
    await refresh();
    if (currentItem) await openItem(currentItem.id);
    setJob(`${label}完成`);
    console.log(result);
  } catch (err) {
    setJob(err.message, true);
  } finally {
    $("#btn-pipeline").disabled = false;
  }
}

$("#btn-pipeline").onclick = () => runJob("/api/jobs/pipeline", "整轮流水线");

$("#btn-reset-sources").onclick = async () => {
  if (
    !confirm(
      "恢复资讯预置源（热点/娱乐/科技/体育/国内科技），并清理 GitHub 类待加工稿？"
    )
  )
    return;
  const r = await api("/api/setup/foreign-sources", { method: "POST", body: "{}" });
  setJob(`已恢复资讯源 ${r.count} 个`);
  currentItem = null;
  await refresh();
};

$("#btn-clear-logs").onclick = async () => {
  if (!confirm("清空全部过程日志？")) return;
  await api("/api/logs", { method: "DELETE" });
  await refresh();
};

/* ---------- settings ---------- */
async function openSettings() {
  settingsCache = await api("/api/settings");
  const s = settingsCache.settings;
  const form = $("#settings-form");
  form.AI_BASE_URL.value = s.AI_BASE_URL || "";
  form.AI_API_KEY.value = "";
  form.AI_API_KEY.placeholder = s.AI_API_KEY_SET
    ? `已配置 ${s.AI_API_KEY}（留空不改）`
    : "填写 API Key";
  form.AI_MODEL.value = s.AI_MODEL || "";
  form.AUTO_RUN.checked = !!s.AUTO_RUN;
  form.WP_URL.value = s.WP_URL || "";
  form.WP_USER.value = s.WP_USER || "";
  form.WP_APP_PASSWORD.value = "";
  form.WP_APP_PASSWORD.placeholder = s.WP_APP_PASSWORD_SET ? "已配置（留空不改）" : "应用密码";

  fillSelect(form.CRON_COLLECT, settingsCache.presets.cronCollect, s.CRON_COLLECT);
  fillSelect(form.CRON_PROCESS, settingsCache.presets.cronProcess, s.CRON_PROCESS);
  fillSelect(form.CRON_PUBLISH, settingsCache.presets.cronPublish, s.CRON_PUBLISH);

  const prov = $("#ai-provider");
  prov.innerHTML =
    `<option value="">手动填写</option>` +
    settingsCache.presets.aiProviders
      .map((p) => `<option value="${p.label}" data-base="${p.base}" data-model="${p.model}">${p.label}</option>`)
      .join("");

  $("#settings-dlg").showModal();
}

function fillSelect(sel, options, current) {
  sel.innerHTML = options
    .map(
      (o) =>
        `<option value="${o.value}" ${o.value === current ? "selected" : ""}>${o.label}</option>`
    )
    .join("");
  if (current && ![...sel.options].some((o) => o.value === current)) {
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = `自定义 ${current}`;
    opt.selected = true;
    sel.appendChild(opt);
  }
}

$("#btn-settings").onclick = () => openSettings();
$("#settings-close").onclick = () => $("#settings-dlg").close();
$("#ai-provider").onchange = (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt?.dataset?.base) return;
  const form = $("#settings-form");
  form.AI_BASE_URL.value = opt.dataset.base;
  form.AI_MODEL.value = opt.dataset.model;
};

$("#settings-form").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = {
    AI_BASE_URL: form.AI_BASE_URL.value.trim(),
    AI_MODEL: form.AI_MODEL.value.trim(),
    AUTO_RUN: form.AUTO_RUN.checked,
    CRON_COLLECT: form.CRON_COLLECT.value,
    CRON_PROCESS: form.CRON_PROCESS.value,
    CRON_PUBLISH: form.CRON_PUBLISH.value,
    WP_URL: form.WP_URL.value.trim(),
    WP_USER: form.WP_USER.value.trim(),
  };
  if (form.AI_API_KEY.value.trim()) body.AI_API_KEY = form.AI_API_KEY.value.trim();
  if (form.WP_APP_PASSWORD.value.trim())
    body.WP_APP_PASSWORD = form.WP_APP_PASSWORD.value.trim();

  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
    $("#settings-dlg").close();
    setJob("设置已保存并立即生效");
    await refresh();
  } catch (err) {
    setJob(err.message, true);
  }
};

/* boot */
refresh().catch((err) => setJob(err.message, true));
setInterval(() => void refresh().catch(() => {}), 12000);
