namespace Vespr.Core;

using System.Text;
using System.Text.RegularExpressions;

/// <summary>
/// Terminal output buffer, ANSI stripper, and runner log parser. Port of app/termoutput.js.
/// </summary>
public static class TermOutput
{
    public const int MaxTermLines = 1000;
    public const int MaxLineChars = 2000;
    public const int MaxParsedErrors = 50;

    public record ParsedError(
        string File,
        int Line,
        int Col,
        string Severity,
        string Message,
        string Source = "runner"
    );

    public record TermSummary(
        int TotalLines,
        int Bytes,
        bool HasErrors,
        int ErrorCount
    );

    public record TermBufferOptions(
        int? MaxLines = null
    );

    private static readonly Regex AnsiRegex = new(
        @"[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]",
        RegexOptions.Compiled
    );

    private static readonly Regex DigitsRegex = new(@"\d+", RegexOptions.Compiled);

    private static readonly Regex PyTracebackRegex = new(
        @"File ""([^""]+)"", line (\d+)(?:, in (.+))?",
        RegexOptions.Compiled
    );

    private static readonly Regex PyErrorLineRegex = new(
        @"^(?:[A-Za-z]+Error|AssertionError|Exception):",
        RegexOptions.Compiled
    );

    private static readonly Regex PyUnitTestRegex = new(
        @"^FAIL:\s*(\w+)\s*\(([^:]+):(\d+)\)",
        RegexOptions.Compiled
    );

    private static readonly Regex NodeStackRegex = new(
        @"at (?:[^\s(]+\s+\()?(?:file:\/\/\/)?([^:)]+):(\d+):(\d+)\)?",
        RegexOptions.Compiled
    );

    private static readonly Regex NodeErrorLineRegex = new(
        @"^(?:[A-Za-z]+Error|AssertionError):",
        RegexOptions.Compiled
    );

    private static readonly Regex CompilerRegex = new(
        @"^([^:\s]+):(\d+):(?:(\d+):)?\s*(error|warning):\s*(.*)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase
    );

    private static string CleanText(string? val)
    {
        if (val is null) return "";
        return val.Replace("\0", "");
    }

    public static string EscapeHtml(string? str)
    {
        if (str is null) return "";
        var sb = new StringBuilder(str.Length);
        foreach (var c in str)
        {
            switch (c)
            {
                case '&': sb.Append("&amp;"); break;
                case '<': sb.Append("&lt;"); break;
                case '>': sb.Append("&gt;"); break;
                case '"': sb.Append("&quot;"); break;
                case '\'': sb.Append("&#39;"); break;
                default: sb.Append(c); break;
            }
        }
        return sb.ToString();
    }

    public static string StripAnsi(string? text)
    {
        var src = CleanText(text);
        if (src.Length == 0) return "";
        var stripped = AnsiRegex.Replace(src, "");
        return stripped.Replace("\r\n", "\n").Replace('\r', '\n');
    }

    public static string AnsiToHtml(string? text)
    {
        var clean = CleanText(text).Replace("\r\n", "\n").Replace('\r', '\n');
        if (clean.Length == 0) return "";

        var sb = new StringBuilder();
        var curStyle = "";
        var openSpan = false
;
        var lastIndex = 0;

        foreach (Match match in AnsiRegex.Matches(clean))
        {
            if (match.Index > lastIndex)
            {
                var chunk = EscapeHtml(clean[lastIndex..match.Index]);
                if (!string.IsNullOrEmpty(curStyle) && !openSpan)
                {
                    sb.Append("<span style=\"").Append(curStyle).Append("\">").Append(chunk);
                    openSpan = true;
                }
                else
                {
                    sb.Append(chunk);
                }
            }

            var codeStr = match.Value;
            var numMatches = DigitsRegex.Matches(codeStr);
            foreach (Match numMatch in numMatches)
            {
                if (int.TryParse(numMatch.Value, out var n))
                {
                    if (n is 0 or 39 or 49)
                    {
                        if (openSpan)
                        {
                            sb.Append("</span>");
                            openSpan = false;
                        }
                        curStyle = "";
                    }
                    else if (n == 1)
                    {
                        curStyle += "font-weight:600;";
                    }
                    else if (n is 31 or 91)
                    {
                        curStyle += "color:var(--bad);";
                    }
                    else if (n is 32 or 92)
                    {
                        curStyle += "color:var(--ok);";
                    }
                    else if (n is 33 or 93)
                    {
                        curStyle += "color:var(--warn);";
                    }
                    else if (n is 34 or 94 or 36 or 96)
                    {
                        curStyle += "color:var(--agent);";
                    }
                    else if (n is 37 or 90)
                    {
                        curStyle += "color:var(--muted);";
                    }
                }
            }

            lastIndex = match.Index + match.Length;
        }

        if (lastIndex < clean.Length)
        {
            var tail = EscapeHtml(clean[lastIndex..]);
            if (!string.IsNullOrEmpty(curStyle) && !openSpan)
            {
                sb.Append("<span style=\"").Append(curStyle).Append("\">").Append(tail).Append("</span>");
            }
            else if (openSpan)
            {
                sb.Append(tail).Append("</span>");
            }
            else
            {
                sb.Append(tail);
            }
        }
        else if (openSpan)
        {
            sb.Append("</span>");
        }

        return sb.ToString();
    }

