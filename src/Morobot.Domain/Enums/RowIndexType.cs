namespace Morobot.Domain.Enums;

/// <summary>
/// How a step points at a row of a data source. Persisted by name and value inside GraphJson, so
/// existing numbers must not move; new members are appended.
/// </summary>
public enum RowIndexType
{
    /// <summary>Follow whatever the surrounding loop is currently on (the default behaviour).</summary>
    None = 0,
    /// <summary>The last row that exists in the source.</summary>
    LastRow,
    /// <summary>The row of the nearest enclosing loop.</summary>
    CurrentLoop,
    /// <summary>The row of the loop one level up.</summary>
    ParentLoop,
    /// <summary>Index within the total loop count.</summary>
    TotalLoop,
    /// <summary>The first row that exists in the source.</summary>
    FirstRow,
    /// <summary>An explicitly chosen row, held in <c>specificRowIndex</c> on the node.</summary>
    SpecificRow
}
