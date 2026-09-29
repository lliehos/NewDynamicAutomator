using System.Text.Json;
using System.Text.Json.Nodes;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// Turns a recorded smart-learning session into an editor canvas graph.
///
/// This is the piece that was missing: the session file has always collected raw contexts, but
/// nothing ever converted them into nodes, so "save" had no graph to persist and the process stayed
/// empty with no error shown.
///
/// Every property name and enum value here was checked against what the editor actually reads
/// (<c>wwwroot/editor/flow.js</c>), because the editor does not validate a loaded graph — it simply
/// renders it. A wrong property name therefore fails silently: the node appears, but the step it
/// describes does nothing. The relevant contracts are:
/// <list type="bullet">
/// <item>node kinds: <c>start</c>, <c>group</c>, <c>condition</c>, <c>action</c>/<c>step</c>, <c>end</c></item>
/// <item>action: <c>selectorValue</c> + <c>actionType</c> (from the editor's own action list)</item>
/// <item>condition: <c>conditionType</c> (from its condition list) + <c>equalityType</c> + operand</item>
/// <item>edges: <c>next</c>, or <c>success</c>/<c>fail</c> out of a condition</item>
/// </list>
///
/// The inference stays deliberately conservative. Without the language model there is no reliable
/// way to tell one intent from another, so a step is only refined where the captured context proves
/// it: a Ctrl+Shift+click is a condition, a click on a field becomes a fill. Everything else becomes
/// a plain click carrying the selector it was captured from.
/// </summary>
internal static class SmartLearningGraphFactory
{
    private const string KindStart = "start";
    private const string KindAction = "action";
    private const string KindCondition = "condition";
    private const string KindEnd = "end";

    /// <summary>Action types the editor recognises. A value outside its list is not a real action.</summary>
    private const string ActionClick = "Click";
    private const string ActionInputContent = "InputContent";

    /// <summary>Condition types the editor recognises. "None" means unset, so it is never emitted.</summary>
    private const string CondUrl = "Url";
    private const string CondFindElement = "FindElement";

    /// <summary>Comparison operators the editor recognises; <c>equal</c> is its own default.</summary>
    private const string EqContain = "Contain";
    private const string EqHasValue = "HasValue";

    /// <summary>Horizontal pitch between generated steps, in canvas units.</summary>
    private const int XStart = 80;
    private const int XPitch = 260;
    private const int YBase = 240;

    /// <summary>A node produced from one recorded context.</summary>
    private sealed class Step
    {
        public required JsonObject Node { get; init; }
    }

