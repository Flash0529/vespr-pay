using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace Vespr.Core;

public enum ShellAccessTier
{
    None = 0,
    SandboxedIsolated = 1,
    FullHost = 2
}

public enum FileSystemAccessTier
{
    ReadOnlyProject = 0,
    ProjectWorkspaceOnly = 1,
    DualProjectAndHost = 2,
    FullSystem = 3
}

public enum NetworkAccessTier
{
    Off = 0,
    AllowlistOnly = 1,
    FullInternet = 2
}

public enum AgentAutonomyTier
{
    RestrictedTutor = 0,
    GuidedAssistedOnly = 1,
    StandardSDE = 2,
    MultiAgentAutonomous = 3
}

public enum DataRetentionTier
{
    Ephemeral = 0,
    Standard30Days = 1,
    SOC2Compliant180Days = 2,
    FERPACompliant365Days = 3
}

public record RoleDefinition(
    string RoleId,
    string DisplayName,
    string Description,
    string Flavor,
    ShellAccessTier Shell = ShellAccessTier.SandboxedIsolated,
    FileSystemAccessTier FileSystem = FileSystemAccessTier.ProjectWorkspaceOnly,
    NetworkAccessTier Network = NetworkAccessTier.AllowlistOnly,
    AgentAutonomyTier Autonomy = AgentAutonomyTier.StandardSDE,
    DataRetentionTier Retention = DataRetentionTier.Standard30Days,
    bool AllowChatSharing = true,
    int MaxDailyComputeTokens = 250000,
    bool RequireMfa = false,
    bool AllowSelfServiceDeactivation = true,
    bool IsSystemImmutable = false,
    List<string>? Tags = null
)
{
    public List<string> Tags { get; init; } = Tags ?? new List<string>();
}

public class SmartRoleManager
{
    private readonly ConcurrentDictionary<string, RoleDefinition> _roles = new();
    private readonly ConcurrentDictionary<string, string> _userAssignments = new();

    public SmartRoleManager()
    {
        SeedStandardRoles();
    }

