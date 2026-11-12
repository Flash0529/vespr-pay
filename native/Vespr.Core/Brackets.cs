namespace Vespr.Core;

using System.Collections.ObjectModel;

/// <summary>
/// Code bracket matching, auto-closing pairs, and syntax balance validator. Port of app/brackets.js.
/// </summary>
public static class Brackets
{
    public const int MaxScanLen = 200000;

    public static readonly ReadOnlyDictionary<char, char> OpenBrackets = new(new Dictionary<char, char>
    {
        ['('] = ')',
        ['['] = ']',
        ['{'] = '}'
    });

    public static readonly ReadOnlyDictionary<char, char> CloseBrackets = new(new Dictionary<char, char>
    {
        [')'] = '(',
        [']'] = '[',
        ['}'] = '{'
    });

    public static readonly ReadOnlyDictionary<char, char> AutoClosePairs = new(new Dictionary<char, char>
    {
        ['('] = ')',
        ['['] = ']',
        ['{'] = '}',
        ['"'] = '"',
        ['\''] = '\'',
        ['`'] = '`'
    });

    public record BracketMatch(
        int MatchOffset,
        int OpenOffset,
        int CloseOffset,
        string Pair
    );

    public record BalanceIssue(
        int Line,
        int Col,
        int Offset,
        string Message,
        char? Expected,
        char? Found
    );

    public record BalanceResult(
        bool Balanced,
        List<BalanceIssue> Issues
    );

    public static bool IsBracket(char? c)
    {
        if (c is null) return false;
        var ch = c.Value;
        return OpenBrackets.ContainsKey(ch) || CloseBrackets.ContainsKey(ch);
    }

    public static char? GetAutoCloseChar(char? c)
    {
        if (c is null) return null;
        return AutoClosePairs.TryGetValue(c.Value, out var match) ? match : null;
    }

    public static string WrapWithPair(string? text, char openChar)
    {
        var content = text ?? "";
        if (content.Length > MaxScanLen) content = content[..MaxScanLen];

        var closeChar = GetAutoCloseChar(openChar);
        if (closeChar is null) return content;

        return $"{openChar}{content}{closeChar}";
    }

    private static (int Line, int Col) OffsetToPos(string text, int offset)
    {
        var line = 1;
        var col = 1;
        var limit = Math.Min(offset, text.Length);
        for (var i = 0; i < limit; i++)
        {
            if (text[i] == '\n')
            {
                line++;
                col = 1;
            }
            else
            {
                col++;
            }
        }
        return (line, col);
    }

    public static BracketMatch? FindMatchingBracket(string? rawText, int rawOffset)
    {
        if (rawText is null) return null;
        var text = rawText.Length > MaxScanLen ? rawText[..MaxScanLen] : rawText;
        if (text.Length == 0) return null;

        var offset = Math.Max(0, Math.Min(text.Length - 1, rawOffset));
        var targetChar = text[offset];

        if (!IsBracket(targetChar) && offset > 0 && IsBracket(text[offset - 1]))
        {
            offset--;
            targetChar = text[offset];
        }

        if (!IsBracket(targetChar)) return null;

        if (OpenBrackets.TryGetValue(targetChar, out var closeChar))
        {
            var depth = 0;
            char? inString = null;
            string? inComment = null;

            for (var i = offset; i < text.Length; i++)
            {
                var ch = text[i];
                var prev = i > 0 ? text[i - 1] : '\0';

                if (inString is not null)
                {
                    if (ch == inString.Value && prev != '\\') inString = null;
                    continue;
                }
                if (inComment == "line")
                {
                    if (ch == '\n') inComment = null;
                    continue;
                }
                if (inComment == "block")
                {
                    if (ch == '/' && prev == '*') inComment = null;
                    continue;
                }

                if (ch is '"' or '\'' or '`')
                {
                    inString = ch;
                    continue;
                }
                if (ch == '/' && i + 1 < text.Length && text[i + 1] == '/')
                {
                    inComment = "line";
                    i++;
                    continue;
                }
                if (ch == '/' && i + 1 < text.Length && text[i + 1] == '*')
                {
                    inComment = "block";
                    i++;
                    continue;
                }

                if (ch == targetChar)
                {
                    depth++;
                }
                else if (ch == closeChar)
                {
                    depth--;
                    if (depth == 0)
                    {
                        return new BracketMatch(
                            MatchOffset: i,
                            OpenOffset: offset,
                            CloseOffset: i,
                            Pair: $"{targetChar}{closeChar}"
                        );
                    }
                }
            }
            return null;
        }

        // Scanning backward from closing bracket
        var openChar = CloseBrackets[targetChar];
        var backDepth = 0;
        for (var i = offset; i >= 0; i--)
        {
            var ch = text[i];
            if (ch == targetChar)
            {
                backDepth++;
            }
            else if (ch == openChar)
            {
                backDepth--;
                if (backDepth == 0)
                {
                    return new BracketMatch(
                        MatchOffset: i,
                        OpenOffset: i,
                        CloseOffset: offset,
                        Pair: $"{openChar}{targetChar}"
                    );
                }
            }
        }

        return null;
    }

