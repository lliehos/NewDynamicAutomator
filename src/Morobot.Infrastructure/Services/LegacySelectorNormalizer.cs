using System.Text.Json.Nodes;
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
        /// <summary>Current-app selector discriminator.</summary>
        public SelectorBy By { get; init; } = SelectorBy.CssSelector;
        /// <summary>Selector body, already valid for <see cref="By"/>.</summary>
        public string Value { get; init; } = string.Empty;
        /// <summary>
        /// The legacy text preserved verbatim. Kept because a lossy conversion must stay
        /// auditable, and because a later re-import may be able to do better.
        /// </summary>
        public string LegacyValue { get; init; } = string.Empty;
        /// <summary>Human-readable notes about what the conversion did.</summary>
        public List<string> Notes { get; } = new();
        /// <summary>False when nothing usable could be extracted (caller should flag the step).</summary>
        public bool Ok => !string.IsNullOrWhiteSpace(Value);
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
        var final = new NormalizedSelector
        {
            By = by,
            Value = (value ?? string.Empty).Trim(),
            LegacyValue = result.LegacyValue
        };
        // Copy the trail accumulated by the caller so the report shows the whole reasoning.
        final.Notes.AddRange(result.Notes);
        if (!string.IsNullOrWhiteSpace(note)) final.Notes.Add(note);
        return final;
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
        if (k.Contains("notequal") || k.Contains("not_equal")) return EqualityType.NotEqual;
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
