using Morobot.Contracts.Licensing;

namespace Morobot.Web.Areas.Admin.Models;

public sealed class AdminLicenseViewModel
{
    public bool LicensingEnabled { get; set; }
    public LicenseDisplayDto Display { get; set; } = new();
    public UpdateCheckResultDto? UpdateStatus { get; set; }
    public string? OrganizationHint { get; set; }
}
