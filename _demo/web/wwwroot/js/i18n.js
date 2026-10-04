/**
 * Morobot client i18n — loads /locales/{fa|en}.json, applies data-i18n, stores preference.
 */
(function (global) {
  const COOKIE = "da_culture";
  const LS_KEY = "da_culture";
  const DEFAULT = "fa";

  let dict = {};
  let culture = DEFAULT;

  /** Product name from Admin → Branding (injected by _BrandHead). Falls back to the locale text. */
  function brandName() {
    const b = global.__MOROBOT_BRANDING;
    const n = b && (b.appName || b.AppName);
    return typeof n === "string" && n.trim() ? n.trim() : "";
  }

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function writeCookie(name, value) {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
  }

  function normalize(c) {
    c = String(c || "").toLowerCase();
    return c === "en" || c === "fa" ? c : DEFAULT;
  }

  function detect() {
    const fromHtml = document.documentElement.getAttribute("data-culture");
    if (fromHtml) return normalize(fromHtml);
    const fromCookie = readCookie(COOKIE);
    if (fromCookie) return normalize(fromCookie);
    try {
      const fromLs = localStorage.getItem(LS_KEY);
      if (fromLs) return normalize(fromLs);
    } catch { /* ignore */ }
    return DEFAULT;
  }

  function flatten(node, prefix, out) {
    if (node == null) return;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      out[prefix] = String(node);
      return;
    }
    if (typeof node !== "object") return;
    Object.keys(node).forEach((k) => {
      const next = prefix ? `${prefix}.${k}` : k;
      flatten(node[k], next, out);
    });
  }

  /** Keys whose whole value IS the product name — replaced outright, not token-substituted. */
  const BRAND_NAME_KEYS = new Set([
    "brand.name", "common.name", "common.appName", "common.dashBrand",
    "landing.title", "landing.ctaBandTitle", "landing.backSite", "landing.featuresImgAlt",
    "admin.brand", "editor.appName"
  ]);

  function t(key, vars) {
    let text = dict[key];
    if (text == null || text === "") text = key;
    if (vars && typeof vars === "object") {
      Object.keys(vars).forEach((k) => {
        text = text.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k] == null ? "" : String(vars[k]));
      });
    }
    if (text.indexOf("{year}") >= 0) text = text.replace(/\{year\}/g, String(new Date().getFullYear()));
    // Never surface the stock name from the locale file — prefer the tenant's branding.
    // {brand} is always expanded; brand-name keys are replaced outright.
    const brand = brandName();
    if (brand) {
      if (BRAND_NAME_KEYS.has(key)) text = brand;
      else if (text.indexOf("{brand}") >= 0) text = text.replace(/\{brand\}/g, brand);
    }
    return text;
  }
  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const val = t(key);
      const attr = el.getAttribute("data-i18n-attr");
      if (attr) {
        attr.split(",").forEach((a) => {
          const name = a.trim();
          if (name) el.setAttribute(name, val);
        });
      } else {
        el.textContent = val;
      }
    });
    scope.querySelectorAll("[data-i18n-src]").forEach((el) => {
      const key = el.getAttribute("data-i18n-src");
      if (key) {
        const val = t(key);
        if (val && val !== key) el.setAttribute("src", val);
      }
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
  }

  function applyDocumentChrome() {
    const dir = culture === "en" ? "ltr" : "rtl";
    const lang = culture === "en" ? "en" : "fa";
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("data-culture", culture);
    document.documentElement.classList.toggle("lp-ltr", culture === "en");
    document.documentElement.classList.toggle("lp-rtl", culture !== "en");
    const titleKey = document.documentElement.getAttribute("data-i18n-title-key");
    if (titleKey) document.title = t(titleKey);
    const metaDesc = document.querySelector('meta[name="description"][data-i18n]');
    if (metaDesc) metaDesc.setAttribute("content", t(metaDesc.getAttribute("data-i18n")));
  }

  function updateLangButtons() {
    document.querySelectorAll("[data-lang-switch]").forEach((btn) => {
      const next = culture === "fa" ? "en" : "fa";
      btn.textContent = next === "en" ? t("common.switchToEn") : t("common.switchToFa");
      btn.setAttribute("data-lang-next", next);
      const title = next === "en" ? t("common.switchLangTitle") : t("common.switchLangTitleFa");
      btn.setAttribute("title", title);
      btn.setAttribute("aria-label", title);
    });
  }

  async function load(nextCulture) {
    culture = normalize(nextCulture || detect());
    const res = await fetch(`/locales/${culture}.json?v=4`, { cache: "no-cache" });
    if (!res.ok) throw new Error("locale load failed");
    const json = await res.json();
    dict = {};
    flatten(json, "", dict);
    writeCookie(COOKIE, culture);
    try { localStorage.setItem(LS_KEY, culture); } catch { /* ignore */ }
    applyDocumentChrome();
    applyDom(document);
    updateLangButtons();
    document.dispatchEvent(new CustomEvent("da:locale", { detail: { culture, dir: culture === "en" ? "ltr" : "rtl" } }));
    return culture;
  }

  function setLanguage(next, opts) {
    next = normalize(next);
    const reload = !opts || opts.reload !== false;
    writeCookie(COOKIE, next);
    try { localStorage.setItem(LS_KEY, next); } catch { /* ignore */ }
    if (opts && typeof opts.beforeReload === "function") opts.beforeReload(next);
    if (reload) {
      // Prefer server round-trip so Panel CSS RTL/LTR swaps correctly.
      const url = `/locale/set?lang=${encodeURIComponent(next)}&returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
      location.href = url;
      return Promise.resolve(next);
    }
    return load(next);
  }

  function bindSwitches() {
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-lang-switch]");
      if (!btn) return;
      ev.preventDefault();
      const next = btn.getAttribute("data-lang-next") || (culture === "fa" ? "en" : "fa");
      const mode = btn.getAttribute("data-lang-mode") || "reload";
      setLanguage(next, { reload: mode !== "live" });
    });
  }

  const api = {
    t,
    apply: applyDom,
    load,
    setLanguage,
    get culture() { return culture; },
    get dir() { return culture === "en" ? "ltr" : "rtl"; },
    ready: null
  };

  bindSwitches();
  api.ready = load(detect()).catch((err) => {
    console.warn("i18n", err);
  });

  global.DaI18n = api;
})(window);
