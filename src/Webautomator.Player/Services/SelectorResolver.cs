using System.Globalization;
using System.Text.RegularExpressions;
using Webautomator.Player.Models;

namespace Webautomator.Player.Services;

/// <summary>
/// The walk's row context for one node execution.
/// </summary>
/// <param name="GroupRow">The row of the level this node sits on (a group's repeat row).</param>
/// <param name="ParentRow">The row of the level above, for «حلقهٔ والد».</param>
/// <param name="ProcessRow">The process loop's row — never rebound by a group.</param>
/// <param name="LoopIndex">The process iteration's 1-based ordinal.</param>
/// <param name="CombinedIndex">
/// The 0-based combined position (process × groups) used by a selector's «کل حلقه‌ها» mode.
/// </param>
internal sealed record RowScope(int GroupRow, int ParentRow, int ProcessRow, int LoopIndex, int CombinedIndex);

/// <summary>
/// Turns a node's selector TEMPLATE into the selector this run should actually use.
/// </summary>
/// <remarks>
/// Port of <c>resolveDynamicSelectorAsync</c> + <c>appendAttributeFilterAsync</c> in engine.js. A
/// selector may be built from data: the <c>{مقدار پویا}</c> placeholder (or a legacy
/// <c>{{Column}}</c> token) is filled from a source cell or from the loop index, and an optional
/// <c>[attr="value"]</c> filter is appended. Both sides follow the same rules — the target
/// (<c>selector*</c>) and the value side (<c>equalSelector*</c>) — because the editor shows the same
/// picker for both.
///
/// A missing value is an ERROR, never an empty substitution: dropping a placeholder still yields a
/// selector that PARSES but points somewhere else, so the click would land on the wrong element and
/// nothing would report a problem. That is the same refusal engine.js makes.
/// </remarks>
internal sealed class SelectorResolver
{
    /// <summary>The placeholder the editor's picker inserts.</summary>
    public const string DynamicPlaceholder = "{مقدار پویا}";

    /// <summary>A token a graph saved before the picker existed may carry.</summary>
    private static readonly Regex LegacyToken = new(@"\{\{\s*([^}]+?)\s*\}\}", RegexOptions.Compiled);

    private readonly ProcessGraph _graph;

    /// <summary>Reads one cell; <c>false</c> means "the value could not be read".</summary>
    private readonly Func<int, int, string, (bool Ok, string Value)> _readCell;

    /// <summary>Reports a refused read the way the run log reports every other refusal.</summary>
    private readonly Action<string> _logError;

    public SelectorResolver(
        ProcessGraph graph,
        Func<int, int, string, (bool Ok, string Value)> readCell,
        Action<string> logError)
    {
        _graph = graph;
        _readCell = readCell;
        _logError = logError;
    }

    /// <summary>
    /// Resolve both selector sides of a node into the overrides the executors read.
    /// </summary>
    /// <param name="nodeRow">The row the node's own row pointer already picked.</param>
    /// <param name="selectorRow">
    /// The row the SELECTOR's own pointer picked, when it has one. Without it the selector follows
    /// the node's row, exactly as it did before that second switch existed.
    /// </param>
    public void ResolveNode(GraphNode node, int nodeRow, int? selectorRow, RowScope scope)
    {
        var row = selectorRow ?? nodeRow;
        node.ResolvedSelector = ResolveTarget(node, row, scope);
        if (HasValueSideSelector(node))
            node.ResolvedEqualSelector = ResolveValueSide(node, row, scope);
    }

    private static bool HasValueSideSelector(GraphNode node)
        => !string.IsNullOrWhiteSpace(node.EqualSelectorValue)
           || node.ReadExtraBool("equalSelectorIsDynamic", false)
           || node.ReadExtraBool("equalHasAttribute", false);

    /// <summary>The target selector (<c>selectorValue</c> side).</summary>
    public string ResolveTarget(GraphNode node, int row, RowScope scope)
        => Resolve(
            node.SelectorValue, node, row, scope,
            dynFlag: "selectorIsDynamic",
            dynDs: "selectorDataSourceId",
            dynCol: "selectorDynamicColumn",
            hasAttr: "hasAttribute",
            attrName: "attributeName",
            attrDynFlag: "attributeValueIsDynamic",
            attrValue: "attributeValue",
            attrDynCol: "attributeDynamicColumn",
            attrDynDs: "attributeDataSourceId");

