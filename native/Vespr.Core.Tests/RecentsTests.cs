namespace Vespr.Core.Tests;

public class RecentsTests
{
    [Fact]
    public void Constants_match_javascript()
    {
        Assert.Equal(12, Recents.MaxRecents);
        Assert.Equal(300, Recents.MaxPath);
    }

    [Fact]
    public void Order_after_several_touches()
    {
        var r = new Recents();
        r.Touch("a.py");
        r.Touch("b.py");
        r.Touch("c.py");
        Assert.Equal(new[] { "c.py", "b.py", "a.py" }, r.List());
    }

    [Fact]
    public void Touching_an_old_one_moves_it_to_the_front()
    {
        var r = new Recents();
        r.Touch("a.py");
        r.Touch("b.py");
        r.Touch("a.py");
        Assert.Equal(new[] { "a.py", "b.py" }, r.List());
    }

    [Fact]
    public void Cap_at_12()
    {
        var r = new Recents();
        for (var i = 0; i < 20; i++)
        {
            r.Touch($"file{i}.py");
        }
        Assert.Equal(Recents.MaxRecents, r.List().Count);
        Assert.Equal("file19.py", r.List()[0]);
        Assert.Equal("file8.py", r.List()[11]);
    }

    [Fact]
    public void List_existing_filters()
    {
        var r = new Recents();
        r.Touch("a.py");
        r.Touch("b.py");
        r.Touch("c.py");
        Assert.Equal(new[] { "c.py", "a.py" }, r.List(new[] { "a.py", "c.py" }));
    }

    [Fact]
    public void Remove_deletes_an_item()
    {
        var r = new Recents();
        r.Touch("a.py");
        r.Touch("b.py");
        r.Remove("a.py");
        Assert.Equal(new[] { "b.py" }, r.List());
    }

    [Fact]
    public void Folder_rename_rewrites_and_deduplicates()
    {
        var r = new Recents();
        r.Touch("src/b.py");
        r.Touch("lib/b.py");
        r.Touch("src/a.py");
        // Before rename: ["src/a.py", "lib/b.py", "src/b.py"]
        // Renaming "src" -> "lib":
        // "src/a.py" -> "lib/a.py"
        // "lib/b.py" stays "lib/b.py"
        // "src/b.py" -> "lib/b.py" (duplicate, dropped)
        r.Rename("src", "lib");
        Assert.Equal(new[] { "lib/a.py", "lib/b.py" }, r.List());
    }

    [Fact]
    public void Hostile_saved_data()
    {
        Assert.Empty(new Recents("not json").List());
        Assert.Empty(new Recents("{ \"a\": 1 }").List());
        Assert.Empty(new Recents(new string?[] { null, "", new string('a', 301), "bad\0name" }).List());
        Assert.Empty(new Recents("__proto__").List());
    }

    [Fact]
    public void Serialize_restore_round_trip()
    {
        var r1 = new Recents();
        r1.Touch("main.js");
        r1.Touch("utils.js");
        var serialized = r1.Serialize();

        var r2 = new Recents(serialized);
        Assert.Equal(new[] { "utils.js", "main.js" }, r2.List());
    }
}
