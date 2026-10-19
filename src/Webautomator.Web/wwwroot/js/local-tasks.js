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

  /**
   * Pull the extension's own task records into this page before acting on local state.
   *
   * The extension is where a run WRITES (chrome.storage), and the page only ever holds a copy that
   * arrives when the extension pushes or when this page is opened. Pressing Sync on a stale copy sent
   * an empty or old payload, cleared the badge and left the server untouched — the "I synced and
   * nothing changed" report. The bridge answers `da-request-local-tasks` by writing the fresh list
   * into this page, so one round trip is enough.
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

  /**
   * The pending writes, asked for from the extension itself.
   *
   * `readTasks()` is this page's mirror: it is only as fresh as the last publish, and a publish is
   * exactly what a sync is trying to catch up with. The bridge answers from the store the RUN writes
   * and also says WHY there is nothing to send (no extension / no record / no writes), which is the
   * difference between "sync is broken" and "this browser never ran it".
   */
  function requestSyncPayload(filter, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const requestId = `sp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let settled = false;
      const onAnswer = (ev) => {
        const d = ev?.detail;
        if (!d || d.requestId !== requestId) return;
        settled = true;
        window.removeEventListener("da-sync-payload", onAnswer);
        resolve(d);
      };
      window.addEventListener("da-sync-payload", onAnswer);
      try {
        window.dispatchEvent(new CustomEvent("da-request-sync-payload", {
          detail: { requestId, taskId: filter?.taskId ?? null, sourceId: filter?.sourceId ?? null }
        }));
      } catch { /* no extension */ }
      setTimeout(() => {
        if (settled) return;
        window.removeEventListener("da-sync-payload", onAnswer);
        resolve(null);
      }, timeoutMs);
    });
  }

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
      createdAt: t.createdAt || null,
      // Where the run is managed. ON (the default) means the server tracks the play session, so the
      // run is visible to the admin and blocked from concurrent edits. OFF means the extension runs
      // it entirely on this machine: no server registration, and non-shared sources are read and
      // written locally. Absent means ON — an old record predates the switch and behaved that way.
      runOnServer: t.runOnServer !== false,
      // Set when a local run has produced results that are not on the server yet; the row then shows
      // the Sync button. Cleared by a successful sync.
      localRunPendingSync: t.localRunPendingSync === true
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
  // Retired: the eye only said "look" — nothing about WHICH copy of the data opens — so every data
  // view (process row and modal) uses ICO_DATA. Excel export moved into the viewer modal, so the
  // spreadsheet-file glyph is gone from the row as well.
  const ICO_DATA = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v3H3V5a1 1 0 0 1 1-1zm-1 6h18v3H3v-3zm0 5h18v3H3v-3zm0 5h18v.5a.5.5 0 0 1-.5.5h-17a.5.5 0 0 1-.5-.5V20z"/></svg>`;
  /** Circular arrows — "push the local result up to the server". */
  const ICO_SYNC = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4a8 8 0 0 1 7.4 5H17a6 6 0 0 0-10.6-1.3L8.5 9.8H3V4.3l2.2 2.2A8 8 0 0 1 12 4zm0 16a8 8 0 0 1-7.4-5H7a6 6 0 0 0 10.6 1.3l-2.1-2.1H21v5.5l-2.2-2.2A8 8 0 0 1 12 20z"/></svg>`;
  const ICO_INFO = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM13.4 17h-2.8v-1.3l.7-.3V10.8l-.7-.3V9.2h2.1v6.2l.7.3V17z"/></svg>`;
  // The template a row came from / was made into. A sheet with a stack behind it, so it reads as
  // "this process is derived from something" rather than as another document action.
  const ICO_TPL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 3h9a1 1 0 0 1 1 1v1H6a2 2 0 0 0-2 2v11H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm4 4h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1.6 3.2v1.6h1.5l-1.8 5.4h1.6l.6-2h1.9l.6 2h1.6l-1.8-5.4h1.5V10.2h-5.7z"/></svg>`;
  /**
   * A flow chart, for the edit action on a process whose structure belongs to a template.
   *
   * A child of a template inherits its graph from the mother, so its editor opens read-only. It used
   * to keep the ordinary pencil, which promised an edit the page then refused — the user only found
   * out after opening it.
   *
   * A flow chart says the right thing: what you would be opening is a *diagram*, and that diagram is
   * the mother's. It also stays true to what the row actually is — you can still open it and read the
   * flow, you just cannot rewire it here. A padlock (the first attempt) overstated it as "no access",
   * and the eye glyph was never an option because it already means "view the data source" and one
   * icon with two meanings is worse than the misleading pencil it replaced.
   */
  const ICO_DIAGRAM = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 3h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v2h4V5H4zm11 0h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v2h4V7h-4zM8 15h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm1 2v2h6v-2H9zM11 9h2v2h-2V9zm-6.5 1.25h2v1.5h-2v-1.5zM4 11.25h1.5v4.25H4v-4.25zm7 0h1.5v4.25H11v-4.25z"/></svg>`;

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

  /**
   * Build the `.watm` payload for a process.
   *
   * A file is intentionally self-contained: it carries the process's structure and nothing about
   * where that structure came from. The template link is deliberately NOT exported, because a file
   * can be handed to someone else, opened on another deployment, or restored long after the
   * template was retired — and in all three cases a dangling `templateId` would either be
   * meaningless or silently re-attach the process to a template it does not belong to. Re-importing
   * therefore yields a standalone process, which is exactly what a portable file should mean.
   *
   * The consequence is worth stating for the UI: importing over a CHILD detaches it from its
   * mother, because the imported graph is now the process's own structure rather than a projection
   * of the template. That has to be confirmed with the user, not done silently.
   */
  function exportTaskPayload(task) {
    return {
      format: "webautomator-task",
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

  /**
   * Return a task object that actually carries a graph, resolving it from the server when needed.
   *
   * The process list is a SUMMARY: a server-backed row has counts and no `graph`, so exporting it
   * straight away wrote `"graph": null` — a file that was valid and encrypted but had no structure,
   * and every import then failed with "no graph". The canvas API is the authoritative source, so a
   * missing/empty graph is filled from it here before the file is built. Local-only rows already
   * carry their graph and are returned untouched.
   */
  async function resolveTaskGraphForExport(task) {
    if (!task) return task;
    const hasGraph = task.graph && Array.isArray(task.graph.nodes) && task.graph.nodes.length;
    if (hasGraph) return task;
    const id = String(task.id ?? "").trim();
    // Only server-backed ids have a canvas to fetch; a local row without a graph cannot be exported.
    if (!/^\d+$/.test(id)) return task;
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/canvas`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `canvas ${res.status}`);
      }
      const canvas = await res.json();
      if (!canvas || !Array.isArray(canvas.nodes)) throw new Error(t("tasks.noGraph") || "گراف فرآیند پیدا نشد.");
      return { ...task, graph: canvas };
    } catch (e) {
      notifyHome(e.message || t("tasks.noGraph") || "گراف فرآیند پیدا نشد.", "error");
      return null;
    }
  }

  async function downloadTask(task) {
    if (!task) return;
    const full = await resolveTaskGraphForExport(task);
    if (!full) return;
    const payload = exportTaskPayload(full);
    let body;
    let fileName;
    try {
      if (window.DaSecureStore) {
        const pack = DaSecureStore.packWatm || DaSecureStore.packMrbt;
        body = await pack(payload);
        fileName = `${safeFileName(full.title)}.watm`;
      } else {
        body = JSON.stringify(payload, null, 2);
        fileName = `${safeFileName(full.title)}.json`;
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
    notifyHome(t("tasks.downloaded", { title: full.title }), "success");
  }

  async function parseImportedTask(raw) {
    let data = raw;
    if (typeof raw === "string") {
      if (window.DaSecureStore) {
        const unpack = DaSecureStore.unpackWatm || DaSecureStore.unpackMrbt;
        data = await unpack(raw);
      } else {
        data = JSON.parse(raw);
      }
    }
    if (!data || typeof data !== "object") throw new Error(t("tasks.badFile") || "invalid");
    let task = null;
    if (data.format === "dynamic-automator-task" && data.task) task = data.task;
    else if (data.format === "webautomator-task" && data.task) task = data.task;
    else if (data.graph || data.title) task = data;
    else if (data.nodes && Array.isArray(data.nodes)) {
      task = { title: data.title || t("tasks.newProcess"), graph: data };
    }
    if (!task?.graph || !Array.isArray(task.graph.nodes)) {
      throw new Error(t("tasks.noGraph") || "no graph");
    }
    return task;
  }

  /**
   * Push an imported graph into the process on the SERVER.
   *
   * A server-backed process keeps its structure in the database; the browser only holds a cache of
   * it. Importing therefore used to write the graph to the local cache alone, and the very next
   * list refresh — or opening the editor, which always reads the server — replaced it with the old
   * structure. The import looked successful and changed nothing.
   *
   * The same endpoint and the same contract as the editor's save are used, including the base
   * revision for conflict detection, so an import can never silently overwrite an edit made
   * elsewhere. `forceSave` is deliberately NOT sent: importing over a run that is in progress has
   * to stop the run first, and that is the operator's decision, not a side effect of a file drop.
   */
  async function pushImportedCanvasToServer(row, graph) {
    const id = String(row.id).trim();
    const base = row?.canvasCache?.updatedAtUtc || row?.updatedAtUtc || null;
    const body = { ...graph };
    if (base) body.baseUpdatedAtUtc = base;
    let res;
    try {
      res = await fetch(`/api/tasks/${encodeURIComponent(id)}/canvas`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error(t("tasks.importOffline") || "ارتباط با سرور برقرار نشد؛ فایل بارگذاری نشد.");
    }
    const resBody = await res.json().catch(() => ({}));
    if (res.status === 409) {
      if (resBody.code === "playing") {
        const who = resBody.playerUserName ? ` (${resBody.playerUserName})` : "";
        throw new Error((t("tasks.importPlaying")
          || "این فرآیند همین حالا در حال اجراست{who}؛ اول اجرا را متوقف کنید.").replace("{who}", who));
      }
      throw new Error(t("tasks.importConflict")
        || "فرآیند جای دیگری تغییر کرده است؛ صفحه را تازه کنید و دوباره بارگذاری کنید.");
    }
    if (!res.ok) {
      throw new Error(resBody.message || `${t("tasks.importFailed") || "بارگذاری ناموفق بود"} (HTTP ${res.status})`);
    }
    return resBody;
  }

  /**
   * Replace a process's content with an imported file.
   *
   * The import replaces the STRUCTURE wholesale, which means the process stops being a projection
   * of any template: its graph is now its own. So the template link is cleared here rather than
   * left hanging — keeping `templateId` would claim an attachment the very next cascade would
   * overwrite, undoing the import without telling anyone. Callers must warn the user first when the
   * target is a child; see `confirmImportDetaches`.
   *
   * ORDER MATTERS: for a server-backed process the server is written FIRST. Writing the local cache
   * first made a failed push leave a process that looked imported in this browser and was unchanged
   * everywhere else, which is the worst of both states. Nothing local is touched until the server
   * has accepted the file.
   */
  async function applyImportToTask(taskId, imported) {
    const tasks = readTasks();
    const idx = findTaskIndex(tasks, taskId);
    if (idx < 0) throw new Error("فرآیند پیدا نشد.");
    const current = tasks[idx];
    const graph = deepClone(imported.graph);
    graph.taskId = current.id;
    graph.title = (imported.title || current.title || "فرآیند").trim() || current.title;
    graph.canModify = true;
    // Server-side canvas JSON must not carry session/concurrency meta (same rule as the editor).
    delete graph.baseUpdatedAtUtc;
    delete graph.updatedAtUtc;
    delete graph.editorSessionId;

    let savedUpdatedAtUtc = null;
    if (isServerBackedTaskId(current.id)) {
      const saved = await pushImportedCanvasToServer(current, graph);
      savedUpdatedAtUtc = saved?.updatedAtUtc || null;
    }

    const counts = taskCounts({ graph });
    tasks[idx] = {
      ...current,
      title: graph.title,
      designOrigin: imported.designOrigin || graph.designOrigin || current.designOrigin || "Manual",
      groupCount: counts.groups,
      stepCount: counts.steps,
      dataSourceCount: counts.sources,
      sharedUsers: Array.isArray(imported.sharedUsers) ? imported.sharedUsers : (current.sharedUsers || []),
      graph,
      // The graph just written IS the server's current revision, so the run path can use it without
      // reading it back — and a later save from this browser conflicts correctly rather than
      // appearing to lose the import.
      canvasCache: { graph, updatedAtUtc: savedUpdatedAtUtc || null }
    };
    if (savedUpdatedAtUtc) tasks[idx].updatedAtUtc = savedUpdatedAtUtc;
    // Detach: the imported graph is this process's own structure now, so any template link would
    // be a claim the next cascade would silently overwrite.
    if (tasks[idx].templateId != null) {
      tasks[idx].templateId = null;
      tasks[idx].templateTitle = "";
      tasks[idx].templateBehind = false;
      tasks[idx].sourceProcessId = null;
      tasks[idx].sourceProcessTitle = "";
    }
    writeTasks(tasks);
    render(tasks);
    // Server mode: re-read the list so the row's counts/revisions are the server's, not our guess.
    if (isServerBackedTaskId(current.id)) scheduleRender();
    notifyHome(t("tasks.imported", { title: tasks[idx].title }) || `فرآیند «${tasks[idx].title}» از فایل به‌روز شد.`, "success");
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
    // An EXACT copy: where it runs (server or this machine) travels with it, because a copy is a
    // starting point that must behave like the original — inheriting the mother's mode for a child
    // and the user's own choice otherwise. Everything else that describes a RUN does not travel: a
    // new process that already reported someone else's results, or claimed unsynced local writes it
    // never made, would be a lie in the list, in the data viewer and on the next sync.
    copy.runOnServer = task.runOnServer !== false;
    copy.localRunPendingSync = false;
    copy.lastLocalRunAt = null;
    delete copy.locallyRunSources;
    delete copy.localSourceCopies;
    delete copy.localSourcesLoaded;
    delete copy.localSourceRevisions;
    delete copy.localValuesStamp;
    // The canvas cache is keyed to the ORIGINAL's server revision; a copy has its own id and its own
    // revision, so a stale cache here would make the first run believe it already had the server's
    // copy of a process that has never been read.
    copy.canvasCache = null;
    copy.lastPlayedAt = null;
    copy.lastPlayedAtUtc = null;
    copy.lastPlayedBy = "";
    copy.lastPlayedByUserName = "";
    copy.playCount = 0;
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
      // The run mode is CLIENT-LOCAL and per user, so the server's copy cannot carry it: seed the new
      // id with the SOURCE's choice, or the copy would silently default to "run on server" while the
      // process it was copied from runs on this machine.
      const newId = String(created?.id ?? "").trim();
      if (newId) {
        const local = readTasks();
        const at = findTaskIndex(local, newId);
        const seed = {
          runOnServer: task ? task.runOnServer !== false : true,
          localRunPendingSync: false,
          canvasCache: null
        };
        if (at >= 0) local[at] = { ...local[at], ...seed };
        else local.push({ id: newId, title: created?.title || "", ...seed });
        // Silent: the render below has to come from the SERVER's row shape, not from this stub.
        writeTasks(local, { silent: true });
      }
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

  /**
   * Is running on the server allowed at all? (Admin → Settings / Monitoring master switch.)
   *
   * Cached briefly: the process list renders on every poll, and the answer rarely changes. The cache
   * is short so flipping the switch takes effect on the next render rather than needing a reload.
   *
   * `serverRunAllowedSync()` is the synchronous read the row renderer uses — an `await` cannot happen
   * mid-render, and the default (`true`) must not disable the button before the first probe answers.
   */
  let serverRunFlag = { value: true, at: 0 };
  async function fetchServerRunEnabled({ force = false } = {}) {
    if (!force && Date.now() - serverRunFlag.at < 15000) return serverRunFlag.value;
    try {
      const res = await fetch("/api/play-mode", { credentials: "same-origin", cache: "no-store" });
      if (res.ok) {
        const body = await res.json();
        serverRunFlag = { value: body?.serverRunEnabled !== false, at: Date.now() };
      }
    } catch { /* keep the last known value; the default is enabled */ }
    return serverRunFlag.value;
  }
  function serverRunAllowedSync() {
    return serverRunFlag.value !== false;
  }

  /**
   * While server runs are switched off, every process runs locally.
   *
   * The flag is client-local (the server has no column for it), so a deployment-wide switch-off
   * has to be applied here: leaving a row on "server" would keep showing a choice the server will
   * refuse. Returns true when any row changed.
   */
  function forceLocalRunsWhenServerOff() {
    if (serverRunAllowedSync()) return false;
    const tasks = readTasks();
    let changed = false;
    const next = tasks.map((task) => {
      if (task.runOnServer === false) return task;
      changed = true;
      return { ...task, runOnServer: false };
    });
    if (changed) writeTasks(next, { silent: true });
    return changed;
  }

  /**
   * Whether the signed-in user may shape the shared templates (Admin or ProcessManager).
   *
   * The flag is rendered by the view from the same role check the sidebar and HomeController use,
   * so the button and the page it opens can never disagree. Read once — the role cannot change
   * inside a session (it is baked into the JWT), so there is nothing to re-evaluate.
   */
  const canManageTemplates = document.querySelector(".da-home")?.dataset?.canManageTemplates === "true";

  function actionButtonsHtml(task) {
    const tid = escapeHtml(String(task.id));
    const ttitle = escapeHtml(String(task.title || "").trim());
    const counts = taskCounts(task);
    const isEmpty = !counts.steps;
    const hasData = counts.sources > 0;
    /**
     * A process made from a template is a CHILD: its structure is a projection of the mother that
     * the cascade rewrites on every publish. Recording would append new groups to a graph the child
     * does not own, and the next cascade would silently discard them — so the record button is
     * shown disabled rather than hidden. Keeping it visible with a reason tells the user why the
     * action is missing instead of leaving them to wonder where it went.
     */
    const isChild = !!task.templateId && !task.isTemplateSource;
    const canRec = recordAllowed() && !isChild;
    const recTip = isChild
      ? (t("tasks.recordChildDisabled") || "این فرآیند از یک قالب ساخته شده است؛ ضبط روی آن ممکن نیست.")
      : recordAllowed()
        ? t("tasks.record")
        : (window.DaEntitlements?.upgradeMessage?.("record") || t("plan.upgradeRecord") || "ضبط نیاز به پلن Pro دارد.");
    const recExtra = canRec
      ? `data-da-action="start-record-menu" data-task-id="${tid}" data-task-title="${ttitle}" aria-haspopup="menu"`
      : `data-da-action="start-record-menu" data-task-id="${tid}" data-task-title="${ttitle}" disabled aria-disabled="true" title="${escapeHtml(recTip)}"`;
    // Smart record writes a whole graph from scratch, which is even further outside what a child owns.
    const smartBtn = isEmpty && !isChild
      ? iconBtn("is-smart", t("tasks.smart"), ICO_SMART, `data-da-action="start-smart-record" data-task-id="${tid}" data-task-title="${ttitle}"`)
      : "";
    /**
     * A process whose local results are still unsynced carries TWO copies, so it gets two data
     * buttons: the browser's copy (what the run produced) and the server's rows (what everyone else
     * sees). One icon could only ever show one of them, and which one it showed was a guess.
     */
    const isPending = task.localRunPendingSync === true
      || (Array.isArray(task.locallyRunSources) && task.locallyRunSources.length > 0);
    // Two buttons exist only while this browser HOLDS a copy of the process's data. After a sync the
    // copy is deleted (it now lives on the server), so the pair collapses to the one server button
    // by itself — and the next local run re-creates the copy and the pair.
    const hasLocalCopy = !!(task.localSourceCopies && Object.keys(task.localSourceCopies).length);
    // The open viewer's copy keeps its ring across list repaints, so it is part of the render.
    const viewing = processViewerState.taskId != null
      && String(processViewerState.taskId) === String(task.id);
    const activeLocal = viewing && processViewerState.localMode ? " is-active" : "";
    const activeServer = viewing && !processViewerState.localMode ? " is-active" : "";
    const dataBtns = hasData
      ? ((isPending || hasLocalCopy)
        ? iconBtn(`is-view is-data-local${activeLocal}`, t("sources.viewLocal") || "نمایش اطلاعات محلی", ICO_DATA,
            `data-da-view-data="${tid}" data-mode="local"`)
          + iconBtn(`is-view is-data-server${activeServer}`, t("sources.viewServer") || "نمایش اطلاعات سرور", ICO_DATA,
            `data-da-view-data="${tid}" data-mode="server"`)
        : iconBtn("is-view", t("tasks.viewData"), ICO_DATA, `data-da-view-data="${tid}"`))
      : "";
    /**
     * A live "open the source template" button for a CHILD, so the relationship is one click away
     * without hunting for the chip. The mother gets no button here: it has no template attached to
     * it (it is the source), and its own chip in the template column already says so.
     */
    const templateBtn = task.templateId
      ? iconBtn("is-template", `${t("panel.colTemplate")}: ${task.templateTitle || ""}`.trim(), ICO_TPL,
          `data-da-template-row="${tid}"`)
      : "";
    // A template child opens read-only, so its edit action is shown as a diagram glyph with the reason
    // in the tooltip, rather than as a pencil that leads to a page the user cannot change.
    const editBtn = isChild
      ? iconLink("is-edit is-template-child",
          t("tasks.editLocked", { name: task.templateTitle || t("panel.colTemplate") }) || t("tasks.edit"),
          `/Panel/Tasks/Editor/${encodeURIComponent(task.id)}`, ICO_DIAGRAM)
      : iconLink("is-edit", t("tasks.edit"), `/Panel/Tasks/Editor/${encodeURIComponent(task.id)}`, ICO_EDIT);

    /**
     * ONE run button, and a per-row switch that decides WHERE it runs.
     *
     * The switch is a standing property of the process (visible at a glance on every row), so it
     * does not belong in a per-click menu. The button then only asks WHICH TAB to drive — a new
     * blank tab, or one already open. This is the design the operator relies on; the two separate
     * «server / local» buttons this replaces were a detour.
     *
     * A server run needs the admin's master switch to be on. It is checked when the menu opens, so
     * the toggle can be flipped to local and the run started without a hidden dead end.
     */
    return `
      ${editBtn}
      ${iconBtn("is-info", t("tasks.details"), ICO_INFO, `data-da-details="${tid}"`)}
      ${templateBtn}
      ${iconBtn("is-play", t("tasks.play"), ICO_PLAY, `data-da-action="play-task-menu" data-task-id="${tid}" aria-haspopup="menu"`)}
      ${iconBtn("is-rec", recTip, ICO_REC, recExtra)}
      ${smartBtn}
      ${dataBtns}
      ${iconBtn("", t("tasks.clone"), ICO_CLONE, `data-da-clone="${tid}"`)}
      ${iconBtn("", t("tasks.downloadMrbt"), ICO_DL, `data-da-download="${tid}"`)}
      ${(canManageTemplates && !task.templateId)
        ? iconBtn("", t("tasks.makeTemplate"), ICO_COPY, `data-da-make-template="${tid}" data-task-title="${ttitle}"`)
        : ""}
      <label class="ds-icon-btn da-import-btn" title="${t("tasks.importMrbt")}" aria-label="${t("tasks.importMrbt")}">
        ${ICO_UP}
        <input type="file" accept=".watm,.mrbt,application/octet-stream,application/json,.json" data-da-import="${tid}" hidden />
      </label>
      ${task.canShare
        ? iconBtn("", t("tasks.share"), ICO_SHARE, `data-da-share="${tid}"`)
        : ""}
      ${task.canDelete !== false
        ? iconBtn("is-danger", t("tasks.delete"), ICO_DEL, `data-da-del="${tid}"`)
        : ""}
      ${(task.localRunPendingSync || (Array.isArray(task.locallyRunSources) && task.locallyRunSources.length > 0))
        ? iconBtn("is-sync", t("tasks.syncAllSources") || t("tasks.syncLocalRun"), ICO_SYNC, `data-da-sync="${tid}"`)
        : ""}
      ${runOnServerSwitch(task, tid)}`;
  }

  /**
   * The per-row "run on server" switch.
   *
   * ON (default): the server tracks the run — visible to the admin, and an edit while it plays is
   * refused. OFF: the run and its private sources stay on this machine, nothing is registered on
   * the server, and the Sync button appears afterwards for a deliberate push.
   */
  function runOnServerSwitch(task, tid) {
    const allowed = serverRunAllowedSync();
    const on = allowed && task.runOnServer !== false;
    // A template CHILD does not own its run mode: it follows the mother. Rendering it locked (with
    // the reason in the tooltip) is honest — a clickable switch that always snapped back would look
    // like a bug.
    const isChild = isTemplateChild(task);
    const editable = allowed && !isChild;
    const title = isChild
      ? (t("tasks.runOnServerChildLocked") || "حالت اجرای فرآیندهای ساخته‌شده از این قالب را فرآیند مادر تعیین می‌کند.")
      : !allowed
        ? t("tasks.serverRunRestricted")
        : (on ? t("tasks.runOnServerOn") : t("tasks.runOnServerOff"));
    return `<label class="da-runswitch${allowed ? "" : " is-locked"}${isChild ? " is-inherited" : ""}" title="${escapeHtml(title)}">
      <input type="checkbox" class="da-runswitch-input" data-da-runserver="${tid}" ${on ? "checked" : ""} ${editable ? "" : "disabled aria-disabled=\"true\""} />
      <span class="da-runswitch-ui" aria-hidden="true"></span>
      <span class="da-runswitch-text">${escapeHtml(t("tasks.runOnServer"))}</span>
    </label>`;
  }

  /**
   * Is this process a template CHILD — a projection of a mother process?
   *
   * A child owns only its runs, not its structure: the cascade rewrites its graph from the mother.
   * Its run mode is therefore inherited too, which is why the switch is locked for it.
   */
  function isTemplateChild(task) {
    if (!task || task.isTemplateSource) return false;
    const hasTemplate = task.templateId != null && task.templateId !== "";
    const hasMother = task.sourceProcessId != null && task.sourceProcessId !== "";
    return hasTemplate || hasMother;
  }

  /** All locally cached processes that belong to `mother`'s family. */
  function childTasksOf(tasks, mother) {
    const mid = String(mother?.id ?? "");
    const mtpl = mother?.templateId != null ? String(mother.templateId) : null;
    return tasks.filter((x) => {
      if (!mid || taskIdEq(x.id, mid) || !isTemplateChild(x)) return false;
      if (x.sourceProcessId != null && x.sourceProcessId !== "" && taskIdEq(x.sourceProcessId, mid)) return true;
      // Fall back to the template id, which is the link the server itself uses.
      return mtpl != null && x.templateId != null && String(x.templateId) === mtpl;
    });
  }

  /**
   * Flip where this process runs and persist it on the task record.
   *
   * Kept local-first: the flag lives with the process, so it survives a reload and travels with
   * the record. Turning it OFF is a real change of behaviour, so it is confirmed once — the user is
   * about to lose the server-side visibility and concurrency guard they may be relying on.
   */
  async function setRunOnServer(taskId, on) {
    const tasks = readTasks();
    const idx = findTaskIndex(tasks, taskId);
    if (idx < 0) return;
    // The switch is per USER (it lives only in this browser's store) and, for a child, per FAMILY:
    // the mother decides. Refusing here — not only in the markup — means a stale page or a script
    // cannot leave a child on a mode its mother contradicts.
    if (isTemplateChild(tasks[idx])) {
      notifyHome(t("tasks.runOnServerChildLocked")
        || "حالت اجرای فرآیندهای ساخته‌شده از این قالب را فرآیند مادر تعیین می‌کند.", "warn");
      render(tasks);
      return;
    }
    if (on && !serverRunAllowedSync()) {
      notifyHome(t("tasks.serverRunRestricted")
        || "اجرای روی سرور توسط مدیر محدود شده است؛ از اجرای محلی استفاده کنید.", "warn");
      render(tasks);
      return;
    }
    if (on) {
      // Turning server runs ON says "from now on the server is the truth for this process". Unsynced
      // local results would then sit in a browser nobody will run from again, so the user is sent to
      // resolve them first — sync them, or reset the local copy from the server — instead of the
      // switch silently orphaning them.
      const task = tasks[idx];
      const pendingCells = Array.isArray(task.locallyRunSources) ? task.locallyRunSources.length : 0;
      if (task.localRunPendingSync === true || pendingCells > 0) {
        const msg = t("tasks.syncBeforeServerBlocked", { n: pendingCells })
          || `این فرآیند ${pendingCells} تغییر محلیِ سینک‌نشده دارد. پیش از روشن‌کردن «اجرای روی سرور»، از فهرست منابع با دکمهٔ «همگام‌سازی با سرور» آن‌ها را منتقل کنید یا با «ریست دیتا از سرور» نسخهٔ محلی را از دادهٔ سرور بازسازی کنید.`;
        if (window.DaNotify?.confirm) {
          await DaNotify.confirm(msg, {
            title: t("tasks.syncBeforeServerTitle") || "تعیین تکلیف دادهٔ محلی",
            okText: t("common.ok") || "باشه",
            cancelText: t("common.cancel") || "انصراف"
          });
        } else {
          window.alert(msg);
        }
        // Either way the switch stays OFF: the run mode may not move on before the data is settled.
        render(tasks);
        return;
      }
    }
    if (!on) {
      const msg = t("tasks.runOnServerOffConfirm")
        || "اجرا و منابع این فرآیند به سیستم خودتان منتقل می‌شود و روی سرور ثبت نمی‌شود. ادامه می‌دهید؟";
      const ok = window.DaNotify
        ? await DaNotify.confirm(msg, {
            title: t("tasks.runOnServer"),
            okText: t("common.confirm") || "تأیید",
            cancelText: t("common.cancel"),
            danger: false
          })
        : window.confirm(msg);
      if (!ok) {
        // The switch already moved under the pointer; put it back so it never lies about the state.
        render(tasks);
        return;
      }
    }
    const motherOn = on !== false;
    // The mother decides where the WHOLE family runs. A child shares the mother's data model, so a
    // mixed mode would leave some children reading local copies that were never created for them.
    const children = childTasksOf(tasks, tasks[idx]);
    let blockedChildren = 0;
    tasks[idx] = { ...tasks[idx], runOnServer: motherOn };
    children.forEach((child) => {
      const i = findTaskIndex(tasks, child.id);
      if (i < 0) return;
      const pending = child.localRunPendingSync === true
        || (Array.isArray(child.locallyRunSources) && child.locallyRunSources.length > 0);
      if (motherOn && pending) blockedChildren += 1;
      tasks[i] = { ...tasks[i], runOnServer: motherOn };
    });
    writeTasks(tasks);
    render(tasks);
    notifyHome(motherOn ? t("tasks.runOnServerNowOn") : t("tasks.runOnServerNowOff"), "success");
    if (children.length) {
      notifyHome(t("tasks.runOnServerChildren", { n: children.length })
        || `${children.length} فرآیند فرزند هم با فرآیند مادر هم‌تراز شد.`, "info");
    }
    // A child that now runs on the server may still hold unsynced local results: say so instead of
    // letting them quietly stop being the copy that runs.
    if (blockedChildren > 0) {
      notifyHome(t("tasks.runOnServerChildrenPending", { n: blockedChildren })
        || `${blockedChildren} فرآیند فرزند دادهٔ محلیِ سینک‌نشده دارد؛ از فهرست منابع آن را همگام‌سازی کنید.`, "warn");
    }
  }

  /**
   * Push the results of a local run up to the server.
   *
   * A local run is deliberately off the server's books, so the sync is also where the two can
   * disagree: the server copy may have moved on, or the local run may have written values the
   * server never saw. The confirmation therefore names the risk before anything is written rather
   * than after, because this is not a reversible action.
   */
  async function syncLocalRun(taskId) {
    // The extension holds what the run actually wrote; this page may be a copy behind it.
    await refreshLocalTasksFromExtension();
    const tasks = readTasks();
    const task = findTask(tasks, taskId);
    if (!task) return;
    // ONE sync for the whole process: the row's button must settle every source the run touched,
    // not just the one that happens to be open somewhere. The payload is the pending-write log,
    // which is keyed by source id already.
    //
    // ASK the extension instead of reading this page's mirror: the mirror is only as fresh as the
    // last publish, and a publish is precisely what the sync is trying to catch up with. When the
    // extension answers, its list is the truth; when it does not answer, the mirror is the best
    // available copy.
    const answer = await requestSyncPayload({ taskId });
    const cells = answer?.ok
      ? (Array.isArray(answer.cells) ? answer.cells : [])
      : (Array.isArray(task.locallyRunSources) ? task.locallyRunSources : []);
    // Rows the run INSERTED locally. The server has to create them AT THESE INDEXES before patching
    // values: appending them at the end puts the run's values beside the wrong records whenever the
    // insertion was above existing rows, and every passed row then comes back as a conflict.
    const insertedRows = Array.isArray(answer?.insertedRows)
      ? answer.insertedRows
      : (Array.isArray(task?.locallyRunInsertedRows) ? task.locallyRunInsertedRows : []);
    const sourceIds = [...new Set(cells
      .map((c) => Number(c?.dataSourceId))
      .filter((n) => Number.isFinite(n) && n > 0))];
    if (!cells.length) {
      // Nothing to send: do NOT clear the badge. Clearing it made the row look "synced" while the
      // server had received nothing at all — the worst possible answer, because it hides the fact
      // that the local result still needs to be produced or found. Name the actual reason too:
      // "no extension" and "the run happened elsewhere" are different problems.
      const why = !answer
        ? (t("tasks.syncNoExtension") || "افزونهٔ اجرا به این صفحه پاسخ نداد؛ مطمئن شوید افزونه فعال و به همین سرور وصل است، بعد دوباره تلاش کنید.")
        : (answer.reason === "no-writes"
          ? (t("tasks.syncNoWrites") || "افزونه این فرآیند را می‌شناسد ولی هیچ نوشتن محلی برایش ثبت نکرده است (اجرا احتمالاً چیزی ننوشته یا روی حالت «سرور» بوده).")
          : (t("tasks.syncNothingKept")
            || "در این مرورگر نتیجهٔ محلیِ قابل ارسالی برای این فرآیند نیست (شاید اجرا روی سیستم دیگری بوده). بَج «نیاز به همگام‌سازی» دست‌نخورده ماند؛ برای ساختن نتیجه، فرآیند را محلی اجرا کنید یا از فهرست منابع نمای محلی را باز کنید."));
      notifyHome(why, "warn");
      render(tasks);
      return;
    }
    const msg = t("tasks.syncConfirmAll", { n: sourceIds.length, cells: cells.length })
      || t("tasks.syncConfirm")
      || "نتیجهٔ اجرای محلی همهٔ منابع این فرآیند روی سرور نوشته می‌شود. اگر روی سرور تغییر کرده باشند، ممکن است اطلاعات جایگزین یا از دست برود. ادامه می‌دهید؟";
    const ok = window.DaNotify
      ? await DaNotify.confirm(msg, {
          title: t("tasks.syncLocalRun"),
          okText: t("tasks.syncConfirmOk") || "سینک کن",
          cancelText: t("common.cancel"),
          danger: true
        })
      : window.confirm(msg);
    if (!ok) return;

    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/sync-local-run`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localRunAt: task.lastLocalRunAt || null,
          // The API names this `cells` (see SyncLocalRunRequest). Sending it as `dataSources` meant
          // the server read an empty list: the sync reported success, cleared nothing and wrote no
          // values, so the badge stayed and the divergence was never resolved.
          cells,
          rows: insertedRows
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || t("tasks.syncFail"));
      }
      const result = await res.json().catch(() => ({}));
      const applied = Number(result?.applied) || 0;
      const unchanged = Number(result?.unchanged) || 0;
      const skipped = Number(result?.skipped) || 0;
      const conflicts = Array.isArray(result?.conflicts) ? result.conflicts.length : 0;
      // Did the server actually take the values? `applied` counts writes and `unchanged` counts
      // cells that already held them — both mean "the server now agrees with this browser". Every
      // other outcome (conflicts kept the server's value, skipped cells could not be addressed)
      // means the payload was REFUSED, and clearing the badge then was the "I pressed sync, the
      // badge vanished and the server still shows the old data" report.
      const accepted = applied + unchanged > 0;
      const idx = findTaskIndex(tasks, taskId);
      if (idx >= 0 && accepted) {
        // The server consumed the payload: clear the LOG as well as the flag, and delete this
        // browser's copies of the sources that were just sent. A copy left behind would keep
        // offering a "local view" of data that no longer exists locally; the next local run copies
        // the sources again, which is exactly what should bring the two buttons back.
        const copies = { ...(tasks[idx].localSourceCopies || {}) };
        const loadedFlags = { ...(tasks[idx].localSourcesLoaded || {}) };
        for (const sid of sourceIds) {
          delete copies[String(sid)];
          delete loadedFlags[String(sid)];
        }
        tasks[idx] = {
          ...tasks[idx],
          localRunPendingSync: false,
          locallyRunSources: null,
          locallyRunInsertedRows: null,
          localSourceCopies: Object.keys(copies).length ? copies : null,
          localSourcesLoaded: Object.keys(loadedFlags).length ? loadedFlags : null
        };
        writeTasks(tasks);
        render(tasks);
      } else if (!accepted) {
        // Keep the log: the values are still only here, so the choice (retry after the server
        // changes, or rebuild this copy from the server) is still the user's to make.
        notifyHome(t("tasks.syncRefused", { applied, conflicts, skipped })
          || `سرور هیچ سلولی را از این ارسال نپذیرفت (${conflicts} تعارض · ${skipped} نامعتبر) — نسخهٔ سرور حفظ شد و «نیاز به همگام‌سازی» باقی ماند. اگر نسخهٔ سرور درست است، این منبع را از سرور بازسازی کنید؛ وگرنه دوباره سینک کنید.`, "error");
        return;
      }
      notifyHome(
        conflicts
          ? (t("tasks.syncDoneAllConflicts", { n: sourceIds.length, applied, conflicts })
            || `نتیجهٔ ${sourceIds.length} منبع سینک شد — ${applied} سلول نوشته شد · ${conflicts} تعارض (نسخهٔ سرور حفظ شد).`)
          : (t("tasks.syncDoneAll", { n: sourceIds.length, applied })
            || `نتیجهٔ ${sourceIds.length} منبع سینک شد — ${applied} سلول نوشته شد.`),
        conflicts ? "warn" : "success"
      );
    } catch (e) {
      notifyHome(String(e.message || e), "error");
    }
  }

  function bindTaskActions(root) {
    root?.querySelectorAll("[data-da-sync]").forEach((btn) => {
      btn.addEventListener("click", () => syncLocalRun(btn.getAttribute("data-da-sync")));
    });
    root?.querySelectorAll("[data-da-runserver]").forEach((inp) => {
      inp.addEventListener("change", () => {
        // The switch stays clickable even while server runs are limited, so an attempt gets an
        // explanation instead of a dead control. It always snaps back to OFF.
        if (inp.checked && !serverRunAllowedSync()) {
          inp.checked = false;
          notifyHome(t("tasks.serverRunRestricted")
            || "اجرای روی سرور توسط مدیر محدود شده است؛ از اجرای محلی استفاده کنید.", "warn");
          render();
          return;
        }
        setRunOnServer(inp.getAttribute("data-da-runserver"), inp.checked);
      });
    });
    root?.querySelectorAll("[data-da-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-da-del");
        const row = findTask(readTasks(), id);
        const isServerRow = /^\d+$/.test(String(id));

        /**
         * Ask the server what this delete would take with it before saying anything.
         *
         * A MOTHER is not just a row: it owns a template, and the template holds every child built
         * on it. Deleting the mother therefore deletes the template too and detaches those children
         * — none of which is visible from the row being deleted. Reading the impact first is what
         * lets the confirmation state the real cost instead of a generic "are you sure".
         *
         * Fetched lazily, only when the button is actually pressed, so the process list does not pay
         * for a lookup per row on every render.
         */
        let impact = null;
        if (isServerRow) {
          try {
            const res = await fetch(`/api/tasks/${id}/delete-impact`, { credentials: "same-origin" });
            if (res.ok) impact = await res.json();
          } catch { /* the warning is best-effort; the delete itself is still guarded */ }
        }

        const message = impact && impact.isMother && impact.childCount > 0
          ? t("tasks.deleteMotherConfirm", {
              template: impact.templateTitle || "—",
              count: impact.childCount
            })
          : (t("tasks.deleteConfirm") || "این فرآیند حذف شود؟");

        const ok = window.DaNotify
          ? await DaNotify.confirm(message, {
              title: impact && impact.isMother ? t("tasks.deleteMother") : t("tasks.delete"),
              danger: true,
              okText: t("tasks.delete")
            })
          : false;
        if (!ok) return;
        try {
          let detached = 0;
          let deletedTemplate = null;
          if (isServerRow) {
            const res = await fetch(`/api/tasks/${id}`, { method: "DELETE", credentials: "same-origin" });
            if (!res.ok && res.status !== 204) {
              const body = await res.json().catch(() => ({}));
              notifyHome(body.message || t("share.error") || "حذف ناموفق بود.", "error");
              return;
            }
            // 200 carries the cascade detail; 204 is the pre-existing shape and means "plain delete".
            if (res.status === 200) {
              const body = await res.json().catch(() => ({}));
              detached = Number(body.detachedProcesses) || 0;
              deletedTemplate = body.deletedTemplateTitle || null;
            }
          }
          const next = readTasks().filter((x) => !taskIdEq(x.id, id));
          writeTasks(next);
          render(next);
          // Report the real consequence, not just "deleted": when a mother goes, the template goes
          // with it and its children are cut loose, and the user is owed that confirmation.
          if (detached > 0) {
            notifyHome(t("tasks.deletedMotherDone", {
              template: deletedTemplate || "—",
              count: detached
            }), "success");
          } else {
            notifyHome(t("tasks.deleted") || "فرآیند حذف شد.", "success");
          }
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
          /**
           * Importing over a template child detaches it — the imported graph becomes the process's
           * own structure, so its template link is cleared. That is a real, irreversible decision
           * (the child stops following its mother), so it is named in the confirmation rather than
           * buried in the generic "replace the content?" question.
           */
          const row = (readTasks() || []).map(normalizeTask).find((r) => String(r.id) === String(id));
          const isChild = row && row.templateId != null;
          const lead = isChild
            ? t("tasks.importDetachConfirm", { name: file.name, template: row.templateTitle || "—" })
            : t("tasks.importConfirm", { name: file.name });
          if (!confirm(lead)) return;
          await applyImportToTask(id, imported);
        } catch (e) {
          notifyHome(e.message || "خطا در بارگذاری فایل", "error");
        }
      });
    });
    root?.querySelectorAll("[data-da-view-data]").forEach((btn) => {
      btn.addEventListener("click", () =>
        viewProcessData(btn.getAttribute("data-da-view-data"), btn, btn.getAttribute("data-mode")));
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
  root?.querySelectorAll("[data-da-details]").forEach((btn) => {
    btn.addEventListener("click", () => showProcessDetails(btn.getAttribute("data-da-details")));
  });
  /**
   * The row's template button opens the same details modal the template chip does, so a user who
   * spots the marker in the action column gets the version/step/attachment counts without hunting
   * for the chip. The template list and modal both live in local-templates.js, which owns that
   * surface — this only forwards the id.
   */
  root?.querySelectorAll("[data-da-template-row]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = (readTasks() || []).find((x) => String(x.id) === String(btn.getAttribute("data-da-template-row")));
      const tplId = row?.templateId;
      if (tplId != null && window.DaTemplates && typeof DaTemplates.openInfo === "function") {
        DaTemplates.openInfo(tplId);
        return;
      }
      notifyHome(t("tasks.templateInfoUnavailable") || "اطلاعات قالب در دسترس نیست.", "warn");
    });
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

/**
 * Show the process's registration and last-edit details in a dialog.
 *
 * These four facts (who/when it was created, who/when the process and its data were last edited)
 * used to be four columns of the list, which pushed the columns that get scanned — run, shared
 * users, group/action/source counts — off to the right and made the table need horizontal
 * scrolling on an ordinary laptop. They are reference information, not something you compare
 * across rows, so they live behind a button instead.
 *
 * The row is read from the already-loaded list, so this opens with no request.
 */
function showProcessDetails(taskId) {
  const id = String(taskId ?? "").trim();
  if (!id) return;
  const row = readTasks().map(normalizeTask).find((r) => String(r.id) === id);
  if (!row) return;

  const rows = [
    ["panel.colTitle", escapeHtml(row.title || "—")],
    ["panel.colCreated", escapeHtml(formatCreatedAt(row.createdAt))],
    ["panel.colCreator", escapeHtml(String(row.createdBy || "").trim() || "—")],
    ["panel.colProcessEdit", formatEditMeta(editMetaIso(row, "process"), editMetaUser(row, "process"))],
    ["panel.colDataEdit", formatEditMeta(editMetaIso(row, "data"), editMetaUser(row, "data"))],
    ["panel.colLastRun", formatLastRun(row)]
  ];

  /**
   * Name the template relationship in the details dialog, because it is the one fact that decides
   * where the user has to go to change this process: a child is locked and follows its mother,
   * while the mother is the row that drives every child. Shown for both roles so the answer is
   * never "look at the diagram and work it out".
   */
  if (row.templateId) {
    rows.splice(1, 0, ["panel.colTemplate", escapeHtml(row.templateTitle || "—")]);
    rows.splice(2, 0, [
      "tasks.motherProcess",
      row.sourceProcessTitle
        ? `<a href="/Panel/Tasks/Editor/${encodeURIComponent(String(row.sourceProcessId ?? ""))}">${escapeHtml(row.sourceProcessTitle)}</a>`
        : escapeHtml(t("tasks.templateNoMother"))
    ]);
  } else if (row.isTemplateSource) {
    rows.splice(1, 0, ["panel.colTemplate", escapeHtml(t("tasks.templateSourceLabel"))]);
  }

  // A process whose run is local (or whose local results are still unsynced) describes a copy of
  // itself that lives on this machine, so the details must say the server may disagree.
  const detailsCtx = processLocalContext(row.id);
  const localNoteHtml = (detailsCtx.local || detailsCtx.pending)
    ? `<p class="ds-local-note">${escapeHtml(t("sources.localDifferNote")
        || "این اطلاعات از نسخهٔ محلی این مرورگر است و ممکن است با اطلاعات سرور متفاوت باشد.")}</p>`
    : "";
  const bodyHtml = `${localNoteHtml}<dl class="da-details-list">${rows.map(([key, value]) => `
    <div class="da-details-row">
      <dt>${escapeHtml(t(key))}</dt>
      <dd>${value}</dd>
    </div>`).join("")}</dl>`;

  let host = document.getElementById("da-process-details-modal");
  if (!host) {
    host = document.createElement("div");
    host.id = "da-process-details-modal";
    host.className = "da-run-history-modal";
    host.hidden = true;
    host.innerHTML = `
      <div class="da-run-history-backdrop" data-details-close="1"></div>
      <div class="da-run-history-box" role="dialog" aria-modal="true" aria-labelledby="da-process-details-title">
        <div class="da-run-history-head">
          <h5 id="da-process-details-title"></h5>
          <button type="button" class="da-run-history-close" data-details-close="1" aria-label="${escapeHtml(t("common.close"))}">&times;</button>
        </div>
        <div class="da-run-history-body"></div>
      </div>`;
    document.body.appendChild(host);
    host.querySelectorAll("[data-details-close]").forEach((el) => {
      el.addEventListener("click", () => { host.hidden = true; });
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") host.hidden = true;
    });
  }
  host.querySelector("#da-process-details-title").textContent = t("tasks.details");
  host.querySelector(".da-run-history-body").innerHTML = bodyHtml;
  host.hidden = false;
  bindTaskActions(host);
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
  const processViewerState = {
    source: null, cellRevisions: null, cellMeta: null, editing: null,
    // Live overlay state: which process's play group we joined, the hub connection, and the
    // per-cell flash timers so a re-triggered cell restarts its blink instead of stacking.
    taskId: null, connection: null, blinkTimers: new Map(),
    // True while the open grid is showing a LOCAL (browser-side) copy. In that mode the grid reads
    // no rows from the server, sends no cell write to it, and is not patched by the live hub: the
    // data belongs to the client, so only the client can update it.
    localMode: false,
    /** Timer that repaints the local grid (there is no hub for a browser-side copy). */
    localTimer: null
  };

  // Cell events reach a browser twice: once as a window event the extension broadcasts locally and
  // once through the play hub. Applying both would shift rows twice, so an event id is honoured once.
  const seenProcessCellEvents = new Set();

  /**
   * Is this process running from a browser-side copy?
   *
   * Two independent facts make the grid "local": the row's run switch is OFF (runs execute on this
   * machine), or the browser still holds unsynced writes from an earlier local run. Both mean the
   * values on screen may differ from the server's, which is what the viewer's banner says.
   */
  function processLocalContext(taskId) {
    const row = findTask(readTasks(), String(taskId ?? ""));
    if (!row) return { local: false, pending: false, hasCopy: false };
    const pending = row.localRunPendingSync === true
      || (Array.isArray(row.locallyRunSources) && row.locallyRunSources.length > 0);
    // "Local" means a browser copy EXISTS — not merely that the switch is set to run here. After a
    // sync the copy is deleted, and defaulting to a local view then would draw server rows under a
    // "this is your local copy" banner: the exact confusion the two-button pair exists to remove.
    const hasCopy = !!(row.localSourceCopies && Object.keys(row.localSourceCopies).length);
    return { local: pending || hasCopy, pending, hasCopy };
  }

  /** The browser's hydrated copy of one source for a process, if this browser holds one. */
  function localProcessSnapshot(taskId, sourceId) {
    const row = findTask(readTasks(), String(taskId ?? ""));
    if (!row) return null;
    // The COMPLETE copy lives in its own record, `localSourceCopies[sourceId]`: a source is an entity
    // in its own right, not a corner of the process graph. The graph is STRUCTURE — the portal
    // replaces it with the canvas (which carries no cells at all) — so drawing the grid from it
    // showed a single partial row (only the cells a run happened to touch) or nothing, and any graph
    // reload quietly threw the local data away.
    const id = Number(sourceId);
    const tasks = readTasks();
    const rec = (() => {
      const own = row.localSourceCopies?.[String(id)];
      if (own && Array.isArray(own.cells)) return own;
      // A source is an entity of its own: another process that loaded it holds a valid copy, and it
      // is a better answer than asking the server for rows this browser already has.
      let best = null;
      for (const t2 of tasks) {
        const r = t2?.localSourceCopies?.[String(id)];
        if (!r || !Array.isArray(r.cells)) continue;
        if (!best || String(r.savedAtUtc || "") > String(best.savedAtUtc || "")) best = r;
      }
      return best;
    })();
    if (rec && Array.isArray(rec.cells)) {
      return {
        id,
        title: rec.title || "",
        fileName: rec.fileName || null,
        cells: rec.cells.map((c) => ({ ...c })),
        columns: Array.isArray(rec.columns) ? rec.columns.map((c) => ({ ...c })) : [],
        columnKeys: Array.isArray(rec.columnKeys) ? rec.columnKeys.slice() : [],
        rowCount: Number(rec.rowCount) || 0,
        columnCount: Number(rec.columnCount) || 0
      };
    }
    // Legacy fallback: a process cached before those records existed kept its cells on the graph. The
    // canvas the server hands out carries no `cells` key at all, so the PRESENCE of the array is what
    // marks a loaded copy — an empty one is a copy the user deliberately cleared.
    const graphs = [row.graph, row.canvasCache?.graph].filter(Boolean);
    for (const g of graphs) {
      const hit = (g.dataSources || []).find((d) => Number(d.id) === id);
      if (hit && Array.isArray(hit.cells)) return hit;
    }
    return null;
  }

  /**
   * Show or hide the "may differ from the server" banner above the grid.
   *
   * It belongs on every info modal opened while a local copy is in play — the process viewer and a
   * source's own viewer alike — because the numbers on screen are then whatever this browser loaded
   * or changed last, not what the server holds.
   */
  function setProcessLocalNote(on, text) {
    const el = document.getElementById("da-portal-ds-local-note");
    if (!el) return;
    el.hidden = !on;
    if (on) {
      el.textContent = text
        || t("sources.localDifferNote")
        || "این اطلاعات از نسخهٔ محلی این مرورگر است و ممکن است با اطلاعات سرور متفاوت باشد. برای انتقال نتیجه «همگام‌سازی با سرور» را بزنید.";
    }
  }

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

  /**
   * Load a source's data for a LOCAL run — but only when the server copy actually moved.
   *
   * "Local" means the server is read ONCE, before the first step, and the run then works on its own
   * copy — and that copy must be the server's CURRENT rows. So each non-public source is checked
   * against the revision we last loaded: one light `/meta` request per source, and only a changed
   * source pulls its rows. An unchanged process therefore starts a local run with no row traffic at
   * all, while still running on the newest data the server holds.
   *
   * Public/shared sources are never cached: they stay server-backed even in a local run, because
   * their state is shared with everyone else by design.
   *
   * The cells are written ONTO the graph's own source entries, because that is the only place the
   * engine's `readCellForRun` looks for local data (`ds.cells`). Storing them anywhere else would
   * leave every local read falling back to the server, which is exactly what "local" must avoid.
   *
   * Unsynced local writes survive the reload: the browser keeps them in `task.locallyRunSources`,
   * and they are re-applied on top of the freshly loaded rows. Dropping them here would throw away
   * results the user has not synced yet — the sync button's whole reason for existing.
   *
   * Returns `{ failed, loaded, kept, pending }`: sources that could not be loaded (the run then falls
   * back to server reads for them), sources that were refreshed, sources whose cached copy was still
   * current, and cells that remain local-only.
   */
  async function hydrateLocalRunSources(task) {
    const sources = (task?.graph?.dataSources || []);
    if (!sources.length) return { failed: 0, loaded: 0, kept: 0, pending: 0 };

    const isPublic = (d) => d?.isPublic === true || d?.IsPublic === true;
    const targets = sources.filter((d) => d && d.id != null && !isPublic(d));
    if (!targets.length) return { failed: 0, loaded: 0, kept: 0, pending: 0 };

    // Writes this browser has not pushed to the server yet, grouped by source.
    const pendingBySource = new Map();
    for (const c of (Array.isArray(task?.locallyRunSources) ? task.locallyRunSources : [])) {
      const sid = Number(c?.dataSourceId);
      if (!Number.isFinite(sid) || sid <= 0) continue;
      if (!pendingBySource.has(sid)) pendingBySource.set(sid, []);
      pendingBySource.get(sid).push(c);
    }

    // Revisions live on the task, keyed by source id: `{ [id]: dataRevision }`. `localSourcesLoaded`
    // records "we hold a snapshot for this source" separately, because a source with zero rows is a
    // real snapshot — testing `cells.length` would re-download it on every single run.
    const revisions = task.localSourceRevisions || {};
    const loadedFlags = task.localSourcesLoaded || {};
    let failed = 0;
    let loaded = 0;
    let kept = 0;
    let pending = 0;

    for (const ds of targets) {
      const id = Number(ds.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      try {
        // What revision does the server hold right now? The meta endpoint carries no cells, so the
        // check costs one light request per source instead of a second full download.
        let serverRevision = null;
        try {
          const metaRes = await fetch(`/api/datasources/${id}/meta`, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (metaRes.ok) {
            const meta = await metaRes.json();
            serverRevision = meta?.dataRevision ?? meta?.DataRevision ?? null;
          }
        } catch { /* treated as "unknown" below: an unknown revision means reload */ }

        const haveSnapshot = loadedFlags[id] === true || Array.isArray(ds.cells);
        const unchanged = haveSnapshot
          && serverRevision != null
          && revisions[id] === serverRevision;

        if (unchanged) {
          kept += 1;
        } else {
          const content = await fetchProcessSourceContent(id);
          // Write the snapshot exactly where the engine reads it.
          ds.cells = content.cells;
          ds.columns = content.columns;
          ds.columnKeys = content.columnKeys;
          ds.rowCount = content.rowCount;
          ds.columnCount = content.columnCount ?? content.columns.length;
          revisions[id] = serverRevision;
          loadedFlags[id] = true;
          loaded += 1;
        }

        // Re-apply this browser's unsynced writes so a reload never discards local results.
        const keep = pendingBySource.get(id);
        if (keep && keep.length && Array.isArray(ds.cells)) {
          keep.forEach((w) => {
            setProcessLocalCell(ds, Number(w.rowIndex) || 0, String(w.columnKey || ""), w.cellValue ?? "");
            pending += 1;
          });
        }
      } catch {
        failed += 1;
      }
    }

    task.localSourceRevisions = revisions;
    task.localSourcesLoaded = loadedFlags;
    task.localSourcesLoadedAt = Date.now();
    task.localSourcesLoadedCount = loaded;
    task.localSourcesPendingCount = pending;
    return { failed, loaded, kept, pending };
  }

  // --- Live read/write overlays (same behaviour as the sources-page viewer) --------------------
  // The modal is a window on the same data a run touches, so while the process plays every cell
  // the engine reads or writes must light up right here — reading = blue flash, writing = green
  // flash — and the live dot says whether that conduit is actually open.
  function setProcessLiveStatus(on, text) {
    const el = document.getElementById("da-portal-ds-live");
    if (!el) return;
    el.classList.toggle("is-on", !!on);
    el.textContent = text || (on ? "● زنده" : "● آفلاین");
  }

  function flashProcessCell(td, op) {
    if (!td) return;
    const cls = op === "write" ? "ds-flash-write" : "ds-flash-read";
    td.classList.remove("ds-flash-read", "ds-flash-write");
    void td.offsetWidth;
    td.classList.add(cls);
    const key = `${td.dataset.row}:${td.dataset.col}`;
    const prev = processViewerState.blinkTimers.get(key);
    if (prev) clearTimeout(prev);
    processViewerState.blinkTimers.set(key, setTimeout(() => {
      td.classList.remove(cls);
      processViewerState.blinkTimers.delete(key);
    }, 2800));
  }

  function showProcessActor(ev) {
    const who = ev.userName || ev.UserName;
    if (!who) return;
    const el = document.getElementById("da-portal-ds-actor");
    if (el) {
      el.hidden = false;
      el.textContent = (window.DaI18n ? DaI18n.t("live.byUser", { user: who }) : `توسط ${who}`) || `توسط ${who}`;
    }
  }

  /**
   * Move a source's cached rows to match a row inserted or removed elsewhere.
   *
   * Every cell carries the row index the server gave it, so after a structural change each index
   * from the touched row down is off by one. Shifting the cache here — instead of waiting for a
   * reload — makes the new row visible immediately and keeps the next read/write flash on the row it
   * really happened on. The blank row is materialised as empty cells (one per column), exactly like
   * the server's own AddRows, because a missing index would collapse the numbering again.
   */
  function shiftProcessRows(ds, atIndex, delta) {
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
  }

  // --- Local structural editing ---------------------------------------------------------------
  // While the grid shows a browser-side copy, every edit — cell OR shape — belongs to that copy.
  // The server is not told anything: a local run's whole promise is that the shared source stays
  // untouched until the user syncs. These helpers mutate the displayed source and mirror it onto the
  // process's snapshot, so the next local run and the next open of this grid see the same shape.

  /** Column keys of a source snapshot, from whichever of the two shapes it carries. */
  function snapshotColumnKeys(ds) {
    return (ds?.columnKeys || (ds?.columns || []).map((c) => String(c.key || c.Key || "")) || [])
      .filter(Boolean);
  }

  /** Insert a column at `atIndex` (append when null) with one empty cell per existing row. */
  function localAddColumn(ds, key, title, atIndex) {
    const cols = Array.isArray(ds.columns) ? ds.columns.slice() : snapshotColumnKeys(ds).map((k) => ({ key: k, title: k }));
    const keys = snapshotColumnKeys(ds);
    const at = atIndex == null ? keys.length : Math.max(0, Math.min(Number(atIndex) || 0, keys.length));
    cols.splice(at, 0, { key, title: title || key });
    keys.splice(at, 0, key);
    ds.columns = cols;
    ds.columnKeys = keys;
    ds.columnCount = keys.length;
    ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
    const rows = Number(ds.rowCount) || 0;
    for (let r = 0; r < rows; r++) ds.cells.push({ key: String(key), index: r, cellValue: "" });
  }

  /** Remove a column and every cell that belongs to it. */
  function localDeleteColumn(ds, key) {
    const drop = String(key);
    ds.cells = (Array.isArray(ds.cells) ? ds.cells : [])
      .filter((c) => String(c.key ?? c.Key ?? "") !== drop);
    ds.columnKeys = snapshotColumnKeys(ds).filter((k) => k !== drop);
    if (Array.isArray(ds.columns)) {
      ds.columns = ds.columns.filter((c) => String(c.key || c.Key || "") !== drop);
    }
    ds.columnCount = ds.columnKeys.length;
  }

  /** Rename a column everywhere: its definition, the key list, and its cells. */
  function localRenameColumn(ds, oldKey, newKey) {
    const from = String(oldKey);
    const to = String(newKey);
    ds.columnKeys = snapshotColumnKeys(ds).map((k) => (k === from ? to : k));
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

  /** Mirror the displayed source's cells + shape onto the process's local snapshot. */
  function persistLocalSnapshot(ds) {
    if (!ds) return;
    const tasks = readTasks();
    const idx = findTaskIndex(tasks, processViewerState.taskId);
    if (idx < 0) return;
    const task = tasks[idx];
    const sourceId = Number(ds.id);
    // The authoritative record first: this is what every local viewer draws, and it must never be
    // lost to a graph reload.
    const copies = { ...(task.localSourceCopies || {}) };
    if (Number.isFinite(sourceId)) {
      copies[String(sourceId)] = {
        cells: Array.isArray(ds.cells) ? ds.cells.map((c) => ({ ...c })) : [],
        columns: Array.isArray(ds.columns) ? ds.columns.map((c) => ({ ...c })) : [],
        columnKeys: Array.isArray(ds.columnKeys) ? ds.columnKeys.slice() : [],
        rowCount: Number(ds.rowCount) || 0,
        columnCount: Number(ds.columnCount) || 0,
        title: ds.title || task.localSourceCopies?.[String(sourceId)]?.title || null,
        fileName: ds.fileName || task.localSourceCopies?.[String(sourceId)]?.fileName || null,
        savedAtUtc: new Date().toISOString()
      };
    }
    let touched = false;
    [task.graph, task.canvasCache?.graph].filter(Boolean).forEach((g) => {
      const snap = (g.dataSources || []).find((d) => Number(d.id) === sourceId);
      if (!snap) return;
      snap.cells = ds.cells;
      snap.columns = ds.columns;
      snap.columnKeys = ds.columnKeys;
      snap.rowCount = ds.rowCount;
      snap.columnCount = ds.columnCount;
      touched = true;
    });
    if (!touched && !Number.isFinite(sourceId)) return;
    tasks[idx] = { ...task, localSourceCopies: copies };
    writeTasks(tasks, { silent: true });
  }

  /**
   * Apply one grid-menu action to the browser copy of a local-run source.
   *
   * Deliberately no fetch: adding/removing rows or columns and renaming a column all change the
   * source for every user, which a local run must never do. The change is real for this browser —
   * the next run uses it — and the banner keeps saying the server may disagree. Structural changes
   * have no cell address, so the sync button carries values only; that is stated in the toast.
   */
  async function runLocalProcessGridAction(action, rowIndex, columnKey, columnIndex) {
    const ds = processViewerState.source;
    if (!ds) return;
    const confirmAsk = async (msg, titleKey, okKey) => (window.DaNotify?.confirm
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
      localRenameColumn(ds, columnKey, newName);
    } else if (action === "row-delete") {
      const msg = t("sources.deleteRowConfirm", { row: rowIndex + 1 }) || `ردیف ${rowIndex + 1} حذف شود؟`;
      if (!(await confirmAsk(msg, "sources.deleteRow", "common.delete"))) return;
      shiftProcessRows(ds, rowIndex, -1);
    } else if (action === "col-delete") {
      const msg = t("sources.deleteColumnConfirm", { key: columnKey }) || `ستون «${columnKey}» با همهٔ داده‌هایش حذف شود؟`;
      if (!(await confirmAsk(msg, "sources.deleteColumn", "common.delete"))) return;
      localDeleteColumn(ds, columnKey);
    } else if (action === "row-before") {
      shiftProcessRows(ds, Math.max(0, rowIndex ?? 0), 1);
    } else if (action === "row-after") {
      shiftProcessRows(ds, Math.max(0, (rowIndex ?? 0) + 1), 1);
    } else {
      const key = nextProcessColumnKey(snapshotColumnKeys(ds));
      const at = action === "col-before"
        ? (columnIndex ?? snapshotColumnKeys(ds).length)
        : ((columnIndex ?? snapshotColumnKeys(ds).length - 1) + 1);
      localAddColumn(ds, key, key, at);
    }
    persistLocalSnapshot(ds);
    renderProcessViewerTable(ds);
    notifyHome(t("sources.localEditApplied")
      || "تغییر روی نسخهٔ محلی اعمال شد؛ دادهٔ سرور دست‌نخورده ماند (همگام‌سازی فقط مقدار سلول‌ها را منتقل می‌کند).", "info");
  }

  /** Empty the browser copy of a local-run source. The server's rows stay exactly as they are. */
  function clearProcessLocalData() {
    const ds = processViewerState.source;
    if (!ds) return;
    ds.cells = [];
    ds.rowCount = 0;
    processViewerState.cellRevisions = {};
    processViewerState.cellMeta = {};
    // The cells those pending writes pointed at no longer exist locally, so they are dropped with
    // them; otherwise the next sync would try to write into rows this copy no longer has.
    const tasks = readTasks();
    const idx = findTaskIndex(tasks, processViewerState.taskId);
    if (idx >= 0) {
      const task = tasks[idx];
      const kept = (task.locallyRunSources || [])
        .filter((w) => Number(w?.dataSourceId) !== Number(ds.id));
      tasks[idx] = {
        ...task,
        locallyRunSources: kept.length ? kept : null,
        localRunPendingSync: kept.length > 0
      };
      writeTasks(tasks, { silent: true });
    }
    persistLocalSnapshot(ds);
    renderProcessViewerTable(ds);
    notifyHome(t("sources.clearDataLocalDone")
      || "دادهٔ نسخهٔ محلی پاک شد؛ دادهٔ سرور دست‌نخورده ماند.", "success");
  }

  function handleProcessCellEvent(ev) {
    if (!ev) return;
    // The extension broadcasts each cell event twice (a window event for this tab and a hub relay
    // for the others). Both can reach this page, and a structural event applied twice invents a
    // row, so an event id is honoured exactly once.
    const eid = ev.eventId ?? ev.EventId;
    if (eid) {
      if (seenProcessCellEvents.has(eid)) return;
      seenProcessCellEvents.add(eid);
      if (seenProcessCellEvents.size > 400) seenProcessCellEvents.clear();
    }
    const taskId = String(ev.taskId ?? ev.TaskId ?? "");
    if (taskId && processViewerState.taskId != null && String(processViewerState.taskId) !== taskId) return;
    const sid = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "").trim();
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    // A row was added or removed: shift the cached rows, repaint, and light the affected row. Without
    // this the inserted row stayed invisible and the next flash pointed at a neighbour's value.
    if (op === "insert" || op === "delete") {
      const ds = processViewerState.source;
      if (ds && Number(ds.id) === sid) {
        shiftProcessRows(ds, idx, op === "insert" ? 1 : -1);
        const modal = document.getElementById("da-portal-ds-viewer");
        if (modal && !modal.hidden) {
          renderProcessViewerTable(ds);
          const td = document.getElementById("da-portal-ds-table")
            ?.querySelector(`td[data-row="${idx}"]`);
          if (td) flashProcessCell(td, op === "insert" ? "write" : "read");
        }
      }
      return;
    }
    // A write also moves the grid's own copy — even before (or without) the modal showing this
    // source — so the next paint of this source is never stale.
    if (op.includes("write") && col && processViewerState.source
      && Number(processViewerState.source.id) === sid) {
      const val = ev.cellValue == null && ev.CellValue == null ? "" : String(ev.cellValue ?? ev.CellValue ?? "");
      setProcessLocalCell(processViewerState.source, idx, col, val);
    }
    const modal = document.getElementById("da-portal-ds-viewer");
    const viewing = modal && !modal.hidden && Number(processViewerState.source?.id) === sid;
    if (!viewing || !col) return;
    const table = document.getElementById("da-portal-ds-table");
    const findTd = () => table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
    if (op.includes("write")) {
      let td = findTd();
      if (!td && processViewerState.source) {
        // The write may have grown the grid (a new row) — repaint, then light the cell up.
        renderProcessViewerTable(processViewerState.source);
        td = findTd();
      } else if (td && (ev.cellValue != null || ev.CellValue != null)) {
        td.textContent = String(ev.cellValue ?? ev.CellValue ?? "");
      }
      flashProcessCell(td, "write");
    } else {
      flashProcessCell(findTd(), "read");
    }
    showProcessActor(ev);
  }

  async function ensureProcessViewerHub(taskId) {
    if (typeof signalR === "undefined") {
      setProcessLiveStatus(false, "● بدون SignalR");
      return;
    }
    if (processViewerState.connection) {
      try { await processViewerState.connection.stop(); } catch { /* ignore */ }
      processViewerState.connection = null;
    }
    const joinId = String(taskId ?? "").trim();
    if (!joinId) {
      setProcessLiveStatus(false, "● آفلاین");
      return;
    }
    try {
      const conn = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/play-data")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      conn.on("cellEvent", handleProcessCellEvent);
      conn.onreconnecting(() => setProcessLiveStatus(false, "● در حال اتصال…"));
      conn.onreconnected(async () => {
        await conn.invoke("JoinTask", joinId).catch(() => {});
        setProcessLiveStatus(true, "● زنده");
      });
      conn.onclose(() => setProcessLiveStatus(false));
      await conn.start();
      await conn.invoke("JoinTask", joinId);
      processViewerState.connection = conn;
      setProcessLiveStatus(true, "● زنده");
    } catch {
      setProcessLiveStatus(false, "● قطع");
    }
  }

  /**
   * Repaint the LOCAL grid every couple of seconds from this browser's copy.
   *
   * A local run writes nothing to the server, so there is no live feed to subscribe to; the cell
   * events give the instant feedback, and this timer is the safety net for anything they missed.
   * It touches localStorage and the DOM only — no requests.
   */
  function startProcessLocalTimer() {
    stopProcessLocalTimer();
    processViewerState.localTimer = setInterval(() => {
      if (!processViewerState.localMode || !processViewerState.source) return;
      if (processViewerState.editing) return;  // never repaint under a half-typed cell
      const snap = localProcessSnapshot(processViewerState.taskId, processViewerState.source.id);
      if (!snap) return;
      // The record is the run's copy; the pending log may still be a moment ahead of it.
      overlayLocalWrites(snap, processViewerState.source.id);
      renderProcessViewerTable(snap);
    }, 2000);
  }

  function stopProcessLocalTimer() {
    if (processViewerState.localTimer) {
      clearInterval(processViewerState.localTimer);
      processViewerState.localTimer = null;
    }
  }

  /**
   * Say WHICH copy the open viewer shows, in its header chip and on the row button that opened it.
   *
   * Green is the server's copy and grey is this browser's, everywhere in the product; without this
   * chip the grid itself gave no clue which of the two the user was looking at, and the answer to
   * "did my sync land?" depended on remembering which icon was pressed.
   */
  function paintProcessViewModeChip(localMode) {
    const open = processViewerState.taskId != null;
    const local = !!localMode;
    const chip = document.getElementById("da-portal-ds-mode");
    if (chip) {
      chip.hidden = !open;
      if (open) {
        chip.className = `ds-view-mode ${local ? "is-local" : "is-server"}`;
        chip.textContent = local
          ? (t("sources.modeLocal") || "دادهٔ محلی این مرورگر")
          : (t("sources.modeServer") || "دادهٔ سرور");
        chip.title = local
          ? (t("sources.localDifferNote") || "")
          : (t("sources.modeServerHint") || "ردیف‌های روی صفحه همان چیزی است که روی سرور ذخیره شده است.");
      }
    }
    document.querySelectorAll(".da-task-actions .is-data-local, .da-task-actions .is-data-server")
      .forEach((btn) => {
        const same = open && String(btn.dataset.daViewData) === String(processViewerState.taskId);
        const btnLocal = btn.classList.contains("is-data-local");
        btn.classList.toggle("is-active", same && btnLocal === local);
      });
  }

  async function closeProcessViewer() {
    const modal = document.getElementById("da-portal-ds-viewer");
    if (modal) modal.hidden = true;
    stopProcessLocalTimer();
    for (const t of processViewerState.blinkTimers.values()) clearTimeout(t);
    processViewerState.blinkTimers.clear();
    processViewerState.source = null;
    processViewerState.cellRevisions = null;
    processViewerState.cellMeta = null;
    processViewerState.taskId = null;
    processViewerState.localMode = false;
    setProcessLocalNote(false);
    setProcessLiveStatus(false);
    paintProcessViewModeChip(false);
    if (processViewerState.connection) {
      try { await processViewerState.connection.stop(); } catch { /* ignore */ }
      processViewerState.connection = null;
    }
  }

  /**
   * Empty the open source's rows and keep its columns — the viewer's "clear data" button. Columns
   * survive because every node binding names one, so the process that reads this source keeps working.
   */
  async function clearProcessViewerData() {
    const ds = processViewerState.source;
    const sourceId = Number(ds?.id);
    if (!ds || !Number.isFinite(sourceId) || sourceId <= 0) {
      notifyHome(t("sources.clearDataFail") || "پاک‌سازی داده انجام نشد.", "error");
      return;
    }
    // Clearing is a SERVER operation (it deletes rows for everyone), so on the browser copy it
    // clears the LOCAL rows — the run then starts from an empty grid — and leaves the server alone.
    if (processViewerState.localMode) {
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
      clearProcessLocalData();
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
      processViewerState.cellRevisions = {};
      processViewerState.cellMeta = {};
      renderProcessViewerTable(ds);
      notifyHome(t("sources.clearDataDone") || "داده‌های منبع پاک شد (ستون‌ها دست‌نخورده ماندند).", "success");
    } catch (e) {
      notifyHome(e.message || t("sources.clearDataFail") || "پاک‌سازی داده انجام نشد.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
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
      // In local mode the grid must describe the copy the run uses: the server rows are overlaid
      // with this browser's unsynced writes, and the result is cached back onto the process so the
      // next open (and the next run) has a local snapshot instead of an empty or stale one.
      if (processViewerState.localMode) {
        overlayLocalWrites(fresh, sourceId);
        cacheLocalSnapshot(processViewerState.taskId, sourceId, fresh);
        // …and into the per-source record, which is what every local view draws from now on.
        persistLocalSnapshot(fresh);
      }
      renderProcessViewerTable(fresh);
    } catch { /* keep the current grid */ }
  }

  /**
   * Apply this browser's unsynced writes for one source on top of a freshly read server copy.
   *
   * The run read and wrote these values locally; showing the bare server rows would display numbers
   * the run never saw, which is precisely what the banner warns about. Overlaying them keeps the
   * grid, the next local run and the pending-sync payload describing the same data.
   */
  function overlayLocalWrites(ds, sourceId) {
    if (!ds) return ds;
    const row = findTask(readTasks(), String(processViewerState.taskId ?? ""));
    const writes = (row?.locallyRunSources || []).filter((w) => Number(w?.dataSourceId) === Number(sourceId));
    if (!writes.length) return ds;
    ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
    writes.forEach((w) => {
      setProcessLocalCell(ds, Number(w.rowIndex) || 0, String(w.columnKey || ""), w.cellValue ?? "");
    });
    return ds;
  }

  /** Store a read copy on the process, so the local snapshot is available without a re-read. */
  function cacheLocalSnapshot(taskId, sourceId, content) {
    const tasks = readTasks();
    const idx = findTaskIndex(tasks, taskId);
    if (idx < 0) return;
    const task = tasks[idx];
    const graphs = [task.graph, task.canvasCache?.graph].filter(Boolean);
    if (!graphs.length) return;
    graphs.forEach((g) => {
      const snap = (g.dataSources || []).find((d) => Number(d.id) === Number(sourceId));
      if (!snap) return;
      snap.cells = content.cells;
      snap.columns = content.columns;
      snap.columnKeys = content.columnKeys;
      snap.rowCount = content.rowCount;
      snap.columnCount = content.columnCount ?? (content.columns || []).length;
    });
    tasks[idx] = { ...task };
    writeTasks(tasks, { silent: true });
  }  /** Record the editor stamp for one cell so a re-render shows the right tooltip. */
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

  /**
   * Save a cell edit into the BROWSER copy while the grid is showing a local-run source.
   *
   * Nothing goes to the server. A local run's results travel later, on demand, through the sync
   * button — writing here would make the change visible to everyone at once (the opposite of what
   * a local run is for) and would create a second copy of the same edit that no merge could undo.
   * The edit joins the pending writes with the value the cell held before it, which is exactly what
   * the sync's merge compares against.
   */
  function saveProcessCellLocally(rowIndex, columnKey, value) {
    const ds = processViewerState.source;
    const sourceId = Number(ds?.id);
    if (!ds || !Number.isFinite(sourceId) || sourceId <= 0) return false;
    const previous = (() => {
      const hit = (ds.cells || []).find((c) =>
        (c.key === columnKey || c.Key === columnKey)
        && Number(c.index ?? c.Index ?? c.rowIndex) === rowIndex);
      if (!hit) return null;
      return hit.cellValue ?? hit.CellValue ?? null;
    })();
    setProcessLocalCell(ds, rowIndex, columnKey, value);

    const tasks = readTasks();
    const idx = findTaskIndex(tasks, processViewerState.taskId);
    if (idx >= 0) {
      const task = tasks[idx];
      // Mirror into the cached graph so the next local run and this viewer both read the new value.
      [task.graph, task.canvasCache?.graph].filter(Boolean).forEach((g) => {
        const snap = (g.dataSources || []).find((d) => Number(d.id) === sourceId);
        if (snap) setProcessLocalCell(snap, rowIndex, columnKey, value);
      });
      const list = Array.isArray(task.locallyRunSources) ? task.locallyRunSources.slice() : [];
      const same = (c) => Number(c?.dataSourceId) === sourceId
        && Number(c?.rowIndex) === rowIndex
        && String(c?.columnKey) === String(columnKey);
      const hit = list.find(same);
      if (hit) {
        hit.cellValue = String(value ?? "");
      } else {
        list.push({
          dataSourceId: sourceId,
          rowIndex,
          columnKey: String(columnKey),
          cellValue: String(value ?? ""),
          baseValue: previous == null ? null : String(previous)
        });
      }
      tasks[idx] = { ...task, locallyRunSources: list, localRunPendingSync: true };
      writeTasks(tasks, { silent: true });
      // Also into the record every local view draws, so this edit survives a graph reload.
      persistLocalSnapshot(ds);
    }
    setProcessCellMeta(rowIndex, columnKey, null, currentUser(), new Date().toISOString());
    return true;
  }

  async function saveProcessCell(rowIndex, columnKey, value) {
    const sourceId = processViewerState.source?.id;
    if (!sourceId) return false;
    // Local mode: the write stays in this browser (see saveProcessCellLocally).
    if (processViewerState.localMode && saveProcessCellLocally(rowIndex, columnKey, value)) {
      notifyHome(t("sources.cellSavedLocal")
        || "در نسخهٔ محلی ذخیره شد؛ با «همگام‌سازی با سرور» به سرور منتقل می‌شود.", "success");
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

  function showProcessGridMenu(x, y, td, th) {
    const source = processViewerState.source;
    if (!source) return;
    const rowIndex = td ? Number(td.dataset.row) : null;
    const columnKey = td ? td.dataset.col : (th ? th.dataset.col : null);
    // A column's position comes from the header/cell index it was invoked on — never from the
    // row number, which is a different axis.
    const columnIndex = (th || td) ? (th ? th.cellIndex : td.cellIndex) - 1 : null;

    let items = [
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
      items = [
        { id: "col-rename", label: t("sources.renameColumn") || "تغییر نام ستون" },
        { sep: true },
        { id: "col-after", label: t("sources.addColAfter") || "افزودن ستون بعد از این" },
        { id: "col-before", label: t("sources.addColBefore") || "افزودن ستون قبل از این" },
        { id: "col-delete", label: t("sources.deleteColumn") || "حذف این ستون" },
        { sep: true },
        { id: "row-append", label: t("sources.addRowAppend") || "افزودن ردیف در پایان" }
      ];
    } else if (!td) {
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
      await runProcessGridAction(action, rowIndex, columnKey, columnIndex);
    });
  }

  function nextProcessColumnKey(existingKeys) {
    const used = new Set((existingKeys || []).map((k) => String(k).toLowerCase()));
    let n = used.size + 1;
    while (used.has(`c${n}`)) n++;
    return `c${n}`;
  }

  async function runProcessGridAction(action, rowIndex, columnKey, columnIndex) {
    const source = processViewerState.source;
    const sourceId = source?.id;
    if (!sourceId) return;
    // In local mode the grid is this browser's copy: every shape edit belongs to it and no request
    // may leave for the server (a local run must not change the shared source).
    if (processViewerState.localMode) {
      await runLocalProcessGridAction(action, rowIndex, columnKey, columnIndex);
      return;
    }
    if (action === "col-rename") {
      await renameProcessColumn(sourceId, columnKey);
      return;
    }
    if (action === "row-delete") {
      await deleteProcessRow(sourceId, rowIndex);
      return;
    }
    if (action === "col-delete") {
      await deleteProcessColumn(sourceId, columnKey);
      return;
    }
    const beforeIndexFor = (kind) => {
      // A column's position comes from the header/cell index the menu was opened on — never from
      // the row number (that ax-mixup is why "before this column" used to land at a row place).
      if (kind === "col" && columnIndex != null) {
        if (action === "col-before") return Math.max(0, columnIndex);
        if (action === "col-after") return columnIndex + 1;
      }
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

  /**
   * Rename one column of the source shown in the modal.
   *
   * The server applies the rename to the column, its cells AND every linked process whose nodes
   * bind to that column — so an edit here cannot leave a process reading a column that no longer
   * exists. The grid refreshes from the server afterwards so the header shows the new name.
   */
  async function renameProcessColumn(sourceId, oldKey) {
    if (!sourceId || !oldKey) return;
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
      const res = await fetch(`/api/datasources/${sourceId}/columns`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldKey, newName })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.renameColumnFail") || "تغییر نام ستون ناموفق بود.");
      const affected = Number(body.affectedProcessCount ?? body.AffectedProcessCount ?? 0);
      notifyHome(
        affected > 0
          ? (t("sources.colRenamedAffected", { key: newName, count: affected }) || `ستون به «${newName}» تغییر نام یافت و در ${affected} فرآیند اعمال شد.`)
          : (t("sources.colRenamed", { key: newName }) || `ستون به «${newName}» تغییر نام یافت.`),
        "success"
      );
      await refreshProcessViewer();
    } catch (e) {
      notifyHome(e.message || t("sources.renameColumnFail") || "تغییر نام ستون ناموفق بود.", "error");
    }
  }

  /**
   * Context menu — delete one row from the modal's source, after a confirmation.
   *
   * A row is not addressable afterwards (the one below it takes its place), so this is asked
   * explicitly rather than being a one-click action.
   */
  async function deleteProcessRow(sourceId, rowIndex) {
    if (!sourceId || !Number.isFinite(rowIndex)) return;
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
      const res = await fetch(`/api/datasources/${sourceId}/rows/${rowIndex}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.deleteRowFail") || "حذف ردیف ناموفق بود.");
      notifyHome(t("sources.rowDeleted") || "ردیف حذف شد.", "success");
      await refreshProcessViewer();
    } catch (e) {
      notifyHome(e.message || "حذف ردیف ناموفق بود.", "error");
    }
  }

  /**
   * Context menu — delete one column (with its cells), after a confirmation.
   *
   * The server keeps node bindings intact on purpose and reports how many linked processes used
   * the column; the toast carries that count so the author knows where to re-pick a column.
   */
  async function deleteProcessColumn(sourceId, columnKey) {
    if (!sourceId || !columnKey) return;
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
      const res = await fetch(`/api/datasources/${sourceId}/columns/${encodeURIComponent(columnKey)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || t("sources.deleteColumnFail") || "حذف ستون ناموفق بود.");
      const key = body.deletedColumnKey || body.DeletedColumnKey || columnKey;
      const affected = Number(body.affectedProcessCount ?? body.AffectedProcessCount ?? 0);
      notifyHome(
        affected > 0
          ? (t("sources.colDeletedAffected", { key, count: affected }) || `ستون «${key}» حذف شد — ${affected} فرآیند به این ستون وابسته بود؛ در ویرایشگر اصلاح کنید.`)
          : (t("sources.colDeleted", { key }) || `ستون «${key}» حذف شد.`),
        affected > 0 ? "warn" : "success"
      );
      await refreshProcessViewer();
    } catch (e) {
      notifyHome(e.message || "حذف ستون ناموفق بود.", "error");
    }
  }

  async function viewProcessData(taskId, btn, mode) {
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    try {
      const hit = await loadProcessDataSource(taskId);
      if (!hit?.ds) {
        notifyHome(t("tasks.noDataSource"), "warn");
        return;
      }
      processViewerState.taskId = taskId;
      // A public/shared source stays server-backed even for a local run, so only a private source of
      // a locally-run process is shown from the browser's copy.
      //
      // WHICH copy is opened is the operator's choice when the two differ: the row then offers one
      // button per copy (`data-mode`). With no explicit mode the switch decides, as before.
      const ctx = processLocalContext(taskId);
      const isPublicSource = hit.ds.isPublic === true || hit.ds.IsPublic === true;
      const wantLocal = mode === "local" ? true : mode === "server" ? false : ctx.local;
      let localMode = !isPublicSource && wantLocal;
      let snapshot = localMode ? localProcessSnapshot(taskId, hit.ds.id) : null;
      // No copy in this browser means there is no local view to show. Saying so and drawing the
      // server's rows is the honest answer; drawing server rows under a "local copy" banner is what
      // made the same button look like it sometimes showed one thing and sometimes the other.
      if (localMode && !snapshot) {
        localMode = false;
        notifyHome(t("sources.localCopyMissing")
          || "نسخهٔ محلی این منبع روی این سیستم نیست؛ ردیف‌های نمایش‌داده‌شده از سرور خوانده می‌شوند.", "warn");
      }
      processViewerState.localMode = localMode;
      paintProcessViewModeChip(localMode);
      // The banner still appears for a server-run process holding unsynced local results: the grid
      // below is the server's, but the user should know a local copy is waiting to be settled.
      setProcessLocalNote(!isPublicSource && localMode);
      // The stored copy already holds the run's writes; re-applying the pending log costs nothing and
      // rescues a record written before a write landed (or by an older extension build).
      if (localMode && snapshot) overlayLocalWrites(snapshot, hit.ds.id);
      renderProcessViewerTable(snapshot || hit.ds);
      const modal = document.getElementById("da-portal-ds-viewer");
      if (modal) modal.hidden = false;
      else { notifyHome("نمایشگر داده در این صفحه نیست.", "error"); return; }
      if (localMode) {
        // A local snapshot exists only after this browser loaded the source once (the run does that
        // itself). Without one, the grid would be a summary with no cell values — empty rows — so the
        // rows are read ONCE, overlaid with the unsynced local writes, and cached back onto the
        // process for next time. Reading is not a data change; nothing is written to the server.
        if (!snapshot) await refreshProcessViewer();
        // The rows come from the run's own copy, so the play hub cannot update them: joining it
        // would let the server patch a grid it does not own. Local cell events arrive through the
        // extension's window event, and a slow repaint from the browser copy covers anything a
        // missed event would leave behind — local data only, no requests.
        setProcessLiveStatus(false, t("sources.localLive") || "● محلی — بدون به‌روزرسانی زنده");
        startProcessLocalTimer();
        return;
      }
      // The list/canvas snapshot is a summary without cell VALUES, so pull the real rows (and the
      // per-cell revisions the inline editor needs) before anyone tries to edit.
      await refreshProcessViewer();
      // Live overlay: join this process's play group so the cell reads/writes the engine makes
      // while it runs flash right here, exactly like the sources-page viewer does.
      setProcessLiveStatus(false, "● اتصال…");
      await ensureProcessViewerHub(taskId);
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
      // EXCEPT in local mode: the run used the browser copy, so that copy is what is exported (and
      // no server request may be made for a local run).
      let ds = hit.ds;
      const sourceId = Number(ds.id);
      if (processViewerState.localMode && processViewerState.source) {
        ds = overlayLocalWrites(deepClone(processViewerState.source), sourceId) || ds;
      } else if (Number.isFinite(sourceId) && sourceId > 0) {
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
    // The search box filters the cards too: on a phone the cards ARE the list, so leaving them
    // unfiltered would make the box look broken.
    const visible = filterTasksBySearch(normalized);
    if (!visible.length) {
      cards.innerHTML = `<div class="da-task-empty text-muted">${escapeHtml(t("panel.searchNoMatch"))}</div>`;
      return;
    }
    cards.innerHTML = visible.map((row) => {
      const { steps, groups, sources } = taskCounts(row);
      return `<article class="da-task-card">
        <div class="da-task-card-top">
          <h3 class="da-task-card-title">${escapeHtml(row.title)}</h3>
          <span class="da-task-id" title="${escapeHtml(t("tasks.processId"))}">${escapeHtml(String(row.id))}</span>
        </div>
        <ul class="da-task-card-meta">
          <li><i class="ti ti-clock"></i><span>${formatLastRun(row)}</span></li>
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

  /**
   * Current search text. Held here rather than read from the input on each render, so a re-render
   * triggered from elsewhere (a live update, a delete) keeps the user's filter instead of dropping
   * them back to the full list.
   */
  let taskSearchQuery = "";

  /** Case- and diacritic-insensitive fold, so "TEst" matches "test" and Persian variants match. */
  function foldForSearch(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u200c\u200f\u200e]/g, "")   // ZWNJ / directional marks are invisible, not content
      .replace(/[\u064a\u06cc]/g, "\u06cc")   // Arabic yeh vs Persian yeh
      .replace(/[\u0643\u06a9]/g, "\u06a9")   // Arabic kaf vs Persian kaf
      .replace(/\u0623|\u0625|\u0622/g, "\u0627")
      .replace(/\u0629/g, "\u0647")
      .trim();
  }

  /** Rows whose title matches the current query. An empty query matches everything. */
  function filterTasksBySearch(list) {
    const q = foldForSearch(taskSearchQuery);
    if (!q) return list;
    return list.filter((row) => foldForSearch(row.title).includes(q));
  }

  /**
   * Apply the search box: filter the list, update the count, and prune the table.
   *
   * Re-rendering the whole table on every keystroke would rebuild every row and lose the input's
   * focus on some browsers; instead the rows are toggled with the `hidden` attribute, which the
   * existing markup already supports because each row carries its task id.
   */
  function applyTaskSearch() {
    const input = document.getElementById("da-task-search");
    const clearBtn = document.getElementById("da-task-search-clear");
    taskSearchQuery = input ? input.value : "";
    if (clearBtn) clearBtn.hidden = !taskSearchQuery;
    render();
  }

  /**
   * Show how many processes are left by the filter.
   *
   * Only shown while a query is active: an always-visible "3 of 3" is noise, and the point of the
   * line is to explain a list that looks shorter than the user expects.
   */
  function updateSearchCount(total, shown) {
    const el = document.getElementById("da-task-search-count");
    if (!el) return;
    if (!foldForSearch(taskSearchQuery)) {
      el.textContent = "";
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = t("panel.searchCount", { shown, total });
  }
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
            || Boolean(o.templateBehind) !== Boolean(n.templateBehind)
            // The mother flag drives the chip's badge and hides its detach button, so a row that
            // only gains/loses "source" status must still be re-rendered.
            || Boolean(o.isTemplateSource) !== Boolean(n.isTemplateSource)
            // Client-local run mode. It has no server column, so nothing else in this comparison
            // notices when it changes; omitting it meant the local write was skipped and the next
            // render rebuilt the row from the API with the default (ON) — the switch that "would
            // not turn off".
            || Boolean(o.runOnServer) !== Boolean(n.runOnServer)
            || Boolean(o.localRunPendingSync) !== Boolean(n.localRunPendingSync);
        });
      // Silent write: avoid writeTasks → da-local-tasks → render → writeTasks loop.
      if (changed) writeTasks(toStore, { silent: true });

      if (body) {
        try {
          const visible = filterTasksBySearch(toStore);
          updateSearchCount(toStore.length, visible.length);
          if (!toStore.length) {
            body.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-6">${t("tasks.empty")}</td></tr>`;
          } else if (!visible.length) {
            // Distinct from "no processes at all": the list is not empty, the filter is just narrow.
            body.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-6">${escapeHtml(t("panel.searchNoMatch"))}</td></tr>`;
          } else {
            body.innerHTML = visible.map((row) => {
              const { steps, groups, sources } = taskCounts(row);
              const tid = escapeHtml(String(row.id));
              /**
               * Template cell. Two different relationships share this column:
               *   - a CHILD has a templateId and shows the template it was built from, plus a
               *     detach button (detaching is the child's own decision);
               *   - the MOTHER has no templateId — it IS the source — so it shows a distinct
               *     "mother" chip without a detach button, because it is not attached to anything.
               * Showing a dash for the mother would hide the one row an author has to edit.
               */
              const tplCell = row.templateId
                ? `<span class="da-tpl-wrap">
                     <a href="#" class="da-tpl-chip${row.templateBehind ? " is-behind" : ""}"
                        data-tpl-id="${escapeHtml(String(row.templateId))}"
                        data-task-id="${tid}"
                        data-task-title="${escapeHtml(row.title || "")}"
                        title="${escapeHtml([
                          row.templateBehind ? t("tasks.templateBehind") : t("tasks.templateCurrent"),
                          row.sourceProcessTitle
                            ? t("tasks.templateMotherLine", { name: row.sourceProcessTitle })
                            : t("tasks.templateNoMother")
                        ].join("\n"))}">
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
                : (row.isTemplateSource
                  ? `<span class="da-tpl-chip is-source" title="${escapeHtml(t("tasks.templateIsSource"))}">
                       <i class="ti ti-copy" aria-hidden="true"></i>
                       <span>${escapeHtml(t("tasks.templateSourceLabel"))}</span>
                       <span class="da-tpl-src-badge">★</span>
                     </span>`
                  : `<span class="text-muted">—</span>`);
              return `<tr data-task-id="${tid}">
        <td>
          <div class="fw-semibold" data-flash="title">${escapeHtml(row.title)}</div>
          <span class="da-task-id" title="${escapeHtml(t("tasks.serverKey"))}">${tid}</span>
        </td>
        <td class="text-nowrap" data-flash="template">${tplCell}</td>
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
          body.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-6">${escapeHtml(String(err && err.message || err))}</td></tr>`;
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

  async function createLocalTask(titleRaw, templateId) {
    const title = (titleRaw || "").trim() || t("tasks.newProcess");

    if (isServerMode()) {
      try {
        /**
         * Starting from a template is a different endpoint on purpose. The plain create writes an
         * empty graph and then PUTs it, which would leave a child with no structure at all; the
         * template path copies the mother's graph, records the attachment and stamps the version,
         * all server-side, so the derived process is correct from its first load.
         */
        if (templateId) {
          const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}/create-process`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            notifyHome(data.message || t("plan.limitTasks", { max: "?" }), "warning");
            return;
          }
          notifyHome(t("panel.templateCreated") || t("tasks.added", { title }), "success");
          if (window.DaTelemetry) DaTelemetry.audit("TaskCreateFromTemplate", `Created task ${data.id}: ${title}`);
          const newId = data && data.id != null ? data.id : null;
          if (newId != null) location.href = `/Panel/Tasks/Editor/${newId}`;
          else window.location.reload();
          return;
        }

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
      // Template fields, same whitelist rule as the run fields above: the server sends them, but
      // omitting them here meant the template chip never rendered and a child offered the record
      // button. `isTemplateSource` is what separates the mother from its children.
      templateId: row.templateId ?? null,
      templateTitle: row.templateTitle || "",
      templateBehind: !!row.templateBehind,
      isTemplateSource: !!row.isTemplateSource,
      // The mother process itself, for a child: its name and id, so the list can say which process
      // to edit instead of only naming the template.
      sourceProcessId: row.sourceProcessId ?? null,
      sourceProcessTitle: row.sourceProcessTitle || "",
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

  /** Merge API list into cache: drop removed server ids, refresh metadata. */
  async function syncServerListToLocalCache(serverRows) {
    const rows = serverRows || [];
    const serverIds = new Set(rows.map((r) => String(r.id)));
    let tasks = readTasks().filter((t) => !isServerBackedTaskId(t.id) || serverIds.has(String(t.id)));
    const prevById = new Map(tasks.map((t) => [String(t.id), t]));
    const mergedMeta = mergeServerTasksWithLocal(rows);

    for (const row of mergedMeta) {
      const id = String(row.id);
      const prev = prevById.get(id);
      const next = { ...(prev || {}), ...row };
      if (isServerBackedTaskId(id)) delete next.graph;
      prevById.set(id, next);
      // No canvas is fetched here on purpose. A list refresh happens whenever ANY process changes,
      // and pulling every edited process's canvas for a page that is merely being looked at was
      // traffic with no reader: the run start is where the canvas is needed, and it decides there
      // whether the cached copy is still the server's revision (see ensureTaskGraphCached).
    }

    const out = [...prevById.values()];
    writeTasks(out, { silent: true });
    return out;
  }

  /** List API has no canvas body — metadata only; canvas lives on server and in the local canvas cache. */
  function mergeServerTasksWithLocal(serverRows) {
    // runOnServer (and the pending-sync flag) are CLIENT-LOCAL: the server has no such column and
    // never sends them. Rebuilding each row from the API response alone therefore dropped them and
    // normalizeTask's default (runOnServer !== false ⇒ true) put the switch back ON — which is
    // exactly the bug where turning the switch off showed "از این پس روی سیستم خودتان" and then the
    // switch snapped back on. Carry the local values across the merge by id.
    const localById = new Map(readTasks().map((t) => [String(t.id), t]));
    return (serverRows || []).map((row) => {
      const prev = localById.get(String(row.id));
      const next = normalizeTask({
        ...row,
        runOnServer: prev ? prev.runOnServer : row.runOnServer,
        localRunPendingSync: prev ? prev.localRunPendingSync : row.localRunPendingSync,
        // The per-source browser copies are client-local too — and they are the LOCAL data entity
        // (one per source). Rebuilt from the API row they would be dropped on every list refresh,
        // i.e. every few seconds, which is how local results used to vanish.
        localSourceCopies: prev ? prev.localSourceCopies : row.localSourceCopies,
        // The cached canvas is client-local state as well, and it is what makes "an unchanged
        // process costs no traffic" possible. Rebuilt from the API row it would be dropped on every
        // list refresh — i.e. exactly when the next start would want it.
        canvasCache: prev ? prev.canvasCache : null
      });
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

  /**
   * The cached canvas of a server-backed process, together with the server revision it came from.
   *
   * Kept on the task row so "is my copy still the server's?" is answered from data the list already
   * carries. The whole point of the cache is that a process nobody edited does not have to be read
   * again before a run: reading it would be traffic spent to learn nothing.
   */
  function canvasCacheOf(task) {
    const cache = task?.canvasCache;
    return cache && cache.graph && Array.isArray(cache.graph.nodes) && cache.graph.nodes.length
      ? cache
      : null;
  }

  /**
   * A server timestamp as a number, for comparison.
   *
   * The two endpoints carrying the same stamp do not format it alike: the list serialises the stored
   * value as-is, while the canvas marks it UTC with a trailing "Z". Comparing the strings would never
   * match; reading a zone-less stamp as LOCAL time would be off by the machine's offset. A missing
   * zone is therefore read as UTC, which is what the database holds.
   */
  function stampValue(raw) {
    const s = String(raw || "").trim();
    if (!s) return NaN;
    const iso = /(z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : NaN;
  }

  /**
   * True when the cached canvas is the revision the server is still serving.
   *
   * Both stamps must exist: a cache with no stamp (or a row whose stamp the list never gave us)
   * cannot be proven current, and an unprovable copy is refetched rather than guessed at.
   */
  function canvasCacheIsCurrent(task) {
    const cache = canvasCacheOf(task);
    const cached = stampValue(cache?.updatedAtUtc);
    const known = stampValue(task?.updatedAtUtc);
    return Number.isFinite(cached) && Number.isFinite(known) && cached === known;
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

    // Server-backed processes: the canvas comes from the server — but only when the process has
    // moved since we cached it. The list already told us when it last changed, so an unchanged
    // process is run from the cached copy and the start costs no traffic at all. A process that DID
    // change (or one we have never loaded) is read once, whole, and then cached against its stamp.
    if (/^\d+$/.test(id)) {
      if (canvasCacheIsCurrent(hit)) {
        hit.graph = canvasCacheOf(hit).graph;
        return hit;
      }
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
      // The stamp is the canvas's OWN revision, not the list row's: if the two disagree the canvas is
      // the newer of the two, and caching it against the row's older stamp would send the next start
      // to the server to fetch the very revision it already holds.
      hit.canvasCache = { updatedAtUtc: String(graph.updatedAtUtc || ""), graph };
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
  const templateWrap = document.getElementById("da-new-template-wrap");
  const templateSel = document.getElementById("da-new-template");

  /**
   * Fill the "start from a template" picker.
   *
   * Loaded when the dialog opens rather than at page load: a user who never creates a process makes
   * no request, and a template created in another tab shows up without a reload. The picker stays
   * hidden while there is nothing to choose from, so an empty select never appears.
   */
  async function loadTemplateOptions() {
    if (!templateSel || !templateWrap) return;
    try {
      const res = await fetch("/api/templates", { credentials: "same-origin" });
      if (!res.ok) return;
      const list = await res.json();
      const rows = Array.isArray(list) ? list : [];
      // Keep the first option (the "from scratch" default) and rebuild the rest.
      templateSel.length = 1;
      rows.forEach((tpl) => {
        const opt = document.createElement("option");
        opt.value = String(tpl.id);
        opt.textContent = tpl.attachedProcessCount
          ? `${tpl.title} (${tpl.stepCount || 0} · ${tpl.attachedProcessCount})`
          : `${tpl.title} (${tpl.stepCount || 0})`;
        templateSel.appendChild(opt);
      });
      templateWrap.hidden = rows.length === 0;
    } catch (err) {
      console.warn("[local-tasks] template options failed", err);
      if (templateWrap) templateWrap.hidden = true;
    }
  }

  createModalEl?.addEventListener("shown.bs.modal", () => {
    titleInp?.focus();
    titleInp?.select();
    loadTemplateOptions();
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
    const templateId = (templateSel?.value || "").trim();
    await createLocalTask(title, templateId || null);
    if (titleInp) titleInp.value = "";
    if (templateSel) templateSel.value = "";
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

  // The extension mirrors its cell events to the page as a window event, so a LOCAL run — whose
  // writes never reach the server and therefore never reach the play hub — still lights up the
  // open grid and moves its rows. This is the only live channel a local run has.
  window.addEventListener("da-ds-cell-event", (ev) => {
    if (!processViewerState.taskId) return;
    // A grid showing the SERVER's rows must never be patched by a local run's events: nothing was
    // written to the server, so "live" updates there were showing values the server never received.
    // The two views are independent — this channel belongs to the local one.
    if (!processViewerState.localMode) return;
    handleProcessCellEvent(ev.detail || {});
    // What the grid just showed must reach the per-source record, or the 2s repaint from that record
    // would revert it. Coalesced: a run emits an event per cell.
    if (processViewerState.source) queueProcessLocalPersist();
  });

  /** Write the open local grid back into its per-source record, once per quiet moment. */
  let processLocalPersistTimer = null;
  function queueProcessLocalPersist() {
    if (processLocalPersistTimer) return;
    processLocalPersistTimer = setTimeout(() => {
      processLocalPersistTimer = null;
      if (!processViewerState.localMode || !processViewerState.source) return;
      persistLocalSnapshot(processViewerState.source);
    }, 700);
  }

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
        /**
         * A disabled record button has two possible reasons and they need different answers.
         * Showing the upgrade prompt for a template child would be wrong — an upgrade would not
         * unlock it — so the row's own marker decides which message the user gets.
         */
        const rowId = recBtn.getAttribute("data-task-id");
        const row = rowId != null
          ? (readTasks() || []).find((x) => String(x.id) === String(rowId))
          : null;
        if (row && row.templateId && !row.isTemplateSource) {
          notifyHome(t("tasks.recordChildDisabled") || "ضبط روی فرآیند ساخته‌شده از قالب ممکن نیست.", "warn");
          return;
        }
        if (window.DaEntitlements) DaEntitlements.showUpgrade("record");
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.daHasRecorder === "function"
        ? !window.daHasRecorder()
        : (document.documentElement.dataset.daRecorderExtension !== "1"
          && document.documentElement.dataset.daExtension !== "1")) {
        return;
      }
      openRecordTargetMenu(recBtn);
      return;
    }

    // The single play button opens the target menu. The run TYPE is not a click-time question —
    // it is the row switch's standing state — so the menu only asks which tab to drive.
    const runBtn = ev.target instanceof Element
      ? ev.target.closest('[data-da-action="play-task-menu"]')
      : null;
    if (!runBtn) return;
    if (!document.getElementById("da-tasks-panel")) return;
    // NOTE: no `ev.preventDefault()` / `stopPropagation()` here, and no early return when the
    // extension is missing. The extension gate listens on `[data-da-action="play-task-menu"]` in the
    // CAPTURE phase and is what opens the "extension required" modal; swallowing the click would
    // leave the user with a button that silently does nothing. So this handler only acts when the
    // extension really is usable, and lets every other case fall through to the gate.
    const playerOn = typeof window.daHasPlayer === "function"
      ? window.daHasPlayer()
      : (document.documentElement.dataset.daPlayerExtension === "1"
        || document.documentElement.dataset.daExtension === "1"
        || document.documentElement.dataset.daRecorderExtension === "1");
    if (!playerOn) {
      return; // the gate's capture handler opens the modal
    }
    // A connected but OUTDATED bundle is not usable either: the gate shows its own modal naming the
    // required version, so fall through to it rather than starting a run that would fail.
    if (typeof window.daExtensionVersionStale === "function"
      && window.daExtensionVersionStale("player")) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    openPlayTargetMenu(runBtn);
  }, true);

  /**
   * Open the target menu behind the row's single play button.
   *
   * The run TYPE is not asked here: it is the row switch's state (a standing property of the
   * process). The menu only answers "where do I run it?" — a new blank tab, or one of the tabs
   * already open. A local run loads its data ONCE before the first step; that hydration lives here
   * because this is where a list run begins.
   */
  async function openPlayTargetMenu(anchor) {
    closePlayTargetMenu();
    const taskId = anchor.getAttribute("data-task-id");
    if (!taskId) return;

    const list = readTasks();
    const idx = findTaskIndex(list, taskId);
    const runOnServer = idx >= 0 ? list[idx].runOnServer !== false : true;
    if (runOnServer && !serverRunAllowedSync()) {
      notifyHome(t("tasks.runTypeServerOff")
        || "اجرای روی سرور توسط مدیر غیرفعال شده است؛ فقط اجرای محلی در دسترس است.", "warn");
      return;
    }

    const menu = document.createElement("div");
    menu.className = "da-play-target-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="da-play-target-loading">${escapeHtml(t("tasks.preparing") || "آماده‌سازی افزونهٔ اجرا…")}</div>`;
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
      setTasksBusy(true, t("tasks.preparing") || "آماده‌سازی افزونهٔ اجرا…");
      let cached = null;
      try {
        // The canvas is re-read only when the process has moved on the server: the list row's
        // `updatedAtUtc` is the stamp the cache was taken from, so an unchanged process starts from
        // the cached copy with no request at all. That is true for a local run too — "local" says
        // where the data lives, not that the diagram has to be fetched again.
        cached = await ensureTaskGraphCached(taskId);
        if (!cached?.graph?.nodes?.length) {
          throw new Error(t("tasks.graphNotCached") || "فرآیند در حافظهٔ محلی پیدا نشد. صفحه را رفرش کنید.");
        }
        const actionSteps = cached.graph.nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
        if (!actionSteps) {
          throw new Error(t("tasks.noActionSteps") || "مرحله‌ای برای اجرا نیست — در دیاگرام اقدام اضافه کنید.");
        }
      } catch (e) {
        setTasksBusy(false);
        notifyHome(String(e.message || e), "error");
        return;
      }
      if (!runOnServer) {
        setTasksBusy(true, t("tasks.localHydrateLoading") || "بررسی نسخهٔ منابع برای اجرای محلی…");
        const load = await hydrateLocalRunSources(cached)
          .catch(() => ({ failed: 0, loaded: 0, kept: 0, pending: 0 }));
        if (load.failed > 0) {
          notifyHome(t("tasks.localHydrateFail", { n: load.failed })
            || `بارگذاری محلی ${load.failed} منبع ناموفق بود؛ خواندن آن‌ها در زمان اجرا از سرور انجام می‌شود.`, "warn");
        }
        if (load.pending > 0) {
          // The load refreshed the server's rows, but this browser still holds results the server
          // has never seen. They were re-applied on top; say so, because the numbers on screen are
          // then a merge of two copies rather than a plain copy of the server.
          notifyHome(t("tasks.localHydratePending", { n: load.pending })
            || `${load.pending} تغییر محلی همگام‌نشده روی دادهٔ سرور اعمال شد؛ پس از پایان اجرا «همگام‌سازی با سرور» را بزنید.`, "info");
        }
        // Persist the hydrated copy: the extension reads the page store rather than this payload,
        // and it must see the same loaded-once snapshot.
        const store = readTasks();
        const i = findTaskIndex(store, taskId);
        if (i >= 0) {
          store[i] = { ...store[i], graph: cached.graph };
          writeTasks(store, { silent: true });
        }
      }
      window.dispatchEvent(new CustomEvent("da-play", {
        detail: {
          taskId,
          task: cached,
          graph: cached.graph,
          ...(scope || {}),
          runOnServer
        }
      }));
    };

    menu.innerHTML = `
      <div class="da-play-target-label">${escapeHtml(t("tasks.runTypeTitle") || "نوع اجرا")}: ${escapeHtml(runOnServer ? (t("tasks.runTypeServer") || "اجرا روی سرور") : (t("tasks.runTypeLocal") || "اجرای محلی"))}</div>
      <button type="button" class="da-play-target-item" data-open-new="1" role="menuitem">
        <span class="da-play-target-title">${escapeHtml(t("tasks.runTypeNewTab") || "تب جدید")}</span>
        <span class="da-play-target-sub">${escapeHtml(t("tasks.runTypeNewTabSub") || "صفحهٔ خالی در مرورگر")}</span>
      </button>
      <div class="da-play-target-sep"></div>
      <div class="da-play-target-loading">${escapeHtml(t("tasks.runTypeOpenTabs") || "تب‌های باز")}</div>
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
      listHost.textContent = t("tasks.runTypeNoTabs") || "تب باز http(s) پیدا نشد — صفحهٔ هدف را باز کنید";
      place();
      return;
    }
    const frag = document.createDocumentFragment();
    const label = document.createElement("div");
    label.className = "da-play-target-label";
    label.textContent = t("tasks.runTypePickTab") || "تب هدف";
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
      if (action === "data_updated") {
        // A linked source changed — cells, shape, file or title — so only the data side of this row
        // is fresh. The process itself was not edited: refreshing the row and blinking its data
        // columns says that, where "فرآیند به‌روز شد" claimed an edit that never happened (once per
        // cell the engine wrote during a run). No toast on purpose — the blink is the message.
        scheduleRender();
        setTimeout(() => flashTaskFields(id, ["dataEdit", "sources"]), 320);
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
      // If the open grid belongs to the source that just changed, repaint it from the server.
      // Without this the viewer kept whatever it loaded, so a cell another user edited stayed
      // wrong on screen until the user thought to hit refresh.
      const action = String(payload.action || payload.Action || "");
      const changedId = Number(payload.source?.id ?? payload.source?.Id ?? payload.source?.sourceId);
      // A structural change repaints even when the actor is us: the engine runs under the same
      // logged-in user, so the process's own InsertRow/DeleteRow looked like "our own write" and the
      // refresh was skipped — leaving the open grid on the old row numbering.
      const structural = action === "row_added" || action === "row_deleted" || action === "rows_cleared";
      if (processViewerState.source && Number(processViewerState.source.id) === changedId) {
        // Our own cell write already updated the grid optimistically; other actions need a pull.
        const actor = payload.actorUserName || payload.ActorUserName;
        const mine = actor && actor === (window.daCurrentUserName || null);
        if (!mine || structural) refreshProcessViewer();
      } else if (action === "cell_patched" && processViewerState.source) {
        refreshProcessViewer();
      }
    });
    DaCatalog.on("serverRunStateChanged", (payload) => {
      const enabled = payload?.serverRunEnabled !== false;
      serverRunFlag = { value: enabled, at: Date.now() };
      const stoppedIds = Array.isArray(payload?.stoppedTaskIds)
        ? payload.stoppedTaskIds.map(String)
        : [];
      if (!enabled) {
        forceLocalRunsWhenServerOff();
        const tasks = readTasks();
        const mineStopped = stoppedIds.some((id) => findTaskIndex(tasks, id) >= 0);
        notifyHome(mineStopped
          ? (t("tasks.serverRunStoppedNotice")
              || "اجرای روی سرور توسط مدیر غیرفعال شد؛ اجرای در حال اجرای شما متوقف شد.")
          : (t("tasks.serverRunDisabledNotice")
              || "اجرای روی سرور توسط مدیر غیرفعال شد؛ از این پس فقط اجرای محلی ممکن است."),
          "warn");
      } else {
        notifyHome(t("tasks.serverRunEnabledNotice")
          || "اجرای روی سرور دوباره فعال شد.", "success");
      }
      scheduleRender();
    });
  }

  // --- Process data viewer: modal controls + grid interactions -------------------------------
  // The processes page has its own lighter viewer (this file), separate from the sources page.
  (function wireProcessViewer() {
    const table = document.getElementById("da-portal-ds-table");
    if (!table) return;

    document.querySelectorAll("[data-portal-ds-close]").forEach((el) => {
      el.addEventListener("click", () => { closeProcessViewer(); });
    });
    document.getElementById("da-portal-ds-refresh")?.addEventListener("click", () => {
      if (!processViewerState.source) return;
      // In local mode "refresh" must not read the server values into the grid: the grid is this
      // browser's copy. It is repainted from that copy; only when no copy was ever loaded (an empty
      // grid) is the source read once — overlaid with the unsynced local writes — so it is never blank.
      if (processViewerState.localMode) {
        const snap = localProcessSnapshot(processViewerState.taskId, processViewerState.source.id);
        if (snap) {
          renderProcessViewerTable(snap);
          notifyHome(t("sources.localRefreshed") || "نمایش از نسخهٔ محلی به‌روز شد.", "info");
        } else {
          refreshProcessViewer();
        }
        return;
      }
      refreshProcessViewer();
    });
    document.getElementById("da-portal-ds-clear")?.addEventListener("click", () => {
      if (processViewerState.source) clearProcessViewerData();
    });
    // Excel export moved here from the process row: it exports the data being LOOKED AT, and in the
    // local view that is the browser's copy — a row button could not tell the two apart.
    document.getElementById("da-portal-ds-download")?.addEventListener("click", (ev) => {
      const btn = ev.currentTarget;
      if (processViewerState.taskId == null) return;
      downloadProcessExcel(processViewerState.taskId, btn);
    });

    table.addEventListener("dblclick", (e) => {
      // A column HEADER double-click renames the column; cells edit their own value instead.
      const th = e.target.closest("th[data-col]");
      if (th) {
        e.preventDefault();
        if (processViewerState.localMode) {
          runLocalProcessGridAction("col-rename", null, th.dataset.col, null);
          return;
        }
        renameProcessColumn(processViewerState.source?.id, th.dataset.col);
        return;
      }
      const td = e.target.closest("td[data-row][data-col]");
      if (!td) return;
      e.preventDefault();
      beginProcessCellEdit(td);
    });
    table.addEventListener("contextmenu", (e) => {
      const modal = document.getElementById("da-portal-ds-viewer");
      if (!modal || modal.hidden) return;
      e.preventDefault();
      showProcessGridMenu(
        e.clientX, e.clientY,
        e.target.closest("td[data-row][data-col]"),
        e.target.closest("th[data-col]")
      );
    });

    document.addEventListener("keydown", (e) => {
      const modal = document.getElementById("da-portal-ds-viewer");
      if (!modal || modal.hidden) return;
      // Escape belongs to the cell editor while a cell is open.
      if (e.key === "Escape" && !processViewerState.editing) closeProcessViewer();
    });
  })();

  scheduleRender();
  document.addEventListener("da:locale", () => scheduleRender());
  window.addEventListener("da-task-list-sync", () => scheduleRender());
  // A local run finishes in the extension, which writes the pending-sync flag into the task record.
  // The page cannot be told while it is hidden, so re-reading when it comes back to the foreground
  // is what makes the Sync button appear without the user having to reload.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // The master switch may have changed while the page was hidden (or the hub was down).
    fetchServerRunEnabled({ force: true }).then(() => {
      forceLocalRunsWhenServerOff();
      scheduleRender();
    }).catch(() => scheduleRender());
  });
  if (window.DaEntitlements?.fetch) {
    DaEntitlements.fetch().then(() => scheduleRender()).catch(() => {});
  }
  // The server-run master switch decides whether the server run button is usable, so ask once up
  // front and re-render when the answer arrives — otherwise the first paint assumes it is allowed.
  fetchServerRunEnabled({ force: true }).then(() => {
    forceLocalRunsWhenServerOff();
    scheduleRender();
  }).catch(() => {});
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));

  // Search box: filter as the user types. The page only renders the input on the processes view,
  // so this is a no-op elsewhere.
  (function bindTaskSearch() {
    const input = document.getElementById("da-task-search");
    if (!input) return;
    const clearBtn = document.getElementById("da-task-search-clear");
    let debounce = null;
    // Debounced so a fast typist re-renders once at the end of a burst, not per character.
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(applyTaskSearch, 120);
    });
    // Enter should not submit anything; the list is already filtered.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(debounce); applyTaskSearch(); }
      if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; applyTaskSearch(); input.focus(); }
    });
    clearBtn?.addEventListener("click", () => {
      input.value = "";
      clearTimeout(debounce);
      applyTaskSearch();
      input.focus();
    });
    // A bfcache restore / back navigation can bring a typed value back without an input event.
    if (input.value) applyTaskSearch();
  })();
})();
