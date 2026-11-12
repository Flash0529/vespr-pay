namespace Vespr.Core.Tests;

public class DiffsTests
{
    [Fact]
    public void Constants_exist_and_have_expected_bounds()
    {
        Assert.Equal(1000, Diffs.MaxLines);
        Assert.Equal(1000, Diffs.MaxLineLen);
        Assert.Equal(500000, Diffs.MaxDiffBytes);
    }

    [Fact]
    public void SplitLines_normalizes_line_endings_and_handles_null_bytes()
    {
        var text = "line 1\r\nline 2\rline 3\nline \04";
        var lines = Diffs.SplitLines(text);
        Assert.Equal(4, lines.Count);
        Assert.Equal("line 1", lines[0]);
        Assert.Equal("line 2", lines[1]);
        Assert.Equal("line 3", lines[2]);
        Assert.Equal("line 4", lines[3]);
    }

    [Fact]
    public void DiffLines_returns_eq_operations_for_identical_text()
    {
        var text = "alpha\nbeta\ngamma";
        var diff = Diffs.DiffLines(text, text);
        Assert.Equal(3, diff.Count);
        Assert.All(diff, d => Assert.Equal("eq", d.Type));
        Assert.Equal(1, diff[0].OldLine);
        Assert.Equal(1, diff[0].NewLine);
        Assert.Equal(3, diff[2].OldLine);
        Assert.Equal(3, diff[2].NewLine);
    }

    [Fact]
    public void DiffLines_detects_additions_and_deletions_accurately()
    {
        var oldText = "def total():\n    return 0\n";
        var newText = "def total():\n    # calculate price\n    return 100\n";

        var diff = Diffs.DiffLines(oldText, newText);
        var s = Diffs.Summary(diff);
        Assert.Equal(2, s.Additions);
        Assert.Equal(1, s.Deletions);
    }

    [Fact]
    public void DiffLines_tracks_correct_1_based_line_numbers()
    {
        var oldText = "a\nb\nc";
        var newText = "a\nx\nc";

        var diff = Diffs.DiffLines(oldText, newText);
        Assert.Equal(4, diff.Count);
        Assert.Equal(new Diffs.DiffItem("eq", "a", 1, 1), diff[0]);
        Assert.Equal(new Diffs.DiffItem("del", "b", 2, null), diff[1]);
        Assert.Equal(new Diffs.DiffItem("add", "x", null, 2), diff[2]);
        Assert.Equal(new Diffs.DiffItem("eq", "c", 3, 3), diff[3]);
    }

    [Fact]
    public void Summary_calculates_counts_from_diff_items_and_patch_objects()
    {
        var items = new List<Diffs.DiffItem>
        {
            new("eq", "a"),
            new("add", "b"),
            new("add", "c"),
            new("del", "d")
        };
        var s = Diffs.Summary(items);
        Assert.Equal(2, s.Additions);
        Assert.Equal(1, s.Deletions);
        Assert.Equal(1, s.Unchanged);
        Assert.Equal(4, s.Total);
    }

    [Fact]
    public void FormatBadge_formats_diff_statistics_with_unicode_minus()
    {
        Assert.Equal("+12 \u22123", Diffs.FormatBadge(new Diffs.DiffSummary(12, 3, 0, 15)));
        Assert.Equal("+5", Diffs.FormatBadge(new Diffs.DiffSummary(5, 0, 0, 5)));
        Assert.Equal("\u22124", Diffs.FormatBadge(new Diffs.DiffSummary(0, 4, 0, 4)));
        Assert.Equal("0", Diffs.FormatBadge(new Diffs.DiffSummary(0, 0, 0, 0)));
        Assert.Equal("0", Diffs.FormatBadge((Diffs.DiffSummary?)null));
    }

    [Fact]
    public void ParsePatch_parses_standard_unified_patch_format()
    {
        var patch = @"--- a/cart.py
+++ b/cart.py
@@ -1,3 +1,4 @@
 def total():
-    return 0
+    # comment
+    return 10
";
        var parsed = Diffs.ParsePatch(patch);
        Assert.Single(parsed.Hunks);
        Assert.Equal(1, parsed.Hunks[0].OldStart);
        Assert.Equal(1, parsed.Hunks[0].NewStart);
        Assert.Equal(2, parsed.Summary.Additions);
        Assert.Equal(1, parsed.Summary.Deletions);
    }

    [Fact]
    public void ParsePatch_handles_simple_diff_logs_without_hunk_headers()
    {
        var simpleDiff = "- Murmio\n+ VESPR\n+ Shared workspace";
        var parsed = Diffs.ParsePatch(simpleDiff);
        Assert.Equal(2, parsed.Summary.Additions);
        Assert.Equal(1, parsed.Summary.Deletions);
    }

    [Fact]
    public void FormatUnified_produces_valid_unified_diff_string()
    {
        var oldText = "line1\nline2";
        var newText = "line1\nline2_modified";
        var uni = Diffs.FormatUnified("test.py", oldText, newText);
        Assert.Contains("--- a/test.py", uni);
        Assert.Contains("+++ b/test.py", uni);
        Assert.Contains("@@ -1,2 +1,2 @@", uni);
        Assert.Contains("-line2", uni);
        Assert.Contains("+line2_modified", uni);
    }

    [Fact]
    public void FormatUnified_returns_empty_string_if_no_changes()
    {
        var text = "unchanged\nlines";
        Assert.Equal("", Diffs.FormatUnified("test.py", text, text));
    }

    [Fact]
    public void Hostile_input_immunity_for_all_diff_functions()
    {
        Assert.Empty(Diffs.SplitLines(null));
        Assert.Empty(Diffs.DiffLines(null, null));
        Assert.Equal(new Diffs.DiffSummary(0, 0, 0, 0), Diffs.Summary((IEnumerable<Diffs.DiffItem>?)null));
        Assert.Equal("0", Diffs.FormatBadge((Diffs.DiffSummary?)null));
        Assert.Equal(new Diffs.DiffSummary(0, 0, 0, 0), Diffs.ParsePatch(null).Summary);
        Assert.Equal("", Diffs.FormatUnified(null, null, null));
    }
}
