/**
 * Process share modal — search users and grant granular permissions.
 */
(function () {
  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function entitlements() {
    return (window.DaEntitlements && DaEntitlements.get && DaEntitlements.get())
      || window.__DA_ENTITLEMENTS__
      || {};
  }

  function canSharePlan() {
    const e = entitlements();
    return !!e.canShare && !e.isLocal;
  }

  function grantable() {
    const e = entitlements();
    return {
      view: e.shareAllowView !== false,
      edit: !!e.shareAllowEdit,
      del: !!e.shareAllowDelete,
      exec: !!e.shareAllowExecute,
      ds: !!e.shareAllowChangeDataSource
    };
  }

  function displayName(u) {
    const d = (u.displayName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.userName || "").trim();
    return d || u.userName;
  }

  function flagLabel(s) {
    const parts = [];
    if (s.canView) parts.push(t("share.perm.view"));
    if (s.canEdit) parts.push(t("share.perm.edit"));
    if (s.canDelete) parts.push(t("share.perm.delete"));
    if (s.canExecute) parts.push(t("share.perm.execute"));
    if (s.canChangeDataSource) parts.push(t("share.perm.ds"));
    return parts.join(" · ") || "—";
  }

  async function api(url, opts) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      ...opts
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || body.code || res.statusText);
      err.code = body.code || res.status;
      throw err;
    }
    return body;
  }

  function openShareModal(taskId, taskTitle) {
    if (!canSharePlan()) {
      if (window.DaNotify) DaNotify.warn(t("share.planBlocked"));
      else if (window.daNotify) daNotify(t("share.planBlocked"), "warn");
      return;
    }

    document.getElementById("da-share-modal")?.remove();
    const g = grantable();
    const backdrop = document.createElement("div");
    backdrop.id = "da-share-modal";
    backdrop.className = "da-share-backdrop";
    backdrop.innerHTML = `
      <div class="da-share-box" role="dialog" aria-modal="true">
        <h3 class="da-share-title">${t("share.title")}</h3>
        <p class="da-share-sub">${t("share.subtitle", { title: taskTitle || ("#" + taskId) })}</p>
        <input class="da-share-search" type="search" id="da-share-q" placeholder="${t("share.searchPh")}" autocomplete="off" />
        <ul class="da-share-hits" id="da-share-hits" hidden></ul>
        <div id="da-share-selected" class="da-share-sub" hidden></div>
        <div class="da-share-perms" id="da-share-perms">
          ${g.view ? `<label><input type="checkbox" data-p="view" checked /> ${t("share.perm.view")}</label>` : ""}
          ${g.edit ? `<label><input type="checkbox" data-p="edit" /> ${t("share.perm.edit")}</label>` : ""}
          ${g.del ? `<label><input type="checkbox" data-p="del" /> ${t("share.perm.delete")}</label>` : ""}
          ${g.exec ? `<label><input type="checkbox" data-p="exec" /> ${t("share.perm.execute")}</label>` : ""}
          ${g.ds ? `<label><input type="checkbox" data-p="ds" /> ${t("share.perm.ds")}</label>` : ""}
        </div>
        <div class="da-share-actions">
          <button type="button" class="da-share-btn ghost" data-da-share-close>${t("share.close")}</button>
          <button type="button" class="da-share-btn primary" id="da-share-add" disabled>${t("share.add")}</button>
        </div>
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:1rem 0" />
        <h4 style="margin:0 0 .5rem;font-size:.95rem">${t("share.current")}</h4>
        <ul class="da-share-list" id="da-share-list"><li>${t("share.loading")}</li></ul>
      </div>`;
    document.documentElement.appendChild(backdrop);

    let selected = null;
    let searchTimer = null;
    const qEl = backdrop.querySelector("#da-share-q");
    const hitsEl = backdrop.querySelector("#da-share-hits");
    const selEl = backdrop.querySelector("#da-share-selected");
    const addBtn = backdrop.querySelector("#da-share-add");
    const listEl = backdrop.querySelector("#da-share-list");

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) close(); });
    backdrop.querySelector("[data-da-share-close]")?.addEventListener("click", close);

    function readPerms() {
      const box = backdrop.querySelector("#da-share-perms");
      const on = (p) => !!box.querySelector(`input[data-p="${p}"]`)?.checked;
      return {
        canView: on("view") || on("edit") || on("del") || on("ds"),
        canEdit: on("edit"),
        canDelete: on("del"),
        canExecute: on("exec"),
        canChangeDataSource: on("ds")
      };
    }

    function setSelected(u) {
      selected = u;
      hitsEl.hidden = true;
      if (!u) {
        selEl.hidden = true;
        addBtn.disabled = true;
        return;
      }
      selEl.hidden = false;
      selEl.textContent = t("share.selected", { name: displayName(u), user: u.userName });
      addBtn.disabled = false;
    }

    async function refreshList() {
      try {
        const rows = await api(`/api/tasks/${taskId}/shares`);
        const others = (rows || []).filter((r) => !r.isOwner);
        if (!others.length) {
          listEl.innerHTML = `<li>${t("share.empty")}</li>`;
          return;
        }
        listEl.innerHTML = others.map((r) => `
          <li data-uid="${r.userId}">
            <div>
              <strong>${displayName(r) || r.userName}</strong>
              <div class="da-share-flags">${flagLabel(r)}</div>
            </div>
            <button type="button" class="da-share-btn danger" data-revoke="${r.userId}">${t("share.revoke")}</button>
          </li>`).join("");
        listEl.querySelectorAll("[data-revoke]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const uid = Number(btn.getAttribute("data-revoke"));
            const ok = window.DaNotify
              ? await DaNotify.confirm(t("share.revokeConfirm"), { title: t("share.title"), danger: true, okText: t("share.revoke") })
              : false;
            if (!ok) return;
            try {
              await api(`/api/tasks/${taskId}/shares/${uid}`, { method: "DELETE" });
              await refreshList();
              if (window.daNotify) daNotify(t("share.revoked"), "success");
            } catch (e) {
              if (window.daNotify) daNotify(e.message || t("share.error"), "error");
            }
          });
        });
      } catch (e) {
        listEl.innerHTML = `<li>${e.message || t("share.error")}</li>`;
      }
    }

    qEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = qEl.value.trim();
      if (q.length < 1) {
        hitsEl.hidden = true;
        hitsEl.innerHTML = "";
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const hits = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
          if (!hits.length) {
            hitsEl.hidden = false;
            hitsEl.innerHTML = `<li>${t("share.noHits")}</li>`;
            return;
          }
          hitsEl.hidden = false;
          hitsEl.innerHTML = hits.map((u) => `
            <li data-pick="${u.userId}">
              <strong>${displayName(u)}</strong>
              <span style="color:#64748b"> @${u.userName}${u.email ? " · " + u.email : ""}${u.nationalId ? " · " + u.nationalId : ""}</span>
            </li>`).join("");
          hitsEl.querySelectorAll("[data-pick]").forEach((li) => {
            li.addEventListener("click", () => {
              const id = Number(li.getAttribute("data-pick"));
              setSelected(hits.find((h) => h.userId === id) || null);
            });
          });
        } catch (e) {
          hitsEl.hidden = false;
          hitsEl.innerHTML = `<li>${e.message || t("share.error")}</li>`;
        }
      }, 280);
    });

    addBtn.addEventListener("click", async () => {
      if (!selected) return;
      const perms = readPerms();
      try {
        await api(`/api/tasks/${taskId}/shares`, {
          method: "POST",
          body: JSON.stringify({ userId: selected.userId, ...perms })
        });
        setSelected(null);
        qEl.value = "";
        await refreshList();
        if (window.daNotify) daNotify(t("share.added"), "success");
      } catch (e) {
        if (window.daNotify) daNotify(e.message || t("share.error"), "error");
      }
    });

    refreshList();
    try { qEl.focus(); } catch { /* ignore */ }
  }

  window.DaTaskShare = { open: openShareModal, canSharePlan };
})();
