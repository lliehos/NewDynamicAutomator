using System.Text.Json.Serialization;
using Morobot.Domain;
using Morobot.Infrastructure.Services;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// The diagram defaults the editor starts from, resolved from admin settings.
/// </summary>
/// <remarks>
/// Values are nullable on purpose: <c>null</c> means "no opinion, use the editor's own
/// default", which is what a colour whose switch is off must produce. Sending the colour
/// anyway and letting the client ignore it would put the two sides out of step the first
/// time one of them changed.
/// </remarks>
public sealed class DiagramDefaultsDto
{
    [JsonPropertyName("stepStroke")] public string? StepStroke { get; set; }
    [JsonPropertyName("stepFill")] public string? StepFill { get; set; }
    [JsonPropertyName("conditionStroke")] public string? ConditionStroke { get; set; }
    [JsonPropertyName("conditionFill")] public string? ConditionFill { get; set; }
    [JsonPropertyName("groupStroke")] public string? GroupStroke { get; set; }
    [JsonPropertyName("highlightColor")] public string? HighlightColor { get; set; }
    [JsonPropertyName("selectorLineWidth")] public double? SelectorLineWidth { get; set; }
    [JsonPropertyName("stepDelayMs")] public int? StepDelayMs { get; set; }
    [JsonPropertyName("loopBackLimit")] public int? LoopBackLimit { get; set; }
    [JsonPropertyName("ignorePlayError")] public bool? IgnorePlayError { get; set; }
}

/// <summary>Reads and validates the diagram defaults.</summary>
public sealed class DiagramSettingsService
{
    /// <summary>Loop-back ceiling the engine itself clamps to; must agree with resolveLoopBackLimit.</summary>
    public const int MinLoopBackLimit = 1;
    public const int MaxLoopBackLimit = 1000;
    public const int DefaultLoopBackLimit = 100;
    public const double MinSelectorLineWidth = 1;
    public const double MaxSelectorLineWidth = 12;

    private readonly SystemSettingsService _settings;

    public DiagramSettingsService(SystemSettingsService settings) => _settings = settings;

    public async Task<DiagramDefaultsDto> GetAsync(CancellationToken ct = default)
    {
        var dto = new DiagramDefaultsDto();

        foreach (var (setting, enabledSwitch) in SystemSettingKeys.DiagramColorPairs)
        {
            // A colour is only offered when its switch is on AND the stored value is a usable
            // hex. A switch left on over a value someone typed badly must not put an invalid
            // colour into the editor, where it would surface as an invisible node.
            if (!await IsSwitchOnAsync(enabledSwitch, ct)) continue;
            var hex = HexOrNull(await _settings.GetAsync(setting, "", ct));
            if (hex is null) continue;

            switch (setting)
            {
                case SystemSettingKeys.DiagramStepStroke: dto.StepStroke = hex; break;
                case SystemSettingKeys.DiagramStepFill: dto.StepFill = hex; break;
                case SystemSettingKeys.DiagramConditionStroke: dto.ConditionStroke = hex; break;
                case SystemSettingKeys.DiagramConditionFill: dto.ConditionFill = hex; break;
                case SystemSettingKeys.DiagramGroupStroke: dto.GroupStroke = hex; break;
                case SystemSettingKeys.DiagramHighlightColor: dto.HighlightColor = hex; break;
            }
        }

        var width = await _settings.GetAsync(SystemSettingKeys.DiagramSelectorLineWidth, "", ct);
        if (double.TryParse(width, out var w) && w >= MinSelectorLineWidth && w <= MaxSelectorLineWidth)
            dto.SelectorLineWidth = w;

        var delay = await _settings.GetAsync(SystemSettingKeys.DiagramStepDelayMs, "", ct);
        if (int.TryParse(delay, out var d) && d >= 0 && d <= 60_000)
            dto.StepDelayMs = d;

        var loop = await _settings.GetAsync(SystemSettingKeys.DiagramLoopBackLimit, "", ct);
        if (int.TryParse(loop, out var l))
            dto.LoopBackLimit = ClampLoopBackLimit(l);

        var ignore = await _settings.GetAsync(SystemSettingKeys.DiagramIgnorePlayError, "", ct);
        if (!string.IsNullOrWhiteSpace(ignore)) dto.IgnorePlayError = IsTrue(ignore);

        return dto;
    }

    /// <summary>Clamp to the range the engine honours, so the UI never promises a value it will not use.</summary>
    public static int ClampLoopBackLimit(int value) =>
        Math.Clamp(value, MinLoopBackLimit, MaxLoopBackLimit);

    private async Task<bool> IsSwitchOnAsync(string key, CancellationToken ct)
        => IsTrue(await _settings.GetAsync(key, "true", ct));

    private static bool IsTrue(string? raw) =>
        string.Equals(raw?.Trim(), "true", StringComparison.OrdinalIgnoreCase) || raw?.Trim() == "1";

    /// <summary>
    /// Accept only a 3- or 6-digit hex colour and return it in six-digit lower-case form.
    /// Anything else is treated as unset. The three-digit form is expanded rather than passed
    /// through so the server and the editor cannot end up describing the same colour with two
    /// different strings, which makes an equality check between them unreliable.
    /// </summary>
    public static string? HexOrNull(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var v = raw.Trim();
        if (!v.StartsWith('#')) v = "#" + v;
        if (!System.Text.RegularExpressions.Regex.IsMatch(v, "^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$"))
            return null;

        if (v.Length == 4)
            v = $"#{v[1]}{v[1]}{v[2]}{v[2]}{v[3]}{v[3]}";

        return v.ToLowerInvariant();
    }
}
