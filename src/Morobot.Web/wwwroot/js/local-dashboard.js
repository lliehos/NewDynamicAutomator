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

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function faNum(n) {
    const loc = (window.DaI18n && DaI18n.culture === "en") ? "en-US" : "fa-IR";
    return Number(n || 0).toLocaleString(loc);
  }

  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function dateLocale() {
    return (window.DaI18n && DaI18n.culture === "en") ? "en-US" : "fa-IR";
  }

  function taskCounts(t) {
    if (t.graph?.nodes && Array.isArray(t.graph.nodes)) {
      const steps = t.graph.nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
      const groups = t.graph.nodes.filter((n) => n.kind === "group").length;
      const sources = Array.isArray(t.graph?.dataSources) ? t.graph.dataSources.length : (t.dataSourceCount || 0);
      return { steps, groups, sources };
    }
    return {
      steps: Number(t.stepCount) || 0,
      groups: Number(t.groupCount) || 0,
      sources: Number(t.dataSourceCount) || 0
    };
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

  function emptyGraph(title) {
    return {
      title,
      version: 1,
      designOrigin: "Manual",
      nodes: [
        { id: "start", kind: "start", title: "شروع", x: 40, y: 80, repeatSourceType: "None" },
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

  function collectSources(tasks) {
    const rows = [];
    tasks.forEach((task) => {
      (task.graph?.dataSources || []).forEach((ds) => {
        rows.push({
          taskId: task.id,
          taskTitle: task.title || "بدون عنوان",
          title: ds.title || ds.fileName || "منبع",
          cols: (ds.columnCount ?? (ds.columnKeys || ds.columns || []).length) || 0,
          rows: ds.rowCount ?? 0,
          fileName: ds.fileName || ""
        });
      });
    });
    return rows;
  }

  function render() {
    const tasks = readTasks();
    let steps = 0;
    let groups = 0;
    let sources = 0;
    tasks.forEach((t) => {
      const c = taskCounts(t);
      steps += c.steps;
      groups += c.groups;
      sources += c.sources;
    });

    const elTasks = document.getElementById("da-stat-tasks");
    const elSources = document.getElementById("da-stat-sources");
    const elSteps = document.getElementById("da-stat-steps");
    const elGroups = document.getElementById("da-stat-groups");
    const status = document.getElementById("da-dash-status");
    if (elTasks) elTasks.textContent = faNum(tasks.length);
    if (elSources) elSources.textContent = faNum(sources);
    if (elSteps) elSteps.textContent = faNum(steps);
    if (elGroups) elGroups.textContent = faNum(groups);
    if (status) {
      status.textContent = tasks.length
        ? t("dashboard.statusWithData", { tasks: faNum(tasks.length), sources: faNum(sources) })
        : t("dashboard.statusEmpty");
    }

    const recent = [...tasks].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    }).slice(0, 5);

    const recentEl = document.getElementById("da-dash-recent");
    if (recentEl) {
      if (!recent.length) {
        recentEl.innerHTML = `<div class="da-task-empty text-muted">${t("dashboard.noProcess")} <a href="/Panel/Home/Processes">${t("dashboard.createProcess")}</a></div>`;
      } else {
        recentEl.innerHTML = recent.map((row) => {
          const c = taskCounts(row);
          return `<a class="da-dash-row" href="/Panel/Tasks/Editor/${row.id}">
            <div class="da-dash-row-main">
              <strong>${escapeHtml(row.title || t("dashboard.untitled"))}</strong>
              <span class="text-muted">${formatCreatedAt(row.createdAt)}</span>
            </div>
            <div class="da-dash-row-meta">
              <span>${faNum(c.steps)} ${t("dashboard.steps")}</span>
              <span>${faNum(c.groups)} ${t("dashboard.groups")}</span>
              <span>${faNum(c.sources)} ${t("dashboard.sources")}</span>
            </div>
          </a>`;
        }).join("");
      }
    }

    const srcRows = collectSources(tasks).slice(0, 5);
    const srcEl = document.getElementById("da-dash-sources");
    if (srcEl) {
      if (!srcRows.length) {
        srcEl.innerHTML = `<div class="da-task-empty text-muted">${t("dashboard.noSource")}</div>`;
      } else {
        srcEl.innerHTML = srcRows.map((r) =>
          `<a class="da-dash-row" href="/Panel/Home/DataSources">
            <div class="da-dash-row-main">
              <strong>${escapeHtml(r.title)}</strong>
              <span class="text-muted">${escapeHtml(r.taskTitle)}</span>
            </div>
            <div class="da-dash-row-meta">
              <span>${faNum(r.cols)}</span>
              <span>${faNum(r.rows)}</span>
            </div>
          </a>`
        ).join("");
      }
    }
  }

  function newProcessId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch { /* ignore */ }
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function createAndOpen() {
    const titleInp = document.getElementById("da-new-title");
    const title = (titleInp?.value || "").trim();
    if (!title) {
      titleInp?.focus();
      return;
    }
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
    window.location.href = `/Panel/Tasks/Editor/${encodeURIComponent(id)}`;
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
    createAndOpen();
  });
  document.getElementById("da-create-local")?.addEventListener("click", createAndOpen);

  function scheduleRender() {
    const run = () => {
      if (window.DaSecureStore && typeof DaSecureStore.whenReady === "function") {
        DaSecureStore.whenReady(render);
      } else {
        render();
      }
    };
    if (window.DaI18n && DaI18n.ready && typeof DaI18n.ready.then === "function") {
      DaI18n.ready.then(run).catch(run);
    } else {
      run();
    }
  }

  window.addEventListener("da-local-tasks", () => scheduleRender());
  document.addEventListener("da:locale", () => scheduleRender());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRender);
  } else {
    scheduleRender();
  }
})();