    /// <summary>
    /// Build a canvas graph for <paramref name="contexts"/>.
    ///
    /// Returns <c>null</c> when nothing could become a step, so the caller can say "no graph was
    /// produced" instead of overwriting the process the user already had with an empty diagram.
    /// </summary>
    public static JsonObject? Build(IReadOnlyList<JsonElement> contexts, long taskId, string? title)
    {
        var steps = new List<Step>();
        var counter = 0;
        string NextId(string prefix) => $"{prefix}{++counter}";

        foreach (var ctx in contexts)
        {
            var step = Convert(ctx, NextId);
            if (step is null) continue;
            // A `change` and the `click` that opened the same field describe one action, not two.
            // A Ctrl+Shift+click likewise records both a `condition` and a plain `click` for the same
            // element — the recorder emits both on purpose so the learner sees the interaction, but
            // re-performing the click as well would press the control the user only meant to check.
            MergeTypedIntoPrecedingStep(steps, step);
            if (!IsClickDuplicatingCondition(steps, step)) steps.Add(step);
        }

        if (steps.Count == 0) return null;

        var nodes = new JsonArray();
        var edges = new JsonArray();
        var edgeSeq = 0;
        string NextEdgeId() => $"e{++edgeSeq}";

        var startId = NextId("n");
        nodes.Add(new JsonObject
        {
            ["id"] = startId,
            ["kind"] = KindStart,
            ["title"] = string.IsNullOrWhiteSpace(title) ? "شروع" : title,
            ["x"] = XStart,
            ["y"] = YBase,
            ["repeatSourceType"] = "None"
        });

        var endId = NextId("n");
        nodes.Add(new JsonObject
        {
            ["id"] = endId,
            ["kind"] = KindEnd,
            ["title"] = "پایان",
            ["x"] = XStart + (steps.Count + 1) * XPitch,
            ["y"] = YBase
        });

        // A single left-to-right column at a fixed pitch. The editor lets the user drag nodes
        // anywhere, so an exact layout is not worth inferring — only a readable starting arrangement
        // that does not stack every node on one point.
        var x = XStart + XPitch;
        var previous = startId;
        foreach (var step in steps)
        {
            step.Node["x"] = x;
            step.Node["y"] = YBase;
            nodes.Add(step.Node);

            var id = step.Node["id"]!.GetValue<string>();
            // Every step is entered from the previous one. A condition also gets a `success` branch
            // below, but it still needs this inbound edge to be reached at all.
            edges.Add(new JsonObject
            {
                ["id"] = NextEdgeId(),
                ["from"] = previous,
                ["to"] = id,
                ["kind"] = "next"
            });

            previous = id;
            x += XPitch;
        }

        // A condition's success branch is what carries the flow onward. Wiring it to the end keeps the
        // graph runnable as recorded instead of stopping at the first condition, and it matches
        // capture order — the steps that followed were performed after the check passed. The fail
        // branch is left unwired, which the editor treats as a clean termination because an `end` node
        // is present. The chain's own terminal edge (added below) is skipped for a condition so it is
        // never given both a `success` and a `next` edge: a condition with any branch edge falls back
        // to `next` only when no branch matches, and having both would make the recorded order
        // ambiguous.
        foreach (var step in steps)
        {
            if (!string.Equals(step.Node["kind"]!.GetValue<string>(), KindCondition, StringComparison.Ordinal))
                continue;
            edges.Add(new JsonObject
            {
                ["id"] = NextEdgeId(),
                ["from"] = step.Node["id"]!.GetValue<string>(),
                ["to"] = endId,
                ["kind"] = "success"
            });
        }

        // Close the chain, unless it already closed on a condition's success branch above.
        var lastIsCondition = string.Equals(
            ReadString(steps[^1].Node, "kind"), KindCondition, StringComparison.Ordinal);
        if (!lastIsCondition)
        {
            edges.Add(new JsonObject
            {
                ["id"] = NextEdgeId(),
                ["from"] = previous,
                ["to"] = endId,
                ["kind"] = "next"
            });
        }

        return new JsonObject
        {
            ["taskId"] = taskId,
            ["title"] = title,
            ["designOrigin"] = "SmartRecorder",
            // Only `zoom` is read by the renderer; the world transform is derived from the node
            // bounds plus an internal centring offset, so writing x/y here would be inert.
            ["viewport"] = new JsonObject { ["zoom"] = 1 },
            ["nodes"] = nodes,
            ["edges"] = edges,
            ["dataSources"] = new JsonArray(),
            ["repeatSourceType"] = "None"
        };
    }

    /// <summary>
    /// Fold a typed-text step into the click that opened the same field.
    ///
    /// Clicking a field and then typing in it fires two contexts for one user action. Left alone they
    /// become a `Click` step followed by an `InputContent` step on the same selector, which makes the
    /// player click the field, then click it again to fill it. The click is upgraded in place to the
    /// fill, so one user action stays one step.
    ///
    /// A `change` with no matching preceding click is kept as its own step: that happens when the
    /// session started mid-form, and the typed value is still worth reproducing.
    /// </summary>
    private static void MergeTypedIntoPrecedingStep(List<Step> steps, Step incoming)
    {
        var node = incoming.Node;
        var isFill = string.Equals(ReadString(node, "actionType"), ActionInputContent, StringComparison.Ordinal);
        if (isFill && steps.Count > 0)
        {
            var prev = steps[^1].Node;
            var sameTarget = string.Equals(ReadString(prev, "selectorValue"), ReadString(node, "selectorValue"), StringComparison.Ordinal);
            var prevIsPlainClick = string.Equals(ReadString(prev, "actionType"), ActionClick, StringComparison.Ordinal);
            if (sameTarget && prevIsPlainClick)
            {
                // Promote the click in place; the incoming node is discarded so no edge is emitted
                // for it and the chain is not lengthened.
                prev["actionType"] = ActionInputContent;
                prev["contentSourceType"] = "Constant";
                // The value is copied rather than moved. `node` is dropped here so a move would work
                // too, but a `JsonNode` may have only one parent — copying keeps this correct if the
                // incoming step is ever kept as well.
                if (node["constantValue"] is { } typed)
                    prev["constantValue"] = typed.DeepClone();
                return;
            }
        }
        steps.Add(incoming);
    }

