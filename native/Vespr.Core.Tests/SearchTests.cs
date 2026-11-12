namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class SearchTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(1000000, Search.MaxDocChars);
        Assert.Equal(500, Search.MaxQueryLen);
        Assert.Equal(1000, Search.MaxMatches);
    }

    [Fact]
    public void EscapeRegExp_EscapesSpecialCharacters()
    {
        var special = ".*+?^${}()|[]\\";
        var escaped = Search.EscapeRegExp(special);
        Assert.Equal(@"\.\*\+\?\^\$\{\}\(\)\|\[\]\\", escaped);
        Assert.Equal("", Search.EscapeRegExp(null));
    }

    [Fact]
    public void BuildRegex_CompilesValidRegexAndHandlesInvalidPatternsSafely()
    {
        var rx1 = Search.BuildRegex("test", new Search.SearchOptions(CaseSensitive: true));
        Assert.NotNull(rx1);
        Assert.False(rx1.Options.HasFlag(System.Text.RegularExpressions.RegexOptions.IgnoreCase));

        var rx2 = Search.BuildRegex("test", new Search.SearchOptions(CaseSensitive: false));
        Assert.NotNull(rx2);
        Assert.True(rx2.Options.HasFlag(System.Text.RegularExpressions.RegexOptions.IgnoreCase));

        var rx3 = Search.BuildRegex("item", new Search.SearchOptions(WholeWord: true));
        Assert.NotNull(rx3);
        Assert.Matches(rx3, "an item here");
        Assert.DoesNotMatch(rx3, "an itemize here");

        // Malformed regex should return null without throwing
        var rxInvalid = Search.BuildRegex("[unclosed", new Search.SearchOptions(Regex: true));
        Assert.Null(rxInvalid);
    }

    [Fact]
    public void FindMatches_LocatesPlainTextOccurrencesWithLineAndColCoordinates()
    {
        var doc = "alpha beta\nbeta gamma\nDELTA";
        var matches = Search.FindMatches(doc, "beta");
        Assert.Equal(2, matches.Count);

        Assert.Equal(6, matches[0].Index);
        Assert.Equal(1, matches[0].Line);
        Assert.Equal(7, matches[0].Col);
        Assert.Equal(4, matches[0].Length);

        Assert.Equal(11, matches[1].Index);
        Assert.Equal(2, matches[1].Line);
        Assert.Equal(1, matches[1].Col);
    }

    [Fact]
    public void FindMatches_RespectsCaseSensitiveOption()
    {
        var doc = "Apple apple APPLE";
        var caseInsensitive = Search.FindMatches(doc, "apple");
        Assert.Equal(3, caseInsensitive.Count);

        var caseSensitive = Search.FindMatches(doc, "apple", new Search.SearchOptions(CaseSensitive: true));
        Assert.Single(caseSensitive);
        Assert.Equal("apple", caseSensitive[0].Text);
    }

    [Fact]
    public void FindMatches_RespectsWholeWordOption()
    {
        var doc = "cat catalog bobcat cat";
        var matches = Search.FindMatches(doc, "cat", new Search.SearchOptions(WholeWord: true));
        Assert.Equal(2, matches.Count);
        Assert.Equal(0, matches[0].Index);
        Assert.Equal(19, matches[1].Index);
    }

    [Fact]
    public void FindMatches_SupportsRegularExpressions()
    {
        var doc = "first: 100, second: 250, third: 99";
        var matches = Search.FindMatches(doc, @"\d+", new Search.SearchOptions(Regex: true));
        Assert.Equal(3, matches.Count);
        Assert.Equal("100", matches[0].Text);
        Assert.Equal("250", matches[1].Text);
        Assert.Equal("99", matches[2].Text);
    }

    [Fact]
    public void ReplaceOne_ReplacesMatchAtSpecifiedRange()
    {
        var doc = "hello world, hello universe";
        var match = new Search.MatchRange(0, 5);
        var res = Search.ReplaceOne(doc, match, "greetings");
        Assert.Equal("greetings world, hello universe", res);
    }

    [Fact]
    public void ReplaceAll_ReplacesAllMatchesAndCountsOccurrences()
    {
        var doc = "foo bar foo baz foo";
        var res = Search.ReplaceAll(doc, "foo", "qux");
        Assert.Equal("qux bar qux baz qux", res.Text);
        Assert.Equal(3, res.Count);
    }

    [Fact]
    public void ReplaceAll_HandlesDollarSignsInReplacementLiterally()
    {
        var doc = "price: old";
        var res = Search.ReplaceAll(doc, "old", "$100");
        Assert.Equal("price: $100", res.Text);
    }

    [Fact]
    public void NextMatchAndPrevMatch_NavigateWithWrapAround()
    {
        var matches = new List<Search.SearchMatch>
        {
            new Search.SearchMatch(10, 1, 1, 1, ""),
            new Search.SearchMatch(50, 1, 1, 1, ""),
            new Search.SearchMatch(100, 1, 1, 1, "")
        };

        Assert.Equal(0, Search.NextMatch(matches, 0));
        Assert.Equal(1, Search.NextMatch(matches, 10));
        Assert.Equal(2, Search.NextMatch(matches, 50));
        Assert.Equal(0, Search.NextMatch(matches, 100)); // wrap to start

        Assert.Equal(2, Search.PrevMatch(matches, 150));
        Assert.Equal(1, Search.PrevMatch(matches, 100));
        Assert.Equal(0, Search.PrevMatch(matches, 50));
        Assert.Equal(2, Search.PrevMatch(matches, 10)); // wrap to end
    }

    [Fact]
    public void FormatMatchCount_FormatsStatusBadge()
    {
        Assert.Equal("1 of 5", Search.FormatMatchCount(0, 5));
        Assert.Equal("5 of 5", Search.FormatMatchCount(4, 5));
        Assert.Equal("0 of 5", Search.FormatMatchCount(-1, 5));
        Assert.Equal("No results", Search.FormatMatchCount(0, 0));
        Assert.Equal("No results", Search.FormatMatchCount(null, null));
    }

    [Fact]
    public void HostileInputImmunity_ForAllSearchFunctions()
    {
        Assert.Empty(Search.FindMatches(null, null));
        Assert.Empty(Search.FindMatches("test", ""));
        Assert.Equal("", Search.ReplaceOne(null, null, null));

        var repAll = Search.ReplaceAll(null, null, null);
        Assert.Equal("", repAll.Text);
        Assert.Equal(0, repAll.Count);

        Assert.Equal(-1, Search.NextMatch(null, 0));
        Assert.Equal(-1, Search.PrevMatch(new List<Search.SearchMatch>(), 0));
    }
}
