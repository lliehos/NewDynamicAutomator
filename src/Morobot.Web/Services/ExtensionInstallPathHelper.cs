using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Morobot.Infrastructure.Options;

namespace Morobot.Web.Services;

/// <summary>Resolves per-deployment extension folders under %LocalAppData%.</summary>
public static class ExtensionInstallPathHelper
{
    private const string BrandFolder = MorobotOptions.BrandFolderName;

    public static string SanitizeAppInstanceKey(string? raw) => MorobotOptions.SanitizeAppInstanceKey(raw);

    public static string ResolveAppInstanceKey(IConfiguration config)
    {
        // `default` is the sentinel for "no explicit key": the folder is not nested.
        var configured = config[$"{MorobotOptions.SectionName}:AppInstanceKey"];
        return MorobotOptions.DeriveAppInstanceKey(configured);
    }

    /// <summary>True when the deployment has no explicit key (the usual one-per-server case).</summary>
    public static bool IsDefaultKey(string? key) => MorobotOptions.IsDefaultAppInstanceKey(key);

    public static string BrandRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        BrandFolder);

    /// <summary>The pre-rename root. Read only, by migrations; never written to.</summary>
    public static string PreviousBrandRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        MorobotOptions.PreviousBrandFolderName);

    /// <summary>
    /// The folder that holds this deployment's packages. With no explicit key (the normal case)
    /// this is just the brand root — no `default` level — because a server hosts one deployment.
    /// </summary>
    public static string InstanceRoot(IConfiguration config)
    {
        var key = ResolveAppInstanceKey(config);
        return IsDefaultKey(key) ? BrandRoot : Path.Combine(BrandRoot, key);
    }

    public static string PackageInstallPath(IConfiguration config, string packageFolderName)
        => Path.Combine(InstanceRoot(config), packageFolderName);
}
