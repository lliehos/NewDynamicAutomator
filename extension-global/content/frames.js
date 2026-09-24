chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "describeChildIframe") {
    sendResponse(describeChild(message.childUrl, message.indexInParent, message.mode));
  }
});

function describeChild(childUrl, indexInParent, mode) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = nodes.find((n) => n.src && childUrl && childUrl.indexOf(n.src) !== -1);
  if (!el && indexInParent >= 0) el = nodes[indexInParent];
  if (!el) return null;
  const relative = mode === "relative";
  return {
    by: "CssSelector",
    value: relative ? frameCssRelative(el) : frameCssUnique(el),
    srcHint: el.getAttribute("src") || childUrl,
    indexInParent,
    unique: !relative
  };
}
