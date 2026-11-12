namespace Vespr.Core.Tests;

public class HighlightTests
{
    [Fact]
    public void Constants_exist_and_have_expected_bounds()
    {
        Assert.Equal(100000, HighlightHelper.MaxCodeLen);
        Assert.Equal(2000, HighlightHelper.MaxLineLen);
    }

    [Fact]
    public void EscapeHtml_encodes_special_HTML_characters_to_prevent_XSS()
    {
        Assert.Equal("&lt;script&gt;alert(&quot;test&quot;) &amp; &#39;x&#39;&lt;/script&gt;", HighlightHelper.EscapeHtml("<script>alert(\"test\") & 'x'</script>"));
        Assert.Equal("", HighlightHelper.EscapeHtml(null));
        Assert.Equal("", HighlightHelper.EscapeHtml(""));
    }

    [Fact]
    public void IsKeyword_recognizes_language_keywords()
    {
        Assert.True(HighlightHelper.IsKeyword("def"));
        Assert.True(HighlightHelper.IsKeyword("return"));
        Assert.True(HighlightHelper.IsKeyword("const"));
        Assert.True(HighlightHelper.IsKeyword("async"));
        Assert.True(HighlightHelper.IsKeyword("interface"));
        Assert.False(HighlightHelper.IsKeyword("myVariable"));
        Assert.False(HighlightHelper.IsKeyword(null));
    }

    [Fact]
    public void Tokenize_extracts_comments_accurately()
    {
        var pyTokens = HighlightHelper.Tokenize("# Python comment\nx = 10");
        Assert.Equal("comment", pyTokens[0].Type);
        Assert.Equal("# Python comment", pyTokens[0].Text);

        var jsTokens = HighlightHelper.Tokenize("let a = 1 // JS comment");
        var commentTok = jsTokens.Find(t => t.Type == "comment");
        Assert.NotNull(commentTok);
        Assert.Equal("// JS comment", commentTok.Text);
    }

    [Fact]
    public void Tokenize_extracts_string_literals_across_quote_styles()
    {
        var tokens = HighlightHelper.Tokenize("const s1 = \"double\"; const s2 = 'single'; const s3 = `backtick`");
        var strings = tokens.FindAll(t => t.Type == "string");
        Assert.Equal(3, strings.Count);
        Assert.Equal("\"double\"", strings[0].Text);
        Assert.Equal("'single'", strings[1].Text);
        Assert.Equal("`backtick`", strings[2].Text);
    }

    [Fact]
    public void Tokenize_extracts_integers_and_decimal_numbers()
    {
        var tokens = HighlightHelper.Tokenize("x = 42; y = 3.1415");
        var nums = tokens.FindAll(t => t.Type == "number");
        Assert.Equal(2, nums.Count);
        Assert.Equal("42", nums[0].Text);
        Assert.Equal("3.1415", nums[1].Text);
    }

    [Fact]
    public void Tokenize_distinguishes_identifiers_with_digits_from_raw_numbers()
    {
        var tokens = HighlightHelper.Tokenize("const item1 = 100");
        var nums = tokens.FindAll(t => t.Type == "number");
        Assert.Single(nums);
        Assert.Equal("100", nums[0].Text);

        var idTok = tokens.Find(t => t.Text == "item1");
        Assert.NotNull(idTok);
        Assert.Equal("text", idTok.Type);
    }

    [Fact]
    public void Tokenize_identifies_function_definitions_and_function_calls()
    {
        var defTokens = HighlightHelper.Tokenize("def calculate_total(items):");
        var fnTok = defTokens.Find(t => t.Type == "function");
        Assert.NotNull(fnTok);
        Assert.Equal("calculate_total", fnTok.Text);

        var callTokens = HighlightHelper.Tokenize("const res = print(message)");
        var callTok = callTokens.Find(t => t.Type == "function");
        Assert.NotNull(callTok);
        Assert.Equal("print", callTok.Text);
    }

    [Fact]
    public void Highlight_renders_HTML_spans_matching_CSS_rules()
    {
        var code = "def total():\n    return 42";
        var html = HighlightHelper.Highlight(code);
        Assert.Contains("<span class=\"k\">def</span>", html);
        Assert.Contains("<span class=\"f\">total</span>", html);
        Assert.Contains("<span class=\"k\">return</span>", html);
        Assert.Contains("<span class=\"n\">42</span>", html);
    }

    [Fact]
    public void Highlight_escapes_HTML_embedded_within_string_literals()
    {
        var code = "const tag = \"<div>hello</div>\"";
        var html = HighlightHelper.Highlight(code);
        Assert.Contains("<span class=\"s\">&quot;&lt;div&gt;hello&lt;/div&gt;&quot;</span>", html);
        Assert.DoesNotContain("<div>", html);
    }

    [Fact]
    public void HighlightLines_splits_and_highlights_individual_lines()
    {
        var code = "line1 = 10\nline2 = 20\nline3 = 30";
        var lines = HighlightHelper.HighlightLines(code);
        Assert.Equal(3, lines.Count);
        Assert.Contains("<span class=\"n\">10</span>", lines[0]);
        Assert.Contains("<span class=\"n\">20</span>", lines[1]);
        Assert.Contains("<span class=\"n\">30</span>", lines[2]);
    }

    [Fact]
    public void Hostile_input_immunity_for_all_highlight_functions()
    {
        Assert.Equal("", HighlightHelper.Highlight(null));
        Assert.Equal("", HighlightHelper.Highlight(""));
        Assert.Empty(HighlightHelper.Tokenize(null));
        Assert.Empty(HighlightHelper.HighlightLines(null));
    }
}
