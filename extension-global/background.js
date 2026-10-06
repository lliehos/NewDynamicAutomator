importScripts("lib/branding.js", "lib/session-scope.js", "lib/alert-dialog.js", "player/action-specs.js", "player/engine.js", "bg-selector.js");

/** Morobot Global extension — record, play, and selector in one package. */
const DEFAULT_PORTAL = "https://localhost:7201";

/**
 * Server binding (\"اثر انگشت سرور\") — why this exists.
 *
 * One machine can carry several installations of this extension: one for the local server, one for
 * a remote or a second tenant. Their content scripts are BOTH injected into EVERY http(s) page, so
 * without an identity check the wrong extension answers a portal it does not belong to: it marks
 * the page as connected and starts a run against ITS server, with the user looking at the other.
 *
 * The extension is bound to one deployment by `morobot-binding.json`, written into its install
 * folder by the server that synced it, and the server proves the same identity on
 * `/extension/fingerprint`. The fingerprint is the deployment instance id hashed with the
 * AppInstanceKey — unique per deployment even when two of them share a machine.
 *
 * No binding file (an older or hand-built bundle) means the old behaviour: no fingerprint checks.
 */
const DEPLOYMENT_BINDING_FILE = "morobot-binding.json";
let deploymentBinding = null;
let deploymentBindingLoaded = false;
let deploymentBindingPromise = null;

/** Load (once) the binding written into this bundle's install folder. */
async function ensureDeploymentBinding() {
  if (deploymentBindingLoaded) return deploymentBinding;
  if (deploymentBindingPromise) return deploymentBindingPromise;
  deploymentBindingPromise = (async () => {
    try {
      const res = await fetch(chrome.runtime.getURL(DEPLOYMENT_BINDING_FILE), { cache: "no-store" });
      if (res.ok) {
        const doc = await res.json();
        if (doc && doc.v === 1 && typeof doc.fingerprint === "string" && doc.fingerprint) {
          deploymentBinding = {
            appInstanceKey: String(doc.appInstanceKey || ""),
            instanceId: String(doc.instanceId || ""),
            fingerprint: doc.fingerprint
          };
          await chrome.storage.local.set({ extensionBinding: deploymentBinding }).catch(() => {});
        }
      }
    } catch { /* no binding file: legacy behaviour */ }
    deploymentBindingLoaded = true;
    return deploymentBinding;
  })();
  return deploymentBindingPromise;
}
ensureDeploymentBinding();

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (globalThis.DaSessionScope && DaSessionScope.normalizeBase) {
    const viaScope = DaSessionScope.normalizeBase(raw);
    if (viaScope) return viaScope;
  }
  try { return new URL(raw).origin; } catch { return ""; }
}

/**
 * Ask one origin what deployment it is.
 * Returns { fingerprint } on success, { missing: true } when the endpoint is absent (an older
 * server), or { unknown: true } when the origin could not be asked at all.
 */
async function fetchOriginFingerprint(origin) {
  const base = normalizeOrigin(origin);
  if (!base) return { unknown: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}/extension/fingerprint`, { cache: "no-store", signal: ctrl.signal });
    if (res.status === 404) return { missing: true };
    if (!res.ok) return { unknown: true };
    const doc = await res.json();
    return doc && doc.fingerprint ? { fingerprint: String(doc.fingerprint) } : { unknown: true };
  } catch {
    return { unknown: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Per-origin verification results, so the hot request path stays a map lookup. */
const originBindingCache = new Map();

/**
 * Compare an origin against this bundle's binding.
 *   match true  → same deployment
 *   match false → a DIFFERENT deployment (must never be used)
 *   match null  → not verifiable (unreachable, or the server predates the endpoint)
 */
async function verifyOriginAgainstBinding(origin) {
  const base = normalizeOrigin(origin);
  const binding = await ensureDeploymentBinding();
  if (!binding) return { match: null, legacy: true };
  if (!base) return { match: null };
  const cached = originBindingCache.get(base);
  if (cached && Date.now() - cached.checkedAt < 60000) {
    return { match: cached.match, fingerprint: cached.fingerprint, serverLacksFingerprint: cached.serverLacksFingerprint };
  }
  const probed = await fetchOriginFingerprint(base);
  const match = probed.fingerprint ? (probed.fingerprint === binding.fingerprint) : null;
  const entry = {
    match,
    fingerprint: probed.fingerprint || null,
    serverLacksFingerprint: probed.missing === true,
    checkedAt: Date.now()
  };
  originBindingCache.set(base, entry);
  return entry;
}

/**
 * Guard one base URL with the binding: a base that belongs to ANOTHER deployment is never used;
 * the last origin that proved itself wins instead. Unverifiable never blocks (that is a network
 * problem, not a mismatch).
 */
async function guardBaseAgainstBinding(base, verifiedOrigin) {
  const binding = await ensureDeploymentBinding();
  if (!binding) return base;
  const normalized = normalizeOrigin(base);
  if (!normalized) return base;
  const verified = normalizeOrigin(verifiedOrigin);
  if (verified && verified === normalized) return base;
  const result = await verifyOriginAgainstBinding(normalized);
  if (result.match === false && verified) return verified;
  return base;
}

/**
 * Engine-generated messages (e.g. node validation reports) follow the portal language.
 * portal-bridge.js writes chrome.storage.uiCulture whenever the portal language changes.
 */
async function syncEngineCulture() {
  try {
    const { uiCulture } = await chrome.storage.local.get("uiCulture");
    if (typeof setPlayCulture === "function") setPlayCulture(uiCulture);
  } catch { /* ignore */ }
}
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.uiCulture && typeof setPlayCulture === "function") {
      setPlayCulture(changes.uiCulture.newValue);
    }
    // Drive the dev poll from the RUN state rather than from each start/stop call site.
    //
    // `recording` and `playing` are the single source of truth for "a run is in progress", and
    // every path that begins or ends one already writes them — the engine, the FAB, the portal,
    // and the resume-after-reload logic. Hooking the storage event therefore covers all of them at
    // once, including the paths that are easy to forget (a crash teardown, a tab close, a stop
    // issued from a different tab). A call-site-by-call-site approach would have missed the ones
    // that matter most: the abnormal exits.
    if (area === "local" && (changes.recording || changes.playing)) {
      chrome.storage.local.get(["recording", "playing"])
        .then(({ recording, playing }) => {
          if (recording || playing) suspendDevPoll();
          else resumeDevPoll();
        })
        .catch(() => { /* storage gone: leave the poll as it is rather than guess */ });
    }
  });
} catch { /* ignore */ }
syncEngineCulture();

/**
 * The portal origin this extension is currently pointed at.
 *
 * Prefers a live session's own bound server over the shared `portalBase` value.
 *
 * `portalBase` is one key in `chrome.storage.local`, shared by every tab, and both
 * `content/portal-bridge.js` and the token lookup write to it. With a local server and a remote one
 * both open they overwrite each other, so a request made for a recording could be sent to whichever
 * portal happened to be loaded last — showing up as "the session does not exist" or a stray 401.
 *
 * Resolving a live session's own base first closes that hole for every caller at once, which is why
 * the preference lives here rather than at each of the ~25 request sites: a site that forgets to opt
 * in would silently keep the old, broken behaviour.
 */
async function portalBase() {
  const { portalBase, bindingVerifiedOrigin } = await chrome.storage.local.get(["portalBase", "bindingVerifiedOrigin"]);
  const globalBase = portalBase || DEFAULT_PORTAL;
  if (globalThis.DaSessionScope) {
    try {
      // A recording outranks a play: a play can be started from the recorder's own portal, and while
      // recording is in progress every request still belongs to that recording's server.
      const bound = await DaSessionScope.recordPortalBase() || await DaSessionScope.playPortalBase();
      if (bound) return bound;
    } catch { /* fall through to the global value */ }
  }
  // Fingerprint guard: when this bundle is bound to a deployment, a stored base that belongs to a
  // DIFFERENT deployment is repointed to the origin that proved itself. See guardBaseAgainstBinding.
  return guardBaseAgainstBinding(globalBase, bindingVerifiedOrigin);
}

/** All server calls go to the portal origin. */
async function apiBase() {
  return portalBase();
}

/**
 * The base URL for a request, honouring the session that owns it.
 *
 * `portalBase` is shared state that any portal tab can overwrite, so a request belonging to a
 * recording must not read it directly: with a local server and a remote one both open, the value at
 * the moment of the call may belong to the other one. When `kind` names a live session the base
 * bound to that session wins, and the global value is only a fallback for requests with no session.
 */
async function baseFor(kind) {
  const globalBase = await portalBase();
  if (globalThis.DaSessionScope) {
    return DaSessionScope.resolveBase(kind, globalBase);
  }
  return globalBase;
}

/**
 * Resolve the auth token, optionally pinned to one origin.
 *
 * The cookie lookup order used to be `portal` followed by a hardcoded list of local ports, and the
 * first hit won. When both a local and a remote portal are signed in, that could return the LOCAL
 * cookie for a request aimed at the server — a 401 that looks like broken auth rather than a
 * misrouted request. `origin` restricts the search to the one host that request actually targets.
 *
 * The write to `portalBase`/`apiBase` is also gone from here. This function runs in the middle of
 * other requests, and updating global routing as a side effect of fetching a token is what let a
 * single call silently repoint the whole extension at a different server.
 */
async function resolveAccessToken(origin) {
  const wanted = String(origin || "").trim();
  const known = [
    "https://localhost:7801",
    "http://localhost:7800",
    "https://localhost:7701",
    "http://localhost:7700",
    "https://localhost:7601",
    "http://localhost:7600",
    "https://localhost:7501",
    "http://localhost:7500",
    "https://localhost:7401",
    "http://localhost:7400",
    "https://localhost:7201",
    "http://localhost:7200",
    "https://localhost/",
    "http://localhost/"
  ];
  // A pinned origin is searched first and, on a hit, is the only one used — the whole point is to
  // stop a cookie from a different server satisfying this request.
  const urls = wanted ? [wanted] : [await portalBase(), ...known];

  for (const url of urls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "da_access" });
      if (cookie?.value) {
        await chrome.storage.local.set({
          token: cookie.value,
          // Record which server issued the token, so `tokenForOrigin` can refuse to hand a local
          // token to a remote request. Without this the token key has the same cross-server leak as
          // `portalBase` had.
          tokenPortalBase: new URL(url).origin
        });
        return cookie.value;
      }
    } catch {
      /* try next */
    }
  }

  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

async function authHeaders(kind) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const base = await baseFor(kind);
  let access = await resolveAccessToken(base);
  // Drop a token that belongs to a different portal, so a stale credential from the other server is
  // not sent (and the request is not rejected as an auth failure it never was).
  if (access && globalThis.DaSessionScope) {
    const scoped = await DaSessionScope.tokenForOrigin(kind, base,
      await chrome.storage.local.get(["recordToken", "playToken", "token", "tokenPortalBase"]));
    access = scoped;
  }
  if (access) headers.Authorization = `Bearer ${access}`;
  return headers;
}

/** Server canvas is authoritative for numeric process ids. */
async function fetchCanvasFromServer(taskId) {
  const id = String(taskId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  const portal = String(await portalBase()).replace(/\/$/, "");
  try {
    const res = await fetch(`${portal}/api/tasks/${id}/canvas`, {
      method: "GET",
      headers: await authHeaders()
    });
    if (res.status === 401 || res.status === 403) return { error: "auth" };
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !(data.nodes || data.Nodes)) return null;
    return {
      taskId: Number(id),
      title: data.title || data.Title,
      nodes: data.nodes || data.Nodes || [],
      edges: data.edges || data.Edges || [],
      viewport: data.viewport || data.Viewport,
      dataSources: data.dataSources || data.DataSources || [],
      designOrigin: data.designOrigin || data.DesignOrigin,
      stepDelayMs: data.stepDelayMs,
      highlightColor: data.highlightColor,
      ignorePlayError: data.ignorePlayError,
      repeatSourceType: data.repeatSourceType,
      updatedAtUtc: data.updatedAtUtc || data.UpdatedAtUtc || null
    };
  } catch {
    return null;
  }
}

async function refreshTaskCacheFromServer(taskId, titleHint) {
  const id = normalizeTaskId(taskId);
  if (!id) return false;
  const graph = await fetchCanvasFromServer(id);
  if (!graph || graph.error) return false;
  const nodes = graph.nodes || [];
  const tasks = await loadUserTasks();
  const idx = findTaskIndex(tasks, id);
  const item = {
    ...(idx >= 0 ? tasks[idx] : {}),
    id,
    title: titleHint || graph.title || tasks[idx]?.title || `#${id}`,
    designOrigin: graph.designOrigin || tasks[idx]?.designOrigin || "Recorded",
    stepCount: nodes.filter((n) => n.kind === "action" || n.kind === "step").length,
    groupCount: nodes.filter((n) => n.kind === "group").length,
    dataSourceCount: Array.isArray(graph.dataSources) ? graph.dataSources.length : 0,
    graph,
    updatedAtUtc: graph.updatedAtUtc || null
  };
  if (idx >= 0) tasks[idx] = item;
  else tasks.push(item);
  await saveUserTasks(tasks);
  await pushTasksToPortalTabs(tasks).catch(() => false);
  return true;
}

