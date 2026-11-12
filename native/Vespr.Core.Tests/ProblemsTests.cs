namespace Vespr.Core.Tests;

public class ProblemsTests
{
    [Fact]
    public void Constants_match_javascript()
    {
        Assert.Equal(200, Problems.MaxProblems);
        Assert.Equal(300, Problems.MaxPath);
        Assert.Equal(1000, Problems.MaxMessage);
        Assert.Equal(new[] { "error", "warning", "info" }, Problems.Severities);
    }

    [Fact]
    public void Add_validates_and_normalizes_problems()
    {
        var m = new Problems();
        Assert.True(m.Add("src/main.py", 12, 4, "undefined variable x", "error"));
        Assert.True(m.Add("src/main.py", 20, 1, "unused import", "warn", "flake8"));

        var items = m.List();
        Assert.Equal(2, items.Count);
        Assert.Equal("src/main.py", items[0].File);
        Assert.Equal(12, items[0].Line);
        Assert.Equal(4, items[0].Col);
        Assert.Equal("error", items[0].Severity);
        Assert.Equal("workspace", items[0].Source);

        Assert.Equal("warning", items[1].Severity);
        Assert.Equal("flake8", items[1].Source);
    }

    [Fact]
    public void Duplicate_problems_are_ignored()
    {
        var m = new Problems();
        Assert.True(m.Add("a.py", 5, 1, "bad syntax", "error"));
        Assert.False(m.Add("a.py", 5, 1, "bad syntax", "error"));
        Assert.Single(m.List());
    }

    [Fact]
    public void Max_limit_evicts_oldest_problems_when_capacity_is_reached()
    {
        var m = new Problems(3);
        m.Add("a.py", 1, 1, "p1", "info");
        m.Add("a.py", 2, 1, "p2", "info");
        m.Add("a.py", 3, 1, "p3", "info");

        // 4th problem evicts p1
        m.Add("b.py", 1, 1, "p4", "error");
        var items = m.List();
        Assert.Equal(3, items.Count);
        Assert.Equal("p2", items[0].Message);
        Assert.Equal("p3", items[1].Message);
        Assert.Equal("p4", items[2].Message);
    }

    [Fact]
    public void Set_replaces_all_problems_for_a_given_file()
    {
        var m = new Problems();
        m.Add("a.py", 1, 1, "old 1", "error");
        m.Add("a.py", 2, 1, "old 2", "error");
        m.Add("b.py", 1, 1, "keep me", "warning");

        var added = m.Set("a.py", [
            new Problems.ProblemItem("", 10, 5, "new diagnostic", "info", "workspace")
        ]);
        Assert.Equal(1, added);

        var items = m.List();
        Assert.Equal(2, items.Count);
        Assert.Equal(10, items.Find(it => it.File == "a.py")!.Line);
        Assert.Equal("keep me", items.Find(it => it.File == "b.py")!.Message);
    }

    [Fact]
    public void Clear_removes_problems_for_a_file_or_all_files()
    {
        var m = new Problems();
        m.Add("a.py", 1, 1, "p1");
        m.Add("b.py", 1, 1, "p2");

        Assert.Equal(1, m.Clear("a.py"));
        Assert.Single(m.List());
        Assert.Equal("b.py", m.List()[0].File);

        Assert.Equal(1, m.Clear());
        Assert.Empty(m.List());
    }

    [Fact]
    public void Summary_computes_counts_accurately()
    {
        var m = new Problems();
        m.Add("a.py", 1, 1, "err1", "error");
        m.Add("a.py", 2, 1, "err2", "error");
        m.Add("b.py", 3, 1, "warn1", "warning");
        m.Add("c.py", 4, 1, "info1", "info");

        var s = m.Summary();
        Assert.Equal(new Problems.SummaryResult(4, 2, 1, 1), s);
    }

