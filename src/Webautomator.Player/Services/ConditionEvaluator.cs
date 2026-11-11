using System.Globalization;
using System.Text.RegularExpressions;
using Webautomator.Player.Models;
using OpenQA.Selenium;

namespace Webautomator.Player.Services;

/// <summary>
/// Evaluates a condition node, including the page-based kinds.
/// </summary>
/// <remarks>
/// Split from <see cref="LocalRunEngine"/> because it is a self-contained decision: reading the page
/// and comparing values. Keeping it apart also makes the port reviewable — each condition type can
/// be compared against its counterpart in engine.js on its own.
///
/// Two rules carried over from the extension deliberately, because both prevent a silent wrong
/// branch:
///   * "could not check" is NOT "the condition is false" for a page that failed to answer — but a
///     condition that genuinely cannot be evaluated still reports fail, with the reason logged;
///   * equality also accepts a numeric match ("1" equals "01"), while ordering needs BOTH sides to
///     be numbers or both to be clock/date values — see <see cref="ConditionCompare"/>.
///
/// The comparison itself lives in <see cref="ConditionCompare"/> so the browser engine and this
/// runner share one rule set (operator spelling, clock ordering, numeric-vs-text ordering).
/// </remarks>
public sealed class ConditionEvaluator
{
    /// <summary>A condition kind that needs the browser page to answer.</summary>
    public static bool NeedsPage(GraphNode node)
    {
        var ct = node.ReadExtraString("conditionType");
        return ct is "Url" or "FindElement" or "NotFindElement" or "FindElements"
            or "ElementVisible" or "ElementHidden" or "ElementValue";
    }

