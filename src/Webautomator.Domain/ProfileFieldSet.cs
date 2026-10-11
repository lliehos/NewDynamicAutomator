using Webautomator.Domain.Entities;

namespace Webautomator.Domain;

/// <summary>
/// The registration/profile fields THIS deployment asks for, resolved from the Admin → Settings
/// switches in <see cref="SystemSettingKeys.ProfileFieldKeys"/>.
/// </summary>
/// <remarks>
/// The two forms that ask for a user's details (the public registration form and the panel's profile
/// form) and the gate that insists the profile is finished all have to agree on which fields count,
/// or a user is asked for something the gate does not check — or blocked by a field no form offers.
/// They therefore all read the answer from here instead of each holding its own list.
/// </remarks>
public sealed class ProfileFieldSet
{
    private readonly HashSet<string> _enabled;

    private ProfileFieldSet(HashSet<string> enabled)
    {
        _enabled = enabled;
        EnabledKeys = SystemSettingKeys.ProfileFieldKeys
            .Where(k => _enabled.Contains(k))
            .ToList();
    }

    /// <summary>The fields this deployment asks for, in form order.</summary>
    public IReadOnlyList<string> EnabledKeys { get; }

    /// <summary>True when nothing is asked for beyond the credentials themselves.</summary>
    public bool IsEmpty => EnabledKeys.Count == 0;

    /// <summary>The set shipped with a new installation.</summary>
    public static ProfileFieldSet Default { get; } =
        FromEnabled(SystemSettingKeys.ProfileFieldKeys.Where(SystemSettingKeys.ProfileFieldDefault));

    /// <summary>Build a set from the enabled keys; anything unrecognised is ignored.</summary>
    public static ProfileFieldSet FromEnabled(IEnumerable<string> enabledKeys) =>
        new(new HashSet<string>(
            enabledKeys.Where(SystemSettingKeys.IsProfileField),
            StringComparer.OrdinalIgnoreCase));

    /// <summary>True when the key is a profile field AND this deployment asks for it.</summary>
    public bool IsEnabled(string? key) =>
        !string.IsNullOrWhiteSpace(key) && _enabled.Contains(key);

    /// <summary>
    /// True when every field this deployment asks for has a value. This is what the panel gate reads
    /// (through the <c>profile_complete</c> claim), so an installation that asks for nothing has
    /// nothing to complete.
    /// </summary>
    public bool IsComplete(AppUser user) =>
        EnabledKeys.All(k => !string.IsNullOrWhiteSpace(ValueOf(user, k)));

    /// <summary>The stored value behind a profile-field key, or null for a key that is not one.</summary>
    public static string? ValueOf(AppUser user, string? key) => key switch
    {
        SystemSettingKeys.ProfileFieldFirstName => user.FirstName,
        SystemSettingKeys.ProfileFieldLastName => user.LastName,
        SystemSettingKeys.ProfileFieldEmail => user.Email,
        SystemSettingKeys.ProfileFieldMobile => user.Mobile,
        SystemSettingKeys.ProfileFieldNationalId => user.NationalId,
        _ => null
    };
}
