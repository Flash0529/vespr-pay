namespace Vespr.Core;

using System.Text.RegularExpressions;

/// <summary>
/// Command palette registry, search, shortcut formatter, and dispatch for the SDE shell. Port of app/commandpalette.js.
/// </summary>
public static class CommandPalette
{
    public const int MaxCommands = 500;
    public const int MaxQueryLen = 100;
    public const int MaxTitleLen = 120;
    public const int MaxCatLen = 60;
    public const int MaxShortcutLen = 50;
    public const int MaxResults = 50;

    public record CommandItem(
        string Id,
        string Title,
        string Category = "General",
        string Shortcut = "",
        Func<object?[], object?>? Handler = null,
        bool Enabled = true,
        int Order = 0
    );

    public record KeyboardEvent(
        bool CtrlKey = false,
        bool MetaKey = false,
        bool ShiftKey = false,
        bool AltKey = false,
        string? Key = null,
        string? Code = null
    );

    public record MatchRange(int Start, int End);

    public record ScoredCommand(
        CommandItem Command,
        int Score,
        List<MatchRange> Matches,
        int Index = 0
    );

    public record ExecutionResult(
        bool Success,
        object? Result = null,
        string? Error = null
    );

    private static readonly HashSet<char> WordDelims = [' ', '-', '_', '.', '/', ':'];

    public static CommandItem? NormalizeCommand(
        string? id,
        string? title,
        string? category = null,
        string? shortcut = null,
        Func<object?[], object?>? handler = null,
        bool enabled = true,
        int order = 0)
    {
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        var cleanId = id.Trim();
        if (cleanId.Length > MaxTitleLen) cleanId = cleanId[..MaxTitleLen];

        var cleanTitle = title.Trim();
        if (cleanTitle.Length > MaxTitleLen) cleanTitle = cleanTitle[..MaxTitleLen];

        var cleanCategory = !string.IsNullOrWhiteSpace(category) ? category.Trim() : "General";
        if (cleanCategory.Length > MaxCatLen) cleanCategory = cleanCategory[..MaxCatLen];

        var cleanShortcut = !string.IsNullOrWhiteSpace(shortcut) ? shortcut.Trim() : "";
        if (cleanShortcut.Length > MaxShortcutLen) cleanShortcut = cleanShortcut[..MaxShortcutLen];

        return new CommandItem(
            Id: cleanId,
            Title: cleanTitle,
            Category: cleanCategory,
            Shortcut: cleanShortcut,
            Handler: handler,
            Enabled: enabled,
            Order: order
        );
    }

    public static string FormatShortcut(string? keys, bool isMac = false)
    {
        if (string.IsNullOrWhiteSpace(keys)) return "";
        var trimmed = keys.Trim();
        if (trimmed.Length > MaxShortcutLen) trimmed = trimmed[..MaxShortcutLen];
        if (trimmed.Length == 0) return "";

        var parts = trimmed.Split('+');
        var key = parts.Length > 0 ? parts[^1].Trim() : "+";
        var mods = new HashSet<string>(parts.Take(parts.Length - 1).Select(p => p.Trim()), StringComparer.Ordinal);

        if (isMac)
        {
            var outMac = "";
            if (mods.Contains("Ctrl") || mods.Contains("Control")) outMac += "⌃";
            if (mods.Contains("Alt") || mods.Contains("Option")) outMac += "⌥";
            if (mods.Contains("Shift")) outMac += "⇧";
            if (mods.Contains("Mod") || mods.Contains("Cmd") || mods.Contains("Meta")) outMac += "⌘";

            var mapped = key switch
            {
                "Enter" or "Return" => "↵",
                "Escape" or "Esc" => "Esc",
                "Delete" => "Del",
                "Backspace" => "⌫",
                "Tab" => "⇥",
                "ArrowUp" => "↑",
                "ArrowDown" => "↓",
                "ArrowLeft" => "←",
                "ArrowRight" => "→",
                _ => key.Length == 1 ? key.ToUpperInvariant() : key
            };
            return outMac + mapped;
        }

        var outPc = new List<string>();
        if (mods.Contains("Mod") || mods.Contains("Ctrl") || mods.Contains("Control") || mods.Contains("Cmd") || mods.Contains("Meta"))
        {
            outPc.Add("Ctrl");
        }
        if (mods.Contains("Alt") || mods.Contains("Option")) outPc.Add("Alt");
        if (mods.Contains("Shift")) outPc.Add("Shift");

        var mappedPc = key switch
        {
            "Enter" or "Return" => "Enter",
            "Escape" or "Esc" => "Esc",
            "Delete" => "Delete",
            "Backspace" => "Backspace",
            "Tab" => "Tab",
            "ArrowUp" => "Up",
            "ArrowDown" => "Down",
            "ArrowLeft" => "Left",
            "ArrowRight" => "Right",
            _ => key.Length == 1 ? key.ToUpperInvariant() : key
        };
        outPc.Add(mappedPc);
        return string.Join("+", outPc);
    }

