namespace Vespr.Core.Tests;

public class GitStatusTests
{
    [Fact]
    public void Constants_exist_and_have_expected_bounds()
    {
        Assert.Equal(500, GitStatus.MaxEntries);
        Assert.Equal(300, GitStatus.MaxPath);
        Assert.Equal(1000, GitStatus.MaxLine);
    }

    [Fact]
    public void ParseStatus_returns_clean_status_for_empty_input()
    {
        var s = GitStatus.ParseStatus("");
        Assert.True(s.Summary.IsClean);
        Assert.Equal(0, s.Summary.Total);
        Assert.Empty(s.Entries);
    }

    [Fact]
    public void ParseStatus_parses_branch_line_with_tracking_and_ahead_behind()
    {
        var raw = "## fix-discount...origin/fix-discount [ahead 1, behind 2]\n";
        var s = GitStatus.ParseStatus(raw);
        Assert.Equal("fix-discount", s.Branch);
        Assert.Equal("origin/fix-discount", s.Upstream);
        Assert.Equal(1, s.Ahead);
        Assert.Equal(2, s.Behind);
        Assert.False(s.IsDetached);
    }

    [Fact]
    public void ParseStatus_parses_simple_branch_and_detached_HEAD()
    {
        var s1 = GitStatus.ParseStatus("## main\n");
        Assert.Equal("main", s1.Branch);
        Assert.Null(s1.Upstream);
        Assert.Equal(0, s1.Ahead);

        var s2 = GitStatus.ParseStatus("## HEAD (no branch)\n");
        Assert.Equal("HEAD", s2.Branch);
        Assert.True(s2.IsDetached);
    }

    [Fact]
    public void ParseStatus_parses_staged_and_unstaged_file_modifications()
    {
        var raw = @"## main
M  staged_mod.py
 M unstaged_mod.py
MM both_mod.py
A  added.js
D  deleted.txt
";
        var s = GitStatus.ParseStatus(raw);
        Assert.Equal(5, s.Entries.Count);

        Assert.Equal("staged_mod.py", s.Entries[0].Path);
        Assert.True(s.Entries[0].IsStaged);
        Assert.False(s.Entries[0].IsUnstaged);

        Assert.Equal("unstaged_mod.py", s.Entries[1].Path);
        Assert.False(s.Entries[1].IsStaged);
        Assert.True(s.Entries[1].IsUnstaged);

        Assert.Equal("both_mod.py", s.Entries[2].Path);
        Assert.True(s.Entries[2].IsStaged);
        Assert.True(s.Entries[2].IsUnstaged);

        Assert.Equal(4, s.Summary.StagedCount);
        Assert.Equal(2, s.Summary.UnstagedCount);
    }

    [Fact]
    public void ParseStatus_parses_untracked_files_and_renames()
    {
        var raw = @"## main
?? scratch.py
R  old_cart.py -> new_cart.py
";
        var s = GitStatus.ParseStatus(raw);
        Assert.Equal(2, s.Entries.Count);

        Assert.Equal("scratch.py", s.Entries[0].Path);
        Assert.True(s.Entries[0].IsUntracked);

        Assert.Equal("old_cart.py", s.Entries[1].OrigPath);
        Assert.Equal("new_cart.py", s.Entries[1].Path);
        Assert.True(s.Entries[1].IsStaged);
    }

    [Fact]
    public void ParseStatus_unquotes_quoted_paths_with_spaces()
    {
        var raw = " M \"my space/file name.py\"\n";
        var s = GitStatus.ParseStatus(raw);
        Assert.Equal("my space/file name.py", s.Entries[0].Path);
    }

    [Fact]
    public void ParseStatus_detects_merge_conflicts()
    {
        var raw = @"## main
UU conflict.js
AA both_added.py
";
        var s = GitStatus.ParseStatus(raw);
        Assert.Equal(2, s.Entries.Count);
        Assert.True(s.Entries[0].IsConflicted);
        Assert.True(s.Entries[1].IsConflicted);
        Assert.Equal(2, s.Summary.ConflictCount);
    }

    [Fact]
    public void FormatStatusLine_formats_status_bar_git_indicator()
    {
        Assert.Equal("main 1\u2191", GitStatus.FormatStatusLine(new GitStatus.StatusResult("main", null, 1, 0, false, [], new GitStatus.StatusSummary(0, 0, 0, 0, 0, true))));
        Assert.Equal("main 2\u2193", GitStatus.FormatStatusLine(new GitStatus.StatusResult("main", null, 0, 2, false, [], new GitStatus.StatusSummary(0, 0, 0, 0, 0, true))));
        Assert.Equal("main 2\u2193 1\u2191", GitStatus.FormatStatusLine(new GitStatus.StatusResult("main", null, 1, 2, false, [], new GitStatus.StatusSummary(0, 0, 0, 0, 0, true))));
        Assert.Equal("main", GitStatus.FormatStatusLine(new GitStatus.StatusResult("main", null, 0, 0, false, [], new GitStatus.StatusSummary(0, 0, 0, 0, 0, true))));
        Assert.Equal("main", GitStatus.FormatStatusLine(null));
    }

    [Fact]
    public void FormatFileBadge_returns_single_character_badges()
    {
        Assert.Equal("!", GitStatus.FormatFileBadge(new GitStatus.StatusEntry("U", "U", "a.py", null, false, false, false, true)));
        Assert.Equal("?", GitStatus.FormatFileBadge(new GitStatus.StatusEntry("?", "?", "b.py", null, false, false, true, false)));
        Assert.Equal("M", GitStatus.FormatFileBadge(new GitStatus.StatusEntry("M", "M", "c.py", null, true, true, false, false)));
        Assert.Equal("A", GitStatus.FormatFileBadge(new GitStatus.StatusEntry("A", " ", "d.py", null, true, false, false, false)));
        Assert.Equal("D", GitStatus.FormatFileBadge(new GitStatus.StatusEntry(" ", "D", "e.py", null, false, true, false, false)));
    }

    [Fact]
    public void GroupEntries_organizes_files_into_categorized_buckets()
    {
        var raw = @"## main
M  staged.js
 M unstaged.js
?? new.txt
UU conflict.txt
";
        var s = GitStatus.ParseStatus(raw);
        var g = GitStatus.GroupEntries(s.Entries);
        Assert.Single(g.Staged);
        Assert.Single(g.Unstaged);
        Assert.Single(g.Untracked);
        Assert.Single(g.Conflicted);
    }

    [Fact]
    public void Hostile_input_immunity_for_parseStatus_and_helpers()
    {
        Assert.True(GitStatus.ParseStatus(null).Summary.IsClean);
        Assert.True(GitStatus.ParseStatus("").Summary.IsClean);
        Assert.True(GitStatus.ParseStatus("garbage random text without prefix").Summary.IsClean);
        var g = GitStatus.GroupEntries(null);
        Assert.Empty(g.Staged);
        Assert.Empty(g.Unstaged);
        Assert.Empty(g.Untracked);
        Assert.Empty(g.Conflicted);
        Assert.Equal("M", GitStatus.FormatFileBadge(null));
    }
}