    /// <summary>Evaluate, reporting why when it could not be decided.</summary>
    public ConditionResult Evaluate(
        IWebDriver? driver, ProcessGraph graph, GraphNode node, int rowIndex,
        IReadOnlyDictionary<string, string> memory,
        Func<int?, int, string, string> readCell)
    {
        var ct = node.ReadExtraString("conditionType");
        if (string.IsNullOrEmpty(ct) || ct == "None") return ConditionResult.Pass();

        try
        {
            switch (ct)
            {
                case "Url":
                {
                    var actual = driver?.Url ?? "";
                    var expected = ResolveOperand(node, memory, readCell, rowIndex, graph, actual, driver);
                    return ConditionResult.Of(Compare(actual, expected, node.ReadExtraString("equalityType")));
                }

                case "FindElement":
                case "NotFindElement":
                case "ElementVisible":
                case "ElementHidden":
                {
                    var negate = ct is "NotFindElement" or "ElementHidden";
                    var selector = node.Selector ?? "";
                    if (string.IsNullOrWhiteSpace(selector)) return ConditionResult.Of(negate);
                    var wantVisible = ct is "ElementVisible" or "ElementHidden";

                    var by = ToBy(selector);
                    var req = ElementRequirements.For(node, valueSide: false);
                    // "Visible" itself is a requirement; the node's enabled/clickable filters add to it.
                    if (wantVisible) req = req with { Visible = true };

                    // The element's wait switch applies here too: "does it exist" asked once, a
                    // millisecond after the click that creates it, answers the wrong thing.
                    var found = ExistsWithWait(driver!, by, req, WaitBudgetMs(node));
                    return ConditionResult.Of(negate ? !found : found);
                }

                case "FindElements":
                {
                    var selector = node.Selector ?? "";
                    // The operand is compared as TEXT, not re-parsed into a number: the author may
                    // have chosen a memory or a source cell, and NodeNumber only ever saw the
                    // constant. Parsing it here made "count > {memory}" compare against 0 always.
                    var expected = ResolveOperand(node, memory, readCell, rowIndex, graph, null, driver);
                    var countReq = ElementRequirements.For(node, valueSide: false);
                    return ConditionResult.Of(CountMatchesWithWait(driver!, string.IsNullOrWhiteSpace(selector) ? null : ToBy(selector),
                        countReq, expected, node.ReadExtraString("equalityType"), WaitBudgetMs(node)));
                }

                case "ElementValue":
                {
                    // The SUBJECT of this condition is the node's TARGET element (`selectorValue`);
                    // its compare operand may be read from the value-side element
                    // (`equalSelectorValue`) when the author picked «عنصر صفحه» for it.
                    var left = ReadElementText(driver!, node, equalSide: false);
                    var right = ResolveOperand(node, memory, readCell, rowIndex, graph, left, driver);
                    return ConditionResult.Of(Compare(left, right, node.ReadExtraString("equalityType")));
                }

                case "SourceValue":
                case "SourceColumnValue":
                case "SourceRowValue":
                {
                    // The SUBJECT source is `sourceId`; `dataSourceId` on a condition belongs to the
                    // COMPARE operand, so reading it here could compare a cell with itself.
                    var dsId = node.SourceId ?? node.DataSourceId;
                    var col = node.DynamicSourceColumnName ?? "";
                    var left = readCell(dsId, rowIndex, col);
                    var right = ResolveOperand(node, memory, readCell, rowIndex, graph, left, driver);
                    return ConditionResult.Of(Compare(left, right, node.ReadExtraString("equalityType")));
                }

                case "MemoryValue":
                {
                    var name = node.MemoryVariableName ?? "";
                    var left = memory.TryGetValue(name, out var v) ? v : "";
                    var right = ResolveOperand(node, memory, readCell, rowIndex, graph, left, driver);
                    return ConditionResult.Of(Compare(left, right, node.ReadExtraString("equalityType")));
                }

                case "DriverTabs":
                {
                    // This runner is one browser per run, so the meaningful count is its windows —
                    // and a run that never opened a browser has none, which is a real answer rather
                    // than a reason to fail the check.
                    var count = driver?.WindowHandles.Count ?? 0;
                    var countText = count.ToString(CultureInfo.InvariantCulture);
                    return ConditionResult.Of(Compare(
                        countText,
                        ResolveOperand(node, memory, readCell, rowIndex, graph, countText, driver),
                        node.ReadExtraString("equalityType")));
                }

                case "SystemDate":
                case "SystemTime":
                {
                    // The subject clock is formatted with the node's OWN format: comparing a
                    // "yyyy/MM/dd" clock against a "yyyy-MM-dd" literal can never be equal, and
                    // ordering a "HH:mm" clock against "14:05:09" was a silent mismatch too.
                    var clock = SystemClock(ct, node.ReadExtraString("systemClockFormat"));
                    var operand = ResolveOperand(node, memory, readCell, rowIndex, graph, clock, driver);
                    // The author may have typed the literal in a different shape than the node's
                    // format. Re-formatting the clock to the operand's shape keeps an ordering
                    // comparison honest instead of silently answering false.
                    if (!ConditionCompare.Compare(clock, operand, ConditionCompare.Equal))
                    {
                        var adapted = AdaptClockToSample(ct, operand);
                        if (adapted is not null) clock = adapted;
                    }
                    return ConditionResult.Of(Compare(clock, operand, node.ReadExtraString("equalityType")));
                }

                default:
                    return ConditionResult.Unsupported($"نوع شرط «{ct}» در اجراکننده محلی پشتیبانی نمی‌شود.");
            }
        }
        catch (WebDriverException ex)
        {
            // A page that cannot answer is reported, not silently treated as a false verdict — the
            // difference matters when the author is debugging why a branch was taken.
            return ConditionResult.Failed($"بررسی شرط ممکن نشد: {ex.Message}");
        }
        catch (Exception ex)
        {
            return ConditionResult.Failed($"بررسی شرط ممکن نشد: {ex.Message}");
        }
    }

