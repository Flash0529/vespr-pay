using System.Collections.Concurrent;

namespace Vespr.Core;

/// <summary>
/// Client device categories for VESPR SDE.
/// </summary>
public static class ClientDeviceType
{
    public const string DesktopApp = "desktop_app";
    public const string SdeWeb = "sde_web";
    public const string MobileCompanion = "mobile_companion";
    public const string TerminalCli = "terminal_cli";

    public static string GetDisplayName(string clientType) => clientType switch
    {
        DesktopApp => "Desktop App - Windows 11",
        SdeWeb => "SDE Web Browser",
        MobileCompanion => "Mobile Companion - iOS/Android",
        TerminalCli => "Pi 5 CLI Terminal",
        _ => "Unknown Device"
    };

    public static string GetIcon(string clientType) => clientType switch
    {
        DesktopApp => "monitor",
        SdeWeb => "globe",
        MobileCompanion => "message",
        TerminalCli => "term",
        _ => "monitor"
    };
}

/// <summary>
/// Account lifecycle state in corporate and educational environments.
/// </summary>
public enum AccountLifecycleStatus
{
    Active,
    Suspended,
    Deactivated,
    PendingProvisioning
}

/// <summary>
/// Represents an authenticated device session.
/// </summary>
public record UserDeviceSession(
    string SessionId,
    string UserId,
    string DeviceName,
    string ClientType,
    string IpAddress,
    string UserAgent,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastActiveAt,
    bool IsCurrentDevice,
    bool IsRevoked = false,
    DateTimeOffset? RevokedAt = null,
    string? RevokedBy = null
);

/// <summary>
/// Represents an authentication or security audit history event.
/// </summary>
public record SessionHistoryEntry(
    string EventId,
    string UserId,
    string EventType,
    string ClientType,
    string IpAddress,
    string Location,
    DateTimeOffset Timestamp,
    string Details
);

/// <summary>
/// Enterprise governance policy for corporate and institutional accounts.
/// </summary>
public record CorporateGovernancePolicy(
    string Flavor,
    string OrgName,
    bool AllowsSelfServiceDeactivation,
    bool AllowsHistoryClearing,
    int RetentionPeriodDays,
    string EnforcingAuthority,
    string DeactivationProcedureNotice
);

/// <summary>
/// Service managing logged-on devices, session history, and enterprise corporate lifecycle governance.
/// </summary>
public class AccountDeviceService
{
    private readonly ConcurrentDictionary<string, UserDeviceSession> _sessions = new();
    private readonly ConcurrentDictionary<string, List<SessionHistoryEntry>> _history = new();
    private readonly ConcurrentDictionary<string, AccountLifecycleStatus> _lifecycle = new();

