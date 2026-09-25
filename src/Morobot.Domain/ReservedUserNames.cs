namespace Morobot.Domain;

/// <summary>Built-in demo/system accounts — end users must not register or claim these names.</summary>
public static class ReservedUserNames
{
    public static readonly HashSet<string> Exact = new(StringComparer.OrdinalIgnoreCase)
    {
        "admin",
        "free",
        "pro",
        "pm",
        "guest",
        "test",
        "local",
        "system",
        "root",
        "support"
    };

    public static bool IsReserved(string? userName)
    {
        if (string.IsNullOrWhiteSpace(userName))
            return true;
        var n = userName.Trim();
        if (Exact.Contains(n))
            return true;
        // Fingerprint-backed local identities and any local_* prefix
        if (n.StartsWith("local_", StringComparison.OrdinalIgnoreCase))
            return true;
        return false;
    }
}
