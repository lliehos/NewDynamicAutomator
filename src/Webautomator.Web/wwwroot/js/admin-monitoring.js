/**
 * Live refresh and the controls on the monitoring dashboard.
 *
 * The page renders a full reading server-side, so it is useful with JavaScript disabled and correct on
 * first paint. This keeps the "right now" counters moving and posts the three controls (stop a user's
 * runs, close a user's session, the stop-all switch). It deliberately does NOT redraw the history chart
 * or the tables: those are a range view, and bars shifting under the pointer every few seconds would
 * make the page unreadable — an action therefore reloads the page, which re-reads everything it changed.
 */
(function () {
  "use strict";

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
      set("windowTotal", bytes(d.windowBytesIn + d.windowBytesOut));
      set("liveSessions", d.liveSessions);
      set("onlineUsers", d.onlineUsers);
      set("distinctIps", d.distinctIpCount);
      set("dbPing", (Math.round(d.databasePingMs * 10) / 10) + " ms");
      var captured = new Date(d.capturedAtUtc + "Z");
      set("capturedAt", captured.toISOString().replace("T", " ").slice(0, 19) + " UTC");
    }).catch(function () {
      // A failed poll is not worth an alert; the page keeps the last good numbers and the next tick
      // tries again. A dashboard that pops an error every 15s during a restart is worse than a briefly
      // stale one.
    });
  }

  // ---- Controls ------------------------------------------------------------------------------

  function token() {
    var el = document.querySelector("#mon-anti-forgery input[name='__RequestVerificationToken']");
    return el ? el.value : "";
  }

  function post(action, data) {
    var body = new URLSearchParams();
    body.set("__RequestVerificationToken", token());
    Object.keys(data || {}).forEach(function (k) { body.set(k, data[k]); });
    return fetch("/Admin/Monitoring/" + action, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });
  }

  /** Report a refusal where the operator is already looking, rather than in a dialog that hides the page. */
  function showError(message) {
    var box = document.getElementById("mon-action-error");
    if (!box) {
      box = document.createElement("p");
      box.id = "mon-action-error";
      box.className = "alert alert-danger";
      var intro = document.querySelector(".admin-dash-intro");
      if (intro && intro.parentNode) intro.parentNode.insertBefore(box, intro.nextSibling);
      else document.body.insertBefore(box, document.body.firstChild);
    }
    box.textContent = message;
  }

  function clearError() {
    var box = document.getElementById("mon-action-error");
    if (box) box.remove();
  }

  function runControl(control, action, payload) {
    clearError();
    control.disabled = true;
    post(action, payload).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function () {
      // Everything on the page is derived from what just changed: the run count, the online counts and
      // the tables. Re-reading the page is both the honest and the cheapest way to show that.
      window.location.reload();
    }).catch(function (err) {
      control.disabled = false;
      showError(err && err.message ? err.message : "failed");
    });
  }

  document.addEventListener("click", function (e) {
    var stop = e.target.closest ? e.target.closest("[data-stop-runs]") : null;
    if (stop) {
      if (!window.confirm(stop.getAttribute("data-confirm") || "")) return;
      runControl(stop, "StopUserRuns", { userId: stop.getAttribute("data-stop-runs") });
      return;
    }

    var close = e.target.closest ? e.target.closest("[data-close-session]") : null;
    if (close) {
      if (!window.confirm(close.getAttribute("data-confirm") || "")) return;
      runControl(close, "CloseUserSession", { userId: close.getAttribute("data-close-session") });
    }
  });

  var stopAll = document.querySelector("[data-stop-all]");
  if (stopAll) {
    stopAll.addEventListener("change", function () {
      var on = stopAll.checked;
      // Confirmed only when switching ON, because that is the direction that stops other people's work.
      if (on && !window.confirm(stopAll.getAttribute("data-confirm") || "")) {
        stopAll.checked = false;
        return;
      }
      runControl(stopAll, "SetStopAll", { on: on ? "true" : "false" });
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