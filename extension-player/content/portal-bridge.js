/** Portal handshake + encrypted local task sync — Player role. */
(function () {
  const ROLE = "player";

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

  function stepCountOf(t) {
    const fromGraph = t?.graph?.nodes?.filter((n) => isActionNode(n)).length || 0;
    return Math.max(fromGraph, Number(t?.stepCount) || 0);
  }

  function richnessOf(t) {
    const nodes = Array.isArray(t?.graph?.nodes) ? t.graph.nodes.length : 0;
    return nodes * 1000 + stepCountOf(t);
  }

  /** When a stale extension copy is poorer, keep the richer graph per task id. */
  function mergePreferRicherPerId(prev, incoming) {
    const prevById = new Map((prev || []).map((t) => [String(t.id), t]));
    return (incoming || []).map((t) => {
      const old = prevById.get(String(t.id));
      if (!old) return t;
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

  function mark() {
    try {
      const version = chrome.runtime.getManifest().version;
      document.documentElement.dataset.daPlayerExtension = "1";
      document.documentElement.dataset.daPlayerVersion = version;
      window.dispatchEvent(new CustomEvent("da-extension-ready", {
        detail: { version, role: ROLE }
      }));
      window.dispatchEvent(new CustomEvent("da-player-ready", {
        detail: { version }
      }));
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
    chrome.storage.local.set({
      portalBase: origin,
      apiBase: origin,
      localUser: user,
      extensionRole: ROLE,
      uiCulture: culture
    });
    chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
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

  async function applyTasks(user, tasks) {
    const u = user || currentUser();
    const list = Array.isArray(tasks) ? tasks : [];
    try {
      const prev = await readTasksDisk(u);
      if (list.length === 0 && prev.length > 0) return;
      const prevRich = prev.reduce((s, t) => s + richnessOf(t), 0);
      const nextRich = list.reduce((s, t) => s + richnessOf(t), 0);
      // Never let a stale chrome.storage copy wipe a richer portal graph after Recorder save.
      const toSave = (list.length && nextRich < prevRich)
        ? mergePreferRicherPerId(prev, list)
        : list;
      // Always notify the PAGE world — DaSecureStore is not in this isolated world.
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
    if (message.type === "localTasksUpdated") {
      applyTasks(message.user || currentUser(), message.tasks || []).then(() => sendResponse({ ok: true }));
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

  mark();
  pullFromExtension();
  pushPageTasksToExtension();
})();
