/** Shared toast / notify for portal + editor (no third-party deps). */
(function () {
  const HOST_ID = "da-toast-host";
  const MAX = 4;

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "da-toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions");
    document.documentElement.appendChild(host);
    return host;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  /**
   * @param {string} message
   * @param {"info"|"success"|"warn"|"error"} [type]
   * @param {{ title?: string, ms?: number }} [opts]
   */
  function notify(message, type, opts) {
    const text = String(message || "").trim();
    if (!text) return null;
    const kind = type || "info";
    const title = opts?.title || "";
    const ms = opts?.ms != null ? opts.ms : (kind === "error" ? 6500 : 3800);
    const host = ensureHost();

    while (host.children.length >= MAX) {
      host.firstElementChild?.remove();
    }

    const el = document.createElement("div");
    el.className = `da-toast da-toast-${kind}`;
    el.innerHTML =
      (title ? `<div class="da-toast-title">${escapeHtml(title)}</div>` : "")
      + `<div class="da-toast-msg">${escapeHtml(text)}</div>`
      + `<button type="button" class="da-toast-x" aria-label="بستن">×</button>`;

    const close = () => {
      el.classList.add("da-toast-out");
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector(".da-toast-x")?.addEventListener("click", close);
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("da-toast-in"));
    if (ms > 0) setTimeout(close, ms);
    return el;
  }

  window.daNotify = notify;
  window.daNotifySuccess = (m, o) => notify(m, "success", o);
  window.daNotifyError = (m, o) => notify(m, "error", o);
  window.daNotifyWarn = (m, o) => notify(m, "warn", o);
  window.daNotifyInfo = (m, o) => notify(m, "info", o);

  /** Prefer toast; optionally also mirror to a status element. */
  window.daStatus = function daStatus(elOrId, message, type) {
    const el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
    if (el && message != null) el.textContent = String(message);
    if (message) notify(message, type || "info");
  };

  /** Content scripts / extensions can raise toasts via CustomEvent (shared DOM). */
  window.addEventListener("da-notify", (ev) => {
    const d = ev.detail || {};
    const msg = d.message ?? d.text ?? d.msg;
    if (!msg) return;
    notify(String(msg), d.type || "info", d);
  });
})();
