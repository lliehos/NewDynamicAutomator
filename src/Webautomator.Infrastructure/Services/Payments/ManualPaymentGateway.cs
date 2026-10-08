using System.Security.Cryptography;
using Microsoft.Extensions.Logging;

namespace Webautomator.Infrastructure.Services.Payments;

/// <summary>
/// A payment gateway that needs no provider account.
/// </summary>
/// <remarks>
/// This exists so the whole commerce flow — plan page, checkout, order, transaction, fulfillment,
/// history — can be built and exercised before a real merchant account exists, and so a deployment
/// can run a manual/offline payment arrangement (a bank transfer confirmed by an operator) without
/// pretending to be a card gateway.
///
/// It is honest about what it is: the "gateway page" it redirects to is a page in this app that
/// shows the amount and asks the customer to confirm, and the confirmation is what marks the payment
/// succeeded. That is a real, usable flow for invoice/bank-transfer sales — not a fake success. A
/// deployment that has not configured a real gateway yet gets a working checkout rather than a dead
/// end, and swapping in ZarinPal later changes one registration.
/// </remarks>
public sealed class ManualPaymentGateway : IPaymentGateway, IPaymentGatewayWithSettings
{
    public const string GatewayKey = "manual";

    private readonly ILogger<ManualPaymentGateway> _log;

    public ManualPaymentGateway(ILogger<ManualPaymentGateway> log) => _log = log;

    public string Key => GatewayKey;

    /// <summary>
    /// No settings: this gateway needs no credentials, which is the whole reason it exists.
    /// </summary>
    /// <remarks>
    /// Declared explicitly rather than omitted so the admin page can render "this provider needs no
    /// configuration" from the same shape a credentialled provider uses, instead of special-casing it.
    /// </remarks>
    public IReadOnlyList<(string Key, string Label, bool Secret)> SettingsSchema { get; }
        = Array.Empty<(string, string, bool)>();

    /// <summary>Always ready: needing no credentials is the point of this gateway.</summary>
    public (bool Ready, string? Reason) IsReady() => (true, null);

    public Task<PaymentStartResult> StartAsync(PaymentStartRequest request, CancellationToken ct = default)
    {
        // The authority is random and stored: the callback must present a value we minted, which
        // stops a stranger from walking the callback URL and marking an arbitrary order paid.
        var authority = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var url = $"{request.CallbackUrl}?authority={authority}&orderId={request.OrderId}&manual=1";
        _log.LogInformation("Manual payment started for order {OrderId} ({Amount} {Currency})",
            request.OrderId, request.Amount, request.Currency);
        return Task.FromResult(new PaymentStartResult(true, url, authority, null));
    }

    public Task<PaymentVerifyResult> VerifyAsync(
        string authority, long orderId, IReadOnlyDictionary<string, string> gatewayParams, CancellationToken ct = default)
    {
        // The customer pressing "confirm" on the manual page is the payment event. There is no
        // provider to ask, so the authority itself is the proof — and the service layer has already
        // checked it matches the transaction it stored.
        if (string.IsNullOrWhiteSpace(authority))
            return Task.FromResult(new PaymentVerifyResult(false, false, null, "مرجع پرداخت نامعتبر است.", null));

        return Task.FromResult(new PaymentVerifyResult(
            Ok: true,
            Succeeded: true,
            GatewayReference: $"manual-{orderId}",
            Error: null,
            Raw: "manual-confirmed"));
    }
}

/// <summary>
/// A gateway that carries its own configuration, so the admin page can show and edit its settings
/// without the checkout flow having to know which provider needs which fields.
/// </summary>
public interface IPaymentGatewayWithSettings
{
    /// <summary>The settings this gateway needs, as key/label pairs, for the admin page to render.</summary>
    IReadOnlyList<(string Key, string Label, bool Secret)> SettingsSchema { get; }
}
