/** Handles portal buttons and scoped play (page world cannot call chrome.*). */
(function () {
  function extOk() {
    return document.documentElement.dataset.daExtension === "1"
      || !!document.getElementById("da-recorder-fab");
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

  document.addEventListener("click", async (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("[data-da-action]") : null;
    if (!t) return;
    const action = t.getAttribute("data-da-action");
    if (action === "start-record") {
      ev.preventDefault();
      const res = await chrome.runtime.sendMessage({ type: "startRecordSession" }).catch((e) => ({ ok: false, error: e.message }));
      const status = document.getElementById("da-portal-status") || document.getElementById("da-page-rec-status");
      if (status) {
        status.textContent = res?.ok
          ? "تب جدید باز شد — در سایت هدف کار کنید، بعد از FAB «اتمام ضبط» را بزنید."
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
      const res = await chrome.runtime.sendMessage({
        type: "saveDraft",
        payload: { newTaskTitle: title }
      }).catch((e) => ({ ok: false, error: e.message }));
      const status = document.getElementById("da-page-rec-status") || document.getElementById("da-portal-status");
      if (status) {
        status.textContent = res?.ok
          ? `ذخیره شد — ویرایش: /Tasks/Editor/${res.result?.taskId}`
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

  if (location.pathname.toLowerCase().includes("/record")) {
    const hideDup = () => {
      const extFab = document.getElementById("da-recorder-fab");
      if (extFab && document.getElementById("da-page-rec-fab")) extFab.style.display = "none";
    };
    hideDup();
    setTimeout(hideDup, 800);
  }

  window.addEventListener("da-extension-ready", syncRecordPageFab);
  window.addEventListener("da-extension-recheck", syncRecordPageFab);
  syncRecordPageFab();
  setTimeout(syncRecordPageFab, 500);
})();
