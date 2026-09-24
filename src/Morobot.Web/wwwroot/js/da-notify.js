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
    const kind = type === "warning" ? "warn" : (type || "info");
    const title = opts?.title || "";
    // Long, multi-line messages (e.g. node validation reports) need time to read.
    const defaultMs = kind === "error" ? 6500 : 3800;
    const ms = opts?.ms != null ? opts.ms : (text.length > 160 ? 15000 : defaultMs);
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
  window.DaNotify = {
    toast: notify,
    success: (m, o) => notify(m, "success", o),
    error: (m, o) => notify(m, "error", o),
    warn: (m, o) => notify(m, "warn", o),
    info: (m, o) => notify(m, "info", o),
    /**
     * Modern confirm dialog. Returns Promise&lt;boolean&gt;.
     * @param {string} message
     * @param {{ title?: string, okText?: string, cancelText?: string, danger?: boolean }} [opts]
     */
    confirm(message, opts) {
      return new Promise((resolve) => {
        const existing = document.getElementById("da-confirm");
        if (existing) existing.remove();
        const title = opts?.title || "";
        const okText = opts?.okText || "تأیید";
        const cancelText = opts?.cancelText || "انصراف";
        const danger = !!opts?.danger;
        const backdrop = document.createElement("div");
        backdrop.id = "da-confirm";
        backdrop.className = "da-confirm-backdrop";
        backdrop.innerHTML =
          `<div class="da-confirm-box ${danger ? "is-danger" : ""}" role="alertdialog" aria-modal="true">`
          + (title ? `<div class="da-confirm-title">${escapeHtml(title)}</div>` : "")
          + `<div class="da-confirm-msg">${escapeHtml(message || "")}</div>`
          + `<div class="da-confirm-actions">`
          + `<button type="button" class="da-confirm-cancel">${escapeHtml(cancelText)}</button>`
          + `<button type="button" class="da-confirm-ok">${escapeHtml(okText)}</button>`
          + `</div></div>`;
        const finish = (val) => {
          backdrop.classList.remove("da-confirm-in");
          setTimeout(() => backdrop.remove(), 160);
          resolve(!!val);
        };
        backdrop.addEventListener("click", (ev) => {
          if (ev.target === backdrop) finish(false);
        });
        backdrop.querySelector(".da-confirm-cancel")?.addEventListener("click", () => finish(false));
        backdrop.querySelector(".da-confirm-ok")?.addEventListener("click", () => finish(true));
        document.documentElement.appendChild(backdrop);
        requestAnimationFrame(() => backdrop.classList.add("da-confirm-in"));
        try { backdrop.querySelector(".da-confirm-ok")?.focus(); } catch { /* ignore */ }
      });
    },
    /**
     * Prompt for a single text value. Returns Promise&lt;string|null&gt; (null = cancel).
     * @param {string} message
     * @param {{ title?: string, okText?: string, cancelText?: string, value?: string, placeholder?: string, maxLength?: number }} [opts]
     */
    prompt(message, opts) {
      return new Promise((resolve) => {
        const existing = document.getElementById("da-confirm");
        if (existing) existing.remove();
        const title = opts?.title || "";
        const okText = opts?.okText || "ذخیره";
        const cancelText = opts?.cancelText || "انصراف";
        const value = opts?.value != null ? String(opts.value) : "";
        const placeholder = opts?.placeholder || "";
        const maxLength = opts?.maxLength > 0 ? Number(opts.maxLength) : 200;
        const backdrop = document.createElement("div");
        backdrop.id = "da-confirm";
        backdrop.className = "da-confirm-backdrop";
        backdrop.innerHTML =
          `<div class="da-confirm-box" role="dialog" aria-modal="true">`
          + (title ? `<div class="da-confirm-title">${escapeHtml(title)}</div>` : "")
          + (message ? `<div class="da-confirm-msg">${escapeHtml(message)}</div>` : "")
          + `<input type="text" class="da-confirm-input" maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" autocomplete="off" />`
          + `<div class="da-confirm-actions">`
          + `<button type="button" class="da-confirm-cancel">${escapeHtml(cancelText)}</button>`
          + `<button type="button" class="da-confirm-ok">${escapeHtml(okText)}</button>`
          + `</div></div>`;
        const input = backdrop.querySelector(".da-confirm-input");
        const finish = (val) => {
          backdrop.classList.remove("da-confirm-in");
          setTimeout(() => backdrop.remove(), 160);
          resolve(val);
        };
        const submit = () => {
          const next = String(input?.value || "").trim();
          if (!next) {
            input?.focus();
            input?.classList.add("is-invalid");
            return;
          }
          finish(next);
        };
        backdrop.addEventListener("click", (ev) => {
          if (ev.target === backdrop) finish(null);
        });
        backdrop.querySelector(".da-confirm-cancel")?.addEventListener("click", () => finish(null));
        backdrop.querySelector(".da-confirm-ok")?.addEventListener("click", submit);
        input?.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); submit(); }
          if (ev.key === "Escape") { ev.preventDefault(); finish(null); }
        });
        document.documentElement.appendChild(backdrop);
        requestAnimationFrame(() => {
          backdrop.classList.add("da-confirm-in");
          try {
            input?.focus();
            input?.select();
          } catch { /* ignore */ }
        });
      });
    }
  };
  window.daConfirm = (m, o) => window.DaNotify.confirm(m, o);
  window.daPrompt = (m, o) => window.DaNotify.prompt(m, o);

  /**
   * Colored modal for condition check result.
   * @param {boolean} pass
   * @param {string} message
   */
  function conditionAlert(pass, message) {
    const existing = document.getElementById("da-cond-alert");
    if (existing) existing.remove();
    const text = String(message || (pass ? "موفق" : "ناموفق"));
    const backdrop = document.createElement("div");
    backdrop.id = "da-cond-alert";
    backdrop.className = "da-cond-alert-backdrop";
    backdrop.innerHTML =
      `<div class="da-cond-alert-box ${pass ? "is-ok" : "is-fail"}" role="alertdialog" aria-modal="true">`
      + `<div class="da-cond-alert-title">${pass ? "نتیجه شرط: موفق" : "نتیجه شرط: ناموفق"}</div>`
      + `<div class="da-cond-alert-msg">${escapeHtml(text)}</div>`
      + `<button type="button" class="da-cond-alert-ok">باشه</button>`
      + `</div>`;
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) close();
    });
    backdrop.querySelector(".da-cond-alert-ok")?.addEventListener("click", close);
    document.documentElement.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("da-cond-alert-in"));
    try { backdrop.querySelector(".da-cond-alert-ok")?.focus(); } catch { /* ignore */ }
  }
  window.daConditionAlert = conditionAlert;

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
