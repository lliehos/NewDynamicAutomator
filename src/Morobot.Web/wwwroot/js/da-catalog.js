/**
 * Live catalog SignalR — process/source list pages.
 */
(function () {
  let conn = null;
  const listeners = { taskChanged: [], sourceChanged: [] };

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach((fn) => {
      try { fn(payload); } catch (e) { console.warn("[catalog]", e); }
    });
  }

  async function ensure() {
    if (typeof signalR === "undefined") return null;
    if (conn) return conn;
    try {
      const c = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/catalog")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      c.on("taskChanged", (p) => emit("taskChanged", p));
      c.on("sourceChanged", (p) => emit("sourceChanged", p));
      c.onreconnected(async () => {
        try { await c.invoke("JoinCatalog"); } catch { /* ignore */ }
      });
      await c.start();
      await c.invoke("JoinCatalog");
      conn = c;
      return c;
    } catch (e) {
      console.warn("catalog hub failed", e);
      return null;
    }
  }

  window.DaCatalog = { ensure, on };
  document.addEventListener("DOMContentLoaded", () => { ensure(); });
})();