    private static bool Exists(IWebDriver driver, By by, ElementRequirements req)
    {
        try
        {
            var elements = driver.FindElements(by);
            if (elements.Count == 0) return false;
            return elements.Any(el => ElementState.Matches(driver, el, req));
        }
        catch (WebDriverException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            // A malformed selector: no match is the honest answer, and the caller logs the condition.
            return false;
        }
    }

    /// <summary>XPath when the selector looks like it, CSS otherwise — the recorder's own rule.</summary>
    private static By ToBy(string selector)
        => selector.TrimStart().StartsWith("//") ? By.XPath(selector) : By.CssSelector(selector);

    /// <summary>Ask whether the element exists, retrying while the node's wait budget lasts.</summary>
    private static bool ExistsWithWait(IWebDriver driver, By by, ElementRequirements req, int budgetMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(budgetMs);
        while (true)
        {
            if (Exists(driver, by, req)) return true;
            if (budgetMs <= 0 || DateTime.UtcNow >= deadline) return false;
            Thread.Sleep(200);
        }
    }

    /// <summary>
    /// Poll the element count until the comparison holds (or the wait budget ends).
    /// </summary>
    /// <remarks>
    /// "Wait until 3 rows are there" is what the author means when the switch is on; a one-shot count
    /// made the switch inert for exactly this condition type.
    /// </remarks>
    private static bool CountMatchesWithWait(
        IWebDriver driver, By? by, ElementRequirements req, string expected, string equality, int budgetMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(budgetMs);
        while (true)
        {
            var count = by is null ? 0 : CountElements(driver, by, req);
            var countText = count.ToString(CultureInfo.InvariantCulture);
            if (Compare(countText, expected, equality)) return true;
            if (budgetMs <= 0 || DateTime.UtcNow >= deadline) return false;
            Thread.Sleep(200);
        }
    }

    /// <summary>The node's selector wait budget in milliseconds (0 = one attempt).</summary>
    private static int WaitBudgetMs(GraphNode node)
    {
        if (node.SelectorWaitEnabled != true) return 0;
        var raw = node.SelectorWaitMs ?? 0;
        return Math.Max(200, raw > 0 ? raw : 1000);
    }

    /// <summary>
    /// Read the text/value of a condition's element.
    /// </summary>
    /// <param name="equalSide">
    /// <c>false</c> for the condition's SUBJECT (the target selector, <c>selectorValue</c>), which is
    /// what an ElementValue check inspects; <c>true</c> for a compare operand read from the page
    /// (<c>equalSelectorValue</c>).
    /// </param>
    private static string ReadElementText(IWebDriver driver, GraphNode node, bool equalSide)
    {
        try
        {
            var selector = ((equalSide ? node.EqualSelector : node.Selector) ?? "").Trim();
            if (selector.Length == 0) return "";
            var el = ElementState.FindFirst(
                driver, ToBy(selector), ElementRequirements.For(node, equalSide), index: 0);

            // WHICH part of the element is read: the condition inspector writes
            // `equalElementValueMode` for the compare element and `elementValueMode` for the subject.
            var mode = (node.ReadExtraString(equalSide ? "equalElementValueMode" : "elementValueMode") ?? "").Trim();
            if (mode.Length == 0) mode = "Auto";
            var attr = (node.ReadExtraString(equalSide ? "equalElementValueAttribute" : "elementValueAttribute") ?? "").Trim();

            return ((IJavaScriptExecutor)driver).ExecuteScript(
                "const el=arguments[0], m=String(arguments[1]||'auto').toLowerCase(), a=arguments[2];" +
                "if(m==='value')return el.value!=null?String(el.value):'';" +
                "if(m==='attribute'){if(!a)return '';const v=el.getAttribute(a);return v==null?'':String(v);}" +
                "if(m==='innerhtml')return el.innerHTML||'';" +
                "if(m==='outerhtml')return el.outerHTML||'';" +
                "if(m==='innertext')return (el.innerText||'').trim();" +
                "if(m==='text')return (el.textContent||'').trim();" +
                "if(m==='href'){const v=el.getAttribute('href')||el.href;return v==null?'':String(v);}" +
                "if(m==='src'){const v=el.getAttribute('src')||el.src;return v==null?'':String(v);}" +
                "if(m==='title'){const v=el.getAttribute('title');return v==null?'':String(v);}" +
                "if(m==='auto'){const t=(el.tagName||'').toUpperCase();" +
                "if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return el.value||'';" +
                "return (el.innerText||el.textContent||'').trim();}" +
                "const v=el.getAttribute(m);return v==null?'':String(v);",
                el, mode, attr) as string ?? "";
        }
        catch
        {
            return "";
        }
    }

