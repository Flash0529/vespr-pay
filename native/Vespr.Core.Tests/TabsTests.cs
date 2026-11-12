namespace Vespr.Core.Tests;

public class TabsTests
{
    [Fact]
    public void Constants_match_javascript()
    {
        Assert.Equal(16, Tabs.MaxTabs);
        Assert.Equal(300, Tabs.MaxPath);
    }

    [Fact]
    public void Open_adds_tabs_and_sets_active()
    {
        var m = new Tabs();
        var r1 = m.Open("src/a.py");
        Assert.Equal("src/a.py", r1.Active);
        Assert.Equal(new[] { "src/a.py" }, m.Paths());
        Assert.Equal("src/a.py", m.Active());

        var r2 = m.Open("src/b.py");
        Assert.Equal("src/b.py", r2.Active);
        Assert.Equal(new[] { "src/a.py", "src/b.py" }, m.Paths());
    }

    [Fact]
    public void Reopening_an_existing_tab_activates_it_without_duplicating()
    {
        var m = new Tabs();
        m.Open("a.py");
        m.Open("b.py");
        m.Open("a.py");
        Assert.Equal("a.py", m.Active());
        Assert.Equal(new[] { "a.py", "b.py" }, m.Paths());
    }

    [Fact]
    public void Max_limit_evicts_the_least_recently_used_unpinned_tab()
    {
        var m = new Tabs(3);
        m.Open("1.py");
        m.Open("2.py");
        m.Open("3.py");
        // Touch 1.py so 2.py is least recently used
        m.Open("1.py");

        // Open 4.py -> should evict 2.py
        var r = m.Open("4.py");
        Assert.Equal("2.py", r.Evicted);
        Assert.Equal(new[] { "1.py", "3.py", "4.py" }, m.Paths());
        Assert.Equal("4.py", m.Active());
    }

    [Fact]
    public void Pinned_tabs_are_protected_from_eviction()
    {
        var m = new Tabs(3);
        m.Open("1.py");
        m.Pin("1.py", true);
        m.Open("2.py");
        m.Open("3.py");

        // Access 3.py, 1.py is pinned, 2.py is unpinned and LRU
        m.Open("3.py");
        var r = m.Open("4.py");
        Assert.Equal("2.py", r.Evicted);
        Assert.Equal(new[] { "1.py", "3.py", "4.py" }, m.Paths());
        Assert.True(m.List().Find(it => it.Path == "1.py")!.Pinned);
    }

    [Fact]
    public void Closing_active_tab_selects_adjacent_right_or_left_tab()
    {
        var m = new Tabs();
        m.Open("a.py");
        m.Open("b.py");
        m.Open("c.py");

        // Active is c.py (last). Close c.py -> next active should be b.py (left)
        var r1 = m.Close("c.py");
        Assert.Equal("c.py", r1.Closed);
        Assert.Equal("b.py", r1.Active);
        Assert.Equal("b.py", m.Active());

        // Active is b.py. Switch to a.py, close a.py -> next active is b.py (right)
        m.Open("a.py");
        var r2 = m.Close("a.py");
        Assert.Equal("a.py", r2.Closed);
        Assert.Equal("b.py", r2.Active);
        Assert.Equal("b.py", m.Active());

        // Close last remaining tab
        var r3 = m.Close("b.py");
        Assert.Equal("b.py", r3.Closed);
        Assert.Equal("", r3.Active);
        Assert.Equal("", m.Active());
        Assert.Empty(m.Paths());
    }

    [Fact]
    public void CloseOthers_preserves_pinned_tabs_and_target_tab()
    {
        var m = new Tabs();
        m.Open("1.py");
        m.Pin("1.py", true);
        m.Open("2.py");
        m.Open("3.py");
        m.Open("4.py");

        var r = m.CloseOthers("3.py");
        Assert.Equal(new[] { "2.py", "4.py" }, r.Closed);
        Assert.Equal(new[] { "1.py", "3.py" }, m.Paths());
        Assert.Equal("3.py", m.Active());
    }

    [Fact]
    public void CloseOthers_on_unknown_target_is_a_noop_and_preserves_all_tabs()
    {
        var m = new Tabs();
        m.Open("1.py");
        m.Open("2.py");
        var r = m.CloseOthers("unknown.py");
        Assert.Empty(r.Closed);
        Assert.Equal(new[] { "1.py", "2.py" }, m.Paths());
        Assert.Equal("2.py", m.Active());
    }