    private void SeedStandardRoles()
    {
        var builtIn = new List<RoleDefinition>
        {
            new("student", "Student", "Middle and high school enrolled learner with safety guardrails", "school",
                Shell: ShellAccessTier.None,
                FileSystem: FileSystemAccessTier.ReadOnlyProject,
                Network: NetworkAccessTier.AllowlistOnly,
                Autonomy: AgentAutonomyTier.RestrictedTutor,
                Retention: DataRetentionTier.FERPACompliant365Days,
                AllowChatSharing: false,
                MaxDailyComputeTokens: 50000,
                RequireMfa: false,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Education", "K-12", "Safety" }),

            new("teacher", "Teacher / Instructor", "Classroom educator managing students, assignments, and pods", "school",
                Shell: ShellAccessTier.SandboxedIsolated,
                FileSystem: FileSystemAccessTier.ProjectWorkspaceOnly,
                Network: NetworkAccessTier.FullInternet,
                Autonomy: AgentAutonomyTier.StandardSDE,
                Retention: DataRetentionTier.FERPACompliant365Days,
                AllowChatSharing: true,
                MaxDailyComputeTokens: 300000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Education", "Faculty", "Grader" }),

            new("school_admin", "School Administrator", "Educational institution admin overseeing classrooms and compliance", "school",
                Shell: ShellAccessTier.SandboxedIsolated,
                FileSystem: FileSystemAccessTier.ProjectWorkspaceOnly,
                Network: NetworkAccessTier.FullInternet,
                Autonomy: AgentAutonomyTier.StandardSDE,
                Retention: DataRetentionTier.FERPACompliant365Days,
                AllowChatSharing: true,
                MaxDailyComputeTokens: 500000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Education", "Admin", "FERPA" }),

            new("intern", "Software Engineering Intern", "Junior trainee with sandbox restrictions and supervised merges", "corporate",
                Shell: ShellAccessTier.SandboxedIsolated,
                FileSystem: FileSystemAccessTier.ProjectWorkspaceOnly,
                Network: NetworkAccessTier.AllowlistOnly,
                Autonomy: AgentAutonomyTier.GuidedAssistedOnly,
                Retention: DataRetentionTier.SOC2Compliant180Days,
                AllowChatSharing: false,
                MaxDailyComputeTokens: 100000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Engineering", "Trainee", "Sandboxed" }),

            new("junior_dev", "Junior Developer", "Core developer working with isolated branch checkouts and tests", "corporate",
                Shell: ShellAccessTier.SandboxedIsolated,
                FileSystem: FileSystemAccessTier.DualProjectAndHost,
                Network: NetworkAccessTier.AllowlistOnly,
                Autonomy: AgentAutonomyTier.StandardSDE,
                Retention: DataRetentionTier.SOC2Compliant180Days,
                AllowChatSharing: true,
                MaxDailyComputeTokens: 350000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Engineering", "Developer" }),

            new("senior_dev", "Senior Developer / Tech Lead", "Full autonomous multi-agent developer with host access", "corporate",
                Shell: ShellAccessTier.FullHost,
                FileSystem: FileSystemAccessTier.DualProjectAndHost,
                Network: NetworkAccessTier.FullInternet,
                Autonomy: AgentAutonomyTier.MultiAgentAutonomous,
                Retention: DataRetentionTier.SOC2Compliant180Days,
                AllowChatSharing: true,
                MaxDailyComputeTokens: 1500000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Engineering", "Lead", "Autonomous" }),

            new("it_admin", "Corporate IT Admin", "Enterprise administrator governing seats, SSO, and device security", "corporate",
                Shell: ShellAccessTier.FullHost,
                FileSystem: FileSystemAccessTier.FullSystem,
                Network: NetworkAccessTier.FullInternet,
                Autonomy: AgentAutonomyTier.MultiAgentAutonomous,
                Retention: DataRetentionTier.SOC2Compliant180Days,
                AllowChatSharing: true,
                MaxDailyComputeTokens: 2000000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "IT", "Security", "SCIM" }),

            new("corporate_legal", "Corporate Legal & Compliance", "Audit and legal officer with read-only retention review", "corporate",
                Shell: ShellAccessTier.None,
                FileSystem: FileSystemAccessTier.ReadOnlyProject,
                Network: NetworkAccessTier.AllowlistOnly,
                Autonomy: AgentAutonomyTier.GuidedAssistedOnly,
                Retention: DataRetentionTier.SOC2Compliant180Days,
                AllowChatSharing: false,
                MaxDailyComputeTokens: 150000,
                RequireMfa: true,
                AllowSelfServiceDeactivation: false,
                IsSystemImmutable: true,
                Tags: new() { "Legal", "Compliance", "Audit" }),

            new("solo_dev", "Solo Developer / Personal", "Independent developer with full workspace control and self-deactivation", "personal_dev",
                Shell: ShellAccessTier.FullHost,
                FileSystem: FileSystemAccessTier.DualProjectAndHost,
                Network: NetworkAccessTier.FullInternet,
                Autonomy: AgentAutonomyTier.MultiAgentAutonomous,
                Retention: DataRetentionTier.Standard30Days,
                AllowChatSharing: true,
                MaxDailyComputeTokens: 800000,
                RequireMfa: false,
                AllowSelfServiceDeactivation: true,
                IsSystemImmutable: true,
                Tags: new() { "Solo", "Personal" })
        };

        foreach (var r in builtIn)
        {
            _roles[r.RoleId] = r;
        }

        // Default test assignment
        _userAssignments["owner@example.com"] = "senior_dev";
    }

    public IReadOnlyList<RoleDefinition> GetRoles()
    {
        return _roles.Values.OrderBy(r => r.DisplayName).ToList();
    }

    public RoleDefinition? GetRole(string roleId)
    {
        _roles.TryGetValue(roleId, out var role);
        return role;
    }

    public bool CreateRole(RoleDefinition role)
    {
        if (string.IsNullOrWhiteSpace(role.RoleId)) return false;
        return _roles.TryAdd(role.RoleId, role with { IsSystemImmutable = false });
    }

    public bool UpdateRole(RoleDefinition role)
    {
        if (!_roles.TryGetValue(role.RoleId, out var existing)) return false;
        if (existing.IsSystemImmutable) return false; // Prevent mutating built-ins directly

        _roles[role.RoleId] = role with { IsSystemImmutable = false };
        return true;
    }

    public bool DeleteRole(string roleId)
    {
        if (!_roles.TryGetValue(roleId, out var existing)) return false;
        if (existing.IsSystemImmutable) return false;

        return _roles.TryRemove(roleId, out _);
    }

    public void AssignRoleToUser(string userId, string roleId)
    {
        if (!_roles.ContainsKey(roleId))
            throw new ArgumentException($"Role {roleId} does not exist");
        _userAssignments[userId] = roleId;
    }

    public RoleDefinition GetUserRole(string userId)
    {
        if (_userAssignments.TryGetValue(userId, out var roleId) && _roles.TryGetValue(roleId, out var role))
        {
            return role;
        }
        return _roles["junior_dev"]; // Safe fallback
    }

    public RoleDefinition SynthesizeRoleFromPrompt(string prompt)
    {
        var lower = prompt.ToLowerInvariant();
        var idSlug = Regex.Replace(lower, @"[^a-z0-9]+", "_").Trim('_');
        if (idSlug.Length > 24) idSlug = idSlug.Substring(0, 24);
        if (string.IsNullOrEmpty(idSlug)) idSlug = "custom_role";

        var displayName = ToTitleCase(prompt.Length > 30 ? prompt.Substring(0, 30) : prompt);
        var flavor = "corporate";
        var shell = ShellAccessTier.SandboxedIsolated;
        var fs = FileSystemAccessTier.ProjectWorkspaceOnly;
        var net = NetworkAccessTier.AllowlistOnly;
        var autonomy = AgentAutonomyTier.StandardSDE;
        var retention = DataRetentionTier.Standard30Days;
        var sharing = true;
        var tokens = 250000;
        var mfa = false;
        var selfDeact = false;
        var tags = new List<string>();

        // Heuristic analysis based on user prompt requirements
        if (lower.Contains("design") || lower.Contains("canva") || lower.Contains("figma"))
        {
            displayName = "Creative & UI Designer";
            shell = ShellAccessTier.None;
            fs = FileSystemAccessTier.ProjectWorkspaceOnly;
            net = NetworkAccessTier.AllowlistOnly;
            autonomy = AgentAutonomyTier.GuidedAssistedOnly;
            tokens = 150000;
            tags.AddRange(new[] { "Design", "UI/UX", "Assets" });
        }
        else if (lower.Contains("student") || lower.Contains("k-12") || lower.Contains("school"))
        {
            displayName = "Custom Student Learner";
            flavor = "school";
            shell = ShellAccessTier.None;
            fs = FileSystemAccessTier.ReadOnlyProject;
            autonomy = AgentAutonomyTier.RestrictedTutor;
            retention = DataRetentionTier.FERPACompliant365Days;
            sharing = false;
            tokens = 60000;
            tags.AddRange(new[] { "Education", "Learner" });
        }
        else if (lower.Contains("contractor") || lower.Contains("vendor") || lower.Contains("external"))
        {
            displayName = "External Contractor";
            shell = ShellAccessTier.SandboxedIsolated;
            fs = FileSystemAccessTier.ProjectWorkspaceOnly;
            net = NetworkAccessTier.AllowlistOnly;
            autonomy = AgentAutonomyTier.GuidedAssistedOnly;
            retention = DataRetentionTier.SOC2Compliant180Days;
            sharing = false;
            tokens = 120000;
            mfa = true;
            tags.AddRange(new[] { "Contractor", "External", "Restricted" });
        }
        else if (lower.Contains("devops") || lower.Contains("cloud") || lower.Contains("infra") || lower.Contains("lead"))
        {
            displayName = "Lead Cloud & DevOps Engineer";
            shell = ShellAccessTier.FullHost;
            fs = FileSystemAccessTier.DualProjectAndHost;
            net = NetworkAccessTier.FullInternet;
            autonomy = AgentAutonomyTier.MultiAgentAutonomous;
            retention = DataRetentionTier.SOC2Compliant180Days;
            tokens = 1200000;
            mfa = true;
            tags.AddRange(new[] { "DevOps", "Infrastructure", "Lead" });
        }
        else
        {
            tags.Add("Custom");
        }

        // Check if token limit specified in prompt
        var tokenMatch = Regex.Match(lower, @"(\d+)\s*(k|m)?\s*tokens?");
        if (tokenMatch.Success)
        {
            var num = int.Parse(tokenMatch.Groups[1].Value);
            var mult = tokenMatch.Groups[2].Value switch
            {
                "k" => 1000,
                "m" => 1000000,
                _ => 1
            };
            tokens = num * mult;
        }

        return new RoleDefinition(
            RoleId: $"custom_{idSlug}",
            DisplayName: displayName,
            Description: $"Synthesized role from prompt: {prompt}",
            Flavor: flavor,
            Shell: shell,
            FileSystem: fs,
            Network: net,
            Autonomy: autonomy,
            Retention: retention,
            AllowChatSharing: sharing,
            MaxDailyComputeTokens: tokens,
            RequireMfa: mfa,
            AllowSelfServiceDeactivation: selfDeact,
            IsSystemImmutable: false,
            Tags: tags
        );
    }

    private static string ToTitleCase(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return text;
        var words = text.Split(new[] { ' ', '_', '-' }, StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < words.Length; i++)
        {
            if (words[i].Length > 0)
                words[i] = char.ToUpperInvariant(words[i][0]) + (words[i].Length > 1 ? words[i].Substring(1).ToLowerInvariant() : "");
        }
        return string.Join(" ", words);
    }
}