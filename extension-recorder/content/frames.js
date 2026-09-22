chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "describeChildIframe") {
    sendResponse(describeChild(message.childUrl, message.indexInParent));
  }
});

function describeChild(childUrl, indexInParent) {
  const nodes = Array.from(document.querySelectorAll("iframe, frame"));
  let el = nodes.find((n) => n.src && childUrl && childUrl.indexOf(n.src) !== -1);
  if (!el && indexInParent >= 0) el = nodes[indexInParent];
  if (!el) return null;
  return {
    by: "CssSelector",
    value: cssPath(el),
    srcHint: el.getAttribute("src") || childUrl,
    indexInParent
  };
}
