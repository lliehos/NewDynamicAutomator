using System.IO;
using Webautomator.Licensing;

namespace Webautomator.Player.Services;

/// <summary>
/// Reads the deployment's signed license and answers the one question the runner asks of it:
/// may this installation run processes locally?
/// </summary>
/// <remarks>
/// The runner is a client of a panel, so the licence it must honour is the PANEL's, not one of its
/// own. It takes the signed document the panel already holds and verifies the signature with the
/// same public keys the web app uses — a licence the runner accepted on its own authority would be
/// a second, weaker gate sitting next to the server's, which is exactly the kind of bypass a
/// licence is meant to prevent.
/// </remarks>
public sealed class LicenseGate
{
    private readonly LicenseDocument? _document;

    public bool IsLoaded => _document is not null;
    public bool SignatureValid { get; private init; }
    public bool AllowsLocalRun => _document?.Payload.AllowLocalRun == true;
    public string? OrganizationName => _document?.Payload.OrganizationName;
    public DateTime? ValidUntilUtc => _document?.Payload.ValidUntilUtc;

    /// <summary>
    /// The licence mirrored to disk by a previous sign-in.
    /// </summary>
    /// <remarks>
    /// Needed before sign-in, because the server address lives in the licence and the app no longer
    /// asks the user for it. Only verified payloads are returned: an unverifiable cached document is
    /// treated as absent, so editing the cache cannot redirect the app to another server.
    /// </remarks>
    public static LicensePayload? ReadLocalPayload()
    {
        try
        {
            var path = CachedLicensePath;
            if (!File.Exists(path)) return null;
            var doc = LicenseJson.TryParseDocument(File.ReadAllText(path));
            if (doc is null) return null;
            return LicenseCrypto.VerifyPayload(doc.Payload, doc.Signature, LicensePublicKeys.Active)
                ? doc.Payload
                : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Remember the panel's licence so the next launch knows its server address.</summary>
    public static void CacheLocal(string? licenseJson)
    {
        if (string.IsNullOrWhiteSpace(licenseJson)) return;
        try
        {
            var path = CachedLicensePath;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, licenseJson);
        }
        catch
        {
            // A cache write failure is not worth interrupting a sign-in over; the only cost is that
            // the next launch falls back to the development address.
        }
    }

    private static string CachedLicensePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "WebautomatorDesktop", "license.json");

    private LicenseGate(LicenseDocument? document, bool signatureValid)
    {
        _document = document;
        SignatureValid = signatureValid;
    }

    public static LicenseGate Blocked() => new(null, false);

    /// <summary>Parse and verify a signed licence document.</summary>
    public static LicenseGate FromJson(string? licenseJson)
    {
        if (string.IsNullOrWhiteSpace(licenseJson)) return Blocked();
        LicenseDocument? doc;
        try { doc = LicenseJson.TryParseDocument(licenseJson); }
        catch { return Blocked(); }
        if (doc is null) return Blocked();

        var valid = LicenseCrypto.VerifyPayload(doc.Payload, doc.Signature, LicensePublicKeys.Active);
        // An invalid signature is treated as "no licence", never as "a licence I did not like": a
        // tampered document must not be able to grant a feature by editing a flag.
        return valid ? new LicenseGate(doc, true) : Blocked();
    }
}
