/** Detect Morobot portal pages (Cloud or Enterprise) on any host. */
(function (global) {
  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  global.DaPortalDetect = {
    isMorobotPortalPage() {
      try {
        const path = location.pathname || "/";
        if (/^\/(Panel|Admin)(\/|$)/i.test(path)) return true;
        if (readCookie("da_access") || readCookie("da_culture")) return true;
        if (path === "/" && document.querySelector(".lp-brand, .sg-page, [data-i18n]")) return true;
        return false;
      } catch {
        return false;
      }
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
