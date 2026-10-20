using Microsoft.AspNetCore.Mvc.Filters;

namespace Webautomator.Web.Filters;

/// <summary>
/// Exempts a Panel endpoint from <see cref="BlockAdminFromPanelFilter"/>.
/// </summary>
/// <remarks>
/// The filter keeps the built-in owner account (<c>admin</c>) out of the Panel app's SURFACES — the
/// pages and tools a person uses. A handful of Panel endpoints are not surfaces at all: they are the
/// bookkeeping calls the browser extension and the desktop client make while playing a process
/// (register a run, unregister it, poll for "stop", report a cell event). The owner account is
/// blocked from the Panel by name, so sending those calls WITH the account's credential — which is
/// what makes a run show up under its real user instead of the dashboard's "unauthenticated" row —
/// had them redirected to /Admin and the run silently unregistered.
///
/// Marking them here is deliberately narrow: an endpoint gets this only when it is machinery, never
/// when it renders something a person reads.
/// </remarks>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class SkipOwnerPanelBlockAttribute : Attribute
{
}

/// <summary>Reads <see cref="SkipOwnerPanelBlockAttribute"/> off the action being executed.</summary>
public static class SkipOwnerPanelBlock
{
    public static bool AppliesTo(ActionExecutingContext context) =>
        context.ActionDescriptor.EndpointMetadata.OfType<SkipOwnerPanelBlockAttribute>().Any();
}