/** Server-backed tasks (numeric id): editor reads PUT /canvas — local cache alone is not enough. */
async function persistCanvasToServer(taskId, graph, title) {
  const id = String(taskId ?? "").trim();
  if (!/^\d+$/.test(id) || !graph || typeof graph !== "object") {
    return { ok: true, skipped: true };
  }
  const portal = String(await portalBase()).replace(/\/$/, "");
  const payload = JSON.parse(JSON.stringify(graph));
  payload.taskId = Number(id);
  if (title) payload.title = title;
  delete payload.updatedAtUtc;
  delete payload.baseUpdatedAtUtc;
  delete payload.editorSessionId;
  try {
    const res = await fetch(`${portal}/api/tasks/${id}/canvas`, {
      method: "PUT",
      headers: await authHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.message || err.Message || `canvas ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, updatedAtUtc: body.updatedAtUtc || body.UpdatedAtUtc || null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "getState":
      return getState();
    case "toggleRecord":
      // legacy: if recording → finish; else → start
      return (await getState()).recording ? finishRecord() : startRecordSession(message);
    case "clearDraft":
      return discardRecord();
    case "saveDraft":
      return saveDraft(message.payload);
    case "saveMemoryDraft":
      return saveMemoryDraft(message.payload);
    case "session":
      return checkSession();
    case "syncPortalSession":
      return syncPortalSession();
    case "getBinding":
      return { ok: true, binding: await ensureDeploymentBinding() };
    case "confirmPortalOrigin": {
      // Called by portal-bridge on every portal page. This is where ownership is decided: a portal
      // of a DIFFERENT deployment is refused outright (the content script then leaves the page
      // unmarked and stamps `daExtensionForeign` so the panel can explain), while a matching portal
      // — or a server too old to expose a fingerprint — may adopt this extension and becomes the
      // stored base. In-session bases are left alone, exactly like the old content-script write.
      const origin = normalizeOrigin(message.origin) || String(message.origin || "");
      const result = await verifyOriginAgainstBinding(origin);
      const bindingFingerprint = (await ensureDeploymentBinding())?.fingerprint || null;
      if (result.match === false) {
        return {
          ok: true,
          match: false,
          foreign: true,
          bindingFingerprint
        };
      }
      if (result.match === null && result.legacy !== true && result.serverLacksFingerprint !== true) {
        // The server HAS an identity and did not answer its own probe. Two very different causes
        // hide behind that silence — it is unreachable, or its TLS certificate is not trusted on
        // this machine, which blocks an extension fetch outright: the browser's "Proceed"
        // interstitial covers navigations only, never a background fetch. The page has to be able
        // to say so, instead of sending the user to install an extension that is already installed
        // and already bound to this very server.
        return { ok: true, match: null, probeFailed: true, bindingFingerprint };
      }
      const { recording, playing } = await chrome.storage.local.get(["recording", "playing"]);
      const patch = { bindingVerifiedOrigin: origin };
      if (!recording && !playing) {
        patch.portalBase = origin;
        patch.apiBase = origin;
      }
      await chrome.storage.local.set(patch).catch(() => {});
      return {
        ok: true,
        match: result.match === true ? true : null,
        legacy: result.legacy === true || result.serverLacksFingerprint === true,
        bindingFingerprint
      };
    }
    case "recordedEvent":
      return onRecordedEvent(message.payload, sender);
    case "describeChildIframe":
      return null;
    case "listTasks":
      return listTasks();
    case "getLocalTasks":
      return listTasks();
    case "listOpenTabs":
      return listOpenTabs();
    case "getTaskGraph":
      return getLocalTaskGraph(message.taskId);
    case "startPlay":
      return startPlayWithAutoReload(message, sender);
    case "stopPlay":
      return stopPlay();
    case "pausePlay":
      return pausePlay();
    case "resumePlay":
      return resumePlay();
    case "getPlayState":
      return getPlayStatus();
    case "clearPlayLogs":
      return clearPlayLogs();
    // The Player HUD re-mounts itself on every page load of its tab — a run often ends with a
    // click that reloads the page, and the fresh document would otherwise look like "no session"
    // and the HUD would vanish. It asks which tab owns the open play session; the marker is
    // cleared only by closing the HUD by hand or by closing the tab — the owner's rule.
    case "playSessionHere": {
      const { playSessionTabId } = await chrome.storage.local.get("playSessionTabId");
      return { ok: true, here: playSessionTabId != null && sender?.tab?.id === Number(playSessionTabId) };
    }
    case "closePlayHud": {
      const { playSessionTabId } = await chrome.storage.local.get("playSessionTabId");
      if (playSessionTabId != null && sender?.tab?.id === Number(playSessionTabId)) {
        await chrome.storage.local.remove("playSessionTabId");
      }
      return { ok: true };
    }
    // AlertAccept's three calls. The Player cannot answer a browser dialog from inside the page
    // (a dialog blocks the page's own script), so it asks the extension to do it — see
    // lib/alert-dialog.js for why the answer is pre-set rather than decided on the fly.
    case "armAlertDialog":
      return MorobotAlerts.armAlertDialog(message.tabId, message.alertType);
    case "setAlertAnswer":
      return MorobotAlerts.setAlertAnswer(message.tabId, message.alertType, message.alertPromptText);
    case "readAlertResult":
      return MorobotAlerts.readAlertResult(message.tabId);
    case "persistPlayDataSources":
      return persistPlayDataSourcesMessage(message);
    case "readDataSourceCell":
      return readDataSourceCellMessage(message);
    case "readDataSourceMeta":
      return readDataSourceMetaMessage(message);
    case "readDataSourceRow":
      return readDataSourceRowMessage(message);
    case "readDataSourceRows":
      return readDataSourceRowsMessage(message);
    case "patchDataSourceCell":
      return patchDataSourceCellMessage(message);
    case "deleteDataSourceRow":
      return deleteDataSourceRowMessage(message);
    case "insertDataSourceRow":
      return insertDataSourceRowMessage(message);
    case "broadcastDsCellEvent":
      return broadcastDsCellEventMessage(message);
    case "reloadPlayerNow":
      return reloadPlayerNow(message.pendingPlay || null);
    case "getCopiedSelector":
      return getCopiedSelector();
    case "setCopiedSelector":
      return setCopiedSelector(message.payload, message.text);
    case "clearCopiedSelector":
      await chrome.storage.local.remove(["copiedSelector", "copiedSelectorText", "copiedMode"]);
      return { ok: true };
    case "devtoolsCopy":
      return handleDevtoolsCopy(message);
    case "ping":
      return {
        ok: true,
        role: "global",
        version: chrome.runtime.getManifest().version,
        ...(await getCopiedSelectorPreview())
      };
    case "startRecordSession":
      return startRecordSession(message);
    case "finishRecord":
      return finishRecord();
    case "discardRecord":
      return discardRecord({ closeTab: message.closeTab !== false });
    case "resumeRecord":
      return resumeRecord();
    case "syncTasksFromPortal":
      return syncTasksFromPortal(message);
    case "applyTenantBranding":
      await DaTenantBranding.persist(DaTenantBranding.normalize(message.payload || message.branding));
      return { ok: true };
    case "setRecordOptions":
      return setRecordOptions(message.options);
    case "rerecord":
      return resumeRecord();
    default:
      return { ok: false, error: "unknown" };
  }
}

async function broadcastRecordState() {
  const state = await getState();
  const payload = {
    type: "recordingChanged",
    recording: state.recording,
    recordPhase: state.recordPhase,
    count: state.count,
    steps: state.steps,
    options: state.options,
    targetTaskId: state.targetTaskId,
    targetTitle: state.targetTitle
  };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  chrome.runtime.sendMessage(payload).catch(() => {});
  return state;
}

async function broadcastDraftUpdated() {
  const state = await getState();
  const payload = {
    type: "draftUpdated",
    recording: state.recording,
    recordPhase: state.recordPhase,
    count: state.count,
    steps: state.steps
  };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  chrome.runtime.sendMessage(payload).catch(() => {});
  return state;
}

function defaultRecordOptions(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    trackInputClicks: !!src.trackInputClicks,
    trackMouse: src.trackMouse !== false
  };
}

async function setRecordOptions(options) {
  const next = defaultRecordOptions(options);
  await chrome.storage.local.set({ recordOptions: next });
  const tabs = await chrome.tabs.query({});
  const msg = { type: "recordOptionsChanged", options: next };
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
  return { ok: true, options: next };
}

function currentStepsFromStorage(recordingGroups, draft) {
  const groups = Array.isArray(recordingGroups) ? recordingGroups : [];
  const flat = flattenGroupSteps(groups);
  if (flat.length) return flat;
  return Array.isArray(draft) ? draft.slice() : [];
}

async function isPortalTabUrl(url) {
  if (!url) return false;
  const portal = await portalBase();
  try {
    if (url.startsWith(portal)) return true;
  } catch {
    /* ignore */
  }
  return /:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

async function listOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const items = [];
  for (const t of tabs) {
    if (!t.id) continue;
    const url = t.url || t.pendingUrl || "";
    const isNewBlank =
      !url
      || url === "about:blank"
      || /^chrome:\/\/(newtab|new-tab-page)/i.test(url)
      || /^edge:\/\/(newtab|new-tab-page)/i.test(url);
    if (
      !isNewBlank
      && (
        url.startsWith("chrome://")
        || url.startsWith("chrome-extension://")
        || url.startsWith("edge://")
        || url.startsWith("devtools://")
      )
    ) {
      continue;
    }
    const portal = !isNewBlank && (await isPortalTabUrl(url));
    const title = isNewBlank
      ? (t.title && t.title !== "New Tab" && t.title !== "برگهٔ جدید" ? t.title : "تب جدید / خالی")
      : (t.title || "بدون عنوان");
    items.push({
      id: t.id,
      title: String(title).slice(0, 80),
      url: (url || "about:blank").slice(0, 220),
      active: !!t.active,
      windowId: t.windowId,
      isPortal: !!portal,
      isBlank: !!isNewBlank
    });
  }
  // Prefer non-portal tabs first; active tabs near the top within each group.
  items.sort((a, b) => {
    if (a.isPortal !== b.isPortal) return a.isPortal ? 1 : -1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return 0;
  });
  return { ok: true, tabs: items };
}

/**
 * The process id encoded in an editor URL, or "" when the URL is not an editor route.
 *
 * The editor route is /Panel/Tasks/Editor/{id}; the id is read from the URL so a caller knows which
 * process it is talking to.
 */
function editorTaskIdFromUrl(url) {
  const m = /\/Panel\/Tasks\/Editor\/([^/?#]+)/i.exec(String(url || ""));
  return m ? decodeURIComponent(m[1]) : "";
}

/**
 * Every open flow-editor tab: `{ id, url, taskId }`.
 *
 * The editor holds the graph in memory, so a node can only be appended while that page is open.
 * Knowing them ALL — not just whether there is exactly one — is what lets the context menu offer
 * the open processes and lets the user pick the target instead of the extension refusing whenever
 * two diagrams happen to be open.
 */
async function listEditorTabs() {
  const portal = String(await portalBase()).replace(/\/$/, "");
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch { return []; }
  const editors = [];
  for (const t of tabs) {
    if (!t.id) continue;
    const url = t.url || t.pendingUrl || "";
    const taskId = editorTaskIdFromUrl(url);
    if (!taskId) continue;
    // Same portal only: a stale tab from another host must not be mistaken for the editor.
    if (portal && !url.startsWith(portal) && !/:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) continue;
    editors.push({ id: t.id, url, taskId });
  }
  return editors;
}

/**
 * Find the ONE flow-editor tab, or explain why there is not exactly one.
 *
 * Used as the fallback when the menu could not name a tab (no editor was open when it was built, or
 * the chosen one has since closed). Ambiguity is still refused rather than guessed at: appending to
 * the wrong process is a silent, wrong edit — the menu is the place where the user resolves it.
 */
async function findEditorTab() {
  const editors = await listEditorTabs();
  if (editors.length === 0) return { ok: false, reason: "no_editor" };
  if (editors.length > 1) return { ok: false, reason: "many_editors", count: editors.length };
  return { ok: true, tabId: editors[0].id, taskId: editors[0].taskId, url: editors[0].url };
}

let openTabsBroadcastTimer = null;function scheduleOpenTabsBroadcast(reason) {
  if (openTabsBroadcastTimer) clearTimeout(openTabsBroadcastTimer);
  openTabsBroadcastTimer = setTimeout(() => {
    openTabsBroadcastTimer = null;
    broadcastOpenTabsChanged(reason).catch(() => {});
  }, 180);
}

async function broadcastOpenTabsChanged(reason) {
  const list = await listOpenTabs();
  const payload = { type: "openTabsChanged", reason: reason || "update", tabs: list.tabs };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  }
  // Popup / other extension pages listening on runtime
  chrome.runtime.sendMessage(payload).catch(() => {});
  return list;
}

async function pullTasksFromPortalTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    const url = tab.url || "";
    if (!(await isPortalTabUrl(url))) continue;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "requestPortalTasks" });
      if (res?.ok && Array.isArray(res.tasks) && res.tasks.length) {
        if (res.user) await chrome.storage.local.set({ localUser: res.user });
        await saveUserTasks(res.tasks);
        return res.tasks;
      }
    } catch {
      /* tab may not have bridge yet */
    }
  }
  return null;
}

/** Portal pushes its task list into the extension before record/save. */
async function syncTasksFromPortal(message = {}) {
  const tasks = Array.isArray(message.tasks) ? message.tasks : null;
  if (!tasks || !tasks.length) {
    // Keep whatever we already have — empty push used to wipe a good session.
    const existing = await loadUserTasks();
    if (existing.length) {
      if (message.user) await chrome.storage.local.set({ localUser: String(message.user) });
      return { ok: true, count: existing.length, keptExisting: true };
    }
    return {
      ok: false,
      error: "لیست فرآیند از پورتال خالی است. صفحهٔ فرآیندها را رفرش کنید یا یک فرآیند بسازید."
    };
  }
  if (message.user) await chrome.storage.local.set({ localUser: String(message.user) });
  await saveUserTasks(tasks);
  return { ok: true, count: tasks.length };
}

function findTaskIndex(tasks, targetId) {
  if (targetId == null || targetId === "") return -1;
  const key = String(targetId);
  return (tasks || []).findIndex((t) => String(t.id) === key);
}

/** Process ids are UUID/string (not always numeric). Never Number()-coerce. */
function normalizeTaskId(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * Turn the reviewed steps into the `DAGRAPH1:` text the editor's paste handler understands.
 *
 * The editor does not read extension storage — it reads the OS clipboard, and it only accepts a
 * payload carrying the `DAGRAPH1:` prefix (see `parseRecordedGraph` in wwwroot/editor/flow.js). The
 * previous version of the copy action only wrote to `chrome.storage.local`, so it reported success
 * and then the paste said "there is no recorded process in memory": the two sides were never
 * talking about the same place.
 *
 * The graph is built in the same shape `saveDraft` merges — one group holding the steps — because
 * that is what the editor expects to receive, and reusing the merge keeps a copy and a save of the
 * same recording producing the same structure. What it must NOT be is a bag of nodes with no edges:
 * a node reaches its successors only through the edges between them, so a payload with an empty
 * `edges` array pastes as an isolated group plus free-floating actions that the player never runs.
 * The steps are therefore chained start → step → step → … in capture order.
 *
 * It runs in the service worker, which has no DOM and therefore cannot touch the clipboard itself;
 * the text is returned to the content script, which writes it while the click is still the active
 * gesture.
 */
function buildRecordedGraphText(steps, groupTitle, taskId, title) {
  const groupId = "group-1";
  const startId = "start-1";
  const endId = "end-1";

  // A single left-to-right column at a fixed pitch, the same readable starting arrangement the smart
  // recorder's factory produces. The editor lets the user drag nodes anywhere, so an exact layout is
  // not worth inferring — only one that does not stack every node on a single point.
  const X_START = 80;
  const X_PITCH = 240;
  const Y = 220;

  const nodes = [
    // The group is a real node, not just a label on its children: the editor draws it, and it is the
    // node the paste wires the scope's `contains` edges from. Leaving it out (which an earlier
    // version did) is why the pasted steps arrived with no group around them.
    { id: groupId, kind: "group", title: groupTitle, x: X_START, y: Y },
    { id: startId, kind: "start", title: groupTitle, x: X_START, y: Y, groupNodeId: groupId }
  ];
  const edges = [];

  let previous = startId;
  let x = X_START + X_PITCH;
  let seq = 0;

  steps.forEach((step, i) => {
    const id = step?.id || `step-${i + 1}`;
    const kind = step?.kind === "condition" ? "condition" : "action";
    nodes.push({
      ...step,
      id,
      kind,
      x,
      y: Y,
      groupNodeId: groupId
    });
    // Every step is entered from the previous one. A condition also needs a `success` branch below,
    // but it still needs this inbound edge to be reachable at all.
    edges.push({ id: `e${++seq}`, from: previous, to: id, kind: "next" });
    previous = id;
    x += X_PITCH;
  });

  nodes.push({ id: endId, kind: "end", title: "پایان", x, y: Y, groupNodeId: groupId });

  // A condition's `success` branch is what carries the flow onward. Wiring it to the end keeps the
  // graph runnable as recorded instead of stopping at the first check, and it matches capture order:
  // the steps that followed were performed after the condition passed. The `fail` branch is left
  // unwired, which the editor treats as a clean termination because an `end` is present.
  const last = steps[steps.length - 1];
  const lastIsCondition = !!last && last.kind === "condition";
  steps.forEach((step) => {
    if (!step || step.kind !== "condition") return;
    edges.push({ id: `e${++seq}`, from: step.id || "", to: endId, kind: "success" });
  });

  // Close the chain, unless a condition's success branch already closed it — a condition must not be
  // given both a `success` and a `next` edge, because having both would make the recorded order
  // ambiguous.
  if (!lastIsCondition) {
    edges.push({ id: `e${++seq}`, from: previous, to: endId, kind: "next" });
  }

  const graph = {
    taskId: taskId != null ? Number(taskId) || taskId : null,
    title: title || null,
    designOrigin: "Recorded",
    nodes,
    edges,
    viewport: { zoom: 1 },
    dataSources: [],
    repeatSourceType: "None"
  };

  return "DAGRAPH1:" + JSON.stringify(graph);
}

/**
 * Copy the reviewed steps to extension memory AND to the clipboard, without touching the process and
 * without asking for a name.
 *
 * This is the "copy to memory" action, and it is deliberately the mirror image of `saveDraft`:
 *
 * - `saveDraft` writes INTO the target process. It needs a group title because that title becomes a
 *   visible group node on the canvas, so it must ask.
 * - This one writes nothing to the process. The steps are parked in `chrome.storage.local` so they
 *   survive the tab, and the same payload is handed back as `DAGRAPH1:` text for the content script
 *   to place on the clipboard — which is the part the editor's paste actually reads.
 *
 * The stored payload is keyed by the target process so a paste on a different process cannot
 * silently pick up another process's recording.
 */
async function saveMemoryDraft(payload) {
  const { recordingGroups, draft, recordTargetTaskId, recordTargetTitle, recordOptions } =
    await chrome.storage.local.get([
      "recordingGroups", "draft", "recordTargetTaskId", "recordTargetTitle", "recordOptions"
    ]);

  let allSteps = currentStepsFromStorage(recordingGroups, draft);
  const indexes = Array.isArray(payload?.selectedIndexes) ? payload.selectedIndexes : null;
  if (indexes != null) {
    if (!indexes.length) {
      return { ok: false, error: "هیچ موردی برای ذخیره انتخاب نشده است." };
    }
    const pick = new Set(indexes.map(Number).filter((n) => Number.isFinite(n)));
    allSteps = allSteps.filter((_, i) => pick.has(i));
  }
  if (!allSteps.length) {
    return { ok: false, error: "هیچ موردی برای ذخیره انتخاب نشده است." };
  }

  const targetId = normalizeTaskId(payload?.taskId) || normalizeTaskId(recordTargetTaskId);
  const title = recordTargetTitle || (targetId ? `فرآیند #${targetId}` : null);

  // The group title is generated rather than asked for. It is not shown to the user here (nothing is
  // written to the canvas yet), but keeping it means the stored payload is already a valid group and
  // a later paste does not have to invent one.
  const groupTitle = (payload?.groupTitle || "").trim()
    || (title ? `گروه ضبط — ${title}` : "گروه ضبط");

  const memory = {
    taskId: targetId,
    title,
    groupTitle,
    steps: allSteps,
    options: defaultRecordOptions(recordOptions),
    at: new Date().toISOString()
  };

  // The text is what actually makes the paste work, so it is built here and returned for the
  // content script to write. It is also stored alongside the memory so the payload survives a tab
  // close and can be re-copied from the portal later.
  const text = buildRecordedGraphText(allSteps, groupTitle, targetId, title);
  memory.text = text;

  await chrome.storage.local.set({
    recordMemory: memory,
    recordMemoryAt: memory.at,
    recordMemoryTaskId: targetId,
    recordMemoryText: text
  });

  await broadcastDraftUpdated();
  return {
    ok: true,
    text,
    result: {
      taskId: targetId,
      groupTitle,
      stepCount: allSteps.length,
      title
    }
  };
}

async function startRecordSession(message = {}) {
  // Record ONLY appends into an existing portal process — never creates one.
  await checkSession();
  const { playing, recordOptions: prevOpts } = await chrome.storage.local.get(["playing", "recordOptions"]);
  if (playing) return { ok: false, error: "هنگام پخش نمی‌توان ضبط کرد." };

  await syncPortalSession().catch(() => {});

  const targetTaskId = normalizeTaskId(message.taskId);
  if (!targetTaskId) {
    return { ok: false, error: "ضبط فقط روی فرآیند موجود — از دکمهٔ ضبط همان فرآیند شروع کنید." };
  }

  // Prefer tasks just pushed from portal; otherwise pull.
  let tasks = await loadUserTasks();
  let existing = tasks.find((t) => String(t.id) === String(targetTaskId));
  if (!existing) {
    const pulled = await pullTasksFromPortalTabs().catch(() => null);
    if (pulled) tasks = pulled;
    existing = tasks.find((t) => String(t.id) === String(targetTaskId));
  }
  if (!existing) {
    return {
      ok: false,
      error: "فرآیند هدف در پورتال پیدا نشد. ضبط فرآیند جدید نمی‌سازد — فقط به فرآیند موجود اقدام اضافه می‌کند."
    };
  }

  const targetTitle = existing.title || message.taskTitle || `فرآیند #${targetTaskId}`;
  const recordingGroups = [{
    id: "group-1",
    title: message.groupTitle || "گروه ضبط",
    steps: []
  }];

  // Pin this recording to the portal it was started from, so a second portal opened later cannot
  // move the save onto a different server. The base is read now, while the record button's own
  // portal is still the one in context, and kept for the life of the session.
  if (globalThis.DaSessionScope) {
    const boundBase = await baseFor(null);
    await DaSessionScope.bindSession("record", boundBase, await resolveAccessToken(boundBase).catch(() => null));
  }

  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: [],
    recordingGroups,
    recordTabId: null,
    lastNavUrl: null,
    recordTargetTaskId: targetTaskId,
    recordTargetTitle: targetTitle,
    recordOptions: defaultRecordOptions(prevOpts)
  });

  // A recorder is now live: hold the dev poll off for the duration so it cannot wake the worker
  // (or queue a reload) while the recording is being driven. Resumed in finish/discard.
  suspendDevPoll();

  const requestedTabId = message.tabId != null && message.tabId !== ""
    ? Number(message.tabId)
    : null;
  let tab = null;
  let reused = false;

  if (requestedTabId && Number.isFinite(requestedTabId)) {
    try {
      tab = await chrome.tabs.get(requestedTabId);
      await chrome.tabs.update(requestedTabId, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      reused = true;
    } catch {
      await chrome.storage.local.set({ recording: false, recordPhase: "idle", recordingGroups: [], draft: [] });
      return { ok: false, error: "تب انتخاب‌شده پیدا نشد یا بسته شده است." };
    }
  } else {
    // Extension blank page — FAB loads immediately (about:blank cannot run content scripts).
    tab = await chrome.tabs.create({ url: chrome.runtime.getURL("blank.html"), active: true });
  }

  if (tab?.id) {
    await chrome.storage.local.set({ recordTabId: tab.id });
    const url = tab.url || tab.pendingUrl || "";
    if (reused && isTrackableNavUrl(url)) {
      await appendNavStep(url, tab.id);
    }
    // blank.html embeds FAB; inject again as safety for reused http(s) tabs.
    await injectRecordFab(tab.id).catch(() => false);
  }
  await broadcastRecordState();
  return {
    ok: true,
    tabId: tab?.id,
    startUrl: tab?.url || chrome.runtime.getURL("blank.html"),
    reused,
    groupCount: recordingGroups.length,
    targetTaskId,
    targetTitle
  };
}

/** Inject recorder HUD (+ capture scripts) into a tab — works on about:blank / http(s). */
async function injectRecordFab(tabId, attempt = 0) {
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = tab?.url || "";
    // blank.html already loads scripts via <script> tags.
    if (url.startsWith("chrome-extension://") && url.includes("/blank.html")) {
      await broadcastRecordState();
      return true;
    }
    // Mark page as recording BEFORE scripts so Player content-script skips its HUD.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { document.documentElement.dataset.daMorobotMode = "record"; }
    }).catch(() => {});
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles/fab.css"]
    }).catch(() => {});
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "lib/ext-i18n.js",
        "content/selector.js",
        "content/frames.js",
        "content/recorder.js",
        "content/fab-record.js"
      ]
    });
    await broadcastRecordState();
    return true;
  } catch (err) {
    if (attempt < 8) {
      await new Promise((r) => setTimeout(r, 100 + attempt * 50));
      return injectRecordFab(tabId, attempt + 1);
    }
    console.warn("[recorder] injectRecordFab failed", tabId, err?.message || err);
    return false;
  }
}

