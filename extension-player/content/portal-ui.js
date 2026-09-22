/** Player portal UI — play / stop only. */
(function () {
  function playerOk() {
    return document.documentElement.dataset.daPlayerExtension === "1";
  }

  function setPortalStatus(msg, type) {
    const status = document.getElementById("da-portal-status")
      || document.getElementById("flow-status")
      || document.getElementById("da-page-rec-status");
    if (status && msg != null) status.textContent = String(msg);
    if (msg) {
      try {
        window.dispatchEvent(new CustomEvent("da-notify", {
          detail: { message: String(msg), type: type || "info" }
        }));
      } catch { /* ignore */ }
    }
  }

  function emitPlayUi(phase, text, extra) {
    try {
      window.dispatchEvent(new CustomEvent("da-play-ui", {
        detail: { phase, text: text || "", ...(extra || {}) }
      }));
    } catch {
      /* ignore */
    }
  }

  async function playTask(taskId, scope) {
    window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
    await new Promise((r) => setTimeout(r, 80));

    const preparing = "آماده‌سازی افزونهٔ اجرا…";
    const status = document.getElementById("da-portal-status")
      || document.getElementById("flow-status")
      || document.getElementById("da-page-rec-status");
    if (status) status.textContent = preparing;
    emitPlayUi("preparing", preparing);

    try {
      await fetch("/extension/sync", { method: "POST", cache: "no-store" });
    } catch {
      /* ignore */
    }

    const payload = {
      type: "startPlay",
      taskId: Number(taskId),
      groupNodeId: scope?.groupNodeId || null,
      stepNodeId: scope?.stepNodeId || null,
      openNewTab: true
    };
    const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
    if (res?.reloading) {
      const msg = res.message || "افزونه در حال Reload است — اجرا خودکار شروع می‌شود…";
      setPortalStatus(msg, "info");
      emitPlayUi("reloading", msg);
    } else if (res?.ok) {
      const msg = `اجرا شروع شد — ${res.stepTotal || "?"} مرحله`;
      setPortalStatus(msg, "success");
      emitPlayUi("started", msg);
    } else {
      const msg = res?.error || "خطا در اجرا";
      setPortalStatus(msg, "error");
      emitPlayUi("error", msg);
    }
    return res;
  }

  async function stopPlay() {
    const res = await chrome.runtime.sendMessage({ type: "stopPlay" }).catch((e) => ({ ok: false, error: e.message }));
    if (res?.ok === false && res?.error) {
      setPortalStatus(res.error, "error");
    } else {
      setPortalStatus("اجرا متوقف شد", "info");
    }
    emitPlayUi("done");
    return res;
  }

  document.addEventListener("click", async (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("[data-da-action]") : null;
    if (!t) return;
    const action = t.getAttribute("data-da-action");

    if (action === "check-extension" || action === "check-player") {
      ev.preventDefault();
      window.dispatchEvent(new CustomEvent("da-extension-recheck", { detail: { role: "player" } }));
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
    if (action === "stop-play") {
      ev.preventDefault();
      await stopPlay();
    }
  });

  window.addEventListener("da-play", async (ev) => {
    const d = ev.detail || {};
    if (!d.taskId) return;
    await playTask(d.taskId, { groupNodeId: d.groupNodeId, stepNodeId: d.stepNodeId });
  });

  window.addEventListener("da-stop-play", async () => {
    await stopPlay();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "playStateChanged") return;
    const status = document.getElementById("da-portal-status")
      || document.getElementById("flow-status")
      || document.getElementById("da-page-rec-status");
    if (message.playing) {
      const msg = message.title ? `اجرا: ${message.title}` : "اجرا شروع شد";
      if (status) status.textContent = msg;
      emitPlayUi("started", msg);
    } else if (message.lastError) {
      const msg = String(message.lastError);
      setPortalStatus(msg, "error");
      emitPlayUi("error", msg);
    } else {
      emitPlayUi("done");
    }
  });

  const hidePortalExtFab = async () => {
    try {
      const { portalBase } = await chrome.storage.local.get("portalBase");
      const base = String(portalBase || "").replace(/\/$/, "");
      if (!base || !location.href.startsWith(base)) return;
    } catch {
      return;
    }
    const extFab = document.getElementById("da-player-fab") || document.getElementById("da-recorder-fab");
    if (extFab) extFab.style.display = "none";
  };
  hidePortalExtFab();
  setTimeout(hidePortalExtFab, 400);

  window.daPlayerOk = playerOk;
})();
