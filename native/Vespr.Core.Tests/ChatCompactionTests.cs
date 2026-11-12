using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class ChatCompactionTests
{
    [Fact]
    public void Service_SeedsInitialTurnsMatchingScreenshot()
    {
        var svc = new ChatCompactionService();
        var turns = svc.GetTurns();

        Assert.Equal(3, turns.Count);

        // Turn 1 assertions matching user screenshot
        Assert.Contains("Thanks for the photo", turns[0].Content);
        Assert.True(turns[0].IsCompacted);
        Assert.Single(turns[0].Pills);
        Assert.Equal("Read 2 files, created 2 files, ran 4 commands", turns[0].Pills[0].SummaryText);
        Assert.Equal(56, turns[0].Pills[0].Additions);

        // Turn 2 assertions
        Assert.Contains("The lumps version", turns[1].Content);
        Assert.True(turns[1].IsCompacted);
        Assert.Equal(27, turns[1].Pills[0].Additions);
        Assert.Equal(3, turns[1].Pills[0].Deletions);
        Assert.Equal(1, turns[1].Pills[0].ExtraThumbnailCount);

        // Turn 3 assertions
        Assert.Contains("Set v4 is on the Pi", turns[2].Content);
        Assert.Equal(2, turns[2].Pills.Count);
        Assert.Equal("Created worklog_v4.py", turns[2].Pills[1].SummaryText);
        Assert.Equal(13, turns[2].Pills[1].Additions);
    }

    [Fact]
    public void AddTurn_AutoCompactsPriorTurnsAndKeepsNewTurnExpanded()
    {
        var svc = new ChatCompactionService();
        var newTurn = svc.AddTurn("user", "Can you build the new smart role maker and enterprise sync?");

        var turns = svc.GetTurns();
        Assert.Equal(4, turns.Count);

        // All prior turns are compacted
        Assert.True(turns[0].IsCompacted);
        Assert.True(turns[1].IsCompacted);
        Assert.True(turns[2].IsCompacted);

        // Newly added active turn is expanded
        Assert.False(turns[3].IsCompacted);
        Assert.Equal(newTurn.TurnId, turns[3].TurnId);
    }

    [Fact]
    public void TogglePillExpansion_FlipsStateAndPreservesDetailedLogs()
    {
        var svc = new ChatCompactionService();
        var turns = svc.GetTurns();
        Assert.False(turns[0].Pills[0].IsExpanded);

        var expanded = svc.TogglePillExpansion("turn-1", 0);
        Assert.True(expanded);

        var updatedTurns = svc.GetTurns();
        Assert.True(updatedTurns[0].Pills[0].IsExpanded);
        Assert.NotEmpty(updatedTurns[0].Pills[0].DetailedLogs);

        var collapsed = svc.TogglePillExpansion("turn-1", 0);
        Assert.False(collapsed);
    }

    [Fact]
    public void BuildPillFromOperations_ConstructsFormattedActionSummary()
    {
        var svc = new ChatCompactionService();
        var pill = svc.BuildPillFromOperations(
            filesRead: 3,
            filesCreated: 1,
            commandsRan: 5,
            additions: 120,
            deletions: 4,
            thumbnails: new[] { "thumb1.png", "thumb2.png" },
            extraCount: 2
        );

        Assert.Equal("Read 3 files, created 1 file, ran 5 commands", pill.SummaryText);
        Assert.Equal(120, pill.Additions);
        Assert.Equal(4, pill.Deletions);
        Assert.Equal(2, pill.Thumbnails.Count);
        Assert.Equal(2, pill.ExtraThumbnailCount);
    }

    [Fact]
    public void StarAndForkTurn_ModifiesMetadataSuccessfully()
    {
        var svc = new ChatCompactionService();
        var isStarred = svc.StarTurn("turn-1");
        Assert.True(isStarred);

        var forkCount = svc.ForkTurn("turn-1");
        Assert.Equal(1, forkCount);

        var turns = svc.GetTurns();
        Assert.True(turns[0].IsStarred);
        Assert.Equal(1, turns[0].ForkCount);
    }

    [Fact]
    public void SpaceSavings_CalculatesExpectedCompactionRatio()
    {
        var svc = new ChatCompactionService();
        var savings = svc.GetEstimatedVerticalSpaceSavingsPercent();
        // Since initial turns are all compacted, savings should be > 50%
        Assert.True(savings >= 50, $"Expected savings >= 50, got {savings}");
    }
}