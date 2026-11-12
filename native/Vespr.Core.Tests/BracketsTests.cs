namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class BracketsTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(200000, Brackets.MaxScanLen);
        Assert.Equal(')', Brackets.OpenBrackets['(']);
        Assert.Equal(']', Brackets.OpenBrackets['[']);
        Assert.Equal('}', Brackets.OpenBrackets['{']);
        Assert.Equal('(', Brackets.CloseBrackets[')']);
        Assert.Equal('[', Brackets.CloseBrackets[']']);
        Assert.Equal('{', Brackets.CloseBrackets['}']);
        Assert.Equal(')', Brackets.AutoClosePairs['(']);
        Assert.Equal('"', Brackets.AutoClosePairs['"']);
    }

    [Fact]
    public void IsBracket_IdentifiesBracketsAndRejectsNonBrackets()
    {
        Assert.True(Brackets.IsBracket('('));
        Assert.True(Brackets.IsBracket(')'));
        Assert.True(Brackets.IsBracket('['));
        Assert.True(Brackets.IsBracket(']'));
        Assert.True(Brackets.IsBracket('{'));
        Assert.True(Brackets.IsBracket('}'));
        Assert.False(Brackets.IsBracket('a'));
        Assert.False(Brackets.IsBracket(null));
    }

    [Fact]
    public void GetAutoCloseChar_RetrievesAutoClosePairCounterparts()
    {
        Assert.Equal(')', Brackets.GetAutoCloseChar('('));
        Assert.Equal(']', Brackets.GetAutoCloseChar('['));
        Assert.Equal('}', Brackets.GetAutoCloseChar('{'));
        Assert.Equal('"', Brackets.GetAutoCloseChar('"'));
        Assert.Equal('\'', Brackets.GetAutoCloseChar('\''));
        Assert.Equal('`', Brackets.GetAutoCloseChar('`'));
        Assert.Null(Brackets.GetAutoCloseChar(')'));
        Assert.Null(Brackets.GetAutoCloseChar('x'));
    }

    [Fact]
    public void WrapWithPair_WrapsSelectedTextWithMatchingPair()
    {
        Assert.Equal("(hello)", Brackets.WrapWithPair("hello", '('));
        Assert.Equal("[items]", Brackets.WrapWithPair("items", '['));
        Assert.Equal("{foo}", Brackets.WrapWithPair("foo", '{'));
        Assert.Equal("\"text\"", Brackets.WrapWithPair("text", '"'));
        Assert.Equal("plain", Brackets.WrapWithPair("plain", 'x'));
        Assert.Equal("()", Brackets.WrapWithPair(null, '('));
    }

    [Fact]
    public void FindMatchingBracket_Forward_FindsMatchingClosingBracket()
    {
        var code = "function test(a, b) { if (a > 0) { return [a, b]; } }";
        // '(' at index 13: test(
        var m1 = Brackets.FindMatchingBracket(code, 13);
        Assert.NotNull(m1);
        Assert.Equal(13, m1.OpenOffset);
        Assert.Equal(18, m1.CloseOffset);
        Assert.Equal("()", m1.Pair);

        // '{' at index 20
        var m2 = Brackets.FindMatchingBracket(code, 20);
        Assert.NotNull(m2);
        Assert.Equal(20, m2.OpenOffset);
        Assert.Equal(code.Length - 1, m2.CloseOffset);
        Assert.Equal("{}", m2.Pair);
    }

    [Fact]
    public void FindMatchingBracket_Backward_FindsMatchingOpeningBracket()
    {
        var code = "const arr = [1, [2, 3], 4];";
        // Outer closing bracket ']' at index 25
        var mOuter = Brackets.FindMatchingBracket(code, 25);
        Assert.NotNull(mOuter);
        Assert.Equal(12, mOuter.OpenOffset);
        Assert.Equal(25, mOuter.CloseOffset);
        Assert.Equal("[]", mOuter.Pair);

        // Inner closing bracket ']' at index 21
        var mInner = Brackets.FindMatchingBracket(code, 21);
        Assert.NotNull(mInner);
        Assert.Equal(16, mInner.OpenOffset);
        Assert.Equal(21, mInner.CloseOffset);
    }

    [Fact]
    public void FindMatchingBracket_StringAndCommentSkipping()
    {
        var code = "const s = \"{ not a bracket }\"; // [comment]\nconst x = { ok: 1 };";
        var openBrace = code.IndexOf("{ ok", StringComparison.Ordinal);
        var m = Brackets.FindMatchingBracket(code, openBrace);
        Assert.NotNull(m);
        Assert.Equal(openBrace, m.OpenOffset);
        Assert.Equal(code.IndexOf("};", StringComparison.Ordinal), m.CloseOffset);
    }

    [Fact]
    public void FindMatchingBracket_OffsetTolerance_MatchesWhenCursorDirectlyAfter()
    {
        var code = "foo()";
        // Offset 4 is right after ')'
        var m = Brackets.FindMatchingBracket(code, 4);
        Assert.NotNull(m);
        Assert.Equal(3, m.OpenOffset);
        Assert.Equal(4, m.CloseOffset);
    }

    [Fact]
    public void CheckBalance_OnValidCode_ReturnsBalancedTrue()
    {
        var code = @"
    function sum(items) {
      let total = 0;
      for (const x of items) {
        total += x;
      }
      return [total];
    }
";
        var res = Brackets.CheckBalance(code);
        Assert.True(res.Balanced);
        Assert.Empty(res.Issues);
    }

    [Fact]
    public void CheckBalance_OnUnexpectedClosingBracket_DetectsAccurateLineAndCol()
    {
        var code = "function test() }\n";
        var res = Brackets.CheckBalance(code);
        Assert.False(res.Balanced);
        Assert.Single(res.Issues);
        Assert.Equal('}', res.Issues[0].Found);
        Assert.Null(res.Issues[0].Expected);
        Assert.Equal(1, res.Issues[0].Line);
        Assert.Equal(17, res.Issues[0].Col);
    }

    [Fact]
    public void CheckBalance_OnMismatchedClosingBracket()
    {
        var code = "const data = { items: [1, 2} ];";
        var res = Brackets.CheckBalance(code);
        Assert.False(res.Balanced);
        Assert.NotEmpty(res.Issues);
        var mismatch = res.Issues.FirstOrDefault(i => i.Found == '}');
        Assert.NotNull(mismatch);
        Assert.Equal(']', mismatch.Expected);
    }

    [Fact]
    public void CheckBalance_OnUnclosedOpeningBrackets()
    {
        var code = "function unclosed() {\n  const x = [1, 2;\n";
        var res = Brackets.CheckBalance(code);
        Assert.False(res.Balanced);
        Assert.Equal(2, res.Issues.Count);
        Assert.Contains(res.Issues, i => i.Expected == ']');
        Assert.Contains(res.Issues, i => i.Expected == '}');
    }
}
