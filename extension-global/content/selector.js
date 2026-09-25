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

/**
 * Attribute names that frameworks/AJAX pages regenerate on every render. Anchoring a selector to
 * one of these produces a path that works once and then rots, so they are never used as an anchor.
 */
const VOLATILE_ATTR_NAMES = [
  "data-reactid", "data-react-checksum", "data-v-", "data-svelte-", "data-nonce",
  "data-csrf", "data-request", "data-timestamp", "data-ts", "data-rand", "data-key"
];

/**
 * True when a value looks machine-generated rather than authored.
 *
 * The failure this prevents: an id like `el_2551142555442xds` or a class like
 * `css-1x2y3z` is unique today but changes on the next render, so a recorded step silently stops
 * matching. Such values are rejected as anchors and the caller falls back to an element path.
 */
function isVolatileValue(value) {
  const v = String(value ?? "").trim();
  if (!v) return true;
  // Pure digits, or a long run of digits — an auto-increment / timestamp.
  if (/^\d+$/.test(v)) return true;
  if (/\d{6,}/.test(v)) return true;
  // hash-like: long hex or long mixed alphanumerics with little vowel structure.
  if (/^[a-f0-9]{8,}$/i.test(v)) return true;
  // Framework-generated prefixes seen in the wild, with or without a separator
  // (el_123, ember123, react-select-2, mui-1234, ng-1, vue-…).
  if (/^(el|ext|ember|react|ng|vue|css|jsx|mui|sc|radix|headlessui)([_-]|\d)/i.test(v)) return true;
  // A UUID.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  // A trailing short hash segment: foo__1a2b3c, foo_1a2b3c4d, widget-9f8e7d.
  if (/[_-][0-9a-f]{5,}$/i.test(v)) return true;
  return false;
}

/** True when an id is safe to anchor a selector to. */
function isStableId(id) {
  const v = String(id ?? "").trim();
  if (!v) return false;
  if (isVolatileValue(v)) return false;
  // Single-use synthetic ids also tend to be very long with no separator structure.
  if (v.length > 60) return false;
  return true;
}

/** True when an attribute name may be used as a selector anchor. */
function isStableAttrName(name) {
  const n = String(name ?? "").toLowerCase();
  if (!n) return false;
  return !VOLATILE_ATTR_NAMES.some((bad) => n === bad || n.startsWith(bad));
}

/** True when a value is safe to put in an attribute selector. */
function isStableAttrValue(value) {
  const v = String(value ?? "");
  if (!v || v.length > 80) return false;
  return !isVolatileValue(v);
}

function attrSelector(el, name) {
  const v = el.getAttribute(name);
  if (v == null || v === "") return null;
  if (v.length > 80) return null;
  // A volatile value must never become an anchor, even inside an otherwise-good attribute.
  if (!isStableAttrValue(v)) return null;
  if (!isStableAttrName(name)) return null;
  return `${el.tagName.toLowerCase()}[${name}="${cssEscapeAttrValue(v)}"]`;
}

/**
 * Unique CSS for an element inside this document/frame.
 * Always verifies querySelectorAll(sel).length === 1 (or best-effort full path).
 *
 * Order matters and encodes the stability preference the product needs:
 *   1. a *stable* unique id  (shortest, most readable, survives re-render)
 *   2. a *stable* unique attribute
 *   3. an element path from the root (Full-XPath style) — preferred over a volatile attribute,
 *      because a path stays correct as long as the structure does, while a generated id does not
 */
function cssPathUnique(el) {
  if (!(el instanceof Element)) return "";

  // 1) Unique id — but only when it looks authored rather than generated.
  if (el.id && isStableId(el.id)) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (isUnique(sel)) return sel;
  }

  // 2) Unique attribute on element (stable names/values only).
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

  // 4) An element with only a volatile id still needs *a* selector. Fall back to the raw id
  //    path so the step is at least recorded, and let the caller/validator flag instability.
  if (el.id) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (isUnique(sel)) return sel;
  }

  // 5) Fallback: absolute body path (may still collide only if DOM is exotic)
  return full || el.tagName.toLowerCase();
}

function buildNthPath(el) {
  const parts = [];
  let node = el;
  let guard = 0;
  while (node && node.nodeType === 1 && guard++ < 64) {
    // Stop early only at a *stable* unique id — a generated one would make the whole path rot.
    if (node.id && isStableId(node.id) && isUnique(`#${cssEscapeIdent(node.id)}`)) {
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
    // :nth-of-type keeps the path valid even when siblings are added or removed around it.
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

  // Meaningful classes (skip hashes / css-modules noise / generated names)
  const classes = Array.from(el.classList || [])
    .filter((c) => c && c.length < 40
      && !/^[a-f0-9]{6,}$/i.test(c)
      && !/^css-/.test(c)
      && !isVolatileValue(c))
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
    if (parent.id && isStableId(parent.id)) parentPart = `#${cssEscapeIdent(parent.id)}`;
    else {
      const pc = Array.from(parent.classList || [])
        .filter((c) => c && c.length < 40 && !/^css-/.test(c) && !isVolatileValue(c))
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
  // Same stability rule as cssPathUnique: a generated frame id is worse than a name/title or path.
  if (el.id && isStableId(el.id)) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (isUnique(sel)) return sel;
  }
  const tag = el.tagName.toLowerCase();
  const frameName = el.getAttribute("name");
  if (frameName) {
    const sel = `${tag}[name="${cssEscapeAttrValue(frameName)}"]`;
    if (isUnique(sel)) return sel;
  }
  const title = el.getAttribute("title");
  if (title) {
    const sel = `${tag}[title="${cssEscapeAttrValue(title)}"]`;
    if (isUnique(sel)) return sel;
  }
  return cssPathUnique(el);
}

/** Relative CSS for iframe/frame — may match several. */
function frameCssRelative(el) {
  if (!(el instanceof Element)) return "";
  const tag = el.tagName.toLowerCase();
  const frameName = el.getAttribute("name");
  if (frameName) return `${tag}[name="${cssEscapeAttrValue(frameName)}"]`;
  const title = el.getAttribute("title");
  if (title) return `${tag}[title="${cssEscapeAttrValue(title)}"]`;
  const src = el.getAttribute("src");
  if (src) {
    const short = src.length > 60 ? src.slice(0, 60) : src;
    return `${tag}[src*="${cssEscapeAttrValue(short)}"]`;
  }
  return tag;
}
