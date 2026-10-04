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

  /**
   * Permission checkboxes. Only the permissions the caller's own plan may grant are rendered, so the
   * switch set doubles as a statement of what the plan allows. `prefs` seeds the checked state, which
   * is what makes the same markup usable for both "add a share" and "edit an existing share" — the
   * source-data switch in particular has to be shown already-on when editing, or saving would
   * silently switch it off.
   */
  function permBoxHtml(g, prefs = {}) {
    const checked = (on) => (on ? " checked" : "");
    return [
      g.view ? `<label><input type="checkbox" data-p="view"${checked(prefs.view !== false)} /> ${t("share.perm.view")}</label>` : "",
      g.edit ? `<label><input type="checkbox" data-p="edit"${checked(prefs.edit)} /> ${t("share.perm.edit")}</label>` : "",
      g.del ? `<label><input type="checkbox" data-p="del"${checked(prefs.del)} /> ${t("share.perm.delete")}</label>` : "",
      g.exec ? `<label><input type="checkbox" data-p="exec"${checked(prefs.exec)} /> ${t("share.perm.execute")}</label>` : "",
      // The "allow changing source data" switch — the whole point of this permission is that it can
      // be withheld, so it must be visible and individually toggleable per user.
      g.ds ? `<label title="${t("share.perm.dsHint")}"><input type="checkbox" data-p="ds"${checked(prefs.ds)} /> ${t("share.perm.ds")}</label>` : ""
    ].filter(Boolean).join("");
  }

  function readPermsFrom(box) {
    const on = (p) => !!box.querySelector(`input[data-p="${p}"]`)?.checked;
    return {
      canView: on("view") || on("edit") || on("del") || on("ds"),
      canEdit: on("edit"),
      canDelete: on("del"),
      canExecute: on("exec"),
      canChangeDataSource: on("ds")
    };
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
          ${permBoxHtml(g, { view: true })}
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
    /** Non-null while the permission row is editing an existing grant instead of adding a new one. */
    let editingUid = null;
    let editingShare = null;
    const qEl = backdrop.querySelector("#da-share-q");
    const hitsEl = backdrop.querySelector("#da-share-hits");
    const selEl = backdrop.querySelector("#da-share-selected");
    const addBtn = backdrop.querySelector("#da-share-add");
    const listEl = backdrop.querySelector("#da-share-list");

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) close(); });
    backdrop.querySelector("[data-da-share-close]")?.addEventListener("click", close);

    function readPerms() {
      return readPermsFrom(backdrop.querySelector("#da-share-perms"));
    }

    /** Clear the permission row back to "add new share" defaults (view only). */
    function resetPerms() {
      const box = backdrop.querySelector("#da-share-perms");
      if (box) box.innerHTML = permBoxHtml(g, { view: true });
    }

    /** Swap the permission row to an existing share's current grants so it can be edited. */
    function loadPermsFor(share) {
      const box = backdrop.querySelector("#da-share-perms");
      if (!box) return;
      box.innerHTML = permBoxHtml(g, {
        view: share.canView,
        edit: share.canEdit,
        del: share.canDelete,
        exec: share.canExecute,
        ds: share.canChangeDataSource
      });
    }

    function setSelected(u) {
      selected = u;
      hitsEl.hidden = true;
      // Picking a user to ADD supersedes any row being edited.
      if (u && editingUid != null) {
        editingUid = null;
        editingShare = null;
        addBtn.textContent = t("share.add");
        addBtn.dataset.mode = "add";
        resetPerms();
      }
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
            <div class="da-share-row-actions">
              <button type="button" class="da-share-btn ghost" data-edit="${r.userId}">${t("share.perms")}</button>
              <button type="button" class="da-share-btn danger" data-revoke="${r.userId}">${t("share.revoke")}</button>
            </div>
          </li>`).join("");

        // Edit an existing grant — the only way to flip the "allow changing source data" switch
        // after the share exists. POSTing the same userId upserts, so one path serves both.
        listEl.querySelectorAll("[data-edit]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const uid = Number(btn.getAttribute("data-edit"));
            const share = others.find((o) => Number(o.userId) === uid);
            if (!share) return;
            editingUid = uid;
            loadPermsFor(share);
            addBtn.textContent = t("share.savePerms");
            addBtn.disabled = false;
            addBtn.dataset.mode = "edit";
            // Point the header at the row being edited so it is obvious what the switches affect.
            selEl.hidden = false;
            selEl.textContent = t("share.editingPerms", { name: displayName(share) || share.userName });
            editingShare = share;
          });
        });

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
      const perms = readPerms();
      const isEdit = editingUid != null;
      const targetId = isEdit ? editingUid : selected?.userId;
      if (!targetId) return;
      try {
        await api(`/api/tasks/${taskId}/shares`, {
          method: "POST",
          body: JSON.stringify({ userId: targetId, ...perms })
        });
        if (isEdit) {
          // Leave edit mode and restore the "add" affordances.
          editingUid = null;
          editingShare = null;
          addBtn.textContent = t("share.add");
          addBtn.dataset.mode = "add";
          resetPerms();
          setSelected(null);
          qEl.value = "";
          if (window.daNotify) daNotify(perms.canChangeDataSource
            ? t("share.permsSavedWithDs")
            : t("share.permsSavedNoDs"), "success");
        } else {
          setSelected(null);
          qEl.value = "";
          if (window.daNotify) daNotify(t("share.added"), "success");
        }
        await refreshList();
      } catch (e) {
        if (window.daNotify) daNotify(e.message || t("share.error"), "error");
      }
    });

    refreshList();
    try { qEl.focus(); } catch { /* ignore */ }
  }

  window.DaTaskShare = { open: openShareModal, canSharePlan };
})();
