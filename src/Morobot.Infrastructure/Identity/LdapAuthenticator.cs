using System.DirectoryServices.Protocols;
using System.Net;
using Microsoft.Extensions.Logging;
using Morobot.Contracts.Auth;

namespace Morobot.Infrastructure.Identity;

/// <summary>
/// Verifies credentials against an LDAP directory.
/// </summary>
/// <remarks>
/// The check is a bind: the directory itself decides whether the password is right, so no
/// password ever travels further than the directory. A simple bind is used because that is what
/// validates a password — searching for the user and comparing a password attribute would both
/// fail on the usual directories (the attribute is not readable) and be unsound where it worked.
/// </remarks>
public sealed class LdapAuthenticator : ILdapAuthenticator
{
    private readonly ILogger<LdapAuthenticator> _log;

    public LdapAuthenticator(ILogger<LdapAuthenticator> log)
    {
        _log = log;
    }

    public async Task<LdapAuthResult> AuthenticateAsync(
        LdapOptions options,
        string userName,
        string password,
        CancellationToken ct = default)
    {
        if (!options.IsUsable || string.IsNullOrWhiteSpace(userName) || string.IsNullOrEmpty(password))
            return LdapAuthResult.InvalidCredentials;

        var signInName = options.ApplyUserTemplate(userName.Trim());

        try
        {
            return await Task.Run(() => Bind(options, signInName, password), ct);
        }
        catch (OperationCanceledException)
        {
            return LdapAuthResult.Unavailable;
        }
    }

    private LdapAuthResult Bind(LdapOptions options, string signInName, string password)
    {
        LdapConnection? connection = null;
        try
        {
            var identifier = new LdapDirectoryIdentifier(options.Host.Trim(), options.EffectivePort, false, false);
            connection = new LdapConnection(identifier)
            {
                AuthType = AuthType.Basic,
                // Fail fast: a wrong host must not make the login page hang for the default
                // protocol timeout, which is long enough to look like a broken server.
                Timeout = TimeSpan.FromSeconds(10)
            };
            // Disable certificate checks only when TLS was not requested; with TLS on, the
            // certificate is validated, because silently accepting any certificate is exactly the
            // attack TLS was turned on to prevent.
            connection.SessionOptions.ProtocolVersion = 3;
            if (options.UseTls)
            {
                connection.SessionOptions.SecureSocketLayer = true;
            }
            else
            {
                connection.SessionOptions.VerifyServerCertificate = (_, _) => true;
            }

            connection.Bind(new NetworkCredential(signInName, password));
            return LdapAuthResult.Success;
        }
        catch (LdapException ex) when (ex.ErrorCode == 49)
        {
            // 49 = invalidCredentials: the directory answered and refused. Not an error worth a
            // stack trace; it is the ordinary "wrong password" path.
            _log.LogInformation("LDAP bind rejected for {User} at {Host}", signInName, options.Host);
            return LdapAuthResult.InvalidCredentials;
        }
        catch (LdapException ex)
        {
            _log.LogWarning(ex, "LDAP bind failed for {User} at {Host}:{Port} (code {Code})",
                signInName, options.Host, options.EffectivePort, ex.ErrorCode);
            return LdapAuthResult.Unavailable;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "LDAP unreachable for {User} at {Host}:{Port}",
                signInName, options.Host, options.EffectivePort);
            return LdapAuthResult.Unavailable;
        }
        finally
        {
            connection?.Dispose();
        }
    }
}
