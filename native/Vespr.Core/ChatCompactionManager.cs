using System.Collections.Concurrent;

namespace Vespr.Core;

public record ActionPill(
    string SummaryText,
    int Additions = 0,
    int Deletions = 0,
    List<string>? Thumbnails = null,
    int ExtraThumbnailCount = 0,
    bool IsExpanded = false,
    List<string>? DetailedLogs = null
)
{
    public List<string> Thumbnails { get; init; } = Thumbnails ?? new List<string>();
    public List<string> DetailedLogs { get; init; } = DetailedLogs ?? new List<string>();
}

public record ChatTurn(
    string TurnId,
    string Role,
    string Content,
    DateTime Timestamp,
    bool IsCompacted = false,
    List<ActionPill>? Pills = null,
    bool IsStarred = false,
    int ForkCount = 0,
    string? AudioUrl = null
)
{
    public List<ActionPill> Pills { get; init; } = Pills ?? new List<ActionPill>();
}

public class ChatCompactionService
{
    private readonly List<ChatTurn> _turns = new();
    private readonly object _lock = new();

    public ChatCompactionService()
    {
        // Seed initial history matching user screenshot
        SeedInitialScreenshotTurns();
    }

    private void SeedInitialScreenshotTurns()
    {
        var turn1 = new ChatTurn(
            TurnId: "turn-1",
            Role: "assistant",
            Content: "Thanks for the photo, it's a helpful reference for the soft rounded dome. I'm now checking how the curly-hair lumps are built so I can match that fluffy shape.",
            Timestamp: DateTime.UtcNow.AddDays(-2),
            IsCompacted: true,
            Pills: new List<ActionPill>
            {
                new(
                    SummaryText: "Read 2 files, created 2 files, ran 4 commands",
                    Additions: 56,
                    Deletions: 0,
                    Thumbnails: new List<string> { "media/avatar_sprite_preview.png" },
                    DetailedLogs: new List<string> { "read native/Vespr.Core/TermOutput.cs", "read native/Vespr.Core/SplitLayout.cs", "created worklog_v3.py", "git status" }
                )
            }
        );

        var turn2 = new ChatTurn(
            TurnId: "turn-2",
            Role: "assistant",
            Content: "The lumps version gives a soft, rounded dome like your photo, with the fringe in front. I'm bumping the volume slightly and starting the final render pass, with F1 now at your good angle.",
            Timestamp: DateTime.UtcNow.AddDays(-2),
            IsCompacted: true,
            Pills: new List<ActionPill>
            {
                new(
                    SummaryText: "Saved 2 memories, ran 8 and 6 more actions",
                    Additions: 27,
                    Deletions: 3,
                    Thumbnails: new List<string> { "media/render_pass_f1.png", "media/angle_inspect.png", "media/dome_profile.png" },
                    ExtraThumbnailCount: 1,
                    DetailedLogs: new List<string> { "Saved memory: fringe volume preference", "Saved memory: F1 good angle bias" }
                )
            }
        );

        var turn3 = new ChatTurn(
            TurnId: "turn-3",
            Role: "assistant",
            Content: "Final render pass is done. I'm checking your reframed good-angle close-up, then I'll finish and upload the set.\n\nSet v4 is on the Pi with 62 of 62 hashes matching. Now the worklog entry, then the commit.",
            Timestamp: DateTime.UtcNow.AddDays(-2),
            IsCompacted: true,
            Pills: new List<ActionPill>
            {
                new(
                    SummaryText: "Read 2 files, ran 4 commands, created 3 files",
                    Additions: 55,
                    Deletions: 0,
                    Thumbnails: new List<string> { "media/closeup_good_angle.png", "media/render_final_grid.png" },
                    DetailedLogs: new List<string> { "read render_output.json", "verified 62/62 hashes" }
                ),
                new(
                    SummaryText: "Created worklog_v4.py",
                    Additions: 13,
                    Deletions: 0,
                    Thumbnails: new List<string>(),
                    DetailedLogs: new List<string> { "created app/worklog_v4.py" }
                )
            }
        );

        _turns.Add(turn1);
        _turns.Add(turn2);
        _turns.Add(turn3);
    }

    public IReadOnlyList<ChatTurn> GetTurns()
    {
        lock (_lock)
        {
            return _turns.ToList();
        }
    }

