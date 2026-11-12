namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class MinimapTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(10000, Minimap.MaxLines);
        Assert.Equal(1000, Minimap.MaxLineChars);
        Assert.Equal(100, Minimap.DefaultMaxPercent);
        Assert.Equal(2.2, Minimap.DefaultScale);
        Assert.Equal(120, Minimap.MaxBars);
    }

    [Fact]
    public void LineWidthPercent_ReturnsZeroForEmptyAndWhitespaceOnlyLines()
    {
        Assert.Equal(0, Minimap.LineWidthPercent(""));
        Assert.Equal(0, Minimap.LineWidthPercent("   "));
        Assert.Equal(0, Minimap.LineWidthPercent("\t\t"));
        Assert.Equal(0, Minimap.LineWidthPercent(null));
    }

    [Fact]
    public void LineWidthPercent_CalculatesProportionalWidthBasedOnCharacterLength()
    {
        var line = "def total():"; // length 12
        var w = Minimap.LineWidthPercent(line);
        Assert.Equal((int)Math.Floor(12 * Minimap.DefaultScale + 0.5), w); // 26%
        Assert.Equal(26, w);
    }

    [Fact]
    public void LineWidthPercent_ClampsToMaxPercent()
    {
        var sb = new System.Text.StringBuilder();
        for (int i = 0; i < 30; i++) sb.Append("x = 100; ");
        var longLine = sb.ToString();
        var w = Minimap.LineWidthPercent(longLine);
        Assert.Equal(100, w);
    }

    [Fact]
    public void LineWidthPercent_StripsHtmlTagsBeforeCalculatingLength()
    {
        var withHtml = "<span class=\"k\">def</span> <span class=\"f\">total</span>():";
        var plain = "def total():";
        Assert.Equal(Minimap.LineWidthPercent(plain), Minimap.LineWidthPercent(withHtml));
    }

    [Fact]
    public void ComputeLines_GeneratesLineDensityObjectsWithLineNumbers()
    {
        var code = "line 1\nline 2\n\nline 4";
        var items = Minimap.ComputeLines(code);
        Assert.Equal(4, items.Count);
        Assert.Equal(1, items[0].Line);
        Assert.Equal(3, items[2].Line);
        Assert.Equal(0, items[2].Width); // blank line
        Assert.Equal(4, items[3].Line);
    }

    [Fact]
    public void ComputeLines_AssociatesDiffStatusWithModifiedLines()
    {
        var code = "line 1\nline 2\nline 3";
        var diffs = new List<Minimap.DiffItem>
        {
            new Minimap.DiffItem(Line: 2, Type: "chg"),
            new Minimap.DiffItem(Line: 3, Type: "add")
        };
        var items = Minimap.ComputeLines(code, diffs);
        Assert.Equal("", items[0].Type);
        Assert.Equal("chg", items[1].Type);
        Assert.Equal("add", items[2].Type);
    }

    [Fact]
    public void SampleLines_DownsamplesLineItemsIntoBoundedBuckets()
    {
        var items = Enumerable.Range(0, 300).Select(i => new Minimap.MinimapItem(
            Line: i + 1,
            Width: (i % 20) * 4,
            Type: i == 150 ? "chg" : ""
        )).ToList();

        var sampled = Minimap.SampleLines(items, 50);
        Assert.Equal(50, sampled.Count);
        // Ensures changed line in bucket 25 is preserved
        var changedBucket = sampled.FirstOrDefault(b => b.Type == "chg");
        Assert.NotNull(changedBucket);
    }

    [Fact]
    public void RenderMinimapHtml_RendersStyledHtmlElementsMatchingCssRules()
    {
        var code = "const x = 1\nconst y = 2";
        var html = Minimap.RenderMinimapHtml(code);
        Assert.Contains("<i style=\"width:", html);
        Assert.Equal(2, html.Split("<i").Length - 1);
    }

    [Fact]
    public void RenderMinimapHtml_IncludesDiffStylingClasses()
    {
        var code = "line 1\nline 2\nline 3";
        var diffs = new List<Minimap.DiffItem>
        {
            new Minimap.DiffItem(Line: 1, Type: "del"),
            new Minimap.DiffItem(Line: 2, Type: "chg"),
            new Minimap.DiffItem(Line: 3, Type: "add")
        };
        var html = Minimap.RenderMinimapHtml(code, diffs);
        Assert.Contains("class=\"del\"", html);
        Assert.Contains("class=\"chg\"", html);
        Assert.Contains("class=\"add\"", html);
    }

    [Fact]
    public void ViewportSlider_CalculatesProportionalSliderPositionAndHeight()
    {
        var slider = Minimap.ViewportSlider(100, 20, 25);
        Assert.Equal(19, slider.TopPercent); // (20 - 1) / 100 * 100 = 19%
        Assert.Equal(25, slider.HeightPercent); // 25 / 100 * 100 = 25%
    }

    [Fact]
    public void ViewportSlider_PreventsSliderFromOverflowingBounds()
    {
        var slider = Minimap.ViewportSlider(100, 95, 20);
        Assert.Equal(20, slider.HeightPercent);
        Assert.Equal(80, slider.TopPercent); // 100 - 20 = 80
    }

    [Fact]
    public void HostileInputImmunity_ForAllMinimapFunctions()
    {
        Assert.Equal(0, Minimap.LineWidthPercent(null));
        Assert.Empty(Minimap.ComputeLines((string?)null));
        Assert.Empty(Minimap.SampleLines(null));
        Assert.Equal("", Minimap.RenderMinimapHtml((string?)null));

        var slider = Minimap.ViewportSlider(0, 0, 0);
        Assert.Equal(0, slider.TopPercent);
        Assert.Equal(100, slider.HeightPercent);
    }
}