    public static List<ParsedError> ParseErrors(string? rawOutput)
    {
        var plain = StripAnsi(rawOutput);
        if (plain.Length == 0) return [];

        var lines = plain.Split('\n');
        var errors = new List<ParsedError>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        void AddError(string file, string rawLine, string rawCol, string severity, string message)
        {
            if (errors.Count >= MaxParsedErrors) return;

            var cleanFile = file.Replace('\\', '/').Trim();
            if (cleanFile.StartsWith("./", StringComparison.Ordinal))
            {
                cleanFile = cleanFile[2..];
            }

            var lineNum = int.TryParse(rawLine, out var l) ? Math.Max(1, l) : 1;
            var colNum = int.TryParse(rawCol, out var c) ? Math.Max(1, c) : 1;
            var sev = string.Equals(severity, "warning", StringComparison.OrdinalIgnoreCase) ? "warning" : "error";
            var trimmedMsg = message.Trim();
            var msg = trimmedMsg.Length > 300 ? trimmedMsg[..300] : trimmedMsg;
            if (msg.Length == 0) msg = "build or test failure";

            var key = $"{cleanFile}:{lineNum}:{colNum}:{msg}";
            if (seen.Add(key))
            {
                errors.Add(new ParsedError(cleanFile, lineNum, colNum, sev, msg));
            }
        }

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];

            // Pattern A: Python tracebacks (File "cart.py", line 12)
            var pyMatch = PyTracebackRegex.Match(line);
            if (pyMatch.Success)
            {
                var msg = "";
                for (var j = i + 1; j < Math.Min(lines.Length, i + 4); j++)
                {
                    if (PyErrorLineRegex.IsMatch(lines[j]))
                    {
                        msg = lines[j];
                        break;
                    }
                }
                AddError(pyMatch.Groups[1].Value, pyMatch.Groups[2].Value, "1", "error", string.IsNullOrEmpty(msg) ? "Python traceback error" : msg);
                continue;
            }

            // Pattern B: Python unittest failure (FAIL: test_discount (cart_test.py:12))
            var utMatch = PyUnitTestRegex.Match(line);
            if (utMatch.Success)
            {
                AddError(utMatch.Groups[2].Value, utMatch.Groups[3].Value, "1", "error", "FAIL: " + utMatch.Groups[1].Value);
                continue;
            }

            // Pattern C: Node / V8 stack trace (at file:///path/cart.js:15:9 or at cart.js:15:9)
            var nodeMatch = NodeStackRegex.Match(line);
            if (nodeMatch.Success && !nodeMatch.Groups[1].Value.Contains("node:internal", StringComparison.Ordinal))
            {
                var msg = "";
                for (var k = Math.Max(0, i - 5); k < i; k++)
                {
                    if (NodeErrorLineRegex.IsMatch(lines[k]))
                    {
                        msg = lines[k];
                        break;
                    }
                }
                AddError(nodeMatch.Groups[1].Value, nodeMatch.Groups[2].Value, nodeMatch.Groups[3].Value, "error", string.IsNullOrEmpty(msg) ? "JavaScript error" : msg);
                continue;
            }

            // Pattern D: Standard compiler format (cart.c:42:10: error: undefined symbol)
            var compMatch = CompilerRegex.Match(line);
            if (compMatch.Success)
            {
                var col = compMatch.Groups[3].Success ? compMatch.Groups[3].Value : "1";
                AddError(compMatch.Groups[1].Value, compMatch.Groups[2].Value, col, compMatch.Groups[4].Value, compMatch.Groups[5].Value);
            }
        }

        return errors;
    }

    public static TermBuffer CreateTermBuffer(TermBufferOptions? options = null)
    {
        return new TermBuffer(options);
    }
}

public class TermBuffer
{
    private readonly int _maxLines;
    private readonly List<string> _buffer = [];

    public TermBuffer(TermOutput.TermBufferOptions? options = null)
    {
        var rawMax = options?.MaxLines;
        _maxLines = rawMax is int m && m > 0
            ? Math.Max(1, Math.Min(TermOutput.MaxTermLines, m))
            : TermOutput.MaxTermLines;
    }

    public int Append(string? chunk)
    {
        var plain = TermOutput.StripAnsi(chunk);
        if (plain.Length == 0) return 0;

        var raw = plain.Split('\n');
        var added = raw.Length;

        for (var i = 0; i < raw.Length; i++)
        {
            var line = raw[i];
            var trimmed = line.Length > TermOutput.MaxLineChars ? line[..TermOutput.MaxLineChars] : line;
            _buffer.Add(trimmed);
            if (_buffer.Count > _maxLines)
            {
                _buffer.RemoveAt(0);
            }
        }

        return added;
    }

    public int Clear()
    {
        var count = _buffer.Count;
        _buffer.Clear();
        return count;
    }

    public List<string> Lines()
    {
        return [.. _buffer];
    }

    public string Text()
    {
        return string.Join("\n", _buffer);
    }

    public string Tail(int count = 25)
    {
        var n = Math.Max(1, count);
        var skip = Math.Max(0, _buffer.Count - n);
        return string.Join("\n", _buffer.Skip(skip));
    }

    public List<TermOutput.ParsedError> Errors()
    {
        return TermOutput.ParseErrors(Text());
    }

    public TermOutput.TermSummary Summary()
    {
        var t = Text();
        var errs = Errors();
        return new TermOutput.TermSummary(
            TotalLines: _buffer.Count,
            Bytes: t.Length,
            HasErrors: errs.Count > 0,
            ErrorCount: errs.Count
        );
    }
}