    /// <summary>
    /// Whether this click merely repeats a condition mark on the same element.
    ///
    /// The recorder emits a `condition` context and then also a `click` context for one Ctrl+Shift+
    /// click, deliberately, so nothing about the interaction is lost. For the rebuilt process the two
    /// are one step: turning both into nodes would ask the player to check the element and then press
    /// it, which is not what the user did. The click's id is simply skipped, which is harmless — ids
    /// only need to be unique, not consecutive.
    /// </summary>
    private static bool IsClickDuplicatingCondition(List<Step> steps, Step incoming)
    {
        var node = incoming.Node;
        if (!string.Equals(ReadString(node, "actionType"), ActionClick, StringComparison.Ordinal)) return false;
        if (steps.Count == 0) return false;

        var prev = steps[^1].Node;
        if (!string.Equals(ReadString(prev, "kind"), KindCondition, StringComparison.Ordinal)) return false;
        return string.Equals(
            ReadString(prev, "equalSelectorValue"),
            ReadString(node, "selectorValue"),
            StringComparison.Ordinal);
    }

    /// <summary>Map one captured context onto a node, or <c>null</c> when it carries no interaction.</summary>
    private static Step? Convert(JsonElement ctx, Func<string, string> nextId)
    {
        if (ctx.ValueKind != JsonValueKind.Object) return null;
        var kind = ReadString(ctx, "kind");
        if (string.IsNullOrEmpty(kind)) return null;

        var page = ctx.TryGetProperty("page", out var p) && p.ValueKind == JsonValueKind.Object ? p : default;

        // Contexts that record something the learner should see, but that is not itself a step to
        // re-perform. Turning these into nodes would pad the diagram with focus jumps, scrolls and
        // tab switches, and re-performing a modified click would click the same control twice.
        //
        // `input` is dropped here as well as `change` being kept: `input` fires continuously while
        // typing and carries only a length, never the text, so it has nothing to reproduce. The text
        // arrives once on `change`, which is why only that one becomes a step.
        switch (kind)
        {
            case "focus":
            case "scroll":
            case "visibility":
            case "page":
            case "input":
            case "keydown":
            case "submit":
            case "dblclick":
            case "contextmenu":
                return null;
        }

        // A navigation is not an interaction to re-perform, but it is where the following steps have
        // to start from. The editor has no "navigate" node — its URL check is a condition of type
        // Url — so that is what a navigation becomes.
        if (kind == "navigation")
        {
            var url = ReadString(page, "url");
            if (string.IsNullOrWhiteSpace(url)) return null;
            var pageTitle = ReadString(page, "title");
            return new Step
            {
                Node = new JsonObject
                {
                    ["id"] = nextId("n"),
                    ["kind"] = KindCondition,
                    ["title"] = string.IsNullOrWhiteSpace(pageTitle) ? url : pageTitle,
                    ["conditionType"] = CondUrl,
                    ["contentSourceType"] = "Constant",
                    ["equalityType"] = EqContain,
                    ["navigation"] = url
                }
            };
        }

        // Everything else must be one of the two interaction kinds that carry a target element.
        if (kind is not ("click" or "condition" or "change")) return null;

        var target = ctx.TryGetProperty("target", out var tg) && tg.ValueKind == JsonValueKind.Object ? tg : default;
        if (target.ValueKind != JsonValueKind.Object) return null;

        var selector = ReadString(target, "cssPath");
        if (string.IsNullOrWhiteSpace(selector)) return null;

        var isCondition = kind == "condition"
            || string.Equals(ReadString(ctx, "markedAs"), "condition", StringComparison.Ordinal);

        if (isCondition)
        {
            // A recorded condition is a check that the element is on the page — the only claim the
            // capture supports. No operator or compare value is invented for it.
            return new Step
            {
                Node = new JsonObject
                {
                    ["id"] = nextId("n"),
                    ["kind"] = KindCondition,
                    ["title"] = Title(kind, target),
                    ["conditionType"] = CondFindElement,
                    ["contentSourceType"] = "Elements",
                    ["equalityType"] = EqHasValue,
                    ["equalSelectorValue"] = selector,
                    ["equalSelectorWaitEnabled"] = false
                }
            };
        }

        var node = new JsonObject
        {
            ["id"] = nextId("n"),
            ["kind"] = KindAction,
            ["title"] = Title(kind, target),
            ["selectorValue"] = selector
        };

        // What was typed into the element, so the step re-types it instead of only clicking.
        //
        // The text is NOT on the click context: clicking a field fires before any typing, so the
        // `value` captured with the click is normally empty. The typed text arrives later, on the
        // element's own `change` context, where the recorder puts it at the TOP level. The element's
        // own `target.value` is read only as a last resort, since it reflects the state at capture
        // time and is usually stale.
        var value = TypedValue(ctx, target);
        if (!string.IsNullOrEmpty(value) && LooksLikeTextField(target))
        {
            node["actionType"] = ActionInputContent;
            node["contentSourceType"] = "Constant";
            node["constantValue"] = value;
        }
        else
        {
            node["actionType"] = ActionClick;
        }

        return new Step { Node = node };
    }

