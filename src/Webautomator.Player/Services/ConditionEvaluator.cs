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
///   * comparison is string-based, matching the extension, so a source cell holding "01" and a
///     constant "1" are not silently treated as equal.
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
        IWebDriver driver, ProcessGraph graph, GraphNode node, int rowIndex,
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
                    var actual = driver.Url ?? "";
                    var expected = ResolveOperand(node, memory, readCell, rowIndex, graph);
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

                    var found = Exists(driver, selector, wantVisible);
                    return ConditionResult.Of(negate ? !found : found);
                }

                case "FindElements":
                {
                    var selector = node.Selector ?? "";
                    var count = string.IsNullOrWhiteSpace(selector)
                        ? 0
                        : driver.FindElements(By.CssSelector(selector)).Count;
                    var expected = NodeNumber(node);
                    return ConditionResult.Of(Compare(count.ToString(), expected.ToString(), node.ReadExtraString("equalityType")));
                }

                case "ElementValue":
                {
                    var left = ReadElementText(driver, node);
                    var right = ResolveOperand(node, memory, readCell, rowIndex, graph);
                    return ConditionResult.Of(Compare(left, right, node.ReadExtraString("equalityType")));
                }

                case "SourceValue":
                case "SourceColumnValue":
                case "SourceRowValue":
                {
                    var dsId = node.DataSourceId;
                    var col = node.DynamicSourceColumnName ?? "";
                    var left = readCell(dsId, rowIndex, col);
                    var right = ResolveOperand(node, memory, readCell, rowIndex, graph);
                    return ConditionResult.Of(Compare(left, right, node.ReadExtraString("equalityType")));
                }

                case "MemoryValue":
                {
                    var name = node.MemoryVariableName ?? "";
                    var left = memory.TryGetValue(name, out var v) ? v : "";
                    var right = ResolveOperand(node, memory, readCell, rowIndex, graph);
                    return ConditionResult.Of(Compare(left, right, node.ReadExtraString("equalityType")));
                }

                case "DriverTabs":
                {
                    // This runner is one browser per run, so the meaningful count is its windows.
                    var count = driver.WindowHandles.Count;
                    return ConditionResult.Of(Compare(count.ToString(), NodeNumber(node).ToString(), node.ReadExtraString("equalityType")));
                }

                case "SystemDate":
                {
                    var today = DateTime.Now.ToString("yyyy-MM-dd");
                    return ConditionResult.Of(Compare(today, ResolveOperand(node, memory, readCell, rowIndex, graph), node.ReadExtraString("equalityType")));
                }

                case "SystemTime":
                {
                    var now = DateTime.Now.ToString("HH:mm:ss");
                    return ConditionResult.Of(Compare(now, ResolveOperand(node, memory, readCell, rowIndex, graph), node.ReadExtraString("equalityType")));
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

    private static bool Exists(IWebDriver driver, string selector, bool requireVisible)
    {
        var by = selector.TrimStart().StartsWith("//") ? By.XPath(selector) : By.CssSelector(selector);
        try
        {
            var elements = driver.FindElements(by);
            if (elements.Count == 0) return false;
            if (!requireVisible) return true;
            return elements.Any(e => e.Displayed);
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

    private static string ReadElementText(IWebDriver driver, GraphNode node)
    {
        try
        {
            var by = (node.Selector ?? "").TrimStart().StartsWith("//")
                ? By.XPath(node.Selector ?? "")
                : By.CssSelector(node.Selector ?? "");
            var el = driver.FindElement(by);
            return ((IJavaScriptExecutor)driver).ExecuteScript(
                "const el=arguments[0];" +
                "if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT')return el.value||'';" +
                "return (el.innerText||el.textContent||'').trim();",
                el) as string ?? "";
        }
        catch
        {
            return "";
        }
    }

    /// <summary>The right-hand side of the comparison, from a constant, memory or source cell.</summary>
    private static string ResolveOperand(
        GraphNode node, IReadOnlyDictionary<string, string> memory,
        Func<int?, int, string, string> readCell, int rowIndex, ProcessGraph graph)
    {
        var src = node.ReadExtraString("compareValueSourceType");
        if (string.Equals(src, "Memory", StringComparison.OrdinalIgnoreCase))
        {
            var name = node.ReadExtraString("compareMemoryVariableName");
            return memory.TryGetValue(name, out var v) ? v : "";
        }
        if (string.Equals(src, "DataSource", StringComparison.OrdinalIgnoreCase))
        {
            var dsId = node.ReadExtraString("compareDataSourceId");
            var col = node.ReadExtraString("compareDynamicColumn");
            return readCell(int.TryParse(dsId, out var id) ? id : null, rowIndex, col);
        }
        return node.ReadExtraString("constantEqualValue").Length > 0
            ? node.ReadExtraString("constantEqualValue")
            : node.ConstantValue ?? "";
    }

    private static decimal NodeNumber(GraphNode node)
    {
        var raw = node.ReadExtraString("constantEqualValue");
        if (string.IsNullOrWhiteSpace(raw)) raw = node.ConstantValue ?? "";
        return decimal.TryParse(raw, out var d) ? d : 0;
    }

    /// <summary>
    /// Compare two values the way the extension does.
    /// </summary>
    /// <remarks>
    /// String comparison by default, and numeric only when BOTH sides parse as numbers. Comparing
    /// everything numerically would make "01" equal "1", which is wrong for a source cell holding a
    /// code; comparing everything as strings would make "10" less than "9", which is wrong for a
    /// count. Requiring both to be numeric is the only rule that gets both right.
    /// </remarks>
    public static bool Compare(string left, string right, string equality)
    {
        left ??= "";
        right ??= "";
        var leftNumeric = decimal.TryParse(left, out var ln);
        var rightNumeric = decimal.TryParse(right, out var rn);
        var bothNumeric = leftNumeric && rightNumeric;
        // Guarded so the compiler can see rn is definitely assigned when it is used.
        var cmp = bothNumeric ? ln.CompareTo(rn) : string.Compare(left, right, StringComparison.Ordinal);
        var numericEqual = bothNumeric && cmp == 0;
        var textEq = string.Equals(left, right, StringComparison.Ordinal);

        return equality switch
        {
            "equal" or "" => textEq || numericEqual,
            "notEqual" => !(textEq || numericEqual),
            "contains" => left.Contains(right, StringComparison.Ordinal),
            "notContains" => !left.Contains(right, StringComparison.Ordinal),
            "startsWith" => left.StartsWith(right, StringComparison.Ordinal),
            "endsWith" => left.EndsWith(right, StringComparison.Ordinal),
            "greaterThan" => bothNumeric && cmp > 0,
            "lessThan" => bothNumeric && cmp < 0,
            "greaterOrEqual" => bothNumeric && cmp >= 0,
            "lessOrEqual" => bothNumeric && cmp <= 0,
            "hasValue" => !string.IsNullOrWhiteSpace(left),
            "hasNotValue" => string.IsNullOrWhiteSpace(left),
            _ => textEq
        };
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
