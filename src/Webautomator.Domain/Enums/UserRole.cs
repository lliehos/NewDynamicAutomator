namespace Webautomator.Domain.Enums;

/// <summary>
/// What a signed-in account is allowed to do beyond its plan.
/// </summary>
/// <remarks>
/// The order matters: a permission that is "this role or higher" is compared with <c>&gt;=</c>, so
/// a new role has to be inserted where its power sits rather than appended. <see cref="Admin"/>
/// stays the highest value, which keeps every existing <c>Role == Admin</c> check meaning exactly
/// what it meant before. The stored column is an int, so promoted values are written back by the
/// <c>AddProcessManagerRole</c> migration — without that, every existing Admin (1) would read back
/// as ProcessManager.
/// </remarks>
public enum UserRole
{
    User = 0,

    /// <summary>
    /// May manage the shared process templates: create them, publish edits out to the processes
    /// built on them, and retire them. Deliberately short of <see cref="Admin"/> — this is whoever
    /// owns how the team's processes are shaped, not whoever runs the installation. It is a panel
    /// role, so it is granted from Admin → Users like any other.
    /// </summary>
    ProcessManager = 1,

    Admin = 2,

    /// <summary>
    /// Read-only oversight of how the server and its users are actually being used: the monitoring
    /// dashboard, live sessions, and the activity/error feed. It is deliberately ABOVE
    /// <see cref="Admin"/> in the enum only so that "Admin or higher" checks keep working unchanged;
    /// it is NOT a permission to change anything. A Monitor operator is the person who watches
    /// capacity and behaviour, and they need no ability to edit users, plans or processes to do it —
    /// so every admin surface stays gated on <see cref="Admin"/> exactly, and only the monitoring
    /// pages accept this role. Stored as an int, so promoting it needs the same care as
    /// <c>AddProcessManagerRole</c> did.
    /// </summary>
    Monitor = 3
}
