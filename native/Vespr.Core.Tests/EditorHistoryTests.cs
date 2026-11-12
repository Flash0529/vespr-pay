namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class EditorHistoryTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(200, EditorHistory.MaxHistoryDepth);
        Assert.Equal(500, EditorHistory.DefaultDebounceMs);
        Assert.Equal(500000, EditorHistory.MaxTextLen);
    }

    [Fact]
    public void Initialization_InitializesBufferHistoryWithInitialTextAndCursor()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(
            InitialText: "const x = 1",
            InitialCursor: new EditorHistory.CursorPos(Line: 1, Col: 12)
        ));
        Assert.Equal(1, h.Size);
        Assert.False(h.CanUndo);
        Assert.False(h.CanRedo);
        Assert.False(h.IsDirty());

        var cur = h.Current();
        Assert.Equal("const x = 1", cur.Text);
        Assert.Equal(1, cur.Cursor.Line);
        Assert.Equal(12, cur.Cursor.Col);
    }

    [Fact]
    public void DiscreteEdits_HandlesDistinctEditsAndUndoRedoStepTraversal()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(InitialText: "a"));

        h.Push("b", new EditorHistory.CursorPos(Line: 1, Col: 2), new EditorHistory.HistoryPushOptions(Origin: "paste"));
        h.Push("c", new EditorHistory.CursorPos(Line: 1, Col: 2), new EditorHistory.HistoryPushOptions(Origin: "paste"));

        Assert.Equal(3, h.Size);
        Assert.True(h.CanUndo);
        Assert.False(h.CanRedo);
        Assert.Equal("c", h.Current().Text);

        // Undo to 'b'
        var u1 = h.Undo();
        Assert.NotNull(u1);
        Assert.Equal("b", u1.Text);
        Assert.True(u1.CanUndo);
        Assert.True(u1.CanRedo);

        // Undo to 'a'
        var u2 = h.Undo();
        Assert.NotNull(u2);
        Assert.Equal("a", u2.Text);
        Assert.False(u2.CanUndo);
        Assert.True(u2.CanRedo);

        // Cannot undo past beginning
        Assert.Null(h.Undo());

        // Redo to 'b'
        var r1 = h.Redo();
        Assert.NotNull(r1);
        Assert.Equal("b", r1.Text);
        Assert.True(r1.CanUndo);
        Assert.True(r1.CanRedo);

        // Redo to 'c'
        var r2 = h.Redo();
        Assert.NotNull(r2);
        Assert.Equal("c", r2.Text);
        Assert.True(r2.CanUndo);
        Assert.False(r2.CanRedo);

        // Cannot redo past end
        Assert.Null(h.Redo());
    }

    [Fact]
    public void RedoTruncation_TruncatesRedoHistoryWhenNewEditsOccurFromIntermediateState()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(InitialText: "step1"));
        h.Push("step2", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        h.Push("step3", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));

        h.Undo(); // back to step2
        Assert.Equal("step2", h.Current().Text);
        Assert.True(h.CanRedo);

        // Branch off with step4
        h.Push("step4", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal("step4", h.Current().Text);
        Assert.False(h.CanRedo);
        Assert.Equal(3, h.Size); // step1, step2, step4

        h.Undo();
        Assert.Equal("step2", h.Current().Text);
    }

    [Fact]
    public void TypingCoalescing_CoalescesRapidSingleCharacterTypingWithinDebounceWindow()
    {
        long clock = 1000;
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(
            InitialText: "",
            DebounceMs: 500
        ));

        // First keystroke
        h.Push("h", new EditorHistory.CursorPos(Line: 1, Col: 2), new EditorHistory.HistoryPushOptions(Origin: "type", Now: () => clock));
        Assert.Equal(2, h.Size);

        // Second keystroke 100ms later -> coalesces into same entry!
        clock += 100;
        h.Push("he", new EditorHistory.CursorPos(Line: 1, Col: 3), new EditorHistory.HistoryPushOptions(Origin: "type", Now: () => clock));
        Assert.Equal(2, h.Size);

        // Third keystroke 100ms later -> coalesces into same entry!
        clock += 100;
        h.Push("hel", new EditorHistory.CursorPos(Line: 1, Col: 4), new EditorHistory.HistoryPushOptions(Origin: "type", Now: () => clock));
        Assert.Equal(2, h.Size);
        Assert.Equal("hel", h.Current().Text);

        // Undoing once reverts back to ''
        h.Undo();
        Assert.Equal("", h.Current().Text);
    }

    [Fact]
    public void TypingBoundaries_OnPauseOrForceBoundary_CreatesSeparateEntry()
    {
        long clock = 1000;
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(
            InitialText: "",
            DebounceMs: 300
        ));

        h.Push("a", null, new EditorHistory.HistoryPushOptions(Origin: "type", Now: () => clock));
        Assert.Equal(2, h.Size);

        // Wait 400ms (exceeds debounceMs 300)
        clock += 400;
        h.Push("ab", null, new EditorHistory.HistoryPushOptions(Origin: "type", Now: () => clock));
        Assert.Equal(3, h.Size); // distinct entry!

        // Force boundary
        clock += 50;
        h.Push("abc", null, new EditorHistory.HistoryPushOptions(Origin: "type", Now: () => clock, ForceBoundary: true));
        Assert.Equal(4, h.Size);
    }

    [Fact]
    public void DirtyTracking_TracksDirtyStateAccuratelyThroughEditsAndUndoRedo()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(InitialText: "clean"));
        Assert.False(h.IsDirty());

        h.Push("dirty", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.True(h.IsDirty());

        // Set saved at 'dirty'
        h.SetSaved();
        Assert.False(h.IsDirty());

        // Undo back to 'clean' -> now dirty compared to saved!
        h.Undo();
        Assert.True(h.IsDirty());

        // Redo back to 'dirty' -> clean again!
        h.Redo();
        Assert.False(h.IsDirty());
    }

    [Fact]
    public void MaxDepthCapacity_EnforcesLimitByDroppingOldestEntries()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(
            InitialText: "0",
            MaxDepth: 3
        ));

        h.Push("1", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        h.Push("2", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal(3, h.Size);

        // Exceeds max depth 3 -> drops '0', keeps '1', '2', '3'
        h.Push("3", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal(3, h.Size);
        Assert.Equal("3", h.Current().Text);

        h.Undo();
        Assert.Equal("2", h.Current().Text);
        h.Undo();
        Assert.Equal("1", h.Current().Text);
        // Cannot undo to '0' because it was dropped
        Assert.False(h.CanUndo);
    }

    [Fact]
    public void ClearMethod_ClearsHistoryAndResetsToNewInitialState()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(InitialText: "old"));
        h.Push("newer", null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal(2, h.Size);

        h.Clear("fresh", new EditorHistory.CursorPos(Line: 5, Col: 1));
        Assert.Equal(1, h.Size);
        Assert.False(h.CanUndo);
        Assert.False(h.CanRedo);
        Assert.False(h.IsDirty());
        Assert.Equal("fresh", h.Current().Text);
        Assert.Equal(5, h.Current().Cursor.Line);
        Assert.Equal(1, h.Current().Cursor.Col);
    }

    [Fact]
    public void NumericCursorOffsets_SupportsNumericOffsetCursors()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(
            InitialText: "hello",
            InitialCursor: new EditorHistory.CursorPos(Offset: 5)
        ));
        Assert.Equal(5, h.Current().Cursor.Offset);

        h.Push("hello world", new EditorHistory.CursorPos(Offset: 11), new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal(11, h.Current().Cursor.Offset);

        h.Undo();
        Assert.Equal(5, h.Current().Cursor.Offset);
    }

    [Fact]
    public void DuplicatePushRejection_RejectsPushingIdenticalTextAndCursor()
    {
        var h = EditorHistory.CreateHistory(new EditorHistory.HistoryOptions(InitialText: "same"));
        Assert.False(h.Push("same", new EditorHistory.CursorPos(Line: 1, Col: 1)));
        Assert.Equal(1, h.Size);
    }

    [Fact]
    public void HostileInputImmunity_HandlesBadTypesHugeStringsAndBoundsSafely()
    {
        var h = EditorHistory.CreateHistory();

        Assert.False(h.Push(null));

        // Huge string clamped to MaxTextLen
        var huge = new string('x', EditorHistory.MaxTextLen + 500);
        h.Push(huge, null, new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal(EditorHistory.MaxTextLen, h.Current().Text.Length);

        // Malformed cursor
        h.Push("valid", new EditorHistory.CursorPos(Line: -10, Col: null), new EditorHistory.HistoryPushOptions(Origin: "paste"));
        Assert.Equal(1, h.Current().Cursor.Line);
        Assert.Equal(1, h.Current().Cursor.Col);
    }
}
