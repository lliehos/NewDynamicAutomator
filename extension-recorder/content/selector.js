/**
 * Recorder CSS path — unique by default (same rules as Selector extension).
 */

function isFromFab(el) {
  return !!(el && el.closest && el.closest("#da-recorder-fab, .da-recorder-root"));
}

function cssEscapeIdent(s) {
  try {
    return CSS.escape(String(s));
  } catch {
    return String(s).replace(/([^\w-])/g, "\\$1");
  }
}

function cssEscapeAttrValue(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function countMatches(sel) {
  if (!sel) return 0;
  try {
    return document.querySelectorAll(sel).length;
  } catch {
    return 0;
  }
}

function isUnique(sel) {
  return countMatches(sel) === 1;
}

const ATTR_PREFER = [
  "data-testid", "data-test", "data-qa", "data-cy", "data-id",
  "name", "aria-label", "title", "placeholder", "role", "type", "href", "alt"
];

function attrSelector(el, name) {
  const v = el.getAttribute(name);
  if (v == null || v === "") return null;
  if (v.length > 80) return null;
  return `${el.tagName.toLowerCase()}[${name}="${cssEscapeAttrValue(v)}"]`;
}

function buildNthPath(el) {
  const parts = [];
  let node = el;
  let guard = 0;
  while (node && node.nodeType === 1 && guard++ < 64) {
    if (node.id && isUnique(`#${cssEscapeIdent(node.id)}`)) {
      parts.unshift(`#${cssEscapeIdent(node.id)}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    if (tag === "html") {
      parts.unshift("html");
      break;
    }
    if (tag === "body") {
      parts.unshift("body");
      break;
    }
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    const idx = same.indexOf(node) + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    node = parent;
  }
  return parts.join(" > ");
}

function shortenUnique(fullPath, el) {
  const parts = fullPath.split(" > ").filter(Boolean);
  if (parts.length <= 1) return fullPath;
  let best = fullPath;
  for (let i = 1; i < parts.length; i++) {
    const cand = parts.slice(i).join(" > ");
    try {
      const nodes = document.querySelectorAll(cand);
      if (nodes.length === 1 && nodes[0] === el) best = cand;
      else break;
    } catch {
      break;
    }
  }
  return best;
}

function cssPathUnique(el) {
  if (!(el instanceof Element)) return "";
  if (el.id) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (isUnique(sel)) return sel;
  }
  for (const name of ATTR_PREFER) {
    if (!el.hasAttribute(name)) continue;
    const sel = attrSelector(el, name);
    if (sel && isUnique(sel)) return sel;
  }
  const full = buildNthPath(el);
  if (full && isUnique(full)) return shortenUnique(full, el) || full;
  return full || el.tagName.toLowerCase();
}

/** Recorded steps always use unique selectors. */
function cssPath(el) {
  return cssPathUnique(el);
}
