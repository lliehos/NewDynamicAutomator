using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Morobot.Domain.Enums;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// Translates the legacy automation schema's selector / condition values into the current app's
/// graph format.
/// </summary>
/// <remarks>
/// The legacy database stored a selector as a single free-text <c>Selectors.ElementValue</c> and
/// expressed branching with a <c>ConditionGroups</c> row per step plus success/fail group edges.
/// This app instead stores a *typed* selector (<c>{By, Value}</c>) and has no condition-group
/// entity: consecutive conditions in a sequence mean AND, parallel branches mean OR.
///
/// Two rules drive everything here:
/// 1. A legacy selector must become a valid typed selector, never a raw string, or the runner
///    cannot resolve it.
/// 2. Dropping information silently is worse than keeping a lossy-but-labelled mapping, so every
///    branch taken is recorded in the notes list for the import report.
/// </remarks>
public static class LegacySelectorNormalizer
{
    /// <summary>Result of normalizing one legacy selector string.</summary>
    public sealed class NormalizedSelector
    {
        /// <summary>Legacy kind, kept for auditing. The new engine has no selector-type field: it is CSS-only.</summary>
        public SelectorBy By { get; init; } = SelectorBy.CssSelector;
        /// <summary>Selector body — ALWAYS a valid CSS selector (empty when <see cref="Managed"/>).</summary>
        public string Value { get; init; } = string.Empty;
        /// <summary>
        /// True when the legacy selector cannot be expressed in CSS (LinkText, text() XPath, exotic
        /// axes …). Nothing runnable is emitted; the legacy text is preserved for a manual fix.
        /// </summary>
        public bool Managed { get; init; }
        /// <summary>
        /// The legacy text preserved verbatim. Kept because a lossy conversion must stay
        /// auditable, and because a later re-import may be able to do better.
        /// </summary>
        public string LegacyValue { get; init; } = string.Empty;
        /// <summary>Human-readable notes about what the conversion did.</summary>
        public List<string> Notes { get; } = new();
        /// <summary>False when nothing runnable could be produced (caller should flag the step).</summary>
        public bool Ok => !Managed && !string.IsNullOrWhiteSpace(Value);
    }

    /// <summary>
    /// Convert a legacy selector string into a typed selector.
    ///
    /// Recognised legacy shapes, in priority order:
    /// <list type="bullet">
    /// <item><c>by=value</c> — an explicit type prefix, e.g. <c>xpath=//div[@id='a']</c>.</item>
    /// <item>a JSON object already carrying <c>by</c>/<c>By</c> + <c>value</c>/<c>Value</c>.</item>
    /// <item>a bare string starting with <c>//</c>, <c>(//</c> or <c>/html</c> — an XPath.</item>
    /// <item>a bare string starting with <c>#</c>, <c>.</c>, <c>[</c>, <c>*</c> or a tag name
    ///       followed by one of those — a CSS selector.</item>
    /// <item>anything else — treated as a CSS selector, but noted, because a legacy value like
    ///       <c>el_2551142555442xds</c> is an id candidate rather than a selector.</item>
    /// </list>
    /// </summary>
    public static NormalizedSelector Normalize(string? legacy)
    {
        var raw = (legacy ?? string.Empty).Trim();
        var result = new NormalizedSelector { LegacyValue = raw };
        if (raw.Length == 0)
        {
            result.Notes.Add("سلکتور قدیمی خالی بود.");
            return result;
        }

        // A JSON object may already carry an explicit By/Value pair.
        if (raw.StartsWith('{') && raw.EndsWith('}'))
        {
            if (TryReadTypedJson(raw, out var by, out var value))
                return Finish(result, by, value, "سلکتور از JSON تایپ‌دار خوانده شد.");

            // A JSON body that is not a typed selector is an unknown shape — keep it as CSS text
            // so the editor still shows something rather than an empty node.
            result.Notes.Add("JSON سلکتور شناسایی نشد؛ به‌صورت متن خام CSS نگه داشته شد.");
            return Finish(result, SelectorBy.CssSelector, raw, null);
        }

        // "by=value" prefix form.
        var eq = raw.IndexOf('=');
        if (eq > 0 && eq < 12)
        {
            var prefix = raw[..eq].Trim().ToLowerInvariant();
            var body = raw[(eq + 1)..].Trim();
            if (body.Length > 0 && TryMapBy(prefix, out var prefixedBy))
                return Finish(result, prefixedBy, body, $"سلکتور با پیشوند «{prefix}=» تشخیص داده شد.");
        }

        // A leading "by:" form, also produced by some legacy versions.
        var colon = raw.IndexOf(':');
        if (colon > 0 && colon < 12)
        {
            var prefix = raw[..colon].Trim().ToLowerInvariant();
            var body = raw[(colon + 1)..].Trim();
            // Careful: ":nth-of-type(...)" and "div:first-child" start with a tag, and a CSS
            // pseudo-class would be misread here, so only accept a known type word.
            if (body.Length > 0 && TryMapBy(prefix, out var colonBy) && !LooksLikeCssTag(prefix))
                return Finish(result, colonBy, body, $"سلکتور با پیشوند «{prefix}:» تشخیص داده شد.");
        }

        // Full XPath — the legacy "full xpath" form the task calls out explicitly.
        if (LooksLikeXPath(raw))
            return Finish(result, SelectorBy.XPath, raw, "به‌عنوان XPath کامل شناسایی شد.");

        // A bare id attribute (legacy stored these without the '#'). Must be checked before the
        // generic CSS branch, otherwise it becomes an invalid tag selector.
        if (LooksLikeGeneratedId(raw))
            return Finish(result, SelectorBy.Id, raw, "به‌عنوان شناسه (Id) شناسایی شد، نه سلکتور CSS.");

        // Anything else: CSS, since that is the only tolerated general form.
        result.Notes.Add("به‌صورت سلکتور CSS نگه داشته شد.");
        return Finish(result, SelectorBy.CssSelector, raw, null);
    }