function flattenGroupSteps(groups) {
  return (groups || []).flatMap((g) => g.steps || []);
}

function countRecordedSteps(groups, draft) {
  const fromGroups = flattenGroupSteps(groups).length;
  if (fromGroups) return fromGroups;
  return Array.isArray(draft) ? draft.length : 0;
}

async function finishRecord() {
  const { recording, draft, recordingGroups } = await chrome.storage.local.get([
    "recording", "draft", "recordingGroups"
  ]);
  if (!recording && (await getState()).recordPhase !== "recording") {
    return { ok: false, error: "ضبطی در جریان نیست." };
  }
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "review"
  });
  // Recording is over, so the dev poll may run again (see suspendDevPoll).
  resumeDevPoll();
  const state = await broadcastRecordState();
  setTimeout(() => pollDevReload(), 400);
  return { ok: true, count: countRecordedSteps(recordingGroups, draft), ...state };
}

async function discardRecord(opts = {}) {
  const closeTab = opts.closeTab !== false;
  const { recordTabId } = await chrome.storage.local.get(["recordTabId"]);
  // The recording is gone, so its server binding goes with it. `finishRecord` deliberately does NOT
  // do this: finishing moves to review, and the save that follows still has to reach the portal the
  // recording was made against.
  if (globalThis.DaSessionScope) await DaSessionScope.unbindSession("record").catch(() => {});
  // Recording is over, so the dev poll may run again (see suspendDevPoll).
  resumeDevPoll();
  await chrome.storage.local.set({
    recording: false,
    recordPhase: "idle",
    draft: [],
    recordingGroups: [],
    recordTabId: null,
    lastNavUrl: null,
    recordTargetTaskId: null,
    recordTargetTitle: null
  });
  if (closeTab && recordTabId) {
    try { await chrome.tabs.remove(recordTabId); } catch { /* already closed */ }
  }
  const state = await broadcastRecordState();
  setTimeout(() => pollDevReload(), 400);
  return state;
}

