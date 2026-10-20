using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Webautomator.Player.Services;

/// <summary>
/// The process canvases this player has already read, and the source values it loaded for them.
/// </summary>
/// <remarks>
/// Starting a run used to read the process from the server every time. A process nobody edited does
/// not need reading again — the process list already reports when it last changed — so the run starts
/// from the copy cached here and asks the server for nothing. That is the point of the cache: traffic
/// spent on a process that has not moved buys nothing.
///
/// The same file keeps the values of the private sources a LOCAL run loaded, because they are what
/// keep that run off the wire. They are filed under the same revision stamp, so a process that changed
/// reloads both and one that did not reloads neither.
///
/// One entry per process, inside this server's folder (see <see cref="PlayerStorage"/>). The process
/// list a row comes from is already per user, and every data read or write is still authorised by the
/// server, so a process shared between two accounts needs only one cached copy.
/// </remarks>
public static class CanvasCache
{
    private const string FileName = "canvas-cache.json";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static Dictionary<string, Entry>? _entries;

    private sealed class Entry
    {
        public string? UpdatedAtUtc { get; set; }
        public string? Canvas { get; set; }
        public List<LocalCellWrite>? Cells { get; set; }
    }

    /// <summary>The cached canvas for this process, when it is still the revision the row reports.</summary>
    public static bool TryGetCanvas(int taskId, DateTime? updatedAtUtc, out string canvas)
    {
        canvas = "";
        var entry = Find(taskId, updatedAtUtc);
        if (entry?.Canvas is not { Length: > 0 }) return false;
        canvas = entry.Canvas;
        return true;
    }

    /// <summary>Remember a canvas against the revision it came from.</summary>
    public static void SaveCanvas(int taskId, DateTime? updatedAtUtc, string? canvas)
    {
        if (taskId <= 0 || string.IsNullOrWhiteSpace(canvas)) return;
        var entry = Ensure(taskId);
        entry.UpdatedAtUtc = Stamp(updatedAtUtc);
        entry.Canvas = canvas;
        Save();
    }

    /// <summary>The source values a local run loaded for this revision, if they are here.</summary>
    public static bool TryGetSourceValues(int taskId, DateTime? updatedAtUtc, out List<LocalCellWrite> cells)
    {
        cells = new List<LocalCellWrite>();
        var entry = Find(taskId, updatedAtUtc);
        if (entry?.Cells is not { Count: > 0 }) return false;
        cells = entry.Cells;
        return true;
    }

    /// <summary>Remember the values a local run loaded, under the same revision as the canvas.</summary>
    public static void SaveSourceValues(int taskId, DateTime? updatedAtUtc, IEnumerable<LocalCellWrite> cells)
    {
        if (taskId <= 0) return;
        var list = cells.ToList();
        if (list.Count == 0) return;
        var entry = Ensure(taskId);
        entry.UpdatedAtUtc = Stamp(updatedAtUtc);
        entry.Cells = list;
        Save();
    }

    /// <summary>
    /// Compare stamps by the instant they name.
    /// </summary>
    /// <remarks>
    /// The two places the same revision is reported do not format it alike — the list serialises the
    /// stored value as-is while the canvas marks it UTC — so the comparison is on ticks, not on the
    /// text of the stamp, and a value with no zone is read as UTC because that is what the database
    /// holds.
    /// </remarks>
    private static bool SameStamp(string? cached, DateTime? updatedAtUtc)
        => cached is { Length: > 0 } && updatedAtUtc is DateTime value && cached == Stamp(value);

    private static Entry? Find(int taskId, DateTime? updatedAtUtc)
    {
        var entry = Load().GetValueOrDefault(taskId.ToString());
        return entry is not null && SameStamp(entry.UpdatedAtUtc, updatedAtUtc) ? entry : null;
    }

    private static Entry Ensure(int taskId)
    {
        var all = Load();
        if (!all.TryGetValue(taskId.ToString(), out var entry))
        {
            entry = new Entry();
            all[taskId.ToString()] = entry;
        }
        return entry;
    }

    /// <summary>
    /// A stamp as an unambiguous UTC instant, or an empty string when there is none.
    /// </summary>
    /// <remarks>
    /// The list reports the stored value as-is while the canvas marks its own with a "Z", so
    /// System.Text.Json hands one back as Unspecified and the other as Utc. Treating Unspecified as
    /// local would move it by the machine's offset and make a perfectly good cached canvas look stale
    /// forever; the database stores UTC, so that is what a zone-less stamp is read as.
    /// </remarks>
    private static string Stamp(DateTime? value)
    {
        if (value is not DateTime v) return "";
        var utc = v.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(v, DateTimeKind.Utc)
            : v.ToUniversalTime();
        return utc.ToString("O");
    }

    private static Dictionary<string, Entry> Load()
    {
        if (_entries is not null) return _entries;
        try
        {
            var path = PlayerStorage.FilePath(FileName);
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                _entries = JsonSerializer.Deserialize<Dictionary<string, Entry>>(json, JsonOpts);
            }
        }
        catch
        {
            // An unreadable cache is a cache miss, never a failed run: the canvas is fetched again.
        }
        return _entries ??= new Dictionary<string, Entry>(StringComparer.Ordinal);
    }

    private static void Save()
    {
        try
        {
            var path = PlayerStorage.FilePath(FileName);
            File.WriteAllText(path, JsonSerializer.Serialize(_entries, JsonOpts));
        }
        catch
        {
            // Losing the cache only costs the next run one read; it must not fail this one.
        }
    }
}