    /// <summary>
    /// Evaluates if self-service deactivation is permitted.
    /// Only solo/personal accounts can self-deactivate. Corporate and school accounts require IT/legal procedures.
    /// </summary>
    public static bool IsSelfServiceDeactivationAllowed(string role, string flavor)
    {
        if (flavor.Equals("school", StringComparison.OrdinalIgnoreCase) ||
            flavor.Equals("corporate", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (role.Equals("solo_dev", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return false;
    }

    /// <summary>
    /// Evaluates if self-service session history clearing is allowed under governance policy.
    /// In corporate and school compliance regimes, session history is an immutable audit log.
    /// </summary>
    public static bool IsHistoryClearingAllowed(string role, string flavor)
    {
        if (flavor.Equals("school", StringComparison.OrdinalIgnoreCase) ||
            flavor.Equals("corporate", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return role.Equals("solo_dev", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Gets corporate governance policy details for a given flavor and organization.
    /// </summary>
    public static CorporateGovernancePolicy GetCorporatePolicy(string flavor, string orgName = "")
    {
        var org = string.IsNullOrWhiteSpace(orgName) ? "Organization" : orgName;
        return flavor.ToLowerInvariant() switch
        {
            "corporate" => new CorporateGovernancePolicy(
                Flavor: "corporate",
                OrgName: org,
                AllowsSelfServiceDeactivation: false,
                AllowsHistoryClearing: false,
                RetentionPeriodDays: 365,
                EnforcingAuthority: $"{org} IT Security Policy (SOC-2 Type II Compliance)",
                DeactivationProcedureNotice: "Account provisioning, suspension, and deactivation are strictly managed by your Corporate IT Administrator and Legal Compliance Department. Individual accounts cannot be self-terminated."
            ),
            "school" => new CorporateGovernancePolicy(
                Flavor: "school",
                OrgName: org,
                AllowsSelfServiceDeactivation: false,
                AllowsHistoryClearing: false,
                RetentionPeriodDays: 180,
                EnforcingAuthority: $"{org} Academic Compliance & FERPA Audit Policy",
                DeactivationProcedureNotice: "Student and faculty accounts are provisioned and decommissioned via School IT Administration. Classroom rosters and audit records are preserved for academic continuity."
            ),
            _ => new CorporateGovernancePolicy(
                Flavor: "dev_team",
                OrgName: org,
                AllowsSelfServiceDeactivation: false,
                AllowsHistoryClearing: true,
                RetentionPeriodDays: 90,
                EnforcingAuthority: $"{org} Developer Team Policy",
                DeactivationProcedureNotice: "Team membership is administered by project owners. Contact your team lead for seat offboarding."
            )
        };
    }

    /// <summary>
    /// Seeds realistic active devices and historical login records for a user.
    /// </summary>
    public void SeedDefaultSessions(string userId, string currentSessionId = "sess_desktop_win11")
    {
        var now = DateTimeOffset.UtcNow;

        var desktop = new UserDeviceSession(
            SessionId: "sess_desktop_win11",
            UserId: userId,
            DeviceName: "Windows 11 Pro Desktop Workstation",
            ClientType: ClientDeviceType.DesktopApp,
            IpAddress: "10.0.0.15",
            UserAgent: "VESPR-Native-Desktop/1.0.0 (Windows NT 10.0; Win64; x64)",
            CreatedAt: now.AddHours(-6),
            LastActiveAt: now,
            IsCurrentDevice: currentSessionId == "sess_desktop_win11",
            IsRevoked: false
        );

        var web = new UserDeviceSession(
            SessionId: "sess_web_edge",
            UserId: userId,
            DeviceName: "Microsoft Edge on Windows",
            ClientType: ClientDeviceType.SdeWeb,
            IpAddress: "10.0.0.8",
            UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
            CreatedAt: now.AddDays(-2),
            LastActiveAt: now.AddMinutes(-34),
            IsCurrentDevice: currentSessionId == "sess_web_edge",
            IsRevoked: false
        );

        var mobile = new UserDeviceSession(
            SessionId: "sess_mobile_ios",
            UserId: userId,
            DeviceName: "iPhone 15 Pro Companion",
            ClientType: ClientDeviceType.MobileCompanion,
            IpAddress: "100.64.0.10",
            UserAgent: "VESPR-Mobile/2.4.0 (iOS 17.4; iPhone16,1)",
            CreatedAt: now.AddDays(-5),
            LastActiveAt: now.AddHours(-3),
            IsCurrentDevice: currentSessionId == "sess_mobile_ios",
            IsRevoked: false
        );

        var piTerminal = new UserDeviceSession(
            SessionId: "sess_pi_term",
            UserId: userId,
            DeviceName: "Raspberry Pi 5 Remote Terminal",
            ClientType: ClientDeviceType.TerminalCli,
            IpAddress: "10.0.0.8",
            UserAgent: "VESPR-CLI/1.0.0 (Linux aarch64; Debian 12)",
            CreatedAt: now.AddDays(-1),
            LastActiveAt: now.AddHours(-1),
            IsCurrentDevice: currentSessionId == "sess_pi_term",
            IsRevoked: false
        );

        _sessions[desktop.SessionId] = desktop;
        _sessions[web.SessionId] = web;
        _sessions[mobile.SessionId] = mobile;
        _sessions[piTerminal.SessionId] = piTerminal;

        _lifecycle[userId] = AccountLifecycleStatus.Active;

        var historyList = _history.GetOrAdd(userId, _ => new List<SessionHistoryEntry>());
        lock (historyList)
        {
            historyList.Clear();
            historyList.Add(new SessionHistoryEntry(
                EventId: "evt_001",
                UserId: userId,
                EventType: "login_success",
                ClientType: ClientDeviceType.DesktopApp,
                IpAddress: "10.0.0.15",
                Location: "Local Subnet (Atlanta, GA)",
                Timestamp: now.AddHours(-6),
                Details: "Windows Hello biometric authentication successful"
            ));
            historyList.Add(new SessionHistoryEntry(
                EventId: "evt_002",
                UserId: userId,
                EventType: "login_mfa_verified",
                ClientType: ClientDeviceType.SdeWeb,
                IpAddress: "10.0.0.8",
                Location: "Local Subnet (Atlanta, GA)",
                Timestamp: now.AddDays(-2),
                Details: "FIDO2 WebAuthn token verified"
            ));
            historyList.Add(new SessionHistoryEntry(
                EventId: "evt_003",
                UserId: userId,
                EventType: "token_refreshed",
                ClientType: ClientDeviceType.MobileCompanion,
                IpAddress: "100.64.0.10",
                Location: "VPN / LTE",
                Timestamp: now.AddHours(-3),
                Details: "OAuth2 refresh token renewed"
            ));
        }
    }

    /// <summary>
    /// Lists all active (unrevoked) device sessions for the given user.
    /// </summary>
    public IReadOnlyList<UserDeviceSession> GetActiveSessions(string userId)
    {
        return _sessions.Values
            .Where(s => s.UserId == userId && !s.IsRevoked)
            .OrderByDescending(s => s.IsCurrentDevice)
            .ThenByDescending(s => s.LastActiveAt)
            .ToList();
    }

    /// <summary>
    /// Lists all device sessions (including revoked) for the user.
    /// </summary>
    public IReadOnlyList<UserDeviceSession> GetAllSessions(string userId)
    {
        return _sessions.Values
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.IsCurrentDevice)
            .ThenByDescending(s => s.LastActiveAt)
            .ToList();
    }

    /// <summary>
    /// Retrieves a specific session by ID.
    /// </summary>
    public UserDeviceSession? GetSession(string sessionId)
    {
        _sessions.TryGetValue(sessionId, out var session);
        return session;
    }

    /// <summary>
    /// Revokes an individual device session.
    /// </summary>
    public bool RevokeSession(string actorUserId, string sessionId, string reason = "User initiated revocation")
    {
        if (!_sessions.TryGetValue(sessionId, out var session))
        {
            return false;
        }

        if (session.IsRevoked)
        {
            return true;
        }

        var revokedSession = session with
        {
            IsRevoked = true,
            RevokedAt = DateTimeOffset.UtcNow,
            RevokedBy = actorUserId
        };

        _sessions[sessionId] = revokedSession;

        RecordHistory(new SessionHistoryEntry(
            EventId: $"evt_{Guid.NewGuid():N}"[..12],
            UserId: session.UserId,
            EventType: "device_revoked",
            ClientType: session.ClientType,
            IpAddress: session.IpAddress,
            Location: "Security Control",
            Timestamp: DateTimeOffset.UtcNow,
            Details: $"Session '{session.DeviceName}' ({session.SessionId}) revoked by {actorUserId}. Reason: {reason}"
        ));

        return true;
    }

    /// <summary>
    /// Revokes all active sessions for the user except the specified current session.
    /// </summary>
    public int RevokeAllOtherSessions(string actorUserId, string currentSessionId)
    {
        var otherSessions = _sessions.Values
            .Where(s => s.UserId == actorUserId && !s.IsRevoked && s.SessionId != currentSessionId)
            .ToList();

        var count = 0;
        foreach (var sess in otherSessions)
        {
            if (RevokeSession(actorUserId, sess.SessionId, "Logged out from all other devices"))
            {
                count++;
            }
        }

        return count;
    }

    /// <summary>
    /// Records a security audit event in session history.
    /// </summary>
    public void RecordHistory(SessionHistoryEntry entry)
    {
        var historyList = _history.GetOrAdd(entry.UserId, _ => new List<SessionHistoryEntry>());
        lock (historyList)
        {
            historyList.Insert(0, entry);
        }
    }

    /// <summary>
    /// Lists all session history entries for a user in reverse-chronological order.
    /// </summary>
    public IReadOnlyList<SessionHistoryEntry> GetSessionHistory(string userId)
    {
        if (!_history.TryGetValue(userId, out var list))
        {
            return Array.Empty<SessionHistoryEntry>();
        }

        lock (list)
        {
            return list.OrderByDescending(e => e.Timestamp).ToList();
        }
    }

    /// <summary>
    /// Attempts to clear session history.
    /// Enforces corporate and school compliance: blocked if flavor is corporate or school.
    /// Allowed only for solo/personal accounts.
    /// </summary>
    public bool ClearSessionHistory(string actorUserId, string actorRole, string flavor, out string error)
    {
        if (!IsHistoryClearingAllowed(actorRole, flavor))
        {
            var policy = GetCorporatePolicy(flavor);
            error = $"Session history clearing is blocked by {policy.EnforcingAuthority}. Audit logs must be retained for compliance.";
            return false;
        }

        if (_history.TryGetValue(actorUserId, out var list))
        {
            lock (list)
            {
                list.Clear();
                list.Add(new SessionHistoryEntry(
                    EventId: $"evt_{Guid.NewGuid():N}"[..12],
                    UserId: actorUserId,
                    EventType: "history_cleared",
                    ClientType: ClientDeviceType.DesktopApp,
                    IpAddress: "127.0.0.1",
                    Location: "Local Device",
                    Timestamp: DateTimeOffset.UtcNow,
                    Details: "Session history audit trail cleared by user."
                ));
            }
        }

        error = string.Empty;
        return true;
    }

    /// <summary>
    /// Gets the account lifecycle status of a user.
    /// </summary>
    public AccountLifecycleStatus GetAccountLifecycle(string userId)
    {
        return _lifecycle.TryGetValue(userId, out var status) ? status : AccountLifecycleStatus.Active;
    }

    /// <summary>
    /// Suspends a user account. Requires IT Admin, Corporate Legal, or School Admin role.
    /// Immediately revokes all active device sessions.
    /// </summary>
    public bool SuspendAccount(string actorUserId, string actorRole, string targetUserId, string reason, out string error)
    {
        if (!IsAuthorizedLifecycleAdmin(actorRole))
        {
            error = "Unauthorized: Only IT Administrators, School Administrators, or Corporate Legal may suspend accounts.";
            return false;
        }

        _lifecycle[targetUserId] = AccountLifecycleStatus.Suspended;

        // Revoke all active sessions
        var activeSessions = GetActiveSessions(targetUserId);
        foreach (var session in activeSessions)
        {
            RevokeSession(actorUserId, session.SessionId, $"Account suspended: {reason}");
        }

        RecordHistory(new SessionHistoryEntry(
            EventId: $"evt_{Guid.NewGuid():N}"[..12],
            UserId: targetUserId,
            EventType: "account_suspended",
            ClientType: ClientDeviceType.DesktopApp,
            IpAddress: "127.0.0.1",
            Location: "Administrative Console",
            Timestamp: DateTimeOffset.UtcNow,
            Details: $"Account placed in Suspended status by {actorUserId} ({actorRole}). Reason: {reason}"
        ));

        error = string.Empty;
        return true;
    }

    /// <summary>
    /// Deactivates a corporate or school user account. Requires IT Admin, Corporate Legal, or School Admin role.
    /// Individual users cannot self-deactivate in managed environments.
    /// </summary>
    public bool DeactivateAccount(string actorUserId, string actorRole, string targetUserId, string reason, out string error)
    {
        if (!IsAuthorizedLifecycleAdmin(actorRole))
        {
            error = "Unauthorized: Company policy dictates that only IT Administrators or Corporate Legal may deactivate enterprise accounts.";
            return false;
        }

        _lifecycle[targetUserId] = AccountLifecycleStatus.Deactivated;

        // Revoke all active sessions
        var activeSessions = GetActiveSessions(targetUserId);
        foreach (var session in activeSessions)
        {
            RevokeSession(actorUserId, session.SessionId, $"Corporate seat deactivation: {reason}");
        }

        RecordHistory(new SessionHistoryEntry(
            EventId: $"evt_{Guid.NewGuid():N}"[..12],
            UserId: targetUserId,
            EventType: "account_deactivated",
            ClientType: ClientDeviceType.DesktopApp,
            IpAddress: "127.0.0.1",
            Location: "Administrative Console",
            Timestamp: DateTimeOffset.UtcNow,
            Details: $"Account deactivated by {actorUserId} ({actorRole}). Reason: {reason}"
        ));

        error = string.Empty;
        return true;
    }

    /// <summary>
    /// Reactivates a suspended or deactivated account. Requires IT Admin or School Admin role.
    /// </summary>
    public bool ReactivateAccount(string actorUserId, string actorRole, string targetUserId, string reason, out string error)
    {
        if (actorRole != "it_admin" && actorRole != "school_admin")
        {
            error = "Unauthorized: Reactivation requires IT Administrator or School Administrator authorization.";
            return false;
        }

        _lifecycle[targetUserId] = AccountLifecycleStatus.Active;

        RecordHistory(new SessionHistoryEntry(
            EventId: $"evt_{Guid.NewGuid():N}"[..12],
            UserId: targetUserId,
            EventType: "account_reactivated",
            ClientType: ClientDeviceType.DesktopApp,
            IpAddress: "127.0.0.1",
            Location: "Administrative Console",
            Timestamp: DateTimeOffset.UtcNow,
            Details: $"Account restored to Active status by {actorUserId} ({actorRole}). Reason: {reason}"
        ));

        error = string.Empty;
        return true;
    }

    private static bool IsAuthorizedLifecycleAdmin(string role) =>
        role is "it_admin" or "school_admin" or "corporate_legal";
}
