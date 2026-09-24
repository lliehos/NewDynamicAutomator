namespace Morobot.Licensing;

public sealed class LicenseDocument
{
    public string Format { get; set; } = LicenseFormats.License;
    public int Version { get; set; } = LicensePayload.CurrentVersion;
    public LicensePayload Payload { get; set; } = new();
    public string Signature { get; set; } = string.Empty;
}