/**
 * The recording tab went away — treat that as "the user is done".
 *
 * Closing the tab a recording runs in is the most natural way to say "stop", and it used to be
 * ignored: the `recording` flag lives in extension storage, so nothing cleared it when the tab
 * disappeared. The user then hit Play and was told to stop the recording first, with no recording
 * left on screen to stop — a dead end only a manual "discard" in the popup could escape.
 *
 * The leftover draft is dropped rather than promoted to "review": the tab is gone, so the user
 * cannot be looking at a review panel, and silently keeping a half-finished draft would leave the
 * same stale flag in place on the next start.
 *
 * `closeTab: false` is essential here — the tab is already gone, and asking chrome to close it
 * again would throw.
 */
async function handleRecordTabClosed(tabId) {
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || Number(recordTabId) !== Number(tabId)) return;
  // `discardRecord` already ends with `broadcastRecordState()`, which is the `recordingChanged`
  // message the portal and the FAB listen for — so the stop propagates without a second send.
  await discardRecord({ closeTab: false });
}

/**
 * The tab a PLAY was running in went away — stop the run.
 *
 * Play drives a real browser tab: every step acts on the page in it. Once that tab is closed there
 * is nothing left to act on, so continuing would either error on every remaining step or silently
 * "succeed" against nothing. Stopping is the only honest outcome, and it also releases the
 * `playing` flag so the next Run is not refused.
 *
 * Step- and group-scoped plays are included: they act on a tab too, and used to leave `playing`
 * set for the same reason.
 */
async function handlePlayTabClosed(tabId) {
  const st = await chrome.storage.local.get(["playing", "playTabId", "playSessionTabId"]);
  // Closing the tab ends its HUD session — one of the only two ways the marker may go.
  if (st.playSessionTabId != null && Number(st.playSessionTabId) === Number(tabId)) {
    await chrome.storage.local.remove("playSessionTabId");
  }
  const knownTab = Number(st.playTabId);
  const sessionTab = typeof playTabId !== "undefined" ? Number(playTabId) : NaN;
  if (Number(tabId) !== knownTab && Number(tabId) !== sessionTab) return;

  const wasPlaying = !!st.playing || !!(typeof playStatus !== "undefined" && playStatus?.playing);
  if (!wasPlaying) return;

  // The tab is gone, so there is nothing left to disarm — but the tracking map must not keep the
  // dead tab id, or a later run reusing that id would inherit a stale arming record.
  try { MorobotAlerts.clearAllAlertArming(); } catch { /* module may not be loaded yet */ }

  await chrome.storage.local.set({ playing: false, playPaused: false, playTabId: null });
  if (typeof playStatus !== "undefined" && playStatus) {
    playStatus.playing = false;
    playStatus.paused = false;
    // Say why, so the HUD/portal does not read as a crash. The tab is gone, so there is nowhere
    // left to show it in the page itself — this surfaces in the portal's status line.
    playStatus.lastError = "تب اجرا بسته شد؛ اجرا متوقف گردید.";
  }
  try {
    if (typeof broadcastPlayState === "function") broadcastPlayState();
  } catch { /* best effort */ }
  try {
    if (typeof notifyPortalTabs === "function" && typeof getPlayStatus === "function") {
      notifyPortalTabs({ type: "playStateChanged", ...getPlayStatus() });
    }
  } catch { /* the portal page may not be open */ }
}

/** Discard current batch and continue recording on the same process/tab. */
async function resumeRecord() {
  const data = await chrome.storage.local.get([
    "recordTargetTaskId", "recordTargetTitle", "recordTabId", "recordOptions"
  ]);
  if (data.recordTargetTaskId == null && !data.recordTabId) {
    return discardRecord();
  }
  const recordingGroups = [{
    id: "group-1",
    title: "گروه ضبط",
    steps: []
  }];
  await chrome.storage.local.set({
    recording: true,
    recordPhase: "recording",
    draft: [],
    recordingGroups,
    lastNavUrl: null,
    recordOptions: defaultRecordOptions(data.recordOptions)
  });
  if (data.recordTabId) {
    await injectRecordFab(data.recordTabId).catch(() => false);
  }
  return broadcastRecordState();
}

async function getState() {
  const data = await chrome.storage.local.get([
    "recording", "draft", "recordingGroups", "token", "playing", "recordPhase",
    "recordTabId", "localUser", "recordOptions", "recordTargetTaskId", "recordTargetTitle"
  ]);
  const steps = currentStepsFromStorage(data.recordingGroups, data.draft);
  const count = steps.length;
  const phase = data.recording
    ? "recording"
    : (data.recordPhase || (count ? "review" : "idle"));
  const play = typeof getPlayStatus === "function" ? getPlayStatus() : null;
  const playing = !!(play?.playing || data.playing);
  return {
    ok: true,
    recording: !!data.recording,
    recordPhase: phase,
    playing,
    count,
    steps,
    options: defaultRecordOptions(data.recordOptions),
    groupCount: Array.isArray(data.recordingGroups) ? data.recordingGroups.length : 0,
    signedIn: true,
    localUser: data.localUser || "test",
    recordTabId: data.recordTabId || null,
    targetTaskId: data.recordTargetTaskId ?? null,
    targetTitle: data.recordTargetTitle || null,
    play: play || { playing: !!data.playing }
  };
}

async function listTasks() {
  const tasks = await loadUserTasks();
  return { ok: true, tasks };
}

async function toggleRecord(tabId) {
  const state = await getState();
  if (state.recording) return finishRecord();
  return startRecordSession({});
}

async function checkSession() {
  const portal = await portalBase();
  let user = "test";
  try {
    const cookie = await chrome.cookies.get({ url: portal, name: "da_local_user" });
    if (cookie?.value) user = decodeURIComponent(cookie.value).trim() || "test";
  } catch {
    /* ignore */
  }
  if (user === "test") {
    const { localUser } = await chrome.storage.local.get("localUser");
    if (localUser) user = localUser;
  }
  await chrome.storage.local.set({
    token: "local-test",
    localUser: user,
    portalBase: portal,
    apiBase: portal
  });
  // Local-first: always signed in (no portal JWT required for record/play).
  return { signedIn: true, userName: user, local: true, version: chrome.runtime.getManifest().version };
}

async function syncPortalSession() {
  return checkSession();
}

/** Persian verb for recorded action types (short form for titles). */
function recordedActionVerbFa(actionType) {
  const t = String(actionType || "Click");
  switch (t) {
    case "Click": return "کلیک";
    case "DoubleClick": return "دبل‌کلیک";
    case "RightClick": return "کلیک‌راست";
    case "Hover": return "هاور";
    case "Hold": return "نگه‌داشتن";
    case "InputContent":
    case "InsertContent": return "متن";
    case "LoadContent": return "بارگذاری";
    case "GoToUrl": return "رفتن به";
    case "GoBack": return "بازگشت";
    case "GoForward": return "جلورفتن";
    case "CloseTab": return "بستن تب";
    case "InsertRow": return "درج ردیف";
    case "DeleteRow": return "حذف ردیف";
    case "SetMemory": return "ذخیره در حافظه";
    case "Refresh": return "رفرش";
    case "ScrollPage": return "اسکرول";
    case "RemoveElements": return "حذف المان";
    case "AlertAccept": return "تأیید هشدار";
    case "SelectOption": return "انتخاب گزینه";
    case "ClearContent": return "پاک‌کردن";
    case "WaitTime": return "انتظار";
    case "WaitForLoading": return "انتظار لود";
    default: return t;
  }
}

function cleanRecordedLabel(s, maxLen) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const max = maxLen == null ? 40 : maxLen;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * e.g. Click + "ورود" → "کلیک ورود"
 *      InputContent + "نام کاربری" → "متن نام کاربری"
 *      GoToUrl → "رفتن به example.com"
 */
function buildRecordedActionTitle(step, index) {
  if (!step) return `اقدام ${Number(index) + 1 || 1}`;
  if (step.title && String(step.title).trim()) return String(step.title).trim();

  const at = step.actionType || "Click";
  const verb = recordedActionVerbFa(at);
  const label = cleanRecordedLabel(step.elementLabel || "");

  if (String(at).toLowerCase() === "gotourl") {
    let host = "";
    try {
      host = new URL(String(step.url || step.value || "")).hostname || "";
    } catch { /* ignore */ }
    const short = host || cleanRecordedLabel(step.url || step.value || "", 36);
    return short ? `${verb} ${short}` : verb;
  }

  if (label) return `${verb} ${label}`;
  const n = (Number(index) >= 0 ? Number(index) : 0) + 1;
  return `${verb} ${n}`;
}

async function onRecordedEvent(payload, sender) {
  const { recording, playing, recordingGroups } = await chrome.storage.local.get([
    "recording", "playing", "recordingGroups"
  ]);
  if (!recording || playing) return { ok: true, ignored: true };

  // V2: ensure at least one group exists (Start creates empty Group).
  let groups = Array.isArray(recordingGroups) ? recordingGroups.slice() : [];
  if (!groups.length) {
    groups.push({ id: "group-1", title: "گروه ضبط", steps: [] });
  }

  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  const framePath = tabId != null ? await buildFramePath(tabId, frameId) : [];

  const item = {
    actionType: payload.actionType,
    value: payload.value || null,
    url: payload.url,
    elementBy: "CssSelector",
    elementValue: payload.elementValue,
    elementLabel: String(payload.elementLabel || "").trim() || null,
    title: null,
    framePath,
    recordedAt: new Date().toISOString()
  };
  item.title = buildRecordedActionTitle(item);

  const last = groups[groups.length - 1];
  last.steps = (last.steps || []).concat(item);
  const draft = flattenGroupSteps(groups);
  await chrome.storage.local.set({ recordingGroups: groups, draft });
  await broadcastDraftUpdated();
  return { ok: true, count: draft.length, groupCount: groups.length };
}