    /// <summary>
    /// The right-hand side of the comparison, from a constant, memory, source cell or the clock.
    /// </summary>
    /// <param name="subjectValue">
    /// The value being checked. Only the user-system clock sources read it: their shape is taken
    /// from it when the node names no format, so an element showing "14:05" is compared against a
    /// "HH:mm" clock instead of a "HH:mm:ss" one that could never match.
    /// </param>
    /// <param name="driver">
    /// Needed only when the operand itself lives on the page («عنصر صفحه»); a node that names no
    /// page operand never touches it.
    /// </param>
    private static string ResolveOperand(
        GraphNode node, IReadOnlyDictionary<string, string> memory,
        Func<int?, int, string, string> readCell, int rowIndex, ProcessGraph graph,
        string? subjectValue = null, IWebDriver? driver = null)
    {
        // The editor stores the operand's source in `contentSourceType` (the same field a step uses
        // for its value) and the operand's own fields in `memoryVariableName` / `dataSourceId` +
        // `dynamicSourceColumnName`. This used to read a `compare*` set that nothing ever wrote, so
        // every operand source but «ثابت» silently compared against the constant instead.
        var src = node.ContentSourceType ?? "";
        if (src.Length == 0) src = node.ReadExtraString("compareValueSourceType");
        if (string.Equals(src, "UserSystemDate", StringComparison.OrdinalIgnoreCase)
            || string.Equals(src, "UserSystemTime", StringComparison.OrdinalIgnoreCase))
        {
            var kind = string.Equals(src, "UserSystemDate", StringComparison.OrdinalIgnoreCase)
                ? "SystemDate"
                : "SystemTime";
            return UserSystemClock(kind, node.ReadExtraString("userSystemClockFormat"), subjectValue);
        }
        if (string.Equals(src, "Elements", StringComparison.OrdinalIgnoreCase))
        {
            // The compare element is the VALUE-side selector: reading the target here compared the
            // subject with itself (or with an empty expression, when the node had no target).
            return driver is null ? "" : ReadElementText(driver, node, equalSide: true);
        }
        if (string.Equals(src, "Memory", StringComparison.OrdinalIgnoreCase))
        {
            var name = node.MemoryVariableName ?? "";
            if (name.Length == 0) name = node.ReadExtraString("sourceMemoryVariableName");
            return memory.TryGetValue(name, out var v) ? v : "";
        }
        if (string.Equals(src, "DataSource", StringComparison.OrdinalIgnoreCase)
            && !SubjectIsSource(node.ReadExtraString("conditionType")))
        {
            // A source-subject condition cannot take a data-source operand: the cell would be
            // compared with itself, which is always true. Mirrors the engine's guard.
            return readCell(node.DataSourceId, rowIndex, node.DynamicSourceColumnName ?? "");
        }
        return node.ReadExtraString("constantEqualValue").Length > 0
            ? node.ReadExtraString("constantEqualValue")
            : node.ConstantValue ?? "";
    }

    /// <summary>
    /// Compare two values, using the shared rule set in <see cref="ConditionCompare"/>.
    /// </summary>
    /// <remarks>
    /// Kept as a thin delegate so every call site reads the same way it used to; the rules — and the
    /// reasons behind them — live in one place, matched against <c>compareConditionValues</c> in
    /// engine.js.
    /// </remarks>
    public static bool Compare(string left, string right, string equality)
        => ConditionCompare.Compare(left, right, equality);

