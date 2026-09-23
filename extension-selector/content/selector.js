/**
 * CSS selector builders — unique (len===1) and relative (may match many).
 * Shared by context menu + frames describe.
 */

function isFromFab(el) {
  return !!(el && el.closest && el.closest(
    "#da-recorder-fab, #da-player-fab, #da-selector-fab, .da-recorder-root"
  ));
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

/** Prefer stable attribute keys for uniqueness probes. */
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

/**
 * Unique CSS for an element inside this document/frame.
 * Always verifies querySelectorAll(sel).length === 1 (or best-effort full path).
 */
function cssPathUnique(el) {
  if (!(el instanceof Element)) return "";

  // 1) Unique id
  if (el.id) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (isUnique(sel)) return sel;
  }

  // 2) Unique attribute on element
  for (const name of ATTR_PREFER) {
    if (!el.hasAttribute(name)) continue;
    const sel = attrSelector(el, name);
    if (sel && isUnique(sel)) return sel;
  }

  // 3) Build full nth-of-type path from body, then shorten from the left
  //    while keeping uniqueness.
  const full = buildNthPath(el);
  if (full && isUnique(full)) {
    const shortened = shortenUnique(full, el);
    return shortened || full;
  }

  // 4) Fallback: absolute body path (may still collide only if DOM is exotic)
  return full || el.tagName.toLowerCase();
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

/** Drop leftmost segments while the remainder still uniquely matches `el`. */
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

/**
 * Relative / non-unique CSS — short, readable, may match several nodes.
 * Useful for dynamic lists / repeating rows.
 */
function cssPathRelative(el) {
  if (!(el instanceof Element)) return "";

  const tag = el.tagName.toLowerCase();

  // Meaningful classes (skip hashes / css-modules noise)
  const classes = Array.from(el.classList || [])
    .filter((c) => c && c.length < 40 && !/^[a-f0-9]{6,}$/i.test(c) && !/^css-/.test(c))
    .slice(0, 3);
  if (classes.length) {
    const sel = `${tag}.${classes.map(cssEscapeIdent).join(".")}`;
    if (countMatches(sel) >= 1) return sel;
  }

  for (const name of ["name", "data-testid", "role", "type", "placeholder", "aria-label"]) {
    const sel = attrSelector(el, name);
    if (sel && countMatches(sel) >= 1) return sel;
  }

  // Parent landmark + tag (intentionally loose)
  const parent = el.parentElement;
  if (parent) {
    let parentPart = parent.tagName.toLowerCase();
    if (parent.id) parentPart = `#${cssEscapeIdent(parent.id)}`;
    else {
      const pc = Array.from(parent.classList || [])
        .filter((c) => c && c.length < 40 && !/^css-/.test(c))
        .slice(0, 1);
      if (pc.length) parentPart = `${parentPart}.${cssEscapeIdent(pc[0])}`;
    }
    const childPart = classes.length
      ? `${tag}.${cssEscapeIdent(classes[0])}`
      : tag;
    return `${parentPart} > ${childPart}`;
  }

  return tag;
}

/** Default export used by older call sites — unique. */
function cssPath(el) {
  return cssPathUnique(el);
}

/**
 * Unique CSS for an iframe/frame element inside its parent document.
 */
function frameCssUnique(el) {
  if (!(el instanceof Element)) return "";
  if (el.id) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (isUnique(sel)) return sel;
  }
  const tag = el.tagName.toLowerCase();
  const frameName = el.getAttribute("name");
  if (frameName) {
    const sel = `${tag}[name="${cssEscapeIdent(frameName)}"]`;
    if (isUnique(sel)) return sel;
  }
  const title = el.getAttribute("title");
  if (title) {
    const sel = `${tag}[title="${cssEscapeIdent(title)}"]`;
    if (isUnique(sel)) return sel;
  }
  return cssPathUnique(el);
}

/** Relative CSS for iframe/frame — may match several. */
function frameCssRelative(el) {
  if (!(el instanceof Element)) return "";
  const tag = el.tagName.toLowerCase();
  const frameName = el.getAttribute("name");
  if (frameName) return `${tag}[name="${cssEscapeIdent(frameName)}"]`;
  const title = el.getAttribute("title");
  if (title) return `${tag}[title="${cssEscapeIdent(title)}"]`;
  const src = el.getAttribute("src");
  if (src) {
    const short = src.length > 60 ? src.slice(0, 60) : src;
    return `${tag}[src*="${cssEscapeIdent(short)}"]`;
  }
  return tag;
}
