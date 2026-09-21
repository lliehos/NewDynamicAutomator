(function () {
  const modal = document.getElementById("da-ext-modal");
  const banner = document.getElementById("da-ext-banner");
  if (!modal) return;

  const DISMISS_KEY = "da-ext-modal-dismissed";
  const pathEl = document.getElementById("da-ext-modal-path");
  const hintEl = document.getElementById("da-ext-modal-hint");
  let installPath = "";

  function hasExtension() {
    if (document.documentElement.dataset.daExtension === "1") return true;
    if (document.getElementById("da-recorder-fab")) return true;
    return false;
  }

  function isDismissed() {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  }

  async function ensureInstallPath() {
    if (installPath) return installPath;
    try {
      const res = await fetch("/extension/install-path", { cache: "no-store" });
      if (!res.ok) return "";
      const data = await res.json();
      installPath = data.path || "";
      if (pathEl && installPath) pathEl.textContent = installPath;
      return installPath;
    } catch {
      if (pathEl) pathEl.textContent = "مسیر آماده نشد — پرتال را رفرش کنید.";
      return "";
    }
  }

  function apply(ok) {
    const showModal = !ok && !isDismissed();
    modal.classList.toggle("open", showModal);
    if (banner) banner.classList.toggle("show", !ok);
    if (showModal) ensureInstallPath();

    document.querySelectorAll("[data-requires-extension]").forEach((el) => {
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement)
        el.disabled = !ok;
      else el.style.opacity = ok ? "" : "0.45";
      el.toggleAttribute("aria-disabled", !ok);
    });

    const st = document.getElementById("da-portal-status");
    if (st && ok) {
      st.textContent = "افزونه متصل است. دکمه قرمز REC پایین‌چپ صفحه را ببینید.";
    }
  }

  function check() {
    if (hasExtension()) {
      try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
    }
    apply(hasExtension());
  }

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    modal.classList.remove("open");
    if (banner) banner.classList.add("show");
  }

  async function copyPath() {
    const path = (await ensureInstallPath()) || pathEl?.textContent?.trim() || "";
    if (!path || path.includes("آماده‌سازی") || path.includes("آماده نشد")) {
      if (hintEl) hintEl.textContent = "مسیر هنوز آماده نیست.";
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      if (hintEl) hintEl.textContent = "مسیر کپی شد — در Load unpacked همان را Paste/انتخاب کنید.";
    } catch {
      if (hintEl) hintEl.textContent = "کپی نشد؛ مسیر را دستی از کادر بالا بردارید.";
    }
  }

  window.addEventListener("da-extension-ready", () => apply(true));
  window.addEventListener("da-extension-recheck", check);

  document.getElementById("da-ext-recheck")?.addEventListener("click", check);
  document.getElementById("da-ext-dismiss")?.addEventListener("click", dismiss);
  document.getElementById("da-ext-copy-path")?.addEventListener("click", copyPath);
  document.getElementById("da-ext-guide")?.addEventListener("click", () => {
    window.location.href = "/Extension/Install";
  });

  ensureInstallPath();
  check();
  [200, 500, 1000, 2000, 4000].forEach((ms) => setTimeout(check, ms));

  const obs = new MutationObserver(() => {
    if (hasExtension()) {
      apply(true);
      obs.disconnect();
    }
  });
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-da-extension"],
    childList: true,
    subtree: true
  });
  setTimeout(() => obs.disconnect(), 15000);
})();
