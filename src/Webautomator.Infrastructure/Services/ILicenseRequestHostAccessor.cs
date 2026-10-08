using System.Net;

namespace Webautomator.Infrastructure.Services;

public interface ILicenseRequestHostAccessor
{
    (string? Host, IPAddress? RemoteIp) GetCurrent();
}

public sealed class NullLicenseRequestHostAccessor : ILicenseRequestHostAccessor
{
    public (string? Host, IPAddress? RemoteIp) GetCurrent() => (null, null);
}
