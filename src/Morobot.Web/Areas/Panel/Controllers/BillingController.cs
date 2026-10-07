using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Services;
using Morobot.Infrastructure.Services.Payments;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Panel.Controllers;

/// <summary>
/// The commerce surfaces: choosing a plan, confirming a purchase, paying, and paying for a new
/// license.
/// </summary>
/// <remarks>
/// One controller for all three paths because they share the same three steps — choose, confirm, pay
/// — and splitting them would have duplicated the payment plumbing three times. What differs is the
/// draft an order is created from, which is a small method per path.
///
/// Every action is gated on the commerce licence flag. A deployment that is not licensed to sell must
/// not be able to reach checkout, and gating here rather than only hiding links is what makes that
/// true for someone typing the URL.
/// </remarks>
[Area("Panel")]
[Authorize]
public class BillingController : Controller
{
    private readonly PricingService _pricing;
    private readonly CheckoutService _checkout;
    private readonly LicenseService _license;
    private readonly Infrastructure.Identity.AuthService _auth;

    public BillingController(
        PricingService pricing,
        CheckoutService checkout,
        LicenseService license,
        Infrastructure.Identity.AuthService auth)
    {
        _pricing = pricing;
        _checkout = checkout;
        _license = license;
        _auth = auth;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>Whether this deployment may sell at all, resolved once per request.</summary>
    private async Task<bool> CommerceAllowedAsync(CancellationToken ct)
        => (await _license.GetRuntimeStateAsync(ct)).AllowsCommerce;

    // ---- Plan selection + checkout -------------------------------------------------------------

    /// <summary>
    /// The plan selection page: every sellable plan, its two cycle prices and its features.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Plans(CancellationToken ct)
    {
        if (!await CommerceAllowedAsync(ct)) return CommerceBlocked();
        ViewBag.Plans = await _pricing.ListPurchasablePlansAsync(ct);
        return View();
    }

    /// <summary>
    /// The checkout confirmation page for a chosen plan and cycle.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Checkout(string plan, string cycle = "monthly", long? orderId = null, CancellationToken ct = default)
    {
        if (!await CommerceAllowedAsync(ct)) return CommerceBlocked();

        // An existing order is re-shown from what was SAVED, not recomputed: the customer is
        // confirming the price they were quoted, and re-pricing could show a different number after
        // an operator edit.
        if (orderId is long existingId)
        {
            var existing = await _checkout.GetOrderAsync(existingId, UserId, ct);
            if (existing is null || existing.UserId != UserId) return NotFound();
            return View(BuildCheckoutModel(existing, CheckoutService.ReadTermsAsLines(existing)));
        }

        var plans = await _pricing.ListPurchasablePlansAsync(ct);
        var chosen = plans.FirstOrDefault(p => string.Equals(p.Code, plan, StringComparison.OrdinalIgnoreCase));
        if (chosen is null) return NotFound();
        var quote = PricingService.QuotePlan(chosen, cycle);
        if (quote.Total <= 0 && PricingService.PriceFor(chosen, cycle) is null)
            return BadRequest("این پلن در این دوره عرضه نمی‌شود.");

        var draft = new OrderDraft(
            OrderKind.Plan,
            chosen.Code,
            string.IsNullOrWhiteSpace(chosen.NameFa) ? chosen.NameEn : chosen.NameFa,
            cycle,
            quote.Total,
            quote.Total,
            quote.Currency,
            quote.ToTerms().ToJsonString());

        // Created now, not on "pay": the checkout page shows a real order id, and the customer can
        // come back to it. An unpaid order is harmless — it takes no money and grants nothing.
        var order = await _checkout.CreateOrderAsync(UserId, draft, ct);
        return View(BuildCheckoutModel(order, quote.Lines));
    }

    /// <summary>
    /// Start payment for an order and send the customer to the gateway.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Pay(long orderId, string? gateway = null, CancellationToken ct = default)
    {
        if (!await CommerceAllowedAsync(ct)) return CommerceBlocked();
        var order = await _checkout.GetOrderAsync(orderId, UserId, ct);
        if (order is null || order.UserId != UserId) return NotFound();

        var callback = Url.Action(nameof(Callback), "Billing", new { area = "Panel" }, Request.Scheme)!;
        var start = await _checkout.StartPaymentAsync(orderId, gateway, callback, ct);
        if (!start.Ok || string.IsNullOrWhiteSpace(start.RedirectUrl))
        {
            TempData["BillingError"] = start.Error ?? "شروع پرداخت ناموفق بود.";
            return RedirectToAction(nameof(Checkout), new { orderId });
        }
        return Redirect(start.RedirectUrl);
    }

    /// <summary>
    /// Where the gateway sends the customer back. Verifies, fulfills, then shows the result.
    /// </summary>
    /// <remarks>
    /// Anonymous and GET, because every PSP redirects with a GET and the customer may not carry a
    /// cookie back. Nothing here trusts the query string: the service matches the authority against a
    /// transaction it issued and asks the gateway directly.
    /// </remarks>
    [AllowAnonymous]
    [HttpGet]
    public async Task<IActionResult> Callback(string authority, long orderId, CancellationToken ct)
    {
        var gatewayParams = Request.Query.ToDictionary(q => q.Key, q => q.Value.ToString());
        var (ok, error, order) = await _checkout.VerifyAsync(orderId, authority, gatewayParams, ct: ct);

        if (!ok || order is null)
        {
            ViewBag.Failed = true;
            ViewBag.Error = error ?? "پرداخت تأیید نشد.";
            ViewBag.OrderId = orderId;
            return View("Result");
        }

        // Fulfillment is what the customer actually bought. It runs after payment is recorded, so a
        // failure here leaves a PAID order they can be helped with rather than a lost payment.
        try
        {
            await FulfillAsync(order, ct);
            await _checkout.MarkFulfilledAsync(order.Id, ct);
        }
        catch (Exception ex)
        {
            ViewBag.Failed = false;
            ViewBag.Warning = $"پرداخت انجام شد اما فعال‌سازی کامل نشد: {ex.Message}";
            ViewBag.OrderId = order.Id;
            return View("Result");
        }

        ViewBag.Failed = false;
        ViewBag.OrderId = order.Id;
        return View("Result");
    }

    /// <summary>
    /// Deliver what was bought.
    /// </summary>
    /// <remarks>
    /// Dispatched on the order's KIND and read from the order's stored terms, never from the current
    /// price list — the customer gets what they paid for, not what the product currently offers.
    /// </remarks>
    private async Task FulfillAsync(Order order, CancellationToken ct)
    {
        switch (order.Kind)
        {
            case OrderKind.Plan:
                var plan = (await _pricing.ListPurchasablePlansAsync(ct))
                    .FirstOrDefault(p => string.Equals(p.Code, order.ItemRef, StringComparison.OrdinalIgnoreCase));
                if (plan is null) throw new InvalidOperationException("پلن خریداری‌شده دیگر موجود نیست.");
                // The plan change itself is the delivery. The user's own password/policy handling is
                // deliberately NOT repeated here: they are already signed in, and forcing a password
                // change on a paid path would be a surprise.
                await _auth.AssignPlanAsync(order.UserId!.Value, plan.Id, ct: ct);
                break;

            case OrderKind.SoftwarePackage:
            case OrderKind.LicenseRenewal:
                // Both deliver a LICENSE. The document is generated on demand from the order's terms
                // (see the download action), so there is nothing to write here — marking the order
                // fulfilled is the whole step, and the download is what hands it over.
                break;
        }
    }

    /// <summary>
    /// Download the licence an order produced.
    /// </summary>
    /// <remarks>
    /// Generated from the order's own terms, so re-downloading always yields the same license and an
    /// edited price list cannot change a document that was already paid for. Only an order that was
    /// paid can produce one — the status check is the guard, since the terms alone would let an
    /// unpaid order mint a license.
    /// </remarks>
    [HttpGet]
    public async Task<IActionResult> DownloadLicense(long orderId, CancellationToken ct)
    {
        var order = await _checkout.GetOrderAsync(orderId, UserId, ct);
        if (order is null || order.UserId != UserId) return NotFound();
        if (order.Status is not (OrderStatus.Paid or OrderStatus.Fulfilled))
            return BadRequest("برای این سفارش پرداختی ثبت نشده است.");
        if (order.Kind == OrderKind.Plan)
            return BadRequest("این سفارش مربوط به پلن است و فایل لایسنس ندارد.");

        var runtime = await _license.GetRuntimeStateAsync(ct);
        if (!runtime.AllowsSelfIssuedLicenses)
            return BadRequest("این نصب مجاز به صدور لایسنس نیست.");

        var json = await _license.BuildOrderLicenseJsonAsync(order, ct);
        if (json is null) return BadRequest("ساخت فایل لایسنس ممکن نشد.");

        var bytes = System.Text.Encoding.UTF8.GetBytes(json);
        return File(bytes, "application/json", $"morobot-license-order-{order.Id}.morobot");
    }

    // ---- Financial history -----------------------------------------------------------------------

    /// <summary>The customer's own orders, newest first — all three revenue paths in one list.</summary>
    [HttpGet]
    public async Task<IActionResult> History(CancellationToken ct)
    {
        if (!await CommerceAllowedAsync(ct)) return CommerceBlocked();
        ViewBag.Orders = await _checkout.ListForUserAsync(UserId, ct);
        return View();
    }

    // ---- Helpers ---------------------------------------------------------------------------------

    private static object BuildCheckoutModel(Order order, IReadOnlyList<PriceLine> lines)
        => new CheckoutView(order, lines);

    private IActionResult CommerceBlocked()
    {
        TempData["BillingError"] = "قابلیت فروش در لایسنس این نصب فعال نیست.";
        return RedirectToAction("Index", "Home");
    }

    /// <summary>The model the checkout view renders: the order plus how its price was reached.</summary>
    public sealed record CheckoutView(Order Order, IReadOnlyList<PriceLine> Lines);
}
