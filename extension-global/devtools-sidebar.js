/** Elements sidebar: build unique/relative selectors for $0 and copy via background. */

const preview = document.getElementById("preview");
const statusEl = document.getElementById("status");

function setStatus(msg, ok) {
  statusEl.textContent = msg || "";
  statusEl.className = ok === true ? "ok" : ok === false ? "err" : "";
}

/**
 * Eval selector builders against $0 in the inspected page.
 * Returns { unique, relative, tag, url, matchUnique, matchRelative } or error.
 */
function evalSelectorsForSelected(callback) {
  const expr = `(() => {
    const el = $0;
    if (!el || !(el instanceof Element)) return { ok: false, error: "المنتی انتخاب نشده ($0 خالی است)." };

    const esc = (s) => {
      try { return CSS.escape(String(s)); } catch {
        return String(s).replace(/([^\\w-])/g, "\\\\$1");
      }
    };
    const count = (sel) => {
      try { return document.querySelectorAll(sel).length; } catch { return 0; }
    };
    const ATTR = ["data-testid","data-test","data-qa","data-cy","data-id","name","aria-label","title","placeholder","role","type","href","alt"];

    function attrSel(node, name) {
      const v = node.getAttribute(name);
      if (v == null || v === "" || v.length > 80) return null;
      return node.tagName.toLowerCase() + "[" + name + "=\\"" + esc(v) + "\\"]";
    }

    function buildNth(node) {
      const parts = [];
      let n = node, g = 0;
      while (n && n.nodeType === 1 && g++ < 64) {
        if (n.id && count("#" + esc(n.id)) === 1) {
          parts.unshift("#" + esc(n.id));
          break;
        }
        const tag = n.tagName.toLowerCase();
        if (tag === "html" || tag === "body") { parts.unshift(tag); break; }
        const parent = n.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const same = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
        parts.unshift(tag + ":nth-of-type(" + (same.indexOf(n) + 1) + ")");
        n = parent;
      }
      return parts.join(" > ");
    }

    function shorten(full, node) {
      const parts = full.split(" > ").filter(Boolean);
      let best = full;
      for (let i = 1; i < parts.length; i++) {
        const cand = parts.slice(i).join(" > ");
        try {
          const nodes = document.querySelectorAll(cand);
          if (nodes.length === 1 && nodes[0] === node) best = cand;
          else break;
        } catch { break; }
      }
      return best;
    }

    function uniqueCss(node) {
      if (node.id) {
        const s = "#" + esc(node.id);
        if (count(s) === 1) return s;
      }
      for (const name of ATTR) {
        if (!node.hasAttribute(name)) continue;
        const s = attrSel(node, name);
        if (s && count(s) === 1) return s;
      }
      const full = buildNth(node);
      if (full && count(full) === 1) return shorten(full, node) || full;
      return full || node.tagName.toLowerCase();
    }

    function relativeCss(node) {
      const tag = node.tagName.toLowerCase();
      const classes = Array.from(node.classList || [])
        .filter((c) => c && c.length < 40 && !/^[a-f0-9]{6,}$/i.test(c) && !/^css-/.test(c))
        .slice(0, 3);
      if (classes.length) {
        const s = tag + "." + classes.map(esc).join(".");
        if (count(s) >= 1) return s;
      }
      for (const name of ["name","data-testid","role","type","placeholder","aria-label"]) {
        const s = attrSel(node, name);
        if (s && count(s) >= 1) return s;
      }
      const parent = node.parentElement;
      if (parent) {
        let pp = parent.tagName.toLowerCase();
        if (parent.id) pp = "#" + esc(parent.id);
        else {
          const pc = Array.from(parent.classList || []).filter((c) => c && !/^css-/.test(c)).slice(0, 1);
          if (pc.length) pp = pp + "." + esc(pc[0]);
        }
        const cp = classes.length ? tag + "." + esc(classes[0]) : tag;
        return pp + " > " + cp;
      }
      return tag;
    }

    const unique = uniqueCss(el);
    const relative = relativeCss(el);
    return {
      ok: true,
      unique,
      relative,
      tag: el.tagName.toLowerCase(),
      url: location.href,
      matchUnique: count(unique),
      matchRelative: count(relative)
    };
  })()`;

  chrome.devtools.inspectedWindow.eval(expr, (result, isException) => {
    if (isException || !result) {
      callback({ ok: false, error: (isException && isException.value) || "خواندن $0 ناموفق بود." });
      return;
    }
    callback(result);
  });
}

function refreshPreview() {
  evalSelectorsForSelected((res) => {
    if (!res?.ok) {
      preview.textContent = res?.error || "—";
      return;
    }
    preview.textContent =
      `یونیک (${res.matchUnique}): ${res.unique}\n\n`
      + `نسبی (${res.matchRelative}): ${res.relative}`;
  });
}

chrome.devtools.panels.elements.onSelectionChanged.addListener(refreshPreview);
refreshPreview();

document.querySelectorAll("button[data-kind]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.getAttribute("data-kind");
    const unique = btn.getAttribute("data-unique") === "1";
    evalSelectorsForSelected(async (res) => {
      if (!res?.ok) {
        setStatus(res?.error || "خطا", false);
        return;
      }
      const sel = unique ? res.unique : res.relative;
      const tabId = chrome.devtools.inspectedWindow.tabId;

      if (kind === "element") {
        try {
          await navigator.clipboard.writeText(sel);
          setStatus(`کپی شد (${unique ? "یونیک" : "نسبی"}): ${sel.slice(0, 80)}`, true);
        } catch {
          setStatus("کپی به کلیپ‌بورد ناموفق بود.", false);
        }
        preview.textContent = sel;
        return;
      }

      // frame / object → background (needs framePath + memory for object)
      const result = await chrome.runtime.sendMessage({
        type: "devtoolsCopy",
        tabId,
        frameId: 0,
        url: res.url,
        kind,
        unique,
        // Prefer selectors computed from $0 for object elementValue
        elementValue: sel,
        tag: res.tag
      }).catch((e) => ({ ok: false, error: e.message }));

      // For object: re-store with $0 selector if background used wrong frame capture
      if (kind === "object" && result?.ok) {
        const payload = {
          v: 1,
          kind: "da-selector",
          elementBy: "CssSelector",
          elementValue: sel,
          unique,
          mode: unique ? "unique" : "relative",
          framePath: [],
          url: res.url,
          tag: res.tag,
          copiedAt: new Date().toISOString()
        };
        await chrome.runtime.sendMessage({
          type: "setCopiedSelector",
          payload
        }).catch(() => null);
        try { await navigator.clipboard.writeText("DASEL:" + JSON.stringify(payload)); } catch { /* ignore */ }
        setStatus(`آبجکت ${unique ? "یونیک" : "نسبی"} در حافظه ذخیره شد.`, true);
        preview.textContent = sel;
        return;
      }

      if (kind === "frame") {
        if (result?.ok) {
          setStatus(`فریم ${unique ? "یونیک" : "نسبی"} کپی شد.`, true);
          preview.textContent = result.preview || result.selector || "[]";
        } else {
          setStatus(result?.error || "خطا در کپی فریم", false);
        }
        return;
      }

      setStatus(result?.error || "انجام شد", !!result?.ok);
    });
  });
});