    /// <summary>Whether the condition's own subject is a data-source cell, column or row.</summary>
    private static bool SubjectIsSource(string conditionType)
        => conditionType is "SourceValue" or "SourceColumnValue" or "SourceRowValue";

    /// <summary>Count the elements a selector matches, tolerating XPath and a malformed selector.</summary>
    private static int CountElements(IWebDriver driver, By by, ElementRequirements req)
    {
        try
        {
            return driver.FindElements(by).Count(el => ElementState.Matches(driver, el, req));
        }
        catch (WebDriverException)
        {
            return 0;
        }
        catch (InvalidOperationException)
        {
            return 0;
        }
    }

    /// <summary>
    /// The machine clock formatted the way the condition node asked for.
    /// </summary>
    /// <remarks>
    /// Mirrors <c>formatSystemClock</c> in engine.js, including its ASCII-only digits: compared
    /// against a constant typed in the editor, a localised numeral would never match. The date
    /// separators follow the chosen format so a "yyyy/MM/dd" node and its literal agree.
    /// </remarks>
    /// <summary>
    /// The user's own clock as a compare operand (<c>UserSystemDate</c>/<c>UserSystemTime</c>).
    /// </summary>
    /// <remarks>
    /// The node's optional format wins; on "Auto" (or no format) the shape follows the value being
    /// checked. Mirrors <c>formatUserSystemClock</c> in engine.js — the source used to hand back a
    /// literal the author had typed, which made it behave exactly like a constant.
    /// </remarks>
    internal static string UserSystemClock(string kind, string? format, string? sample)
    {
        var fmt = (format ?? "").Trim();
        if (fmt.Length > 0 && !string.Equals(fmt, "Auto", StringComparison.OrdinalIgnoreCase))
            return SystemClock(kind, fmt);
        return AdaptClockToSample(kind, sample) ?? SystemClock(kind, "");
    }