    public static BalanceResult CheckBalance(string? rawText)
    {
        if (rawText is null)
        {
            return new BalanceResult(true, []);
        }

        var text = rawText.Length > MaxScanLen ? rawText[..MaxScanLen] : rawText;
        var stack = new Stack<(char Char, int Offset, char Close)>();
        var issues = new List<BalanceIssue>();

        char? inString = null;
        string? inComment = null;

        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            var prev = i > 0 ? text[i - 1] : '\0';

            if (inString is not null)
            {
                if (ch == inString.Value && prev != '\\') inString = null;
                continue;
            }
            if (inComment == "line")
            {
                if (ch == '\n') inComment = null;
                continue;
            }
            if (inComment == "block")
            {
                if (ch == '/' && prev == '*') inComment = null;
                continue;
            }

            if (ch is '"' or '\'' or '`')
            {
                inString = ch;
                continue;
            }
            if (ch == '#' && (i == 0 || text[i - 1] == ' ' || text[i - 1] == '\n'))
            {
                inComment = "line";
                continue;
            }
            if (ch == '/' && i + 1 < text.Length && text[i + 1] == '/')
            {
                inComment = "line";
                i++;
                continue;
            }
            if (ch == '/' && i + 1 < text.Length && text[i + 1] == '*')
            {
                inComment = "block";
                i++;
                continue;
            }

            if (OpenBrackets.TryGetValue(ch, out var closeMatch))
            {
                stack.Push((ch, i, closeMatch));
            }
            else if (CloseBrackets.ContainsKey(ch))
            {
                if (stack.Count == 0)
                {
                    var (line, col) = OffsetToPos(text, i);
                    issues.Add(new BalanceIssue(
                        Line: line,
                        Col: col,
                        Offset: i,
                        Message: $"Unexpected closing bracket \"{ch}\" without matching opening bracket",
                        Expected: null,
                        Found: ch
                    ));
                }
                else
                {
                    var top = stack.Pop();
                    if (top.Close != ch)
                    {
                        var (line, col) = OffsetToPos(text, i);
                        issues.Add(new BalanceIssue(
                            Line: line,
                            Col: col,
                            Offset: i,
                            Message: $"Mismatched closing bracket \"{ch}\", expected \"{top.Close}\"",
                            Expected: top.Close,
                            Found: ch
                        ));
                    }
                }
            }
        }

        // Report unclosed opening brackets left on stack
        while (stack.Count > 0)
        {
            var unclosed = stack.Pop();
            var (line, col) = OffsetToPos(text, unclosed.Offset);
            issues.Add(new BalanceIssue(
                Line: line,
                Col: col,
                Offset: unclosed.Offset,
                Message: $"Unclosed opening bracket \"{unclosed.Char}\", expected \"{unclosed.Close}\" before end of input",
                Expected: unclosed.Close,
                Found: null
            ));
        }

        return new BalanceResult(issues.Count == 0, issues);
    }
}