    public ChatTurn AddTurn(string role, string content, List<ActionPill>? pills = null, bool autoCompactPrevious = true)
    {
        lock (_lock)
        {
            if (autoCompactPrevious)
            {
                // Compact all prior turns to minimize vertical space consumption
                for (int i = 0; i < _turns.Count; i++)
                {
                    _turns[i] = _turns[i] with { IsCompacted = true };
                }
            }

            var newTurn = new ChatTurn(
                TurnId: $"turn-{_turns.Count + 1}",
                Role: role,
                Content: content,
                Timestamp: DateTime.UtcNow,
                IsCompacted: false, // active turn starts expanded
                Pills: pills ?? new List<ActionPill>()
            );

            _turns.Add(newTurn);
            return newTurn;
        }
    }

    public void AdvanceTurn(string newTurnId)
    {
        lock (_lock)
        {
            for (int i = 0; i < _turns.Count; i++)
            {
                if (_turns[i].TurnId != newTurnId)
                {
                    _turns[i] = _turns[i] with { IsCompacted = true };
                }
            }
        }
    }

    public bool TogglePillExpansion(string turnId, int pillIndex)
    {
        lock (_lock)
        {
            var idx = _turns.FindIndex(t => t.TurnId == turnId);
            if (idx == -1) return false;

            var turn = _turns[idx];
            if (pillIndex < 0 || pillIndex >= turn.Pills.Count) return false;

            var pills = turn.Pills.ToList();
            var target = pills[pillIndex];
            pills[pillIndex] = target with { IsExpanded = !target.IsExpanded };

            _turns[idx] = turn with { Pills = pills };
            return pills[pillIndex].IsExpanded;
        }
    }

    public bool ToggleTurnCompaction(string turnId)
    {
        lock (_lock)
        {
            var idx = _turns.FindIndex(t => t.TurnId == turnId);
            if (idx == -1) return false;

            var turn = _turns[idx];
            var updated = turn with { IsCompacted = !turn.IsCompacted };
            _turns[idx] = updated;
            return updated.IsCompacted;
        }
    }

    public bool StarTurn(string turnId)
    {
        lock (_lock)
        {
            var idx = _turns.FindIndex(t => t.TurnId == turnId);
            if (idx == -1) return false;

            var turn = _turns[idx];
            var updated = turn with { IsStarred = !turn.IsStarred };
            _turns[idx] = updated;
            return updated.IsStarred;
        }
    }

    public int ForkTurn(string turnId)
    {
        lock (_lock)
        {
            var idx = _turns.FindIndex(t => t.TurnId == turnId);
            if (idx == -1) return -1;

            var turn = _turns[idx];
            var updated = turn with { ForkCount = turn.ForkCount + 1 };
            _turns[idx] = updated;
            return updated.ForkCount;
        }
    }

    public ActionPill BuildPillFromOperations(
        int filesRead,
        int filesCreated,
        int commandsRan,
        int additions,
        int deletions,
        IEnumerable<string>? thumbnails = null,
        int extraCount = 0,
        IEnumerable<string>? logs = null)
    {
        var parts = new List<string>();
        if (filesRead > 0) parts.Add($"Read {filesRead} file{(filesRead > 1 ? "s" : "")}");
        if (filesCreated > 0) parts.Add($"created {filesCreated} file{(filesCreated > 1 ? "s" : "")}");
        if (commandsRan > 0) parts.Add($"ran {commandsRan} command{(commandsRan > 1 ? "s" : "")}");

        var summary = parts.Count > 0 ? string.Join(", ", parts) : "Completed actions";

        return new ActionPill(
            SummaryText: summary,
            Additions: additions,
            Deletions: deletions,
            Thumbnails: thumbnails?.ToList() ?? new List<string>(),
            ExtraThumbnailCount: extraCount,
            DetailedLogs: logs?.ToList() ?? new List<string>()
        );
    }

    public int GetEstimatedVerticalSpaceSavingsPercent()
    {
        lock (_lock)
        {
            if (_turns.Count == 0) return 0;
            var compactedCount = _turns.Count(t => t.IsCompacted);
            if (compactedCount == 0) return 0;

            // In full expanded mode, a turn with logs takes ~350px.
            // In compacted mode with collapsed summary pill, it takes ~90px (74% savings).
            return (int)Math.Round((double)compactedCount / _turns.Count * 74.0);
        }
    }
}