async function buildFramePath(tabId, leafFrameId) {
  if (!leafFrameId) return [];
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) return [];

  const byId = new Map(frames.map((f) => [f.frameId, f]));
  const chain = [];
  let current = byId.get(leafFrameId);
  while (current && current.parentFrameId >= 0) {
    chain.unshift(current);
    current = byId.get(current.parentFrameId);
  }

  const path = [];
  for (const child of chain) {
    const parentId = child.parentFrameId;
    const siblings = frames.filter((f) => f.parentFrameId === parentId);
    const indexInParent = siblings.findIndex((f) => f.frameId === child.frameId);
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [parentId] },
        func: describeIframe,
        args: [child.url, indexInParent]
      });
      if (result) path.push(result);
      else {
        path.push({
          by: "CssSelector",
          value: `iframe:nth-of-type(${indexInParent + 1}), frame:nth-of-type(${indexInParent + 1})`,
          srcHint: child.url,
          indexInParent
        });
      }
    } catch {
      path.push({
        by: "CssSelector",
        value: `iframe:nth-of-type(${indexInParent + 1})`,
        srcHint: child.url,
        indexInParent
      });
    }
  }
  return path;
}

function describeIframe(childUrl, indexInParent) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = nodes.find((n) => {
    try {
      return n.src && childUrl && (childUrl.startsWith(n.src) || n.src === childUrl || childUrl.includes(n.getAttribute("src") || "___"));
    } catch {
      return false;
    }
  });
  if (!el && indexInParent >= 0 && indexInParent < nodes.length) el = nodes[indexInParent];
  if (!el) return null;

  const esc = (s) => {
    try { return CSS.escape(String(s)); } catch {
      return String(s).replace(/([^\w-])/g, "\\$1");
    }
  };
  const count = (sel) => {
    try { return document.querySelectorAll(sel).length; } catch { return 0; }
  };

  function uniqueCss(element) {
    if (element.id) {
      const sel = `#${esc(element.id)}`;
      if (count(sel) === 1) return sel;
    }
    const tag = element.tagName.toLowerCase();
    const frameName = element.getAttribute("name");
    if (frameName) {
      const sel = `${tag}[name="${esc(frameName)}"]`;
      if (count(sel) === 1) return sel;
    }
    const parts = [];
    let node = element;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 64) {
      if (node.id && count(`#${esc(node.id)}`) === 1) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      const t = node.tagName.toLowerCase();
      if (t === "body" || t === "html") {
        parts.unshift(t);
        break;
      }
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(t);
        break;
      }
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      parts.unshift(`${t}:nth-of-type(${same.indexOf(node) + 1})`);
      node = parent;
    }
    return parts.join(" > ");
  }

  const css = uniqueCss(el);
  return {
    by: "CssSelector",
    value: css,
    srcHint: el.getAttribute("src") || childUrl,
    indexInParent,
    unique: true
  };
}

async function saveDraft(payload) {
  await syncPortalSession().catch(() => {});
  const {
    draft,
    recordingGroups,
    recordTargetTaskId,
    recordTargetTitle,
    recordTabId,
    recordOptions
  } = await chrome.storage.local.get([
    "draft", "recordingGroups", "recordTargetTaskId", "recordTargetTitle", "recordTabId", "recordOptions"
  ]);

  let allSteps = currentStepsFromStorage(recordingGroups, draft);
  const indexes = Array.isArray(payload?.selectedIndexes) ? payload.selectedIndexes : null;
  if (indexes != null) {
    if (!indexes.length) {
      return { ok: false, error: "هیچ موردی برای ذخیره انتخاب نشده است." };
    }
    const pick = new Set(indexes.map(Number).filter((n) => Number.isFinite(n)));
    allSteps = allSteps.filter((_, i) => pick.has(i));
  }
  if (!allSteps.length) {
    return { ok: false, error: "هیچ موردی برای ذخیره انتخاب نشده است." };
  }

  const groupTitle = (payload?.groupTitle || "").trim();
  if (!groupTitle) {
    return { ok: false, error: "نام گروه ضبط لازم است." };
  }

  // Refresh from portal, then require the EXISTING process — never create a new one.
  let pulled = await pullTasksFromPortalTabs().catch(() => null);
  let tasks = (pulled && pulled.length) ? pulled : await loadUserTasks();

  const targetId = normalizeTaskId(payload?.taskId) || normalizeTaskId(recordTargetTaskId);

  if (!targetId) {
    return {
      ok: false,
      error: "فرآیند هدف مشخص نیست. ضبط را از دکمهٔ ضبط همان فرآیند در پورتال شروع کنید."
    };
  }

  let existingIdx = findTaskIndex(tasks, targetId);
  // One more pull if target missing (portal tab may have finished decrypting late).
  if (existingIdx < 0) {
    await new Promise((r) => setTimeout(r, 250));
    pulled = await pullTasksFromPortalTabs().catch(() => null);
    if (pulled && pulled.length) {
      tasks = pulled;
      existingIdx = findTaskIndex(tasks, targetId);
    }
  }
  if (existingIdx < 0) {
    return {
      ok: false,
      error: "فرآیند هدف در پورتال پیدا نشد. تب پورتال را باز نگه دارید، لیست فرآیندها را رفرش کنید و دوباره ذخیره کنید."
    };
  }

  const existing = tasks[existingIdx];
  const id = existing.id;
  const title = existing.title || recordTargetTitle || `فرآیند #${id}`;
  let baseGraph = existing.graph;
  const numericServer = /^\d+$/.test(String(id));

  if (numericServer) {
    const serverGraph = await fetchCanvasFromServer(id);
    if (serverGraph?.error === "auth") {
      return {
        ok: false,
        error: "برای ذخیره روی سرور وارد پورتال شوید (نشست منقضی شده)."
      };
    }
    if (serverGraph?.nodes) {
      baseGraph = serverGraph;
    } else if (!baseGraph?.nodes?.length) {
      return {
        ok: false,
        error: "گراف فرآیند از سرور خوانده نشد. تب پورتال را باز کنید، وارد شوید و دوباره ذخیره کنید."
      };
    }
  } else if (!baseGraph || typeof baseGraph !== "object") {
    return {
      ok: false,
      error: "گراف فرآیند هدف خالی/نامعتبر است. ابتدا فرآیند را در ویرایشگر باز کنید."
    };
  }

  const existingGroups = (baseGraph?.nodes || []).filter((n) => n.kind === "group");
  const nextGroupOrdinal = existingGroups.length + 1;
  const groups = [{ id: `group-${nextGroupOrdinal}`, title: groupTitle, steps: allSteps }];

  const graph = mergeRecordingGroupsIntoGraph(baseGraph, groups, id, title);
  const nodes = graph.nodes || [];
  const stepCount = nodes.filter((n) => n.kind === "action" || n.kind === "step").length;
  const groupCount = nodes.filter((n) => n.kind === "group").length;

  const beforeSteps = (baseGraph?.nodes || []).filter((n) => n.kind === "action" || n.kind === "step").length;
  if (stepCount < beforeSteps + allSteps.length) {
    console.warn("[recorder] merge produced fewer steps than expected", { beforeSteps, stepCount, added: allSteps.length });
  }
  if (stepCount <= beforeSteps) {
    return {
      ok: false,
      error: "گروه جدید به فرآیند اضافه نشد. تب پورتال را رفرش کنید و دوباره ذخیره کنید."
    };
  }

  if (numericServer) {
    const serverSave = await persistCanvasToServer(id, graph, title);
    if (!serverSave.ok && !serverSave.skipped) {
      return {
        ok: false,
        error: serverSave.error
          || "ذخیره روی سرور انجام نشد — وارد شوید و دوباره ذخیره کنید."
      };
    }
    await refreshTaskCacheFromServer(id, title);
  } else {
    tasks[existingIdx] = {
      ...existing,
      title,
      designOrigin: existing.designOrigin || "Recorded",
      groupCount,
      stepCount,
      dataSourceCount: Array.isArray(graph.dataSources) ? graph.dataSources.length : 0,
      graph
    };
    await saveUserTasks(tasks);
    const pushed = await pushTasksToPortalTabs(tasks);
    if (!pushed) {
      return {
        ok: false,
        error: "ذخیره در افزونه انجام شد ولی پورتال به‌روز نشد — تب پورتال را باز نگه دارید."
      };
    }
  }

  const continueRecording = payload?.continueRecording !== false;
  if (continueRecording) {
    await chrome.storage.local.set({
      recording: true,
      recordPhase: "recording",
      draft: [],
      recordingGroups: [{ id: "group-1", title: "گروه ضبط", steps: [] }],
      lastNavUrl: null,
      recordTabId: recordTabId || null,
      recordTargetTaskId: id,
      recordTargetTitle: title,
      recordOptions: defaultRecordOptions(recordOptions)
    });
    if (recordTabId) {
      await injectRecordFab(recordTabId).catch(() => false);
    }
  } else {
    // The recording is over and saved, so its server binding is released. `continueRecording` above
    // deliberately keeps the binding, because the same recording is still open and must keep talking
    // to the same portal.
    if (globalThis.DaSessionScope) await DaSessionScope.unbindSession("record").catch(() => {});
    await chrome.storage.local.set({
      recording: false,
      recordPhase: "idle",
      draft: [],
      recordingGroups: [],
      recordTabId: null,
      lastNavUrl: null,
      recordTargetTaskId: null,
      recordTargetTitle: null
    });
    setTimeout(() => pollDevReload(), 400);
  }

  await broadcastRecordState();
  await broadcastDraftUpdated();
  return {
    ok: true,
    result: {
      taskId: id,
      groupId: nextGroupOrdinal,
      groupTitle,
      stepCount,
      groupCount,
      merged: true,
      continued: continueRecording,
      pushed: true
    }
  };
}

function isRecordedActionNode(n) {
  return !!n && (n.kind === "action" || n.kind === "step");
}

function processStartNode(nodes) {
  return (nodes || []).find((n) => n.kind === "start" && !n.groupNodeId) || null;
}

/** Last node on the root flow chain (start → group/condition/… via `next`). */
function findProcessFlowTip(nodes, edges) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const isProcessLevel = (n) => {
    if (!n) return false;
    if (n.groupNodeId) return false;
    return n.kind === "start" || n.kind === "group" || n.kind === "condition" || isRecordedActionNode(n);
  };
  let tip = processStartNode(nodes)?.id;
  if (!tip) return null;
  const seen = new Set();
  while (tip && !seen.has(tip)) {
    seen.add(tip);
    const next = (edges || []).find((e) => e.from === tip && e.kind === "next");
    if (!next) break;
    const target = byId.get(next.to);
    if (!isProcessLevel(target)) break;
    tip = next.to;
  }
  return tip;
}

