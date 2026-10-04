(function () {
  /** @type {null | Promise<object>} */
  let cachePromise = null;
  /** @type {object | null} */
  let cached = null;

  const LOCAL_DEFAULTS = {
    planCode: "Local",
    planNameFa: "محلی",
    planNameEn: "Local",
    isLocal: true,
    canPlay: false,
    canSelector: false,
    canRecord: false,
    canSmart: false,
    maxTasks: 1,
    maxDataSources: 1
  };

  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function authMode() {
    const m = document.cookie.split(";").map((s) => s.trim()).find((s) => s.startsWith("da_auth_mode="));
    return m ? decodeURIComponent(m.split("=")[1]) : "local";
  }

  async function fetchEntitlements(force) {
    if (!force && cached) return cached;
    if (!force && cachePromise) return cachePromise;
    cachePromise = (async () => {
      try {
        const res = await fetch("/api/auth/entitlements", { credentials: "same-origin" });
        if (!res.ok) throw new Error("entitlements " + res.status);
        cached = await res.json();
        return cached;
      } catch {
        cached = { ...LOCAL_DEFAULTS, isLocal: authMode() !== "server" };
        return cached;
      } finally {
        cachePromise = null;
      }
    })();
    return cachePromise;
  }

  function fromBootstrap() {
    if (window.__DA_ENTITLEMENTS__) {
      cached = window.__DA_ENTITLEMENTS__;
      return cached;
    }
    return null;
  }

  function getCached() {
    return cached || fromBootstrap() || { ...LOCAL_DEFAULTS };
  }

  function canCreateTask(currentCount) {
    const e = getCached();
    if (e.maxTasks == null) return true;
    return (currentCount || 0) < e.maxTasks;
  }

  function canCreateSource(currentCount) {
    const e = getCached();
    if (e.maxDataSources == null) return true;
    return (currentCount || 0) < e.maxDataSources;
  }

  function upgradeMessage(capability) {
    if (capability === "play") return t("plan.upgradePlay");
    if (capability === "selector") return t("plan.upgradeSelector");
    if (capability === "record") return t("plan.upgradeRecord");
    if (capability === "smart") return t("plan.upgradeSmart");
    return t("plan.upgradeTitle");
  }

  function showUpgrade(capability) {
    const msg = upgradeMessage(capability);
    if (window.DaNotify) DaNotify.toast(msg, "warn");
    else if (window.daNotify) daNotify(msg, "warn");
    const target = capability === "smart" ? "Gold" : "Pro";
    setTimeout(() => {
      window.location.href = "/Panel/Account/Upgrade?target=" + encodeURIComponent(target);
    }, 900);
  }

  function applyUiGates(root) {
    const e = getCached();
    const scope = root || document;
    scope.querySelectorAll("[data-da-need-play]").forEach((el) => {
      el.classList.toggle("d-none", !e.canPlay);
      el.toggleAttribute("disabled", !e.canPlay);
    });
    scope.querySelectorAll("[data-da-need-record]").forEach((el) => {
      if (!e.canRecord) {
        el.classList.remove("d-none");
        el.toggleAttribute("disabled", true);
        const tip = upgradeMessage("record");
        if (tip) el.setAttribute("title", tip);
      } else {
        el.classList.remove("d-none");
        el.removeAttribute("disabled");
      }
    });
    scope.querySelectorAll("[data-da-need-selector]").forEach((el) => {
      el.classList.toggle("d-none", !e.canSelector);
      el.toggleAttribute("disabled", !e.canSelector);
    });
    scope.querySelectorAll("[data-da-need-smart]").forEach((el) => {
      el.classList.toggle("d-none", !e.canSmart);
      el.toggleAttribute("disabled", !e.canSmart);
    });
  }

  window.DaEntitlements = {
    fetch: fetchEntitlements,
    get: getCached,
    canCreateTask,
    canCreateSource,
    showUpgrade,
    upgradeMessage,
    applyUiGates,
    authMode,
    LOCAL_DEFAULTS
  };

  document.addEventListener("DOMContentLoaded", () => {
    fetchEntitlements().then(() => applyUiGates(document));
  });
})();
