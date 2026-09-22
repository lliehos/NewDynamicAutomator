/** Handles portal buttons and scoped play (page world cannot call chrome.*). */
(function () {
  function extOk() {
    return document.documentElement.dataset.daExtension === "1"
      || !!document.getElementById("da-recorder-fab");
  }

  function tabOptionLabel(t) {
    const title = (t.title || "بدون عنوان").trim();
    let host = "";
    try {
      if (t.url && /^https?:/i.test(t.url)) host = new URL(t.url).host;
      else if (t.isBlank) host = "خالی";
    } catch {
      /* ignore */
    }
    const mark = t.active ? " [فعال]" : "";
    return host ? `${title}${mark} — ${host}` : `${title}${mark}`;
  }

  function fillRecordTabSelectFromList(sel, tabs) {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">تب جدید (خالی)</option>`;
    for (const t of tabs || []) {
      if (t.isPortal) continue;
      const opt = document.createElement("option");
      opt.value = String(t.id);
      opt.textContent = tabOptionLabel(t);
      sel.appendChild(opt);
    }
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  async function fillRecordTabSelect(sel) {
    if (!sel) return;
    const res = await chrome.runtime.sendMessage({ type: "listOpenTabs" }).catch(() => null);
    fillRecordTabSelectFromList(sel, res?.ok ? res.tabs : []);
  }

  async function loadPortalRecordTabs(fromBroadcast) {
    if (fromBroadcast?.tabs) {
      fillRecordTabSelectFromList(document.getElementById("da-record-tab"), fromBroadcast.tabs);
      fillRecordTabSelectFromList(document.getElementById("da-page-record-tab"), fromBroadcast.tabs);
      return;
    }
    await fillRecordTabSelect(document.getElementById("da-record-tab"));
    await fillRecordTabSelect(document.getElementById("da-page-record-tab"));
  }

  function syncRecordPageFab() {
    const fab = document.getElementById("da-page-rec-fab");
    const panel = document.getElementById("da-page-rec-panel");
    const status = document.getElementById("da-page-rec-status");
    const msg = document.getElementById("da-record-gate-msg");
    if (!fab) return;

    const ok = extOk();
    fab.hidden = !ok;
    if (msg) {
      msg.innerHTML = ok
        ? "افزونه متصل است. دکمهٔ قرمز <strong>REC</strong> پایین‌چپ را بزنید."
        : "افزونه نصب نیست. در <strong>Chrome یا Edge</strong> نصب کنید — مرورگر داخلی Cursor از افزونه پشتیبانی نمی‌کند.";
    }
    if (!ok) {
      if (panel) panel.hidden = true;
      return;
    }

    chrome.runtime.sendMessage({ type: "getState" }).then((state) => {
      const phase = state?.recordPhase || "idle";
      fab.classList.toggle("on", phase === "recording");
      fab.textContent = phase === "recording" ? "REC●" : phase === "review" ? "✓" : "REC";
      const idle = document.getElementById("da-page-idle");
      const rec = document.getElementById("da-page-recording");
      const review = document.getElementById("da-page-review");
      if (idle) idle.hidden = phase !== "idle";
      if (rec) rec.hidden = phase !== "recording";
      if (review) review.hidden = phase !== "review";
      if (status) {
        if (phase === "recording") status.textContent = `در حال ضبط — ${state.count} اکشن (موقت)`;
        else if (phase === "review") status.textContent = `${state.count || 0} اکشن آماده — ارسال / انصراف / مجدد`;
        else status.textContent = "آماده برای شروع ضبط";
      }
      if (phase === "idle") loadPortalRecordTabs();
    }).catch(() => {});
  }

  async function playTask(taskId, scope) {
    const payload = {
      type: "startPlay",
      taskId: Number(taskId),
      groupNodeId: scope?.groupNodeId || null,
      stepNodeId: scope?.stepNodeId || null
    };
    const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
    const status = document.getElementById("da-portal-status")
      || document.getElementById("flow-status")
      || document.getElementById("da-page-rec-status");
    if (status) {
      status.textContent = res?.ok
        ? `اجرا شروع شد — ${res.stepTotal} مرحله`
        : (res?.error || "خطا در اجرا");
    }
    return res;
  }

  function selectedRecordTabId() {
    const sel = document.getElementById("da-record-tab")
      || document.getElementById("da-page-record-tab");
    const val = sel?.value;
    if (!val) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  document.addEventListener("click", async (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("[data-da-action]") : null;
    if (!t) return;
    const action = t.getAttribute("data-da-action");
    if (action === "start-record") {
      ev.preventDefault();
      // Always open a fresh about:blank tab (no tab picker on portal).
      const payload = { type: "startRecordSession" };
      const taskId = t.getAttribute("data-task-id");
      if (taskId) payload.taskId = Number(taskId);
      const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
      const status = document.getElementById("da-portal-status") || document.getElementById("da-page-rec-status");
      if (status) {
        status.textContent = res?.ok
          ? (taskId
            ? `ضبط روی فرآیند #${taskId} در تب جدید شروع شد — بعد از اتمام، در FAB ذخیره کنید.`
            : "تب جدید خالی باز شد — کار کنید، بعد از FAB «اتمام ضبط» را بزنید.")
          : (res?.error || "خطا در شروع ضبط");
      }
      syncRecordPageFab();
    }
    if (action === "check-extension") {
      ev.preventDefault();
      window.dispatchEvent(new CustomEvent("da-extension-recheck"));
      syncRecordPageFab();
    }
    if (action === "clear-draft") {
      ev.preventDefault();
      await chrome.runtime.sendMessage({ type: "discardRecord" }).catch(() => {});
      syncRecordPageFab();
    }
    if (action === "finish-record") {
      ev.preventDefault();
      await chrome.runtime.sendMessage({ type: "finishRecord" }).catch(() => {});
      syncRecordPageFab();
    }
    if (action === "rerecord") {
      ev.preventDefault();
      await chrome.runtime.sendMessage({ type: "rerecord" }).catch(() => {});
      syncRecordPageFab();
    }
    if (action === "save-draft") {
      ev.preventDefault();
      const title = prompt("عنوان فرآیند", "فرآیند ضبط‌شده");
      if (title == null) return;
      const res = await chrome.runtime.sendMessage({
        type: "saveDraft",
        payload: { newTaskTitle: title }
      }).catch((e) => ({ ok: false, error: e.message }));
      const status = document.getElementById("da-page-rec-status") || document.getElementById("da-portal-status");
      if (status) {
        status.textContent = res?.ok
          ? `ذخیره شد — ویرایش: /Panel/Tasks/Editor/${res.result?.taskId}`
          : (res?.error || "خطا");
      }
      syncRecordPageFab();
    }
    if (action === "play-task") {
      ev.preventDefault();
      const taskId = t.getAttribute("data-task-id");
      if (!taskId) return;
      await playTask(taskId);
    }
    if (action === "play-group") {
      ev.preventDefault();
      const taskId = t.getAttribute("data-task-id") || document.getElementById("flow-app")?.dataset?.taskId;
      const groupNodeId = t.getAttribute("data-group-id");
      if (!taskId || !groupNodeId) return;
      await playTask(taskId, { groupNodeId });
    }
    if (action === "play-step") {
      ev.preventDefault();
      const taskId = t.getAttribute("data-task-id") || document.getElementById("flow-app")?.dataset?.taskId;
      const stepNodeId = t.getAttribute("data-step-id");
      if (!taskId || !stepNodeId) return;
      await playTask(taskId, { stepNodeId });
    }
  });

  // Editor can dispatch: window.dispatchEvent(new CustomEvent("da-play", { detail: { taskId, groupNodeId, stepNodeId } }))
  window.addEventListener("da-play", async (ev) => {
    const d = ev.detail || {};
    if (!d.taskId) return;
    await playTask(d.taskId, { groupNodeId: d.groupNodeId, stepNodeId: d.stepNodeId });
  });

  document.getElementById("da-page-rec-fab")?.addEventListener("click", (e) => {
    e.preventDefault();
    const panel = document.getElementById("da-page-rec-panel");
    if (panel) panel.hidden = !panel.hidden;
    syncRecordPageFab();
  });

  // Hide global extension REC only on the portal app origin (not other localhost sites).
  const hidePortalExtFab = async () => {
    try {
      const { portalBase } = await chrome.storage.local.get("portalBase");
      const base = String(portalBase || "").replace(/\/$/, "");
      if (!base || !location.href.startsWith(base)) return;
    } catch {
      return;
    }
    const extFab = document.getElementById("da-recorder-fab");
    if (extFab) extFab.style.display = "none";
  };
  hidePortalExtFab();
  setTimeout(hidePortalExtFab, 400);
  setTimeout(hidePortalExtFab, 1200);

  window.addEventListener("da-extension-ready", () => {
    syncRecordPageFab();
    loadPortalRecordTabs();
  });
  window.addEventListener("da-extension-recheck", () => {
    syncRecordPageFab();
    loadPortalRecordTabs();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "openTabsChanged") {
      loadPortalRecordTabs(message);
    }
  });

  syncRecordPageFab();
  loadPortalRecordTabs();
  setTimeout(syncRecordPageFab, 500);
  setTimeout(loadPortalRecordTabs, 600);
})();
