using System.Collections.Concurrent;

namespace Vespr.Core;

public enum FriendshipStatus
{
    Friend,
    PendingInvite,
    Blocked
}

public record FriendContact(
    string UserId,
    string Name,
    string Email,
    string AvatarLetter,
    string AvatarBg,
    FriendshipStatus Status,
    bool CanShareAgenticChats,
    int SharedChatCount,
    DateTimeOffset AddedAt
);

public record SharedChatGrant(
    string GrantId,
    string ChatId,
    string TargetEmailOrId,
    bool IsOffCompanyAccount,
    bool IsReadOnly,
    string AccessToken,
    DateTimeOffset GrantedAt
);

public record IssueReport(
    string Id,
    string Source,
    string ReporterEmail,
    string Title,
    string Description,
    bool IsFakeOrSpam,
    string Category,
    int EmergencyTier,
    string AutomatedFixSuggestion,
    string FixStatus,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CommittedAt = null,
    string? CommittedBy = null
);

public class SocialAndReportingService
{
    private readonly ConcurrentDictionary<string, FriendContact> _contacts = new();
    private readonly ConcurrentDictionary<string, SharedChatGrant> _chatGrants = new();
    private readonly ConcurrentDictionary<string, IssueReport> _reports = new();

    public SocialAndReportingService()
    {
        SeedDefaultContacts();
        SeedDefaultReports();
    }

    private void SeedDefaultContacts()
    {
        var now = DateTimeOffset.UtcNow;
        AddContactDirect(new FriendContact("usr_maya", "Maya Lin", "maya.lin@stanford.edu", "M", "#ec4899", FriendshipStatus.Friend, true, 4, now.AddDays(-20)));
        AddContactDirect(new FriendContact("usr_devon", "Devon Vance", "devon.v@apexsystems.com", "D", "#3b82f6", FriendshipStatus.Friend, true, 7, now.AddDays(-14)));
        AddContactDirect(new FriendContact("usr_elena", "Elena Rostova", "elena.r@corporate-legal.org", "E", "#8b5cf6", FriendshipStatus.Friend, false, 1, now.AddDays(-5)));
        AddContactDirect(new FriendContact("usr_spammer", "Crypto Bot 9000", "airdrop@unknown-spammer.io", "C", "#ef4444", FriendshipStatus.Blocked, false, 0, now.AddDays(-2)));
    }

    private void AddContactDirect(FriendContact contact) => _contacts[contact.UserId] = contact;

    public IReadOnlyList<FriendContact> GetFriends() =>
        _contacts.Values.Where(c => c.Status == FriendshipStatus.Friend).OrderBy(c => c.Name).ToList();

    public IReadOnlyList<FriendContact> GetBlockedUsers() =>
        _contacts.Values.Where(c => c.Status == FriendshipStatus.Blocked).OrderBy(c => c.Name).ToList();

