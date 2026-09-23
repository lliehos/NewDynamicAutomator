/** Recorder portal UI — start from process list; session controls on target FAB. */
(function () {
  function recorderOk() {
    return document.documentElement.dataset.daRecorderExtension === "1"
      || document.documentElement.dataset.daExtension === "1";
  }

  function setPortalStatus(msg, type) {
    const status = document.getElementById("da-portal-status")
      || document.getElementById("da-page-rec-status")
      || document.getElementById("flow-status");
    if (status && msg != null) status.textContent = String(msg);
    if (msg) {
      try {
        window.dispatchEvent(new CustomEvent("da-notify", {
          detail: { message: String(msg), type: type || "info" }
        }));
      } catch { /* ignore */ }
    }
  }

  function portalUser() {
    if (window.DaSecureStore && typeof DaSecureStore.currentUser === "function") {
      return DaSecureStore.currentUser() || "test";
    }
    return localStorage.getItem("da_local_user") || "test";
  }

  /** Always decrypt from disk — sync DaSecureStore.readTasks() can be [] before bootstrap. */
  async function readPortalTasksAsync() {
    const user = portalUser();
    if (window.DaSecureStore) {
      try {
        if (typeof DaSecureStore.bootstrap === "function") {
          await DaSecureStore.bootstrap(user);
        }
      } catch { /* ignore */ }
      const cached = DaSecureStore.readTasks(user);
      if (Array.isArray(cached) && cached.length) return cached;
    }
    try {
      const raw = localStorage.getItem("da_local_tasks__" + user);
      if (!raw) return [];
      if (window.DaCrypto && DaCrypto.looksEncrypted(raw)) {
        const data = await DaCrypto.decryptJson(raw);
        return Array.isArray(data) ? data : [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function syncRecordPageFab() {
    const fab = document.getElementById("da-page-rec-fab");
    const panel = document.getElementById("da-page-rec-panel");
    const status = document.getElementById("da-page-rec-status");
    const msg = document.getElementById("da-record-gate-msg");
    if (!fab) return;

    const ok = recorderOk();
    fab.hidden = !ok;
    if (msg) {
      msg.innerHTML = ok
        ? "افزونهٔ <strong>ضبط</strong> متصل است. ضبط را از <strong>لیست فرآیندها</strong> شروع کنید؛ کنترل‌ها روی تب هدف ظاهر می‌شوند."
        : "افزونهٔ <strong>ضبط (Recorder)</strong> نصب نیست. در Chrome/Edge با Load unpacked نصب کنید.";
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
        const title = state?.targetTitle || (state?.targetTaskId ? `#${state.targetTaskId}` : "");
        if (phase === "recording") status.textContent = `در حال ضبط ${title} — ${state.count || 0} مورد`;
        else if (phase === "review") status.textContent = `بازبینی — ${state.count || 0} مورد · ذخیره از FAB تب هدف`;
        else status.textContent = "آماده — از لیست فرآیندها ضبط را شروع کنید";
      }
    }).catch(() => {});
  }

  document.addEventListener("click", async (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("[data-da-action]") : null;
    if (!t) return;
    const action = t.getAttribute("data-da-action");

    if (action === "start-record") {
      ev.preventDefault();
      const taskId = t.getAttribute("data-task-id");
      if (!taskId) {
        setPortalStatus("ضبط باید از روی یک فرآیند در لیست شروع شود.", "error");
        return;
      }
      // Push portal process list into the extension BEFORE starting (append-only).
      const tasks = await readPortalTasksAsync();
      const user = portalUser();
      if (!tasks.length) {
        setPortalStatus("در پورتال فرآیندی نیست — اول یک فرآیند بسازید، بعد ضبط را از همان ردیف شروع کنید.", "error");
        return;
      }
      const sync = await chrome.runtime.sendMessage({
        type: "syncTasksFromPortal",
        tasks,
        user
      }).catch((e) => ({ ok: false, error: e.message }));
      if (!sync?.ok) {
        setPortalStatus(sync?.error || "همگام‌سازی فرآیندها با افزونه ناموفق بود.", "error");
        return;
      }
      const payload = {
        type: "startRecordSession",
        // Keep UUID/string ids — Number(uuid) becomes NaN and breaks start.
        taskId: String(taskId).trim(),
        taskTitle: t.getAttribute("data-task-title") || null
      };
      const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
      if (res?.ok) {
        setPortalStatus(
          `ضبط روی فرآیند #${taskId} شروع شد — پنل ضبط روی تب هدف است.`,
          "success"
        );
      } else {
        setPortalStatus(res?.error || "خطا در شروع ضبط", "error");
      }
      syncRecordPageFab();
    }
    if (action === "check-extension" || action === "check-recorder") {
      ev.preventDefault();
      window.dispatchEvent(new CustomEvent("da-extension-recheck", { detail: { role: "recorder" } }));
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
    if (action === "resume-record") {
      ev.preventDefault();
      await chrome.runtime.sendMessage({ type: "resumeRecord" }).catch(() => {});
      syncRecordPageFab();
    }
    if (action === "save-draft") {
      ev.preventDefault();
      const def = "گروه ضبط";
      const groupTitle = window.prompt("نام گروه ضبط", def);
      if (groupTitle == null) return;
      if (!String(groupTitle).trim()) {
        setPortalStatus("نام گروه لازم است.", "error");
        return;
      }
      const res = await chrome.runtime.sendMessage({
        type: "saveDraft",
        payload: { continueRecording: true, groupTitle: String(groupTitle).trim() }
      }).catch((e) => ({ ok: false, error: e.message }));
      if (res?.ok) {
        setPortalStatus(
          `ذخیره شد در فرآیند #${res.result?.taskId} — گروه «${res.result?.groupTitle || groupTitle}» · می‌توانید ادامه دهید`,
          "success"
        );
      } else {
        setPortalStatus(res?.error || "خطا در ذخیره ضبط", "error");
      }
      syncRecordPageFab();
    }
  });

  document.getElementById("da-page-rec-fab")?.addEventListener("click", (e) => {
    e.preventDefault();
    const panel = document.getElementById("da-page-rec-panel");
    if (panel) panel.hidden = !panel.hidden;
    syncRecordPageFab();
  });

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

  window.addEventListener("da-recorder-ready", () => syncRecordPageFab());
  window.addEventListener("da-extension-ready", (ev) => {
    if (ev.detail?.role && ev.detail.role !== "recorder") return;
    syncRecordPageFab();
  });
  window.addEventListener("da-extension-recheck", () => syncRecordPageFab());

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "recordingChanged" || message.type === "draftUpdated") {
      syncRecordPageFab();
    }
  });

  syncRecordPageFab();
  setTimeout(syncRecordPageFab, 500);
})();
