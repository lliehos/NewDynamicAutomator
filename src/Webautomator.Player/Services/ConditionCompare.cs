using System.Globalization;
using System.Text.RegularExpressions;

namespace Webautomator.Player.Services;

/// <summary>
/// The one comparison used by every condition, in every runner.
/// </summary>
/// <remarks>
/// Sharing this between the browser engine and this runner matters more than it looks: a process
/// that takes one branch during development and another during a real run is the hardest kind of
/// bug to find, and it is exactly what happens when two copies drift.
///
/// Rules (kept identical to <c>compareConditionValues</c> in engine.js):
///   * the operator is normalised first — the editor stores <c>BiggerThan</c>, older saves store
///     <c>greaterThan</c>, a hand-edited graph may store <c>&gt;</c>, and all three mean the same;
///   * ordering compares CLOCK values as clock values: <c>09:10</c> is after <c>08:45</c> even
///     though neither is a number. This used to fail for every time-of-day comparison;
///   * otherwise numbers compare numerically only when BOTH sides parse as numbers, and anything
///     else compares as ordinal text, so "01" is not "1" and "10" is still after "9".
/// </remarks>
public static class ConditionCompare
{
    /// <summary>Canonical operator names, after normalisation.</summary>
    public const string Equal = "equal";
    public const string NotEqual = "notequal";
    public const string Greater = "greater";
    public const string Less = "less";
    public const string GreaterOrEqual = "greaterorequal";
    public const string LessOrEqual = "lessorequal";
    public const string Contains = "contains";
    public const string StartsWith = "startswith";
    public const string EndsWith = "endswith";
    public const string HasValue = "hasvalue";
    public const string HasNotValue = "hasnotvalue";

    /// <summary>
    /// Normalise the many spellings of one operator into a single name.
    /// </summary>
    /// <remarks>
    /// The domain enum (<c>EqualityType.BiggerThan</c>) and the editor's option values are Pascal
    /// case; the evaluator's old switch expected camel case and therefore fell through to "equal"
    /// for every save made by the current editor. Stripping separators and lowercasing is what makes
    /// both spellings — and any future one — land on the same branch.
    /// </remarks>
    public static string NormalizeOperator(string? equality)
    {
        var raw = (equality ?? "").Trim();
        if (raw.Length == 0) return Equal;
        var k = raw.ToLowerInvariant().Replace("_", "").Replace("-", "").Replace(" ", "");

        return k switch
        {
            "equal" or "equals" or "==" or "=" or "eq" => Equal,
            "notequal" or "not" or "!=" or "<>" or "ne" => NotEqual,
            "biggerthan" or "greaterthan" or "gt" or ">" => Greater,
            "smallerthan" or "lessthan" or "lt" or "<" => Less,
            "biggerorequal" or "greaterthanorequal" or "greaterorequal" or "gte" or ">=" => GreaterOrEqual,
            "smallerorequal" or "lessthanorequal" or "lessorequal" or "lte" or "<=" => LessOrEqual,
            "contain" or "contains" => Contains,
            "notcontain" or "notcontains" => "notcontains",
            "startwith" or "startswith" => StartsWith,
            "endwith" or "endswith" => EndsWith,
            "hasvalue" => HasValue,
            "hasnotvalue" or "novalue" => HasNotValue,
            // An unknown operator must not silently become "equal": that turned "bigger than" into
            // "is exactly" on a save whose spelling we did not anticipate. Exact match is the old
            // fallback, kept, but recognised spellings never reach here.
            _ => Equal
        };
    }

    public static bool Compare(string? left, string? right, string? equality)
    {
        var a = left ?? "";
        var b = right ?? "";
        return CompareNormalized(a, b, NormalizeOperator(equality));
    }

    /// <summary>Compare with an operator already produced by <see cref="NormalizeOperator"/>.</summary>
    public static bool CompareNormalized(string a, string b, string op)
    {
        switch (op)
        {
            case HasValue: return !string.IsNullOrWhiteSpace(a);
            case HasNotValue: return string.IsNullOrWhiteSpace(a);
            case Contains: return a.Contains(b, StringComparison.Ordinal);
            case "notcontains": return !a.Contains(b, StringComparison.Ordinal);
            case StartsWith: return a.StartsWith(b, StringComparison.Ordinal);
            case EndsWith: return a.EndsWith(b, StringComparison.Ordinal);
        }

        // Equality: a number and its own text are the same value, so "1" matches "01" — this is the
        // rule the runner already had, and the browser engine now matches it instead of comparing
        // raw text.
        var aIsNumber = TryNumber(a, out var na);
        var bIsNumber = TryNumber(b, out var nb);
        var bothNumeric = aIsNumber && bIsNumber;
        if (op == Equal) return (bothNumeric && na == nb) || string.Equals(a, b, StringComparison.Ordinal);
        if (op == NotEqual) return !((bothNumeric && na == nb) || string.Equals(a, b, StringComparison.Ordinal));

        if (bothNumeric)
        {
            var cmp = na.CompareTo(nb);
            return op switch
            {
                Greater => cmp > 0,
                Less => cmp < 0,
                GreaterOrEqual => cmp >= 0,
                LessOrEqual => cmp <= 0,
                _ => false
            };
        }

        // Clock/date ordering. Checked only for the ordering operators, so an "equal" comparison on
        // two timestamps keeps the plain text rule.
        if (TryCompareClock(a, b, out var clockCmp))
        {
            return op switch
            {
                Greater => clockCmp > 0,
                Less => clockCmp < 0,
                GreaterOrEqual => clockCmp >= 0,
                LessOrEqual => clockCmp <= 0,
                _ => false
            };
        }

        // Text ordering as a last resort: "bigger than" on two words is not a page concept, but
        // answering false for every non-numeric pair made a mis-set-up condition look like a false
        // verdict. Ordinal keeps it deterministic and locale-independent.
        var textCmp = string.Compare(a, b, StringComparison.Ordinal);
        return op switch
        {
            Greater => textCmp > 0,
            Less => textCmp < 0,
            GreaterOrEqual => textCmp >= 0,
            LessOrEqual => textCmp <= 0,
            _ => false
        };
    }

