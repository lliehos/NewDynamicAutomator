namespace Webautomator.Infrastructure.Services.Payments;

/// <summary>What the gateway needs to start a payment.</summary>
/// <param name="OrderId">Our order, echoed back on callback so we can match without trusting the gateway's id.</param>
/// <param name="Amount">What to charge.</param>
/// <param name="Currency">ISO code.</param>
/// <param name="Description">Shown on the gateway's own page.</param>
/// <param name="CallbackUrl">Where the gateway sends the customer back.</param>
public sealed record PaymentStartRequest(
    long OrderId,
    decimal Amount,
    string Currency,
    string Description,
    string CallbackUrl);

/// <summary>Where to send the customer, and the reference we must remember.</summary>
public sealed record PaymentStartResult(bool Ok, string? RedirectUrl, string? Authority, string? Error);

/// <summary>The gateway's verdict on a returned payment.</summary>
public sealed record PaymentVerifyResult(bool Ok, bool Succeeded, string? GatewayReference, string? Error, string? Raw);

/// <summary>
/// A payment provider.
/// </summary>
/// <remarks>
/// Abstracted because the provider is a deployment choice, not a property of this product: which
/// Iranian PSP a customer may use depends on their merchant account, and the right answer differs
/// per installation. Behind an interface, adding ZarinPal or IDPay later is one class plus a setting
/// — and, more importantly, the checkout flow never has to know which one is configured.
///
/// The flow is the standard two-step: Start sends the customer to the gateway and returns a
/// reference we keep; the gateway then sends them back, and Verify asks the gateway directly whether
/// the money actually moved. Verifying server-to-server rather than trusting the callback's query
/// string is what makes a forged callback harmless.
/// </remarks>
public interface IPaymentGateway
{
    /// <summary>Stable key stored on the transaction row, e.g. "manual" or "zarinpal".</summary>
    string Key { get; }

    /// <summary>Whether this gateway is configured enough to be used, with the reason when it is not.</summary>
    (bool Ready, string? Reason) IsReady();

    Task<PaymentStartResult> StartAsync(PaymentStartRequest request, CancellationToken ct = default);

    /// <summary>
    /// Confirm a returned payment.
    /// </summary>
    /// <param name="authority">The reference <see cref="StartAsync"/> produced.</param>
    /// <param name="orderId">Our order id, as echoed back.</param>
    /// <param name="gatewayParams">
    /// Everything the gateway appended to the callback, so a provider that reports success in its
    /// query string can be read without the interface having to model each provider's parameter set.
    /// </param>
    Task<PaymentVerifyResult> VerifyAsync(
        string authority, long orderId, IReadOnlyDictionary<string, string> gatewayParams, CancellationToken ct = default);
}