    /// <summary>The value-side selector (<c>equalSelectorValue</c> side).</summary>
    public string ResolveValueSide(GraphNode node, int row, RowScope scope)
        => Resolve(
            node.EqualSelectorValue, node, row, scope,
            dynFlag: "equalSelectorIsDynamic",
            dynDs: "equalSelectorDataSourceId",
            dynCol: "equalSelectorDynamicColumn",
            hasAttr: "equalHasAttribute",
            attrName: "equalAttributeName",
            attrDynFlag: "equalAttributeValueIsDynamic",
            attrValue: "equalAttributeValue",
            attrDynCol: "equalAttributeDynamicColumn",
            attrDynDs: "equalAttributeDataSourceId");

    private string Resolve(
        string? template, GraphNode node, int row, RowScope scope,
        string dynFlag, string dynDs, string dynCol,
        string hasAttr, string attrName,
        string attrDynFlag, string attrValue, string attrDynCol, string attrDynDs)
    {
        var sel = template ?? "";
        if (sel.Length == 0) return sel;

        var hasPlaceholder = sel.Contains(DynamicPlaceholder);
        var hasLegacyToken = LegacyToken.IsMatch(sel);
        if (node.ReadExtraBool(dynFlag, false) || hasPlaceholder || hasLegacyToken)
        {
            var source = FindSource(node, node.ReadExtraInt(dynDs));
            var column = node.ReadExtraString(dynCol);

            if (hasPlaceholder)
            {
                var value = UsesLoopIndex(node, dynFlag)
                    ? IndexText(node, dynFlag, row, scope)
                    : source is not null && column.Length > 0
                        ? ReadCellOrThrow(source.Id, row, column)
                        : "";
                sel = sel.Replace(DynamicPlaceholder, value);
            }

            if (LegacyToken.IsMatch(sel))
            {
                sel = LegacyToken.Replace(sel, m =>
                {
                    var key = m.Groups[1].Value.Trim();
                    return source is null ? "" : ReadCellOrThrow(source.Id, row, key);
                });
            }
        }

        return AppendAttributeFilter(
            sel, node, row, scope,
            hasAttr, attrName, attrDynFlag, attrValue, attrDynCol, attrDynDs);
    }

    /// <summary>Append <c>[name="value"]</c> when the node's attribute filter is on.</summary>
    private string AppendAttributeFilter(
        string sel, GraphNode node, int row, RowScope scope,
        string hasAttr, string attrName,
        string attrDynFlag, string attrValue, string attrDynCol, string attrDynDs)
    {
        if (sel.Length == 0 || !node.ReadExtraBool(hasAttr, false)) return sel;
        var name = node.ReadExtraString(attrName).Trim();
        if (name.Length == 0) return sel;

        string value;
        if (node.ReadExtraBool(attrDynFlag, false))
        {
            if (UsesLoopIndex(node, attrDynFlag))
            {
                value = IndexText(node, attrDynFlag, row, scope);
            }
            else
            {
                var source = FindSource(node, node.ReadExtraInt(attrDynDs));
                var column = node.ReadExtraString(attrDynCol);
                // A missing attribute value would build [data-id=""] — a selector that matches the
                // wrong element. Refuse, exactly as the extension does.
                value = source is not null && column.Length > 0
                    ? ReadCellOrThrow(source.Id, row, column)
                    : "";
            }
        }
        else
        {
            value = node.ReadExtraString(attrValue);
        }

        var escapedName = name.Replace("\\", "\\\\").Replace("\"", "\\\"");
        var escapedValue = value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        return $"{sel}[{escapedName}=\"{escapedValue}\"]";
    }

    // ---- Dynamic-index plumbing ----------------------------------------------------------------

    /// <summary>Whether a dynamic selector is fed by the loop index instead of a source cell.</summary>
    private static bool UsesLoopIndex(GraphNode node, string dynFlag)
        => string.Equals(node.ReadExtraString(ModeKey(dynFlag)), "LoopIndex", StringComparison.Ordinal);

