/** Track right-clicked element and return its CSS selector for context-menu copy. */
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
      sendResponse({
        ok: true,
        selector: cssPath(el),
        tag: el.tagName?.toLowerCase() || "",
        url: location.href
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || "خطا" });
    }
  });
})();
