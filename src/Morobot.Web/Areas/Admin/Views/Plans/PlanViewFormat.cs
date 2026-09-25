namespace Morobot.Web.Areas.Admin.Views.Plans;

/// <summary>
/// Presentation helpers for the plans admin screens. Kept in the view namespace because both the
/// list chips and the edit form need the same human-readable byte size.
/// </summary>
public static class PlanViewFormat
{
    /// <summary>
    /// Render a nullable byte ceiling for humans: null means the vendor set no ceiling, so it shows
    /// as the infinity sign the other limit chips use rather than a bare "0".
    /// </summary>
    public static string Size(long? bytes)
    {
        if (bytes is not long b) return "∞";
        if (b >= 1024L * 1024 * 1024) return $"{b / (1024d * 1024d * 1024d):0.##} GB";
        if (b >= 1024L * 1024) return $"{b / (1024d * 1024d):0.##} MB";
        if (b >= 1024) return $"{b / 1024d:0.##} KB";
        return $"{b} B";
    }
}
