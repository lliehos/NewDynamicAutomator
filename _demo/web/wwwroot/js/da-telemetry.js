(function () {
  const queue = [];
  let flushing = false;

  function tLevel(level) {
    const s = String(level || "Info");
    if (/error/i.test(s)) return "Error";
    if (/warn/i.test(s)) return "Warn";
    if (/audit/i.test(s)) return "Audit";
    return "Info";
  }

  function push(evt) {
    queue.push({
      level: tLevel(evt.level),
      category: evt.category || "Client",
      eventType: evt.eventType || "ClientEvent",
      message: String(evt.message || "").slice(0, 2000),
      detailsJson: evt.detailsJson || (evt.details ? JSON.stringify(evt.details) : null),
      path: evt.path || (location.pathname + location.search),
      device: window.DaDevice ? DaDevice.collect() : null
    });
    if (queue.length > 40) queue.shift();
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushing) return;
    flushing = true;
    setTimeout(flush, 400);
  }

  async function flush() {
    flushing = false;
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    for (const item of batch) {
      try {
        const authed = document.cookie.includes("da_access") || document.cookie.includes("da_local_user=");
        const url = authed ? "/api/events" : "/api/events/public";
        await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item)
        });
      } catch { /* ignore */ }
    }
  }

  window.DaTelemetry = {
    log: push,
    error: (message, details) => push({ level: "Error", category: "Client", eventType: "ClientError", message, details }),
    warn: (message, details) => push({ level: "Warn", category: "Client", eventType: "ClientWarn", message, details }),
    audit: (eventType, message, details) => push({ level: "Audit", category: "Client", eventType, message, details }),
    info: (eventType, message, details) => push({ level: "Info", category: "Client", eventType, message, details })
  };

  window.addEventListener("error", (ev) => {
    push({
      level: "Error",
      category: "Client",
      eventType: "WindowError",
      message: ev.message || "window.error",
      details: { file: ev.filename, line: ev.lineno, col: ev.colno }
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    push({
      level: "Error",
      category: "Client",
      eventType: "UnhandledRejection",
      message: String(ev.reason?.message || ev.reason || "rejection")
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
})();
