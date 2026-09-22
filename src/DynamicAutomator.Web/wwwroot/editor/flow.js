(() => {
  // ---------------------------------------------------------------------------
  // i18n helper — uses DaI18n when available, falls back to key
  // ---------------------------------------------------------------------------
  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function actionLabels() {
    return {
      NoAction: t("editor.actions.NoAction"),
      Click: t("editor.actions.Click"),
      DoubleClick: t("editor.actions.DoubleClick"),
      RightClick: t("editor.actions.RightClick"),
      Hover: t("editor.actions.Hover"),
      Enter: t("editor.actions.Enter"),
      InputContent: t("editor.actions.InputContent"),
      InsertContent: t("editor.actions.InsertContent"),
      LoadContent: t("editor.actions.LoadContent"),
      SaveContent: t("editor.actions.SaveContent"),
      TakeContent: t("editor.actions.TakeContent"),
      GoToUrl: t("editor.actions.GoToUrl"),
      NewPage: t("editor.actions.NewPage"),
      CloseFirstTab: t("editor.actions.CloseFirstTab"),
      CloseLastTab: t("editor.actions.CloseLastTab"),
      WaitTime: t("editor.actions.WaitTime"),
      WaitForLoading: t("editor.actions.WaitForLoading"),
      Refresh: t("editor.actions.Refresh")
    };
  }

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

  /** status bar + toast for important feedback */
  function setStatus(msg, type) {
    if (status && msg != null) status.textContent = String(msg);
    if (!msg || typeof window.daNotify !== "function") return;
    if (type === "error" || type === "success" || type === "warn" || type === "info") {
      window.daNotify(String(msg), type);
    }
  }

  // ACTION_LABELS is now dynamically generated via actionLabels() for i18n
  const ACTIONS = [
    "NoAction","Click","DoubleClick","RightClick","Hover","Enter",
    "InputContent","InsertContent","LoadContent","SaveContent","TakeContent",
    "GoToUrl","NewPage","CloseFirstTab","CloseLastTab","WaitTime","WaitForLoading","Refresh"
  ];

  function isActionNode(n) {
    return !!n && (n.kind === "action" || n.kind === "step");
  }
  function actionTypeLabel(at) {
    const map = actionLabels();
    return map[at] || at || t("editor.nodes.action");
  }
  function migrateActionKinds(g) {
    (g?.nodes || []).forEach((n) => {
      if (isActionNode(n)) n.kind = "action";
    });
  }

  const DEFAULT_HIGHLIGHT_COLOR = "#ea5455";
  function normalizeHighlightColor(v) {
    const s = String(v || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      const r = s[1], g = s[2], b = s[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return DEFAULT_HIGHLIGHT_COLOR;
  }

  let graph = {
    nodes: [], edges: [], viewport: { x: 40, y: 40, zoom: 1 }, title: "",
    dataSources: [], delayBeforeMs: 0, delayAfterMs: 0, stepDelayMs: 0,
    highlightColor: DEFAULT_HIGHLIGHT_COLOR, canModify: true
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
    if (window.DaSecureStore) return DaSecureStore.currentUser();
    const u = readCookie("da_local_user") || localStorage.getItem(LOCAL_USER_KEY) || "test";
    localStorage.setItem(LOCAL_USER_KEY, u);
    return u;
  }
  function tasksKey() {
    return window.DaSecureStore ? DaSecureStore.tasksKey() : ("da_local_tasks__" + currentUser());
  }

  const LOCAL_KEY = tasksKey();

  function readLocalTasks() {
    if (window.DaSecureStore) return DaSecureStore.readTasks();
    try { return JSON.parse(localStorage.getItem(tasksKey()) || "[]"); } catch { return []; }
  }
  function writeLocalTasks(tasks) {
    if (window.DaSecureStore) {
      try {
        DaSecureStore.writeTasks(tasks);
        return;
      } catch (err) {
        // fall through to legacy with quota messaging
      }
    }
    try {
      localStorage.setItem(tasksKey(), JSON.stringify(tasks));
    } catch (err) {
      const name = err?.name || "";
      const msg = String(err?.message || err || "");
      if (name === "QuotaExceededError" || /quota|exceeded|full/i.test(msg)) {
        const err2 = new Error(t("editor.status.quotaError"));
        err2.code = "QUOTA";
        err2.cause = err;
        throw err2;
      }
      const err2 = new Error(t("editor.status.storageFailed", { msg: msg || "?" }));
      err2.cause = err;
      throw err2;
    }
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
    graph.stepDelayMs = graph.stepDelayMs ?? local.stepDelayMs ?? 0;
    graph.highlightColor = normalizeHighlightColor(graph.highlightColor ?? local.highlightColor);
    graph.repeatSourceType = graph.repeatSourceType || "None";
    const start = graph.nodes.find((n) => n.kind === "start");
    if (start) {
      start.repeatSourceType = start.repeatSourceType || graph.repeatSourceType || "None";
      if (start.dataSourceId == null && graph.dataSourceId != null) start.dataSourceId = graph.dataSourceId;
      if (start.loopCount == null && graph.loopCount != null) start.loopCount = graph.loopCount;
      if (start.stepDelayMs == null) start.stepDelayMs = graph.stepDelayMs ?? 0;
      else graph.stepDelayMs = start.stepDelayMs;
      // Process-level ignore play errors — default ON.
      if (start.ignorePlayError == null && graph.ignorePlayError == null) start.ignorePlayError = true;
      else if (start.ignorePlayError == null) start.ignorePlayError = graph.ignorePlayError !== false;
      graph.ignorePlayError = start.ignorePlayError !== false;
      if (!start.highlightColor) start.highlightColor = graph.highlightColor;
      else graph.highlightColor = normalizeHighlightColor(start.highlightColor);
    }
    graph.canModify = true;
    graph.designOrigin = local.designOrigin || graph.designOrigin || "Manual";
    migrateActionKinds(graph);
    enforceSingleStartOut();
    normalizeProcessRepeat();
    titleEl.textContent = graph.title || local.title || t("editor.ribbon.workflow");
    if (originEl) {
      const recorded = String(graph.designOrigin || "").toLowerCase() === "recorded";
      originEl.className = "origin-badge " + (recorded ? "recorded" : "manual");
      originEl.textContent = recorded ? t("editor.origin.fromRecord") : t("editor.origin.manual");
    }
    const steps = graph.nodes.filter((n) => isActionNode(n)).length;
    const groups = graph.nodes.filter((n) => n.kind === "group");
    status.textContent = steps
      ? t("editor.status.stepsHint", { steps })
      : t("editor.status.readyEdit");
    renderDataSources();
    render();
    // Stay on diagram so single-click shows properties; user opens children via double-click.
  }

  function emptyShell() {
    graph = {
      taskId: Number(taskId) || taskId,
      title: t("editor.nodes.localProcess"),
      canModify: true,
      designOrigin: "Manual",
      viewport: { x: 40, y: 40, zoom: 1 },
      nodes: [{
        id: "start", kind: "start", title: t("editor.nodes.start"), x: 40, y: 220,
        repeatSourceType: "None", loopCount: 1, moveLoop: false, stepDelayMs: 0,
        ignorePlayError: true, highlightColor: DEFAULT_HIGHLIGHT_COLOR
      }],
      edges: [],
      dataSources: [],
      delayBeforeMs: 0,
      delayAfterMs: 0,
      stepDelayMs: 0,
      ignorePlayError: true,
      highlightColor: DEFAULT_HIGHLIGHT_COLOR,
      repeatSourceType: "None"
    };
    titleEl.textContent = graph.title;
    status.textContent = t("editor.status.loadingLocal");
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
  function saveBtnSpinnerHtml() { return `<span class="btn-save-spinner" aria-hidden="true"></span><span>${t("editor.ribbon.saving")}</span>`; }
  function saveBtnLabelHtml() { return `${SAVE_ICON_SVG}<span>${t("editor.ribbon.save")}</span>`; }
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
        btn.innerHTML = saveBtnSpinnerHtml();
      } else {
        btn.classList.remove("is-saving");
        btn.removeAttribute("aria-busy");
        if (btn.dataset.saveHtml) {
          btn.innerHTML = btn.dataset.saveHtml;
          delete btn.dataset.saveHtml;
        } else if (btn.id === "btn-canvas-save") {
          btn.innerHTML = saveBtnLabelHtml();
        } else if (btn.id === "btn-save") {
          btn.innerHTML = saveBtnLabelHtml();
        } else {
          btn.textContent = t("editor.ribbon.save");
        }
        if (canModify) btn.disabled = false;
      }
    });
  }

  async function save() {
    if (!canModify) return { ok: false, error: t("editor.status.saveReadOnly") };
    if (saving) return { ok: false, error: t("editor.status.saveBusy") };
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
        title: graph.title || t("editor.nodes.localProcess"),
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
      setStatus(t("editor.status.saved"), "success");
      return { ok: true };
    } catch (err) {
      const detail = err?.message || String(err) || t("editor.status.saveError");
      setStatus(detail, "error");
      console.error(err);
      return { ok: false, error: detail };
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

  /** Ensure process has a default data source when one exists / when repeat needs it. */
  function ensureDefaultDataSource({ forceForRepeat = false } = {}) {
    const list = graph.dataSources || [];
    const start = processStart();
    const rst = start?.repeatSourceType || graph.repeatSourceType || "None";
    let masterId = masterDataSourceId();
    const stillExists = list.some((d) => Number(d.id) === Number(masterId));
    if (!stillExists) masterId = null;

    if (!masterId && list.length) {
      masterId = list[0].id;
      setMasterDataSource(masterId);
    } else if (!list.length) {
      setMasterDataSource(null);
      masterId = null;
    }

    if ((forceForRepeat || rst === "DataSource") && !masterId && list.length) {
      setMasterDataSource(list[0].id);
      masterId = list[0].id;
    }
    if (rst === "DataSource" && !list.length && start) {
      start.repeatSourceType = "None";
      graph.repeatSourceType = "None";
    }
    return masterId;
  }

  function normalizeProcessRepeat() {
    const start = processStart();
    if (!start) return;
    let rst = start.repeatSourceType || graph.repeatSourceType || "None";
    // Process has no page selector — Elements is invalid at process level.
    if (rst === "Elements") {
      rst = "None";
      start.repeatSourceType = "None";
      graph.repeatSourceType = "None";
      delete start.selectorValue;
      delete start.selectorIsDynamic;
    }
    ensureDefaultDataSource({ forceForRepeat: rst === "DataSource" });
  }

  function renderDataSources() {
    const listEl = document.getElementById("ds-list");
    if (!listEl) return;
    const list = graph.dataSources || [];
    ensureDefaultDataSource();
    const masterId = masterDataSourceId();
    if (!list.length) {
      listEl.innerHTML = `<li class="ds-meta" style="background:transparent;padding:0">${t("editor.ds.emptyList")}</li>`;
      return;
    }
    listEl.innerHTML = list.map((d) => {
      const keys = (d.columnKeys || (d.columns || []).map((c) => c.key || c.Key) || []).join("، ") || "—";
      const isMaster = Number(d.id) === Number(masterId);
      const label = d.title || dataSourceFileTitle(d.fileName) || t("editor.ds.removed");
      return `<li data-id="${d.id}" class="${isMaster ? "ds-is-master" : ""}">
        <span class="ds-title">${esc(label)}${isMaster ? `<span class="ds-badge-master">${t("editor.ds.masterBadge")}</span>` : ""}</span>
        <div class="ds-meta">${d.columnCount || 0} ${t("editor.ds.columns")} · ${d.rowCount || 0} ${t("editor.ds.rows")}${d.fileName ? ` · ${esc(d.fileName)}` : ""}${isMaster ? ` · ${t("editor.ds.masterLabel")}` : ""}</div>
        <div class="ds-keys">${esc(keys)}</div>
        ${canModify ? `<div class="ds-actions">
          ${isMaster
            ? `<button type="button" class="btn-flow btn-ghost" disabled>${t("editor.ds.masterBadge")}</button>`
            : `<button type="button" class="btn-flow btn-ghost ds-set-master" data-id="${d.id}">${t("editor.insp.gotoStart")}</button>`}
          <button type="button" class="btn-flow btn-ghost ds-del" data-id="${d.id}">${t("common.delete")}</button>
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
        const start = processStart();
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

  function dataSourceFileTitle(fileName) {
    return String(fileName || "")
      .replace(/\.(xlsx|xlsm)$/i, "")
      .trim() || t("editor.ds.viewerTitle");
  }

  function setDsProgress(pct, label) {
    const wrap = document.getElementById("ds-progress");
    const bar = document.getElementById("ds-progress-bar");
    const txt = document.getElementById("ds-progress-text");
    const statusEl = document.getElementById("ds-status");
    if (wrap) wrap.hidden = false;
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    if (bar) bar.style.width = `${p}%`;
    if (txt) txt.textContent = `${p}%`;
    if (statusEl && label) statusEl.textContent = label;
  }

  function hideDsProgress() {
    const wrap = document.getElementById("ds-progress");
    if (wrap) wrap.hidden = true;
    const bar = document.getElementById("ds-progress-bar");
    if (bar) bar.style.width = "0%";
  }

  function setDsDropzoneBusy(busy) {
    const zone = document.getElementById("ds-dropzone");
    if (!zone) return;
    zone.classList.toggle("is-busy", !!busy);
    zone.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function parseExcelViaServer(file, onProgress) {
    return new Promise((resolve, reject) => {
      const title = dataSourceFileTitle(file.name);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/Panel/Tasks/ParseExcel");
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const ratio = e.total ? e.loaded / e.total : 0;
        onProgress(8 + ratio * 62, t("editor.ds.uploadParsing"));
      };
      xhr.onload = () => {
        const data = xhr.response && typeof xhr.response === "object"
          ? xhr.response
          : (() => { try { return JSON.parse(xhr.responseText || "{}"); } catch { return {}; } })();
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(78, t("editor.ds.uploadSaving"));
          resolve(data);
          return;
        }
        const serverMsg = data?.message || data?.title || data?.error;
        const detail = serverMsg
          ? String(serverMsg)
          : `خطا در خواندن اکسل (کد ${xhr.status})`;
        reject(new Error(detail));
      };
      xhr.onerror = () => reject(new Error(t("editor.ds.networkError")));
      xhr.onabort = () => reject(new Error(t("editor.ds.abortError")));
      onProgress(4, t("editor.ds.progressStarting"));
      xhr.send(fd);
    });
  }

  async function ingestDataSourceFile(file) {
    if (!canModify || !file) return;
    const statusEl = document.getElementById("ds-status");
    const name = file.name || "";
    if (!/\.(xlsx|xlsm)$/i.test(name)) {
      const msg = t("editor.ds.onlyXlsx");
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.classList.add("is-error");
      }
      notifyDsError(msg);
      return;
    }
    setDsDropzoneBusy(true);
    if (statusEl) statusEl.classList.remove("is-error");
    setDsProgress(2, `${t("editor.ds.progressStarting")} «${name}»`);

    const prevSources = (graph.dataSources || []).slice();
    const prevMaster = masterDataSourceId();
    let rolledBack = false;

    try {
      const data = await parseExcelViaServer(file, setDsProgress);
      const title = data.suggestedTitle || dataSourceFileTitle(name);
      const cols = data.columns || [];
      const keys = data.columnKeys || cols.map((c) => c.key || c.Key).filter(Boolean);
      if (!keys.length) {
        throw new Error(t("editor.ds.tooManySheets"));
      }
      if (!(data.rowCount > 0) && !(Array.isArray(data.cells) && data.cells.length)) {
        throw new Error(t("editor.ds.emptySheet"));
      }

      setDsProgress(88, t("editor.ds.progressSaving"));
      const entry = {
        id: nextDataSourceId(),
        title,
        fileName: name,
        columnCount: data.columnCount || keys.length,
        rowCount: data.rowCount || 0,
        columnKeys: keys,
        columns: cols,
        cells: data.cells || []
      };

      // Attach only for the save attempt — rollback if persist fails.
      graph.dataSources = prevSources.concat([entry]);
      if (!prevMaster) setMasterDataSource(entry.id);
      else {
        setMasterDataSource(prevMaster);
        ensureDefaultDataSource();
      }

      setDsProgress(96, t("editor.ds.progressAttach"));
      const saved = await save();
      if (!saved?.ok) {
        throw new Error(saved?.error || t("editor.ds.uploadSaveError"));
      }

      setDsProgress(100, t("editor.ds.uploadDone"));
      const isDefault = Number(masterDataSourceId()) === Number(entry.id);
      if (statusEl) {
        statusEl.classList.remove("is-error");
        statusEl.textContent = `«${entry.title}» — ${t("editor.insp.dsRowCount", { rows: entry.rowCount, cols: entry.columnCount })}${isDefault ? ` — ${t("editor.ds.masterBadge")}` : ""}`;
      }
      const fileInp = document.getElementById("ds-file");
      if (fileInp) fileInp.value = "";
      renderInspector();
      render();
    } catch (e) {
      // Never keep a half-added source box when persist/parse failed.
      graph.dataSources = prevSources;
      if (prevMaster != null) setMasterDataSource(prevMaster);
      else setMasterDataSource(null);
      ensureDefaultDataSource({ forceForRepeat: true });
      rolledBack = true;

      const detail = e?.message || String(e) || t("editor.status.dsLoadError");
      if (statusEl) {
        statusEl.classList.add("is-error");
        statusEl.textContent = detail;
      }
      notifyDsError(detail);
      renderDataSources();
    } finally {
      setDsDropzoneBusy(false);
      setTimeout(hideDsProgress, rolledBack ? 200 : 500);
    }
  }

  function notifyDsError(message) {
    try {
      window.dispatchEvent(new CustomEvent("da-notify", {
        detail: { message: String(message || t("editor.status.dsLoadError")), type: "error" }
      }));
    } catch { /* ignore */ }
    try { setStatus(String(message || t("editor.status.dsLoadError")), "error"); } catch { /* ignore */ }
  }

  async function uploadDataSource() {
    const fileInp = document.getElementById("ds-file");
    const file = fileInp?.files?.[0];
    if (!file) {
      const statusEl = document.getElementById("ds-status");
      if (statusEl) statusEl.textContent = "فایل را بکشید یا برای انتخاب کلیک کنید.";
      return;
    }
    await ingestDataSourceFile(file);
  }

  async function deleteDataSource(sourceId) {
    if (!canModify || !sourceId) return;
    graph.dataSources = (graph.dataSources || []).filter((d) => d.id !== sourceId);
    if (Number(masterDataSourceId()) === Number(sourceId)) setMasterDataSource(null);
    ensureDefaultDataSource({ forceForRepeat: true });
    graph.nodes.forEach((n) => {
      if (n.kind !== "start" && Number(n.dataSourceId) === Number(sourceId)) n.dataSourceId = null;
      if (Number(n.sourceId) === Number(sourceId)) n.sourceId = null;
      if (Number(n.selectorDataSourceId) === Number(sourceId)) n.selectorDataSourceId = null;
      if (Number(n.equalSelectorDataSourceId) === Number(sourceId)) n.equalSelectorDataSourceId = null;
      if (Number(n.attributeDataSourceId) === Number(sourceId)) n.attributeDataSourceId = null;
      if (Number(n.equalAttributeDataSourceId) === Number(sourceId)) n.equalAttributeDataSourceId = null;
      if (Number(n.saveDataSourceId) === Number(sourceId)) n.saveDataSourceId = null;
    });
    const statusEl = document.getElementById("ds-status");
    if (statusEl) statusEl.textContent = t("editor.status.saved");
    await save();
    renderInspector();
  }

  function dataSourcesPanelHtml() {
    const count = (graph.dataSources || []).length;
    const disabled = canModify ? "" : "disabled";
    return `
      <div class="insp-section-title">${t("editor.ds.viewerTitle")} (${count})</div>
      <p class="palette-hint" style="margin:0 0 8px;line-height:1.7">
        ${t("editor.insp.noSourceYet")}
      </p>
      <div class="ds-dropzone${canModify ? "" : " is-disabled"}" id="ds-dropzone" tabindex="${canModify ? "0" : "-1"}" role="button" aria-label="${t("editor.ds.dropHint")}">
        <input type="file" id="ds-file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ${disabled} hidden />
        <div class="ds-dropzone-inner">
          <span class="ds-dropzone-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
          </span>
          <span class="ds-dropzone-title">${t("editor.ds.dropHint")}</span>
          <span class="ds-dropzone-hint">${t("editor.ds.onlyXlsx")}</span>
        </div>
        <div class="ds-progress" id="ds-progress" hidden>
          <div class="ds-progress-track">
            <div class="ds-progress-bar" id="ds-progress-bar"></div>
          </div>
          <span class="ds-progress-text" id="ds-progress-text">0%</span>
        </div>
      </div>
      <div id="ds-status" class="ds-status"></div>
      <ul class="ds-list" id="ds-list"></ul>
    `;
  }

  function processPropsHtml() {
    const disabled = canModify ? "" : "disabled";
    const start = processStart();
    const rst = start?.repeatSourceType || graph.repeatSourceType || "None";
    const master = (graph.dataSources || []).find((d) => Number(d.id) === Number(masterDataSourceId()));
    const count = (graph.dataSources || []).length;
    return `
      <div class="insp-field"><label>${t("editor.insp.title")}</label>
        <input data-task-k="title" value="${esc(graph.title || "")}" ${disabled} /></div>
      <div class="insp-field"><label>${t("editor.insp.waitMaxMs")} (${t("editor.insp.constMs")})</label>
        <input type="number" min="0" data-task-k="delayBeforeMs" value="${Number(graph.delayBeforeMs) || 0}" ${disabled} /></div>
      <div class="insp-field"><label>${t("editor.insp.waitMaxMs")}</label>
        <input type="number" min="0" data-task-k="delayAfterMs" value="${Number(graph.delayAfterMs) || 0}" ${disabled} /></div>
      <div class="insp-field">
        <label>${t("editor.insp.selectorLabel")}</label>
        <div class="insp-color-row">
          <input type="color" data-task-k="highlightColor" value="${esc(normalizeHighlightColor(start?.highlightColor || graph.highlightColor))}" ${disabled} />
          <input type="text" data-task-k="highlightColor" value="${esc(normalizeHighlightColor(start?.highlightColor || graph.highlightColor))}" maxlength="7" ${disabled} />
        </div>
        <p class="palette-hint" style="margin:4px 0 0">${t("editor.insp.selectorHint")}</p>
      </div>
      <div class="insp-section-title">${t("editor.ds.viewerTitle")}</div>
      <p class="palette-hint" style="margin:0 0 8px;line-height:1.7">
        ${t("editor.ds.masterLabel")}: ${esc(repeatTypeLabel(rst))}
        ${master ? ` · ${esc(master.title)}` : ""} · ${count}
      </p>
      <button type="button" class="btn-flow" id="insp-goto-start" style="width:100%">${t("editor.insp.gotoStart")}</button>
    `;
  }

  function bindProcessProps() {
    inspector.querySelectorAll("[data-task-k]").forEach((inp) => {
      const apply = () => {
        const k = inp.dataset.taskK;
        if (k === "title") {
          graph.title = inp.value;
          titleEl.textContent = graph.title || t("editor.ribbon.workflow");
        } else if (k === "delayBeforeMs" || k === "delayAfterMs") {
          graph[k] = Math.max(0, Number(inp.value) || 0);
        } else if (k === "highlightColor") {
          const raw = String(inp.value || "").trim();
          if (inp.type === "text" && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) {
            return;
          }
          const color = normalizeHighlightColor(raw);
          graph.highlightColor = color;
          const start = processStart();
          if (start) start.highlightColor = color;
          inspector.querySelectorAll('[data-task-k="highlightColor"]').forEach((el) => {
            if (el !== inp) el.value = color;
          });
        }
      };
      inp.addEventListener("change", apply);
      inp.addEventListener("input", apply);
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
    const zone = document.getElementById("ds-dropzone");
    const fileInp = document.getElementById("ds-file");
    if (zone && fileInp && canModify) {
      const openPicker = () => {
        if (zone.classList.contains("is-busy")) return;
        fileInp.click();
      };
      zone.addEventListener("click", (e) => {
        if (e.target === fileInp) return;
        e.preventDefault();
        openPicker();
      });
      zone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      });
      ["dragenter", "dragover"].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add("is-dragover");
        });
      });
      ["dragleave", "drop"].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (ev === "dragleave") zone.classList.remove("is-dragover");
        });
      });
      zone.addEventListener("drop", async (e) => {
        zone.classList.remove("is-dragover");
        const file = e.dataTransfer?.files?.[0];
        if (file) await ingestDataSourceFile(file);
      });
      fileInp.addEventListener("change", async () => {
        const file = fileInp.files?.[0];
        if (file) await ingestDataSourceFile(file);
      });
    }
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
        title: t("editor.nodes.start"),
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
  /** Action with ignoreError ON — fill leans green */
  const STEP_STROKE_IGNORE = "#28c76f";
  const STEP_FILL_IGNORE = "#e8f6ee";
  const COND_STROKE = "#8b9098";
  const COND_FILL = "#eceff2";
  /** Root process start — strong green (ignorePlayError ON / default) */
  const START_FILL_ROOT = "#159a55";
  const START_STROKE_ROOT = "#0d7a40";
  /** Root start when ignorePlayError is OFF — lean orange */
  const START_FILL_ROOT_WARN = "#e8943a";
  const START_STROKE_ROOT_WARN = "#c66f18";
  /** Nested group start — softer / faded green */
  const START_FILL_NESTED = "#b7e5c8";
  const START_STROKE_NESTED = "#7bc99a";
  const START_FILL_NESTED_WARN = "#ffe0c2";
  const START_STROKE_NESTED_WARN = "#e0a060";

  function startIgnoresPlayError(n) {
    return n?.ignorePlayError !== false;
  }

  function startFill(n) {
    const ok = startIgnoresPlayError(n);
    if (n?.groupNodeId) return ok ? START_FILL_NESTED : START_FILL_NESTED_WARN;
    return ok ? START_FILL_ROOT : START_FILL_ROOT_WARN;
  }

  function startStroke(n) {
    const ok = startIgnoresPlayError(n);
    if (n?.groupNodeId) return ok ? START_STROKE_NESTED : START_STROKE_NESTED_WARN;
    return ok ? START_STROKE_ROOT : START_STROKE_ROOT_WARN;
  }

  function startLabelFill(n) {
    if (n?.groupNodeId) {
      return startIgnoresPlayError(n) ? "#2f6b45" : "#8a4b12";
    }
    return "#fff";
  }

  function stepIgnoresError(n) {
    return n?.ignoreError === true;
  }

  function stepFill(n) {
    return stepIgnoresError(n) ? STEP_FILL_IGNORE : STEP_FILL;
  }

  function stepStroke(n) {
    return stepIgnoresError(n) ? STEP_STROKE_IGNORE : STEP_STROKE;
  }

  function defaultStrokeFor(n) {
    if (!n) return "#e4e1f5";
    if (n.kind === "start") return startStroke(n);
    if (n.kind === "group") return "#9b92f8";
    if (isActionNode(n)) return stepStroke(n);
    if (n.kind === "condition") return COND_STROKE;
    return "#e4e1f5";
  }

  /** Slightly deeper tone of a hex stroke — used as the “strong” end of the invalid blink. */
  function intensifyStroke(hex) {
    const s = String(hex || "").trim();
    const m = /^#([0-9a-fA-F]{6})$/.exec(s);
    if (!m) return s || "#7367f0";
    const n = parseInt(m[1], 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r * 0.72)));
    g = Math.max(0, Math.min(255, Math.round(g * 0.72)));
    b = Math.max(0, Math.min(255, Math.round(b * 0.72)));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  function validityStrokeFor(n) {
    return intensifyStroke(defaultStrokeFor(n));
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
  function actionTypeIconSpec(at, strokeColor) {
    const color = strokeColor || STEP_STROKE;
    const stroke = { fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
    switch (at) {
      case "Click":
        return [{ d: "M9 4l2 12 2.5-3.5L17 16l1.5-1.5-3.5-2.5L18 9z", ...stroke, fill: color, "fill-opacity": .15 }];
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
    actionTypeIconSpec(n.actionType || "Click", stepStroke(n)).forEach((spec) => {
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
    const metaW = Math.ceil(meta.length * 11 * 0.55 + padX * 2);
    const w = Math.min(300, Math.max(baseW, idealW, metaW));
    const titleLine = fitGroupTitle(title, w - padX * 2, titleFs);
    const topPad = 11;
    const titleH = 16;
    const metaGap = 8;
    const metaH = 14;
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
          size: 11,
          fill: "#9a96a8",
          weight: "400",
          leading: metaGap + 13
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

  /**
   * Auto-layout for the current scope:
   * 1) layered flow (keeps edges short / few crossings)
   * 2) orientation + spacing chosen to fill the visible designer area
   * 3) barycenter + swap passes to cut edge crossings / overlaps
   */
  function autoLayoutCurrentScope() {
    if (!canModify) {
      setStatus(t("editor.status.notModifiable"), "warn");
      return false;
    }
    const nodes = scopedNodes();
    if (nodes.length < 2) {
      setStatus(t("editor.status.stepsHint", { steps: nodes.length }), "warn");
      return false;
    }

    const viewW = Math.max(120, canvasScroll?.clientWidth || wrap?.clientWidth || 800);
    const viewH = Math.max(120, canvasScroll?.clientHeight || wrap?.clientHeight || 600);
    const margin = 36;
    const availW = Math.max(80, viewW - margin * 2);
    const availH = Math.max(80, viewH - margin * 2);

    const edges = scopedEdges().filter((e) =>
      nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)
    );
    const idSet = new Set(nodes.map((n) => n.id));
    const outs = new Map();
    const ins = new Map();
    nodes.forEach((n) => {
      outs.set(n.id, []);
      ins.set(n.id, []);
    });
    edges.forEach((e) => {
      outs.get(e.from).push(e.to);
      ins.get(e.to).push(e.from);
    });

    // --- Layer assignment (longest path from start / roots) ---
    const layerOf = new Map();
    const queue = [];
    const start = nodes.find((n) => n.kind === "start");
    if (start) {
      layerOf.set(start.id, 0);
      queue.push(start.id);
    }
    nodes.forEach((n) => {
      if (layerOf.has(n.id)) return;
      if (!(ins.get(n.id) || []).length) {
        layerOf.set(n.id, 0);
        queue.push(n.id);
      }
    });
    let guard = 0;
    while (queue.length && guard++ < nodes.length * nodes.length + 16) {
      const id = queue.shift();
      const L = layerOf.get(id) || 0;
      for (const to of outs.get(id) || []) {
        const next = L + 1;
        if (!layerOf.has(to) || layerOf.get(to) < next) {
          layerOf.set(to, next);
          queue.push(to);
        }
      }
    }
    let maxL = 0;
    layerOf.forEach((v) => { maxL = Math.max(maxL, v); });
    nodes.forEach((n) => {
      if (!layerOf.has(n.id)) {
        maxL += 1;
        layerOf.set(n.id, maxL);
      }
    });

    const layers = new Map();
    layerOf.forEach((L, id) => {
      if (!layers.has(L)) layers.set(L, []);
      layers.get(L).push(id);
    });
    const layerKeys = [...layers.keys()].sort((a, b) => a - b);

    function posMap(layerList) {
      const m = new Map();
      layerList.forEach((id, i) => m.set(id, i));
      return m;
    }

    function countLayerCrossings(orderA, orderB) {
      const pa = posMap(orderA);
      const pb = posMap(orderB);
      const pairs = [];
      edges.forEach((e) => {
        if (!pa.has(e.from) || !pb.has(e.to)) return;
        pairs.push([pa.get(e.from), pb.get(e.to)]);
      });
      let cross = 0;
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const [a1, b1] = pairs[i];
          const [a2, b2] = pairs[j];
          if ((a1 - a2) * (b1 - b2) < 0) cross += 1;
        }
      }
      return cross;
    }

    function totalCrossings(layerMap) {
      let c = 0;
      for (let i = 0; i < layerKeys.length - 1; i++) {
        const a = layerMap.get(layerKeys[i]) || [];
        const b = layerMap.get(layerKeys[i + 1]) || [];
        c += countLayerCrossings(a, b);
      }
      return c;
    }

    function barycenter(ids, refPos, useParents) {
      return ids.map((id) => {
        const refs = useParents ? (ins.get(id) || []) : (outs.get(id) || []);
        const hit = refs.filter((r) => refPos.has(r));
        if (!hit.length) return { id, key: refPos.get(id) ?? 0 };
        const avg = hit.reduce((s, r) => s + refPos.get(r), 0) / hit.length;
        return { id, key: avg };
      }).sort((a, b) => a.key - b.key || String(a.id).localeCompare(String(b.id)))
        .map((x) => x.id);
    }

    // Copy working orders
    const orders = new Map();
    layerKeys.forEach((L) => {
      orders.set(L, [...(layers.get(L) || [])]);
    });

    // Barycenter sweeps (down + up) to reduce crossings
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 1; i < layerKeys.length; i++) {
        const prev = posMap(orders.get(layerKeys[i - 1]));
        orders.set(layerKeys[i], barycenter(orders.get(layerKeys[i]), prev, true));
      }
      for (let i = layerKeys.length - 2; i >= 0; i--) {
        const next = posMap(orders.get(layerKeys[i + 1]));
        orders.set(layerKeys[i], barycenter(orders.get(layerKeys[i]), next, false));
      }
    }

    // Adjacent pairwise swaps if they reduce crossings with neighbor layers
    function improveBySwaps(L) {
      const list = orders.get(L);
      if (!list || list.length < 2) return;
      const prev = layerKeys.indexOf(L) > 0 ? orders.get(layerKeys[layerKeys.indexOf(L) - 1]) : null;
      const next = layerKeys.indexOf(L) < layerKeys.length - 1 ? orders.get(layerKeys[layerKeys.indexOf(L) + 1]) : null;
      let improved = true;
      let rounds = 0;
      while (improved && rounds++ < list.length * list.length) {
        improved = false;
        for (let i = 0; i < list.length - 1; i++) {
          const before =
            (prev ? countLayerCrossings(prev, list) : 0) +
            (next ? countLayerCrossings(list, next) : 0);
          const tmp = list[i];
          list[i] = list[i + 1];
          list[i + 1] = tmp;
          const after =
            (prev ? countLayerCrossings(prev, list) : 0) +
            (next ? countLayerCrossings(list, next) : 0);
          if (after < before) {
            improved = true;
          } else {
            list[i + 1] = list[i];
            list[i] = tmp;
          }
        }
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      layerKeys.forEach(improveBySwaps);
    }

    const crossCount = totalCrossings(orders);

    // --- Place in world coords: try both orientations, pick best viewport fill ---
    const H_GAP = 56;
    const V_GAP = 44;
    const ORIGIN = 40;

    function place(horizontal) {
      // horizontal: layers along X, order along Y
      // vertical: layers along Y, order along X
      const positions = new Map();
      const laneSizes = [];
      const layerSizes = [];

      layerKeys.forEach((L, li) => {
        const ids = orders.get(L) || [];
        let laneMax = 0;
        let stack = 0;
        ids.forEach((id, idx) => {
          const n = nodeById(id);
          const s = sizeOf(n);
          if (horizontal) {
            laneMax = Math.max(laneMax, s.w);
            stack += s.h + (idx ? V_GAP : 0);
          } else {
            laneMax = Math.max(laneMax, s.h);
            stack += s.w + (idx ? H_GAP : 0);
          }
        });
        layerSizes[li] = laneMax;
        laneSizes[li] = stack;
      });

      const maxStack = Math.max(0, ...laneSizes);
      let cursor = ORIGIN;
      layerKeys.forEach((L, li) => {
        const ids = orders.get(L) || [];
        const stack = laneSizes[li] || 0;
        let cross = ORIGIN + Math.max(0, (maxStack - stack) / 2);
        ids.forEach((id) => {
          const n = nodeById(id);
          const s = sizeOf(n);
          if (horizontal) {
            positions.set(id, {
              x: cursor + Math.max(0, (layerSizes[li] - s.w) / 2),
              y: cross
            });
            cross += s.h + V_GAP;
          } else {
            positions.set(id, {
              x: cross,
              y: cursor + Math.max(0, (layerSizes[li] - s.h) / 2)
            });
            cross += s.w + H_GAP;
          }
        });
        cursor += layerSizes[li] + (horizontal ? H_GAP : V_GAP);
      });

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      positions.forEach((p, id) => {
        const s = sizeOf(nodeById(id));
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.w);
        maxY = Math.max(maxY, p.y + s.h);
      });
      const gridW = Math.max(1, maxX - minX);
      const gridH = Math.max(1, maxY - minY);
      const scale = Math.min(availW / gridW, availH / gridH);
      const used = (gridW * scale) * (gridH * scale);
      const waste = availW * availH - used;
      const fillX = (gridW * scale) / availW;
      const fillY = (gridH * scale) / availH;
      const balance = Math.abs(fillX - fillY);
      // Prefer max viewport coverage; light weight on orientation balance.
      const score = waste + balance * availW * availH * 0.12;
      return { positions, score, gridW, gridH };
    }

    const horiz = place(true);
    const vert = place(false);
    const chosen = horiz.score <= vert.score ? horiz : vert;

    chosen.positions.forEach((p, id) => {
      const n = nodeById(id);
      if (!n) return;
      n.x = Math.round(p.x);
      n.y = Math.round(p.y);
    });

    setStatus(`چینش خودکار: ${nodes.length} المان · تقاطع تقریبی خطوط ${crossCount} · پر کردن محدوده دید.`, "success");
    render();
    requestAnimationFrame(() => fitDiagramToView());
    return true;
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
      // Geometric exit only — avoid recursion with outgoingAnchor / conditionExitPoint.
      const tc = centerOf(n);
      const exit = src.kind === "condition"
        ? nearestConditionCorner(src, tc.x, tc.y)
        : attachPoint(src, tc.x, tc.y);
      const entry = attachPoint(n, exit.x, exit.y);
      if (n.kind === "condition") keys.add(conditionTipName(n, entry));
      else keys.add(detectSide(n, entry));
    }
    return keys;
  }

  /** Side of a rect node that best faces a world point. */
  function sideTowardPoint(n, px, py) {
    return detectSide(n, nearestSideMid(n, px, py));
  }

  /**
   * Prefer an outgoing side that is NOT where an incoming arrow already lands.
   * Still bias toward the target when that side is free.
   */
  function pickOutgoingSide(n, towardX, towardY) {
    const occupied = occupiedIncomingKeys(n);
    const ordered = [];
    if (towardX != null && towardY != null) {
      ordered.push(sideTowardPoint(n, towardX, towardY));
    }
    for (const s of ["right", "bottom", "top", "left"]) {
      if (!ordered.includes(s)) ordered.push(s);
    }
    return ordered.find((s) => !occupied.has(s)) || ordered[0] || "right";
  }

  /** World anchor for a rect/start/group out-port / edge exit. */
  function outgoingAnchor(n, towardX, towardY) {
    const side = pickOutgoingSide(n, towardX, towardY);
    return anchorOn(n, side);
  }

  /**
   * Prefer a diamond tip that is NOT under an incoming arrow tip.
   * Biases toward the target when that tip is free.
   */
  function pickOutgoingConditionTip(n, towardX, towardY, occupiedExtra) {
    const occupied = new Set(occupiedIncomingKeys(n));
    if (occupiedExtra) {
      for (const k of occupiedExtra) occupied.add(k);
    }
    const prefer = [];
    if (towardX != null && towardY != null) {
      prefer.push(conditionTipName(n, nearestConditionCorner(n, towardX, towardY)));
    }
    for (const name of ["right", "bottom", "top", "left"]) {
      if (!prefer.includes(name)) prefer.push(name);
    }
    return pickFreeConditionTip(n, occupied, prefer);
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
   * Place success/fail exits toward their targets, but never on an incoming tip
   * when another tip is free. If both land on the same tip, keep them side-by-side.
   */
  function conditionBranchExits(n) {
    const c = centerOf(n);
    const okE = diagramEdges().find((e) => e.from === n.id && e.kind === "success");
    const failE = diagramEdges().find((e) => e.from === n.id && e.kind === "fail");
    const okT = okE && nodeById(okE.to);
    const failT = failE && nodeById(failE.to);
    const okToward = okT ? centerOf(okT) : { x: c.x + 140, y: c.y - 28 };
    const failToward = failT ? centerOf(failT) : { x: c.x + 140, y: c.y + 28 };

    let success = pickOutgoingConditionTip(n, okToward.x, okToward.y);
    let fail = pickOutgoingConditionTip(n, failToward.x, failToward.y, [
      conditionTipName(n, success)
    ]);

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
      success = pickOutgoingConditionTip(n, n.x + sizeOf(n).w + 80, n.y - 40, occupied);
      occupied.add(conditionTipName(n, success));
    }
    if (hasFail) {
      fail = pair.fail;
      occupied.add(conditionTipName(n, fail));
    } else {
      fail = pickOutgoingConditionTip(n, n.x + sizeOf(n).w + 80, n.y + sizeOf(n).h + 40, occupied);
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
   * Always prefer a side without an incoming arrow tip.
   */
  function outPortLocal(n, edgeKind = "next") {
    const e = diagramEdges().find((x) => x.from === n.id && x.kind === edgeKind);
    const to = e && nodeById(e.to);
    let towardX;
    let towardY;
    if (to) {
      const c = centerOf(to);
      towardX = c.x;
      towardY = c.y;
    } else {
      const s = sizeOf(n);
      towardX = n.x + s.w + 120;
      towardY = n.y + s.h / 2;
    }
    const a = outgoingAnchor(n, towardX, towardY);
    return { lx: a.x - n.x, ly: a.y - n.y };
  }

  /** Exit tip for a condition branch — nearest toward target, ports may sit side-by-side. */
  function conditionExitPoint(n, edgeKind, towardX, towardY) {
    if (edgeKind !== "success" && edgeKind !== "fail") {
      return pickOutgoingConditionTip(n, towardX, towardY);
    }
    const hasEdge = diagramEdges().some((e) => e.from === n.id && e.kind === edgeKind);
    // While dragging a new branch, follow the cursor tip; keep clear of the sibling port.
    if (!hasEdge && towardX != null && towardY != null) {
      const draw = conditionPortsForDraw(n);
      const other = edgeKind === "success" ? draw.fail : draw.success;
      let tip = pickOutgoingConditionTip(n, towardX, towardY, [
        conditionTipName(n, other)
      ]);
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
    if (from.kind === "condition") return nearestConditionCorner(from, tc.x, tc.y);
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
    return outgoingAnchor(n, x, y);
  }

  /**
   * Route: condition tips / group mid-sides; fan stacked arrivals on same side.
   * Exit prefers a side/tip without an incoming arrow.
   */
  function nearestAnchors(from, to, edgeKind, edgeId) {
    const tc = centerOf(to);
    const fc = centerOf(from);
    const a = from.kind === "condition"
      ? conditionExitPoint(from, edgeKind, tc.x, tc.y)
      : outgoingAnchor(from, tc.x, tc.y);
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
    if (inspHeading) inspHeading.textContent = edgeId ? t("editor.inspector.selectedEdge") : t("editor.inspector.processProps");
    if (edgeId) {
      const e = graph.edges.find((x) => x.id === edgeId);
      const a = e && nodeById(e.from);
      const b = e && nodeById(e.to);
      const kindLabel = e?.kind === "success" ? t("editor.edge.success") : e?.kind === "fail" ? t("editor.edge.fail") : e?.kind === "parent" ? t("editor.edge.parent") : t("editor.edge.other");
      inspector.innerHTML = `
        <p class="palette-hint" style="margin:0 0 10px;line-height:1.7">
          ${t("editor.edge.edgeDesc", { kind: kindLabel, from: esc(a?.title || e?.from || ""), to: esc(b?.title || e?.to || "") })}
        </p>
        <p class="palette-hint" style="margin:0 0 10px">${t("editor.status.tipRetarget")} · <b>Delete</b></p>
        <button type="button" class="btn-flow" id="btn-del-edge" style="width:100%">${t("common.delete")} ${t("editor.inspector.selectedEdge")}</button>`;
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
    setStatus(t("editor.edge.saved"), "info");
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
    status.textContent = t("editor.status.tipRetargetDrop");
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
    status.textContent = t("editor.status.tipRetarget");
  }

  /** Move an existing edge's tip to a new target node. */
  function retargetEdge(edgeId, newToId) {
    const e = graph.edges.find((x) => x.id === edgeId);
    if (!e || !canModify) return false;
    if (String(newToId) === String(e.from)) {
      setStatus(t("editor.status.linkCycle"), "warn");
      return false;
    }
    if (String(newToId) === String(e.to)) {
      setStatus(t("editor.status.saved"), "warn");
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
    setStatus(t("editor.edge.saved"), "success");
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
    tipTitle.textContent = t("editor.status.tipDragRetarget");
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
    if (isActionNode(n) && n.isActive === false) g.classList.add("node-inactive");
    const validity = validateNode(n);
    if (!validity.ok) g.classList.add("node-invalid");
    const fill = n.kind === "start" ? startFill(n)
      : n.kind === "group" ? "#fff"
      : n.kind === "condition" ? COND_FILL
      : isActionNode(n) ? stepFill(n)
      : "#fff";
    const baseStroke = defaultStrokeFor(n);
    const stroke = validity.ok ? baseStroke : validityStrokeFor(n);
    const sw = strokeWidthFor(n, selected.has(n.id));
    if (n.kind === "condition") {
      const verts = conditionDiamondLocal(w, h);
      const pts = verts.map((v) => `${v.lx},${v.ly}`).join(" ");
      const poly = el("polygon", {
        points: pts, fill, stroke,
        "stroke-width": sw
      });
      if (!validity.ok) poly.style.setProperty("--da-stroke", stroke);
      g.appendChild(poly);
    } else {
      const rx = n.kind === "start" ? h / 2 : isActionNode(n) ? 8 : 14;
      const rectAttrs = {
        width: w, height: h, rx, fill, stroke,
        "stroke-width": sw
      };
      if (n.kind === "group") {
        rectAttrs["stroke-dasharray"] = "3.5 3.5";
      }
      const rect = el("rect", rectAttrs);
      if (!validity.ok) rect.style.setProperty("--da-stroke", stroke);
      g.appendChild(rect);
    }
    if (!validity.ok) {
      const tip = document.createElementNS(ns, "title");
      tip.setAttribute("data-da-validity", "1");
      tip.textContent = "نامعتبر: " + validity.reasons.join(" · ");
      g.insertBefore(tip, g.firstChild);
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
        fill: n.kind === "start" ? startLabelFill(n) : "#4b465c",
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
      g.appendChild(makeOutPort(n.id, "next", p.lx, p.ly, 7, startStroke(n)));
    } else if (isActionNode(n)) {
      const p = outPortLocal(n, "next");
      g.appendChild(makeOutPort(n.id, "next", p.lx, p.ly, 6, stepStroke(n)));
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
    setStatus(`کپی «${copy.title}» نزدیک اصل ساخته شد`, "success");
  }

  function groupCanConvertToAction(gid) {
    const { actions, conditions, groups } = groupChildCounts(gid);
    return actions === 0 && conditions === 0 && groups === 0;
  }

  /** Direct children of a group (exclude inner start). */
  function groupDirectChildren(gid) {
    return (graph.nodes || []).filter((x) => x.groupNodeId === gid && x.kind !== "start");
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
      setStatus("اقدام‌های انتخاب‌شده باید در یک سطح دیاگرام باشند.", "warn");
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
      const childN = groupDirectChildren(n.id).length;
      items.push({
        act: "lift-children",
        label: "انتقال فرزندان به این سطح",
        disabled: !canModify || childN === 0,
        title: !canModify
          ? "فقط مشاهده"
          : (childN
            ? "همهٔ فرزندان گروه به همین سطح می‌آیند و گروه خالی می‌ماند"
            : "گروه فرزندی ندارد")
      });
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
      // Show when action lives inside a group (especially nested subgroups).
      const container = n.groupNodeId ? nodeById(n.groupNodeId) : null;
      const nestedUnderGroup = !!(container && container.groupNodeId);
      if (nestedUnderGroup) {
        items.push({
          act: "promote",
          label: "انتقال به سطح بالاتر",
          disabled: !canModify,
          title: !canModify
            ? "فقط مشاهده"
            : "اقدام از این زیرگروه به سطح گروه والد منتقل می‌شود"
        });
      }
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
            setStatus(`«${n.title || "گروه"}» به اقدام تبدیل شد.`, "success");
            render();
          }
        } else if (act === "lift-children") {
          const count = groupDirectChildren(n.id).length;
          if (liftGroupChildrenToParent(n)) {
            setStatus(`${count} فرزند به سطح فعلی منتقل شد؛ گروه خالی ماند.`, "success");
            render();
          }
        } else if (act === "promote") {
          if (promoteStepToParent(n)) {
            setStatus(`اقدام «${n.title || ""}» به سطح بالاتر منتقل شد.`, "success");
            render();
          }
        } else if (act === "to-group") {
          const multi = selectedActionsForGroupConvert();
          const list = (Array.isArray(multi) && multi.length) ? multi : [n];
          if (convertActionsToGroup(list)) {
            setStatus(list.length > 1
              ? `${list.length} اقدام داخل گروه جدید قرار گرفت.`
              : `اقدام «${n.title || ""}» داخل گروه جدید قرار گرفت.`, "success");
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

  /** Lift step one scope up (out of its containing group). */
  function promoteStepToParent(step) {
    if (!canModify || !step || !isActionNode(step) || !step.groupNodeId) return false;
    const parentGroup = nodeById(step.groupNodeId);
    if (!parentGroup) return false;
    const parentScope = parentGroup.groupNodeId || null;
    detachNodeFlowEdges(step.id);
    // Drop legacy contains if this step was the entry.
    graph.edges = (graph.edges || []).filter((e) =>
      !(e.kind === "contains" && e.from === parentGroup.id && e.to === step.id)
    );
    if (parentScope) step.groupNodeId = parentScope;
    else delete step.groupNodeId;
    const sz = sizeOf(parentGroup);
    step.x = parentGroup.x + sz.w + 28;
    step.y = parentGroup.y;
    selected = new Set([step.id]);
    return true;
  }

  /**
   * Move all direct children of a group onto the group's own scope (sibling level),
   * leaving the group empty. Keeps edges between the children.
   */
  function liftGroupChildrenToParent(g) {
    if (!canModify || !g || g.kind !== "group") return false;
    const kids = groupDirectChildren(g.id);
    if (!kids.length) return false;

    const parentScope = g.groupNodeId || null;
    const kidIds = new Set(kids.map((k) => k.id));
    const start = scopeStart(g.id);
    const sz = sizeOf(g);
    const baseX = g.x + sz.w + 28;
    const baseY = g.y;

    // Remove group→entry contains and edges between start and children.
    graph.edges = (graph.edges || []).filter((e) => {
      if (e.kind === "contains" && e.from === g.id) return false;
      if (start && (e.from === start.id || e.to === start.id)
        && (kidIds.has(e.from) || kidIds.has(e.to))) return false;
      return true;
    });

    kids.forEach((kid, i) => {
      if (parentScope) kid.groupNodeId = parentScope;
      else delete kid.groupNodeId;
      kid.x = baseX;
      kid.y = baseY + i * 56;
    });

    selected = new Set(kids.map((k) => k.id));
    selectedEdgeId = null;
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
    if (dsHint) dsHint.innerHTML = "اکسل و منبع پیش‌فرض روی نود <strong>شروع</strong> فرآیند است.";
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
      if (inspHeading) inspHeading.textContent = t("editor.inspector.processProps");
      inspector.innerHTML = processPropsHtml();
      bindProcessProps();
      return;
    }
    if (inspHeading) {
      inspHeading.textContent = n.kind === "group" ? t("editor.inspector.groupProps")
        : isActionNode(n) ? t("editor.inspector.actionProps")
        : n.kind === "condition" ? t("editor.inspector.conditionProps")
        : n.kind === "start"
          ? (n.groupNodeId ? t("editor.inspector.startGroupRepeat") : t("editor.inspector.startRepeat"))
        : t("editor.inspector.props");
    }
    if (n.kind === "start") {
      inspector.innerHTML = startInspectorHtml(n);
      toggleInspFields(n.repeatSourceType || graph.repeatSourceType || "None");
      bindDataSourcesPanel();
    } else if (n.kind === "group") {
      inspector.innerHTML = groupInspectorHtml(n);
    } else if (isActionNode(n)) {
      inspector.innerHTML = stepInspectorHtml(n);
      lockStepInspectorBody(n.isActive !== false);
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
          if (k === "ignorePlayError" && n.kind === "start" && !n.groupNodeId) {
            graph.ignorePlayError = inp.checked;
          }
          if (k === "isActive" && isActionNode(n)) {
            clearTimeout(window.__daInspSwitchT);
            window.__daInspSwitchT = setTimeout(() => {
              renderInspector();
              render();
            }, 220);
            return;
          }
        } else if (k === "dataSourceId" || k === "selectorDataSourceId" || k === "sourceId"
          || k === "equalSelectorDataSourceId"
          || k === "attributeDataSourceId" || k === "equalAttributeDataSourceId"
          || k === "saveDataSourceId") {
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
        } else if (k === "stepDelayMs") {
          const num = Math.max(0, Number(inp.value) || 0);
          n.stepDelayMs = num;
          if (n.kind === "start" && !n.groupNodeId) graph.stepDelayMs = num;
        } else if (k === "highlightColor") {
          const raw = String(inp.value || "").trim();
          if (inp.type === "text" && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) {
            return;
          }
          const color = normalizeHighlightColor(raw);
          n.highlightColor = color;
          if (n.kind === "start" && !n.groupNodeId) {
            graph.highlightColor = color;
            inspector.querySelectorAll('[data-k="highlightColor"]').forEach((el) => {
              if (el !== inp) el.value = color;
            });
          }
          return;
        } else if (k === "moveLoop") {
          n.moveLoop = inp.value === "1" || inp.value === "true" || inp.checked === true;
          if (n.moveLoop || (n.repeatSourceType || "None") !== "DataSource") n.dataSourceId = null;
        } else if (k === "repeatSourceType") {
          let next = inp.value;
          // Process-level start cannot repeat by page elements.
          if (n.kind === "start" && !n.groupNodeId && next === "Elements") next = "None";
          n[k] = next;
          if (n.kind === "start" && !n.groupNodeId) {
            graph.repeatSourceType = next;
            if (next === "DataSource") ensureDefaultDataSource({ forceForRepeat: true });
            if (next !== "DataSource" && next !== "Loops") {
              /* keep default DS even when not used for repeat */
            }
          } else if (n.kind === "start") {
            /* nested group start — do not sync graph.repeatSourceType */
          } else if (n.kind === "group" && next !== "DataSource") {
            n.dataSourceId = null;
          }
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
          syncNodeValidity(n);
          return;
        }
        if (k === "actionType" || k === "conditionType" || k === "contentSourceType" || k === "equalityType"
          || k === "saveTargetType" || k === "systemValueType") {
          if (k === "conditionType") {
            n.contentSourceType = n.contentSourceType || "Constant";
            if (inp.value === "SourceValue") {
              if (!n.sourceId && !n.dataSourceId) {
                n.sourceId = masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
              }
              const cols = dataSourceColumnKeys(n.sourceId || n.dataSourceId);
              if (cols.length && !cols.includes(n.dynamicSourceColumnName)) {
                n.dynamicSourceColumnName = cols[0];
              }
            }
          }
          if (k === "contentSourceType" && inp.value === "DataSource") {
            if (!n.dataSourceId) {
              n.dataSourceId = masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
            }
            const cols = dataSourceColumnKeys(n.dataSourceId);
            if (cols.length && !cols.includes(n.dynamicSourceColumnName)) {
              n.dynamicSourceColumnName = cols[0];
            }
          }
          if (k === "saveTargetType" && inp.value === "DataSource") {
            if (!n.saveDataSourceId) {
              n.saveDataSourceId = masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
            }
            const cols = dataSourceColumnKeys(n.saveDataSourceId);
            if (cols.length && !cols.includes(n.saveColumnName)) {
              n.saveColumnName = cols[0];
            }
          }
          renderInspector();
          syncNodeValidity(n);
          return;
        }
        if (k === "selectorIsDynamic" || k === "equalSelectorIsDynamic"
          || k === "selectorDataSourceId" || k === "equalSelectorDataSourceId"
          || k === "sourceId" || k === "moveLoop" || k === "valueFromSource" || k === "dataSourceId"
          || k === "dynamicSourceColumnName" || k === "selectorDynamicColumn"
          || k === "equalSelectorDynamicColumn" || k === "memoryVariableName"
          || k === "sourceMemoryVariableName" || k === "saveDataSourceId" || k === "saveColumnName"
          || k === "hasAttribute" || k === "equalHasAttribute"
          || k === "attributeValueIsDynamic" || k === "equalAttributeValueIsDynamic"
          || k === "attributeDataSourceId" || k === "equalAttributeDataSourceId"
          || k === "attributeDynamicColumn" || k === "equalAttributeDynamicColumn"
          || k === "selectorWaitEnabled" || k === "equalSelectorWaitEnabled") {
          if (k === "saveDataSourceId" || k === "dataSourceId" || k === "sourceId"
            || k === "selectorDataSourceId" || k === "equalSelectorDataSourceId"
            || k === "attributeDataSourceId" || k === "equalAttributeDataSourceId") {
            /* numeric ids already applied above when type matches; ensure number here if came via this branch */
            const picked = n[k];
            if (k === "dataSourceId" || k === "sourceId" || k === "saveDataSourceId") {
              const colKey = k === "saveDataSourceId" ? "saveColumnName" : "dynamicSourceColumnName";
              const cols = dataSourceColumnKeys(picked);
              if (cols.length && !cols.includes(n[colKey])) n[colKey] = cols[0];
              else if (!cols.length) n[colKey] = "";
            }
            if (k === "selectorDataSourceId" && n.selectorDynamicColumn) {
              const cols = dataSourceColumnKeys(picked);
              if (cols.length && !cols.includes(n.selectorDynamicColumn)) n.selectorDynamicColumn = cols[0];
            }
            if (k === "equalSelectorDataSourceId" && n.equalSelectorDynamicColumn) {
              const cols = dataSourceColumnKeys(picked);
              if (cols.length && !cols.includes(n.equalSelectorDynamicColumn)) n.equalSelectorDynamicColumn = cols[0];
            }
          }
          if (isActionNode(n) && (n.valueFromSource || n.contentSourceType === "DataSource")) {
            syncStepParamFromSource(n);
          }
          // Let switch thumb animate before rebuilding inspector DOM
          const isSwitch = inp.type === "checkbox" && (
            k === "selectorIsDynamic" || k === "equalSelectorIsDynamic"
            || k === "hasAttribute" || k === "equalHasAttribute"
            || k === "attributeValueIsDynamic" || k === "equalAttributeValueIsDynamic"
            || k === "selectorWaitEnabled" || k === "equalSelectorWaitEnabled"
          );
          if (isSwitch) {
            clearTimeout(window.__daInspSwitchT);
            window.__daInspSwitchT = setTimeout(() => {
              renderInspector();
              syncNodeValidity(n);
            }, 300);
          } else {
            renderInspector();
            syncNodeValidity(n);
          }
          return;
        }
        if (k === "selectorWaitMs" || k === "equalSelectorWaitMs") {
          n[k] = Math.max(0, Number(inp.value) || 0);
          syncNodeValidity(n);
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
      if (inp.type === "color") inp.addEventListener("input", apply);
    });
    document.getElementById("insp-goto-start")?.addEventListener("click", () => {
      const start = graph.nodes.find((x) => x.kind === "start");
      if (!start) return;
      selected.clear();
      selected.add(start.id);
      render();
    });
    bindSelectorTools(n);
    if (isActionNode(n)) lockStepInspectorBody(n.isActive !== false);
  }

  const DYN_SEL_PLACEHOLDER = "{مقدار پویا}";

  function stepNeedsSelector(actionType) {
    // Legacy helper — prefer stepShowsTargetSelector(node).
    return stepShowsTargetSelector({ actionType });
  }

  /**
   * Target selector ("هدف روی صفحه"): element the action acts on.
   * Capture: only when value source is page element.
   */
  function stepShowsTargetSelector(n) {
    const at = (n && n.actionType) || "";
    if (stepIsUrlAction(at)) return false;
    if (at === "WaitTime" || at === "CloseFirstTab" || at === "CloseLastTab"
      || at === "Refresh" || at === "NoAction" || !at) {
      return false;
    }
    if (stepIsCapture(at)) {
      migrateCaptureNode(n);
      return normalizeStepValueSource(n) === "Elements";
    }
    return [
      "Click", "DoubleClick", "RightClick", "Hover", "Enter",
      "InputContent", "InsertContent", "LoadContent",
      "WaitForLoading"
    ].includes(at);
  }

  /** Value-source selector: when مقدار comes from a page element (non-capture). */
  function stepShowsValueSelector(n) {
    if (!n) return false;
    if (stepIsCapture(n.actionType)) return false; // capture Elements uses هدف سلکتور
    if (!stepReceivesValue(n.actionType)) return false;
    if (!stepAllowsElementValue(n.actionType)) return false;
    return normalizeStepValueSource(n) === "Elements";
  }

  /** Actions that consume a value (constant / element / datasource / memory / system). */
  function stepReceivesValue(actionType) {
    return [
      "InputContent", "InsertContent", "LoadContent",
      "WaitTime", "GoToUrl", "Navigate", "NewPage"
    ].includes(actionType || "");
  }

  function stepNeedsValueSource(n) {
    const at = n?.actionType || "";
    return stepReceivesValue(at) || stepIsCapture(at);
  }

  function stepIsCapture(actionType) {
    return actionType === "TakeContent" || actionType === "SaveContent";
  }

  function stepIsUrlAction(actionType) {
    return actionType === "GoToUrl" || actionType === "Navigate" || actionType === "NewPage";
  }

  /** Memory variables available as value source wherever «نوع مقدار» exists. */
  function stepAllowsMemoryValue(actionType) {
    return stepReceivesValue(actionType) || stepIsCapture(actionType);
  }

  function stepAllowsElementValue(actionType) {
    if (actionType === "WaitTime") return false;
    return actionType === "InputContent" || actionType === "InsertContent" || actionType === "LoadContent"
      || stepIsUrlAction(actionType) || stepIsCapture(actionType);
  }

  function stepAllowsSystemValue(actionType) {
    if (actionType === "WaitTime") return false;
    return stepReceivesValue(actionType) || stepIsCapture(actionType);
  }

  const SYSTEM_VALUE_OPTIONS = [
    ["CurrentDateTime", "تاریخ و زمان جاری"],
    ["CurrentDate", "تاریخ جاری"],
    ["CurrentTime", "زمان جاری"],
    ["Timestamp", "برچسب زمانی (میلی‌ثانیه)"],
    ["Uuid", "شناسه یکتا (UUID)"],
    ["RandomInt", "عدد تصادفی"]
  ];

  function systemValueOptionsHtml(cur) {
    const c = cur || "CurrentDateTime";
    return SYSTEM_VALUE_OPTIONS.map(([v, t]) =>
      `<option value="${v}" ${c === v ? "selected" : ""}>${t}</option>`
    ).join("");
  }

  /** Legacy capture used contentSourceType as destination (Memory/DataSource). */
  function migrateCaptureNode(n) {
    if (!n || !stepIsCapture(n.actionType)) return;
    if (n.saveTargetType === "Memory" || n.saveTargetType === "DataSource") return;
    if (n.contentSourceType === "Memory" || n.contentSourceType === "DataSource") {
      n.saveTargetType = n.contentSourceType;
      n.contentSourceType = "Elements";
    } else {
      n.saveTargetType = "Memory";
    }
  }

  function normalizeSaveTarget(n) {
    migrateCaptureNode(n);
    let t = n.saveTargetType || "Memory";
    if (t !== "DataSource") t = "Memory";
    n.saveTargetType = t;
    return t;
  }

  /** Leaf validity (no group-container recursion). */
  function validateNodeLeaf(n) {
    if (!n) return { ok: true, reasons: [] };
    if (isActionNode(n)) return validateActionNode(n);
    if (n.kind === "condition") return validateConditionNode(n);
    if (n.kind === "start") return validateStartNode(n);
    return { ok: true, reasons: [] };
  }

  /** True if any descendant inside this group (nested groups included) fails leaf validation. */
  function groupHasInvalidContent(groupId) {
    const kids = (graph.nodes || []).filter((x) => x.groupNodeId === groupId);
    for (const kid of kids) {
      if (kid.kind === "group") {
        if (groupHasInvalidContent(kid.id)) return true;
        continue;
      }
      if (!validateNodeLeaf(kid).ok) return true;
    }
    return false;
  }

  function validateGroupNode(n) {
    const reasons = [];
    if (n?.id && groupHasInvalidContent(n.id)) {
      reasons.push("داخل گروه المان نامعتبر وجود دارد");
    }
    return { ok: reasons.length === 0, reasons };
  }

  function validateNode(n) {
    if (!n) return { ok: true, reasons: [] };
    if (isActionNode(n)) return validateActionNode(n);
    if (n.kind === "condition") return validateConditionNode(n);
    if (n.kind === "start") return validateStartNode(n);
    if (n.kind === "group") return validateGroupNode(n);
    return { ok: true, reasons: [] };
  }

  function applyNodeValidityClass(g, n) {
    if (!g || !n) return;
    const v = validateNode(n);
    g.classList.toggle("node-invalid", !v.ok);
    const shape = g.querySelector(":scope > rect, :scope > polygon");
    if (shape) {
      const stroke = v.ok ? defaultStrokeFor(n) : validityStrokeFor(n);
      shape.setAttribute("stroke", stroke);
      if (!v.ok) {
        shape.setAttribute("data-invalid", "1");
        shape.style.setProperty("--da-stroke", stroke);
      } else {
        shape.removeAttribute("data-invalid");
        shape.style.removeProperty("--da-stroke");
        shape.style.removeProperty("stroke-opacity");
      }
    }
    let tip = null;
    for (const t of g.querySelectorAll("title")) {
      if (t.getAttribute("data-da-validity") === "1") tip = t;
    }
    if (!v.ok) {
      if (!tip) {
        tip = document.createElementNS(ns, "title");
        tip.setAttribute("data-da-validity", "1");
        g.insertBefore(tip, g.firstChild);
      }
      tip.textContent = "نامعتبر: " + v.reasons.join(" · ");
    } else if (tip) {
      tip.remove();
    }
  }

  function syncAncestorGroupValidity(n) {
    let gid = n?.groupNodeId || null;
    const seen = new Set();
    while (gid && !seen.has(gid)) {
      seen.add(gid);
      const gNode = nodeById(gid);
      if (!gNode) break;
      const elG = world.querySelector(`g.node[data-id="${CSS.escape(String(gNode.id))}"]`);
      if (elG) applyNodeValidityClass(elG, gNode);
      gid = gNode.groupNodeId || null;
    }
  }

  function syncNodeValidity(n) {
    if (!n) return;
    const g = world.querySelector(`g.node[data-id="${CSS.escape(String(n.id))}"]`);
    if (g) applyNodeValidityClass(g, n);
    syncAncestorGroupValidity(n);
  }
  function validateSelectorBlock(n, opts = {}) {
    const valueKey = opts.valueKey || "selectorValue";
    const dynFlag = opts.dynFlag || "selectorIsDynamic";
    const dynCol = opts.dynCol || "selectorDynamicColumn";
    const hasAttr = opts.hasAttr || "hasAttribute";
    const attrName = opts.attrName || "attributeName";
    const attrDyn = opts.attrDynFlag || "attributeValueIsDynamic";
    const attrCol = opts.attrDynCol || "attributeDynamicColumn";
    const label = opts.label || "سلکتور";

    const sel = String(n[valueKey] || "").trim();
    if (!sel) return { ok: false, reason: `${label} خالی است` };
    if (n[dynFlag] === true) {
      if (!selectorHasDynPlaceholder(sel)) {
        return { ok: false, reason: `${label} پویا باید «{مقدار پویا}» یا {{ستون}} داشته باشد` };
      }
      if (sel.includes(DYN_SEL_PLACEHOLDER) && !String(n[dynCol] || "").trim()) {
        return { ok: false, reason: `ستون ${label} پویا مشخص نیست` };
      }
    }
    if (n[hasAttr] === true) {
      if (!String(n[attrName] || "").trim()) {
        return { ok: false, reason: `نام اتریبیوت ${label} خالی است` };
      }
      if (n[attrDyn] === true && !String(n[attrCol] || "").trim()) {
        return { ok: false, reason: `ستون اتریبیوت پویای ${label} مشخص نیست` };
      }
    }
    return { ok: true };
  }

  function validateDataSourcePick(n, opts = {}) {
    const dsKey = opts.dsKey || "dataSourceId";
    const colKey = opts.colKey || "dynamicSourceColumnName";
    const dsId = n[dsKey] || n.sourceId || n.dataSourceId;
    if (dsId == null || dsId === "") return { ok: false, reason: opts.dsReason || "منبع داده انتخاب نشده" };
    if (!String(n[colKey] || "").trim()) {
      return { ok: false, reason: opts.colReason || "ستون منبع داده انتخاب نشده" };
    }
    return { ok: true };
  }

  function validateActionNode(n) {
    const reasons = [];
    if (n.isActive === false) return { ok: true, reasons };
    const at = n.actionType || "";
    if (!at || at === "NoAction") return { ok: true, reasons };

    if (stepShowsTargetSelector(n)) {
      const v = validateSelectorBlock(n, { label: "سلکتور هدف" });
      if (!v.ok) reasons.push(v.reason);
    }

    if (stepIsCapture(at)) {
      migrateCaptureNode(n);
      const src = normalizeStepValueSource(n);
      if (src === "Constant") {
        if (!String(n.constantValue || "").trim()) reasons.push("مقدار ثابت ذخیره خالی است");
      } else if (src === "Elements") {
        const v = validateSelectorBlock(n, { label: "سلکتور المان صفحه" });
        if (!v.ok) reasons.push(v.reason);
      } else if (src === "DataSource") {
        const v = validateDataSourcePick(n);
        if (!v.ok) reasons.push(v.reason);
      } else if (src === "Memory") {
        if (!String(n.sourceMemoryVariableName || "").trim()) {
          reasons.push("متغیر منبع حافظه مشخص نیست");
        }
      } else if (src === "System") {
        if (!String(n.systemValueType || "").trim()) {
          reasons.push("نوع مقدار پیش‌فرض سیستم مشخص نیست");
        }
      }
      const dest = normalizeSaveTarget(n);
      if (dest === "Memory") {
        if (!String(n.memoryVariableName || "").trim()) {
          reasons.push("نام متغیر مقصد حافظه مشخص نیست");
        }
      } else {
        const saveDs = n.saveDataSourceId != null ? n.saveDataSourceId : n.dataSourceId;
        const saveCol = n.saveColumnName || (src === "DataSource" ? "" : n.dynamicSourceColumnName);
        // When value is also DataSource, destination must use save* fields
        if (src === "DataSource") {
          if (saveDs == null || saveDs === "") reasons.push("منبع مقصد ذخیره انتخاب نشده");
          if (!String(n.saveColumnName || "").trim()) reasons.push("ستون مقصد ذخیره انتخاب نشده");
        } else {
          const v = validateDataSourcePick({
            dataSourceId: saveDs,
            dynamicSourceColumnName: saveCol || n.dynamicSourceColumnName
          }, { dsReason: "منبع مقصد ذخیره انتخاب نشده", colReason: "ستون مقصد ذخیره انتخاب نشده" });
          if (!v.ok) reasons.push(v.reason);
        }
      }
    } else if (stepReceivesValue(at)) {
      const src = normalizeStepValueSource(n);
      if (src === "Constant") {
        if (at === "WaitTime") {
          const ms = Number(n.constantValue);
          if (!Number.isFinite(ms) || ms < 0 || String(n.constantValue ?? "").trim() === "") {
            reasons.push("زمان انتظار مشخص نیست");
          }
        } else if (stepIsUrlAction(at)) {
          const url = String(n.navigateUrl || n.constantValue || "").trim();
          if (!url) reasons.push("آدرس ثابت خالی است");
        } else if (!String(n.constantValue || "").trim()) {
          reasons.push("مقدار ثابت خالی است");
        }
      } else if (src === "Elements") {
        const v = validateSelectorBlock(n, {
          valueKey: "equalSelectorValue",
          dynFlag: "equalSelectorIsDynamic",
          dynCol: "equalSelectorDynamicColumn",
          hasAttr: "equalHasAttribute",
          attrName: "equalAttributeName",
          attrDynFlag: "equalAttributeValueIsDynamic",
          attrCol: "equalAttributeDynamicColumn",
          label: stepIsUrlAction(at) ? "سلکتور آدرس" : "سلکتور منبع مقدار"
        });
        if (!v.ok) reasons.push(v.reason);
      } else if (src === "DataSource") {
        const v = validateDataSourcePick(n);
        if (!v.ok) reasons.push(v.reason);
      } else if (src === "Memory") {
        if (!String(n.memoryVariableName || "").trim()) {
          reasons.push("متغیر حافظه مشخص نیست");
        }
      } else if (src === "System") {
        if (!String(n.systemValueType || "").trim()) {
          reasons.push("نوع مقدار پیش‌فرض سیستم مشخص نیست");
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  function validateConditionNode(n) {
    const reasons = [];
    const ct = n.conditionType || "None";
    if (!ct || ct === "None") {
      reasons.push("نوع شرط انتخاب نشده");
      return { ok: false, reasons };
    }
    const eq = n.equalityType || "equal";
    const src = n.contentSourceType || "Constant";

    if (["FindElement", "NotFindElement", "FindElements", "ElementValue"].includes(ct)) {
      const v = validateSelectorBlock(n, { label: "سلکتور شرط" });
      if (!v.ok) reasons.push(v.reason);
    }
    if (ct === "SourceValue") {
      if (!n.sourceId && !n.dataSourceId) {
        reasons.push("منبع مورد بررسی انتخاب نشده");
      } else if (!String(n.dynamicSourceColumnName || "").trim()) {
        reasons.push("ستون مورد بررسی انتخاب نشده");
      }
    }

    if (conditionNeedsCompareOperand(ct, eq)) {
      if (src === "Constant") {
        const val = ct === "Url"
          ? String(n.navigation || n.constantEqualValue || n.constantValue || "").trim()
          : String(n.constantEqualValue ?? n.constantValue ?? n.navigation ?? "").trim();
        // FindElements / DriverTabs: "0" is valid
        if (ct === "FindElements" || ct === "DriverTabs") {
          if (val === "" || !Number.isFinite(Number(val))) {
            reasons.push("مقدار عددی مقایسه مشخص نیست");
          }
        } else if (!val) {
          reasons.push("مقدار مقایسه خالی است");
        }
      } else if (src === "Elements") {
        const v = validateSelectorBlock(n, {
          valueKey: "equalSelectorValue",
          dynFlag: "equalSelectorIsDynamic",
          dynCol: "equalSelectorDynamicColumn",
          hasAttr: "equalHasAttribute",
          attrName: "equalAttributeName",
          attrDynFlag: "equalAttributeValueIsDynamic",
          attrCol: "equalAttributeDynamicColumn",
          label: "سلکتور مقدار مقایسه"
        });
        if (!v.ok) reasons.push(v.reason);
      } else if (src === "DataSource" && ct !== "SourceValue") {
        const v = validateDataSourcePick(n);
        if (!v.ok) reasons.push(v.reason);
      } else if (src === "Memory") {
        if (!String(n.memoryVariableName || n.sourceMemoryVariableName || "").trim()) {
          reasons.push("متغیر حافظه مقایسه مشخص نیست");
        }
      } else if (src === "System") {
        if (!String(n.systemValueType || "").trim()) {
          reasons.push("نوع مقدار پیش‌فرض مقایسه مشخص نیست");
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  function validateStartNode(n) {
    const reasons = [];
    const rst = n.repeatSourceType || (n.groupNodeId ? "None" : (graph.repeatSourceType || "None"));
    if (rst === "Loops") {
      const lc = Number(n.loopCount ?? n.constantValue);
      if (!Number.isFinite(lc) || lc < 1) reasons.push("تعداد تکرار حلقه نامعتبر است");
    } else if (rst === "DataSource") {
      const id = n.dataSourceId ?? graph.dataSourceId ?? masterDataSourceId();
      const sources = graph.dataSources || [];
      const exists = id != null && sources.some((d) => Number(d.id) === Number(id));
      if (!exists) {
        reasons.push("منبع پیش‌فرض برای تکرار مشخص نشده");
      }
    } else if (rst === "Elements") {
      if (!n.groupNodeId) {
        reasons.push("تکرار با المان صفحه فقط داخل گروه مجاز است");
      } else {
        const v = validateSelectorBlock(n, { label: "سلکتور تکرار" });
        if (!v.ok) reasons.push(v.reason);
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  function knownMemoryVariableNames() {
    const names = new Set();
    (graph.nodes || []).forEach((n) => {
      if (!isActionNode(n)) return;
      if (n.memoryVariableName) names.add(String(n.memoryVariableName).trim());
      if (n.sourceMemoryVariableName) names.add(String(n.sourceMemoryVariableName).trim());
    });
    return [...names].filter(Boolean).sort();
  }

  function normalizeStepValueSource(n) {
    migrateCaptureNode(n);
    let src = n.contentSourceType;
    const at = n.actionType || "";
    if (!src || src === "None") {
      src = n.valueFromSource ? "DataSource"
        : (stepIsCapture(at) ? "Elements" : "Constant");
    }
    const allowed = new Set(["Constant", "DataSource"]);
    if (stepAllowsElementValue(at)) allowed.add("Elements");
    if (stepAllowsMemoryValue(at)) allowed.add("Memory");
    if (stepAllowsSystemValue(at)) allowed.add("System");
    if (!allowed.has(src)) src = stepIsCapture(at) ? "Elements" : "Constant";
    n.contentSourceType = src;
    n.valueFromSource = src === "DataSource";
    return src;
  }

  function lockStepInspectorBody(active) {
    const body = inspector.querySelector(".insp-step-body");
    if (!body) return;
    body.classList.toggle("is-disabled", !active);
    body.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (el.closest(".insp-switches-row")) return;
      el.disabled = !active;
    });
    const ignore = inspector.querySelector('.insp-switches-row [data-k="ignoreError"]');
    if (ignore) ignore.disabled = !active;
  }

  function stepInspectorHtml(n) {
    if (n.isActive == null) n.isActive = true;
    const active = n.isActive !== false;
    const at = n.actionType || "Click";
    const ignoreError = n.ignoreError === true;
    const disabledAttr = active ? "" : "disabled";

    let body = field("عنوان", "title", n.title) +
      `<div class="insp-field"><label>نوع اقدام</label><select data-k="actionType" ${disabledAttr}>${optActions(at)}</select></div>`;

    if (at === "NewPage") {
      body += `<p class="palette-hint">تب جدید باز می‌شود و به آدرس می‌رود.</p>`;
    }
    if (at === "CloseFirstTab" || at === "CloseLastTab") {
      body += `<p class="palette-hint">${at === "CloseFirstTab" ? "اولین تب پنجره بسته می‌شود." : "آخرین تب پنجره بسته می‌شود."}</p>`;
    }

    if (stepNeedsValueSource(n)) body += stepValueSourceHtml(n);
    if (stepIsCapture(at)) body += stepCaptureTargetHtml(n);

    // Target selector depends on action type (+ capture only when value = Elements).
    if (stepShowsTargetSelector(n)) {
      body += `<div class="insp-section-title">${stepIsCapture(at) ? "المان صفحه (مقدار)" : "هدف روی صفحه"}</div>`;
      body += selectorFieldHtml(n, "سلکتور", { includeFramePath: true });
    }

    return `
      <div class="insp-field insp-active-field">
        <div class="insp-switches-row">
          <label class="da-switch">
            <input type="checkbox" data-k="isActive" ${active ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">${active ? "فعال" : "غیرفعال"}</span>
          </label>
          <label class="da-switch da-switch-end">
            <input type="checkbox" data-k="ignoreError" ${ignoreError ? "checked" : ""} ${disabledAttr}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">چشم‌پوشی از خطا</span>
          </label>
        </div>
        <p class="palette-hint" style="margin:6px 0 0;line-height:1.55">
          غیرفعال: فقط در لاگ ثبت می‌شود.
          چشم‌پوشی از خطا روشن: با خطا مرحلهٔ بعدی اجرا می‌شود.
        </p>
      </div>
      <div class="insp-step-body${active ? "" : " is-disabled"}" ${active ? "" : "aria-disabled=\"true\""}>
        ${body}
      </div>`;
  }

  function stepCaptureTargetHtml(n) {
    migrateCaptureNode(n);
    const dest = normalizeSaveTarget(n);
    const src = normalizeStepValueSource(n);
    const saveDsId = n.saveDataSourceId != null ? n.saveDataSourceId : (src === "DataSource" ? null : n.dataSourceId);
    const saveCol = n.saveColumnName || "";
    const dsOpts = processDataSourceOptions(saveDsId);
    const cols = dataSourceColumnKeys(saveDsId);
    const colOpts = cols.map((c) =>
      `<option value="${esc(c)}" ${saveCol === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");
    return `
      <div class="insp-section-title">مقصد ذخیره</div>
      <div class="insp-field"><label>ذخیره در</label>
        <select data-k="saveTargetType">
          <option value="Memory" ${dest === "Memory" ? "selected" : ""}>حافظه (متغیر)</option>
          <option value="DataSource" ${dest === "DataSource" ? "selected" : ""}>منبع داده</option>
        </select>
      </div>
      ${dest === "Memory" ? `
        <div class="insp-field"><label>نام متغیر مقصد</label>
          <input data-k="memoryVariableName" list="mem-var-list-dest" value="${esc(n.memoryVariableName || "")}" placeholder="مثلاً titleText" />
          <datalist id="mem-var-list-dest">${knownMemoryVariableNames().map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
        </div>
        <p class="palette-hint">مقدار خوانده‌شده در این متغیر ذخیره می‌شود و بعداً قابل استفاده است.</p>
      ` : `
        <div class="insp-field"><label>منبع مقصد</label>
          <select data-k="saveDataSourceId"><option value="">—</option>${dsOpts}</select>
        </div>
        <div class="insp-field"><label>ستون مقصد</label>
          <select data-k="saveColumnName"><option value="">—</option>${colOpts}</select>
        </div>
      `}`;
  }

  function stepValueSourceHtml(n) {
    const at = n.actionType || "";
    const src = normalizeStepValueSource(n);
    const isUrl = stepIsUrlAction(at);
    const isWait = at === "WaitTime";
    const isCapture = stepIsCapture(at);
    const sectionTitle = isCapture ? "مقدار برای ذخیره" : (isUrl ? "آدرس" : (isWait ? "زمان انتظار" : "مقدار"));
    const constLabel = isUrl ? "آدرس ثابت" : (isWait ? "میلی‌ثانیه (ثابت)" : "مقدار ثابت");
    const constKey = isUrl ? "navigateUrl" : "constantValue";
    const constVal = isUrl ? (n.navigateUrl || n.constantValue || "") : (n.constantValue || "");

    const dsId = n.dataSourceId || masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
    if (src === "DataSource" && dsId && !n.dataSourceId) n.dataSourceId = dsId;
    const dsOpts = processDataSourceOptions(dsId);
    const cols = dataSourceColumnKeys(dsId);
    const colOpts = cols.map((c) =>
      `<option value="${esc(c)}" ${n.dynamicSourceColumnName === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");
    const emptyDs = !(graph.dataSources || []).length
      ? `<p class="palette-hint">منبعی نیست — روی نود شروع اکسل اضافه کنید.</p>`
      : "";
    const memNames = knownMemoryVariableNames();
    if (!n.systemValueType) n.systemValueType = "CurrentDateTime";

    let html = `<div class="insp-section-title">${sectionTitle}</div>
      <div class="insp-field"><label>نوع مقدار</label>
        <select data-k="contentSourceType">
          <option value="Constant" ${src === "Constant" ? "selected" : ""}>ثابت</option>
          ${stepAllowsElementValue(at) ? `<option value="Elements" ${src === "Elements" ? "selected" : ""}>عنصر صفحه</option>` : ""}
          <option value="DataSource" ${src === "DataSource" ? "selected" : ""}>منبع داده</option>
          ${stepAllowsMemoryValue(at) ? `<option value="Memory" ${src === "Memory" ? "selected" : ""}>حافظه (متغیر)</option>` : ""}
          ${stepAllowsSystemValue(at) ? `<option value="System" ${src === "System" ? "selected" : ""}>پیش‌فرض سیستم</option>` : ""}
        </select>
      </div>`;

    if (src === "Constant") {
      html += `<div class="insp-field"><label>${constLabel}</label>
        <input data-k="${constKey}" value="${esc(constVal)}" placeholder="${isUrl ? "https://..." : (isWait ? "مثلاً 1000" : "")}" />
      </div>`;
    } else if (src === "Elements" && stepShowsValueSelector(n)) {
      html += selectorFieldHtml(n, isUrl ? "سلکتور المان (آدرس)" : "سلکتور عنصر منبع مقدار", {
        valueKey: "equalSelectorValue",
        dynFlag: "equalSelectorIsDynamic",
        dynDs: "equalSelectorDataSourceId",
        dynCol: "equalSelectorDynamicColumn",
        hasAttr: "equalHasAttribute",
        attrName: "equalAttributeName",
        attrDynFlag: "equalAttributeValueIsDynamic",
        attrValue: "equalAttributeValue",
        attrDynCol: "equalAttributeDynamicColumn",
        attrDynDs: "equalAttributeDataSourceId",
        waitFlag: "equalSelectorWaitEnabled",
        waitMsKey: "equalSelectorWaitMs",
        includeFramePath: true
      });
      if (isUrl) {
        html += `<p class="palette-hint">متن/مقدار این المان به‌عنوان آدرس استفاده می‌شود.</p>`;
      }
    } else if (src === "Elements" && isCapture) {
      html += `<p class="palette-hint">سلکتور المان در بخش پایین («المان صفحه») تنظیم می‌شود.</p>`;
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
      const memKey = isCapture ? "sourceMemoryVariableName" : "memoryVariableName";
      const memVal = isCapture ? (n.sourceMemoryVariableName || "") : (n.memoryVariableName || "");
      html += `<div class="insp-field"><label>متغیر حافظه${isCapture ? " (منبع)" : ""}</label>
        <input data-k="${memKey}" list="mem-var-list" value="${esc(memVal)}" placeholder="نام متغیر" />
        <datalist id="mem-var-list">${memNames.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
      </div>
      ${!memNames.length
        ? `<p class="palette-hint">هنوز متغیری نیست — ابتدا مقداری در حافظه ذخیره کنید.</p>`
        : `<p class="palette-hint">مقدار ذخیره‌شده در این متغیر خوانده می‌شود.</p>`}`;
    } else if (src === "System") {
      html += `<div class="insp-field"><label>نوع پیش‌فرض</label>
        <select data-k="systemValueType">${systemValueOptionsHtml(n.systemValueType)}</select>
      </div>
      <p class="palette-hint">مقدار در لحظهٔ اجرا توسط سیستم تولید می‌شود.</p>`;
    }
    return html;
  }

  function processDataSourceOptions(selectedId, { markMaster = true } = {}) {
    const masterId = masterDataSourceId();
    const list = graph.dataSources || [];
    if (!list.length) {
      return `<option value="">— منبعی نیست (روی شروع اکسل اضافه کنید) —</option>`;
    }
    return list.map((d) => {
      const label = d.title || dataSourceFileTitle(d.fileName) || `منبع ${d.id}`;
      const meta = d.rowCount != null ? ` (${d.rowCount} ردیف · ${(d.columnKeys || d.columns || []).length || d.columnCount || 0} ستون)` : "";
      const tag = markMaster && Number(d.id) === Number(masterId) ? " — پیش‌فرض" : "";
      return `<option value="${d.id}" ${Number(selectedId) === Number(d.id) ? "selected" : ""}>${esc(label)}${meta}${tag}</option>`;
    }).join("");
  }

  function syncStepParamFromSource(n) {
    if ((n.contentSourceType || "") !== "DataSource" && !n.valueFromSource) return;
    if (!n.dynamicSourceColumnName) return;
    // Keep constant/url empty when reading from DS — engine resolves from column.
  }

  function dataSourceColumnKeys(dsId) {
    if (dsId == null || dsId === "") return [];
    const ds = (graph.dataSources || []).find((d) => Number(d.id) === Number(dsId));
    if (!ds) return [];
    if (Array.isArray(ds.columnKeys) && ds.columnKeys.length) {
      return ds.columnKeys.map((k) => String(k)).filter(Boolean);
    }
    if (Array.isArray(ds.columns) && ds.columns.length) {
      return ds.columns.map((c) => c.key || c.Key || c.title || c.Title).filter(Boolean).map(String);
    }
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
    const waitFlag = opts.waitFlag || "selectorWaitEnabled";
    const waitMsKey = opts.waitMsKey || "selectorWaitMs";
    const wrapId = opts.wrapId ? ` id="${opts.wrapId}"` : "";

    // Default off unless explicitly true
    if (n[dynFlag] == null) n[dynFlag] = false;
    if (n[hasAttrKey] == null) n[hasAttrKey] = false;
    if (n[attrDynFlag] == null) n[attrDynFlag] = false;
    if (n[waitFlag] == null) n[waitFlag] = false;
    if (n[waitMsKey] == null || n[waitMsKey] === "") n[waitMsKey] = 10000;
    const dynOn = n[dynFlag] === true;
    const attrOn = n[hasAttrKey] === true;
    const attrDynOn = n[attrDynFlag] === true;
    const waitOn = n[waitFlag] === true;
    const waitMs = Math.max(0, Number(n[waitMsKey]) || 0);
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
        <div class="insp-field insp-sel-wait">
          <label class="da-switch">
            <input type="checkbox" data-k="${waitFlag}" ${waitOn ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">انتظار تا ظاهر شدن المان</span>
          </label>
          <p class="palette-hint" style="margin:4px 0 0;line-height:1.55">
            خاموش: یک‌بار جستجو؛ اگر نبود، خطا (نات‌فاوند).
            روشن: تا سقف زیر صبر می‌کند؛ بعد از آن نات‌فاوند.
          </p>
          ${waitOn ? `
            <div class="insp-sel-wait-ms">
              <label>حداکثر انتظار (ms)</label>
              <input type="number" min="0" step="100" data-k="${waitMsKey}" value="${esc(waitMs)}" />
            </div>
          ` : ""}
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
    setStatus("سلکتور از حافظه خوانده شد.", "success");
    render();
    return true;
  }

  async function saveSelectorToMemory(n, preferKey) {
    const payload = buildSelectorPayloadFromNode(n, preferKey);
    if (!payload.selector) {
      setStatus("سلکتور خالی است — چیزی برای ذخیره نیست.", "warn");
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

    setStatus(extOk
      ? "سلکتور در حافظه افزونه ذخیره شد."
      : "سلکتور در حافظه محلی ذخیره شد.", "success");
  }

  async function loadSelectorFromMemory(n, preferKey) {
    const hasSelectorExt = document.documentElement.dataset.daSelectorExtension === "1";
    // Prefer extension memory (Dynamic Automator Selector)
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
        setStatus("سلکتور از حافظه خوانده شد.", "success");
        render();
        return true;
      }
    } catch { /* fall through */ }

    // localStorage fallback
    try {
      const raw = localStorage.getItem(SEL_MEM_KEY);
      const parsed = parseDaSelectorText(raw);
      if (parsed) {
        applySelectorPayload(n, parsed, preferKey);
        setStatus("سلکتور از حافظه محلی خوانده شد.", "success");
        render();
        return true;
      }
    } catch { /* ignore */ }

    // clipboard last
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseDaSelectorText(text);
      if (parsed) {
        applySelectorPayload(n, parsed, preferKey);
        setStatus("سلکتور از کلیپ‌بورد خوانده شد.", "success");
        render();
        return true;
      }
    } catch { /* ignore */ }

    if (!hasSelectorExt) {
      setStatus("افزونهٔ سلکتور نصب نیست — از صفحهٔ نصب، مسیر Selector را Load unpacked کنید.", "warn");
    } else {
      setStatus("سلکتوری در حافظه نیست. روی صفحه راست‌کلیک → «کپی سلکتور».", "warn");
    }
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
      case "DataSource": return "ردیف‌های منبع پیش‌فرض";
      default: return "یک‌بار";
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

    if (needsSubjectDs && !n.sourceId && !n.dataSourceId) {
      const fallback = masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
      if (fallback) n.sourceId = fallback;
    }
    const subjectDsId = n.sourceId || n.dataSourceId || masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
    if (needsSubjectDs && subjectDsId && !n.sourceId) n.sourceId = subjectDsId;
    const subjectDsOpts = processDataSourceOptions(subjectDsId);
    const subjectCols = dataSourceColumnKeys(subjectDsId);
    if (needsSubjectDs && subjectCols.length && !subjectCols.includes(n.dynamicSourceColumnName)) {
      n.dynamicSourceColumnName = subjectCols[0];
    }
    const subjectColOpts = subjectCols.map((c) =>
      `<option value="${esc(c)}" ${n.dynamicSourceColumnName === c ? "selected" : ""}>${esc(c)}</option>`
    ).join("");

    let compareDsId = n.dataSourceId || n.sourceId || masterDataSourceId() || (graph.dataSources || [])[0]?.id || null;
    if (src === "DataSource" && allowCompareDs && compareDsId && !n.dataSourceId) n.dataSourceId = compareDsId;
    compareDsId = n.dataSourceId || n.sourceId || compareDsId;
    const compareDsOpts = processDataSourceOptions(compareDsId);
    const compareCols = dataSourceColumnKeys(compareDsId);
    if (src === "DataSource" && allowCompareDs && compareCols.length && !compareCols.includes(n.dynamicSourceColumnName)) {
      n.dynamicSourceColumnName = compareCols[0];
    }
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
            <option value="Memory" ${src === "Memory" ? "selected" : ""}>حافظه (متغیر)</option>
            <option value="System" ${src === "System" ? "selected" : ""}>پیش‌فرض سیستم</option>
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
          attrDynDs: "equalAttributeDataSourceId",
          waitFlag: "equalSelectorWaitEnabled",
          waitMsKey: "equalSelectorWaitMs"
        });
      } else if (src === "DataSource" && allowCompareDs) {
        html += `<div class="insp-field"><label>منبع داده</label>
            <select data-k="dataSourceId"><option value="">— انتخاب منبع —</option>${compareDsOpts}</select>
          </div>
          <div class="insp-field"><label>ستون</label>
            <select data-k="dynamicSourceColumnName"><option value="">— انتخاب ستون —</option>${compareColOpts}</select>
          </div>`;
      } else if (src === "Memory") {
        html += `<div class="insp-field"><label>متغیر حافظه</label>
          <input data-k="memoryVariableName" list="mem-var-list-cond" value="${esc(n.memoryVariableName || "")}" placeholder="نام متغیر" />
          <datalist id="mem-var-list-cond">${knownMemoryVariableNames().map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
        </div>`;
      } else if (src === "System") {
        if (!n.systemValueType) n.systemValueType = "CurrentDateTime";
        html += `<div class="insp-field"><label>نوع پیش‌فرض</label>
          <select data-k="systemValueType">${systemValueOptionsHtml(n.systemValueType)}</select>
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
    // Nested group start keeps Elements (group can use page selectors).
    if (n.groupNodeId) return groupStartInspectorHtml(n);

    normalizeProcessRepeat();
    const rst = n.repeatSourceType || graph.repeatSourceType || "None";
    n.repeatSourceType = rst;
    n.dataSourceId = n.dataSourceId ?? graph.dataSourceId ?? null;
    n.loopCount = n.loopCount ?? graph.loopCount ?? (Number(graph.constantValue) || 1);
    n.stepDelayMs = n.stepDelayMs ?? graph.stepDelayMs ?? 0;
    graph.stepDelayMs = n.stepDelayMs;
    if (n.ignorePlayError == null && graph.ignorePlayError == null) n.ignorePlayError = true;
    else if (n.ignorePlayError == null) n.ignorePlayError = graph.ignorePlayError !== false;
    graph.ignorePlayError = n.ignorePlayError !== false;
    if (!n.highlightColor) n.highlightColor = graph.highlightColor || DEFAULT_HIGHLIGHT_COLOR;
    else graph.highlightColor = normalizeHighlightColor(n.highlightColor);
    n.highlightColor = normalizeHighlightColor(n.highlightColor);
    const loopCount = n.loopCount || 1;
    const stepDelayMs = Math.max(0, Number(n.stepDelayMs) || 0);
    const ignorePlayError = n.ignorePlayError !== false;
    const highlightColor = n.highlightColor;
    const masterId = ensureDefaultDataSource({ forceForRepeat: rst === "DataSource" });
    n.dataSourceId = masterId;
    const dsOpts = processDataSourceOptions(masterId);
    const hasSources = (graph.dataSources || []).length > 0;
    const dsWarn = rst === "DataSource" && !hasSources
      ? `<p class="palette-hint" style="margin:6px 0 0;color:#ea5455">برای تکرار بر اساس منبع، حداقل یک منبع اضافه کنید.</p>`
      : "";

    return `
      <p class="palette-hint" style="margin:0 0 10px;line-height:1.7">
        فرآیند یا <b>یک‌بار</b> اجرا می‌شود، یا به <b>تعداد ثابت</b>، یا به تعداد ردیف‌های
        <b>منبع پیش‌فرض</b>. چند منبع مجاز است؛ یکی باید پیش‌فرض باشد.
      </p>
      <div class="insp-section-title">تنظیمات اجرا</div>
      <div class="insp-field">
        <label>فاصله بین مراحل (ms)</label>
        <input type="number" min="0" step="50" data-k="stepDelayMs" value="${esc(stepDelayMs)}" />
        <p class="palette-hint" style="margin:4px 0 0;line-height:1.6">
          بعد از اتمام هر مرحله، قبل از شروع مرحلهٔ بعدی این مدت صبر می‌شود (نه قبل از اولی).
        </p>
      </div>
      <div class="insp-field">
        <label>رنگ انتخابگر المان</label>
        <div class="insp-color-row">
          <input type="color" data-k="highlightColor" value="${esc(highlightColor)}" />
          <input type="text" data-k="highlightColor" value="${esc(highlightColor)}" maxlength="7" />
        </div>
        <p class="palette-hint" style="margin:4px 0 0;line-height:1.55">
          هنگام اجرا، دور المانی که افزونه تارگت می‌کند با این رنگ بوردر کشیده می‌شود.
        </p>
      </div>
      <div class="insp-field">
        <label class="da-switch">
          <input type="checkbox" data-k="ignorePlayError" ${ignorePlayError ? "checked" : ""}/>
          <span class="da-switch-ui" aria-hidden="true"></span>
          <span class="da-switch-text">چشم‌پوشی از خطای اجرا</span>
        </label>
        <p class="palette-hint" style="margin:6px 0 0;line-height:1.55">
          روشن (پیش‌فرض): اگر مرحله‌ای بدون چشم‌پوشی خطا بخورد، به اندیس بعدی حلقه می‌رود.
          خاموش: کل اجرا متوقف می‌شود.
        </p>
      </div>
      ${dataSourcesPanelHtml()}
      <div class="insp-section-title">تکرار فرآیند</div>
      <div class="insp-field"><label>نوع تکرار</label>
        <select data-k="repeatSourceType">
          <option value="None" ${rst === "None" ? "selected" : ""}>یک‌بار</option>
          <option value="Loops" ${rst === "Loops" ? "selected" : ""}>تعداد ثابت</option>
          <option value="DataSource" ${rst === "DataSource" ? "selected" : ""}>تعداد ردیف منبع پیش‌فرض</option>
        </select>
      </div>
      <div class="insp-field" id="insp-loops">
        <label>تعداد تکرار ثابت</label>
        <input type="number" min="1" data-k="loopCount" value="${esc(loopCount)}" />
      </div>
      <div class="insp-field" id="insp-ds">
        <label>منبع پیش‌فرض</label>
        <select data-k="dataSourceId">${hasSources
          ? dsOpts
          : `<option value="">— ابتدا منبع اضافه کنید —</option>`}</select>
        <p class="palette-hint" style="margin:4px 0 0">وقتی نوع تکرار «منبع پیش‌فرض» باشد این انتخاب الزامی است.</p>
        ${dsWarn}
      </div>
    `;
  }

  /** Repeat settings for start node inside a group (may use page selectors). */
  function groupStartInspectorHtml(n) {
    const rst = n.repeatSourceType || "None";
    n.repeatSourceType = rst;
    n.loopCount = n.loopCount || 1;
    const loopCount = n.loopCount || 1;
    const dsOpts = processDataSourceOptions(n.dataSourceId);
    return `
      <p class="palette-hint" style="margin:0 0 10px;line-height:1.7">
        تکرار این گروه: یک‌بار، تعداد ثابت، المان‌های صفحه، یا ردیف منبع داده.
      </p>
      <div class="insp-section-title">تکرار گروه</div>
      <div class="insp-field"><label>نوع تکرار</label>
        <select data-k="repeatSourceType">
          <option value="None" ${rst === "None" ? "selected" : ""}>یک‌بار</option>
          <option value="Loops" ${rst === "Loops" ? "selected" : ""}>تعداد ثابت</option>
          <option value="Elements" ${rst === "Elements" ? "selected" : ""}>تعداد المان‌های صفحه</option>
          <option value="DataSource" ${rst === "DataSource" ? "selected" : ""}>تعداد ردیف منبع داده</option>
        </select>
      </div>
      <div class="insp-field" id="insp-loops">
        <label>تعداد تکرار ثابت</label>
        <input type="number" min="1" data-k="loopCount" value="${esc(loopCount)}" />
      </div>
      <div class="insp-field" id="insp-ds">
        <label>منبع داده</label>
        <select data-k="dataSourceId"><option value="">— انتخاب منبع —</option>${dsOpts}</select>
      </div>
      <div id="insp-el">
        ${selectorFieldHtml(n, "سلکتور المان‌ها (تکرار گروه)")}
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
      `<div class="insp-status">
        گروه = کانتینر دیاگرام داخل.
        <br/>محتوا: ${stepN} اقدام · ${groupN} گروه · ${condN} شرط
        <br/>خروجی بیرون: شرط(OR) · یک گروه یا اقدام بعدی
        ${toConds.length || toGroup || toStep
          ? `<br/>فعلی: ${toConds.length} شرط${toGroup ? ` + گروه «${esc(toGroup.title)}»` : ""}${toStep ? ` + اقدام «${esc(toStep.title)}»` : ""}`
          : ""}
      </div>` +
      `<p class="palette-hint" style="margin:0 0 10px">
        تکرار و منبع داده روی نود <b>شروع</b> داخل همین گروه تنظیم می‌شود — نه روی خود گروه.
      </p>` +
      `<button type="button" class="btn-flow" id="insp-open-steps" style="width:100%;margin-top:8px">باز کردن طراح داخل گروه</button>`;
  }

  function toggleInspFields(rst) {
    const n = [...selected].map(nodeById)[0];
    const ds = document.getElementById("insp-ds");
    const el = document.getElementById("insp-el");
    const loops = document.getElementById("insp-loops");
    const isProcessStart = n?.kind === "start" && !n.groupNodeId;
    const showDs = rst === "DataSource" && (
      n?.kind === "start" || (n?.kind === "group" && !n.moveLoop)
    );
    if (ds) ds.style.display = showDs || (isProcessStart && rst === "DataSource") ? "" : "none";
    // Process start never uses page-element repeat.
    if (el) el.style.display = (!isProcessStart && rst === "Elements") ? "" : "none";
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

  function graphHasInvalidNodes() {
    return (graph.nodes || []).some((n) => {
      if (n.kind === "group") return false; // groups mirror descendants; leaf check is enough
      return !validateNodeLeaf(n).ok;
    });
  }

  function requestPlay(scope) {
    if (graphHasInvalidNodes()) {
      const msg = "در فرایند المان نامعتبر وجود دارد";
      setStatus(msg, "warn");
      try {
        window.dispatchEvent(new CustomEvent("da-notify", {
          detail: { message: msg, type: "error" }
        }));
      } catch { /* ignore */ }
      return;
    }
    const detail = {
      taskId: Number(taskId),
      groupNodeId: scope?.groupNodeId || null,
      stepNodeId: scope?.stepNodeId || null
    };
    if (typeof window.daRequirePlayer === "function") {
      window.daRequirePlayer({
        reason: "برای اجرای فرآیند، افزونهٔ Player لازم است.",
        pending: { kind: "da-play", detail }
      }).then((ok) => {
        if (!ok) {
          setStatus("افزونهٔ اجرا متصل نیست — راهنمای نصب را ببینید.", "warn");
          return;
        }
        window.dispatchEvent(new CustomEvent("da-play", { detail }));
        setStatus("درخواست اجرا ارسال شد...", "info");
      });
      return;
    }
    if (typeof window.daRequireExtension === "function") {
      window.daRequireExtension({
        role: "player",
        reason: "برای اجرای فرآیند، افزونهٔ Player لازم است.",
        pending: { kind: "da-play", detail }
      }).then((ok) => {
        if (!ok) {
          setStatus("افزونهٔ اجرا متصل نیست — راهنمای نصب را ببینید.", "warn");
          return;
        }
        window.dispatchEvent(new CustomEvent("da-play", { detail }));
        setStatus("درخواست اجرا ارسال شد...", "info");
      });
      return;
    }
    if (!extOkHint()) {
      setStatus("افزونهٔ اجرا متصل نیست — صفحه را در Chrome رفرش کنید یا Player را Reload کنید.", "warn");
      return;
    }
    window.dispatchEvent(new CustomEvent("da-play", { detail }));
    setStatus("درخواست اجرا ارسال شد...", "info");
  }

  function extOkHint() {
    return document.documentElement.dataset.daPlayerExtension === "1"
      || (typeof window.daHasPlayer === "function" && window.daHasPlayer());
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
        setStatus("گروه شاخه ندارد — برای دو مسیر یک شرط بگذارید.", "warn");
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
      setStatus(res.error, "warn");
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
    setStatus(`وصل شد: ${from?.title || fromId} → ${to?.title || toId} (${kindFa})${note}`, "success");
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
      const shape = g.querySelector(":scope > rect, :scope > polygon");
      if (!shape) return;
      const n = nodeById(id);
      if (!n) return;
      applyNodeValidityClass(g, n);
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
    setStatus(linking.retargetEdgeId ? "تغییر مقصد لغو شد." : "اتصال لغو شد.", "info");
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
          setStatus(`اقدام به داخل «${hit.title || "گروه"}» منتقل شد.`, "success");
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
          setStatus(`اقدام به داخل «${hit.title || "گروه"}» منتقل شد.`, "success");
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
        setStatus(`اقدام داخل «${hitGroup.title || "گروه"}» اضافه شد.`, "success");
        return;
      }
      const node = createStepNode({
        groupNodeId: scopeId || null,
        x: p.x,
        y: p.y
      });
      selected = new Set([node.id]);
      render();
      setStatus("اقدام به نمودار اضافه شد.", "success");
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
  document.getElementById("btn-auto-layout")?.addEventListener("click", () => {
    autoLayoutCurrentScope();
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
  /** Desktop collapse prefs — mobile sheet open/close must not overwrite these. */
  let desktopCollapse = { paletteCollapsed: false, inspCollapsed: false };
  let wasMobileEditor = false;

  function readLayoutState() {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (Number.isFinite(o.paletteW)) layoutState.paletteW = clamp(o.paletteW, PANEL_MIN.palette, PANEL_MAX.palette);
      if (Number.isFinite(o.inspW)) layoutState.inspW = clamp(o.inspW, PANEL_MIN.inspector, PANEL_MAX.inspector);
      layoutState.paletteCollapsed = !!o.paletteCollapsed;
      layoutState.inspCollapsed = !!o.inspCollapsed;
      desktopCollapse = {
        paletteCollapsed: layoutState.paletteCollapsed,
        inspCollapsed: layoutState.inspCollapsed
      };
    } catch { /* ignore */ }
  }

  function saveLayoutState() {
    try {
      if (isMobileEditor()) {
        // Persist widths only; keep last known desktop collapse flags.
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({
          paletteW: layoutState.paletteW,
          inspW: layoutState.inspW,
          paletteCollapsed: desktopCollapse.paletteCollapsed,
          inspCollapsed: desktopCollapse.inspCollapsed
        }));
        return;
      }
      desktopCollapse = {
        paletteCollapsed: layoutState.paletteCollapsed,
        inspCollapsed: layoutState.inspCollapsed
      };
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutState));
    } catch { /* ignore */ }
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function isMobileEditor() {
    return window.matchMedia && window.matchMedia("(max-width: 767.98px)").matches;
  }

  function syncMobileScrim() {
    const shell = document.getElementById("flow-app");
    const scrim = document.getElementById("flow-mobile-scrim");
    if (!shell) return;
    const open = isMobileEditor() && (!layoutState.paletteCollapsed || !layoutState.inspCollapsed);
    shell.classList.toggle("mobile-panel-open", open);
    if (scrim) {
      scrim.hidden = !open;
      scrim.setAttribute("aria-hidden", open ? "false" : "true");
    }
  }

  function closeMobilePanels() {
    if (!isMobileEditor()) return;
    let changed = false;
    if (!layoutState.paletteCollapsed) {
      layoutState.paletteCollapsed = true;
      changed = true;
    }
    if (!layoutState.inspCollapsed) {
      layoutState.inspCollapsed = true;
      changed = true;
    }
    if (!changed) return;
    applyLayoutState();
    saveLayoutState();
  }

  function clearMobilePanelStyles() {
    for (const id of ["flow-palette", "flow-inspector"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove("is-sheet-open");
      ["bottom", "transform", "position", "left", "right", "top", "width", "max-height", "z-index", "visibility", "padding", "border", "border-radius", "box-shadow"].forEach((p) => {
        el.style.removeProperty(p);
      });
    }
    document.getElementById("flow-app")?.classList.remove("mobile-panel-open");
    const scrim = document.getElementById("flow-mobile-scrim");
    if (scrim) {
      scrim.hidden = true;
      scrim.setAttribute("aria-hidden", "true");
    }
  }

  function onEditorBreakpointChange() {
    const mobile = isMobileEditor();
    if (mobile === wasMobileEditor) {
      applyLayoutState();
      return;
    }
    if (mobile) {
      desktopCollapse = {
        paletteCollapsed: layoutState.paletteCollapsed,
        inspCollapsed: layoutState.inspCollapsed
      };
      layoutState.paletteCollapsed = true;
      layoutState.inspCollapsed = true;
    } else {
      clearMobilePanelStyles();
      layoutState.paletteCollapsed = desktopCollapse.paletteCollapsed;
      layoutState.inspCollapsed = desktopCollapse.inspCollapsed;
    }
    wasMobileEditor = mobile;
    applyLayoutState();
  }

  function applyLayoutState() {
    if (!flowBody) return;
    flowBody.style.setProperty("--palette-w", `${layoutState.paletteW}px`);
    flowBody.style.setProperty("--insp-w", `${layoutState.inspW}px`);
    flowBody.classList.toggle("palette-collapsed", layoutState.paletteCollapsed);
    flowBody.classList.toggle("insp-collapsed", layoutState.inspCollapsed);
    const palette = document.getElementById("flow-palette");
    const inspector = document.getElementById("flow-inspector");
    const mobile = isMobileEditor();
    if (palette) {
      const open = mobile && !layoutState.paletteCollapsed;
      palette.classList.toggle("is-sheet-open", open);
      if (mobile) palette.style.setProperty("bottom", open ? "0px" : "-100%", "important");
      else {
        palette.classList.remove("is-sheet-open");
        palette.style.removeProperty("bottom");
      }
    }
    if (inspector) {
      const open = mobile && !layoutState.inspCollapsed;
      inspector.classList.toggle("is-sheet-open", open);
      if (mobile) inspector.style.setProperty("bottom", open ? "0px" : "-100%", "important");
      else {
        inspector.classList.remove("is-sheet-open");
        inspector.style.removeProperty("bottom");
      }
    }
    if (!mobile) clearMobilePanelStyles();
    const peekPal = document.getElementById("btn-peek-palette");
    const peekInsp = document.getElementById("btn-peek-inspector");
    if (peekPal) peekPal.hidden = !layoutState.paletteCollapsed;
    if (peekInsp) peekInsp.hidden = !layoutState.inspCollapsed;
    syncPanelChevrons();
    syncMobileScrim();
    // Grow/shrink diagram viewport with panels — keep current zoom.
    if (typeof applyVp === "function" && view === "diagram") {
      requestAnimationFrame(() => applyVp());
    }
  }

  /** Open state: outward chevrons on desktop toggles. Mobile peeks use tool icons (not arrows). */
  function syncPanelChevrons() {
    const CHEV_RIGHT = "M8.5 5.5L15 12l-6.5 6.5";
    const CHEV_LEFT = "M15.5 5.5L9 12l6.5 6.5";
    const ICO_CLOSE = "M6 6l12 12M18 6L6 18";
    const setSvg = (btn, html) => {
      if (!btn) return;
      btn.innerHTML = html;
    };
    const chevronSvg = (d) =>
      `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;

    const mobile = isMobileEditor();
    const tPal = document.getElementById("btn-toggle-palette");
    const tInsp = document.getElementById("btn-toggle-inspector");
    const peekPal = document.getElementById("btn-peek-palette");
    const peekInsp = document.getElementById("btn-peek-inspector");

    if (mobile) {
      setSvg(tPal, `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"><path d="${ICO_CLOSE}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`);
      setSvg(tInsp, `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"><path d="${ICO_CLOSE}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`);
      setSvg(peekPal, `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`);
      setSvg(peekInsp, `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`);
    } else {
      setSvg(tPal, chevronSvg(CHEV_RIGHT));
      setSvg(tInsp, chevronSvg(CHEV_LEFT));
      setSvg(peekPal, chevronSvg(CHEV_LEFT));
      setSvg(peekInsp, chevronSvg(CHEV_RIGHT));
    }

    if (tPal) {
      tPal.title = layoutState.paletteCollapsed ? "نمایش جعبه ابزار" : (mobile ? "بستن جعبه ابزار" : "جمع کردن جعبه ابزار");
      tPal.setAttribute("aria-label", tPal.title);
    }
    if (tInsp) {
      tInsp.title = layoutState.inspCollapsed ? "نمایش ویژگی‌ها" : (mobile ? "بستن ویژگی‌ها" : "جمع کردن ویژگی‌ها");
      tInsp.setAttribute("aria-label", tInsp.title);
    }
  }

  function ensureInspectorExpanded() {
    if (isMobileEditor()) {
      layoutState.paletteCollapsed = true;
      layoutState.inspCollapsed = false;
      applyLayoutState();
      saveLayoutState();
      return;
    }
    if (!layoutState.inspCollapsed) return;
    layoutState.inspCollapsed = false;
    applyLayoutState();
    saveLayoutState();
  }

  function ensurePanelChrome() {
    const palette = document.getElementById("flow-palette");
    const inspector = document.getElementById("flow-inspector") || document.querySelector(".flow-inspector");
    if (inspector && !inspector.id) inspector.id = "flow-inspector";
    const canvas = document.getElementById("canvas-wrap") || document.querySelector(".canvas-wrap");

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
        b.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
        canvas.appendChild(b);
      }
      if (!document.getElementById("btn-peek-inspector")) {
        const b = document.createElement("button");
        b.type = "button";
        b.id = "btn-peek-inspector";
        b.className = "btn-panel-peek peek-insp";
        b.hidden = true;
        b.title = "نمایش ویژگی‌ها";
        b.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
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
    wasMobileEditor = isMobileEditor();
    if (wasMobileEditor) {
      layoutState.paletteCollapsed = true;
      layoutState.inspCollapsed = true;
    } else if (layoutState.paletteCollapsed && layoutState.inspCollapsed) {
      // Recover desktop after prior mobile sessions overwrote prefs.
      layoutState.paletteCollapsed = false;
      layoutState.inspCollapsed = false;
      desktopCollapse = { paletteCollapsed: false, inspCollapsed: false };
      saveLayoutState();
    }
    applyLayoutState();

    const mq = window.matchMedia("(max-width: 767.98px)");
    const onMq = () => onEditorBreakpointChange();
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
    else if (typeof mq.addListener === "function") mq.addListener(onMq);
    window.addEventListener("resize", () => {
      // Fallback for environments where matchMedia change is flaky.
      if (isMobileEditor() !== wasMobileEditor) onEditorBreakpointChange();
    });

    document.getElementById("btn-toggle-palette")?.addEventListener("click", () => {
      if (isMobileEditor()) {
        const opening = layoutState.paletteCollapsed;
        layoutState.paletteCollapsed = !layoutState.paletteCollapsed;
        if (opening) layoutState.inspCollapsed = true;
      } else {
        layoutState.paletteCollapsed = !layoutState.paletteCollapsed;
      }
      applyLayoutState();
      saveLayoutState();
    });
    document.getElementById("btn-toggle-inspector")?.addEventListener("click", () => {
      if (isMobileEditor()) {
        const opening = layoutState.inspCollapsed;
        layoutState.inspCollapsed = !layoutState.inspCollapsed;
        if (opening) layoutState.paletteCollapsed = true;
      } else {
        layoutState.inspCollapsed = !layoutState.inspCollapsed;
      }
      applyLayoutState();
      saveLayoutState();
    });
    document.getElementById("btn-peek-palette")?.addEventListener("click", () => {
      layoutState.paletteCollapsed = false;
      if (isMobileEditor()) layoutState.inspCollapsed = true;
      applyLayoutState();
      saveLayoutState();
    });
    document.getElementById("btn-peek-inspector")?.addEventListener("click", () => {
      layoutState.inspCollapsed = false;
      if (isMobileEditor()) layoutState.paletteCollapsed = true;
      applyLayoutState();
      saveLayoutState();
    });

    document.getElementById("flow-mobile-scrim")?.addEventListener("click", closeMobilePanels);
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
        if (isMobileEditor()) return;
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
  document.addEventListener("da:locale", () => {
    const cul = (window.DaI18n && DaI18n.culture) || document.documentElement.getAttribute("data-culture") || "fa";
    const dir = cul === "en" ? "ltr" : "rtl";
    document.documentElement.setAttribute("lang", cul);
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("data-culture", cul);
    document.documentElement.classList.toggle("flow-ltr", cul === "en");
    document.documentElement.classList.toggle("flow-rtl", cul !== "en");
    try { renderInspector(); } catch { /* ignore */ }
    try { render(); } catch { /* ignore */ }
  });
  load();
})();