    public FriendContact AddFriend(string email, string name = "")
    {
        var existing = _contacts.Values.FirstOrDefault(c => c.Email.Equals(email, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            if (existing.Status == FriendshipStatus.Blocked)
            {
                var unblocked = existing with { Status = FriendshipStatus.Friend };
                _contacts[existing.UserId] = unblocked;
                return unblocked;
            }
            return existing;
        }

        var id = "usr_" + Guid.NewGuid().ToString("N")[..8];
        var displayName = string.IsNullOrWhiteSpace(name) ? email.Split('@')[0] : name;
        var letter = char.ToUpperInvariant(displayName[0]).ToString();
        var contact = new FriendContact(id, displayName, email, letter, "#10b981", FriendshipStatus.Friend, true, 0, DateTimeOffset.UtcNow);
        _contacts[id] = contact;
        return contact;
    }

    public bool Unfriend(string userId)
    {
        if (_contacts.TryGetValue(userId, out var c))
        {
            return _contacts.TryRemove(userId, out _);
        }
        return false;
    }

    public bool BlockUser(string userId)
    {
        if (_contacts.TryGetValue(userId, out var c))
        {
            _contacts[userId] = c with { Status = FriendshipStatus.Blocked, CanShareAgenticChats = false };
            return true;
        }
        return false;
    }

    public SharedChatGrant ShareAgenticChat(string chatId, string targetEmailOrId, bool isOffCompany, bool isReadOnly = true)
    {
        var grantId = "grant_" + Guid.NewGuid().ToString("N")[..8];
        var token = "tok_ext_" + Guid.NewGuid().ToString("N")[..12];
        var grant = new SharedChatGrant(grantId, chatId, targetEmailOrId, isOffCompany, isReadOnly, token, DateTimeOffset.UtcNow);
        _chatGrants[grantId] = grant;
        return grant;
    }

    public SharedChatGrant? GetChatGrantByToken(string token) =>
        _chatGrants.Values.FirstOrDefault(g => g.AccessToken == token);

    // AI Emergency Triage & Issue Intake
    public IssueReport IngestAndTriageReport(string title, string description, string reporterEmail, string source)
    {
        var id = "rep_" + Guid.NewGuid().ToString("N")[..8];
        var now = DateTimeOffset.UtcNow;

        var (isFake, category, tier, fix) = RunAiTriage(title, description, reporterEmail);

        var report = new IssueReport(
            Id: id,
            Source: source,
            ReporterEmail: reporterEmail,
            Title: title,
            Description: description,
            IsFakeOrSpam: isFake,
            Category: category,
            EmergencyTier: tier,
            AutomatedFixSuggestion: fix,
            FixStatus: "PendingApproval",
            CreatedAt: now
        );

        _reports[id] = report;
        return report;
    }

    private static (bool IsFake, string Category, int Tier, string Fix) RunAiTriage(string title, string desc, string email)
    {
        var combined = $"{title} {desc}".ToLowerInvariant();

        // 1. Fake / Spam detection
        if (combined.Contains("casino") || combined.Contains("viagra") || combined.Contains("crypto free") ||
            combined.Contains("asdfghjk") || combined.Contains("click here to win") || email.EndsWith(".ru.spam"))
        {
            return (true, "Spam", 1, "Automated filter rule: Discard spam submission.");
        }

        // 2. High emergency tier (8-10): Security, Data Loss, Crash
        if (combined.Contains("vulnerability") || combined.Contains("cve") || combined.Contains("sql injection") ||
            combined.Contains("secret leak") || combined.Contains("auth bypass") || combined.Contains("crash loop"))
        {
            return (false, "Security", 10, "Patch: Enforce strict bearer token validation and rate-limit authentication endpoints in server/access.js.");
        }

        if (combined.Contains("billing") || combined.Contains("double charge") || combined.Contains("stripe payment failed"))
        {
            return (false, "Billing", 8, "Patch: Implement idempotent webhook handlers for Stripe customer subscription invoices.");
        }

        if (combined.Contains("discount") || combined.Contains("syntaxerror") || combined.Contains("test fail") || combined.Contains("cart.py"))
        {
            return (false, "Bug", 7, "Patch: In cart.py, update return statement to round(amount * (1 - percent / 100), 2).");
        }

        if (combined.Contains("compliance") || combined.Contains("ferpa") || combined.Contains("gdpr") || combined.Contains("soc2"))
        {
            return (false, "Compliance", 6, "Patch: Lock session audit trail purge and enforce 365-day corporate retention policy.");
        }

        // Feature / general
        return (false, "Feature", 4, "Config: Enable requested toggle in app/user-settings.js and expose option in settings modal.");
    }

    private void SeedDefaultReports()
    {
        var now = DateTimeOffset.UtcNow;
        var r1 = new IssueReport("rep_101", "context_menu_rclick", "alex.m@apexsystems.com", "Rounding precision in cart calculation", "When applying a 20% discount on float values, rounding exceeds 2 decimal points.", false, "Bug", 7, "Patch: round(amount * (1 - percent / 100), 2) in cart.py", "PendingApproval", now.AddHours(-4));
        var r2 = new IssueReport("rep_102", "email_intake", "security-lead@apexsystems.com", "Token expiry audit log validation", "Verify off-company external viewer links expire within 48 hours.", false, "Security", 9, "Enforce TTL check in SharedChatGrant middleware.", "PendingApproval", now.AddHours(-8));
        var r3 = new IssueReport("rep_103", "email_intake", "spam-bot@fakedomain.biz", "Claim your free $5000 grant", "Congratulations you won free credits click link.", true, "Spam", 1, "Auto-quarantine spam email.", "PendingApproval", now.AddDays(-1));
        var r4 = new IssueReport("rep_104", "feedback_form", "sarah.j@lincoln.edu", "Google Classroom rubric export formatting", "Requesting CSV batch grade export with matching student emails.", false, "Feature", 5, "Add Google Classroom RFC-4180 CSV gradebook exporter.", "Committed", now.AddDays(-2), now.AddDays(-1), "the VESPR team");

        _reports[r1.Id] = r1;
        _reports[r2.Id] = r2;
        _reports[r3.Id] = r3;
        _reports[r4.Id] = r4;
    }

    public IReadOnlyList<IssueReport> ListReports(bool? filterFake = null, string? category = null, int? minTier = null, string sortBy = "date")
    {
        var list = _reports.Values.AsEnumerable();

        if (filterFake.HasValue)
        {
            list = list.Where(r => r.IsFakeOrSpam == filterFake.Value);
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            list = list.Where(r => r.Category.Equals(category, StringComparison.OrdinalIgnoreCase));
        }

        if (minTier.HasValue)
        {
            list = list.Where(r => r.EmergencyTier >= minTier.Value);
        }

        return sortBy.ToLowerInvariant() switch
        {
            "tier" => list.OrderByDescending(r => r.EmergencyTier).ThenByDescending(r => r.CreatedAt).ToList(),
            "category" => list.OrderBy(r => r.Category).ThenByDescending(r => r.CreatedAt).ToList(),
            _ => list.OrderByDescending(r => r.CreatedAt).ToList()
        };
    }

    public bool ApproveAndCommitFix(string reportId, string committer)
    {
        if (_reports.TryGetValue(reportId, out var report))
        {
            _reports[reportId] = report with
            {
                FixStatus = "Committed",
                CommittedAt = DateTimeOffset.UtcNow,
                CommittedBy = committer
            };
            return true;
        }
        return false;
    }
}
