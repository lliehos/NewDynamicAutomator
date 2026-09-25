using System.Globalization;

namespace Morobot.Web.Services;

/// <summary>
/// Formats a date/time for display in whichever language the request is using.
///
/// The culture is already set per request (fa-IR or en-US), and fa-IR carries the Persian calendar —
/// so formatting through <see cref="CultureInfo.CurrentCulture"/> yields a Jalali date in Persian and
/// a Gregorian one in English WITHOUT any branching on language here. The previous code formatted
/// with a hard-coded "yyyy-MM-dd HH:mm" and InvariantCulture in places, which produced a Latin-digit
/// Gregorian date even in the Persian UI.
/// </summary>
public static class DateDisplay
{
    /// <summary>Date and time, e.g. "1404/07/03 14:05" (fa) or "03/07/2025 14:05" (en).</summary>
    public static string DateTimeLocal(System.DateTime value)
        => value.ToLocalTime().ToString("g", CultureInfo.CurrentCulture);

    /// <summary>Same as <see cref="DateTimeLocal(System.DateTime)"/> for a nullable value.</summary>
    public static string DateTimeLocal(System.DateTime? value)
        => value.HasValue ? DateTimeLocal(value.Value) : "—";

    /// <summary>Date only, for tables where the time is noise.</summary>
    public static string DateLocal(System.DateTime value)
        => value.ToLocalTime().ToString("d", CultureInfo.CurrentCulture);

    /// <summary>Just the day and month, for a chart axis: "07-03" (fa) / "03/07" (en).</summary>
    public static string DayMonthLocal(System.DateTime value)
        => value.ToLocalTime().ToString("MM-dd", CultureInfo.CurrentCulture);

    /// <summary>
    /// Date and time for an instant that is already UTC, converted to the viewer's local zone first.
    /// Kept as a named method so callers do not have to remember the conversion.
    /// </summary>
    public static string UtcDateTimeLocal(System.DateTime utc)
        => DateTime.SpecifyKind(utc, System.DateTimeKind.Utc)
            .ToLocalTime()
            .ToString("g", CultureInfo.CurrentCulture);
}
