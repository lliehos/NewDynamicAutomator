(() => {
  const app = document.getElementById("flow-app");
  const taskId = app.dataset.taskId;
  const canModify = app.dataset.canModify === "true";
  const world = document.getElementById("world");
  const svg = document.getElementById("flow-svg");
  const wrap = document.getElementById("canvas-wrap");
  const listWrap = document.getElementById("list-wrap");
  const inspector = document.getElementById("inspector");
  const status = document.getElementById("flow-status");
  const titleEl = document.getElementById("flow-title");

  const ACTIONS = ["NoAction","Click","DoubleClick","RightClick","InputContent","GoToUrl","WaitTime","SaveContent","InsertContent","TakeContent","Refresh","Hover","WaitForLoading"];

  let graph = { nodes: [], edges: [], viewport: { x: 40, y: 40, zoom: 1 }, title: "", dataSources: [], canModify: true };
  let selected = new Set();
  let view = "diagram";
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

  function snapshot() {
    return JSON.stringify({ nodes: graph.nodes, edges: graph.edges, viewport: graph.viewport });
  }

  async function load() {
    const res = await fetch(`/Tasks/Graph/${taskId}`, { credentials: "same-origin" });
    if (!res.ok) { status.textContent = "خطا در بارگذاری"; return; }
    graph = await res.json();
    graph.nodes ||= [];
    graph.edges ||= [];
    graph.viewport ||= { x: 40, y: 40, zoom: 1 };
    graph.dataSources ||= [];
    titleEl.textContent = graph.title || "گردش کار";
    status.textContent = canModify ? "آماده ویرایش" : "فقط مشاهده";
    render();
  }

  async function save() {
    if (!canModify) return;
    status.textContent = "در حال ذخیره...";
    const body = {
      title: graph.title,
      viewport: graph.viewport,
      nodes: graph.nodes,
      edges: graph.edges.filter((e) => e.kind !== "contains"),
      deletedGroupIds: [],
      deletedStepIds: [],
      deletedConditionGroupIds: []
    };
    const res = await fetch(`/Tasks/SaveGraph/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    if (!res.ok) { status.textContent = "ذخیره ناموفق"; return; }
    graph = await res.json();
    graph.dataSources ||= [];
    status.textContent = "ذخیره شد";
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
    applyVp();
    world.replaceChildren();
    graph.edges.filter((e) => e.kind !== "contains").forEach(drawEdge);
    graph.nodes.forEach(drawNode);
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
    const p = el("path", { d, fill: "none", stroke: c, "stroke-width": e.kind === "parent" ? 2 : 2.4, "marker-end": "url(#arrow)" });
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
    const label = n.kind === "group"
      ? `${n.title}\nتکرار: ${n.repeatSourceType || "None"}`
      : n.kind === "step"
        ? `${n.actionType || "Step"}\n${n.title}`
        : n.title;
    const t = el("text", { x: w / 2, y: n.kind === "step" || n.kind === "group" ? 28 : h / 2 + 4, "text-anchor": "middle", fill: n.kind === "start" ? "#fff" : "#4b465c", "font-size": 12, "font-family": "Vazirmatn, Tahoma" });
    label.split("\n").forEach((line, i) => {
      const s = el("tspan", { x: w / 2, dy: i === 0 ? 0 : 16 });
      s.textContent = line;
      t.appendChild(s);
    });
    g.appendChild(t);
    const port = el("circle", { class: "port", cx: w, cy: h / 2, r: 6, fill: "#7367f0" });
    g.appendChild(port);
    g.addEventListener("mousedown", (ev) => onNodeDown(ev, n, ev.target.classList.contains("port")));
    world.appendChild(g);
  }

  function renderList() {
    const groups = graph.nodes.filter((n) => n.kind === "group");
    listWrap.innerHTML = groups.map((g) => {
      const steps = graph.nodes.filter((n) => n.kind === "step" && n.groupNodeId === g.id);
      return `<div class="list-group">
        <div class="list-group-h">
          <b>${esc(g.title)}</b>
          <span>تکرار: ${esc(g.repeatSourceType || "None")}${g.moveLoop ? " · MoveLoop" : ""}</span>
        </div>
        ${steps.map((s, i) => `<div class="list-step ${selected.has(s.id) ? "on" : ""}" data-id="${s.id}">
          <span>${i + 1}</span><b>${esc(s.actionType || "")}</b><span>${esc(s.title)}</span>
        </div>`).join("") || `<div class="list-step">مرحله‌ای نیست</div>`}
      </div>`;
    }).join("") || `<p style="color:#a8aaae">هنوز گروهی نیست. از جعبه ابزار بکشید یا رکورد ذخیره کنید.</p>`;
    listWrap.querySelectorAll(".list-step[data-id]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        select(row.dataset.id, ev.shiftKey);
        render();
      });
    });
    listWrap.querySelectorAll(".list-group-h").forEach((h, idx) => {
      h.addEventListener("click", () => { select(groups[idx].id, false); render(); });
    });
  }

  function renderInspector() {
    const id = [...selected][0];
    const n = id && nodeById(id);
    if (!n) { inspector.innerHTML = "<p style='color:#a8aaae'>یک شکل یا ردیف را انتخاب کنید.</p>"; return; }
    if (n.kind === "group") {
      inspector.innerHTML = field("عنوان", "title", n.title) +
        `<div class="insp-field"><label>منبع تکرار</label><select data-k="repeatSourceType">${opt(["None","DataSource","Elements","Loops"], n.repeatSourceType)}</select></div>` +
        `<div class="insp-field"><label>منبع داده</label><select data-k="dataSourceId"><option value="">—</option>${(graph.dataSources || []).map((d) => `<option value="${d.id}" ${n.dataSourceId === d.id ? "selected" : ""}>${esc(d.title)}</option>`).join("")}</select></div>` +
        `<div class="insp-field"><label><input type="checkbox" data-k="moveLoop" ${n.moveLoop ? "checked" : ""}/> ارث‌بری ایندکس والد (MoveLoop)</label></div>`;
    } else if (n.kind === "step") {
      inspector.innerHTML = field("عنوان", "title", n.title) +
        `<div class="insp-field"><label>نوع اکشن</label><select data-k="actionType">${opt(ACTIONS, n.actionType)}</select></div>` +
        field("مقدار", "constantValue", n.constantValue || "") +
        field("سلکتور", "selectorValue", n.selectorValue || "") +
        `<div class="insp-field"><label>زنجیره فریم (JSON)</label><textarea data-k="framePathJson" rows="4">${esc(n.framePathJson || "[]")}</textarea></div>` +
        `<div class="insp-field"><label><input type="checkbox" data-k="isConditional" ${n.isConditional ? "checked" : ""}/> مرحله مشروط</label></div>`;
    } else {
      inspector.innerHTML = field("عنوان", "title", n.title);
    }
    inspector.querySelectorAll("[data-k]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const k = inp.dataset.k;
        n[k] = inp.type === "checkbox" ? inp.checked : (k === "dataSourceId" ? (inp.value ? Number(inp.value) : null) : inp.value);
        if (n.kind === "group" && k === "title") titleEl.textContent = graph.title;
        render();
      });
    });
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
      if (n.kind === "step") {
        const g = graph.nodes.find((x) => x.kind === "group" && n.x > x.x && n.x < x.x + 280 && n.y > x.y && n.y < x.y + 200);
        if (g) n.groupNodeId = g.id;
      }
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
    const kind = ev.dataTransfer.getData("kind");
    if (!kind) return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const ctm = world.getScreenCTM().inverse();
    const p = pt.matrixTransform(ctm);
    const node = { id: tmpId(kind), kind, title: kind === "group" ? "گروه جدید" : kind === "condition" ? "شرط" : "مرحله", x: p.x, y: p.y, actionType: "Click", repeatSourceType: "None", isActive: true, framePathJson: "[]" };
    if (kind === "step") {
      const g = graph.nodes.find((x) => x.kind === "group");
      if (g) node.groupNodeId = g.id;
    }
    graph.nodes.push(node);
    selected = new Set([node.id]);
    render();
  });

  document.getElementById("btn-group").addEventListener("click", () => {
    const steps = graph.nodes.filter((n) => selected.has(n.id) && n.kind === "step");
    if (steps.length === 0) { status.textContent = "چند مرحله را انتخاب کنید"; return; }
    const g = { id: tmpId("group"), kind: "group", title: "گروه حلقه", x: Math.min(...steps.map((s) => s.x)) - 20, y: Math.min(...steps.map((s) => s.y)) - 50, repeatSourceType: "DataSource", moveLoop: false };
    graph.nodes.push(g);
    steps.forEach((s) => { s.groupNodeId = g.id; });
    selected = new Set([g.id]);
    status.textContent = "گروه ساخته شد — منبع تکرار را تنظیم کنید";
    render();
  });

  document.getElementById("btn-save").addEventListener("click", save);
  document.getElementById("btn-fit").addEventListener("click", () => {
    graph.viewport = { x: 40, y: 40, zoom: 1 };
    render();
  });
  document.getElementById("tab-diagram").addEventListener("click", () => setView("diagram"));
  document.getElementById("tab-list").addEventListener("click", () => setView("list"));

  function setView(v) {
    view = v;
    document.getElementById("tab-diagram").classList.toggle("on", v === "diagram");
    document.getElementById("tab-list").classList.toggle("on", v === "list");
    svg.style.display = v === "diagram" ? "" : "none";
    listWrap.hidden = v !== "list";
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Delete" || ev.key === "Backspace") {
      const ids = selected;
      graph.nodes = graph.nodes.filter((n) => n.kind === "start" || !ids.has(n.id));
      graph.edges = graph.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
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
