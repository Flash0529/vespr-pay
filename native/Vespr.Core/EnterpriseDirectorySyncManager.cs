using System.Collections.Concurrent;

namespace Vespr.Core;

public record GitHubMemberRecord(
    string Login,
    string Email,
    string GitHubRole,
    List<string>? Teams = null,
    bool IsSuspended = false
)
{
    public List<string> Teams { get; init; } = Teams ?? new List<string>();
}

public record ScimUserRecord(
    string ScimId,
    string Email,
    string Department,
    string JobTitle,
    bool Active = true
);

public record DirectorySyncEvent(
    string Provider,
    string Action,
    string TargetUser,
    string AssignedRole,
    DateTime Timestamp,
    bool Success = true
);

public record DirectorySyncStatus(
    bool GitHubConnected,
    string GitHubOrg,
    DateTime? GitHubLastSync,
    int GitHubMembersCount,
    bool ScimConnected,
    string ScimProvider,
    DateTime? ScimLastSync,
    int ScimUsersCount,
    int TotalProvisionedSeats,
    int SuspendedSeats
);

public class EnterpriseDirectorySyncManager
{
    private readonly SmartRoleManager _roleManager;
    private readonly ConcurrentDictionary<string, GitHubMemberRecord> _githubMembers = new();
    private readonly ConcurrentDictionary<string, ScimUserRecord> _scimUsers = new();
    private readonly ConcurrentDictionary<string, string> _teamMappings = new();
    private readonly ConcurrentBag<DirectorySyncEvent> _auditTrail = new();

    public string GitHubOrg { get; set; } = "apex-systems-cloud";
    public bool GitHubConnected { get; set; } = true;
    public DateTime? GitHubLastSync { get; private set; }

    public string ScimProviderName { get; set; } = "Okta Enterprise SCIM 2.0";
    public bool ScimConnected { get; set; } = true;
    public DateTime? ScimLastSync { get; private set; }

    public EnterpriseDirectorySyncManager(SmartRoleManager roleManager)
    {
        _roleManager = roleManager;

        // Default GitHub Team -> VESPR Role mappings
        _teamMappings["org-owners"] = "it_admin";
        _teamMappings["lead-architects"] = "senior_dev";
        _teamMappings["backend-engineers"] = "senior_dev";
        _teamMappings["frontend-engineers"] = "junior_dev";
        _teamMappings["interns"] = "intern";
        _teamMappings["design-system"] = "student"; // restricted
        _teamMappings["compliance-officers"] = "corporate_legal";

        SeedInitialDirectory();
    }

    private void SeedInitialDirectory()
    {
        var members = new List<GitHubMemberRecord>
        {
            new("shamit-apex", "owner@example.com", "admin", new() { "org-owners", "lead-architects" }),
            new("alex-apex", "alex.m@apexsystems.com", "member", new() { "backend-engineers" }),
            new("devon-apex", "devon.v@apexsystems.com", "member", new() { "frontend-engineers" }),
            new("maya-intern", "maya.lin@stanford.edu", "member", new() { "interns" }),
            new("elena-legal", "elena.r@corporate-legal.org", "member", new() { "compliance-officers" })
        };

        foreach (var m in members)
        {
            _githubMembers[m.Email] = m;
        }

        SyncAllGitHubMembers();
    }

    public void SetTeamMapping(string githubTeam, string vesprRoleId)
    {
        _teamMappings[githubTeam] = vesprRoleId;
    }

    public IReadOnlyDictionary<string, string> GetTeamMappings() => _teamMappings;

    public void SyncAllGitHubMembers()
    {
        foreach (var pair in _githubMembers)
        {
            SyncSingleGitHubMember(pair.Value);
        }
        GitHubLastSync = DateTime.UtcNow;
    }

    public void IngestGitHubMembers(IEnumerable<GitHubMemberRecord> members)
    {
        foreach (var m in members)
        {
            _githubMembers[m.Email] = m;
            SyncSingleGitHubMember(m);
        }
        GitHubLastSync = DateTime.UtcNow;
    }

    private void SyncSingleGitHubMember(GitHubMemberRecord member)
    {
        if (member.IsSuspended)
        {
            _auditTrail.Add(new("GitHub", "SUSPEND_SEAT", member.Email, "none", DateTime.UtcNow));
            return;
        }

        // Determine highest role based on teams
        string targetRole = "junior_dev"; // default
        if (member.GitHubRole == "admin")
        {
            targetRole = "senior_dev";
        }

        foreach (var team in member.Teams)
        {
            if (_teamMappings.TryGetValue(team, out var mappedRole))
            {
                targetRole = mappedRole;
                break;
            }
        }

        _roleManager.AssignRoleToUser(member.Email, targetRole);
        _auditTrail.Add(new("GitHub", "SYNC_ROLE", member.Email, targetRole, DateTime.UtcNow));
    }

    public void IngestScimUsers(IEnumerable<ScimUserRecord> users)
    {
        foreach (var user in users)
        {
            _scimUsers[user.Email] = user;
            if (!user.Active)
            {
                _auditTrail.Add(new("SCIM", "DEPROVISION_USER", user.Email, "none", DateTime.UtcNow));
                continue;
            }

            var targetRole = "junior_dev";
            if (user.Department.Equals("Legal", StringComparison.OrdinalIgnoreCase) || user.JobTitle.Contains("Compliance"))
            {
                targetRole = "corporate_legal";
            }
            else if (user.Department.Equals("IT", StringComparison.OrdinalIgnoreCase) || user.JobTitle.Contains("Admin"))
            {
                targetRole = "it_admin";
            }
            else if (user.JobTitle.Contains("Lead") || user.JobTitle.Contains("Senior"))
            {
                targetRole = "senior_dev";
            }
            else if (user.JobTitle.Contains("Intern"))
            {
                targetRole = "intern";
            }

            _roleManager.AssignRoleToUser(user.Email, targetRole);
            _auditTrail.Add(new("SCIM", "PROVISION_USER", user.Email, targetRole, DateTime.UtcNow));
        }

        ScimLastSync = DateTime.UtcNow;
    }

    public DirectorySyncStatus GetStatus()
    {
        var suspended = _githubMembers.Values.Count(m => m.IsSuspended) + _scimUsers.Values.Count(u => !u.Active);
        var active = _githubMembers.Values.Count(m => !m.IsSuspended);

        return new DirectorySyncStatus(
            GitHubConnected: GitHubConnected,
            GitHubOrg: GitHubOrg,
            GitHubLastSync: GitHubLastSync,
            GitHubMembersCount: _githubMembers.Count,
            ScimConnected: ScimConnected,
            ScimProvider: ScimProviderName,
            ScimLastSync: ScimLastSync,
            ScimUsersCount: _scimUsers.Count,
            TotalProvisionedSeats: active,
            SuspendedSeats: suspended
        );
    }

    public IReadOnlyList<DirectorySyncEvent> GetAuditTrail() => _auditTrail.OrderByDescending(e => e.Timestamp).ToList();
}