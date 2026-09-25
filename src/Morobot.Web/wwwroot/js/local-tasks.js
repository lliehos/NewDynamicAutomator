(function () {
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

  let suppressLocalTasksRender = false;

  function writeTasks(tasks, opts) {
    const silent = !!(opts && opts.silent);
    if (silent) suppressLocalTasksRender = true;
    try {
      if (window.DaSecureStore) {
        DaSecureStore.writeTasks(tasks);
        return;
      }
      localStorage.setItem(tasksKey(), JSON.stringify(tasks));
      localStorage.setItem("da_local_user", currentUser());
      if (!silent) {
        window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
      }
    } finally {
      if (silent) suppressLocalTasksRender = false;
    }
  }

  function notifyHome(message, type) {
    const status = document.getElementById("da-portal-status");
    if (status && message != null) status.textContent = String(message);
    if (message && typeof window.daNotify === "function") {
      const kind = type === "warning" ? "warn" : (type || "info");
      window.daNotify(String(message), kind);
    }
  }

  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function dateLocale() {
    return (window.DaI18n && DaI18n.culture === "en") ? "en-US" : "fa-IR";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function dataSourceCount(t) {
    if (Array.isArray(t.graph?.dataSources)) return t.graph.dataSources.length;
    if (t.dataSourceCount != null) return Number(t.dataSourceCount) || 0;
    return 0;
  }

  function formatCreatedAt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(dateLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatEditMeta(iso, userName) {
    const when = formatCreatedAt(iso);
    const who = (userName || "").trim();
    if (when === "—" && !who) return "—";
    const parts = [];
    if (when !== "—") parts.push(`<div class="da-edit-meta-when">${escapeHtml(when)}</div>`);
    if (who) parts.push(`<div class="da-edit-meta-user text-muted small">${escapeHtml(who)}</div>`);
    return `<div class="da-edit-meta">${parts.join("")}</div>`;
  }

  function editMetaIso(row, kind) {
    if (kind === "data") return row.dataUpdatedAtUtc || row.dataUpdatedAt || null;
    return row.updatedAtUtc || row.updatedAt || row.processUpdatedAt || null;
  }

  function editMetaUser(row, kind) {
    if (kind === "data") return row.dataLastEditorUserName || row.dataLastEditor || "";
    return row.lastEditorUserName || row.lastEditor || "";
  }

  /**
   * Last run cell: the time and user of the most recent play, plus a button that opens the
   * process's run history.
   *
   * A process that has never been run shows a dash and no history button, rather than an empty
   * cell: run starts are recorded, so "no record" genuinely means "never run" and the button
   * would open an empty list.
   */
  function formatLastRun(row) {
    const when = formatCreatedAt(row.lastPlayedAtUtc || row.lastPlayedAt || null);
    const who = String(row.lastPlayedByUserName || row.lastPlayedBy || "").trim();
    const count = Number(row.playCount || 0);
    if (when === "—") {
      return `<span class="text-muted">${escapeHtml(t("tasks.neverRun"))}</span>`;
    }
    const parts = [`<div class="da-edit-meta-when">${escapeHtml(when)}</div>`];
    if (who) parts.push(`<div class="da-edit-meta-user text-muted small">${escapeHtml(who)}</div>`);
    const countLabel = count > 1
      ? `<span class="da-run-count" title="${escapeHtml(t("tasks.runCount"))}">×${count}</span>`
      : "";
    const taskId = escapeHtml(String(row.id));
    const historyTitle = escapeHtml(t("tasks.runHistory"));
    return `<div class="da-last-run">
      <div class="da-edit-meta">${parts.join("")}</div>
      ${countLabel}
      <button type="button" class="da-run-history-btn" data-run-history="${taskId}"
              title="${historyTitle}" aria-label="${historyTitle}">
        <i class="ti ti-history" aria-hidden="true"></i>
      </button>
    </div>`;
  }

  function sharedUsersLabel(users, count) {
    const list = Array.isArray(users) ? users.map((u) => String(u || "").trim()).filter(Boolean) : [];
    if (list.length) return list.join(dateLocale().startsWith("fa") ? "، " : ", ");
    const n = Number(count) || 0;
    if (n > 0) return String(n);
    return "—";
  }

  function normalizeTask(t) {
    const owner = (t.createdBy || "").trim() || currentUser();
    let id = t.id;
    if (id == null || id === "") id = newProcessId();
    else id = String(id);
    return {
      ...t,
      id,
      createdBy: owner,
      ownerUser: (t.ownerUser || owner).trim() || owner,
      sharedUsers: Array.isArray(t.sharedUsers)
        ? t.sharedUsers.map((u) => String(u || "").trim()).filter(Boolean)
        : [],
      createdAt: t.createdAt || null
    };
  }

  /** Unique process id for future server key: (ownerUser, id). */
  function newProcessId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch { /* ignore */ }
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function taskIdEq(a, b) {
    return String(a) === String(b);
  }

  function findTaskIndex(tasks, taskId) {
    return tasks.findIndex((x) => taskIdEq(x.id, taskId));
  }

  function findTask(tasks, taskId) {
    return tasks.find((x) => taskIdEq(x.id, taskId));
  }

  const ICO_PLAY = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>`;
  const ICO_REC = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>`;
  /** Robot head only (not brand mark / browser chrome). */
  const ICO_SMART = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="10.5" y="2.5" width="3" height="3.2" rx="1" fill="currentColor"/><circle cx="12" cy="2.2" r="1.4" fill="currentColor"/><rect x="5" y="6.5" width="14" height="13" rx="3.5" fill="currentColor"/><circle cx="9.2" cy="12" r="1.7" fill="#fff"/><circle cx="14.8" cy="12" r="1.7" fill="#fff"/><rect x="9" y="15.8" width="6" height="1.6" rx="0.8" fill="#fff" opacity="0.9"/></svg>`;
  const ICO_EDIT = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5zm16.7-11.2a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5 1.6-1.6z"/></svg>`;
  const ICO_SHARE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18 16.1a2.9 2.9 0 0 0-2.3 1.1l-6.4-3.3a2.9 2.9 0 0 0 0-1.8l6.4-3.3A2.9 2.9 0 1 0 15 6a2.9 2.9 0 0 0 .1.7L8.7 10a2.9 2.9 0 1 0 0 4l6.4 3.3a2.9 2.9 0 1 0 2.9-1.2z"/></svg>`;
  const ICO_DL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3v10.2l3.4-3.4 1.4 1.4L12 17l-4.8-5.8 1.4-1.4L11 13.2V3h1zM5 19h14v2H5v-2z"/></svg>`;
  const ICO_UP = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 21V10.8l3.4 3.4 1.4-1.4L12 7l-4.8 5.8 1.4 1.4L11 10.8V21h1zM5 3h14v2H5V3z"/></svg>`;
  const ICO_CLONE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 7h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm-3 3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1H8a3 3 0 0 0-3 3v7z"/></svg>`;
  // "Make a template from this" — a dashed outline around a copy, to read as "the skeleton of a
  // process" rather than as the plain duplicate the clone button already means.
  const ICO_COPY = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V8h3.5L14 4.5zM4 7h1v13h10v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/></svg>`;
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;
  const ICO_VIEW = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c5.2 0 9.3 3.4 10.7 7-1.4 3.6-5.5 7-10.7 7S2.7 15.6 1.3 12C2.7 8.4 6.8 5 12 5zm0 2.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm0 2A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5z"/></svg>`;
  const ICO_XLSX = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm1 7V3.5L19.5 9H15zM8.2 18l2.3-3.2L8.3 12h1.7l1.4 2.1L12.8 12H14.4l-2.2 2.8L14.5 18h-1.7l-1.5-2.2L9.9 18H8.2z"/></svg>`;

  function iconBtn(cls, title, iconHtml, extra = "") {
    return `<button type="button" class="ds-icon-btn ${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${extra}>${iconHtml}</button>`;
  }

  function iconLink(cls, title, href, iconHtml) {
    return `<a class="ds-icon-btn ${cls}" href="${href}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${iconHtml}</a>`;
  }
  function isServerBackedTaskId(id) {
    return /^\d+$/.test(String(id ?? "").trim());
  }

  function taskCounts(t) {
    // Server-backed rows: counts always come from API metadata (GraphJson on server), not stale local graph.
    if (isServerBackedTaskId(t?.id)) {
      return {
        steps: Number(t.stepCount) || 0,
        groups: Number(t.groupCount) || 0,
        sources: Number(t.dataSourceCount ?? dataSourceCount(t)) || 0
      };
    }
    if (t.graph?.nodes && Array.isArray(t.graph.nodes)) {
      const steps = t.graph.nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
      const groups = t.graph.nodes.filter((n) => n.kind === "group").length;
      return { steps, groups, sources: dataSourceCount(t) };
    }
    return {
      steps: Number(t.stepCount) || 0,
      groups: Number(t.groupCount) || 0,
      sources: dataSourceCount(t)
    };
  }

  function safeFileName(title) {
    const base = String(title || "process").trim() || "process";
    return base.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").slice(0, 80);
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function exportTaskPayload(task) {
    return {
      format: "morobot-task",
      version: 3,
      exportedAt: new Date().toISOString(),
      task: {
        id: task.id,
        ownerUser: task.ownerUser || task.createdBy,
        title: task.title,
        designOrigin: task.designOrigin || task.graph?.designOrigin || "Manual",
        groupCount: task.groupCount,
        stepCount: task.stepCount,
        dataSourceCount: task.dataSourceCount,
        createdAt: task.createdAt,
        createdBy: task.createdBy,
        sharedUsers: task.sharedUsers || [],
        graph: task.graph || null
      }
    };
  }

  async function downloadTask(task) {
    if (!task) return;
    const payload = exportTaskPayload(task);
    let body;
    let fileName;
    try {
      if (window.DaSecureStore) {
        body = await DaSecureStore.packMrbt(payload);
        fileName = `${safeFileName(task.title)}.mrbt`;
      } else {
        body = JSON.stringify(payload, null, 2);
        fileName = `${safeFileName(task.title)}.json`;
      }
    } catch (e) {
      notifyHome(e.message || "export failed", "error");
      return;
    }
    const blob = new Blob([body], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    notifyHome(t("tasks.downloaded", { title: task.title }), "success");
  }

  async function parseImportedTask(raw) {
    let data = raw;
    if (typeof raw === "string") {
      if (window.DaSecureStore) {
        data = await DaSecureStore.unpackMrbt(raw);
      } else {
        data = JSON.parse(raw);
      }
    }
    if (!data || typeof data !== "object") throw new Error(t("tasks.badFile") || "invalid");
    let task = null;
    if (data.format === "dynamic-automator-task" && data.task) task = data.task;
    else if (data.format === "morobot-task" && data.task) task = data.task;
    else if (data.graph || data.title) task = data;
    else if (data.nodes && Array.isArray(data.nodes)) {
      task = { title: data.title || t("tasks.newProcess"), graph: data };
    }
    if (!task?.graph || !Array.isArray(task.graph.nodes)) {
      throw new Error(t("tasks.noGraph") || "no graph");
    }
    return task;
  }

  function applyImportToTask(taskId, imported) {
    const tasks = readTasks();
    const idx = findTaskIndex(tasks, taskId);
    if (idx < 0) throw new Error("فرآیند پیدا نشد.");
    const current = tasks[idx];
    const graph = deepClone(imported.graph);
    graph.taskId = current.id;
    graph.title = (imported.title || current.title || "فرآیند").trim() || current.title;
    graph.canModify = true;
    const counts = taskCounts({ graph });
    tasks[idx] = {
      ...current,
      title: graph.title,
      designOrigin: imported.designOrigin || graph.designOrigin || current.designOrigin || "Manual",
      groupCount: counts.groups,
      stepCount: counts.steps,
      dataSourceCount: counts.sources,
      sharedUsers: Array.isArray(imported.sharedUsers) ? imported.sharedUsers : (current.sharedUsers || []),
      graph
    };
    writeTasks(tasks);
    render(tasks);
    notifyHome(`فرآیند «${tasks[idx].title}» از فایل به‌روز شد.`, "success");
  }

  function cloneTask(task) {
    if (!task) return;
    const tasks = readTasks();
    const id = newProcessId();
    const owner = currentUser();
    const copy = deepClone(task);
    copy.id = id;
    copy.title = `${(task.title || "فرآیند").trim()} (کپی)`;
    copy.createdAt = new Date().toISOString();
    copy.createdBy = owner;
    copy.ownerUser = owner;
    copy.sharedUsers = [];
    if (copy.graph) {
      copy.graph = deepClone(copy.graph);
      copy.graph.taskId = id;
      copy.graph.title = copy.title;
    }
    const counts = taskCounts(copy);
    copy.groupCount = counts.groups;
    copy.stepCount = counts.steps;
    copy.dataSourceCount = counts.sources;
    tasks.push(copy);
    writeTasks(tasks);
    render(tasks);
    notifyHome(`کپی «${copy.title}» ساخته شد.`, "success");
  }

  /**
   * Copy a process, preferring the server.
   *
   * A server-backed process must be copied on the server: a browser-only copy existed on one
   * machine, disappeared on the next sign-in, and never had its data-source links created (those
   * live in their own table). Local-only processes keep the local path because they have no row.
   */
  async function cloneTaskById(id, btn) {
    const tasks = readTasks();
    const task = findTask(tasks, id);
    const serverBacked = /^\d+$/.test(String(id));
    if (!serverBacked) {
      cloneTask(task);
      return;
    }

    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/clone`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) {
        let msg = t("tasks.cloneFailed") || "کپی فرآیند انجام نشد.";
        try {
          const body = await res.json();
          if (body && body.message) msg = body.message;
        } catch { /* keep the generic message */ }
        notifyHome(msg, "error");
        return;
      }
      const created = await res.json();
      // Re-read the list from the server so the new row appears with the same shape as the rest
      // (permissions, counts, last-run) rather than a hand-built entry that could drift.
      scheduleRender();
      notifyHome(`کپی «${(created && created.title) || ""}» ساخته شد.`, "success");
    } catch (e) {
      notifyHome(t("tasks.cloneFailed") || "کپی فرآیند انجام نشد.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function recordAllowed() {
    const e = window.DaEntitlements?.get?.();
    if (!e) return true;
    return !!e.canRecord;
  }

  function actionButtonsHtml(task) {
    const tid = escapeHtml(String(task.id));
    const ttitle = escapeHtml(String(task.title || "").trim());
    const counts = taskCounts(task);
    const isEmpty = !counts.steps;
    const hasData = counts.sources > 0;
    const canRec = recordAllowed();
    const recTip = canRec
      ? t("tasks.record")
      : (window.DaEntitlements?.upgradeMessage?.("record") || t("plan.upgradeRecord") || "ضبط نیاز به پلن Pro دارد.");
    const recExtra = canRec
      ? `data-da-action="start-record-menu" data-task-id="${tid}" data-task-title="${ttitle}" aria-haspopup="menu"`
      : `data-da-action="start-record-menu" data-task-id="${tid}" data-task-title="${ttitle}" disabled aria-disabled="true" title="${escapeHtml(recTip)}"`;
    const smartBtn = isEmpty
      ? iconBtn("is-smart", t("tasks.smart"), ICO_SMART, `data-da-action="start-smart-record" data-task-id="${tid}" data-task-title="${ttitle}"`)
      : "";
    const dataBtns = hasData
      ? `${iconBtn("is-view", t("tasks.viewData"), ICO_VIEW, `data-da-view-data="${tid}"`)}
         ${iconBtn("is-xlsx", t("tasks.downloadExcel"), ICO_XLSX, `data-da-dl-excel="${tid}"`)}`
      : "";
    return `
      ${iconLink("is-edit", t("tasks.edit"), `/Panel/Tasks/Editor/${encodeURIComponent(task.id)}`, ICO_EDIT)}
      ${iconBtn("is-play", t("tasks.play"), ICO_PLAY, `data-da-action="play-task-menu" data-task-id="${tid}" aria-haspopup="menu"`)}
      ${iconBtn("is-rec", recTip, ICO_REC, recExtra)}
      ${smartBtn}
      ${dataBtns}
      ${iconBtn("", t("tasks.clone"), ICO_CLONE, `data-da-clone="${tid}"`)}
      ${iconBtn("", t("tasks.downloadMrbt"), ICO_DL, `data-da-download="${tid}"`)}
      ${task.templateId
        ? ""
        : iconBtn("", t("tasks.makeTemplate"), ICO_COPY, `data-da-make-template="${tid}" data-task-title="${ttitle}"`)}
      <label class="ds-icon-btn da-import-btn" title="${t("tasks.importMrbt")}" aria-label="${t("tasks.importMrbt")}">
        ${ICO_UP}
        <input type="file" accept=".mrbt,application/octet-stream,application/json,.json" data-da-import="${tid}" hidden />
      </label>
      ${task.canShare
        ? iconBtn("", t("tasks.share"), ICO_SHARE, `data-da-share="${tid}"`)
        : ""}
      ${task.canDelete !== false
        ? iconBtn("is-danger", t("tasks.delete"), ICO_DEL, `data-da-del="${tid}"`)
        : ""}`;
  }

  function bindTaskActions(root) {
    root?.querySelectorAll("[data-da-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-da-del");
        const ok = window.DaNotify
          ? await DaNotify.confirm(t("tasks.deleteConfirm") || "این فرآیند حذف شود؟", {
              title: t("tasks.delete"),
              danger: true,
              okText: t("tasks.delete")
            })
          : false;
        if (!ok) return;
        try {
          if (/^\d+$/.test(String(id))) {
            const res = await fetch(`/api/tasks/${id}`, { method: "DELETE", credentials: "same-origin" });
            if (!res.ok && res.status !== 204) {
              const body = await res.json().catch(() => ({}));
              notifyHome(body.message || t("share.error") || "حذف ناموفق بود.", "error");
              return;
            }
          }
          const next = readTasks().filter((x) => !taskIdEq(x.id, id));
          writeTasks(next);
          render(next);
          notifyHome(t("tasks.deleted") || "فرآیند حذف شد.", "success");
        } catch (e) {
          notifyHome(String(e.message || e), "error");
        }
      });
    });
    root?.querySelectorAll("[data-da-share]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-da-share");
        const task = findTask(readTasks(), id);
        if (window.DaTaskShare) {
          DaTaskShare.open(id, task?.title || "");
          return;
        }
        notifyHome(t("share.unavailable") || "اشتراک‌گذاری در دسترس نیست.", "warn");
      });
    });
    root?.querySelectorAll("[data-da-download]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-da-download");
        const task = findTask(readTasks(), id);
        downloadTask(task);
      });
    });
    root?.querySelectorAll("[data-da-clone]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-da-clone");
        await cloneTaskById(id, btn);
      });
    });
    root?.querySelectorAll("input[data-da-import]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const id = inp.getAttribute("data-da-import");
        const file = inp.files?.[0];
        inp.value = "";
        if (!file) return;
        try {
          const text = await file.text();
          const imported = await parseImportedTask(text);
          if (!confirm(`محتوای فرآیند با فایل «${file.name}» جایگزین شود؟`)) return;
          applyImportToTask(id, imported);
        } catch (e) {
          notifyHome(e.message || "خطا در بارگذاری فایل", "error");
        }
      });
    });
    root?.querySelectorAll("[data-da-view-data]").forEach((btn) => {
      btn.addEventListener("click", () => viewProcessData(btn.getAttribute("data-da-view-data"), btn));
    });
    root?.querySelectorAll("[data-da-dl-excel]").forEach((btn) => {
      btn.addEventListener("click", () => downloadProcessExcel(btn.getAttribute("data-da-dl-excel"), btn));
    });
    // Turn a process into a template. The post and the notifying live in local-templates.js, so the
    // table stays out of the template rules and only has to hand over the id and the title.
    root?.querySelectorAll("[data-da-make-template]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.DaTemplates && typeof DaTemplates.makeFromProcess === "function") {
          DaTemplates.makeFromProcess(
            btn.getAttribute("data-da-make-template"),
            btn.getAttribute("data-task-title") || ""
          );
          return;
        }
        notifyHome(t("tasks.templateNotAvailable") || "ساخت قالب در دسترس نیست.", "warn");
      });
    });
  root?.querySelectorAll("[data-run-history]").forEach((btn) => {
    btn.addEventListener("click", () => showRunHistory(btn.getAttribute("data-run-history")));
  });
}

/**
 * Open the recorded runs of one process.
 *
 * Fetched on click rather than shipped with the list: it is one request per process the user
 * actually asks about, instead of one per row on every page load.
 *
 * Rendered as a small dialog rather than a route, so the user keeps their place in the list and
 * can check several processes in a row. The markup is created on first use and reused after.
 */
async function showRunHistory(taskId) {
  if (!taskId) return;
  let entries = [];
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/runs`, { credentials: "same-origin" });
    if (res.ok) entries = await res.json();
  } catch (err) {
    console.warn("[local-tasks] run history failed", err);
  }

  const list = Array.isArray(entries) ? entries : [];
  const bodyHtml = list.length
    ? `<ul class="da-run-history">${list.map((e) => {
        const when = escapeHtml(formatCreatedAt(e.atUtc || e.AtUtc));
        const who = escapeHtml(String(e.userName || e.UserName || "").trim() || "—");
        return `<li class="da-run-history-item"><span class="da-run-history-when">${when}</span><span class="da-run-history-who">${who}</span></li>`;
      }).join("")}</ul>`
    : `<p class="da-run-history-empty text-muted">${escapeHtml(t("tasks.neverRun"))}</p>`;

  let host = document.getElementById("da-run-history-modal");
  if (!host) {
    host = document.createElement("div");
    host.id = "da-run-history-modal";
    host.className = "da-run-history-modal";
    host.hidden = true;
    host.innerHTML = `
      <div class="da-run-history-backdrop" data-run-history-close="1"></div>
      <div class="da-run-history-box" role="dialog" aria-modal="true" aria-labelledby="da-run-history-title">
        <div class="da-run-history-head">
          <h5 id="da-run-history-title"></h5>
          <button type="button" class="da-run-history-close" data-run-history-close="1" aria-label="${escapeHtml(t("common.close"))}">&times;</button>
        </div>
        <div class="da-run-history-body"></div>
      </div>`;
    document.body.appendChild(host);
    host.querySelectorAll("[data-run-history-close]").forEach((el) => {
      el.addEventListener("click", () => { host.hidden = true; });
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") host.hidden = true;
    });
  }
  host.querySelector("#da-run-history-title").textContent = t("tasks.runHistory");
  host.querySelector(".da-run-history-body").innerHTML = bodyHtml;
  host.hidden = false;
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

  function pickProcessDataSource(canvas) {
    const list = Array.isArray(canvas?.dataSources) ? canvas.dataSources : [];
    if (!list.length) return null;
    const start = (canvas.nodes || []).find((n) => n.kind === "start" && !n.groupNodeId);
    const masterId = start?.dataSourceId ?? canvas.masterDataSourceId ?? null;
    if (masterId != null) {
      const hit = list.find((d) => Number(d.id) === Number(masterId));
      if (hit) return hit;
    }
    return list[0];
  }

  async function loadProcessDataSource(taskId) {
    const local = findTask(readTasks(), taskId);
    if (local?.graph?.dataSources?.length) {
      const ds = pickProcessDataSource(local.graph);
      if (ds) return { taskId, ds, taskTitle: local.title };
    }
    if (!/^\d+$/.test(String(taskId))) return null;
    const canvasRes = await fetch(`/api/tasks/${taskId}/canvas`, { credentials: "same-origin" });
    if (!canvasRes.ok) throw new Error("canvas " + canvasRes.status);
    const canvas = await canvasRes.json();
    const thin = pickProcessDataSource(canvas);
    if (!thin) return null;
    const sid = Number(thin.id);
    if (Number.isFinite(sid) && sid > 0) {
      try {
        const fullRes = await fetch(`/api/datasources/${sid}`, { credentials: "same-origin" });
        if (fullRes.ok) {
          const full = await fullRes.json();
          return { taskId, ds: full, taskTitle: canvas.title || local?.title || "" };
        }
      } catch { /* use canvas snapshot */ }
    }
    return { taskId, ds: thin, taskTitle: canvas.title || local?.title || "" };
  }

  function renderProcessViewerTable(ds) {
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
    processViewerState.source = ds;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    if (!thead || !tbody) return;
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>`
      + headers.map((h, ci) => `<th data-col="${escapeHtml(colKeys[ci])}" title="${escapeHtml(h)}">${escapeHtml(h)}</th>`).join("")
      + `</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">ردیفی نیست — راست‌کلیک کنید و ردیف اضافه کنید</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) =>
      `<tr><th class="ds-row-idx">${i + 1}</th>${r.map((v, ci) =>
        `<td data-row="${i}" data-col="${escapeHtml(colKeys[ci])}" title="${escapeHtml(processCellTooltip(i, colKeys[ci]))}">${escapeHtml(v)}</td>`
      ).join("")}</tr>`
    ).join("");
  }

  /**
   * Tooltip for one cell on the processes grid: who last changed it and when. Grid-only — the
   * Excel export carries the data and must not embed this change log.
   */
  function processCellTooltip(rowIndex, columnKey) {
    const hint = t("sources.inlineEditHint") || "برای ویرایش دابل‌کلیک کنید";
    const meta = processViewerState.cellMeta?.[rowIndex]?.[columnKey];
    const when = formatProcessCellStamp(meta?.updatedAtUtc);
    if (!meta || (!meta.userName && !when)) {
      return when
        ? `${hint}\n${t("sources.cellMetaImported") || "وارد‌شده از فایل"} · ${when}`
        : hint;
    }
    const byUser = meta.userName ? (t("sources.cellMetaEditedBy", { user: meta.userName }) || meta.userName) : "";
    const atTime = when ? (t("sources.cellMetaEditedAt", { time: when }) || when) : "";
    return [hint, [byUser, atTime].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  }

  /** Language-aware stamp so a Persian UI shows a Jalali date and an English UI a Gregorian one. */
  function formatProcessCellStamp(iso) {
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

  // --- Grid editing on the processes page (same behaviour as the sources page) ----------------
  const processViewerState = { source: null, cellRevisions: null, cellMeta: null, editing: null };

  /**
   * Read a source's current content straight from the server, paging until it is exhausted.
   *
   * Showing or exporting from the local cache would display whatever was true when the page
   * loaded, and the canvas list payload carries no cell values at all. Paging also means a source
   * with more rows than one response can hold is never silently truncated.
   */
  async function fetchProcessSourceContent(sourceId) {
    const PAGE = 500;
    const first = await fetch(`/api/datasources/${sourceId}/rows?from=0&count=${PAGE}`, { credentials: "same-origin" });
    if (!first.ok) throw new Error(`rows ${first.status}`);
    const head = await first.json();

    const columns = head.columns || [];
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

    let got = (head.rows || []).length;
    const total = Number(head.rowCount) || got;
    while (got < total) {
      const next = await fetch(`/api/datasources/${sourceId}/rows?from=${got}&count=${PAGE}`, { credentials: "same-origin" });
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
      columnKeys: head.columnKeys || columns.map((c) => c.key),
      cells,
      rowCount: Math.max(total, got),
      columnCount: head.columnCount ?? columns.length,
      cellRevisions,
      cellMeta
    };
  }

  /** Re-read the open source from the server: the list payload is a summary without cell values. */
  async function refreshProcessViewer() {
    const sourceId = processViewerState.source?.id;
    if (!sourceId) return;
    try {
      const fresh = await fetchProcessSourceContent(sourceId);
      processViewerState.cellRevisions = fresh.cellRevisions;
      processViewerState.cellMeta = fresh.cellMeta;
      delete fresh.cellRevisions;
      delete fresh.cellMeta;
      renderProcessViewerTable(fresh);
    } catch { /* keep the current grid */ }
  }

  /** Record the editor stamp for one cell so a re-render shows the right tooltip. */
  function setProcessCellMeta(rowIndex, columnKey, userId, userName, updatedAtUtc) {
    if (!processViewerState.cellMeta) processViewerState.cellMeta = {};
    processViewerState.cellMeta[rowIndex] = processViewerState.cellMeta[rowIndex] || {};
    processViewerState.cellMeta[rowIndex][columnKey] = {
      userId: userId ?? null,
      userName: userName ?? null,
      updatedAtUtc: updatedAtUtc ?? new Date().toISOString()
    };
  }

  function processCellRevision(rowIndex, columnKey) {
    const row = processViewerState.cellRevisions?.[rowIndex];
    return row ? row[columnKey] : undefined;
  }

  function setProcessLocalCell(source, rowIndex, columnKey, value) {
    source.cells = Array.isArray(source.cells) ? source.cells : [];
    const hit = source.cells.find((c) =>
      (c.key === columnKey || c.Key === columnKey)
      && Number(c.index ?? c.Index ?? c.rowIndex) === rowIndex);
    if (hit) {
      if (hit.cellValue !== undefined) hit.cellValue = value;
      else if (hit.CellValue !== undefined) hit.CellValue = value;
      else hit.value = value;
    } else {
      source.cells.push({ key: columnKey, index: rowIndex, cellValue: value });
    }
  }

  async function saveProcessCell(rowIndex, columnKey, value) {
    const sourceId = processViewerState.source?.id;
    if (!sourceId) return false;
    try {
      const res = await fetch(`/api/datasources/${sourceId}/cells`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIndex,
          columnKey,
          cellValue: value,
          expectedCellRevision: processCellRevision(rowIndex, columnKey)
        })
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        notifyHome(t("sources.cellConflict") || "این سلول توسط کاربر دیگری تغییر کرده است.", "warn");
        if (!processViewerState.cellRevisions) processViewerState.cellRevisions = {};
        processViewerState.cellRevisions[rowIndex] = processViewerState.cellRevisions[rowIndex] || {};
        if (body.currentCellRevision != null) processViewerState.cellRevisions[rowIndex][columnKey] = body.currentCellRevision;
        // The value now on screen belongs to the other writer, so the tooltip must name them.
        setProcessCellMeta(rowIndex, columnKey, body.currentCellUserId, body.currentCellUserName, body.currentCellUpdatedAtUtc);
        const td = document.querySelector(`#da-portal-ds-table td[data-row="${rowIndex}"][data-col="${CSS.escape(columnKey)}"]`);
        if (td) {
          if (body.currentCellValue != null) td.textContent = String(body.currentCellValue);
          td.title = processCellTooltip(rowIndex, columnKey);
        }
        if (processViewerState.source && body.currentCellValue != null) {
          setProcessLocalCell(processViewerState.source, rowIndex, columnKey, body.currentCellValue);
        }
        return false;
      }
      if (!res.ok) throw new Error(`cell ${res.status}`);
      const body = await res.json();
      if (!processViewerState.cellRevisions) processViewerState.cellRevisions = {};
      processViewerState.cellRevisions[rowIndex] = processViewerState.cellRevisions[rowIndex] || {};
      if (body.cellRevision != null) processViewerState.cellRevisions[rowIndex][columnKey] = body.cellRevision;
      // We wrote this value — the tooltip should now name us and when we wrote it.
      setProcessCellMeta(rowIndex, columnKey, body.lastEditorUserId, body.lastEditorUserName, body.updatedAtUtc);
      if (processViewerState.source) setProcessLocalCell(processViewerState.source, rowIndex, columnKey, value);
      notifyHome(t("sources.cellSaved") || "سلول ذخیره شد.", "success");
      return true;
    } catch (e) {
      notifyHome(e.message || t("sources.cellSaveFail") || "ذخیرهٔ سلول ناموفق بود.", "error");
      return false;
    }
  }

  function beginProcessCellEdit(td) {
    if (!td || processViewerState.editing) return;
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
    processViewerState.editing = { td, input, rowIndex, columnKey, before, done: false };

    const finish = async (commit) => {
      const state = processViewerState.editing;
      if (!state || state.done) return;
      state.done = true;
      const next = input.value;
      td.classList.remove("ds-cell-editing");
      td.textContent = commit ? next : before;
      processViewerState.editing = null;
      if (!commit || next === before) return;
      const ok = await saveProcessCell(rowIndex, columnKey, next);
      if (!ok) td.textContent = before;
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  function showProcessGridMenu(x, y, td) {
    const source = processViewerState.source;
    if (!source) return;
    const rowIndex = td ? Number(td.dataset.row) : null;
    const columnKey = td ? td.dataset.col : null;

    let items = [
      { id: "row-after", label: t("sources.addRowAfter") || "افزودن ردیف بعد از این" },
      { id: "row-before", label: t("sources.addRowBefore") || "افزودن ردیف قبل از این" },
      { sep: true },
      { id: "col-after", label: t("sources.addColAfter") || "افزودن ستون بعد از این" },
      { id: "col-before", label: t("sources.addColBefore") || "افزودن ستون قبل از این" }
    ];
    if (!td) {
      items = [
        { id: "row-append", label: t("sources.addRowAppend") || "افزودن ردیف در پایان" },
        { sep: true },
        { id: "col-append", label: t("sources.addColAppend") || "افزودن ستون در پایان" }
      ];
    }

    const menu = document.createElement("div");
    menu.className = "ds-grid-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items.map((it) => it.sep
      ? `<div class="ds-grid-menu-sep"></div>`
      : `<button type="button" class="ds-grid-menu-item" data-action="${it.id}">${escapeHtml(it.label)}</button>`
    ).join("");
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;

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
      await runProcessGridAction(action, rowIndex, columnKey);
    });
  }

  function nextProcessColumnKey(existingKeys) {
    const used = new Set((existingKeys || []).map((k) => String(k).toLowerCase()));
    let n = used.size + 1;
    while (used.has(`c${n}`)) n++;
    return `c${n}`;
  }

  async function runProcessGridAction(action, rowIndex, columnKey) {
    const source = processViewerState.source;
    const sourceId = source?.id;
    if (!sourceId) return;
    const beforeIndexFor = (kind) => {
      if (action === `${kind}-before`) return rowIndex ?? undefined;
      if (action === `${kind}-after`) return rowIndex == null ? undefined : rowIndex + 1;
      return undefined;
    };
    try {
      if (action.startsWith("row-")) {
        const res = await fetch(`/api/datasources/${sourceId}/rows/add`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beforeIndex: beforeIndexFor("row"), count: 1 })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.addRowFail") || "افزودن ردیف ناموفق بود.");
        notifyHome(t("sources.rowAdded") || "ردیف اضافه شد.", "success");
      } else {
        const existing = (source.columnKeys || source.columns || []).map((c) => String(c.key || c.Key || c));
        const key = nextProcessColumnKey(existing);
        const res = await fetch(`/api/datasources/${sourceId}/columns`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, title: key, beforeIndex: beforeIndexFor("col") })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("sources.addColFail") || "افزودن ستون ناموفق بود.");
        notifyHome(t("sources.colAdded", { key: body.addedColumnKey || key }) || `ستون «${body.addedColumnKey || key}» اضافه شد.`, "success");
      }
      await refreshProcessViewer();
    } catch (e) {
      notifyHome(e.message || "انجام نشد.", "error");
    }
  }

  async function viewProcessData(taskId, btn) {
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    try {
      const hit = await loadProcessDataSource(taskId);
      if (!hit?.ds) {
        notifyHome(t("tasks.noDataSource"), "warn");
        return;
      }
      renderProcessViewerTable(hit.ds);
      const modal = document.getElementById("da-portal-ds-viewer");
      if (modal) modal.hidden = false;
      else { notifyHome("نمایشگر داده در این صفحه نیست.", "error"); return; }
      // The list/canvas snapshot is a summary without cell VALUES, so pull the real rows (and the
      // per-cell revisions the inline editor needs) before anyone tries to edit.
      await refreshProcessViewer();
    } catch (e) {
      notifyHome(String(e.message || e), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    }
  }

  async function downloadProcessExcel(taskId, btn) {
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    try {
      const hit = await loadProcessDataSource(taskId);
      if (!hit?.ds) {
        notifyHome(t("tasks.noDataSource"), "warn");
        return;
      }
      // Export the server's current content, never the page-load snapshot: the canvas payload is a
      // summary with no cell values, so downloading from it could hand the user stale numbers.
      let ds = hit.ds;
      const sourceId = Number(ds.id);
      if (Number.isFinite(sourceId) && sourceId > 0) {
        try {
          ds = await fetchProcessSourceContent(sourceId);
        } catch { /* fall back to the snapshot below */ }
      }
      const table = dataSourceTableRows(ds);
      if (!table.colKeys.length) {
        notifyHome(t("tasks.noDataSource"), "warn");
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
      notifyHome(t("tasks.downloaded", { title: dataSourceDownloadName(ds) + ".xlsx" }), "success");
    } catch (e) {
      notifyHome(String(e.message || e), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    }
  }

  function renderCards(normalized) {
    const cards = document.getElementById("da-task-cards");
    if (!cards) return;
    if (!normalized.length) {
      cards.innerHTML = `<div class="da-task-empty text-muted">فرآیندی نیست. با دکمه + یک فرآیند بسازید.</div>`;
      return;
    }
    cards.innerHTML = normalized.map((row) => {
      const { steps, groups, sources } = taskCounts(row);
      return `<article class="da-task-card">
        <div class="da-task-card-top">
          <h3 class="da-task-card-title">${escapeHtml(row.title)}</h3>
          <span class="da-task-id" title="${escapeHtml(t("tasks.processId"))}">${escapeHtml(String(row.id))}</span>
        </div>
        <ul class="da-task-card-meta">
          <li><i class="ti ti-calendar"></i><span>${escapeHtml(formatCreatedAt(row.createdAt))}</span></li>
          <li><i class="ti ti-user"></i><span>${escapeHtml(row.createdBy)}</span></li>
          <li><i class="ti ti-edit"></i><span>${formatEditMeta(editMetaIso(row, "process"), editMetaUser(row, "process"))}</span></li>
          <li><i class="ti ti-database"></i><span>${formatEditMeta(editMetaIso(row, "data"), editMetaUser(row, "data"))}</span></li>
          <li><i class="ti ti-users"></i><span>${escapeHtml(sharedUsersLabel(row.sharedUsers, row.sharedWithCount))}</span></li>
        </ul>
        <div class="da-task-stats">
          <div class="da-task-stat"><b>${groups}</b><span>${t("dashboard.groups")}</span></div>
          <div class="da-task-stat"><b>${steps}</b><span>${t("dashboard.steps")}</span></div>
          <div class="da-task-stat"><b>${sources}</b><span>${t("dashboard.sources")}</span></div>
        </div>
        <div class="da-task-actions">${actionButtonsHtml(row)}</div>
      </article>`;
    }).join("");
    bindTaskActions(cards);
  }

  let rendering = false;
  let pendingRenderTasks = undefined;
  function render(tasks) {
    if (rendering) {
      pendingRenderTasks = tasks;
      return;
    }
    rendering = true;
    try {
      const body = document.getElementById("da-task-rows");
      const status = document.getElementById("da-portal-status");
      // Quiet status line only (no toast spam on every re-render).
      if (status) status.textContent = t("tasks.localUser", { user: currentUser() });

      const raw = tasks || readTasks();
      const normalized = Array.isArray(raw) ? raw.map(normalizeTask) : [];
      // Persist list metadata only — canvas for server tasks lives on the server (+ explicit mirror cache).
      const existing = readTasks();
      const byId = new Map(existing.map((t) => [String(t.id), t]));
      const toStore = normalized.map((n) => {
        const out = { ...n };
        if (isServerBackedTaskId(out.id)) delete out.graph;
        return out;
      });
      const changed = toStore.length !== existing.length
        || toStore.some((n) => {
          const o = byId.get(String(n.id));
          if (!o) return true;
          return String(o.title || "") !== String(n.title || "")
            || String(o.ownerUser || "") !== String(n.ownerUser || "")
            || Number(o.stepCount || 0) !== Number(n.stepCount || 0)
            || Number(o.groupCount || 0) !== Number(n.groupCount || 0)
            || Number(o.dataSourceCount || 0) !== Number(n.dataSourceCount || 0)
            || Number(o.sharedWithCount || 0) !== Number(n.sharedWithCount || 0)
            || String(o.updatedAtUtc || "") !== String(n.updatedAtUtc || "")
            || String(o.lastEditorUserName || "") !== String(n.lastEditorUserName || "")
            || String(o.dataUpdatedAtUtc || "") !== String(n.dataUpdatedAtUtc || "")
            || String(o.dataLastEditorUserName || "") !== String(n.dataLastEditorUserName || "")
            // The run fields must be compared here too. Without them a process whose only change
            // is a new run looked unchanged, so the cached copy was kept and the Last run column
            // went on showing "never run" for a process that had just been run.
            || String(o.lastPlayedAtUtc || "") !== String(n.lastPlayedAtUtc || "")
            || String(o.lastPlayedByUserName || "") !== String(n.lastPlayedByUserName || "")
            || Number(o.playCount || 0) !== Number(n.playCount || 0)
            // Template columns too: attaching, detaching or a template publish all change what the
            // row should show, and without these the cached copy kept the stale template chip.
            || String(o.templateId || "") !== String(n.templateId || "")
            || String(o.templateTitle || "") !== String(n.templateTitle || "")
            || Boolean(o.templateBehind) !== Boolean(n.templateBehind);
        });
      // Silent write: avoid writeTasks → da-local-tasks → render → writeTasks loop.
      if (changed) writeTasks(toStore, { silent: true });

      if (body) {
        try {
          if (!toStore.length) {
            body.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-6">${t("tasks.empty")}</td></tr>`;
          } else {
            body.innerHTML = toStore.map((row) => {
              const { steps, groups, sources } = taskCounts(row);
              const tid = escapeHtml(String(row.id));
              const tplCell = row.templateId
                ? `<span class="da-tpl-wrap">
                     <a href="#" class="da-tpl-chip${row.templateBehind ? " is-behind" : ""}"
                        data-tpl-id="${escapeHtml(String(row.templateId))}"
                        data-task-id="${tid}"
                        data-task-title="${escapeHtml(row.title || "")}"
                        title="${escapeHtml(row.templateBehind ? t("tasks.templateBehind") : t("tasks.templateCurrent"))}">
                       <i class="ti ti-copy" aria-hidden="true"></i>
                       <span>${escapeHtml(row.templateTitle || "")}</span>
                       ${row.templateBehind ? '<i class="ti ti-alert-triangle" aria-hidden="true"></i>' : ""}
                     </a>
                     <button type="button" class="da-tpl-chip-detach"
                             data-tpl-id="${escapeHtml(String(row.templateId))}"
                             data-task-id="${tid}"
                             data-task-title="${escapeHtml(row.title || "")}"
                             title="${escapeHtml(t("panel.templateDetach"))}"
                             aria-label="${escapeHtml(t("panel.templateDetach"))}">
                       <i class="ti ti-unlink" aria-hidden="true"></i>
                     </button>
                   </span>`
                : `<span class="text-muted">—</span>`;
              return `<tr data-task-id="${tid}">
        <td>
          <div class="fw-semibold" data-flash="title">${escapeHtml(row.title)}</div>
          <span class="da-task-id" title="${escapeHtml(t("tasks.serverKey"))}">${tid}</span>
        </td>
        <td class="text-nowrap" data-flash="template">${tplCell}</td>
        <td class="text-nowrap">${escapeHtml(formatCreatedAt(row.createdAt))}</td>
        <td>${escapeHtml(row.createdBy)}</td>
        <td class="text-nowrap" data-flash="processEdit">${formatEditMeta(editMetaIso(row, "process"), editMetaUser(row, "process"))}</td>
        <td class="text-nowrap" data-flash="dataEdit">${formatEditMeta(editMetaIso(row, "data"), editMetaUser(row, "data"))}</td>
        <td class="text-nowrap" data-flash="lastRun">${formatLastRun(row)}</td>
        <td data-flash="shared">${escapeHtml(sharedUsersLabel(row.sharedUsers, row.sharedWithCount))}</td>
        <td data-flash="groups">${groups}</td>
        <td data-flash="steps">${steps}</td>
        <td data-flash="sources">${sources}</td>
        <td class="text-nowrap">
          <div class="da-task-actions-desk da-task-actions">${actionButtonsHtml(row)}</div>
        </td>
      </tr>`;
            }).join("");
            bindTaskActions(body);
          }
        } catch (err) {
          console.error("[local-tasks] rows render failed", err);
          body.innerHTML = `<tr><td colspan="12" class="text-center text-danger py-6">${escapeHtml(String(err && err.message || err))}</td></tr>`;
        }
      }

      try {
        renderCards(toStore);
      } catch (err) {
        console.warn("[local-tasks] renderCards", err);
      }
    } finally {
      rendering = false;
      if (pendingRenderTasks !== undefined) {
        const next = pendingRenderTasks;
        pendingRenderTasks = undefined;
        render(next);
      }
    }
  }

  function emptyGraph(title) {
    return {
      taskId: 0,
      title: title || "فرآیند جدید",
      canModify: true,
      designOrigin: "Manual",
      viewport: { x: 40, y: 40, zoom: 1 },
      nodes: [
        { id: "start", kind: "start", title: "شروع", x: 40, y: 220, stepDelayMs: 0, ignorePlayError: true, highlightColor: "#ea5455", repeatSourceType: "None", loopCount: 1 },
        {
          id: "group-1",
          kind: "group",
          entityId: 1,
          title: "گروه خالی",
          x: 280,
          y: 80,
          repeatSourceType: "None",
          moveLoop: true
        }
      ],
      edges: [{ id: "e-start", from: "start", to: "group-1", kind: "next" }],
      dataSources: [],
      stepDelayMs: 0,
      ignorePlayError: true,
      highlightColor: "#ea5455"
    };
  }

  function isServerMode() {
    // All tiers persist on the server; localStorage is cache only.
    return true;
  }

  async function createLocalTask(titleRaw) {
    const title = (titleRaw || "").trim() || t("tasks.newProcess");

    if (isServerMode()) {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, designOrigin: "Manual" })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notifyHome(data.message || t("plan.limitTasks", { max: "?" }), "warning");
          return;
        }
        const empty = emptyGraph(title);
        empty.taskId = data.id;
        await fetch(`/api/tasks/${data.id}/canvas`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(empty)
        });
        notifyHome(t("tasks.added", { title }), "success");
        if (window.DaTelemetry) DaTelemetry.audit("TaskCreate", `Created task ${data.id}: ${title}`);
        location.href = `/Panel/Tasks/Editor/${data.id}`;
        return;
      } catch (e) {
        notifyHome(String(e.message || e), "error");
        if (window.DaTelemetry) DaTelemetry.error(String(e.message || e), { where: "createTask" });
        return;
      }
    }

    const tasks = readTasks();
    const entitlements = window.DaEntitlements ? DaEntitlements.get() : { maxTasks: 1 };
    if (entitlements.maxTasks != null && tasks.length >= entitlements.maxTasks) {
      const msg = window.DaI18n
        ? DaI18n.t("plan.limitTasks", { max: entitlements.maxTasks })
        : "Limit reached";
      notifyHome(msg, "warning");
      return;
    }
    const id = newProcessId();
    const owner = currentUser();
    const graph = emptyGraph(title);
    graph.taskId = id;
    tasks.push({
      id,
      ownerUser: owner,
      title,
      designOrigin: "Manual",
      groupCount: 1,
      stepCount: 0,
      dataSourceCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: owner,
      sharedUsers: [],
      graph
    });
    writeTasks(tasks);
    render(tasks);
    notifyHome(t("tasks.added", { title }), "success");
  }

  async function loadServerTasks() {
    const res = await fetch("/api/tasks", { credentials: "same-origin" });
    if (!res.ok) throw new Error("tasks " + res.status);
    const list = await res.json();
    return (list || []).map((row) => ({
      id: row.id,
      title: row.title,
      designOrigin: row.designOrigin || "Manual",
      groupCount: row.groupCount || 0,
      stepCount: row.stepCount || 0,
      dataSourceCount: row.dataSourceCount || 0,
      createdAt: row.createdAtUtc || row.createdAt,
      updatedAtUtc: row.updatedAtUtc || null,
      lastEditorUserName: row.lastEditorUserName || "",
      dataUpdatedAtUtc: row.dataUpdatedAtUtc || null,
      dataLastEditorUserName: row.dataLastEditorUserName || "",
      // Last-run fields, from the recorded play events. Mapped explicitly like everything else
      // here - this is a whitelist, so a field the server sends but this list omits simply never
      // reaches the row, which is what made the Last run column always read "never run".
      lastPlayedAtUtc: row.lastPlayedAtUtc || null,
      lastPlayedByUserName: row.lastPlayedByUserName || "",
      playCount: row.playCount || 0,
      createdBy: row.ownerUserName || "",
      sharedUsers: [],
      sharedWithCount: row.sharedWithCount || 0,
      isOwner: !!row.isOwner,
      canModify: row.canModify !== false,
      canEdit: row.canEdit !== false,
      canDelete: row.canDelete !== false,
      canExecute: row.canExecute !== false,
      canShare: !!row.canShare,
      canChangeDataSource: !!row.canChangeDataSource,
      graph: null
    }));
  }

  /** Merge API list into cache: drop removed server ids, refresh metadata; refetch canvas when counts changed. */
  async function syncServerListToLocalCache(serverRows) {
    const rows = serverRows || [];
    const serverIds = new Set(rows.map((r) => String(r.id)));
    let tasks = readTasks().filter((t) => !isServerBackedTaskId(t.id) || serverIds.has(String(t.id)));
    const prevById = new Map(tasks.map((t) => [String(t.id), t]));
    const mergedMeta = mergeServerTasksWithLocal(rows);

    for (const row of mergedMeta) {
      const id = String(row.id);
      const prev = prevById.get(id);
      const countsChanged = prev
        && (Number(prev.stepCount) !== Number(row.stepCount)
          || Number(prev.groupCount) !== Number(row.groupCount)
          || String(prev.title || "") !== String(row.title || ""));
      const next = { ...(prev || {}), ...row };
      if (isServerBackedTaskId(id)) delete next.graph;
      prevById.set(id, next);
      if (countsChanged) {
        try {
          await ensureTaskGraphCached(id);
        } catch { /* list still shows API counts */ }
      }
    }

    const out = [...prevById.values()];
    writeTasks(out, { silent: true });
    return out;
  }

  /** List API has no canvas body — metadata only; canvas lives on server and in extension cache after explicit sync. */
  function mergeServerTasksWithLocal(serverRows) {
    return (serverRows || []).map((row) => {
      const next = normalizeTask(row);
      delete next.graph;
      return next;
    });
  }

  /** Write server canvas into encrypted local cache (Player/Recorder read path). */
  async function mirrorServerCanvasToLocalCache(taskRow) {
    const id = String(taskRow?.id ?? "").trim();
    if (!isServerBackedTaskId(id) || !taskRow?.graph?.nodes) return null;
    const tasks = readTasks().map((t) => ({ ...t }));
    const counts = taskCounts({
      ...taskRow,
      stepCount: (taskRow.graph.nodes || []).filter((n) => n.kind === "action" || n.kind === "step").length,
      groupCount: (taskRow.graph.nodes || []).filter((n) => n.kind === "group").length
    });
    const item = {
      ...taskRow,
      id,
      stepCount: counts.steps,
      groupCount: counts.groups,
      dataSourceCount: counts.sources,
      graph: taskRow.graph
    };
    const idx = tasks.findIndex((t) => String(t.id) === id);
    if (idx >= 0) tasks[idx] = { ...tasks[idx], ...item };
    else tasks.push(item);
    if (window.DaSecureStore && typeof DaSecureStore.writeTasksAsync === "function") {
      suppressLocalTasksRender = true;
      try {
        await DaSecureStore.writeTasksAsync(tasks);
      } finally {
        suppressLocalTasksRender = false;
      }
    } else {
      writeTasks(tasks, { silent: true });
    }
    try {
      window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
    } catch { /* ignore */ }
    return item;
  }

  /** Ensure the process canvas is in the local cache (player reads localStorage / extension sync). */
  async function ensureTaskGraphCached(taskId) {
    const id = String(taskId || "").trim();
    if (!id) return null;
    const tasks = readTasks();
    let hit = findTask(tasks, id);

    const applyCanvasToHit = (graph) => {
      graph.taskId = graph.taskId ?? (Number(id) || id);
      if (!hit) {
        hit = normalizeTask({
          id,
          title: graph.title || `#${id}`,
          designOrigin: graph.designOrigin || "Manual",
          createdAt: graph.updatedAtUtc || null,
          createdBy: currentUser(),
          graph
        });
        tasks.push(hit);
      } else {
        hit.graph = graph;
        if (graph.title) hit.title = graph.title;
        const counts = taskCounts(hit);
        hit.groupCount = counts.groups;
        hit.stepCount = counts.steps;
        hit.dataSourceCount = counts.sources;
      }
    };

    const persistTasks = async () => {
      if (window.DaSecureStore && typeof DaSecureStore.writeTasksAsync === "function") {
        suppressLocalTasksRender = true;
        try {
          await DaSecureStore.writeTasksAsync(tasks);
        } finally {
          suppressLocalTasksRender = false;
        }
      } else {
        writeTasks(tasks, { silent: true });
      }
    };

    // Server-backed processes: canvas API is authoritative (list cache may lag after editor save).
    if (/^\d+$/.test(id)) {
      const res = await fetch(`/api/tasks/${id}/canvas`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `canvas ${res.status}`);
      }
      const canvas = await res.json();
      const graph = canvas && typeof canvas === "object" ? canvas : null;
      if (!graph || !Array.isArray(graph.nodes)) {
        throw new Error(t("tasks.noGraph") || "گراف فرآیند پیدا نشد.");
      }
      applyCanvasToHit(graph);
      await mirrorServerCanvasToLocalCache(hit);
      return hit;
    }

    if (hit?.graph && Array.isArray(hit.graph.nodes) && hit.graph.nodes.length) {
      await persistTasks();
      return hit;
    }
    return hit || null;
  }

  const createModalEl = document.getElementById("da-create-task-modal");
  const titleInp = document.getElementById("da-new-title");

  createModalEl?.addEventListener("shown.bs.modal", () => {
    titleInp?.focus();
    titleInp?.select();
  });

  titleInp?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    document.getElementById("da-create-local")?.click();
  });

  document.getElementById("da-create-local")?.addEventListener("click", async () => {
    const title = (titleInp?.value || "").trim();
    if (!title) {
      titleInp?.focus();
      return;
    }
    await createLocalTask(title);
    if (titleInp) titleInp.value = "";
    window.bootstrap?.Modal?.getInstance(createModalEl)?.hide();
  });

  window.addEventListener("da-local-tasks", (ev) => {
    if (suppressLocalTasksRender) return;
    const detail = ev.detail;
    if (detail && detail.tasks && detail.user && detail.user !== currentUser()) return;
    if (isServerMode()) {
      scheduleRender();
      return;
    }
    render((detail && detail.tasks) || readTasks());
  });

  let busyTimer = null;
  let busyErrorTimer = null;

  function setTasksBusy(on, text, opts) {
    const panel = document.getElementById("da-tasks-panel");
    const busy = document.getElementById("da-tasks-busy");
    const textEl = busy?.querySelector(".da-tasks-busy-text");
    const kind = opts?.kind || "busy";
    if (textEl && text) textEl.textContent = text;
    if (busy) {
      busy.hidden = !on;
      busy.classList.toggle("is-error", on && kind === "error");
      busy.classList.toggle("is-ok", on && kind === "success");
    }
    if (panel) panel.classList.toggle("is-busy", !!on);
    if (busyTimer) {
      clearTimeout(busyTimer);
      busyTimer = null;
    }
    if (busyErrorTimer) {
      clearTimeout(busyErrorTimer);
      busyErrorTimer = null;
    }
    // Safety: never leave the table locked forever (e.g. extension reload races).
    if (on && kind === "busy") {
      busyTimer = setTimeout(() => setTasksBusy(false), 20000);
    }
  }

  window.daSetTasksBusy = setTasksBusy;

  // Play opens a target-tab menu (not immediate start).
  document.addEventListener("click", (ev) => {
    const recBtn = ev.target instanceof Element
      ? ev.target.closest('[data-da-action="start-record-menu"]')
      : null;
    if (recBtn) {
      if (!document.getElementById("da-tasks-panel")) return;
      if (recBtn.hasAttribute("disabled") || recBtn.getAttribute("aria-disabled") === "true") {
        ev.preventDefault();
        ev.stopPropagation();
        if (window.DaEntitlements) DaEntitlements.showUpgrade("record");
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if (document.documentElement.dataset.daRecorderExtension !== "1"
        && document.documentElement.dataset.daExtension !== "1") {
        return;
      }
      openRecordTargetMenu(recBtn);
      return;
    }

    const btn = ev.target instanceof Element
      ? ev.target.closest('[data-da-action="play-task-menu"]')
      : null;
    if (!btn) return;
    if (!document.getElementById("da-tasks-panel")) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (document.documentElement.dataset.daPlayerExtension !== "1"
      && document.documentElement.dataset.daExtension !== "1"
      && document.documentElement.dataset.daRecorderExtension !== "1") {
      return; // gate modal will open instead
    }
    openPlayTargetMenu(btn);
  }, true);

  let playMenuEl = null;
  let playMenuCloser = null;
  let recordMenuEl = null;
  let recordMenuCloser = null;

  function closeRecordTargetMenu() {
    if (recordMenuEl) {
      recordMenuEl.remove();
      recordMenuEl = null;
    }
    if (recordMenuCloser) {
      document.removeEventListener("click", recordMenuCloser, true);
      recordMenuCloser = null;
    }
  }

  async function openRecordTargetMenu(anchor) {
    closeRecordTargetMenu();
    closePlayTargetMenu();
    const taskId = anchor.getAttribute("data-task-id");
    const taskTitle = anchor.getAttribute("data-task-title") || "";
    if (!taskId) return;

    const menu = document.createElement("div");
    menu.className = "da-play-target-menu da-record-target-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="da-play-target-loading">در حال بارگذاری…</div>`;
    document.body.appendChild(menu);
    recordMenuEl = menu;

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const mw = Math.max(220, menu.offsetWidth || 260);
      let left = r.left + window.scrollX;
      let top = r.bottom + window.scrollY + 6;
      if (left + mw > window.scrollX + window.innerWidth - 8) {
        left = window.scrollX + window.innerWidth - mw - 8;
      }
      if (top + menu.offsetHeight > window.scrollY + window.innerHeight - 8) {
        top = r.top + window.scrollY - menu.offsetHeight - 6;
      }
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    };
    place();

    recordMenuCloser = (ev) => {
      if (!(ev.target instanceof Element)) return;
      if (menu.contains(ev.target) || anchor.contains(ev.target)) return;
      closeRecordTargetMenu();
    };
    setTimeout(() => document.addEventListener("click", recordMenuCloser, true), 0);

    const startRecord = async (scope) => {
      closeRecordTargetMenu();
      setTasksBusy(true, "آماده‌سازی ضبط…");
      let cached = null;
      try {
        cached = await ensureTaskGraphCached(taskId);
        if (!cached?.graph?.nodes?.length) {
          throw new Error("فرآیند برای ضبط پیدا نشد. صفحه را رفرش کنید.");
        }
      } catch (e) {
        setTasksBusy(false);
        notifyHome(String(e.message || e), "error");
        return;
      }
      window.dispatchEvent(new CustomEvent("da-start-record", {
        detail: {
          taskId,
          taskTitle: taskTitle || cached.title || "",
          task: cached,
          graph: cached.graph,
          tabId: scope?.tabId ?? null,
          openNewTab: scope?.openNewTab === true
        }
      }));
    };

    menu.innerHTML = `
      <button type="button" class="da-play-target-item" data-open-new="1" role="menuitem">
        <span class="da-play-target-title">تب جدید خالی</span>
        <span class="da-play-target-sub">صفحهٔ ضبط (ایجاد خودکار)</span>
      </button>
      <div class="da-play-target-sep"></div>
      <div class="da-play-target-loading">بارگذاری تب‌های باز…</div>
    `;
    place();
    menu.querySelector('[data-open-new="1"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startRecord({ openNewTab: true });
    });

    const tabs = await requestOpenTabs();
    if (!recordMenuEl) return;
    const listHost = menu.querySelector(".da-play-target-loading");
    if (!listHost) return;
    if (!tabs.length) {
      listHost.className = "da-play-target-empty";
      listHost.textContent = "تب دیگری باز نیست — «تب جدید خالی» را بزنید";
      place();
      return;
    }
    const frag = document.createDocumentFragment();
    const label = document.createElement("div");
    label.className = "da-play-target-label";
    label.textContent = "تب‌های باز";
    frag.appendChild(label);
    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "da-play-target-item";
      btn.setAttribute("role", "menuitem");
      btn.setAttribute("data-tab-id", String(tab.id));
      btn.title = tab.url || "";
      btn.innerHTML = `<span class="da-play-target-title"></span><span class="da-play-target-sub"></span>`;
      btn.querySelector(".da-play-target-title").textContent = tab.label || tab.title || `#${tab.id}`;
      btn.querySelector(".da-play-target-sub").textContent = (tab.url || "").replace(/^https?:\/\//i, "").slice(0, 56);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tabId = Number(btn.getAttribute("data-tab-id"));
        if (!Number.isFinite(tabId)) return;
        startRecord({ tabId, openNewTab: false });
      });
      frag.appendChild(btn);
    });
    listHost.replaceWith(frag);
    place();
  }

  function closePlayTargetMenu() {
    if (playMenuEl) {
      playMenuEl.remove();
      playMenuEl = null;
    }
    if (playMenuCloser) {
      document.removeEventListener("click", playMenuCloser, true);
      playMenuCloser = null;
    }
  }

  function requestOpenTabs() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("da-open-tabs", onTabs);
        resolve([]);
      }, 2500);
      function onTabs(ev) {
        clearTimeout(timeout);
        window.removeEventListener("da-open-tabs", onTabs);
        const tabs = Array.isArray(ev.detail?.tabs) ? ev.detail.tabs : [];
        resolve(tabs);
      }
      window.addEventListener("da-open-tabs", onTabs);
      window.dispatchEvent(new CustomEvent("da-list-open-tabs"));
      try {
        window.postMessage({ source: "da-editor", type: "list-open-tabs" }, "*");
      } catch { /* ignore */ }
    });
  }

  async function openPlayTargetMenu(anchor) {
    closePlayTargetMenu();
    const taskId = anchor.getAttribute("data-task-id");
    if (!taskId) return;

    const menu = document.createElement("div");
    menu.className = "da-play-target-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="da-play-target-loading">در حال بارگذاری تب‌ها…</div>`;
    document.body.appendChild(menu);
    playMenuEl = menu;

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const mw = Math.max(220, menu.offsetWidth || 260);
      let left = r.left + window.scrollX;
      let top = r.bottom + window.scrollY + 6;
      if (left + mw > window.scrollX + window.innerWidth - 8) {
        left = window.scrollX + window.innerWidth - mw - 8;
      }
      if (top + menu.offsetHeight > window.scrollY + window.innerHeight - 8) {
        top = r.top + window.scrollY - menu.offsetHeight - 6;
      }
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    };
    place();

    playMenuCloser = (ev) => {
      if (!(ev.target instanceof Element)) return;
      if (menu.contains(ev.target) || anchor.contains(ev.target)) return;
      closePlayTargetMenu();
    };
    setTimeout(() => document.addEventListener("click", playMenuCloser, true), 0);

    const startPlay = async (scope) => {
      closePlayTargetMenu();
      setTasksBusy(true, "آماده‌سازی افزونهٔ اجرا…");
      let cached = null;
      try {
        cached = await ensureTaskGraphCached(taskId);
        if (!cached?.graph?.nodes?.length) {
          throw new Error("فرآیند در حافظهٔ محلی پیدا نشد. صفحه را رفرش کنید.");
        }
        const actionSteps = cached.graph.nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
        if (!actionSteps) {
          throw new Error("مرحله‌ای برای اجرا نیست — در دیاگرام اقدام اضافه کنید.");
        }
      } catch (e) {
        setTasksBusy(false);
        notifyHome(String(e.message || e), "error");
        return;
      }
      window.dispatchEvent(new CustomEvent("da-play", {
        detail: {
          taskId,
          task: cached,
          graph: cached.graph,
          ...(scope || {})
        }
      }));
    };

    menu.innerHTML = `
      <button type="button" class="da-play-target-item" data-open-new="1" role="menuitem">
        <span class="da-play-target-title">تب جدید</span>
        <span class="da-play-target-sub">صفحه خالی در مرورگر</span>
      </button>
      <div class="da-play-target-sep"></div>
      <div class="da-play-target-loading">بارگذاری تب‌های باز…</div>
    `;
    place();
    menu.querySelector('[data-open-new="1"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startPlay({ openNewTab: true });
    });

    const tabs = await requestOpenTabs();
    if (!playMenuEl) return;
    const listHost = menu.querySelector(".da-play-target-loading");
    if (!listHost) return;
    if (!tabs.length) {
      listHost.className = "da-play-target-empty";
      listHost.textContent = "تب http(s) باز پیدا نشد — صفحه هدف را باز کنید";
      place();
      return;
    }
    const frag = document.createDocumentFragment();
    const label = document.createElement("div");
    label.className = "da-play-target-label";
    label.textContent = "تب‌های باز";
    frag.appendChild(label);
    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "da-play-target-item";
      btn.setAttribute("role", "menuitem");
      btn.setAttribute("data-tab-id", String(tab.id));
      btn.title = tab.url || "";
      btn.innerHTML = `<span class="da-play-target-title"></span><span class="da-play-target-sub"></span>`;
      btn.querySelector(".da-play-target-title").textContent = tab.label || tab.title || `#${tab.id}`;
      btn.querySelector(".da-play-target-sub").textContent = (tab.url || "").replace(/^https?:\/\//i, "").slice(0, 56);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tabId = Number(btn.getAttribute("data-tab-id"));
        if (!Number.isFinite(tabId)) return;
        startPlay({ tabId, openNewTab: false });
      });
      frag.appendChild(btn);
    });
    listHost.replaceWith(frag);
    place();
  }

  window.addEventListener("da-play-ui", (ev) => {
    const d = ev.detail || {};
    if (d.phase === "preparing") {
      setTasksBusy(true, d.text || "آماده‌سازی افزونهٔ اجرا…");
      return;
    }
    if (d.phase === "reloading") {
      setTasksBusy(true, d.text || "در حال Reload افزونهٔ اجرا…");
      return;
    }
    if (d.phase === "error") {
      const msg = d.text || "خطا در اجرا";
      setTasksBusy(true, msg, { kind: "error" });
      notifyHome(msg, "error");
      setTimeout(() => setTasksBusy(false), 3500);
      return;
    }
    if (d.phase === "started" || d.phase === "done") {
      setTasksBusy(false);
    }
  });

  window.addEventListener("da-record-ui", (ev) => {
    const d = ev.detail || {};
    if (d.phase === "preparing") {
      setTasksBusy(true, d.text || "آماده‌سازی ضبط…");
      return;
    }
    if (d.phase === "error") {
      const msg = d.text || "خطا در ضبط";
      setTasksBusy(true, msg, { kind: "error" });
      notifyHome(msg, "error");
      setTimeout(() => setTasksBusy(false), 3500);
      return;
    }
    if (d.phase === "started") {
      setTasksBusy(false);
      notifyHome(d.text || "ضبط شروع شد — کنترل‌ها روی تب هدف.", "success");
    }
  });

  function scheduleRender() {
    const run = async () => {
      if (isServerMode()) {
        try {
          const rows = await loadServerTasks();
          await syncServerListToLocalCache(rows);
          render(mergeServerTasksWithLocal(rows));
          return;
        } catch (e) {
          console.warn(e);
          notifyHome(String(e.message || e), "error");
          render(readTasks());
          return;
        }
      }
      if (window.DaSecureStore && typeof DaSecureStore.whenReady === "function") {
        DaSecureStore.whenReady(() => render(readTasks()));
      } else {
        render(readTasks());
      }
    };
    if (window.DaI18n && DaI18n.ready && typeof DaI18n.ready.then === "function") {
      DaI18n.ready.then(run).catch(run);
    } else {
      run();
    }
  }

  function flashTaskFields(taskId, fields) {
    const row = document.querySelector(`#da-task-rows tr[data-task-id="${CSS.escape(String(taskId))}"]`);
    if (!row) return;
    row.classList.add("da-row-flash");
    setTimeout(() => row.classList.remove("da-row-flash"), 1600);
    (fields || []).forEach((f) => {
      const el = row.querySelector(`[data-flash="${f}"]`);
      if (!el) return;
      el.classList.add("da-cell-blink");
      setTimeout(() => el.classList.remove("da-cell-blink"), 1800);
    });
  }

  function fadeOutTask(taskId) {
    const row = document.querySelector(`#da-task-rows tr[data-task-id="${CSS.escape(String(taskId))}"]`);
    if (!row) {
      scheduleRender();
      return;
    }
    row.classList.add("da-row-fade-out");
    setTimeout(() => scheduleRender(), 450);
  }

  if (window.DaCatalog) {
    DaCatalog.ensure();
    DaCatalog.on("taskChanged", (payload) => {
      if (!payload) return;
      const action = payload.action || "";
      const task = payload.task || {};
      const id = task.id ?? task.Id;
      const who = payload.actorUserName ? ` (${payload.actorUserName})` : "";
      if (action === "deleted") {
        if (window.daNotify) daNotify((t("live.taskDeleted") || "فرآیند حذف شد") + who, "info");
        fadeOutTask(id);
        return;
      }
      if (action === "created") {
        if (window.daNotify) daNotify((t("live.taskCreated") || "فرآیند جدید") + who, "success");
        scheduleRender();
        setTimeout(() => flashTaskFields(id, ["title", "steps"]), 300);
        return;
      }
      // updated / shared
      const prev = findTask(readTasks(), id);
      scheduleRender();
      setTimeout(() => {
        const fields = [];
        const titleNext = task.title || task.Title;
        const stepNext = task.stepCount ?? task.StepCount;
        const groupNext = task.groupCount ?? task.GroupCount;
        const srcNext = task.dataSourceCount ?? task.DataSourceCount;
        const procEditNext = task.updatedAtUtc ?? task.UpdatedAtUtc;
        const procUserNext = task.lastEditorUserName ?? task.LastEditorUserName;
        const dataEditNext = task.dataUpdatedAtUtc ?? task.DataUpdatedAtUtc;
        const dataUserNext = task.dataLastEditorUserName ?? task.DataLastEditorUserName;
        if (!prev || prev.title !== titleNext) fields.push("title");
        if (!prev || Number(prev.stepCount) !== Number(stepNext)) fields.push("steps");
        if (!prev || Number(prev.groupCount) !== Number(groupNext)) fields.push("groups");
        if (!prev || Number(prev.dataSourceCount ?? prev.sources) !== Number(srcNext)) {
          fields.push("sources");
        }
        if (!prev || String(prev.updatedAtUtc || "") !== String(procEditNext || "")
          || String(prev.lastEditorUserName || "") !== String(procUserNext || "")) {
          fields.push("processEdit");
        }
        if (!prev || String(prev.dataUpdatedAtUtc || "") !== String(dataEditNext || "")
          || String(prev.dataLastEditorUserName || "") !== String(dataUserNext || "")) {
          fields.push("dataEdit");
        }
        if (action === "shared" || Number(prev?.sharedWithCount) !== Number(task.sharedWithCount ?? task.SharedWithCount)) {
          fields.push("shared");
        }
        if (!fields.length) fields.push("processEdit");
        flashTaskFields(id, fields);
        if (window.daNotify && payload.actorUserName) {
          const key = action === "shared" ? "live.taskShared" : "live.taskUpdated";
          daNotify((t(key) || (action === "shared" ? "اشتراک فرآیند تغییر کرد" : "فرآیند به‌روز شد")) + who, "info");
        }
      }, 320);
    });
    DaCatalog.on("sourceChanged", (payload) => {
      if (!payload || payload.taskId == null) return;
      const tid = payload.taskId;
      scheduleRender();
      setTimeout(() => flashTaskFields(tid, ["dataEdit", "sources"]), 320);
    });
  }

  // --- Process data viewer: modal controls + grid interactions -------------------------------
  // The processes page has its own lighter viewer (this file), separate from the sources page.
  (function wireProcessViewer() {
    const table = document.getElementById("da-portal-ds-table");
    if (!table) return;

    document.querySelectorAll("[data-portal-ds-close]").forEach((el) => {
      el.addEventListener("click", () => {
        const modal = document.getElementById("da-portal-ds-viewer");
        if (modal) modal.hidden = true;
        processViewerState.source = null;
        processViewerState.cellRevisions = null;
      });
    });
    document.getElementById("da-portal-ds-refresh")?.addEventListener("click", () => {
      if (processViewerState.source) refreshProcessViewer();
    });

    table.addEventListener("dblclick", (e) => {
      const td = e.target.closest("td[data-row][data-col]");
      if (!td) return;
      e.preventDefault();
      beginProcessCellEdit(td);
    });
    table.addEventListener("contextmenu", (e) => {
      const modal = document.getElementById("da-portal-ds-viewer");
      if (!modal || modal.hidden) return;
      e.preventDefault();
      showProcessGridMenu(e.clientX, e.clientY, e.target.closest("td[data-row][data-col]"));
    });

    document.addEventListener("keydown", (e) => {
      const modal = document.getElementById("da-portal-ds-viewer");
      if (!modal || modal.hidden) return;
      // Escape belongs to the cell editor while a cell is open.
      if (e.key === "Escape" && !processViewerState.editing) modal.hidden = true;
    });
  })();

  scheduleRender();
  document.addEventListener("da:locale", () => scheduleRender());
  window.addEventListener("da-task-list-sync", () => scheduleRender());
  if (window.DaEntitlements?.fetch) {
    DaEntitlements.fetch().then(() => scheduleRender()).catch(() => {});
  }
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
})();
