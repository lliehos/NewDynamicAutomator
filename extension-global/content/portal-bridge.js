/** Portal handshake + encrypted local task sync — Recorder role. */
(function () {
  // This script runs at document_start, when the DOM is empty. isMorobotPortalPage() inspects the
  // DOM (title / meta / [data-i18n]) as one of its signals, so calling it here and bailing out on a
  // false answer kills the whole file on a fresh navigation — no listeners, no mark(), and the page
  // then reports "the extension did not respond" until a manual refresh (by which time the DOM
  // exists and the check passes). That made behaviour depend on how the page was reached.
  //
  // Instead: skip ONLY when the answer is trustworthy, which is when the detector has no DOM
  // evidence to consult yet. `da_access` / `da_culture` cookies and the /Panel, /Admin path prefix
  // are all available immediately, so an unambiguous true is honoured now; a false is re-checked at
  // DOM ready and only then treated as authoritative.
  function looksLikePortalNow() {
    try {
      if (!window.DaPortalDetect) return true; // no detector loaded -> never block the bridge
      const path = location.pathname || "/";
      if (/^\/(Panel|Admin)(\/|$)/i.test(path)) return true;
      return !!window.DaPortalDetect.isMorobotPortalPage();
    } catch {
      return true;
    }
  }

  // Deferred start: resolves the "not a portal" case once the DOM can be inspected.
  function startWhenConfirmed() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onDomReady, { once: true });
      // Belt and braces: some navigations (bfcache restore, script injected mid-load) can skip
      // DOMContentLoaded for this frame, so give the decision one more chance at window load.
      window.addEventListener("load", onDomReady, { once: true });
    } else {
      onDomReady();
    }
  }

  let started = false;
  function onDomReady() {
    if (started) return;
    if (!looksLikePortalNow()) return; // now the DOM exists, so a false is trustworthy
    started = true;
    run();
  }

  // Everything below lives inside run(). The early-true path must CALL it, not merely reach its
  // declaration: a `function` statement only defines it. Without the explicit call on this path the
  // whole bridge silently did nothing on /Panel and /Admin (the pages that decide by URL, not by
  // DOM), so mark() never ran, `dataset.daPlayerExtension` was never set, and the editor reported
  // "افزونهٔ اجرا متصل نیست" — with a page refresh unable to help, because the fault was structural
  // rather than a timing race.
  if (!looksLikePortalNow()) {
    // Inconclusive (or a non-portal page seen early): decide again once the DOM is parsed.
    startWhenConfirmed();
    return;
  }

  // Reached only when the early check already said "portal" — start immediately.
  started = true;
  run();

  function run() {
  const ROLE = "recorder";

  function isActionNode(n) {
    return !!n && (n.kind === "action" || n.kind === "step");
  }

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function currentUser() {
    const u = readCookie("da_local_user") || localStorage.getItem("da_local_user") || "test";
    localStorage.setItem("da_local_user", u);
    return u;
  }

  function tasksKey(user) {
    return "da_local_tasks__" + (user || currentUser());
  }

  function isServerBackedTaskId(id) {
    return /^\d+$/.test(String(id ?? "").trim());
  }

  function stepCountOf(t) {
    if (isServerBackedTaskId(t?.id)) return Number(t?.stepCount) || 0;
    if (Array.isArray(t?.graph?.nodes)) {
      return t.graph.nodes.filter((n) => isActionNode(n)).length;
    }
    return Number(t?.stepCount) || 0;
  }

  function richnessOf(t) {
    if (isServerBackedTaskId(t?.id)) return stepCountOf(t);
    const nodes = Array.isArray(t?.graph?.nodes) ? t.graph.nodes.length : 0;
    return nodes * 1000 + stepCountOf(t);
  }

  /** Server-backed: trust incoming canvas/counts. Local-only: keep richer graph. */
  function mergePreferRicherPerId(prev, incoming) {
    const prevById = new Map((prev || []).map((t) => [String(t.id), t]));
    return (incoming || []).map((t) => {
      const old = prevById.get(String(t.id));
      if (!old) return t;
      if (isServerBackedTaskId(t.id)) {
        const out = { ...old, ...t };
        if (Array.isArray(t.graph?.nodes) && t.graph.nodes.length) {
          out.graph = t.graph;
        } else {
          delete out.graph;
          out.stepCount = Number(t.stepCount) || 0;
          out.groupCount = Number(t.groupCount) || 0;
        }
        return out;
      }
      if (richnessOf(t) >= richnessOf(old)) {
        return {
          ...old,
          ...t,
          graph: t.graph?.nodes?.length ? t.graph : old.graph
        };
      }
      return {
        ...t,
        graph: old.graph,
        stepCount: old.stepCount ?? stepCountOf(old),
        groupCount: old.groupCount
      };
    });
  }

  /** Page world (DaSecureStore) is not visible from this isolated content-script world. */
  function writeTasksToPage(user, tasks) {
    try {
      window.postMessage({ source: "da-ext-bridge", type: "write-tasks", user, tasks }, "*");
    } catch { /* ignore */ }
  }

  async function readTasksDisk(user) {
    const raw = localStorage.getItem(tasksKey(user));
    if (!raw) return [];
    if (window.DaCrypto && DaCrypto.looksEncrypted(raw)) {
      try {
        const data = await DaCrypto.decryptJson(raw);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeTasksDisk(user, list) {
    localStorage.setItem("da_local_user", user);
    if (window.DaCrypto) {
      const enc = await DaCrypto.encryptJson(list);
      localStorage.setItem(tasksKey(user), enc);
    } else {
      localStorage.setItem(tasksKey(user), JSON.stringify(list));
    }
  }

  function mark(fingerprint) {
    try {
      const version = chrome.runtime.getManifest().version;
      document.documentElement.dataset.daRecorderExtension = "1";
      document.documentElement.dataset.daRecorderVersion = version;
      document.documentElement.dataset.daPlayerExtension = "1";
      document.documentElement.dataset.daPlayerVersion = version;
      document.documentElement.dataset.daSelectorExtension = "1";
      document.documentElement.dataset.daSelectorVersion = version;
      // The identity this bundle was built for: the panel compares it with its own server
      // fingerprint, so "connected" always means "THIS server's extension", never just "some
      // Morobot extension is installed". Legacy bundles (no binding) leave it unset.
      if (fingerprint) {
        document.documentElement.dataset.daExtensionFingerprint = String(fingerprint);
      }
      window.dispatchEvent(new CustomEvent("da-extension-ready", {
        detail: { version, role: "global" }
      }));
      window.dispatchEvent(new CustomEvent("da-recorder-ready", { detail: { version } }));
      window.dispatchEvent(new CustomEvent("da-player-ready", { detail: { version } }));
      window.dispatchEvent(new CustomEvent("da-selector-ready", { detail: { version } }));
    } catch {
      /* ignore */
    }
  }

  try {
    const origin = location.origin;
    const user = currentUser();
    const culture = (readCookie("da_culture") || localStorage.getItem("da_culture") || "fa").toLowerCase() === "en"
      ? "en"
      : "fa";
    /*
     * Base adoption is decided by the WORKER, not here.
     *
     * `portalBase` is one shared key, so every portal page load used to repoint the whole extension
     * at itself — opening the local portal while a recording ran against the remote one silently
     * moved the running session's requests to localhost (and the reverse). `confirmPortalOrigin`
     * now answers with the deployment verdict from the server fingerprint: a foreign portal is
     * refused (and gets `daExtensionForeign` so the panel can say "this extension belongs to
     * another server"), a matching one is adopted unless a session is in progress, and that
     * in-session rule lives with the decision, in the worker.
     */
    chrome.storage.local.set({ localUser: user, extensionRole: "global", uiCulture: culture }).catch(() => {});

    (async () => {
      let verdict = null;
      try {
        verdict = await chrome.runtime.sendMessage({ type: "confirmPortalOrigin", origin: origin });
      } catch { verdict = null; }
      if (verdict && verdict.foreign) {
        try { document.documentElement.dataset.daExtensionForeign = "1"; } catch { /* ignore */ }
        return;
      }
      // Not verifiable: legacy servers (no endpoint) still mark; a bound server that did not answer
      // is left unmarked rather than claimed — a claim that turns out wrong is worse than a warning.
      // Unmarked and unexplained, though, is the worst of the three: the panel then blames a missing
      // extension and sends the user to install what is already installed. So stamp WHY the probe
      // failed (offline server, or a certificate this machine does not trust) and let the panel say
      // it in those words.
      if (verdict && verdict.match === null && verdict.legacy !== true) {
        if (verdict.probeFailed) {
          try { document.documentElement.dataset.daExtensionUnreachable = "1"; } catch { /* ignore */ }
        }
        return;
      }
      mark(verdict?.bindingFingerprint || null);
      pushTenantBranding();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", pushTenantBranding);
      }
      pullFromExtension();
      pushPageTasksToExtension();
      chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
    })().catch(() => { /* a handshake failure must never break the portal page */ });
  } catch {
    /* ignore */
  }

  function syncCultureFromPortal() {
    try {
      const culture = (readCookie("da_culture") || localStorage.getItem("da_culture") || "fa").toLowerCase() === "en"
        ? "en"
        : "fa";
      chrome.storage.local.set({ uiCulture: culture });
    } catch { /* ignore */ }
  }
  document.addEventListener("da:locale", (ev) => {
    const c = ev?.detail?.culture;
    if (c) chrome.storage.local.set({ uiCulture: c === "en" ? "en" : "fa" });
    else syncCultureFromPortal();
  });
  window.addEventListener("storage", (ev) => {
    if (ev.key === "da_culture") syncCultureFromPortal();
  });
  setInterval(syncCultureFromPortal, 5000);

  async function applyTasks(user, tasks, opts) {
    const u = user || currentUser();
    const list = Array.isArray(tasks) ? tasks : [];
    try {
      const prev = await readTasksDisk(u);
      if (list.length === 0 && prev.length > 0) return;
      const toSave = opts?.authoritative
        ? list
        : mergePreferRicherPerId(prev, list);
      writeTasksToPage(u, toSave);
      return;
    } catch {
      /* ignore */
    }
    writeTasksToPage(u, list);
  }

  function pullFromExtension() {
    const user = currentUser();
    chrome.storage.local.set({ localUser: user });
    chrome.runtime.sendMessage({ type: "getLocalTasks" }).then((res) => {
      if (res?.ok && Array.isArray(res.tasks) && res.tasks.length) {
        applyTasks(user, res.tasks);
        return;
      }
      chrome.storage.local.get([`localTasks__${user}`, "localTasks"]).then((data) => {
        const full = data[`localTasks__${user}`];
        if (Array.isArray(full) && full.length) {
          applyTasks(user, full);
          return;
        }
        if (Array.isArray(data.localTasks) && data.localTasks.length) {
          applyTasks(user, data.localTasks);
        }
      });
    }).catch(() => {});
  }

  /** Player primarily reads portal localStorage into its own chrome.storage. */
  function pushPageTasksToExtension() {
    const user = currentUser();
    readTasksDisk(user).then((tasks) => {
      if (!Array.isArray(tasks) || !tasks.length) return;
      chrome.storage.local.set({ localUser: user, [`localTasks__${user}`]: tasks });
    }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "portalPing") {
      sendResponse({ ok: true, extension: true, role: ROLE, version: chrome.runtime.getManifest().version });
      return true;
    }
    if (message.type === "requestPortalTasks") {
      const user = currentUser();
      readTasksDisk(user).then((tasks) => {
        sendResponse({ ok: true, user, tasks: Array.isArray(tasks) ? tasks : [] });
      }).catch(() => sendResponse({ ok: false, tasks: [] }));
      return true;
    }
    if (message.type === "localTasksUpdated") {
      applyTasks(message.user || currentUser(), message.tasks || [], { authoritative: true })
        .then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "dsCellEvent") {
      try {
        window.dispatchEvent(new CustomEvent("da-ds-cell-event", { detail: message.event || {} }));
      } catch { /* ignore */ }
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  window.addEventListener("da-request-local-tasks", () => {
    pushPageTasksToExtension();
    pullFromExtension();
  });
  window.addEventListener("da-local-tasks", (ev) => {
    const d = ev.detail;
    if (d?.tasks) {
      chrome.storage.local.set({
        localUser: d.user || currentUser(),
        [`localTasks__${d.user || currentUser()}`]: d.tasks
      });
    }
  });

  function pushTenantBranding() {
    try {
      const b = window.__MOROBOT_BRANDING;
      if (!b || !b.appName) return;
      chrome.runtime.sendMessage({ type: "applyTenantBranding", payload: b }).catch(() => {});
    } catch { /* ignore */ }
  }

  // mark()/pull/push moved into the fingerprint handshake above: a foreign portal must not be
  // marked as connected, and this extension must not import its tasks.
  }
})();