    public static bool MatchShortcut(KeyboardEvent? evt, string? keys)
    {
        if (evt is null || string.IsNullOrWhiteSpace(keys)) return false;
        var trimmed = keys.Trim();
        if (trimmed.Length > MaxShortcutLen) trimmed = trimmed[..MaxShortcutLen];
        if (trimmed.Length == 0) return false;

        var parts = trimmed.Split('+');
        var expectedKey = parts.Length > 0 ? parts[^1].Trim() : "+";
        var mods = new HashSet<string>(parts.Take(parts.Length - 1).Select(p => p.Trim()), StringComparer.Ordinal);

        var hasMod = mods.Contains("Mod");
        var reqCtrl = mods.Contains("Ctrl") || mods.Contains("Control");
        var reqMeta = mods.Contains("Cmd") || mods.Contains("Meta");
        var reqShift = mods.Contains("Shift");
        var reqAlt = mods.Contains("Alt") || mods.Contains("Option");

        var eventMod = evt.CtrlKey || evt.MetaKey;
        if (hasMod)
        {
            if (!eventMod) return false;
        }
        else
        {
            if (reqCtrl != evt.CtrlKey) return false;
            if (reqMeta != evt.MetaKey) return false;
        }
        if (reqShift != evt.ShiftKey) return false;
        if (reqAlt != evt.AltKey) return false;

        var ek = evt.Key ?? "";
        if (expectedKey.Length == 1)
        {
            if (string.Equals(ek, expectedKey, StringComparison.OrdinalIgnoreCase)) return true;
            if (!string.IsNullOrEmpty(evt.Code))
            {
                if (char.IsAsciiLetter(expectedKey[0]) && evt.Code == "Key" + char.ToUpperInvariant(expectedKey[0]))
                {
                    return true;
                }
                if (char.IsAsciiDigit(expectedKey[0]) && evt.Code == "Digit" + expectedKey)
                {
                    return true;
                }
            }
            return false;
        }
        return string.Equals(ek, expectedKey, StringComparison.OrdinalIgnoreCase);
    }

    public static int? ScoreCommand(string? query, CommandItem? command)
    {
        if (query is null) return null;
        var qClean = query.Trim();
        if (qClean.Length > MaxQueryLen) qClean = qClean[..MaxQueryLen];
        if (qClean.Length == 0) return 0;
        if (command is null) return null;

        var title = command.Title.Length > MaxTitleLen ? command.Title[..MaxTitleLen] : command.Title;
        var category = (command.Category ?? "").Length > MaxCatLen ? command.Category![..MaxCatLen] : (command.Category ?? "");
        var fullText = (!string.IsNullOrEmpty(category) ? category + ": " + title : title).ToLowerInvariant();
        var q = Regex.Replace(qClean.ToLowerInvariant(), @"\s+", "");

        var indices = new List<int>(q.Length);
        var tIdx = 0;
        for (var k = 0; k < q.Length; k++)
        {
            var pos = fullText.IndexOf(q[k], tIdx);
            if (pos == -1) return null;
            indices.Add(pos);
            tIdx = pos + 1;
        }

        var total = 100 * q.Length;
        var catOffset = !string.IsNullOrEmpty(category) ? category.Length + 2 : 0;

        for (var k = 0; k < indices.Count; k++)
        {
            var i = indices[k];
            if (i == 0 || i == catOffset) total += 35;
            if (i == 0 || WordDelims.Contains(fullText[i - 1])) total += 25;
            if (k > 0 && i == indices[k - 1] + 1) total += 20;
            if (i >= catOffset) total += 10;
        }

        var penalty = Math.Max(0, fullText.Length - q.Length);
        return Math.Max(1, total - penalty);
    }

