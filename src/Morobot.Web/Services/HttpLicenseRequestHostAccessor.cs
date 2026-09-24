using System.Net;
using Microsoft.AspNetCore.Http;
using Morobot.Infrastructure.Services;

namespace Morobot.Web.Services;

public sealed class HttpLicenseRequestHostAccessor : ILicenseRequestHostAccessor
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public HttpLicenseRequestHostAccessor(IHttpContextAccessor httpContextAccessor)
        => _httpContextAccessor = httpContextAccessor;

    public (string? Host, IPAddress? RemoteIp) GetCurrent()
    {
        var ctx = _httpContextAccessor.HttpContext;
        if (ctx is null)
            return (null, null);

        var host = ctx.Request.Host.Host;
        var forwarded = ctx.Request.Headers["X-Forwarded-Host"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwarded))
            host = forwarded.Split(',')[0].Trim();

        return (host, ctx.Connection.RemoteIpAddress);
    }
}
