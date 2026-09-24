namespace Morobot.Contracts.Licensing;

public static class BrandPaletteDefaults
{
    public const string Primary = "#0d9488";
    public const string PrimaryDark = "#0f766e";
    public const string PrimaryLight = "#5eead4";
    public const string Accent = "#0891b2";
    public const string Soft = "#ecfdf5";
    public const string Soft2 = "#ccfbf1";
    public const string Ink = "#134e4a";
    public const string BorderSubtle = "#99f6e4";

    public const string ReferralProductUrl = "https://morobot.ir";

    public static string NormalizeHex(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var v = value.Trim();
        if (!v.StartsWith('#')) v = "#" + v;
        if (v.Length is 4 or 7 && System.Text.RegularExpressions.Regex.IsMatch(v, "^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$"))
            return v.ToLowerInvariant();
        return fallback;
    }

    public static (int R, int G, int B) ParseRgb(string hex)
    {
        hex = NormalizeHex(hex, Primary);
        if (hex.Length == 4)
        {
            hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        return (
            Convert.ToInt32(hex[1..3], 16),
            Convert.ToInt32(hex[3..5], 16),
            Convert.ToInt32(hex[5..7], 16));
    }

    public static string ToRgbCsv(string hex) => ParseRgb(hex) switch
    {
        var (r, g, b) => $"{r}, {g}, {b}"
    };
}
