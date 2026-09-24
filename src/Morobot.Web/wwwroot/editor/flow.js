(() => {
  // ---------------------------------------------------------------------------
  // i18n helper — uses DaI18n when available, falls back to key
  // ---------------------------------------------------------------------------
  function t(key, vars) {
    if (window.DaI18n && typeof DaI18n.t === "function") return DaI18n.t(key, vars);
    return key;
  }

  function morobotCssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  function morobotPrimaryColor() {
    return morobotCssVar("--morobot-primary", "#0d9488");
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
  const isLocalMode = false; // server is source of truth for all plans
  /** Keep UUID/string process ids — Number(uuid) becomes NaN and corrupts saves. */
  function stableTaskId(id) {
    if (id == null || id === "") return id;
    const s = String(id).trim();
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : s;
    }
    return s;
  }
  if (taskId) app.dataset.taskId = taskId;
  const currentUserId = String(app?.dataset?.userId || "").trim();
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
    const kind = type === "warning" ? "warn" : type;
    if (kind === "error" || kind === "success" || kind === "warn" || kind === "info") {
      window.daNotify(String(msg), kind);
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
  /** Node currently executing in Player — pulse on diagram when editor is open. */
  let playFocusNodeId = null;
  let playSessionActive = false;
  let playSessionPaused = false;
  const PLAY_PAUSE_ICO = `<svg class="btn-play-ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>`;
  const PLAY_RESUME_ICO = `<svg class="btn-play-ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`;
  /** Stack of parent group ids when drilling into nested group designers. */
  let editStack = [];
  /** Per-scope viewport: "root" | groupId → {x,y,zoom} */
  let scopeViewports = {};
  let dragging = null;
  let panning = null;
  /** Box-select on empty canvas: { x0,y0,x1,y1, additive }. */
  let marquee = null;
  let spacePanHeld = false;
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

  /** Flush current diagram into encrypted localStorage before Player sync. */
  async function flushGraphForPlay() {
    const id = stableTaskId(taskId);
    if (!id || !graph?.nodes?.length) return null;
    const g = structuredClone
      ? structuredClone(graph)
      : JSON.parse(JSON.stringify(graph));
    g.taskId = id;
    const tasks = (readLocalTasks() || []).map((t) => ({ ...t }));
    let hit = tasks.find((t) => String(t.id) === String(id));
    if (!hit) {
      hit = {
        id,
        title: g.title || `#${id}`,
        designOrigin: g.designOrigin || "Manual",
        createdBy: currentUser(),
        ownerUser: currentUser(),
        graph: g
      };
      tasks.push(hit);
    } else {
      hit.graph = g;
      if (g.title) hit.title = g.title;
      hit.stepCount = (g.nodes || []).filter((n) => n.kind === "action" || n.kind === "step").length;
      hit.groupCount = (g.nodes || []).filter((n) => n.kind === "group").length;
    }
    if (window.DaSecureStore && typeof DaSecureStore.writeTasksAsync === "function") {
      await DaSecureStore.writeTasksAsync(tasks);
    } else {
      writeLocalTasks(tasks);
    }
    return hit;
  }

  /** Keep Player cache aligned with the last successful server save (never used to overwrite editor). */
  async function syncLocalCacheAfterSave() {
    if (!/^\d+$/.test(String(taskId))) return;
    try {
      const g = structuredClone ? structuredClone(graph) : JSON.parse(JSON.stringify(graph));
      stripCanvasMeta(g);
      const tasks = readLocalTasks().map((t) => ({ ...t }));
      const id = String(taskId);
      const idx = tasks.findIndex((t) => String(t.id) === id);
      const item = {
        id: stableTaskId(taskId),
        title: graph.title || titleEl?.textContent || "",
        designOrigin: graph.designOrigin || "Manual",
        ownerUser: currentUser(),
        createdBy: currentUser(),
        stepCount: (g.nodes || []).filter((n) => isActionNode(n)).length,
        groupCount: (g.nodes || []).filter((n) => n.kind === "group").length,
        updatedAtUtc: loadedUpdatedAtUtc,
        graph: g
      };
      if (idx >= 0) tasks[idx] = { ...tasks[idx], ...item };
      else tasks.push(item);
      if (window.DaSecureStore && typeof DaSecureStore.writeTasksAsync === "function") {
        await DaSecureStore.writeTasksAsync(tasks);
      } else {
        writeLocalTasks(tasks);
      }
    } catch (e) {
      console.warn("[flow] syncLocalCacheAfterSave", e);
    }
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

  function stripCanvasMeta(g) {
    if (!g || typeof g !== "object") return;
    delete g.updatedAtUtc;
    delete g.baseUpdatedAtUtc;
    delete g.editorSessionId;
  }

  function applyLocalGraph(local) {
    graph = structuredClone ? structuredClone(local.graph) : JSON.parse(JSON.stringify(local.graph));
    stripCanvasMeta(graph);
    graph.taskId = stableTaskId(taskId);
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
    // Never use graph.updatedAtUtc — embedded stamp is stale and causes false save conflicts.
    const stamp = local.updatedAtUtc || local.UpdatedAtUtc || null;
    if (stamp) loadedUpdatedAtUtc = stamp;
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
      taskId: stableTaskId(taskId),
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
    if (!isLocalMode && /^\d+$/.test(String(taskId))) {
      serverCanvasLoadPending = true;
      try {
        const res = await fetch(`/api/tasks/${taskId}/canvas`, { credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          if (data && (data.nodes || data.Nodes)) {
            const serverItem = {
              id: taskId,
              title: data.title || data.Title || t("editor.ribbon.workflow"),
              designOrigin: data.designOrigin || data.DesignOrigin || "Manual",
              updatedAtUtc: data.updatedAtUtc || data.UpdatedAtUtc || null,
              graph: {
                taskId: Number(taskId),
                title: data.title || data.Title,
                nodes: data.nodes || data.Nodes || [],
                edges: data.edges || data.Edges || [],
                viewport: data.viewport || data.Viewport,
                dataSources: data.dataSources || data.DataSources || [],
                designOrigin: data.designOrigin || data.DesignOrigin,
                stepDelayMs: data.stepDelayMs,
                highlightColor: data.highlightColor,
                ignorePlayError: data.ignorePlayError,
                repeatSourceType: data.repeatSourceType
              }
            };
            applyLocalGraph(serverItem);
            loadedUpdatedAtUtc = serverItem.updatedAtUtc
              || data.updatedAtUtc
              || data.UpdatedAtUtc
              || null;
            serverCanvasLoaded = true;
            await syncLocalCacheAfterSave();
            ensureCanvasHub();
            return;
          }
        }
      } catch (e) {
        console.warn("server canvas load failed", e);
      } finally {
        serverCanvasLoadPending = false;
      }
      emptyShell();
      ensureCanvasHub();
      return;
    }
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

  // Portal-bridge may write chrome.storage → localStorage after first paint.
  // Server-mode editor must NOT re-apply that cache over the live canvas (causes false conflicts + stale refresh).
  window.addEventListener("da-local-tasks", (ev) => {
    if (serverCanvasLoaded || serverCanvasLoadPending) return;
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
  /** Server canvas timestamp from last successful load/save (optimistic concurrency). */
  let loadedUpdatedAtUtc = null;
  /** True after GET /canvas — localStorage cache is for Player only, not editor source of truth. */
  let serverCanvasLoaded = false;
  /** Block local cache from overwriting canvas while the server load is in flight. */
  let serverCanvasLoadPending = /^\d+$/.test(String(taskId));
  /** Group id under drag that would become parent on drop. */
  let nestHoverGroupId = null;
  /** Distinguishes this editor tab so SignalR ignores our own saves. */
  const editorSessionId = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `ed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let canvasHubConn = null;
  let canvasConflictPromptOpen = false;

  async function ensureCanvasHub() {
    if (isLocalMode || !/^\d+$/.test(String(taskId))) return;
    if (typeof signalR === "undefined") return;
    const joinId = String(taskId).trim();
    try {
      if (canvasHubConn) {
        await canvasHubConn.invoke("JoinTask", joinId).catch(() => {});
        return;
      }
      const conn = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/canvas")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();

      conn.on("canvasChanged", async (payload) => {
        if (!payload) return;
        // Same editor tab: ignore echo (source upload / canvas save from this session).
        const remoteSid = payload.editorSessionId || payload.EditorSessionId || "";
        if (remoteSid && remoteSid === editorSessionId) {
          const ownAt = payload.updatedAtUtc || payload.UpdatedAtUtc;
          if (ownAt) loadedUpdatedAtUtc = ownAt;
          const ownTitle = payload.title || payload.Title;
          if (ownTitle) {
            graph.title = ownTitle;
            if (titleEl) titleEl.textContent = ownTitle;
          }
          return;
        }
        // Soft-apply data-source rename from library without full conflict dialog.
        const reason = String(payload.reason || payload.Reason || "");
        if (reason === "datasource_renamed") {
          const dsId = payload.dataSourceId ?? payload.DataSourceId;
          const newTitle = payload.title || payload.Title;
          const ds = findDataSourceById(dsId);
          if (ds && newTitle) {
            ds.title = newTitle;
            renderDataSources();
          }
          // Server bumped Process.UpdatedAtUtc — refresh stamp without reloading diagram.
          if (/^\d+$/.test(String(taskId))) {
            fetch(`/api/tasks/${taskId}/canvas`, { credentials: "same-origin" })
              .then((r) => (r.ok ? r.json() : null))
              .then((c) => {
                const remoteAt = c?.updatedAtUtc || c?.UpdatedAtUtc;
                if (remoteAt) loadedUpdatedAtUtc = remoteAt;
              })
              .catch(() => {});
          }
          return;
        }
        // Extension / recorder PUT canvas (no editorSessionId) — server is authoritative.
        if (!remoteSid && /^\d+$/.test(String(taskId))) {
          loadedUpdatedAtUtc = payload.updatedAtUtc || payload.UpdatedAtUtc || loadedUpdatedAtUtc;
          await load();
          setStatus(t("editor.status.conflictReloaded") || "فرآیند از سرور به‌روز شد.", "success");
          try {
            window.dispatchEvent(new CustomEvent("da-task-list-sync"));
          } catch { /* ignore */ }
          return;
        }
        const remoteAt = payload.updatedAtUtc || payload.UpdatedAtUtc || null;
        if (remoteAt && loadedUpdatedAtUtc && String(remoteAt) === String(loadedUpdatedAtUtc)) return;
        if (canvasConflictPromptOpen) return;
        canvasConflictPromptOpen = true;
        try {
          // Prompt only for another user, or the same user in another browser/tab.
          const remoteUid = String(payload.userId ?? payload.UserId ?? "").trim();
          const whoName = String(payload.userName || payload.UserName || "").trim();
          const isSelfOtherBrowser = !!(currentUserId && remoteUid && remoteUid === currentUserId);
          let msg;
          if (isSelfOtherBrowser) {
            msg = t("editor.status.conflictLiveOtherBrowser");
          } else if (whoName) {
            msg = t("editor.status.conflictLiveOtherUser", { who: whoName });
          } else {
            const who = whoName ? ` (${whoName})` : "";
            msg = t("editor.status.conflictLive", { who });
          }
          const refresh = await (window.DaNotify
            ? DaNotify.confirm(msg, {
                title: t("editor.status.conflictTitle"),
                okText: t("editor.status.conflictReloadBtn"),
                cancelText: t("editor.status.conflictKeepBtn")
              })
            : Promise.resolve(false));
          if (refresh) {
            loadedUpdatedAtUtc = remoteAt || loadedUpdatedAtUtc;
            await load();
            setStatus(t("editor.status.conflictReloaded"), "warn");
          } else {
            setStatus(t("editor.status.conflictKept"), "warn");
          }
        } finally {
          canvasConflictPromptOpen = false;
        }
      });

      conn.on("playStopDueToChange", async (payload) => {
        const who = payload?.actorUserName ? ` (${payload.actorUserName})` : "";
        const msg = (t("editor.status.playStoppedByEdit") || "اجرا به‌خاطر تغییر فرآیند متوقف شد") + who;
        setStatus(msg, "warn");
        if (window.DaNotify) DaNotify.warn(msg);
        window.dispatchEvent(new CustomEvent("da-stop-play", { detail: { reason: "canvas_changed", ...payload } }));
        if (window.DaTelemetry) DaTelemetry.audit("PlayStoppedByEdit", msg);
      });

      conn.onreconnected(async () => {
        await conn.invoke("JoinTask", joinId).catch(() => {});
      });

      await conn.start();
      await conn.invoke("JoinTask", joinId);
      canvasHubConn = conn;
    } catch (e) {
      console.warn("canvas hub failed", e);
    }
  }

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
      void orphan;

      graph.taskId = stableTaskId(taskId);

      if (!isLocalMode && /^\d+$/.test(String(taskId))) {
        // Do not persist session/concurrency meta into canvas JSON.
        const { baseUpdatedAtUtc: _b, editorSessionId: _e, updatedAtUtc: _u, ...canvasBody } = graph;
        const payload = {
          ...canvasBody,
          baseUpdatedAtUtc: loadedUpdatedAtUtc,
          editorSessionId
        };
        const res = await fetch(`/api/tasks/${taskId}/canvas`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.status === 409) {
          const errBody = await res.json().catch(() => ({}));
          if (errBody.code === "playing") {
            const who = errBody.playerUserName ? ` (${errBody.playerUserName})` : "";
            const force = await (window.DaNotify
              ? DaNotify.confirm(
                  (t("editor.status.playingWarn") || "این فرآیند در حال اجراست{who}. با تأیید، اجرا متوقف و تغییرات ذخیره می‌شود.").replace("{who}", who),
                  {
                    title: t("editor.status.playingTitle") || "اجرا در جریان",
                    okText: t("editor.status.playingForce") || "توقف اجرا و ذخیره",
                    cancelText: t("common.cancel") || "انصراف",
                    danger: true
                  }
                )
              : Promise.resolve(false));
            if (!force) {
              setStatus(t("editor.status.playingKept") || "ذخیره لغو شد — اجرا ادامه دارد.", "warn");
              return { ok: false, error: "playing" };
            }
            const retry = await fetch(`/api/tasks/${taskId}/canvas`, {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, forceSave: true })
            });
            if (!retry.ok) {
              const rb = await retry.json().catch(() => ({}));
              throw new Error(rb.message || t("editor.status.saveError"));
            }
            const okBody = await retry.json().catch(() => ({}));
            if (okBody.updatedAtUtc) loadedUpdatedAtUtc = okBody.updatedAtUtc;
            await syncLocalCacheAfterSave();
            window.dispatchEvent(new CustomEvent("da-stop-play", { detail: { reason: "canvas_changed" } }));
            setStatus(t("editor.status.playingForced") || "اجرا متوقف و ذخیره شد.", "warn");
            render();
            return { ok: true, forced: true };
          }
          const refresh = await (window.DaNotify
            ? DaNotify.confirm(t("editor.status.conflictRefresh"), {
                title: t("editor.status.conflictTitle"),
                okText: t("editor.status.conflictReloadBtn"),
                cancelText: t("editor.status.conflictKeepBtn")
              })
            : Promise.resolve(false));
          if (refresh) {
            loadedUpdatedAtUtc = errBody.updatedAtUtc || loadedUpdatedAtUtc;
            await load();
            setStatus(t("editor.status.conflictReloaded"), "warn");
            return { ok: false, error: "conflict", reloaded: true };
          }
          setStatus(t("editor.status.conflictKept"), "warn");
          return { ok: false, error: "conflict" };
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.message || t("editor.status.saveError"));
        }
        const okBody = await res.json().catch(() => ({}));
        if (okBody.updatedAtUtc) loadedUpdatedAtUtc = okBody.updatedAtUtc;
        await syncLocalCacheAfterSave();
        await new Promise((r) => setTimeout(r, 200));
        render();
        setStatus(t("editor.status.saved"), "success");
        return { ok: true };
      }

      const tasks = readLocalTasks();
      const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
      const stepCount = graph.nodes.filter((n) => isActionNode(n)).length;
      const groupCount = graph.nodes.filter((n) => n.kind === "group").length;
      const item = {
        id: stableTaskId(taskId),
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
      const isMaster = Number(d.id) === Number(masterId);
      const label = d.title || dataSourceFileTitle(d.fileName) || t("editor.ds.removed");
      const sid = Number(d.id);
      const onServer = !isLocalMode && Number.isFinite(sid) && sid > 0;
      const masterBtn = isMaster
        ? dsIconBtn("is-master", t("editor.ds.masterBadge"), DS_ICO_STAR, "disabled")
        : (canModify
          ? dsIconBtn("js-ds-master", t("editor.ds.setMaster"), DS_ICO_STAR_OUT, `data-id="${sid}"`)
          : "");
      const cloudTitle = onServer ? t("editor.ds.onServer") : t("editor.ds.onLocal");
      const cloudIco = onServer ? DS_ICO_CLOUD : DS_ICO_LOCAL;
      const cloudCls = onServer ? "js-ds-cloud is-server" : "js-ds-cloud is-local";
      const actions = `
        ${dsIconBtn("js-ds-view", t("editor.ds.viewTable"), DS_ICO_VIEW, `data-id="${sid}"`)}
        ${dsIconBtn("js-ds-dl", t("editor.ds.downloadExcel"), DS_ICO_DL, `data-id="${sid}"`)}
        ${dsIconBtn(cloudCls, cloudTitle, cloudIco, `data-id="${sid}" data-on-server="${onServer ? "1" : "0"}" disabled`)}
        ${masterBtn}
        ${canModify ? dsIconBtn("js-ds-del is-danger", t("editor.ds.detach"), DS_ICO_DEL, `data-id="${sid}"`) : ""}
      `;
      return `<li data-id="${d.id}" class="${isMaster ? "ds-is-master" : ""}">
        <div class="ds-row-top">
          <div class="ds-title-row">
            <span class="ds-title">${esc(label)}</span>
            ${canModify ? dsIconBtn("js-ds-rename", t("editor.ds.rename"), DS_ICO_RENAME, `data-id="${sid}"`) : ""}
          </div>
          <div class="ds-actions">${actions}</div>
        </div>
        <div class="ds-meta">${d.columnCount || 0} ${t("editor.ds.columns")} · ${d.rowCount || 0} ${t("editor.ds.rows")}${d.fileName ? ` · ${esc(d.fileName)}` : ""}</div>
      </li>`;
    }).join("");

    listEl.querySelectorAll(".js-ds-view").forEach((btn) => {
      btn.addEventListener("click", () => openDsViewer(Number(btn.dataset.id)));
    });
    listEl.querySelectorAll(".js-ds-dl").forEach((btn) => {
      btn.addEventListener("click", () => downloadDataSource(Number(btn.dataset.id), btn));
    });
    listEl.querySelectorAll(".js-ds-cloud").forEach((btn) => {
      btn.addEventListener("click", () => {
        const onServer = btn.dataset.onServer === "1";
        setStatus(onServer ? t("editor.ds.onServerHint") : t("editor.ds.onLocalHint"), "info");
      });
    });
    listEl.querySelectorAll(".js-ds-rename").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        renameDataSource(Number(btn.dataset.id));
      });
    });
    listEl.querySelectorAll(".js-ds-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteDataSource(Number(btn.dataset.id));
      });
    });
    listEl.querySelectorAll(".js-ds-master").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const newId = Number(btn.dataset.id);
        const prevId = masterDataSourceId();
        setMasterDataSource(newId);
        const start = processStart();
        if (start && (start.repeatSourceType || graph.repeatSourceType) !== "DataSource") {
          start.repeatSourceType = "DataSource";
          graph.repeatSourceType = "DataSource";
        }
        if (prevId != null && Number(prevId) !== Number(newId)) {
          const ask = window.DaNotify?.confirm
            ? await DaNotify.confirm(t("editor.ds.remapSelectorsConfirm"), {
                title: t("editor.ds.setMaster"),
                okText: t("common.yes"),
                cancelText: t("common.no")
              })
            : window.confirm(t("editor.ds.remapSelectorsConfirm"));
          if (ask) remapSelectorsToSource(newId);
        }
        await save();
        renderInspector();
        render();
      });
    });
  }

  const DS_ICO_VIEW = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c5.2 0 9.3 3.4 10.7 7-1.4 3.6-5.5 7-10.7 7S2.7 15.6 1.3 12C2.7 8.4 6.8 5 12 5zm0 2.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm0 2A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5z"/></svg>`;
  const DS_ICO_DL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3v10.2l3.4-3.4 1.4 1.4L12 17l-4.8-5.8 1.4-1.4L11 13.2V3h1zM5 19h14v2H5v-2z"/></svg>`;
  const DS_ICO_CLOUD = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.5 19H8a5 5 0 0 1-.7-9.95A6.5 6.5 0 0 1 20 12.5a3.5 3.5 0 0 1-2.5 6.5z"/></svg>`;
  const DS_ICO_LOCAL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 6h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-5v2h2v2H7v-2h2v-2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v5h16V8H4z"/></svg>`;
  const DS_ICO_STAR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const DS_ICO_STAR_OUT = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.1 7.2 18.5l.9-5.4L4.2 9.3l5.4-.8L12 3.6z"/></svg>`;
  const DS_ICO_DEL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`;
  const DS_ICO_RENAME = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5zm16.7-11.2a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5 1.6-1.6z"/></svg>`;

  function dsIconBtn(cls, title, iconHtml, extra = "") {
    return `<button type="button" class="ds-icon-btn ${cls}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${iconHtml}</button>`;
  }

  async function promptRename(current, titleKey, msgKey) {
    if (window.DaNotify?.prompt) {
      return DaNotify.prompt(t(msgKey), {
        title: t(titleKey),
        value: current || "",
        okText: t("common.save"),
        cancelText: t("common.cancel"),
        maxLength: 200
      });
    }
    const next = window.prompt(t(msgKey), current || "");
    return next == null ? null : String(next).trim() || null;
  }

  async function renameDataSource(sourceId) {
    if (!canModify) return;
    const ds = findDataSourceById(sourceId);
    if (!ds) {
      setStatus(t("editor.ds.notFound"), "error");
      return;
    }
    const current = ds.title || dataSourceFileTitle(ds.fileName) || "";
    const next = await promptRename(current, "editor.ds.rename", "editor.ds.renamePrompt");
    if (next == null || next === current) return;
    ds.title = next;
    renderDataSources();
    try {
      if (!isLocalMode && Number(sourceId) > 0) {
        const res = await fetch(`/api/datasources/${sourceId}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || t("editor.ds.renameFail"));
        }
        // Server already patched GraphJson + bumped UpdatedAt — refresh stamp only.
        if (/^\d+$/.test(String(taskId))) {
          const canvasRes = await fetch(`/api/tasks/${taskId}/canvas`, { credentials: "same-origin" });
          if (canvasRes.ok) {
            const c = await canvasRes.json();
            if (c.updatedAtUtc) loadedUpdatedAtUtc = c.updatedAtUtc;
          }
        }
      } else {
        await save();
      }
      setStatus(t("editor.ds.renamed"), "success");
    } catch (e) {
      ds.title = current;
      renderDataSources();
      setStatus(e.message || t("editor.ds.renameFail"), "error");
    }
  }

  async function renameProcessTitle() {
    if (!canModify) return;
    const current = graph.title || titleEl?.textContent || "";
    const next = await promptRename(current, "editor.ribbon.rename", "editor.ribbon.renamePrompt");
    if (next == null || next === current) return;
    graph.title = next;
    if (titleEl) titleEl.textContent = next;
    try {
      if (!isLocalMode && /^\d+$/.test(String(taskId))) {
        const res = await fetch(`/api/tasks/${taskId}/title`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next, editorSessionId })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || t("editor.ribbon.renameFail"));
        if (body.updatedAtUtc) loadedUpdatedAtUtc = body.updatedAtUtc;
        // Mirror into local cache if present
        try {
          if (window.DaSecureStore) {
            const tasks = DaSecureStore.readTasks() || [];
            const hit = tasks.find((x) => String(x.id) === String(taskId));
            if (hit) {
              hit.title = next;
              if (hit.graph) hit.graph.title = next;
              DaSecureStore.writeTasks(tasks);
            }
          }
        } catch { /* cache optional */ }
      } else {
        await save();
      }
      setStatus(t("editor.ribbon.renamed"), "success");
    } catch (e) {
      graph.title = current;
      if (titleEl) titleEl.textContent = current;
      setStatus(e.message || t("editor.ribbon.renameFail"), "error");
    }
  }

  async function renameDiagramNode(n) {
    if (!canModify || !n || n.kind === "start") return;
    const current = n.title || "";
    const next = await promptRename(current, "editor.insp.title", "editor.ribbon.renamePrompt");
    if (next == null || next === current) return;
    n.title = next;
    render();
    renderInspector();
    await save();
  }

  function findDataSourceById(sourceId) {
    return (graph.dataSources || []).find((d) => Number(d.id) === Number(sourceId)) || null;
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
    return { headers, colKeys, columns: cols, rows };
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

  function dataSourceSafeFileName(ds) {
    const raw = (ds?.fileName && String(ds.fileName).replace(/\.(xlsx|xlsm|csv)$/i, ""))
      || ds?.title
      || "data-source";
    return String(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "data-source";
  }

  function downloadAsCsv(ds) {
    const { headers, rows } = dataSourceTableRows(ds);
    const escCsv = (v) => {
      const s = String(v ?? "");
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.map(escCsv).join(",")].concat(rows.map((r) => r.map(escCsv).join(",")));
    downloadBlobFile(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${dataSourceSafeFileName(ds)}.csv`);
  }

  async function downloadDataSource(sourceId, btn) {
    const ds = findDataSourceById(sourceId);
    if (!ds) {
      setStatus(t("editor.ds.notFound"), "error");
      return;
    }
    const table = dataSourceTableRows(ds);
    if (!table.colKeys.length) {
      setStatus(t("editor.ds.noColumns"), "error");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-busy");
    }
    try {
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
      setStatus(t("editor.ds.downloadDone", { name: dataSourceSafeFileName(ds) }), "success");
    } catch (e) {
      try {
        downloadAsCsv(ds);
        setStatus(t("editor.ds.downloadCsvFallback", { err: e.message || "" }), "info");
      } catch (e2) {
        setStatus(e.message || e2.message || t("editor.ds.downloadFail"), "error");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-busy");
      }
    }
  }

  const dsViewerState = { sourceId: null, connection: null, blinkTimers: new Map() };

  function setDsViewerLive(on, text) {
    const el = document.getElementById("ds-viewer-live");
    if (!el) return;
    el.classList.toggle("is-on", !!on);
    el.textContent = text || (on ? t("editor.ds.live") : t("editor.ds.offline"));
  }

  function flashDsCell(td, op) {
    if (!td) return;
    const cls = op === "write" ? "ds-flash-write" : "ds-flash-read";
    td.classList.remove("ds-flash-read", "ds-flash-write");
    void td.offsetWidth;
    td.classList.add(cls);
    const key = `${td.dataset.row}:${td.dataset.col}`;
    const prev = dsViewerState.blinkTimers.get(key);
    if (prev) clearTimeout(prev);
    dsViewerState.blinkTimers.set(key, setTimeout(() => {
      td.classList.remove(cls);
      dsViewerState.blinkTimers.delete(key);
    }, 2800));
  }

  function applyDsCellEventToGraph(ev) {
    if (!ev) return null;
    const sourceId = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    if (!Number.isFinite(sourceId)) return null;
    const ds = findDataSourceById(sourceId);
    if (!ds) return null;
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "").trim();
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    if (!col) return ds;
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    if (op.includes("write")) {
      ds.cells = Array.isArray(ds.cells) ? ds.cells : [];
      const hit = ds.cells.find((c) =>
        (c.key === col || c.Key === col)
        && Number(c.index ?? c.Index ?? c.rowIndex) === idx
      );
      const val = ev.cellValue == null && ev.CellValue == null ? "" : String(ev.cellValue ?? ev.CellValue ?? "");
      if (hit) {
        if (hit.cellValue !== undefined) hit.cellValue = val;
        else if (hit.CellValue !== undefined) hit.CellValue = val;
        else hit.value = val;
      } else {
        ds.cells.push({ key: col, index: idx, cellValue: val });
      }
      const rc = Number(ds.rowCount) || 0;
      if (idx + 1 > rc) ds.rowCount = idx + 1;
    }
    return ds;
  }

  function handleDsCellEvent(ev) {
    if (!ev) return;
    const sid = Number(ev.dataSourceId ?? ev.DataSourceId ?? ev.sourceId ?? ev.SourceId);
    const modal = document.getElementById("ds-viewer");
    const viewing = modal && !modal.hidden && Number(dsViewerState.sourceId) === sid;
    const ds = applyDsCellEventToGraph(ev);
    if (!viewing) return;
    const op = String(ev.op || ev.Op || "read").toLowerCase();
    const col = String(ev.columnKey ?? ev.ColumnKey ?? "");
    const idx = Number(ev.rowIndex ?? ev.RowIndex ?? 0) || 0;
    const table = document.getElementById("ds-viewer-table");
    if (op.includes("write") && ds) {
      let td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      if (!td) {
        renderDsViewerTable(ds);
        td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      } else if (ev.cellValue != null || ev.CellValue != null) {
        td.textContent = String(ev.cellValue ?? ev.CellValue ?? "");
      }
      flashDsCell(td, "write");
    } else {
      const td = table?.querySelector(`td[data-row="${idx}"][data-col="${CSS.escape(col)}"]`);
      flashDsCell(td, "read");
    }
  }

  async function ensureDsViewerHub() {
    if (typeof signalR === "undefined") {
      setDsViewerLive(false, t("editor.ds.noSignalR"));
      return;
    }
    const joinId = String(taskId || graph.taskId || "").trim();
    if (!joinId) {
      setDsViewerLive(false, t("editor.ds.offline"));
      return;
    }
    try {
      if (dsViewerState.connection) {
        await dsViewerState.connection.stop().catch(() => {});
        dsViewerState.connection = null;
      }
      const conn = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/play-data")
        .withAutomaticReconnect([0, 1000, 3000, 8000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      conn.on("cellEvent", handleDsCellEvent);
      conn.onreconnecting(() => setDsViewerLive(false, t("editor.ds.reconnecting")));
      conn.onreconnected(async () => {
        await conn.invoke("JoinTask", joinId).catch(() => {});
        setDsViewerLive(true, t("editor.ds.live"));
      });
      conn.onclose(() => setDsViewerLive(false));
      await conn.start();
      await conn.invoke("JoinTask", joinId);
      dsViewerState.connection = conn;
      setDsViewerLive(true, t("editor.ds.live"));
    } catch {
      setDsViewerLive(false, t("editor.ds.disconnected"));
    }
  }

  function renderDsViewerTable(ds) {
    const table = document.getElementById("ds-viewer-table");
    const titleEl = document.getElementById("ds-viewer-title");
    const subEl = document.getElementById("ds-viewer-sub");
    if (!table || !ds) return;
    const { headers, colKeys, rows } = dataSourceTableRows(ds);
    if (titleEl) titleEl.textContent = ds.title || dataSourceSafeFileName(ds);
    if (subEl) {
      subEl.textContent = `${colKeys.length} ${t("editor.ds.columns")} · ${rows.length} ${t("editor.ds.rows")}`
        + (ds.fileName ? ` · ${ds.fileName}` : "")
        + " — " + t("editor.ds.liveHint");
    }
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    thead.innerHTML = `<tr><th class="ds-row-idx">#</th>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length + 1}" class="ds-viewer-empty">${t("editor.ds.noRows")}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) =>
      `<tr><th class="ds-row-idx">${i + 1}</th>${r.map((v, ci) =>
        `<td data-row="${i}" data-col="${esc(colKeys[ci])}">${esc(v)}</td>`
      ).join("")}</tr>`
    ).join("");
  }

  async function loadDataSourceForViewer(sourceId) {
    const ds = findDataSourceById(sourceId);
    if (!ds) return null;
    if (isLocalMode || !(Number(sourceId) > 0)) return ds;
    try {
      const metaRes = await fetch(`/api/datasources/${sourceId}/meta`, { credentials: "same-origin" });
      if (!metaRes.ok) return ds;
      const meta = await metaRes.json();
      ds.title = meta.title ?? ds.title;
      ds.rowCount = meta.rowCount ?? ds.rowCount;
      ds.columnCount = meta.columnCount ?? ds.columnCount;
      ds.dataRevision = meta.dataRevision;
      if (Array.isArray(meta.columns)) ds.columns = meta.columns;
      ds.cells = [];
      // One bulk page request instead of one request per row (was N+1 round trips).
      const total = Math.min(Number(meta.rowCount) || 0, 5000);
      const PAGE = 1000;
      for (let from = 0; from < total; from += PAGE) {
        const pageRes = await fetch(
          `/api/datasources/${sourceId}/rows?from=${from}&count=${Math.min(PAGE, total - from)}`,
          { credentials: "same-origin" }
        );
        if (!pageRes.ok) continue;
        const page = await pageRes.json();
        const rows = page.rows || page.Rows || [];
        for (const row of rows) {
          const idx = Number(row.rowIndex ?? row.RowIndex ?? 0);
          const values = row.values || row.Values || {};
          for (const [key, val] of Object.entries(values)) {
            ds.cells.push({ key, index: idx, cellValue: val ?? "" });
          }
        }
        if (page.dataRevision != null) ds.dataRevision = page.dataRevision;
      }
    } catch { /* use in-graph fallback */ }
    return ds;
  }

  async function openDsViewer(sourceId) {
    const ds = await loadDataSourceForViewer(sourceId);
    if (!ds) {
      setStatus(t("editor.ds.notFound"), "error");
      return;
    }
    dsViewerState.sourceId = Number(sourceId);
    renderDsViewerTable(ds);
    const modal = document.getElementById("ds-viewer");
    if (modal) modal.hidden = false;
    setDsViewerLive(false, t("editor.ds.connecting"));
    await ensureDsViewerHub();
  }

  async function closeDsViewer() {
    const modal = document.getElementById("ds-viewer");
    if (modal) modal.hidden = true;
    dsViewerState.sourceId = null;
    setDsViewerLive(false);
    if (dsViewerState.connection) {
      try { await dsViewerState.connection.stop(); } catch { /* ignore */ }
      dsViewerState.connection = null;
    }
  }

  function bindDsViewerChrome() {
    document.querySelectorAll("[data-ds-viewer-close]").forEach((el) => {
      el.addEventListener("click", () => closeDsViewer());
    });
    document.getElementById("ds-viewer-refresh")?.addEventListener("click", () => {
      const ds = findDataSourceById(dsViewerState.sourceId);
      if (ds) renderDsViewerTable(ds);
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        const modal = document.getElementById("ds-viewer");
        if (modal && !modal.hidden) closeDsViewer();
      }
    });
  }
  bindDsViewerChrome();

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

  let dsIngestLock = false;

  /** Single gate before Excel upload — uses library count from server (not graph.dataSources.length). */
  async function ensureCanAddDataSource() {
    const entitlements = window.DaEntitlements ? DaEntitlements.get() : null;
    if (!entitlements || entitlements.maxDataSources == null) return true;
    let count = null;
    try {
      const res = await fetch("/api/datasources/count", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.count === "number") count = data.count;
      }
    } catch { /* ignore */ }
    if (count == null) {
      notifyDsError(t("editor.ds.limitCheckFailed") || "بررسی سقف منبع ممکن نشد — دوباره تلاش کنید.");
      return false;
    }
    if (!DaEntitlements.canCreateSource(count)) {
      notifyDsError(t("plan.limitSources", { max: entitlements.maxDataSources }));
      return false;
    }
    return true;
  }

  function mapSourceLimitMessage(errBody, entitlements) {
    if (errBody?.code === "limit" || /limit reached/i.test(String(errBody?.message || ""))) {
      const max = entitlements?.maxDataSources ?? errBody?.max ?? "?";
      return t("plan.limitSources", { max });
    }
    return errBody?.message || null;
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
        const detail = (data?.code === "limit" && window.DaEntitlements)
          ? t("plan.limitSources", { max: DaEntitlements.get()?.maxDataSources ?? "?" })
          : serverMsg
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
    if (!canModify || !file || dsIngestLock) return;
    if (!(await ensureCanAddDataSource())) return;

    dsIngestLock = true;
    const entitlements = window.DaEntitlements ? DaEntitlements.get() : null;
    const statusEl = document.getElementById("ds-status");
    const name = file.name || "";
    if (!/\.(xlsx|xlsm)$/i.test(name)) {
      const msg = t("editor.ds.onlyXlsx");
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.classList.add("is-error");
      }
      notifyDsError(msg);
      dsIngestLock = false;
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
      let entry = {
        id: nextDataSourceId(),
        title,
        fileName: name,
        columnCount: data.columnCount || keys.length,
        rowCount: data.rowCount || 0,
        columnKeys: keys,
        columns: cols,
        cells: data.cells || []
      };

      // Persist into user library first (independent entity). Do NOT attach here —
      // Attach used to bump Process.UpdatedAtUtc and caused a false concurrency conflict
      // on the subsequent canvas save. SyncFromCanvas on save creates the process link.
      try {
        const createRes = await fetch("/api/datasources", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: entry.title,
            fileName: entry.fileName,
            columns: entry.columns,
            cells: entry.cells,
            columnKeys: entry.columnKeys,
            columnCount: entry.columnCount,
            rowCount: entry.rowCount
          })
        });
        if (createRes.ok) {
          const created = await createRes.json();
          entry = {
            ...entry,
            id: created.id,
            title: created.title || entry.title,
            fileName: created.fileName || entry.fileName,
            columnCount: created.columnCount ?? entry.columnCount,
            rowCount: created.rowCount ?? entry.rowCount,
            columns: created.columns || entry.columns,
            columnKeys: created.columnKeys || entry.columnKeys,
            cells: created.cells || entry.cells
          };
        } else if (createRes.status === 400) {
          const err = await createRes.json().catch(() => ({}));
          throw new Error(mapSourceLimitMessage(err, entitlements) || err.message || t("editor.ds.uploadSaveError"));
        }
      } catch (apiErr) {
        if (apiErr?.message) throw apiErr;
        // Fall through: SyncFromCanvas on save still materializes the library row.
      }

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
      dsIngestLock = false;
      setDsDropzoneBusy(false);
      setTimeout(hideDsProgress, rolledBack ? 200 : 500);
      const fileInp = document.getElementById("ds-file");
      if (fileInp) fileInp.value = "";
    }
  }

  function notifyDsError(message) {
    const msg = String(message || t("editor.status.dsLoadError"));
    // One user-facing alert — avoid toast + duplicate toast from setStatus/da-notify both firing.
    if (typeof window.daNotify === "function") {
      window.daNotify(msg, "error");
    } else if (window.DaNotify && typeof DaNotify.toast === "function") {
      DaNotify.toast(msg, "error");
    } else {
      try { setStatus(msg, "error"); } catch { /* ignore */ }
    }
    const statusEl = document.getElementById("ds-status");
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.classList.add("is-error");
    }
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
    // Detach from this process only — library row stays. Keep selector column names.
    const prevMaster = masterDataSourceId();
    graph.dataSources = (graph.dataSources || []).filter((d) => Number(d.id) !== Number(sourceId));
    if (Number(masterDataSourceId()) === Number(sourceId)) setMasterDataSource(null);
    const newMaster = ensureDefaultDataSource({ forceForRepeat: true });
    graph.nodes.forEach((n) => {
      // Clear DS id refs only — column name fields (selectorDynamicColumn, etc.) stay.
      if (n.kind !== "start" && Number(n.dataSourceId) === Number(sourceId)) n.dataSourceId = null;
      if (Number(n.sourceId) === Number(sourceId)) n.sourceId = null;
      if (Number(n.selectorDataSourceId) === Number(sourceId)) n.selectorDataSourceId = null;
      if (Number(n.equalSelectorDataSourceId) === Number(sourceId)) n.equalSelectorDataSourceId = null;
      if (Number(n.attributeDataSourceId) === Number(sourceId)) n.attributeDataSourceId = null;
      if (Number(n.equalAttributeDataSourceId) === Number(sourceId)) n.equalAttributeDataSourceId = null;
      if (Number(n.saveDataSourceId) === Number(sourceId)) n.saveDataSourceId = null;
    });
    try {
      await fetch(`/api/tasks/${taskId}/datasources/${sourceId}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
    } catch { /* canvas save still syncs links */ }

    if (newMaster && Number(prevMaster) === Number(sourceId) && Number(newMaster) !== Number(sourceId)) {
      const ask = window.DaNotify?.confirm
        ? await DaNotify.confirm(t("editor.ds.remapSelectorsConfirm"), {
            title: t("editor.ds.setMaster"),
            okText: t("common.yes"),
            cancelText: t("common.no")
          })
        : window.confirm(t("editor.ds.remapSelectorsConfirm"));
      if (ask) remapSelectorsToSource(newMaster);
    }

    const statusEl = document.getElementById("ds-status");
    if (statusEl) statusEl.textContent = t("editor.ds.detached");
    await save();
    renderInspector();
  }

  /** Point selector/dynamic DS ids at sourceId when the stored column key exists on that source. */
  function remapSelectorsToSource(sourceId) {
    const ds = findDataSourceById(sourceId);
    if (!ds) return 0;
    const keySet = new Set(
      (ds.columnKeys || (ds.columns || []).map((c) => c.key || c.Key) || [])
        .map((k) => String(k || "").trim())
        .filter(Boolean)
    );
    if (!keySet.size) return 0;
    let updated = 0;
    const pairs = [
      ["selectorDynamicColumn", "selectorDataSourceId"],
      ["equalSelectorDynamicColumn", "equalSelectorDataSourceId"],
      ["attributeDynamicColumn", "attributeDataSourceId"],
      ["equalAttributeDynamicColumn", "equalAttributeDataSourceId"],
      ["dynamicSourceColumnName", "dataSourceId"],
      ["dynamicSourceColumnName", "sourceId"],
      ["saveColumnName", "saveDataSourceId"]
    ];
    (graph.nodes || []).forEach((n) => {
      pairs.forEach(([colProp, dsProp]) => {
        const col = n[colProp];
        if (!col || !keySet.has(String(col).trim())) return;
        if (dsProp === "dataSourceId" && n.kind === "start") return;
        if (Number(n[dsProp]) === Number(sourceId)) return;
        n[dsProp] = Number(sourceId);
        updated += 1;
      });
    });
    return updated;
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

  /**
   * Map an executing node id to the node that is actually drawn in the current
   * diagram scope (ascend into parent groups when nested).
   */
  function playFocusVisibleId() {
    if (!playFocusNodeId) return null;
    let n = nodeById(playFocusNodeId);
    if (!n) return null;
    const scope = currentScopeId();
    let guard = 0;
    while (n && guard++ < 48) {
      const parent = n.groupNodeId || null;
      if (parent === scope) return n.id;
      if (!parent) return scope == null ? n.id : null;
      n = nodeById(parent);
    }
    return null;
  }

  function applyPlayFocusHighlight() {
    if (!world) return;
    const focusId = playFocusVisibleId();
    const playing = !!focusId;
    world.classList.toggle("is-play-focus", playing);
    svg?.classList.toggle("is-play-focus", playing);
    world.querySelectorAll("g.node").forEach((g) => {
      const id = g.getAttribute("data-id");
      const isFocus = playing && id === focusId;
      g.classList.toggle("node-playing", isFocus);
      g.classList.toggle("node-play-dim", playing && !isFocus);
    });
    world.querySelectorAll("path.edge, path.edge-hit").forEach((el) => {
      el.classList.toggle("edge-play-dim", playing);
    });
    listWrap?.querySelectorAll(".list-step[data-id]").forEach((row) => {
      const id = row.getAttribute("data-id");
      const isFocus = !!playFocusNodeId && id === playFocusNodeId;
      row.classList.toggle("list-step-playing", isFocus);
      row.classList.toggle("list-step-play-dim", !!playFocusNodeId && !isFocus);
    });
  }

  function setPlayFocusFromProgress(detail) {
    const playing = !!detail?.playing;
    const paused = !!detail?.paused;
    playSessionActive = playing;
    playSessionPaused = playing && paused;
    updatePlayControlsUi();
    const nodeId = playing ? (detail.nodeId || null) : null;
    if (playFocusNodeId === nodeId && (playing || !playFocusNodeId)) {
      applyPlayFocusHighlight();
      return;
    }
    playFocusNodeId = nodeId;
    applyPlayFocusHighlight();
  }

  function updatePlayControlsUi() {
    const bar = document.getElementById("flow-play-controls");
    const btn = document.getElementById("btn-play-pause");
    if (!bar) return;
    bar.hidden = !playSessionActive;
    if (!btn) return;
    if (!playSessionActive) {
      btn.dataset.mode = "pause";
      btn.setAttribute("data-da-action", "pause-play");
      return;
    }
    if (playSessionPaused) {
      btn.dataset.mode = "play";
      btn.setAttribute("data-da-action", "resume-play");
      btn.title = t("editor.ribbon.resumeTitle");
      btn.setAttribute("aria-label", t("editor.ribbon.resume"));
      btn.innerHTML = `${PLAY_RESUME_ICO}<span id="btn-play-pause-label">${t("editor.ribbon.resume")}</span>`;
    } else {
      btn.dataset.mode = "pause";
      btn.setAttribute("data-da-action", "pause-play");
      btn.title = t("editor.ribbon.pauseTitle");
      btn.setAttribute("aria-label", t("editor.ribbon.pause"));
      btn.innerHTML = `${PLAY_PAUSE_ICO}<span id="btn-play-pause-label">${t("editor.ribbon.pause")}</span>`;
    }
  }

  function requestEditorPauseResume() {
    const btn = document.getElementById("btn-play-pause");
    const mode = btn?.dataset?.mode || "pause";
    const type = mode === "play" ? "resume" : "pause";
    // Optimistic UI — playStateChanged will confirm.
    playSessionPaused = type === "pause";
    updatePlayControlsUi();
    try {
      window.postMessage({ source: "da-editor", type }, "*");
    } catch {
      window.dispatchEvent(new CustomEvent(type === "pause" ? "da-pause-play" : "da-resume-play"));
    }
  }

  function requestEditorStopPlay() {
    playSessionActive = false;
    playSessionPaused = false;
    playFocusNodeId = null;
    updatePlayControlsUi();
    applyPlayFocusHighlight();
    try {
      window.postMessage({ source: "da-editor", type: "stop" }, "*");
    } catch {
      window.dispatchEvent(new CustomEvent("da-stop-play"));
    }
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
    // Default ON — only explicit false turns it off.
    return n?.ignoreError !== false;
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
    // Edge tip handles above strokes, but BELOW nodes/ports — otherwise an
    // incoming tip steals clicks meant for a free out-port on the same node.
    raiseEdgeTipsUnderNodes();
    if (!inGroup) renderList();
    renderInspector();
    applyPlayFocusHighlight();
    const hint = document.getElementById("flow-hint");
    if (hint) {
      hint.textContent = inGroup
        ? `طراح گروه «${nodeById(editingGroupId)?.title || ""}» — گروه / شرط / اقدام مثل سطح فرآیند`
        : "گروه→شرط(OR)+گروه/اقدام · شرط→موفق/شکست · اقدام ۱ ورودی و ۱ خروجی · کادر نارنجی اقدام";
    }
  }

  /** Keep tip hit-zones under node groups so out-ports win overlapping clicks. */
  function raiseEdgeTipsUnderNodes() {
    const firstNode = world.querySelector("g.node");
    const tips = [...world.querySelectorAll("circle.edge-tip-hit, polygon.edge-tip, circle.edge-tip")];
    if (!firstNode) {
      tips.forEach((t) => world.appendChild(t));
      return;
    }
    tips.forEach((t) => world.insertBefore(t, firstNode));
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

  /** World points of arrow tips landing on n (same as drawEdge tip-hit). */
  function incomingTipWorldPoints(n) {
    const pts = [];
    for (const e of diagramEdges()) {
      if (e.to !== n.id || e.kind === "contains" || e.kind === "parent") continue;
      const src = nodeById(e.from);
      if (!src) continue;
      const { b } = nearestAnchors(src, n, e.kind, e.id);
      pts.push({
        x: b.x - (b.dx || 0) * 5,
        y: b.y - (b.dy || 0) * 5,
        side: n.kind === "condition" ? conditionTipName(n, b) : detectSide(n, b)
      });
    }
    return pts;
  }

  /**
   * Idle free out-port: never sit on an incoming arrow tip (or other ports).
   * Tries clear sides first, then offsets along a side until clearance is enough.
   */
  function pickFreeRectPortLocal(n, avoidLocal, preferToward) {
    const tips = incomingTipWorldPoints(n);
    const avoid = [];
    for (const p of avoidLocal || []) avoid.push({ x: n.x + p.x, y: n.y + p.y });
    for (const t of tips) avoid.push({ x: t.x, y: t.y });

    const blockedSides = new Set(tips.map((t) => t.side));
    const sideOrder = [];
    if (preferToward) {
      sideOrder.push(sideTowardPoint(n, preferToward.x, preferToward.y));
    }
    for (const s of ["right", "bottom", "top", "left"]) {
      if (!sideOrder.includes(s)) sideOrder.push(s);
    }
    sideOrder.sort((a, b) => (blockedSides.has(a) ? 1 : 0) - (blockedSides.has(b) ? 1 : 0));

    const offsets = [0, -24, 24, -44, 44, -64, 64];
    const candidates = [];
    for (const side of sideOrder) {
      for (const off of offsets) {
        candidates.push(clampOnSide(n, side, offsetAlongSide(anchorOn(n, side), side, off)));
      }
    }

    const minClear = 20;
    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      let minD = avoid.length ? Infinity : 100;
      for (const a of avoid) minD = Math.min(minD, Math.hypot(c.x - a.x, c.y - a.y));
      const sideBonus = blockedSides.has(detectSide(n, c)) ? 0 : 50;
      const score = Math.min(minD, 90) + sideBonus;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
      if (minD >= minClear && sideBonus > 0) break;
    }
    const chosen = best || anchorOn(n, "right");
    return { lx: chosen.x - n.x, ly: chosen.y - n.y };
  }

  /**
   * Local (lx,ly) for rect/start out-port.
   * Live → toward target (side without incoming). Idle → clear of arrow tips.
   */
  function outPortLocal(n, edgeKind = "next") {
    const e = diagramEdges().find((x) => x.from === n.id && x.kind === edgeKind);
    const to = e && nodeById(e.to);
    const s = sizeOf(n);
    const defaultToward = { x: n.x + s.w + 120, y: n.y + s.h / 2 };
    if (to) {
      const c = centerOf(to);
      const a = outgoingAnchor(n, c.x, c.y);
      return { lx: a.x - n.x, ly: a.y - n.y };
    }
    return pickFreeRectPortLocal(n, [], defaultToward);
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
    if (playFocusVisibleId()) {
      p.classList.add("edge-play-dim");
      hit.classList.add("edge-play-dim");
    }
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

    // Transparent hit zone near the arrowhead for retarget drag.
    // Keep radius modest so it does not swallow neighboring out-ports.
    const tipX = p2.x - (p2.dx || 0) * 5;
    const tipY = p2.y - (p2.dy || 0) * 5;
    const tipHit = el("circle", {
      class: "edge-tip-hit",
      cx: tipX,
      cy: tipY,
      r: 10,
      fill: "transparent",
      stroke: "none",
      "data-eid": e.id,
      style: "cursor:crosshair;pointer-events:all"
    });
    const tipTitle = document.createElementNS(ns, "title");
    tipTitle.textContent = t("editor.status.tipDragRetarget");
    tipHit.appendChild(tipTitle);

    const nearOutPort = (ev) => {
      const wpt = clientToWorld(ev.clientX, ev.clientY);
      const toNode = nodeById(e.to);
      if (!toNode) return false;
      const g = world.querySelector(`g.node[data-id="${CSS.escape(String(toNode.id))}"]`);
      if (!g) return false;
      for (const p of g.querySelectorAll("circle.port")) {
        const cx = toNode.x + Number(p.getAttribute("cx") || 0);
        const cy = toNode.y + Number(p.getAttribute("cy") || 0);
        if (Math.hypot(wpt.x - cx, wpt.y - cy) <= 14) return true;
      }
      return false;
    };
    const nearTip = (ev) => {
      if (nearOutPort(ev)) return false;
      const wpt = clientToWorld(ev.clientX, ev.clientY);
      return Math.hypot(wpt.x - tipX, wpt.y - tipY) < 18
        || Math.hypot(wpt.x - p2.x, wpt.y - p2.y) < 12;
    };
    const pick = (ev) => {
      if (nearOutPort(ev)) return; // let the port (above) own the gesture
      ev.stopPropagation();
      ev.preventDefault();
      if (canModify && nearTip(ev)) {
        armTipRetarget(e, p1, ev);
        return;
      }
      selectEdge(e.id);
    };
    const grabTip = (ev) => {
      if (nearOutPort(ev)) return;
      ev.stopPropagation();
      ev.preventDefault();
      armTipRetarget(e, p1, ev);
    };
    hit.addEventListener("pointerdown", pick);
    p.addEventListener("pointerdown", pick);
    tipHit.addEventListener("pointerdown", grabTip);
    tipHit.addEventListener("mousedown", (ev) => {
      if (nearOutPort(ev)) return;
      ev.stopPropagation();
      ev.preventDefault();
    });
    world.appendChild(hit);
    world.appendChild(p);
    world.appendChild(tipHit);
  }

  function portHasOutgoing(nodeId, edgeKind) {
    return (graph.edges || []).some((e) =>
      e.from === nodeId && e.kind === edgeKind && e.kind !== "contains" && e.kind !== "parent"
    );
  }

  /**
   * @param {boolean|null} liveForced — if null, derive from edges; true=occupied, false=free idle
   */
  function makeOutPort(nodeId, edgeKind, cx, cy, r, fill, liveForced) {
    const live = liveForced == null ? portHasOutgoing(nodeId, edgeKind) : !!liveForced;
    return el("circle", {
      class: live ? "port port-live" : "port port-idle",
      "data-edge": edgeKind,
      cx, cy, r, fill,
      style: "cursor:crosshair"
    });
  }

  /**
   * Out-ports for start / group / action.
   * - start & action: exactly one next port (idle or live toward target) — no extras
   * - group: live port(s) for each next + one idle free port (never on an incoming tip)
   */
  function appendRectOutPorts(g, n, fill, r) {
    const outs = diagramEdges().filter((e) => e.from === n.id && e.kind === "next");
    const allowExtraFree = n.kind === "group";
    const defaultToward = {
      x: n.x + sizeOf(n).w + 120,
      y: n.y + sizeOf(n).h / 2
    };

    if (!allowExtraFree) {
      // Single next port only (start / action).
      if (outs.length) {
        const to = nodeById(outs[0].to);
        const toward = to ? centerOf(to) : defaultToward;
        const a = outgoingAnchor(n, toward.x, toward.y);
        g.appendChild(makeOutPort(n.id, "next", a.x - n.x, a.y - n.y, r, fill, true));
      } else {
        const p = pickFreeRectPortLocal(n, [], defaultToward);
        g.appendChild(makeOutPort(n.id, "next", p.lx, p.ly, r, fill, false));
      }
      return;
    }

    // Group: live circles for each next + one idle free clear of tips/arrows.
    const placed = [];
    outs.forEach((e) => {
      const to = nodeById(e.to);
      const toward = to ? centerOf(to) : defaultToward;
      const a = outgoingAnchor(n, toward.x, toward.y);
      placed.push({ x: a.x - n.x, y: a.y - n.y, live: true });
    });

    const free = pickFreeRectPortLocal(n, placed, defaultToward);
    placed.push({ x: free.lx, y: free.ly, live: false });

    placed.forEach((p) => {
      g.appendChild(makeOutPort(n.id, "next", p.x, p.y, r, fill, p.live));
    });
  }

  /** Condition: exactly success + fail — never a third circle. */
  function appendConditionOutPorts(g, n) {
    const pair = conditionPortsForDraw(n);
    const hasOk = portHasOutgoing(n.id, "success");
    const hasFail = portHasOutgoing(n.id, "fail");
    g.appendChild(makeOutPort(
      n.id, "success",
      pair.success.x - n.x, pair.success.y - n.y,
      7, "#28c76f", hasOk
    ));
    g.appendChild(makeOutPort(
      n.id, "fail",
      pair.fail.x - n.x, pair.fail.y - n.y,
      7, "#ea5455", hasFail
    ));
  }

  function drawNode(n) {
    const { w, h } = sizeOf(n);
    const actionLayout = isActionNode(n) ? stepBoxSize(n) : null;
    const g = el("g", { class: "node", "data-id": n.id, transform: `translate(${n.x},${n.y})` });
    if (selected.has(n.id)) g.classList.add("node-on");
    const focusId = playFocusVisibleId();
    if (focusId) {
      if (focusId === n.id) g.classList.add("node-playing");
      else g.classList.add("node-play-dim");
    }
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
    // Buttons first (lower paint layer); titles appended after so they sit above.
    if ((n.kind === "group" || n.kind === "condition" || isActionNode(n)) && canModify) {
      g.appendChild(makeCloneButton(w, h, n.kind === "condition" ? "condition" : n.kind === "group" ? "group" : "action"));
    }
    if ((n.kind === "group" || n.kind === "condition" || isActionNode(n)) && canModify) {
      g.appendChild(makeRenameButton(w, h, n.kind === "condition" ? "condition" : n.kind === "group" ? "group" : "action"));
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
      appendRectOutPorts(g, n, "#7367f0", 7);
    } else if (n.kind === "condition") {
      appendConditionOutPorts(g, n);
    } else if (n.kind === "start") {
      appendRectOutPorts(g, n, startStroke(n), 7);
    } else if (isActionNode(n)) {
      appendRectOutPorts(g, n, stepStroke(n), 6);
    }
    g.addEventListener("mousedown", (ev) => {
      const renameEl = ev.target.closest && ev.target.closest(".node-rename-btn");
      if (renameEl || (ev.target.classList && ev.target.classList.contains("node-rename-btn"))) {
        ev.stopPropagation();
        ev.preventDefault();
        renameDiagramNode(n);
        return;
      }
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

  /** Clone icon at bottom-left — under the title paint layer. */
  function makeCloneButton(w, h, kind) {
    const size = 18;
    const x = kind === "condition" ? 4 : 5;
    const y = Math.max(5, h - size - 5);
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

  /** Pencil next to title (top-right) for rename modal. */
  function makeRenameButton(w, h, kind) {
    const size = 18;
    const x = Math.max(4, w - size - 5);
    const y = kind === "condition" ? Math.max(4, h * 0.18) : 5;
    const color = kind === "group" ? morobotPrimaryColor()
      : kind === "condition" ? "#6f6b7d"
      : morobotPrimaryColor();
    const btn = el("g", {
      class: "node-rename-btn",
      transform: `translate(${x},${y})`,
      style: "cursor:pointer"
    });
    const tip = document.createElementNS(ns, "title");
    tip.textContent = t("editor.ds.rename") || "تغییر عنوان";
    btn.appendChild(tip);
    btn.appendChild(el("rect", {
      class: "rename-hit",
      width: size, height: size, rx: 4,
      fill: "transparent", stroke: "none"
    }));
    // Simple pencil glyph
    btn.appendChild(el("path", {
      class: "rename-ico",
      d: "M4 13.5V16h2.5L14.2 8.3 11.7 5.8 4 13.5zm12.2-9.1a.75.75 0 0 0 0-1.06L14.7 1.8a.75.75 0 0 0-1.06 0L12.4 3.04l2.5 2.5 1.3-1.14z",
      fill: color
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

    // Keep relative layout (sequence/spacing) instead of a flat vertical restack.
    const originX = 160;
    const originY = 120;
    list.forEach((a) => {
      a.groupNodeId = gid;
      a.x = originX + (a.x - minX);
      a.y = originY + (a.y - minY);
    });

    const sorted = [...list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
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
      items.push({
        act: "run-browser",
        label: "اجرا در مرورگر",
        submenu: true,
        title: "اجرای این گروه در یکی از تب‌های باز مرورگر"
      });
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
      items.push({
        act: "run-browser",
        label: "اجرا در مرورگر",
        submenu: true,
        title: "اجرای این اقدام در یکی از تب‌های باز مرورگر"
      });
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
    } else if (n.kind === "condition") {
      const needsBrowser = conditionNeedsBrowser(n);
      items.push({
        act: "check-browser",
        label: "بررسی در مرورگر",
        submenu: needsBrowser,
        title: needsBrowser
          ? "ارزیابی این شرط در یکی از تب‌های باز مرورگر (بدون سوییچ تب)"
          : "ارزیابی این شرط (وابسته به مرورگر نیست)"
      });
    } else if (n.kind === "start") {
      items.push({
        act: "run-browser",
        label: "اجرا در مرورگر",
        submenu: true,
        title: n.groupNodeId
          ? "اجرای این گروه از شروع در یکی از تب‌های باز مرورگر"
          : "اجرای کل فرآیند از شروع در یکی از تب‌های باز مرورگر"
      });
    }

    // زیرسطح (داخل گروه): انتقال به سطح بالاتر
    if (canPromoteToParent(n)) {
      const movers = selected.has(n.id)
        ? [...selected].map(nodeById).filter((x) => x && canPromoteToParent(x) && x.groupNodeId === n.groupNodeId)
        : [n];
      const count = movers.length || 1;
      items.push({
        act: "promote",
        label: count > 1 ? `انتقال ${count} المان به سطح بالاتر` : "انتقال به سطح بالاتر",
        disabled: !canModify,
        title: !canModify
          ? "فقط مشاهده"
          : "خروج از این گروه و قرار گرفتن در سطح والد"
      });
    }

    // انتقال به گروه — همهٔ المان‌ها به‌جز Start
    if (n.kind !== "start") {
      const movers = selected.has(n.id)
        ? [...selected].map(nodeById).filter((x) => x && x.kind !== "start")
        : [n];
      const exclude = new Set(movers.filter((x) => x.kind === "group").map((x) => x.id));
      exclude.add(n.id);
      const targets = groupsInCurrentDiagram(exclude)
        .filter((g) => movers.some((m) => canMoveIntoGroup(m, g.id)));
      items.push({
        act: "move-to-group",
        label: movers.length > 1 ? `انتقال ${movers.length} المان به گروه` : "انتقال به گروه",
        submenu: true,
        disabled: !canModify || targets.length === 0,
        title: !canModify
          ? "فقط مشاهده"
          : (targets.length
            ? "انتقال به یکی از گروه‌های دیاگرام جاری"
            : "در این سطح گروهی برای انتقال نیست")
      });
    }

    items.push({ act: "select", label: "انتخاب" });

    ctxMenu.innerHTML = items.map((it) => {
      if (it.submenu) {
        return `<li class="has-sub ${it.disabled ? "disabled" : ""}" data-act="${it.act}"${it.title ? ` title="${esc(it.title)}"` : ""}>
          <span class="ctx-label">${it.label}</span>
          <span class="ctx-caret" aria-hidden="true">‹</span>
          <ul class="ctx-submenu" hidden><li class="disabled">…</li></ul>
        </li>`;
      }
      return `<li data-act="${it.act}" class="${it.disabled ? "disabled" : ""}"${it.title ? ` title="${esc(it.title)}"` : ""}>${it.label}</li>`;
    }).join("");

    // Keep menu inside viewport
    requestAnimationFrame(() => {
      const r = ctxMenu.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) ctxMenu.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
      if (r.bottom > window.innerHeight - 8) ctxMenu.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
    });

    const fillBrowserSubmenu = async (li, mode) => {
      const sub = li.querySelector(".ctx-submenu");
      if (!sub) return;
      sub.hidden = false;
      sub.innerHTML = `<li class="disabled">در حال بارگذاری تب‌ها…</li>`;
      const tabs = await requestOpenBrowserTabs();
      const newTabRow = (mode === "task" || mode === "group")
        ? `<li data-tab-id="__new__" class="ctx-new-tab" title="about:blank">➕ تب جدید خالی (ایجاد خودکار)</li>`
        : "";
      if (!newTabRow && !tabs.length) {
        sub.innerHTML = `<li class="disabled">تب مرورگر پیدا نشد — افزونه را Reload کنید</li>`;
        return;
      }
      const tabRows = tabs.map((t) =>
        `<li data-tab-id="${esc(String(t.id))}" title="${esc(t.url || "")}">${esc(t.label || t.title || String(t.id))}</li>`
      ).join("");
      sub.innerHTML = newTabRow + (tabRows || `<li class="disabled">تب دیگری باز نیست</li>`);
      sub.querySelectorAll("li[data-tab-id]").forEach((tabLi) => {
        tabLi.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ctxMenu.hidden = true;
          const raw = tabLi.getAttribute("data-tab-id");
          if (raw === "__new__") {
            if (mode === "group") requestPlayInTab({ groupNodeId: n.id, openNewTab: true });
            else if (mode === "task") {
              if (n.groupNodeId) requestPlayInTab({ groupNodeId: n.groupNodeId, openNewTab: true });
              else requestPlayInTab({ openNewTab: true });
            }
            return;
          }
          const tabId = Number(raw);
          if (!Number.isFinite(tabId)) return;
          if (mode === "action") requestPlayInTab({ stepNodeId: n.id, tabId });
          else if (mode === "group") requestPlayInTab({ groupNodeId: n.id, tabId });
          else if (mode === "task") {
            if (n.groupNodeId) requestPlayInTab({ groupNodeId: n.groupNodeId, tabId });
            else requestPlayInTab({ tabId });
          } else requestPlayInTab({ conditionNodeId: n.id, tabId });
        });
      });
    };

    const fillMoveToGroupSubmenu = (li) => {
      const sub = li.querySelector(".ctx-submenu");
      if (!sub) return;
      sub.hidden = false;
      const movers = selected.has(n.id)
        ? [...selected].map(nodeById).filter((x) => x && x.kind !== "start")
        : [n];
      const exclude = new Set(movers.filter((x) => x.kind === "group").map((x) => x.id));
      exclude.add(n.id);
      const targets = groupsInCurrentDiagram(exclude)
        .filter((g) => movers.some((m) => canMoveIntoGroup(m, g.id)));
      if (!targets.length) {
        sub.innerHTML = `<li class="disabled">گروهی در این سطح نیست</li>`;
        return;
      }
      sub.innerHTML = targets.map((g) =>
        `<li data-group-id="${esc(g.id)}" title="${esc(g.title || g.id)}">${esc(g.title || "گروه")}</li>`
      ).join("");
      sub.querySelectorAll("li[data-group-id]").forEach((gLi) => {
        gLi.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ctxMenu.hidden = true;
          const gid = gLi.getAttribute("data-group-id");
          const toMove = movers.filter((m) => canMoveIntoGroup(m, gid));
          if (!toMove.length) return;
          if (moveNodesIntoGroup(toMove, gid)) {
            const g = nodeById(gid);
            setStatus(
              toMove.length > 1
                ? `${toMove.length} المان به «${g?.title || "گروه"}» منتقل شد.`
                : `به «${g?.title || "گروه"}» منتقل شد.`,
              "success"
            );
            render();
          }
        });
      });
    };

    ctxMenu.querySelectorAll("li.has-sub").forEach((li) => {
      const act = li.dataset.act;
      const open = () => {
        if (li.classList.contains("disabled")) return;
        if (act === "move-to-group") fillMoveToGroupSubmenu(li);
        else {
          const mode = act === "check-browser"
            ? "condition"
            : (n.kind === "group" ? "group" : n.kind === "start" ? "task" : "action");
          fillBrowserSubmenu(li, mode);
        }
      };
      li.addEventListener("mouseenter", open);
      li.addEventListener("click", (ev) => {
        ev.stopPropagation();
        open();
      });
    });

    ctxMenu.querySelectorAll("li:not(.has-sub)").forEach((li) => {
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
          const count = promoteSelectionToParent(n);
          if (count) {
            setStatus(
              count > 1
                ? `${count} المان به سطح بالاتر منتقل شد.`
                : `«${n.title || n.kind}» به سطح بالاتر منتقل شد.`,
              "success"
            );
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
        } else if (act === "check-browser") {
          requestPlayInTab({ conditionNodeId: n.id, openNewTab: false });
        }
      });
    });
  }

  /** شرط وابسته به مرورگر (تب/صفحه) → نیاز به انتخاب تب هدف. */
  function conditionNeedsBrowser(n) {
    if (!n || n.kind !== "condition") return false;
    const ct = n.conditionType || "None";
    if (["FindElement", "NotFindElement", "FindElements", "ElementValue", "Url", "DriverTabs"].includes(ct)) {
      return true;
    }
    if ((n.contentSourceType || "Constant") === "Elements") return true;
    return false;
  }

  /** @deprecated use conditionNeedsBrowser */
  function conditionNeedsPageElement(n) {
    return conditionNeedsBrowser(n);
  }

  function requestOpenBrowserTabs() {
    return new Promise((resolve) => {
      let settled = false;
      let retryTimer = null;
      const done = (tabs) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(Array.isArray(tabs) ? tabs : []);
      };
      const onEvt = (ev) => done(ev.detail?.tabs || []);
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== "da-player-ext" || d.type !== "open-tabs") return;
        done(d.tabs || []);
      };
      const cleanup = () => {
        window.removeEventListener("da-open-tabs", onEvt);
        window.removeEventListener("message", onMsg);
        clearTimeout(timer);
        if (retryTimer) clearTimeout(retryTimer);
      };
      window.addEventListener("da-open-tabs", onEvt);
      window.addEventListener("message", onMsg);
      const ask = () => {
        try {
          window.postMessage({ source: "da-editor", type: "list-open-tabs" }, "*");
        } catch { /* ignore */ }
        try {
          window.dispatchEvent(new CustomEvent("da-list-open-tabs"));
        } catch { /* ignore */ }
      };
      ask();
      // Retry once — Player service worker may be waking up.
      retryTimer = setTimeout(ask, 350);
      const timer = setTimeout(() => done([]), 4000);
    });
  }

  function requestPlayInTab(scope) {
    if (graphHasInvalidNodes()) {
      const msg = buildInvalidNodesMessage();
      setStatus(msg.split("\n").filter(Boolean)[0] || msg, "error");
      try {
        window.dispatchEvent(new CustomEvent("da-notify", {
          detail: { message: msg, type: "error" }
        }));
      } catch { /* ignore */ }
      // Jump to the first offending node so the user can fix it without hunting.
      const first = collectInvalidNodes()[0];
      if (first) focusInvalidNode(first.id);
      return;
    }
    const rawTab = scope?.tabId != null && scope.tabId !== "" ? Number(scope.tabId) : NaN;
    const hasTab = Number.isFinite(rawTab);
    // شرط‌های غیرالمنتی بدون tabId هم مجازند؛ شرط المانی حتماً tab می‌خواهد.
    if (!hasTab && scope?.conditionNodeId) {
      const cond = nodeById(scope.conditionNodeId);
      if (conditionNeedsBrowser(cond)) {
        setStatus("برای این شرط یک تب صفحه انتخاب کنید.", "warn");
        return;
      }
    } else if (!hasTab && !scope?.conditionNodeId && scope?.openNewTab !== true) {
      setStatus("شناسهٔ تب نامعتبر است.", "warn");
      return;
    }

    const run = async () => {
      let cached = null;
      try {
        cached = await flushGraphForPlay();
      } catch (e) {
        setStatus(String(e.message || e), "error");
        return;
      }
      if (!cached?.graph?.nodes?.length) {
        setStatus("گراف فرآیند برای اجرا آماده نشد.", "error");
        return;
      }
      const detail = {
        taskId: stableTaskId(taskId),
        groupNodeId: scope?.groupNodeId || null,
        stepNodeId: scope?.stepNodeId || null,
        conditionNodeId: scope?.conditionNodeId || null,
        playScope: scope?.conditionNodeId
          ? "condition"
          : scope?.stepNodeId
            ? "step"
            : scope?.groupNodeId
              ? "group"
              : "task",
        tabId: hasTab ? rawTab : null,
        openNewTab: scope?.openNewTab === true,
        task: cached,
        graph: cached.graph
      };
      const send = () => {
        // postMessage crosses isolated worlds reliably (CustomEvent detail can be lost).
        try {
          window.postMessage({ source: "da-editor", type: "play", ...detail }, "*");
        } catch {
          window.dispatchEvent(new CustomEvent("da-play", { detail }));
        }
        const newTab = scope?.openNewTab === true;
        const msg = scope?.conditionNodeId
          ? (hasTab ? `بررسی شرط در تب #${rawTab}…` : "بررسی شرط…")
          : scope?.groupNodeId
            ? (newTab ? "اجرای گروه در تب جدید…" : `اجرای گروه در تب #${rawTab}…`)
            : scope?.stepNodeId
              ? (newTab ? "اجرای اقدام در تب جدید…" : `اجرای اقدام در تب #${rawTab}…`)
              : (newTab ? "اجرای فرآیند در تب جدید خالی…" : `اجرای فرآیند در تب #${rawTab}…`);
        setStatus(msg, "info");
        // Show pause/stop on diagram for any play (including condition checks).
        playSessionActive = true;
        playSessionPaused = false;
        updatePlayControlsUi();
      };
      if (typeof window.daRequirePlayer === "function") {
        const ok = await window.daRequirePlayer({
          reason: "برای اجرا در مرورگر، افزونهٔ Player لازم است.",
          pending: { kind: "da-play", detail }
        });
        if (!ok) {
          setStatus("افزونهٔ اجرا متصل نیست — راهنمای نصب را ببینید.", "warn");
          return;
        }
        send();
        return;
      }
      if (!extOkHint()) {
        setStatus("افزونهٔ اجرا متصل نیست — صفحه را در Chrome رفرش کنید یا Player را Reload کنید.", "warn");
        return;
      }
      send();
    };
    run().catch((e) => setStatus(String(e.message || e), "error"));
  }

  // نتیجهٔ بررسی شرط از Player → ناتیفای + آلرت رنگی
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== "da-player-ext") return;
    if (d.type === "play-progress") {
      setPlayFocusFromProgress(d);
      return;
    }
    if (d.type === "play-ui") {
      applyPlayUiPhase(d.phase);
      return;
    }
    if (d.type !== "condition-result") return;
    const msg = d.message || (d.pass ? "نتیجه شرط: برقرار (موفق)" : "نتیجه شرط: برقرار نیست (ناموفق)");
    setStatus(msg, d.pass ? "success" : "error");
    if (typeof window.daConditionAlert === "function") {
      window.daConditionAlert(!!d.pass, msg);
    }
  });
  window.addEventListener("da-play-progress", (ev) => {
    setPlayFocusFromProgress(ev.detail || {});
  });
  function applyPlayUiPhase(phase) {
    if (phase === "started" || phase === "preparing" || phase === "reloading") {
      playSessionActive = true;
      playSessionPaused = false;
      updatePlayControlsUi();
      return;
    }
    if (phase === "done" || phase === "error") {
      playSessionActive = false;
      playSessionPaused = false;
      playFocusNodeId = null;
      updatePlayControlsUi();
      applyPlayFocusHighlight();
    }
  }
  window.addEventListener("da-play-ui", (ev) => {
    applyPlayUiPhase(ev.detail?.phase);
  });
  window.addEventListener("click", () => { if (ctxMenu) ctxMenu.hidden = true; });

  document.getElementById("btn-play-pause")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!playSessionActive) return;
    requestEditorPauseResume();
  });
  document.getElementById("btn-stop-play")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    requestEditorStopPlay();
  });
  // Ensure controls exist even if the view was cached without them.
  if (!document.getElementById("flow-play-controls")) {
    const wrap = document.querySelector(".canvas-wrap");
    if (wrap) {
      const bar = document.createElement("div");
      bar.className = "flow-play-controls";
      bar.id = "flow-play-controls";
      bar.hidden = true;
      bar.innerHTML = `
        <button type="button" class="btn-flow btn-with-ico btn-play-pause" id="btn-play-pause" data-da-action="pause-play" data-mode="pause" title="${t("editor.ribbon.pauseTitle")}">
          ${PLAY_PAUSE_ICO}<span id="btn-play-pause-label">${t("editor.ribbon.pause")}</span>
        </button>
        <button type="button" class="btn-flow btn-with-ico btn-stop-play" id="btn-stop-play" data-da-action="stop-play" title="${t("editor.ribbon.stopTitle")}">
          <svg class="btn-play-ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>
          <span>${t("editor.ribbon.stop")}</span>
        </button>`;
      wrap.appendChild(bar);
      document.getElementById("btn-play-pause")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!playSessionActive) return;
        requestEditorPauseResume();
      });
      document.getElementById("btn-stop-play")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        requestEditorStopPlay();
      });
    }
  }

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
      ignoreError: true,
      framePathJson: "[]",
      x: opts.x ?? 120,
      y: opts.y ?? (100 + siblings.length * 48)
    };
    if (scopeId) node.groupNodeId = scopeId;
    graph.nodes.push(node);
    return node;
  }

  /** Group under a world point in the current diagram scope only (prefer smallest / topmost). */
  function groupAtWorldInScope(wx, wy, excludeIds = null) {
    const skip = excludeIds == null
      ? null
      : (excludeIds instanceof Set ? excludeIds : new Set([].concat(excludeIds)));
    let best = null;
    let bestArea = Infinity;
    for (const g of scopedNodes().filter((n) => n.kind === "group")) {
      if (skip && skip.has(g.id)) continue;
      const s = sizeOf(g);
      if (wx >= g.x && wx <= g.x + s.w && wy >= g.y && wy <= g.y + s.h) {
        const area = s.w * s.h;
        if (area <= bestArea) {
          best = g;
          bestArea = area;
        }
      }
    }
    return best;
  }

  /** Drop all edges touching a node (flow + contains). */
  function detachNodeFlowEdges(nodeId) {
    graph.edges = (graph.edges || []).filter((e) => e.from !== nodeId && e.to !== nodeId);
  }

  /** True if ancestorId is an ancestor group of nodeId (via groupNodeId chain). */
  function isAncestorGroup(ancestorId, nodeId) {
    let cur = nodeById(nodeId);
    const seen = new Set();
    while (cur?.groupNodeId) {
      if (cur.groupNodeId === ancestorId) return true;
      if (seen.has(cur.groupNodeId)) break;
      seen.add(cur.groupNodeId);
      cur = nodeById(cur.groupNodeId);
    }
    return false;
  }

  /** Can this node be moved into target group without cycles / no-ops? */
  function canMoveIntoGroup(node, groupId) {
    if (!canModify || !node || !groupId || node.kind === "start") return false;
    if (node.id === groupId) return false;
    if ((node.groupNodeId || null) === groupId) return false;
    const g = nodeById(groupId);
    if (!g || g.kind !== "group") return false;
    // Don't nest a group inside itself / its descendant.
    if (node.kind === "group" && isAncestorGroup(node.id, groupId)) return false;
    return true;
  }

  /** Groups visible on the current diagram canvas. */
  function groupsInCurrentDiagram(excludeIds = null) {
    const skip = excludeIds instanceof Set
      ? excludeIds
      : new Set(excludeIds ? [].concat(excludeIds) : []);
    return scopedNodes().filter((n) => n.kind === "group" && !skip.has(n.id));
  }

  /**
   * Move action/condition/group nodes into an existing group.
   * Keeps internal edges (sequence between moved nodes) and relative layout;
   * rewires outer edges to the group container.
   */
  function moveNodesIntoGroup(nodes, groupId) {
    if (!canModify) return false;
    const g = nodeById(groupId);
    if (!g || g.kind !== "group") return false;
    const list = (nodes || []).filter((n) => canMoveIntoGroup(n, groupId));
    if (!list.length) return false;

    const movingIds = new Set(list.map((n) => n.id));
    const minX = Math.min(...list.map((n) => n.x));
    const minY = Math.min(...list.map((n) => n.y));
    const existingKids = groupDirectChildren(groupId).filter((k) => !movingIds.has(k.id));
    let baseX = 140;
    let baseY = 120;
    if (existingKids.length) {
      const bottom = Math.max(...existingKids.map((k) => {
        const s = sizeOf(k);
        return k.y + s.h;
      }));
      baseY = bottom + 48;
    }

    // Rewire boundary edges onto the group; keep edges entirely inside the selection.
    (graph.edges || []).forEach((e) => {
      if (e.kind === "contains" || e.kind === "parent") return;
      const fromIn = movingIds.has(e.from);
      const toIn = movingIds.has(e.to);
      if (fromIn && toIn) return;
      if (!fromIn && toIn) e.to = groupId;
      if (fromIn && !toIn) e.from = groupId;
    });

    // Drop old parent→child contains for movers; drop accidental self-loops.
    graph.edges = (graph.edges || []).filter((e) => {
      if (e.from === e.to) return false;
      if (e.kind === "contains" && movingIds.has(e.to) && e.from !== groupId) return false;
      return true;
    });

    list.forEach((n) => {
      n.groupNodeId = groupId;
      n.x = baseX + (n.x - minX);
      n.y = baseY + (n.y - minY);
    });

    // Topological-ish entry: first node (by layout) with no inbound edge from other movers.
    const hasInternalIn = new Set();
    (graph.edges || []).forEach((e) => {
      if (e.kind === "contains" || e.kind === "parent") return;
      if (movingIds.has(e.from) && movingIds.has(e.to)) hasInternalIn.add(e.to);
    });
    const sorted = [...list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const entries = sorted.filter((a) => !hasInternalIn.has(a.id));
    const entry = entries[0] || sorted[0];

    const start = ensureGroupStart(groupId);
    if (start && entry) {
      const hasStartNext = (graph.edges || []).some((e) => e.from === start.id && e.kind === "next");
      if (!hasStartNext) {
        graph.edges.push({ id: tmpId("e"), from: start.id, to: entry.id, kind: "next" });
        syncGroupContainsFromStart(start.id, entry.id);
      }
    }

    selectedEdgeId = null;
    selected = new Set(list.map((n) => n.id));
    return true;
  }

  /** @deprecated use moveNodesIntoGroup */
  function moveStepIntoGroup(step, groupId) {
    return moveNodesIntoGroup([step], groupId);
  }

  /** Lift node one scope up (out of its containing group). */
  function promoteNodeToParent(node) {
    if (!canModify || !node || node.kind === "start" || !node.groupNodeId) return false;
    const parentGroup = nodeById(node.groupNodeId);
    if (!parentGroup || parentGroup.kind !== "group") return false;
    const parentScope = parentGroup.groupNodeId || null;
    detachNodeFlowEdges(node.id);
    graph.edges = (graph.edges || []).filter((e) =>
      !(e.kind === "contains" && e.from === parentGroup.id && e.to === node.id)
    );
    if (parentScope) node.groupNodeId = parentScope;
    else delete node.groupNodeId;
    const sz = sizeOf(parentGroup);
    node.x = parentGroup.x + sz.w + 28;
    node.y = parentGroup.y;
    selected = new Set([node.id]);
    return true;
  }

  /** @deprecated use promoteNodeToParent */
  function promoteStepToParent(step) {
    return promoteNodeToParent(step);
  }

  function canPromoteToParent(n) {
    if (!n || n.kind === "start" || !n.groupNodeId) return false;
    const parent = nodeById(n.groupNodeId);
    return !!(parent && parent.kind === "group");
  }

  function promoteSelectionToParent(primary) {
    if (!canModify) return 0;
    const list = (selected.has(primary.id)
      ? [...selected].map(nodeById)
      : [primary]
    ).filter((x) => x && canPromoteToParent(x));
    if (!list.length) return 0;
    // Same containing group only
    const gid = list[0].groupNodeId;
    const peers = list.filter((x) => x.groupNodeId === gid);
    const parentGroup = nodeById(gid);
    if (!parentGroup) return 0;
    const parentScope = parentGroup.groupNodeId || null;
    const sz = sizeOf(parentGroup);
    const ids = new Set(peers.map((p) => p.id));

    // Keep edges entirely inside the promoted set; rewire outer flow to parent group.
    (graph.edges || []).forEach((e) => {
      if (e.kind === "contains" || e.kind === "parent") return;
      const fromIn = ids.has(e.from);
      const toIn = ids.has(e.to);
      if (fromIn && toIn) return;
      if (!fromIn && toIn) e.to = parentGroup.id;
      if (fromIn && !toIn) e.from = parentGroup.id;
    });
    graph.edges = (graph.edges || []).filter((e) => {
      if (e.from === e.to) return false;
      if (e.kind === "contains" && e.from === parentGroup.id && ids.has(e.to)) return false;
      return true;
    });

    peers.forEach((n, i) => {
      if (parentScope) n.groupNodeId = parentScope;
      else delete n.groupNodeId;
      n.x = parentGroup.x + sz.w + 28;
      n.y = parentGroup.y + i * 56;
    });
    selected = new Set(peers.map((p) => p.id));
    selectedEdgeId = null;
    return peers.length;
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
          if (inp.value === "UserSystemDate") {
            n.constantEqualValue = normalizeUserSystemDateInput(n.constantEqualValue || "");
          } else if (inp.value === "UserSystemTime") {
            n.constantEqualValue = normalizeUserSystemTimeInput(n.constantEqualValue || "");
          }
        } else n[k] = inp.value;

        if (k === "constantEqualValue" && n.kind === "condition") {
          if (n.contentSourceType === "UserSystemDate") {
            n.constantEqualValue = normalizeUserSystemDateInput(inp.value) || String(inp.value || "").trim();
          } else if (n.contentSourceType === "UserSystemTime") {
            n.constantEqualValue = normalizeUserSystemTimeInput(inp.value) || String(inp.value || "").trim();
          }
        }

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
          || k === "selectorWaitEnabled" || k === "equalSelectorWaitEnabled"
          || k === "selectorRequireVisible" || k === "equalSelectorRequireVisible"
          || k === "selectorRequireEnabled" || k === "equalSelectorRequireEnabled"
          || k === "selectorRequireClickable" || k === "equalSelectorRequireClickable") {
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
            || k === "selectorRequireVisible" || k === "equalSelectorRequireVisible"
            || k === "selectorRequireEnabled" || k === "equalSelectorRequireEnabled"
            || k === "selectorRequireClickable" || k === "equalSelectorRequireClickable"
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

  /** Allowed: YYYY-MM-DD */
  const USER_SYSTEM_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  /** Allowed: HH:mm or HH:mm:ss */
  const USER_SYSTEM_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

  function isValidUserSystemDate(v) {
    const s = String(v || "").trim();
    if (!USER_SYSTEM_DATE_RE.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function isValidUserSystemTime(v) {
    return USER_SYSTEM_TIME_RE.test(String(v || "").trim());
  }

  function normalizeUserSystemDateInput(raw) {
    const s = String(raw || "").trim();
    if (isValidUserSystemDate(s)) return s;
    const m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (m) {
      const y = m[1];
      const mo = String(m[2]).padStart(2, "0");
      const d = String(m[3]).padStart(2, "0");
      const norm = `${y}-${mo}-${d}`;
      return isValidUserSystemDate(norm) ? norm : "";
    }
    return "";
  }

  function normalizeUserSystemTimeInput(raw) {
    const s = String(raw || "").trim();
    if (isValidUserSystemTime(s)) return s;
    const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
      const hh = String(m[1]).padStart(2, "0");
      const mm = String(m[2]).padStart(2, "0");
      const ss = m[3] != null ? String(m[3]).padStart(2, "0") : null;
      const norm = ss != null ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
      return isValidUserSystemTime(norm) ? norm : "";
    }
    return "";
  }

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
      } else if (src === "UserSystemDate") {
        const val = String(n.constantEqualValue ?? n.userSystemDateValue ?? "").trim();
        if (!val) {
          reasons.push("تاریخ سیستم کاربر مشخص نیست");
        } else if (!isValidUserSystemDate(val)) {
          reasons.push("فرمت تاریخ سیستم کاربر نامعتبر است (مجاز: YYYY-MM-DD)");
        }
      } else if (src === "UserSystemTime") {
        const val = String(n.constantEqualValue ?? n.userSystemTimeValue ?? "").trim();
        if (!val) {
          reasons.push("زمان سیستم کاربر مشخص نیست");
        } else if (!isValidUserSystemTime(val)) {
          reasons.push("فرمت زمان سیستم کاربر نامعتبر است (مجاز: HH:mm یا HH:mm:ss)");
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
    if (n.ignoreError == null) n.ignoreError = true;
    const active = n.isActive !== false;
    const at = n.actionType || "Click";
    const ignoreError = n.ignoreError !== false;
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
          چشم‌پوشی از خطا (پیش‌فرض روشن): با خطا مرحلهٔ بعدی اجرا می‌شود.
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
        requireVisibleKey: "equalSelectorRequireVisible",
        requireEnabledKey: "equalSelectorRequireEnabled",
        requireClickableKey: "equalSelectorRequireClickable",
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
    const reqVisibleKey = opts.requireVisibleKey || "selectorRequireVisible";
    const reqEnabledKey = opts.requireEnabledKey || "selectorRequireEnabled";
    const reqClickableKey = opts.requireClickableKey || "selectorRequireClickable";
    const wrapId = opts.wrapId ? ` id="${opts.wrapId}"` : "";

    // Default off unless explicitly true
    if (n[dynFlag] == null) n[dynFlag] = false;
    if (n[hasAttrKey] == null) n[hasAttrKey] = false;
    if (n[attrDynFlag] == null) n[attrDynFlag] = false;
    if (n[waitFlag] == null) n[waitFlag] = false;
    if (n[waitMsKey] == null || n[waitMsKey] === "") n[waitMsKey] = 1000;
    if (n[reqVisibleKey] == null) n[reqVisibleKey] = false;
    if (n[reqEnabledKey] == null) n[reqEnabledKey] = false;
    if (n[reqClickableKey] == null) n[reqClickableKey] = false;
    const dynOn = n[dynFlag] === true;
    const attrOn = n[hasAttrKey] === true;
    const attrDynOn = n[attrDynFlag] === true;
    const waitOn = n[waitFlag] === true;
    const reqVisible = n[reqVisibleKey] === true;
    const reqEnabled = n[reqEnabledKey] === true;
    const reqClickable = n[reqClickableKey] === true;
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
            <button type="button" class="btn-mini" data-sel-act="save-mem" data-sel-key="${valueKey}" title="ذخیره آبجکت سلکتور در حافظه افزونه">ذخیره در حافظه</button>
            <button type="button" class="btn-mini" data-sel-act="load-mem" data-sel-key="${valueKey}" title="جایگزینی با آبجکت کپی‌شده (کپی آبجکت سلکتور)">خواندن از حافظه</button>
          </div>
          <p class="palette-hint" style="margin:4px 0 0;line-height:1.5">
            راست‌کلیک → «کپی آبجکت سلکتور»، سپس اینجا «خواندن از حافظه» تا سلکتور و زنجیره فریم ست شوند.
          </p>
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
        <div class="insp-field insp-sel-state">
          <label class="palette-hint" style="display:block;margin:0 0 6px;font-weight:600;color:#4b465c">شرایط ضروری المان</label>
          <label class="da-switch" style="margin-bottom:6px">
            <input type="checkbox" data-k="${reqVisibleKey}" ${reqVisible ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">باید مرئی (Visible) باشد</span>
          </label>
          <label class="da-switch" style="margin-bottom:6px">
            <input type="checkbox" data-k="${reqEnabledKey}" ${reqEnabled ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">باید فعال (Enabled) باشد</span>
          </label>
          <label class="da-switch">
            <input type="checkbox" data-k="${reqClickableKey}" ${reqClickable ? "checked" : ""}/>
            <span class="da-switch-ui" aria-hidden="true"></span>
            <span class="da-switch-text">باید قابل کلیک (Clickable) باشد</span>
          </label>
          <p class="palette-hint" style="margin:6px 0 0;line-height:1.55">
            فقط المانی پذیرفته می‌شود که همهٔ شرایط روشن‌شده را داشته باشد.
          </p>
        </div>
      </div>`;
  }

  function parseDaSelectorText(text) {
    if (!text || typeof text !== "string") return null;
    const raw = text.trim();
    if (!raw.startsWith("DASEL:")) return null;
    try {
      const obj = JSON.parse(raw.slice(6));
      const leaf = obj?.selector || obj?.Selector || obj?.elementValue || obj?.ElementValue || "";
      if (!obj || !String(leaf).trim()) return null;
      return {
        selector: leaf,
        elementValue: leaf,
        framePath: obj.framePath || obj.FramePath || [],
        elementBy: obj.elementBy || obj.ElementBy || "CssSelector",
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
    const leaf = n[key] || "";
    const payload = {
      v: 1,
      kind: "da-selector",
      elementBy: "CssSelector",
      elementValue: leaf,
      selector: leaf,
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
  const SEL_PAGE_SRC = "da-editor";
  const SEL_EXT_SRC = "da-selector-ext";

  function payloadFromExtDetail(detail) {
    if (!detail?.ok || !detail.payload) return null;
    const p = detail.payload;
    const leaf = p.selector || p.elementValue || p.Selector || p.ElementValue || "";
    if (!String(leaf).trim()) return null;
    return {
      selector: leaf,
      elementValue: leaf,
      elementBy: p.elementBy || p.ElementBy || "CssSelector",
      framePath: Array.isArray(p.framePath) ? p.framePath : (Array.isArray(p.FramePath) ? p.FramePath : []),
      hasAttribute: p.hasAttribute ?? p.HasAttribute,
      attributeName: p.attributeName || p.AttributeName,
      attributeValueIsDynamic: p.attributeValueIsDynamic ?? p.AttributeValueIsDynamic,
      attributeValue: p.attributeValue || p.AttributeValue,
      attributeDynamicColumn: p.attributeDynamicColumn || p.AttributeDynamicColumn || p.attributeDynamicColumn,
      attributeDataSourceId: p.attributeDataSourceId ?? p.AttributeDataSourceId ?? p.attributeDataSourceId ?? null
    };
  }

  /** Ask Selector extension via postMessage (cross-world) + legacy CustomEvent. */
  function requestCopiedSelectorFromExt(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let settled = false;
      const finishOk = (detail) => {
        const mapped = payloadFromExtDetail(detail);
        if (!mapped || settled) return false;
        settled = true;
        cleanup();
        resolve({ ok: true, payload: mapped, text: detail.text || "" });
        return true;
      };
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== SEL_EXT_SRC || d.type !== "copied-selector") return;
        finishOk(d);
      };
      const onEvt = (ev) => finishOk(ev.detail);
      const cleanup = () => {
        window.removeEventListener("message", onMsg);
        window.removeEventListener("da-copied-selector", onEvt);
        clearTimeout(timer);
      };
      window.addEventListener("message", onMsg);
      window.addEventListener("da-copied-selector", onEvt);
      try {
        window.postMessage({ source: SEL_PAGE_SRC, type: "request-copied-selector" }, "*");
      } catch { /* ignore */ }
      try {
        window.dispatchEvent(new CustomEvent("da-request-copied-selector"));
      } catch { /* ignore */ }
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, timeoutMs);
    });
  }

  function storeCopiedSelectorToExt(payload, text, timeoutMs = 1500) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (detail) => {
        if (settled) return;
        if (detail && detail.ok) {
          settled = true;
          cleanup();
          resolve(true);
        }
      };
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== SEL_EXT_SRC || d.type !== "stored-selector") return;
        finish(d);
      };
      const onEvt = (ev) => finish(ev.detail);
      const cleanup = () => {
        window.removeEventListener("message", onMsg);
        window.removeEventListener("da-stored-selector", onEvt);
        clearTimeout(timer);
      };
      window.addEventListener("message", onMsg);
      window.addEventListener("da-stored-selector", onEvt);
      try {
        window.postMessage({ source: SEL_PAGE_SRC, type: "store-copied-selector", payload, text }, "*");
      } catch { /* ignore */ }
      try {
        window.dispatchEvent(new CustomEvent("da-store-copied-selector", { detail: { payload, text } }));
      } catch { /* ignore */ }
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      }, timeoutMs);
    });
  }

  function applySelectorPayload(n, payload, preferKey) {
    const leaf = payload?.selector || payload?.elementValue || "";
    if (!payload || leaf == null || String(leaf).trim() === "") return false;
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
    n[targetKey] = leaf;
    // Full app selector object: always apply framePath when not the equal-only field
    if (targetKey !== "equalSelectorValue") {
      n.framePathJson = JSON.stringify(payload.framePath || []);
      if (payload.elementBy) n.elementBy = payload.elementBy;
      if (payload.hasAttribute != null) {
        n.hasAttribute = !!payload.hasAttribute;
        if (payload.attributeName != null) n.attributeName = payload.attributeName;
        if (payload.attributeValueIsDynamic != null) n.attributeValueIsDynamic = !!payload.attributeValueIsDynamic;
        if (payload.attributeValue != null) n.attributeValue = payload.attributeValue;
        if (payload.attributeDynamicColumn != null) n.attributeDynamicColumn = payload.attributeDynamicColumn;
        if (payload.attributeDataSourceId != null) n.attributeDataSourceId = payload.attributeDataSourceId;
      }
    } else if (payload.hasAttribute != null) {
      n.equalHasAttribute = !!payload.hasAttribute;
      if (payload.attributeName != null) n.equalAttributeName = payload.attributeName;
      if (payload.attributeValueIsDynamic != null) n.equalAttributeValueIsDynamic = !!payload.attributeValueIsDynamic;
      if (payload.attributeValue != null) n.equalAttributeValue = payload.attributeValue;
      if (payload.attributeDynamicColumn != null) n.equalAttributeDynamicColumn = payload.attributeDynamicColumn;
      if (payload.attributeDataSourceId != null) n.equalAttributeDataSourceId = payload.attributeDataSourceId;
    }
    // Set open inspector fields immediately (then full re-render)
    const inp = inspector.querySelector(`[data-k="${targetKey}"]`);
    if (inp) inp.value = leaf;
    const frameTa = inspector.querySelector("[data-k=framePathJson]");
    if (frameTa && targetKey !== "equalSelectorValue") {
      frameTa.value = n.framePathJson || "[]";
    }
    setStatus("سلکتور از حافظه روی نود ست شد.", "success");
    render();
    return true;
  }

  async function saveSelectorToMemory(n, preferKey) {
    const payload = buildSelectorPayloadFromNode(n, preferKey);
    if (!payload.selector && !payload.elementValue) {
      setStatus("سلکتور خالی است — چیزی برای ذخیره نیست.", "warn");
      return;
    }
    const text = encodeDaSelectorPayload(payload);
    try {
      localStorage.setItem(SEL_MEM_KEY, text);
    } catch { /* ignore quota */ }

    const extOk = await storeCopiedSelectorToExt(payload, text);

    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }

    setStatus(extOk
      ? "آبجکت سلکتور در حافظه افزونه ذخیره شد."
      : "آبجکت سلکتور در حافظه محلی ذخیره شد.", "success");
  }

  async function loadSelectorFromMemory(n, preferKey) {
    const hasSelectorExt = document.documentElement.dataset.daSelectorExtension === "1";

    // 1) localStorage first — «کپی آبجکت سلکتور» / ذخیره در حافظه می‌نویسند
    try {
      const raw = localStorage.getItem(SEL_MEM_KEY);
      const parsed = parseDaSelectorText(raw);
      if (parsed) {
        applySelectorPayload(n, parsed, preferKey);
        setStatus("آبجکت سلکتور از حافظه جایگزین شد.", "success");
        return true;
      }
    } catch { /* ignore */ }

    // 2) Extension memory (postMessage + CustomEvent)
    try {
      const res = await requestCopiedSelectorFromExt(2000);
      if (res?.ok && res.payload) {
        applySelectorPayload(n, res.payload, preferKey);
        try {
          if (res.text) localStorage.setItem(SEL_MEM_KEY, res.text);
          else localStorage.setItem(SEL_MEM_KEY, encodeDaSelectorPayload(res.payload));
        } catch { /* ignore */ }
        setStatus("آبجکت سلکتور از افزونه جایگزین شد.", "success");
        return true;
      }
    } catch { /* fall through */ }

    // 3) clipboard (DASEL only — plain CSS is not an object)
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseDaSelectorText(text);
      if (parsed) {
        applySelectorPayload(n, parsed, preferKey);
        try { localStorage.setItem(SEL_MEM_KEY, text); } catch { /* ignore */ }
        setStatus("آبجکت سلکتور از کلیپ‌بورد جایگزین شد.", "success");
        return true;
      }
    } catch { /* ignore */ }

    if (!hasSelectorExt) {
      setStatus("افزونهٔ سلکتور نصب نیست — از صفحهٔ نصب، مسیر Selector را Load unpacked کنید.", "warn");
    } else {
      setStatus("آبجکت سلکتوری در حافظه نیست. راست‌کلیک → «کپی آبجکت سلکتور».", "warn");
    }
    return false;
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
      `      <p class="palette-hint" style="margin:0 0 8px;line-height:1.7">
        ترتیب: نوع شرط → نوع مقدار → مقدار → نوع مقایسه
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
      html += `<div class="insp-section-title">۲. نوع مقدار مقایسه</div>` +
        `<div class="insp-field"><label>نوع مقدار</label>
          <select data-k="contentSourceType">
            <option value="Constant" ${src === "Constant" ? "selected" : ""}>مقدار ثابت</option>
            <option value="UserSystemDate" ${src === "UserSystemDate" ? "selected" : ""}>تاریخ سیستم کاربر</option>
            <option value="UserSystemTime" ${src === "UserSystemTime" ? "selected" : ""}>زمان سیستم کاربر</option>
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
      } else if (src === "UserSystemDate") {
        const dateVal = normalizeUserSystemDateInput(n.constantEqualValue || n.userSystemDateValue || "");
        html += `<div class="insp-field">
          <label>تاریخ (فرمت مجاز: YYYY-MM-DD)</label>
          <input type="date" data-k="constantEqualValue" value="${esc(dateVal)}" />
          <p class="palette-hint" style="margin:4px 0 0;line-height:1.55">مقدار مقایسه به‌صورت تاریخ سیستم کاربر با فرمت <code>YYYY-MM-DD</code> ذخیره می‌شود.</p>
        </div>`;
      } else if (src === "UserSystemTime") {
        const timeVal = normalizeUserSystemTimeInput(n.constantEqualValue || n.userSystemTimeValue || "");
        html += `<div class="insp-field">
          <label>زمان (فرمت مجاز: HH:mm یا HH:mm:ss)</label>
          <input type="time" step="1" data-k="constantEqualValue" value="${esc(timeVal)}" />
          <p class="palette-hint" style="margin:4px 0 0;line-height:1.55">مقدار مقایسه به‌صورت زمان سیستم کاربر با فرمت <code>HH:mm</code> یا <code>HH:mm:ss</code> ذخیره می‌شود.</p>
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
          waitMsKey: "equalSelectorWaitMs",
          requireVisibleKey: "equalSelectorRequireVisible",
          requireEnabledKey: "equalSelectorRequireEnabled",
          requireClickableKey: "equalSelectorRequireClickable"
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
    // Play is only via context menu + target tab — ribbon play buttons removed.
  }

  function graphHasInvalidNodes() {
    return (graph.nodes || []).some((n) => {
      if (n.kind === "group") return false; // groups mirror descendants; leaf check is enough
      return !validateNodeLeaf(n).ok;
    });
  }

  /** Human label for a node kind, used in the validation report. */
  function nodeKindLabel(n) {
    if (!n) return t("play.check.unknownNode");
    if (n.kind === "start") return t("play.check.kindStart");
    if (n.kind === "condition") return t("play.check.kindCondition");
    if (isActionNode(n)) return t("play.check.kindAction");
    if (n.kind === "group") return t("play.check.kindGroup");
    return n.kind || t("play.check.unknownNode");
  }

  /** Group a node belongs to, or the process scope for free-standing nodes. */
  function nodeGroupLabel(n) {
    if (!n) return t("play.check.noGroup");
    if (n.kind === "group") return n.title || t("play.check.untitledGroup");
    if (!n.groupNodeId) return t("play.check.outsideGroup");
    const g = nodeById(n.groupNodeId);
    return g ? (g.title || t("play.check.untitledGroup")) : t("play.check.unknownGroup");
  }

  /** Every node failing validation, with name, group, kind and reasons. */
  function collectInvalidNodes() {
    const out = [];
    for (const n of graph.nodes || []) {
      if (n.kind === "group") continue;
      if (n.isActive === false) continue;
      const v = validateNodeLeaf(n);
      if (v.ok) continue;
      out.push({
        node: n,
        id: n.id,
        title: n.title || nodeKindLabel(n),
        kind: nodeKindLabel(n),
        group: nodeGroupLabel(n),
        reasons: (v.reasons && v.reasons.length) ? v.reasons : [t("play.check.unknownReason")]
      });
    }
    return out;
  }

  /** Detailed, user-facing validation error — names each node, its group, kind and reasons. */
  function buildInvalidNodesMessage() {
    const items = collectInvalidNodes();
    if (!items.length) return "";
    const lines = items.map((it, i) =>
      `${i + 1}) ${it.kind} «${it.title}» — ${t("play.check.inGroup")}: ${it.group}`
      + "\n" + it.reasons.map((r) => `   • ${r}`).join("\n")
    );
    return `${t("play.check.header", { n: items.length })}\n\n${lines.join("\n\n")}\n\n${t("play.check.footer")}`;
  }

  /** Move the viewport/selection to a node so the user can fix it immediately. */
  function focusInvalidNode(nodeId) {
    if (!nodeId) return;
    try {
      const n = nodeById(nodeId);
      if (!n) return;
      if (n.groupNodeId) openGroup(n.groupNodeId);
      selectNode(nodeId, false);
      render();
      renderInspector();
    } catch { /* focus is best-effort */ }
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
    if (isPort) {
      selectNode(n.id, false);
    } else if (additive) {
      selectNode(n.id, true);
    } else if (!selected.has(n.id)) {
      selectNode(n.id, false);
    }
    // else: already selected → keep multi-select for group drag
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
      const ids = selected.has(n.id) ? [...selected] : [n.id];
      const items = ids.map((id) => {
        const node = nodeById(id);
        return node ? { id, ox: node.x, oy: node.y } : null;
      }).filter(Boolean);
      if (!items.some((it) => it.id === n.id)) {
        items.push({ id: n.id, ox: n.x, oy: n.y });
      }
      dragging = { id: n.id, mx: ev.clientX, my: ev.clientY, items };
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

  function clearNestHoverPreview() {
    if (!nestHoverGroupId) {
      world.querySelectorAll("g.node.node-drop-target").forEach((g) => {
        g.classList.remove("node-drop-target");
        const rect = g.querySelector(":scope > rect");
        if (rect) {
          rect.removeAttribute("data-nest-ow");
          rect.removeAttribute("data-nest-oh");
        }
      });
      return;
    }
    world.querySelectorAll("g.node.node-drop-target").forEach((g) => {
      g.classList.remove("node-drop-target");
      const rect = g.querySelector(":scope > rect");
      if (rect && rect.hasAttribute("data-nest-ow")) {
        rect.setAttribute("width", rect.getAttribute("data-nest-ow"));
        rect.setAttribute("height", rect.getAttribute("data-nest-oh"));
        rect.removeAttribute("data-nest-ow");
        rect.removeAttribute("data-nest-oh");
      }
    });
    nestHoverGroupId = null;
  }

  function updateNestHoverPreview(primary, exclude) {
    if (!primary || !dragMoved) {
      clearNestHoverPreview();
      return;
    }
    const sz = sizeOf(primary);
    const hit = groupAtWorldInScope(primary.x + sz.w / 2, primary.y + sz.h / 2, exclude);
    const canNest = hit && canMoveIntoGroup(primary, hit.id);
    const nextId = canNest ? hit.id : null;
    if (nextId === nestHoverGroupId) return;

    clearNestHoverPreview();
    if (!nextId) return;

    nestHoverGroupId = nextId;
    const gEl = world.querySelector(`g.node[data-id="${CSS.escape(nextId)}"]`);
    if (!gEl) return;
    gEl.classList.add("node-drop-target");
    const rect = gEl.querySelector(":scope > rect");
    if (rect) {
      const ow = parseFloat(rect.getAttribute("width") || "0");
      const oh = parseFloat(rect.getAttribute("height") || "0");
      rect.setAttribute("data-nest-ow", String(ow));
      rect.setAttribute("data-nest-oh", String(oh));
      // Expand ~18% so the drop-into-parent intent is obvious.
      rect.setAttribute("width", String(Math.round(ow * 1.18)));
      rect.setAttribute("height", String(Math.round(oh * 1.28)));
    }
    setStatus(t("editor.status.nestHover", { title: hit.title || "گروه" }), "info");
  }

  function moveDraggedNode(ev) {
    if (!dragging) return;
    const z = graph.viewport.zoom || 1;
    const dx = (ev.clientX - dragging.mx) / z;
    const dy = (ev.clientY - dragging.my) / z;
    if (!dragMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragMoved = true;
    if (!dragMoved) return;
    const items = Array.isArray(dragging.items) && dragging.items.length
      ? dragging.items
      : [{ id: dragging.id, ox: dragging.ox, oy: dragging.oy }];
    let primary = null;
    const exclude = new Set(items.map((it) => it.id));
    items.forEach((it) => {
      const n = nodeById(it.id);
      if (!n) return;
      n.x = it.ox + dx;
      n.y = it.oy + dy;
      const g = world.querySelector(`g.node[data-id="${CSS.escape(it.id)}"]`);
      if (g) {
        g.setAttribute("transform", `translate(${n.x},${n.y})`);
        g.classList.toggle("node-nest-dragging", true);
      }
      if (it.id === dragging.id) primary = n;
    });
    redrawEdgesOnly();
    if (primary) {
      ensureNodeInScrollView(primary);
      updateNestHoverPreview(primary, exclude);
    }
  }

  function finishNodeDragDrop() {
    if (!dragging || !dragMoved) return false;
    const items = Array.isArray(dragging.items) && dragging.items.length
      ? dragging.items
      : [{ id: dragging.id }];
    const primary = nodeById(dragging.id);
    if (!primary) return false;
    const exclude = new Set(items.map((it) => it.id));
    const sz = sizeOf(primary);
    const hit = groupAtWorldInScope(primary.x + sz.w / 2, primary.y + sz.h / 2, exclude);
    clearNestHoverPreview();
    items.forEach((it) => {
      const g = world.querySelector(`g.node[data-id="${CSS.escape(it.id)}"]`);
      if (g) g.classList.remove("node-nest-dragging");
    });
    if (hit) {
      const movers = items
        .map((it) => nodeById(it.id))
        .filter((n) => canMoveIntoGroup(n, hit.id));
      if (movers.length && moveNodesIntoGroup(movers, hit.id)) {
        dragging = panning = marquee = null;
        dragMoved = false;
        openGroup(hit.id);
        setStatus(
          movers.length > 1
            ? `${movers.length} المان به داخل «${hit.title || "گروه"}» منتقل شد.`
            : `به داخل «${hit.title || "گروه"}» منتقل شد.`,
          "success"
        );
        return true;
      }
    }
    applyVp();
    if (primary) ensureNodeInScrollView(primary);
    render();
    return false;
  }

  function ensureMarqueeRect() {
    let r = world.querySelector("rect.flow-marquee");
    if (!r) {
      r = el("rect", {
        class: "flow-marquee",
        fill: "rgba(0, 207, 232, 0.12)",
        stroke: "#00cfe8",
        "stroke-width": "1.2",
        "stroke-dasharray": "5 4",
        "pointer-events": "none"
      });
      world.appendChild(r);
    }
    return r;
  }

  function updateMarqueeRect() {
    if (!marquee) return;
    const r = ensureMarqueeRect();
    const x = Math.min(marquee.x0, marquee.x1);
    const y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0);
    const h = Math.abs(marquee.y1 - marquee.y0);
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.removeAttribute("hidden");
  }

  function clearMarqueeRect() {
    const r = world.querySelector("rect.flow-marquee");
    if (r) r.remove();
    marquee = null;
  }

  function applyMarqueeSelection() {
    if (!marquee) return;
    const x1 = Math.min(marquee.x0, marquee.x1);
    const y1 = Math.min(marquee.y0, marquee.y1);
    const x2 = Math.max(marquee.x0, marquee.x1);
    const y2 = Math.max(marquee.y0, marquee.y1);
    const hits = scopedNodes().filter((n) => {
      const s = sizeOf(n);
      const nx2 = n.x + s.w;
      const ny2 = n.y + s.h;
      return n.x < x2 && nx2 > x1 && n.y < y2 && ny2 > y1;
    });
    selectedEdgeId = null;
    if (!marquee.additive) selected.clear();
    hits.forEach((n) => selected.add(n.id));
    if (!selected.size && hits.length === 0 && !marquee.additive) {
      // empty marquee clears
    }
    updatePlaySelectionBtn();
    highlightSelection();
    redrawEdgesOnly();
    renderInspector();
  }

  function redrawEdgesOnly() {
    [...world.querySelectorAll("path:not(.link-preview), circle.edge-tip, circle.edge-tip-hit, polygon.edge-tip")].forEach((p) => p.remove());
    scopedEdges().forEach(drawEdge);
    // Nodes (ports) above tip hits
    world.querySelectorAll("g.node").forEach((g) => world.appendChild(g));
    raiseEdgeTipsUnderNodes();
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
    const onEmpty = ev.target === svg || ev.target === wrap || onScrollChrome
      || (ev.target.tagName === "rect" && !ev.target.closest("g.node") && !ev.target.classList?.contains("flow-marquee"));
    if (!onEmpty) return;

    // Middle-button or Space+Left → pan (scroll)
    if (ev.button === 1 || (ev.button === 0 && spacePanHeld)) {
      ev.preventDefault();
      panning = {
        sl: canvasScroll.scrollLeft,
        st: canvasScroll.scrollTop,
        mx: ev.clientX,
        my: ev.clientY
      };
      marquee = null;
      return;
    }

    if (ev.button !== 0) return;

    // Left-drag on empty canvas → marquee select
    const wpt = clientToWorld(ev.clientX, ev.clientY);
    marquee = {
      x0: wpt.x,
      y0: wpt.y,
      x1: wpt.x,
      y1: wpt.y,
      additive: !!(ev.shiftKey || ev.ctrlKey || ev.metaKey),
      moved: false
    };
    panning = null;
    if (!marquee.additive) {
      selected.clear();
      selectedEdgeId = null;
      updatePlaySelectionBtn();
      highlightSelection();
      redrawEdgesOnly();
      renderInspector();
    }
    updateMarqueeRect();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space" && !ev.repeat && !ev.target.closest?.("input,textarea,select,[contenteditable]")) {
      spacePanHeld = true;
      wrap.classList.add("space-pan");
      ev.preventDefault();
    }
  });
  wrap.addEventListener("auxclick", (ev) => {
    if (ev.button === 1) ev.preventDefault();
  });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") {
      spacePanHeld = false;
      wrap.classList.remove("space-pan");
    }
  });
  window.addEventListener("blur", () => {
    spacePanHeld = false;
    wrap.classList.remove("space-pan");
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
    } else if (marquee) {
      const wpt = clientToWorld(ev.clientX, ev.clientY);
      marquee.x1 = wpt.x;
      marquee.y1 = wpt.y;
      if (Math.abs(marquee.x1 - marquee.x0) > 3 || Math.abs(marquee.y1 - marquee.y0) > 3) {
        marquee.moved = true;
      }
      updateMarqueeRect();
    } else if (panning) {
      canvasScroll.scrollLeft = panning.sl - (ev.clientX - panning.mx);
      canvasScroll.scrollTop = panning.st - (ev.clientY - panning.my);
    }
  });
  window.addEventListener("pointerup", (ev) => {
    if (onLinkPointerUp(ev)) return;
    if (marquee) {
      if (marquee.moved) applyMarqueeSelection();
      clearMarqueeRect();
      dragging = panning = null;
      dragMoved = false;
      return;
    }
    if (dragging && dragMoved) {
      if (finishNodeDragDrop()) return;
    }
    clearNestHoverPreview();
    if (dragging) {
      world.querySelectorAll("g.node.node-nest-dragging").forEach((g) => g.classList.remove("node-nest-dragging"));
    }
    dragging = panning = null;
    dragMoved = false;
  });
  // Keep legacy mouse handlers for node drag started via mousedown on nodes
  window.addEventListener("mousemove", (ev) => {
    if (onLinkPointerMove(ev)) return;
    if (dragging) {
      moveDraggedNode(ev);
    } else if (marquee) {
      const wpt = clientToWorld(ev.clientX, ev.clientY);
      marquee.x1 = wpt.x;
      marquee.y1 = wpt.y;
      if (Math.abs(marquee.x1 - marquee.x0) > 3 || Math.abs(marquee.y1 - marquee.y0) > 3) {
        marquee.moved = true;
      }
      updateMarqueeRect();
    } else if (panning) {
      canvasScroll.scrollLeft = panning.sl - (ev.clientX - panning.mx);
      canvasScroll.scrollTop = panning.st - (ev.clientY - panning.my);
    }
  });
  window.addEventListener("mouseup", (ev) => {
    if (onLinkPointerUp(ev)) return;
    if (marquee) {
      if (marquee.moved) applyMarqueeSelection();
      clearMarqueeRect();
      dragging = panning = null;
      dragMoved = false;
      return;
    }
    if (dragging && dragMoved) {
      if (finishNodeDragDrop()) return;
    }
    clearNestHoverPreview();
    if (dragging) {
      world.querySelectorAll("g.node.node-nest-dragging").forEach((g) => g.classList.remove("node-nest-dragging"));
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
  const btnRenameProcess = document.getElementById("btn-rename-process");
  if (btnRenameProcess) {
    btnRenameProcess.hidden = !canModify;
    btnRenameProcess.addEventListener("click", () => renameProcessTitle());
  }
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
