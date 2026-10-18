(function () {
  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function currentUser() {
    if (window.DaSecureStore) return DaSecureStore.currentUser();
    const m = document.cookie.match(/(?:^|; )da_local_user=([^;]*)/);
    const fromCookie = m ? decodeURIComponent(m[1]) : "";
    if (fromCookie) {
      localStorage.setItem("da_local_user", fromCookie);
      return fromCookie;
    }
    return localStorage.getItem("da_local_user") || "test";
  }

  function tasksKey() {
    return window.DaSecureStore ? DaSecureStore.tasksKey() : ("da_local_tasks__" + currentUser());
  }

  function readTasks() {
    if (window.DaSecureStore) return DaSecureStore.readTasks();
    try {
      return JSON.parse(localStorage.getItem(tasksKey()) || "[]");
    } catch {
      return [];
    }
  }

  function writeTasks(tasks) {
    if (window.DaSecureStore) {
      DaSecureStore.writeTasks(tasks);
      return;
    }
    localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    localStorage.setItem("da_local_user", currentUser());
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
  }

  function notify(message, type) {
    const status = document.getElementById("da-sources-status");
    if (status && message != null) status.textContent = String(message);
    if (message && typeof window.daNotify === "function") {
      window.daNotify(String(message), type || "info");
    }
  }

  /**
   * Pull the extension's own task records into this page before acting on local state.
   *
   * The extension is where a run WRITES; this page only holds whatever arrived on the last push.
   * Syncing from a stale copy sent an empty payload, cleared the badge and left the server untouched
   * — the "I synced and nothing changed" report. The content-script bridge answers
   * `da-request-local-tasks` by writing the fresh list into this page, so one round trip is enough.
   */
  function refreshLocalTasksFromExtension(timeoutMs = 1200) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener("da-local-tasks", onChanged);
        resolve(readTasks());
      };
      const onChanged = (ev) => { if (ev?.detail?.tasks) finish(); };
      window.addEventListener("da-local-tasks", onChanged);
      try { window.dispatchEvent(new CustomEvent("da-request-local-tasks")); } catch { /* no extension */ }
      setTimeout(finish, timeoutMs);
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  /**
   * Rows requested per page. The viewer and the export both walk pages of this size, so a source
   * with more rows than one response can carry is never silently truncated.
   */
  const SOURCE_PAGE_SIZE = 500;

  // Retired: the eye said nothing about WHAT is being shown (local copy or server rows), so the view
  // action now uses the table glyph, and the Excel export moved into the viewer modal where the
  // copy on screen can be named. Kept as comments so a future edit does not re-invent them.
  const ICO_CLOUD = `<!-- retired: the "in library" cloud icon no longer has a meaning on a source row -->`;
  /** Two arrows in a circle — "this source and the server disagree; send the local values up". */
  const ICO_SYNC = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6h2a8 8 0 0 0-8-8zm0 14a6 6 0 0 1-6-6H4a8 8 0 0 0 8 8v3l4-4-4-4v3z"/></svg>`;
  const ICO_STAR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const ICO_STAR_OUT = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;
  const ICO_OPEN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>`;
  const ICO_RENAME = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5zm16.7-11.2a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5 1.6-1.6z"/></svg>`;
  const ICO_RELOAD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 1 6.5 4.4l1.9-1.1V13h-4.7l1.8-1A5 5 0 1 0 12 17v2a7 7 0 1 1 0-14z"/></svg>`;
  const ICO_GLOBE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15 15 0 0 0-1.3-3.4A8 8 0 0 1 18.9 8zM12 4.2c.7 1 1.3 2.3 1.7 3.8h-3.4A14 14 0 0 1 12 4.2zM4.3 14A8 8 0 0 1 4 12c0-.7.1-1.4.3-2h3.4a17 17 0 0 0 0 4H4.3zm.8 2h3a15 15 0 0 0 1.3 3.4A8 8 0 0 1 5.1 16zm3-8h-3A8 8 0 0 1 8.4 4.6 15 15 0 0 0 7.1 8zM12 19.8a14 14 0 0 1-1.7-3.8h3.4a14 14 0 0 1-1.7 3.8zm2.1-5.8H9.9a15 15 0 0 1 0-4h4.2a15 15 0 0 1 0 4zm.5 5.4a15 15 0 0 0 1.3-3.4h3a8 8 0 0 1-4.3 3.4zm1.7-5.4a17 17 0 0 0 0-4h3.4c.2.6.3 1.3.3 2s-.1 1.4-.3 2h-3.4z"/></svg>`;
  const ICO_ADD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>`;
  const ICO_SHIELD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2l7 3v6c0 4.4-3 8-7 11-4-3-7-6.6-7-11V5l7-3zm0 2.2L7 6v5c0 3.4 2.1 6.2 5 8.7 2.9-2.5 5-5.3 5-8.7V6l-5-1.8zM10.9 9.6l1.9 1.9 3.4-3.4 1.1 1.1-4.5 4.5-3-3 1.1-1.1z"/></svg>`;
  //
  // The two data-copy icons: a small table. Tinted green for the server's copy and grey for this
  // browser's, so "which data am I about to look at?" is answered by colour before the tooltip.
  const ICO_DATA = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v3H3V5a1 1 0 0 1 1-1zm-1 6h18v3H3v-3zm0 5h18v3H3v-3zm0 5h18v.5a.5.5 0 0 1-.5.5h-17a.5.5 0 0 1-.5-.5V20z"/></svg>`;

  function iconBtn(cls, title, iconHtml, extra = "") {
    return `<button type="button" class="ds-icon-btn ${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${extra}>${iconHtml}</button>`;
  }

  async function renameLibrarySource(sourceId, currentTitle) {
    const next = window.DaNotify?.prompt
      ? await DaNotify.prompt(t("sources.renamePrompt"), {
          title: t("sources.rename"),
          value: currentTitle || "",
          okText: t("common.save"),
          cancelText: t("common.cancel"),
          maxLength: 200
        })
      : (() => {
          const v = window.prompt(t("sources.renamePrompt"), currentTitle || "");
          return v == null ? null : String(v).trim() || null;
        })();
    if (next == null || next === currentTitle) return;
    try {
      const res = await fetch(`/api/datasources/${sourceId}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t("sources.renameFail"));
      }
      notify(t("sources.renamed"), "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.renameFail"), "error");
    }
  }

  /**
   * Share an owned source with every user, or take that sharing back.
   *
   * Confirmed first because it is not a cosmetic toggle: once public, every user can read and write
   * this source's cells and use it as a step/condition target, and the change is not something they
   * would notice until they see someone else's data in it.
   */
  async function togglePublic(sourceId, makePublic) {
    const msg = makePublic
      ? (t("sources.makePublicConfirm") || "این منبع برای همه کاربران قابل مشاهده و استفاده می‌شود. مطمئنید؟")
      : (t("sources.makePrivateConfirm") || "این منبع دیگر برای سایر کاربران نمایش داده نمی‌شود. مطمئنید؟");
    if (window.DaNotify?.confirm) {
      const ok = await DaNotify.confirm(msg, {
        title: makePublic ? (t("sources.makePublic") || "عمومی کردن") : (t("sources.makePrivate") || "خصوصی کردن"),
        okText: t("common.confirm") || "تأیید",
        cancelText: t("common.cancel"),
        danger: false
      });
      if (!ok) return;
    }
    try {
      const res = await fetch(`/api/datasources/${sourceId}/public`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: makePublic })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t("sources.publicFail") || "تغییر وضعیت اشتراک‌گذاری ناموفق بود.");
      }
      notify(makePublic
        ? (t("sources.publicOn") || "منبع عمومی شد.")
        : (t("sources.publicOff") || "منبع خصوصی شد."), "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.publicFail") || "تغییر وضعیت اشتراک‌گذاری ناموفق بود.", "error");
    }
  }

  /**
   * Create an empty shared source from the button above the list.
   *
   * Only a ProcessManager/Admin sees the button (the server enforces the same rule), because a
   * public source is a team-level artefact. The user gives it a title and a first column, and the
   * grid is then filled from the viewer like any other source.
   */
  async function createPublicSource() {
    const title = window.DaNotify?.prompt
      ? await DaNotify.prompt(t("sources.publicNewPrompt") || "عنوان منبع عمومی:", {
          title: t("sources.createPublic") || "ایجاد منبع عمومی",
          value: "",
          okText: t("common.create") || "ایجاد",
          cancelText: t("common.cancel"),
          maxLength: 200
        })
      : window.prompt(t("sources.publicNewPrompt") || "عنوان منبع عمومی:");
    if (title == null) return;
    const name = String(title).trim();
    if (!name) return;
    try {
      const res = await fetch("/api/datasources/public", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        // One starter column so the source is immediately usable as a write target; the grid can
        // add or rename columns afterwards from an account that may reshape it.
        body: JSON.stringify({
          title: name,
          columns: [{ key: "c1", title: "c1" }],
          columnCount: 1,
          rowCount: 1,
          cells: [{ key: "c1", index: 0, cellValue: "" }]
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t("sources.publicCreateFail") || "ساخت منبع عمومی ناموفق بود.");
      }
      notify(t("sources.publicCreated") || "منبع عمومی ساخته شد.", "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.publicCreateFail") || "ساخت منبع عمومی ناموفق بود.", "error");
    }
  }

  /**
   * Merge this source's local-run results back into the server.
   *
   * The writes live in the task record the extension wrote (`locallyRunSources`), so they are read
   * from the local task cache and posted exactly like the panel's Sync used to be — the server
   * checks each cell against its own current value, writes the ones nobody else touched and keeps
   * its own newer value where they disagree. The row's "needs sync" badge clears when it is done.
   */
  async function syncSourceWithServer(sourceId, title, btn) {
    const sid = Number(sourceId);
    if (!Number.isFinite(sid) || sid <= 0) return;
    const msg = t("sources.syncConfirm", { title: title || "" })
      || `تغییرات محلی منبع «${title}» با دادهٔ سرور بررسی و ادغام می‌شود. ادامه می‌دهید؟`;
    const ask = window.DaNotify?.confirm
      ? await DaNotify.confirm(msg, {
          title: t("sources.syncNow") || "همگام‌سازی با سرور",
          okText: t("common.confirm") || "تأیید",
          cancelText: t("common.cancel")
        })
      : window.confirm(msg);
    if (!ask) return;
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    try {
      // Ask the extension what the run actually wrote before reading this page's copy of it.
      await refreshLocalTasksFromExtension();
      // Collect this source's pending cells from every task that recorded some.
      const tasks = readTasks();
      let applied = 0, unchanged = 0, conflicts = 0, skipped = 0, syncedTasks = 0;
      for (const task of tasks) {
        const cells = (Array.isArray(task.locallyRunSources) ? task.locallyRunSources : [])
          .filter((c) => Number(c?.dataSourceId) === sid);
        if (!cells.length) continue;
        const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/sync-local-run`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localRunAt: task.lastLocalRunAt || null, cells })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.syncFail") || "همگام‌سازی ناموفق بود.");
        applied += Number(body.applied) || 0;
        unchanged += Number(body.unchanged) || 0;
        skipped += Number(body.skipped) || 0;
        conflicts += Array.isArray(body.conflicts) ? body.conflicts.length : 0;
        syncedTasks += 1;
        // Drop just this source's cells from the task's pending list; keep any other source's.
        const idx = tasks.findIndex((x) => String(x.id) === String(task.id));
        if (idx >= 0) {
          const rest = (tasks[idx].locallyRunSources || []).filter((c) => Number(c?.dataSourceId) !== sid);
          tasks[idx] = {
            ...tasks[idx],
            locallyRunSources: rest.length ? rest : null,
            localRunPendingSync: rest.length ? tasks[idx].localRunPendingSync : false
          };
        }
      }
      if (syncedTasks === 0) {
        // Nothing was sent, so nothing may be presented as synced: the badge stays and the server's
        // flag is left alone. Use the local view of the source to see what this browser does hold.
        notify(t("sources.syncNothingKept")
          || "تغییر محلیِ قابل ارسالی برای این منبع در این مرورگر نیست؛ بَج دست‌نخورده ماند.", "warn");
      } else {
        writeTasks(tasks);
        // The server now holds the merged value of every cell, so the BROWSER copy is rebuilt from it.
        // Without this the two views kept disagreeing after a "successful" sync, and the local view
        // still showed the values the server had just refused (a conflict keeps the server's value).
        try {
          const fresh = await fetchSourceContent(sid);
          fresh.id = sid;
          persistLocalGridCopy(fresh);
          if (Number(viewerState.sourceId) === sid) {
            viewerState.lastSource = fresh;
            viewerState.localDirty = false;
          }
        } catch { /* keep the old record; reopening the view re-reads it */ }
        notify(
          conflicts > 0
            ? (t("sources.syncedConflicts", { applied, conflicts }) || `همگام‌سازی انجام شد — ${applied} سلول نوشته شد · ${conflicts} سلول روی سرور تازه‌تر بود.`)
            : (t("sources.synced", { applied }) || `همگام‌سازی انجام شد — ${applied} سلول نوشته شد.`),
          conflicts > 0 ? "warn" : "success"
        );
        if (skipped > 0) notify(t("sources.syncSkipped", { n: skipped }) || `${skipped} سلول قابل اعمال نبود.`, "warn");
      }
      await renderAsync();
      window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
    } catch (e) {
      notify(e.message || t("sources.syncFail") || "همگام‌سازی ناموفق بود.", "error");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    }
  }

  /**
   * Add a public source to one of the caller's processes.
   *
   * This is the action that used to live in the diagram editor; the sources list is where a source
   * is picked, so the button lives on the source's own row now. The server decides whether the
   * chosen process may use it (the access list the manager edits), and a refusal is shown verbatim.
   */
  async function attachPublicToProcess(sourceId, title) {
    const sid = Number(sourceId);
    if (!Number.isFinite(sid) || sid <= 0) return;
    let list;
    try {
      const res = await fetch("/api/tasks", { credentials: "same-origin" });
      list = await res.json();
    } catch {
      notify(t("sources.attachLoadFail") || "بارگذاری فهرست فرآیندها ناموفق بود.", "error");
      return;
    }
    const rows = Array.isArray(list) ? list.filter((t) => t.canChangeDataSource !== false) : [];
    if (!rows.length) {
      notify(t("sources.attachNoProcess") || "فرآیندی برای افزودن این منبع وجود ندارد.", "info");
      return;
    }
    const pick = await (window.DaNotify?.prompt
      ? DaNotify.prompt(
          (t("sources.attachPickPrompt") || "فرآیند مقصد را انتخاب کنید:") + "\n" + rows.map((r) => `#${r.id} ${r.title}`).join("\n"),
          { title: t("sources.attachToProcess") || "افزودن به فرآیند", value: String(rows[0].id), okText: t("common.confirm") || "افزودن" })
      : window.prompt(t("sources.attachPickPrompt") || "شناسهٔ فرآیند:", String(rows[0].id)));
    if (pick == null) return;
    const taskId = String(pick).trim();
    if (!/^\d+$/.test(taskId)) {
      notify(t("sources.attachBadProcess") || "شناسهٔ فرآیند نامعتبر است.", "warn");
      return;
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}/datasources/${sid}/attach`, {
        method: "POST",
        credentials: "same-origin"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.attachFail") || "افزودن منبع ناموفق بود.");
      notify((t("sources.attached", { title }) || `منبع «${title}» به فرآیند ${taskId} اضافه شد.`), "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.attachFail") || "افزودن منبع ناموفق بود.", "error");
    }
  }

  /**
   * The «دسترسی فرآیندها» dialog for a public source: the checkbox that lets any process use it,
   * plus a process list whose ticked rows are the processes that may attach it.
   *
   * Server-state first, then writes back the whole state in one call — which attaches the newly
   * ticked processes, detaches the explicitly unticked ones and stores the blanket flag, so the
   * permission and the actual usage can never drift apart.
   */
  async function openAccessDialog(sourceId, title) {
    const sid = Number(sourceId);
    if (!Number.isFinite(sid) || sid <= 0) return;
    let state;
    try {
      const res = await fetch(`/api/datasources/${sid}/access`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`access ${res.status}`);
      state = await res.json();
    } catch {
      notify(t("sources.accessLoadFail") || "بارگذاری دسترسی‌ها ناموفق بود.", "error");
      return;
    }
    const selected = new Set((state.grantedProcessIds || []).map((x) => Number(x)));
    // Everything linked but not granted still counts as "may use it" — it is attached, so its row
    // must read as ticked, otherwise saving would silently revoke a working attachment.
    (state.linkedProcessIds || []).forEach((x) => selected.add(Number(x)));
    const rows = (state.processes || []).map((p) => {
      const checked = selected.has(Number(p.id));
      return `<label class="ds-access-row${p.canManage === false ? " is-readonly" : ""}">
        <input type="checkbox" data-access-pid="${p.id}" ${checked ? "checked" : ""} ${p.canManage === false ? "disabled" : ""} />
        <span class="ds-access-title">${escapeHtml(p.title || `#${p.id}`)}</span>
        <span class="ds-access-sub">${escapeHtml(p.ownerUserName || "")}${p.linked ? " · متصل" : ""}</span>
      </label>`;
    }).join("");

    const backdrop = document.createElement("div");
    backdrop.className = "da-confirm-backdrop ds-access-backdrop";
    backdrop.innerHTML = `
      <div class="da-confirm-box ds-access-box" role="dialog" aria-modal="true">
        <div class="da-confirm-title">${escapeHtml(t("sources.manageAccess") || "دسترسی فرآیندها")}</div>
        <div class="da-confirm-msg">${escapeHtml(title || "")}</div>
        <label class="ds-access-all">
          <input type="checkbox" id="ds-access-all" ${state.allProcesses ? "checked" : ""} />
          <span>${escapeHtml(t("sources.accessAll") || "همهٔ فرآیندها بتوانند از این منبع استفاده کنند")}</span>
        </label>
        <div class="ds-access-list">${rows || `<div class="da-field-hint">${escapeHtml(t("sources.accessNoProcess") || "فرآیندی برای نمایش نیست.")}</div>`}</div>
        <div class="da-confirm-actions">
          <button type="button" class="da-confirm-cancel">${escapeHtml(t("common.cancel") || "انصراف")}</button>
          <button type="button" class="da-confirm-ok">${escapeHtml(t("common.save") || "ذخیره")}</button>
        </div>
      </div>`;
    document.documentElement.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("da-confirm-in"));

    const close = () => {
      backdrop.classList.remove("da-confirm-in");
      setTimeout(() => backdrop.remove(), 160);
    };
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) close(); });
    backdrop.querySelector(".da-confirm-cancel")?.addEventListener("click", close);
    backdrop.querySelector(".da-confirm-ok")?.addEventListener("click", async () => {
      const all = backdrop.querySelector("#ds-access-all")?.checked === true;
      const processIds = [];
      const detachIds = [];
      backdrop.querySelectorAll("[data-access-pid]").forEach((inp) => {
        const pid = Number(inp.getAttribute("data-access-pid"));
        if (!Number.isFinite(pid)) return;
        if (inp.checked) processIds.push(pid);
        else if (selected.has(pid)) detachIds.push(pid); // was granted/linked, now unticked
      });
      try {
        const res = await fetch(`/api/datasources/${sid}/access`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allProcesses: all, processIds, detachProcessIds: detachIds })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.accessSaveFail") || "ذخیرهٔ دسترسی‌ها ناموفق بود.");
        notify(
          (t("sources.accessSaved", { attached: Number(body.attached) || 0, detached: Number(body.detached) || 0 })
            || `دسترسی ذخیره شد — ${Number(body.attached) || 0} فرآیند افزوده و ${Number(body.detached) || 0} فرآیند جدا شد.`),
          "success"
        );
        close();
        await renderAsync();
      } catch (e) {
        notify(e.message || t("sources.accessSaveFail") || "ذخیرهٔ دسترسی‌ها ناموفق بود.", "error");
      }
    });
  }

  /** Open the OS file picker and resolve the chosen spreadsheet, or null when cancelled. */
  function pickSourceFile() {
    const pick = document.createElement("input");
    pick.type = "file";
    pick.accept = ".xlsx,.xlsm,.csv";
    pick.hidden = true;
    document.body.appendChild(pick);
    return new Promise((resolve) => {
      pick.addEventListener("change", () => resolve(pick.files?.[0] || null), { once: true });
      pick.click();
      // The element is removed by the caller once the promise settles, so a cancelled picker (which
      // may never fire `change`) cannot leave a stray input in the page.
      setTimeout(() => { if (!pick.files?.length) { pick.remove(); resolve(null); } }, 120000);
    });
  }

  /**
   * Parse a spreadsheet SERVER-SIDE without writing anything.
   *
   * `/Panel/Tasks/ParseExcel` only converts the upload into columns+cells; it stores nothing. That is
   * what makes it usable for a LOCAL reload too: the parse is a read, and where the values land is
   * decided by the caller.
   */
  async function parseSourceFile(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/Panel/Tasks/ParseExcel", {
      method: "POST",
      credentials: "same-origin",
      body: fd
    });
    if (!res.ok) throw new Error(t("sources.reloadParseFail") || "فایل اکسل خوانده نشد.");
    const parsed = await res.json();
    if (!parsed || !Array.isArray(parsed.columns) || !parsed.columns.length) {
      throw new Error(t("sources.reloadNoColumns") || "فایل اکسل ستون معتبری ندارد.");
    }
    return parsed;
  }

  /**
   * Replace the file behind a library source without changing its id, title or process links.
   *
   * A process node binds a source *column by name*, so if the new file dropped a column that a
   * step still reads the step would break mid-play. We therefore analyse first and list the exact
   * steps before anything is written; the user can still go ahead deliberately.
   */
  async function reloadLibrarySource(sourceId, currentTitle) {
    const file = await pickSourceFile();
    if (!file) return;

    let parsed;
    try {
      parsed = await parseSourceFile(file);
    } catch (e) {
      notify(e.message || t("sources.reloadParseFail") || "فایل اکسل خوانده نشد.", "error");
      return;
    }
    await reloadSourceWithParsedFile(sourceId, currentTitle, file, parsed);
  }

  /**
   * Replace a source's content on the SERVER with an already parsed file.
   *
   * Split out of `reloadLibrarySource` so the viewer's own button can reuse the exact same flow
   * (compatibility analysis first, then the replace) with a file it has already read.
   */
  async function reloadSourceWithParsedFile(sourceId, currentTitle, file, parsed) {
    const payload = {
      fileName: file.name,
      columns: parsed.columns,
      columnKeys: parsed.columnKeys || parsed.columns.map((c) => c.key),
      cells: parsed.cells || [],
      columnCount: parsed.columnCount,
      rowCount: parsed.rowCount
    };

    // Dry run first — the server tells us which steps would lose a column they read.
    let compat = null;
    try {
      const res = await fetch(`/api/datasources/${sourceId}/analyze-columns`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) compat = await res.json();
    } catch { /* the real call re-checks server-side anyway */ }

    let force = false;
    if (compat && compat.missingColumns && compat.missingColumns.length) {
      const ok = await confirmMissingColumns(compat, currentTitle);
      if (!ok) return;
      force = true;
    } else if (!confirm((t("sources.reloadConfirm") || "محتوای منبع «{title}» با فایل «{file}» جایگزین شود؟")
      .replace("{title}", currentTitle || "").replace("{file}", file.name))) {
      return;
    }

    try {
      const res = await fetch(`/api/datasources/${sourceId}/reload`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, force })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body && body.compatibility && body.compatibility.missingColumns?.length) {
          await confirmMissingColumns(body.compatibility, currentTitle);
        } else {
          notify(body.message || t("sources.reloadFail") || "بارگذاری مجدد انجام نشد.", "error");
        }
        return;
      }
      notify((t("sources.reloaded") || "منبع «{title}» بازخوانی شد ({rows} ردیف).")
        .replace("{title}", body.dataSourceTitle || currentTitle || "")
        .replace("{rows}", String(body.rowCount ?? 0)), "success");
      await renderAsync();
    } catch (e) {
      notify(e.message || t("sources.reloadFail") || "بارگذاری مجدد انجام نشد.", "error");
    }
  }

  /**
   * Drop this browser's pending run writes for one source.
   *
   * Their addresses describe the shape the run loaded. Once that shape is replaced (a new file
   * loaded locally, a cleared local grid) those cells no longer exist locally, so keeping them
   * would only make the next sync write into rows this copy cannot see.
   */
  function dropPendingWritesForSource(sourceId) {
    const sid = Number(sourceId);
    if (!Number.isFinite(sid)) return;
    const tasks = readTasks();
    let changed = false;
    const next = tasks.map((task) => {
      const writes = Array.isArray(task?.locallyRunSources) ? task.locallyRunSources : [];
      if (!writes.some((w) => Number(w?.dataSourceId) === sid)) return task;
      const kept = writes.filter((w) => Number(w?.dataSourceId) !== sid);
      changed = true;
      return { ...task, locallyRunSources: kept.length ? kept : null, localRunPendingSync: kept.length > 0 };
    });
    if (changed) writeTasks(next);
  }

  /**
   * Load a replacement file into the BROWSER copy of the open source.
   *
   * The values are applied to the grid this browser loaded (and to the process snapshot that a local
   * run reads), so the run will use the new file — while the server keeps the file it has. That is
   * the whole contract of the local view: look at it, edit it, and only the sync button ever moves
   * values to the server.
   */
  function applyLocalReload(sourceId, parsed, fileName) {
    const ds = viewerState.lastSource || viewerSource();
    if (!ds) return;
    ds.columns = parsed.columns || [];
    ds.columnKeys = parsed.columnKeys || (parsed.columns || []).map((c) => c.key);
    ds.cells = (parsed.cells || []).map((c) => ({ ...c }));
    ds.columnCount = parsed.columnCount ?? ds.columnKeys.length;
    ds.rowCount = parsed.rowCount ?? Math.max(0, ds.cells.length);
    if (fileName) ds.fileName = fileName;
    viewerState.lastSource = ds;
    viewerState.page = 0;
    viewerState.cellRevisions = null;
    viewerState.cellMeta = null;
    // The old addresses are gone with the old shape.
    dropPendingWritesForSource(sourceId);
    viewerState.localDirty = false;
    viewerState.localCopy = true;
    setLocalNote(true);
    persistLocalGridCopy(ds);
    renderViewerTable(ds);
    notify(t("sources.reloadLocalDone")
      || "فایل جدید در نسخهٔ محلی بارگذاری شد؛ اطلاعات سرور تغییر نکرد.", "success");
  }

  /**
   * The viewer's «بارگذاری مجدد فایل» button.
   *
   * One entry point, two destinations: in the local view the parsed file replaces this browser's
   * copy, and in the server view it goes through the normal analyse-then-reload path so the server's
   * data is what changes. Keeping the button here (instead of on the row) also means it always acts
   * on the copy the operator is actually looking at.
   */
  async function reloadFromModal() {
    const sourceId = Number(viewerState.sourceId);
    if (!Number.isFinite(sourceId) || sourceId <= 0) return;
    const title = viewerState.lastSource?.title || viewerSource()?.title || "";
    const file = await pickSourceFile();
    if (!file) return;
    let parsed;
    try {
      parsed = await parseSourceFile(file);
    } catch (e) {
      notify(e.message || t("sources.reloadParseFail") || "فایل اکسل خوانده نشد.", "error");
      return;
    }
    if (viewerState.localCopy) {
      const ask = window.DaNotify?.confirm
        ? await DaNotify.confirm(
            t("sources.reloadLocalConfirm", { title, file: file.name })
              || `فایل «${file.name}» فقط در نسخهٔ محلی منبع «${title}» بارگذاری شود؟ اطلاعات سرور تغییری نمی‌کند.`,
            { title: t("sources.reloadFile") || "بارگذاری مجدد فایل", okText: t("common.yes") || "بله" })
        : window.confirm(`فایل «${file.name}» فقط در نسخهٔ محلی بارگذاری شود؟`);
      if (!ask) return;
      applyLocalReload(sourceId, parsed, file.name);
      return;
    }
    // Server view: reuse the full path (compatibility analysis + server replace) with the file we
    // already have, so the user is not asked to pick it a second time.
    await reloadSourceWithParsedFile(sourceId, title, file, parsed);
  }

  /**
   * The local view's «ریست دیتا از سرور» button.
   *
   * It does NOT empty anything: the server's current rows are fetched once and become the local copy
   * again, which is how a local run that drifted (or a local file load that went wrong) gets back to
   * a known state without touching the server.
   */
  async function resetLocalFromServer() {
    const sourceId = Number(viewerState.sourceId);
    if (!Number.isFinite(sourceId) || sourceId <= 0) return;
    // The direction is spelled out, because the opposite direction (send local results UP) is the
    // action an operator usually wants here and the two used to be one easy-to-confuse glyph.
    const msg = t("sources.resetLocalConfirm")
      || "دادهٔ سرور دوباره برای نسخهٔ محلی خوانده می‌شود و نتیجهٔ اجرای محلیِ سینک‌نشده از بین می‌رود (دادهٔ سرور تغییری نمی‌کند). ادامه می‌دهید؟";
    const ask = window.DaNotify?.confirm
      ? await DaNotify.confirm(msg, {
          title: t("sources.resetLocal") || "بازسازی نسخهٔ محلی از سرور",
          okText: t("sources.resetLocalOk") || "جایگزین کن",
          cancelText: t("common.cancel") || "انصراف",
          danger: true
        })
      : window.confirm(msg);
    if (!ask) return;
    const btn = document.getElementById("da-portal-ds-reset");
    if (btn) btn.disabled = true;
    try {
      const fresh = await fetchSourceContent(sourceId);
      fresh.id = sourceId;
      // The local copy becomes exactly the server's again, so the pending writes that described the
      // old copy no longer mean anything.
      dropPendingWritesForSource(sourceId);
      viewerState.lastSource = fresh;
      viewerState.page = 0;
      viewerState.localDirty = false;
      viewerState.localCopy = true;
      setLocalNote(true);
      persistLocalGridCopy(fresh);
      renderViewerTable(fresh);
      syncViewerModeChrome();
      notify(t("sources.resetLocalDone") || "نسخهٔ محلی از دادهٔ سرور بازسازی شد.", "success");
    } catch (e) {
      notify(e.message || t("sources.loadingGrid") || "بارگذاری انجام نشد.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /** Precise warning: name every process + step that reads a column the new file dropped. */
  async function confirmMissingColumns(compat, title) {
    const lines = [];
    for (const miss of compat.missingColumns || []) {
      const nodes = (miss.nodes || []).map((n) => `«${n.nodeTitle}»${n.processTitle ? ` — ${n.processTitle}` : ""}`);
      lines.push(`• ستون «${miss.columnKey}» (${miss.columnTitle}) توسط: ${nodes.join("، ")}`);
    }
    const head = (t("sources.reloadMissingHead")
      || "این ستون‌ها در فایل جدید نیستند ولی گره‌های زیر به آن‌ها وابسته‌اند:");
    const foot = (t("sources.reloadMissingFoot")
      || "اگر ادامه دهید، این گره‌ها مقدار لازم را پیدا نمی‌کنند. ادامه می‌دهید؟");
    const text = `${head}\n\n${lines.join("\n")}\n\n${foot}\n(${title || ""})`;
    if (window.DaNotify?.confirm) {
      return !!(await DaNotify.confirm(text, {
        title: t("sources.reloadMissingTitle") || "ستون‌های وابسته حذف شده‌اند",
        okText: t("common.confirm") || "ادامه",
        cancelText: t("common.cancel"),
        danger: true
      }));
    }
    return confirm(text);
  }

  async function fetchLibrarySources() {
    try {
      const res = await fetch("/api/datasources", { credentials: "same-origin" });
      const list = await res.json();
      if (!Array.isArray(list)) return null;
      return list.map((d) => ({
        taskId: null,
        taskTitle: (d.linkedProcessTitles && d.linkedProcessTitles.length)
          ? d.linkedProcessTitles.join("، ")
          : (d.linkedProcessCount ? `${d.linkedProcessCount} فرآیند` : "— (کتابخانه)"),
        ds: {
          id: d.id,
          title: d.title,
          fileName: d.fileName,
          columnCount: d.columnCount,
          rowCount: d.rowCount,
          columnKeys: d.columnKeys || [],
          columns: d.columns || [],
          cells: d.cells || [],
          // Carried through so the row can badge a shared source and hide the buttons the server
          // would refuse anyway (a public source's shape is not the reader's to change).
          isPublic: d.isPublic === true,
          // Owner or ProcessManager/Admin: may open the «دسترسی فرآیندها» dialog for this source.
          canManageAccess: d.canManageAccess === true,
          ownerUserName: d.ownerUserName || null,
          // True while a local run's changes for this source have not been synced; the row shows the
          // sync badge so "somewhere there is a newer copy" is visible instead of remembered.
          needsSync: d.needsSync === true,
          canEditStructure: d.canEditStructure !== false
        },
        isMaster: false,
        fromLibrary: true,
        linkedProcessCount: d.linkedProcessCount || 0
      }));
    } catch {
      return null;
    }
  }

  function collectSources() {
    const tasks = readTasks();
    const rows = [];
    tasks.forEach((task) => {
      const list = Array.isArray(task.graph?.dataSources) ? task.graph.dataSources : [];
      const masterId = task.graph?.nodes?.find((n) => n.kind === "start")?.dataSourceId
        ?? task.graph?.masterDataSourceId
        ?? null;
      list.forEach((ds) => {
        rows.push({
          taskId: task.id,
          taskTitle: task.title || "بدون عنوان",
          ds,
          isMaster: masterId != null && Number(ds.id) === Number(masterId),
          fromLibrary: false
        });
      });
    });
    rows.sort((a, b) => String(a.taskTitle).localeCompare(String(b.taskTitle), "fa")
      || String(a.ds.title || a.ds.fileName || "").localeCompare(String(b.ds.title || b.ds.fileName || ""), "fa"));
    return rows;
  }

  function findEntry(taskId, sourceId) {
    const tasks = readTasks();
    const task = tasks.find((t) => String(t.id) === String(taskId));
    if (!task?.graph) return null;
    const ds = (task.graph.dataSources || []).find((d) => Number(d.id) === Number(sourceId));
    if (!ds) return null;
    return { tasks, task, ds };
  }

  function dataSourceSafeFileName(ds) {
    const raw = (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || ds?.title
      || "data-source";
    return String(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "data-source";
  }

  /**
   * Download name of a source, which is the source's own name (title), not the file it was
   * imported from. The imported file name is only a fallback for sources that have no title.
   */
  function dataSourceDownloadName(ds) {
    const raw = (ds?.title && String(ds.title).trim())
      || (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || "data-source";
    return String(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "data-source";
  }

  function dataSourceTableRows(ds) {
    const keys = Array.isArray(ds?.columnKeys) && ds.columnKeys.length
      ? ds.columnKeys.map(String)
      : (ds?.columns || []).map((c) => String(c.key || c.Key || "")).filter(Boolean);
    const cols = Array.isArray(ds?.columns) && ds.columns.length
      ? ds.columns.map((c) => ({
          key: String(c.key || c.Key || ""),
          title: String(c.title || c.Title || c.key || c.Key || "")
        })).filter((c) => c.key)
      : keys.map((k) => ({ key: k, title: k }));
    const headers = cols.map((c) => c.title || c.key);
    const colKeys = cols.map((c) => c.key);
    const cells = Array.isArray(ds?.cells) ? ds.cells : [];
    const byRow = new Map();
    cells.forEach((cell) => {
      const idx = Number(cell.index ?? cell.Index ?? 0);
      if (!Number.isFinite(idx)) return;
      if (!byRow.has(idx)) byRow.set(idx, {});
      const key = String(cell.key || cell.Key || "");
      byRow.get(idx)[key] = cell.cellValue ?? cell.CellValue ?? "";
    });
    const indexes = [...byRow.keys()].sort((a, b) => a - b);
    const rows = indexes.map((idx) => {
      const map = byRow.get(idx) || {};
      return colKeys.map((k) => map[k] ?? "");
    });
    return { headers, colKeys, columns: cols, rows, cells };
  }

  function downloadBlobFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadAsCsv(ds) {
    const { headers, rows } = dataSourceTableRows(ds);
    const escCsv = (v) => {
      const s = String(v ?? "");
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.map(escCsv).join(",")].concat(rows.map((r) => r.map(escCsv).join(",")));
    downloadBlobFile(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${dataSourceSafeFileName(ds)}.csv`);
  }

  /**
   * Read a source's current content straight from the server.
   *
   * Everything that shows or exports source data must go through this. The local cache is a
   * snapshot taken when the page loaded (and the canvas list payload is a summary with no cell
   * values at all), so exporting from it could hand the user yesterday's numbers. This walks the
   * row endpoint in pages until the server says the source is exhausted, so a source larger than
   * the page size is never silently truncated either.
   */
  async function fetchSourceContent(sourceId) {
    const first = await fetch(`/api/datasources/${sourceId}/rows?from=0&count=${SOURCE_PAGE_SIZE}`,
      { credentials: "same-origin" });
    if (!first.ok) throw new Error(`rows ${first.status}`);
    const head = await first.json();

    const columns = head.columns || [];
    const columnKeys = head.columnKeys || columns.map((c) => c.key);
    const cells = [];
    const cellRevisions = {};
    const cellMeta = {};
    const mergeExtras = (page) => {
      for (const [row, cols] of Object.entries(page?.cellRevisions || {})) {
        cellRevisions[row] = Object.assign(cellRevisions[row] || {}, cols);
      }
      for (const [row, cols] of Object.entries(page?.cellMeta || {})) {
        cellMeta[row] = Object.assign(cellMeta[row] || {}, cols);
      }
    };
    const pushRows = (rows) => {
      for (const row of rows || []) {
        for (const [k, v] of Object.entries(row.values || {})) {
          cells.push({ key: k, index: row.rowIndex, cellValue: v });
        }
      }
    };
    pushRows(head.rows);
    mergeExtras(head);

    // Keep paging while the server reports more rows than we have collected.
    let got = (head.rows || []).length;
    const total = Number(head.rowCount) || got;
    while (got < total) {
      const next = await fetch(`/api/datasources/${sourceId}/rows?from=${got}&count=${SOURCE_PAGE_SIZE}`,
        { credentials: "same-origin" });
      if (!next.ok) break;
      const page = await next.json();
      const rows = page.rows || [];
      if (!rows.length) break;
      pushRows(rows);
      mergeExtras(page);
      got += rows.length;
    }

    return {
      id: Number(sourceId),
      title: head.title || "",
      fileName: head.fileName,
      columns,
      columnKeys,
      cells,
      rowCount: Math.max(total, got),
      columnCount: head.columnCount ?? columns.length,
      dataRevision: head.dataRevision,
      hexRevision: head.hexRevision,
      // Carried back so one walk serves the grid, its tooltips and its concurrency check.
      cellRevisions,
      cellMeta
    };
  }

  async function downloadSource(taskId, sourceId, btn) {
    const entry = findEntry(taskId, sourceId);
    const cached = entry?.ds || null;
    if (!entry && !(Number(sourceId) > 0)) {
      notify("منبع پیدا نشد.", "error");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-busy");
    }
    try {
      // Which copy is exported follows the view: the LOCAL view exports the browser copy (that is the
      // data the run used), the server view exports the server's current rows.
      let fresh;
      if (viewerState.localCopy) {
        fresh = buildLocalView() || viewerState.lastSource || cached;
      } else {
        try {
          fresh = await fetchSourceContent(sourceId);
        } catch {
          fresh = cached;
        }
      }
      const ds = fresh || cached;
      if (!ds) {
        notify("منبع پیدا نشد.", "error");
        return;
      }

      const table = dataSourceTableRows(ds);
      if (!table.colKeys.length) {
        notify("این منبع ستونی برای دانلود ندارد.", "error");
        return;
      }
      const payload = {
        title: dataSourceDownloadName(ds),
        columns: table.columns.map((c) => ({ key: c.key, title: c.title })),
        columnKeys: table.colKeys,
        cells: (ds.cells || []).map((c) => ({
          key: c.key || c.Key || "",
          index: Number(c.index ?? c.Index ?? 0),
          cellValue: c.cellValue ?? c.CellValue ?? ""
        }))
      };
      const res = await fetch("/Panel/Tasks/ExportExcel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/octet-stream" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `خطا در ساخت اکسل (کد ${res.status})`);
      }
      downloadBlobFile(await res.blob(), `${dataSourceDownloadName(ds)}.xlsx`);
      notify(`فایل «${dataSourceDownloadName(ds)}.xlsx» دانلود شد.`, "success");
    } catch (e) {
      try {
        downloadAsCsv(cached || {});
        notify(`اکسل در دسترس نبود — CSV دانلود شد. ${e.message || ""}`.trim(), "info");
      } catch (e2) {
        notify(e.message || e2.message || "دانلود ناموفق بود.", "error");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-busy");
      }
    }
  }

  function setMaster(taskId, sourceId) {
    const entry = findEntry(taskId, sourceId);
    if (!entry) return;
    const { tasks, task } = entry;
    const start = (task.graph.nodes || []).find((n) => n.kind === "start");
    if (start) {
      start.dataSourceId = Number(sourceId);
      start.repeatSourceType = "DataSource";
    }
    task.graph.masterDataSourceId = Number(sourceId);
    task.graph.repeatSourceType = "DataSource";
    writeTasks(tasks);
    notify("منبع پیش‌فرض فرآیند به‌روز شد.", "success");
    render();
  }

  /**
   * Source ids this browser still owes the server, from the local write log.
   *
   * The row's sync button cannot depend on the server flag alone: a local run reports its divergence
   * best-effort, and an offline/failed report would leave a diverged source with no affordance at
   * all. The pending writes are the authoritative record and they live here, in the browser.
   *
   * Computed once per list paint (the row renderer asks per row) and refreshed by paintRows.
   */
  let localDivergentCache = new Set();
  function localDivergentSourceIds() {
    return localDivergentCache;
  }

  /**
   * Process ids configured to run on this machine (`runOnServer === false`).
   *
   * Used only for the VIEW buttons: on such a process the browser copy is the copy that matters, so
   * both views must be reachable even before the first write — otherwise the local view appears only
   * after a run has already produced values, which reads as "the local data button does nothing".
   */
  let localRunTaskCache = new Set();
  function localRunTaskIds() {
    return localRunTaskCache;
  }
  /**
   * The local-run process that uses this source, if any.
   *
   * A library row carries no `taskId` (the source is shared, the process is not), so the only way to
   * know that the copy on screen belongs to this machine is to look for a locally-running process
   * that attached the source. Without this the row's local button was decided by pending writes
   * alone, i.e. it appeared only AFTER a run — which is why it looked inert beforehand.
   */
  function localRunTaskForSource(sourceId) {
    const sid = Number(sourceId);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    for (const task of readTasks()) {
      if (!task || task.runOnServer !== false) continue;
      const list = Array.isArray(task.graph?.dataSources) ? task.graph.dataSources : [];
      if (list.some((ds) => Number(ds?.id) === sid) || task.graph?.masterDataSourceId === sid) return task;
    }
    return null;
  }
  function recomputeLocalDivergence() {
    const ids = new Set();
    const runIds = new Set();
    for (const task of readTasks()) {
      if (task && task.runOnServer === false) runIds.add(String(task.id));
      const writes = Array.isArray(task?.locallyRunSources) ? task.locallyRunSources : [];
      for (const w of writes) {
        const sid = Number(w?.dataSourceId);
        if (Number.isFinite(sid) && sid > 0) ids.add(sid);
      }
    }
    localDivergentCache = ids;
    localRunTaskCache = runIds;
    return ids;
  }

  /**
   * The local-run writes this browser still owes the server for one source, and their process.
   *
   * The values live with the client that ran the process — the server only knows a source diverged —
   * so the button that sends them up can only be offered where the writes actually are.
   */
  function pendingWritesForSource(sourceId) {
    const sid = Number(sourceId);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    const tasks = readTasks();
    for (const task of tasks) {
      const writes = Array.isArray(task.locallyRunSources) ? task.locallyRunSources : [];
      const mine = writes.filter((w) => Number(w?.dataSourceId) === sid);
      if (mine.length) return { tasks, task, writes: mine };
    }
    return null;
  }

  /**
   * Send one source's local-run values to the server.
   *
   * A local run is off the server's books by design, and the divergence it leaves behind is resolved
   * here — for the source the operator is looking at, rather than for the whole process — which is
   * what makes the badge on that row actionable instead of just a warning. The writes are dropped
   * from the local record only after the server accepted them, so a failed sync loses nothing.
   */
  async function syncSourceWrites(sourceId, btn) {
    const pending = pendingWritesForSource(sourceId);
    if (!pending) {
      notify(t("sources.needsSyncHint") || "نتیجهٔ اجرای محلی برای این منبع در این مرورگر نیست.", "info");
      return;
    }
    const label = pending.task.title || `#${pending.task.id}`;
    const msg = t("tasks.syncConfirm")
      || `نتیجهٔ اجرای محلی منبع از «${label}» روی سرور نوشته می‌شود. اگر منبع روی سرور تغییر کرده باشد، ممکن است اطلاعات جایگزین یا از دست برود. ادامه می‌دهید؟`;
    const ask = window.DaNotify?.confirm
      ? await DaNotify.confirm(msg, {
          title: t("tasks.syncLocalRun") || "سینک نتیجهٔ اجرای محلی",
          okText: t("tasks.syncConfirmOk") || "سینک کن",
          cancelText: t("common.cancel") || "انصراف",
          danger: true
        })
      : window.confirm(msg);
    if (!ask) return;

    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/tasks/${pending.task.id}/sync-local-run`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localRunAt: pending.task.lastLocalRunAt || null,
          // `cells`, not `dataSources`: that is the name SyncLocalRunRequest binds, and the wrong one
          // silently synced nothing while still reporting success.
          cells: pending.writes
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "playing") {
          throw new Error(body.playerUserName
            ? `${t("sources.syncPlaying") || "فرآیند همین حالا در حال اجراست"} (${body.playerUserName})`
            : (t("sources.syncPlaying") || "فرآیند همین حالا در حال اجراست؛ بعد از پایان اجرا سینک کنید."));
        }
        throw new Error(body.message || t("tasks.syncFail") || "سینک انجام نشد.");
      }
      // The server holds these values now: forget exactly the writes it accepted, and clear the
      // process-level flag only when nothing is left for ANY of its sources.
      const tasks = pending.tasks.map((task) => {
        if (String(task.id) !== String(pending.task.id)) return task;
        const kept = (task.locallyRunSources || [])
          .filter((w) => Number(w?.dataSourceId) !== Number(sourceId));
        return { ...task, locallyRunSources: kept, localRunPendingSync: kept.length > 0 };
      });
      writeTasks(tasks);
      notify(t("tasks.syncDone") || "نتیجهٔ اجرای محلی روی سرور سینک شد.", "success");
      await renderAsync();
    } catch (e) {
      if (btn) btn.disabled = false;
      notify(String(e.message || e), "error");
    }
  }

  async function deleteSource(taskId, sourceId) {    const entry = findEntry(taskId, sourceId);
    // Library-mode row (no task): hard-delete from user library
    if (!entry && (taskId == null || taskId === "null" || taskId === "")) {
      const label = String(sourceId);
      if (!confirm(t("sources.delete") + ` #${label}؟`)) return;
      try {
        const res = await fetch(`/api/datasources/${sourceId}`, { method: "DELETE", credentials: "same-origin" });
        if (!res.ok) throw new Error("delete failed");
        notify(t("sources.delete"), "success");
        await renderAsync();
      } catch {
        notify("حذف ناموفق بود.", "error");
      }
      return;
    }
    if (!entry) return;
    const label = entry.ds.title || entry.ds.fileName || "منبع";
    // Detach from process only (local mirror)
    if (!confirm(`${t("sources.detach")}: «${label}» از «${entry.task.title || ""}»؟`)) return;
    const { tasks, task } = entry;
    task.graph.dataSources = (task.graph.dataSources || []).filter((d) => Number(d.id) !== Number(sourceId));
    const start = (task.graph.nodes || []).find((n) => n.kind === "start");
    if (start && Number(start.dataSourceId) === Number(sourceId)) {
      delete start.dataSourceId;
      const next = task.graph.dataSources[0];
      if (next) {
        start.dataSourceId = next.id;
        task.graph.masterDataSourceId = next.id;
      } else {
        delete task.graph.masterDataSourceId;
      }
    }
    // Keep column name fields on nodes — only clear matching DS ids
    (task.graph.nodes || []).forEach((n) => {
      if (Number(n.dataSourceId) === Number(sourceId) && n.kind !== "start") n.dataSourceId = null;
      if (Number(n.sourceId) === Number(sourceId)) n.sourceId = null;
      if (Number(n.selectorDataSourceId) === Number(sourceId)) n.selectorDataSourceId = null;
      if (Number(n.saveDataSourceId) === Number(sourceId)) n.saveDataSourceId = null;
    });
    task.dataSourceCount = (task.graph.dataSources || []).length;
    writeTasks(tasks);
    try {
      await fetch(`/api/tasks/${taskId}/datasources/${sourceId}`, { method: "DELETE", credentials: "same-origin" });
    } catch { /* local-only ok */ }
    closeViewer();
    notify(t("sources.detach"), "success");
    render();
  }

  let viewerState = {
    taskId: null,
    sourceId: null,
    connection: null,
    blinkTimers: new Map(),
    /** Source detail loaded by refreshViewer, for grids whose process is not in the local cache. */
    lastSource: null,
    /** rowIndex → columnKey → cellRevision, so concurrent writes can be detected. */
    cellRevisions: null,
    /** rowIndex → columnKey → {userId, userName, updatedAtUtc} for the cell tooltip. */
    cellMeta: null,
    /** 0-based page shown by the grid; a big source renders one page at a time. */
    page: 0,
    /**
     * True while the grid carries this browser's unsynced local-run values for the open source. In
     * that state the server is not allowed to repaint it: the copy on screen belongs to the client.
     */
    localDirty: false,
    /**
     * True whenever the open grid shows a browser-side copy for any reason — unsynced local-run
     * writes, or a process that is configured to run locally. The banner and the "no live updates"
     * state both key off this, because in either case the server is not the authority on screen.
     */
    localCopy: false,
    /**
     * Which copy the operator explicitly asked for: "local" (the browser's), "server", or null for
     * "decide from the divergence". A source with local-run results is opened twice from its row —
     * one icon per copy — so this is the only way the two views can differ on the same source.
     */
    forceMode: null,
    /** Timer that repaints the LOCAL view; the hub cannot reach a browser-side copy. */
    localTimer: null
  };

  /**
   * The stored browser copy of one source.
   *
   * A dedicated record on the owning process (`localSourceCopies[sourceId]`) rather than the process
   * GRAPH: the graph carries only the cells a run happened to load/touch, so rendering it showed a
   * single partial row and then nothing. This record is the full copy the local view and the next
   * local run both use.
   */
  function readLocalCopyRecord(taskId, sourceId) {
    const sid = String(Number(sourceId));
    const tasks = readTasks();
    if (taskId != null) {
      const task = tasks.find((t) => String(t.id) === String(taskId));
      const rec = task?.localSourceCopies?.[sid];
      if (rec && Array.isArray(rec.cells)) return { ...rec, id: Number(sourceId) };
    }
    // A source is an entity of its own: if THIS process has not loaded it, any process that did is a
    // better answer than re-reading the server (and the newest record wins when several hold one).
    let best = null;
    for (const t of tasks) {
      const rec = t?.localSourceCopies?.[sid];
      if (!rec || !Array.isArray(rec.cells)) continue;
      if (!best || String(rec.savedAtUtc || "") > String(best.savedAtUtc || "")) best = rec;
    }
    return best ? { ...best, id: Number(sourceId) } : null;
  }

  /** The grid the LOCAL view renders: the stored copy with the pending writes applied on top. */
  function buildLocalView() {
    const sourceId = Number(viewerState.sourceId);
    if (!Number.isFinite(sourceId)) return null;
    const stored = readLocalCopyRecord(localGridOwnerTaskId(), sourceId);
    if (!stored) {
      // No stored copy yet: fall back to whatever is on screen, as long as it is this source.
      return Number(viewerState.lastSource?.id) === sourceId ? viewerState.lastSource : null;
    }
    const view = {
      ...stored,
      cells: (stored.cells || []).map((c) => ({ ...c })),
      columns: Array.isArray(stored.columns) ? stored.columns.map((c) => ({ ...c })) : [],
      columnKeys: Array.isArray(stored.columnKeys) ? stored.columnKeys.slice() : []
    };
    applyPendingWrites(view, sourceId);
    return view;
  }

  /**
   * Make sure a stored copy exists for the open source, reading the server ONCE if this browser has
   * never built one. Everything afterwards is local.
   *
   * When there is no process to hold the record (a library row whose copies live on some other
   * process, or none at all), the read still becomes the view: the modal must open with the rows it
   * has and say they are not a local copy, rather than opening nothing at all.
   */
  async function ensureLocalCopy() {
    const sourceId = Number(viewerState.sourceId);
    if (!Number.isFinite(sourceId)) return null;
    const ownerId = localGridOwnerTaskId();
    if (!readLocalCopyRecord(ownerId, sourceId)) {
      const fresh = await fetchSourceContent(sourceId);
      fresh.id = sourceId;
      if (ownerId != null) {
        persistLocalGridCopy(fresh);
        viewerState.localCopyMissing = false;
      } else {
        // No owner to attach it to: this is a view of the server's rows, labelled as such. The
        // banner must say it plainly — otherwise the same button shows server rows one minute and
        // local rows the next, and the user reads that as "the local data is wrong".
        viewerState.localCopyMissing = true;
        viewerState.lastSource = fresh;
        return fresh;
      }
    }
    return buildLocalView();
  }

  /**
   * A local grid has no live feed: the run's writes never reach the server, so the hub cannot patch
   * this table. A slow timer repaints it from the stored browser copy instead — cheap (localStorage
   * only, no requests), and frequent enough that a running local process is visibly filling rows.
   */
  function setLocalViewTimer(on) {
    if (viewerState.localTimer) {
      clearInterval(viewerState.localTimer);
      viewerState.localTimer = null;
    }
    if (!on) return;
    viewerState.localTimer = setInterval(() => {
      if (!viewerState.localCopy || viewerState.sourceId == null) return;
      // Do not fight the inline editor: it is a DOM edit on top of the grid, and a repaint would
      // throw away the half-typed value.
      if (editingCell) return;
      const view = buildLocalView();
      if (!view) return;
      viewerState.lastSource = view;
      renderViewerTable(view);
    }, 2000);
  }

  /** Show/hide the buttons that only make sense in one of the two views. */
  function syncViewerModeChrome() {
    const reset = document.getElementById("da-portal-ds-reset");
    if (reset) reset.hidden = !viewerState.localCopy;
    // The sync button exists only when there is something to send: a local copy this browser still
    // owes the server. Showing it on a clean source would offer a no-op.
    // `pendingWritesForSource`, not `pendingWritesFor`: the wrong name threw here on EVERY local
    // view, which aborted refreshViewer before the grid was drawn — the "local data button does
    // nothing" report was this one line.
    const sync = document.getElementById("da-portal-ds-sync");
    const pending = viewerState.localCopy ? pendingWritesForSource(viewerState.sourceId) : null;
    if (sync) sync.hidden = !(pending && (pending.writes?.length || 0) > 0);
    setLocalViewTimer(viewerState.localCopy);
  }

  /**
   * Rows per grid page. A source can hold thousands of rows, so rendering them all would build a
   * huge DOM and freeze the tab; paging keeps the grid responsive and the scroll sane.
   */
  const GRID_PAGE_SIZE = 200;

  /** Show/hide the grid's busy overlay. A counter keeps nested calls from hiding it too early. */
  let gridBusyDepth = 0;
  function setGridBusy(on, textKey) {
    const el = document.getElementById("da-portal-ds-loader");
    const txt = document.getElementById("da-portal-ds-loader-text");
    if (on) gridBusyDepth++; else gridBusyDepth = Math.max(0, gridBusyDepth - 1);
    if (!el) return;
    if (txt) txt.textContent = t(textKey || "sources.working") || "در حال انجام…";
    el.hidden = gridBusyDepth === 0;
  }

  function cellKey(row, col) {
    return `${row}:${col}`;
  }

  function setLiveStatus(on, text) {
    const el = document.getElementById("da-portal-ds-live");
    if (!el) return;
    el.classList.toggle("is-on", !!on);
    el.textContent = text || (on ? "● زنده" : "● آفلاین");
  }

  /**
   * Show or hide the "may differ from the server" banner above the grid.
   *
   * It appears whenever the rows on screen are not purely the server's: a local run wrote this
   * source and the values are still waiting in this browser. Nothing is broken — the banner is what
   * turns "why is this number different on my colleague's screen?" into an answered question.
   */
  function setLocalNote(on, text) {
    const el = document.getElementById("da-portal-ds-local-note");
    if (!el) return;
    el.hidden = !on;
    if (on) {
      el.textContent = text
        || t("sources.localDifferNote")
        || "این اطلاعات از نسخهٔ محلی این مرورگر است و ممکن است با اطلاعات سرور متفاوت باشد.";
    }
  }

  /**
   * True when the process behind the open grid is configured to run on this machine.
   *
   * Its private sources are then loaded into the browser before every run, so the grid describes a
   * copy that the server only sees on sync — the banner has to say that even before any write.
   */
  function viewerProcessRunsLocally() {
    if (viewerState.taskId == null) return false;
    const row = readTasks().find((t) => String(t.id) === String(viewerState.taskId));
    return !!row && row.runOnServer === false;
  }

  /** The library row for the open source from the last painted list (it carries `isPublic`). */
  function viewerListRow() {
    const sid = Number(viewerState.sourceId);
    if (!Number.isFinite(sid)) return null;
    return (lastListRows || []).find((r) => Number(r?.ds?.id) === sid) || null;
  }

  /** Overlay this browser's unsynced run writes on freshly loaded server rows. */
  function applyPendingWrites(ds, sourceId) {
    const pending = pendingWritesForSource(sourceId);
    if (!pending || !ds) return 0;
    const tasks = pending.tasks;
    let applied = 0;
    for (const task of tasks) {
      const writes = Array.isArray(task?.locallyRunSources) ? task.locallyRunSources : [];
      for (const w of writes) {
        if (Number(w?.dataSourceId) !== Number(sourceId)) continue;
        setLocalCell(ds, Number(w.rowIndex) || 0, String(w.columnKey || ""), w.cellValue ?? "");
        applied += 1;
      }
    }
    return applied;
  }

  function flashCell(td, op) {
    if (!td) return;
    const cls = op === "write" ? "ds-flash-write" : "ds-flash-read";
    td.classList.remove("ds-flash-read", "ds-flash-write");
    void td.offsetWidth;
    td.classList.add(cls);
    const key = cellKey(td.dataset.row, td.dataset.col);
    const prev = viewerState.blinkTimers.get(key);
    if (prev) clearTimeout(prev);
    viewerState.blinkTimers.set(key, setTimeout(() => {
      td.classList.remove(cls);
      viewerState.blinkTimers.delete(key);
    }, 2800));
  }

  function applyCellToLocalStore(ev) {
    if (!ev) return null;
    const taskId = String(ev.taskId ?? ev.TaskId ?? viewerState.taskId ?? "");
    const sourceId = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    if (!taskId || !Number.isFinite(sourceId)) return null;
    const entry = findEntry(taskId, sourceId);
    if (!entry) return null;
    const { tasks, task, ds } = entry;
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "").trim();
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    if (!col) return ds;
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    if (op.includes("write")) {
      ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
      const hit = ds.cells.find((c) =>
        (c.key === col || c.Key === col)
        && Number(c.index ?? c.Index ?? c.rowIndex) === idx
      );
      const val = ev.cellValue == null && ev.CellValue == null ? "" : String(ev.cellValue ?? ev.CellValue ?? "");
      if (hit) {
        if (hit.cellValue !== undefined) hit.cellValue = val;
        else if (hit.CellValue !== undefined) hit.CellValue = val;
        else hit.value = val;
      } else {
        ds.cells.push({ key: col, index: idx, cellValue: val });
      }
      const rc = Number(ds.rowCount) || 0;
      if (idx + 1 > rc) ds.rowCount = idx + 1;
      writeTasks(tasks);
    }
    return ds;
  }

  /**
   * Ids of the live events already applied, so the two delivery paths cannot double-apply one.
   *
   * The player sends every event twice on this page: once as a window event through the extension's
   * content script and once over SignalR. A repeated cell write is harmless (it sets the same
   * value), but a structural shift is not — applying an "insert row" twice would invent a second
   * blank row. Bounded, because a long run produces a great many events.
   */
  const seenEventIds = new Set();
  function isDuplicateEvent(ev) {
    const id = String(ev?.eventId ?? ev?.EventId ?? "");
    if (!id) return false;
    if (seenEventIds.has(id)) return true;
    seenEventIds.add(id);
    if (seenEventIds.size > 200) {
      const keep = [...seenEventIds].slice(-100);
      seenEventIds.clear();
      keep.forEach((k) => seenEventIds.add(k));
    }
    return false;
  }

  /**
   * Move the viewer's cached rows to match a row inserted or removed elsewhere.
   *
   * The grid labels each cell with the row index the server gave it, so after a structural change
   * every index from the touched row down is off by one. Shifting the cache here — rather than
   * waiting for a reload — makes the new row appear at once and keeps the next read/write flash on
   * the row it really happened on. The blank row is materialised as empty cells (one per column),
   * exactly like the server's own AddRows, because a missing index would collapse the numbering.
   */
  function shiftViewerRows(ds, atIndex, delta) {
    if (!ds || !delta) return;
    const at = Number(atIndex);
    if (!Number.isFinite(at) || at < 0) return;
    const cells = Array.isArray(ds.cells) ? ds.cells : (ds.cells = []);
    const rowOf = (c) => Number(c.index ?? c.Index ?? c.rowIndex);
    const setRow = (c, v) => {
      if (c.index !== undefined) c.index = v;
      else if (c.Index !== undefined) c.Index = v;
      else c.rowIndex = v;
    };
    if (delta > 0) {
      cells.forEach((c) => { const i = rowOf(c); if (Number.isFinite(i) && i >= at) setRow(c, i + delta); });
      const keys = (ds.columnKeys || (ds.columns || []).map((c) => c.key || c.Key) || []).filter(Boolean);
      keys.forEach((key) => cells.push({ key: String(key), index: at, cellValue: "" }));
      ds.rowCount = Math.max((Number(ds.rowCount) || 0) + delta, at + 1);
    } else {
      for (let i = cells.length - 1; i >= 0; i--) {
        const idx = rowOf(cells[i]);
        if (idx === at) cells.splice(i, 1);
        else if (Number.isFinite(idx) && idx > at) setRow(cells[i], idx + delta);
      }
      ds.rowCount = Math.max(0, (Number(ds.rowCount) || 0) + delta);
    }
    // The task cache is what a library-only row does not have, so keep it in step when it exists.
    if (viewerState.taskId != null) {
      const entry = findEntry(viewerState.taskId, Number(ds.id));
      if (entry) writeTasks(entry.tasks);
    }
  }

  function handleCellEvent(ev, channel) {
    if (!ev) return;
    // A diverged grid is a browser-side copy: a hub event describes the SERVER's state and would
    // repaint it with values the run never saw. Only the local channel may touch it.
    if (channel === "hub" && (viewerState.localDirty || viewerState.localCopy)) return;
    // …and the mirror image: while the process runs on THIS machine, nothing reaches the server, so
    // its cell events must not repaint the SERVER view either. That grid is a still photo of what the
    // server holds; making it move made "live" updates look meaningful when there was nothing to be
    // live about. The two views are independent on purpose.
    if (channel === "local" && !viewerState.localCopy && viewerProcessRunsLocally()) return;
    if (isDuplicateEvent(ev)) return;
    const taskId = String(ev.taskId ?? ev.TaskId ?? "");
    const sid = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    if (taskId && viewerState.taskId != null && String(viewerState.taskId) !== taskId) return;
    const modal = document.getElementById("da-portal-ds-viewer");
    const viewing = modal && !modal.hidden && Number(viewerState.sourceId) === sid;
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    // A row was added or removed: shift the cached rows, repaint, and light the affected row. Without
    // this the inserted row stayed invisible and the next flash pointed at a neighbour's value.
    if (op === "insert" || op === "delete") {
      const target = viewerSource();
      if (target && Number(target.id) === sid) {
        shiftViewerRows(target, idx, op === "insert" ? 1 : -1);
        if (viewing) {
          renderViewerTable(target);
          const td = document.getElementById("da-portal-ds-table")
            ?.querySelector(`td[data-row="${idx}"]`);
          if (td) flashCell(td, op === "insert" ? "write" : "read");
        }
        // A row the run inserted IS a result: it has to reach the per-source record too.
        if (viewerState.localCopy) queueLocalViewPersist();
      }
      return;
    }
    const isWrite = op.includes("write");
    const hasValue = ev.cellValue != null || ev.CellValue != null;
    const val = hasValue ? String(ev.cellValue ?? ev.CellValue) : "";
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "");
    // `applyCellToLocalStore` only knows the task cache, and a source opened from this page is a
    // library row with no process behind it — so it answers null and the write used to fall through
    // to the "read" branch below: the cell kept its old value and flashed green instead of red.
    // Move the object the grid actually draws from (`viewerSource`, the server-loaded copy here) too.
    let ds = applyCellToLocalStore(ev);
    if (isWrite && hasValue && col && viewerState.sourceId != null && Number(viewerState.sourceId) === sid) {
      ds = viewerSource() || ds;
    }
    if (!viewing) return;
    const table = document.getElementById("da-portal-ds-table");
    if (isWrite && ds && hasValue && col) {
      showWrittenCell(ds, idx, col, val);
      showActor(ev);
    } else {
      const td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      flashCell(td, isWrite ? "write" : "read");
      showActor(ev);
    }
    // The local view draws from the per-source record, so what it just displayed has to reach that
    // record — otherwise the 2s repaint (or the next open) would show the pre-run grid again.
    if (viewerState.localCopy) queueLocalViewPersist();
  }

  /**
   * Write the open local grid back into its per-source record, coalesced.
   *
   * A run emits an event per cell; persisting the whole record on each one would rewrite the
   * encrypted store hundreds of times a minute. One write per quiet moment is enough, because the
   * record is only read when the grid is painted.
   */
  let localViewPersistTimer = null;
  function queueLocalViewPersist() {
    if (localViewPersistTimer) return;
    localViewPersistTimer = setTimeout(() => {
      localViewPersistTimer = null;
      if (!viewerState.localCopy || !viewerState.lastSource) return;
      persistLocalGridCopy(viewerState.lastSource);
    }, 700);
  }

  function showActor(ev) {
    const who = ev.userName || ev.UserName;
    if (!who) return;
    const el = document.getElementById("da-portal-ds-actor");
    if (el) {
      el.hidden = false;
      el.textContent = (window.DaI18n ? DaI18n.t("live.byUser", { user: who }) : `توسط ${who}`) || `توسط ${who}`;
    }
    if (window.daNotify) {
      const op = String(ev.op || ev.Op || "read").toLowerCase();
      daNotify(`${who}: ${op === "write" || op.includes("write") ? "نوشتن" : "خواندن"}`, op.includes("write") ? "warn" : "info", { ms: 2200 });
    }
  }

  /**
   * Show the value a writer just put in one cell — the player's cell event and the catalog's
   * `cell_patched` feed both land here, so a cell looks the same however the news arrived.
   *
   * The cache always moves (the next repaint draws from it). The DOM is left alone for the cell the
   * user has open in the inline editor, which would otherwise be wiped out mid-typing — the editor
   * still owns that cell and writes its own value on commit.
   */
  function showWrittenCell(ds, rowIndex, columnKey, value) {
    setLocalCell(ds, rowIndex, columnKey, value);
    const modal = document.getElementById("da-portal-ds-viewer");
    if (!modal || modal.hidden) return;
    const table = document.getElementById("da-portal-ds-table");
    let td = table?.querySelector(`td[data-row="${rowIndex}"][data-col="${CSS.escape(columnKey)}"]`);
    if (!td) {
      // The write may have grown the grid (a row with no cell yet), so repaint and look again.
      renderViewerTable(ds);
      td = table?.querySelector(`td[data-row="${rowIndex}"][data-col="${CSS.escape(columnKey)}"]`);
    } else if (!(editingCell && editingCell.td === td)) {
      td.textContent = value;
      td.title = cellTooltip(rowIndex, columnKey);
    }
    flashCell(td, "write");
  }

  /**
   * Put one `cell_patched` catalog payload on the open grid: the value, the editor's stamp, the flash.
   *
   * The payload already names the source, the row, the column and the new value, so the cell can
   * change the moment the server reports it — without a round trip and without the player's own
   * window event, which only exists while the extension's bridge is open in this tab. This is what
   * makes a library source live: it has no process to join, so the catalog feed is its only wire.
   */
  function applyCatalogCell(payload) {
    const src = payload?.source || {};
    const col = String(src.columnKey ?? src.ColumnKey ?? "");
    const ds = viewerSource();
    if (!ds || !col || (src.cellValue == null && src.CellValue == null)) return;
    const idx = Number(src.rowIndex ?? src.RowIndex ?? 0) || 0;
    setCellMeta(idx, col, src.editorUserId ?? src.EditorUserId,
      src.editorUserName ?? src.EditorUserName, src.updatedAtUtc ?? src.UpdatedAtUtc);
    showWrittenCell(ds, idx, col, String(src.cellValue ?? src.CellValue ?? ""));
  }

  async function ensureHub(taskId) {
    if (typeof signalR === "undefined") {
      setLiveStatus(false, "● بدون SignalR");
      return;
    }
    // A library row has no process to observe, so there is no play group to join (joining one named
    // "undefined" would be a lie too). It is NOT offline though: edits arrive over the catalog feed
    // and refresh this very grid — hence "آنلاین" rather than the old "آفلاین".
    const joinId = String(taskId ?? "").trim();
    if (!joinId) {
      setLiveStatus(!!window.DaCatalog, "● آنلاین");
      return;
    }
    try {
      if (viewerState.connection) {
        await viewerState.connection.stop().catch(() => {});
        viewerState.connection = null;
      }
      const conn = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/play-data")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      conn.on("cellEvent", (ev) => handleCellEvent(ev, "hub"));
      conn.onreconnecting(() => setLiveStatus(false, "● در حال اتصال…"));
      conn.onreconnected(async () => {
        await conn.invoke("JoinTask", joinId).catch(() => {});
        setLiveStatus(true, "● زنده");
      });
      conn.onclose(() => setLiveStatus(false));
      await conn.start();
      await conn.invoke("JoinTask", joinId);
      viewerState.connection = conn;
      setLiveStatus(true, "● زنده");
    } catch {
      setLiveStatus(false, "● قطع");
    }
  }

  function renderViewerTable(ds) {
    const table = document.getElementById("da-portal-ds-table");
    const titleEl = document.getElementById("da-portal-ds-title");
    const subEl = document.getElementById("da-portal-ds-sub");
    if (!table) return;
    const { headers, colKeys, rows } = dataSourceTableRows(ds);
    if (titleEl) titleEl.textContent = ds.title || dataSourceSafeFileName(ds);
    if (subEl) {
      subEl.textContent = `${colKeys.length} ستون · ${rows.length} ردیف${ds.fileName ? ` · ${ds.fileName}` : ""}`
        + ` — ${t("sources.inlineHint") || "دابل‌کلیک: ویرایش · راست‌کلیک: افزودن ردیف/ستون"}`;
    }
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>`
      + headers.map((h, ci) => `<th data-col="${escapeHtml(colKeys[ci])}" data-col-index="${ci}" title="${escapeHtml(h)}">${escapeHtml(h)}</th>`).join("")
      + `</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">ردیفی نیست — راست‌کلیک کنید و ردیف اضافه کنید</td></tr>`;
      renderViewerPager(0, 0);
      return;
    }
    // Only the current page is materialised. The row's real index travels in data-row, so editing,
    // the tooltip and the revision lookup keep working against the true row, not the page offset.
    const totalPages = Math.max(1, Math.ceil(rows.length / GRID_PAGE_SIZE));
    if (viewerState.page >= totalPages) viewerState.page = totalPages - 1;
    if (viewerState.page < 0) viewerState.page = 0;
    const from = viewerState.page * GRID_PAGE_SIZE;
    const slice = rows.slice(from, from + GRID_PAGE_SIZE);
    tbody.innerHTML = slice.map((r, i) => {
      const rowIndex = from + i;
      return `<tr><th class="ds-row-idx" data-row-index="${rowIndex}">${(rowIndex + 1).toLocaleString("fa-IR")}</th>${r.map((v, ci) =>
        `<td data-row="${rowIndex}" data-col="${escapeHtml(colKeys[ci])}" title="${escapeHtml(cellTooltip(rowIndex, colKeys[ci]))}">${escapeHtml(v)}</td>`
      ).join("")}</tr>`;
    }).join("");
    renderViewerPager(rows.length, totalPages);
  }

  /** Show/hide and fill the pager; hidden entirely for a source that fits in one page. */
  function renderViewerPager(totalRows, totalPages) {
    const foot = document.getElementById("da-portal-ds-pager");
    const info = document.getElementById("da-portal-ds-pageinfo");
    const prev = document.getElementById("da-portal-ds-prev");
    const next = document.getElementById("da-portal-ds-next");
    if (!foot) return;
    foot.hidden = totalPages <= 1;
    if (foot.hidden) return;
    const page = viewerState.page + 1;
    if (info) info.textContent = t("sources.pageInfo", { page, total: totalPages, rows: totalRows })
      || `صفحه ${page} از ${totalPages} — ${totalRows} ردیف`;
    if (prev) prev.disabled = viewerState.page <= 0;
    if (next) next.disabled = viewerState.page >= totalPages - 1;
  }

  /**
   * Tooltip for one cell: who last changed it and when. Shown only in the grid — the Excel export
   * is the data itself and must not carry this change log.
   */
  function cellTooltip(rowIndex, columnKey) {
    const hint = t("sources.inlineEditHint") || "برای ویرایش دابل‌کلیک کنید";
    const meta = viewerState.cellMeta?.[rowIndex]?.[columnKey];
    const when = formatCellStamp(meta?.updatedAtUtc);
    if (!meta || (!meta.userName && !when)) {
      // An imported cell has no per-cell editor; say so rather than showing an empty tooltip.
      return when
        ? `${hint}\n${t("sources.cellMetaImported") || "وارد‌شده از فایل"} · ${when}`
        : hint;
    }
    const byUser = meta.userName ? (t("sources.cellMetaEditedBy", { user: meta.userName }) || meta.userName) : "";
    const atTime = when ? (t("sources.cellMetaEditedAt", { time: when }) || when) : "";
    return [hint, [byUser, atTime].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  }

  /**
   * Format a cell timestamp using the active UI language, so a Persian UI shows a Jalali date and
   * an English UI a Gregorian one. Falls back to the raw value if the locale data is unavailable.
   */
  function formatCellStamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const lang = (typeof window !== "undefined" && window.daCurrentLang) || document.documentElement.lang || "fa";
    try {
      return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fa-IR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(d);
    } catch {
      return d.toISOString();
    }
  }

  /** Column keys + row count of the source currently open in the viewer (from the local cache). */
  function viewerSource() {
    if (viewerState.sourceId == null) return null;
    // The server-loaded copy is the freshest shape and the only one a library-only row has
    // (no process id → `findEntry` cannot help), so it wins when present.
    if (viewerState.lastSource) return viewerState.lastSource;
    if (viewerState.taskId == null) return null;
    const entry = findEntry(viewerState.taskId, viewerState.sourceId);
    return entry ? entry.ds : null;
  }

  function cellRevisionFor(rowIndex, columnKey) {
    const revs = viewerState.cellRevisions;
    if (!revs) return undefined;
    const row = revs[rowIndex];
    if (!row) return undefined;
    return row[columnKey];
  }

  /** Record the editor stamp for one cell so a re-render (or an immediate tooltip) shows it. */
  function setCellMeta(rowIndex, columnKey, userId, userName, updatedAtUtc) {
    if (!viewerState.cellMeta) viewerState.cellMeta = {};
    viewerState.cellMeta[rowIndex] = viewerState.cellMeta[rowIndex] || {};
    viewerState.cellMeta[rowIndex][columnKey] = {
      userId: userId ?? null,
      userName: userName ?? null,
      // A write always has a server timestamp; fall back to now so the tooltip is never blank.
      updatedAtUtc: updatedAtUtc ?? new Date().toISOString()
    };
  }

  /**
   * Save one cell edit into the browser copy of a diverged source.
   *
   * The value goes into the grid's own copy AND into the pending-write log of the process that ran
   * locally, so the three readers of this source — the grid, the next local run, and the eventual
   * sync payload — all see the same number. `baseValue` is the value the run loaded, which is what
   * the sync's merge compares against.
   */
  function saveCellLocally(rowIndex, columnKey, value, source) {
    const sourceId = Number(viewerState.sourceId);
    if (!Number.isFinite(sourceId) || sourceId <= 0) return false;
    let previous = null;
    if (source && Array.isArray(source.cells)) {
      const hit = source.cells.find((c) =>
        (c.key === columnKey || c.Key === columnKey)
        && Number(c.index ?? c.Index ?? c.rowIndex) === Number(rowIndex));
      if (hit) previous = hit.cellValue ?? hit.CellValue ?? null;
    }
    if (source) setLocalCell(source, rowIndex, columnKey, value);
    // The write belongs to the process that owns this copy: the one with pending writes for the
    // source, or — for a process merely set to run locally — that process itself.
    const pending = pendingWritesForSource(sourceId);
    const ownerId = pending ? pending.task.id : viewerState.taskId;
    if (ownerId != null) {
      // Re-read INSIDE the write: the pending list may have grown while this edit was being typed,
      // and saving an older snapshot of the store would silently roll those writes back.
      const tasks = readTasks();
      const owned = tasks.map((task) => {
        if (String(task.id) !== String(ownerId)) return task;
        const list = (Array.isArray(task.locallyRunSources) ? task.locallyRunSources : []).slice();
        const same = (c) => Number(c?.dataSourceId) === sourceId
          && Number(c?.rowIndex) === Number(rowIndex)
          && String(c?.columnKey) === String(columnKey);
        const hit = list.find(same);
        if (hit) hit.cellValue = String(value ?? "");
        else list.push({
          dataSourceId: sourceId,
          rowIndex: Number(rowIndex),
          columnKey: String(columnKey),
          cellValue: String(value ?? ""),
          baseValue: previous == null ? null : String(previous)
        });
        return { ...task, locallyRunSources: list, localRunPendingSync: true };
      });
      writeTasks(owned, { silent: true });
      // Keep the stored browser copy in step, or the 2s repaint would bring the old value back.
      if (source) persistLocalGridCopy(source);
      viewerState.localDirty = true;
      viewerState.localCopy = true;
      setLocalNote(true);
    }
    setCellMeta(rowIndex, columnKey, null, currentUser(), new Date().toISOString());
    notify(t("sources.cellSavedLocal")
      || "در نسخهٔ محلی ذخیره شد؛ با «همگام‌سازی با سرور» به سرور منتقل می‌شود.", "success");
    return true;
  }

  /**
   * Write one cell. The grid sends the revision it last saw so a concurrent writer produces a 409
   * we can surface, instead of silently overwriting their value.
   */
  async function saveCell(rowIndex, columnKey, value) {
    const sourceId = viewerState.sourceId;
    const source = viewerSource();
    if (sourceId == null) return false;
    // A browser-side copy (unsynced local-run values, or a process set to run locally): the edit
    // joins the pending writes instead of going to the server. Writing now would publish a value the
    // run has not synced yet and split one change into two copies that no merge could reconcile.
    if ((viewerState.localDirty || viewerState.localCopy) && saveCellLocally(rowIndex, columnKey, value, source)) {
      return true;
    }
    try {
      const res = await fetch(`/api/datasources/${sourceId}/cells`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIndex,
          columnKey,
          cellValue: value,
          expectedCellRevision: cellRevisionFor(rowIndex, columnKey)
        })
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        notify((t("sources.cellConflict") || "این سلول توسط کاربر دیگری تغییر کرده است.")
          + (body.currentCellValue != null ? ` (${body.currentCellValue})` : ""), "warn");
        // Adopt the server's value + revision so the next write succeeds.
        if (viewerState.cellRevisions) {
          viewerState.cellRevisions[rowIndex] = viewerState.cellRevisions[rowIndex] || {};
          if (body.currentCellRevision != null) viewerState.cellRevisions[rowIndex][columnKey] = body.currentCellRevision;
        }
        // The value on screen is now the other writer's, so its stamp has to come from them too —
        // leaving our own name in the tooltip would credit us for a value we did not write.
        setCellMeta(rowIndex, columnKey, body.currentCellUserId, body.currentCellUserName, body.currentCellUpdatedAtUtc);
        const td = document.querySelector(`#da-portal-ds-table td[data-row="${rowIndex}"][data-col="${CSS.escape(columnKey)}"]`);
        if (td) {
          if (body.currentCellValue != null) td.textContent = String(body.currentCellValue);
          td.title = cellTooltip(rowIndex, columnKey);
        }
        if (source) setLocalCell(source, rowIndex, columnKey, body.currentCellValue ?? "");
        return false;
      }
      if (!res.ok) throw new Error(`cell ${res.status}`);

      const body = await res.json();
      if (viewerState.cellRevisions) {
        viewerState.cellRevisions[rowIndex] = viewerState.cellRevisions[rowIndex] || {};
        if (body.cellRevision != null) viewerState.cellRevisions[rowIndex][columnKey] = body.cellRevision;
      }
      // We wrote this value, so the tooltip should now name us and the moment we wrote it.
      setCellMeta(rowIndex, columnKey, body.lastEditorUserId, body.lastEditorUserName, body.updatedAtUtc);
      if (source) setLocalCell(source, rowIndex, columnKey, value);
      notify(t("sources.cellSaved") || "سلول ذخیره شد.", "success");
      return true;
    } catch (e) {
      notify(e.message || t("sources.cellSaveFail") || "ذخیرهٔ سلول ناموفق بود.", "error");
      return false;
    }
  }

  /** Mirror a written cell into the local cache so a re-render shows it before the next fetch. */
  function setLocalCell(ds, rowIndex, columnKey, value) {
    ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
    const hit = ds.cells.find((c) =>
      (c.key === columnKey || c.Key === columnKey)
      && Number(c.index ?? c.Index ?? c.rowIndex) === rowIndex);
    if (hit) {
      if (hit.cellValue !== undefined) hit.cellValue = value;
      else if (hit.CellValue !== undefined) hit.CellValue = value;
      else hit.value = value;
    } else {
      ds.cells.push({ key: columnKey, index: rowIndex, cellValue: value });
    }
    const rc = Number(ds.rowCount) || 0;
    if (rowIndex + 1 > rc) ds.rowCount = rowIndex + 1;
  }

  let editingCell = null;

  /** Double-click → swap the cell for an input; Enter/blur commits, Escape reverts. */
  function beginCellEdit(td) {
    if (!td || editingCell) return;
    const rowIndex = Number(td.dataset.row);
    const columnKey = td.dataset.col;
    if (!Number.isFinite(rowIndex) || !columnKey) return;

    const before = td.textContent ?? "";
    td.classList.add("ds-cell-editing");
    td.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ds-cell-input";
    input.value = before;
    input.autocomplete = "off";
    td.appendChild(input);
    input.focus();
    input.select();
    editingCell = { td, input, rowIndex, columnKey, before, done: false };

    const finish = async (commit) => {
      if (editingCell?.done) return;
      if (editingCell) editingCell.done = true;
      const next = input.value;
      td.classList.remove("ds-cell-editing");
      td.textContent = commit ? next : before;
      editingCell = null;
      if (!commit || next === before) return;
      const ok = await saveCell(rowIndex, columnKey, next);
      if (!ok) td.textContent = before;
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      // Keep grid-level shortcuts (Delete, arrows) from firing while typing.
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  /** Row/column context menu for the source grid. */
  function showGridMenu(x, y, td, th) {
    const source = viewerSource();
    if (!source || viewerState.sourceId == null) return;
    const rowIndex = td ? Number(td.dataset.row) : null;
    const columnKey = td ? td.dataset.col : (th ? th.dataset.col : null);
    // A column's position comes from the header/cell index the menu was opened on — never from
    // the row number, which is a different axis.
    const columnIndex = th
      ? Number(th.dataset.colIndex ?? (th.cellIndex - 1))
      : (td ? td.cellIndex - 1 : null);

    const items = [
      { id: "row-after", label: t("sources.addRowAfter") || "افزودن ردیف بعد از این" },
      { id: "row-before", label: t("sources.addRowBefore") || "افزودن ردیف قبل از این" },
      { id: "row-delete", label: t("sources.deleteRow") || "حذف این ردیف" },
      { sep: true },
      { id: "col-rename", label: t("sources.renameColumn") || "تغییر نام ستون" },
      { id: "col-after", label: t("sources.addColAfter") || "افزودن ستون بعد از این" },
      { id: "col-before", label: t("sources.addColBefore") || "افزودن ستون قبل از این" },
      { id: "col-delete", label: t("sources.deleteColumn") || "حذف این ستون" }
    ];
    if (th && columnKey) {
      // Right-click on a column header: column actions for THAT column, no row actions.
      items.splice(0, items.length,
        { id: "col-rename", label: t("sources.renameColumn") || "تغییر نام ستون" },
        { sep: true },
        { id: "col-after", label: t("sources.addColAfter") || "افزودن ستون بعد از این" },
        { id: "col-before", label: t("sources.addColBefore") || "افزودن ستون قبل از این" },
        { id: "col-delete", label: t("sources.deleteColumn") || "حذف این ستون" },
        { sep: true },
        { id: "row-append", label: t("sources.addRowAppend") || "افزودن ردیف در پایان" });
    } else if (!td) {
      // Clicked empty area — offer append-only actions.
      items.splice(0, items.length,
        { id: "row-append", label: t("sources.addRowAppend") || "افزودن ردیف در پایان" },
        { sep: true },
        { id: "col-append", label: t("sources.addColAppend") || "افزودن ستون در پایان" });
    }

    const menu = document.createElement("div");
    menu.className = "ds-grid-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items.map((it) => it.sep
      ? `<div class="ds-grid-menu-sep"></div>`
      : `<button type="button" class="ds-grid-menu-item" data-action="${it.id}">${escapeHtml(it.label)}</button>`
    ).join("");
    document.body.appendChild(menu);
    // Flip near the viewport edges so the menu is never cut off.
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;

    const close = () => {
      menu.remove();
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const onDocDown = (e) => { if (!menu.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);

    menu.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      close();
      await runGridAction(action, rowIndex, columnKey, columnIndex);
    });
  }

  /** The process that owns the browser copy shown in this grid, if any. */
  function localGridOwnerTaskId() {
    const pending = pendingWritesForSource(viewerState.sourceId);
    if (pending) return pending.task.id;
    if (viewerState.taskId != null) return viewerState.taskId;
    // A LIBRARY row has no process, but the copy still belongs to whichever process loaded it. Without
    // this fallback a source opened from the library could not resolve a record at all, so the local
    // view had nothing to draw and the click looked dead.
    const sid = String(Number(viewerState.sourceId));
    const owner = readTasks().find((x) => {
      const copies = x?.localSourceCopies;
      return copies && copies[sid] && Array.isArray(copies[sid].cells);
    });
    if (owner) return owner.id;
    // No stored copy yet: a locally-running process that uses this source can still adopt it, which
    // is what turns the first click on a local view into a stored local copy instead of a server read.
    const localRun = localRunTaskForSource(viewerState.sourceId);
    return localRun ? localRun.id : null;
  }

  /** Column keys of a source snapshot, whichever of the two shapes it carries. */
  function gridColumnKeys(ds) {
    return (ds?.columnKeys || (ds?.columns || []).map((c) => String(c.key || c.Key || "")) || [])
      .filter(Boolean);
  }

  function localAddGridColumn(ds, key, atIndex) {
    const keys = gridColumnKeys(ds);
    const cols = Array.isArray(ds.columns) && ds.columns.length
      ? ds.columns.slice()
      : keys.map((k) => ({ key: k, title: k }));
    const at = atIndex == null ? keys.length : Math.max(0, Math.min(Number(atIndex) || 0, keys.length));
    cols.splice(at, 0, { key, title: key });
    keys.splice(at, 0, key);
    ds.columns = cols;
    ds.columnKeys = keys;
    ds.columnCount = keys.length;
    ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
    const rows = Number(ds.rowCount) || 0;
    for (let r = 0; r < rows; r++) ds.cells.push({ key, index: r, cellValue: "" });
  }

  function localDeleteGridColumn(ds, key) {
    const drop = String(key);
    ds.cells = (Array.isArray(ds.cells) ? ds.cells : [])
      .filter((c) => String(c.key ?? c.Key ?? "") !== drop);
    ds.columnKeys = gridColumnKeys(ds).filter((k) => k !== drop);
    if (Array.isArray(ds.columns)) {
      ds.columns = ds.columns.filter((c) => String(c.key || c.Key || "") !== drop);
    }
    ds.columnCount = ds.columnKeys.length;
  }

  function localRenameGridColumn(ds, oldKey, newKey) {
    const from = String(oldKey);
    const to = String(newKey);
    ds.columnKeys = gridColumnKeys(ds).map((k) => (k === from ? to : k));
    if (Array.isArray(ds.columns)) {
      ds.columns = ds.columns.map((c) =>
        String(c.key || c.Key || "") === from ? { ...c, key: to, title: to } : c);
    }
    (Array.isArray(ds.cells) ? ds.cells : []).forEach((c) => {
      if (String(c.key ?? c.Key ?? "") !== from) return;
      if (c.key !== undefined) c.key = to;
      else if (c.Key !== undefined) c.Key = to;
    });
  }

  /**
   * Store the displayed copy as the browser copy of this source.
   *
   * Two places on purpose: a dedicated record (`localSourceCopies[sourceId]`) is what the local view
   * and the timer render — a COMPLETE copy — while the process graph entry is what a local run reads.
   * Keeping the graph in step means the next run starts from the same values the user just saw.
   */
  function persistLocalGridCopy(ds) {
    const taskId = localGridOwnerTaskId();
    if (taskId == null || !ds) return;
    const sourceId = Number(ds.id ?? viewerState.sourceId);
    if (!Number.isFinite(sourceId)) return;
    const tasks = readTasks();
    const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
    if (idx < 0) return;
    const task = tasks[idx];
    const record = {
      cells: Array.isArray(ds.cells) ? ds.cells : [],
      columns: Array.isArray(ds.columns) ? ds.columns : [],
      columnKeys: Array.isArray(ds.columnKeys) ? ds.columnKeys : [],
      rowCount: Number(ds.rowCount) || 0,
      columnCount: Number(ds.columnCount) || (Array.isArray(ds.columnKeys) ? ds.columnKeys.length : 0),
      fileName: ds.fileName || null,
      title: ds.title || null,
      savedAtUtc: new Date().toISOString()
    };
    const copies = { ...(task.localSourceCopies || {}) };
    copies[String(sourceId)] = record;
    // The graph entry stays the run's input, so it gets the same values.
    [task.graph, task.canvasCache?.graph].filter(Boolean).forEach((g) => {
      const snap = (g.dataSources || []).find((d) => Number(d.id) === sourceId);
      if (!snap) return;
      snap.cells = record.cells;
      snap.columns = record.columns;
      snap.columnKeys = record.columnKeys;
      snap.rowCount = record.rowCount;
      snap.columnCount = record.columnCount;
    });
    tasks[idx] = { ...task, localSourceCopies: copies };
    writeTasks(tasks, { silent: true });
  }

  /**
   * Apply one grid-menu action to the browser copy of a local-run source.
   *
   * No fetch on purpose: a local run must not reshape the shared source. The change is real for this
   * browser (the next run and the next open of this grid use it) and the banner keeps saying the
   * server may disagree. Structural changes have no cell address, so the sync button carries values
   * only — the toast says so rather than letting the user believe a shape change will travel.
   */
  async function runLocalGridAction(action, rowIndex, columnKey, columnIndex) {
    const ds = viewerState.lastSource || viewerSource();
    if (!ds) return;
    const ask = async (msg, titleKey, okKey) => (window.DaNotify?.confirm
      ? DaNotify.confirm(msg, {
          title: t(titleKey) || "",
          okText: t(okKey) || "تأیید",
          cancelText: t("common.cancel") || "انصراف"
        })
      : window.confirm(msg));

    if (action === "col-rename") {
      const next = window.DaNotify?.prompt
        ? await DaNotify.prompt(t("sources.renameColumnPrompt") || "نام جدید ستون را وارد کنید", {
            title: t("sources.renameColumn") || "تغییر نام ستون",
            value: columnKey
          })
        : window.prompt(t("sources.renameColumnPrompt") || "نام جدید ستون را وارد کنید", columnKey);
      if (next == null) return;
      const newName = String(next).trim();
      if (!newName || newName === columnKey) return;
      localRenameGridColumn(ds, columnKey, newName);
    } else if (action === "row-delete") {
      const msg = t("sources.deleteRowConfirm", { row: rowIndex + 1 }) || `ردیف ${rowIndex + 1} حذف شود؟`;
      if (!(await ask(msg, "sources.deleteRow", "common.delete"))) return;
      shiftViewerRows(ds, rowIndex, -1);
    } else if (action === "col-delete") {
      const msg = t("sources.deleteColumnConfirm", { key: columnKey }) || `ستون «${columnKey}» با همهٔ داده‌هایش حذف شود؟`;
      if (!(await ask(msg, "sources.deleteColumn", "common.delete"))) return;
      localDeleteGridColumn(ds, columnKey);
    } else if (action === "row-before") {
      shiftViewerRows(ds, Math.max(0, rowIndex ?? 0), 1);
    } else if (action === "row-after") {
      shiftViewerRows(ds, Math.max(0, (rowIndex ?? 0) + 1), 1);
    } else if (action === "row-append") {
      shiftViewerRows(ds, Number(ds.rowCount) || 0, 1);
    } else {
      const keys = gridColumnKeys(ds);
      const key = nextColumnKey(keys);
      const at = action === "col-before" ? (columnIndex ?? keys.length)
        : action === "col-after" ? ((columnIndex ?? keys.length - 1) + 1)
        : null;
      localAddGridColumn(ds, key, at);
    }
    persistLocalGridCopy(ds);
    viewerState.lastSource = ds;
    renderViewerTable(ds);
    notify(t("sources.localEditApplied")
      || "تغییر روی نسخهٔ محلی اعمال شد؛ دادهٔ سرور دست‌نخورده ماند (همگام‌سازی فقط مقدار سلول‌ها را منتقل می‌کند).", "info");
  }

  async function runGridAction(action, rowIndex, columnKey, columnIndex) {
    const sourceId = viewerState.sourceId;
    if (sourceId == null) return;
    // A browser-side copy (unsynced local-run values, or a process set to run locally): every menu
    // action — cell or shape — belongs to that copy and must not send anything to the server.
    if (viewerState.localCopy) {
      await runLocalGridAction(action, rowIndex, columnKey, columnIndex);
      return;
    }
    if (action === "col-rename") {
      await renameLibraryColumn(sourceId, columnKey);
      return;
    }
    if (action === "row-delete") {
      await deleteLibraryRow(sourceId, rowIndex);
      return;
    }
    if (action === "col-delete") {
      await deleteLibraryColumn(sourceId, columnKey);
      return;
    }
    const source = viewerSource();
    const columns = (source?.columnKeys || source?.columns || []).map((c) => String(c.key || c.Key || c));
    const rowCount = Number(source?.rowCount) || 0;

    const beforeIndexFor = (kind) => {
      // A column's position comes from the header/cell index the menu was opened on — never from
      // the row number, which is a different axis.
      if (kind === "col" && columnIndex != null) {
        if (action === "col-before") return Math.max(0, columnIndex);
        if (action === "col-after") return columnIndex + 1;
      }
      if (action === `${kind}-before`) return rowIndex ?? undefined;
      if (action === `${kind}-after`) return rowIndex == null ? undefined : rowIndex + 1;
      return undefined; // append
    };

    try {
      // Adding a row/column changes the source's shape, so the grid has to be re-read; on a large
      // source that takes a moment, and without the overlay the click looks like it did nothing.
      setGridBusy(true, action.startsWith("row-") ? "sources.addingRow" : "sources.addingColumn");
      if (action.startsWith("row-")) {
        const beforeIndex = beforeIndexFor("row");
        const res = await fetch(`/api/datasources/${sourceId}/rows/add`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beforeIndex, count: 1 })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.addRowFail") || "افزودن ردیف ناموفق بود.");
        notify(t("sources.rowAdded") || "ردیف اضافه شد.", "success");
      } else {
        const beforeIndex = beforeIndexFor("col");
        // Derive a free key from the current columns, mirroring the server's generator.
        const key = nextColumnKey(columns);
        const res = await fetch(`/api/datasources/${sourceId}/columns`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, title: key, beforeIndex })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.addColFail") || "افزودن ستون ناموفق بود.");
        notify(t("sources.colAdded", { key: body.addedColumnKey || key }) || `ستون «${body.addedColumnKey || key}» اضافه شد.`, "success");
      }
      // refreshViewer shows its own overlay, so tell it not to double-count ours.
      await refreshViewer({ busy: false });
    } catch (e) {
      notify(e.message || "انجام نشد.", "error");
    } finally {
      // Always clear the overlay, even when the request failed, or the grid would stay greyed out.
      setGridBusy(false);
    }
  }

  /**
   * Rename one column of the open source.
   *
   * The server applies the rename to the column, its cells AND every linked process whose nodes
   * bind to that column — an edit here cannot leave a process reading a column that no longer
   * exists. The grid is re-read afterwards so the header shows the new name.
   */
  async function renameLibraryColumn(sourceId, oldKey) {
    if (sourceId == null || !oldKey) return;
    const next = window.DaNotify?.prompt
      ? await DaNotify.prompt(t("sources.renameColumnPrompt") || "نام جدید ستون را وارد کنید", {
          title: t("sources.renameColumn") || "تغییر نام ستون",
          value: oldKey
        })
      : window.prompt(t("sources.renameColumnPrompt") || "نام جدید ستون را وارد کنید", oldKey);
    if (next == null) return;
    const newName = String(next).trim();
    if (!newName || newName === oldKey) return;
    try {
      setGridBusy(true, "sources.renamingColumn");
      const res = await fetch(`/api/datasources/${sourceId}/columns`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldKey, newName })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.renameColumnFail") || "تغییر نام ستون ناموفق بود.");
      const affected = Number(body.affectedProcessCount ?? body.AffectedProcessCount ?? 0);
      notify(
        affected > 0
          ? (t("sources.colRenamedAffected", { key: newName, count: affected }) || `ستون به «${newName}» تغییر نام یافت و در ${affected} فرآیند اعمال شد.`)
          : (t("sources.colRenamed", { key: newName }) || `ستون به «${newName}» تغییر نام یافت.`),
        "success"
      );
      await refreshViewer({ busy: false });
    } catch (e) {
      notify(e.message || t("sources.renameColumnFail") || "تغییر نام ستون ناموفق بود.", "error");
    } finally {
      setGridBusy(false);
    }
  }

  /** Context menu — delete one row from the open source, after a confirmation. */
  async function deleteLibraryRow(sourceId, rowIndex) {
    if (sourceId == null || !Number.isFinite(rowIndex)) return;
    const msg = t("sources.deleteRowConfirm", { row: rowIndex + 1 }) || `ردیف ${rowIndex + 1} حذف شود؟`;
    const ask = window.DaNotify?.confirm
      ? await DaNotify.confirm(msg, {
          title: t("sources.deleteRow") || "حذف ردیف",
          okText: t("common.delete") || "حذف",
          cancelText: t("common.cancel") || "انصراف"
        })
      : window.confirm(msg);
    if (!ask) return;
    try {
      setGridBusy(true, "sources.deletingRow");
      const res = await fetch(`/api/datasources/${sourceId}/rows/${rowIndex}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.deleteRowFail") || "حذف ردیف ناموفق بود.");
      notify(t("sources.rowDeleted") || "ردیف حذف شد.", "success");
      // refreshViewer shows its own overlay, so tell it not to double-count ours.
      await refreshViewer({ busy: false });
    } catch (e) {
      notify(e.message || "حذف ردیف ناموفق بود.", "error");
    } finally {
      setGridBusy(false);
    }
  }

  /**
   * Context menu — delete one column (with its cells), after a confirmation.
   *
   * The server keeps node bindings intact on purpose and reports how many linked processes used
   * the column; the toast carries that count so the author knows where to re-pick a column.
   */
  async function deleteLibraryColumn(sourceId, columnKey) {
    if (sourceId == null || !columnKey) return;
    const msg = t("sources.deleteColumnConfirm", { key: columnKey }) || `ستون «${columnKey}» با همهٔ داده‌هایش حذف شود؟`;
    const ask = window.DaNotify?.confirm
      ? await DaNotify.confirm(msg, {
          title: t("sources.deleteColumn") || "حذف ستون",
          okText: t("common.delete") || "حذف",
          cancelText: t("common.cancel") || "انصراف"
        })
      : window.confirm(msg);
    if (!ask) return;
    try {
      setGridBusy(true, "sources.deletingColumn");
      const res = await fetch(`/api/datasources/${sourceId}/columns/${encodeURIComponent(columnKey)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.deleteColumnFail") || "حذف ستون ناموفق بود.");
      const key = body.deletedColumnKey || body.DeletedColumnKey || columnKey;
      const affected = Number(body.affectedProcessCount ?? body.AffectedProcessCount ?? 0);
      notify(
        affected > 0
          ? (t("sources.colDeletedAffected", { key, count: affected }) || `ستون «${key}» حذف شد — ${affected} فرآیند به این ستون وابسته بود؛ در ویرایشگر اصلاح کنید.`)
          : (t("sources.colDeleted", { key }) || `ستون «${key}» حذف شد.`),
        affected > 0 ? "warn" : "success"
      );
      await refreshViewer({ busy: false });
    } catch (e) {
      notify(e.message || "حذف ستون ناموفق بود.", "error");
    } finally {
      setGridBusy(false);
    }
  }

  /** First free c<n> not already used by the source. */
  function nextColumnKey(existingKeys) {
    const used = new Set((existingKeys || []).map((k) => String(k).toLowerCase()));
    let n = used.size + 1;
    while (used.has(`c${n}`)) n++;
    return `c${n}`;
  }

  /**
   * Repaint the open source.
   *
   * The MODE is decided first, without a request: the SERVER view (or an ordinary, undiverged source)
   * reads the server's rows, while the LOCAL view renders the browser copy that this page stores for
   * the source. Reading the server into the local view was the bug that showed one partial row and
   * then lost it — the copy on screen must be the copy this browser actually holds.
   */
  async function refreshViewer(opts) {
    const sourceId = viewerState.sourceId;
    if (sourceId == null) return;
    // A caller that already shows its own overlay passes busy:false so the counter stays balanced.
    const busy = opts?.busy !== false;
    const forced = viewerState.forceMode;
    // Public sources stay server-backed even for a local run, so they never take the banner.
    const publicSource = viewerListRow()?.ds?.isPublic === true;
    const autoLocal = !publicSource
      && (!!pendingWritesForSource(sourceId) || viewerProcessRunsLocally() || localRunTaskForSource(sourceId) != null);
    const localCopy = forced === "local" ? true : forced === "server" ? false : autoLocal;
    viewerState.localCopy = localCopy;
    setLocalNote(localCopy);

    if (localCopy) {
      try {
        const view = await ensureLocalCopy();
        if (view) {
          viewerState.localDirty = (pendingWritesForSource(sourceId)?.writes?.length || 0) > 0;
          viewerState.cellRevisions = null;
          viewerState.cellMeta = null;
          viewerState.lastSource = view;
          setLocalNote(true, viewerState.localCopyMissing
            ? (t("sources.localCopyMissing")
              || "نسخهٔ محلی این منبع روی این سیستم نیست؛ ردیف‌های زیر از سرور خوانده شده‌اند و ارسال‌شدنی نیستند.")
            : undefined);
          renderViewerTable(view);
        }
      } catch { /* keep whatever is on screen */ }
      finally {
        syncViewerModeChrome();
        if (busy) setGridBusy(false);
      }
      return;
    }

    if (busy) setGridBusy(true, "sources.loadingGrid");
    try {
      // One walk supplies the cells, the per-cell revisions the inline editor checks against, and
      // the per-cell editor stamps the tooltips show — so the three can never disagree.
      const fresh = await fetchSourceContent(sourceId);
      viewerState.cellRevisions = fresh.cellRevisions || null;
      viewerState.cellMeta = fresh.cellMeta || null;
      viewerState.localDirty = false;
      viewerState.localCopyMissing = false;
      viewerState.lastSource = fresh;
      renderViewerTable(fresh);
      syncViewerModeChrome();
    } catch { /* leave the grid as-is */ }
    finally { if (busy) setGridBusy(false); }
  }

  /**
   * Empty the open source's rows and keep its columns — the viewer's "clear data" button. Columns
   * survive because every node binding names one, so the processes that read this source keep working.
   */
  async function clearViewerData() {
    const sourceId = Number(viewerState.sourceId);
    const ds = viewerSource();
    if (!ds || !Number.isFinite(sourceId) || sourceId <= 0) {
      notify(t("sources.clearDataFail") || "پاک‌سازی داده انجام نشد.", "error");
      return;
    }
    // Clearing deletes rows for EVERYONE, so in local mode it clears the LOCAL copy instead: the run
    // then starts from an empty grid and the server's rows stay exactly as they are.
    if (viewerState.localCopy) {
      const title = ds.title || dataSourceSafeFileName(ds);
      const msg = t("sources.clearDataConfirm", { title })
        || `همهٔ ردیف‌های منبع «${title}» پاک شود؟ ستون‌ها می‌مانند.`;
      const ask = window.DaNotify?.confirm
        ? await DaNotify.confirm(msg, {
            title: t("sources.clearData") || "پاک‌سازی داده",
            okText: t("common.yes") || "بله",
            cancelText: t("common.no") || "خیر"
          })
        : window.confirm(msg);
      if (!ask) return;
      ds.cells = [];
      ds.rowCount = 0;
      viewerState.cellRevisions = {};
      viewerState.cellMeta = {};
      viewerState.page = 0;
      persistLocalGridCopy(ds);
      // The addresses those pending writes pointed at no longer exist locally, so they go with them.
      const ownerId = localGridOwnerTaskId();
      if (ownerId != null) {
        const tasks = readTasks();
        const idx = tasks.findIndex((x) => String(x.id) === String(ownerId));
        if (idx >= 0) {
          const kept = (tasks[idx].locallyRunSources || [])
            .filter((w) => Number(w?.dataSourceId) !== Number(ds.id ?? viewerState.sourceId));
          tasks[idx] = {
            ...tasks[idx],
            locallyRunSources: kept.length ? kept : null,
            localRunPendingSync: kept.length > 0
          };
          writeTasks(tasks);
        }
      }
      renderViewerTable(ds);
      notify(t("sources.clearDataLocalDone")
        || "دادهٔ نسخهٔ محلی پاک شد؛ دادهٔ سرور دست‌نخورده ماند.", "success");
      return;
    }
    const title = ds.title || dataSourceSafeFileName(ds);
    const msg = t("sources.clearDataConfirm", { title })
      || `همهٔ ردیف‌های منبع «${title}» پاک شود؟ ستون‌ها می‌مانند.`;
    const ask = window.DaNotify?.confirm
      ? await DaNotify.confirm(msg, {
          title: t("sources.clearData") || "پاک‌سازی داده",
          okText: t("common.yes") || "بله",
          cancelText: t("common.no") || "خیر"
        })
      : window.confirm(msg);
    if (!ask) return;
    const btn = document.getElementById("da-portal-ds-clear");
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/datasources/${sourceId}/rows`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.clearDataFail") || "پاک‌سازی داده انجام نشد.");
      ds.cells = [];
      ds.rowCount = 0;
      // The grid is empty, so there is no revision or stamp left to show.
      viewerState.cellRevisions = {};
      viewerState.cellMeta = {};
      viewerState.page = 0;
      renderViewerTable(ds);
      if (viewerState.taskId != null) {
        const entry = findEntry(viewerState.taskId, sourceId);
        if (entry) writeTasks(entry.tasks);
      }
      notify(t("sources.clearDataDone") || "داده‌های منبع پاک شد (ستون‌ها دست‌نخورده ماندند).", "success");
    } catch (e) {
      notify(e.message || t("sources.clearDataFail") || "پاک‌سازی داده انجام نشد.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function openViewer(taskId, sourceId, mode) {
    // `undefined`/empty (a library row's button) must become a real null, or the hub would be
    // joined with the string "undefined" and the live indicator would lie.
    const tid = (taskId == null || taskId === "" || taskId === "undefined" || taskId === "null") ? null : taskId;
    viewerState.taskId = tid;
    viewerState.sourceId = Number(sourceId);
    // Which copy this open is about; null lets the divergence decide (the old behaviour).
    viewerState.forceMode = mode === "local" || mode === "server" ? mode : null;
    // A freshly opened source starts at its first page; keeping an old page index would show a
    // different source's rows or an out-of-range page.
    viewerState.page = 0;
    // Reset before the load: a failed load must not inherit the previous source's local-mode state.
    viewerState.localDirty = false;
    viewerState.localCopy = false;
    setLocalNote(false);
    // Read the source straight from the server: the grid needs real cell values and the current
    // column set, which the list payload deliberately omits (it is a summary-only shape).
    setGridBusy(true, "sources.loadingGrid");
    try {
      await refreshViewer();
    } finally {
      setGridBusy(false);
    }
    // Show the modal BEFORE deciding what to draw: a viewer that only appears when a fetch happened
    // to succeed is a button that sometimes does nothing — which is exactly how a local copy that
    // could not be resolved looked from the row.
    const modal = document.getElementById("da-portal-ds-viewer");
    if (modal) modal.hidden = false;
    if (!viewerState.lastSource) {
      const entry = tid != null ? findEntry(tid, sourceId) : null;
      if (entry) {
        renderViewerTable(entry.ds);
      } else {
        // Nothing to draw: say so INSIDE the modal, so the click always produces an answer.
        const titleEl = document.getElementById("da-portal-ds-title");
        if (titleEl) titleEl.textContent = t("sources.notFound") || "منبع پیدا نشد.";
        const subEl = document.getElementById("da-portal-ds-sub");
        if (subEl) subEl.textContent = "";
        const table = document.getElementById("da-portal-ds-table");
        const thead = table?.querySelector("thead");
        const tbody = table?.querySelector("tbody");
        if (thead) thead.innerHTML = "";
        if (tbody) {
          tbody.innerHTML = `<tr><td class="ds-viewer-empty">${escapeHtml(t("sources.loadFailed")
            || "دادهٔ این نسخه بارگذاری نشد. دکمهٔ بازخوانی را بزنید یا دوباره امتحان کنید.")}</td></tr>`;
        }
        notify(t("sources.loadFailed") || "بارگذاری داده انجام نشد.", "error");
      }
    }
    if (viewerState.localCopy) {
      // The grid is showing a browser-side copy: neither the play hub nor a server pull may
      // overwrite it. Local cell events still arrive through the extension's window event.
      setLiveStatus(false, t("sources.localLive") || "● محلی — بدون به‌روزرسانی زنده");
      return;
    }
    setLiveStatus(false, "● اتصال…");
    await ensureHub(tid);
  }

  async function closeViewer() {
    const modal = document.getElementById("da-portal-ds-viewer");
    if (modal) modal.hidden = true;
    viewerState.sourceId = null;
    viewerState.taskId = null;
    viewerState.lastSource = null;
    viewerState.cellRevisions = null;
    viewerState.cellMeta = null;
    viewerState.page = 0;
    viewerState.localDirty = false;
    viewerState.localCopy = false;
    viewerState.forceMode = null;
    setLocalNote(false);
    setLocalViewTimer(false);
    const resetBtn = document.getElementById("da-portal-ds-reset");
    if (resetBtn) resetBtn.hidden = true;
    editingCell = null;
    setLiveStatus(false);
    if (viewerState.connection) {
      try { await viewerState.connection.stop(); } catch { /* ignore */ }
      viewerState.connection = null;
    }
  }

  function actionButtons(row) {
    const tid = row.taskId != null ? escapeHtml(String(row.taskId)) : "";
    const sid = Number(row.ds.id);
    const master = row.fromLibrary
      ? ""
      : (row.isMaster
        ? iconBtn("is-master", t("sources.master"), ICO_STAR, "disabled")
        : iconBtn("js-master", t("sources.setMaster"), ICO_STAR_OUT, `data-task="${tid}" data-id="${sid}"`));
    const delLabel = row.fromLibrary ? t("sources.delete") : t("sources.detach");
    const openBtn = row.taskId != null
      ? iconBtn("js-open", t("sources.openProcess"), ICO_OPEN, `data-task="${tid}"`)
      : "";
    // A public source's shape belongs to whoever owns it (ProcessManager/Admin), so a reader who may
    // not reshape it gets no rename/reload buttons at all — offering a control the server rejects
    // reads as a broken button rather than a permission.
    const canShape = row.ds.canEditStructure !== false;
    const isPublic = row.ds.isPublic === true;
    // Only a library row can be made public/private: the toggle needs an owner, and an ad-hoc
    // in-process source has none. A source whose local data still diverges cannot be shared yet —
    // making it public would publish the server's stale rows as if they were everyone's truth, so
    // the data has to be settled first (sync it, or reset the local copy from the server).
    const divergent = row.ds.needsSync === true || localDivergentSourceIds().has(sid);
    // A source of a locally-running process is a two-view source even with nothing pending yet —
    // for a library row that process is found through the source, since the row has no taskId.
    const dualView = divergent
      || (row.taskId != null && localRunTaskIds().has(String(row.taskId)))
      || localRunTaskForSource(sid) != null;
    const publicToggle = row.fromLibrary && Number(sid) > 0
      ? iconBtn(
          `js-public${divergent ? " is-locked" : ""}`,
          divergent
            ? (t("sources.publicBlockedBySync") || "ابتدا دادهٔ محلی این منبع را با سرور تعیین تکلیف کنید (همگام‌سازی یا ریست از سرور)")
            : (isPublic ? (t("sources.makePrivate") || "خصوصی کردن") : (t("sources.makePublic") || "عمومی کردن")),
          ICO_GLOBE,
          `data-id="${sid}" data-public="${isPublic ? "0" : "1"}"${divergent ? " disabled" : ""}`)
      : "";
    // The add-a-public-source-to-my-process action that used to live in the diagram editor; the
    // sources list is where a source is picked, so the button lives next to the source now.
    const attachBtn = isPublic && Number(sid) > 0
      ? iconBtn("js-attach", t("sources.attachToProcess") || "افزودن به فرآیند", ICO_ADD, `data-id="${sid}" data-title="${escapeHtml(row.ds.title || "")}"`)
      : "";
    const accessBtn = isPublic && Number(sid) > 0 && row.ds.canManageAccess === true
      ? iconBtn("js-access", t("sources.manageAccess") || "دسترسی فرآیندها", ICO_SHIELD, `data-id="${sid}" data-title="${escapeHtml(row.ds.title || "")}"`)
      : "";
    // Sync button: shown when a LOCAL run left this source diverged from the server. Two independent
    // signals count, because either alone can be missing: the server flag (set by the run's own
    // report, which a local run may never have managed to send) and this browser's pending-write log
    // (which the server cannot see at all). The divergence belongs to the source, so the affordance
    // lives on its row, next to the "needs sync" badge that explains it.
    const syncBtn = divergent
      ? iconBtn("js-sync is-sync", t("sources.syncNow") || "همگام‌سازی با سرور", ICO_RELOAD,
          `data-id="${sid}" data-title="${escapeHtml(row.ds.title || "")}"`)
      : "";
    // The reload action lives INSIDE the viewer now: replacing the file is about the data being
    // looked at, and which copy it replaces follows the view — local view rewrites the browser copy,
    // server view rewrites the server's.
    const viewBtn = Number(sid) > 0
      ? (dualView
        ? iconBtn("js-view-local is-data-local", t("sources.viewLocal") || "نمایش اطلاعات محلی", ICO_DATA,
            `${row.taskId != null ? `data-task="${tid}" ` : ""}data-id="${sid}" data-mode="local"`)
          + iconBtn("js-view-server is-data-server", t("sources.viewServer") || "نمایش اطلاعات سرور", ICO_DATA,
            `${row.taskId != null ? `data-task="${tid}" ` : ""}data-id="${sid}" data-mode="server"`)
        : iconBtn("js-view", t("sources.viewTable"), ICO_DATA, `${row.taskId != null ? `data-task="${tid}" ` : ""}data-id="${sid}"`))
      : "";
    return `
      ${Number(sid) > 0 && canShape ? iconBtn("js-rename", t("sources.rename"), ICO_RENAME, `data-id="${sid}" data-title="${escapeHtml(row.ds.title || "")}"`) : ""}
      ${viewBtn}
      ${master}
      ${publicToggle}
      ${attachBtn}
      ${accessBtn}
      ${syncBtn}
      ${iconBtn("js-del is-danger", delLabel, ICO_DEL, `data-task="${tid}" data-id="${sid}" data-lib="${row.fromLibrary ? "1" : "0"}"`)}
      ${openBtn}
    `;
  }

  function bindActions(root) {
    if (!root) return;
    root.querySelectorAll(".js-rename").forEach((btn) => {
      btn.addEventListener("click", () => renameLibrarySource(btn.dataset.id, btn.dataset.title || ""));
    });
    root.querySelectorAll(".js-reload").forEach((btn) => {
      btn.addEventListener("click", () => reloadLibrarySource(btn.dataset.id, btn.dataset.title || ""));
    });
    root.querySelectorAll(".js-view").forEach((btn) => {
      // A library row has no process: pass null so the viewer skips the live-session join.
      btn.addEventListener("click", () => openViewer(btn.dataset.task ?? null, btn.dataset.id));
    });
    root.querySelectorAll(".js-view-local, .js-view-server").forEach((btn) => {
      // Two eyes on a diverged source: one for the browser's copy, one for the server's. The mode is
      // explicit because on a diverged source "the grid" is otherwise ambiguous.
      btn.addEventListener("click", () =>
        openViewer(btn.dataset.task ?? null, btn.dataset.id, btn.dataset.mode === "local" ? "local" : "server"));
    });
    root.querySelectorAll(".js-public").forEach((btn) => {
      btn.addEventListener("click", () => togglePublic(btn.dataset.id, btn.dataset.public === "1"));
    });
    root.querySelectorAll(".js-access").forEach((btn) => {
      btn.addEventListener("click", () => openAccessDialog(btn.dataset.id, btn.dataset.title || ""));
    });
    root.querySelectorAll(".js-attach").forEach((btn) => {
      btn.addEventListener("click", () => attachPublicToProcess(btn.dataset.id, btn.dataset.title || ""));
    });
    root.querySelectorAll(".js-sync").forEach((btn) => {
      btn.addEventListener("click", () => syncSourceWithServer(btn.dataset.id, btn.dataset.title || "", btn));
    });
    root.querySelectorAll(".js-master").forEach((btn) => {
      btn.addEventListener("click", () => setMaster(btn.dataset.task, btn.dataset.id));
    });
    root.querySelectorAll(".js-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.lib === "1") deleteSource(null, btn.dataset.id);
        else deleteSource(btn.dataset.task, btn.dataset.id);
      });
    });
    root.querySelectorAll(".js-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `/Panel/Tasks/Editor/${encodeURIComponent(btn.dataset.task)}`;
      });
    });
  }

  /** Rows per list page. The library can grow large, so the table shows a page at a time. */
  const LIST_PAGE_SIZE = 50;
  let listPage = 0;
  let lastListRows = [];

  /** While the library is being fetched, say so instead of leaving a stale table on screen. */
  function showListLoading() {
    const rowsEl = document.getElementById("da-source-rows");
    const cardsEl = document.getElementById("da-source-cards");
    const status = document.getElementById("da-sources-status");
    const msg = t("sources.listLoading") || "در حال بارگذاری فهرست منابع…";
    if (status) status.textContent = msg;
    if (rowsEl && !rowsEl.querySelector("tr[data-da-row]")) {
      rowsEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-6">${escapeHtml(msg)}</td></tr>`;
    }
    if (cardsEl && !cardsEl.querySelector(".da-source-card")) {
      cardsEl.innerHTML = `<div class="da-task-empty text-muted">${escapeHtml(msg)}</div>`;
    }
  }

  function paintRows(rows) {
    const rowsEl = document.getElementById("da-source-rows");
    const cardsEl = document.getElementById("da-source-cards");
    const status = document.getElementById("da-sources-status");
    lastListRows = rows;
    // One walk of the local task store per paint: which sources this browser still owes the server.
    recomputeLocalDivergence();
    if (status) {
      const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
      status.textContent = rows.length
        ? `${rows.length.toLocaleString("fa-IR")} منبع${pages > 1 ? ` · صفحه ${(listPage + 1).toLocaleString("fa-IR")} از ${pages.toLocaleString("fa-IR")}` : ""} — ${t("sources.libraryHint")}`
        : t("sources.libraryHint");
    }
    // Clamp the page first, so removing rows (or a refresh) can never leave us past the end.
    const totalPages = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
    if (listPage >= totalPages) listPage = totalPages - 1;
    if (listPage < 0) listPage = 0;
    const pageRows = rows.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE);

    if (rowsEl) {
      if (!rows.length) {
        rowsEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-6">منبعی یافت نشد. از ویرایشگر فرآیند فایل اکسل اضافه کنید.</td></tr>`;
      } else {
        rowsEl.innerHTML = pageRows.map((r) => {
          const label = r.ds.title || r.ds.fileName || "منبع";
          const cols = (r.ds.columnCount ?? (r.ds.columnKeys || r.ds.columns || []).length) || 0;
          const rowCount = r.ds.rowCount ?? 0;
          const pubBadge = r.ds.isPublic
            ? ` <span class="ds-badge-public" title="${escapeHtml(r.ds.ownerUserName || "")}">${t("sources.publicBadge") || "عمومی"}</span>`
            : "";
          const syncBadge = (r.ds.needsSync || localDivergentSourceIds().has(Number(r.ds.id)))
            ? ` <span class="ds-badge-sync" style="background:#fff7e6;border:1px solid #f0c36d;border-radius:6px;padding:1px 6px;font-size:11px;color:#7a5b10" title="${t("sources.syncLocalPendingHint") || "اجرای محلی این منبع را تغییر داده و هنوز با سرور همگام نشده است."}">◌ ${t("sources.needsSync") || "نیاز به همگام‌سازی"}</span>`
            : "";
          return `<tr data-da-row="${escapeHtml(String(r.ds.id ?? ""))}">
            <td>
              <div class="fw-semibold">${escapeHtml(label)}${r.isMaster ? ` <span class="ds-badge-master">پیش‌فرض</span>` : ""}${pubBadge}${syncBadge}</div>
            </td>
            <td>${escapeHtml(r.taskTitle)}</td>
            <td>${cols}</td>
            <td>${rowCount}</td>
            <td>${escapeHtml(r.ds.fileName || "—")}</td>
            <td class="text-nowrap"><div class="ds-actions">${actionButtons(r)}</div></td>
          </tr>`;
        }).join("");
      }
      bindActions(rowsEl);
    }
    if (cardsEl) {
      if (!rows.length) {
        cardsEl.innerHTML = `<div class="da-task-empty text-muted">منبعی نیست.</div>`;
      } else {
        cardsEl.innerHTML = pageRows.map((r) => {
          const label = r.ds.title || r.ds.fileName || "منبع";
          return `<div class="da-source-card card mb-2" data-da-row="${escapeHtml(String(r.ds.id ?? ""))}"><div class="card-body">
            <div class="fw-semibold mb-1">${escapeHtml(label)}</div>
            <div class="text-muted small mb-2">${escapeHtml(r.taskTitle)}</div>
            <div class="ds-actions">${actionButtons(r)}</div>
          </div></div>`;
        }).join("");
      }
      bindActions(cardsEl);
    }
    renderListPager(totalPages);
  }

  /** The list pager; hidden when everything fits on one page. */
  function renderListPager(totalPages) {
    const foot = document.getElementById("da-sources-pager");
    if (!foot) return;
    foot.hidden = totalPages <= 1;
    if (foot.hidden) return;
    const info = document.getElementById("da-sources-pageinfo");
    const prev = document.getElementById("da-sources-prev");
    const next = document.getElementById("da-sources-next");
    if (info) info.textContent = `صفحه ${(listPage + 1).toLocaleString("fa-IR")} از ${totalPages.toLocaleString("fa-IR")}`;
    if (prev) prev.disabled = listPage <= 0;
    if (next) next.disabled = listPage >= totalPages - 1;
  }

  function render() {
    paintRows(collectSources());
  }

  async function renderAsync() {
    // Only show the loader when there is nothing on screen yet; a refresh with rows already
    // visible would otherwise flash the table away on every live event.
    if (!lastListRows.length) showListLoading();
    const lib = await fetchLibrarySources();
    if (lib !== null) {
      paintRows(lib);
      return;
    }
    render();
  }

  document.querySelectorAll("[data-portal-ds-close]").forEach((el) => {
    el.addEventListener("click", () => closeViewer());
  });
  document.getElementById("da-portal-ds-refresh")?.addEventListener("click", () => {
    if (viewerState.sourceId == null) return;
    // The modal can now be opened for a LIBRARY row too (two eyes on a diverged source), so the
    // guard must not require a process id — only a source.
    refreshViewer();
  });
  // Replacing the file happens where the data is shown, and follows the view: local view rewrites
  // the browser copy, server view rewrites the server's.
  document.getElementById("da-portal-ds-reload")?.addEventListener("click", () => {
    if (viewerState.sourceId == null) return;
    reloadFromModal();
  });
  // Only meaningful in the local view: pull the server's rows back into the browser copy.
  document.getElementById("da-portal-ds-reset")?.addEventListener("click", () => {
    if (viewerState.sourceId == null) return;
    resetLocalFromServer();
  });
  // The other direction, and the one this screen is usually opened for: send the local result up.
  document.getElementById("da-portal-ds-sync")?.addEventListener("click", async (ev) => {
    if (viewerState.sourceId == null) return;
    const label = viewerSource()?.title || "";
    await syncSourceWithServer(viewerState.sourceId, label, ev.currentTarget);
    await refreshViewer();
  });
  // Excel export lives here now: it exports the copy being LOOKED AT (local or server).
  document.getElementById("da-portal-ds-download")?.addEventListener("click", (ev) => {
    if (viewerState.sourceId == null) return;
    downloadSource(viewerState.taskId, viewerState.sourceId, ev.currentTarget);
  });
  // Paging is pure rendering: the data is already loaded, so this only re-slices the rows.
  document.getElementById("da-portal-ds-prev")?.addEventListener("click", () => {
    if (viewerState.page <= 0) return;
    viewerState.page -= 1;
    const src = viewerState.lastSource || viewerSource();
    if (src) renderViewerTable(src);
  });
  document.getElementById("da-portal-ds-next")?.addEventListener("click", () => {
    const src = viewerState.lastSource || viewerSource();
    if (!src) return;
    const { rows } = dataSourceTableRows(src);
    const totalPages = Math.max(1, Math.ceil(rows.length / GRID_PAGE_SIZE));
    if (viewerState.page >= totalPages - 1) return;
    viewerState.page += 1;
    renderViewerTable(src);
  });

  // Create a shared source. The button is only rendered for the roles that may create one.
  document.getElementById("da-create-public-source")?.addEventListener("click", () => {
    createPublicSource();
  });

  // List paging is pure re-rendering of the rows we already fetched.
  document.getElementById("da-sources-prev")?.addEventListener("click", () => {
    if (listPage <= 0) return;
    listPage -= 1;
    paintRows(lastListRows);
    document.getElementById("da-sources-panel")?.scrollIntoView({ block: "start" });
  });
  document.getElementById("da-sources-next")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(lastListRows.length / LIST_PAGE_SIZE));
    if (listPage >= totalPages - 1) return;
    listPage += 1;
    paintRows(lastListRows);
    document.getElementById("da-sources-panel")?.scrollIntoView({ block: "start" });
  });

  // --- Grid interactions: double-click edits a cell, right-click opens the add menu ----------
  const viewerTable = document.getElementById("da-portal-ds-table");
  if (viewerTable) {
    viewerTable.addEventListener("dblclick", (e) => {
      // A column HEADER double-click renames the column; cells edit their own value instead.
      const th = e.target.closest("th[data-col]");
      if (th) {
        e.preventDefault();
        renameLibraryColumn(viewerState.sourceId, th.dataset.col);
        return;
      }
      const td = e.target.closest("td[data-row][data-col]");
      if (!td) return;
      e.preventDefault();
      beginCellEdit(td);
    });
    viewerTable.addEventListener("contextmenu", (e) => {
      const modal = document.getElementById("da-portal-ds-viewer");
      if (!modal || modal.hidden) return;
      e.preventDefault();
      showGridMenu(
        e.clientX, e.clientY,
        e.target.closest("td[data-row][data-col]"),
        e.target.closest("th[data-col]")
      );
    });
  }

  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("da-portal-ds-viewer");
    if (!modal || modal.hidden) return;
    // Escape belongs to the cell editor while a cell is open — do not close the whole viewer.
    if (e.key === "Escape" && !editingCell) closeViewer();
  });

  document.getElementById("da-portal-ds-clear")?.addEventListener("click", () => {
    if (viewerState.sourceId != null) clearViewerData();
  });

  window.addEventListener("da-local-tasks", () => {
    renderAsync();
    // The local cache is a summary shape; repainting the open grid from it would drop the real
    // cell values and any optimistic revisions, so only repaint when the server load failed.
    if (viewerState.taskId != null && viewerState.sourceId != null && !viewerState.lastSource) {
      const entry = findEntry(viewerState.taskId, viewerState.sourceId);
      if (entry) renderViewerTable(entry.ds);
    }
  });
  window.addEventListener("da-ds-cell-event", (ev) => {
    handleCellEvent(ev.detail || {}, "local");
  });

  function scheduleRender() {
    const run = () => {
      if (window.DaSecureStore && typeof DaSecureStore.whenReady === "function") {
        DaSecureStore.whenReady(() => renderAsync());
      } else {
        renderAsync();
      }
    };
    if (window.DaI18n && DaI18n.ready && typeof DaI18n.ready.then === "function") {
      DaI18n.ready.then(run).catch(run);
    } else {
      run();
    }
  }

  document.addEventListener("da:locale", () => scheduleRender());
  if (window.DaCatalog) {
    DaCatalog.ensure();
    DaCatalog.on("sourceChanged", (payload) => {
      if (!payload) return;
      const who = payload.actorUserName ? ` (${payload.actorUserName})` : "";
      const action = payload.action || "updated";
      if (window.daNotify) {
        const msg = action === "deleted"
          ? ((window.DaI18n ? DaI18n.t("live.sourceDeleted") : null) || "منبع حذف شد")
          : ((window.DaI18n ? DaI18n.t("live.sourceUpdated") : null) || "منبع به‌روز شد");
        daNotify(msg + who, action === "deleted" ? "info" : "success");
      }
      scheduleRender();

      // A source that is open in the viewer has to follow the change, not just the list. Our own
      // cell write already updated the grid, so re-reading on every event would fight the editor; we
      // only pull when somebody else changed the source we are looking at — except for a structural
      // change (rows added/removed/cleared), which must repaint even when the actor is us: the engine
      // runs under the same logged-in user, so the process's own InsertRow looked like "our own
      // write" and the refresh was skipped, leaving the grid on the old row numbering.
      const structural = action === "row_added" || action === "row_deleted" || action === "rows_cleared";
      const changedId = Number(payload.source?.id ?? payload.source?.Id ?? payload.source?.sourceId ?? payload.sourceId);
      const actor = payload.actorUserName || payload.ActorUserName || "";
      const mine = actor && actor === (window.daCurrentUserName || "");
      if (viewerState.sourceId != null && changedId === Number(viewerState.sourceId)) {
        if (action === "deleted") closeViewer();
        // A cell write carries the new value itself, so apply it here instead of walking the whole
        // source again. Without this the grid kept the old value: the engine writes as the same
        // user, and "our own write" only meant "skip" — nothing refreshed until the next structural
        // change happened to reload the source.
        else if (action === "cell_patched") {
          applyCatalogCell(payload);
          // Someone else's write: still pull, so the revisions our next edit checks against are exact.
          if (!mine) refreshViewer();
        }
        else if (!mine || structural) refreshViewer();
      }

      setTimeout(() => {
        const tid = payload.taskId ?? payload.TaskId;
        // A process change names its process; a library change has no process at all, so the row to
        // light up is the source itself — matching by taskId alone left every library row unlit.
        const matchId = Number(payload.source?.id ?? payload.source?.Id ?? payload.source?.sourceId ?? payload.sourceId);
        document.querySelectorAll(`#da-source-rows tr, #da-source-cards .da-source-card`).forEach((el) => {
          const self = Number.isFinite(matchId) && Number(el.dataset.daRow) === matchId;
          const link = self
            ? el
            : (el.querySelector(`a[href*="/Editor/${tid}"]`) || el.querySelector(`[data-task="${tid}"]`));
          if (!link && !String(el.innerHTML || "").includes(`/Editor/${tid}`)) return;
          el.classList.add("da-row-flash");
          setTimeout(() => el.classList.remove("da-row-flash"), 1600);
        });
      }, 250);
    });
    DaCatalog.on("taskChanged", (payload) => {
      if (!payload) return;
      if (payload.action === "deleted") {
        scheduleRender();
        return;
      }
      scheduleRender();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRender);
  } else {
    scheduleRender();
  }
  // The extension owns the run records; this page only sees the mirror written on the last push.
  // Without asking once on open, the sources list judged every row from a copy that a run finished
  // elsewhere had never updated — so "local data" looked empty and Sync had nothing to send.
  try { window.dispatchEvent(new CustomEvent("da-request-local-tasks")); } catch { /* no extension */ }
})();
