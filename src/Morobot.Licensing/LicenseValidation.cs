namespace Morobot.Licensing;

public enum LicenseValidationStatus
{
    NotRequired,
    Missing,
    InvalidSignature,
    WrongAnchor,
    Expired,
    SequenceRollback,
    Valid
}

public sealed class LicenseValidationResult
{
    public LicenseValidationStatus Status { get; init; }
    public LicensePayload? Payload { get; init; }
    public string? Message { get; init; }

    public bool IsValid => Status == LicenseValidationStatus.Valid || Status == LicenseValidationStatus.NotRequired;

    public static LicenseValidationResult NotRequired() => new()
    {
        Status = LicenseValidationStatus.NotRequired
    };

    public static LicenseValidationResult Fail(LicenseValidationStatus status, string? message = null, LicensePayload? payload = null)
        => new() { Status = status, Message = message, Payload = payload };

    public static LicenseValidationResult Ok(LicensePayload payload) => new()
    {
        Status = LicenseValidationStatus.Valid,
        Payload = payload
    };
}

public static class LicenseValidator
{
    public static LicenseValidationResult ValidateDocument(
        LicenseDocument? document,
        string deploymentAnchorId,
        string publicKeyPem,
        DateTime utcNow,
        long? previousSequence = null)
    {
        if (document is null)
            return LicenseValidationResult.Fail(LicenseValidationStatus.Missing, "License document is missing or invalid JSON.");

        if (!string.Equals(document.Format, LicenseFormats.License, StringComparison.OrdinalIgnoreCase))
            return LicenseValidationResult.Fail(LicenseValidationStatus.InvalidSignature, "Unknown license format.");

        var payload = document.Payload;
        if (payload is null || payload.Version <= 0)
            return LicenseValidationResult.Fail(LicenseValidationStatus.InvalidSignature, "License payload is invalid.");

        if (string.IsNullOrWhiteSpace(payload.LicenseId))
            return LicenseValidationResult.Fail(LicenseValidationStatus.InvalidSignature, "LicenseId is required.");

        if (!LicenseCrypto.VerifyPayload(payload, document.Signature, publicKeyPem))
            return LicenseValidationResult.Fail(LicenseValidationStatus.InvalidSignature, "License signature is invalid.", payload);

        if (!string.Equals(payload.DeploymentAnchorId, deploymentAnchorId, StringComparison.OrdinalIgnoreCase))
            return LicenseValidationResult.Fail(LicenseValidationStatus.WrongAnchor, "License is not issued for this installation.", payload);

        if (payload.ValidUntilUtc < utcNow)
            return LicenseValidationResult.Fail(LicenseValidationStatus.Expired, "License has expired.", payload);

        if (previousSequence is long prev && payload.Sequence < prev)
            return LicenseValidationResult.Fail(LicenseValidationStatus.SequenceRollback, "License sequence is older than the current license.", payload);

        return LicenseValidationResult.Ok(payload);
    }
}
