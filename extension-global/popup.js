const I18n = globalThis.DaExtI18n;
const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
}

function stepTitle(s) {
  if (s?.title && String(s.title).trim()) return String(s.title).trim();
  const label = String(s?.elementLabel || "").trim();
  const x = String(s?.actionType || "Action");
  const verb = x.toLowerCase() === "gotourl" ? "رفتن به"
    : x.toLowerCase() === "inputcontent" ? "متن"
      : x === "Click" ? "کلیک" : x;
  if (label) return `${verb} ${label}`;
  if (x.toLowerCase() === "gotourl") {
    try { return `${verb} ${new URL(String(s.url || s.value || "")).hostname}`; } catch { /* ignore */ }
  }
  return verb;
}

function stepDetail(s) {
  const x = String(s?.actionType || "").toLowerCase();
  if (x === "gotourl") return String(s.url || s.value || "").slice(0, 100);
  if (x === "inputcontent") {
    const v = String(s.value ?? "").slice(0, 50);
    const sel = String(s.elementValue || "").slice(0, 50);
    return v ? `${v} · ${sel}` : sel;
  }
  return String(s.elementValue || "").slice(0, 100);
}

function applyDomI18n() {
  if (I18n) {
    document.documentElement.setAttribute("lang", I18n.getCulture());
    document.documentElement.setAttribute("dir", I18n.dir());
  }
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  const save = document.getElementById("save");
  if (save) {
    save.title = t("rec.save");
    save.setAttribute("aria-label", t("rec.save"));
  }
}

function renderLiveLog(el, steps) {
  if (!el) return;
  if (!steps?.length) {
    el.innerHTML = `<div class="log-empty">${escapeHtml(t("rec.logEmpty"))}</div>`;
    return;
  }
  el.innerHTML = steps.map((s, i) => `
    <div class="log-line">
      <div class="log-title">${i + 1}. ${escapeHtml(stepTitle(s))}</div>
      <div class="log-detail">${escapeHtml(stepDetail(s))}</div>
    </div>`).join("");
  el.scrollTop = el.scrollHeight;
}

function renderReviewLog(el, steps) {
  if (!el) return;
  if (!steps?.length) {
    el.innerHTML = `<div class="log-empty">${escapeHtml(t("rec.reviewEmpty"))}</div>`;
    return;
  }
  el.innerHTML = steps.map((s, i) => `
    <label class="check-line">
      <input type="checkbox" class="step-cb" data-idx="${i}" checked />
      <span>
        <div class="log-title">${escapeHtml(stepTitle(s))} · ${i + 1}</div>
        <div class="log-detail">${escapeHtml(stepDetail(s))}</div>
      </span>
    </label>`).join("");
}

function selectedIndexes() {
  return [...document.querySelectorAll(".step-cb:checked")]
    .map((el) => Number(el.getAttribute("data-idx")))
    .filter((n) => Number.isFinite(n));
}

async function pushOptions() {
  await chrome.runtime.sendMessage({
    type: "setRecordOptions",
    options: {
      trackInputClicks: !!document.getElementById("opt-input-clicks")?.checked,
      trackMouse: !!document.getElementById("opt-mouse")?.checked
    }
  }).catch(() => {});
}

async function refresh() {
  applyDomI18n();
  try {
    const { tenantBranding: b } = await chrome.storage.local.get("tenantBranding");
    if (b?.logoUrl) {
      const img = document.querySelector("#app-title img");
      if (img) img.src = b.logoUrl;
    }
  } catch { /* ignore */ }
  const session = await chrome.runtime.sendMessage({ type: "session" }).catch(() => ({
    userName: "test", version: "?"
  }));
  const state = await chrome.runtime.sendMessage({ type: "getState" }).catch(() => ({
    recordPhase: "idle", count: 0, steps: []
  }));
  const el = document.getElementById("status");
  const idleBox = document.getElementById("idle-box");
  const recBox = document.getElementById("rec-box");
  const reviewBox = document.getElementById("review-box");
  const phase = state.recordPhase || "idle";
  const steps = Array.isArray(state.steps) ? state.steps : [];

  idleBox.hidden = phase !== "idle";
  recBox.hidden = phase !== "recording";
  reviewBox.hidden = phase !== "review";

  const title = state.targetTitle
    || (state.targetTaskId ? t("rec.process", { id: state.targetTaskId }) : "");
  const ver = session?.version || chrome.runtime.getManifest().version;
  const user = session?.userName || "test";

  if (phase === "recording") {
    el.textContent = `${title || t("rec.fallbackTitle")} — ${t("rec.items", { n: state.count || 0 })} · v${ver}`;
    const opts = state.options || {};
    const ic = document.getElementById("opt-input-clicks");
    const ms = document.getElementById("opt-mouse");
    if (ic) ic.checked = !!opts.trackInputClicks;
    if (ms) ms.checked = opts.trackMouse !== false;
    renderLiveLog(document.getElementById("log"), steps);
  } else if (phase === "review") {
    el.textContent = `${t("rec.reviewMeta", { n: state.count || 0 })}${title ? ` · ${title}` : ""}`;
    renderReviewLog(document.getElementById("review-log"), steps);
  } else {
    el.textContent = `${t("rec.fallbackTitle")} v${ver} · ${user}`;
  }
}

(async function boot() {
  if (I18n) {
    await I18n.init();
    I18n.onChange(() => refresh());
  }
  document.getElementById("refresh").addEventListener("click", refresh);
  document.getElementById("opt-input-clicks")?.addEventListener("change", pushOptions);
  document.getElementById("opt-mouse")?.addEventListener("change", pushOptions);

  document.getElementById("stop").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "finishRecord" });
    await refresh();
  });

  document.getElementById("save").addEventListener("click", async () => {
    const asked = window.prompt(t("rec.groupTitlePrompt"), t("rec.groupTitleDefault"));
    if (asked == null) return;
    const groupTitle = String(asked).trim();
    if (!groupTitle) {
      document.getElementById("status").textContent = t("rec.groupTitleRequired");
      return;
    }
    const res = await chrome.runtime.sendMessage({
      type: "saveDraft",
      payload: {
        selectedIndexes: selectedIndexes(),
        continueRecording: true,
        groupTitle
      }
    });
    document.getElementById("status").textContent = res?.ok
      ? t("rec.saved", { n: res.result?.groupCount })
      : (res?.error || t("rec.saveError"));
    await refresh();
  });

  document.getElementById("resume").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "resumeRecord" });
    await refresh();
  });

  async function endSession() {
    await chrome.runtime.sendMessage({ type: "discardRecord" });
    await refresh();
  }
  document.getElementById("end").addEventListener("click", endSession);
  document.getElementById("end2").addEventListener("click", endSession);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "recordingChanged" || message.type === "draftUpdated") refresh();
  });
  await refresh();
})();
