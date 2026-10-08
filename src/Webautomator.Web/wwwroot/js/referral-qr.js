(function () {
  const root = document.getElementById("webautomator-referral-root");
  if (!root) return;

  const url = root.getAttribute("data-url") || "https://webautomator.ir";
  const modal = document.getElementById("webautomator-referral-modal");
  const openBtn = document.getElementById("webautomator-referral-open");
  const canvas = document.getElementById("webautomator-referral-qr");
  let qrReady = false;

  function shareText() {
    if (window.I18n && typeof I18n.t === "function") return `${I18n.t("panel.referral.shareText")} ${url}`;
    const brand = (window.__WEBAUTOMATOR_BRANDING && window.__WEBAUTOMATOR_BRANDING.appName) || "Webautomator";
    return `${brand} — اتوماسیون وب ${url}`;
  }

  function drawQr() {
    if (!canvas || qrReady) return;
    if (typeof QRCode !== "undefined" && QRCode.toCanvas) {
      QRCode.toCanvas(canvas, url, { width: 200, margin: 1, color: { dark: "#134e4a", light: "#ffffff" } }, (err) => {
        if (!err) qrReady = true;
      });
      return;
    }
    // No local encoder loaded: show the link itself so the dialog is still usable offline.
    // (Previously this fell back to api.qrserver.com, which is an external request and is not
    // allowed on this deployment.)
    const wrap = canvas.parentElement;
    if (wrap) {
      canvas.hidden = true;
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = url;
      link.className = "webautomator-referral-url-fallback";
      wrap.appendChild(link);
      qrReady = true;
    }
  }

  function openModal() {
    if (!modal) return;
    modal.hidden = false;
    drawQr();
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  openBtn?.addEventListener("click", openModal);
  root.querySelectorAll("[data-referral-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal && !modal.hidden) closeModal();
  });

  const text = shareText();
  root.querySelectorAll("[data-share]").forEach((el) => {
    const kind = el.getAttribute("data-share");
    if (kind === "whatsapp") {
      el.href = "https://wa.me/?text=" + encodeURIComponent(text);
      el.target = "_blank";
    } else if (kind === "telegram") {
      el.href = "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text);
      el.target = "_blank";
    } else if (kind === "email") {
      el.href = "mailto:?subject=" + encodeURIComponent("Webautomator") + "&body=" + encodeURIComponent(text);
    } else if (kind === "sms") {
      el.href = "sms:?body=" + encodeURIComponent(text);
    } else if (kind === "copy") {
      el.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(url);
          el.querySelector("span").textContent = window.I18n?.t?.("panel.referral.copied") || "کپی شد";
          setTimeout(() => {
            const span = el.querySelector("span");
            if (span) span.textContent = window.I18n?.t?.("panel.referral.copyLink") || "کپی لینک";
          }, 1500);
        } catch { /* ignore */ }
      });
    }
  });
})();
