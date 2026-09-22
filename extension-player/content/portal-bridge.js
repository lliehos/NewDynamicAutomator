/** Portal handshake + local task sync — Player role. */
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
    const fromGraph = t?.graph?.nodes?.filter((n) => isActionNode(n)).length;
    return fromGraph || t?.stepCount || 0;
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

  mark();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mark);
  }

  try {
    const origin = location.origin;
    const user = currentUser();
    chrome.storage.local.set({ portalBase: origin, apiBase: origin, localUser: user, extensionRole: ROLE });
    chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
  } catch {
    /* ignore */
  }

  function applyTasks(user, tasks) {
    const u = user || currentUser();
    const list = Array.isArray(tasks) ? tasks : [];
    try {
      const prev = JSON.parse(localStorage.getItem(tasksKey(u)) || "[]");
      if (list.length === 0 && prev.length > 0) return;
      const prevSteps = prev.reduce((s, t) => s + stepCountOf(t), 0);
      const nextSteps = list.reduce((s, t) => s + stepCountOf(t), 0);
      if (list.length && nextSteps === 0 && prevSteps > 0) {
        const byId = new Map(prev.map((t) => [String(t.id), t]));
        for (const t of list) {
          const old = byId.get(String(t.id));
          if (old?.graph?.nodes?.length) {
            byId.set(String(t.id), { ...t, graph: old.graph, stepCount: stepCountOf(old) });
          } else {
            byId.set(String(t.id), t);
          }
        }
        const merged = [...byId.values()];
        localStorage.setItem("da_local_user", u);
        localStorage.setItem(tasksKey(u), JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: u, tasks: merged } }));
        return;
      }
      localStorage.setItem("da_local_user", u);
      localStorage.setItem(tasksKey(u), JSON.stringify(list));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: u, tasks: list } }));
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
    try {
      const user = currentUser();
      const tasks = JSON.parse(localStorage.getItem(tasksKey(user)) || "[]");
      if (!Array.isArray(tasks) || !tasks.length) return;
      chrome.storage.local.set({ localUser: user, [`localTasks__${user}`]: tasks });
    } catch {
      /* ignore */
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "portalPing") {
      sendResponse({ ok: true, extension: true, role: ROLE, version: chrome.runtime.getManifest().version });
      return true;
    }
    if (message.type === "localTasksUpdated") {
      applyTasks(message.user || currentUser(), message.tasks || []);
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
    if (d && Array.isArray(d.tasks)) pushPageTasksToExtension();
  });

  pushPageTasksToExtension();
  pullFromExtension();
  setTimeout(pushPageTasksToExtension, 400);
  setTimeout(pullFromExtension, 500);
  setTimeout(pushPageTasksToExtension, 1200);
})();
