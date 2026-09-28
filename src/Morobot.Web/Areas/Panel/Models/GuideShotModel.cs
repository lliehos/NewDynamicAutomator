namespace Morobot.Web.Areas.Panel.Models;

/// <summary>
/// One screenshot slot in the illustrated guide.
/// </summary>
/// <remarks>
/// The guide ships with the layout and the wording, not with the images: a screenshot has to be
/// taken on a real deployment, and a stale one is worse than none because it teaches a UI that no
/// longer exists. Each slot therefore names the file it expects and describes what the reader
/// should be looking at, and the view decides whether to show the image or a labelled placeholder.
/// </remarks>
public sealed class GuideShotModel
{
    /// <summary>
    /// File name (without extension) under <c>wwwroot/img/guide/</c>, taken verbatim from the
    /// <c>Guide:Shots</c> configuration list.
    /// </summary>
    /// <remarks>
    /// Passed in rather than derived from the locale key: the first attempt derived it by stripping
    /// "panel.guide." and slugifying, which turned <c>s2Title</c> into <c>s2-itle</c> — a mangled
    /// name that would never match a real file. The configuration list is the one place an operator
    /// already edits to describe the shots, so it is the right source for the name too.
    /// </remarks>
    public required string Slug { get; init; }

    /// <summary>Locale key naming the section, reused for the alt text.</summary>
    public required string Key { get; init; }

    /// <summary>Locale key for the caption shown under the image.</summary>
    public required string Caption { get; init; }

    /// <summary>The page the screenshot should show, linked so the reader can open it.</summary>
    public required string Url { get; init; }
}
