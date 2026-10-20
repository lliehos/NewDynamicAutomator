using System.Text.Json.Serialization;
using Webautomator.Domain;
using Webautomator.Infrastructure.Services;

namespace Webautomator.Infrastructure.Services;

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

    // Node state colours — were hard-coded in the editor.
    [JsonPropertyName("startFill")] public string? StartFill { get; set; }
    [JsonPropertyName("startStroke")] public string? StartStroke { get; set; }
    [JsonPropertyName("startWarnFill")] public string? StartWarnFill { get; set; }
    [JsonPropertyName("startWarnStroke")] public string? StartWarnStroke { get; set; }
    [JsonPropertyName("stepIgnoreStroke")] public string? StepIgnoreStroke { get; set; }
    [JsonPropertyName("stepIgnoreFill")] public string? StepIgnoreFill { get; set; }

    // Edge colours.
    [JsonPropertyName("edgeNext")] public string? EdgeNext { get; set; }
    [JsonPropertyName("edgeSuccess")] public string? EdgeSuccess { get; set; }
    [JsonPropertyName("edgeFail")] public string? EdgeFail { get; set; }
    [JsonPropertyName("edgeParent")] public string? EdgeParent { get; set; }

    // Canvas / chrome.
    [JsonPropertyName("canvasEdge")] public string? CanvasEdge { get; set; }
    [JsonPropertyName("labelColor")] public string? LabelColor { get; set; }
    [JsonPropertyName("mutedLabel")] public string? MutedLabel { get; set; }

    [JsonPropertyName("selectorLineWidth")] public double? SelectorLineWidth { get; set; }
    [JsonPropertyName("stepDelayMs")] public int? StepDelayMs { get; set; }
    [JsonPropertyName("loopBackLimit")] public int? LoopBackLimit { get; set; }

    /// <summary>Root start node's process-level "continue after a failed step".</summary>
    [JsonPropertyName("ignorePlayError")] public bool? IgnorePlayError { get; set; }

    /// <summary>An inner node's own "ignore this step's error". Stored as <c>ignoreError</c>.</summary>
    [JsonPropertyName("nodeIgnoreError")] public bool? NodeIgnoreError { get; set; }
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

        // Every colour is always sent, never null-when-unset. The editor falls back to its own
        // constant when a field is missing, so leaving one out would make the admin page and the
        // editor disagree about what "the default" is. A stored value that is not a usable hex
        // falls back to the shipped default rather than being dropped.
        foreach (var color in SystemSettingKeys.DiagramColors)
        {
            var hex = HexOrDefault(await _settings.GetAsync(color.Key, color.DefaultValue, ct), color.DefaultValue);
            AssignColor(dto, color.EditorField, hex);
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

        var nodeIgnore = await _settings.GetAsync(SystemSettingKeys.DiagramNodeIgnoreError, "", ct);
        if (!string.IsNullOrWhiteSpace(nodeIgnore)) dto.NodeIgnoreError = IsTrue(nodeIgnore);

        return dto;
    }

    /// <summary>
    /// The setting keys this service owns for saving: the three numeric/behaviour defaults and the
    /// two ignore-error flags. Colours are NOT here — they are saved with the branding palette.
    /// </summary>
    /// <remarks>
    /// Kept as an explicit list so the branding page cannot accidentally write an unrelated setting
    /// whose name happened to reach the posted form.
    /// </remarks>
    public static readonly IReadOnlyList<string> OwnedKeys = new[]
    {
        SystemSettingKeys.DiagramSelectorLineWidth,
        SystemSettingKeys.DiagramStepDelayMs,
        SystemSettingKeys.DiagramLoopBackLimit,
        SystemSettingKeys.DiagramIgnorePlayError,
        SystemSettingKeys.DiagramNodeIgnoreError
    };

    /// <summary>
    /// Persist the diagram behaviour defaults (not the colours) from a posted branding form.
    /// </summary>
    /// <remarks>
    /// Values are read by their setting key so the form and the settings rows keep the same names:
    /// a form field named after the key makes the mapping obvious and means the two pages that can
    /// show these (Settings, before the move, and Branding, now) post identical data.
    ///
    /// Out-of-range numbers are IGNORED rather than clamped. A clamped value would be saved as a
    /// number the admin never typed and cannot see they did not type, whereas ignoring it leaves the
    /// stored value intact and the page re-renders what is really in effect.
    /// </remarks>
    public async Task SaveAsync(IReadOnlyDictionary<string, string?> values, int? actorUserId, string? actorUserName, CancellationToken ct = default)
    {
        var pairs = new List<(string, string)>();

        void AddIfPresent(string key, Func<string, bool> accept, Func<string, string> normalize)
        {
            if (!values.TryGetValue(key, out var raw) || string.IsNullOrWhiteSpace(raw)) return;
            var trimmed = raw.Trim();
            if (accept(trimmed)) pairs.Add((key, normalize(trimmed)));
        }

        AddIfPresent(SystemSettingKeys.DiagramSelectorLineWidth,
            v => double.TryParse(v, out var d) && d >= MinSelectorLineWidth && d <= MaxSelectorLineWidth,
            v => double.Parse(v).ToString(System.Globalization.CultureInfo.InvariantCulture));

        AddIfPresent(SystemSettingKeys.DiagramStepDelayMs,
            v => int.TryParse(v, out var d) && d >= 0 && d <= 60_000,
            v => int.Parse(v).ToString(System.Globalization.CultureInfo.InvariantCulture));

        AddIfPresent(SystemSettingKeys.DiagramLoopBackLimit,
            v => int.TryParse(v, out _),
            v => ClampLoopBackLimit(int.Parse(v)).ToString(System.Globalization.CultureInfo.InvariantCulture));

        // The two switches always have a definite value once the form was submitted, so they are
        // written even when off — that is the difference between "untouched" and "turned off".
        foreach (var key in new[] { SystemSettingKeys.DiagramIgnorePlayError, SystemSettingKeys.DiagramNodeIgnoreError })
        {
            if (values.TryGetValue(key, out var raw) && !string.IsNullOrWhiteSpace(raw))
                pairs.Add((key, IsTrue(raw) ? "true" : "false"));
        }

        if (pairs.Count > 0)
            await _settings.SaveAsync(pairs, actorUserId, actorUserName, ct);
    }

    /// <summary>Write a resolved colour onto the matching editor field.</summary>
    private static void AssignColor(DiagramDefaultsDto dto, string editorField, string hex)    {
        switch (editorField)
        {
            case "stepStroke": dto.StepStroke = hex; break;
            case "stepFill": dto.StepFill = hex; break;
            case "conditionStroke": dto.ConditionStroke = hex; break;
            case "conditionFill": dto.ConditionFill = hex; break;
            case "groupStroke": dto.GroupStroke = hex; break;
            case "highlightColor": dto.HighlightColor = hex; break;
            case "startFill": dto.StartFill = hex; break;
            case "startStroke": dto.StartStroke = hex; break;
            case "startWarnFill": dto.StartWarnFill = hex; break;
            case "startWarnStroke": dto.StartWarnStroke = hex; break;
            case "stepIgnoreStroke": dto.StepIgnoreStroke = hex; break;
            case "stepIgnoreFill": dto.StepIgnoreFill = hex; break;
            case "edgeNext": dto.EdgeNext = hex; break;
            case "edgeSuccess": dto.EdgeSuccess = hex; break;
            case "edgeFail": dto.EdgeFail = hex; break;
            case "edgeParent": dto.EdgeParent = hex; break;
            case "canvasEdge": dto.CanvasEdge = hex; break;
            case "labelColor": dto.LabelColor = hex; break;
            case "mutedLabel": dto.MutedLabel = hex; break;
        }
    }

    /// <summary>Clamp to the range the engine honours, so the UI never promises a value it will not use.</summary>
    public static int ClampLoopBackLimit(int value) =>
        Math.Clamp(value, MinLoopBackLimit, MaxLoopBackLimit);

    private static bool IsTrue(string? raw) =>
        string.Equals(raw?.Trim(), "true", StringComparison.OrdinalIgnoreCase) || raw?.Trim() == "1";

    /// <summary>
    /// The stored colour when it is a usable hex, otherwise the shipped default.
    /// </summary>
    /// <remarks>
    /// A colour is always resolved to something drawable. The previous behaviour skipped an invalid
    /// value entirely, which left the editor on its own constant — so the admin page showed the bad
    /// value while the canvas showed a different one, and neither said so.
    /// </remarks>
    public static string HexOrDefault(string? raw, string fallback) =>
        HexOrNull(raw) ?? HexOrNull(fallback) ?? "#000000";

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
