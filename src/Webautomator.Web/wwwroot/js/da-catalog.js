/**
 * Live catalog SignalR — process/source list pages + optional admin overview.
 */
(function () {
  let conn = null;
  const listeners = { taskChanged: [], sourceChanged: [], playState: [], updateAvailable: [] };

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach((fn) => {
      try { fn(payload); } catch (e) { console.warn("[catalog]", e); }
    });
  }

  /**
   * @param {{ admin?: boolean }} [opts]
   */
  async function ensure(opts) {
    if (typeof signalR === "undefined") return null;
    if (conn) {
      if (opts?.admin) {
        try { await conn.invoke("JoinAdminCatalog"); } catch { /* ignore */ }
      }
      return conn;
    }
    try {
      const c = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/catalog")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      c.on("taskChanged", (p) => emit("taskChanged", p));
      c.on("sourceChanged", (p) => emit("sourceChanged", p));
      c.on("playState", (p) => emit("playState", p));
      // Pushed by UpdateNotifyBackgroundService when a newer version appears.
      c.on("updateAvailable", (p) => emit("updateAvailable", p));
      c.onreconnected(async () => {
        try { await c.invoke("JoinCatalog"); } catch { /* ignore */ }
        if (opts?.admin) {
          try { await c.invoke("JoinAdminCatalog"); } catch { /* ignore */ }
        }
      });
      await c.start();
      await c.invoke("JoinCatalog");
      if (opts?.admin) {
        try { await c.invoke("JoinAdminCatalog"); } catch { /* ignore */ }
      }
      conn = c;
      return c;
    } catch (e) {
      console.warn("catalog hub failed", e);
      return null;
    }
  }

  window.DaCatalog = { ensure, on };
  document.addEventListener("DOMContentLoaded", () => {
    const admin = document.body?.dataset?.adminCatalog === "1"
      || document.documentElement?.dataset?.adminCatalog === "1";
    ensure({ admin });
  });
})();