    private static NormalizedSelector Finish(
        NormalizedSelector result, SelectorBy by, string value, string? note)
    {
        var raw = (value ?? string.Empty).Trim();
        var notes = new List<string>(result.Notes);
        if (!string.IsNullOrWhiteSpace(note)) notes.Add(note);

        var (css, managed, managedNote) = ToCss(by, raw, notes);
        var final = new NormalizedSelector
        {
            By = by,
            Value = css,
            Managed = managed,
            LegacyValue = result.LegacyValue
        };
        final.Notes.AddRange(notes);
        if (managedNote is not null) final.Notes.Add(managedNote);
        return final;
    }

    /// <summary>
    /// Convert a detected legacy (kind, value) pair into the CSS selector the new engine actually
    /// consumes (<c>document.querySelectorAll</c>). When no faithful CSS form exists the result is
    /// <c>Managed</c>: nothing runnable is emitted and the caller flags the step for a manual fix —
    /// silently emitting a wrong selector would be worse than emitting none.
    /// </summary>
    private static (string Css, bool Managed, string? Note) ToCss(SelectorBy by, string raw, List<string> notes)
    {
        switch (by)
        {
            case SelectorBy.CssSelector:
                return (raw, false, "سلکتور CSS قدیمی بدون تغییر منتقل شد.");

            case SelectorBy.Id:
                notes.Add($"سلکتور Id قدیمی به CSS تبدیل شد: [id=…]‎.");
                return ($"[id={CssString(raw)}]", false, null);

            case SelectorBy.Name:
                notes.Add("سلکتور Name قدیمی به CSS تبدیل شد: [name=…].");
                return ($"[name={CssString(raw)}]", false, null);

            case SelectorBy.ClassName:
            {
                var parts = raw.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 0) return ("", true, "نام کلاس قدیمی خالی بود.");
                var css = string.Concat(parts.Select(p => $"[class~={CssString(p)}]"));
                notes.Add("سلکتور ClassName قدیمی به CSS تبدیل شد: [class~=…].");
                return (css, false, null);
            }

            case SelectorBy.TagName:
                if (raw == "*" || TagNamePattern.IsMatch(raw))
                {
                    notes.Add("سلکتور TagName به CSS منتقل شد.");
                    return (raw, false, null);
                }
                return ("", true,
                    $"⚠ نوع TagName با مقدار «{raw}» یک نام تگ معتبر نیست؛ در ویرایشگر اصلاح کنید.");

            case SelectorBy.XPath:
            {
                var css = XPathToCss(raw, out var reason);
                if (css is null)
                {
                    // Some legacy rows record a plain CSS chain under the XPath kind
                    // (e.g. "html body form#form1 table tbody tr"). Detect and keep it as-is.
                    if (LooksLikeCssAlready(raw))
                    {
                        notes.Add("⚠ مقدار ذخیره‌شده در ستون XPath در واقع یک زنجیرهٔ CSS بود؛ بدون تغییر منتقل شد — لطفاً بازبینی شود.");
                        return (raw, false, null);
                    }
                    return ("", true,
                        $"⚠ سلکتور XPath قدیمی به CSS تبدیل نشد ({reason}). برای جلوگیری از اجرای اشتباه، مقدار جدید خالی ماند — لطفاً در ویرایشگر یک سلکتور CSS جایگزین کنید.");
                }
                notes.Add("سلکتور XPath قدیمی به معادل CSS تبدیل شد.");
                return (css, false, null);
            }

            case SelectorBy.LinkText:
            case SelectorBy.PartialLinkText:
                return ("", true,
                    $"⚠ نوع {(by == SelectorBy.LinkText ? "LinkText" : "PartialLinkText")} در موتور جدید (که فقط CSS اجرا می‌کند) پشتیبانی نمی‌شود؛ متن قدیمی در «مقدار قدیمی» حفظ شد و باید دستی به سلکتور CSS تبدیل شود.");

            default:
                return (raw, false, null);
        }
    }

    private static readonly Regex TagNamePattern = new("^[A-Za-z][A-Za-z0-9-]*$", RegexOptions.Compiled);
    private static readonly Regex CssAttrNamePattern = new("^[A-Za-z_][A-Za-z0-9_-]*$", RegexOptions.Compiled);
    /// <summary>A bare frame reference like <c>iframe[2]</c> — an index, not a CSS selector.</summary>
    private static readonly Regex FrameIndexPattern = new("^(?:iframe|frame)?\\s*\\[(\\d+)\\]$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>
    /// True when a value that failed XPath conversion is actually a plain CSS chain
    /// (contains a space, '#' or '.'; no XPath-only syntax like @, ::, //, text(), '(').
    /// </summary>
    private static bool LooksLikeCssAlready(string raw)
    {
        if (raw.Contains('@') || raw.Contains("::") || raw.Contains("//")) return false;
        if (raw.Contains("text()") || raw.StartsWith('(')) return false;
        return raw.Contains(' ') || raw.Contains('#') || raw.Contains('.');
    }

    /// <summary>Quote a value for a CSS attribute selector (escapes the quote and backslash).</summary>
    private static string CssString(string v) =>
        "\"" + v.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    /// <summary>[attr="v"] / [attr] for a single CSS-safe attribute name; null when the name is not safe.</summary>
    private static string? CssAttribute(string attrName, string? value)
    {
        if (!CssAttrNamePattern.IsMatch(attrName)) return null;
        return value is null ? $"[{attrName}]" : $"[{attrName}={CssString(value)}]";
    }

    /// <summary>Predicate regexes for the legacy XPath subset.</summary>
    /// <remarks>
    /// Quoted content excludes both quote characters, so a compound predicate such as
    /// <c>[@name='q' and @type='text']</c> cannot be partially swallowed by the simple equality
    /// pattern — it falls through to "managed" instead of being silently converted wrong.
    /// </remarks>
    private static readonly Regex PAttrEq = new(
        "^@([A-Za-z_][A-Za-z0-9_-]*)\\s*=\\s*(['\"])([^'\"]*)\\2$", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex PAttrOnly = new("^@([A-Za-z_][A-Za-z0-9_-]*)$", RegexOptions.Compiled);
    private static readonly Regex PContains = new(
        "^contains\\s*\\(\\s*@([A-Za-z_][A-Za-z0-9_-]*)\\s*,\\s*(['\"])([^'\"]*)\\2\\s*\\)$", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex PStartsWith = new(
        "^starts-with\\s*\\(\\s*@([A-Za-z_][A-Za-z0-9_-]*)\\s*,\\s*(['\"])([^'\"]*)\\2\\s*\\)$", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex PPosition = new("^(?:position\\s*\\(\\s*\\)\\s*=\\s*)?(\\d+)$", RegexOptions.Compiled);

    /// <summary>
    /// Convert the legacy XPath subset into CSS. Supported: child/descendant paths, tag or '*'
    /// node tests, <c>@attr="v"</c>, <c>@attr</c>, <c>contains()</c>, <c>starts-with()</c> and
    /// positional <c>[n]</c> / <c>[last()]</c> predicates (position among same-name siblings —
    /// <c>:nth-of-type</c>). Anything else (text() comparisons, other axes, nested predicates,
    /// functions) returns null with a reason so the caller can manage the step.
    /// </summary>
    internal static string? XPathToCss(string xpath, out string reason)
    {
        reason = "";
        var s = xpath.Trim();
        if (s.Length == 0) { reason = "خالی"; return null; }
        if (s.StartsWith('(')) { reason = "پرانتز/مجموعه در ابتدای مسیر"; return null; }
        if (s.Contains("text()")) { reason = "مقایسه با text() معادل CSS ندارد"; return null; }
        if (s.Contains("::")) { reason = "محور (axis) خاص پشتیبانی نمی‌شود"; return null; }
        if (s.StartsWith("./", StringComparison.Ordinal)) s = s[2..];
        else if (s.StartsWith('.')) s = s[1..];
        if (!s.StartsWith('/')) { reason = "مسیر از ریشه شروع نمی‌شود"; return null; }

        var parts = new List<string>();
        var i = 0;
        while (i < s.Length)
        {
            bool descendant;
            if (s[i] == '/')
            {
                if (i + 1 < s.Length && s[i + 1] == '/') { descendant = true; i += 2; }
                else { descendant = false; i++; }
            }
            else { reason = "ساختار مسیر نامشخص"; return null; }

            var start = i;
            var depth = 0;
            while (i < s.Length)
            {
                var ch = s[i];
                if (ch == '[') depth++;
                else if (ch == ']') depth--;
                else if (ch == '/' && depth == 0) break;
                i++;
            }
            var seg = s[start..i].Trim();
            if (seg.Length == 0) continue; // trailing slash

            var fragment = SegmentToCss(seg, out var segReason);
            if (fragment is null) { reason = segReason; return null; }
            parts.Add(parts.Count == 0 ? fragment : (descendant ? " " : " > ") + fragment);
        }
        if (parts.Count == 0) { reason = "مسیر خالی"; return null; }
        return string.Concat(parts);
    }

    /// <summary>Convert one XPath step (name + predicates) into a CSS compound fragment.</summary>
    private static string? SegmentToCss(string seg, out string reason)
    {
        reason = "";
        var bracket = seg.IndexOf('[');
        var name = (bracket < 0 ? seg : seg[..bracket]).Trim();
        var predText = bracket < 0 ? "" : seg[bracket..];
        if (name.Length == 0) name = "*";
        if (name != "*" && !TagNamePattern.IsMatch(name))
        {
            reason = $"نام گره «{name}» در CSS قابل بیان نیست";
            return null;
        }

        var preds = new List<string>();
        var i = 0;
        while (i < predText.Length)
        {
            if (predText[i] != '[') { reason = "ساختار پیش‌بینی نامشخص"; return null; }
            var depth = 0;
            var start = i + 1;
            var j = i;
            while (j < predText.Length)
            {
                if (predText[j] == '[') depth++;
                else if (predText[j] == ']') { depth--; if (depth == 0) break; }
                j++;
            }
            if (depth != 0) { reason = "براکت بسته نشده"; return null; }
            preds.Add(predText[start..j].Trim());
            i = j + 1;
        }

        var css = new StringBuilder();
        if (name != "*" || preds.Count == 0) css.Append(name);
        foreach (var pred in preds)
        {
            var m = PAttrEq.Match(pred);
            if (m.Success)
            {
                var attr = m.Groups[1].Value;
                var val = m.Groups[3].Value;
                if (attr.Equals("class", StringComparison.Ordinal))
                {
                    var classes = val.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                    if (classes.Length == 0) { reason = "پیش‌بینی class خالی"; return null; }
                    foreach (var cl in classes) css.Append($"[class~={CssString(cl)}]");
                }
                else
                {
                    var sel = CssAttribute(attr, val);
                    if (sel is null) { reason = $"نام ویژگی «{attr}» در CSS معتبر نیست"; return null; }
                    css.Append(sel);
                }
                continue;
            }

            m = PAttrOnly.Match(pred);
            if (m.Success)
            {
                var sel = CssAttribute(m.Groups[1].Value, null);
                if (sel is null) { reason = $"نام ویژگی «{m.Groups[1].Value}» در CSS معتبر نیست"; return null; }
                css.Append(sel);
                continue;
            }

            m = PContains.Match(pred);
            if (m.Success)
            {
                if (!CssAttrNamePattern.IsMatch(m.Groups[1].Value)) { reason = "نام ویژگی در contains() معتبر نیست"; return null; }
                css.Append($"[{m.Groups[1].Value}*={CssString(m.Groups[3].Value)}]");
                continue;
            }

            m = PStartsWith.Match(pred);
            if (m.Success)
            {
                if (!CssAttrNamePattern.IsMatch(m.Groups[1].Value)) { reason = "نام ویژگی در starts-with() معتبر نیست"; return null; }
                css.Append($"[{m.Groups[1].Value}^={CssString(m.Groups[3].Value)}]");
                continue;
            }

            if (pred == "last()") { css.Append(":last-of-type"); continue; }

            m = PPosition.Match(pred);
            if (m.Success)
            {
                css.Append($":nth-of-type({m.Groups[1].Value})");
                continue;
            }

            reason = $"پیش‌بینی «{pred}» قابل تبدیل نیست";
            return null;
        }

        var result = css.ToString();
        if (result.Length == 0) { reason = "مرحله بدون گره"; return null; }
        return result;
    }

    private static bool TryMapBy(string prefix, out SelectorBy by)
    {
        by = prefix switch
        {
            "xpath" or "xp" or "fullxpath" or "full_xpath" or "full-xpath" => SelectorBy.XPath,
            "id" => SelectorBy.Id,
            "name" => SelectorBy.Name,
            "class" or "classname" or "class_name" => SelectorBy.ClassName,
            "tag" or "tagname" or "tag_name" => SelectorBy.TagName,
            "linktext" or "link_text" => SelectorBy.LinkText,
            "partiallinktext" or "partial_link_text" or "partiallink" => SelectorBy.PartialLinkText,
            "css" or "cssselector" or "css_selector" or "selector" => SelectorBy.CssSelector,
            _ => SelectorBy.None
        };
        return by != SelectorBy.None;
    }

    private static bool LooksLikeXPath(string s)
    {
        if (s.StartsWith("//", StringComparison.Ordinal)) return true;
        if (s.StartsWith("(//", StringComparison.Ordinal)) return true;
        if (s.StartsWith("/html", StringComparison.OrdinalIgnoreCase)) return true;
        if (s.StartsWith("./", StringComparison.Ordinal)) return true;
        if (s.StartsWith("(.//", StringComparison.Ordinal)) return true;
        return false;
    }

    /// <summary>
    /// A legacy value that is a bare identifier (no selector syntax) is almost always an element id.
    /// Treating it as CSS would produce an invalid tag name like el_2551142555442xds.
    /// </summary>
    private static bool LooksLikeGeneratedId(string s)
    {
        if (s.Length == 0) return false;
        // Selector punctuation means it is already a selector, not a bare id.
        if (s.IndexOfAny(new[] { ' ', '>', '.', '#', '[', ']', ':', ',', '/', '*' }) >= 0) return false;
        // A bare word: letters/digits/underscore/dash. CSS tag names cannot contain '_'.
        return s.All(c => char.IsLetterOrDigit(c) || c == '_' || c == '-');
    }

    private static bool LooksLikeCssTag(string prefix)
    {
        // "div:first-child" style — prefix is a tag name, not a type keyword.
        return prefix.Length > 0 && prefix.All(char.IsLetter) && TryMapBy(prefix, out _) == false;
    }

    private static bool TryReadTypedJson(string raw, out SelectorBy by, out string value)
    {
        by = SelectorBy.CssSelector;
        value = string.Empty;
        try
        {
            var obj = JsonNode.Parse(raw) as JsonObject;
            if (obj is null) return false;
            var byText = (obj["by"] ?? obj["By"])?.ToString();
            var valText = (obj["value"] ?? obj["Value"])?.ToString();
            if (string.IsNullOrWhiteSpace(valText)) return false;
            if (!string.IsNullOrWhiteSpace(byText))
            {
                if (TryMapBy(byText.Trim().ToLowerInvariant(), out var mapped)) by = mapped;
                else if (Enum.TryParse<SelectorBy>(byText, true, out var parsed)) by = parsed;
            }
            value = valText.Trim();
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>The placeholder the current runner substitutes for a dynamic selector's value.</summary>
    public const string DynamicPlaceholder = "{مقدار پویا}";

    /// <summary>
    /// Convert a legacy selector that carries its own matcher type (the old Selenium era stored the
    /// kind next to the value). The kind column is authoritative; an absent/unknown kind — the old
    /// «هیچ» with no type — falls back to shape detection on the value itself.
    /// </summary>
    public static NormalizedSelector NormalizeTyped(string? elementBy, string? value)
    {
        var by = MapLegacyBy(elementBy);
        var raw = (value ?? string.Empty).Trim();
        if (by == SelectorBy.None) return Normalize(raw);

        var result = new NormalizedSelector { LegacyValue = raw };
        if (raw.Length == 0)
        {
            result.Notes.Add("سلکتور قدیمی خالی بود.");
            return Finish(result, by, raw, null);
        }

        var cleaned = raw;
        if (cleaned.Contains("{dynamic}", StringComparison.OrdinalIgnoreCase))
        {
            cleaned = cleaned.Replace("{dynamic}", DynamicPlaceholder, StringComparison.OrdinalIgnoreCase);
            result.Notes.Add("سلکتور پویا ({dynamic}) به نشانگر پویای نرم‌افزار فعلی تبدیل شد.");
        }
        return Finish(result, by, cleaned, $"نوع سلکتور از ستون قدیمی «{elementBy}» خوانده شد.");
    }

    /// <summary>Map a legacy ElementBy/FrameBy kind name onto the current selector discriminator.</summary>
    public static SelectorBy MapLegacyBy(string? elementBy)
    {
        var s = (elementBy ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "xpath" or "xp" or "fullxpath" => SelectorBy.XPath,
            "cssselector" or "css" or "selector" => SelectorBy.CssSelector,
            "id" => SelectorBy.Id,
            "name" => SelectorBy.Name,
            "classname" or "class" => SelectorBy.ClassName,
            "linktext" => SelectorBy.LinkText,
            "partiallinktext" or "partiallink" => SelectorBy.PartialLinkText,
            "tagname" or "tag" => SelectorBy.TagName,
            _ => SelectorBy.None      // "هیچ" / none / empty — no type recorded
        };
    }

    /// <summary>
    /// Build the frame-path JSON the current runner reads (an array of hops) from the legacy
    /// <c>FrameBy</c>/<c>FrameByValue</c> pair. The runner resolves each hop with
    /// <c>document.querySelector(hop.value)</c> only — the hop's <c>by</c> is ignored — so every
    /// hop value is converted to CSS here. A URL-like value becomes a <c>srcHint</c> (the runner
    /// matches it against the frame's src), and an unconvertible hop falls back to the child index.
    /// The old editor separated nesting levels with '|' in either column; when one kind covers
    /// several values, that kind applies to every level.
    /// </summary>
    public static string BuildFramePathJson(string? frameBy, string? frameByValue, List<string>? notes = null)
    {
        var valueRaw = (frameByValue ?? string.Empty).Trim();
        if (valueRaw.Length == 0) return "[]";

        var kinds = (frameBy ?? string.Empty).Split('|').Select(x => x.Trim()).ToList();
        var values = valueRaw.Split('|').Select(x => x.Trim()).ToList();

        var hops = new JsonArray();
        for (var i = 0; i < values.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(values[i])) continue;
            var kindRaw = kinds.Count == values.Count ? kinds[i] : kinds.FirstOrDefault() ?? "";
            var by = MapLegacyBy(kindRaw);
            if (by == SelectorBy.None)
            {
                // No usable kind for this level — derive it from the value's shape.
                by = LooksLikeXPath(values[i]) ? SelectorBy.XPath
                    : LooksLikeGeneratedId(values[i]) ? SelectorBy.Id
                    : SelectorBy.CssSelector;
            }

            // The frame reference may be the frame's URL rather than a selector — the runner
            // matches srcHint against the real frame URL, which is more reliable here.
            if (values[i].Contains("://", StringComparison.Ordinal))
            {
                hops.Add(new JsonObject { ["by"] = "CssSelector", ["value"] = "", ["srcHint"] = values[i] });
                notes?.Add("مقدار فریم قدیمی یک URL بود؛ به srcHint تبدیل شد.");
                continue;
            }

            var (css, managed, managedNote) = ToCss(by, values[i], new List<string>());
            if (managed)
            {
                // Leave the hop value empty: the runner then falls back to srcHint / child index.
                // A bare "iframe[n]" reference is an index, so record it (0-based, like the old app).
                var hop = new JsonObject { ["by"] = "CssSelector", ["value"] = "" };
                var idxMatch = FrameIndexPattern.Match(values[i]);
                if (idxMatch.Success && int.TryParse(idxMatch.Groups[1].Value, out var frameIdx) && frameIdx >= 0)
                {
                    hop["indexInParent"] = frameIdx;
                    notes?.Add($"سطح فریم «{values[i]}» قابل تبدیل به CSS نبود؛ از ایندکس {frameIdx} فریم فرزند استفاده می‌شود.");
                }
                else
                {
                    notes?.Add($"سطح فریم «{values[i]}» قابل تبدیل به CSS نبود؛ از موقعیت فریم فرزند استفاده می‌شود.");
                }
                hops.Add(hop);
            }
            else
            {
                hops.Add(new JsonObject { ["by"] = "CssSelector", ["value"] = css });
            }
        }

        if (hops.Count == 0) return "[]";
        if (values.Count > 1)
            notes?.Add($"زنجیرهٔ فریم قدیمی با {hops.Count} سطح از '|' بازسازی شد.");
        return hops.ToJsonString();
    }

    // ---------------------------------------------------------------------------------------
    // Conditions
    // ---------------------------------------------------------------------------------------

    /// <summary>One legacy condition row, as read from the old schema.</summary>
    public sealed class LegacyCondition
    {
        public string? Title { get; init; }
        /// <summary>Legacy ConditionType (name or int) — mapped onto <see cref="ConditionType"/>.</summary>
        public string? ConditionType { get; init; }
        /// <summary>Legacy EqualityType (name or int).</summary>
        public string? EqualityType { get; init; }
        /// <summary>Selector text for element-based conditions.</summary>
        public string? SelectorValue { get; init; }
        /// <summary>Constant to compare against.</summary>
        public string? ConstantValue { get; init; }
        /// <summary>Column name when the compared value comes from a data source.</summary>
        public string? ColumnName { get; init; }
        /// <summary>Legacy Conditions.SourceId — the source a sourceValue condition reads from.</summary>
        public int? SourceId { get; init; }
        /// <summary>Logical joiner to the previous condition in the same group (legacy And/Or).</summary>
        public string? Join { get; init; }
    }

    /// <summary>A mapped condition ready to become a graph condition node.</summary>
    public sealed class MappedCondition
    {
        public ConditionType ConditionType { get; init; }
        public EqualityType EqualityType { get; init; } = EqualityType.Equal;
        public NormalizedSelector? Selector { get; init; }
        public string? ConstantValue { get; init; }
        public string? ColumnName { get; init; }
        /// <summary>Legacy source id of a sourceValue condition (remapped on import).</summary>
        public int? SourceId { get; init; }
        public string Title { get; init; } = string.Empty;
        public List<string> Notes { get; } = new();
    }

    /// <summary>
    /// Map a legacy condition type name/number onto the current enum. Unknown values fall back to
    /// the closest behaviour and say so, rather than being dropped.
    /// </summary>
    public static ConditionType MapConditionType(string? legacy)
    {
        var s = (legacy ?? string.Empty).Trim();
        if (s.Length == 0) return ConditionType.None;
        if (int.TryParse(s, out var n) && Enum.IsDefined(typeof(ConditionType), n))
            return (ConditionType)n;
        if (Enum.TryParse<ConditionType>(s, true, out var direct)) return direct;

        var k = s.ToLowerInvariant();
        if (k.Contains("url") || k.Contains("address")) return ConditionType.Url;
        if (k.Contains("source")) return ConditionType.SourceValue;
        if (k.Contains("elementvalue") || k.Contains("element_value") || k.Contains("value")) return ConditionType.ElementValue;
        if (k.Contains("notfound") || k.Contains("not_found") || k.Contains("notfind")) return ConditionType.NotFindElement;
        if (k.Contains("elements")) return ConditionType.FindElements;
        if (k.Contains("find") || k.Contains("exist")) return ConditionType.FindElement;
        if (k.Contains("tab")) return ConditionType.DriverTabs;
        return ConditionType.None;
    }

    /// <summary>Map a legacy equality type name/number onto the current enum.</summary>
    public static EqualityType MapEqualityType(string? legacy)
    {
        var s = (legacy ?? string.Empty).Trim();
        if (s.Length == 0) return EqualityType.Equal;
        if (int.TryParse(s, out var n) && Enum.IsDefined(typeof(EqualityType), n))
            return (EqualityType)n;
        if (Enum.TryParse<EqualityType>(s, true, out var direct)) return direct;

        var k = s.ToLowerInvariant();
        // The Windows-era enum misspelled it: notEequal ("notequal" without the extra e never matches).
        if (k.Contains("noteequal") || k.Contains("notequal") || k.Contains("not_equal")) return EqualityType.NotEqual;
        if (k.Contains("smaller") || k.Contains("less")) return EqualityType.SmallerThan;
        if (k.Contains("bigger") || k.Contains("greater")) return EqualityType.BiggerThan;
        if (k.Contains("contain")) return EqualityType.Contain;
        if (k.Contains("hasnot") || k.Contains("has_not")) return EqualityType.HasNotValue;
        if (k.Contains("has")) return EqualityType.HasValue;
        return EqualityType.Equal;
    }

    /// <summary>True when a legacy join token means OR rather than AND.</summary>
    public static bool IsOrJoin(string? join)
    {
        var j = (join ?? string.Empty).Trim().ToLowerInvariant();
        return j is "or" or "||" or "|" or "2" or "any";
    }

    /// <summary>
    /// How a legacy condition group maps onto the current graph, which has no group entity.
    ///
    /// Consecutive conditions = AND. When a legacy group mixes joins, the OR must instead become
    /// parallel branches, so the caller is told to split rather than silently flattening it into
    /// an AND chain (which would change the meaning of the process).
    /// </summary>
    public sealed class ConditionGroupPlan
    {
        /// <summary>Conditions that belong to the first AND chain, in order.</summary>
        public List<MappedCondition> AndChain { get; } = new();
        /// <summary>
        /// Additional AND chains that must run as parallel (OR) branches alongside
        /// <see cref="AndChain"/>. Each inner list is one branch.
        /// </summary>
        public List<List<MappedCondition>> OrBranches { get; } = new();
        /// <summary>True when the group mixes AND and OR and therefore needs branch splitting.</summary>
        public bool IsMixed => OrBranches.Count > 0;
        public List<string> Notes { get; } = new();
    }

    /// <summary>
    /// Turn a legacy condition group into AND chains + parallel branches.
    ///
    /// Walk the rows in order. A row whose join is "or" starts a new parallel branch; every other
    /// row appends to the chain it is in. This is exactly the legacy semantics: `A AND B OR C`
    /// was evaluated as `(A AND B) OR C`.
    /// </summary>
    public static ConditionGroupPlan MapConditionGroup(IReadOnlyList<LegacyCondition> conditions)
    {
        var plan = new ConditionGroupPlan();
        List<MappedCondition>? current = null;
        var first = true;

        foreach (var c in conditions ?? Array.Empty<LegacyCondition>())
        {
            var mapped = MapCondition(c);
            var isOr = !first && IsOrJoin(c.Join);
            if (current is null || isOr)
            {
                if (isOr) plan.OrBranches.Add(new List<MappedCondition>());
                current = isOr ? plan.OrBranches[^1] : plan.AndChain;
            }
            current.Add(mapped);
            first = false;
        }

        if (plan.OrBranches.Count > 0)
        {
            plan.Notes.Add("گروه شرط ترکیبی (AND/OR) بود: شرط‌های AND پشت سر هم و OR به‌صورت شاخهٔ موازی نگاشت شد.");
        }
        return plan;
    }

    private static MappedCondition MapCondition(LegacyCondition c)
    {
        var type = MapConditionType(c.ConditionType);
        NormalizedSelector? sel = null;
        if (!string.IsNullOrWhiteSpace(c.SelectorValue))
        {
            sel = Normalize(c.SelectorValue);
        }
        else if (type == ConditionType.ElementValue || type == ConditionType.FindElement
                 || type == ConditionType.NotFindElement || type == ConditionType.FindElements)
        {
            // Element-based condition with no selector is unusable — flag it.
            sel = new NormalizedSelector { LegacyValue = string.Empty };
            sel.Notes.Add("شرط وابسته به المان است ولی سلکتوری نداشت.");
        }

        var mapped = new MappedCondition
        {
            ConditionType = type,
            EqualityType = MapEqualityType(c.EqualityType),
            Selector = sel,
            ConstantValue = c.ConstantValue,
            ColumnName = c.ColumnName,
            SourceId = c.SourceId,
            Title = string.IsNullOrWhiteSpace(c.Title) ? DefaultConditionTitle(type) : c.Title!.Trim()
        };
        if (sel is not null) foreach (var n in sel.Notes) mapped.Notes.Add(n);
        return mapped;
    }

    private static string DefaultConditionTitle(ConditionType t) => t switch
    {
        ConditionType.Url => "بررسی آدرس صفحه",
        ConditionType.ElementValue => "بررسی مقدار المان",
        ConditionType.SourceValue => "بررسی منبع صفحه",
        ConditionType.FindElement => "پیدا بودن المان",
        ConditionType.NotFindElement => "پنهان بودن المان",
        ConditionType.FindElements => "پیدا بودن چند المان",
        ConditionType.DriverTabs => "تعداد تب‌ها",
        _ => "شرط"
    };
}
