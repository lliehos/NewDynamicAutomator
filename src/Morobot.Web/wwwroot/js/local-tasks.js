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

  function writeTasks(tasks) {
    if (window.DaSecureStore) {
      DaSecureStore.writeTasks(tasks);
      return;
    }
    localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    localStorage.setItem("da_local_user", currentUser());
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
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
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;
  const ICO_VIEW = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c5.2 0 9.3 3.4 10.7 7-1.4 3.6-5.5 7-10.7 7S2.7 15.6 1.3 12C2.7 8.4 6.8 5 12 5zm0 2.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm0 2A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5z"/></svg>`;
  const ICO_XLSX = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm1 7V3.5L19.5 9H15zM8.2 18l2.3-3.2L8.3 12h1.7l1.4 2.1L12.8 12H14.4l-2.2 2.8L14.5 18h-1.7l-1.5-2.2L9.9 18H8.2z"/></svg>`;

  function iconBtn(cls, title, iconHtml, extra = "") {
    return `<button type="button" class="ds-icon-btn ${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${extra}>${iconHtml}</button>`;
  }

  function iconLink(cls, title, href, iconHtml) {
    return `<a class="ds-icon-btn ${cls}" href="${href}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${iconHtml}</a>`;
  }
  function taskCounts(t) {
    const steps = t.graph?.nodes?.filter((n) => n.kind === "action" || n.kind === "step").length || t.stepCount || 0;
    const groups = t.graph?.nodes?.filter((n) => n.kind === "group").length || t.groupCount || 0;
    return { steps, groups, sources: dataSourceCount(t) };
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

  function actionButtonsHtml(task) {
    const tid = escapeHtml(String(task.id));
    const ttitle = escapeHtml(String(task.title || "").trim());
    const counts = taskCounts(task);
    const isEmpty = !counts.steps;
    const hasData = counts.sources > 0;
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
      ${iconBtn("is-rec", t("tasks.record"), ICO_REC, `data-da-action="start-record" data-task-id="${tid}" data-task-title="${ttitle}"`)}
      ${smartBtn}
      ${dataBtns}
      ${iconBtn("", t("tasks.clone"), ICO_CLONE, `data-da-clone="${tid}"`)}
      ${iconBtn("", t("tasks.downloadMrbt"), ICO_DL, `data-da-download="${tid}"`)}
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
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-da-clone");
        const task = findTask(readTasks(), id);
        cloneTask(task);
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
  }

  function dataSourceSafeFileName(ds) {
    const raw = (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || ds?.title
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
      subEl.textContent = `${colKeys.length} ستون · ${rows.length} ردیف${ds.fileName ? ` · ${ds.fileName}` : ""}`;
    }
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    if (!thead || !tbody) return;
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">${escapeHtml(t("tasks.noDataSource") === t("tasks.noDataSource") ? "ردیفی نیست" : "ردیفی نیست")}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) =>
      `<tr><th class="ds-row-idx">${i + 1}</th>${r.map((v, ci) =>
        `<td data-row="${i}" data-col="${escapeHtml(colKeys[ci])}">${escapeHtml(v)}</td>`
      ).join("")}</tr>`
    ).join("");
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
      else notifyHome("نمایشگر داده در این صفحه نیست.", "error");
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
      const ds = hit.ds;
      const table = dataSourceTableRows(ds);
      if (!table.colKeys.length) {
        notifyHome(t("tasks.noDataSource"), "warn");
        return;
      }
      const payload = {
        title: dataSourceSafeFileName(ds),
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
      downloadBlobFile(await res.blob(), `${dataSourceSafeFileName(ds)}.xlsx`);
      notifyHome(t("tasks.downloaded", { title: dataSourceSafeFileName(ds) + ".xlsx" }), "success");
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
      // Persist migrated ids / ownerUser without re-entering render via da-local-tasks.
      const changed = normalized.some((n, i) => {
        const o = raw[i];
        return !o || String(o.id) !== String(n.id) || String(o.ownerUser || "") !== String(n.ownerUser || "");
      });
      if (changed) {
        if (window.DaSecureStore) {
          const u = currentUser();
          // write without event: update cache + persist only
          DaSecureStore.writeTasks(normalized, u);
        } else {
          localStorage.setItem(tasksKey(), JSON.stringify(normalized));
        }
      }

      if (body) {
        try {
          if (!normalized.length) {
            body.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-6">${t("tasks.empty")}</td></tr>`;
          } else {
            body.innerHTML = normalized.map((row) => {
              const { steps, groups, sources } = taskCounts(row);
              const tid = escapeHtml(String(row.id));
              return `<tr data-task-id="${tid}">
        <td>
          <div class="fw-semibold" data-flash="title">${escapeHtml(row.title)}</div>
          <span class="da-task-id" title="${escapeHtml(t("tasks.serverKey"))}">${tid}</span>
        </td>
        <td class="text-nowrap">${escapeHtml(formatCreatedAt(row.createdAt))}</td>
        <td>${escapeHtml(row.createdBy)}</td>
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
          body.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-6">${escapeHtml(String(err && err.message || err))}</td></tr>`;
        }
      }

      try {
        renderCards(normalized);
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
    const detail = ev.detail;
    if (detail && detail.tasks && detail.user && detail.user !== currentUser()) return;
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
    const btn = ev.target instanceof Element
      ? ev.target.closest('[data-da-action="play-task-menu"]')
      : null;
    if (!btn) return;
    if (!document.getElementById("da-tasks-panel")) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (document.documentElement.dataset.daPlayerExtension !== "1"
      && document.documentElement.dataset.daExtension !== "1") {
      return; // gate modal will open instead
    }
    openPlayTargetMenu(btn);
  }, true);

  let playMenuEl = null;
  let playMenuCloser = null;

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

    const startPlay = (scope) => {
      closePlayTargetMenu();
      setTasksBusy(true, "آماده‌سازی افزونهٔ اجرا…");
      window.dispatchEvent(new CustomEvent("da-play", {
        detail: { taskId, ...(scope || {}) }
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
      // Keep error visible on the process list briefly, then clear.
      setTasksBusy(true, msg, { kind: "error" });
      notifyHome(msg, "error");
      busyErrorTimer = setTimeout(() => setTasksBusy(false), 2800);
      return;
    }
    if (d.phase === "started") {
      // Success → clear overlay; Player switches to the play tab.
      setTasksBusy(false);
      return;
    }
    if (d.phase === "done") {
      setTasksBusy(false);
    }
  });

  function scheduleRender() {
    const run = async () => {
      if (isServerMode()) {
        try {
          const rows = await loadServerTasks();
          render(rows);
          return;
        } catch (e) {
          console.warn(e);
          notifyHome(String(e.message || e), "error");
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
        if (!prev || prev.title !== (task.title || task.Title)) fields.push("title");
        if (!prev || Number(prev.stepCount) !== Number(task.stepCount ?? task.StepCount)) fields.push("steps");
        if (!prev || Number(prev.groupCount) !== Number(task.groupCount ?? task.GroupCount)) fields.push("groups");
        if (!prev || Number(prev.dataSourceCount ?? prev.sources) !== Number(task.dataSourceCount ?? task.DataSourceCount)) {
          fields.push("sources");
        }
        if (action === "shared" || Number(prev?.sharedWithCount) !== Number(task.sharedWithCount ?? task.SharedWithCount)) {
          fields.push("shared");
        }
        if (!fields.length) fields.push("steps");
        flashTaskFields(id, fields);
        if (window.daNotify && payload.actorUserName) {
          const key = action === "shared" ? "live.taskShared" : "live.taskUpdated";
          daNotify((t(key) || (action === "shared" ? "اشتراک فرآیند تغییر کرد" : "فرآیند به‌روز شد")) + who, "info");
        }
      }, 280);
    });
  }

  scheduleRender();
  document.addEventListener("da:locale", () => scheduleRender());
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
})();
