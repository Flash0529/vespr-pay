namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class CommandPaletteTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(500, CommandPalette.MaxCommands);
        Assert.Equal(100, CommandPalette.MaxQueryLen);
        Assert.Equal(120, CommandPalette.MaxTitleLen);
        Assert.Equal(60, CommandPalette.MaxCatLen);
        Assert.Equal(50, CommandPalette.MaxShortcutLen);
        Assert.Equal(50, CommandPalette.MaxResults);
    }

    [Fact]
    public void NormalizeCommand_NormalizesValidCommandsAndSanitizesFields()
    {
        var cmd = CommandPalette.NormalizeCommand(
            id: "  file.save  ",
            title: "  Save File  ",
            category: "  File  ",
            shortcut: "  Mod+S  ",
            handler: _ => "saved",
            order: 5
        );
        Assert.NotNull(cmd);
        Assert.Equal("file.save", cmd.Id);
        Assert.Equal("Save File", cmd.Title);
        Assert.Equal("File", cmd.Category);
        Assert.Equal("Mod+S", cmd.Shortcut);
        Assert.NotNull(cmd.Handler);
        Assert.True(cmd.Enabled);
        Assert.Equal(5, cmd.Order);

        // Default category
        var simple = CommandPalette.NormalizeCommand(id: "test", title: "Test Action");
        Assert.NotNull(simple);
        Assert.Equal("General", simple.Category);
        Assert.True(simple.Enabled);
        Assert.Equal(0, simple.Order);
        Assert.Equal("", simple.Shortcut);
        Assert.Null(simple.Handler);

        // Rejection of invalid inputs
        Assert.Null(CommandPalette.NormalizeCommand(null, "title"));
        Assert.Null(CommandPalette.NormalizeCommand("", "title"));
        Assert.Null(CommandPalette.NormalizeCommand("valid", null));
        Assert.Null(CommandPalette.NormalizeCommand("valid", ""));
    }

    [Fact]
    public void FormatShortcut_FormatsShortcutsForPcAndMac()
    {
        // PC / Windows / Linux
        Assert.Equal("Ctrl+Shift+P", CommandPalette.FormatShortcut("Mod+Shift+P", false));
        Assert.Equal("Ctrl+K", CommandPalette.FormatShortcut("Mod+K", false));
        Assert.Equal("Alt+F", CommandPalette.FormatShortcut("Alt+F", false));
        Assert.Equal("F2", CommandPalette.FormatShortcut("F2", false));
        Assert.Equal("Esc", CommandPalette.FormatShortcut("Escape", false));
        Assert.Equal("Enter", CommandPalette.FormatShortcut("Enter", false));

        // macOS
        Assert.Equal("⇧⌘P", CommandPalette.FormatShortcut("Mod+Shift+P", true));
        Assert.Equal("⌘K", CommandPalette.FormatShortcut("Mod+K", true));
        Assert.Equal("⌃⌥⇧⌘P", CommandPalette.FormatShortcut("Ctrl+Alt+Shift+Mod+P", true));
        Assert.Equal("↵", CommandPalette.FormatShortcut("Enter", true));
        Assert.Equal("Esc", CommandPalette.FormatShortcut("Escape", true));
        Assert.Equal("Del", CommandPalette.FormatShortcut("Delete", true));
        Assert.Equal("⌫", CommandPalette.FormatShortcut("Backspace", true));

        // Invalid inputs
        Assert.Equal("", CommandPalette.FormatShortcut(null));
        Assert.Equal("", CommandPalette.FormatShortcut(""));
    }

    [Fact]
    public void MatchShortcut_MatchesKeyboardEventsAgainstShortcutDefinitions()
    {
        // Mod key on PC (Ctrl) or Mac (Meta)
        Assert.True(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(CtrlKey: true, Key: "k"), "Mod+K"));
        Assert.True(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(MetaKey: true, Key: "k"), "Mod+K"));
        Assert.True(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(CtrlKey: true, ShiftKey: true, Key: "P"), "Mod+Shift+P"));

        // Reject missing modifier or extra modifier
        Assert.False(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(ShiftKey: true, Key: "P"), "Mod+Shift+P"));
        Assert.False(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(CtrlKey: true, ShiftKey: true, AltKey: true, Key: "P"), "Mod+Shift+P"));

        // Special keys
        Assert.True(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(Key: "Escape"), "Escape"));
        Assert.True(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(Key: "F2"), "F2"));

        // Invalid event inputs
        Assert.False(CommandPalette.MatchShortcut(null, "Mod+K"));
        Assert.False(CommandPalette.MatchShortcut(new CommandPalette.KeyboardEvent(), null));
    }

    [Fact]
    public void ScoreCommand_FuzzyScoresQueryAgainstCommandTitleAndCategory()
    {
        var cmd = new CommandPalette.CommandItem("view.terminal", "Toggle Terminal", "View");
        var sExact = CommandPalette.ScoreCommand("Toggle Terminal", cmd);
        var sPartial = CommandPalette.ScoreCommand("term", cmd);
        var sCategory = CommandPalette.ScoreCommand("View", cmd);
        var sMismatch = CommandPalette.ScoreCommand("xyz123", cmd);

        Assert.NotNull(sExact);
        Assert.True(sExact.Value > 100);
        Assert.NotNull(sPartial);
        Assert.True(sPartial.Value > 0);
        Assert.NotNull(sCategory);
        Assert.True(sCategory.Value > 0);
        Assert.Null(sMismatch);

        // Empty query returns 0
        Assert.Equal(0, CommandPalette.ScoreCommand("", cmd));
        Assert.Equal(0, CommandPalette.ScoreCommand("   ", cmd));
        Assert.Null(CommandPalette.ScoreCommand(null, cmd));
    }

    [Fact]
    public void MatchRanges_ComputesCharacterRangesForQueryMatchHighlights()
    {
        var ranges = CommandPalette.MatchRanges("term", "Toggle Terminal");
        Assert.Single(ranges);
        Assert.Equal(7, ranges[0].Start);
        Assert.Equal(11, ranges[0].End);

        var disjoint = CommandPalette.MatchRanges("tt", "Toggle Terminal");
        Assert.Equal(2, disjoint.Count);
        Assert.Equal(0, disjoint[0].Start);
        Assert.Equal(1, disjoint[0].End);
        Assert.Equal(7, disjoint[1].Start);
        Assert.Equal(8, disjoint[1].End);

        Assert.Empty(CommandPalette.MatchRanges("", "Toggle Terminal"));
        Assert.Empty(CommandPalette.MatchRanges(null, "Toggle Terminal"));
        Assert.Empty(CommandPalette.MatchRanges("xyz", "Toggle Terminal"));
    }

    [Fact]
    public void CreateCommandPalette_RegistersAndRetrievesCommandsSafely()
    {
        var palette = CommandPalette.CreateCommandPalette();
        Assert.Equal(0, palette.Size);

        var ok = palette.Register(new CommandPalette.CommandItem(
            Id: "cmd.test",
            Title: "Test Command",
            Category: "Tools",
            Shortcut: "Mod+T",
            Handler: _ => 42
        ));
        Assert.True(ok);
        Assert.Equal(1, palette.Size);
        Assert.True(palette.Has("cmd.test"));
        Assert.False(palette.Has("nonexistent"));

        var retrieved = palette.Get("cmd.test");
        Assert.NotNull(retrieved);
        Assert.Equal("cmd.test", retrieved.Id);
        Assert.Equal("Test Command", retrieved.Title);

        // Overwriting updates without growing size
        palette.Register(new CommandPalette.CommandItem(
            Id: "cmd.test",
            Title: "Updated Title",
            Category: "Tools"
        ));
        Assert.Equal(1, palette.Size);
        Assert.Equal("Updated Title", palette.Get("cmd.test")!.Title);

        // Unregister
        Assert.True(palette.Unregister("cmd.test"));
        Assert.Equal(0, palette.Size);
        Assert.False(palette.Unregister("cmd.test"));
    }

    [Fact]
    public void CreateCommandPalette_AcceptsInitialItemsAndRespectsMaxCommands()
    {
        var bigPalette = CommandPalette.CreateCommandPalette();
        for (int i = 0; i < CommandPalette.MaxCommands; i++)
        {
            bigPalette.Register(new CommandPalette.CommandItem("cmd_" + i, "Command " + i));
        }
        Assert.Equal(CommandPalette.MaxCommands, bigPalette.Size);

        // Registering over capacity returns false
        Assert.False(bigPalette.Register(new CommandPalette.CommandItem("overflow", "Overflow")));
        Assert.Equal(CommandPalette.MaxCommands, bigPalette.Size);
    }

    [Fact]
    public void ListAndCategories_ListsCommandsAndReturnsSortedUniqueCategories()
    {
        var palette = CommandPalette.CreateCommandPalette([
            new CommandPalette.CommandItem("c1", "Zebra", "Edit", Enabled: true),
            new CommandPalette.CommandItem("c2", "Apple", "File", Enabled: true),
            new CommandPalette.CommandItem("c3", "Beta", "Edit", Enabled: false)
        ]);

        var cats = palette.Categories();
        Assert.Equal(["Edit", "File"], cats);

        var all = palette.List();
        Assert.Equal(3, all.Count);

        var enabledOnly = palette.List(enabledOnly: true);
        Assert.Equal(2, enabledOnly.Count);

        var editOnly = palette.List(category: "Edit");
        Assert.Equal(2, editOnly.Count);
    }

    [Fact]
    public void QuerySearchAndRanking_SearchesAndRanksCommandsByFuzzyScore()
    {
        var palette = CommandPalette.CreateCommandPalette([
            new CommandPalette.CommandItem("file.new", "New File", "File"),
            new CommandPalette.CommandItem("file.open", "Open File", "File"),
            new CommandPalette.CommandItem("view.sidebar", "Toggle Sidebar", "View"),
            new CommandPalette.CommandItem("view.terminal", "Toggle Terminal", "View"),
            new CommandPalette.CommandItem("git.status", "Git: Status", "Git")
        ]);

        // Empty query returns all up to limit
        var emptyRes = palette.Query("", limit: 2);
        Assert.Equal(2, emptyRes.Count);
        Assert.Equal(0, emptyRes[0].Score);

        // Specific query
        var termRes = palette.Query("terminal");
        Assert.Single(termRes);
        Assert.Equal("view.terminal", termRes[0].Command.Id);
        Assert.True(termRes[0].Score > 0);
        Assert.Single(termRes[0].Matches);
        Assert.Equal(7, termRes[0].Matches[0].Start);
        Assert.Equal(15, termRes[0].Matches[0].End);

        // Category search
        var gitRes = palette.Query("git");
        Assert.Single(gitRes);
        Assert.Equal("git.status", gitRes[0].Command.Id);
    }

    [Fact]
    public void ExecuteAndTrigger_SafelyExecutesCommandsAndHandlesErrorsWithoutThrowing()
    {
        var called = false;
        var palette = CommandPalette.CreateCommandPalette([
            new CommandPalette.CommandItem("run.ok", "Run OK", Handler: args => { called = true; return "res: " + args[0]; }),
            new CommandPalette.CommandItem("run.err", "Run Err", Handler: _ => throw new InvalidOperationException("boom")),
            new CommandPalette.CommandItem("run.disabled", "Disabled", Enabled: false, Handler: _ => "nope"),
            new CommandPalette.CommandItem("run.nohandler", "No Handler")
        ]);

        var resOk = palette.Execute("run.ok", "test");
        Assert.True(called);
        Assert.True(resOk.Success);
        Assert.Equal("res: test", resOk.Result);

        // Alias trigger
        var resTrigger = palette.Trigger("run.ok", "again");
        Assert.True(resTrigger.Success);
        Assert.Equal("res: again", resTrigger.Result);

        // Error handling
        var resErr = palette.Execute("run.err");
        Assert.False(resErr.Success);
        Assert.Equal("boom", resErr.Error);

        // Disabled command
        var resDis = palette.Execute("run.disabled");
        Assert.False(resDis.Success);
        Assert.Equal("Command is disabled", resDis.Error);

        // Missing command
        var resMissing = palette.Execute("missing");
        Assert.False(resMissing.Success);
        Assert.Equal("Command not found", resMissing.Error);

        // No handler
        var resNoH = palette.Execute("run.nohandler");
        Assert.False(resNoH.Success);
        Assert.Equal("Command has no handler", resNoH.Error);
    }

    [Fact]
    public void HostileInputImmunity_ForAllCommandPaletteFunctions()
    {
        var palette = CommandPalette.CreateCommandPalette();

        Assert.False(palette.Register(null));
        Assert.False(palette.Register(new CommandPalette.CommandItem("", "title")));

        // Huge inputs
        var hugeId = new string('a', 20000);
        var hugeQuery = new string('b', 20000);
        palette.Register(new CommandPalette.CommandItem(hugeId, "Huge"));
        Assert.True(palette.Has(hugeId[..CommandPalette.MaxTitleLen]));

        var hugeRes = palette.Query(hugeQuery);
        Assert.Empty(hugeRes);

        // Invalid query params
        Assert.NotNull(palette.Query(null, limit: -5));
    }
}
