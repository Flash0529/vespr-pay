namespace Vespr.Core;

using System.Text;
using System.Text.RegularExpressions;

/// <summary>
/// Light syntax highlighter and code tokenizer for the SDE shell. Port of app/highlight.js.
/// </summary>
public static class HighlightHelper
{
    public const int MaxCodeLen = 100000;
    public const int MaxLineLen = 2000;

    public record Token(string Type, string Text);

    private static readonly HashSet<string> Keywords = new(StringComparer.Ordinal)
    {
        "def", "class", "return", "if", "elif", "else", "for", "while", "import", "from",
        "in", "not", "and", "or", "is", "None", "True", "False", "try", "except", "finally",
        "with", "as", "pass", "raise", "lambda", "yield",
        "const", "let", "var", "function", "async", "await", "export", "default", "new",
        "this", "null", "true", "false", "undefined", "throw", "catch", "switch", "case",
        "break", "continue", "typeof", "instanceof", "interface", "type", "implements",
        "fn", "mut", "pub", "struct", "enum", "impl", "trait", "match",
        "func", "package", "select", "chan", "defer"
    };

    private static readonly Regex TokenRegex = new(
        @"(#.*$|//.*$)|(""(?:[^""\\]|\\.)*""|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)",
        RegexOptions.Compiled | RegexOptions.Multiline
    );

    private static readonly Regex DefRegex = new(@"(def|function|class)\s+$", RegexOptions.Compiled);
    private static readonly Regex CallRegex = new(@"^\s*\(", RegexOptions.Compiled);

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

    private static string CleanText(string? val)
    {
        if (val is null) return "";
        var replaced = val.Replace("\0", "");
        return replaced.Length > MaxCodeLen ? replaced[..MaxCodeLen] : replaced;
    }

    public static bool IsKeyword(string? word) =>
        word is not null && Keywords.Contains(word);

    public static List<Token> Tokenize(string? code)
    {
        var src = CleanText(code);
        if (src.Length == 0) return [];

        var tokens = new List<Token>();
        var lastIndex = 0;

        foreach (Match match in TokenRegex.Matches(src))
        {
            if (match.Index > lastIndex)
            {
                tokens.Add(new Token("text", src[lastIndex..match.Index]));
            }

            if (match.Groups[1].Success)
            {
                tokens.Add(new Token("comment", match.Groups[1].Value));
            }
            else if (match.Groups[2].Success)
            {
                tokens.Add(new Token("string", match.Groups[2].Value));
            }
            else if (match.Groups[3].Success)
            {
                tokens.Add(new Token("number", match.Groups[3].Value));
            }
            else if (match.Groups[4].Success)
            {
                var w = match.Groups[4].Value;
                if (Keywords.Contains(w))
                {
                    tokens.Add(new Token("keyword", w));
                }
                else
                {
                    var preceding = src[..match.Index];
                    var following = src[(match.Index + w.Length)..];
                    var isDef = DefRegex.IsMatch(preceding);
                    var isCall = CallRegex.IsMatch(following);

                    if (isDef || isCall)
                    {
                        tokens.Add(new Token("function", w));
                    }
                    else
                    {
                        tokens.Add(new Token("text", w));
                    }
                }
            }

            lastIndex = match.Index + match.Length;
        }

        if (lastIndex < src.Length)
        {
            tokens.Add(new Token("text", src[lastIndex..]));
        }

        return tokens;
    }

    public static string Highlight(string? code)
    {
        var tokens = Tokenize(code);
        if (tokens.Count == 0) return "";

        var sb = new StringBuilder();
        foreach (var t in tokens)
        {
            var escText = EscapeHtml(t.Text);
            switch (t.Type)
            {
                case "keyword":
                    sb.Append("<span class=\"k\">").Append(escText).Append("</span>");
                    break;
                case "string":
                    sb.Append("<span class=\"s\">").Append(escText).Append("</span>");
                    break;
                case "number":
                    sb.Append("<span class=\"n\">").Append(escText).Append("</span>");
                    break;
                case "comment":
                    sb.Append("<span class=\"c\">").Append(escText).Append("</span>");
                    break;
                case "function":
                    sb.Append("<span class=\"f\">").Append(escText).Append("</span>");
                    break;
                default:
                    sb.Append(escText);
                    break;
            }
        }

        return sb.ToString();
    }

    public static List<string> HighlightLines(string? code)
    {
        var src = CleanText(code);
        if (src.Length == 0) return [];
        return src.Split('\n').Select(Highlight).ToList();
    }
}
