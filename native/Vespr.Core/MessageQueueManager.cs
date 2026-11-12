using System.Collections.Concurrent;

namespace Vespr.Core;

public record QueuedMessage(
    string QueueId,
    string Text,
    List<string>? Attachments = null,
    DateTime EnqueuedAt = default,
    bool IsHighPriorityInstant = false,
    int QueuePosition = 1
)
{
    public List<string> Attachments { get; init; } = Attachments ?? new List<string>();
}

public class MessageQueueService
{
    private readonly List<QueuedMessage> _queue = new();
    private readonly object _lock = new();

    public MessageQueueService()
    {
        SeedDefaultQueuedMessage();
    }

    private void SeedDefaultQueuedMessage()
    {
        // Seed:
        // "1 message queued [Image] kind of like this but less lines keep it more mysterious"
        _queue.Add(new QueuedMessage(
            QueueId: "qmsg-01",
            Text: "kind of like this but less lines keep it more mysterious",
            Attachments: new() { "[Image: media_1793892836648_9a3dc130.jpg]" },
            EnqueuedAt: DateTime.UtcNow.AddSeconds(-30),
            IsHighPriorityInstant: false,
            QueuePosition: 1
        ));
    }

    public IReadOnlyList<QueuedMessage> GetQueue()
    {
        lock (_lock)
        {
            return _queue.ToList();
        }
    }

    public int QueueCount
    {
        get
        {
            lock (_lock)
            {
                return _queue.Count;
            }
        }
    }

    public QueuedMessage Enqueue(string text, IEnumerable<string>? attachments = null)
    {
        lock (_lock)
        {
            var id = $"qmsg-{Guid.NewGuid().ToString("N")[..6]}";
            var msg = new QueuedMessage(
                QueueId: id,
                Text: text,
                Attachments: attachments?.ToList() ?? new List<string>(),
                EnqueuedAt: DateTime.UtcNow,
                IsHighPriorityInstant: false,
                QueuePosition: _queue.Count + 1
            );
            _queue.Add(msg);
            return msg;
        }
    }

    public bool EditQueuedMessage(string queueId, string newText)
    {
        lock (_lock)
        {
            var idx = _queue.FindIndex(m => m.QueueId == queueId);
            if (idx == -1) return false;

            _queue[idx] = _queue[idx] with { Text = newText };
            return true;
        }
    }

    public bool DeleteQueuedMessage(string queueId)
    {
        lock (_lock)
        {
            var idx = _queue.FindIndex(m => m.QueueId == queueId);
            if (idx == -1) return false;

            _queue.RemoveAt(idx);
            // Re-index remaining positions
            for (int i = 0; i < _queue.Count; i++)
            {
                _queue[i] = _queue[i] with { QueuePosition = i + 1 };
            }
            return true;
        }
    }

    public QueuedMessage? InstantSend(string queueId)
    {
        lock (_lock)
        {
            var idx = _queue.FindIndex(m => m.QueueId == queueId);
            if (idx == -1) return null;

            var msg = _queue[idx] with { IsHighPriorityInstant = true };
            _queue.RemoveAt(idx);
            for (int i = 0; i < _queue.Count; i++)
            {
                _queue[i] = _queue[i] with { QueuePosition = i + 1 };
            }
            return msg;
        }
    }

    public QueuedMessage? DequeueNext()
    {
        lock (_lock)
        {
            if (_queue.Count == 0) return null;

            var msg = _queue[0];
            _queue.RemoveAt(0);
            for (int i = 0; i < _queue.Count; i++)
            {
                _queue[i] = _queue[i] with { QueuePosition = i + 1 };
            }
            return msg;
        }
    }

    public void ClearQueue()
    {
        lock (_lock)
        {
            _queue.Clear();
        }
    }
}