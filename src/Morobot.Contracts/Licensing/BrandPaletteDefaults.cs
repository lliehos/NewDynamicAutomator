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

    /// <summary>
    /// One ready-made colour scheme. Choosing a preset sets every palette key at once, so an
    /// admin gets a coherent look without having to pick eight colours that agree with each
    /// other. Each palette is tuned so the soft tints and the border stay in the same family
    /// as the primary, which is what a hand-picked set often gets wrong.
    /// </summary>
    public sealed record PalettePreset(
        string Id,
        string NameFa,
        string NameEn,
        string Primary,
        string PrimaryDark,
        string PrimaryLight,
        string Accent,
        string Soft,
        string Soft2,
        string Ink,
        string BorderSubtle);

    /// <summary>
    /// The presets offered in Admin -> Branding, in display order. The first entry is the
    /// shipped default, so "reset to default" is just applying it.
    /// </summary>
    public static readonly IReadOnlyList<PalettePreset> Presets = new[]
    {
        new PalettePreset("teal", "فیروزه‌ای (پیش‌فرض)", "Teal (default)",
            Primary, PrimaryDark, PrimaryLight, Accent, Soft, Soft2, Ink, BorderSubtle),

        new PalettePreset("indigo", "نیلی", "Indigo",
            "#4f46e5", "#3730a3", "#a5b4fc", "#7c3aed",
            "#eef2ff", "#e0e7ff", "#312e81", "#c7d2fe"),

        new PalettePreset("blue", "آبی", "Blue",
            "#2563eb", "#1d4ed8", "#93c5fd", "#0ea5e9",
            "#eff6ff", "#dbeafe", "#1e3a8a", "#bfdbfe"),

        new PalettePreset("violet", "بنفش", "Violet",
            "#7c3aed", "#5b21b6", "#c4b5fd", "#a855f7",
            "#f5f3ff", "#ede9fe", "#4c1d95", "#ddd6fe"),

        new PalettePreset("rose", "سرخابی", "Rose",
            "#e11d48", "#9f1239", "#fda4af", "#db2777",
            "#fff1f2", "#ffe4e6", "#881337", "#fecdd3"),

        new PalettePreset("amber", "کهربایی", "Amber",
            "#d97706", "#b45309", "#fcd34d", "#ea580c",
            "#fffbeb", "#fef3c7", "#78350f", "#fde68a"),

        new PalettePreset("emerald", "زمردی", "Emerald",
            "#059669", "#047857", "#6ee7b7", "#0d9488",
            "#ecfdf5", "#d1fae5", "#064e3b", "#a7f3d0"),

        new PalettePreset("slate", "خاکستری", "Slate",
            "#475569", "#334155", "#cbd5e1", "#0f766e",
            "#f8fafc", "#f1f5f9", "#0f172a", "#e2e8f0")
    };

    /// <summary>The preset matching these values exactly, or null when the palette is hand-picked.</summary>
    public static PalettePreset? MatchPreset(string? primary, string? primaryDark, string? accent)
    {
        if (string.IsNullOrWhiteSpace(primary)) return null;
        var p = NormalizeHex(primary, Primary);
        var dk = NormalizeHex(primaryDark, PrimaryDark);
        var ac = NormalizeHex(accent, Accent);
        return Presets.FirstOrDefault(x =>
            string.Equals(x.Primary, p, StringComparison.OrdinalIgnoreCase)
            && string.Equals(x.PrimaryDark, dk, StringComparison.OrdinalIgnoreCase)
            && string.Equals(x.Accent, ac, StringComparison.OrdinalIgnoreCase));
    }
}