    [Fact]
    public void Filter_filters_by_file_severity_and_text_query()
    {
        var m = new Problems();
        m.Add("src/main.py", 10, 1, "syntax error in parser", "error");
        m.Add("src/main.py", 15, 2, "deprecated call", "warning");
        m.Add("tests/test.py", 5, 1, "missing assert", "error", "pytest");

        // By file
        Assert.Equal(2, m.Filter(new Problems.FilterCriteria(File: "src/main.py")).Count);

        // By severity
        Assert.Equal(2, m.Filter(new Problems.FilterCriteria(Severity: "error")).Count);

        // By query
        var res = m.Filter(new Problems.FilterCriteria(Query: "pytest"));
        Assert.Single(res);
        Assert.Equal("tests/test.py", res[0].File);

        // Combined
        Assert.Single(m.Filter(new Problems.FilterCriteria(File: "src/main.py", Severity: "error")));
    }

    [Fact]
    public void GroupByFile_groups_and_sorts_problems()
    {
        var m = new Problems();
        m.Add("z.py", 1, 1, "z-problem");
        m.Add("a.py", 20, 1, "a-second");
        m.Add("a.py", 5, 10, "a-first");

        var g = m.GroupByFile();
        Assert.Equal(new[] { "a.py", "z.py" }, g.Keys);
        Assert.Equal(5, g["a.py"][0].Line);
        Assert.Equal(20, g["a.py"][1].Line);
    }

    [Fact]
    public void FormatRow_formats_clean_single_line_representation()
    {
        var row = Problems.FormatRow(new Problems.ProblemItem("cart.py", 8, 41, "apply_discount returns wrong value", "warning", "linter"));
        Assert.Equal("cart.py:8:41 [warning] apply_discount returns wrong value (linter)", row);
    }

    [Fact]
    public void Rename_updates_single_file_and_rewrites_folder_prefixes()
    {
        var m = new Problems();
        m.Add("src/a.py", 1, 1, "err");
        m.Add("src/sub/b.py", 2, 2, "warn");
        m.Add("lib/c.py", 3, 3, "info");

        Assert.Equal(1, m.Rename("lib/c.py", "lib/main.py"));
        Assert.Equal("lib/main.py", m.List().Find(it => it.Message == "info")!.File);

        Assert.Equal(2, m.Rename("src", "pkg"));
        var files = m.List().Select(it => it.File).ToList();
        Assert.Equal(new[] { "pkg/a.py", "pkg/sub/b.py", "lib/main.py" }, files);
    }

    [Fact]
    public void Serialize_and_deserialize_round_trip_preserves_state()
    {
        var m = new Problems();
        m.Add("a.py", 10, 2, "test", "error", "tool");
        var json = m.Serialize();

        var m2 = new Problems();
        Assert.True(m2.Deserialize(json));
        Assert.Single(m2.List());
        Assert.Equal(new Problems.ProblemItem("a.py", 10, 2, "test", "error", "tool"), m2.List()[0]);
    }

    [Fact]
    public void Hostile_inputs_do_not_throw_and_are_handled_cleanly()
    {
        var mNull = new Problems(-5);
        Assert.Empty(mNull.List());

        var m = new Problems();
        Assert.False(m.Add((Problems.ProblemItem?)null));
        Assert.False(m.Add(""));
        Assert.False(m.Add("a\0b.py"));
        Assert.False(m.Add(new string('x', Problems.MaxPath + 10)));

        Assert.Equal(0, m.Set(null, []));
        Assert.Equal(0, m.Set("a.py", null));
        Assert.Equal(0, m.Clear(null));
        Assert.Equal(0, m.Rename(null, null));

        Assert.False(m.Deserialize("not json"));
        Assert.False(m.Deserialize("{\"__proto__\": {\"polluted\": true}}"));
        Assert.True(m.Deserialize("{\"items\": [null, 123, {\"file\": \"\"}]}"));
        Assert.Empty(m.List());
    }
}
