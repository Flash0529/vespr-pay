using System.Text.Json;

namespace Vespr.Core.Tests;

// Fuzzy must give exactly the JavaScript answers recorded in native/golden/fuzzy.json.
public class FuzzyTests
{
    static double? Limit(JsonElement[] args)
    {
        if (args.Length < 4) return null;
        var a = args[3];
        if (a.ValueKind == JsonValueKind.Number) return a.GetDouble();
        if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty("$inf", out var inf)) return inf.GetInt32() > 0 ? double.PositiveInfinity : double.NegativeInfinity;
        if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty("$nan", out _)) return double.NaN;
        return null; // undefined
    }

    [Fact]
    public void Constants_match_javascript()
    {
        var c = Golden.Constants("fuzzy");
        Assert.Equal(Fuzzy.MaxText, c.GetProperty("MAX_TEXT").GetInt32());
        Assert.Equal(Fuzzy.MaxResults, c.GetProperty("MAX_RESULTS").GetInt32());
    }

    [Fact]
    public void Score_matches_javascript() =>
        Golden.Check("fuzzy", "score", c => Golden.Json(Fuzzy.Score(c.Args[0].GetString(), c.Args[1].GetString())));

    [Fact]
    public void Rank_matches_javascript() =>
        Golden.Check("fuzzy", "rank", c => Golden.Json(Fuzzy.Rank(c.Args[0].GetString(),
            c.Args[1].EnumerateArray().Select(x => x.GetString()!).ToList(), null, Limit(c.Args))));

    [Fact]
    public void Highlight_matches_javascript() =>
        Golden.Check("fuzzy", "highlight", c => Golden.Json(Fuzzy.Highlight(c.Args[0].GetString(), c.Args[1].GetString())
            .Select(r => new[] { r.Start, r.End })));
}