/** Append newly recorded groups/steps onto an existing task graph. */
function mergeRecordingGroupsIntoGraph(existingGraph, groups, taskId, title) {
  const base = existingGraph && typeof existingGraph === "object"
    ? existingGraph
    : { nodes: [], edges: [], dataSources: [], viewport: { x: 40, y: 40, zoom: 1 } };
  let nodes = Array.isArray(base.nodes) ? base.nodes.slice() : [];
  let edges = Array.isArray(base.edges) ? base.edges.slice() : [];

  // Drop a start whose group is gone. A previous merge could leave one behind (it was written for
  // a group that never made it into the graph), and it reads as a stray "شروع" on the canvas.
  const groupIds = new Set(nodes.filter((n) => n.kind === "group").map((n) => n.id));
  const orphanStartIds = new Set(
    nodes.filter((n) => n.kind === "start" && n.groupNodeId && !groupIds.has(n.groupNodeId)).map((n) => n.id)
  );
  if (orphanStartIds.size) {
    nodes = nodes.filter((n) => !orphanStartIds.has(n.id));
    edges = edges.filter((e) => !orphanStartIds.has(e.from) && !orphanStartIds.has(e.to));
  }

  // The process MUST keep a root start. Without it the run has no entry point and the
  // process-level settings have no node to live on. Recreate it from the graph's own values
  // rather than trusting the base to have kept it.
  //
  // Every repeat field the engine reads has to be carried over, not just the common ones. A
  // partial copy silently changed behaviour: a process set to run source rows 3..5 came back as
  // "whole source", and a dedicated-row start lost its pointer, because the rebuilt node simply
  // had no such properties. When adding a repeat field to the start node, add it here too.
  if (!processStartNode(nodes)) {
    nodes.unshift({
      id: nodes.some((n) => n.id === "start") ? "start-root" : "start",
      kind: "start",
      title: "شروع",
      x: 40,
      y: 220,
      repeatSourceType: base.repeatSourceType || "None",
      loopCount: base.loopCount ?? 1,
      moveLoop: base.moveLoop === true,
      stepDelayMs: base.stepDelayMs ?? 0,
      loopBackLimit: base.loopBackLimit,
      ignorePlayError: base.ignorePlayError !== false,
      highlightColor: base.highlightColor,
      dataSourceId: base.dataSourceId ?? null,
      // Range over the repeat source. (Row pointers are per NODE now — see the row's action or
      // condition — so a rebuilt start carries none.)
      repeatFromIndex: base.repeatFromIndex ?? null,
      repeatToIndex: base.repeatToIndex ?? null
    });
  }

  // Anything that was recorded into a group without its own start needs one (per-group start).

  const stamp = Date.now();
  let maxEntity = 0;
  for (const n of nodes) {
    if (n.entityId != null && Number(n.entityId) > maxEntity) maxEntity = Number(n.entityId);
  }

  let tip = findProcessFlowTip(nodes, edges);
  if (!tip) tip = processStartNode(nodes)?.id || "start";

  const list = Array.isArray(groups) && groups.length
    ? groups
    : [{ id: "group-1", title: "گروه ضبط", steps: [] }];

  list.forEach((g, gi) => {
    maxEntity += 1;
    const gid = `group-rec-${stamp}-${gi + 1}`;
    const gstartId = `gstart-${gid}`;
    nodes.push({
      id: gid,
      kind: "group",
      entityId: maxEntity,
      title: g.title || `گروه ضبط ${gi + 1}`,
      x: 280 + gi * 280,
      y: 80 + (nodes.filter((n) => n.kind === "group" && !n.groupNodeId).length * 20),
      repeatSourceType: "None",
      moveLoop: true
    });
    nodes.push({
      id: gstartId,
      kind: "start",
      title: "شروع",
      groupNodeId: gid,
      x: 48,
      y: 80,
      repeatSourceType: "None",
      isActive: true
    });
    edges.push({ id: `e-rec-${stamp}-g-${gi}`, from: tip, to: gid, kind: "next" });
    tip = gid;

    let prevStep = null;
    (g.steps || []).forEach((a, i) => {
      maxEntity += 1;
      const sid = `${gid}-step-${i + 1}`;
      const isNav = String(a.actionType || "").toLowerCase() === "gotourl";
      nodes.push({
        id: sid,
        kind: "action",
        entityId: maxEntity,
        title: buildRecordedActionTitle(a, i),
        groupNodeId: gid,
        actionType: a.actionType || "Click",
        // The recorded value is a constant (the typed text, or the target address for GoToUrl).
        // Stating it stops the editor/player from inferring "element" for an action that merely
        // permits an element source.
        contentSourceType: "Constant",
        selectorValue: a.elementValue || "",
        constantValue: isNav ? "" : (a.value || ""),
        navigateUrl: isNav ? (a.url || a.value || "") : null,
        framePathJson: JSON.stringify(a.framePath || []),
        ignoreError: true,
        isActive: true,
        x: 40,
        y: i * 90
      });
      if (prevStep) {
        edges.push({ id: `e-rec-${stamp}-${gi}-${i}`, from: prevStep, to: sid, kind: "next" });
      } else {
        edges.push({ id: `e-rec-c-${stamp}-${gi}-${i}`, from: gid, to: sid, kind: "contains" });
        edges.push({ id: `e-rec-gs-${stamp}-${gi}-${i}`, from: gstartId, to: sid, kind: "next" });
      }
      prevStep = sid;
    });
  });

  return {
    ...base,
    taskId,
    title,
    canModify: true,
    designOrigin: base.designOrigin || "Recorded",
    viewport: base.viewport || { x: 40, y: 40, zoom: 1 },
    nodes,
    edges,
    dataSources: Array.isArray(base.dataSources) ? base.dataSources : []
  };
}

async function currentLocalUser() {
  const { localUser } = await chrome.storage.local.get("localUser");
  return localUser || "test";
}

async function loadUserTasks() {
  const user = await currentLocalUser();
  const key = `localTasks__${user}`;
  const data = await chrome.storage.local.get([key, "localTasks"]);
  if (Array.isArray(data[key])) return data[key];
  // One-time migrate shared legacy bucket into THIS user only, then delete shared key
  // so other users do not inherit the same tasks.
  if (Array.isArray(data.localTasks) && data.localTasks.length) {
    await chrome.storage.local.set({ [key]: data.localTasks });
    await chrome.storage.local.remove("localTasks");
    return data.localTasks;
  }
  return [];
}

/**
 * Publish the start node's highlight colour so the manual-click preview can use it.
 *
 * The preview (content/click-preview.js) outlines the element a HUMAN clicked, so the operator
 * can see what a step would target before running it. That is most useful precisely when nothing
 * is running, so it cannot read the colour from a live play payload — hence this copy in storage.
 *
 * Only the PROCESS-level start owns the colour, matching resolveHighlightColor() in the engine:
 * a start node inside a group has its own settings and must not stand in for the process's.
 */
async function publishPreviewHighlightColor(taskId) {
  try {
    const tasks = await loadUserTasks();
    const task = tasks.find((t) => String(t.id) === String(taskId));
    const nodes = task?.graph?.nodes || [];
    const start = nodes.find((n) => n.kind === "start" && !n.groupNodeId);
    const raw = start?.highlightColor ?? task?.graph?.highlightColor ?? "";
    const v = String(raw || "").trim();
    await chrome.storage.local.set({
      da_preview_highlight_color: /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : ""
    });
  } catch { /* a missing colour only costs the preview its exact tint */ }
}

async function saveUserTasks(tasks) {
  const user = await currentLocalUser();
  const key = `localTasks__${user}`;
  // Never write a shared localTasks key — that leaked tasks across users.
  await chrome.storage.local.set({ [key]: tasks });
  await chrome.storage.local.remove("localTasks");
}

async function persistPlayDataSourcesMessage(message) {
  const taskId = message?.taskId != null && message.taskId !== ""
    ? String(message.taskId).trim()
    : null;
  const dataSources = message?.dataSources;
  if (!taskId || !Array.isArray(dataSources)) return { ok: false, error: "داده ناقص" };
  const tasks = await loadUserTasks();
  const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
  if (idx < 0 || !tasks[idx]?.graph) return { ok: false, error: "فرآیند پیدا نشد" };
  tasks[idx].graph.dataSources = dataSources;
  await saveUserTasks(tasks);
  await pushTasksToPortalTabs(tasks);
  return { ok: true };
}

