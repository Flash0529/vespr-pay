using System.Text;

namespace Vespr.Core;

/// <summary>
/// The few places where C# and JavaScript disagree on strings, done the JavaScript way, so ported modules give the same answers as
/// the originals (the golden files prove it). Strings are UTF-16 in both languages, so indexes and lengths already agree.
/// </summary>
public static class Js
{
    /// <summary>
    /// JavaScript's String.prototype.toLowerCase: full Unicode lowercase, culture-independent. Unlike .NET's ToLowerInvariant it can
    /// change the length (U+0130 'İ' becomes "i̇") and it applies the Greek final-sigma rule (Σ at the end of a word becomes ς).
    /// </summary>
    public static string ToLowerCase(string s)
    {
        var sb = new StringBuilder(s.Length);
        var i = 0;
        foreach (var rune in s.EnumerateRunes())
        {
            if (rune.Value == 0x0130) sb.Append("i̇");
            else if (rune.Value == 0x03A3) sb.Append(IsFinalSigma(s, i) ? 'ς' : 'σ');
            else sb.Append(Rune.ToLowerInvariant(rune).ToString());
            i += rune.Utf16SequenceLength;
        }
        return sb.ToString();
    }

    // Final_Sigma (Unicode SpecialCasing): a cased letter comes before it and no cased letter comes after it (case-ignorable marks skipped).
    static bool IsFinalSigma(string s, int at)
    {
        bool Cased(char c) => char.IsLetter(c) && (char.IsUpper(c) || char.IsLower(c) || char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.TitlecaseLetter);
        bool Ignorable(char c) => char.GetUnicodeCategory(c) is System.Globalization.UnicodeCategory.NonSpacingMark or System.Globalization.UnicodeCategory.EnclosingMark or System.Globalization.UnicodeCategory.Format;
        var before = false;
        for (var j = at - 1; j >= 0; j--) { if (Ignorable(s[j])) continue; before = Cased(s[j]); break; }
        if (!before) return false;
        for (var j = at + 1; j < s.Length; j++) { if (Ignorable(s[j])) continue; return !Cased(s[j]); }
        return true;
    }

    /// <summary>JavaScript's \s: the characters a /\s/ regular expression matches (it includes U+FEFF, which .NET's \s does not).</summary>
    public static bool IsWhiteSpace(char c) => c switch
    {
        // U+2028 and U+2029 are written as numbers: in a C# character literal their \u escape counts as a line break
        '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or ' ' or ' ' or (char)0x2028 or (char)0x2029 or ' ' or ' ' or '　' or '﻿' => true,
        >= ' ' and <= ' ' => true,
        _ => false
    };

    /// <summary>s.replace(/\s+/g, ''): every JavaScript whitespace character removed.</summary>
    public static string RemoveWhiteSpace(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s) if (!IsWhiteSpace(c)) sb.Append(c);
        return sb.ToString();
    }

    /// <summary>JavaScript's String.prototype.trim: strips the same characters as \s from both ends (string.Trim() uses a different set).</summary>
    public static string Trim(string s)
    {
        int a = 0, b = s.Length;
        while (a < b && IsWhiteSpace(s[a])) a++;
        while (b > a && IsWhiteSpace(s[b - 1])) b--;
        return s[a..b];
    }

    /// <summary>JavaScript's default array sort for strings: by UTF-16 code units (string.CompareOrdinal), not by culture.</summary>
    public static int CompareStrings(string? x, string? y) => string.CompareOrdinal(x, y);

    /// <summary>s.slice(0, n) for n >= 0: never throws when the string is shorter.</summary>
    public static string Slice(string s, int end) => s.Length <= end ? s : s[..end];
}
