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
  const canvasScroll = document.getElementById("canvas-scroll") || wrap;
  const gridRect = document.getElementById("canvas-grid") || svg?.querySelector("rect");
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
  const inspHeading = document.getElementById("insp-heading");

  const ACTION_LABELS = {
    NoAction: "بدون اقدام",
    Click: "کلیک",
    DoubleClick: "دبل‌کلیک",
    RightClick: "کلیک راست",
    Hover: "هاور",
    Enter: "اینتر",
    InputContent: "ورود متن",
    InsertContent: "درج محتوا",
    LoadContent: "بارگذاری محتوا",
    SaveContent: "ذخیره محتوا",
    TakeContent: "خواندن محتوا",
    GoToUrl: "رفتن به آدرس",
    NewPage: "تب جدید",
    CloseFirstTab: "بستن تب اول",
    CloseLastTab: "بستن تب آخر",
    WaitTime: "انتظار زمانی",
    WaitForLoading: "انتظار بارگذاری",
    Refresh: "بارگذاری مجدد"
  };
  const ACTIONS = Object.keys(ACTION_LABELS);

  function isActionNode(n) {
    return !!n && (n.kind === "action" || n.kind === "step");
  }
  function actionTypeLabel(at) {
    return ACTION_LABELS[at] || at || "اقدام";
  }
  function migrateActionKinds(g) {
    (g?.nodes || []).forEach((n) => {
      if (isActionNode(n)) n.kind = "action";
    });
  }

  let graph = {
    nodes: [], edges: [], viewport: { x: 40, y: 40, zoom: 1 }, title: "",
    dataSources: [], delayBeforeMs: 0, delayAfterMs: 0, canModify: true
  };
  let selected = new Set();
  let selectedEdgeId = null;
  let view = "diagram";
  let editingGroupId = null;
  /** Stack of parent group ids when drilling into nested group designers. */
  let editStack = [];
  /** Per-scope viewport: "root" | groupId → {x,y,zoom} */
  let scopeViewports = {};
  let dragging = null;
  let panning = null;
  let linking = null;
  let retargetHideId = null;
  /** Pending tip grab before drag threshold — avoids click canceling retarget. */
  let tipDrag = null;
  let linkGestureSeq = 0;
  let dragMoved = false;
  let suppressClickUntil = 0;
  const DRAG_THRESHOLD = 4;

  const ns = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };

  const nodeById = (id) => graph.nodes.find((n) => n.id === id);
  const tmpId = (kind) => `tmp-${kind}-${Date.now()}-${Math.floor(Math.random() * 999)}`;
  const stepsOf = (gid) => graph.nodes.filter((n) => isActionNode(n) && n.groupNodeId === gid);

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

  function enforceSingleStartOut() {
    const start = graph.nodes.find((n) => n.kind === "start");
    if (!start) return;
    const outs = (graph.edges || []).filter((e) => e.from === start.id && e.kind !== "contains");
    if (outs.length <= 1) return;
    const keep = outs[0];
    graph.edges = graph.edges.filter((e) => e.from !== start.id || e.id === keep.id);
  }

  function applyLocalGraph(local) {
    graph = structuredClone ? structuredClone(local.graph) : JSON.parse(JSON.stringify(local.graph));
    graph.taskId = Number(taskId) || taskId;
    graph.nodes ||= [];
    graph.edges ||= [];
    graph.viewport ||= { x: 40, y: 40, zoom: 1 };
    graph.dataSources ||= [];
    graph.delayBeforeMs = graph.delayBeforeMs ?? local.delayBeforeMs ?? 0;
    graph.delayAfterMs = graph.delayAfterMs ?? local.delayAfterMs ?? 0;
    graph.repeatSourceType = graph.repeatSourceType || "None";
    const start = graph.nodes.find((n) => n.kind === "start");
    if (start) {
      start.repeatSourceType = start.repeatSourceType || graph.repeatSourceType || "None";
      if (start.dataSourceId == null && graph.dataSourceId != null) start.dataSourceId = graph.dataSourceId;
      if (start.loopCount == null && graph.loopCount != null) start.loopCount = graph.loopCount;
    }
    graph.canModify = true;
    graph.designOrigin = local.designOrigin || graph.designOrigin || "Manual";
    migrateActionKinds(graph);
    enforceSingleStartOut();
    titleEl.textContent = graph.title || local.title || "گردش کار";
    if (originEl) {
      const recorded = String(graph.designOrigin || "").toLowerCase() === "recorded";
      originEl.className = "origin-badge " + (recorded ? "recorded" : "manual");
      originEl.textContent = recorded ? "ویرایش: از رکورد" : "ویرایش: دستی";
    }
    const steps = graph.nodes.filter((n) => isActionNode(n)).length;
    const groups = graph.nodes.filter((n) => n.kind === "group");
    status.textContent = steps
      ? `${steps} اقدام — روی گروه دبل‌کلیک کنید تا اقدام‌ها را ببینید`
      : "آماده ویرایش (ذخیره محلی)";
    renderDataSources();
    render();
    // Stay on diagram so single-click shows properties; user opens children via double-click.
  }

  function emptyShell() {
    graph = {
      taskId: Number(taskId) || taskId,
      title: "فرآیند محلی",
      canModify: true,
      designOrigin: "Manual",
      viewport: { x: 40, y: 40, zoom: 1 },
      nodes: [{
        id: "start", kind: "start", title: "شروع", x: 40, y: 220,
        repeatSourceType: "None", loopCount: 1, moveLoop: false
      }],
      edges: [],
      dataSources: [],
      delayBeforeMs: 0,
      delayAfterMs: 0,
      repeatSourceType: "None"
    };
    titleEl.textContent = graph.title;
    status.textContent = "در حال دریافت از حافظهٔ محلی...";
    renderDataSources();
    render();
  }

  function graphStepCount(g) {
    return (g?.nodes || []).filter((n) => isActionNode(n)).length;
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

  const SAVE_ICON_SVG = `<svg class="btn-canvas-save-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>`;
  const SAVE_SPINNER_HTML = `<span class="btn-save-spinner" aria-hidden="true"></span><span>در حال ذخیره…</span>`;
  let saving = false;

  function saveButtons() {
    return [
      document.getElementById("btn-save"),
      document.getElementById("btn-canvas-save")
    ].filter(Boolean);
  }

  function setSaveButtonsBusy(busy) {
    saveButtons().forEach((btn) => {
      if (busy) {
        if (!btn.dataset.saveHtml) btn.dataset.saveHtml = btn.innerHTML;
        btn.classList.add("is-saving");
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        btn.innerHTML = SAVE_SPINNER_HTML;
      } else {
        btn.classList.remove("is-saving");
        btn.removeAttribute("aria-busy");
        if (btn.dataset.saveHtml) {
          btn.innerHTML = btn.dataset.saveHtml;
          delete btn.dataset.saveHtml;
        } else if (btn.id === "btn-canvas-save") {
          btn.innerHTML = `${SAVE_ICON_SVG}<span>ذخیره</span>`;
        } else if (btn.id === "btn-save") {
          btn.innerHTML = `${SAVE_ICON_SVG}<span>ذخیره</span>`;
        } else {
          btn.textContent = "ذخیره";
        }
        if (canModify) btn.disabled = false;
      }
    });
  }

  async function save() {
    if (!canModify || saving) return;
    saving = true;
    setSaveButtonsBusy(true);
    try {
      const orphan = graph.nodes.filter((n) => isActionNode(n) && !n.groupNodeId);
      // Free diagram steps are intentional — only warn if nothing can run them.
      void orphan;

      graph.taskId = Number(taskId);
      const tasks = readLocalTasks();
      const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
      const stepCount = graph.nodes.filter((n) => isActionNode(n)).length;
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
      // Brief pause so the button loader is perceptible for local save.
      await new Promise((r) => setTimeout(r, 450));
      render();
    } catch (err) {
      status.textContent = "خطا در ذخیره";
      console.error(err);
    } finally {
      saving = false;
      setSaveButtonsBusy(false);
    }
  }

  function masterDataSourceId() {
    const start = processStart();
    return start?.dataSourceId ?? graph.dataSourceId ?? null;
  }

  function setMasterDataSource(sourceId) {
    const id = sourceId ? Number(sourceId) : null;
    const start = processStart();
    if (start) start.dataSourceId = id;
    graph.dataSourceId = id;
  }

  function renderDataSources() {
    const listEl = document.getElementById("ds-list");
    if (!listEl) return;
    const list = graph.dataSources || [];
    const masterId = masterDataSourceId();
    if (!list.length) {
      listEl.innerHTML = `<li class="ds-meta" style="background:transparent;padding:0">هنوز منبعی اضافه نشده — فایل اکسل را از بالا بیفزایید.</li>`;
      return;
    }
    listEl.innerHTML = list.map((d) => {
      const keys = (d.columnKeys || (d.columns || []).map((c) => c.key) || []).join("، ") || "—";
      const isMaster = Number(d.id) === Number(masterId);
      return `<li data-id="${d.id}" class="${isMaster ? "ds-is-master" : ""}">
        <span class="ds-title">${esc(d.title)}${isMaster ? `<span class="ds-badge-master">مادر</span>` : ""}</span>
        <div class="ds-meta">${d.columnCount || 0} ستون · ${d.rowCount || 0} ردیف${isMaster ? " · تکرار کل فرآیند" : " · قابل استفاده در گروه‌ها"}</div>
        <div class="ds-keys">${esc(keys)}</div>
        ${canModify ? `<div class="ds-actions">
          ${isMaster
            ? `<button type="button" class="btn-flow btn-ghost" disabled>دیتاسورس مادر</button>`
            : `<button type="button" class="btn-flow btn-ghost ds-set-master" data-id="${d.id}">تنظیم به‌عنوان مادر</button>`}
          <button type="button" class="btn-flow btn-ghost ds-del" data-id="${d.id}">حذف</button>
        </div>` : ""}
      </li>`;
    }).join("");
    listEl.querySelectorAll(".ds-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteDataSource(Number(btn.dataset.id));
      });
    });
    listEl.querySelectorAll(".ds-set-master").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setMasterDataSource(Number(btn.dataset.id));
        const start = graph.nodes.find((n) => n.kind === "start");
        if (start && (start.repeatSourceType || graph.repeatSourceType) !== "DataSource") {
          start.repeatSourceType = "DataSource";
          graph.repeatSourceType = "DataSource";
        }
        await save();
        renderInspector();
        render();
      });
    });
  }

  function nextDataSourceId() {
    const ids = (graph.dataSources || []).map((d) => Number(d.id) || 0);
    const base = Date.now() % 1e9;
    let id = base;
    while (ids.includes(id)) id += 1;
    return id;
  }

  async function uploadDataSource() {
    if (!canModify) return;
    const fileInp = document.getElementById("ds-file");
    const titleInp = document.getElementById("ds-title");
    const statusEl = document.getElementById("ds-status");
    const file = fileInp?.files?.[0];
    if (!file) {
      if (statusEl) statusEl.textContent = "یک فایل اکسل انتخاب کنید.";
      return;
    }
    if (statusEl) statusEl.textContent = "در حال خواندن اکسل...";
    const fd = new FormData();
    fd.append("file", file);
    const title = (titleInp?.value || "").trim() || file.name.replace(/\.(xlsx|xlsm)$/i, "");
    fd.append("title", title);
    try {
      const res = await fetch("/Tasks/ParseExcel", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (statusEl) statusEl.textContent = data.message || "خطا در خواندن اکسل";
        return;
      }
      graph.dataSources = graph.dataSources || [];
      const entry = {
        id: nextDataSourceId(),
        title: data.suggestedTitle || title,
        columnCount: data.columnCount || 0,
        rowCount: data.rowCount || 0,
        columnKeys: data.columnKeys || (data.columns || []).map((c) => c.key),
        columns: data.columns || [],
        cells: data.cells || []
      };
      graph.dataSources.push(entry);
      if (titleInp) titleInp.value = "";
      if (fileInp) fileInp.value = "";
      if (statusEl) statusEl.textContent = `منبع «${entry.title}» اضافه شد (${entry.rowCount} ردیف).`;
      await save();
      renderInspector();
      render();
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message || "خطا در ارتباط با سرور";
    }
  }

  async function deleteDataSource(sourceId) {
    if (!canModify || !sourceId) return;
    graph.dataSources = (graph.dataSources || []).filter((d) => d.id !== sourceId);
    if (Number(masterDataSourceId()) === Number(sourceId)) setMasterDataSource(null);
    graph.nodes.forEach((n) => {
      if (n.kind !== "start" && Number(n.dataSourceId) === Number(sourceId)) n.dataSourceId = null;
      if (Number(n.sourceId) === Number(sourceId)) n.sourceId = null;
      if (Number(n.selectorDataSourceId) === Number(sourceId)) n.selectorDataSourceId = null;
    });
    const statusEl = document.getElementById("ds-status");
    if (statusEl) statusEl.textContent = "منبع حذف شد — ذخیره شد.";
    await save();
    renderInspector();
  }

  function dataSourcesPanelHtml() {
    const count = (graph.dataSources || []).length;
    const disabled = canModify ? "" : "disabled";
    return `
      <div class="insp-section-title">منابع داده فرآیند (${count})</div>
      <p class="palette-hint" style="margin:0 0 8px;line-height:1.7">
        اکسل‌ها اینجا اضافه می‌شوند. یکی را به‌عنوان <b>مادر</b> برای تکرار کل برگزینید؛
        بقیه در گروه‌ها و مراحل قابل انتخاب‌اند.
      </p>
      <div class="insp-field">
        <label>عنوان منبع</label>
        <input type="text" id="ds-title" placeholder="مثلاً مشتریان" ${disabled} />
      </div>
      <div class="insp-field">
        <label>فایل اکسل</label>
        <input type="file" id="ds-file" accept=".xlsx,.xlsm" ${disabled} />
      </div>
      <button type="button" class="btn-flow" id="btn-ds-upload" style="width:100%" ${disabled}>افزودن منبع از اکسل</button>
      <div id="ds-status" class="ds-status"></div>
      <ul class="ds-list" id="ds-list"></ul>
    `;
  }

  function processPropsHtml() {
    const disabled = canModify ? "" : "disabled";
    const start = graph.nodes.find((n) => n.kind === "start");
    const rst = start?.repeatSourceType || graph.repeatSourceType || "None";
    const master = (graph.dataSources || []).find((d) => Number(d.id) === Number(masterDataSourceId()));
    const count = (graph.dataSources || []).length;
    return `
      <div class="insp-field"><label>عنوان فرآیند</label>
        <input data-task-k="title" value="${esc(graph.title || "")}" ${disabled} /></div>
      <div class="insp-field"><label>تأخیر قبل (ms)</label>
        <input type="number" min="0" data-task-k="delayBeforeMs" value="${Number(graph.delayBeforeMs) || 0}" ${disabled} /></div>
      <div class="insp-field"><label>تأخیر بعد (ms)</label>
        <input type="number" min="0" data-task-k="delayAfterMs" value="${Number(graph.delayAfterMs) || 0}" ${disabled} /></div>
      <div class="insp-section-title">منابع و تکرار</div>
      <p class="palette-hint" style="margin:0 0 8px;line-height:1.7">
        مدیریت اکسل، دیتاسورس <b>مادر</b> و تکرار کلی روی نود <b>شروع</b>
        (فعلی: ${esc(repeatTypeLabel(rst))}
        ${master ? ` · مادر: «${esc(master.title)}»` : count ? " · مادر انتخاب نشده" : ""} · ${count} منبع).
      </p>
      <button type="button" class="btn-flow" id="insp-goto-start" style="width:100%">باز کردن نود شروع</button>
    `;
  }

  function bindProcessProps() {
    inspector.querySelectorAll("[data-task-k]").forEach((inp) => {
      const apply = () => {
        const k = inp.dataset.taskK;
        if (k === "title") {
          graph.title = inp.value;
          titleEl.textContent = graph.title || "گردش کار";
        } else if (k === "delayBeforeMs" || k === "delayAfterMs") {
          graph[k] = Math.max(0, Number(inp.value) || 0);
        }
      };
      inp.addEventListener("change", apply);
      inp.addEventListener("blur", apply);
    });
    document.getElementById("insp-goto-start")?.addEventListener("click", () => {
      const start = graph.nodes.find((n) => n.kind === "start");
      if (!start) return;
      selected.clear();
      selected.add(start.id);
      render();
    });
  }

  function bindDataSourcesPanel() {
    document.getElementById("btn-ds-upload")?.addEventListener("click", uploadDataSource);
    renderDataSources();
  }

  function sizeOf(n) {
    if (n.kind === "start") return { w: 84, h: 84 };
    if (n.kind === "group") return groupBoxSize(n);
    if (n.kind === "condition") return { w: 140, h: 84 };
    if (isActionNode(n)) return stepBoxSize(n);
    return { w: 120, h: 44 };
  }

  /** Free (diagram) actions vs actions nested inside a group. */
  function isDiagramStep(n) {
    return isActionNode(n) && !n.groupNodeId;
  }

  function currentScopeId() {
    return editingGroupId || null;
  }

  function nodeScopeId(n) {
    return n?.groupNodeId || null;
  }

  /** True if node belongs to the canvas currently being edited. */
  function inCurrentScope(n) {
    if (!n) return false;
    return nodeScopeId(n) === currentScopeId();
  }

  function scopedNodes() {
    return graph.nodes.filter(inCurrentScope);
  }

  function scopedEdges() {
    return (graph.edges || []).filter((e) => {
      if (e.kind === "contains" || e.kind === "parent") return false;
      const a = nodeById(e.from);
      const b = nodeById(e.to);
      return inCurrentScope(a) && inCurrentScope(b);
    });
  }

  function processStart() {
    return graph.nodes.find((n) => n.kind === "start" && !n.groupNodeId) || null;
  }

  function scopeStart(gid) {
    const id = gid === undefined ? currentScopeId() : gid;
    if (!id) return processStart();
    return graph.nodes.find((n) => n.kind === "start" && n.groupNodeId === id) || null;
  }

  /** Ensure a start node exists inside a group designer (entry of that scope). */
  function ensureGroupStart(gid) {
    if (!gid) return null;
    let s = scopeStart(gid);
    if (!s) {
      s = {
        id: `gstart-${gid}`,
        kind: "start",
        title: "شروع",
        groupNodeId: gid,
        x: 48,
        y: 80,
        repeatSourceType: "None",
        isActive: true
      };
      graph.nodes.push(s);
    }
    const hasOut = graph.edges.some((e) => e.from === s.id && e.kind === "next");
    if (!hasOut) {
      const contains = graph.edges.find((e) => e.from === gid && e.kind === "contains");
      if (contains && nodeById(contains.to)) {
        graph.edges.push({ id: tmpId("e"), from: s.id, to: contains.to, kind: "next" });
      }
    }
    return s;
  }

  function isFlowTarget(n) {
    return !!n && (n.kind === "group" || n.kind === "condition" || isActionNode(n));
  }

  /** Compact orange action box: icon (right) + title — width always fits full title. */
  function stepBoxSize(n) {
    const label = String(n.title || actionTypeLabel(n.actionType) || "اقدام").trim() || "اقدام";
    const fontSize = 11;
    const padL = 8;
    const padR = 8;
    const iconSize = 20;
    const gap = 8;
    const textW = measureSvgTextWidth(label, fontSize, "600");
    const w = Math.max(108, Math.ceil(textW + padL + padR + iconSize + gap + 2));
    return { w, h: 40, padL, padR, iconSize, gap, fontSize };
  }

  let _measureCanvas = null;
  function measureSvgTextWidth(text, fontSize = 11, weight = "400") {
    try {
      if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
      const ctx = _measureCanvas.getContext("2d");
      if (!ctx) throw new Error("no-ctx");
      ctx.font = `${weight} ${fontSize}px Vazirmatn, Tahoma, sans-serif`;
      return ctx.measureText(String(text || "")).width;
    } catch {
      return String(text || "").length * fontSize * 0.72;
    }
  }

  /** Keep full action title (box width already fits). */
  function fitActionLabel(text) {
    return String(text || "اقدام").trim() || "اقدام";
  }

  const STEP_STROKE = "#ff9f43";
  const STEP_FILL = "#fff8f0";
  const COND_STROKE = "#8b9098";
  const COND_FILL = "#eceff2";
  /** Root process start — strong green */
  const START_FILL_ROOT = "#159a55";
  const START_STROKE_ROOT = "#0d7a40";
  /** Nested group start — softer / faded green */
  const START_FILL_NESTED = "#b7e5c8";
  const START_STROKE_NESTED = "#7bc99a";

  function startFill(n) {
    return n?.groupNodeId ? START_FILL_NESTED : START_FILL_ROOT;
  }

  function startStroke(n) {
    return n?.groupNodeId ? START_STROKE_NESTED : START_STROKE_ROOT;
  }

  function defaultStrokeFor(n) {
    if (!n) return "#e4e1f5";
    if (n.kind === "start") return startStroke(n);
    if (n.kind === "group") return "#9b92f8";
    if (isActionNode(n)) return STEP_STROKE;
    if (n.kind === "condition") return COND_STROKE;
    return "#e4e1f5";
  }

  /** Selection thickens the border only — never changes stroke color. */
  function strokeWidthFor(n, isOn) {
    if (n?.kind === "condition") return isOn ? 3.4 : 2.4;
    if (n?.kind === "group") return isOn ? 2.55 : 1.45;
    if (n?.kind === "start") {
      const base = n.groupNodeId ? 2 : 2.5;
      return isOn ? base + 1.2 : base;
    }
    if (isActionNode(n)) return isOn ? 3.15 : 2;
    return isOn ? 3 : 2;
  }

  /** SVG path fragments (viewBox 0 0 24 24) for action-type icons on diagram boxes. */
  function actionTypeIconSpec(at) {
    const stroke = { fill: "none", stroke: STEP_STROKE, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
    switch (at) {
      case "Click":
        return [{ d: "M9 4l2 12 2.5-3.5L17 16l1.5-1.5-3.5-2.5L18 9z", ...stroke, fill: STEP_STROKE, "fill-opacity": .15 }];
      case "DoubleClick":
        return [
          { d: "M8 5l1.6 9 2-2.8L15 14l1.2-1.2-2.8-2L16 8z", ...stroke },
          { d: "M6 18h4M14 18h4", ...stroke }
        ];
      case "RightClick":
        return [
          { d: "M9 4l2 12 2.5-3.5L17 16l1.5-1.5-3.5-2.5L18 9z", ...stroke },
          { d: "M18 6v4", ...stroke }
        ];
      case "Hover":
        return [{ d: "M8 14c2-6 6-8 10-6M10 18h8", ...stroke }];
      case "Enter":
        return [{ d: "M5 12h10M12 8l4 4-4 4M5 7v10", ...stroke }];
      case "InputContent":
        return [{ d: "M5 7h14v10H5zM8 17v2M16 17v2M9 12h6", ...stroke }];
      case "InsertContent":
      case "LoadContent":
        return [{ d: "M12 5v10M8 11l4 4 4-4M6 19h12", ...stroke }];
      case "SaveContent":
        return [{ d: "M6 5h10l2 2v12H6zM9 5v4h6V5M9 14h6", ...stroke }];
      case "TakeContent":
        return [{ d: "M8 7h8v6H8zM10 17h4M12 13v4", ...stroke }];
      case "GoToUrl":
      case "Navigate":
        return [{ d: "M10 14l4-4M8 12a4 4 0 105.5 3.5M16 12a4 4 0 10-5.5-3.5", ...stroke }];
      case "NewPage":
        return [{ d: "M8 5h6l3 3v11H8zM14 5v3h3M11 12h4M11 15h3", ...stroke }];
      case "CloseFirstTab":
      case "CloseLastTab":
        return [{ d: "M7 7l10 10M17 7L7 17", ...stroke }];
      case "WaitTime":
        return [{ d: "M12 7v5l3 2M12 4a8 8 0 110 16 8 8 0 010-16z", ...stroke }];
      case "WaitForLoading":
        return [{ d: "M12 5a7 7 0 11-5 2", ...stroke }, { d: "M7 5h.01", ...stroke, "stroke-width": 2.4 }];
      case "Refresh":
        return [{ d: "M6 12a6 6 0 0110-4.2M18 12a6 6 0 01-10 4.2M16 5v4h4M8 19v-4H4", ...stroke }];
      default:
        return [{ d: "M8 8h8v8H8z", ...stroke }];
    }
  }

  function appendActionTypeIcon(parent, n, boxW, boxH, layout) {
    const size = layout?.iconSize || 20;
    const padR = layout?.padR ?? 8;
    const x = boxW - padR - size;
    const y = (boxH - size) / 2;
    const scale = size / 24;
    const g = el("g", {
      class: "action-type-ico",
      transform: `translate(${x},${y}) scale(${scale})`,
      "aria-label": actionTypeLabel(n.actionType)
    });
    const tip = document.createElementNS(ns, "title");
    tip.textContent = actionTypeLabel(n.actionType);
    g.appendChild(tip);
    actionTypeIconSpec(n.actionType || "Click").forEach((spec) => {
      const { d, ...attrs } = spec;
      g.appendChild(el("path", { d, ...attrs }));
    });
    parent.appendChild(g);
  }

  /** Single-line group title; overflow → ellipsis (no wrap). */
  function fitGroupTitle(text, maxW, fontSize = 13) {
    const raw = String(text || "گروه").trim() || "گروه";
    const charW = fontSize * 0.58;
    const maxChars = Math.max(5, Math.floor(maxW / charW));
    if (raw.length <= maxChars) return raw;
    return raw.slice(0, Math.max(3, maxChars - 1)) + "…";
  }

  /** Direct children inside a group (exclude start). */
  function groupChildCounts(gid) {
    let actions = 0;
    let conditions = 0;
    let groups = 0;
    for (const x of graph.nodes || []) {
      if (x.groupNodeId !== gid || x.kind === "start") continue;
      if (isActionNode(x)) actions += 1;
      else if (x.kind === "condition") conditions += 1;
      else if (x.kind === "group") groups += 1;
    }
    return { actions, conditions, groups };
  }

  function groupMetaText(gid) {
    const { actions, conditions, groups } = groupChildCounts(gid);
    return `${actions} اقدام · ${conditions} شرط · ${groups} گروه`;
  }

  /** Group box: tighter side pad, bold single-line title, spaced meta counts. */
  function groupBoxSize(n) {
    const baseW = 200;
    const padX = 10;
    const titleFs = 13;
    const title = n.title || "گروه";
    const charW = titleFs * 0.58;
    const idealW = Math.ceil(title.length * charW + padX * 2);
    const meta = groupMetaText(n.id);
    const metaW = Math.ceil(meta.length * 10 * 0.55 + padX * 2);
    const w = Math.min(300, Math.max(baseW, idealW, metaW));
    const titleLine = fitGroupTitle(title, w - padX * 2, titleFs);
    const topPad = 11;
    const titleH = 16;
    const metaGap = 8;
    const metaH = 12;
    const bottomPad = 11;
    const h = topPad + titleH + metaGap + metaH + bottomPad;
    return { w, h, titleLine, titleFs, metaGap };
  }

  /** Label lines used both for sizing and drawing. */
  function groupLabelLines(n) {
    const { titleLine, titleFs, metaGap } = groupBoxSize(n);
    return {
      lines: [
        {
          text: titleLine,
          size: titleFs,
          fill: "#4b465c",
          weight: "700",
          leading: 0
        },
        {
          text: groupMetaText(n.id),
          size: 10,
          fill: "#6f6b7d",
          weight: "400",
          leading: metaGap + 12
        }
      ]
    };
  }

  /** Shrink / trim condition title so it stays inside the diamond. */
  function fitConditionLabel(text, boxW) {
    const raw = String(text || "شرط").trim() || "شرط";
    const maxW = boxW * 0.5; // usable band near diamond center
    const charFactor = 0.62; // Vazirmatn approx width/em
    let fontSize = 12;
    while (fontSize > 8 && raw.length * fontSize * charFactor > maxW) fontSize -= 1;
    let display = raw;
    const maxChars = Math.max(4, Math.floor(maxW / (fontSize * charFactor)));
    if (display.length > maxChars) {
      display = display.slice(0, Math.max(3, maxChars - 1)) + "…";
    }
    return { text: display, fontSize };
  }

  function scopedContentBounds() {
    const nodes = typeof scopedNodes === "function" ? scopedNodes() : (graph.nodes || []);
    const pad = 120;
    if (!nodes.length) {
      return { minX: -pad, minY: -pad, maxX: pad + 640, maxY: pad + 420 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((n) => {
      const s = sizeOf(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + s.w);
      maxY = Math.max(maxY, n.y + s.h);
    });
    return {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad
    };
  }

  function applyVp() {
    const z = Math.min(2.2, Math.max(0.35, graph.viewport.zoom || 1));
    graph.viewport.zoom = z;
    const b = scopedContentBounds();
    graph.viewport.contentOrigin = { x: b.minX, y: b.minY };
    const offX = graph.viewport.fitOffset?.x || 0;
    const offY = graph.viewport.fitOffset?.y || 0;
    // World → SVG: fitOffset (centering) + (x - origin) * zoom
    world.setAttribute(
      "transform",
      `translate(${offX - b.minX * z},${offY - b.minY * z}) scale(${z})`
    );

    const viewW = canvasScroll.clientWidth || wrap.clientWidth || 800;
    const viewH = canvasScroll.clientHeight || wrap.clientHeight || 600;
    const contentW = Math.max(viewW, Math.ceil((b.maxX - b.minX) * z + offX));
    const contentH = Math.max(viewH, Math.ceil((b.maxY - b.minY) * z + offY));
    svg.style.width = `${contentW}px`;
    svg.style.height = `${contentH}px`;
    svg.setAttribute("width", String(contentW));
    svg.setAttribute("height", String(contentH));
    if (gridRect) {
      gridRect.setAttribute("width", String(contentW));
      gridRect.setAttribute("height", String(contentH));
    }

    // Restore scroll if stored on viewport (used when switching scopes)
    if (graph.viewport._pendingScroll) {
      const ps = graph.viewport._pendingScroll;
      canvasScroll.scrollLeft = ps.x || 0;
      canvasScroll.scrollTop = ps.y || 0;
      delete graph.viewport._pendingScroll;
    }
  }

  /**
   * «نمایش کامل»:
   * 1) sync diagram surface to the current canvas area (after panels)
   * 2) zoom so all nodes fit inside that area, then center
   */
  function fitDiagramToView() {
    if (!canvasScroll || view !== "diagram") return;
    // Drop letterbox from a previous fit; we'll recompute.
    delete graph.viewport.fitOffset;

    // Step 1 — size the SVG/scroll surface to the live viewport (zoom unchanged briefly).
    applyVp();

    const viewW = Math.max(80, canvasScroll.clientWidth || wrap.clientWidth || 800);
    const viewH = Math.max(80, canvasScroll.clientHeight || wrap.clientHeight || 600);
    const b = scopedContentBounds();
    const contentW = Math.max(1, b.maxX - b.minX);
    const contentH = Math.max(1, b.maxY - b.minY);

    const margin = 28;
    const availW = Math.max(40, viewW - margin * 2);
    const availH = Math.max(40, viewH - margin * 2);
    let z = Math.min(availW / contentW, availH / contentH);
    z = Math.min(2.2, Math.max(0.35, z));
    graph.viewport.zoom = z;

    const scaledW = contentW * z;
    const scaledH = contentH * z;
    // Center when content is smaller than the canvas; otherwise scroll to center.
    graph.viewport.fitOffset = {
      x: Math.max(0, (viewW - scaledW) / 2),
      y: Math.max(0, (viewH - scaledH) / 2)
    };
    graph.viewport._pendingScroll = {
      x: Math.max(0, (Math.max(viewW, scaledW) - viewW) / 2),
      y: Math.max(0, (Math.max(viewH, scaledH) - viewH) / 2)
    };

    // Step 2 — apply fitted zoom + centered scroll.
    applyVp();

    const key = currentScopeId() || "root";
    scopeViewports[key] = {
      zoom: graph.viewport.zoom,
      scroll: rememberScroll()
    };
  }

  /** Keep a node inside the visible scrollport when it drifts outside. */
  function ensureNodeInScrollView(n) {
    if (!n || !canvasScroll) return;
    applyVp();
    const z = graph.viewport.zoom || 1;
    const origin = graph.viewport.contentOrigin || { x: 0, y: 0 };
    const offX = graph.viewport.fitOffset?.x || 0;
    const offY = graph.viewport.fitOffset?.y || 0;
    const s = sizeOf(n);
    const left = (n.x - origin.x) * z + offX;
    const top = (n.y - origin.y) * z + offY;
    const right = (n.x + s.w - origin.x) * z + offX;
    const bottom = (n.y + s.h - origin.y) * z + offY;
    const m = 32;
    const maxSL = Math.max(0, canvasScroll.scrollWidth - canvasScroll.clientWidth);
    const maxST = Math.max(0, canvasScroll.scrollHeight - canvasScroll.clientHeight);
    if (left < canvasScroll.scrollLeft + m) {
      canvasScroll.scrollLeft = Math.max(0, left - m);
    }
    if (top < canvasScroll.scrollTop + m) {
      canvasScroll.scrollTop = Math.max(0, top - m);
    }
    if (right > canvasScroll.scrollLeft + canvasScroll.clientWidth - m) {
      canvasScroll.scrollLeft = Math.min(maxSL, right - canvasScroll.clientWidth + m);
    }
    if (bottom > canvasScroll.scrollTop + canvasScroll.clientHeight - m) {
      canvasScroll.scrollTop = Math.min(maxST, bottom - canvasScroll.clientHeight + m);
    }
  }

  function rememberScroll() {
    return { x: canvasScroll.scrollLeft || 0, y: canvasScroll.scrollTop || 0 };
  }

  function updateBackButton() {
    if (!btnBack) return;
    // Only while drilled into a group scope — never on the root diagram.
    if (!editingGroupId) {
      btnBack.hidden = true;
      return;
    }
    btnBack.hidden = false;
    const labelEl = document.getElementById("btn-back-group-label") || btnBack.querySelector("span");
    const parentId = editStack.length ? editStack[editStack.length - 1] : null;
    let label;
    let tip;
    if (parentId) {
      const parent = nodeById(parentId);
      const title = (parent?.title || "گروه").trim() || "گروه";
      label = `بازگشت به «${title}»`;
      tip = `بازگشت به گروه «${title}»`;
    } else {
      const levelTitle = (graph.title || titleEl?.textContent || "نمودار").trim() || "نمودار";
      label = `بازگشت به «${levelTitle}»`;
      tip = `بازگشت به سطح «${levelTitle}»`;
    }
    if (labelEl) labelEl.textContent = label;
    else btnBack.textContent = label;
    btnBack.title = tip;
  }

  function render() {
    const inGroup = !!editingGroupId;
    // Full toolbox at every scope (root + inside groups)
    if (paletteRoot) paletteRoot.hidden = false;
    if (paletteGroup) paletteGroup.hidden = true;
    ensurePaletteStencils();
    updateBackButton();
    document.getElementById("palette-ds")?.remove();
    document.getElementById("ds-panel")?.remove();
    svg.style.display = view === "diagram" ? "" : "none";
    listWrap.hidden = view !== "list" || inGroup;
    if (groupEdit) groupEdit.hidden = true;
    const canvasSave = document.getElementById("btn-canvas-save");
    if (canvasSave) canvasSave.hidden = view === "list" && !inGroup;
    updatePlaySelectionBtn();

    if (view === "list" && !inGroup) {
      renderList();
      renderInspector();
      return;
    }
    if (view !== "diagram") {
      renderInspector();
      return;
    }

    if (inGroup) ensureGroupStart(editingGroupId);

    applyVp();
    world.replaceChildren();
    scopedEdges().forEach(drawEdge);
    scopedNodes().forEach(drawNode);
    world.querySelectorAll("circle.edge-tip-hit, polygon.edge-tip, circle.edge-tip").forEach((t) => world.appendChild(t));
    if (!inGroup) renderList();
    renderInspector();
    const hint = document.getElementById("flow-hint");
    if (hint) {
      hint.textContent = inGroup
        ? `طراح گروه «${nodeById(editingGroupId)?.title || ""}» — گروه / شرط / اقدام مثل سطح فرآیند`
        : "گروه→شرط(OR)+گروه/اقدام · شرط→موفق/شکست · اقدام ۱ ورودی و ۱ خروجی · کادر نارنجی اقدام";
    }
  }

  function centerOf(n) {
    const s = sizeOf(n);
    return { x: n.x + s.w / 2, y: n.y + s.h / 2 };
  }

  /** Anchor on a node edge. Returns {x,y,dx,dy} where dx/dy is outward normal. */
  function anchorOn(n, side, yOffset = 0) {
    const s = sizeOf(n);
    const cx = n.x + s.w / 2;
    const cy = n.y + s.h / 2;
    switch (side) {
      case "left": return { x: n.x, y: cy + yOffset, dx: -1, dy: 0 };
      case "right": return { x: n.x + s.w, y: cy + yOffset, dx: 1, dy: 0 };
      case "top": return { x: cx, y: n.y, dx: 0, dy: -1 };
      case "bottom": return { x: cx, y: n.y + s.h, dx: 0, dy: 1 };
      default: return { x: n.x + s.w, y: cy, dx: 1, dy: 0 };
    }
  }

  /** Local diamond vertices — single source of truth for draw + edge attach. */
  function conditionDiamondLocal(w, h) {
    return [
      { lx: w / 2, ly: 2, dx: 0, dy: -1 },
      { lx: w - 2, ly: h / 2, dx: 1, dy: 0 },
      { lx: w / 2, ly: h - 2, dx: 0, dy: 1 },
      { lx: 2, ly: h / 2, dx: -1, dy: 0 }
    ];
  }

  /** Four diamond tips in world space (never the bounding-rect corners). */
  function conditionCorners(n) {
    const { w, h } = sizeOf(n);
    return conditionDiamondLocal(w, h).map((v) => ({
      x: n.x + v.lx,
      y: n.y + v.ly,
      dx: v.dx,
      dy: v.dy
    }));
  }

  const ALL_SIDES = ["left", "right", "top", "bottom"];

  /** Midpoint of the side of a rect node that faces (px,py) best. */
  function nearestSideMid(n, px, py) {
    let best = null;
    let bestScore = Infinity;
    for (const side of ALL_SIDES) {
      const a = anchorOn(n, side);
      const dist = Math.hypot(a.x - px, a.y - py);
      const face = (px - a.x) * a.dx + (py - a.y) * a.dy;
      const score = dist + (face < 0 ? 50 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best || anchorOn(n, "right");
  }

  /** Nearest diamond tip (rhombus vertex), never bbox corner. */
  function nearestConditionCorner(n, px, py) {
    const tips = conditionCorners(n);
    let best = tips[1];
    let bestScore = Infinity;
    for (const c of tips) {
      const dist = Math.hypot(c.x - px, c.y - py);
      const face = (px - c.x) * c.dx + (py - c.y) * c.dy;
      const score = dist + (face < 0 ? 25 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /**
   * Attachment:
   * - condition → only the 4 rhombus tips (not the invisible bbox corners)
   * - group/start → middle of nearest side
   */
  function attachPoint(n, px, py) {
    if (n.kind === "condition") return nearestConditionCorner(n, px, py);
    return nearestSideMid(n, px, py);
  }

  /** Perpendicular nudge so two ports on the same tip sit side-by-side. */
  function offsetAlongTipTangent(anchor, delta) {
    return {
      x: anchor.x + (-anchor.dy) * delta,
      y: anchor.y + anchor.dx * delta,
      dx: anchor.dx,
      dy: anchor.dy
    };
  }

  function sameAnchor(a, b, eps = 5) {
    return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < eps;
  }

  /** Classify a world point as one of the 4 diamond tip names. */
  function conditionTipName(n, point) {
    const tips = conditionCorners(n);
    const names = ["top", "right", "bottom", "left"];
    let best = "right";
    let bestD = Infinity;
    tips.forEach((t, i) => {
      const d = Math.hypot(t.x - point.x, t.y - point.y);
      if (d < bestD) {
        bestD = d;
        best = names[i];
      }
    });
    return best;
  }

  function conditionTipByName(n, name) {
    const tips = conditionCorners(n);
    const idx = { top: 0, right: 1, bottom: 2, left: 3 }[name] ?? 1;
    return tips[idx];
  }

  /** Sides (rect) or tip names (diamond) already used by incoming edge tips. */
  function occupiedIncomingKeys(n) {
    const keys = new Set();
    for (const e of diagramEdges()) {
      if (e.to !== n.id || e.kind === "contains" || e.kind === "parent") continue;
      const src = nodeById(e.from);
      if (!src) continue;
      const exit = roughExit(src, n, e.kind);
      const entry = attachPoint(n, exit.x, exit.y);
      if (n.kind === "condition") keys.add(conditionTipName(n, entry));
      else keys.add(detectSide(n, entry));
    }
    return keys;
  }

  function pickFreeConditionTip(n, occupied, preferNames) {
    for (const name of preferNames) {
      if (!occupied.has(name)) return conditionTipByName(n, name);
    }
    for (const name of ["top", "right", "bottom", "left"]) {
      if (!occupied.has(name)) return conditionTipByName(n, name);
    }
    return conditionTipByName(n, "top");
  }

  /**
   * Place success/fail exits toward their targets (nearest tip).
   * If both resolve to the same tip, keep them side-by-side — never stacked.
   */
  function conditionBranchExits(n) {
    const c = centerOf(n);
    const okE = diagramEdges().find((e) => e.from === n.id && e.kind === "success");
    const failE = diagramEdges().find((e) => e.from === n.id && e.kind === "fail");
    const okT = okE && nodeById(okE.to);
    const failT = failE && nodeById(failE.to);
    const okToward = okT ? centerOf(okT) : { x: c.x + 140, y: c.y - 28 };
    const failToward = failT ? centerOf(failT) : { x: c.x + 140, y: c.y + 28 };

    let success = nearestConditionCorner(n, okToward.x, okToward.y);
    let fail = nearestConditionCorner(n, failToward.x, failToward.y);

    if (sameAnchor(success, fail)) {
      success = offsetAlongTipTangent(success, -12);
      fail = offsetAlongTipTangent(fail, 12);
    }
    return { success, fail };
  }

  /**
   * Port positions for drawing: live ports follow branch routing;
   * idle (dim) ports sit on a free diamond tip — never under an incoming arrow tip.
   */
  function conditionPortsForDraw(n) {
    const occupied = occupiedIncomingKeys(n);
    const hasOk = portHasOutgoing(n.id, "success");
    const hasFail = portHasOutgoing(n.id, "fail");
    const pair = conditionBranchExits(n);

    let success;
    let fail;
    if (hasOk) {
      success = pair.success;
      occupied.add(conditionTipName(n, success));
    } else {
      success = pickFreeConditionTip(n, occupied, ["top", "right", "bottom", "left"]);
      occupied.add(conditionTipName(n, success));
    }
    if (hasFail) {
      fail = pair.fail;
      occupied.add(conditionTipName(n, fail));
    } else {
      fail = pickFreeConditionTip(n, occupied, ["bottom", "right", "top", "left"]);
      occupied.add(conditionTipName(n, fail));
    }
    if (sameAnchor(success, fail)) {
      success = offsetAlongTipTangent(success, -10);
      fail = offsetAlongTipTangent(fail, 10);
    }
    return { success, fail };
  }

  /**
   * Local (lx,ly) for rect/start out-port.
   * Live → toward actual target side; idle → free side (avoid incoming tip).
   */
  function outPortLocal(n, edgeKind = "next") {
    const live = portHasOutgoing(n.id, edgeKind);
    if (live) {
      const e = diagramEdges().find((x) => x.from === n.id && x.kind === edgeKind);
      const to = e && nodeById(e.to);
      if (to) {
        const a = attachPoint(n, centerOf(to).x, centerOf(to).y);
        return { lx: a.x - n.x, ly: a.y - n.y };
      }
    }
    const occupied = occupiedIncomingKeys(n);
    const prefer = ["right", "bottom", "top", "left"];
    const side = prefer.find((s) => !occupied.has(s)) || "right";
    const a = anchorOn(n, side);
    return { lx: a.x - n.x, ly: a.y - n.y };
  }

  /** Exit tip for a condition branch — nearest toward target, ports may sit side-by-side. */
  function conditionExitPoint(n, edgeKind, towardX, towardY) {
    if (edgeKind !== "success" && edgeKind !== "fail") {
      return nearestConditionCorner(n, towardX, towardY);
    }
    const hasEdge = diagramEdges().some((e) => e.from === n.id && e.kind === edgeKind);
    // While dragging a new branch, follow the cursor tip; keep clear of the sibling port.
    if (!hasEdge && towardX != null && towardY != null) {
      const draw = conditionPortsForDraw(n);
      const other = edgeKind === "success" ? draw.fail : draw.success;
      let tip = nearestConditionCorner(n, towardX, towardY);
      // Prefer starting from the idle port's parked tip when cursor is near it;
      // otherwise follow cursor but avoid landing on incoming tip / sibling.
      const occupied = occupiedIncomingKeys(n);
      if (occupied.has(conditionTipName(n, tip))) {
        tip = edgeKind === "success" ? draw.success : draw.fail;
      }
      if (sameAnchor(tip, other)) {
        tip = offsetAlongTipTangent(tip, edgeKind === "success" ? -12 : 12);
      }
      return tip;
    }
    const pair = conditionBranchExits(n);
    return edgeKind === "success" ? pair.success : pair.fail;
  }

  function detectSide(n, p) {
    const s = sizeOf(n);
    const dl = Math.abs(p.x - n.x);
    const dr = Math.abs(p.x - (n.x + s.w));
    const dt = Math.abs(p.y - n.y);
    const db = Math.abs(p.y - (n.y + s.h));
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return "left";
    if (m === dr) return "right";
    if (m === dt) return "top";
    return "bottom";
  }

  function offsetAlongSide(anchor, side, delta) {
    if (side === "left" || side === "right") {
      return { x: anchor.x, y: anchor.y + delta, dx: anchor.dx, dy: anchor.dy };
    }
    return { x: anchor.x + delta, y: anchor.y, dx: anchor.dx, dy: anchor.dy };
  }

  function clampOnSide(n, side, anchor) {
    const s = sizeOf(n);
    const pad = 18;
    if (side === "left" || side === "right") {
      return {
        ...anchor,
        y: Math.min(n.y + s.h - pad, Math.max(n.y + pad, anchor.y))
      };
    }
    return {
      ...anchor,
      x: Math.min(n.x + s.w - pad, Math.max(n.x + pad, anchor.x))
    };
  }

  function diagramEdges() {
    return scopedEdges();
  }

  /** Rough exit used only to classify which target side an edge would hit. */
  function roughExit(from, to, edgeKind) {
    const tc = centerOf(to);
    if (from.kind === "condition") return conditionExitPoint(from, edgeKind, tc.x, tc.y);
    return attachPoint(from, tc.x, tc.y);
  }

  /**
   * Spread multiple edges that land on the same side of a node so they don't stack.
   */
  function fanTargetAnchor(to, base, edgeId) {
    if (to.kind === "condition") return base;
    const side = detectSide(to, base);
    const peers = diagramEdges().filter((e) => {
      if (e.to !== to.id) return false;
      const src = nodeById(e.from);
      if (!src) return false;
      const exit = roughExit(src, to, e.kind);
      const entry = attachPoint(to, exit.x, exit.y);
      return detectSide(to, entry) === side;
    });
    peers.sort((a, b) => {
      const rank = (k) => (k === "success" ? 0 : k === "fail" ? 1 : 2);
      const d = rank(a.kind) - rank(b.kind);
      if (d) return d;
      return String(a.id).localeCompare(String(b.id));
    });
    const idx = peers.findIndex((e) => e.id === edgeId);
    const count = peers.length;
    if (count < 2 || idx < 0) return base;
    const s = sizeOf(to);
    const span = (side === "left" || side === "right") ? s.h - 36 : s.w - 36;
    const spacing = Math.min(32, Math.max(16, span / count));
    const delta = (idx - (count - 1) / 2) * spacing;
    return clampOnSide(to, side, offsetAlongSide(base, side, delta));
  }

  /** Exit of a node toward a world point (rubber-band + routing). */
  function nearestSideToward(n, x, y, edgeKind) {
    if (n.kind === "condition") return conditionExitPoint(n, edgeKind, x, y);
    return attachPoint(n, x, y);
  }

  /**
   * Route: condition tips / group mid-sides; fan stacked arrivals on same side.
   */
  function nearestAnchors(from, to, edgeKind, edgeId) {
    const tc = centerOf(to);
    const fc = centerOf(from);
    const a = from.kind === "condition"
      ? conditionExitPoint(from, edgeKind, tc.x, tc.y)
      : attachPoint(from, tc.x, tc.y);
    let b = attachPoint(to, a.x, a.y);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) {
      b = attachPoint(to, fc.x, fc.y);
    }
    b = fanTargetAnchor(to, b, edgeId);
    return { a, b };
  }

  function edgeAnchors(from, to, edgeKind, edgeId) {
    return nearestAnchors(from, to, edgeKind, edgeId);
  }

  function edgePath(a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const bend = Math.max(36, Math.min(120, dist * 0.45));
    const c1x = a.x + a.dx * bend;
    const c1y = a.y + a.dy * bend;
    const c2x = b.x + b.dx * bend;
    const c2y = b.y + b.dy * bend;
    return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
  }

  function edgeColor(kind, selected) {
    if (kind === "success") return selected ? "#0f9f4f" : "#28c76f";
    if (kind === "fail") return selected ? "#c62828" : "#ea5455";
    if (kind === "parent") return selected ? "#0095a8" : "#00cfe8";
    return selected ? "#4a3fd6" : "#7367f0";
  }

  function selectEdge(edgeId) {
    selectedEdgeId = edgeId || null;
    selected.clear();
    updatePlaySelectionBtn();
    highlightSelection();
    redrawEdgesOnly();
    if (edgeId) ensureInspectorExpanded();
    if (inspHeading) inspHeading.textContent = edgeId ? "اتصال انتخاب‌شده" : "ویژگی‌های فرآیند";
    if (edgeId) {
      const e = graph.edges.find((x) => x.id === edgeId);
      const a = e && nodeById(e.from);
      const b = e && nodeById(e.to);
      const kindFa = e?.kind === "success" ? "موفقیت" : e?.kind === "fail" ? "شکست" : e?.kind === "parent" ? "والد" : "بعدی";
      inspector.innerHTML = `
        <p class="palette-hint" style="margin:0 0 10px;line-height:1.7">
          اتصال <b>${kindFa}</b> از «${esc(a?.title || e?.from || "")}» به «${esc(b?.title || e?.to || "")}».
        </p>
        <p class="palette-hint" style="margin:0 0 10px">نوک فلش را بکشید تا مقصد عوض شود · <b>Delete</b> برای حذف.</p>
        <button type="button" class="btn-flow" id="btn-del-edge" style="width:100%">حذف اتصال</button>`;
      document.getElementById("btn-del-edge")?.addEventListener("click", () => {
        deleteSelectedEdge();
      });
    } else {
      renderInspector();
    }
  }

  function deleteSelectedEdge() {
    if (!selectedEdgeId) return false;
    graph.edges = graph.edges.filter((e) => e.id !== selectedEdgeId);
    selectedEdgeId = null;
    status.textContent = "اتصال حذف شد.";
    render();
    return true;
  }

  function captureSvgPointer(ev) {
    if (ev && typeof ev.pointerId === "number" && svg.setPointerCapture) {
      try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      return ev.pointerId;
    }
    return null;
  }

  /** Begin tip grab; actual retarget starts only after drag threshold. */
  function armTipRetarget(e, startAnchor, ev) {
    if (!canModify) return;
    ev.stopPropagation();
    ev.preventDefault();
    tipDrag = {
      edgeId: e.id,
      edge: e,
      startAnchor,
      mx: ev.clientX,
      my: ev.clientY,
      pointerId: captureSvgPointer(ev),
      seq: ++linkGestureSeq
    };
    selectEdge(e.id);
    status.textContent = "نوک را بکشید و روی مقصد جدید رها کنید";
  }

  function startRetargetEdge(e, startAnchor, ev, alreadyMoved = true) {
    if (!canModify) return;
    selected.clear();
    selectedEdgeId = e.id;
    updatePlaySelectionBtn();
    const pointerId = (ev && typeof ev.pointerId === "number")
      ? captureSvgPointer(ev)
      : (tipDrag && tipDrag.pointerId) || null;
    tipDrag = null;
    retargetHideId = e.id;
    linking = {
      retargetEdgeId: e.id,
      from: e.from,
      kind: e.kind,
      x1: startAnchor.x,
      y1: startAnchor.y,
      dx: startAnchor.dx || 1,
      dy: startAnchor.dy || 0,
      pointerId,
      moved: !!alreadyMoved,
      seq: ++linkGestureSeq
    };
    redrawEdgesOnly();
    ensureLinkPreview();
    const wpt = ev ? clientToWorld(ev.clientX, ev.clientY) : null;
    updateLinkPreview(
      wpt ? wpt.x : startAnchor.x + (startAnchor.dx || 1) * 28,
      wpt ? wpt.y : startAnchor.y + (startAnchor.dy || 0) * 28
    );
    wrap.classList.add("linking");
    status.textContent = "نوک فلش را روی مقصد جدید رها کنید";
  }

  /** Move an existing edge's tip to a new target node. */
  function retargetEdge(edgeId, newToId) {
    const e = graph.edges.find((x) => x.id === edgeId);
    if (!e || !canModify) return false;
    if (String(newToId) === String(e.from)) {
      status.textContent = "نمی‌توان به خود وصل کرد.";
      return false;
    }
    if (String(newToId) === String(e.to)) {
      status.textContent = "مقصد همان است.";
      return true;
    }
    const snapshot = { id: e.id, from: e.from, to: e.to, kind: e.kind };
    graph.edges = graph.edges.filter((x) => x.id !== edgeId);
    const ok = applyLink(snapshot.from, newToId, snapshot.kind);
    if (!ok) {
      graph.edges.push(snapshot);
      return false;
    }
    const neu = graph.edges.find((x) => x.from === snapshot.from && x.to === newToId && x.kind === snapshot.kind)
      || graph.edges[graph.edges.length - 1];
    if (neu) neu.id = edgeId;
    selectedEdgeId = edgeId;
    status.textContent = "مقصد اتصال تغییر کرد.";
    return true;
  }

  function drawEdge(e) {
    if (!e.id) e.id = tmpId("e");
    if (retargetHideId && e.id === retargetHideId) return;
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return;
    const { a: p1, b: p2 } = edgeAnchors(a, b, e.kind, e.id);
    const on = selectedEdgeId === e.id;
    const c = edgeColor(e.kind, on);
    const d = edgePath(p1, p2);
    const hit = el("path", {
      d,
      fill: "none",
      stroke: "transparent",
      "stroke-width": 18,
      class: "edge-hit",
      "data-eid": e.id
    });
    const p = el("path", {
      d,
      fill: "none",
      stroke: c,
      "stroke-width": on ? 3.1 : 1.65,
      class: on ? "edge edge-on" : "edge",
      "data-eid": e.id,
      "marker-end": "url(#arrow)",
      "pointer-events": "stroke"
    });
    if (e.kind === "parent") p.setAttribute("stroke-dasharray", "8 5");
    if (on) {
      p.setAttribute("filter", "none");
      const glow = el("path", {
        d,
        fill: "none",
        stroke: c,
        "stroke-width": 7,
        opacity: "0.28",
        class: "edge-glow",
        "data-eid": e.id,
        "pointer-events": "none"
      });
      world.appendChild(glow);
    }

    // Keep SVG triangle marker as the only tip visual (no white circle).
    // Transparent hit zone near the arrowhead for retarget drag.
    const tipX = p2.x - (p2.dx || 0) * 5;
    const tipY = p2.y - (p2.dy || 0) * 5;
    const tipHit = el("circle", {
      class: "edge-tip-hit",
      cx: tipX,
      cy: tipY,
      r: 14,
      fill: "transparent",
      stroke: "none",
      "data-eid": e.id,
      style: "cursor:crosshair;pointer-events:all"
    });
    const tipTitle = document.createElementNS(ns, "title");
    tipTitle.textContent = "بکشید تا مقصد عوض شود";
    tipHit.appendChild(tipTitle);

    const nearTip = (ev) => {
      const wpt = clientToWorld(ev.clientX, ev.clientY);
      return Math.hypot(wpt.x - tipX, wpt.y - tipY) < 22
        || Math.hypot(wpt.x - p2.x, wpt.y - p2.y) < 14;
    };
    const pick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (canModify && nearTip(ev)) {
        armTipRetarget(e, p1, ev);
        return;
      }
      selectEdge(e.id);
    };
    const grabTip = (ev) => {
      armTipRetarget(e, p1, ev);
    };
    hit.addEventListener("pointerdown", pick);
    p.addEventListener("pointerdown", pick);
    tipHit.addEventListener("pointerdown", grabTip);
    tipHit.addEventListener("mousedown", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    world.appendChild(hit);
    world.appendChild(p);
    world.appendChild(tipHit);
  }

  function portHasOutgoing(nodeId, edgeKind) {
    return (graph.edges || []).some((e) =>
      e.from === nodeId && e.kind === edgeKind && e.kind !== "contains" && e.kind !== "parent"
    );
  }

  function makeOutPort(nodeId, edgeKind, cx, cy, r, fill) {
    const live = portHasOutgoing(nodeId, edgeKind);
    return el("circle", {
      class: live ? "port port-live" : "port port-idle",
      "data-edge": edgeKind,
      cx, cy, r, fill,
      style: "cursor:crosshair"
    });
  }

  function drawNode(n) {
    const { w, h } = sizeOf(n);
    const actionLayout = isActionNode(n) ? stepBoxSize(n) : null;
    const g = el("g", { class: "node", "data-id": n.id, transform: `translate(${n.x},${n.y})` });
    if (selected.has(n.id)) g.classList.add("node-on");
    const fill = n.kind === "start" ? startFill(n)
      : n.kind === "group" ? "#fff"
      : n.kind === "condition" ? COND_FILL
      : isActionNode(n) ? STEP_FILL
      : "#fff";
    const stroke = defaultStrokeFor(n);
    const sw = strokeWidthFor(n, selected.has(n.id));
    if (n.kind === "condition") {
      const verts = conditionDiamondLocal(w, h);
      const pts = verts.map((v) => `${v.lx},${v.ly}`).join(" ");
      g.appendChild(el("polygon", {
        points: pts, fill, stroke,
        "stroke-width": sw
      }));
    } else {
      const rx = n.kind === "start" ? h / 2 : isActionNode(n) ? 8 : 14;
      const rectAttrs = {
        width: w, height: h, rx, fill, stroke,
        "stroke-width": sw
      };
      if (n.kind === "group") {
        rectAttrs["stroke-dasharray"] = "3.5 3.5";
      }
      g.appendChild(el("rect", rectAttrs));
    }
    let label = n.title;
    let fontSize = 12;
    let labelLines = null;
    let labelX = w / 2;
    let labelAnchor = "middle";
    if (n.kind === "group") {
      labelLines = groupLabelLines(n).lines;
      const tip = document.createElementNS(ns, "title");
      tip.textContent = "برای تغییرات داخل گروه دبل‌کلیک کنید";
      g.appendChild(tip);
    } else if (n.kind === "start") {
      label = n.groupNodeId
        ? "شروع"
        : `شروع\n${repeatTypeLabel(n.repeatSourceType || graph.repeatSourceType || "None")}`;
    } else if (n.kind === "condition") {
      const fitted = fitConditionLabel(n.title || "شرط", w);
      label = fitted.text;
      fontSize = fitted.fontSize;
    } else if (isActionNode(n)) {
      fontSize = actionLayout.fontSize || 11;
      const padR = actionLayout.padR ?? 8;
      const iconSize = actionLayout.iconSize || 20;
      const gap = actionLayout.gap ?? 8;
      const iconLeft = w - padR - iconSize;
      // Page is RTL: text-anchor "start" = right edge of glyph run → text grows left, clear of icon.
      labelX = iconLeft - gap;
      labelAnchor = "start";
      label = fitActionLabel(n.title || actionTypeLabel(n.actionType) || "اقدام");
      appendActionTypeIcon(g, n, w, h, actionLayout);
    }
    if (labelLines) {
      const t = el("text", {
        x: w / 2,
        y: 12,
        "text-anchor": "middle",
        "font-family": "Vazirmatn, Tahoma",
        "dominant-baseline": "hanging"
      });
      labelLines.forEach((line, i) => {
        const s = el("tspan", {
          x: w / 2,
          dy: i === 0 ? 0 : (line.leading || 12),
          fill: line.fill,
          "font-size": line.size,
          "font-weight": line.weight || "400"
        });
        s.textContent = line.text;
        t.appendChild(s);
      });
      g.appendChild(t);
    } else {
      const t = el("text", {
        x: labelX,
        y: n.kind === "condition" ? h / 2 + fontSize * 0.35
          : n.kind === "start" ? (n.groupNodeId ? h / 2 + 4 : 32)
          : h / 2 + fontSize * 0.35,
        "text-anchor": labelAnchor,
        fill: n.kind === "start" ? (n.groupNodeId ? "#2f6b45" : "#fff") : "#4b465c",
        "font-size": fontSize,
        "font-family": "Vazirmatn, Tahoma"
      });
      String(label || "").split("\n").forEach((line, i) => {
        const s = el("tspan", { x: labelX, dy: i === 0 ? 0 : Math.round(fontSize * 1.25) });
        s.textContent = line;
        t.appendChild(s);
      });
      g.appendChild(t);
    }
    if (n.kind === "group") {
      const p = outPortLocal(n, "next");
      g.appendChild(makeOutPort(n.id, "next", p.lx, p.ly, 7, "#7367f0"));
    } else if (n.kind === "condition") {
      const pair = conditionPortsForDraw(n);
      g.appendChild(makeOutPort(n.id, "success", pair.success.x - n.x, pair.success.y - n.y, 7, "#28c76f"));
      g.appendChild(makeOutPort(n.id, "fail", pair.fail.x - n.x, pair.fail.y - n.y, 7, "#ea5455"));
    } else if (n.kind === "start") {
      const p = outPortLocal(n, "next");
      g.appendChild(makeOutPort(
        n.id, "next", p.lx, p.ly, 7,
        n.groupNodeId ? START_STROKE_NESTED : START_STROKE_ROOT
      ));
    } else if (isActionNode(n)) {
      const p = outPortLocal(n, "next");
      g.appendChild(makeOutPort(n.id, "next", p.lx, p.ly, 6, STEP_STROKE));
    }
    if ((n.kind === "group" || n.kind === "condition" || isActionNode(n)) && canModify) {
      g.appendChild(makeCloneButton(w, h, n.kind === "condition" ? "condition" : n.kind === "group" ? "group" : "action"));
    }
    g.addEventListener("mousedown", (ev) => {
      const cloneEl = ev.target.closest && ev.target.closest(".node-clone-btn");
      if (cloneEl || (ev.target.classList && ev.target.classList.contains("node-clone-btn"))) {
        ev.stopPropagation();
        ev.preventDefault();
        cloneDiagramNode(n);
        return;
      }
      const isPort = ev.target.classList.contains("port");
      const edgeHint = isPort ? (ev.target.getAttribute("data-edge") || null) : null;
      onNodeDown(ev, n, isPort, edgeHint);
    });
    g.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      dragging = null;
      dragMoved = false;
      if (n.kind === "group") openGroup(n.id);
    });
    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      // Keep multi-select if this node is already selected; otherwise select only it.
      if (!selected.has(n.id)) selectNode(n.id, false);
      highlightSelection();
      renderInspector();
      showCtx(ev.clientX, ev.clientY, n);
    });
    world.appendChild(g);
  }

  function openGroup(id) {
    if (!id || !nodeById(id)) return;
    const prevKey = currentScopeId() || "root";
    scopeViewports[prevKey] = {
      zoom: graph.viewport.zoom || 1,
      scroll: rememberScroll()
    };
    if (editingGroupId && editingGroupId !== id) {
      editStack.push(editingGroupId);
    } else if (!editingGroupId) {
      editStack = [];
    }
    editingGroupId = id;
    ensureGroupStart(id);
    const vp = scopeViewports[id];
    delete graph.viewport.fitOffset;
    graph.viewport.zoom = vp?.zoom || 1;
    graph.viewport._pendingScroll = vp?.scroll || { x: 0, y: 0 };
    selected.clear();
    selectedEdgeId = null;
    view = "diagram";
    setViewTabs();
    render();
    status.textContent = `طراح داخل گروه «${nodeById(id)?.title || ""}»`;
  }

  function closeGroup() {
    if (editingGroupId) {
      scopeViewports[editingGroupId] = {
        zoom: graph.viewport.zoom || 1,
        scroll: rememberScroll()
      };
    }
    const parent = editStack.pop() || null;
    editingGroupId = parent;
    const key = editingGroupId || "root";
    const vp = scopeViewports[key];
    delete graph.viewport.fitOffset;
    graph.viewport.zoom = vp?.zoom || 1;
    graph.viewport._pendingScroll = vp?.scroll || { x: 0, y: 0 };
    selected.clear();
    selectedEdgeId = null;
    render();
    status.textContent = editingGroupId
      ? `طراح داخل گروه «${nodeById(editingGroupId)?.title || ""}»`
      : "نمودار فرآیند";
  }

  /** Clone icon on the left — no border/background, tone-colored glyph only. */
  function makeCloneButton(w, h, kind) {
    const size = 18;
    const x = kind === "condition" ? 4 : 5;
    const y = 5;
    const tone = kind === "group" ? "group" : kind === "condition" ? "condition" : "action";
    const color = tone === "group" ? "#9b92f8"
      : tone === "condition" ? COND_STROKE
      : STEP_STROKE;
    const btn = el("g", {
      class: "node-clone-btn",
      "data-tone": tone,
      transform: `translate(${x},${y})`,
      style: "cursor:pointer"
    });
    const tip = document.createElementNS(ns, "title");
    tip.textContent = "کپی این المان";
    btn.appendChild(tip);
    btn.appendChild(el("rect", {
      class: "clone-hit",
      width: size, height: size, rx: 4,
      fill: "transparent", stroke: "none"
    }));
    btn.appendChild(el("rect", {
      class: "clone-ico",
      x: 4, y: 6, width: 9, height: 9, rx: 1.5,
      fill: "none", stroke: color, "stroke-width": 1.45
    }));
    btn.appendChild(el("rect", {
      class: "clone-ico",
      x: 7, y: 3, width: 9, height: 9, rx: 1.5,
      fill: "none", stroke: color, "stroke-width": 1.45
    }));
    return btn;
  }

  function deepClonePlain(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Clone group / condition / action near the original.
   * Groups also copy their direct children and internal edges.
   */
  function cloneDiagramNode(src) {
    if (!canModify) return;
    if (!src || (src.kind !== "group" && src.kind !== "condition" && !isActionNode(src))) return;

    const copy = deepClonePlain(src);
    const idPrefix = src.kind === "group" ? "group"
      : src.kind === "condition" ? "condition"
      : "action";
    copy.id = tmpId(idPrefix);
    delete copy.entityId;
    const sz = sizeOf(src);
    copy.x = src.x + Math.min(72, Math.max(40, sz.w * 0.22));
    copy.y = src.y + Math.min(56, Math.max(36, sz.h * 0.35));
    const defaultTitle = src.kind === "group" ? "گروه"
      : src.kind === "condition" ? "شرط"
      : (actionTypeLabel(src.actionType) || "اقدام");
    const baseTitle = (src.title || defaultTitle).replace(/\s*\(کپی\)\s*$/, "");
    copy.title = `${baseTitle} (کپی)`;

    graph.nodes.push(copy);

    if (src.kind === "group") {
      const idMap = { [src.id]: copy.id };
      const children = (graph.nodes || []).filter((x) =>
        x.groupNodeId === src.id && x.kind !== "start"
      );
      children.forEach((st) => {
        const sc = deepClonePlain(st);
        const prefix = st.kind === "group" ? "group"
          : st.kind === "condition" ? "condition"
          : "action";
        sc.id = tmpId(prefix);
        delete sc.entityId;
        sc.groupNodeId = copy.id;
        idMap[st.id] = sc.id;
        graph.nodes.push(sc);
      });
      // Nested start for the new group
      ensureGroupStart(copy.id);
      const srcStart = scopeStart(src.id);
      const copyStart = scopeStart(copy.id);
      if (srcStart && copyStart) idMap[srcStart.id] = copyStart.id;

      const edgeSnap = [...(graph.edges || [])];
      edgeSnap.forEach((e) => {
        if (e.kind === "contains" && e.from === src.id && idMap[e.to]) {
          graph.edges.push({ id: tmpId("e"), from: copy.id, to: idMap[e.to], kind: "contains" });
          return;
        }
        const mappedFrom = idMap[e.from];
        const mappedTo = idMap[e.to];
        if (mappedFrom && mappedTo && e.kind !== "contains") {
          graph.edges.push({ id: tmpId("e"), from: mappedFrom, to: mappedTo, kind: e.kind });
        }
      });
    }

    selectedEdgeId = null;
    selected = new Set([copy.id]);
    render();
    status.textContent = `کپی «${copy.title}» نزدیک اصل ساخته شد`;
  }

  function groupCanConvertToAction(gid) {
    const { actions, conditions, groups } = groupChildCounts(gid);
    return actions === 0 && conditions === 0 && groups === 0;
  }

  /** Empty group (no action/condition) → action in place; keep id & outer edges. */
  function convertGroupToAction(g) {
    if (!canModify || !g || g.kind !== "group") return false;
    if (!groupCanConvertToAction(g.id)) return false;

    const start = scopeStart(g.id);
    if (start) {
      graph.edges = (graph.edges || []).filter((e) => e.from !== start.id && e.to !== start.id);
      graph.nodes = graph.nodes.filter((n) => n.id !== start.id);
    }
    graph.edges = (graph.edges || []).filter((e) => !(e.from === g.id && e.kind === "contains"));

    g.kind = "action";
    g.actionType = g.actionType || "Click";
    g.framePathJson = g.framePathJson || "[]";
    g.isActive = g.isActive !== false;
    delete g.repeatSourceType;
    delete g.loopCount;
    delete g.moveLoop;
    delete g.dataSourceId;

    selectedEdgeId = null;
    selected = new Set([g.id]);
    return true;
  }

  /** Action → wrap in a new group; rewire outer edges; link start→action inside. */
  function convertActionToGroup(action) {
    if (!canModify || !isActionNode(action)) return false;
    return convertActionsToGroup([action]);
  }

  /** One or more actions (same scope) → new group; outer edges rewired; start→entry. */
  function convertActionsToGroup(actions) {
    if (!canModify || !actions?.length) return false;
    const list = actions.filter(isActionNode);
    if (!list.length) return false;

    const scope = list[0].groupNodeId || null;
    if (list.some((a) => (a.groupNodeId || null) !== scope)) {
      status.textContent = "اقدام‌های انتخاب‌شده باید در یک سطح دیاگرام باشند.";
      return false;
    }

    if (list.length === 1) {
      // fall through with same logic as multi (unified)
    }

    const ids = new Set(list.map((a) => a.id));
    const minX = Math.min(...list.map((a) => a.x));
    const minY = Math.min(...list.map((a) => a.y));
    const title = list.length === 1
      ? (String(list[0].title || "گروه").trim() || "گروه")
      : `گروه (${list.length} اقدام)`;

    const gid = tmpId("group");
    const group = {
      id: gid,
      kind: "group",
      title,
      x: minX,
      y: minY,
      isActive: true,
      repeatSourceType: "None",
      loopCount: 1,
      moveLoop: true
    };
    if (scope) group.groupNodeId = scope;

    (graph.edges || []).forEach((e) => {
      const fromIn = ids.has(e.from);
      const toIn = ids.has(e.to);
      if (e.kind === "contains" || e.kind === "parent") {
        if (toIn) e.to = gid;
        return;
      }
      if (fromIn && toIn) return;
      if (!fromIn && toIn) e.to = gid;
      if (fromIn && !toIn) e.from = gid;
    });

    graph.nodes.push(group);

    const sorted = [...list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    sorted.forEach((a, i) => {
      a.groupNodeId = gid;
      a.x = 160;
      a.y = 120 + i * 56;
    });

    const hasInternalIn = new Set();
    (graph.edges || []).forEach((e) => {
      if (e.kind === "contains" || e.kind === "parent") return;
      if (ids.has(e.from) && ids.has(e.to)) hasInternalIn.add(e.to);
    });
    const entries = sorted.filter((a) => !hasInternalIn.has(a.id));
    const entry = entries[0] || sorted[0];

    const start = ensureGroupStart(gid);
    if (start && entry) {
      graph.edges = (graph.edges || []).filter((e) => !(e.from === start.id && e.kind === "next"));
      graph.edges.push({ id: tmpId("e"), from: start.id, to: entry.id, kind: "next" });
      syncGroupContainsFromStart(start.id, entry.id);
    }

    selectedEdgeId = null;
    selected = new Set([gid]);
    return true;
  }

  function selectedActionsForGroupConvert() {
    const acts = [...selected].map((id) => nodeById(id)).filter(isActionNode);
    if (!acts.length) return [];
    const scope = acts[0].groupNodeId || null;
    if (acts.some((a) => (a.groupNodeId || null) !== scope)) return null;
    // Only pure action multi-select (ignore if other kinds also selected)
    if ([...selected].some((id) => {
      const n = nodeById(id);
      return n && !isActionNode(n);
    })) return null;
    return acts;
  }

  function showCtx(x, y, n) {
    if (!ctxMenu || !n) return;
    ctxMenu.hidden = false;
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;

    const items = [
      {
        act: "props",
        label: "مشخصات",
        title: "نمایش پنل ویژگی‌ها"
      }
    ];
    if (n.kind === "group") {
      items.push({ act: "edit", label: "باز کردن طراح داخل" });
      const canConv = groupCanConvertToAction(n.id);
      items.push({
        act: "to-action",
        label: "تبدیل به مرحله",
        disabled: !canModify || !canConv,
        title: !canModify
          ? "فقط مشاهده"
          : (canConv ? "گروه خالی را به اقدام تبدیل می‌کند" : "گروه حاوی شرط یا اقدام است")
      });
    } else if (isActionNode(n)) {
      const multi = selectedActionsForGroupConvert();
      const multiOk = Array.isArray(multi) && multi.length >= 1 && multi.some((a) => a.id === n.id);
      const count = multiOk ? multi.length : 1;
      items.push({
        act: "to-group",
        label: count > 1 ? `تبدیل ${count} اقدام به گروه` : "تبدیل به گروه",
        disabled: !canModify || !multiOk,
        title: !canModify
          ? "فقط مشاهده"
          : (multiOk
            ? (count > 1 ? "اقدام‌های انتخاب‌شده را داخل یک گروه می‌برد" : "اقدام را داخل یک گروه جدید می‌برد")
            : "فقط اقدام‌های هم‌سطح را با Ctrl انتخاب کنید")
      });
    }
    items.push({ act: "select", label: "انتخاب" });

    ctxMenu.innerHTML = items.map((it) =>
      `<li data-act="${it.act}" class="${it.disabled ? "disabled" : ""}"${it.title ? ` title="${esc(it.title)}"` : ""}>${it.label}</li>`
    ).join("");

    ctxMenu.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (li.classList.contains("disabled")) return;
        ctxMenu.hidden = true;
        const act = li.dataset.act;
        if (act === "props") {
          selected = new Set([n.id]);
          highlightSelection();
          ensureInspectorExpanded();
          renderInspector();
        } else if (act === "edit") openGroup(n.id);
        else if (act === "select") { selected = new Set([n.id]); render(); }
        else if (act === "to-action") {
          if (convertGroupToAction(n)) {
            status.textContent = `«${n.title || "گروه"}» به اقدام تبدیل شد.`;
            render();
          }
        } else if (act === "to-group") {
          const multi = selectedActionsForGroupConvert();
          const list = (Array.isArray(multi) && multi.length) ? multi : [n];
          if (convertActionsToGroup(list)) {
            status.textContent = list.length > 1
              ? `${list.length} اقدام داخل گروه جدید قرار گرفت.`
              : `اقدام «${n.title || ""}» داخل گروه جدید قرار گرفت.`;
            render();
          }
        }
      });
    });
  }
  window.addEventListener("click", () => { if (ctxMenu) ctxMenu.hidden = true; });

  function renderGroupEdit() {
    return;
  }

  function createStepNode(opts = {}) {
    const scopeId = opts.groupNodeId !== undefined ? opts.groupNodeId : currentScopeId();
    const siblings = graph.nodes.filter((n) =>
      isActionNode(n) && (n.groupNodeId || null) === (scopeId || null)
    );
    const node = {
      id: tmpId("action"),
      kind: "action",
      title: opts.title || `اقدام ${siblings.length + 1}`,
      actionType: opts.actionType || "Click",
      isActive: true,
      framePathJson: "[]",
      x: opts.x ?? 120,
      y: opts.y ?? (100 + siblings.length * 48)
    };
    if (scopeId) node.groupNodeId = scopeId;
    graph.nodes.push(node);
    return node;
  }

  /** Group under a world point in the current diagram scope only. */
  function groupAtWorldInScope(wx, wy, excludeId = null) {
    for (const g of scopedNodes().filter((n) => n.kind === "group")) {
      if (excludeId && g.id === excludeId) continue;
      const s = sizeOf(g);
      if (wx >= g.x && wx <= g.x + s.w && wy >= g.y && wy <= g.y + s.h) return g;
    }
    return null;
  }

  /** Drop all edges touching a node (flow + contains). */
  function detachNodeFlowEdges(nodeId) {
    graph.edges = (graph.edges || []).filter((e) => e.from !== nodeId && e.to !== nodeId);
  }

  /** Move an existing step into a group container (sets scope + opens designer). */
  function moveStepIntoGroup(step, groupId) {
    if (!canModify || !step || step.kind !== "step") return false;
    const g = nodeById(groupId);
    if (!g || g.kind !== "group") return false;
    if (step.groupNodeId === groupId) return false;
    detachNodeFlowEdges(step.id);
    step.groupNodeId = groupId;
    step.x = 140;
    step.y = 120 + stepsOf(groupId).filter((s) => s.id !== step.id).length * 48;
    selected = new Set([step.id]);
    return true;
  }

  /** Lift step one scope up (out of its containing group). Kept for rare callers. */
  function promoteStepToParent(step) {
    if (!canModify || !step || !isActionNode(step) || !step.groupNodeId) return false;
    const parentGroup = nodeById(step.groupNodeId);
    if (!parentGroup) return false;
    const parentScope = parentGroup.groupNodeId || null;
    detachNodeFlowEdges(step.id);
    if (parentScope) step.groupNodeId = parentScope;
    else delete step.groupNodeId;
    const sz = sizeOf(parentGroup);
    step.x = parentGroup.x + sz.w + 28;
    step.y = parentGroup.y;
    selected = new Set([step.id]);
    return true;
  }

  function ensurePaletteStencils() {
    const root = paletteRoot || document.getElementById("palette-root");
    if (!root) return;
    const specs = [
      {
        kind: "group",
        title: "گروه",
        desc: "کانتینر دیاگرام داخل",
        ico: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
      },
      {
        kind: "condition",
        title: "شرط",
        desc: "شاخه موفق / شکست",
        ico: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l9 9-9 9-9-9 9-9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8v5M12 15.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
      },
      {
        kind: "action",
        title: "اقدام",
        desc: "اقدام روی صفحه",
        ico: `<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="6" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h8M14 9.5l2.5 2.5L14 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      }
    ];
    let hint = root.querySelector(":scope > .palette-hint");
    specs.forEach((spec) => {
      let s = root.querySelector(`.stencil[data-kind="${spec.kind}"]`);
      if (!s && spec.kind === "action") {
        s = root.querySelector('.stencil[data-kind="step"]');
        if (s) s.dataset.kind = "action";
      }
      if (!s) {
        s = document.createElement("div");
        s.draggable = true;
        s.dataset.kind = spec.kind;
        if (hint) root.insertBefore(s, hint);
        else root.appendChild(s);
      }
      s.className = `stencil stencil-${spec.kind}`;
      s.draggable = true;
      s.dataset.kind = spec.kind;
      if (!s.querySelector(".stencil-body")) {
        s.innerHTML = `
          <span class="stencil-ico" aria-hidden="true">${spec.ico}</span>
          <span class="stencil-body">
            <span class="stencil-title">${spec.title}</span>
            <span class="stencil-desc">${spec.desc}</span>
          </span>`;
      } else {
        const titleEl = s.querySelector(".stencil-title");
        const descEl = s.querySelector(".stencil-desc");
        if (titleEl) titleEl.textContent = spec.title;
        if (descEl) descEl.textContent = spec.desc;
      }
      if (!s.dataset.dragBound) {
        s.dataset.dragBound = "1";
        s.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData("kind", s.dataset.kind);
          ev.dataTransfer.effectAllowed = "copy";
        });
      }
    });
    if (!hint) {
      hint = document.createElement("p");
      hint.className = "palette-hint";
      root.appendChild(hint);
    }
    hint.textContent = "بکشید و روی بوم رها کنید. اقدام را می‌توانید روی یک گروه هم بیندازید.";
    const groupHint = document.querySelector("#palette-group .palette-hint");
    if (groupHint) groupHint.textContent = "تکرار از نود شروع داخل گروه تنظیم می‌شود.";
    const dsHint = document.getElementById("ds-palette-hint");
    if (dsHint) dsHint.innerHTML = "اکسل و منبع مادر روی نود <strong>شروع</strong> است.";
  }

  function addStep(groupId) {
    const gid = groupId || editingGroupId || currentScopeId();
    if (!canModify) return null;
    const g = gid ? nodeById(gid) : null;
    const node = createStepNode({
      groupNodeId: gid || null,
      x: g ? g.x + 40 : 120,
      y: g ? g.y + 80 + stepsOf(gid).length * 20 : 120
    });
    if (gid) {
      ensureGroupStart(gid);
      const contains = graph.edges.find((e) => e.from === gid && e.kind === "contains");
      if (!contains) {
        graph.edges.push({ id: tmpId("e"), from: gid, to: node.id, kind: "contains" });
      } else {
        const steps = stepsOf(gid).filter((s) => s.id !== node.id);
        const prev = steps[steps.length - 1];
        if (prev) graph.edges.push({ id: tmpId("e"), from: prev.id, to: node.id, kind: "next" });
      }
    }
    selected = new Set([node.id]);
    return node;
  }

  /** Resolve which group should receive a dropped/added step. */
  function resolveTargetGroupId(ev) {
    if (ev && svg && world.getScreenCTM) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const ctm = world.getScreenCTM().inverse();
        const p = pt.matrixTransform(ctm);
        for (const g of graph.nodes.filter((n) => n.kind === "group")) {
          const s = sizeOf(g);
          if (p.x >= g.x && p.x <= g.x + s.w && p.y >= g.y && p.y <= g.y + s.h) {
            return g.id;
          }
        }
      } catch (_) { /* ignore */ }
    }
    const selId = [...selected][0];
    if (selId && nodeById(selId)?.kind === "group") return selId;
    const groups = graph.nodes.filter((n) => n.kind === "group");
    if (groups.length === 1) return groups[0].id;
    return null;
  }

  function renderList() {
    const groups = graph.nodes.filter((n) => n.kind === "group");
    listWrap.innerHTML = groups.map((g) => {
      const steps = stepsOf(g.id);
      return `<div class="list-group">
        <div class="list-group-h" data-gid="${g.id}">
          <b>${esc(g.title)}</b>
          <span>${esc(repeatTypeLabel(g.repeatSourceType || "None"))}${g.moveLoop ? " · اندیس والد" : " · اندیس مستقل"} · ${steps.length} اقدام — دبل‌کلیک: باز کردن</span>
        </div>
        ${steps.map((s, i) => `<div class="list-step ${selected.has(s.id) ? "on" : ""}" data-id="${s.id}">
          <span>${i + 1}</span><b>${esc(actionTypeLabel(s.actionType))}</b><span>${esc(s.title)}</span>
        </div>`).join("") || `<div class="list-step">اقدامی نیست</div>`}
      </div>`;
    }).join("") || `<p style="color:#a8aaae">هنوز گروهی نیست. از جعبه ابزار «گروه» را بکشید یا رکورد ذخیره کنید.</p>`;
    listWrap.querySelectorAll(".list-step[data-id]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        selectNode(row.dataset.id, ev.shiftKey);
        render();
      });
    });
    listWrap.querySelectorAll(".list-group-h").forEach((h) => {
      h.addEventListener("click", () => {
        selectNode(h.dataset.gid, false);
        render();
      });
      h.addEventListener("dblclick", () => openGroup(h.dataset.gid));
    });
  }

  function renderInspector() {
    const id = [...selected][0];
    const n = id && nodeById(id);
    if (!n) {
      if (inspHeading) inspHeading.textContent = "ویژگی‌های فرآیند";
      inspector.innerHTML = processPropsHtml();
      bindProcessProps();
      return;
    }
    if (inspHeading) {
      inspHeading.textContent = n.kind === "group" ? "ویژگی‌های گروه"
        : isActionNode(n) ? "ویژگی‌های اقدام"
        : n.kind === "condition" ? "ویژگی‌های شرط"
        : n.kind === "start" ? "شروع فرآیند (تکرار کلی)"
        : "ویژگی‌ها";
    }
    if (n.kind === "start") {
      inspector.innerHTML = startInspectorHtml(n);
      toggleInspFields(n.repeatSourceType || graph.repeatSourceType || "None");
      bindDataSourcesPanel();
    } else if (n.kind === "group") {
      inspector.innerHTML = groupInspectorHtml(n);
    } else if (isActionNode(n)) {
      inspector.innerHTML = stepInspectorHtml(n);
    } else if (n.kind === "condition") {
      inspector.innerHTML = conditionInspectorHtml(n);
      toggleConditionFields(n.conditionType || "None");
    } else {
      inspector.innerHTML = field("عنوان", "title", n.title);
    }
    inspector.querySelectorAll("[data-k]").forEach((inp) => {
      const apply = () => {
        const k = inp.dataset.k;
        if (inp.type === "checkbox") {
          n[k] = inp.checked;
          if (k === "valueFromSource" && !inp.checked) {
            n.dataSourceId = null;
            n.dynamicSourceColumnName = null;
          }
        } else if (k === "dataSourceId" || k === "selectorDataSourceId" || k === "sourceId"
          || k === "equalSelectorDataSourceId"
          || k === "attributeDataSourceId" || k === "equalAttributeDataSourceId") {
          n[k] = inp.value ? Number(inp.value) : null;
          if (k === "dataSourceId" && n.kind === "start") setMasterDataSource(n.dataSourceId);
        } else if (k === "loopCount") {
          const num = Math.max(1, Number(inp.value) || 1);
          n.loopCount = num;
          n.constantValue = String(num);
          if (n.kind === "start") {
            graph.loopCount = num;
            graph.constantValue = String(num);
          }
        } else if (k === "moveLoop") {
          n.moveLoop = inp.value === "1" || inp.value === "true" || inp.checked === true;
          if (n.moveLoop || (n.repeatSourceType || "None") !== "DataSource") n.dataSourceId = null;
        } else if (k === "repeatSourceType") {
          n[k] = inp.value;
          if (n.kind === "start") graph.repeatSourceType = inp.value;
          if (n.kind === "group" && inp.value !== "DataSource") n.dataSourceId = null;
        } else if (k === "contentSourceType") {
          n[k] = inp.value;
          n.valueFromSource = inp.value === "DataSource";
        } else n[k] = inp.value;

        if (k === "navigation" && n.kind === "condition") {
          n.constantEqualValue = n.navigation;
        }

        if (k === "repeatSourceType") {
          toggleInspFields(n.repeatSourceType);
          renderInspector();
          return;
        }
        if (k === "actionType" || k === "conditionType" || k === "contentSourceType" || k === "equalityType") {
          if (k === "conditionType") {
            n.contentSourceType = n.contentSourceType || "Constant";
          }
          renderInspector();
          return;
        }
        if (k === "selectorIsDynamic" || k === "equalSelectorIsDynamic"
          || k === "selectorDataSourceId" || k === "equalSelectorDataSourceId"
          || k === "sourceId" || k === "moveLoop" || k === "valueFromSource" || k === "dataSourceId"
          || k === "dynamicSourceColumnName" || k === "selectorDynamicColumn"
          || k === "equalSelectorDynamicColumn" || k === "memoryVariableName"
          || k === "hasAttribute" || k === "equalHasAttribute"
          || k === "attributeValueIsDynamic" || k === "equalAttributeValueIsDynamic"
          || k === "attributeDataSourceId" || k === "equalAttributeDataSourceId"
          || k === "attributeDynamicColumn" || k === "equalAttributeDynamicColumn") {
          if (isActionNode(n) && (n.valueFromSource || n.contentSourceType === "DataSource")) {
            syncStepParamFromSource(n);
          }
          // Let switch thumb animate before rebuilding inspector DOM
          const isSwitch = inp.type === "checkbox" && (
            k === "selectorIsDynamic" || k === "equalSelectorIsDynamic"
            || k === "hasAttribute" || k === "equalHasAttribute"
            || k === "attributeValueIsDynamic" || k === "equalAttributeValueIsDynamic"
          );
          if (isSwitch) {
            clearTimeout(window.__daInspSwitchT);
            window.__daInspSwitchT = setTimeout(() => renderInspector(), 300);
          } else {
            renderInspector();
          }
          return;
        }
        if (k === "navigateUrl" && isActionNode(n)) {
          n.constantValue = n.navigateUrl;
        }
        render();
      };
      inp.addEventListener("change", apply);
      if (inp.tagName === "TEXTAREA" || (inp.tagName === "INPUT" && inp.type !== "checkbox" && inp.type !== "file")) {
        inp.addEventListener("blur", apply);
      }
    });
    document.getElementById("insp-open-steps")?.addEventListener("click", () => openGroup(n.id));
    document.getElementById("insp-goto-start")?.addEventListener("click", () => {
      const start = graph.nodes.find((x) => x.kind === "start");
      if (!start) return;
      selected.clear();
      selected.add(start.id);
      render();
    });
    bindSelectorTools(n);
  }

  const DYN_SEL_PLACEHOLDER = "{مقدار پویا}";

  function stepNeedsSelector(actionType) {
    return [
      "Click", "DoubleClick", "RightClick", "Hover", "Enter",
      "InputContent", "InsertContent", "LoadContent", "SaveContent", "TakeContent",
      "WaitForLoading"
    ].includes(actionType || "");
  }

  /** Actions that consume a value (constant / element / datasource / …). */
  function stepReceivesValue(actionType) {
    return [
      "InputContent", "InsertContent", "LoadContent",
      "WaitTime", "GoToUrl", "Navigate", "NewPage"
    ].includes(actionType || "");
  }

  function stepIsCapture(actionType) {
    return actionType === "TakeContent" || actionType === "SaveContent";
  }

  function stepIsUrlAction(actionType) {
    return actionType === "GoToUrl" || actionType === "Navigate" || actionType === "NewPage";
  }

  function stepAllowsMemoryValue(actionType) {
    return actionType === "InsertContent" || actionType === "LoadContent";
  }

  function stepAllowsElementValue(actionType) {
    return actionType === "InputContent" || actionType === "InsertContent" || actionType === "LoadContent";
  }

  function knownMemoryVariableNames() {
    const names = new Set();
    (graph.nodes || []).forEach((n) => {
      if (n.kind !== "step") return;
      if ((n.actionType === "TakeContent" || n.actionType === "SaveContent")
        && (n.contentSourceType || "Memory") === "Memory"
        && n.memoryVariableName) {
        names.add(String(n.memoryVariableName).trim());
      }
    });
    return [...names].filter(Boolean).sort();
  }

  function normalizeStepValueSource(n) {
    let src = n.contentSourceType;
    if (!src || src === "None") {
      src = n.valueFromSource ? "DataSource" : "Constant";
    }
    const at = n.actionType || "";
    const allowed = new Set(["Constant", "DataSource"]);
    if (stepAllowsElementValue(at)) allowed.add("Elements");
    if (stepAllowsMemoryValue(at)) allowed.add("Memory");
    if (!allowed.has(src)) src = "Constant";
    n.contentSourceType = src;
    n.valueFromSource = src === "DataSource";
    return src;
  }

  function stepInspectorHtml(n) {
    const at = n.actionType || "Click";
    let html = field("عنوان", "title", n.title) +
      `<div class="insp-field"><label>نوع اقدام</label><select data-k="actionType">${optActions(at)}</select></div>`;

    if (at === "NewPage") {
      html += `<p class="palette-hint">تب جدید باز می‌شود و به آدرس می‌رود.</p>`;
    }
    if (at === "CloseFirstTab" || at === "CloseLastTab") {
      html += `<p class="palette-hint">${at === "CloseFirstTab" ? "اولین تب پنجره بسته می‌شود." : "آخرین تب پنجره بسته می‌شود."}</p>`;
    }

    if (stepIsCapture(at)) html += stepCaptureTargetHtml(n);
    if (stepReceivesValue(at)) html += stepValueSourceHtml(n);

    if (stepNeedsSelector(at)) {
      html += `<div class="insp-section-title">هدف روی صفحه</div>`;
      html += selectorFieldHtml(n, "سلکتور", { includeFramePath: true });
    }

    return html;
  }

  function stepCaptureTargetHtml(n) {
    const cst = n.contentSourceType === "DataSource" ? "DataSource" : "Memory";
    n.contentSourceType = cst;
    const dsId = n.dataSourceId || null;
    const dsOpts = processDataSourceOptions(dsId);
    const cols = dataSourceColumnKeys(dsId);
    const colOpts = cols.map((c) =>
      `<option value="${esc(c)}" ${n.dynamicSourceColumnName === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");
    return `
      <div class="insp-section-title">مقصد ذخیره</div>
      <div class="insp-field"><label>ذخیره در</label>
        <select data-k="contentSourceType">
          <option value="Memory" ${cst === "Memory" ? "selected" : ""}>حافظه (متغیر)</option>
          <option value="DataSource" ${cst === "DataSource" ? "selected" : ""}>منبع داده</option>
        </select>
      </div>
      ${cst === "Memory" ? `
        <div class="insp-field"><label>نام متغیر حافظه</label>
          <input data-k="memoryVariableName" value="${esc(n.memoryVariableName || "")}" placeholder="مثلاً titleText" />
        </div>
        <p class="palette-hint">بعداً در درج از حافظه همین نام را انتخاب کنید.</p>
      ` : `
        <div class="insp-field"><label>منبع</label>
          <select data-k="dataSourceId"><option value="">—</option>${dsOpts}</select>
        </div>
        <div class="insp-field"><label>ستون</label>
          <select data-k="dynamicSourceColumnName"><option value="">—</option>${colOpts}</select>
        </div>
      `}`;
  }

  function stepValueSourceHtml(n) {
    const at = n.actionType || "";
    const src = normalizeStepValueSource(n);
    const isUrl = stepIsUrlAction(at);
    const isWait = at === "WaitTime";
    const sectionTitle = isUrl ? "آدرس" : (isWait ? "زمان انتظار" : "مقدار");
    const constLabel = isUrl ? "آدرس ثابت" : (isWait ? "میلی‌ثانیه (ثابت)" : "مقدار ثابت");
    const constKey = isUrl ? "navigateUrl" : "constantValue";
    const constVal = isUrl ? (n.navigateUrl || n.constantValue || "") : (n.constantValue || "");

    const dsId = n.dataSourceId || null;
    const dsOpts = processDataSourceOptions(dsId);
    const cols = dataSourceColumnKeys(dsId);
    const colOpts = cols.map((c) =>
      `<option value="${esc(c)}" ${n.dynamicSourceColumnName === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");
    const emptyDs = !(graph.dataSources || []).length
      ? `<p class="palette-hint">منبعی نیست — روی نود شروع اکسل اضافه کنید.</p>`
      : "";
    const memNames = knownMemoryVariableNames();

    let html = `<div class="insp-section-title">${sectionTitle}</div>
      <div class="insp-field"><label>نوع مقدار</label>
        <select data-k="contentSourceType">
          <option value="Constant" ${src === "Constant" ? "selected" : ""}>ثابت</option>
          ${stepAllowsElementValue(at) ? `<option value="Elements" ${src === "Elements" ? "selected" : ""}>عنصر صفحه</option>` : ""}
          <option value="DataSource" ${src === "DataSource" ? "selected" : ""}>منبع داده</option>
          ${stepAllowsMemoryValue(at) ? `<option value="Memory" ${src === "Memory" ? "selected" : ""}>حافظه (متغیر)</option>` : ""}
        </select>
      </div>`;

    if (src === "Constant") {
      html += `<div class="insp-field"><label>${constLabel}</label>
        <input data-k="${constKey}" value="${esc(constVal)}" placeholder="${isUrl ? "https://..." : (isWait ? "مثلاً 1000" : "")}" />
      </div>`;
    } else if (src === "Elements") {
      html += selectorFieldHtml(n, "سلکتور عنصر منبع مقدار", {
        valueKey: "equalSelectorValue",
        dynFlag: "equalSelectorIsDynamic",
        dynDs: "equalSelectorDataSourceId",
        dynCol: "equalSelectorDynamicColumn",
        hasAttr: "equalHasAttribute",
        attrName: "equalAttributeName",
        attrDynFlag: "equalAttributeValueIsDynamic",
        attrValue: "equalAttributeValue",
        attrDynCol: "equalAttributeDynamicColumn",
        attrDynDs: "equalAttributeDataSourceId"
      });
    } else if (src === "DataSource") {
      html += `
        <div class="insp-field"><label>منبع داده</label>
          <select data-k="dataSourceId"><option value="">— انتخاب منبع —</option>${dsOpts}</select>
        </div>
        <div class="insp-field"><label>ستون</label>
          <select data-k="dynamicSourceColumnName"><option value="">— انتخاب ستون —</option>${colOpts}</select>
        </div>
        ${emptyDs}
        <p class="palette-hint">در اجرا مقدار سلول ردیف جاری خوانده می‌شود.</p>`;
    } else if (src === "Memory") {
      html += `<div class="insp-field"><label>متغیر حافظه</label>
        <input data-k="memoryVariableName" list="mem-var-list" value="${esc(n.memoryVariableName || "")}" placeholder="نام متغیر" />
        <datalist id="mem-var-list">${memNames.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
      </div>
      ${!memNames.length
        ? `<p class="palette-hint">هنوز متغیری نیست — ابتدا Take/Save با مقصد حافظه بسازید.</p>`
        : `<p class="palette-hint">مقدار ذخیره‌شده در این متغیر درج می‌شود.</p>`}`;
    }
    return html;
  }

  function processDataSourceOptions(selectedId, { markMaster = true } = {}) {
    const masterId = masterDataSourceId();
    return (graph.dataSources || []).map((d) => {
      const meta = d.rowCount != null ? ` (${d.rowCount} ردیف)` : "";
      const tag = markMaster && Number(d.id) === Number(masterId) ? " — مادر" : "";
      return `<option value="${d.id}" ${Number(selectedId) === Number(d.id) ? "selected" : ""}>${esc(d.title)}${meta}${tag}</option>`;
    }).join("");
  }

  function syncStepParamFromSource(n) {
    if ((n.contentSourceType || "") !== "DataSource" && !n.valueFromSource) return;
    if (!n.dynamicSourceColumnName) return;
    // Keep constant/url empty when reading from DS — engine resolves from column.
  }

  function dataSourceColumnKeys(dsId) {
    const ds = (graph.dataSources || []).find((d) => Number(d.id) === Number(dsId));
    if (!ds) return [];
    if (Array.isArray(ds.columnKeys) && ds.columnKeys.length) return ds.columnKeys;
    if (Array.isArray(ds.columns)) return ds.columns.map((c) => c.key || c.Key).filter(Boolean);
    return [];
  }

  function resolveSelectorDsId(n, dynDsKey = "selectorDataSourceId") {
    if (n[dynDsKey]) return n[dynDsKey];
    if (n.selectorDataSourceId) return n.selectorDataSourceId;
    if (n.kind === "group" && n.dataSourceId) return n.dataSourceId;
    if (isActionNode(n)) {
      if (n.dataSourceId) return n.dataSourceId;
      if (n.groupNodeId) {
        const g = nodeById(n.groupNodeId);
        if (g?.dataSourceId) return g.dataSourceId;
      }
    }
    return masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
  }

  function selectorHasDynPlaceholder(val) {
    const s = String(val || "");
    return s.includes(DYN_SEL_PLACEHOLDER) || /\{\{[^}]+\}\}/.test(s);
  }

  /** Red/green border when dynamic selector is on; no auto-insert of the token. */
  function syncDynSelectorValidation(inp, dynOn) {
    if (!inp) return;
    inp.classList.remove("sel-dyn-ok", "sel-dyn-bad");
    inp.removeAttribute("aria-invalid");
    const warn = inp.closest(".insp-sel-block")?.querySelector(".insp-warn-dyn");
    if (!dynOn) {
      if (warn) warn.hidden = true;
      return;
    }
    const ok = selectorHasDynPlaceholder(inp.value);
    inp.classList.add(ok ? "sel-dyn-ok" : "sel-dyn-bad");
    if (!ok) inp.setAttribute("aria-invalid", "true");
    if (warn) warn.hidden = ok;
  }

  function selectorFieldHtml(n, label, opts = {}) {
    const valueKey = opts.valueKey || "selectorValue";
    const dynFlag = opts.dynFlag || "selectorIsDynamic";
    const dynDs = opts.dynDs || "selectorDataSourceId";
    const dynCol = opts.dynCol || "selectorDynamicColumn";
    const hasAttrKey = opts.hasAttr || "hasAttribute";
    const attrNameKey = opts.attrName || "attributeName";
    const attrDynFlag = opts.attrDynFlag || "attributeValueIsDynamic";
    const attrValueKey = opts.attrValue || "attributeValue";
    const attrDynCol = opts.attrDynCol || "attributeDynamicColumn";
    const attrDynDs = opts.attrDynDs || "attributeDataSourceId";
    const wrapId = opts.wrapId ? ` id="${opts.wrapId}"` : "";

    // Default off unless explicitly true
    if (n[dynFlag] == null) n[dynFlag] = false;
    if (n[hasAttrKey] == null) n[hasAttrKey] = false;
    if (n[attrDynFlag] == null) n[attrDynFlag] = false;
    const dynOn = n[dynFlag] === true;
    const attrOn = n[hasAttrKey] === true;
    const attrDynOn = n[attrDynFlag] === true;
    const selectedDs = n[dynDs] || "";
    const dsId = selectedDs || resolveSelectorDsId(n, dynDs);
    const dsOpts = processDataSourceOptions(selectedDs || dsId);
    const cols = dataSourceColumnKeys(dsId);
    const colOpts = cols.map((c) =>
      `<option value="${esc(c)}" ${n[dynCol] === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");

    const attrSelectedDs = n[attrDynDs] || "";
    const attrDsId = attrSelectedDs || resolveSelectorDsId(n, attrDynDs);
    const attrDsOpts = processDataSourceOptions(attrSelectedDs || attrDsId);
    const attrCols = dataSourceColumnKeys(attrDsId);
    const attrColOpts = attrCols.map((c) =>
      `<option value="${esc(c)}" ${n[attrDynCol] === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");

    const selVal = n[valueKey] || "";
    const hasPh = selectorHasDynPlaceholder(selVal);
    const empty = !(graph.dataSources || []).length
      ? `<p class="palette-hint">منبعی نیست — روی نود شروع اضافه کنید.</p>`
      : "";
    const borderCls = dynOn ? (hasPh ? " sel-dyn-ok" : " sel-dyn-bad") : "";
    const showFrame = opts.includeFramePath === true;

    return `
      <div class="insp-sel-block"${wrapId} data-dyn-flag="${dynFlag}" data-sel-key="${valueKey}">
        <div class="insp-field">
          <label class="da-switch">
            <input type="checkbox" data-k="${dynFlag}" ${dynOn ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">سلکتور پویا</span>
          </label>
          <p class="palette-hint" style="margin:4px 0 0">با روشن بودن، منبع و ستون را انتخاب کنید و «${esc(DYN_SEL_PLACEHOLDER)}» را داخل سلکتور بنویسید.</p>
        </div>
        ${dynOn ? `
          <div class="insp-sel-dyn">
            <div class="insp-field"><label>منبع پویا</label>
              <select data-k="${dynDs}"><option value="">— انتخاب منبع —</option>${dsOpts}</select>
            </div>
            <div class="insp-field"><label>ستون پویا</label>
              <select data-k="${dynCol}"><option value="">— انتخاب ستون —</option>${colOpts}</select>
            </div>
            ${empty}
          </div>
        ` : ""}
        <div class="insp-field">
          <label>${label}</label>
          <input data-k="${valueKey}" data-da-selector="1" data-dyn-validate="${dynOn ? "1" : "0"}"
            class="${borderCls.trim()}" value="${esc(selVal)}"
            placeholder="${esc(dynOn ? DYN_SEL_PLACEHOLDER : "#btn")}"
            ${dynOn && !hasPh ? `aria-invalid="true"` : ""} />
          <div class="sel-toolbar">
            <button type="button" class="btn-mini" data-sel-act="save-mem" data-sel-key="${valueKey}">ذخیره در حافظه</button>
            <button type="button" class="btn-mini" data-sel-act="load-mem" data-sel-key="${valueKey}">خواندن از حافظه</button>
          </div>
          <p class="insp-warn insp-warn-dyn" ${dynOn && !hasPh ? "" : "hidden"}>سلکتور باید شامل «${esc(DYN_SEL_PLACEHOLDER)}» باشد.</p>
        </div>
        ${showFrame ? `
          <div class="insp-field">
            <label>زنجیره فریم (JSON)</label>
            <textarea data-k="framePathJson" data-da-framepath="1" rows="3">${esc(n.framePathJson || "[]")}</textarea>
          </div>
        ` : ""}
        <div class="insp-field">
          <label class="da-switch">
            <input type="checkbox" data-k="${hasAttrKey}" ${attrOn ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">دارای اتریبیوت / ویژگی</span>
          </label>
          <p class="palette-hint" style="margin:4px 0 0">مثلاً optionهایی که value خاصی دارند: سلکتور <code>select option</code> + اتریبیوت <code>value</code>.</p>
        </div>
        ${attrOn ? `
          <div class="insp-sel-attr">
            <div class="insp-field"><label>نام اتریبیوت</label>
              <input data-k="${attrNameKey}" value="${esc(n[attrNameKey] || "")}" placeholder="مثلاً value یا data-id" />
            </div>
            <div class="insp-field">
              <label class="da-switch">
                <input type="checkbox" data-k="${attrDynFlag}" ${attrDynOn ? "checked" : ""}/>
                <span class="da-switch-ui" aria-hidden="true"></span>
                <span class="da-switch-text">مقدار اتریبیوت پویا</span>
              </label>
            </div>
            ${attrDynOn ? `
              <div class="insp-sel-dyn">
                <div class="insp-field"><label>منبع مقدار</label>
                  <select data-k="${attrDynDs}"><option value="">— انتخاب منبع —</option>${attrDsOpts}</select>
                </div>
                <div class="insp-field"><label>ستون مقدار</label>
                  <select data-k="${attrDynCol}"><option value="">— انتخاب ستون —</option>${attrColOpts}</select>
                </div>
                ${empty}
              </div>
            ` : `
              <div class="insp-field"><label>مقدار اتریبیوت (ثابت)</label>
                <input data-k="${attrValueKey}" value="${esc(n[attrValueKey] || "")}" placeholder="مثلاً active" />
              </div>
            `}
          </div>
        ` : ""}
      </div>`;
  }

  function parseDaSelectorText(text) {
    if (!text || typeof text !== "string") return null;
    const raw = text.trim();
    if (!raw.startsWith("DASEL:")) return null;
    try {
      const obj = JSON.parse(raw.slice(6));
      if (!obj || (!obj.selector && !obj.Selector)) return null;
      return {
        selector: obj.selector || obj.Selector || "",
        framePath: obj.framePath || obj.FramePath || [],
        elementBy: obj.elementBy || "CssSelector",
        hasAttribute: obj.hasAttribute ?? obj.HasAttribute,
        attributeName: obj.attributeName || obj.AttributeName || "",
        attributeValueIsDynamic: obj.attributeValueIsDynamic ?? obj.AttributeValueIsDynamic,
        attributeValue: obj.attributeValue || obj.AttributeValue || "",
        attributeDynamicColumn: obj.attributeDynamicColumn || obj.AttributeDynamicColumn || "",
        attributeDataSourceId: obj.attributeDataSourceId ?? obj.AttributeDataSourceId ?? null
      };
    } catch {
      return null;
    }
  }

  function encodeDaSelectorPayload(payload) {
    return "DASEL:" + JSON.stringify(payload);
  }

  function readSelectorFieldLive(n, preferKey) {
    const key = preferKey || "selectorValue";
    const inp = inspector.querySelector(`[data-k="${key}"]`);
    if (inp) n[key] = inp.value;
    const frameTa = inspector.querySelector("[data-k=framePathJson]");
    if (frameTa) n.framePathJson = frameTa.value;
    return key;
  }

  function buildSelectorPayloadFromNode(n, preferKey) {
    const key = readSelectorFieldLive(n, preferKey);
    let framePath = [];
    try {
      const parsed = JSON.parse(n.framePathJson || "[]");
      framePath = Array.isArray(parsed) ? parsed : [];
    } catch {
      framePath = [];
    }
    const isEqual = key === "equalSelectorValue";
    const payload = {
      v: 1,
      kind: "da-selector",
      selector: n[key] || "",
      elementBy: "CssSelector",
      framePath: isEqual ? [] : framePath,
      copiedAt: new Date().toISOString()
    };
    if (isEqual) {
      if (n.equalHasAttribute) {
        payload.hasAttribute = true;
        payload.attributeName = n.equalAttributeName || "";
        payload.attributeValueIsDynamic = !!n.equalAttributeValueIsDynamic;
        payload.attributeValue = n.equalAttributeValue || "";
        payload.attributeDynamicColumn = n.equalAttributeDynamicColumn || "";
        payload.attributeDataSourceId = n.equalAttributeDataSourceId ?? null;
      }
    } else if (n.hasAttribute) {
      payload.hasAttribute = true;
      payload.attributeName = n.attributeName || "";
      payload.attributeValueIsDynamic = !!n.attributeValueIsDynamic;
      payload.attributeValue = n.attributeValue || "";
      payload.attributeDynamicColumn = n.attributeDynamicColumn || "";
      payload.attributeDataSourceId = n.attributeDataSourceId ?? null;
    }
    return payload;
  }

  const SEL_MEM_KEY = "da_copied_selector";

  function applySelectorPayload(n, payload, preferKey) {
    if (!payload || payload.selector == null || String(payload.selector).trim() === "") return false;
    const hasEqualField = !!inspector.querySelector("[data-k=equalSelectorValue]");
    const hasSubjectField = !!inspector.querySelector("[data-k=selectorValue]");
    let targetKey = preferKey;
    if (!targetKey) {
      if (n.kind === "condition" && hasEqualField && (!hasSubjectField || n.contentSourceType === "Elements")) {
        targetKey = "equalSelectorValue";
      } else {
        targetKey = "selectorValue";
      }
    }
    n[targetKey] = payload.selector;
    if (targetKey === "selectorValue") {
      n.framePathJson = JSON.stringify(payload.framePath || []);
      if (payload.hasAttribute != null) {
        n.hasAttribute = !!payload.hasAttribute;
        if (payload.attributeName != null) n.attributeName = payload.attributeName;
        if (payload.attributeValueIsDynamic != null) n.attributeValueIsDynamic = !!payload.attributeValueIsDynamic;
        if (payload.attributeValue != null) n.attributeValue = payload.attributeValue;
        if (payload.attributeDynamicColumn != null) n.attributeDynamicColumn = payload.attributeDynamicColumn;
        if (payload.attributeDataSourceId != null) n.attributeDataSourceId = payload.attributeDataSourceId;
      }
    } else if (targetKey === "equalSelectorValue" && payload.hasAttribute != null) {
      n.equalHasAttribute = !!payload.hasAttribute;
      if (payload.attributeName != null) n.equalAttributeName = payload.attributeName;
      if (payload.attributeValueIsDynamic != null) n.equalAttributeValueIsDynamic = !!payload.attributeValueIsDynamic;
      if (payload.attributeValue != null) n.equalAttributeValue = payload.attributeValue;
      if (payload.attributeDynamicColumn != null) n.equalAttributeDynamicColumn = payload.attributeDynamicColumn;
      if (payload.attributeDataSourceId != null) n.equalAttributeDataSourceId = payload.attributeDataSourceId;
    }
    status.textContent = "سلکتور از حافظه خوانده شد.";
    render();
    return true;
  }

  async function saveSelectorToMemory(n, preferKey) {
    const payload = buildSelectorPayloadFromNode(n, preferKey);
    if (!payload.selector) {
      status.textContent = "سلکتور خالی است — چیزی برای ذخیره نیست.";
      return;
    }
    const text = encodeDaSelectorPayload(payload);
    try {
      localStorage.setItem(SEL_MEM_KEY, text);
    } catch { /* ignore quota */ }

    let extOk = false;
    try {
      const res = await new Promise((resolve) => {
        const done = (ev) => {
          window.removeEventListener("da-stored-selector", done);
          resolve(ev.detail || null);
        };
        window.addEventListener("da-stored-selector", done);
        window.dispatchEvent(new CustomEvent("da-store-copied-selector", { detail: { payload, text } }));
        setTimeout(() => {
          window.removeEventListener("da-stored-selector", done);
          resolve(null);
        }, 1200);
      });
      extOk = !!(res && res.ok);
    } catch { /* no extension */ }

    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }

    status.textContent = extOk
      ? "سلکتور در حافظه افزونه ذخیره شد."
      : "سلکتور در حافظه محلی ذخیره شد.";
  }

  async function loadSelectorFromMemory(n, preferKey) {
    // Prefer extension memory
    try {
      const res = await new Promise((resolve) => {
        const done = (ev) => {
          window.removeEventListener("da-copied-selector", done);
          resolve(ev.detail || null);
        };
        window.addEventListener("da-copied-selector", done);
        window.dispatchEvent(new CustomEvent("da-request-copied-selector"));
        setTimeout(() => {
          window.removeEventListener("da-copied-selector", done);
          resolve(null);
        }, 1500);
      });
      if (res?.ok && res.payload) {
        applySelectorPayload(n, {
          selector: res.payload.selector,
          framePath: res.payload.framePath || [],
          hasAttribute: res.payload.hasAttribute,
          attributeName: res.payload.attributeName,
          attributeValueIsDynamic: res.payload.attributeValueIsDynamic,
          attributeValue: res.payload.attributeValue,
          attributeDynamicColumn: res.payload.attributeDynamicColumn,
          attributeDataSourceId: res.payload.attributeDataSourceId
        }, preferKey);
        return;
      }
    } catch { /* fall through */ }

    // localStorage fallback
    try {
      const raw = localStorage.getItem(SEL_MEM_KEY);
      const parsed = parseDaSelectorText(raw);
      if (parsed) {
        applySelectorPayload(n, parsed, preferKey);
        return;
      }
    } catch { /* ignore */ }

    // clipboard last
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseDaSelectorText(text);
      if (parsed) {
        applySelectorPayload(n, parsed, preferKey);
        return;
      }
    } catch { /* ignore */ }

    status.textContent = "سلکتوری در حافظه نیست.";
  }

  function bindSelectorTools(n) {
    inspector.querySelectorAll("[data-sel-act]").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const act = btn.getAttribute("data-sel-act");
        const key = btn.getAttribute("data-sel-key")
          || btn.closest(".insp-sel-block")?.getAttribute("data-sel-key")
          || "selectorValue";
        if (act === "save-mem") await saveSelectorToMemory(n, key);
        else if (act === "load-mem") await loadSelectorFromMemory(n, key);
      });
    });
    inspector.querySelectorAll("[data-da-selector]").forEach((inp) => {
      inp.addEventListener("paste", (ev) => {
        const text = ev.clipboardData?.getData("text") || "";
        const parsed = parseDaSelectorText(text);
        if (!parsed) return;
        ev.preventDefault();
        applySelectorPayload(n, parsed, inp.getAttribute("data-k") || "selectorValue");
      });
      const liveValidate = () => {
        const block = inp.closest(".insp-sel-block");
        const flagKey = block?.getAttribute("data-dyn-flag");
        const dynOn = flagKey ? n[flagKey] === true : inp.getAttribute("data-dyn-validate") === "1";
        const k = inp.getAttribute("data-k");
        if (k) n[k] = inp.value;
        syncDynSelectorValidation(inp, dynOn);
      };
      inp.addEventListener("input", liveValidate);
      if (inp.getAttribute("data-dyn-validate") === "1") {
        syncDynSelectorValidation(inp, true);
      }
    });
  }

  function repeatTypeLabel(rst) {
    switch (rst) {
      case "Loops": return "تعداد ثابت";
      case "Elements": return "المان‌های صفحه";
      case "DataSource": return "ردیف‌های منبع";
      default: return "بدون تکرار";
    }
  }

  function conditionTypeLabel(ct) {
    switch (ct) {
      case "Url": return "آدرس صفحه";
      case "ElementValue": return "مقدار المان";
      case "SourceValue": return "مقدار منبع";
      case "FindElement": return "وجود المان";
      case "NotFindElement": return "نبود المان";
      case "FindElements": return "تعداد المان‌ها";
      case "DriverTabs": return "تعداد تب‌ها";
      default: return "نوع؟";
    }
  }

  function equalityOptions(cur) {
    const list = [
      ["equal", "مساوی"],
      ["NotEqual", "نامساوی"],
      ["Contain", "شامل"],
      ["HasValue", "دارای مقدار"],
      ["HasNotValue", "بدون مقدار"],
      ["BiggerThan", "بزرگ‌تر"],
      ["SmallerThan", "کوچک‌تر"]
    ];
    return list.map(([v, t]) =>
      `<option value="${v}" ${String(cur || "equal") === v ? "selected" : ""}>${t}</option>`
    ).join("");
  }

  function conditionNeedsCompare(ct) {
    return ["Url", "ElementValue", "SourceValue", "FindElements", "DriverTabs"].includes(ct);
  }

  /** Whether a compare operand (constant / element / DS) is needed. */
  function conditionNeedsCompareOperand(ct, eq) {
    if (!conditionNeedsCompare(ct)) return false;
    if (eq === "HasValue" || eq === "HasNotValue") return false;
    return true;
  }

  function conditionInspectorHtml(n) {
    const ct = n.conditionType || "None";
    const eq = n.equalityType || "equal";
    const src = n.contentSourceType || "Constant";
    if (!n.contentSourceType) n.contentSourceType = "Constant";

    const outs = (graph.edges || []).filter((e) => e.from === n.id && (e.kind === "success" || e.kind === "fail"));
    const ok = outs.find((e) => e.kind === "success");
    const fail = outs.find((e) => e.kind === "fail");
    const labelOf = (id) => {
      const t = id && nodeById(id);
      return t ? esc(t.title || t.kind) : "— هنوز وصل نشده";
    };

    const needsSubjectSelector = ["ElementValue", "FindElement", "NotFindElement", "FindElements"].includes(ct);
    const needsSubjectDs = ct === "SourceValue";
    const needsOperand = conditionNeedsCompareOperand(ct, eq);
    const allowCompareDs = needsOperand && ct !== "SourceValue";

    const subjectDsOpts = processDataSourceOptions(n.sourceId || n.dataSourceId);
    const subjectDsId = n.sourceId || n.dataSourceId;
    const subjectCols = dataSourceColumnKeys(subjectDsId);
    const subjectColOpts = subjectCols.map((c) =>
      `<option value="${esc(c)}" ${n.dynamicSourceColumnName === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");

    const compareDsId = n.dataSourceId || n.sourceId;
    const compareDsOpts = processDataSourceOptions(compareDsId);
    const compareCols = dataSourceColumnKeys(compareDsId);
    const compareColOpts = compareCols.map((c) =>
      `<option value="${esc(c)}" ${n.dynamicSourceColumnName === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");

    let html = field("عنوان", "title", n.title || "شرط") +
      `<p class="palette-hint" style="margin:0 0 8px;line-height:1.7">
        ترتیب: نوع شرط → نوع منبع مقدار → مقدار → نوع مقایسه
      </p>` +
      `<div class="insp-field"><label>۱. نوع شرط</label>
        <select data-k="conditionType">
          <option value="None" ${ct === "None" ? "selected" : ""}>— انتخاب کنید —</option>
          <option value="Url" ${ct === "Url" ? "selected" : ""}>آدرس صفحه (Url)</option>
          <option value="ElementValue" ${ct === "ElementValue" ? "selected" : ""}>مقدار المان صفحه</option>
          <option value="SourceValue" ${ct === "SourceValue" ? "selected" : ""}>مقدار منبع داده</option>
          <option value="FindElement" ${ct === "FindElement" ? "selected" : ""}>وجود المان</option>
          <option value="NotFindElement" ${ct === "NotFindElement" ? "selected" : ""}>نبود المان</option>
          <option value="FindElements" ${ct === "FindElements" ? "selected" : ""}>تعداد المان‌های صفحه</option>
          <option value="DriverTabs" ${ct === "DriverTabs" ? "selected" : ""}>تعداد تب‌های مرورگر</option>
        </select>
      </div>`;

    if (needsSubjectSelector) {
      html += `<div class="insp-section-title">المان مورد بررسی</div>` +
        selectorFieldHtml(n, "سلکتور المان", { includeFramePath: true });
    }

    if (needsSubjectDs) {
      html += `<div class="insp-section-title">مقدار مورد بررسی (منبع)</div>` +
        `<div class="insp-field"><label>منبع داده</label>
          <select data-k="sourceId"><option value="">— انتخاب منبع —</option>${subjectDsOpts}</select>
        </div>
        <div class="insp-field"><label>ستون</label>
          <select data-k="dynamicSourceColumnName"><option value="">— انتخاب ستون —</option>${subjectColOpts}</select>
        </div>`;
    }

    if (needsOperand) {
      html += `<div class="insp-section-title">۲. نوع منبع مقدار مقایسه</div>` +
        `<div class="insp-field"><label>منبع مقدار</label>
          <select data-k="contentSourceType">
            <option value="Constant" ${src === "Constant" ? "selected" : ""}>مقدار ثابت</option>
            <option value="Elements" ${src === "Elements" ? "selected" : ""}>مقدار المان صفحه</option>
            ${allowCompareDs ? `<option value="DataSource" ${src === "DataSource" ? "selected" : ""}>مقدار منبع داده</option>` : ""}
          </select>
        </div>`;

      if (src === "Constant") {
        const isUrl = ct === "Url";
        html += `<div class="insp-field">
          <label>${isUrl ? "آدرس / الگو" : "مقدار ثابت"}</label>
          <input data-k="${isUrl ? "navigation" : "constantEqualValue"}"
            value="${esc(isUrl ? (n.navigation || n.constantEqualValue || "") : (n.constantEqualValue || ""))}"
            placeholder="${isUrl ? "مثلاً google.com یا /login" : "مقدار برای مقایسه"}" />
        </div>`;
      } else if (src === "Elements") {
        html += selectorFieldHtml(n, "سلکتور المان (مقدار مقایسه)", {
          valueKey: "equalSelectorValue",
          dynFlag: "equalSelectorIsDynamic",
          dynDs: "equalSelectorDataSourceId",
          dynCol: "equalSelectorDynamicColumn",
          hasAttr: "equalHasAttribute",
          attrName: "equalAttributeName",
          attrDynFlag: "equalAttributeValueIsDynamic",
          attrValue: "equalAttributeValue",
          attrDynCol: "equalAttributeDynamicColumn",
          attrDynDs: "equalAttributeDataSourceId"
        });
      } else if (src === "DataSource" && allowCompareDs) {
        html += `<div class="insp-field"><label>منبع داده</label>
            <select data-k="dataSourceId"><option value="">— انتخاب منبع —</option>${compareDsOpts}</select>
          </div>
          <div class="insp-field"><label>ستون</label>
            <select data-k="dynamicSourceColumnName"><option value="">— انتخاب ستون —</option>${compareColOpts}</select>
          </div>`;
      }
    }

    if (conditionNeedsCompare(ct)) {
      html += `<div class="insp-section-title">۳. نوع مقایسه</div>` +
        `<div class="insp-field"><label>نوع مقایسه</label>
          <select data-k="equalityType">${equalityOptions(eq)}</select>
        </div>`;
      if (eq === "HasValue" || eq === "HasNotValue") {
        html += `<p class="palette-hint" style="margin:0 0 8px">برای «دارای مقدار / بدون مقدار» به مقدار مقایسه نیاز نیست.</p>`;
      }
    }

    html += `<div class="insp-section-title">خروجی‌ها</div>` +
      `<div class="insp-field"><label><span style="color:#28c76f">●</span> موفقیت</label><div class="ds-meta">${labelOf(ok?.to)}</div></div>` +
      `<div class="insp-field"><label><span style="color:#ea5455">●</span> شکست</label><div class="ds-meta">${labelOf(fail?.to)}</div></div>` +
      `<p class="palette-hint" style="margin:0">هر خروجی به گروه یا شرط بعدی (زنجیره = AND).</p>`;

    return html;
  }

  function toggleConditionFields(_ct) {
    // Fields are rendered conditionally in conditionInspectorHtml; full re-render on change.
  }

  function startInspectorHtml(n) {
    const rst = n.repeatSourceType || graph.repeatSourceType || "None";
    n.repeatSourceType = rst;
    n.dataSourceId = n.dataSourceId ?? graph.dataSourceId ?? null;
    n.loopCount = n.loopCount ?? graph.loopCount ?? (Number(graph.constantValue) || 1);
    const loopCount = n.loopCount || 1;
    const masterId = n.dataSourceId;
    const dsOpts = processDataSourceOptions(masterId);
    return `
      <p class="palette-hint" style="margin:0 0 10px;line-height:1.7">
        اینجا منابع اکسل فرآیند و دیتاسورس <b>مادر</b> (تکرار کل گردش) تنظیم می‌شود.
      </p>
      ${dataSourcesPanelHtml()}
      <div class="insp-section-title">تکرار فرآیند</div>
      <div class="insp-field"><label>نوع تکرار کلی</label>
        <select data-k="repeatSourceType">
          <option value="None" ${rst === "None" ? "selected" : ""}>بدون تکرار (یک‌بار)</option>
          <option value="Loops" ${rst === "Loops" ? "selected" : ""}>تعداد ثابت</option>
          <option value="Elements" ${rst === "Elements" ? "selected" : ""}>تعداد المان‌های صفحه</option>
          <option value="DataSource" ${rst === "DataSource" ? "selected" : ""}>تعداد ردیف دیتاسورس مادر</option>
        </select>
      </div>
      <div class="insp-field" id="insp-loops">
        <label>تعداد تکرار ثابت</label>
        <input type="number" min="1" data-k="loopCount" value="${esc(loopCount)}" />
      </div>
      <div class="insp-field" id="insp-ds">
        <label>دیتاسورس مادر (تکرار فرآیند)</label>
        <select data-k="dataSourceId"><option value="">— انتخاب مادر —</option>${dsOpts}</select>
        <p class="palette-hint" style="margin:4px 0 0">فقط یکی مادر است؛ بقیه در گروه‌ها/مراحل استفاده می‌شوند.</p>
      </div>
      <div id="insp-el">
        ${selectorFieldHtml(n, "سلکتور المان‌ها (تکرار کلی)")}
      </div>
    `;
  }

  function groupInspectorHtml(n) {
    const kids = graph.nodes.filter((x) => x.groupNodeId === n.id);
    const stepN = kids.filter((k) => isActionNode(k)).length;
    const groupN = kids.filter((k) => k.kind === "group").length;
    const condN = kids.filter((k) => k.kind === "condition").length;
    const nextEdges = (graph.edges || []).filter((e) => e.from === n.id && e.kind === "next");
    const toConds = nextEdges.map((e) => nodeById(e.to)).filter((t) => t?.kind === "condition");
    const toGroup = nextEdges.map((e) => nodeById(e.to)).find((t) => t?.kind === "group");
    const toStep = nextEdges.map((e) => nodeById(e.to)).find((t) => isActionNode(t));

    return field("عنوان", "title", n.title) +
      `<div class="ds-meta" style="margin-bottom:8px;line-height:1.7">
        گروه = کانتینر دیاگرام داخل.
        <br/>محتوا: ${stepN} اقدام · ${groupN} گروه · ${condN} شرط
        <br/>خروجی بیرون: شرط(OR) · یک گروه یا اقدام بعدی
        ${toConds.length || toGroup || toStep
          ? `<br/>فعلی: ${toConds.length} شرط${toGroup ? ` + گروه «${esc(toGroup.title)}»` : ""}${toStep ? ` + اقدام «${esc(toStep.title)}»` : ""}`
          : ""}
      </div>` +
      `<p class="palette-hint" style="margin:0 0 10px;line-height:1.7">
        تکرار و منبع داده روی نود <b>شروع</b> داخل همین گروه تنظیم می‌شود — نه روی خود گروه.
      </p>` +
      `<button type="button" class="btn-flow" id="insp-open-steps" style="width:100%;margin-top:8px">باز کردن طراح داخل گروه</button>`;
  }

  function toggleInspFields(rst) {
    const n = [...selected].map(nodeById)[0];
    const ds = document.getElementById("insp-ds");
    const el = document.getElementById("insp-el");
    const loops = document.getElementById("insp-loops");
    const showDs = rst === "DataSource" && (
      n?.kind === "start" || (n?.kind === "group" && !n.moveLoop)
    );
    if (ds) ds.style.display = showDs ? "" : "none";
    if (el) el.style.display = rst === "Elements" ? "" : "none";
    if (loops) loops.style.display = rst === "Loops" ? "" : "none";
  }

  function field(label, key, val) {
    return `<div class="insp-field"><label>${label}</label><input data-k="${key}" value="${esc(val)}" /></div>`;
  }
  function opt(list, cur) {
    return list.map((x) => `<option value="${esc(x)}" ${String(cur) === x ? "selected" : ""}>${esc(x)}</option>`).join("");
  }
  function optActions(cur) {
    return ACTIONS.map((x) =>
      `<option value="${esc(x)}" ${String(cur) === x ? "selected" : ""}>${esc(actionTypeLabel(x))}</option>`
    ).join("");
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  function selectNode(id, additive) {
    const hadEdge = !!selectedEdgeId;
    selectedEdgeId = null;
    if (!additive) {
      selected.clear();
      selected.add(id);
    } else if (selected.has(id)) {
      selected.delete(id);
      if (!selected.size) selected.add(id);
    } else {
      selected.add(id);
    }
    updatePlaySelectionBtn();
    if (hadEdge) redrawEdgesOnly();
  }

  function updatePlaySelectionBtn() {
    const btn = document.getElementById("btn-play-selection");
    if (!btn) return;
    const labelEl = document.getElementById("btn-play-selection-label") || btn.querySelector("span");
    const id = [...selected][0];
    const n = id && nodeById(id);
    if (n && (n.kind === "group" || isActionNode(n))) {
      btn.hidden = false;
      const label = n.kind === "group" ? "اجرای گروه" : "اجرای اقدام";
      if (labelEl) labelEl.textContent = label;
      else btn.textContent = label;
      btn.dataset.kind = n.kind === "group" ? "group" : "action";
      btn.dataset.nodeId = n.id;
    } else {
      btn.hidden = true;
      delete btn.dataset.kind;
      delete btn.dataset.nodeId;
    }
  }

  function requestPlay(scope) {
    const detail = {
      taskId: Number(taskId),
      groupNodeId: scope?.groupNodeId || null,
      stepNodeId: scope?.stepNodeId || null
    };
    if (typeof window.daRequireExtension === "function") {
      window.daRequireExtension({
        reason: "برای اجرای فرآیند، افزونه لازم است.",
        pending: { kind: "da-play", detail }
      }).then((ok) => {
        if (!ok) {
          status.textContent = "افزونه متصل نیست — راهنمای نصب را ببینید.";
          return;
        }
        window.dispatchEvent(new CustomEvent("da-play", { detail }));
        status.textContent = "درخواست اجرا ارسال شد...";
      });
      return;
    }
    if (!extOkHint()) {
      status.textContent = "افزونه متصل نیست — صفحه را در Chrome رفرش کنید یا افزونه را Reload کنید.";
      return;
    }
    window.dispatchEvent(new CustomEvent("da-play", { detail }));
    status.textContent = "درخواست اجرا ارسال شد...";
  }

  function extOkHint() {
    return document.documentElement.dataset.daExtension === "1"
      || !!document.getElementById("da-recorder-fab");
  }

  function onNodeDown(ev, n, isPort, edgeHint) {
    ev.stopPropagation();
    ev.preventDefault();
    // Ctrl/Cmd + click on node body = multi-select; ports keep Ctrl for success branch.
    const additive = !isPort && (ev.ctrlKey || ev.metaKey);
    selectNode(n.id, additive);
    // Refresh inspector without rebuilding the whole SVG (keeps dblclick reliable).
    updatePlaySelectionBtn();
    renderInspector();
    highlightSelection();
    if (isPort) {
      let kind = edgeHint
        || (ev.altKey ? "parent" : ev.shiftKey ? "fail" : ev.ctrlKey ? "success" : "next");
      if (n.kind === "condition" && (kind === "next" || !edgeHint)) {
        // Prefer explicit port; otherwise fill the free branch.
        if (edgeHint === "success" || edgeHint === "fail") kind = edgeHint;
        else {
          const hasOk = graph.edges.some((e) => e.from === n.id && e.kind === "success");
          const hasFail = graph.edges.some((e) => e.from === n.id && e.kind === "fail");
          kind = !hasOk ? "success" : (!hasFail ? "fail" : "success");
        }
      }
      if (n.kind === "group" && (kind === "success" || kind === "fail")) {
        status.textContent = "گروه شاخه ندارد — برای دو مسیر یک شرط بگذارید.";
        linking = null;
      } else {
        const fromNode = n;
        const start = nearestSideToward(fromNode, fromNode.x + sizeOf(fromNode).w + 40, fromNode.y + sizeOf(fromNode).h / 2, kind);
        linking = { from: n.id, kind, x1: start.x, y1: start.y, dx: start.dx, dy: start.dy, moved: false };
        ensureLinkPreview();
        updateLinkPreview(start.x + start.dx * 20, start.y + start.dy * 20);
        status.textContent = kind === "success"
          ? "رها کنید روی مقصد موفقیت (گروه یا شرط)"
          : kind === "fail"
            ? "رها کنید روی مقصد شکست (گروه یا شرط)"
            : kind === "parent"
              ? "رها کنید روی گروه فرزند (تو در تو)"
              : "رها کنید روی گروه یا شرط بعدی";
      }
      dragging = null;
      dragMoved = false;
    } else {
      dragging = { id: n.id, ox: n.x, oy: n.y, mx: ev.clientX, my: ev.clientY };
      dragMoved = false;
    }
  }

  function clientToWorld(clientX, clientY) {
    const ctm = world.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function linkPreviewColor(kind) {
    if (kind === "success") return "#28c76f";
    if (kind === "fail") return "#ea5455";
    if (kind === "parent") return "#00cfe8";
    return "#7367f0";
  }

  function ensureLinkPreview() {
    let p = world.querySelector("path.link-preview");
    if (!p) {
      p = el("path", {
        class: "link-preview",
        fill: "none",
        "stroke-width": 1.6,
        "stroke-dasharray": "7 5",
        "stroke-linecap": "round",
        "pointer-events": "none",
        "marker-end": "url(#arrow)"
      });
      world.appendChild(p);
    }
    return p;
  }

  function updateLinkPreview(x2, y2) {
    if (!linking) return;
    const fromNode = nodeById(linking.from);
    if (fromNode) {
      const start = nearestSideToward(fromNode, x2, y2, linking.kind);
      linking.x1 = start.x;
      linking.y1 = start.y;
      linking.dx = start.dx;
      linking.dy = start.dy;
    }
    const p = ensureLinkPreview();
    const x1 = linking.x1;
    const y1 = linking.y1;
    const dx = linking.dx || 1;
    const dy = linking.dy || 0;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const bend = Math.max(28, Math.min(90, dist * 0.4));
    const c1x = x1 + dx * bend;
    const c1y = y1 + dy * bend;
    // Approach cursor with opposite horizontal bias for a natural rubber-band
    const c2x = x2 - dx * bend * 0.35;
    const c2y = y2;
    p.setAttribute("d", `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`);
    p.setAttribute("stroke", linkPreviewColor(linking.kind));
    // Keep preview above edges but under nodes visually: append last among paths then re-append nodes
    world.appendChild(p);
  }

  function clearLinkPreview() {
    world.querySelectorAll("path.link-preview").forEach((p) => p.remove());
  }

  /** Flow rules (same at root and inside any group designer):
   *  - group → many next to conditions (OR) + at most one next to group/step
   *  - condition → success + fail (to group / condition / step)
   *  - start → one next
   *  - step → one next, one incoming
   */
  function resolveLink(fromId, toId, requestedKind) {
    const from = nodeById(fromId);
    const to = nodeById(toId);
    if (!from || !to) return { ok: false, error: "گره نامعتبر." };
    if (fromId === toId) return { ok: false, error: "نمی‌توان به خود وصل کرد." };
    if (!inCurrentScope(from) || !inCurrentScope(to)) {
      return { ok: false, error: "اتصال فقط داخل همین سطح طراح مجاز است." };
    }
    if (to.kind === "start") return { ok: false, error: "به «شروع» نمی‌توان وصل کرد." };

    let kind = requestedKind || "next";

    if (kind === "parent") {
      if (from.kind !== "group" || to.kind !== "group") {
        return { ok: false, error: "یال والد فقط بین دو گروه است." };
      }
      return { ok: true, kind, replaceKinds: ["parent"] };
    }

    if (from.kind === "start") {
      if (kind !== "next") kind = "next";
      if (!isFlowTarget(to)) {
        return { ok: false, error: "از شروع به گروه، شرط یا اقدام وصل شوید." };
      }
      return { ok: true, kind: "next", mode: "replace-all-from", oneInTo: true };
    }

    if (isActionNode(from)) {
      if (kind === "success" || kind === "fail") {
        return { ok: false, error: "اقدام فقط یک خروجی next دارد." };
      }
      kind = "next";
      if (!isFlowTarget(to)) {
        return { ok: false, error: "اقدام به گروه، شرط یا اقدام وصل می‌شود." };
      }
      return { ok: true, kind: "next", mode: "replace-all-from", oneInTo: true };
    }

    if (from.kind === "group") {
      if (kind === "success" || kind === "fail") {
        return { ok: false, error: "برای شاخه از پورت شرط استفاده کنید." };
      }
      kind = "next";
      if (to.kind === "condition") {
        return { ok: true, kind: "next", mode: "add-or-replace-same", oneInTo: true };
      }
      if (to.kind === "group" || isActionNode(to)) {
        return { ok: true, kind: "next", mode: "replace-group-next", oneInTo: true };
      }
      return { ok: false, error: "گروه به گروه، شرط یا اقدام وصل می‌شود." };
    }

    if (from.kind === "condition") {
      if (kind !== "success" && kind !== "fail") {
        const hasOk = graph.edges.some((e) => e.from === fromId && e.kind === "success");
        kind = hasOk ? "fail" : "success";
      }
      if (!isFlowTarget(to)) {
        return { ok: false, error: "خروجی شرط باید گروه، شرط یا اقدام باشد." };
      }
      return { ok: true, kind, replaceKinds: [kind], oneInTo: true };
    }

    return { ok: false, error: "این اتصال پشتیبانی نمی‌شود." };
  }

  function applyLink(fromId, toId, requestedKind) {
    const res = resolveLink(fromId, toId, requestedKind);
    if (!res.ok) {
      status.textContent = res.error;
      return false;
    }
    let replacedGroup = null;
    let replacedStart = null;
    if (res.mode === "replace-all-from") {
      const prev = graph.edges.find((e) => e.from === fromId && e.to !== toId);
      if (prev) replacedStart = nodeById(prev.to);
      graph.edges = graph.edges.filter((e) => e.from !== fromId);
    } else if (res.mode === "replace-group-next") {
      const prev = graph.edges.find((e) => {
        if (e.from !== fromId || e.kind !== "next") return false;
        const t = nodeById(e.to);
        return (t?.kind === "group" || isActionNode(t)) && e.to !== toId;
      });
      if (prev) replacedGroup = nodeById(prev.to);
      graph.edges = graph.edges.filter((e) => {
        if (e.from !== fromId || e.kind !== "next") return true;
        const t = nodeById(e.to);
        return t?.kind === "condition";
      });
    } else if (res.mode === "add-or-replace-same") {
      graph.edges = graph.edges.filter((e) =>
        !(e.from === fromId && e.to === toId && e.kind === res.kind)
      );
    } else {
      const replace = new Set(res.replaceKinds || [res.kind]);
      graph.edges = graph.edges.filter((e) => !(e.from === fromId && replace.has(e.kind)));
    }
    // Steps accept only one incoming flow edge
    if (res.oneInTo && isActionNode(nodeById(toId))) {
      graph.edges = graph.edges.filter((e) => {
        if (e.to !== toId) return true;
        if (e.kind === "contains" || e.kind === "parent") return true;
        return false;
      });
    }
    graph.edges.push({ id: tmpId("e"), from: fromId, to: toId, kind: res.kind });
    syncGroupContainsFromStart(fromId, toId);
    const from = nodeById(fromId);
    const to = nodeById(toId);
    let note = "";
    if (from?.kind === "start") {
      note = replacedStart
        ? ` · فقط یک خروجی از شروع (جایگزین «${replacedStart.title || replacedStart.kind}»)`
        : " · تنها خروجی شروع";
    }
    if (isActionNode(from)) note = " · تنها خروجی اقدام";
    if (from?.kind === "group" && to?.kind === "condition") {
      const condCount = graph.edges.filter((e) => {
        if (e.from !== fromId || e.kind !== "next") return false;
        return nodeById(e.to)?.kind === "condition";
      }).length;
      note = ` · OR موازی (${condCount} شرط)`;
    }
    if (from?.kind === "group" && (to?.kind === "group" || isActionNode(to))) {
      note = replacedGroup
        ? ` · فقط یک خروجی مستقیم (جایگزین «${replacedGroup.title || replacedGroup.kind}»)`
        : " · تنها خروجی گروه→گروه/اقدام";
    }
    if (from?.kind === "condition" && to?.kind === "condition") note = " · AND زنجیره‌ای";
    const kindFa = res.kind === "success" ? "موفقیت" : res.kind === "fail" ? "شکست" : res.kind === "parent" ? "والد" : "بعدی";
    status.textContent = `وصل شد: ${from?.title || fromId} → ${to?.title || toId} (${kindFa})${note}`;
    return true;
  }

  /** Keep legacy contains edge in sync when group-scope start links to a step. */
  function syncGroupContainsFromStart(fromId, toId) {
    const from = nodeById(fromId);
    const to = nodeById(toId);
    if (!from || from.kind !== "start" || !from.groupNodeId) return;
    const gid = from.groupNodeId;
    graph.edges = graph.edges.filter((e) => !(e.from === gid && e.kind === "contains"));
    if (isActionNode(to) && to.groupNodeId === gid) {
      graph.edges.push({ id: tmpId("e"), from: gid, to: toId, kind: "contains" });
    }
  }

  function highlightSelection() {
    world.querySelectorAll("g.node").forEach((g) => {
      const id = g.getAttribute("data-id");
      const on = selected.has(id);
      g.classList.toggle("node-on", on);
      const shape = g.querySelector("rect, polygon");
      if (!shape) return;
      const n = nodeById(id);
      if (!n) return;
      shape.setAttribute("stroke", defaultStrokeFor(n));
      shape.setAttribute("stroke-width", String(strokeWidthFor(n, on)));
    });
  }

  function moveDraggedNode(ev) {
    if (!dragging) return;
    const z = graph.viewport.zoom || 1;
    const dx = (ev.clientX - dragging.mx) / z;
    const dy = (ev.clientY - dragging.my) / z;
    if (!dragMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragMoved = true;
    if (!dragMoved) return;
    const n = nodeById(dragging.id);
    if (!n) return;
    n.x = dragging.ox + dx;
    n.y = dragging.oy + dy;
    const g = world.querySelector(`g.node[data-id="${CSS.escape(dragging.id)}"]`);
    if (g) g.setAttribute("transform", `translate(${n.x},${n.y})`);
    redrawEdgesOnly();
    ensureNodeInScrollView(n);
  }

  function redrawEdgesOnly() {
    [...world.querySelectorAll("path:not(.link-preview), circle.edge-tip, circle.edge-tip-hit, polygon.edge-tip")].forEach((p) => p.remove());
    scopedEdges().forEach(drawEdge);
    world.querySelectorAll("g.node").forEach((g) => world.appendChild(g));
    world.querySelectorAll("circle.edge-tip-hit, polygon.edge-tip, circle.edge-tip").forEach((t) => world.appendChild(t));
    if (linking) {
      const prev = world.querySelector("path.link-preview");
      if (prev) world.appendChild(prev);
    }
  }

  wrap.addEventListener("mousedown", (ev) => {
    if (tipDrag || linking) return;
    const onNode = ev.target.closest && ev.target.closest("g.node");
    if (onNode) return;
    const onScrollChrome = ev.target === canvasScroll;
    if (ev.target === svg || ev.target === wrap || onScrollChrome
      || (ev.target.tagName === "rect" && !ev.target.closest("g.node"))) {
      panning = {
        sl: canvasScroll.scrollLeft,
        st: canvasScroll.scrollTop,
        mx: ev.clientX,
        my: ev.clientY
      };
      selected.clear();
      selectedEdgeId = null;
      updatePlaySelectionBtn();
      highlightSelection();
      redrawEdgesOnly();
      renderInspector();
    }
  });
  function endLinkingGesture(ev) {
    if (linking?.pointerId != null && svg.releasePointerCapture) {
      try { svg.releasePointerCapture(linking.pointerId); } catch (_) { /* ignore */ }
    }
    if (tipDrag?.pointerId != null && svg.releasePointerCapture) {
      try { svg.releasePointerCapture(tipDrag.pointerId); } catch (_) { /* ignore */ }
    }
    clearLinkPreview();
    retargetHideId = null;
    linking = null;
    tipDrag = null;
    wrap.classList.remove("linking");
  }

  function promoteTipDrag(ev) {
    if (!tipDrag || linking) return false;
    const dist = Math.hypot(ev.clientX - tipDrag.mx, ev.clientY - tipDrag.my);
    if (dist < 8) return false;
    startRetargetEdge(tipDrag.edge, tipDrag.startAnchor, ev, true);
    return true;
  }

  function hitNodeIdAt(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const nodeEl = hit && hit.closest && hit.closest("g.node");
    return nodeEl ? nodeEl.getAttribute("data-id") : null;
  }

  function completeLinkingDrop(ev) {
    if (!linking) return false;
    const to = hitNodeIdAt(ev.clientX, ev.clientY);
    if (to && to !== linking.from) {
      if (linking.retargetEdgeId) {
        retargetEdge(linking.retargetEdgeId, to);
      } else {
        applyLink(linking.from, to, linking.kind);
      }
      endLinkingGesture(ev);
      render();
      dragging = panning = null;
      dragMoved = false;
      return true;
    }
    status.textContent = linking.retargetEdgeId ? "تغییر مقصد لغو شد." : "اتصال لغو شد.";
    endLinkingGesture(ev);
    render();
    dragging = panning = null;
    dragMoved = false;
    return true;
  }

  let lastLinkUpSeq = 0;
  function onLinkPointerMove(ev) {
    if (tipDrag && !linking) {
      promoteTipDrag(ev);
    }
    if (linking) {
      linking.moved = true;
      const wpt = clientToWorld(ev.clientX, ev.clientY);
      updateLinkPreview(wpt.x, wpt.y);
      wrap.classList.add("linking");
      return true;
    }
    return false;
  }

  function onLinkPointerUp(ev) {
    if (tipDrag && !linking) {
      // Click without drag: keep edge selected, tip stays for another try.
      const edgeId = tipDrag.edgeId;
      endLinkingGesture(ev);
      selectEdge(edgeId);
      status.textContent = "نوک سفید انتهای خط را بگیرید و روی مقصد جدید بکشید";
      return true;
    }
    if (!linking) return false;
    // Deduplicate pointerup + mouseup for the same gesture
    const seq = linking.seq || 0;
    if (seq && seq === lastLinkUpSeq) return true;
    lastLinkUpSeq = seq;

    if (!linking.moved && linking.retargetEdgeId) {
      const retargetId = linking.retargetEdgeId;
      endLinkingGesture(ev);
      selectEdge(retargetId);
      status.textContent = "نوک سفید انتهای خط را بگیرید و روی مقصد جدید بکشید";
      return true;
    }
    if (!linking.moved) {
      endLinkingGesture(ev);
      return true;
    }
    return completeLinkingDrop(ev);
  }

  window.addEventListener("pointermove", (ev) => {
    if (onLinkPointerMove(ev)) return;
    if (dragging) {
      moveDraggedNode(ev);
    } else if (panning) {
      canvasScroll.scrollLeft = panning.sl - (ev.clientX - panning.mx);
      canvasScroll.scrollTop = panning.st - (ev.clientY - panning.my);
    }
  });
  window.addEventListener("pointerup", (ev) => {
    if (onLinkPointerUp(ev)) return;
    if (dragging && dragMoved) {
      const n = nodeById(dragging.id);
      if (isActionNode(n)) {
        const sz = sizeOf(n);
        const hit = groupAtWorldInScope(n.x + sz.w / 2, n.y + sz.h / 2, n.id);
        if (hit && moveStepIntoGroup(n, hit.id)) {
          dragging = panning = null;
          dragMoved = false;
          openGroup(hit.id);
          status.textContent = `اقدام به داخل «${hit.title || "گروه"}» منتقل شد.`;
          return;
        }
      }
      applyVp();
      if (n) ensureNodeInScrollView(n);
      render();
    }
    dragging = panning = null;
    dragMoved = false;
  });
  // Keep legacy mouse handlers for node drag started via mousedown on nodes
  window.addEventListener("mousemove", (ev) => {
    if (onLinkPointerMove(ev)) return;
    if (dragging) {
      moveDraggedNode(ev);
    } else if (panning) {
      canvasScroll.scrollLeft = panning.sl - (ev.clientX - panning.mx);
      canvasScroll.scrollTop = panning.st - (ev.clientY - panning.my);
    }
  });
  window.addEventListener("mouseup", (ev) => {
    if (onLinkPointerUp(ev)) return;
    if (dragging && dragMoved) {
      const n = nodeById(dragging.id);
      if (isActionNode(n)) {
        const sz = sizeOf(n);
        const hit = groupAtWorldInScope(n.x + sz.w / 2, n.y + sz.h / 2, n.id);
        if (hit && moveStepIntoGroup(n, hit.id)) {
          dragging = panning = null;
          dragMoved = false;
          openGroup(hit.id);
          status.textContent = `اقدام به داخل «${hit.title || "گروه"}» منتقل شد.`;
          return;
        }
      }
      applyVp();
      if (n) ensureNodeInScrollView(n);
      render();
    }
    dragging = panning = null;
    dragMoved = false;
  });
  wrap.addEventListener("wheel", (ev) => {
    // Ctrl/Meta + wheel = zoom; otherwise native scroll on canvas-scroll
    if (!(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    const f = ev.deltaY > 0 ? 0.92 : 1.08;
    const prev = rememberScroll();
    delete graph.viewport.fitOffset;
    graph.viewport.zoom = Math.min(2.2, Math.max(0.35, (graph.viewport.zoom || 1) * f));
    applyVp();
    // Keep approximate focal area
    canvasScroll.scrollLeft = prev.x * f;
    canvasScroll.scrollTop = prev.y * f;
  }, { passive: false });

  document.querySelectorAll(".stencil").forEach((s) => {
    s.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("kind", s.dataset.kind);
      ev.dataTransfer.effectAllowed = "copy";
    });
  });
  wrap.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });
  wrap.addEventListener("drop", (ev) => {
    ev.preventDefault();
    if (!canModify) return;
    const kind = ev.dataTransfer.getData("kind");
    if (!kind) return;

    const p = clientToWorld(ev.clientX, ev.clientY);
    const scopeId = currentScopeId();

    if (kind === "action" || kind === "step") {
      const hitGroup = groupAtWorldInScope(p.x, p.y);
      if (hitGroup) {
        const node = createStepNode({
          groupNodeId: hitGroup.id,
          x: 140,
          y: 120 + stepsOf(hitGroup.id).length * 48
        });
        selected = new Set([node.id]);
        openGroup(hitGroup.id);
        status.textContent = `اقدام داخل «${hitGroup.title || "گروه"}» اضافه شد.`;
        return;
      }
      const node = createStepNode({
        groupNodeId: scopeId || null,
        x: p.x,
        y: p.y
      });
      selected = new Set([node.id]);
      render();
      status.textContent = "اقدام به نمودار اضافه شد.";
      return;
    }

    if (kind !== "group" && kind !== "condition") return;

    const node = {
      id: tmpId(kind),
      kind,
      title: kind === "group" ? "گروه جدید" : "شرط",
      x: p.x,
      y: p.y,
      isActive: true
    };
    if (scopeId) node.groupNodeId = scopeId;
    if (kind === "group") {
      node.repeatSourceType = "None";
      node.loopCount = 1;
      node.moveLoop = true;
    }
    if (kind === "condition") {
      node.conditionType = "FindElement";
      node.equalityType = "Equal";
      node.constantEqualValue = "";
    }
    graph.nodes.push(node);
    selected = new Set([node.id]);
    render();
  });

  document.getElementById("btn-add-step").addEventListener("click", () => {
    if (addStep()) render();
  });
  document.getElementById("btn-back-group").addEventListener("click", closeGroup);
  document.getElementById("btn-group-edit-close").addEventListener("click", closeGroup);
  document.getElementById("btn-save").addEventListener("click", save);
  const canvasSaveHtml = `${SAVE_ICON_SVG}<span>ذخیره</span>`;
  // Ensure canvas save exists even if Razor view is stale (server not restarted).
  let btnCanvasSave = document.getElementById("btn-canvas-save");
  if (!btnCanvasSave && wrap) {
    btnCanvasSave = document.createElement("button");
    btnCanvasSave.type = "button";
    btnCanvasSave.id = "btn-canvas-save";
    btnCanvasSave.className = "btn-flow btn-canvas-save";
    btnCanvasSave.title = "ذخیره تغییرات";
    wrap.appendChild(btnCanvasSave);
  }
  if (btnCanvasSave) {
    if (!btnCanvasSave.querySelector(".btn-canvas-save-icon")) {
      btnCanvasSave.innerHTML = canvasSaveHtml;
    }
    if (!canModify) btnCanvasSave.disabled = true;
    btnCanvasSave.addEventListener("click", save);
  }
  document.getElementById("btn-play-task")?.addEventListener("click", () => requestPlay({}));
  document.getElementById("btn-play-selection")?.addEventListener("click", () => {
    const btn = document.getElementById("btn-play-selection");
    if (!btn?.dataset?.nodeId) return;
    if (btn.dataset.kind === "group") requestPlay({ groupNodeId: btn.dataset.nodeId });
    else requestPlay({ stepNodeId: btn.dataset.nodeId });
  });
  document.getElementById("btn-fit").addEventListener("click", () => {
    // Wait a frame so canvas size matches current panel layout, then fit.
    requestAnimationFrame(() => {
      fitDiagramToView();
    });
  });
  document.getElementById("tab-diagram")?.addEventListener("click", () => { closeGroup(); setView("diagram"); });
  document.getElementById("tab-list")?.addEventListener("click", () => { closeGroup(); setView("list"); });

  function setView(v) {
    view = v;
    setViewTabs();
    render();
  }
  function setViewTabs() {
    document.getElementById("tab-diagram")?.classList.toggle("on", view === "diagram" && !editingGroupId);
    document.getElementById("tab-list")?.classList.toggle("on", view === "list" && !editingGroupId);
  }

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && editingGroupId) { closeGroup(); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT") return;
      if (deleteSelectedEdge()) return;
      const ids = new Set(selected);
      if (!ids.size) return;
      const removeGroups = [...ids].filter((id) => nodeById(id)?.kind === "group");
      const ban = new Set(ids);
      removeGroups.forEach((gid) => {
        graph.nodes.forEach((n) => {
          if (n.groupNodeId === gid) ban.add(n.id);
        });
      });
      // cascade one more level for nested containers
      let grew = true;
      while (grew) {
        grew = false;
        graph.nodes.forEach((n) => {
          if (n.groupNodeId && ban.has(n.groupNodeId) && !ban.has(n.id)) {
            ban.add(n.id);
            grew = true;
          }
        });
      }
      graph.nodes = graph.nodes.filter((n) => {
        if (n.kind === "start") return true;
        return !ban.has(n.id);
      });
      graph.edges = graph.edges.filter((e) => graph.nodes.some((n) => n.id === e.from) && graph.nodes.some((n) => n.id === e.to));
      selected.clear();
      selectedEdgeId = null;
      render();
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      save();
    }
  });

  /* ---- Side panels: resize, collapse, persist in localStorage ---- */
  const LAYOUT_KEY = "da-flow-layout-v1";
  const PANEL_MIN = { palette: 160, inspector: 220 };
  const PANEL_MAX = { palette: 420, inspector: 480 };
  const PANEL_DEFAULT = { palette: 228, inspector: 300 };
  const flowBody = document.getElementById("flow-body") || document.querySelector(".flow-body");
  if (flowBody && !flowBody.id) flowBody.id = "flow-body";
  const layoutState = {
    paletteW: PANEL_DEFAULT.palette,
    inspW: PANEL_DEFAULT.inspector,
    paletteCollapsed: false,
    inspCollapsed: false
  };

  function readLayoutState() {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (Number.isFinite(o.paletteW)) layoutState.paletteW = clamp(o.paletteW, PANEL_MIN.palette, PANEL_MAX.palette);
      if (Number.isFinite(o.inspW)) layoutState.inspW = clamp(o.inspW, PANEL_MIN.inspector, PANEL_MAX.inspector);
      layoutState.paletteCollapsed = !!o.paletteCollapsed;
      layoutState.inspCollapsed = !!o.inspCollapsed;
    } catch { /* ignore */ }
  }

  function saveLayoutState() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutState));
    } catch { /* ignore */ }
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function applyLayoutState() {
    if (!flowBody) return;
    flowBody.style.setProperty("--palette-w", `${layoutState.paletteW}px`);
    flowBody.style.setProperty("--insp-w", `${layoutState.inspW}px`);
    flowBody.classList.toggle("palette-collapsed", layoutState.paletteCollapsed);
    flowBody.classList.toggle("insp-collapsed", layoutState.inspCollapsed);
    const peekPal = document.getElementById("btn-peek-palette");
    const peekInsp = document.getElementById("btn-peek-inspector");
    if (peekPal) peekPal.hidden = !layoutState.paletteCollapsed;
    if (peekInsp) peekInsp.hidden = !layoutState.inspCollapsed;
    syncPanelChevrons();
    // Grow/shrink diagram viewport with panels — keep current zoom.
    if (typeof applyVp === "function" && view === "diagram") {
      requestAnimationFrame(() => applyVp());
    }
  }

  /** Open state: outward chevrons. Collapsed/peek: reversed (inward). */
  function syncPanelChevrons() {
    const CHEV_RIGHT = "M8.5 5.5L15 12l-6.5 6.5";
    const CHEV_LEFT = "M15.5 5.5L9 12l6.5 6.5";
    const setPath = (btn, d) => {
      const p = btn?.querySelector?.("path");
      if (p) p.setAttribute("d", d);
    };
    // Palette (right): open → ▶ , collapsed peek → ◀
    setPath(document.getElementById("btn-toggle-palette"), CHEV_RIGHT);
    setPath(document.getElementById("btn-peek-palette"), CHEV_LEFT);
    // Inspector (left): open → ◀ , collapsed peek → ▶
    setPath(document.getElementById("btn-toggle-inspector"), CHEV_LEFT);
    setPath(document.getElementById("btn-peek-inspector"), CHEV_RIGHT);

    const tPal = document.getElementById("btn-toggle-palette");
    const tInsp = document.getElementById("btn-toggle-inspector");
    if (tPal) {
      tPal.title = layoutState.paletteCollapsed ? "نمایش جعبه ابزار" : "جمع کردن جعبه ابزار";
      tPal.setAttribute("aria-label", tPal.title);
    }
    if (tInsp) {
      tInsp.title = layoutState.inspCollapsed ? "نمایش ویژگی‌ها" : "جمع کردن ویژگی‌ها";
      tInsp.setAttribute("aria-label", tInsp.title);
    }
  }

  function ensureInspectorExpanded() {
    if (!layoutState.inspCollapsed) return;
    layoutState.inspCollapsed = false;
    applyLayoutState();
    saveLayoutState();
  }

  function ensurePanelChrome() {
    const palette = document.getElementById("flow-palette");
    const inspector = document.getElementById("flow-inspector") || document.querySelector(".flow-inspector");
    if (inspector && !inspector.id) inspector.id = "flow-inspector";
    const canvas = document.getElementById("canvas-wrap");

    const ensureHead = (panel, titleText, btnId, titleAttr, chevronPath) => {
      if (!panel) return;
      let head = panel.querySelector(":scope > .panel-head");
      if (!head) {
        head = document.createElement("div");
        head.className = "panel-head";
        const h3 = panel.querySelector(":scope > h3") || document.createElement("h3");
        if (!h3.id && btnId === "btn-toggle-inspector") h3.id = "insp-heading";
        if (!h3.textContent) h3.textContent = titleText;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-panel-toggle";
        btn.id = btnId;
        btn.title = titleAttr;
        btn.setAttribute("aria-label", titleAttr);
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${chevronPath}"/></svg>`;
        head.appendChild(h3);
        head.appendChild(btn);
        panel.insertBefore(head, panel.firstChild);
      } else if (!document.getElementById(btnId)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-panel-toggle";
        btn.id = btnId;
        btn.title = titleAttr;
        btn.setAttribute("aria-label", titleAttr);
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${chevronPath}"/></svg>`;
        head.appendChild(btn);
      }
      if (!panel.querySelector(`:scope > .panel-resize[data-resize="${btnId.includes("palette") ? "palette" : "inspector"}"]`)) {
        const rz = document.createElement("div");
        rz.className = "panel-resize";
        rz.dataset.resize = btnId.includes("palette") ? "palette" : "inspector";
        rz.title = "تغییر پهنا";
        panel.appendChild(rz);
      }
    };

    // RTL layout: palette = right, inspector = left.
    // Initial open-state chevrons; syncPanelChevrons keeps peek reversed when collapsed.
    const CHEV_RIGHT = "M8.5 5.5L15 12l-6.5 6.5";
    const CHEV_LEFT = "M15.5 5.5L9 12l6.5 6.5";

    ensureHead(palette, "جعبه ابزار", "btn-toggle-palette", "جمع کردن جعبه ابزار", CHEV_RIGHT);
    ensureHead(inspector, "ویژگی‌های فرآیند", "btn-toggle-inspector", "جمع کردن ویژگی‌ها", CHEV_LEFT);

    if (canvas) {
      if (!document.getElementById("btn-peek-palette")) {
        const b = document.createElement("button");
        b.type = "button";
        b.id = "btn-peek-palette";
        b.className = "btn-panel-peek peek-palette";
        b.hidden = true;
        b.title = "نمایش جعبه ابزار";
        b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${CHEV_LEFT}"/></svg>`;
        canvas.appendChild(b);
      }
      if (!document.getElementById("btn-peek-inspector")) {
        const b = document.createElement("button");
        b.type = "button";
        b.id = "btn-peek-inspector";
        b.className = "btn-panel-peek peek-insp";
        b.hidden = true;
        b.title = "نمایش ویژگی‌ها";
        b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${CHEV_RIGHT}"/></svg>`;
        canvas.appendChild(b);
      }
    }
    syncPanelChevrons();
    if (flowBody && !flowBody.id) flowBody.id = "flow-body";
  }

  function initSidePanels() {
    if (!flowBody) return;
    ensurePanelChrome();
    readLayoutState();
    applyLayoutState();

    document.getElementById("btn-toggle-palette")?.addEventListener("click", () => {
      layoutState.paletteCollapsed = !layoutState.paletteCollapsed;
      applyLayoutState();
      saveLayoutState();
    });
    document.getElementById("btn-toggle-inspector")?.addEventListener("click", () => {
      layoutState.inspCollapsed = !layoutState.inspCollapsed;
      applyLayoutState();
      saveLayoutState();
    });
    document.getElementById("btn-peek-palette")?.addEventListener("click", () => {
      layoutState.paletteCollapsed = false;
      applyLayoutState();
      saveLayoutState();
    });
    document.getElementById("btn-peek-inspector")?.addEventListener("click", () => {
      layoutState.inspCollapsed = false;
      applyLayoutState();
      saveLayoutState();
    });

    // Keep diagram surface sized to the canvas when the middle column changes.
    if (typeof ResizeObserver !== "undefined" && canvasScroll) {
      let roPending = false;
      const ro = new ResizeObserver(() => {
        if (roPending || view !== "diagram") return;
        roPending = true;
        requestAnimationFrame(() => {
          roPending = false;
          applyVp();
        });
      });
      ro.observe(canvasScroll);
    }

    let drag = null;
    flowBody.querySelectorAll(".panel-resize").forEach((handle) => {
      handle.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        const which = handle.getAttribute("data-resize");
        drag = {
          which,
          startX: ev.clientX,
          startW: which === "palette" ? layoutState.paletteW : layoutState.inspW,
          pointerId: ev.pointerId
        };
        try { handle.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        flowBody.classList.add("is-resizing");
      });
      handle.addEventListener("pointermove", (ev) => {
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        if (drag.which === "palette") {
          layoutState.paletteW = clamp(drag.startW - dx, PANEL_MIN.palette, PANEL_MAX.palette);
        } else {
          layoutState.inspW = clamp(drag.startW + dx, PANEL_MIN.inspector, PANEL_MAX.inspector);
        }
        applyLayoutState();
      });
      const end = () => {
        if (!drag) return;
        drag = null;
        flowBody.classList.remove("is-resizing");
        saveLayoutState();
      };
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  initSidePanels();
  load();
})();
