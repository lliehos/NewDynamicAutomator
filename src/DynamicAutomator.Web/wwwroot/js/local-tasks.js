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
      window.daNotify(String(message), type || "info");
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

  function sharedUsersLabel(users) {
    const list = Array.isArray(users) ? users.map((u) => String(u || "").trim()).filter(Boolean) : [];
    return list.length ? list.join(dateLocale().startsWith("fa") ? "، " : ", ") : "—";
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
  const ICO_EDIT = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5zm16.7-11.2a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5 1.6-1.6z"/></svg>`;
  const ICO_SHARE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18 16.1a2.9 2.9 0 0 0-2.3 1.1l-6.4-3.3a2.9 2.9 0 0 0 0-1.8l6.4-3.3A2.9 2.9 0 1 0 15 6a2.9 2.9 0 0 0 .1.7L8.7 10a2.9 2.9 0 1 0 0 4l6.4 3.3a2.9 2.9 0 1 0 2.9-1.2z"/></svg>`;
  const ICO_DL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3v10.2l3.4-3.4 1.4 1.4L12 17l-4.8-5.8 1.4-1.4L11 13.2V3h1zM5 19h14v2H5v-2z"/></svg>`;
  const ICO_UP = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 21V10.8l3.4 3.4 1.4-1.4L12 7l-4.8 5.8 1.4 1.4L11 10.8V21h1zM5 3h14v2H5V3z"/></svg>`;
  const ICO_CLONE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 7h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm-3 3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1H8a3 3 0 0 0-3 3v7z"/></svg>`;
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;

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
    return `
      ${iconLink("is-edit", t("tasks.edit"), `/Panel/Tasks/Editor/${encodeURIComponent(task.id)}`, ICO_EDIT)}
      ${iconBtn("is-play", t("tasks.play"), ICO_PLAY, `data-da-action="play-task" data-task-id="${tid}"`)}
      ${iconBtn("is-rec", t("tasks.record"), ICO_REC, `data-da-action="start-record" data-task-id="${tid}"`)}
      ${iconBtn("", t("tasks.clone"), ICO_CLONE, `data-da-clone="${tid}"`)}
      ${iconBtn("", t("tasks.downloadMrbt"), ICO_DL, `data-da-download="${tid}"`)}
      <label class="ds-icon-btn da-import-btn" title="${t("tasks.importMrbt")}" aria-label="${t("tasks.importMrbt")}">
        ${ICO_UP}
        <input type="file" accept=".mrbt,application/octet-stream,application/json,.json" data-da-import="${tid}" hidden />
      </label>
      ${iconBtn("", t("tasks.share"), ICO_SHARE, `data-da-share="${tid}"`)}
      ${iconBtn("is-danger", t("tasks.delete"), ICO_DEL, `data-da-del="${tid}"`)}`;
  }

  function bindTaskActions(root) {
    root?.querySelectorAll("[data-da-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-da-del");
        if (!confirm("این فرآیند حذف شود؟")) return;
        const next = readTasks().filter((x) => !taskIdEq(x.id, id));
        writeTasks(next);
        render(next);
        notifyHome("فرآیند حذف شد.", "info");
      });
    });
    root?.querySelectorAll("[data-da-share]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-da-share");
        const task = findTask(readTasks(), id);
        notifyHome(
          task
            ? `اشتراک‌گذاری «${task.title}» به‌زودی فعال می‌شود.`
            : "اشتراک‌گذاری به‌زودی فعال می‌شود.",
          "info"
        );
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
          <li><i class="ti ti-users"></i><span>${escapeHtml(sharedUsersLabel(row.sharedUsers))}</span></li>
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
  function render(tasks) {
    if (rendering) return;
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
              return `<tr>
        <td>
          <div class="fw-semibold">${escapeHtml(row.title)}</div>
          <span class="da-task-id" title="${escapeHtml(t("tasks.serverKey"))}">${escapeHtml(String(row.id))}</span>
        </td>
        <td class="text-nowrap">${escapeHtml(formatCreatedAt(row.createdAt))}</td>
        <td>${escapeHtml(row.createdBy)}</td>
        <td>${escapeHtml(sharedUsersLabel(row.sharedUsers))}</td>
        <td>${groups}</td>
        <td>${steps}</td>
        <td>${sources}</td>
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

  function createLocalTask(titleRaw) {
    const title = (titleRaw || "").trim() || t("tasks.newProcess");
    const tasks = readTasks();
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

  document.getElementById("da-create-local")?.addEventListener("click", () => {
    const title = (titleInp?.value || "").trim();
    if (!title) {
      titleInp?.focus();
      return;
    }
    createLocalTask(title);
    if (titleInp) titleInp.value = "";
    window.bootstrap?.Modal?.getInstance(createModalEl)?.hide();
  });

  window.addEventListener("da-local-tasks", (ev) => {
    const detail = ev.detail;
    if (detail && detail.tasks && detail.user && detail.user !== currentUser()) return;
    render((detail && detail.tasks) || readTasks());
  });

  let busyTimer = null;
  function setTasksBusy(on, text) {
    const panel = document.getElementById("da-tasks-panel");
    const busy = document.getElementById("da-tasks-busy");
    const textEl = busy?.querySelector(".da-tasks-busy-text");
    if (textEl && text) textEl.textContent = text;
    if (busy) busy.hidden = !on;
    if (panel) panel.classList.toggle("is-busy", !!on);
    if (busyTimer) {
      clearTimeout(busyTimer);
      busyTimer = null;
    }
    // Safety: never leave the table locked forever (e.g. extension reload races).
    if (on) {
      busyTimer = setTimeout(() => setTasksBusy(false), 20000);
    }
  }

  window.daSetTasksBusy = setTasksBusy;

  // Immediate feedback on Play (before extension responds).
  document.addEventListener("click", (ev) => {
    const btn = ev.target instanceof Element
      ? ev.target.closest('[data-da-action="play-task"], #btn-play-task, #btn-play-selection')
      : null;
    if (!btn) return;
    // Only show on home task list when the panel exists.
    if (!document.getElementById("da-tasks-panel")) return;
    if (document.documentElement.dataset.daPlayerExtension !== "1"
      && document.documentElement.dataset.daExtension !== "1") {
      return; // gate modal will open instead
    }
    setTasksBusy(true, "آماده‌سازی افزونهٔ اجرا…");
  }, true);

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
    if (d.phase === "started" || d.phase === "done" || d.phase === "error") {
      setTasksBusy(false);
    }
  });

  function scheduleRender() {
    const run = () => {
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

  scheduleRender();
  document.addEventListener("da:locale", () => scheduleRender());
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
})();
