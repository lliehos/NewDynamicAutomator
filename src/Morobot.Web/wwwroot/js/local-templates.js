/*
 * Templates (قالب‌ها) — the menus, the info modal and the detach/use flows.
 *
 * Kept out of local-tasks.js on purpose. That file already owns the process table and its
 * pagination; templates are a second, smaller surface that the same page hosts, and folding the
 * two together would make the table's render path the place every template bug also lives.
 *
 * The page opts in by rendering #da-tpl-menu (and the two modals); everything here is inert when
 * those elements are absent, so the same script can be loaded on a page without templates.
 */
(function () {
  const base = "/api/templates";

  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function dateLocale() {
    return (window.DaI18n && DaI18n.culture === "en") ? "en-US" : "fa-IR";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(dateLocale(), { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Antiforgery token for the cookieless-safe POSTs. The page renders it once in the layout's
  // meta tag; without it the API's [ValidateAntiForgeryToken]-style protection would reject us.
  function requestToken() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]')
      || document.querySelector('meta[name="csrf-token"]');
    return el ? (el.value || el.getAttribute("content") || "") : "";
  }

  async function api(url, options) {
    const opts = Object.assign({ credentials: "same-origin", headers: {} }, options || {});
    opts.headers = Object.assign({}, opts.headers);
    if (opts.body) opts.headers["Content-Type"] = "application/json";
    const token = requestToken();
    if (token) opts.headers["Request-Token"] = token;
    const res = await fetch(url, opts);
    let payload = null;
    try { payload = await res.json(); } catch { /* some responses have no body */ }
    if (!res.ok) {
      const msg = (payload && payload.message) || res.statusText || String(res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.code = payload && payload.code;
      throw err;
    }
    return payload;
  }

  function notify(message, kind) {
    if (typeof window.daNotify === "function") window.daNotify(String(message), kind || "info");
  }

  let templates = [];
  let infoTemplateId = null;
  let detachContext = null;

  // ── Create-from-template ──────────────────────────────────────────────────────────────────
  async function loadTemplates() {
    templates = (await api(base)) || [];
    return templates;
  }

  function renderTemplateMenu() {
    const menu = document.getElementById("da-tpl-menu");
    if (!menu) return;
    if (!templates.length) {
      menu.innerHTML = `<li><span class="dropdown-item-text text-muted small">${escapeHtml(t("panel.templateNone"))}</span></li>`;
      return;
    }
    menu.innerHTML = templates.map((tpl) => `
      <li>
        <button type="button" class="dropdown-item da-tpl-menu-item" data-tpl-id="${escapeHtml(String(tpl.id))}">
          <span class="da-tpl-menu-title">${escapeHtml(tpl.title)}</span>
          <span class="da-tpl-menu-sub">${escapeHtml(
            t("panel.templateMeta", { steps: tpl.stepCount || 0, used: tpl.attachedProcessCount || 0 })
          )}</span>
        </button>
      </li>`).join("") + `
      <li><hr class="dropdown-divider"></li>
      <li>
        <button type="button" class="dropdown-item" id="da-tpl-menu-manage">
          <i class="ti ti-settings" aria-hidden="true"></i>
          <span>${escapeHtml(t("panel.templateManage"))}</span>
        </button>
      </li>`;
  }

  // ── Info modal ────────────────────────────────────────────────────────────────────────────
  function openInfo(templateId) {
    const tpl = templates.find((x) => String(x.id) === String(templateId));
    if (!tpl) return;
    infoTemplateId = tpl.id;

    const title = document.getElementById("da-tpl-info-title");
    const desc = document.getElementById("da-tpl-info-desc");
    const grid = document.getElementById("da-tpl-info-grid");
    if (title) title.textContent = tpl.title;
    if (desc) {
      desc.textContent = tpl.description || "";
      desc.hidden = !tpl.description;
    }
    if (grid) {
      const rows = [
        [t("panel.templateVersion"), String(tpl.version || 1)],
        [t("panel.templateSteps"), String(tpl.stepCount || 0)],
        [t("panel.templateGroups"), String(tpl.groupCount || 0)],
        [t("panel.templateAttached"), String(tpl.attachedProcessCount || 0)],
        [t("panel.templateUpdated"), formatDate(tpl.updatedAtUtc)],
        [t("panel.templateCreator"), tpl.creatorUserName || "—"]
      ];
      grid.innerHTML = rows.map(([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");
    }

    const modalEl = document.getElementById("da-tpl-info-modal");
    if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // ── Create a template from a process ──────────────────────────────────────────────────────
  async function makeFromProcess(processId, processTitle) {
    const suggested = processTitle || "";
    const title = window.prompt(t("panel.templateNamePrompt"), suggested);
    if (title === null) return;
    if (!String(title).trim()) {
      notify(t("panel.templateTitleRequired"), "warn");
      return;
    }
    try {
      await api(`${base}/from-process/${processId}`, {
        method: "POST",
        body: JSON.stringify({ title: String(title).trim() })
      });
      notify(t("panel.templateMade"), "ok");
      await loadTemplates();
      renderTemplateMenu();
      window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { refresh: true } }));
    } catch (err) {
      notify(err && err.message ? err.message : String(err), "warn");
    }
  }

  // ── Create a process from a template ──────────────────────────────────────────────────────
  async function useTemplate(templateId) {
    const tpl = templates.find((x) => String(x.id) === String(templateId));
    const suggested = tpl ? tpl.title : "";
    const title = window.prompt(t("panel.templateNewProcessPrompt"), suggested);
    if (title === null) return;
    if (!String(title).trim()) {
      notify(t("panel.templateTitleRequired"), "warn");
      return;
    }
    try {
      const created = await api(`${base}/${templateId}/create-process`, {
        method: "POST",
        body: JSON.stringify({ title: String(title).trim() })
      });
      notify(t("panel.templateCreated"), "ok");
      // Ask the process table to refresh rather than editing its DOM from here: it owns the
      // cached copy, and a second writer is how a row ends up disagreeing with the cache.
      if (created && created.id != null) {
        window.dispatchEvent(new CustomEvent("da-local-tasks", {
          detail: { refresh: true, focusId: created.id }
        }));
      }
    } catch (err) {
      notify(err && err.message ? err.message : String(err), "warn");
    }
  }

  // ── Detach ────────────────────────────────────────────────────────────────────────────────
  function openDetach(templateId, processId, processTitle) {
    detachContext = { templateId, processId };
    const body = document.getElementById("da-tpl-detach-body");
    if (body) {
      body.textContent = t("panel.templateDetachBody", {
        name: processTitle || `#${processId}`
      });
    }
    const modalEl = document.getElementById("da-tpl-detach-modal");
    if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  async function confirmDetach() {
    if (!detachContext) return;
    const { templateId, processId } = detachContext;
    detachContext = null;
    try {
      await api(`${base}/${templateId}/detach/${processId}`, { method: "POST" });
      notify(t("panel.templateDetached"), "ok");
      window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { refresh: true } }));
    } catch (err) {
      notify(err && err.message ? err.message : String(err), "warn");
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────────────────
  function bind() {
    // The menu and modals are optional: makeFromProcess is reachable from the process table's
    // action column on pages that host neither, so the export below happens either way.
    const menu = document.getElementById("da-tpl-menu");
    if (!menu) return;

    // The menu is filled on open rather than on load: a template added in another tab shows up
    // without a page reload, and a user who never opens the menu makes no request at all.
    const btn = document.getElementById("da-tpl-menu-btn");
    if (btn) {
      btn.addEventListener("show.bs.dropdown", async () => {
        try {
          await loadTemplates();
        } catch (err) {
          console.warn("[local-templates] load failed", err);
          templates = [];
        }
        renderTemplateMenu();
      });
    }

    menu.addEventListener("click", (ev) => {
      const item = ev.target.closest(".da-tpl-menu-item");
      if (item) {
        ev.preventDefault();
        openInfo(item.getAttribute("data-tpl-id"));
        return;
      }
      if (ev.target.closest("#da-tpl-menu-manage")) {
        ev.preventDefault();
        window.location.href = "/Panel/Home/Templates";
      }
    });

    document.getElementById("da-tpl-info-use")?.addEventListener("click", () => {
      const modalEl = document.getElementById("da-tpl-info-modal");
      if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      if (infoTemplateId != null) useTemplate(infoTemplateId);
    });

    document.getElementById("da-tpl-detach-confirm")?.addEventListener("click", () => {
      const modalEl = document.getElementById("da-tpl-detach-modal");
      if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      confirmDetach();
    });

    // The template chip in a process row opens the same info modal, and the detach button on that
    // chip is handled here so the process table does not need to know how detaching works.
    document.addEventListener("click", (ev) => {
      const chip = ev.target.closest(".da-tpl-chip");
      if (!chip) return;
      ev.preventDefault();
      const templateId = chip.getAttribute("data-tpl-id");
      const processId = chip.getAttribute("data-task-id");
      if (ev.target.closest(".da-tpl-chip-detach")) {
        openDetach(templateId, processId, chip.getAttribute("data-task-title"));
        return;
      }
      loadTemplates().then(() => openInfo(templateId)).catch(() => openInfo(templateId));
    });

    // Rebuild the menu contents whenever the process list refreshes, so the "attached" counts
    // shown in the menu follow the table instead of freezing at whatever the last open saw.
    window.addEventListener("da-local-tasks", () => { renderTemplateMenu(); });

    loadTemplates().then(renderTemplateMenu).catch(() => { /* menu stays on its loading hint */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.DaTemplates = { openInfo, useTemplate, openDetach, makeFromProcess };
})();
