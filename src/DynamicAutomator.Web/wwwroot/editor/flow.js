(() => {
  const app = document.getElementById("flow-app");
  // Prefer URL segment: local task ids are Date.now() and may exceed Int32
  // (older Editor(int) routes would put "0" in data-task-id).
  const pathSeg = location.pathname.split("/").filter(Boolean).pop() || "";
  const taskId = /^\d+$/.test(pathSeg) ? pathSeg : (app.dataset.taskId || "");
  const canModify = app.dataset.canModify === "true";
  if (taskId) app.dataset.taskId = taskId;
  const world = document.getElementById("world");
  const svg = document.getElementById("flow-svg");
  const wrap = document.getElementById("canvas-wrap");
  const listWrap = document.getElementById("list-wrap");
  const groupEdit = document.getElementById("group-edit");
  const groupStepsEl = document.getElementById("group-steps");
  const inspector = document.getElementById("inspector");
  const status = document.getElementById("flow-status");
  const titleEl = document.getElementById("flow-title");
  const originEl = document.getElementById("flow-origin");
  const ctxMenu = document.getElementById("ctx-menu");
  const paletteRoot = document.getElementById("palette-root");
  const paletteGroup = document.getElementById("palette-group");
  const btnBack = document.getElementById("btn-back-group");
  const dsListEl = document.getElementById("ds-list");
  const dsStatus = document.getElementById("ds-status");
  const dsTitleInp = document.getElementById("ds-title");
  const dsFileInp = document.getElementById("ds-file");
  const btnDsUpload = document.getElementById("btn-ds-upload");

  const ACTIONS = ["NoAction","Click","DoubleClick","RightClick","InputContent","GoToUrl","WaitTime","SaveContent","InsertContent","TakeContent","Refresh","Hover","WaitForLoading","Enter"];

  let graph = { nodes: [], edges: [], viewport: { x: 40, y: 40, zoom: 1 }, title: "", dataSources: [], canModify: true };
  let selected = new Set();
  let view = "diagram";
  let editingGroupId = null;
  let dragging = null;
  let panning = null;
  let linking = null;

  const ns = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };

  const nodeById = (id) => graph.nodes.find((n) => n.id === id);
  const tmpId = (kind) => `tmp-${kind}-${Date.now()}-${Math.floor(Math.random() * 999)}`;
  const stepsOf = (gid) => graph.nodes.filter((n) => n.kind === "step" && n.groupNodeId === gid);

  const LOCAL_USER_KEY = "da_local_user";

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function currentUser() {
    const u = readCookie("da_local_user") || localStorage.getItem(LOCAL_USER_KEY) || "test";
    localStorage.setItem(LOCAL_USER_KEY, u);
    return u;
  }
  function tasksKey() {
    return "da_local_tasks__" + currentUser();
  }

  const LOCAL_KEY = tasksKey();

  function readLocalTasks() {
    try { return JSON.parse(localStorage.getItem(tasksKey()) || "[]"); } catch { return []; }
  }
  function writeLocalTasks(tasks) {
    localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: currentUser(), tasks } }));
  }
  function findLocalTask(id) {
    return readLocalTasks().find((t) => String(t.id) === String(id));
  }

  function applyLocalGraph(local) {
    graph = structuredClone ? structuredClone(local.graph) : JSON.parse(JSON.stringify(local.graph));
    graph.taskId = Number(taskId) || taskId;
    graph.nodes ||= [];
    graph.edges ||= [];
    graph.viewport ||= { x: 40, y: 40, zoom: 1 };
    graph.dataSources ||= [];
    graph.canModify = true;
    graph.designOrigin = local.designOrigin || graph.designOrigin || "Manual";
    titleEl.textContent = graph.title || local.title || "گردش کار";
    if (originEl) {
      const recorded = String(graph.designOrigin || "").toLowerCase() === "recorded";
      originEl.className = "origin-badge " + (recorded ? "recorded" : "manual");
      originEl.textContent = recorded ? "ویرایش: از رکورد" : "ویرایش: دستی";
    }
    const steps = graph.nodes.filter((n) => n.kind === "step").length;
    const groups = graph.nodes.filter((n) => n.kind === "group");
    status.textContent = steps
      ? `${steps} مرحله — روی گروه دبل‌کلیک کنید تا مراحل را ببینید`
      : "آماده ویرایش (ذخیره محلی)";
    renderDataSources();
    render();
    // Open the group that actually has recorded steps (not the spare empty one)
    if (steps > 0 && !editingGroupId) {
      const withSteps = groups.find((g) =>
        graph.nodes.some((n) => n.kind === "step" && n.groupNodeId === g.id));
      if (withSteps) openGroup(withSteps.id);
    }
  }

  function emptyShell() {
    graph = {
      taskId: Number(taskId) || taskId,
      title: "فرآیند محلی",
      canModify: true,
      designOrigin: "Manual",
      viewport: { x: 40, y: 40, zoom: 1 },
      nodes: [{ id: "start", kind: "start", title: "شروع", x: 40, y: 220 }],
      edges: [],
      dataSources: []
    };
    titleEl.textContent = graph.title;
    status.textContent = "در حال دریافت از حافظهٔ محلی...";
    renderDataSources();
    render();
  }

  function graphStepCount(g) {
    return (g?.nodes || []).filter((n) => n.kind === "step").length;
  }

  async function load() {
    const local = findLocalTask(taskId);
    if (local?.graph && graphStepCount(local.graph) > 0) {
      applyLocalGraph(local);
      return;
    }
    if (local?.graph) {
      applyLocalGraph(local);
    } else {
      emptyShell();
    }
    // Ask extension/bridge to sync; listener below will apply richer graph.
    window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
  }

  // Portal-bridge may write chrome.storage → localStorage after first paint
  window.addEventListener("da-local-tasks", (ev) => {
    const detail = ev.detail;
    if (detail && detail.user && detail.user !== currentUser()) return;
    const tasks = (detail && detail.tasks) || (Array.isArray(detail) ? detail : null);
    const local = tasks
      ? tasks.find((t) => String(t.id) === String(taskId))
      : findLocalTask(taskId);
    if (!local?.graph) return;
    const incoming = graphStepCount(local.graph);
    const current = graphStepCount(graph);
    if (incoming === 0) return;
    if (current > 0 && current >= incoming && editingGroupId) return;
    applyLocalGraph(local);
  });
  window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
  [400, 1200, 2500].forEach((ms) => setTimeout(() => {
    window.dispatchEvent(new CustomEvent("da-request-local-tasks"));
  }, ms));

  async function save() {
    if (!canModify) return;
    status.textContent = "در حال ذخیره محلی...";
    const orphan = graph.nodes.filter((n) => n.kind === "step" && !n.groupNodeId);
    if (orphan.length) {
      const g = graph.nodes.find((n) => n.kind === "group");
      if (!g) {
        status.textContent = "هر مرحله باید داخل گروه باشد — ابتدا یک گروه بسازید.";
        return;
      }
      orphan.forEach((s) => { s.groupNodeId = g.id; });
    }

    graph.taskId = Number(taskId);
    const tasks = readLocalTasks();
    const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
    const stepCount = graph.nodes.filter((n) => n.kind === "step").length;
    const groupCount = graph.nodes.filter((n) => n.kind === "group").length;
    const item = {
      id: Number(taskId),
      title: graph.title || "فرآیند",
      designOrigin: graph.designOrigin || "Manual",
      groupCount,
      stepCount,
      createdAt: idx >= 0 ? tasks[idx].createdAt : new Date().toISOString(),
      graph
    };
    if (idx >= 0) tasks[idx] = item; else tasks.push(item);
    writeLocalTasks(tasks);
    window.dispatchEvent(new CustomEvent("da-local-tasks", { detail: tasks }));
    status.textContent = "ذخیره محلی شد";
    render();
  }

  function renderDataSources() {
    if (!dsListEl) return;
    const list = graph.dataSources || [];
    if (!list.length) {
      dsListEl.innerHTML = `<li class="ds-meta" style="background:transparent;padding:0">هنوز منبعی بارگذاری نشده.</li>`;
      return;
    }
    dsListEl.innerHTML = list.map((d) => {
      const keys = (d.columnKeys || []).join("، ") || "—";
      return `<li data-id="${d.id}">
        <span class="ds-title">${esc(d.title)}</span>
        <div class="ds-meta">${d.columnCount || 0} ستون · ${d.rowCount || 0} ردیف</div>
        <div class="ds-keys">${esc(keys)}</div>
        ${canModify ? `<div class="ds-actions"><button type="button" class="btn-flow btn-ghost ds-del" data-id="${d.id}">حذف</button></div>` : ""}
      </li>`;
    }).join("");
    dsListEl.querySelectorAll(".ds-del").forEach((btn) => {
      btn.addEventListener("click", () => deleteDataSource(Number(btn.dataset.id)));
    });
  }

  async function uploadDataSource() {
    if (dsStatus) dsStatus.textContent = "فعلاً منابع اکسل در حالت محلی بعدی اضافه می‌شود.";
  }

  async function deleteDataSource(sourceId) {
    if (!canModify || !sourceId) return;
    graph.dataSources = (graph.dataSources || []).filter((d) => d.id !== sourceId);
    graph.nodes.forEach((n) => {
      if (n.dataSourceId === sourceId) n.dataSourceId = null;
    });
    if (dsStatus) dsStatus.textContent = "منبع از گراف محلی حذف شد — ذخیره کنید.";
    renderDataSources();
    render();
  }

  function sizeOf(n) {
    if (n.kind === "start") return { w: 72, h: 72 };
    if (n.kind === "group") return { w: 280, h: 120 };
    if (n.kind === "condition") return { w: 150, h: 86 };
    return { w: 240, h: 76 };
  }

  function applyVp() {
    world.setAttribute("transform", `translate(${graph.viewport.x},${graph.viewport.y}) scale(${graph.viewport.zoom})`);
  }

  function render() {
    const inGroup = !!editingGroupId;
    paletteRoot.hidden = inGroup;
    paletteGroup.hidden = !inGroup;
    btnBack.hidden = !inGroup;
    svg.style.display = view === "diagram" && !inGroup ? "" : "none";
    listWrap.hidden = view !== "list" || inGroup;
    groupEdit.hidden = !inGroup;
    updatePlaySelectionBtn();

    if (inGroup) {
      renderGroupEdit();
      renderInspector();
      return;
    }

    applyVp();
    world.replaceChildren();
    graph.edges
      .filter((e) => e.kind !== "contains")
      .filter((e) => {
        const a = nodeById(e.from), b = nodeById(e.to);
        if (!a || !b) return false;
        if (a.kind === "step" || b.kind === "step") return false;
        return true;
      })
      .forEach(drawEdge);
    graph.nodes.filter((n) => n.kind !== "step").forEach(drawNode);
    renderList();
    renderInspector();
  }

  function drawEdge(e) {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return;
    const sa = sizeOf(a), sb = sizeOf(b);
    const x1 = a.x + sa.w, y1 = a.y + sa.h / 2;
    const x2 = b.x, y2 = b.y + sb.h / 2;
    const c = e.kind === "success" ? "#28c76f" : e.kind === "fail" ? "#ea5455" : e.kind === "parent" ? "#00cfe8" : "#7367f0";
    const d = `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`;
    const p = el("path", { d, fill: "none", stroke: c, "stroke-width": 2.4, "marker-end": "url(#arrow)" });
    if (e.kind === "parent") p.setAttribute("stroke-dasharray", "8 5");
    world.appendChild(p);
  }

  function drawNode(n) {
    const { w, h } = sizeOf(n);
    const g = el("g", { class: "node", "data-id": n.id, transform: `translate(${n.x},${n.y})` });
    if (selected.has(n.id)) g.classList.add("node-on");
    const fill = n.kind === "start" ? "#28c76f" : n.kind === "group" ? "#fff" : n.kind === "condition" ? "#fff8e1" : "#fff";
    const stroke = selected.has(n.id) ? "#7367f0" : n.kind === "group" ? "#9b92f8" : "#e4e1f5";
    if (n.kind === "condition") {
      const pts = `${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`;
      g.appendChild(el("polygon", { points: pts, fill, stroke, "stroke-width": 2 }));
    } else {
      g.appendChild(el("rect", { width: w, height: h, rx: n.kind === "start" ? h / 2 : 14, fill, stroke, "stroke-width": 2 }));
    }
    const stepCount = n.kind === "group" ? stepsOf(n.id).length : 0;
    const label = n.kind === "group"
      ? `${n.title}\nتکرار: ${n.repeatSourceType || "None"} · ${stepCount} مرحله`
      : n.title;
    const t = el("text", { x: w / 2, y: n.kind === "group" ? 36 : h / 2 + 4, "text-anchor": "middle", fill: n.kind === "start" ? "#fff" : "#4b465c", "font-size": 12, "font-family": "Vazirmatn, Tahoma" });
    label.split("\n").forEach((line, i) => {
      const s = el("tspan", { x: w / 2, dy: i === 0 ? 0 : 16 });
      s.textContent = line;
      t.appendChild(s);
    });
    g.appendChild(t);
    const port = el("circle", { class: "port", cx: w, cy: h / 2, r: 6, fill: "#7367f0" });
    g.appendChild(port);
    g.addEventListener("mousedown", (ev) => onNodeDown(ev, n, ev.target.classList.contains("port")));
    g.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (n.kind === "group") openGroup(n.id);
    });
    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      if (n.kind === "group") showCtx(ev.clientX, ev.clientY, n);
    });
    world.appendChild(g);
  }

  function openGroup(id) {
    editingGroupId = id;
    selected = new Set([id]);
    view = "diagram";
    setViewTabs();
    render();
  }

  function closeGroup() {
    editingGroupId = null;
    render();
  }

  function showCtx(x, y, n) {
    ctxMenu.hidden = false;
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.innerHTML = `
      <li data-act="edit">ویرایش مراحل</li>
      <li data-act="select">انتخاب</li>
    `;
    ctxMenu.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        ctxMenu.hidden = true;
        if (li.dataset.act === "edit") openGroup(n.id);
        else { selected = new Set([n.id]); render(); }
      });
    });
  }
  window.addEventListener("click", () => { ctxMenu.hidden = true; });

  function renderGroupEdit() {
    const g = nodeById(editingGroupId);
    if (!g) { closeGroup(); return; }
    document.getElementById("group-edit-title").textContent = g.title || "گروه";
    const steps = stepsOf(g.id);
    groupStepsEl.innerHTML = steps.map((s, i) => `
      <div class="group-step-row ${selected.has(s.id) ? "on" : ""}" data-id="${s.id}">
        <span class="idx">${i + 1}</span>
        <div class="body">
          <b>${esc(s.actionType || "Step")}</b>
          <span>${esc(s.title)}</span>
        </div>
        <button type="button" class="btn-mini" data-del="${s.id}">حذف</button>
      </div>
    `).join("") || `<p class="empty-steps">هنوز مرحله‌ای نیست. «افزودن مرحله» را بزنید.</p>`;

    groupStepsEl.querySelectorAll(".group-step-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-del]")) return;
        selected = new Set([row.dataset.id]);
        render();
      });
    });
    groupStepsEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute("data-del");
        graph.nodes = graph.nodes.filter((n) => n.id !== id);
        graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
        selected = new Set([editingGroupId]);
        render();
      });
    });
  }

  function addStep() {
    if (!editingGroupId || !canModify) return;
    const g = nodeById(editingGroupId);
    const steps = stepsOf(editingGroupId);
    const node = {
      id: tmpId("step"),
      kind: "step",
      title: `مرحله ${steps.length + 1}`,
      groupNodeId: editingGroupId,
      actionType: "Click",
      isActive: true,
      framePathJson: "[]",
      x: (g?.x || 0) + 40,
      y: (g?.y || 0) + 80 + steps.length * 20
    };
    graph.nodes.push(node);
    const prev = steps[steps.length - 1];
    if (prev) graph.edges.push({ id: tmpId("e"), from: prev.id, to: node.id, kind: "next" });
    else graph.edges.push({ id: tmpId("e"), from: editingGroupId, to: node.id, kind: "contains" });
    selected = new Set([node.id]);
    render();
  }

  function renderList() {
    const groups = graph.nodes.filter((n) => n.kind === "group");
    listWrap.innerHTML = groups.map((g) => {
      const steps = stepsOf(g.id);
      return `<div class="list-group">
        <div class="list-group-h" data-gid="${g.id}">
          <b>${esc(g.title)}</b>
          <span>تکرار: ${esc(g.repeatSourceType || "None")} · ${steps.length} مرحله — کلیک برای ویرایش</span>
        </div>
        ${steps.map((s, i) => `<div class="list-step ${selected.has(s.id) ? "on" : ""}" data-id="${s.id}">
          <span>${i + 1}</span><b>${esc(s.actionType || "")}</b><span>${esc(s.title)}</span>
        </div>`).join("") || `<div class="list-step">مرحله‌ای نیست</div>`}
      </div>`;
    }).join("") || `<p style="color:#a8aaae">هنوز گروهی نیست. از جعبه ابزار «گروه» را بکشید یا رکورد ذخیره کنید.</p>`;
    listWrap.querySelectorAll(".list-step[data-id]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        select(row.dataset.id, ev.shiftKey);
        const step = nodeById(row.dataset.id);
        if (step?.groupNodeId) openGroup(step.groupNodeId);
        else render();
      });
    });
    listWrap.querySelectorAll(".list-group-h").forEach((h) => {
      h.addEventListener("click", () => openGroup(h.dataset.gid));
    });
  }

  function renderInspector() {
    const id = [...selected][0];
    const n = id && nodeById(id);
    if (!n) { inspector.innerHTML = "<p style='color:#a8aaae'>یک شکل یا ردیف را انتخاب کنید.</p>"; return; }
    if (n.kind === "group") {
      const rst = n.repeatSourceType || "None";
      const dsOpts = (graph.dataSources || []).map((d) => {
        const meta = d.columnCount != null ? ` (${d.columnCount} ستون)` : "";
        return `<option value="${d.id}" ${n.dataSourceId === d.id ? "selected" : ""}>${esc(d.title)}${meta}</option>`;
      }).join("");
      const selectedDs = (graph.dataSources || []).find((d) => d.id === n.dataSourceId);
      const keysHint = selectedDs?.columnKeys?.length
        ? `<div class="ds-keys" style="margin-top:4px">کلیدها: ${esc(selectedDs.columnKeys.join("، "))}</div>`
        : "";
      inspector.innerHTML = field("عنوان", "title", n.title) +
        `<div class="insp-field"><label>منبع تکرار</label><select data-k="repeatSourceType">${opt(["None","DataSource","Elements","Loops"], rst)}</select></div>` +
        `<div class="insp-field" id="insp-ds"><label>منبع داده</label><select data-k="dataSourceId"><option value="">—</option>${dsOpts}</select>${keysHint}</div>` +
        `<div class="insp-field" id="insp-el"><label>سلکتور المان‌ها (Elements)</label><input data-k="selectorValue" value="${esc(n.selectorValue || "")}" placeholder="مثلاً table tbody tr" /></div>` +
        `<div class="insp-field"><label><input type="checkbox" data-k="moveLoop" ${n.moveLoop ? "checked" : ""}/> ارث‌بری ایندکس والد (MoveLoop)</label></div>` +
        `<button type="button" class="btn-flow" id="insp-open-steps" style="width:100%;margin-top:8px">ویرایش مراحل گروه</button>`;
      toggleInspFields(rst);
    } else if (n.kind === "step") {
      inspector.innerHTML = field("عنوان", "title", n.title) +
        `<div class="insp-field"><label>نوع اکشن</label><select data-k="actionType">${opt(ACTIONS, n.actionType)}</select></div>` +
        field("مقدار", "constantValue", n.constantValue || "") +
        field("آدرس (GoToUrl)", "navigateUrl", n.navigateUrl || "") +
        field("سلکتور", "selectorValue", n.selectorValue || "") +
        `<div class="insp-field"><label>زنجیره فریم (JSON)</label><textarea data-k="framePathJson" rows="4">${esc(n.framePathJson || "[]")}</textarea></div>` +
        `<div class="insp-field"><label><input type="checkbox" data-k="isConditional" ${n.isConditional ? "checked" : ""}/> مرحله مشروط</label></div>`;
    } else if (n.kind === "condition") {
      inspector.innerHTML = field("عنوان", "title", n.title) +
        `<p style="font-size:12px;color:#a8aaae">یال سبز (Ctrl+پورت)=موفقیت، قرمز (Shift)=شکست به گروه بعدی.</p>`;
    } else {
      inspector.innerHTML = field("عنوان", "title", n.title);
    }
    inspector.querySelectorAll("[data-k]").forEach((inp) => {
      const apply = () => {
        const k = inp.dataset.k;
        n[k] = inp.type === "checkbox" ? inp.checked : (k === "dataSourceId" ? (inp.value ? Number(inp.value) : null) : inp.value);
        if (k === "repeatSourceType") toggleInspFields(n.repeatSourceType);
        render();
      };
      inp.addEventListener("change", apply);
      if (inp.tagName === "TEXTAREA" || inp.tagName === "INPUT") inp.addEventListener("blur", apply);
    });
    document.getElementById("insp-open-steps")?.addEventListener("click", () => openGroup(n.id));
  }

  function toggleInspFields(rst) {
    const ds = document.getElementById("insp-ds");
    const el = document.getElementById("insp-el");
    if (ds) ds.style.display = rst === "DataSource" ? "" : "none";
    if (el) el.style.display = rst === "Elements" ? "" : "none";
  }

  function field(label, key, val) {
    return `<div class="insp-field"><label>${label}</label><input data-k="${key}" value="${esc(val)}" /></div>`;
  }
  function opt(list, cur) {
    return list.map((x) => `<option ${String(cur) === x ? "selected" : ""}>${x}</option>`).join("");
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function select(id, additive) {
    if (!additive) selected.clear();
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    updatePlaySelectionBtn();
  }

  function updatePlaySelectionBtn() {
    const btn = document.getElementById("btn-play-selection");
    if (!btn) return;
    const id = [...selected][0];
    const n = id && nodeById(id);
    if (n && (n.kind === "group" || n.kind === "step")) {
      btn.hidden = false;
      btn.textContent = n.kind === "group" ? "▶ اجرای گروه" : "▶ اجرای مرحله";
      btn.dataset.kind = n.kind;
      btn.dataset.nodeId = n.id;
    } else {
      btn.hidden = true;
      delete btn.dataset.kind;
      delete btn.dataset.nodeId;
    }
  }

  function requestPlay(scope) {
    if (!extOkHint()) {
      status.textContent = "افزونه متصل نیست — صفحه را در Chrome رفرش کنید یا افزونه را Reload کنید.";
      return;
    }
    window.dispatchEvent(new CustomEvent("da-play", {
      detail: {
        taskId: Number(taskId),
        groupNodeId: scope?.groupNodeId || null,
        stepNodeId: scope?.stepNodeId || null
      }
    }));
    status.textContent = "درخواست اجرا ارسال شد...";
  }

  function extOkHint() {
    return document.documentElement.dataset.daExtension === "1"
      || !!document.getElementById("da-recorder-fab");
  }

  function onNodeDown(ev, n, isPort) {
    ev.stopPropagation();
    select(n.id, ev.shiftKey);
    if (isPort) {
      linking = { from: n.id, kind: ev.altKey ? "parent" : ev.shiftKey ? "fail" : ev.ctrlKey ? "success" : "next" };
    } else {
      dragging = { id: n.id, ox: n.x, oy: n.y, mx: ev.clientX, my: ev.clientY };
    }
    render();
  }

  wrap.addEventListener("mousedown", (ev) => {
    if (editingGroupId) return;
    if (ev.target === svg || ev.target.tagName === "rect") {
      panning = { x: graph.viewport.x, y: graph.viewport.y, mx: ev.clientX, my: ev.clientY };
      selected.clear();
      render();
    }
  });
  window.addEventListener("mousemove", (ev) => {
    const z = graph.viewport.zoom || 1;
    if (dragging) {
      const n = nodeById(dragging.id);
      n.x = dragging.ox + (ev.clientX - dragging.mx) / z;
      n.y = dragging.oy + (ev.clientY - dragging.my) / z;
      render();
    } else if (panning) {
      graph.viewport.x = panning.x + (ev.clientX - panning.mx);
      graph.viewport.y = panning.y + (ev.clientY - panning.my);
      applyVp();
    }
  });
  window.addEventListener("mouseup", (ev) => {
    if (linking) {
      const hit = ev.target.closest && ev.target.closest("g.node");
      if (hit) {
        const to = hit.getAttribute("data-id");
        if (to && to !== linking.from) {
          graph.edges.push({ id: tmpId("e"), from: linking.from, to, kind: linking.kind });
        }
      }
    }
    dragging = panning = linking = null;
  });
  wrap.addEventListener("wheel", (ev) => {
    if (editingGroupId) return;
    ev.preventDefault();
    const f = ev.deltaY > 0 ? 0.92 : 1.08;
    graph.viewport.zoom = Math.min(2.2, Math.max(0.35, (graph.viewport.zoom || 1) * f));
    applyVp();
  }, { passive: false });

  document.querySelectorAll(".stencil").forEach((s) => {
    s.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("kind", s.dataset.kind));
  });
  wrap.addEventListener("dragover", (ev) => ev.preventDefault());
  wrap.addEventListener("drop", (ev) => {
    ev.preventDefault();
    if (editingGroupId) return;
    const kind = ev.dataTransfer.getData("kind");
    if (!kind || kind === "step") return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const ctm = world.getScreenCTM().inverse();
    const p = pt.matrixTransform(ctm);
    const node = {
      id: tmpId(kind),
      kind,
      title: kind === "group" ? "گروه جدید" : "شرط",
      x: p.x,
      y: p.y,
      repeatSourceType: "None",
      isActive: true,
      moveLoop: false
    };
    graph.nodes.push(node);
    selected = new Set([node.id]);
    render();
  });

  document.getElementById("btn-add-step").addEventListener("click", addStep);
  document.getElementById("btn-back-group").addEventListener("click", closeGroup);
  document.getElementById("btn-group-edit-close").addEventListener("click", closeGroup);
  document.getElementById("btn-save").addEventListener("click", save);
  btnDsUpload?.addEventListener("click", uploadDataSource);
  document.getElementById("btn-play-task")?.addEventListener("click", () => requestPlay({}));
  document.getElementById("btn-play-selection")?.addEventListener("click", () => {
    const btn = document.getElementById("btn-play-selection");
    if (!btn?.dataset?.nodeId) return;
    if (btn.dataset.kind === "group") requestPlay({ groupNodeId: btn.dataset.nodeId });
    else requestPlay({ stepNodeId: btn.dataset.nodeId });
  });
  document.getElementById("btn-fit").addEventListener("click", () => {
    graph.viewport = { x: 40, y: 40, zoom: 1 };
    render();
  });
  document.getElementById("tab-diagram").addEventListener("click", () => { closeGroup(); setView("diagram"); });
  document.getElementById("tab-list").addEventListener("click", () => { closeGroup(); setView("list"); });

  function setView(v) {
    view = v;
    setViewTabs();
    render();
  }
  function setViewTabs() {
    document.getElementById("tab-diagram").classList.toggle("on", view === "diagram" && !editingGroupId);
    document.getElementById("tab-list").classList.toggle("on", view === "list" && !editingGroupId);
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && editingGroupId) { closeGroup(); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT") return;
      const ids = new Set(selected);
      if (editingGroupId) {
        graph.nodes = graph.nodes.filter((n) => !(n.kind === "step" && ids.has(n.id)));
      } else {
        const removeGroups = [...ids].filter((id) => nodeById(id)?.kind === "group");
        graph.nodes = graph.nodes.filter((n) => {
          if (n.kind === "start") return true;
          if (ids.has(n.id)) return false;
          if (n.kind === "step" && removeGroups.includes(n.groupNodeId)) return false;
          return true;
        });
      }
      graph.edges = graph.edges.filter((e) => graph.nodes.some((n) => n.id === e.from) && graph.nodes.some((n) => n.id === e.to));
      selected.clear();
      render();
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      save();
    }
  });

  load();
})();
