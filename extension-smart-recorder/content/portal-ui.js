/** Smart Recorder portal UI — start from process list. */
(function () {
  // Localized status text. The culture is the one the web app published to chrome.storage.
  function t(key, vars) {
    const i18n = window.DaRecI18n;
    return i18n ? i18n.t(key, vars) : key;
  }

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
    const el = ev.target instanceof Element ? ev.target.closest("[data-da-action]") : null;
    if (!el) return;
    const action = el.getAttribute("data-da-action");

    if (action === "start-smart-record") {
      ev.preventDefault();
      if (!smartOk()) {
        setPortalStatus(t("portal.notInstalled"), "error");
        return;
      }
      const taskId = el.getAttribute("data-task-id");
      if (!taskId) {
        setPortalStatus(t("portal.noTask"), "error");
        return;
      }
      const payload = {
        type: "startSmartSession",
        taskId: String(taskId).trim(),
        taskTitle: el.getAttribute("data-task-title") || null
      };
      const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
      if (res?.ok) {
        setPortalStatus(t("portal.started", { id: taskId }), "success");
      } else if (res?.network) {
        // `network` means the server was never reached, so the reason it carries is the useful part
        // (connection refused, certificate rejected, bad host) and it is shown verbatim. Testing for
        // a literal 404 here no longer works: a transport failure is reported with status 0 now.
        setPortalStatus(res?.error || t("portal.serverDown"), "error");
      } else {
        setPortalStatus(res?.error || t("portal.startError"), "error");
      }
    }
    if (action === "copy-smart-record") {
      ev.preventDefault();
      // Copying the last recording back out of extension memory. This exists because the page on
      // which the recording happened may never be visited again: without it, once the recorded tab
      // is closed there is no way to reach the payload a second time. The text is already in
      // storage (written by `copySmartResult`), so no server round-trip is needed.
      const stored = await chrome.storage.local.get(["smartCopyText", "smartCopyAt"]).catch(() => ({}));
      const text = stored?.smartCopyText;
      if (!text) {
        setPortalStatus(t("portal.noCopy"), "error");
        return;
      }
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch { ok = false; }
      if (ok) setPortalStatus(t("portal.copied"), "success");
      else setPortalStatus(t("portal.copyBlocked"), "error");
      return;
    }

    if (action === "check-smart") {
      ev.preventDefault();
      window.dispatchEvent(new CustomEvent("da-extension-recheck", { detail: { role: "smart" } }));
    }
  });
})();
