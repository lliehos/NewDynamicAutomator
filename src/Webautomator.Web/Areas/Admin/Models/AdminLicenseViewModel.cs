using Webautomator.Contracts.Licensing;

namespace Webautomator.Web.Areas.Admin.Models;

public sealed class AdminLicenseViewModel
{
    public bool LicensingEnabled { get; set; }
    public LicenseDisplayDto Display { get; set; } = new();
    public UpdateCheckResultDto? UpdateStatus { get; set; }
    public string? OrganizationHint { get; set; }
}
