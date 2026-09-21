/** Portal handshake + per-user local task sync. */
(function () {
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

  function mark() {
    try {
      const version = chrome.runtime.getManifest().version;
      document.documentElement.dataset.daExtension = "1";
      document.documentElement.dataset.daExtensionVersion = version;
      window.dispatchEvent(new CustomEvent("da-extension-ready", {
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
    chrome.storage.local.set({ portalBase: origin, apiBase: origin, localUser: user });
    chrome.runtime.sendMessage({ type: "syncPortalSession" }).catch(() => {});
  } catch {
    /* ignore */
  }

  function applyTasks(user, tasks) {
    const u = user || currentUser();
    try {
      localStorage.setItem("da_local_user", u);
      localStorage.setItem(tasksKey(u), JSON.stringify(tasks || []));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: u, tasks: tasks || [] } }));
  }

  function pullFromExtension() {
    const user = currentUser();
    chrome.storage.local.set({ localUser: user });
    chrome.runtime.sendMessage({ type: "getLocalTasks" }).then(() => {
      chrome.storage.local.get(`localTasks__${user}`).then((data) => {
        const full = data[`localTasks__${user}`];
        if (Array.isArray(full)) applyTasks(user, full);
      });
    }).catch(() => {});
  }

  function pushPageTasksToExtension() {
    try {
      const user = currentUser();
      const tasks = JSON.parse(localStorage.getItem(tasksKey(user)) || "[]");
      chrome.storage.local.remove("localTasks");
      chrome.storage.local.set({ localUser: user, [`localTasks__${user}`]: tasks });
    } catch {
      /* ignore */
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "portalPing") {
      sendResponse({ ok: true, extension: true, version: chrome.runtime.getManifest().version });
      return true;
    }
    if (message.type === "localTasksUpdated") {
      applyTasks(message.user || currentUser(), message.tasks || []);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  window.addEventListener("da-request-local-tasks", pullFromExtension);
  window.addEventListener("da-local-tasks", pushPageTasksToExtension);

  pullFromExtension();
  setTimeout(pullFromExtension, 800);
})();
