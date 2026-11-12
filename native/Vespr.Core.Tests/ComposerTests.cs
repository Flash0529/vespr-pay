using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class ComposerTests
{
    [Fact]
    public void BigPaste_Detection()
    {
        Assert.False(Composer.IsBigPaste("a short question"));
        Assert.True(Composer.IsBigPaste(new string('x', Composer.BigPasteChars)));
        Assert.True(Composer.IsBigPaste(string.Concat(Enumerable.Repeat("a\n", Composer.BigPasteLines))));
        Assert.False(Composer.IsBigPaste(string.Concat(Enumerable.Repeat(" \n", 5000))));
    }

    [Fact]
    public void BigPaste_Metadata()
    {
        var plan = Composer.PasteMeta("# Launch plan\n\nWe ship on Friday.\n- one\n- two");
        Assert.Equal("Launch plan.md", plan.Name);
        Assert.Equal(5, plan.Lines);
        Assert.Equal(45, plan.Chars);
        Assert.Equal("markdown", plan.Kind);

        Assert.Equal("Pasted text.txt", Composer.PasteMeta("plain words\nmore words").Name);
        Assert.Equal("Pasted text 3.txt", Composer.PasteMeta("plain", 3).Name);
        Assert.Equal("abc.md", Composer.PasteMeta("# a/b:c*?\nx").Name);
        Assert.Equal("code", Composer.PasteMeta("function a () {\n  return 1;\n}\nconst b = 2;").Kind);
    }

    [Fact]
    public void ContinueList_NumberBulletsAndEnding()
    {
        var res1 = Composer.ContinueList("Steps:\n1. buy milk");
        Assert.NotNull(res1);
        Assert.Equal("Steps:\n1. buy milk\n2. ", res1.Value);
        Assert.Equal(22, res1.Caret);
        Assert.False(res1.Ended);

        var res2 = Composer.ContinueList("9) nine");
        Assert.NotNull(res2);
        Assert.Equal("9) nine\n10) ", res2.Value);

        var res3 = Composer.ContinueList("  - nested");
        Assert.NotNull(res3);
        Assert.Equal("  - nested\n  - ", res3.Value);

        var res4 = Composer.ContinueList("• dot");
        Assert.NotNull(res4);
        Assert.Equal("• dot\n• ", res4.Value);

        var res5 = Composer.ContinueList("a) first");
        Assert.NotNull(res5);
        Assert.Equal("a) first\nb) ", res5.Value);

        var endRes = Composer.ContinueList("1. a\n2. ");
        Assert.NotNull(endRes);
        Assert.Equal("1. a\n", endRes.Value);
        Assert.Equal(5, endRes.Caret);
        Assert.True(endRes.Ended);

        Assert.Null(Composer.ContinueList("just text"));
        Assert.Null(Composer.ContinueList("2026. was a year"));
        Assert.Null(Composer.ContinueList("1.5 litres"));

        var midRes = Composer.ContinueList("1. one\n2. two", 6);
        Assert.NotNull(midRes);
        Assert.Equal("1. one\n2. \n2. two", midRes.Value);
    }

    [Fact]
    public void ActivityView_EmptyAndInactive()
    {
        const long now = 1_000_000;
        Assert.Null(Composer.ActivityView([]));
        Assert.Null(Composer.ActivityView(null));

        var inactive = Composer.ActivityView([
            new("me"),
            new("work", Text: "$ npm test", Status: "done", Ok: true, Started: 1)
        ], new Composer.ActivityOptions(Now: now));
        Assert.Null(inactive);
    }

    [Fact]
    public void ActivityView_ActiveTurnAndRunningStep()
    {
        const long now = 1_000_000;
        var items = new List<Composer.ComposerItem>
        {
            new("work", Text: "Reading old.py", Status: "done", Started: 1),
            new("me", Text: "fix it"),
            new("work", Text: "Reading cart.py", Status: "done", Ok: true, Started: now - 75_000, Who: "coder"),
            new("work", Text: "$ pytest -q\n3 passed", Status: "failed", Ok: false, Started: now - 60_000, Who: "coder"),
            new("work", Text: "$ npm run build", Status: "running", Started: now - 5_000, Who: "coder")
        };

        var v = Composer.ActivityView(items, new Composer.ActivityOptions(Now: now));
        Assert.NotNull(v);
        Assert.Equal("Running npm run build", v.Title);
        Assert.Equal("coder", v.Who);
        Assert.Equal(75_000, v.Elapsed);
        Assert.Equal(["done", "failed", "running"], v.Steps.Select(s => s.State));
        Assert.Equal("$ pytest -q", v.Steps[1].Text);
    }

    [Fact]
    public void ActivityView_ThinkingState()
    {
        const long now = 1_000_000;
        var thinking = Composer.ActivityView([
            new("me"),
            new("thinking", Who: "planner", Ts: now - 3000)
        ], new Composer.ActivityOptions(Now: now));

        Assert.NotNull(thinking);
        Assert.Equal("planner is thinking", thinking.Title);
    }

    [Fact]
    public void ActivityView_StepCapAndMoreCount()
    {
        const long now = 1_000_000;
        var list = new List<Composer.ComposerItem> { new("me") };
        for (int i = 0; i < 9; i++)
        {
            list.Add(new("work", Text: "step " + i, Status: i == 8 ? "running" : "done", Started: now - 1000));
        }

        var many = Composer.ActivityView(list, new Composer.ActivityOptions(Now: now));
        Assert.NotNull(many);
        Assert.Equal(6, many.Steps.Count);
        Assert.Equal(3, many.More);
    }

    [Fact]
    public void Clock_Formatting()
    {
        Assert.Equal("14m 36s", Composer.Clock(876_000));
        Assert.Equal("52s", Composer.Clock(52_400));
        Assert.Equal("1h 2m", Composer.Clock(3_725_000));
        Assert.Equal("0s", Composer.Clock(-5));
        Assert.Equal("0s", Composer.Clock(double.NaN));
    }

    [Fact]
    public void ConstantsCheck()
    {
        Assert.Equal(2500, Composer.BigPasteChars);
        Assert.Equal(40, Composer.BigPasteLines);
        Assert.Equal(6, Composer.DefaultMaxActivitySteps);
        Assert.Equal(2500, Composer.BigPaste.Chars);
        Assert.Equal(40, Composer.BigPaste.Lines);
    }
}
