using Morobot.Licensing;

namespace Morobot.Player.Services;

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
