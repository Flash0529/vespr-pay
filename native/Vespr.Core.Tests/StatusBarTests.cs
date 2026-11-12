namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class StatusBarTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(50, StatusBar.MaxStatusItems);
        Assert.Equal(60, StatusBar.MaxIdLen);
        Assert.Equal(120, StatusBar.MaxTextLen);
        Assert.Equal(200, StatusBar.MaxTooltipLen);
        Assert.Equal(250, StatusBar.MaxMessageLen);
        Assert.Equal(5000, StatusBar.DefaultMessageTimeout);
    }

    [Fact]
    public void FormatCursor_FormatsCursorCoordinates()
    {
        Assert.Equal("Ln 1, Col 1", StatusBar.FormatCursor(1, 1));
        Assert.Equal("Ln 42, Col 10", StatusBar.FormatCursor(42, 10));
        Assert.Equal("Ln 10, Col 5 (25 selected)", StatusBar.FormatCursor(10, 5, 25));
        Assert.Equal("Ln 10, Col 5 (1 selected)", StatusBar.FormatCursor(10, 5, 1));
        Assert.Equal("Ln 1, Col 1", StatusBar.FormatCursor(-5, 0));
        Assert.Equal("Ln 1, Col 1", StatusBar.FormatCursor(null, null));
    }

    [Fact]
    public void FormatProblems_FormatsProblemsDiagnosticsBadges()
    {
        Assert.Equal("0 Problems", StatusBar.FormatProblems(0, 0));
        Assert.Equal("✕ 3", StatusBar.FormatProblems(3, 0));
        Assert.Equal("⚠ 5", StatusBar.FormatProblems(0, 5));
        Assert.Equal("✕ 2  ⚠ 4", StatusBar.FormatProblems(2, 4));
        Assert.Equal("0 Problems", StatusBar.FormatProblems(-1, null));
    }

    [Fact]
    public void FormatGit_FormatsGitBranchAndSyncIndicators()
    {
        Assert.Equal("main", StatusBar.FormatGit("main"));
        Assert.Equal("main 1↑", StatusBar.FormatGit("main", ahead: 1));
        Assert.Equal("main 2↓", StatusBar.FormatGit("main", behind: 2));
        Assert.Equal("feat/auth 2↓ 3↑", StatusBar.FormatGit("feat/auth", ahead: 3, behind: 2));
        Assert.Equal("HEAD detached at 1a2b3c4", StatusBar.FormatGit("1a2b3c4", detached: true));
        Assert.Equal("", StatusBar.FormatGit(""));
        Assert.Equal("", StatusBar.FormatGit(null));
    }

    [Fact]
    public void FormatIndent_FormatsIndentationModeAndWidth()
    {
        Assert.Equal("Spaces: 2", StatusBar.FormatIndent("spaces", 2));
        Assert.Equal("Spaces: 4", StatusBar.FormatIndent("spaces", 4));
        Assert.Equal("Tabs: 4", StatusBar.FormatIndent("tabs", 4));
        Assert.Equal("Tabs: 8", StatusBar.FormatIndent("tab", 8));
        Assert.Equal("Spaces: 2", StatusBar.FormatIndent(null));
    }

    [Fact]
    public void FormatEncoding_FormatsEncodingAndLineEndingConvention()
    {
        Assert.Equal("UTF-8  LF", StatusBar.FormatEncoding("utf-8", "\n"));
        Assert.Equal("UTF-8  CRLF", StatusBar.FormatEncoding("utf-8", "\r\n"));
        Assert.Equal("ASCII  CRLF", StatusBar.FormatEncoding("ascii", "CRLF"));
        Assert.Equal("UTF-8  LF", StatusBar.FormatEncoding(null, null));
    }

    [Fact]
    public void CreateStatusBar_RegistersRetrievesAndRemovesStatusItems()
    {
        var bar = StatusBar.CreateStatusBar();
        Assert.Equal(0, bar.Size);

        var ok = bar.Set("cursor", new StatusBar.StatusItem(
            Id: "cursor",
            Text: "Ln 1, Col 1",
            Side: "right",
            Priority: 100
        ));
        Assert.True(ok);
        Assert.Equal(1, bar.Size);
        Assert.True(bar.Has("cursor"));
        Assert.False(bar.Has("missing"));

        var item = bar.Get("cursor");
        Assert.NotNull(item);
        Assert.Equal("cursor", item.Id);
        Assert.Equal("Ln 1, Col 1", item.Text);
        Assert.Equal("right", item.Side);
        Assert.Equal(100, item.Priority);

        Assert.True(bar.Remove("cursor"));
        Assert.Equal(0, bar.Size);
        Assert.False(bar.Remove("cursor"));
    }

    [Fact]
    public void List_SortsItemsByPriorityDescendingWithinEachSide()
    {
        var bar = StatusBar.CreateStatusBar();
        bar.Set("branch", new StatusBar.StatusItem("branch", Text: "main", Side: "left", Priority: 50));
        bar.Set("problems", new StatusBar.StatusItem("problems", Text: "0 Problems", Side: "left", Priority: 100));
        bar.Set("encoding", new StatusBar.StatusItem("encoding", Text: "UTF-8", Side: "right", Priority: 10));
        bar.Set("cursor", new StatusBar.StatusItem("cursor", Text: "Ln 1, Col 1", Side: "right", Priority: 80));

        var left = bar.List("left");
        Assert.Equal(2, left.Count);
        Assert.Equal("problems", left[0].Id); // priority 100 first
        Assert.Equal("branch", left[1].Id);   // priority 50 second

        var right = bar.List("right");
        Assert.Equal(2, right.Count);
        Assert.Equal("cursor", right[0].Id);   // priority 80 first
        Assert.Equal("encoding", right[1].Id); // priority 10 second

        var all = bar.List();
        Assert.Equal(2, all.Left.Count);
        Assert.Equal(2, all.Right.Count);
    }

    [Fact]
    public void ShowAndHide_TogglesItemVisibilityAndHidesFromList()
    {
        var bar = StatusBar.CreateStatusBar();
        bar.Set("spinner", new StatusBar.StatusItem("spinner", Text: "Syncing...", Visible: false));
        Assert.Empty(bar.List("left"));

        Assert.True(bar.Show("spinner"));
        Assert.Single(bar.List("left"));

        Assert.True(bar.Hide("spinner"));
        Assert.Empty(bar.List("left"));
        Assert.False(bar.Show("nonexistent"));
    }

    [Fact]
    public void EphemeralMessages_ManagesEphemeralStatusMessagesWithExpirationClock()
    {
        var bar = StatusBar.CreateStatusBar();
        long clock = 1000;

        Assert.Null(bar.GetMessage(now: () => clock));

        bar.SetMessage("File saved", timeout: 2000, now: () => clock);
        Assert.Equal("File saved", bar.GetMessage(now: () => clock));

        // Advance clock before expiration
        clock += 1500;
        Assert.Equal("File saved", bar.GetMessage(now: () => clock));

        // Advance clock past expiration
        clock += 600;
        Assert.Null(bar.GetMessage(now: () => clock));

        // Clear message manually
        bar.SetMessage("Processing...", timeout: 5000, now: () => clock);
        bar.ClearMessage();
        Assert.Null(bar.GetMessage(now: () => clock));
    }

    [Fact]
    public void CapacityCheck_EnforcesMaxStatusItemsCapacity()
    {
        var bar = StatusBar.CreateStatusBar();
        for (int i = 0; i < StatusBar.MaxStatusItems; i++)
        {
            bar.Set("item_" + i, new StatusBar.StatusItem("item_" + i, Text: "Text " + i));
        }
        Assert.Equal(StatusBar.MaxStatusItems, bar.Size);

        // New item beyond max returns false
        Assert.False(bar.Set("overflow", new StatusBar.StatusItem("overflow", Text: "Overflow")));
        Assert.Equal(StatusBar.MaxStatusItems, bar.Size);

        // Existing item can still be updated
        Assert.True(bar.Set("item_0", new StatusBar.StatusItem("item_0", Text: "Updated")));
        Assert.Equal(StatusBar.MaxStatusItems, bar.Size);
    }

    [Fact]
    public void HostileInputImmunity_HandlesHostileInputsAndBoundsSafely()
    {
        var bar = StatusBar.CreateStatusBar();

        Assert.False(bar.Set(null, new StatusBar.StatusItem("id")));
        Assert.False(bar.Set("", new StatusBar.StatusItem("id")));
        Assert.False(bar.Set("bad", null));
        Assert.False(bar.Set("__proto__", new StatusBar.StatusItem("__proto__", Text: "attack")));

        // Huge text clamped
        var huge = new string('a', 5000);
        bar.Set("huge", new StatusBar.StatusItem("huge", Text: huge, Tooltip: huge));
        var saved = bar.Get("huge");
        Assert.NotNull(saved);
        Assert.Equal(StatusBar.MaxTextLen, saved.Text.Length);
        Assert.Equal(StatusBar.MaxTooltipLen, saved.Tooltip.Length);
    }
}
