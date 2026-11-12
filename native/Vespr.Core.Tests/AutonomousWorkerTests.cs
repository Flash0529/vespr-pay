using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class AutonomousWorkerTests
{
    [Fact]
    public void WorkerService_SeedsDefaultWorkersWithValidStatuses()
    {
        var svc = new AutonomousWorkerService();
        var workers = svc.GetActiveWorkers();

        Assert.Equal(3, workers.Count);
        Assert.Contains(workers, w => w.WorkerType == "indexer" && w.Status == WorkerStatus.Completed);
        Assert.Contains(workers, w => w.WorkerType == "auditor" && w.Status == WorkerStatus.Running);
        Assert.Contains(workers, w => w.WorkerType == "test_runner" && w.Status == WorkerStatus.Queued);
    }

    [Fact]
    public void SpawnWorker_CreatesRunningAutonomousTask()
    {
        var svc = new AutonomousWorkerService();
        var worker = svc.SpawnAutonomousWorker("Docker Image Builder", "builder", "Compiling multi-arch binaries");

        Assert.NotNull(worker);
        Assert.Equal(WorkerStatus.Running, worker.Status);
        Assert.Equal("builder", worker.WorkerType);
        Assert.Equal("Compiling multi-arch binaries", worker.CurrentStepDescription);

        svc.ProgressWorker(worker.WorkerId, 75, "Pushing layer sha256:4a8b...", "Layer 3/4 pushed");
        var updated = svc.GetWorker(worker.WorkerId);
        Assert.NotNull(updated);
        Assert.Equal(75, updated.ProgressPercent);
        Assert.Contains("Layer 3/4 pushed", updated.Logs);

        svc.CompleteWorker(worker.WorkerId, "ghcr.io/apex/sde:v1.0.4");
        var completed = svc.GetWorker(worker.WorkerId);
        Assert.NotNull(completed);
        Assert.Equal(WorkerStatus.Completed, completed.Status);
        Assert.Equal("ghcr.io/apex/sde:v1.0.4", completed.ArtifactProduced);
    }

    [Fact]
    public void FailWorker_UpdatesStatusAndLogsError()
    {
        var svc = new AutonomousWorkerService();
        var worker = svc.SpawnAutonomousWorker("Flaky Worker", "test");

        svc.FailWorker(worker.WorkerId, "Out of disk space on /tmp");
        var failed = svc.GetWorker(worker.WorkerId);
        Assert.NotNull(failed);
        Assert.Equal(WorkerStatus.Failed, failed.Status);
        Assert.Contains("Out of disk space", failed.CurrentStepDescription);
    }
}