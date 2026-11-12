namespace Vespr.Core.Tests;

public class CursorTests
{
    [Fact]
    public void Constants_exist_and_have_expected_bounds()
    {
        Assert.Equal(1000000, Cursor.MaxDocChars);
        Assert.Equal(50000, Cursor.MaxLines);
        Assert.Equal("spaces", Cursor.DefaultIndent.Type);
        Assert.Equal(4, Cursor.DefaultIndent.Width);
    }

    [Fact]
    public void LineCount_counts_lines_accurately()
    {
        Assert.Equal(0, Cursor.LineCount(""));
        Assert.Equal(1, Cursor.LineCount("single line"));
        Assert.Equal(3, Cursor.LineCount("line 1\nline 2\nline 3"));
        Assert.Equal(2, Cursor.LineCount("trailing\n"));
        Assert.Equal(0, Cursor.LineCount(null));
    }

    [Fact]
    public void ClampLine_clamps_target_line_within_valid_line_bounds()
    {
        Assert.Equal(5, Cursor.ClampLine(5, 10));
        Assert.Equal(1, Cursor.ClampLine(0, 10));
        Assert.Equal(1, Cursor.ClampLine(-3, 10));
        Assert.Equal(10, Cursor.ClampLine(15, 10));
        Assert.Equal(1, Cursor.ClampLine(null, 10));
    }

    [Fact]
    public void OffsetToPos_maps_character_offsets_to_1_based_line_and_col()
    {
        var text = "def total():\n    return 42";
        Assert.Equal(new Cursor.Position(1, 1), Cursor.OffsetToPos(text, 0));
        Assert.Equal(new Cursor.Position(1, 4), Cursor.OffsetToPos(text, 3));
        Assert.Equal(new Cursor.Position(1, 13), Cursor.OffsetToPos(text, 12));
        Assert.Equal(new Cursor.Position(2, 1), Cursor.OffsetToPos(text, 13));
        Assert.Equal(new Cursor.Position(2, 5), Cursor.OffsetToPos(text, 17));
    }

    [Fact]
    public void PosToOffset_maps_line_and_col_back_to_character_offset_round_trip()
    {
        var text = "def total():\n    return 42\n";
        var offset1 = Cursor.PosToOffset(text, new Cursor.Position(1, 1));
        Assert.Equal(0, offset1);

        var offset2 = Cursor.PosToOffset(text, new Cursor.Position(2, 5));
        Assert.Equal(17, offset2);
        Assert.Equal(new Cursor.Position(2, 5), Cursor.OffsetToPos(text, offset2));
    }

    [Fact]
    public void PosToOffset_clamps_column_to_end_of_line_if_exceeded()
    {
        var text = "short\nline";
        var offset = Cursor.PosToOffset(text, new Cursor.Position(1, 999));
        Assert.Equal(5, offset);
    }

    [Fact]
    public void FormatPosition_formats_status_bar_indicator_correctly()
    {
        Assert.Equal("Ln 8, Col 41", Cursor.FormatPosition(new Cursor.PositionInfo(8, 41)));
        Assert.Equal("Ln 8, Col 41 (12 selected)", Cursor.FormatPosition(new Cursor.PositionInfo(8, 41, 12)));
        Assert.Equal("Ln 8, Col 41 (3 lines selected)", Cursor.FormatPosition(new Cursor.PositionInfo(8, 41, 45, 3)));
        Assert.Equal("Ln 1, Col 1", Cursor.FormatPosition(null));
    }

    [Fact]
    public void DetectIndentation_identifies_4_space_indentation()
    {
        var pyCode = "def total(items):\n    result = 0\n    for x in items:\n        result += x\n    return result";
        var ind = Cursor.DetectIndentation(pyCode);
        Assert.Equal("spaces", ind.Type);
        Assert.Equal(4, ind.Width);
        Assert.Equal("Spaces: 4", ind.Label);
    }

    [Fact]
    public void DetectIndentation_identifies_2_space_indentation()
    {
        var jsCode = "function total(items) {\n  let res = 0\n  for (const x of items) {\n    res += x\n  }\n  return res\n}";
        var ind = Cursor.DetectIndentation(jsCode);
        Assert.Equal("spaces", ind.Type);
        Assert.Equal(2, ind.Width);
        Assert.Equal("Spaces: 2", ind.Label);
    }

    [Fact]
    public void DetectIndentation_identifies_tab_indentation()
    {
        var goCode = "func main() {\n\tfmt.Println(\"hello\")\n}";
        var ind = Cursor.DetectIndentation(goCode);
        Assert.Equal("tabs", ind.Type);
        Assert.Equal("Tabs", ind.Label);
    }

    [Fact]
    public void WordAt_finds_identifier_under_cursor_or_adjacent_to_it()
    {
        var text = "const totalItems = calculate(cart)";
        // Inside 'totalItems'
        var w1 = Cursor.WordAt(text, 8);
        Assert.Equal("totalItems", w1.Word);
        Assert.Equal(6, w1.From);
        Assert.Equal(16, w1.To);

        // End of 'calculate'
        var w2 = Cursor.WordAt(text, 27);
        Assert.Equal("calculate", w2.Word);

        // On whitespace
        var w3 = Cursor.WordAt(text, 5);
        Assert.Equal("", w3.Word);
    }

    [Fact]
    public void NormalizeSelection_orders_anchor_and_head_into_from_and_to()
    {
        var fwd = Cursor.NormalizeSelection(10, 25);
        Assert.Equal(10, fwd.From);
        Assert.Equal(25, fwd.To);
        Assert.False(fwd.IsReversed);
        Assert.Equal(15, fwd.Length);

        var rev = Cursor.NormalizeSelection(25, 10);
        Assert.Equal(10, rev.From);
        Assert.Equal(25, rev.To);
        Assert.True(rev.IsReversed);
        Assert.Equal(15, rev.Length);
    }

    [Fact]
    public void Hostile_input_immunity_for_all_cursor_functions()
    {
        Assert.Equal(new Cursor.Position(1, 1), Cursor.OffsetToPos(null, -10));
        Assert.Equal(new Cursor.Position(1, 4), Cursor.OffsetToPos("abc", 999));
        Assert.Equal(0, Cursor.PosToOffset(null, null));
        Assert.Equal("Ln 1, Col 1", Cursor.FormatPosition(new Cursor.PositionInfo(-5, 0)));
        Assert.Equal(Cursor.DefaultIndent, Cursor.DetectIndentation(null));
        Assert.Equal(new Cursor.WordInfo("", 0, 0), Cursor.WordAt(null, 10));
        Assert.Equal(new Cursor.SelectionInfo(0, 0, false, 0), Cursor.NormalizeSelection(null, null));
    }
}
