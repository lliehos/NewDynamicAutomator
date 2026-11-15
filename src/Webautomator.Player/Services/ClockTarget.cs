using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Webautomator.Player.Services;

/// <summary>
/// A wall-clock target ("08:44:59.990") a step can wait for.
/// </summary>
/// <remarks>
/// This is the Windows player's mirror of the extension's <c>parseClockTargetEpoch</c>. The two must
/// accept exactly the same text and reject exactly the same text: a process that runs on both players
/// must not mean one thing on the extension and something else here. Persian/Arabic-Indic digits are
/// normalised first, because the UI is Persian and a clock typed there is written with those digits.
/// </remarks>
public static class ClockTarget
{
    /// <summary>
    /// "HH:mm" or "HH:mm:ss" or "HH:mm:ss.SSS", with ':' or '.' as the separators (the editor accepts
    /// both) and ',' or '.' before the fraction.
    /// </summary>
    private static readonly Regex Shape = new(
        @"^(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*(\d{2})(?:[.,](\d{1,3}))?)?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Persian/Arabic-Indic digits → ASCII, so a clock typed in the Persian UI still parses.</summary>
    public static string NormalizeDigits(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var sb = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (ch >= '\u06F0' && ch <= '\u06F9') sb.Append((char)('0' + (ch - '\u06F0')));
            else if (ch >= '\u0660' && ch <= '\u0669') sb.Append((char)('0' + (ch - '\u0660')));
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>
    /// Today's LOCAL instant named by <paramref name="text"/>, or <c>null</c> when the text is not a
    /// clock time (a plain number is a duration and must not be read as a clock here).
    /// </summary>
    /// <param name="today">The day the instant belongs to; defaults to today.</param>
    public static DateTime? Parse(string? text, DateTime? today = null)
    {
        var m = Shape.Match(NormalizeDigits(text).Trim());
        if (!m.Success) return null;

        var hour = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        var minute = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        var second = m.Groups[3].Success ? int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture) : 0;
        var fraction = m.Groups[4].Success ? m.Groups[4].Value.PadRight(3, '0')[..3] : "0";
        var millis = int.Parse(fraction, CultureInfo.InvariantCulture);

        if (hour > 23 || minute > 59 || second > 59) return null;

        var day = today ?? DateTime.Now;
        return new DateTime(day.Year, day.Month, day.Day, hour, minute, second, millis, DateTimeKind.Local);
    }

    /// <summary>The instant as Unix epoch milliseconds — the unit the page's <c>Date.now()</c> speaks.</summary>
    public static long? ToEpochMs(string? text)
        => Parse(text) is { } target ? new DateTimeOffset(target).ToUnixTimeMilliseconds() : null;
}
