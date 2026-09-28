/** Track the element targeted by a right-click, and by a right-DRAG box selection. */
(function () {
  let lastCtxEl = null;

  document.addEventListener(
    "contextmenu",
    (e) => {
      // A right-drag that just finished has already chosen the target; the contextmenu event that
      // follows the release must not overwrite it with whatever is under the cursor.
      if (dragTarget) {
        lastCtxEl = dragTarget;
        const resolved = dragTarget;
        dragTarget = null;
        lastWasBoxSelection = true;
        // The box-selection target is what a caller should highlight. Announced from inside the
        // handler rather than on mouseup: the browser fires contextmenu BEFORE mouseup for a
        // right-drag, so a mouseup-based publish has nothing left to publish.
        publishBoxTarget(resolved);
        return;
      }
      lastCtxEl = e.target instanceof Element ? e.target : null;
      lastWasBoxSelection = false;
    },
    true
  );

  // ---------------------------------------------------------------- right-drag box select
  //
  // Why: when several elements are enclosed, the user means "this group of things", and the only
  // element that is unambiguously the right target is their nearest common ancestor — the
  // container. Picking any single enclosed element would silently target one arbitrary member.
  //
  // The rectangle is drawn only for the RIGHT button. A left-button drag is the page's own
  // (text selection, sliders, drag handles), and hijacking it would break every site.
  const DRAG_MIN_PX = 6;   // below this it is a click, not a drag
  let box = null;          // the overlay element
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let dragTarget = null;   // decided target, consumed by the contextmenu handler
  /** True when the CURRENT lastCtxEl was chosen by a box drag rather than a plain right-click. */
  let lastWasBoxSelection = false;

  function isOurUi(el) {
    if (!(el instanceof Element)) return true;
    if (typeof isFromFab === "function" && isFromFab(el)) return true;
    return !!(el.closest && el.closest("#da-player-fab, #da-recorder-fab, #da-click-preview-box"));
  }

  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "da-click-preview-box";
    // position:fixed so page scrolling cannot shift it out from under the pointer; the
    // coordinates below are viewport coordinates to match.
    box.style.cssText = [
      "position:fixed", "z-index:2147483646", "pointer-events:none",
      "border:1px dashed #ea5455", "background:rgba(234,84,85,0.10)",
      "display:none", "left:0", "top:0", "width:0", "height:0"
    ].join(";");
    document.documentElement.appendChild(box);
    return box;
  }

  function hideBox() {
    if (box) box.style.display = "none";
  }

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;               // right button only
    if (isOurUi(e.target)) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    dragTarget = null;
    // A new right-press supersedes any drag target still waiting to be read.
    lastBoxTarget = null;
  }, true);

  document.addEventListener("mousemove", (e) => {
    if (e.buttons !== 2) {                    // right button no longer held
      if (dragging) { hideBox(); dragging = false; }
      return;
    }
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (!dragging) {
      if (dx < DRAG_MIN_PX && dy < DRAG_MIN_PX) return;   // still a click
      dragging = true;
      ensureBox();
    }
    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const b = ensureBox();
    b.style.display = "block";
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.style.width = `${dx}px`;
    b.style.height = `${dy}px`;
  }, true);

  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    if (!dragging) return;                    // a plain right-click: leave lastCtxEl to contextmenu
    hideBox();
    dragging = false;
    const boxRect = {
      left: Math.min(startX, e.clientX),
      top: Math.min(startY, e.clientY),
      right: Math.max(startX, e.clientX),
      bottom: Math.max(startY, e.clientY)
    };
    dragTarget = nearestCommonParentIn(boxRect);
    lastBoxTarget = dragTarget;
  }, true);

  /**
   * Announce the resolved drag target to anyone who cares (the click-preview).
   *
   * A synchronously dispatched CustomEvent rather than a shared variable read at contextmenu time:
   * both files register capture-phase `contextmenu` listeners, and their relative order follows
   * manifest order. An event removes that dependency — the consumer is told the moment the target
   * is known. (The browser fires mouseup BEFORE contextmenu for a right-drag, so by the time
   * contextmenu runs the target is already resolved; the resolution still lives in mouseup, where
   * the rectangle's final coordinates are known.)
   */
  function publishBoxTarget(el) {
    if (!(el instanceof Element)) return;
    try {
      document.dispatchEvent(new CustomEvent("da-box-selection", { detail: { element: el } }));
    } catch { /* a host without CustomEvent just loses the preview tint */ }
  }

  /**
   * The drag-resolved target, handed to whoever asks and then cleared.
   *
   * Consuming it matters: a plain right-click that follows a drag must resolve to whatever is under
   * the pointer, NOT to the previous drag's group ancestor. A lingering value would silently retarget
   * the next unrelated right-click.
   */
  let lastBoxTarget = null;
  window.__daTakeLastBoxTarget = () => {
    const el = lastBoxTarget;
    lastBoxTarget = null;
    return el;
  };

  /**
   * Every element whose box lies inside `r`, then the nearest ancestor containing them all.
   *
   * The answer is the SMALLEST element that still represents what the user enclosed — the point of
   * a drag is to mean "this whole thing", not one member of it:
   *   - several cells of one row  -> that <tr>
   *   - several rows of one table -> that <table>
   *   - one element               -> itself
   *
   * So the walk up from the first enclosed element stops at the first ancestor that contains all
   * the others. The one adjustment is that a pure layout wrapper is skipped on the way: enclosing
   * two rows has <tbody> as its nearest common ancestor, but <tbody> is inserted implicitly by the
   * parser, carries no attributes and is not something a selector can meaningfully target — the
   * element the user is pointing at is the <table>. Returning <tbody> would have produced a
   * selector that matches nothing an operator recognises.
   */
  const LAYOUT_WRAPPERS = new Set(["TBODY", "THEAD", "TFOOT", "COLGROUP"]);

  function nearestCommonParentIn(r) {
    const inside = [];
    const all = document.body ? document.body.querySelectorAll("*") : [];
    for (const el of all) {
      if (isOurUi(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      // Fully inside, not merely overlapping: a partial overlap means the user did not mean it.
      if (b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom) {
        inside.push(el);
      }
    }
    if (!inside.length) return null;
    if (inside.length === 1) return inside[0];
    // Walk up from the first element until the ancestor contains all the others too.
    let cur = inside[0];
    while (cur && cur !== document.documentElement) {
      if (inside.every((el) => cur.contains(el))) {
        // Skip past any layout wrapper so the target is the element the user sees. If the whole
        // chain is wrappers, the last one seen is still a better answer than null.
        let target = cur;
        while (target && LAYOUT_WRAPPERS.has(target.tagName) && target.parentElement) {
          target = target.parentElement;
        }
        return target;
      }
      cur = cur.parentElement;
    }
    return document.body;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "captureContextSelector") return;
    try {
      const el = lastCtxEl;
      if (!el || (typeof isFromFab === "function" && isFromFab(el))) {
        sendResponse({ ok: false, error: "عنصری انتخاب نشده است." });
        return;
      }
      const mode = message.mode === "relative" ? "relative" : "unique";
      const selector = mode === "relative"
        ? cssPathRelative(el)
        : cssPathUnique(el);
      const matchCount = (() => {
        try { return document.querySelectorAll(selector).length; } catch { return 0; }
      })();
      sendResponse({
        ok: true,
        selector,
        mode,
        matchCount,
        unique: matchCount === 1,
        tag: el.tagName?.toLowerCase() || "",
        url: location.href,
        // True when the target came from a right-drag box: the element is then the common
        // ancestor of a group rather than the thing under the pointer, and callers may want to
        // label the resulting node differently.
        fromBoxSelection: lastWasBoxSelection
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || "خطا" });
    }
  });
})();
