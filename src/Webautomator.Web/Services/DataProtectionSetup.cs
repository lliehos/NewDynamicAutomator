using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection;

namespace Webautomator.Web.Services;

/// <summary>
/// Pins the DataProtection key ring to a folder beside the application.
/// </summary>
/// <remarks>
/// <para>
/// Left alone, the key ring goes to <c>%LOCALAPPDATA%\ASP.NET\DataProtection-Keys</c> for the account
/// the process runs as, and the host warns <c>Using an in-memory repository. Keys will not be persisted
/// to storage</c> when that location is not usable. A Windows service identity has no profile, so on a
/// real deployment the warning is the normal case.
/// </para>
/// <para>
/// What that costs is worse than a missing folder: an ephemeral key ring is generated per process, so
/// every restart invalidates every auth cookie, every antiforgery token and every one-time code this
/// application mints. Users are silently signed out, and a form opened before a deploy is rejected with
/// a 400 on submit.
/// </para>
/// <para>
/// The folder is deliberately <b>not</b> inside the publish output. A deploy replaces the application
/// tree, and keys living there would be rolled back or deleted with it — the exact failure this exists
/// to prevent. It sits in a fixed sibling directory of the content root instead.
/// </para>
/// </remarks>
public static class DataProtectionSetup
{
    /// <summary>Folder name created next to the application folder.</summary>
    public const string KeysFolderName = "DataProtection-Keys";

    public static void KeepKeysBesideTheApplication(IServiceCollection services, string contentRootPath)
    {
        services.AddDataProtection()
            .SetApplicationName("Webautomator")
            .PersistKeysToFileSystem(ResolveKeyDirectory(contentRootPath));
    }

    /// <summary>
    /// <c>&lt;content root&gt;\..\DataProtection-Keys</c>, created if it is missing.
    /// </summary>
    /// <remarks>
    /// Failing to create the folder must not stop the host: the worst case is exactly the in-memory
    /// behaviour this replaces, and refusing to start over a key-ring directory would be worse than
    /// that. <c>PersistKeysToFileSystem</c> surfaces the real problem when it first writes a key.
    /// </remarks>
    public static DirectoryInfo ResolveKeyDirectory(string contentRootPath)
    {
        var root = new DirectoryInfo(Path.TrimEndingDirectorySeparator(Path.GetFullPath(contentRootPath)));
        var directory = new DirectoryInfo(
            Path.Combine(root.Parent?.FullName ?? root.FullName, KeysFolderName));

        try
        {
            directory.Create();
        }
        catch (Exception)
        {
            // Handled by the host's own warning if the directory stays unwritable.
        }

        return directory;
    }
}
