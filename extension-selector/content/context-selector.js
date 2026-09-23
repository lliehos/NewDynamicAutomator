/** Track right-clicked element and return CSS selector (unique or relative). */
(function () {
  let lastCtxEl = null;

  document.addEventListener(
    "contextmenu",
    (e) => {
      lastCtxEl = e.target instanceof Element ? e.target : null;
    },
    true
  );

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
        url: location.href
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || "خطا" });
    }
  });
})();
