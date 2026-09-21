(function () {
  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function currentUser() {
    const fromCookie = readCookie("da_local_user");
    if (fromCookie) {
      localStorage.setItem("da_local_user", fromCookie);
      return fromCookie;
    }
    return localStorage.getItem("da_local_user") || "test";
  }

  function tasksKey() {
    return "da_local_tasks__" + currentUser();
  }

  function readTasks() {
    try {
      return JSON.parse(localStorage.getItem(tasksKey()) || "[]");
    } catch {
      return [];
    }
  }

  function writeTasks(tasks) {
    localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    localStorage.setItem("da_local_user", currentUser());
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
  }

  function originLabel(o) {
    return String(o || "").toLowerCase() === "recorded" ? "از رکورد" : "دستی";
  }
  function originClass(o) {
    return String(o || "").toLowerCase() === "recorded" ? "bg-label-danger" : "bg-label-primary";
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

  const ICO_PLAY = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>`;
  const ICO_REC = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>`;
  const ICO_EDIT = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5zm16.7-11.2a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5 1.6-1.6z"/></svg>`;
  const ICO_DEL = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;

  function render(tasks) {
    const body = document.getElementById("da-task-rows");
    if (!body) return;
    const status = document.getElementById("da-portal-status");
    if (status) status.textContent = `کاربر محلی: ${currentUser()} — داده‌ها فقط در این مرورگر برای همین کاربر.`;

    if (!tasks.length) {
      body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-6">فرآیندی نیست. طراحی دستی بسازید یا روی یک فرآیند ضبط کنید.</td></tr>`;
      return;
    }
    body.innerHTML = tasks.map((t) => {
      const steps = t.graph?.nodes?.filter((n) => n.kind === "action" || n.kind === "step").length || t.stepCount || 0;
      const groups = t.graph?.nodes?.filter((n) => n.kind === "group").length || t.groupCount || 0;
      const sources = dataSourceCount(t);
      return `<tr>
        <td>${escapeHtml(t.title)}</td>
        <td><span class="badge ${originClass(t.designOrigin)}">${originLabel(t.designOrigin)}</span></td>
        <td>${groups}</td>
        <td>${steps}</td>
        <td>${sources}</td>
        <td class="text-nowrap">
          <div class="d-inline-flex gap-1 align-items-center flex-wrap">
            <a class="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" href="/Tasks/Editor/${t.id}" title="ویرایش">
              ${ICO_EDIT}<span>ویرایش</span>
            </a>
            <button type="button" class="btn btn-sm btn-success d-inline-flex align-items-center gap-1"
              data-da-action="play-task" data-task-id="${t.id}" title="اجرا">
              ${ICO_PLAY}<span>اجرا</span>
            </button>
            <button type="button" class="btn btn-sm btn-danger d-inline-flex align-items-center gap-1"
              data-da-action="start-record" data-task-id="${t.id}" title="ضبط روی این فرآیند">
              ${ICO_REC}<span>ضبط</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
              data-da-del="${t.id}" title="حذف">
              ${ICO_DEL}<span>حذف</span>
            </button>
          </div>
        </td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-da-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-da-del"));
        if (!confirm("این فرآیند حذف شود؟")) return;
        const next = readTasks().filter((t) => t.id !== id);
        writeTasks(next);
        render(next);
      });
    });
  }

  function emptyGraph(title) {
    return {
      taskId: 0,
      title: title || "فرآیند جدید",
      canModify: true,
      designOrigin: "Manual",
      viewport: { x: 40, y: 40, zoom: 1 },
      nodes: [
        { id: "start", kind: "start", title: "شروع", x: 40, y: 220 },
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
      dataSources: []
    };
  }

  document.getElementById("da-create-local")?.addEventListener("click", () => {
    const titleInp = document.getElementById("da-new-title");
    const title = (titleInp?.value || "").trim() || "فرآیند جدید";
    const tasks = readTasks();
    const id = Date.now();
    const graph = emptyGraph(title);
    graph.taskId = id;
    tasks.push({
      id,
      title,
      designOrigin: "Manual",
      groupCount: 1,
      stepCount: 0,
      dataSourceCount: 0,
      createdAt: new Date().toISOString(),
      graph
    });
    writeTasks(tasks);
    if (titleInp) titleInp.value = "";
    render(tasks);
    const status = document.getElementById("da-portal-status");
    if (status) status.textContent = `فرآیند «${title}» اضافه شد.`;
  });

  window.addEventListener("da-local-tasks", (ev) => {
    const detail = ev.detail;
    if (detail && detail.tasks && detail.user && detail.user !== currentUser()) return;
    render((detail && detail.tasks) || readTasks());
  });

  render(readTasks());
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
})();
