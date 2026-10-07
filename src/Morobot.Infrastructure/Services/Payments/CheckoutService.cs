using System.Text.Json;
using System.Text.Json.Nodes;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Morobot.Infrastructure.Services.Payments;

/// <summary>What a checkout needs to know to charge for something.</summary>
/// <param name="Kind">Which revenue path this is.</param>
/// <param name="ItemRef">The plan code / package id / license term reference.</param>
/// <param name="ItemTitle">What to show the customer and store in history.</param>
/// <param name="BillingCycle">Monthly/yearly/perpetual where the kind has one.</param>
/// <param name="Amount">List price.</param>
/// <param name="PayableAmount">What will actually be charged.</param>
/// <param name="Currency">ISO code.</param>
/// <param name="TermsJson">The snapshot of what was bought, stored on the order.</param>
public sealed record OrderDraft(
    OrderKind Kind,
    string ItemRef,
    string ItemTitle,
    string? BillingCycle,
    decimal Amount,
    decimal PayableAmount,
    string Currency,
    string? TermsJson);

/// <summary>
/// Creates orders, starts payments and confirms them.
/// </summary>
/// <remarks>
/// One service for all three revenue paths, because the money-handling must be identical for all of
/// them: same idempotency, same "verify before trusting", same audit. Splitting it per kind would
/// have meant three places that could each get the money rules subtly wrong.
/// </remarks>
public class CheckoutService
{
    private readonly AppDbContext _db;
    private readonly IEnumerable<IPaymentGateway> _gateways;
    private readonly ILogger<CheckoutService> _log;

    public CheckoutService(AppDbContext db, IEnumerable<IPaymentGateway> gateways, ILogger<CheckoutService> log)
    {
        _db = db;
        _gateways = gateways;
        _log = log;
    }

    /// <summary>The configured gateways, for the admin settings page.</summary>
    public IReadOnlyList<IPaymentGateway> Gateways => _gateways.ToList();

