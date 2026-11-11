using OpenQA.Selenium;
using Webautomator.Player.Models;

namespace Webautomator.Player.Services;

/// <summary>
/// The state filters a selector can require of the element it matches.
/// </summary>
/// <remarks>
/// Port of <c>selectorStateReqs</c> + the filter loop in <c>pageFindMatchingElement</c>. The flags
/// are the author's way of saying "the element that is actually USABLE, not merely present": a page
/// often has a hidden template copy before the real row, and a click on the template does nothing.
/// </remarks>
internal sealed record ElementRequirements(bool Visible, bool Enabled, bool Clickable)
{
    public static readonly ElementRequirements None = new(false, false, false);

    public bool Any => Visible || Enabled || Clickable;

    /// <summary>The requirements of one side of a node (its target, or its value-side selector).</summary>
    public static ElementRequirements For(GraphNode node, bool valueSide) => new(
        Visible: node.ReadExtraBool(valueSide ? "equalSelectorRequireVisible" : "selectorRequireVisible", false),
        Enabled: node.ReadExtraBool(valueSide ? "equalSelectorRequireEnabled" : "selectorRequireEnabled", false),
        Clickable: node.ReadExtraBool(valueSide ? "equalSelectorRequireClickable" : "selectorRequireClickable", false));
}

/// <summary>Element lookup that honours those filters.</summary>
internal static class ElementState
{
    /// <summary>
    /// The indexed element among the matches that satisfy the requirements.
    /// </summary>
    /// <exception cref="NoSuchElementException">
    /// Nothing matched (after filtering) — the caller's wait loop may retry that.
    /// </exception>
    public static IWebElement FindFirst(
        IWebDriver driver, By by, ElementRequirements requirements, int index)
    {
        var candidates = driver.FindElements(by);
        var matches = new List<IWebElement>();
        foreach (var element in candidates)
        {
            if (!requirements.Any || Matches(driver, element, requirements)) matches.Add(element);
        }

        if (matches.Count == 0)
            throw new NoSuchElementException("المنت موردنظر در صفحه پیدا نشد.");
        if (index <= 0) return matches[0];
        if (matches.Count <= index)
            throw new NoSuchElementException($"المنت با اندیس {index} پیدا نشد.");
        return matches[index];
    }

    /// <summary>Whether one element satisfies the visible / enabled / clickable requirements.</summary>
    public static bool Matches(IWebDriver driver, IWebElement element, ElementRequirements requirements)
    {
        if (!requirements.Any) return true;
        try
        {
            return ((IJavaScriptExecutor)driver).ExecuteScript(
                "const el=arguments[0], vis=arguments[1], en=arguments[2], clk=arguments[3];" +
                "if(!el)return false;" +
                "const st=window.getComputedStyle(el), r=el.getBoundingClientRect();" +
                "if(vis||clk){" +
                "if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity)===0)return false;" +
                "if(!(r.width>0&&r.height>0))return false;}" +
                "if(en){" +
                "if(el.disabled===true)return false;" +
                "if(el.getAttribute('aria-disabled')==='true')return false;" +
                "const dis=el.getAttribute('disabled');if(dis!=null&&dis!=='false')return false;}" +
                "if(clk){" +
                "if(st.pointerEvents==='none')return false;" +
                "const x=r.left+r.width/2,y=r.top+r.height/2;" +
                "if(x<0||y<0||x>window.innerWidth||y>window.innerHeight)return false;" +
                "try{const top=document.elementFromPoint(x,y);" +
                "if(top&&top!==el&&!el.contains(top)&&!(top.contains&&top.contains(el)))return false;}catch(e){}" +
                "}" +
                "return true;",
                element, requirements.Visible, requirements.Enabled, requirements.Clickable) is true;
        }
        catch
        {
            // A detached element cannot satisfy anything; the caller treats it as a miss.
            return false;
        }
    }
}