    [Fact]
    public void CloseToRight_only_closes_unpinned_tabs_to_the_right_of_target()
    {
        var m = new Tabs();
        m.Open("a.py");
        m.Open("b.py");
        m.Open("c.py");
        m.Open("d.py");
        m.Pin("d.py", true);
        m.Open("e.py");

        // Order: a, b, c, d (pinned), e
        var r = m.CloseToRight("b.py");
        Assert.Equal(new[] { "c.py", "e.py" }, r.Closed);
        Assert.Equal(new[] { "a.py", "b.py", "d.py" }, m.Paths());
    }

    [Fact]
    public void Move_reorders_tabs_safely()
    {
        var m = new Tabs();
        m.Open("a.py");
        m.Open("b.py");
        m.Open("c.py");

        Assert.True(m.Move(0, 2));
        Assert.Equal(new[] { "b.py", "c.py", "a.py" }, m.Paths());

        // Out of bounds returns false without modifying
        Assert.False(m.Move(-1, 2));
        Assert.False(m.Move(0, 10));
        Assert.Equal(new[] { "b.py", "c.py", "a.py" }, m.Paths());
    }

    [Fact]
    public void Rename_updates_single_file_and_rewrites_folder_prefixes()
    {
        var m = new Tabs();
        m.Open("src/a.py");
        m.Open("src/sub/b.py");
        m.Open("lib/c.py");

        // Rename single file
        Assert.True(m.Rename("lib/c.py", "lib/main.py"));
        Assert.Equal(new[] { "src/a.py", "src/sub/b.py", "lib/main.py" }, m.Paths());

        // Rename folder src -> pkg
        Assert.True(m.Rename("src", "pkg"));
        Assert.Equal(new[] { "pkg/a.py", "pkg/sub/b.py", "lib/main.py" }, m.Paths());
        Assert.Equal("lib/main.py", m.Active());
    }

    [Fact]
    public void Rename_collision_preserves_pinned_status_of_either_tab()
    {
        var m = new Tabs();
        m.Open("a.py");
        m.Pin("a.py", true);
        m.Open("b.py");
        // Rename b.py to a.py -> should merge and retain pinned
        Assert.True(m.Rename("b.py", "a.py"));
        Assert.Equal(new[] { "a.py" }, m.Paths());
        Assert.True(m.List()[0].Pinned);

        var m2 = new Tabs();
        m2.Open("x.py");
        m2.Open("y.py");
        m2.Pin("y.py", true);
        // Rename unpinned x.py to pinned y.py -> resulting tab must remain pinned
        Assert.True(m2.Rename("x.py", "y.py"));
        Assert.Equal(new[] { "y.py" }, m2.Paths());
        Assert.True(m2.List()[0].Pinned);
    }

    [Fact]
    public void Folder_rename_exceeding_MAX_PATH_skips_invalid_targets()
    {
        var m = new Tabs();
        m.Open("short/file.js");
        var giantPrefix = new string('x', Tabs.MaxPath);
        var res = m.Rename("short", giantPrefix);
        foreach (var p in m.Paths())
        {
            Assert.True(p.Length <= Tabs.MaxPath);
        }
    }

    [Fact]
    public void Serialize_and_deserialize_round_trip_preserves_state()
    {
        var m = new Tabs();
        m.Open("a.py");
        m.Open("b.py");
        m.Pin("b.py", true);
        m.Open("c.py");

        var json = m.Serialize();
        var m2 = new Tabs();
        Assert.True(m2.Deserialize(json));
        Assert.Equal("c.py", m2.Active());
        Assert.Equal(new[] {
            new Tabs.TabItem("a.py", false),
            new Tabs.TabItem("b.py", true),
            new Tabs.TabItem("c.py", false)
        }, m2.List());
    }

    [Fact]
    public void Hostile_inputs_do_not_throw_and_are_handled_cleanly()
    {
        var m = new Tabs(-5);
        m.Open(null);
        m.Open("");
        m.Open("a\0b");
        m.Open(new string('x', Tabs.MaxPath + 10));
        Assert.Empty(m.Paths());

        m.Close(null);
        m.Pin(null);
        m.Move(-1, 5);
        m.Rename(null, null);

        Assert.False(m.Deserialize("not json"));
        Assert.False(m.Deserialize("{\"__proto__\": {\"polluted\": true}}"));
        Assert.True(m.Deserialize("{\"items\": [null, 123, {\"path\": \"\"}]}"));
        Assert.Empty(m.Paths());
    }
}
