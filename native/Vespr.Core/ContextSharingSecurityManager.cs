using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Vespr.Core;

public record ContextScrubResult(
    string SanitizedContent,
    int ScrubbedItemsCount,
    List<string> ScrubbedItemNames,
    bool WasCleaned,
    string ContextHash
);

public record ContextSharingAuditEvent(
    string SenderId,
    string SenderRole,
    string Recipient,
    bool IsExternalGuest,
    bool Allowed,
    int ScrubbedSecretsCount,
    string ContextHash,
    DateTime Timestamp
);

public class ContextSharingSecurityService
{
    private readonly List<ContextSharingAuditEvent> _auditLog = new();
    private readonly object _lock = new();

    private static readonly Regex SecretPatterns = new(
        @"(sk_live_[a-zA-Z0-9_-]{16,})|(ghp_[a-zA-Z0-9_-]{20,})|(AIzaSy[a-zA-Z0-9_-]{33})|(password\s*[:=]\s*['""][^'""]+['""])|(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase
    );

    public bool CanShareContext(string roleId, bool isExternalGuest)
    {
        // Enforce role-based compliance
        if (roleId.Equals("student", StringComparison.OrdinalIgnoreCase))
            return false; // FERPA protection: student transcripts cannot be shared externally

        if (roleId.Equals("corporate_legal", StringComparison.OrdinalIgnoreCase))
            return false; // Corporate legal compliance transcripts are strictly locked

        if (isExternalGuest && roleId.Equals("intern", StringComparison.OrdinalIgnoreCase))
            return false; // Interns cannot share with off-company guests

        return true;
    }

    public ContextScrubResult ScrubContext(string rawContent, bool isExternalGuest)
    {
        var matches = SecretPatterns.Matches(rawContent);
        var scrubbedNames = new List<string>();

        var sanitized = SecretPatterns.Replace(rawContent, m =>
        {
            scrubbedNames.Add(m.Value.Length > 10 ? m.Value[..8] + "..." : "secret");
            return isExternalGuest ? "[CONFIDENTIAL_SECRET_REDACTED]" : "[REDACTED_API_KEY]";
        });

        // Compute SHA-256 fingerprint
        using var sha = SHA256.Create();
        var hashBytes = sha.ComputeHash(Encoding.UTF8.GetBytes(sanitized));
        var hash = Convert.ToHexString(hashBytes)[..16].ToLowerInvariant();

        return new ContextScrubResult(
            SanitizedContent: sanitized,
            ScrubbedItemsCount: matches.Count,
            ScrubbedItemNames: scrubbedNames,
            WasCleaned: matches.Count > 0,
            ContextHash: hash
        );
    }

    public void LogSharingEvent(string senderId, string senderRole, string recipient, bool isExternalGuest, bool allowed, int scrubbedCount, string hash)
    {
        lock (_lock)
        {
            _auditLog.Add(new ContextSharingAuditEvent(
                SenderId: senderId,
                SenderRole: senderRole,
                Recipient: recipient,
                IsExternalGuest: isExternalGuest,
                Allowed: allowed,
                ScrubbedSecretsCount: scrubbedCount,
                ContextHash: hash,
                Timestamp: DateTime.UtcNow
            ));
        }
    }

    public IReadOnlyList<ContextSharingAuditEvent> GetAuditLog()
    {
        lock (_lock)
        {
            return _auditLog.ToList();
        }
    }
}