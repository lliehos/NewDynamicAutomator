using System.Text.RegularExpressions;
using Morobot.Domain.Entities;

namespace Morobot.Domain;

/// <summary>
/// The effective password rules: a plan may state its own, otherwise the deployment-wide policy
/// from Admin → Settings (Auth group) applies.
/// </summary>
/// <remarks>
/// The rules used to live ONLY on <see cref="Plan"/>. That was fine while every install had plan
/// levels, but an install whose licence has no plan management has no plan rows to ask — and it was
/// exactly those installs that ended up with no password floor at all. A global policy was added as
/// the fallback, so a rule always exists.
///
/// The precedence is deliberate: <b>a plan that states its own rules wins</b>. A deployment selling
/// a strong-password tier must not have that tier silently weakened by a global default, and the
/// reverse reading (global always wins) would make the per-plan fields decorative.
/// </remarks>
public static partial class PasswordPolicy
{
    /// <summary>Length used when neither a plan nor a setting states one.</summary>
    public const int FallbackMinLength = 3;

    public static bool IsLocal(string? code) =>
        string.Equals(code, "Local", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The rules that actually apply to a user on <paramref name="plan"/>.
    /// </summary>
    /// <param name="plan">The user's plan, or null when the install has no plan levels.</param>
    /// <param name="globalMinLength">
    /// The deployment-wide minimum from <see cref="SystemSettingKeys.PasswordMinLength"/>, or null
    /// when it has never been set.
    /// </param>
    /// <param name="globalRequireLetterAndDigit">
    /// The deployment-wide complexity rule, or null when it has never been set.
    /// </param>
    /// <remarks>
    /// "Never been set" and "set to the weakest value" are different: null means fall through to the
    /// next source, whereas a stated 0/false is an explicit decision. That distinction is why the
    /// globals are nullable here rather than pre-defaulted.
    /// </remarks>
    public static (int minLength, bool requireLetterAndDigit) Resolve(
        Plan? plan,
        int? globalMinLength = null,
        bool? globalRequireLetterAndDigit = null)
    {
        // A plan's own rule wins when it states one. MinPasswordLength is a non-nullable int with a
        // seeded value, so "<= 0" is the only way a plan can say "I have no opinion".
        if (plan is not null && plan.MinPasswordLength > 0)
        {
            // The switch is taken from the plan too. Mixing halves — length from the plan, complexity
            // from the global — would produce a rule neither page describes, and an admin looking at
            // the plan would have no way to see where the complexity requirement came from.
            return (Math.Max(1, plan.MinPasswordLength), plan.RequireLetterAndDigit);
        }

        return (Math.Max(1, globalMinLength ?? FallbackMinLength), globalRequireLetterAndDigit ?? false);
    }

    /// <summary>Validate a password against the plan's rules, falling back to the global policy.</summary>
    public static (bool ok, string? errorKey) Validate(
        string? password,
        Plan? plan,
        int? globalMinLength = null,
        bool? globalRequireLetterAndDigit = null)
    {
        var pwd = password ?? "";
        if (string.IsNullOrEmpty(pwd))
            return (false, "password.errorRequired");

        var (min, requireLetterAndDigit) = Resolve(plan, globalMinLength, globalRequireLetterAndDigit);
        if (pwd.Length < min)
            return (false, "password.errorTooShort");

        if (requireLetterAndDigit && !LetterAndDigit().IsMatch(pwd))
            return (false, "password.errorStrongComplexity");

        return (true, null);
    }

    /// <summary>
    /// True when the rules are demanding enough that a typical signup password would fail them.
    /// Used to decide whether changing a plan must be accompanied by a new password.
    /// </summary>
    public static bool IsStrict(Plan? plan, int? globalMinLength = null, bool? globalRequireLetterAndDigit = null)
    {
        var (min, requireLetterAndDigit) = Resolve(plan, globalMinLength, globalRequireLetterAndDigit);
        return requireLetterAndDigit || min >= 8;
    }

    [GeneratedRegex(@"^(?=.*[A-Za-z])(?=.*\d).+$", RegexOptions.CultureInvariant)]
    private static partial Regex LetterAndDigit();
}