async function readDataSourceCellMessage(message) {
  const id = Number(message?.dataSourceId);
  const rowIndex = Number(message?.rowIndex);
  const columnKey = String(message?.columnKey || "").trim();
  if (!id || !columnKey || rowIndex < 0) return { ok: false, error: "invalid" };
  const portal = String(await portalBase()).replace(/\/$/, "");
  const q = new URLSearchParams({ rowIndex: String(rowIndex), columnKey });
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/cells?${q}`, {
      method: "GET",
      headers: await authHeaders()
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Lightweight row/column counts — no cell payload (group repeat sizing). */
async function readDataSourceMetaMessage(message) {
  const id = Number(message?.dataSourceId);
  if (!id) return { ok: false, error: "invalid" };
  const portal = String(await portalBase()).replace(/\/$/, "");
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/meta`, {
      method: "GET",
      headers: await authHeaders()
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function readDataSourceRowMessage(message) {
  const id = Number(message?.dataSourceId);
  const rowIndex = Number(message?.rowIndex);
  if (!id || rowIndex < 0) return { ok: false, error: "invalid" };
  const portal = String(await portalBase()).replace(/\/$/, "");
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/rows/${rowIndex}`, {
      method: "GET",
      headers: await authHeaders()
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Bulk row page — what a whole-column check needs (one request per page, not one per row). */
async function readDataSourceRowsMessage(message) {
  const id = Number(message?.dataSourceId);
  if (!id) return { ok: false, error: "invalid" };
  const from = Math.max(0, Number(message?.from) || 0);
  const count = Math.max(1, Number(message?.count) || 1000);
  const keys = Array.isArray(message?.keys) ? message.keys.filter((k) => String(k || "").trim()) : [];
  if (keys.length === 0) return { ok: false, error: "invalid" };
  const portal = String(await portalBase()).replace(/\/$/, "");
  const query = `from=${from}&count=${count}&keys=${encodeURIComponent(keys.join(","))}`;
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/rows?${query}`, {
      method: "GET",
      headers: await authHeaders()
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function patchDataSourceCellMessage(message) {
  const id = Number(message?.dataSourceId);
  const rowIndex = Number(message?.rowIndex);
  const columnKey = String(message?.columnKey || "").trim();
  if (!id || !columnKey || rowIndex < 0) return { ok: false, error: "invalid" };
  const portal = String(await portalBase()).replace(/\/$/, "");
  const payload = {
    rowIndex,
    columnKey,
    cellValue: message?.cellValue ?? "",
    expectedCellRevision: message?.expectedCellRevision ?? message?.cellRevision ?? null,
    // Prepend/Append + their separator ride along so the server composes the value under the same
    // row lock as the write; the editor's own grid writes leave both null and overwrite as before.
    insertMode: message?.insertMode ?? null,
    insertSeparator: message?.insertSeparator ?? null
  };
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/cells`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    // A row/byte ceiling comes back as 409 with a distinct code, so this MUST be checked before the
    // generic 409 branch. Treating it as a revision conflict would make the player adopt the
    // server's revision and retry until the wait budget ran out, then blame a "busy" cell - hiding
    // the fact that no amount of retrying can help.
    if (body?.code === "source-limit") {
      return { ok: false, limit: true, message: body.message || null, body };
    }
    if (res.status === 409) return { ok: false, conflict: true, body };
    if (!res.ok) return { ok: false, error: body.message || `http ${res.status}`, body };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Remove one row from a library data source.
 *
 * The server owns the store, so this is a plain request; `rowIndex` is resolved by the player from
 * the step's row pointer before it gets here.
 */
async function deleteDataSourceRowMessage(message) {
  const id = Number(message?.dataSourceId);
  const rowIndex = Number(message?.rowIndex);
  if (!id || !Number.isFinite(rowIndex) || rowIndex < 0) return { ok: false, error: "invalid" };
  let portal;
  try {
    portal = String(await portalBase()).replace(/\/$/, "");
  } catch {
    return { ok: false, error: "no_portal" };
  }
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/rows/${rowIndex}`, {
      method: "DELETE",
      headers: await authHeaders()
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    if (body?.code === "source-limit") return { ok: false, limit: true, message: body.message || null, body };
    if (!res.ok) return { ok: false, error: body.message || `http ${res.status}`, body };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Insert a blank row at a chosen position — the InsertRow action.
 *
 * `rowIndex` is where the row ends up, expressed 0-based, which is what the row pointer on the step
 * already resolves to. The server's contract is "insert BEFORE this index", so the index is passed
 * straight through: asking for row 2 must put the new row at position 2, not after it.
 */
async function insertDataSourceRowMessage(message) {
  const id = Number(message?.dataSourceId);
  const rowIndex = Number(message?.rowIndex);
  if (!id || !Number.isFinite(rowIndex) || rowIndex < 0) return { ok: false, error: "invalid" };
  let portal;
  try {
    portal = String(await portalBase()).replace(/\/$/, "");
  } catch {
    return { ok: false, error: "no_portal" };
  }
  try {
    const res = await fetch(`${portal}/api/datasources/${id}/rows/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ beforeIndex: rowIndex, count: 1 })
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
    if (body?.code === "source-limit") return { ok: false, limit: true, message: body.message || null, body };
    if (!res.ok) return { ok: false, error: body.message || `http ${res.status}`, body };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function broadcastDsCellEventMessage(message) {
  const ev = message?.event;
  if (!ev) return { ok: false };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: "dsCellEvent", event: ev }).catch(() => {});
  }
  return { ok: true };
}

async function getLocalTaskGraph(taskId) {
  const tasks = await loadUserTasks();
  const task = tasks.find((t) => String(t.id) === String(taskId));
  if (!task?.graph) return { ok: false, error: "فرآیند محلی پیدا نشد." };
  return { ok: true, graph: task.graph };
}

async function pushTasksToPortalTabs(tasks) {
  const user = await currentLocalUser();
  const tabs = await chrome.tabs.query({});
  let ok = false;
  for (const tab of tabs) {
    if (!tab.id) continue;
    const url = tab.url || "";
    if (!(await isPortalTabUrl(url))) continue;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "localTasksUpdated", user, tasks });
      if (res?.ok) ok = true;
    } catch {
      /* portal tab without bridge */
    }
    // MAIN-world write — content-script isolated world cannot touch page DaSecureStore.
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (u, list) => {
          try {
            if (window.DaSecureStore && typeof DaSecureStore.writeTasks === "function") {
              DaSecureStore.writeTasks(list, u);
              return true;
            }
            window.postMessage({ source: "da-ext-bridge", type: "write-tasks", user: u, tasks: list }, "*");
            return true;
          } catch {
            return false;
          }
        },
        args: [user, tasks]
      });
      if (result) ok = true;
    } catch {
      /* scripting may fail on restricted pages */
    }
  }
  return ok;
}

/** V2 FormRecord: one graph Group per record Group; Steps only inside their Group. No spare empty group. */
function buildGraphFromRecordingGroups(taskId, title, groups) {
  const list = Array.isArray(groups) && groups.length
    ? groups
    : [{ id: "group-1", title: "گروه خالی", steps: [] }];

  const nodes = [{ id: "start", kind: "start", title: "شروع", x: 40, y: 220 }];
  const edges = [];
  let prevNode = "start";
  let stepEntity = 0;

  list.forEach((g, gi) => {
    const gid = g.id || `group-${gi + 1}`;
    const gstartId = `gstart-${gid}`;
    nodes.push({
      id: gid,
      kind: "group",
      entityId: gi + 1,
      title: g.title || `گروه ${gi + 1}`,
      x: 280 + gi * 280,
      y: 80,
      repeatSourceType: "None",
      moveLoop: true
    });
    nodes.push({
      id: gstartId,
      kind: "start",
      title: "شروع",
      groupNodeId: gid,
      x: 48,
      y: 80,
      repeatSourceType: "None",
      isActive: true
    });
    edges.push({ id: `e-g-${gi}`, from: prevNode, to: gid, kind: "next" });
    prevNode = gid;

    let prevStep = null;
    (g.steps || []).forEach((a, i) => {
      stepEntity += 1;
      const sid = `${gid}-step-${i + 1}`;
      const isNav = String(a.actionType || "").toLowerCase() === "gotourl";
      nodes.push({
        id: sid,
        kind: "action",
        entityId: stepEntity,
        title: buildRecordedActionTitle(a, i),
        groupNodeId: gid,
        actionType: a.actionType || "Click",
        // The recorded value is a constant (the typed text, or the target address for GoToUrl).
        // Stating it stops the editor/player from inferring "element" for an action that merely
        // permits an element source.
        contentSourceType: "Constant",
        selectorValue: a.elementValue || "",
        constantValue: isNav ? "" : (a.value || ""),
        navigateUrl: isNav ? (a.url || a.value || "") : null,
        framePathJson: JSON.stringify(a.framePath || []),
        ignoreError: true,
        isActive: true,
        x: 40,
        y: i * 90
      });
      if (prevStep) edges.push({ id: `e-${gid}-${i}`, from: prevStep, to: sid, kind: "next" });
      else {
        edges.push({ id: `e-c-${gid}-${i}`, from: gid, to: sid, kind: "contains" });
        edges.push({ id: `e-gs-${gid}-${i}`, from: gstartId, to: sid, kind: "next" });
      }
      prevStep = sid;
    });
  });

  return {
    taskId,
    title,
    canModify: true,
    designOrigin: "Recorded",
    viewport: { x: 40, y: 40, zoom: 1 },
    nodes,
    edges,
    dataSources: []
  };
}

function buildGraphFromDraft(taskId, title, actions, groupTitle) {
  return buildGraphFromRecordingGroups(taskId, title, [
    { id: "group-1", title: groupTitle || "ضبط‌شده", steps: actions || [] }
  ]);
}

function isTrackableNavUrl(url) {
  if (!url) return false;
  if (url === "about:blank" || url.startsWith("about:")) return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://") || url.startsWith("devtools://")) return false;
  return /^https?:\/\//i.test(url);
}

async function appendNavStep(url, tabId) {
  const { recording, lastNavUrl, playing, recordingGroups } = await chrome.storage.local.get([
    "recording", "lastNavUrl", "playing", "recordingGroups"
  ]);
  if (!recording || playing) return;
  if (!isTrackableNavUrl(url)) return;
  if (lastNavUrl === url) return;

  let groups = Array.isArray(recordingGroups) ? recordingGroups.slice() : [];
  if (!groups.length) {
    groups.push({ id: "group-1", title: "گروه ضبط", steps: [] });
  }

  const item = {
    actionType: "GoToUrl",
    value: url,
    url,
    elementBy: "CssSelector",
    elementValue: "",
    elementLabel: null,
    framePath: [],
    recordedAt: new Date().toISOString()
  };
  item.title = buildRecordedActionTitle(item);
  const last = groups[groups.length - 1];
  last.steps = (last.steps || []).concat(item);
  await chrome.storage.local.set({
    recordingGroups: groups,
    draft: flattenGroupSteps(groups),
    lastNavUrl: url
  });
  await broadcastDraftUpdated();
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.transitionType === "auto_subframe") return;
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || details.tabId !== recordTabId) return;
  await appendNavStep(details.url, details.tabId);
});

/** Play dev-stamp (global bundle; server aliases player → global). */
const PLAYER_DEV_STAMP_FALLBACK_URLS = [
  "https://localhost:7201/extension/dev-stamp/global",
  "https://localhost:7201/extension/dev-stamp/player",
  "http://localhost:5201/extension/dev-stamp/global",
  "http://localhost:5201/extension/dev-stamp/player",
  "http://localhost:5000/extension/dev-stamp/global",
  "http://localhost:5000/extension/dev-stamp/player"
];

/**
 * Play: sync install folder; if code changed, respond first then reload & resume.
 * Never call chrome.runtime.reload() before sendResponse — that closes the channel.
 */
async function startPlayWithAutoReload(message, sender) {
  const rawTab = message.tabId != null && message.tabId !== "" ? Number(message.tabId) : NaN;
  const hasExplicitTab = Number.isFinite(rawTab);
  const isConditionCheck = !!message.conditionNodeId;
  // "from this node onward" walks the graph like a whole-task run, so it must not be forced onto a
  // sender tab the way a condition check is, and a fresh tab has to stay possible.
  const isNextFrom = !!message.nextFromNodeId;
  const pendingPlay = {
    taskId: message.taskId,
    tabId: hasExplicitTab
      ? rawTab
      : (isConditionCheck ? null : (sender.tab?.id ?? null)),
    runMode: message.runMode || null,
    groupNodeId: message.groupNodeId || null,
    stepNodeId: message.stepNodeId || null,
    conditionNodeId: message.conditionNodeId || null,
    nextFromNodeId: message.nextFromNodeId || null,
    playScope: message.playScope
      || (message.nextFromNodeId ? "next"
        : message.conditionNodeId ? "condition"
          : message.stepNodeId ? "step"
            : message.groupNodeId ? "group"
              : "task"),
    openNewTab: hasExplicitTab || isConditionCheck ? false : (message.openNewTab === true)
  };

  const playOpts = {
    groupNodeId: pendingPlay.groupNodeId,
    stepNodeId: pendingPlay.stepNodeId,
    conditionNodeId: pendingPlay.conditionNodeId,
    nextFromNodeId: pendingPlay.nextFromNodeId,
    playScope: pendingPlay.playScope,
    openNewTab: pendingPlay.openNewTab,
    activateTab: isConditionCheck ? false : undefined
  };

  // Keep the manual-click preview's colour in step with the process being run. Done here (on a
  // play request) because that is the moment the operator has told us which process matters.
  await publishPreviewHighlightColor(pendingPlay.taskId);

  const { resumePlayAfterReload } = await chrome.storage.local.get("resumePlayAfterReload");
  if (resumePlayAfterReload) {
    await chrome.storage.local.remove("resumePlayAfterReload");
    return startPlay(pendingPlay.taskId, pendingPlay.tabId, pendingPlay.runMode, playOpts);
  }

  const stampInfo = await fetchPlayerStamp({ forceSync: true });
  const { playerDevStamp } = await chrome.storage.local.get("playerDevStamp");
  const prev = playerDevStamp || null;

  if (stampInfo?.stamp) {
    await chrome.storage.local.set({
      playerDevStamp: stampInfo.stamp,
      portalBase: stampInfo.origin || undefined,
      installPath: stampInfo.path || null
    });
  }

  const needsReload = !!(prev && stampInfo?.stamp && prev !== stampInfo.stamp);
  if (!needsReload || hasExplicitTab || isConditionCheck) {
    if (hasExplicitTab || isConditionCheck) {
      console.info("[Morobot Global] startPlay in tab", pendingPlay.tabId, {
        step: pendingPlay.stepNodeId,
        group: pendingPlay.groupNodeId,
        condition: pendingPlay.conditionNodeId
      });
    }
    return startPlay(pendingPlay.taskId, pendingPlay.tabId, pendingPlay.runMode, playOpts);
  }

  await chrome.storage.local.set({
    pendingPlayRequest: pendingPlay,
    pendingPlayAt: Date.now(),
    resumePlayAfterReload: true,
    pendingDevReload: false,
    pendingDevStamp: null
  });

  setTimeout(() => {
    console.info("[Morobot Global] play → auto reload after response", pendingPlay.taskId);
    try { chrome.runtime.reload(); } catch { /* ignore */ }
  }, 120);

  return {
    ok: true,
    reloading: true,
    message: "افزونهٔ اجرا در حال به‌روزرسانی است — اجرا خودکار شروع می‌شود."
  };
}

async function reloadPlayerNow(pendingPlay) {
  if (pendingPlay) {
    await chrome.storage.local.set({
      pendingPlayRequest: pendingPlay,
      pendingPlayAt: Date.now()
    });
  }
  setTimeout(() => {
    try { chrome.runtime.reload(); } catch { /* ignore */ }
  }, 120);
  return { ok: true, reloading: true };
}

async function fetchPlayerStamp({ forceSync }) {
  const portal = await portalBase().catch(() => DEFAULT_PORTAL);
  if (forceSync) {
    try {
      await fetch(`${portal}/extension/sync`, { method: "POST", cache: "no-store" });
    } catch {
      /* sync optional if portal down */
    }
  }
  const urls = [
    `${portal}/extension/dev-stamp/global`,
    `${portal}/extension/dev-stamp/player`,
    `${portal}/extension/dev-stamp`,
    ...PLAYER_DEV_STAMP_FALLBACK_URLS
  ];
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.stamp) continue;
      let origin = portal;
      try { origin = new URL(url).origin; } catch { /* keep */ }
      return {
        stamp: data.stamp,
        version: data.version || "",
        path: data.path || null,
        origin
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function resumePendingPlayAfterReload() {
  const { pendingPlayRequest, pendingPlayAt } = await chrome.storage.local.get([
    "pendingPlayRequest", "pendingPlayAt"
  ]);
  if (!pendingPlayRequest?.taskId) return;
  if (pendingPlayAt && Date.now() - Number(pendingPlayAt) > 120000) {
    await chrome.storage.local.remove(["pendingPlayRequest", "pendingPlayAt", "resumePlayAfterReload"]);
    return;
  }
  await chrome.storage.local.remove(["pendingPlayRequest", "pendingPlayAt"]);
  await chrome.storage.local.set({ resumePlayAfterReload: true });
  console.info("[Morobot Global] resuming play after auto-reload", pendingPlayRequest.taskId);
  setTimeout(() => {
    startPlay(
      pendingPlayRequest.taskId,
      pendingPlayRequest.tabId,
      pendingPlayRequest.runMode,
      {
        groupNodeId: pendingPlayRequest.groupNodeId || null,
        stepNodeId: pendingPlayRequest.stepNodeId || null,
        conditionNodeId: pendingPlayRequest.conditionNodeId || null,
        nextFromNodeId: pendingPlayRequest.nextFromNodeId || null,
        playScope: pendingPlayRequest.playScope || null,
        openNewTab: pendingPlayRequest.openNewTab === true
      }
    ).then((res) => {
      chrome.storage.local.remove("resumePlayAfterReload");
      if (res && res.ok === false) {
        const msg = res.error || "اجرا پس از به‌روزرسانی افزونه ناموفق بود.";
        playStatus.lastError = msg;
        playStatus.playing = false;
        notifyPortalTabs({ type: "playStateChanged", ...getPlayStatus() });
      }
    }).catch((err) => {
      chrome.storage.local.remove("resumePlayAfterReload");
      const msg = err?.message || String(err) || "اجرا پس از به‌روزرسانی افزونه ناموفق بود.";
      playStatus.lastError = msg;
      playStatus.playing = false;
      notifyPortalTabs({ type: "playStateChanged", ...getPlayStatus() });
      console.warn("[Morobot Global] resume play failed", err);
    });
  }, 700);
}

/** Re-mount play HUD after refresh/navigation (storage-aware; retries for blank tabs). */
async function reinjectPlayHudForTab(tabId, reason) {
  if (!tabId) return;
  try {
    let playing = !!(typeof playStatus !== "undefined" && playStatus?.playing);
    let activePlayTab = (typeof playTabId !== "undefined" && playTabId) || null;
    if (!playing || !activePlayTab) {
      const st = await chrome.storage.local.get(["playing", "playTabId"]);
      if (st.playing && st.playTabId) {
        if (!playing) {
          await chrome.storage.local.set({ playing: false, playTabId: null, playPaused: false });
          if (typeof playStatus !== "undefined") {
            playStatus.playing = false;
            playStatus.paused = false;
            playStatus.lastError = "اجرا قطع شد (ریستارت افزونه). دوباره اجرا کنید.";
          }
          if (typeof broadcastPlayState === "function") broadcastPlayState();
          return;
        }
        activePlayTab = Number(st.playTabId) || activePlayTab;
      }
    }
    if (!playing || !activePlayTab || Number(tabId) !== Number(activePlayTab)) return;
    if (typeof injectPlayFab !== "function") return;
    for (let i = 0; i < 4; i++) {
      const ok = await injectPlayFab(tabId);
      if (ok) {
        if (typeof notifyTab === "function" && typeof getPlayStatus === "function") {
          notifyTab(tabId, { type: "playStateChanged", ...getPlayStatus() });
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 150 + i * 120));
    }
  } catch (err) {
    console.warn("[Morobot Global] reinjectPlayHudForTab", reason, err?.message || err);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete" || changeInfo.status === "loading") {
    scheduleOpenTabsBroadcast(changeInfo.url ? "url" : "update");
  }
  // Opening or closing the portal page is what changes whether the fast dev-poll cadence is worth
  // paying for, so re-evaluate on the events that can change that answer. Cheap: it only ever
  // happens on a navigation, and the no-op case is a single interval re-arm.
  if (changeInfo.url) applyDevPollCadence();
  if (changeInfo.status === "complete") {
    reinjectPlayHudForTab(tabId, "tabs.onUpdated").catch(() => {});
  }
  const { recording, recordTabId } = await chrome.storage.local.get(["recording", "recordTabId"]);
  if (!recording || !recordTabId || tabId !== recordTabId) return;
  if (changeInfo.status === "complete") {
    injectRecordFab(tabId).catch(() => {});
  }
  if (changeInfo.url) {
    await appendNavStep(changeInfo.url, tabId);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  reinjectPlayHudForTab(details.tabId, "webNavigation.onCompleted").catch(() => {});
});

chrome.tabs.onCreated.addListener(() => scheduleOpenTabsBroadcast("created"));
/**
 * Closing the tab a session runs in must END that session, not just update the tab list.
 *
 * The `recording` and `playing` flags live in extension storage, so a closed tab left them set.
 * The user then could not start a run ("ابتدا ضبط را متوقف کنید") with no recording left on screen
 * to stop, and a finished play kept the process marked as running. Both are handled here.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  scheduleOpenTabsBroadcast("removed");
  // Closing a tab can close the portal (dropping the poll back to idle) or end a run (letting it
  // resume), so both answers are re-evaluated here.
  applyDevPollCadence();
  handleRecordTabClosed(tabId).catch((err) => console.warn("[Morobot Global] record tab close", err));
  handlePlayTabClosed(tabId).catch((err) => console.warn("[Morobot Global] play tab close", err));
});
chrome.tabs.onActivated.addListener(() => scheduleOpenTabsBroadcast("activated"));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) scheduleOpenTabsBroadcast("focus");
});

/** Dev/local auto-reload: only when portal (app) is open and not recording/playing.
 *  Refreshing a recorded external page must NOT reload the extension.
 *
 *  Two cadences on purpose. The IDLE poll runs all the time, so it is deliberately slow: it is a
 *  dev convenience, and every tick wakes the MV3 service worker. The ACTIVE cadence is used only
 *  while the portal page is open, which is the one situation where an author is actually waiting
 *  for a rebuild to land — and it is turned off entirely during a run (see stopDevPoll).
 */
const DEV_POLL_MS_IDLE = 10000;
const DEV_POLL_MS_ACTIVE = 2500;
const DEV_STAMP_URLS = [
  "https://localhost:7201/extension/dev-stamp/recorder",
  "http://localhost:5201/extension/dev-stamp/recorder",
  "http://localhost:5000/extension/dev-stamp/recorder"
];

function isPortalAppUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1") return false;
    // Extension sync endpoints alone don't count as "using the app"
    if (u.pathname.startsWith("/extension/")) return false;
    return true;
  } catch {
    return false;
  }
}

async function hasOpenPortalAppTab() {
  try {
    const portal = await portalBase().catch(() => DEFAULT_PORTAL);
    let origin;
    try { origin = new URL(portal).origin; } catch { origin = null; }
    const tabs = await chrome.tabs.query({});
    return tabs.some((t) => {
      const url = t.url || "";
      if (origin && url.startsWith(origin) && isPortalAppUrl(url)) return true;
      return isPortalAppUrl(url);
    });
  } catch {
    return false;
  }
}

async function pollDevReload() {
  // Never overlap two polls. A poll does a storage read plus up to four network fetches, and the
  // 2.5 s interval is shorter than a slow one can take, so without this the polls stack up and the
  // worker accumulates in-flight work it can never drain — one more way for it to be killed
  // mid-operation by Chrome.
  if (devPollInFlight) return;
  devPollInFlight = true;
  try {
    await pollDevReloadInner();
  } catch (err) {
    // A dev-only convenience must never take the worker down with it.
    console.warn("[DA] dev poll failed", err);
  } finally {
    devPollInFlight = false;
  }
}

async function pollDevReloadInner() {
  const { recording, playing, pendingDevReload, pendingDevStamp } =
    await chrome.storage.local.get(["recording", "playing", "pendingDevReload", "pendingDevStamp"]);

  // Never tear down the service worker mid-record / mid-play (page refresh on target site is fine).
  if (recording || playing) {
    // Still detect updates and queue them for after finish.
    await detectDevStampChange({ queueOnly: true });
    return;
  }

  // Outside recording: only apply reload when user has the app open — not while browsing/recording targets.
  const appOpen = await hasOpenPortalAppTab();
  if (!appOpen) {
    if (pendingDevReload && pendingDevStamp) {
      // Keep stamp queued; apply next time app is open.
      return;
    }
    await detectDevStampChange({ queueOnly: true });
    return;
  }

  if (pendingDevReload && pendingDevStamp) {
    await chrome.storage.local.set({
      devStamp: pendingDevStamp,
      pendingDevReload: false,
      pendingDevStamp: null
    });
    console.info("[DA] applying deferred extension reload (app open, idle)");
    chrome.runtime.reload();
    return;
  }

  await detectDevStampChange({ queueOnly: false });
}

/** True while a dev poll is running; see pollDevReload. */
let devPollInFlight = false;
/** Handle for the repeating poll, so a play/record session can pause it. */
let devPollTimer = null;
/** Set while a run is in progress: the poll is suspended and touches nothing. */
let devPollSuspended = false;

/**
 * Pause or resume the dev poll around a run.
 *
 * A rebuild landing mid-run is never useful — the poll already refuses to reload while
 * `recording`/`playing` — but it still WAKES the worker every tick to make that decision, and a
 * worker that is being woken and torn down while it is driving a live run is the situation that
 * ends with "service worker terminated" in the middle of a step. Suspending for the duration
 * removes the churn from the one window where it actually hurts.
 */
function suspendDevPoll() {
  devPollSuspended = true;
  stopDevPoll();
}

function resumeDevPoll() {
  devPollSuspended = false;
  // Pick the cadence for the current situation: fast only while the portal page is actually open,
  // which is the one moment an author is waiting for a rebuild to land. Everywhere else the slow
  // idle cadence keeps the worker from being woken for a stamp nobody is watching for.
  applyDevPollCadence();
}

/**
 * Choose the poll cadence from what is on screen right now.
 *
 * A no-op while a run is in progress: the poll is off for the duration, and re-arming it here would
 * undo suspendDevPoll.
 */
function applyDevPollCadence() {
  if (devPollSuspended) return;
  hasOpenPortalAppTab()
    .then((open) => {
      if (devPollSuspended) return;
      startDevPoll(open ? DEV_POLL_MS_ACTIVE : DEV_POLL_MS_IDLE);
    })
    .catch(() => { startDevPoll(DEV_POLL_MS_IDLE); });
}

/**
 * Start (or restart) the repeating dev poll, at the SLOW cadence.
 *
 * Why slow: this poll is a development convenience — it auto-reloads the unpacked extension when
 * the server rebuilds it. In an MV3 service worker a `setInterval` does NOT keep the worker alive
 * the way it did in MV2, but a fast one still means the worker is woken constantly, which is the
 * expensive pattern Chrome's own guidance warns about and makes the worker far more likely to be
 * stopped at an inconvenient moment. 2.5 s only made sense when the poll WAS the keep-alive.
 * The portal-open case opts into the fast cadence below, and only while it is actually useful.
 */
function startDevPoll(ms) {
  if (devPollSuspended) return;
  if (devPollTimer) clearInterval(devPollTimer);
  devPollTimer = setInterval(pollDevReload, Math.max(1000, Number(ms) || DEV_POLL_MS_IDLE));
}

/** Stop the dev poll. Called when a run starts: a reload during a run is never wanted anyway. */
function stopDevPoll() {
  if (devPollTimer) clearInterval(devPollTimer);
  devPollTimer = null;
}

/**
 * A worker that dies with an unhandled rejection loses whatever run it was driving.
 *
 * This is a last line of defence, not a substitute for handling errors at the source: every path
 * the engine takes is expected to catch its own failures. But MV3 gives a service worker no
 * "restart where you left off" — if a stray rejected promise escapes, Chrome can tear the worker
 * down and an in-flight run stops with no explanation. Logging it keeps the worker (and the run)
 * alive and leaves a trace the operator can actually read.
 */
self.addEventListener("unhandledrejection", (ev) => {
  console.warn("[DA] unhandled rejection in service worker", ev.reason);
});

pollDevReload().catch(() => {});
// Cadence-aware on boot: a worker that starts while the portal is open should poll at the fast
// rate immediately, and one that starts with no portal open should stay on the slow rate rather
// than paying for a wake-up every 2.5 s to learn nothing changed.
applyDevPollCadence();
resumePendingPlayAfterReload();

async function detectDevStampChange({ queueOnly }) {
  const portal = await portalBase().catch(() => DEFAULT_PORTAL);
  const urls = [`${portal}/extension/dev-stamp`, ...DEV_STAMP_URLS];
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.stamp) continue;
      const { devStamp } = await chrome.storage.local.get("devStamp");
      const origin = new URL(url).origin;
      if (devStamp && devStamp !== data.stamp) {
        if (queueOnly) {
          await chrome.storage.local.set({
            pendingDevReload: true,
            pendingDevStamp: data.stamp,
            portalBase: origin,
            installPath: data.path || null
          });
          console.info("[DA] extension update queued (recording/play or no app tab)", data.version || "");
          return;
        }
        await chrome.storage.local.set({
          devStamp: data.stamp,
          pendingDevReload: false,
          pendingDevStamp: null,
          portalBase: origin,
          installPath: data.path || null
        });
        console.info("[DA] extension updated → reload", data.version || "", data.path || "");
        chrome.runtime.reload();
        return;
      }
      await chrome.storage.local.set({
        devStamp: data.stamp,
        portalBase: origin,
        installPath: data.path || null
      });
      return;
    } catch {
      /* portal not up yet */
    }
  }
}

DaTenantBranding.bootstrap().catch(() => {});

async function pullBrandingFromPortal() {
  try {
    const portal = await portalBase();
    const res = await fetch(`${portal}/extension/branding`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    await DaTenantBranding.persist(DaTenantBranding.normalize(data));
  } catch { /* offline */ }
}
pullBrandingFromPortal().catch(() => {});

// The dev poll is started by the lifecycle block near pollDevReload (see startDevPoll). It is NOT
// started here: this point runs on every worker wake-up, so starting it again would stack timers
// onto a worker that has just been revived rather than keeping exactly one poll alive.
//
// This runs on EVERY worker start, which is why it is the right place to check for a run that was
// killed: the only way to observe a terminated worker is from the worker that comes after it.
detectOrphanedPlay()
  .then((wasOrphaned) => {
    if (wasOrphaned) console.info("[DA] cleared an interrupted play run at startup");
  })
  .catch(() => {});
resumePendingPlayAfterReload();

// Context-menu selector copy lives in extension-selector (dedicated package).

