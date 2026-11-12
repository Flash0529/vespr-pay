using System.Text.RegularExpressions;
using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class ChatRenderTests
{
    [Fact]
    public void Markdown_PlainTextAndEscaping()
    {
        Assert.Equal("<p>hello<br>world</p>", ChatRender.RenderMarkdown("hello\nworld"));
        Assert.Equal("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>", ChatRender.RenderMarkdown("<script>alert(1)</script>"));

        var unsafeInput = "<img src=x onerror=alert(1)> ![x](javascript:alert(1)) [a](javascript:alert(1))";
        var rendered = ChatRender.RenderMarkdown(unsafeInput);
        Assert.DoesNotMatch(new Regex(@"<img|<script|href=""javascript", RegexOptions.IgnoreCase), rendered);
        Assert.DoesNotMatch(new Regex(@"href=""javascript", RegexOptions.IgnoreCase), ChatRender.RenderMarkdown("[a](javascript:alert(1))"));
    }

    [Fact]
    public void Markdown_InlineFormatting()
    {
        Assert.Equal("<p>a <strong>bold</strong> and <em>it</em> and <code>x &lt; y</code> and <del>gone</del></p>",
            ChatRender.RenderMarkdown("a **bold** and *it* and `x < y` and ~~gone~~"));
        Assert.Equal("<p>snake_case_name and 2*3*4</p>",
            ChatRender.RenderMarkdown("snake_case_name and 2*3*4"));

        var link = ChatRender.RenderMarkdown("see [the docs](https://example.com/a?b=1&c=2) now");
        Assert.Matches(new Regex(@"<a href=""https://example\.com/a\?b=1&amp;c=2"" target=""_blank"" rel=""noopener noreferrer"">the docs</a>"), link);

        var autoUrl = ChatRender.RenderMarkdown("go to https://example.com/x.");
        Assert.Matches(new Regex(@"<a href=""https://example\.com/x""[^>]*>https://example\.com/x</a>\.</p>"), autoUrl);
    }

    [Fact]
    public void Markdown_CodeBlocks()
    {
        var c = ChatRender.RenderMarkdown("Here:\n```python\ndef f():\n    return \"**not bold**\"\n```\ndone");
        Assert.Matches(new Regex(@"<div class=""mdcode"">.*mdlang"">python<.*data-copy", RegexOptions.Singleline), c);
        Assert.DoesNotContain("<strong>", c);
        Assert.Matches(new Regex(@"<p>Here:</p>.*<p>done</p>", RegexOptions.Singleline), c);

        var unclosed = ChatRender.RenderMarkdown("```js\nlet a = 1");
        Assert.Matches(new Regex(@"mdcode.*let a = 1", RegexOptions.Singleline), unclosed);

        var highlighted = ChatRender.RenderMarkdown("```x\n1\n```", new ChatRender.MarkdownHooks(
            Highlight: (lang, body) => "<span class=\"k\">HL</span>"
        ));
        Assert.Contains("<code><span class=\"k\">HL</span></code>", highlighted);

        var escapedCode = ChatRender.RenderMarkdown("```\n<b>x</b>\n```");
        Assert.Contains("&lt;b&gt;x&lt;/b&gt;", escapedCode);
    }

    [Fact]
    public void Markdown_LinkAttrs()
    {
        var hooks = new ChatRender.MarkdownHooks(
            LinkAttrs: u => u.Contains("/preview/") ? " data-preview=\"1\"" : ""
        );
        var preview = ChatRender.RenderMarkdown("see https://x.example/preview/0123456789abcdef01234567/ now", hooks);
        Assert.Matches(new Regex(@"<a href=""https://x\.example/preview/0123456789abcdef01234567/"" target=""_blank"" rel=""noopener noreferrer"" data-preview=""1"">"), preview);

        var named = ChatRender.RenderMarkdown("[app](https://x.example/preview/0123456789abcdef01234567/)", hooks);
        Assert.Contains("data-preview=\"1\">app</a>", named);

        var plain = ChatRender.RenderMarkdown("[a](https://e.com)", hooks);
        Assert.DoesNotContain("data-preview", plain);
    }

    [Fact]
    public void Markdown_HeadingsRulesQuotes()
    {
        var headings = ChatRender.RenderMarkdown("# One\n## Two");
        Assert.Matches(new Regex(@"<h3 class=""mdh"">One</h3><h4 class=""mdh"">Two</h4>"), headings);

        Assert.Equal("<hr>", ChatRender.RenderMarkdown("---"));
        Assert.Equal("<blockquote>a<br>b</blockquote>", ChatRender.RenderMarkdown("> a\n> b"));
    }

    [Fact]
    public void Markdown_Lists()
    {
        Assert.Equal("<ul><li>a</li><li>b</li></ul>", ChatRender.RenderMarkdown("- a\n- b"));
        Assert.Equal("<ol><li>a</li><li>b</li></ol>", ChatRender.RenderMarkdown("1. a\n2. b"));
        Assert.Equal("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>", ChatRender.RenderMarkdown("- a\n  - b\n- c"));
        Assert.Equal("<p>Steps:</p><ul><li>a</li><li>b</li></ul><p>After</p>", ChatRender.RenderMarkdown("Steps:\n- a\n- b\n\nAfter"));
    }

    [Fact]
    public void Markdown_Tables()
    {
        var t = ChatRender.RenderMarkdown("| Name | Qty |\n|---|--:|\n| apple | 3 |\n| pear | 10 |");
        Assert.Matches(new Regex(@"<th>Name</th><th style=""text-align:right"">Qty</th>"), t);
        Assert.Matches(new Regex(@"<td>apple</td><td style=""text-align:right"">3</td>"), t);
        Assert.Matches(new Regex(@"<td>pear</td>"), t);
        Assert.DoesNotContain("<table", ChatRender.RenderMarkdown("a | b\nnot a table"));
    }

    [Fact]
    public void Markdown_Markers()
    {
        var seen = new List<(string Kind, string Arg, string Opt)>();
        var hooks = new ChatRender.MarkdownHooks(
            Marker: (k, a, o) =>
            {
                seen.Add((k, a, o));
                return k == "file" ? $"<span class=\"filechip\">{ChatRender.Esc(a)}</span>" : $"<div class=\"fcard\">{ChatRender.Esc(a)}</div>";
            },
            Attached: a => $"<div class=\"fcard\">{ChatRender.Esc(a.Name)}</div>"
        );

        Assert.Equal("<p>Open <span class=\"filechip\">cart.py</span> first</p>", ChatRender.RenderMarkdown("Open {{file:cart.py}} first", hooks));
        Assert.Equal("<div class=\"fcard\">report.pdf</div>", ChatRender.RenderMarkdown("{{card:report.pdf}}", hooks));

        var img = ChatRender.RenderMarkdown("Result:\n\n{{image:chart.png|big}}\n\nMore", hooks).Replace("<p>", "|").Replace("</p>", "|");
        Assert.Equal("|Result:|<div class=\"fcard\">chart.png</div>|More|", img);
        Assert.Equal(("image", "chart.png", "big"), seen[^1]);

        Assert.Equal("<div class=\"fcard\">a.png</div>", ChatRender.RenderMarkdown("[attached: a.png 2048 id=0123456789abcdef]", hooks));
        Assert.Equal("<p>{{nope:x}}</p>", ChatRender.RenderMarkdown("{{nope:x}}"));
        Assert.DoesNotContain("<b>", ChatRender.RenderMarkdown("{{file:<b>x</b>}}"));
        Assert.DoesNotContain("\u0000", ChatRender.RenderMarkdown("a\u00000\u0000b", hooks), StringComparison.Ordinal);
    }

    [Fact]
    public void WorkBoxes_GroupingAndSummaries()
    {
        var step1 = new ChatRender.WorkStep("s1", "$ make", 1, Ok: true, Detail: "built <ok>", Started: 0, Ended: 2000);
        var step2 = new ChatRender.WorkStep("s2", "read a", 2, Ok: true);

        var list = new List<ChatRender.WorkStep>
        {
            new("1", "$ make", 1),
            new("2", "$ npm test", 2),
            new("3", "read cart.py", 3),
            new("4", "edited app/a.js", 4),
            new("5", "edited app/b.js", 5),
            new("6", "edited app/c.js", 6),
            new("7", "something failed", 7, Ok: false)
        };

        var summary = ChatRender.SummarizeWork(list);
        Assert.Equal("Ran 2 commands, read cart.py, edited 3 files, 1 other step, 1 failed", summary);

        var group = new ChatRender.WorkGroup("o", [step1, step2], Live: false);
        var shut = ChatRender.WorkBox(group, new ChatRender.WorkBoxOptions(OpenSteps: new HashSet<string>(), Now: 5000));
        Assert.Matches(new Regex(@"data-step=""s1""><button class=""wsr"" data-step-toggle aria-expanded=""false"">"), shut);
        Assert.DoesNotContain("<pre>", shut);
        Assert.DoesNotMatch(new Regex(@"data-step=""s2"""), shut);

        var opened = ChatRender.WorkBox(group, new ChatRender.WorkBoxOptions(OpenSteps: new HashSet<string> { "s1" }, Now: 5000));
        Assert.Matches(new Regex(@"data-step=""s1"" data-open=""1""><button class=""wsr"" data-step-toggle aria-expanded=""true"">"), opened);
        Assert.Matches(new Regex(@"<pre>built &lt;ok&gt;</pre>"), opened);

        var defaultOpen = ChatRender.WorkBox(group, new ChatRender.WorkBoxOptions(Now: 5000));
        Assert.Matches(new Regex(@"<pre>built &lt;ok&gt;</pre>"), defaultOpen);
    }

    [Fact]
    public void WorkBoxes_DurationsAndIcons()
    {
        Assert.Equal("<1s", ChatRender.FormatDuration(500));
        Assert.Equal("12s", ChatRender.FormatDuration(12000));
        Assert.Equal("1m 05s", ChatRender.FormatDuration(65000));
        Assert.Equal("2h 03m", ChatRender.FormatDuration(7380000));
        Assert.Equal("", ChatRender.FormatDuration(-1));
        Assert.Equal("", ChatRender.FormatDuration(double.NaN));

        Assert.Equal("term", ChatRender.StepIcon("$ cargo build"));
        Assert.Equal("eye", ChatRender.StepIcon("read main.rs"));
        Assert.Equal("edit", ChatRender.StepIcon("edited main.rs"));
        Assert.Equal("search", ChatRender.StepIcon("search for errors"));
        Assert.Equal("alert", ChatRender.StepIcon("anything", ok: false));
        Assert.Equal("check", ChatRender.StepIcon("done"));
    }

    [Fact]
    public void Checklist_PlanViewAndBox()
    {
        var plan = new ChatRender.PlanData(
        [
            new("Read the code", "done"),
            new("Fix  it\n", "in_progress"),
            new("Test", "weird"),
            new("", "pending"),
            null!
        ]);

        var pv = ChatRender.PlanView(plan);
        Assert.Equal(3, pv.Total);
        Assert.Equal(1, pv.Done);
        Assert.Equal("Fix it", pv.Current);
        Assert.False(pv.Finished);
        Assert.Equal("done", pv.Steps[0].Status);
        Assert.Equal("in_progress", pv.Steps[1].Status);
        Assert.Equal("pending", pv.Steps[2].Status);

        Assert.Equal(0, ChatRender.PlanView(null).Total);
        Assert.Equal("", ChatRender.PlanBox(null));

        var pb = ChatRender.PlanBox(new ChatRender.PlanData(
        [
            new("Read <b>x</b>", "done"),
            new("Fix", "in_progress"),
            new("Test", "pending")
        ]), ic: n => $"<i>{n}</i>", who: "co<der");

        Assert.Matches(new Regex(@"<div class=""planbox"" data-plan=""co&lt;der""><div class=""ph""><span class=""pw"">co&lt;der's plan</span><span class=""pn"">1/3</span></div>"), pb);
        Assert.Matches(new Regex(@"<li class=""pst done""><span class=""psi"" role=""img"" aria-label=""done""><i>check</i></span><span class=""pt"">Read &lt;b&gt;x&lt;/b&gt;</span></li>"), pb);
        Assert.Matches(new Regex(@"<li class=""pst in_progress""><span class=""psi"" role=""img"" aria-label=""in progress""><span class=""wsp sm"""), pb);
        Assert.Matches(new Regex(@"aria-label=""not started""></span><span class=""pt"">Test"), pb);

        var finished = ChatRender.PlanBox(new ChatRender.PlanData([new("a", "done")]));
        Assert.Matches(new Regex(@"class=""planbox done"""), finished);
    }

    [Fact]
    public void FileKindsAndHumanSizes()
    {
        Assert.Equal("image", ChatRender.FileKind("a.PNG"));
        Assert.Equal("svg", ChatRender.FileKind("a.svg"));
        Assert.Equal("image", ChatRender.FileKind("x", "image/jpeg"));
        Assert.Equal("3d", ChatRender.FileKind("m.glb"));
        Assert.Equal("file", ChatRender.FileKind("thing"));

        Assert.Equal("1 B", ChatRender.HumanSize(0));
        Assert.Equal("2 KB", ChatRender.HumanSize(2048));
        Assert.Equal("1.5 MB", ChatRender.HumanSize(1572864));
    }

    [Fact]
    public void LimitsAndUsage()
    {
        var mine = ChatRender.LimitCard(new ChatRender.LimitInfo("L1", "coder", "Usage limit reached", "Get more usage to keep working"), ic: n => $"<i data-ic=\"{n}\"></i>", mine: true);
        Assert.Matches(new Regex(@"class=""limitcard"""), mine);
        Assert.Matches(new Regex(@"<b>Usage limit reached</b>"), mine);
        Assert.Matches(new Regex(@"Get more usage to keep working"), mine);
        Assert.Matches(new Regex(@"data-billing=""buy"">Get more usage<"), mine);
        Assert.Matches(new Regex(@"data-billing=""usage"">Open usage settings<"), mine);
        Assert.Matches(new Regex(@"data-ic=""clock"""), mine);
        Assert.DoesNotMatch(new Regex(@"Resets at"), mine);

        var other = ChatRender.LimitCard(new ChatRender.LimitInfo(Who: "coder"), mine: false);
        Assert.DoesNotMatch(new Regex(@"data-billing"), other);
        Assert.Matches(new Regex(@"coder paused: the person who asked is out of usage"), other);

        var resetsCard = ChatRender.LimitCard(new ChatRender.LimitInfo(Resets: 1793890800000.0), mine: true);
        Assert.Matches(new Regex(@" · Resets at \d{1,2}:00 (AM|PM)"), resetsCard);

        var evil = ChatRender.LimitCard(new ChatRender.LimitInfo(Title: "<img src=x onerror=alert(1)>", Detail: "\"><script>", Who: "<b>"), mine: true)
                 + ChatRender.LimitCard(new ChatRender.LimitInfo(Who: "<b>x"), mine: false);
        Assert.DoesNotMatch(new Regex(@"<img|<script|<b>x"), evil);

        Assert.Equal("$20.00", ChatRender.Money(20));
        Assert.Equal("-$0.01", ChatRender.Money(-0.015));
        Assert.Equal("$0.00", ChatRender.Money(double.NaN));

        var panel = ChatRender.UsagePanel(new ChatRender.UserInfo(
            BalanceUsd: 1.5,
            SpentUsd: 18.5,
            Packs: [new("credit-10", 10), new("credit-20", 20)]
        ));
        Assert.Matches(new Regex(@"Balance <b>\$1\.50</b>"), panel);
        Assert.Matches(new Regex(@"Used <b>\$18\.50</b>"), panel);
        Assert.Matches(new Regex(@"data-pack=""credit-10"">Add \$10\.00<"), panel);
        Assert.DoesNotContain("data-pack", ChatRender.UsagePanel(null));
        Assert.DoesNotMatch(new Regex("\"><x"), ChatRender.UsagePanel(new ChatRender.UserInfo(Packs: [new("\"><x", 1)])));
    }

    [Fact]
    public void ConstantsCheck()
    {
        Assert.Equal(200_000, ChatRender.MaxMarkdownLen);
        Assert.Equal(20, ChatRender.MaxPlanItems);
        Assert.Equal(160, ChatRender.MaxPlanTextLen);
        Assert.Equal(45_000, ChatRender.DefaultLiveMs);
    }
}
