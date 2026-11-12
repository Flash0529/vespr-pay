namespace Vespr.Core.Tests;

using Vespr.Core;
using Xunit;

public class ContextMenuTests
{
    [Fact]
    public void Constants_ExistAndHaveExpectedBounds()
    {
        Assert.Equal(50, ContextMenu.MaxMenuItems);
        Assert.Equal(100, ContextMenu.MaxLabelLen);
        Assert.Equal(60, ContextMenu.MaxIdLen);
        Assert.Equal(8, ContextMenu.DefaultMargin);
    }

    [Fact]
    public void NormalizeMenuItem_NormalizesMenuItemsSeparatorsAndSubmenus()
    {
        var item = ContextMenu.NormalizeMenuItem(new ContextMenu.MenuItem(
            Id: "  copy-all  ",
            Label: "  Copy All  ",
            Shortcut: "Mod+Shift+C",
            Action: () => "ok"
        ));
        Assert.NotNull(item);
        Assert.Equal("copy-all", item.Id);
        Assert.Equal("Copy All", item.Label);
        Assert.Equal("Mod+Shift+C", item.Shortcut);
        Assert.NotNull(item.Action);
        Assert.False(item.Disabled);

        // Separator
        var sep = ContextMenu.NormalizeMenuItem(new ContextMenu.MenuItem(Separator: true));
        Assert.NotNull(sep);
        Assert.True(sep.Separator);

        // Submenu
        var parent = ContextMenu.NormalizeMenuItem(new ContextMenu.MenuItem(
            Label: "Share",
            Children: [
                new ContextMenu.MenuItem(Label: "Copy Link"),
                new ContextMenu.MenuItem(Separator: true)
            ]
        ));
        Assert.NotNull(parent);
        Assert.NotNull(parent.Children);
        Assert.Equal(2, parent.Children.Count);
        Assert.Equal("Copy Link", parent.Children[0].Label);

        // Rejection of invalid inputs
        Assert.Null(ContextMenu.NormalizeMenuItem(null));
        Assert.Null(ContextMenu.NormalizeMenuItem(new ContextMenu.MenuItem()));
        Assert.Null(ContextMenu.NormalizeMenuItem(new ContextMenu.MenuItem(Id: "", Label: "")));
    }

    [Fact]
    public void CreateFileMenu_BuildsFileAndFolderContextMenuPresets()
    {
        var dirMenu = ContextMenu.CreateFileMenu(new ContextMenu.FileMenuOptions(IsDir: true, CanPaste: true));
        Assert.Contains(dirMenu, it => it.Id == "new-file");
        Assert.Contains(dirMenu, it => it.Id == "new-folder");
        Assert.Contains(dirMenu, it => it.Id == "paste" && !it.Disabled);
        Assert.Contains(dirMenu, it => it.Id == "delete" && it.Danger);

        var fileMenu = ContextMenu.CreateFileMenu(new ContextMenu.FileMenuOptions(IsDir: false));
        Assert.DoesNotContain(fileMenu, it => it.Id == "new-file");
        Assert.DoesNotContain(fileMenu, it => it.Id == "paste");
        Assert.Contains(fileMenu, it => it.Id == "rename");
    }

    [Fact]
    public void CreateTabMenu_BuildsTabContextMenuPresetsBasedOnTabPositionAndCount()
    {
        // Single pinned tab
        var single = ContextMenu.CreateTabMenu(new ContextMenu.TabMenuOptions(IsPinned: true, TabCount: 1, Index: 0));
        Assert.Contains(single, it => it.Id == "pin" && it.Label == "Unpin Tab");
        Assert.Contains(single, it => it.Id == "close-others" && it.Disabled);
        Assert.Contains(single, it => it.Id == "close-right" && it.Disabled);

        // Middle tab in multi-tab window
        var middle = ContextMenu.CreateTabMenu(new ContextMenu.TabMenuOptions(IsPinned: false, TabCount: 3, Index: 1));
        Assert.Contains(middle, it => it.Id == "pin" && it.Label == "Pin Tab");
        Assert.Contains(middle, it => it.Id == "close-others" && !it.Disabled);
        Assert.Contains(middle, it => it.Id == "close-right" && !it.Disabled);
    }

    [Fact]
    public void CreateEditorMenu_BuildsEditorContextMenuPresetsRespectingSelectionAndReadOnly()
    {
        // Normal edit with selection
        var selected = ContextMenu.CreateEditorMenu(new ContextMenu.EditorMenuOptions(HasSelection: true, ReadOnly: false));
        Assert.Contains(selected, it => it.Id == "cut" && !it.Disabled);
        Assert.Contains(selected, it => it.Id == "copy" && !it.Disabled);
        Assert.Contains(selected, it => it.Id == "format-document" && !it.Disabled);

        // Read-only without selection
        var ro = ContextMenu.CreateEditorMenu(new ContextMenu.EditorMenuOptions(HasSelection: false, ReadOnly: true));
        Assert.Contains(ro, it => it.Id == "cut" && it.Disabled);
        Assert.Contains(ro, it => it.Id == "copy" && it.Disabled);
        Assert.Contains(ro, it => it.Id == "paste" && it.Disabled);
        Assert.Contains(ro, it => it.Id == "format-document" && it.Disabled);
    }

