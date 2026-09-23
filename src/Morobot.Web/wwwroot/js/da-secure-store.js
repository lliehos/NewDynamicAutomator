/**
 * Encrypted localStorage facade for Morobot process/profile data.
 * Depends on da-crypto.js. Keeps an in-memory cache so sync callers still work.
 */
(function (global) {
  const USER_KEY = "da_local_user";
  const cache = Object.create(null);
  const readyWaiters = [];
  let bootstrapped = false;

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function currentUser() {
    const fromCookie = readCookie(USER_KEY);
    if (fromCookie) {
      try { localStorage.setItem(USER_KEY, fromCookie); } catch { /* ignore */ }
      return fromCookie;
    }
    try {
      return localStorage.getItem(USER_KEY) || "test";
    } catch {
      return "test";
    }
  }

  function tasksKey(user) {
    return "da_local_tasks__" + (user || currentUser());
  }

  function profileKey(user) {
    return "da_user_profile__" + (user || currentUser());
  }

  function ensureCrypto() {
    if (!global.DaCrypto) throw new Error("DaCrypto missing — load da-crypto.js first");
    return global.DaCrypto;
  }

  async function loadTasksFromDisk(user) {
    const key = tasksKey(user);
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { return []; }
    if (!raw) return [];
    const crypto = ensureCrypto();
    if (crypto.looksEncrypted(raw)) {
      try {
        const data = await crypto.decryptJson(raw);
        return Array.isArray(data) ? data : [];
      } catch {
        console.warn("[DaSecureStore] decrypt failed — key changed or data tampered");
        return [];
      }
    }
    // Legacy plaintext → migrate on next write
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function persistTasks(user, tasks) {
    const crypto = ensureCrypto();
    const enc = await crypto.encryptJson(tasks);
    localStorage.setItem(tasksKey(user), enc);
    localStorage.setItem(USER_KEY, user || currentUser());
  }

  function isActionNode(n) {
    return !!n && (n.kind === "action" || n.kind === "step");
  }

  function stepCountOf(t) {
    const fromGraph = t?.graph?.nodes?.filter((n) => isActionNode(n)).length || 0;
    return Math.max(fromGraph, Number(t?.stepCount) || 0);
  }

  function richnessOf(t) {
    const nodes = Array.isArray(t?.graph?.nodes) ? t.graph.nodes.length : 0;
    return nodes * 1000 + stepCountOf(t);
  }

  function tasksRichness(list) {
    return (Array.isArray(list) ? list : []).reduce((sum, t) => sum + richnessOf(t), 0);
  }

  /** Membership from incoming (allows deletes); per-id graph keeps the richer side. */
  function mergePreferRicherPerId(prev, incoming) {
    const prevById = new Map((prev || []).map((t) => [String(t.id), t]));
    return (incoming || []).map((t) => {
      const old = prevById.get(String(t.id));
      if (!old) return t;
      if (richnessOf(t) >= richnessOf(old)) {
        return {
          ...old,
          ...t,
          graph: t.graph?.nodes?.length ? t.graph : old.graph
        };
      }
      return {
        ...t,
        graph: old.graph,
        stepCount: old.stepCount ?? stepCountOf(old),
        groupCount: old.groupCount
      };
    });
  }

  async function bootstrap(user) {
    const u = user || currentUser();
    const key = tasksKey(u);
    const list = await loadTasksFromDisk(u);
    // Don't let a late bootstrap clobber a richer in-memory write (extension save race).
    const cached = cache[key];
    if (Array.isArray(cached) && tasksRichness(cached) > tasksRichness(list)) {
      bootstrapped = true;
      flushWaiters();
      return cached;
    }
    cache[key] = list;
    // Upgrade plaintext → encrypted immediately
    try {
      const raw = localStorage.getItem(key);
      if (raw && !ensureCrypto().looksEncrypted(raw)) {
        await persistTasks(u, list);
      }
    } catch { /* ignore */ }
    bootstrapped = true;
    flushWaiters();
    return list;
  }

  function flushWaiters() {
    while (readyWaiters.length) {
      try { readyWaiters.shift()(); } catch { /* ignore */ }
    }
  }

  function whenReady(cb) {
    if (typeof cb !== "function") return;
    if (bootstrapped) {
      cb();
      return;
    }
    readyWaiters.push(cb);
    bootstrap()
      .then(() => flushWaiters())
      .catch(() => {
        bootstrapped = true;
        flushWaiters();
      });
  }

  function readTasks(user) {
    const u = user || currentUser();
    const k = tasksKey(u);
    if (Object.prototype.hasOwnProperty.call(cache, k)) return cache[k];
    // Sync fallback: if still plaintext, parse; if encrypted, return [] until ready
    try {
      const raw = localStorage.getItem(k);
      if (!raw) {
        cache[k] = [];
        return cache[k];
      }
      if (ensureCrypto().looksEncrypted(raw)) {
        // Kick async load; return last known or empty
        bootstrap(u);
        cache[k] = cache[k] || [];
        return cache[k];
      }
      const parsed = JSON.parse(raw);
      cache[k] = Array.isArray(parsed) ? parsed : [];
      bootstrap(u); // migrate
      return cache[k];
    } catch {
      cache[k] = [];
      return cache[k];
    }
  }

  function writeTasks(tasks, user) {
    const u = user || currentUser();
    let list = Array.isArray(tasks) ? tasks : [];
    const key = tasksKey(u);
    const cached = cache[key];
    // Never let a stale extension pull wipe a richer in-memory graph (re-record race).
    if (Array.isArray(cached) && cached.length) {
      list = mergePreferRicherPerId(cached, list);
    }
    cache[key] = list;
    persistTasks(u, list).catch((err) => console.warn("[DaSecureStore] write failed", err));
    try {
      global.dispatchEvent(new CustomEvent("da-local-tasks", { detail: { user: u, tasks: list } }));
    } catch { /* ignore */ }
  }

  // Extension content-scripts run in an isolated world — they postMessage here so the
  // page's DaSecureStore cache + UI actually update after record/save.
  try {
    global.addEventListener("message", (ev) => {
      const d = ev?.data;
      if (!d || d.source !== "da-ext-bridge" || d.type !== "write-tasks") return;
      if (!Array.isArray(d.tasks)) return;
      writeTasks(d.tasks, d.user);
    });
  } catch { /* ignore */ }

  async function readProfile(user) {
    const u = user || currentUser();
    const key = profileKey(u);
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { return null; }
    if (!raw) return null;
    const crypto = ensureCrypto();
    if (crypto.looksEncrypted(raw)) {
      try { return await crypto.decryptJson(raw); } catch { return null; }
    }
    try {
      const obj = JSON.parse(raw);
      await writeProfile(obj, u);
      return obj;
    } catch {
      return null;
    }
  }

  async function writeProfile(profile, user) {
    const u = user || currentUser();
    const enc = await ensureCrypto().encryptJson(profile || {});
    localStorage.setItem(profileKey(u), enc);
  }

  async function packMrbt(payload) {
    return ensureCrypto().encodeMrbtFile(payload);
  }

  async function unpackMrbt(text) {
    return ensureCrypto().decodeMrbtFile(text);
  }

  // Auto-bootstrap
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => bootstrap().catch(() => {}));
    } else {
      bootstrap().catch(() => {});
    }
  }

  global.DaSecureStore = {
    currentUser,
    tasksKey,
    profileKey,
    readTasks,
    writeTasks,
    readProfile,
    writeProfile,
    bootstrap,
    whenReady,
    packMrbt,
    unpackMrbt
  };
})(typeof window !== "undefined" ? window : globalThis);
