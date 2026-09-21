function cssPath(el) {
  if (!(el instanceof Element)) return "";
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    let sel = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(sel);
    node = parent;
    if (node && node.tagName === "BODY") {
      parts.unshift("body");
      break;
    }
  }
  return parts.join(" > ");
}

function isFromFab(el) {
  return !!(el && el.closest && el.closest("#da-recorder-fab, .da-recorder-root"));
}
