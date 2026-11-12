namespace Vespr.Core;

/// <summary>
/// Editor undo and redo buffer history with typing coalescing and dirty tracking. Port of app/editorhistory.js.
/// </summary>
public static class EditorHistory
{
    public const int MaxHistoryDepth = 200;
    public const int DefaultDebounceMs = 500;
    public const int MaxTextLen = 500000;

    public record CursorPos(
        int? Offset = null,
        int? Line = null,
        int? Col = null
    );

    public record HistoryEntry(
        string Text,
        CursorPos Cursor,
        long Timestamp,
        string Origin
    );

    public record HistoryState(
        string Text,
        CursorPos Cursor,
        bool CanUndo,
        bool CanRedo,
        bool IsDirty
    );

    public record HistoryPushOptions(
        string Origin = "type",
        bool ForceBoundary = false,
        Func<long>? Now = null
    );

    public record HistoryOptions(
        int MaxDepth = MaxHistoryDepth,
        int DebounceMs = DefaultDebounceMs,
        string InitialText = "",
        CursorPos? InitialCursor = null
    );

    public static CursorPos NormalizeCursor(CursorPos? cursor)
    {
        if (cursor is null)
        {
            return new CursorPos(Line: 1, Col: 1);
        }

        if (cursor.Offset is int off)
        {
            return new CursorPos(Offset: Math.Max(0, off));
        }

        var line = cursor.Line is int l && l >= 1 ? l : 1;
        var col = cursor.Col is int c && c >= 1 ? c : 1;
        return new CursorPos(Line: line, Col: col);
    }

    public static bool CursorsEqual(CursorPos? a, CursorPos? b)
    {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;

        if (a.Offset is not null && b.Offset is not null)
        {
            return a.Offset == b.Offset;
        }

        if (a.Line is not null && b.Line is not null && a.Col is not null && b.Col is not null)
        {
            return a.Line == b.Line && a.Col == b.Col;
        }

        return false;
    }

    public static HistoryManager CreateHistory(HistoryOptions? options = null)
    {
        return new HistoryManager(options);
    }
}

public class HistoryManager
{
    private readonly int _maxDepth;
    private readonly int _debounceMs;
    private readonly List<EditorHistory.HistoryEntry> _entries = [];
    private int _currentIndex;
    private int _savedIndex;

    public HistoryManager(EditorHistory.HistoryOptions? options = null)
    {
        var rawDepth = options?.MaxDepth ?? EditorHistory.MaxHistoryDepth;
        _maxDepth = rawDepth > 0 ? Math.Min(EditorHistory.MaxHistoryDepth, rawDepth) : EditorHistory.MaxHistoryDepth;

        var rawDebounce = options?.DebounceMs ?? EditorHistory.DefaultDebounceMs;
        _debounceMs = rawDebounce >= 0 ? rawDebounce : EditorHistory.DefaultDebounceMs;

        var initialText = options?.InitialText ?? "";
        if (initialText.Length > EditorHistory.MaxTextLen)
        {
            initialText = initialText[..EditorHistory.MaxTextLen];
        }

        var initialCursor = EditorHistory.NormalizeCursor(options?.InitialCursor);

        _entries.Add(new EditorHistory.HistoryEntry(
            Text: initialText,
            Cursor: initialCursor,
            Timestamp: 0,
            Origin: "init"
        ));
        _currentIndex = 0;
        _savedIndex = 0;
    }

    public bool CanUndo => _currentIndex > 0;
    public bool CanRedo => _currentIndex < _entries.Count - 1;
    public int Size => _entries.Count;
    public int Index => _currentIndex;

    public bool Push(string? rawText, EditorHistory.CursorPos? rawCursor = null, EditorHistory.HistoryPushOptions? opts = null)
    {
        if (rawText is null) return false;

        var text = rawText.Length > EditorHistory.MaxTextLen ? rawText[..EditorHistory.MaxTextLen] : rawText;
        var cursor = rawCursor is not null ? EditorHistory.NormalizeCursor(rawCursor) : _entries[_currentIndex].Cursor;
        var origin = !string.IsNullOrEmpty(opts?.Origin) ? opts!.Origin : "type";
        if (origin.Length > 30) origin = origin[..30];
        var forceBoundary = opts?.ForceBoundary == true;
        var timestamp = opts?.Now is not null ? opts.Now() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var currentEntry = _entries[_currentIndex];
        if (currentEntry.Text == text && EditorHistory.CursorsEqual(currentEntry.Cursor, cursor))
        {
            return false;
        }

        var isTyping = origin == "type" || origin == "input";
        var wasTyping = currentEntry.Origin == "type" || currentEntry.Origin == "input";
        var timeDelta = timestamp - currentEntry.Timestamp;

        var checkIdx = Math.Min(text.Length - 1, currentEntry.Text.Length);
        if (checkIdx < 0) checkIdx = 0;
        var hasNewline = checkIdx < text.Length && text.IndexOf('\n', checkIdx) != -1;

        var canCoalesce = !forceBoundary &&
            isTyping &&
            wasTyping &&
            timeDelta <= _debounceMs &&
            Math.Abs(text.Length - currentEntry.Text.Length) == 1 &&
            !hasNewline;

        if (canCoalesce)
        {
            _entries[_currentIndex] = new EditorHistory.HistoryEntry(text, cursor, timestamp, origin);
            return true;
        }

        if (_currentIndex + 1 < _entries.Count)
        {
            _entries.RemoveRange(_currentIndex + 1, _entries.Count - (_currentIndex + 1));
        }

        _entries.Add(new EditorHistory.HistoryEntry(text, cursor, timestamp, origin));
        _currentIndex++;

        if (_entries.Count > _maxDepth)
        {
            _entries.RemoveAt(0);
            _currentIndex--;
            if (_savedIndex > 0) _savedIndex--;
            else if (_savedIndex == 0) _savedIndex = -1;
        }

        return true;
    }

    public EditorHistory.HistoryState? Undo()
    {
        if (_currentIndex <= 0) return null;
        _currentIndex--;
        return Current();
    }

    public EditorHistory.HistoryState? Redo()
    {
        if (_currentIndex >= _entries.Count - 1) return null;
        _currentIndex++;
        return Current();
    }

    public EditorHistory.HistoryState Current()
    {
        var entry = _entries[_currentIndex];
        return new EditorHistory.HistoryState(
            Text: entry.Text,
            Cursor: entry.Cursor,
            CanUndo: _currentIndex > 0,
            CanRedo: _currentIndex < _entries.Count - 1,
            IsDirty: _currentIndex != _savedIndex
        );
    }

    public void SetSaved()
    {
        _savedIndex = _currentIndex;
    }

    public bool IsDirty()
    {
        return _currentIndex != _savedIndex;
    }

    public void Clear(string newInitialText = "", EditorHistory.CursorPos? newInitialCursor = null)
    {
        var text = newInitialText.Length > EditorHistory.MaxTextLen ? newInitialText[..EditorHistory.MaxTextLen] : newInitialText;
        var cursor = EditorHistory.NormalizeCursor(newInitialCursor);
        _entries.Clear();
        _entries.Add(new EditorHistory.HistoryEntry(
            Text: text,
            Cursor: cursor,
            Timestamp: 0,
            Origin: "init"
        ));
        _currentIndex = 0;
        _savedIndex = 0;
    }
}
