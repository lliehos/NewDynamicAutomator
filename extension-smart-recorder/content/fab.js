/** Smart Recorder FAB — only when a smart session is active (injected by background). */
(async function initSmartFab() {
  if (window !== window.top) return;
  if (window.__daSmartFabInit || document.getElementById("da-smart-fab")) return;

  // Load the shared strings first so the FAB is created already in the right language.
  if (window.DaRecI18n) {
    try { await window.DaRecI18n.init(); } catch { /* fall back to defaults */ }
  }

  try {
    const { portalBase } = await chrome.storage.local.get("portalBase");
    const base = String(portalBase || "https://localhost:7201").replace(/\/$/, "");
    if (base && location.href.startsWith(base)) return;
  } catch { /* continue */ }

  // Do not mount on ordinary play/record pages — only during an active smart session.
  const boot = await chrome.runtime.sendMessage({ type: "getSmartState" }).catch(() => ({}));
  if (!boot?.active && !boot?.learningComplete) return;

  window.__daSmartFabInit = true;

  const markUrl = chrome.runtime.getURL("icons/mark.svg");
  const i18n = window.DaRecI18n;
  const tr = (key) => (i18n ? i18n.t(key) : key);
  const root = document.createElement("div");
  root.className = "da-smart-root";
  root.id = "da-smart-fab";
  root.hidden = true;
  root.innerHTML = `
    <div class="da-smart-guide" id="da-smart-guide" hidden>
      <span class="da-smart-guide-line">
        <span class="da-smart-guide-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>${tr("fab.guideClick")}</kbd></span>
        <span class="da-smart-guide-text" data-guide="condition"></span>
      </span>
      <span class="da-smart-guide-line">
        <span class="da-smart-guide-keys"><kbd>${tr("fab.guideClick")}</kbd></span>
        <span class="da-smart-guide-text" data-guide="action"></span>
      </span>
    </div>
    <button type="button" class="da-smart-save" id="da-smart-save" title="Save" aria-label="Save" hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>
    </button>
    <button type="button" class="da-smart-logo-btn" id="da-smart-toggle" title="Stop thinking" aria-label="Stop thinking">
      <img src="${markUrl}" width="56" height="56" alt="${tr("fab.markAlt")}" />
    </button>
  `;
  document.documentElement.appendChild(root);
  Object.assign(root.style, {
    position: "fixed", left: "18px", right: "auto", bottom: "18px", top: "auto",
    zIndex: "2147483647"
  });

  const logoBtn = root.querySelector("#da-smart-toggle");
  const saveBtn = root.querySelector("#da-smart-save");
  const guide = root.querySelector("#da-smart-guide");

  /**
   * Show/hide the gesture guide.
   *
   * There is no other way to discover that Ctrl+Shift+click marks a condition - nothing in the
   * page hints at it - so the guide appears while a session is active and can be collapsed.
   * The choice is remembered so a user who has read it once is not shown it on every page.
   */
  const GUIDE_KEY = "fabGuideHidden";
  let guideHidden = false;

  async function restoreGuidePref() {
    try {
      const stored = await chrome.storage.local.get(GUIDE_KEY);
      guideHidden = !!(stored && stored[GUIDE_KEY]);
    } catch { /* show the guide by default */ }
    applyGuideVisibility();
  }

  function applyGuideVisibility() {
    const active = !root.hidden;
    guide.hidden = !active || guideHidden;
  }

  guide.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    guideHidden = true;
    applyGuideVisibility();
    try { await chrome.storage.local.set({ [GUIDE_KEY]: true }); } catch { /* best effort */ }
  });
  guide.addEventListener("pointerdown", (ev) => ev.stopPropagation());

  /**
   * Let the user move the FAB out of the way, and remember where they put it.
   *
   * The FAB sits over the page being recorded, and on many sites that corner holds a real
   * control. The position is kept in chrome.storage.local so it survives navigation between
   * pages of the same session, not just a single page load.
   *
   * Stored as a distance from one horizontal edge and one vertical edge with the fractions
   * (0..1) of the space available, rather than absolute pixels. A page can be narrower than
   * the one the position was chosen on - a resized window, a different tab - and pixels would
   * put the FAB off-screen. Fractions keep it at the same relative spot and it is clamped back
   * inside the viewport on every restore.
   */
  const FAB_POS_KEY = "fabPosition";
  const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag, not a click

  let dragState = null;

  function viewportSize() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0
    };
  }

  /** Apply a stored {x, y} fraction pair, clamped so the FAB is always fully on screen. */
  function applyStoredPosition(pos) {
    const { w, h } = viewportSize();
    const rect = root.getBoundingClientRect();
    const fabW = rect.width || 56;
    const fabH = rect.height || 56;
    const margin = 18;

    if (!pos || typeof pos.fx !== "number" || typeof pos.fy !== "number") return;
    const fx = Math.min(1, Math.max(0, pos.fx));
    const fy = Math.min(1, Math.max(0, pos.fy));

    const usableX = Math.max(0, w - fabW - margin * 2);
    const usableY = Math.max(0, h - fabH - margin * 2);
    const left = margin + usableX * fx;
    const top = margin + usableY * fy;

    Object.assign(root.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: "auto",
      bottom: "auto"
    });
  }

  async function restorePosition() {
    try {
      const stored = await chrome.storage.local.get(FAB_POS_KEY);
      applyStoredPosition(stored && stored[FAB_POS_KEY]);
    } catch { /* keep the default corner */ }
  }

  async function savePosition() {
    const { w, h } = viewportSize();
    const rect = root.getBoundingClientRect();
    const margin = 18;
    const usableX = Math.max(1, w - rect.width - margin * 2);
    const usableY = Math.max(1, h - rect.height - margin * 2);
    const pos = {
      fx: Math.min(1, Math.max(0, (rect.left - margin) / usableX)),
      fy: Math.min(1, Math.max(0, (rect.top - margin) / usableY))
    };
    try { await chrome.storage.local.set({ [FAB_POS_KEY]: pos }); } catch { /* best effort */ }
  }

  root.addEventListener("pointerdown", (ev) => {
    // Only the primary button, and never from the save button: that one is a plain action.
    if (ev.button !== 0) return;
    if (ev.target.closest("#da-smart-save")) return;
    const rect = root.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false
    };
    // Keeps receiving move events even if the pointer leaves the element.
    root.setPointerCapture?.(ev.pointerId);
  });

  root.addEventListener("pointermove", (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragState.moved) {
      dragState.moved = true;
      root.classList.add("is-dragging");
    }
    ev.preventDefault();

    const { w, h } = viewportSize();
    const rect = root.getBoundingClientRect();
    const maxLeft = Math.max(0, w - rect.width);
    const maxTop = Math.max(0, h - rect.height);
    const left = Math.min(maxLeft, Math.max(0, dragState.originLeft + dx));
    const top = Math.min(maxTop, Math.max(0, dragState.originTop + dy));

    Object.assign(root.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: "auto",
      bottom: "auto"
    });
  });

  function endDrag(ev) {
    if (!dragState || (ev && ev.pointerId !== dragState.pointerId)) return;
    const wasDrag = dragState.moved;
    dragState = null;
    root.classList.remove("is-dragging");
    if (wasDrag) {
      savePosition();
      // Stop the click that follows the release from also toggling the FAB, which would look
      // like the drag had triggered Stop/thinking-complete by accident.
      root.addEventListener("click", (clickEv) => {
        clickEv.preventDefault();
        clickEv.stopPropagation();
      }, { capture: true, once: true });
    }
  }

  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  // A window resize can invalidate the fractions, so re-apply them rather than leaving the FAB
  // where it happens to be.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      try {
        const stored = await chrome.storage.local.get(FAB_POS_KEY);
        applyStoredPosition(stored && stored[FAB_POS_KEY]);
      } catch { /* ignore */ }
    }, 150);
  });

  restorePosition();
  restoreGuidePref();

  function applyLabels() {
    const label = tr(logoBtn.classList.contains("save-ready") ? "fab.learningComplete" : "fab.stopThinking");
    // The action and the drag hint are both true of the same button, so the tooltip says both:
    // the click's meaning, then how to move it out of the way.
    const withHint = `${label} — ${tr("fab.dragHint")}`;
    logoBtn.title = withHint;
    logoBtn.setAttribute("aria-label", withHint);
    const saveLabel = tr("fab.save");
    saveBtn.title = saveLabel;
    saveBtn.setAttribute("aria-label", saveLabel);
    const img = logoBtn.querySelector("img");
    if (img) img.alt = tr("fab.markAlt");
    // The guide is the only place the gesture is documented, so it has to follow the language
    // like everything else.
    const condText = guide.querySelector('[data-guide="condition"]');
    const actionText = guide.querySelector('[data-guide="action"]');
    if (condText) condText.textContent = tr("fab.guideCondition");
    if (actionText) actionText.textContent = tr("fab.guideAction");
    const condKeys = guide.querySelectorAll(".da-smart-guide-keys");
    if (condKeys[1]) condKeys[1].querySelector("kbd").textContent = tr("fab.guideClick");
    guide.title = tr("fab.guideToggle");
    if (i18n) root.setAttribute("dir", i18n.dir());
  }

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "getSmartState" }).catch(() => ({}));
    const active = !!state.active;
    const learningComplete = !!state.learningComplete;
    root.hidden = !active && !learningComplete;
    logoBtn.classList.toggle("thinking", active && !learningComplete);
    logoBtn.classList.toggle("save-ready", learningComplete);
    applyLabels();
    applyGuideVisibility();
    if (learningComplete) {
      saveBtn.hidden = false;
      saveBtn.classList.add("show");
    } else {
      saveBtn.hidden = true;
      saveBtn.classList.remove("show");
    }
  }

  logoBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "stopSmartThinking" }).catch(() => {});
    await refresh();
  });

  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: "saveSmartResult" }).catch(() => {});
    await refresh();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "smartStateChanged") refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.smartActive || changes.smartLearningComplete || changes.smartSessionId)) {
      refresh();
    }
  });
  if (i18n) i18n.onChange(() => applyLabels());

  refresh();
})();
