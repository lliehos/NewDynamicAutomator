/** Smart Recorder portal UI — start from process list. */
(function () {
  function smartOk() {
    return document.documentElement.dataset.daSmartExtension === "1";
  }

  function setPortalStatus(msg, type) {
    const status = document.getElementById("da-portal-status")
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

  document.addEventListener("click", async (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("[data-da-action]") : null;
    if (!t) return;
    const action = t.getAttribute("data-da-action");

    if (action === "start-smart-record") {
      ev.preventDefault();
      if (!smartOk()) {
        setPortalStatus("افزونهٔ Smart Recorder نصب نیست.", "error");
        return;
      }
      const taskId = t.getAttribute("data-task-id");
      if (!taskId) {
        setPortalStatus("فرآیند هدف مشخص نیست.", "error");
        return;
      }
      const payload = {
        type: "startSmartSession",
        taskId: String(taskId).trim(),
        taskTitle: t.getAttribute("data-task-title") || null
      };
      const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
      if (res?.ok) {
        setPortalStatus(`هوشمندسازی فرآیند #${taskId} شروع شد — لوگو = توقف فکر کردن.`, "success");
      } else if (res?.status === 404 || /404/.test(String(res?.error || ""))) {
        setPortalStatus("سرور در دسترس نیست (404).", "error");
      } else {
        setPortalStatus(res?.error || "خطا در شروع Smart Recorder", "error");
      }
    }
    if (action === "check-smart") {
      ev.preventDefault();
      window.dispatchEvent(new CustomEvent("da-extension-recheck", { detail: { role: "smart" } }));
    }
  });
})();