    public IPaymentGateway? Resolve(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return _gateways.FirstOrDefault();
        return _gateways.FirstOrDefault(g => string.Equals(g.Key, key, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Create a pending order. No money is involved yet.</summary>
    public async Task<Order> CreateOrderAsync(int? userId, OrderDraft draft, CancellationToken ct = default)
    {
        var order = new Order
        {
            UserId = userId,
            Kind = draft.Kind,
            Status = OrderStatus.Pending,
            ItemRef = draft.ItemRef,
            ItemTitle = draft.ItemTitle,
            BillingCycle = draft.BillingCycle,
            Amount = draft.Amount,
            PayableAmount = draft.PayableAmount,
            DiscountAmount = draft.Amount - draft.PayableAmount,
            Currency = draft.Currency,
            TermsJson = draft.TermsJson,
            CreatedAtUtc = DateTime.UtcNow
        };
        _db.Orders.Add(order);
        await _db.SaveChangesAsync(ct);
        return order;
    }

    /// <summary>
    /// Send the customer to the gateway for an existing pending order.
    /// </summary>
    /// <remarks>
    /// The transaction row is written BEFORE the redirect, so a customer who pays and then loses the
    /// connection can still be reconciled: the authority we must match against already exists.
    /// </remarks>
    public async Task<PaymentStartResult> StartPaymentAsync(
        long orderId, string? gatewayKey, string callbackUrl, CancellationToken ct = default)
    {
        var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == orderId, ct);
        if (order is null) return new PaymentStartResult(false, null, null, "سفارش پیدا نشد.");
        if (order.Status != OrderStatus.Pending)
            return new PaymentStartResult(false, null, null, "این سفارش دیگر قابل پرداخت نیست.");

        var gateway = Resolve(gatewayKey);
        if (gateway is null) return new PaymentStartResult(false, null, null, "درگاه پرداختی تنظیم نشده است.");
        var (ready, reason) = gateway.IsReady();
        if (!ready) return new PaymentStartResult(false, null, null, reason ?? "درگاه پرداخت آماده نیست.");

        var start = await gateway.StartAsync(new PaymentStartRequest(
            order.Id, order.PayableAmount, order.Currency, order.ItemTitle, callbackUrl), ct);
        if (!start.Ok)
        {
            _log.LogWarning("Gateway {Gateway} refused to start order {OrderId}: {Error}",
                gateway.Key, orderId, start.Error);
            return start;
        }

        _db.PaymentTransactions.Add(new PaymentTransaction
        {
            OrderId = order.Id,
            Gateway = gateway.Key,
            Authority = start.Authority ?? "",
            Status = PaymentStatus.Initiated,
            Amount = order.PayableAmount,
            Currency = order.Currency,
            CreatedAtUtc = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
        return start;
    }

    /// <summary>
    /// Confirm a returned payment and mark the order paid.
    /// </summary>
    /// <remarks>
    /// Idempotent by design. A callback can arrive twice — the customer refreshes, or the gateway
    /// retries — and the second arrival must find the work already done rather than charge again or
    /// fulfill twice. The (gateway, authority) unique index is what makes the lookup exact, and the
    /// order's own status is checked before fulfilling.
    /// </remarks>
    public async Task<(bool Ok, string? Error, Order? Order)> VerifyAsync(
        long orderId, string authority, IReadOnlyDictionary<string, string> gatewayParams,
        string? gatewayKey = null, CancellationToken ct = default)
    {
        var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == orderId, ct);
        if (order is null) return (false, "سفارش پیدا نشد.", null);

        // Already done: return success so a repeated callback page shows "paid", not an error.
        if (order.Status is OrderStatus.Paid or OrderStatus.Fulfilled)
            return (true, null, order);

        var tx = await _db.PaymentTransactions
            .FirstOrDefaultAsync(t => t.OrderId == orderId && t.Authority == authority, ct);
        if (tx is null)
        {
            // An authority we never issued. Refusing is the point: this is exactly the forged-callback
            // case, and treating it as a normal failure is what keeps it out of the order's history.
            _log.LogWarning("Unknown payment authority for order {OrderId}", orderId);
            return (false, "مرجع پرداخت با این سفارش مطابقت ندارد.", null);
        }

        var gateway = Resolve(gatewayKey ?? tx.Gateway);
        if (gateway is null) return (false, "درگاه پرداخت پیدا نشد.", null);

        var verify = await gateway.VerifyAsync(authority, orderId, gatewayParams, ct);
        tx.RawResponse = Truncate(verify.Raw, 2000);

        if (!verify.Ok || !verify.Succeeded)
        {
            tx.Status = PaymentStatus.Failed;
            tx.CompletedAtUtc = DateTime.UtcNow;
            order.Status = OrderStatus.Failed;
            order.FailureReason = verify.Error ?? "پرداخت تأیید نشد.";
            await _db.SaveChangesAsync(ct);
            return (false, order.FailureReason, order);
        }

        tx.Status = PaymentStatus.Succeeded;
        tx.GatewayReference = verify.GatewayReference;
        tx.CompletedAtUtc = DateTime.UtcNow;
        order.Status = OrderStatus.Paid;
        order.PaidAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        _log.LogInformation("Order {OrderId} paid ({Amount} {Currency})", order.Id, order.PayableAmount, order.Currency);
        return (true, null, order);
    }

    /// <summary>Record that fulfillment happened, so the order stops being "paid but not delivered".</summary>
    public async Task MarkFulfilledAsync(long orderId, CancellationToken ct = default)
    {
        var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == orderId, ct);
        if (order is null || order.Status == OrderStatus.Fulfilled) return;
        order.Status = OrderStatus.Fulfilled;
        order.FulfilledAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>A user's orders, newest first — the financial history page.</summary>
    public async Task<List<Order>> ListForUserAsync(int userId, CancellationToken ct = default)
        => await _db.Orders.AsNoTracking()
            .Where(o => o.UserId == userId)
            .OrderByDescending(o => o.CreatedAtUtc)
            .ToListAsync(ct);

    public async Task<Order?> GetOrderAsync(long orderId, int? userId, CancellationToken ct = default)
    {
        var order = await _db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orderId, ct);
        // A signed-in user may only see their own; an anonymous order is reachable by id, which is
        // what lets a checkout complete before the customer has an account.
        if (order is null) return null;
        if (order.UserId is not null && userId is not null && order.UserId != userId) return null;
        return order;
    }

    /// <summary>
    /// Read a stored order's terms.
    /// </summary>
    /// <remarks>
    /// Terms are the snapshot of what was bought, so fulfillment reads THIS rather than the current
    /// price list or feature set. A price edited after the sale must not change what the customer
    /// gets.
    /// </remarks>
    public static JsonObject? ReadTerms(Order order)
    {
        if (string.IsNullOrWhiteSpace(order.TermsJson)) return null;
        try { return JsonNode.Parse(order.TermsJson) as JsonObject; }
        catch (JsonException) { return null; }
    }

    private static string? Truncate(string? s, int max)
        => string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s[..max]);
}
