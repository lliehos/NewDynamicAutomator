/**
 * Live refresh and the controls on the monitoring dashboard.
 *
 * The page renders a full reading server-side so it is useful with JavaScript disabled and correct
 * on first paint. This keeps the headline numbers live afterwards: they are re-read from the poll
 * and only touched when the page actually has a slot for them.
 *
 * The history chart is live as well. It is a view of a time range, which is why it is redrawn from
 * the polled buckets rather than re-fetched as a page: the bucket count and the axis are fixed by
 * the server, so the columns move in place without the layout shifting under the pointer. An
 * unchanged series is not redrawn at all.
 */
(function () {
  "use strict";

  var REFRESH_MS = 15000;
  // Echoed from the page so a poll reads the same window the user picked.
  var hours = Number(document.body.getAttribute("data-mon-hours") || 24) || 24;
  // Last history payload rendered, so an unchanged poll never rebuilds the DOM under the pointer.
  var lastHistoryJson = "";

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

  /** "MM-dd HH:mm" in UTC — the exact shape the server used in chart tooltips. */
  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return two(d.getUTCMonth() + 1) + "-" + two(d.getUTCDate())
      + " " + two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
  }

  function pct(v, max) {
    if (!(max > 0)) return "0";
    var clamped = Math.min(100, Math.max(0, (100 * v) / max));
    return (Math.round(clamped * 10) / 10).toString();
  }

  /** Same rounded ceiling the server uses (1, 2 or 5 × 10^n), so the redraw cannot re-scale the bars. */
  function niceMax(value) {
    if (!(value > 0)) return 1;
    var magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    var norm = value / magnitude;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return Math.max(1, step * magnitude);
  }

  function column(title, inHeight, outHeight) {
    // A zero bucket draws nothing: the old 1px floor made an idle hour look like a row of bars.
    return '<div class="admin-mon-chart-col" title="' + title + '">'
      + (Number(inHeight) > 0 ? '<span class="admin-mon-chart-in" style="height:' + inHeight + '%"></span>' : "")
      + (Number(outHeight) > 0 ? '<span class="admin-mon-chart-out" style="height:' + outHeight + '%"></span>' : "")
      + "</div>";
  }

  /**
   * Redraw the history chart from a poll's history array.
   *
   * The maxima are computed over the returned window exactly like the server does, so the bars
   * keep their proportions when the window slides. The payload is compared first: an unchanged
   * series never rebuilds the DOM, which is what keeps a chart that the operator is reading from
   * twitching under the pointer when nothing has actually happened.
   *
   * The "no samples yet" note and the chart are both in the markup and this toggles between them,
   * so a page opened before the first sample starts drawing as soon as one arrives, without a
   * reload.
   */
  function renderHistory(history) {
    var rows = Array.isArray(history) ? history : [];
    var json = JSON.stringify(rows);
    if (json === lastHistoryJson) return;
    lastHistoryJson = json;

    var netChart = document.querySelector("[data-mon-chart='net']");
    if (!netChart) return;
    var empty = document.querySelector("[data-mon-history-empty]");
    var legend = document.querySelector("[data-mon-history-legend]");

    if (!rows.length) {
      netChart.hidden = true;
      if (legend) legend.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    netChart.hidden = false;
    if (legend) legend.hidden = false;
    if (empty) empty.hidden = true;

    var maxNet = 1;
    rows.forEach(function (p) {
      var net = (Number(p.bytesIn) || 0) + (Number(p.bytesOut) || 0);
      if (net > maxNet) maxNet = net;
    });
    // Round the ceiling the same way the server does, then print it: without a stated scale a bar's
    // height is a shape, not a number.
    maxNet = niceMax(maxNet);
    var maxEl = document.querySelector("[data-mon='chartMax']");
    if (maxEl) maxEl.textContent = bytes(maxNet);

    var netHtml = "";
    rows.forEach(function (p) {
      var t = stamp(p.atUtc);
      var bytesIn = Number(p.bytesIn) || 0;
      var bytesOut = Number(p.bytesOut) || 0;
      netHtml += column(t + " — ↓" + bytes(bytesIn) + " ↑" + bytes(bytesOut),
        pct(bytesIn, maxNet), pct(bytesOut, maxNet));
    });
    netChart.innerHTML = netHtml;
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
      renderHistory(d.history);
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

  // ---- The server-run master switch ----
  // Same setting as Admin → Settings, on the page where live sessions are being watched. Turning it
  // OFF is destructive — it stops every live server run — so it is confirmed first, and the
  // confirmation names that consequence rather than asking a generic "are you sure?".
  (function bindServerRunSwitch() {
    var input = document.getElementById("da-serverrun-toggle");
    if (!input) return;
    var section = document.getElementById("da-mon-serverrun");
    var label = input.closest("label");

    function paint(on) {
      input.checked = on;
      input.setAttribute("data-state", on ? "1" : "0");
      if (section) {
        section.classList.toggle("is-on", on);
        section.classList.toggle("is-off", !on);
      }
    }

    function toggle(ev) {
      if (ev) ev.preventDefault();
      var next = !(input.getAttribute("data-state") === "1");
      if (!next) {
        var msg = "با خاموش‌کردن اجرای سروری، همهٔ فرآیندهای زندهٔ روی سرور فوراً متوقف می‌شوند و از این پس تنها اجرای محلی ممکن است. ادامه می‌دهید؟";
        var ask = window.DaNotify
          ? window.DaNotify.confirm(msg, { title: "غیرفعال‌کردن اجرای سروری", okText: "بله، خاموش کن", cancelText: "انصراف", danger: true })
          : Promise.resolve(window.confirm(msg));
        ask.then(function (ok) { if (ok) send(next); });
        return;
      }
      send(next);
    }

    function send(next) {
      input.disabled = true;
      fetch("/api/play-mode", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ serverRunEnabled: next })
      }).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, body: d }; });
      }).then(function (res) {
        if (!res.ok) throw new Error(res.body && res.body.message ? res.body.message : "HTTP");
        paint(res.body.serverRunEnabled !== false);
        var stopped = Array.isArray(res.body.stopped) ? res.body.stopped.length : 0;
        var text = (next ? "اجرای روی سرور روشن شد." : "اجرای روی سرور خاموش شد.") +
          (!next && stopped ? " " + stopped + " اجرای زنده متوقف شد." : "");
        if (window.daNotify) window.daNotify(text, next ? "success" : "warn");
        tick();
      }).catch(function () {
        if (window.daNotify) window.daNotify("تغییر سویچ اجرای سروری انجام نشد.", "error");
      }).finally(function () { input.disabled = false; });
    }

    // The switch track is a label, so a click anywhere on it flips it — but only our handler may
    // decide the outcome (the confirmation can cancel), so the native checkbox change is consumed.
    label?.addEventListener("click", toggle);
    input.addEventListener("click", function (ev) { ev.preventDefault(); });
    input.addEventListener("change", function (ev) { ev.preventDefault(); });
  })();

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