    [Fact]
    public void NavigateMenu_ArrowDown_NavigatesForwardSkippingSeparatorsAndDisabled()
    {
        var items = new List<ContextMenu.MenuItem>
        {
            new(Id: "1", Label: "First"),
            new(Separator: true),
            new(Id: "2", Label: "Disabled", Disabled: true),
            new(Id: "3", Label: "Third")
        };

        // From beginning (-1) -> index 0
        Assert.Equal(0, ContextMenu.NavigateMenu(items, -1, "ArrowDown")!.Index);
        // From 0 -> skips separator (1) and disabled (2) -> index 3
        Assert.Equal(3, ContextMenu.NavigateMenu(items, 0, "ArrowDown")!.Index);
        // From 3 -> wraps back to index 0
        Assert.Equal(0, ContextMenu.NavigateMenu(items, 3, "ArrowDown")!.Index);
    }

    [Fact]
    public void NavigateMenu_ArrowUp_NavigatesBackwardThroughSelectableItemsAndWrapsAround()
    {
        var items = new List<ContextMenu.MenuItem>
        {
            new(Id: "1", Label: "First"),
            new(Separator: true),
            new(Id: "2", Label: "Second")
        };

        // From 0 -> wraps to index 2
        Assert.Equal(2, ContextMenu.NavigateMenu(items, 0, "ArrowUp")!.Index);
        // From 2 -> back to index 0
        Assert.Equal(0, ContextMenu.NavigateMenu(items, 2, "ArrowUp")!.Index);
    }

    [Fact]
    public void NavigateMenu_HomeAndEnd_JumpsToFirstAndLastSelectableItem()
    {
        var items = new List<ContextMenu.MenuItem>
        {
            new(Separator: true),
            new(Id: "1", Label: "First"),
            new(Id: "2", Label: "Middle"),
            new(Id: "3", Label: "Last"),
            new(Separator: true)
        };

        Assert.Equal(1, ContextMenu.NavigateMenu(items, -1, "Home")!.Index);
        Assert.Equal(3, ContextMenu.NavigateMenu(items, -1, "End")!.Index);
        Assert.Null(ContextMenu.NavigateMenu([], -1, "Home"));
    }

    [Fact]
    public void ComputePopupPosition_NormalPlacement_ComputesStandardDropdownBelowTarget()
    {
        var target = new ContextMenu.PositionTarget(100, 50, 80, 30);
        var popup = new ContextMenu.PopupSize(150, 200);
        var viewport = new ContextMenu.ViewportSize(1000, 800);

        var pos = ContextMenu.ComputePopupPosition(target, popup, viewport);
        Assert.Equal(100, pos.X);
        Assert.Equal(80, pos.Y); // 50 + 30
        Assert.Equal("bottom-start", pos.Placement);
    }

    [Fact]
    public void ComputePopupPosition_FlippingAndClamping()
    {
        var target = new ContextMenu.PositionTarget(950, 700, 20, 20);
        var popup = new ContextMenu.PopupSize(200, 180);
        var viewport = new ContextMenu.ViewportSize(1000, 750);

        var pos = ContextMenu.ComputePopupPosition(target, popup, viewport);
        // Should flip upward: ty - ph = 700 - 180 = 520
        Assert.Equal(520, pos.Y);
        Assert.Equal("top-start", pos.Placement);
        // Should clamp X so it fits inside viewport - margin: 1000 - 200 - 8 = 792
        Assert.Equal(792, pos.X);
    }

    [Fact]
    public void CreateMenu_ManagesContextMenuOpenCloseAndKeyboardInteractionState()
    {
        var menu = ContextMenu.CreateMenu();
        Assert.False(menu.IsOpen);

        var shown = menu.Show([
            new ContextMenu.MenuItem(Id: "save", Label: "Save"),
            new ContextMenu.MenuItem(Id: "close", Label: "Close")
        ], x: 120, y: 240);

        Assert.True(shown);
        Assert.True(menu.IsOpen);
        Assert.Equal(120, menu.X);
        Assert.Equal(240, menu.Y);
        Assert.Equal(2, menu.Items.Count);
        Assert.Equal(-1, menu.SelectedIndex);

        // ArrowDown selects first item
        var navDown = menu.HandleKey("ArrowDown");
        Assert.NotNull(navDown);
        Assert.Equal("select", navDown.Action);
        Assert.Equal(0, navDown.Index);
        Assert.Equal(0, menu.SelectedIndex);

        // Enter triggers execution and closes
        var enterRes = menu.HandleKey("Enter");
        Assert.NotNull(enterRes);
        Assert.Equal("execute", enterRes.Action);
        Assert.Equal("save", enterRes.Item!.Id);
        Assert.False(menu.IsOpen);

        // Re-open and Escape closes
        menu.Show([new ContextMenu.MenuItem(Id: "test", Label: "Test")]);
        Assert.True(menu.IsOpen);
        var escRes = menu.HandleKey("Escape");
        Assert.NotNull(escRes);
        Assert.Equal("close", escRes.Action);
        Assert.False(menu.IsOpen);
    }

    [Fact]
    public void HostileInputImmunity_HandlesHostileInputsGracefully()
    {
        Assert.False(ContextMenu.CreateMenu().Show(null));

        var pos = ContextMenu.ComputePopupPosition(
            new ContextMenu.PositionTarget(double.NaN, double.PositiveInfinity),
            null,
            null
        );
        Assert.True(double.IsFinite(pos.X));
        Assert.True(double.IsFinite(pos.Y));
    }
}
