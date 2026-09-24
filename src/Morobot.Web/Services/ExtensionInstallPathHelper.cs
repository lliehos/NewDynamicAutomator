using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Morobot.Infrastructure.Options;

namespace Morobot.Web.Services;

/// <summary>Resolves per-deployment extension folders under %LocalAppData%.</summary>
public static class ExtensionInstallPathHelper
{
    private const string BrandFolder = "morobot.soras.ir";

    public static string SanitizeAppInstanceKey(string? raw) => MorobotOptions.SanitizeAppInstanceKey(raw);

    public static string ResolveAppInstanceKey(IConfiguration config)
    {
        var fromConfig = config[$"{MorobotOptions.SectionName}:AppInstanceKey"];
        return SanitizeAppInstanceKey(fromConfig);
    }

    public static string BrandRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        BrandFolder);

    public static string InstanceRoot(IConfiguration config)
        => Path.Combine(BrandRoot, ResolveAppInstanceKey(config));

    public static string PackageInstallPath(IConfiguration config, string packageFolderName)
        => Path.Combine(InstanceRoot(config), packageFolderName);
}
