/*
 * admin-update-notify.js — react to the pushed `updateAvailable` event.
 *
 * The background service decides *when* a new version exists; this module owns
 * *what the admin sees and does about it*. It:
 *   - shows a non-blocking toast naming the new version
 *   - offers to open the download / go to the License page where the update is
 *     applied, rather than downloading silently (applying an update is a
 *     deliberate admin action)
 *   - de-duplicates per version per browser session, so a page reload does not
 *     re-nag about a version the admin already dismissed
 *
 * Strings come from `window.AdminI18n.strings.update` (set in the layout) with
 * English fallbacks so the module never renders a raw key.
 */
(function () {
  "use strict";

  var SEEN_KEY = "da_update_seen_version";

  function s(key) {
    var pack = (window.AdminI18n && window.AdminI18n.strings && window.AdminI18n.strings.update) || {};
    return pack[key] || FALLBACK[key] || key;
  }

  var FALLBACK = {
    available: "A new version is available: {version} (current {current}).",
    notes: "Release notes",
    open: "Open download",
    later: "Later",
    title: "Update available"
  };

  function fmt(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) {
      return vars && vars[k] != null ? String(vars[k]) : "";
    });
  }

  function alreadySeen(version) {
    try {
      return sessionStorage.getItem(SEEN_KEY) === String(version);
    } catch (e) {
      return false;
    }
  }

  function markSeen(version) {
    try { sessionStorage.setItem(SEEN_KEY, String(version)); } catch (e) { /* ignore */ }
  }

  /** Informational toast; the actionable part lives in the banner below. */
  function toast(message) {
    if (typeof window.daNotify === "function") {
      window.daNotify(message, "info");
      return;
    }
    if (window.DaNotify && typeof DaNotify.toast === "function") {
      DaNotify.toast(message, "info");
    }
  }

  /** Persistent bar so the admin can act whenever they get to it. */
  function showBanner(payload) {
    if (document.getElementById("da-update-banner")) return;
    var version = payload.version || payload.Version || "";
    var current = payload.currentVersion || payload.CurrentVersion || "";
    var notes = payload.notes || payload.Notes || "";
    var url = payload.downloadUrl || payload.DownloadUrl || "";

    var bar = document.createElement("div");
    bar.id = "da-update-banner";
    bar.className = "da-update-banner";
    bar.setAttribute("role", "status");

    var text = document.createElement("div");
    text.className = "da-update-banner-text";
    var strong = document.createElement("strong");
    strong.textContent = s("title") + " — ";
    text.appendChild(strong);
    text.appendChild(document.createTextNode(fmt(s("available"), { version: version, current: current })));
    if (notes) {
      var note = document.createElement("div");
      note.className = "da-update-banner-notes";
      note.textContent = s("notes") + ": " + notes;
      text.appendChild(note);
    }
    bar.appendChild(text);

    var actions = document.createElement("div");
    actions.className = "da-update-banner-actions";

    if (url) {
      var open = document.createElement("a");
      open.className = "btn-admin";
      open.href = url;
      // External artefact — never leak the referrer, and open in a new tab so the
      // admin keeps their place in the panel.
      open.rel = "noopener noreferrer";
      open.target = "_blank";
      open.textContent = s("open");
      actions.appendChild(open);
    }

    var later = document.createElement("button");
    later.type = "button";
    later.className = "btn-admin secondary";
    later.textContent = s("later");
    later.addEventListener("click", function () { bar.remove(); });
    actions.appendChild(later);

    bar.appendChild(actions);
    // Placed at the top of the admin shell so it is visible on every admin page.
    var host = document.querySelector(".admin-shell") || document.body;
    host.insertBefore(bar, host.firstChild);
  }

  function handle(payload) {
    if (!payload) return;
    var version = payload.version || payload.Version || "";
    if (!version) return;
    // Announce once per version per browser session, but keep the banner so the
    // admin can still act after dismissing the toast.
    if (!alreadySeen(version)) {
      markSeen(version);
      toast(fmt(s("available"), {
        version: version,
        current: payload.currentVersion || payload.CurrentVersion || ""
      }));
    }
    showBanner(payload);
  }

  function init() {
    if (!window.DaCatalog || typeof DaCatalog.on !== "function") return;
    DaCatalog.on("updateAvailable", handle);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
