using System.Net;

namespace Morobot.Licensing;

/// <summary>When <see cref="LicensePayload.AllowedHost"/> is set, requests must match that host name or IP.</summary>
public static class LicenseHostBinding
{
    public static bool TryNormalize(string? input, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(input))
            return false;

        var s = input.Trim();
        if (s.Contains("://", StringComparison.Ordinal))
        {
            if (!Uri.TryCreate(s, UriKind.Absolute, out var uri) || string.IsNullOrWhiteSpace(uri.Host))
                return false;
            s = uri.Host;
        }
        else
        {
            var slash = s.IndexOf('/');
            if (slash >= 0)
                s = s[..slash];
        }

        s = s.Trim();
        if (s.Length == 0)
            return false;

        if (IPAddress.TryParse(s, out var ip))
        {
            normalized = ip.ToString();
            return true;
        }

        if (s.StartsWith('[') && s.EndsWith(']') && IPAddress.TryParse(s[1..^1], out ip))
        {
            normalized = ip.ToString();
            return true;
        }

        var portSep = s.LastIndexOf(':');
        if (portSep > 0 && int.TryParse(s[(portSep + 1)..], out _))
            s = s[..portSep];

        s = s.Trim().TrimEnd('.').ToLowerInvariant();
        if (s.Length == 0 || s.Contains(' ') || s.Contains('/'))
            return false;

        normalized = s;
        return true;
    }

    public static bool IsRequestAllowed(string allowedHost, string? requestHost, IPAddress? remoteIp)
    {
        if (!TryNormalize(allowedHost, out var allowed))
            return true;

        return MatchesAllowed(allowed, requestHost, remoteIp);
    }

    public static bool MatchesAllowed(string normalizedAllowed, string? requestHost, IPAddress? remoteIp)
    {
        if (IPAddress.TryParse(normalizedAllowed, out var allowedIp))
        {
            if (remoteIp is null)
                return false;
            return IpEquals(allowedIp, remoteIp);
        }

        if (string.IsNullOrWhiteSpace(requestHost))
            return false;

        var host = requestHost.Trim().TrimEnd('.').ToLowerInvariant();
        var portSep = host.LastIndexOf(':');
        if (portSep > 0 && int.TryParse(host[(portSep + 1)..], out _))
            host = host[..portSep];

        if (host == normalizedAllowed)
            return true;

        if (host == "www." + normalizedAllowed)
            return true;
        if (normalizedAllowed.StartsWith("www.", StringComparison.Ordinal) && host == normalizedAllowed[4..])
            return true;

        return false;
    }

    private static bool IpEquals(IPAddress allowed, IPAddress remote)
    {
        if (allowed.Equals(remote))
            return true;

        if (allowed.IsIPv4MappedToIPv6 && allowed.MapToIPv4().Equals(remote.MapToIPv4()))
            return true;

        if (remote.IsIPv4MappedToIPv6 && remote.MapToIPv4().Equals(allowed.MapToIPv4()))
            return true;

        return false;
    }
}
