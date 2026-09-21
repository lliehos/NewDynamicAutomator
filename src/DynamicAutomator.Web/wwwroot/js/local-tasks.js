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

  function render(tasks) {
    const body = document.getElementById("da-task-rows");
    if (!body) return;
    const status = document.getElementById("da-portal-status");
    if (status) status.textContent = `کاربر محلی: ${currentUser()} — داده‌ها فقط در این مرورگر برای همین کاربر.`;

    if (!tasks.length) {
      body.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-6">فرآیندی نیست. ضبط کنید یا طراحی دستی بسازید.</td></tr>`;
      return;
    }
    body.innerHTML = tasks.map((t) => {
      const steps = t.graph?.nodes?.filter((n) => n.kind === "step").length || t.stepCount || 0;
      const groups = t.graph?.nodes?.filter((n) => n.kind === "group").length || t.groupCount || 0;
      return `<tr>
        <td>${escapeHtml(t.title)}</td>
        <td><span class="badge ${originClass(t.designOrigin)}">${originLabel(t.designOrigin)}</span></td>
        <td>${groups}</td>
        <td>${steps}</td>
        <td>
          <a class="btn btn-sm btn-primary" href="/Tasks/Editor/${t.id}">ویرایش</a>
          <button type="button" class="btn btn-sm btn-success" data-da-action="play-task" data-task-id="${t.id}">اجرا</button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-da-del="${t.id}">حذف</button>
        </td>
      </tr>`;
    }).join("");

    body.querySelectorAll("[data-da-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-da-del"));
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
          moveLoop: false
        }
      ],
      edges: [{ id: "e-start", from: "start", to: "group-1", kind: "next" }],
      dataSources: []
    };
  }

  document.getElementById("da-create-local")?.addEventListener("click", () => {
    const title = (document.getElementById("da-new-title")?.value || "").trim() || "فرآیند دستی";
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
      createdAt: new Date().toISOString(),
      graph
    });
    writeTasks(tasks);
    location.href = `/Tasks/Editor/${id}`;
  });

  window.addEventListener("da-local-tasks", (ev) => {
    const detail = ev.detail;
    if (detail && detail.tasks && detail.user && detail.user !== currentUser()) return;
    render((detail && detail.tasks) || readTasks());
  });

  render(readTasks());
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
})();