    internal static string SystemClock(string kind, string format)
    {
        var now = DateTime.Now;
        var fmt = (format ?? "").Trim();
        if (string.Equals(kind, "SystemDate", StringComparison.OrdinalIgnoreCase))
        {
            // Any of "-", "/" and "." between the parts, so a literal typed with another separator
            // (or produced by AdaptClockToSample) still has a matching clock format.
            var ymd = Regex.Match(fmt, @"^yyyy([-/\.])MM\1dd$");
            if (ymd.Success)
            {
                var sep = ymd.Groups[1].Value;
                return now.ToString($"yyyy'{sep}'MM'{sep}'dd", CultureInfo.InvariantCulture);
            }
            var dmy = Regex.Match(fmt, @"^dd([-/\.])MM\1yyyy$");
            if (dmy.Success)
            {
                var sep = dmy.Groups[1].Value;
                return now.ToString($"dd'{sep}'MM'{sep}'yyyy", CultureInfo.InvariantCulture);
            }
            return fmt switch
            {
                "yyyyMMdd" => now.ToString("yyyyMMdd", CultureInfo.InvariantCulture),
                "Timestamp" => new DateTimeOffset(now).ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture),
                _ => now.ToString("yyyy'-'MM'-'dd", CultureInfo.InvariantCulture)
            };
        }
        return fmt switch
        {
            "HH:mm" => now.ToString("HH':'mm", CultureInfo.InvariantCulture),
            "HHmmss" => now.ToString("HHmmss", CultureInfo.InvariantCulture),
            "HH:mm:ss.fff" => now.ToString("HH':'mm':'ss'.'fff", CultureInfo.InvariantCulture),
            "HHmmssfff" => now.ToString("HHmmssfff", CultureInfo.InvariantCulture),
            "Timestamp" => new DateTimeOffset(now).ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture),
            _ => now.ToString("HH':'mm':'ss", CultureInfo.InvariantCulture)
        };
    }

    /// <summary>
    /// Re-format the machine clock to the shape of the compare literal.
    /// </summary>
    /// <remarks>
    /// Only a fallback for when the node's own format does not match the literal at all — the
    /// literal is what the author actually typed, so it wins. Returns <c>null</c> when no safe guess
    /// exists, leaving the caller's format alone. Mirrors <c>matchFormatToSample</c> in engine.js.
    /// </remarks>
    internal static string? AdaptClockToSample(string kind, string? sample)
    {
        var s = (sample ?? "").Trim();
        if (s.Length == 0) return null;

        // A subject that shows the whole moment ("2026-11-10 08:45:00" or "…08:45:00.123") needs a
        // date AND a time: a date-only clock could never equal it, no matter which side is right.
        var stamp = Regex.Match(s, @"^(\d{4})([-/\.])(\d{1,2})\2(\d{1,2})[ T](\d{1,2}):(\d{2})(:(\d{2})(?:\.(\d{1,3}))?)?$");
        if (stamp.Success)
        {
            var sep = stamp.Groups[2].Value;
            var datePart = SystemClock("SystemDate", $"yyyy{sep}MM{sep}dd");
            var timeFormat = !stamp.Groups[8].Success ? "HH:mm"
                : stamp.Groups[9].Success ? "HH:mm:ss.fff"
                : "HH:mm:ss";
            var timePart = SystemClock("SystemTime", timeFormat);
            return datePart + (s.Contains('T') ? "T" : " ") + timePart;
        }

        var isDate = string.Equals(kind, "SystemDate", StringComparison.OrdinalIgnoreCase);

        if (isDate)
        {
            var ymd = Regex.Match(s, @"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$");
            if (ymd.Success)
            {
                var sep = s.FirstOrDefault(c => c is '-' or '/' or '.');
                return SystemClock(kind, $"yyyy{sep}MM{sep}dd");
            }
            var dmy = Regex.Match(s, @"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$");
            if (dmy.Success)
            {
                var sep = s.FirstOrDefault(c => c is '-' or '/' or '.');
                return SystemClock(kind, $"dd{sep}MM{sep}yyyy");
            }
            if (Regex.IsMatch(s, @"^\d{8}$")) return SystemClock(kind, "yyyyMMdd");
            return null;
        }

        if (Regex.IsMatch(s, @"^\d{2}:\d{2}:\d{2}\.\d{3}$")) return SystemClock(kind, "HH:mm:ss.fff");
        if (Regex.IsMatch(s, @"^\d{2}:\d{2}:\d{2}$")) return SystemClock(kind, "HH:mm:ss");
        if (Regex.IsMatch(s, @"^\d{2}:\d{2}$")) return SystemClock(kind, "HH:mm");
        if (Regex.IsMatch(s, @"^\d{6}$")) return SystemClock(kind, "HHmmss");
        // Nine digits that read as a valid HHmmssfff; anything else of 8+ digits is an epoch stamp.
        var compactMs = Regex.Match(s, @"^(\d{2})(\d{2})(\d{2})(\d{3})$");
        if (compactMs.Success
            && int.Parse(compactMs.Groups[1].Value) < 24
            && int.Parse(compactMs.Groups[2].Value) < 60
            && int.Parse(compactMs.Groups[3].Value) < 60)
            return SystemClock(kind, "HHmmssfff");
        if (Regex.IsMatch(s, @"^\d{8,}$")) return SystemClock(kind, "Timestamp");
        return null;
    }
}

/// <summary>The verdict of a condition, with the reason when it could not be decided.</summary>
public sealed record ConditionResult(bool Passed, string? Problem)
{
    public static ConditionResult Pass() => new(true, null);
    public static ConditionResult Of(bool passed) => new(passed, null);
    public static ConditionResult Failed(string problem) => new(false, problem);
    public static ConditionResult Unsupported(string problem) => new(false, problem);
}
