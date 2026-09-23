using System.Text.RegularExpressions;
using Morobot.Domain.Entities;

namespace Morobot.Domain;

/// <summary>Password rules come from the target <see cref="Plan"/> (admin-editable).</summary>
public static partial class PasswordPolicy
{
    public static bool IsLocal(string? code) =>
        string.Equals(code, "Local", StringComparison.OrdinalIgnoreCase);

    public static (bool ok, string? errorKey) Validate(string? password, Plan plan)
    {
        var pwd = password ?? "";
        if (string.IsNullOrEmpty(pwd))
            return (false, "password.errorRequired");

        var min = Math.Max(1, plan.MinPasswordLength);
        if (pwd.Length < min)
            return (false, "password.errorTooShort");

        if (plan.RequireLetterAndDigit && !LetterAndDigit().IsMatch(pwd))
            return (false, "password.errorStrongComplexity");

        return (true, null);
    }

    /// <summary>True when moving onto a plan that needs a stronger password than a typical Free signup.</summary>
    public static bool IsStrict(Plan plan) =>
        plan.RequireLetterAndDigit || plan.MinPasswordLength >= 8;

    [GeneratedRegex(@"^(?=.*[A-Za-z])(?=.*\d).+$", RegexOptions.CultureInvariant)]
    private static partial Regex LetterAndDigit();
}