    /// <summary>
    /// The text associated with a context, from wherever the recorder actually put it.
    ///
    /// Order matters: a top-level <c>value</c> is a real recorded keystroke result, while
    /// <c>target.value</c> is the element's state at capture time and is usually stale or empty. Only
    /// a top-level <c>value</c> is trusted for content; <c>target.value</c> is a last resort for
    /// contexts that carry nothing else.
    /// </summary>
    private static string? TypedValue(JsonElement ctx, JsonElement target)
    {
        var top = ReadString(ctx, "value");
        if (!string.IsNullOrEmpty(top)) return top;
        var inner = ReadString(target, "value");
        return string.IsNullOrEmpty(inner) ? null : inner;
    }

    /// <summary>
    /// Whether the captured element can hold typed text.
    ///
    /// Checked rather than assumed: a button and a text input both expose a `value`, and typing into
    /// a button would produce a step that silently does nothing. Only genuine field types qualify,
    /// and <c>contenteditable</c> is excluded because the capture records it as a plain div.
    /// </summary>
    private static bool LooksLikeTextField(JsonElement target)
    {
        var tag = ReadString(target, "tag");
        if (string.Equals(tag, "textarea", StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.Equals(tag, "input", StringComparison.OrdinalIgnoreCase)) return false;

        var type = ReadString(target, "type");
        if (string.IsNullOrWhiteSpace(type)) return true; // <input> with no type is a text field
        return type.Trim().ToLowerInvariant() switch
        {
            "text" or "search" or "email" or "tel" or "url" or "password"
                or "number" or "date" or "datetime-local" or "month" or "time" or "week" => true,
            _ => false
        };
    }

    /// <summary>Short, human-readable label; falls back through the evidence the capture holds.</summary>
    private static string Title(string kind, JsonElement target)
    {
        var text = Truncate(ReadString(target, "text"), 60);
        if (!string.IsNullOrWhiteSpace(text)) return text!;
        var name = ReadString(target, "name");
        if (!string.IsNullOrWhiteSpace(name)) return name!;
        var id = ReadString(target, "id");
        if (!string.IsNullOrWhiteSpace(id)) return id!;
        var tag = ReadString(target, "tag") ?? "element";
        return kind == "condition" ? $"شرط: {tag}" : $"کلیک روی {tag}";
    }

    private static string? ReadString(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object) return null;
        if (!obj.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    /// <summary>
    /// Read a string off a node that is being built.
    ///
    /// A separate overload rather than one taking <c>JsonNode</c>: the two JSON object types live in
    /// different namespaces with no implicit conversion, and the built-graph side only ever needs the
    /// four scalar cases the writer can produce.
    /// </summary>
    private static string? ReadString(JsonObject? obj, string name)
    {
        if (obj is null) return null;
        if (!obj.TryGetPropertyValue(name, out var node) || node is null) return null;
        return node.GetValueKind() switch
        {
            JsonValueKind.String => node.GetValue<string>(),
            JsonValueKind.Number => node.ToJsonString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private static string? Truncate(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return value;
        var flat = value.Replace('\n', ' ').Replace('\r', ' ').Trim();
        return flat.Length <= max ? flat : flat[..max];
    }
}
