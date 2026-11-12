namespace Vespr.Core;

/// <summary>
/// Editor cursor position, selection, and indentation helper for the SDE shell. Port of app/cursor.js.
/// </summary>
public static class Cursor
{
    public const int MaxDocChars = 1000000;
    public const int MaxLines = 50000;

    public record IndentInfo(string Type, int Width, string Label);
    public record Position(int Line, int Col);
    public record PositionInfo(int Line, int Col, int SelectedChars = 0, int SelectedLines = 0);
    public record WordInfo(string Word, int From, int To);
    public record SelectionInfo(int From, int To, bool IsReversed, int Length);

    public static readonly IndentInfo DefaultIndent = new("spaces", 4, "Spaces: 4");

    private static bool IsWordChar(char c) =>
        (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';

    private static string CleanText(string? val)
    {
        if (val is null) return "";
        var replaced = val.Replace("\0", "");
        return replaced.Length > MaxDocChars ? replaced[..MaxDocChars] : replaced;
    }

    private static int CleanPosNum(int? val, int fallback = 1)
    {
        if (val.HasValue)
        {
            return Math.Max(1, val.Value);
        }
        return fallback;
    }

    public static int LineCount(string? text)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        var count = 1;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n') count++;
        }
        return count;
    }

    public static int ClampLine(int? line, int? totalLines)
    {
        var target = CleanPosNum(line, 1);
        var max = CleanPosNum(totalLines, 1);
        return Math.Min(target, max);
    }

    public static Position OffsetToPos(string? text, int? rawOffset)
    {
        var src = CleanText(text);
        var len = src.Length;
        var offset = rawOffset.HasValue
            ? Math.Max(0, Math.Min(len, rawOffset.Value))
            : 0;

        var line = 1;
        var lineStart = 0;

        for (var i = 0; i < offset; i++)
        {
            if (src[i] == '\n')
            {
                line++;
                lineStart = i + 1;
            }
        }

        var col = offset - lineStart + 1;
        return new Position(line, col);
    }

    public static int PosToOffset(string? text, Position? pos)
    {
        var src = CleanText(text);
        if (src.Length == 0) return 0;

        var targetLine = pos is not null ? CleanPosNum(pos.Line, 1) : 1;
        var targetCol = pos is not null ? CleanPosNum(pos.Col, 1) : 1;

        var curLine = 1;
        var lineStart = 0;
        var lineEnd = src.Length;

        for (var i = 0; i < src.Length; i++)
        {
            if (src[i] == '\n')
            {
                if (curLine == targetLine)
                {
                    lineEnd = i;
                    break;
                }
                curLine++;
                lineStart = i + 1;
            }
        }

        var colOffset = Math.Max(0, Math.Min(targetCol - 1, lineEnd - lineStart));
        return lineStart + colOffset;
    }

    public static string FormatPosition(PositionInfo? pos)
    {
        if (pos is null) return "Ln 1, Col 1";
        var line = CleanPosNum(pos.Line, 1);
        var col = CleanPosNum(pos.Col, 1);

        var selChars = Math.Max(0, pos.SelectedChars);
        var selLines = Math.Max(0, pos.SelectedLines);

        if (selChars > 0)
        {
            if (selLines > 1)
            {
                return $"Ln {line}, Col {col} ({selLines} lines selected)";
            }
            return $"Ln {line}, Col {col} ({selChars} selected)";
        }

        return $"Ln {line}, Col {col}";
    }

    public static IndentInfo DetectIndentation(string? text)
    {
        var src = CleanText(text);
        if (src.Length == 0) return DefaultIndent with { };

        var lines = src.Split('\n').Take(500);
        var tabCount = 0;
        var space2Count = 0;
        var space4Count = 0;

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (line.StartsWith('\t'))
            {
                tabCount++;
                continue;
            }

            var leadSpaces = 0;
            while (leadSpaces < line.Length && line[leadSpaces] == ' ') leadSpaces++;

            if (leadSpaces > 0)
            {
                if (leadSpaces % 4 == 0) space4Count++;
                else if (leadSpaces % 2 == 0) space2Count++;
            }
        }

        if (tabCount > space2Count && tabCount > space4Count)
        {
            return new IndentInfo("tabs", 1, "Tabs");
        }

        if (space2Count > space4Count)
        {
            return new IndentInfo("spaces", 2, "Spaces: 2");
        }

        return DefaultIndent with { };
    }

    public static WordInfo WordAt(string? text, int? rawOffset)
    {
        var src = CleanText(text);
        if (src.Length == 0) return new WordInfo("", 0, 0);

        var offset = rawOffset.HasValue
            ? Math.Max(0, Math.Min(src.Length, rawOffset.Value))
            : 0;

        if (offset >= src.Length)
        {
            if (offset > 0 && IsWordChar(src[offset - 1]))
            {
                offset--;
            }
            else
            {
                return new WordInfo("", offset, offset);
            }
        }

        if (!IsWordChar(src[offset]))
        {
            return new WordInfo("", offset, offset);
        }

        var from = offset;
        while (from > 0 && IsWordChar(src[from - 1]))
        {
            from--;
        }

        var to = offset;
        while (to < src.Length && IsWordChar(src[to]))
        {
            to++;
        }

        return new WordInfo(src[from..to], from, to);
    }

    public static SelectionInfo NormalizeSelection(int? rawAnchor, int? rawHead)
    {
        var anchor = rawAnchor.HasValue ? Math.Max(0, rawAnchor.Value) : 0;
        var head = rawHead.HasValue ? Math.Max(0, rawHead.Value) : 0;

        if (anchor <= head)
        {
            return new SelectionInfo(anchor, head, false, head - anchor);
        }

        return new SelectionInfo(head, anchor, true, anchor - head);
    }
}