    public static List<MatchRange> MatchRanges(string? query, string? text)
    {
        if (query is null || text is null) return [];
        var qClean = Regex.Replace(query.Trim(), @"\s+", "").ToLowerInvariant();
        if (qClean.Length > MaxQueryLen) qClean = qClean[..MaxQueryLen];
        if (qClean.Length == 0) return [];

        var t = text.Length > MaxTitleLen ? text[..MaxTitleLen].ToLowerInvariant() : text.ToLowerInvariant();
        var exactIdx = t.IndexOf(qClean, StringComparison.Ordinal);
        if (exactIdx != -1)
        {
            return [new MatchRange(exactIdx, exactIdx + qClean.Length)];
        }

        var indices = new List<int>(qClean.Length);
        var tIdx = 0;
        for (var k = 0; k < qClean.Length; k++)
        {
            var pos = t.IndexOf(qClean[k], tIdx);
            if (pos == -1) return [];
            indices.Add(pos);
            tIdx = pos + 1;
        }

        var ranges = new List<MatchRange>();
        var start = indices[0];
        var prev = indices[0];
        for (var k = 1; k < indices.Count; k++)
        {
            var cur = indices[k];
            if (cur == prev + 1)
            {
                prev = cur;
            }
            else
            {
                ranges.Add(new MatchRange(start, prev + 1));
                start = cur;
                prev = cur;
            }
        }
        ranges.Add(new MatchRange(start, prev + 1));
        return ranges;
    }

    public static CommandPaletteRegistry CreateCommandPalette(IEnumerable<CommandItem>? items = null)
    {
        return new CommandPaletteRegistry(items);
    }
}

public class CommandPaletteRegistry
{
    private readonly Dictionary<string, CommandPalette.CommandItem> _registry = new(StringComparer.Ordinal);

    public CommandPaletteRegistry(IEnumerable<CommandPalette.CommandItem>? items = null)
    {
        if (items is not null)
        {
            foreach (var item in items)
            {
                Register(item);
            }
        }
    }

    public int Size => _registry.Count;

    public bool Register(CommandPalette.CommandItem? item)
    {
        if (item is null) return false;
        var cmd = CommandPalette.NormalizeCommand(
            id: item.Id,
            title: item.Title,
            category: item.Category,
            shortcut: item.Shortcut,
            handler: item.Handler,
            enabled: item.Enabled,
            order: item.Order
        );
        if (cmd is null) return false;
        if (_registry.Count >= CommandPalette.MaxCommands && !_registry.ContainsKey(cmd.Id))
        {
            return false;
        }
        _registry[cmd.Id] = cmd;
        return true;
    }

    public bool Unregister(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        return _registry.Remove(id.Trim());
    }

    public bool Has(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        return _registry.ContainsKey(id.Trim());
    }

    public CommandPalette.CommandItem? Get(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        return _registry.GetValueOrDefault(id.Trim());
    }

    public List<CommandPalette.CommandItem> List(string? category = null, bool enabledOnly = false)
    {
        var catFilter = !string.IsNullOrWhiteSpace(category) ? category.Trim() : null;
        var items = new List<CommandPalette.CommandItem>();

        foreach (var cmd in _registry.Values)
        {
            if (enabledOnly && !cmd.Enabled) continue;
            if (catFilter is not null && !string.Equals(cmd.Category, catFilter, StringComparison.OrdinalIgnoreCase)) continue;
            items.Add(cmd);
        }

        items.Sort((a, b) =>
        {
            if (a.Order != b.Order) return a.Order.CompareTo(b.Order);
            var catCmp = string.Compare(a.Category, b.Category, StringComparison.Ordinal);
            if (catCmp != 0) return catCmp;
            return string.Compare(a.Title, b.Title, StringComparison.Ordinal);
        });

        return items;
    }

