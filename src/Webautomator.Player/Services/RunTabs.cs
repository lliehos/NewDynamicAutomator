namespace Webautomator.Player.Services;

/// <summary>
/// The named tabs a run has opened, alias → window handle.
/// </summary>
/// <remarks>
/// Port of the alias registry in engine.js. The extension has one browser and many tabs; this
/// runner has one browser too, so a "tab" here is a Selenium window/tab handle. A GoToUrl with
/// «تب جدید» creates one and files it under its alias, and SwitchTab/CloseTab by alias find it
/// again — which is what makes "return to system B" mean the page that is already logged in
/// instead of whatever window happens to be focused.
///
/// The run's own window is always registered as <c>main</c>; the editor reserves that name.
/// </remarks>
public sealed class RunTabs
{
    private readonly Dictionary<string, string> _byAlias = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Alias names are case/space insensitive, exactly as the editor normalises them.</summary>
    public static string Normalize(string? alias) => (alias ?? "").Trim().ToLowerInvariant();

    /// <summary>The handle an alias names, or null when it was never opened (or was closed).</summary>
    public string? HandleFor(string? alias)
    {
        var key = Normalize(alias);
        if (key.Length == 0) return null;
        return _byAlias.TryGetValue(key, out var handle) ? handle : null;
    }

    public void Register(string alias, string handle)
    {
        var key = Normalize(alias);
        if (key.Length == 0 || string.IsNullOrEmpty(handle)) return;
        _byAlias[key] = handle;
    }

    /// <summary>Drop every alias that pointed at a window that no longer exists.</summary>
    public void ForgetHandle(string? handle)
    {
        if (string.IsNullOrEmpty(handle)) return;
        foreach (var key in _byAlias.Where(kv => kv.Value == handle).Select(kv => kv.Key).ToList())
            _byAlias.Remove(key);
    }

    /// <summary>An unused alias for a tab the author did not name.</summary>
    public string NextAutoAlias()
    {
        var index = _byAlias.Count;
        string alias;
        do { alias = $"tab{++index}"; } while (_byAlias.ContainsKey(alias));
        return alias;
    }

    /// <summary>Forget everything — a new browser means the old handles are meaningless.</summary>
    public void Reset() => _byAlias.Clear();
}
