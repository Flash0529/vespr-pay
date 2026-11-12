using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class MessageQueueTests
{
    [Fact]
    public void Queue_SeedsDefaultMessageMatchingScreenshot()
    {
        var svc = new MessageQueueService();
        Assert.Equal(1, svc.QueueCount);

        var q = svc.GetQueue();
        Assert.Single(q);
        Assert.Contains("kind of like this but less lines", q[0].Text);
        Assert.Contains("media_1793892836648_9a3dc130.jpg", q[0].Attachments[0]);
    }

    [Fact]
    public void Enqueue_AddsMessageWithCorrectQueuePosition()
    {
        var svc = new MessageQueueService();
        var msg = svc.Enqueue("Run unit tests on all 38 C# native files", new[] { "test_suite.py" });

        Assert.Equal(2, svc.QueueCount);
        Assert.Equal(2, msg.QueuePosition);
        Assert.Equal("Run unit tests on all 38 C# native files", msg.Text);
    }

    [Fact]
    public void EditQueuedMessage_UpdatesText()
    {
        var svc = new MessageQueueService();
        var edited = svc.EditQueuedMessage("qmsg-01", "Updated prompt: verify with fewer lines and clean mystery style");
        Assert.True(edited);

        var q = svc.GetQueue();
        Assert.Equal("Updated prompt: verify with fewer lines and clean mystery style", q[0].Text);
    }

    [Fact]
    public void DeleteQueuedMessage_RemovesAndReindexesPositions()
    {
        var svc = new MessageQueueService();
        var m2 = svc.Enqueue("Second message");
        Assert.Equal(2, svc.QueueCount);

        var deleted = svc.DeleteQueuedMessage("qmsg-01");
        Assert.True(deleted);
        Assert.Equal(1, svc.QueueCount);

        var remaining = svc.GetQueue();
        Assert.Equal(1, remaining[0].QueuePosition);
        Assert.Equal("Second message", remaining[0].Text);
    }

    [Fact]
    public void InstantSend_RemovesFromQueueAndFlagsHighPriority()
    {
        var svc = new MessageQueueService();
        var instant = svc.InstantSend("qmsg-01");

        Assert.NotNull(instant);
        Assert.True(instant.IsHighPriorityInstant);
        Assert.Equal(0, svc.QueueCount);
    }
}