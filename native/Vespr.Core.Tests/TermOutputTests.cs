namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class TermOutputTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(1000, TermOutput.MaxTermLines);
        Assert.Equal(2000, TermOutput.MaxLineChars);
        Assert.Equal(50, TermOutput.MaxParsedErrors);
    }

    [Fact]
    public void StripAnsi_RemovesEscapeCodesAndNormalizesNewlines()
    {
        var colored = "\u001b[31mError:\u001b[0m test failed\r\nline 2\rline 3\0";
        var plain = TermOutput.StripAnsi(colored);
        Assert.Equal("Error: test failed\nline 2\nline 3", plain);
    }

    [Fact]
    public void AnsiToHtml_ConvertsAnsiColorCodesIntoSafeStyledHtmlSpans()
    {
        var redText = "\u001b[31mFAIL\u001b[0m: test failed";
        var html = TermOutput.AnsiToHtml(redText);
        Assert.Contains("<span style=\"color:var(--bad);\">FAIL</span>", html);
        Assert.Contains(": test failed", html);
    }

    [Fact]
    public void AnsiToHtml_EscapesEmbeddedHtmlTagsToPreventXss()
    {
        var injection = "\u001b[32m<script>alert(\"xss\")</script>\u001b[0m";
        var html = TermOutput.AnsiToHtml(injection);
        Assert.Contains("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;", html);
        Assert.DoesNotContain("<script>", html);
    }

    [Fact]
    public void ParseErrors_ExtractsPythonTracebackLocationAndMessage()
    {
        var output = "Traceback (most recent call last):\n" +
                     "  File \"cart.py\", line 12, in total\n" +
                     "    raise ValueError(\"negative price\")\n" +
                     "ValueError: negative price\n";
        var errs = TermOutput.ParseErrors(output);
        Assert.Single(errs);
        Assert.Equal("cart.py", errs[0].File);
        Assert.Equal(12, errs[0].Line);
        Assert.Equal("error", errs[0].Severity);
        Assert.Contains("ValueError: negative price", errs[0].Message);
    }

    [Fact]
    public void ParseErrors_ExtractsPythonUnitTestFailures()
    {
        var output = "FAIL: test_discount (test_cart.py:15)\nAssertionError: 90 != 10\n";
        var errs = TermOutput.ParseErrors(output);
        Assert.Single(errs);
        Assert.Equal("test_cart.py", errs[0].File);
        Assert.Equal(15, errs[0].Line);
        Assert.Equal("FAIL: test_discount", errs[0].Message);
    }

    [Fact]
    public void ParseErrors_ExtractsNodeStackLocations()
    {
        var output = "TypeError: Cannot read properties of null\n" +
                     "    at Object.calculate (app/cart.js:24:18)\n" +
                     "    at test (app/test/cart.test.mjs:10:5)\n";
        var errs = TermOutput.ParseErrors(output);
        Assert.NotEmpty(errs);
        Assert.Equal("app/cart.js", errs[0].File);
        Assert.Equal(24, errs[0].Line);
        Assert.Equal(18, errs[0].Col);
    }

    [Fact]
    public void ParseErrors_ExtractsStandardCompilerErrors()
    {
        var output = "src/native.c:42:10: error: use of undeclared identifier 'ptr'";
        var errs = TermOutput.ParseErrors(output);
        Assert.Single(errs);
        Assert.Equal("src/native.c", errs[0].File);
        Assert.Equal(42, errs[0].Line);
        Assert.Equal(10, errs[0].Col);
        Assert.Equal("error", errs[0].Severity);
        Assert.Contains("undeclared identifier", errs[0].Message);
    }

    [Fact]
    public void CreateTermBuffer_MaintainsRollingBufferWithinLimit()
    {
        var buf = TermOutput.CreateTermBuffer(new TermOutput.TermBufferOptions(MaxLines: 5));
        buf.Append("line 1\nline 2\nline 3");
        Assert.Equal(3, buf.Lines().Count);

        buf.Append("line 4\nline 5\nline 6\nline 7");
        Assert.Equal(5, buf.Lines().Count);
        Assert.Equal("line 3", buf.Lines()[0]);
        Assert.Equal("line 7", buf.Lines()[4]);
    }

    [Fact]
    public void CreateTermBuffer_TailReturnsLastNLines()
    {
        var buf = TermOutput.CreateTermBuffer(new TermOutput.TermBufferOptions(MaxLines: 20));
        buf.Append("a\nb\nc\nd\ne");
        Assert.Equal("d\ne", buf.Tail(2));
    }

    [Fact]
    public void CreateTermBuffer_SummaryProvidesTotalsAndErrorIndicators()
    {
        var buf = TermOutput.CreateTermBuffer();
        buf.Append("all green\nall ok");
        Assert.False(buf.Summary().HasErrors);

        buf.Append("FAIL: test_cart (test_cart.py:10)");
        Assert.True(buf.Summary().HasErrors);
        Assert.Equal(1, buf.Summary().ErrorCount);
    }

    [Fact]
    public void HostileInputImmunity_ForAllTermOutputFunctions()
    {
        Assert.Equal("", TermOutput.StripAnsi(null));
        Assert.Equal("", TermOutput.AnsiToHtml(null));
        Assert.Empty(TermOutput.ParseErrors(null));

        var buf = TermOutput.CreateTermBuffer(null);
        Assert.Equal(0, buf.Append(null));
        Assert.Equal(0, buf.Clear());
        Assert.Empty(buf.Lines());
    }
}
