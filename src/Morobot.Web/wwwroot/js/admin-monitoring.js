/**
 * Live refresh for the monitoring dashboard.
 *
 * The page renders a full reading server-side so it is useful with JavaScript disabled and correct
 * on first paint. This only keeps the headline numbers moving afterwards. It deliberately does NOT
 * redraw the history chart or the breakdown tables: those are a range view, and having their bars
 * shift under the pointer every few seconds would make the page unreadable. Only the counters whose
 * value is "right now" are updated.
 */
(function () {
  "use strict";

  var anchor = document.querySelector("[data-mon='capturedAt']");
  if (!anchor) return;

  var REFRESH_MS = 15000;
  // Echoed from the page so a poll reads the same window the user picked.
  var hours = Number(document.body.getAttribute("data-mon-hours") || 24) || 24;

  function bytes(value) {
    if (!value || value <= 0) return "—";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var v = value, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return (Math.round(v * 10) / 10) + " " + units[u];
  }

  function rate(perSec) {
    return !perSec || perSec <= 0 ? "0 B/s" : bytes(perSec) + "/s";
  }

  function uptime(seconds) {
    if (!seconds || seconds <= 0) return "—";
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (d >= 1) return d + " روز " + h + " ساعت";
    if (h >= 1) return h + " ساعت " + m + " دقیقه";
    return m + " دقیقه";
  }

  function set(name, text) {
    var el = document.querySelector("[data-mon='" + name + "']");
    if (el) el.textContent = text;
  }

  function tick() {
    fetch("/Admin/Monitoring/Snapshot?hours=" + hours, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      set("netIn", rate(d.networkInPerSec));
      set("netOut", rate(d.networkOutPerSec));
      set("netTotal", bytes(d.networkReceivedBytes + d.networkSentBytes));
      set("diskRead", rate(d.diskReadPerSec));
      set("diskWrite", rate(d.diskWritePerSec));
      set("diskTotal", bytes(d.diskReadBytes + d.diskWriteBytes));
      set("liveSessions", d.liveSessions);
      set("onlineUsers", d.onlineUsers);
      set("distinctIps", d.distinctIpCount);
      set("plays24h", d.plays24h);
      set("dbPing", (Math.round(d.databasePingMs * 10) / 10) + " ms");
      set("workingSet", bytes(d.processWorkingSetBytes));
      set("privateBytes", bytes(d.processPrivateBytes));
      set("managedHeap", bytes(d.managedHeapBytes));
      set("gen2", d.gen2Collections);
      set("threads", d.threadCount);
      set("cpus", d.logicalProcessors);
      set("cpuSeconds", Math.round(d.processorSeconds));
      set("uptime", uptime(d.processUptimeSeconds));
      if (d.availablePhysicalBytes > 0) set("availMem", bytes(d.availablePhysicalBytes));
      var captured = new Date(d.capturedAtUtc + "Z");
      set("capturedAt", captured.toISOString().replace("T", " ").slice(0, 19) + " UTC");
    }).catch(function () {
      // A failed poll is not worth an alert; the page keeps the last good numbers and the next tick
      // tries again. A dashboard that pops an error every 15s during a restart is worse than a
      // briefly stale one.
    });
  }

  var timer = setInterval(tick, REFRESH_MS);

  // Stop polling when the tab is hidden so a dashboard left open overnight does not keep asking.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearInterval(timer);
      timer = null;
    } else if (!timer) {
      tick();
      timer = setInterval(tick, REFRESH_MS);
    }
  });
})();
