/**
 * Manual-click preview — outline the element the operator just clicked.
 *
 * Why this exists: before running a flow, the operator needs to know WHICH element the next
 * action will target. The run itself highlights its target, but that only happens while the
 * engine is driving the page. This shows the same thing for a HUMAN click, so a flow can be
 * checked by hand before it is executed.
 *
 * Rules that matter (from the owner):
 *   - NOT while a run is in progress. During playback the engine does its own highlighting, and
 *     a second outline chasing the user's stray clicks would fight it.
 *   - It IS active while recording and in normal browsing.
 *   - The outline fades out after a couple of seconds; it is a hint, not a mark.
 *
 * Deliberately a separate file: mounting logic for the recorder HUD bails out on portal pages and
 * when the player owns the tab, and this preview must behave the same everywhere.
 */
(function () {
  if (window !== window.top) return;
  if (window.__daClickPreview) return;
  window.__daClickPreview = true;

  const FADE_MS = 2000;      // how long the outline stays fully visible
  const FADE_OUT_MS = 400;   // the fade itself
  const WIDTH = 3;
  const DEFAULT_COLOR = "#ea5455";

  /** The element currently outlined, so it can be cleaned up precisely. */
  let shownEl = null;
  let hideTimer = null;
  let colorCache = { value: DEFAULT_COLOR, at: 0 };
  let isRecording = false;

  /**
   * Are we on the Morobot panel itself?
   *
   * The outline must NOT run there: on our own pages the user is clicking the application, not a
   * target element, so an outline on every click is noise over the UI they are trying to use
   * (the owner hit exactly this). Detected the same way portal-bridge.js does it — the configured
   * portal origin, plus the /Panel and /Admin path prefixes — so the two agree on what "our page"
   * means and a self-hosted portal on another host is still recognised.
   */
  let onPortal = /^\/(Panel|Admin)(\/|$)/i.test(location.pathname || "/");
  /**
   * Storage is not reachable from every context this script runs in.
   *
   * The content script is declared `all_frames: true`, so it is injected into every sub-frame on
   * the page, and in some of those (and in pages that were already open when the extension
   * reloaded) `chrome.storage` is absent. Touching it at top level then threw on load — the error
   * the owner saw — and took the whole preview down with it. Every access goes through here, so a
   * missing API degrades to "no preview" instead of a broken content script.
   */
  function storageGet(keys) {
    try {
      if (!chrome?.storage?.local?.get) return Promise.resolve({});
      return chrome.storage.local.get(keys);
    } catch {
      return Promise.resolve({});
    }
  }

  function refreshPortalFlag() {
    storageGet(["portalBase"])
      .then((d) => {
        const base = String(d.portalBase || "").replace(/\/$/, "");
        if (base && location.href.startsWith(base)) onPortal = true;
      })
      .catch(() => { /* keep the path-based answer */ });
  }
  refreshPortalFlag();

  /**
   * Is a run in progress?
   *
   * The answer has to be available SYNCHRONOUSLY, at the moment of the click, because storage can
   * only be read asynchronously. So this keeps a local flag that:
   *   - starts `false` (a page normally loads outside a run, and this feature is meant to work
   *     when nothing is running),
   *   - is updated the instant the engine toggles `playing` (storage.onChanged), which is the
   *     only way a run can begin,
   *   - is re-read from storage on a slow timer as a safety net for a missed event.
   *
   * The one gap is a click that lands between the run starting and the event being delivered —
   * sub-millisecond in practice, and the worst case is one stale outline that fades in 2s.
   */
  let isPlaying = false;
  function refreshPlaying() {
    storageGet(["playing", "recording", "recordPhase"])
      .then((d) => {
        isPlaying = !!d.playing;
        // Recording counts as "armed": every click there becomes a step, so the operator needs to
        // see which element each one targets. Outside recording and playback the outline is only
        // shown for a right-click / right-drag, where choosing a target is the actual question.
        isRecording = !!d.recording || d.recordPhase === "recording";
      })
      .catch(() => { /* keep the last known value */ });
  }
  // Prime from storage, and keep it fresh even if an onChanged event is ever missed.
  refreshPlaying();
  setInterval(refreshPlaying, 3000);

  // The engine flips `playing` as a run starts and stops. Reacting here (rather than polling)
  // is what makes the boundary crisp: the preview is suppressed the moment a run begins and
  // returns the moment it ends.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.playing) return;
      isPlaying = !!changes.playing.newValue;
    });
  } catch { /* no onChanged: the timer still keeps us honest */ }

  /**
   * The colour configured on the process start node.
   *
   * Read from storage rather than from a message, so the preview still works when no run is
   * active (which is exactly when the operator is preparing one). Falls back to the same default
   * the engine uses so the hint never silently disappears.
   */
  function getColor() {
    const now = Date.now();
    if (now - colorCache.at < 5000) return colorCache.value;
    storageGet(["da_preview_highlight_color"])
      .then((d) => {
        const v = String(d.da_preview_highlight_color || "").trim();
        colorCache = { value: /^#[0-9a-fA-F]{6}$/.test(v) ? v : DEFAULT_COLOR, at: Date.now() };
      })
      .catch(() => { /* ignore */ });
    return colorCache.value;
  }

  /** Remove the outline from whatever we styled, restoring the page as we found it. */
  function clear() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const el = shownEl;
    shownEl = null;
    if (!el) return;
    try {
      // Transition the properties back so the fade applies to removal too.
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
      el.style.removeProperty("transition");
      el.classList.remove("da-click-preview");
    } catch { /* element may be gone */ }
  }

  function show(el) {
    if (!(el instanceof Element)) return;
    if (!shouldPreview()) return;
    // Never draw over our own HUD, and never on the portal chrome itself.
    if (typeof isFromFab === "function" && isFromFab(el)) return;
    if (el.closest && el.closest("#da-player-fab, #da-recorder-fab")) return;

    if (el === shownEl) {
      // Same element clicked again — just extend its life.
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(startFade, FADE_MS);
      return;
    }

    clear();
    const c = getColor();
    try {
      el.style.setProperty("outline", `${WIDTH}px solid ${c}`, "important");
      el.style.setProperty("outline-offset", "2px", "important");
      el.style.setProperty("transition", `outline-color ${FADE_OUT_MS}ms ease, outline-width ${FADE_OUT_MS}ms ease`, "important");
      el.classList.add("da-click-preview");
    } catch { /* ignore */ }
    shownEl = el;
    hideTimer = setTimeout(startFade, FADE_MS);
  }

  /** Fade, then remove. `outline-color` fades; `outline-width` is what actually disappears. */
  function startFade() {
    const el = shownEl;
    if (!el) return;
    try {
      el.style.setProperty("outline-color", "transparent", "important");
      el.style.setProperty("outline-width", "0px", "important");
    } catch { /* ignore */ }
    hideTimer = setTimeout(clear, FADE_OUT_MS);
  }

  /** Should this interaction be previewed at all? */
  function shouldPreview() {
    // Our own panel: the user is operating the application, not aiming at a target element.
    if (onPortal) return false;
    // During playback the engine draws its own outline on the element it is about to act on.
    if (isPlaying) return false;
    return true;
  }

  // LEFT click — only meaningful while RECORDING.
  //
  // Recording turns each click into a step, so seeing which element each one targets is the whole
  // point. Outside recording a plain left click is just the user browsing, and outlining every one
  // of them is noise — the owner asked for exactly this distinction.
  //
  // Capture phase so the preview is drawn even when the page stops propagation, and so it is
  // applied before the page's own handler can navigate away or re-render the target.
  document.addEventListener("click", (e) => {
    if (!shouldPreview()) return;
    if (!isRecording) return;
    if (e.button != null && e.button !== 0) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    show(el);
  }, true);

  // RIGHT button — meaningful whenever playback is not running, recording or not.
  //
  // A right-click (or a right-drag box) is how the user picks a target: for "copy selector" and
  // for "build element". That is precisely the moment "which element(s) am I aiming at?" is the
  // live question, so the outline answers it here whether or not a recording is in progress.
  //
  // If a DRAG just finished, context-selector.js has resolved the enclosed group to one ancestor,
  // and THAT is what the selector will target — not the element under the pointer. The two differ
  // exactly when it matters: dragging across a row's cells leaves the pointer over the last <td>,
  // but the target is the parent <tr>. The resolved ancestor is preferred here so the wrong
  // single-element outline is never drawn at all.
  document.addEventListener("contextmenu", (e) => {
    if (!shouldPreview()) return;
    const dragged = typeof window.__daTakeLastBoxTarget === "function"
      ? window.__daTakeLastBoxTarget()
      : null;
    if (dragged instanceof Element) { show(dragged); return; }
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    show(el);
  }, true);

  // A navigation or a DOM swap would leave the outline on a detached node; drop it on page hide.
  window.addEventListener("pagehide", clear, { once: false });
})();
