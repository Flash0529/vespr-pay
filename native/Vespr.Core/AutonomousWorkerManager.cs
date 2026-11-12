using System.Collections.Concurrent;

namespace Vespr.Core;

public enum WorkerStatus
{
    Queued,
    Running,
    Completed,
    Failed,
    Paused
}

public record WorkerTask(
    string WorkerId,
    string Name,
    string WorkerType,
    WorkerStatus Status,
    string CurrentStepDescription,
    int ProgressPercent = 0,
    List<string>? Logs = null,
    int TokensConsumed = 0,
    TimeSpan Duration = default,
    DateTime StartedAt = default,
    DateTime? CompletedAt = null,
    string? ArtifactProduced = null
)
{
    public List<string> Logs { get; init; } = Logs ?? new List<string>();
}

public class AutonomousWorkerService
{
    private readonly ConcurrentDictionary<string, WorkerTask> _workers = new();
    private readonly object _lock = new();

    public AutonomousWorkerService()
    {
        SeedDefaultAutonomousWorkers();
    }

    private void SeedDefaultAutonomousWorkers()
    {
        var w1 = new WorkerTask(
            WorkerId: "wrk-indexer",
            Name: "AST Codebase Indexer",
            WorkerType: "indexer",
            Status: WorkerStatus.Completed,
            CurrentStepDescription: "Indexed 84 files across native C# and JS modules",
            ProgressPercent: 100,
            Logs: new() { "Parsed symbol graph", "Built syntax trees for 38 C# files", "Cached 1,420 AST nodes" },
            TokensConsumed: 14200,
            Duration: TimeSpan.FromSeconds(3.4),
            StartedAt: DateTime.UtcNow.AddMinutes(-5),
            CompletedAt: DateTime.UtcNow.AddMinutes(-4),
            ArtifactProduced: "ast_symbols.cache.json"
        );

        var w2 = new WorkerTask(
            WorkerId: "wrk-security",
            Name: "Static Vulnerability & Secret Auditor",
            WorkerType: "auditor",
            Status: WorkerStatus.Running,
            CurrentStepDescription: "Analyzing dataflow for SQL injection and exposed tokens",
            ProgressPercent: 68,
            Logs: new() { "Scanning .env boundaries", "Checked 12 API controllers", "Zero credential leaks found" },
            TokensConsumed: 8900,
            Duration: TimeSpan.FromSeconds(6.1),
            StartedAt: DateTime.UtcNow.AddSeconds(-6),
            CompletedAt: null,
            ArtifactProduced: null
        );

        var w3 = new WorkerTask(
            WorkerId: "wrk-testrunner",
            Name: "Autonomous E2E Test Runner",
            WorkerType: "test_runner",
            Status: WorkerStatus.Queued,
            CurrentStepDescription: "Awaiting security auditor completion",
            ProgressPercent: 0,
            Logs: new() { "Queued behind wrk-security" },
            TokensConsumed: 0,
            Duration: TimeSpan.Zero,
            StartedAt: DateTime.UtcNow,
            CompletedAt: null,
            ArtifactProduced: null
        );

        _workers[w1.WorkerId] = w1;
        _workers[w2.WorkerId] = w2;
        _workers[w3.WorkerId] = w3;
    }

    public IReadOnlyList<WorkerTask> GetActiveWorkers()
    {
        return _workers.Values.OrderByDescending(w => w.StartedAt).ToList();
    }

    public WorkerTask SpawnAutonomousWorker(string name, string workerType, string initialStep = "Initializing autonomous worker")
    {
        var id = $"wrk-{Guid.NewGuid().ToString("N")[..8]}";
        var task = new WorkerTask(
            WorkerId: id,
            Name: name,
            WorkerType: workerType,
            Status: WorkerStatus.Running,
            CurrentStepDescription: initialStep,
            ProgressPercent: 0,
            Logs: new() { $"Worker {name} started in autonomous headless mode" },
            TokensConsumed: 500,
            Duration: TimeSpan.Zero,
            StartedAt: DateTime.UtcNow
        );

        _workers[id] = task;
        return task;
    }

    public void ProgressWorker(string workerId, int progress, string stepDescription, string? logEntry = null)
    {
        if (_workers.TryGetValue(workerId, out var existing))
        {
            var logs = existing.Logs.ToList();
            if (!string.IsNullOrEmpty(logEntry)) logs.Add(logEntry);

            _workers[workerId] = existing with
            {
                ProgressPercent = Math.Clamp(progress, 0, 100),
                CurrentStepDescription = stepDescription,
                Logs = logs
            };
        }
    }

    public void CompleteWorker(string workerId, string artifactProduced)
    {
        if (_workers.TryGetValue(workerId, out var existing))
        {
            var logs = existing.Logs.ToList();
            logs.Add($"Worker successfully finished. Artifact: {artifactProduced}");

            _workers[workerId] = existing with
            {
                Status = WorkerStatus.Completed,
                ProgressPercent = 100,
                CurrentStepDescription = $"Completed: {artifactProduced}",
                CompletedAt = DateTime.UtcNow,
                ArtifactProduced = artifactProduced,
                Logs = logs
            };
        }
    }

    public void FailWorker(string workerId, string error)
    {
        if (_workers.TryGetValue(workerId, out var existing))
        {
            var logs = existing.Logs.ToList();
            logs.Add($"Worker failed: {error}");

            _workers[workerId] = existing with
            {
                Status = WorkerStatus.Failed,
                CurrentStepDescription = $"Failed: {error}",
                CompletedAt = DateTime.UtcNow,
                Logs = logs
            };
        }
    }

    public WorkerTask? GetWorker(string workerId)
    {
        _workers.TryGetValue(workerId, out var worker);
        return worker;
    }
}