    /// <summary>
    /// The number a loop-index selector substitutes.
    /// </summary>
    /// <remarks>
    /// Mirrors <c>dynIndexText</c>: «شمارهٔ ثابت» is used exactly as typed (it is a page position,
    /// not a row), the run ordinal is already 1-based, and every other pointer names a 0-based row
    /// whose CSS form (<c>:nth-child</c>) counts from 1.
    /// </remarks>
    private string IndexText(GraphNode node, string dynFlag, int row, RowScope scope)
    {
        var pointer = node.ReadExtraString(IndexTypeKey(dynFlag));
        if (pointer.Length == 0) pointer = "CurrentLoop";

        if (string.Equals(pointer, "SpecificRow", StringComparison.Ordinal))
        {
            var literal = node.ReadExtraString(IndexValueKey(dynFlag)).Trim();
            if (double.TryParse(literal, NumberStyles.Float, CultureInfo.InvariantCulture, out var fixedIndex))
                return fixedIndex.ToString(CultureInfo.InvariantCulture);
            // No usable literal: fall through so a damaged node still resolves something.
        }

        // `TotalLoop` is the run ORDINAL, which is already 1-based: it must not be shifted again.
        if (string.Equals(pointer, "TotalLoop", StringComparison.Ordinal))
            return scope.LoopIndex.ToString(CultureInfo.InvariantCulture);

        if (string.Equals(pointer, "CombinedLoop", StringComparison.Ordinal))
            return (scope.CombinedIndex + 1).ToString(CultureInfo.InvariantCulture);

        // Every remaining pointer names a 0-based row; CSS counts from 1.
        var used = PointerRow(pointer, node, scope) ?? row;
        return (used + 1).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>The row a simple row-pointer names, or null when the pointer is unknown.</summary>
    private int? PointerRow(string pointer, GraphNode node, RowScope scope) => pointer switch
    {
        "CurrentLoop" or "GroupLoop" => scope.GroupRow,
        "ParentLoop" => scope.ParentRow,
        "ProcessLoop" => scope.ProcessRow,
        "FirstRow" => 0,
        "LastRow" => LastRow(node),
        _ => null
    };

    /// <summary>The last row of the source a row pointer resolves against, when its count is known.</summary>
    private int? LastRow(GraphNode node)
    {
        var source = FindSource(node, node.ReadExtraInt("selectorDataSourceId"));
        return source is not null && source.RowCount > 0 ? source.RowCount - 1 : null;
    }

    private static string ModeKey(string dynFlag)
        => dynFlag.Replace("IsDynamic", "", StringComparison.Ordinal) + "DynamicMode";

    private static string IndexTypeKey(string dynFlag) => IndexBase(dynFlag) + "DynamicIndexType";

    private static string IndexValueKey(string dynFlag) => IndexBase(dynFlag) + "DynamicIndexValue";

    /// <summary>
    /// The key prefix of a dynamic configuration's index fields.
    /// </summary>
    /// <remarks>
    /// The editor derives it from the VALUE key (<c>selectorValue</c> → <c>selector</c>,
    /// <c>attributeValue</c> → <c>attribute</c>), which is the dynamic flag without its
    /// <c>IsDynamic</c> suffix and without a trailing <c>Value</c>.
    /// </remarks>
    private static string IndexBase(string dynFlag)
    {
        var baseName = dynFlag.Replace("IsDynamic", "", StringComparison.Ordinal);
        if (baseName.EndsWith("Value", StringComparison.Ordinal))
            baseName = baseName[..^"Value".Length];
        return baseName;
    }

    // ---- Source lookup -------------------------------------------------------------------------

    /// <summary>
    /// The source a dynamic selector reads, in the same order the editor/engine use.
    /// </summary>
    /// <remarks>
    /// The selector's own source wins; then the node's source; then its group's; then the process
    /// start's. Falling back to the first source (rather than none) keeps a graph that never named
    /// a source running the way it did before the field existed.
    /// </remarks>
    private GraphDataSource? FindSource(GraphNode node, int? explicitId)
    {
        var sources = _graph.DataSources;
        if (sources.Count == 0) return null;

        var groupSourceId = node.GroupNodeId is { Length: > 0 } groupId
            ? _graph.NodeById(groupId)?.DataSourceId
            : null;
        var id = explicitId ?? node.DataSourceId ?? groupSourceId ?? _graph.StartNode?.DataSourceId;
        if (id is int wanted)
        {
            var found = sources.FirstOrDefault(d => d.Id == wanted);
            if (found is not null) return found;
        }
        return sources[0];
    }

    /// <summary>Read a cell, refusing to continue when it cannot be read.</summary>
    private string ReadCellOrThrow(int dsId, int rowIndex, string columnKey)
    {
        var (ok, value) = _readCell(dsId, rowIndex, columnKey);
        if (ok) return value;

        var message =
            $"مقدار سلکتور پویا از منبع داده خوانده نشد (منبع {dsId}، ستون «{columnKey}»، ردیف {rowIndex + 1}) — " +
            "از مقدار خالی به‌جای دادهٔ واقعی استفاده نمی‌شود.";
        _logError(message);
        throw new InvalidOperationException(message);
    }
}
