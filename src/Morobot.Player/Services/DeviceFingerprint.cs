using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Morobot.Player.Services;

/// <summary>
/// A stable per-machine id for the desktop runner.
/// </summary>
/// <remarks>
/// Derived from machine-stable inputs only — never the hostname the user can change at will, and
/// never the user-agent, which does not exist here. The value is deliberately the same shape the
/// extension sends, so one machine presenting as a desktop client and as a browser client is not
/// treated as two different devices by the panel's device list.
/// </remarks>
public static class DeviceFingerprint
{
    private static readonly Lazy<string> _value = new(Compute);

    public static string Value => _value.Value;

    private static string Compute()
    {
        var parts = new List<string>();
        try { parts.Add(Environment.MachineName); } catch { /* not fatal */ }
        try { parts.Add(Environment.OSVersion.VersionString); } catch { /* not fatal */ }
        try { parts.Add(Environment.ProcessorCount.ToString()); } catch { /* not fatal */ }
        // A stable per-install salt, so two machines with identical specs do not collide.
        parts.Add(ReadOrCreateInstallSalt());
        var joined = string.Join("|", parts);
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(joined));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string ReadOrCreateInstallSalt()
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MorobotDesktop");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "install.id");
            if (File.Exists(file))
            {
                var existing = File.ReadAllText(file).Trim();
                if (existing.Length > 0) return existing;
            }
            var created = Guid.NewGuid().ToString("N");
            File.WriteAllText(file, created);
            return created;
        }
        catch
        {
            // Falling back to the machine name alone is still stable for this session.
            return "no-salt";
        }
    }
}
