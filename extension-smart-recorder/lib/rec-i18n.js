/**
 * Smart Recorder — shared extension UI strings (fa/en).
 *
 * Culture is synced from the portal: the web app writes the tenant/admin language into
 * `chrome.storage.local.uiCulture` (the same key `extension-global/lib/ext-i18n.js` uses),
 * so both extensions speak the language the user actually selected in the product.
 *
 * Deliberately self-contained (no import) because the recorder's manifest does not yet
 * bundle the global extension's lib folder.
 */
(function (global) {
  const STRINGS = {
    fa: {
      // popup
      "app.title": "ضبط هوشمند",
      "popup.idle": "ضبط هوشمند v{ver} · بی‌کار",
      "popup.thinking": "در حال فکر کردن · جلسه {sid} · فرآیند #{id}",
      "popup.learningComplete": "یادگیری کامل شد · آماده ذخیره",
      "popup.refresh": "تازه‌سازی",
      "popup.stop": "توقف فکر کردن",
      "popup.hint": "از لیست فرآیندها شروع کنید. لوگوی روی صفحه، فکر کردن را متوقف می‌کند. لاگی ثبت نمی‌شود.",
      // in-page FAB
      "fab.stopThinking": "توقف فکر کردن",
      "fab.learningComplete": "یادگیری کامل شد",
      "fab.save": "ذخیره",
      "fab.markAlt": "مروبات",
      "fab.dragHint": "برای جابجایی بکشید",
      // portal status messages
      "portal.notInstalled": "افزونهٔ Smart Recorder نصب نیست.",
      "portal.noTask": "فرآیند هدف مشخص نیست.",
      "portal.started": "هوشمندسازی فرآیند #{id} شروع شد — لوگو = توقف فکر کردن.",
      "portal.serverDown": "سرور در دسترس نیست (404).",
      "portal.startError": "خطا در شروع Smart Recorder"
    },
    en: {
      "app.title": "Smart Recorder",
      "popup.idle": "Smart Recorder v{ver} · idle",
      "popup.thinking": "Thinking · session {sid} · process #{id}",
      "popup.learningComplete": "Learning complete · ready to save",
      "popup.refresh": "Refresh",
      "popup.stop": "Stop thinking",
      "popup.hint": "Start from the process list. The mark on the page stops thinking. No logs.",
      "fab.stopThinking": "Stop thinking",
      "fab.learningComplete": "Learning complete",
      "fab.save": "Save",
      "fab.markAlt": "Morobot",
      "fab.dragHint": "Drag to move",
      "portal.notInstalled": "The Smart Recorder extension is not installed.",
      "portal.noTask": "The target process is not specified.",
      "portal.started": "Smart processing of process #{id} started — the mark stops thinking.",
      "portal.serverDown": "Server is not reachable (404).",
      "portal.startError": "Could not start Smart Recorder"
    }
  };

  let culture = "fa";
  const listeners = new Set();

  function normalize(v) {
    const s = String(v || "").trim().toLowerCase();
    if (s.startsWith("en")) return "en";
    return "fa";
  }

  function t(key, vars) {
    const pack = STRINGS[culture] || STRINGS.fa;
    let text = pack[key] ?? STRINGS.fa[key] ?? key;
    if (vars && typeof vars === "object") {
      Object.keys(vars).forEach((k) => {
        text = text.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k] == null ? "" : String(vars[k]));
      });
    }
    return text;
  }

  function dir() {
    return culture === "en" ? "ltr" : "rtl";
  }

  function getCulture() {
    return culture;
  }

  function setCulture(next) {
    const n = normalize(next);
    if (n === culture) return;
    culture = n;
    listeners.forEach((fn) => {
      try { fn(culture); } catch { /* ignore */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Apply direction/language and translate every [data-i18n] node inside `root`.
  function applyDom(root) {
    const host = root || document;
    host.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      el.textContent = t(key);
    });
    host.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;
      const val = t(key);
      el.setAttribute("title", val);
      el.setAttribute("aria-label", val);
    });
    const html = document.documentElement;
    if (html) {
      html.setAttribute("dir", dir());
      html.setAttribute("lang", culture);
    }
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get(["uiCulture"]);
      culture = normalize(data.uiCulture);
    } catch {
      culture = "fa";
    }
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.uiCulture) return;
        setCulture(changes.uiCulture.newValue);
      });
    } catch { /* ignore */ }
    return culture;
  }

  global.DaRecI18n = { t, init, getCulture, setCulture, dir, applyDom, onChange, normalize };
})(typeof globalThis !== "undefined" ? globalThis : window);
