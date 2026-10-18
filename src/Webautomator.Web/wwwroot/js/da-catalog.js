/**
 * Live catalog SignalR — process/source list pages + optional admin overview.
 */
(function () {
  let conn = null;
  const listeners = {
    taskChanged: [], sourceChanged: [], playState: [], updateAvailable: [], serverRunStateChanged: []
  };

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
      // The admin's server-run master switch (deployment-wide). Panels use it to force every row
      // to local, and to explain why an attempted server switch cannot be turned on.
      c.on("serverRunStateChanged", (p) => emit("serverRunStateChanged", p));
      // Pushed by UpdateNotifyBackgroundService when a newer version appears.
      c.on("updateAvailable", (p) => emit("updateAvailable", p));
      // Sent to this user's own group when an administrator closes their session from Admin →
      // Monitoring. The token is already dead server-side, so the page goes back to the sign-in form
      // now rather than looking signed in until the next click fails.
      c.on("sessionEnded", () => { window.location.reload(); });
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
