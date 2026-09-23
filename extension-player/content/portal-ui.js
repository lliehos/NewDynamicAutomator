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

  function portalUser() {
    return localStorage.getItem("da_local_user") || "test";
  }

  /** Decrypt portal tasks into the Player extension before startPlay. */
  async function readPortalTasksAsync() {
    const user = portalUser();
    const key = "da_local_tasks__" + user;
    try {
      const raw = localStorage.getItem(key);
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

  async function syncTasksIntoPlayer() {
    const tasks = await readPortalTasksAsync();
    const user = portalUser();
    if (!tasks.length) {
      return { ok: false, error: "در پورتال فرآیندی نیست یا هنوز رمزگشایی نشده — صفحه را رفرش کنید." };
    }
    return chrome.runtime.sendMessage({
      type: "syncTasksFromPortal",
      tasks,
      user
    }).catch((e) => ({ ok: false, error: e.message }));
  }

  let lastConditionAnnounceKey = "";
  let conditionWaitGen = 0;

  function announceConditionResult(pass, text, meta) {
    const ok = !!pass;
    const msg = text || (ok ? "نتیجه شرط: برقرار (موفق)" : "نتیجه شرط: برقرار نیست (ناموفق)");
    // Unique per check run — same pass/fail must still alert again.
    const checkId = meta?.checkId != null ? String(meta.checkId) : `${Date.now()}-${Math.random()}`;
    const key = `ann:${checkId}`;
    if (key === lastConditionAnnounceKey) return;
    lastConditionAnnounceKey = key;
    setPortalStatus(msg, ok ? "success" : "error");
    emitPlayUi("done", msg, { conditionPass: ok, checkId });
    try {
      window.postMessage({
        source: "da-player-ext",
        type: "condition-result",
        pass: ok,
        message: msg,
        checkId
      }, "*");
    } catch { /* ignore */ }
  }

  async function waitForConditionResult(timeoutMs, expect) {
    const gen = ++conditionWaitGen;
    const t0 = Date.now();
    const deadline = t0 + Math.max(2000, Number(timeoutMs) || 20000);
    const expectNodeId = expect?.conditionNodeId || null;
    let sawPlaying = false;
    let last = null;

    while (Date.now() < deadline) {
      if (gen !== conditionWaitGen) return false; // superseded by a newer check
      const st = await chrome.runtime.sendMessage({ type: "getPlayState" }).catch(() => null);
      last = st;
      if (st?.playing) sawPlaying = true;

      if (sawPlaying && st && st.playing === false) {
        const lr = st.lastResult;
        if (lr && Object.prototype.hasOwnProperty.call(lr, "conditionPass")) {
          // Ignore stale result from a previous run (no checkId or older than this wait).
          const cid = lr.checkId != null ? Number(lr.checkId) : NaN;
          if (Number.isFinite(cid) && cid < t0 - 50) {
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }
          if (expectNodeId && lr.nodeId && lr.nodeId !== expectNodeId) {
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }
          announceConditionResult(!!lr.conditionPass, null, { checkId: lr.checkId || `${t0}` });
          return true;
        }
        if (st.lastError) {
          announceConditionResult(false, String(st.lastError), { checkId: `${t0}-err` });
          return false;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (gen !== conditionWaitGen) return false;
    if (last?.lastResult && Object.prototype.hasOwnProperty.call(last.lastResult, "conditionPass")) {
      const lr = last.lastResult;
      const cid = lr.checkId != null ? Number(lr.checkId) : NaN;
      if (!Number.isFinite(cid) || cid >= t0 - 50) {
        announceConditionResult(!!lr.conditionPass, null, { checkId: lr.checkId || `${t0}` });
        return true;
      }
    }
    announceConditionResult(
      false,
      "بررسی شرط پاسخ نداد. تب هدف را باز نگه دارید و دوباره تلاش کنید.",
      { checkId: `${t0}-timeout` }
    );
    return false;
  }

  async function playTask(taskId, scope) {
    const id = String(taskId || "").trim();
    if (!id || id === "NaN" || id === "null" || id === "undefined") {
      setPortalStatus("شناسهٔ فرآیند نامعتبر است.", "error");
      emitPlayUi("error", "شناسهٔ فرآیند نامعتبر است.");
      return { ok: false, error: "شناسهٔ فرآیند نامعتبر است." };
    }

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

    // Push portal process list into Player chrome.storage BEFORE startPlay.
    const sync = await syncTasksIntoPlayer();
    if (!sync?.ok) {
      const msg = sync?.error || "همگام‌سازی فرآیندها با افزونهٔ اجرا ناموفق بود.";
      setPortalStatus(msg, "error");
      emitPlayUi("error", msg);
      return sync;
    }

    const rawTab = scope?.tabId != null && scope.tabId !== "" ? Number(scope.tabId) : NaN;
    const hasTargetTab = Number.isFinite(rawTab);
    const isConditionCheck = !!scope?.conditionNodeId;
    const payload = {
      type: "startPlay",
      // Keep UUID/string ids — Number(uuid) becomes NaN and breaks play.
      taskId: id,
      groupNodeId: scope?.groupNodeId || null,
      stepNodeId: scope?.stepNodeId || null,
      conditionNodeId: scope?.conditionNodeId || null,
      tabId: hasTargetTab ? rawTab : null,
      // Portal Start → new blank tab; ctx check/run → never open a new tab.
      openNewTab: hasTargetTab ? false : (isConditionCheck ? false : (scope?.openNewTab !== false))
    };
    const res = await chrome.runtime.sendMessage(payload).catch((e) => ({ ok: false, error: e.message }));
    if (res?.reloading) {
      const msg = res.message || "افزونه در حال Reload است — اجرا خودکار شروع می‌شود…";
      setPortalStatus(msg, "info");
      emitPlayUi("reloading", msg);
    } else if (res?.ok) {
      const msg = isConditionCheck
        ? (hasTargetTab
          ? "بررسی شرط در تب انتخاب‌شده شروع شد"
          : "بررسی شرط شروع شد")
        : (hasTargetTab
          ? (scope?.groupNodeId
            ? `اجرای گروه در تب انتخاب‌شده شروع شد — ${res.stepTotal || "?"} مرحله`
            : `اجرا در تب انتخاب‌شده شروع شد — ${res.stepTotal || "?"} مرحله`)
          : `اجرا شروع شد — ${res.stepTotal || "?"} مرحله`);
      // For condition checks avoid green "started" toast — poll for the real pass/fail.
      if (isConditionCheck) {
        if (status) status.textContent = msg;
        emitPlayUi("started", msg);
        lastConditionAnnounceKey = "";
        waitForConditionResult(25000, { conditionNodeId: scope.conditionNodeId }).catch(() => {});
      } else {
        setPortalStatus(msg, "success");
        emitPlayUi("started", msg);
      }
    } else {
      const msg = res?.error || "خطا در اجرا";
      setPortalStatus(msg, "error");
      emitPlayUi("error", msg);
    }
    return res;
  }

  function tabLabel(t) {
    const title = (t.title || "").trim() || "بدون عنوان";
    const url = (t.url || "").replace(/^https?:\/\//i, "").slice(0, 48);
    return url ? `${title} — ${url}` : title;
  }

  async function listOpenTabsForEditor() {
    let res = await chrome.runtime.sendMessage({ type: "listOpenTabs" })
      .catch((e) => ({ ok: false, error: e.message, tabs: [] }));
    // Cold service worker: one quick retry.
    if (!res?.ok && !Array.isArray(res?.tabs)) {
      await new Promise((r) => setTimeout(r, 200));
      res = await chrome.runtime.sendMessage({ type: "listOpenTabs" })
        .catch((e) => ({ ok: false, error: e.message, tabs: [] }));
    }
    const tabs = Array.isArray(res?.tabs) ? res.tabs : [];
    // Prefer real http(s) pages that are not the Morobot portal itself.
    const httpTargets = tabs.filter((t) =>
      t && t.id
      && !t.isPortal
      && !t.isBlank
      && /^https?:\/\//i.test(String(t.url || ""))
    );
    // Fallback: any non-blank tab (still skip pure newtab/about:blank).
    const anyUsable = tabs.filter((t) =>
      t && t.id
      && !t.isBlank
      && /^https?:\/\//i.test(String(t.url || ""))
    );
    const list = httpTargets.length ? httpTargets : anyUsable;
    return {
      ok: !!res?.ok || list.length > 0,
      tabs: list.map((t) => ({
        id: t.id,
        title: t.title || "",
        url: t.url || "",
        active: !!t.active,
        isBlank: !!t.isBlank,
        isPortal: !!t.isPortal,
        label: tabLabel(t) + (t.isPortal ? " (پورتال)" : "")
      })),
      error: res?.error
    };
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

  // postMessage path for ctx «اجرا/بررسی در مرورگر» (reliable tabId)
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== "da-editor") return;
    if (d.type === "play") {
      if (!d.taskId) return;
      await playTask(d.taskId, {
        groupNodeId: d.groupNodeId,
        stepNodeId: d.stepNodeId,
        conditionNodeId: d.conditionNodeId,
        tabId: d.tabId,
        openNewTab: d.openNewTab
      });
      return;
    }
    if (d.type === "list-open-tabs") {
      const res = await listOpenTabsForEditor();
      try {
        window.postMessage({ source: "da-player-ext", type: "open-tabs", ...res }, "*");
        window.dispatchEvent(new CustomEvent("da-open-tabs", { detail: res }));
      } catch { /* ignore */ }
    }
  });

  window.addEventListener("da-play", async (ev) => {
    const d = ev.detail || {};
    if (!d.taskId) return;
    // Skip if this looks like a tab-targeted play without tabId (handled via postMessage).
    await playTask(d.taskId, {
      groupNodeId: d.groupNodeId,
      stepNodeId: d.stepNodeId,
      conditionNodeId: d.conditionNodeId,
      tabId: d.tabId,
      openNewTab: d.openNewTab
    });
  });

  window.addEventListener("da-list-open-tabs", async () => {
    const res = await listOpenTabsForEditor();
    try {
      window.dispatchEvent(new CustomEvent("da-open-tabs", { detail: res }));
      window.postMessage({ source: "da-player-ext", type: "open-tabs", ...res }, "*");
    } catch { /* ignore */ }
  });

  window.addEventListener("da-stop-play", async () => {
    await stopPlay();
  });

  function maybeAnnounceFromPlayState(message) {
    if (!message) return false;
    if (message.type === "conditionCheckResult") {
      announceConditionResult(!!message.pass, message.message, { checkId: message.checkId });
      return true;
    }
    if (message.type !== "playStateChanged") return false;
    const hasCond = message.lastResult
      && Object.prototype.hasOwnProperty.call(message.lastResult, "conditionPass");
    if (!hasCond) return false;
    // Prefer finished state; also accept if playing was cleared early for condition checks.
    if (message.playing && message.scope !== "condition") return false;
    announceConditionResult(
      !!message.lastResult.conditionPass,
      null,
      { checkId: message.lastResult.checkId }
    );
    return true;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (maybeAnnounceFromPlayState(message)) return;
    if (message?.type !== "playStateChanged") return;

    // Live diagram highlight on the editor (current node).
    try {
      window.postMessage({
        source: "da-player-ext",
        type: "play-progress",
        playing: !!message.playing,
        nodeId: message.currentNodeId || null,
        stepIndex: message.stepIndex || 0,
        stepTotal: message.stepTotal || 0,
        paused: !!message.paused
      }, "*");
      window.dispatchEvent(new CustomEvent("da-play-progress", {
        detail: {
          playing: !!message.playing,
          nodeId: message.currentNodeId || null,
          stepIndex: message.stepIndex || 0,
          stepTotal: message.stepTotal || 0,
          paused: !!message.paused
        }
      }));
    } catch { /* ignore */ }

    const status = document.getElementById("da-portal-status")
      || document.getElementById("flow-status")
      || document.getElementById("da-page-rec-status");
    if (message.playing) {
      // Don't spam "اجرا شروع شد" for silent condition checks.
      if (message.scope === "condition") return;
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
