namespace Webautomator.Domain.Enums;

/// <summary>
/// What a signed-in account is allowed to do beyond its plan.
/// </summary>
/// <remarks>
/// Flags, not a ladder: an account may carry several roles at once (a process manager who also
/// watches the server, an admin who is also a monitor), and the admin grants them with switches on
/// the user form. Because it is a bit set, a check is always "does this set contain the flag"
/// (<see cref="UserRoleExtensions.Has"/>) — never a numeric comparison, which a combined value would
/// fail. The stored column is an int; the values are bit values, one per role, and the
/// <c>UserRolesAsFlags</c> migration renumbers the rows written under the old sequential enum.
/// </remarks>
[Flags]
public enum UserRole
{
    None = 0,

    /// <summary>The base role every account gets: sign in, use the panel, own its own work.</summary>
    User = 1,

    /// <summary>
    /// May manage the shared process templates: create them, publish edits out to the processes
    /// built on them, and retire them. Deliberately short of <see cref="Admin"/> — this is whoever
    /// owns how the team's processes are shaped, not whoever runs the installation.
    /// </summary>
    ProcessManager = 2,

    /// <summary>Full control of the installation: users, plans, licence, branding, settings.</summary>
    Admin = 4,

    /// <summary>
    /// Read-only oversight of how the server and its users are actually being used: the monitoring
    /// dashboard, live sessions, and the activity/error feed. It grants no ability to change
    /// anything — every admin surface stays gated on <see cref="Admin"/> exactly, and only the
    /// monitoring pages accept this role in addition.
    /// </summary>
    Monitor = 8
}

/// <summary>
/// Membership tests for the <see cref="UserRole"/> bit set.
/// </summary>
/// <remarks>
/// One helper rather than <c>Enum.HasFlag</c> at each call site: <c>HasFlag</c> boxes, and these
/// checks run on every request path. The expressions also translate to plain bitwise SQL
/// (<c>Role &amp; 4 = 4</c>), which is what the admin list's "is there another administrator?"
/// query depends on.
/// </remarks>
public static class UserRoleExtensions
{
    /// <summary>True when <paramref name="set"/> contains every flag in <paramref name="flag"/>.</summary>
    public static bool Has(this UserRole set, UserRole flag) => (set & flag) == flag;

    /// <summary>True when the account is an administrator.</summary>
    public static bool IsAdmin(this UserRole set) => set.Has(UserRole.Admin);

    /// <summary>
    /// Parse a set of role names (form checkboxes) into one value. Unknown names are ignored, and an
    /// empty result falls back to <see cref="UserRole.User"/> — a form that posts nothing must leave
    /// the account usable rather than role-less.
    /// </summary>
    public static UserRole ParseSet(IEnumerable<string>? names)
    {
        var result = UserRole.None;
        foreach (var name in names ?? [])
        {
            if (Enum.TryParse<UserRole>(name?.Trim(), ignoreCase: true, out var parsed))
                result |= parsed;
        }
        return result == UserRole.None ? UserRole.User : result;
    }

    /// <summary>The individual role names in a set, for claims and display.</summary>
    public static IEnumerable<string> Names(this UserRole set)
        => Enum.GetValues<UserRole>()
            .Where(r => r != UserRole.None && set.Has(r))
            .Select(r => r.ToString());
}
