(function () {

  const modal = document.getElementById("da-ext-modal");

  const banner = document.getElementById("da-ext-banner");

  if (!modal) return;



  const DISMISS_KEY = "da-ext-modal-dismissed";

  const actions = modal.querySelector(".da-ext-actions");

  if (actions && !document.getElementById("da-ext-dismiss")) {

    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "btn-da btn-da-ghost";

    btn.id = "da-ext-dismiss";

    btn.textContent = "انصراف";

    actions.appendChild(btn);

  }



  function hasExtension() {

    if (document.documentElement.dataset.daExtension === "1") return true;

    // FAB from content script is also proof the extension is alive.

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



  function apply(ok) {

    const showModal = !ok && !isDismissed();

    modal.classList.toggle("open", showModal);

    if (banner) banner.classList.toggle("show", !ok);

    document.querySelectorAll("[data-requires-extension]").forEach((el) => {

      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement)

        el.disabled = !ok;

      else el.style.opacity = ok ? "" : "0.45";

      el.toggleAttribute("aria-disabled", !ok);

    });

    const st = document.getElementById("da-portal-status");

    if (st) {

      st.textContent = ok

        ? "افزونه متصل است. دکمه قرمز REC پایین‌چپ صفحه را ببینید."

        : (st.textContent || "");

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



  window.addEventListener("da-extension-ready", () => apply(true));

  window.addEventListener("da-extension-recheck", check);



  document.getElementById("da-ext-recheck")?.addEventListener("click", check);

  document.getElementById("da-ext-dismiss")?.addEventListener("click", dismiss);

  document.getElementById("da-ext-download")?.addEventListener("click", () => {

    window.location.href = "/extension/download";

  });

  document.getElementById("da-ext-guide")?.addEventListener("click", () => {

    window.location.href = "/Extension/Install";

  });



  check();

  [200, 500, 1000, 2000, 4000].forEach((ms) => setTimeout(check, ms));

  // Keep watching until handshake lands (e.g. content script injects late).

  const obs = new MutationObserver(() => {

    if (hasExtension()) {

      apply(true);

      obs.disconnect();

    }

  });

  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-da-extension"], childList: true, subtree: true });

  setTimeout(() => obs.disconnect(), 15000);

})();