    private static bool TryNumber(string s, out decimal value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(s)) return false;
        return decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out value)
            || decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.CurrentCulture, out value);
    }

    private static readonly Regex TimeHms = new(@"^(\d{1,2}):(\d{2}):(\d{2})$", RegexOptions.Compiled);
    private static readonly Regex TimeHm = new(@"^(\d{1,2}):(\d{2})$", RegexOptions.Compiled);
    private static readonly Regex TimeHmsShort = new(@"^(\d{2})(\d{2})(\d{2})$", RegexOptions.Compiled);
    private static readonly Regex DateYmdDash = new(@"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", RegexOptions.Compiled);
    private static readonly Regex DateDmyDash = new(@"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$", RegexOptions.Compiled);
    private static readonly Regex DateYmdCompact = new(@"^(\d{4})(\d{2})(\d{2})$", RegexOptions.Compiled);

    /// <summary>
    /// Order two values that look like a clock time or a calendar date.
    /// </summary>
    /// <remarks>
    /// Only orderable when BOTH sides use the same shape. A time compared against a date, or a
    /// 4-digit year against a timestamp, has no honest ordering, and guessing one is worse than
    /// saying "cannot order these" and falling back to the caller's rule.
    /// </remarks>
    public static bool TryCompareClock(string a, string b, out int comparison)
    {
        comparison = 0;
        var x = a.Trim();
        var y = b.Trim();
        if (x.Length == 0 || y.Length == 0) return false;

        if (TryParseTime(x, out var tx) && TryParseTime(y, out var ty))
        {
            comparison = tx.CompareTo(ty);
            return true;
        }
        if (TryParseDate(x, out var dx) && TryParseDate(y, out var dy))
        {
            comparison = dx.CompareTo(dy);
            return true;
        }
        // Two full timestamps ("2026-11-10 08:45:00" / "2026/11/10 08:45") — the shape a page
        // usually shows. Compared as a calendar date plus a time of day.
        if (TryParseTimestamp(x, out var sx) && TryParseTimestamp(y, out var sy))
        {
            comparison = sx.CompareTo(sy);
            return true;
        }
        return false;
    }

    private static bool TryParseTime(string s, out TimeSpan time)
    {
        time = default;
        var m = TimeHms.Match(s);
        if (m.Success)
        {
            if (!TryParts(m, 1, out var h, out var mi, out var se)) return false;
            if (h > 23 || mi > 59 || se > 59) return false;
            time = new TimeSpan(h, mi, se);
            return true;
        }
        m = TimeHm.Match(s);
        if (m.Success)
        {
            if (!int.TryParse(m.Groups[1].Value, out var h) || !int.TryParse(m.Groups[2].Value, out var mi)) return false;
            if (h > 23 || mi > 59) return false;
            time = new TimeSpan(h, mi, 0);
            return true;
        }
        m = TimeHmsShort.Match(s);
        if (m.Success)
        {
            if (!TryParts(m, 1, out var h, out var mi, out var se)) return false;
            if (h > 23 || mi > 59 || se > 59) return false;
            time = new TimeSpan(h, mi, se);
            return true;
        }
        return false;
    }

    private static bool TryParseDate(string s, out DateTime date)
    {
        date = default;
        var m = DateYmdDash.Match(s);
        if (m.Success)
            return TryDateParts(m, 1, out date);
        m = DateYmdCompact.Match(s);
        if (m.Success)
            return TryDateParts(m, 1, out date);
        m = DateDmyDash.Match(s);
        if (m.Success)
        {
            if (!int.TryParse(m.Groups[3].Value, out var y)
                || !int.TryParse(m.Groups[2].Value, out var mo)
                || !int.TryParse(m.Groups[1].Value, out var d)) return false;
            return TryMakeDate(y, mo, d, out date);
        }
        return false;
    }

    private static bool TryParseTimestamp(string s, out DateTime stamp)
    {
        stamp = default;
        var idx = s.IndexOf('T');
        if (idx < 0) idx = s.IndexOf(' ');
        if (idx <= 0) return false;
        var datePart = s[..idx];
        var timePart = s[(idx + 1)..].Trim();
        if (!TryParseDate(datePart, out var d)) return false;
        if (!TryParseTime(timePart, out var t)) return false;
        stamp = d.Add(t);
        return true;
    }

    private static bool TryParts(Match m, int first, out int h, out int mi, out int se)
    {
        h = mi = se = 0;
        return int.TryParse(m.Groups[first].Value, out h)
            && int.TryParse(m.Groups[first + 1].Value, out mi)
            && int.TryParse(m.Groups[first + 2].Value, out se);
    }

    private static bool TryDateParts(Match m, int first, out DateTime date)
    {
        date = default;
        if (!int.TryParse(m.Groups[first].Value, out var y)
            || !int.TryParse(m.Groups[first + 1].Value, out var mo)
            || !int.TryParse(m.Groups[first + 2].Value, out var d)) return false;
        return TryMakeDate(y, mo, d, out date);
    }

    private static bool TryMakeDate(int y, int mo, int d, out DateTime date)
    {
        date = default;
        if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
        try
        {
            date = new DateTime(y, mo, d);
            return date.Year == y && date.Month == mo && date.Day == d;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}