    public List<string> Categories()
    {
        var set = new HashSet<string>(_registry.Values.Select(c => c.Category), StringComparer.Ordinal);
        var list = set.ToList();
        list.Sort(StringComparer.Ordinal);
        return list;
    }

    public List<CommandPalette.ScoredCommand> Query(
        string? searchStr,
        int limit = CommandPalette.MaxResults,
        string? category = null,
        bool enabledOnly = true)
    {
        var max = Math.Max(1, Math.Min(CommandPalette.MaxResults, limit <= 0 ? CommandPalette.MaxResults : limit));
        var catFilter = !string.IsNullOrWhiteSpace(category) ? category.Trim() : null;
        var rawQuery = searchStr is not null ? searchStr.Trim() : "";
        if (rawQuery.Length > CommandPalette.MaxQueryLen) rawQuery = rawQuery[..CommandPalette.MaxQueryLen];

        var candidates = new List<CommandPalette.CommandItem>();
        foreach (var cmd in _registry.Values)
        {
            if (enabledOnly && !cmd.Enabled) continue;
            if (catFilter is not null && !string.Equals(cmd.Category, catFilter, StringComparison.OrdinalIgnoreCase)) continue;
            candidates.Add(cmd);
        }

        if (string.IsNullOrEmpty(rawQuery))
        {
            candidates.Sort((a, b) =>
            {
                if (a.Order != b.Order) return a.Order.CompareTo(b.Order);
                var catCmp = string.Compare(a.Category, b.Category, StringComparison.Ordinal);
                if (catCmp != 0) return catCmp;
                return string.Compare(a.Title, b.Title, StringComparison.Ordinal);
            });

            return candidates.Take(max).Select(cmd => new CommandPalette.ScoredCommand(
                Command: cmd,
                Score: 0,
                Matches: []
            )).ToList();
        }

        var scored = new List<CommandPalette.ScoredCommand>();
        for (var i = 0; i < candidates.Count; i++)
        {
            var cmd = candidates[i];
            var s = CommandPalette.ScoreCommand(rawQuery, cmd);
            if (s is not null)
            {
                scored.Add(new CommandPalette.ScoredCommand(
                    Command: cmd,
                    Score: s.Value,
                    Matches: CommandPalette.MatchRanges(rawQuery, cmd.Title),
                    Index: i
                ));
            }
        }

        scored.Sort((a, b) =>
        {
            if (b.Score != a.Score) return b.Score.CompareTo(a.Score);
            if (a.Command.Title.Length != b.Command.Title.Length)
            {
                return a.Command.Title.Length.CompareTo(b.Command.Title.Length);
            }
            return a.Index.CompareTo(b.Index);
        });

        return scored.Take(max).ToList();
    }

    public CommandPalette.ExecutionResult Execute(string? id, params object?[] args)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return new CommandPalette.ExecutionResult(false, Error: "Invalid command identifier");
        }

        if (!_registry.TryGetValue(id.Trim(), out var cmd))
        {
            return new CommandPalette.ExecutionResult(false, Error: "Command not found");
        }

        if (!cmd.Enabled)
        {
            return new CommandPalette.ExecutionResult(false, Error: "Command is disabled");
        }

        if (cmd.Handler is null)
        {
            return new CommandPalette.ExecutionResult(false, Error: "Command has no handler");
        }

        try
        {
            var result = cmd.Handler(args);
            return new CommandPalette.ExecutionResult(true, Result: result);
        }
        catch (Exception ex)
        {
            return new CommandPalette.ExecutionResult(false, Error: ex.Message);
        }
    }

    public CommandPalette.ExecutionResult Trigger(string? id, params object?[] args)
    {
        return Execute(id, args);
    }

    public void Clear()
    {
        _registry.Clear();
    }
}
