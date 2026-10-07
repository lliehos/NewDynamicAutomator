using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Morobot.Player;

/// <summary>
/// Edits the two run settings a desktop user actually wants to touch: the step gap and the highlight
/// colour.
/// </summary>
/// <remarks>
/// These live on the process's start node, exactly as they do in the editor, so a change made here
/// is the SAME setting the panel shows — not a desktop-only override that would make one process
/// behave differently depending on who ran it.
///
/// Editing them from the player exists because they are the two things an operator adjusts *while
/// watching a run*: a page that needs longer between steps, and a colour that is hard to see on a
/// particular site. Sending them back to the panel editor for that would defeat the point.
/// </remarks>
public partial class RunSettingsWindow : Window
{
    private static readonly string DefaultColor = "#7367F0";

    /// <summary>The step gap the user chose, in milliseconds.</summary>
    public int StepDelayMs { get; private set; }

    /// <summary>The highlight colour the user chose, as #RRGGBB.</summary>
    public string HighlightColor { get; private set; } = DefaultColor;

    public RunSettingsWindow(int stepDelayMs, string? highlightColor)
    {
        InitializeComponent();
        StepDelayBox.Text = Math.Max(0, stepDelayMs).ToString();
        var color = NormalizeColor(highlightColor) ?? DefaultColor;
        ColorTextBox.Text = color;
        SetSwatch(color);
        ColorTextBox.TextChanged += (_, _) =>
        {
            var normalized = NormalizeColor(ColorTextBox.Text);
            if (normalized is not null) SetSwatch(normalized);
        };
    }

    private void SetSwatch(string color)
    {
        try { ColorSwatch.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)); }
        catch { /* an unparseable colour simply leaves the swatch as it was */ }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(StepDelayBox.Text?.Trim(), out var delay) || delay < 0)
        {
            StatusText.Text = "فاصله بین مراحل باید عددی صفر یا بیشتر باشد.";
            return;
        }
        // Cap matches the editor's own limit, so the player cannot save a value the editor would
        // then clamp on next open — which would look like the setting silently reverted.
        if (delay > 60000)
        {
            StatusText.Text = "فاصله بین مراحل حداکثر ۶۰۰۰۰ میلی‌ثانیه است.";
            return;
        }
        var color = NormalizeColor(ColorTextBox.Text);
        if (color is null)
        {
            StatusText.Text = "کد رنگ معتبر نیست (مثال: #7367F0).";
            return;
        }

        StepDelayMs = delay;
        HighlightColor = color;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    /// <summary>
    /// Accept a colour only in the #RRGGBB form the editor stores.
    /// </summary>
    /// <remarks>
    /// Deliberately strict: the value is written into the process graph and read by both the player
    /// and the extension, so a loose value ("red", "#f00", "rgb(…") would be accepted here and then
    /// silently ignored there — the worst outcome, since the colour would simply stop working.
    /// </remarks>
    private static string? NormalizeColor(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (s.Length == 0) return null;
        if (!s.StartsWith('#')) s = "#" + s;
        if (s.Length != 7) return null;
        for (var i = 1; i < 7; i++)
        {
            if (!Uri.IsHexDigit(s[i])) return null;
        }
        return s.ToUpperInvariant();
    }
}
