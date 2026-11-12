using System.Collections.Concurrent;

namespace Vespr.Core;

public enum StudentAgeTier
{
    MiddleSchoolUnder, // < 14: simplified, restricted shell, safety controls
    HighSchoolPlus     // 14+: full SDE power, terminal, multi-agent
}

public record AgeLayoutConfiguration(
    StudentAgeTier AgeTier,
    bool IsSimplifiedLayout,
    bool AllowShellTerminal,
    bool AllowNetworkEgress,
    bool AllowAdvancedSettings,
    bool GuidedPromptsOnly,
    string UIMode
);

public record ProjectScopeSlide(
    int SlideNumber,
    string Title,
    List<string> BulletPoints,
    string ScopeSummary
);

public record ProjectPart(
    string PartId,
    string Title,
    string ModuleFile,
    string AssignedTo,
    bool IsPod,
    List<string> PodMembers,
    string Status,
    int Score
);

public record OrchestratedProject(
    string ProjectId,
    string Title,
    string TeacherPrompt,
    string DifficultyMode, // "Beginner_Pods" or "Advanced_Individual"
    List<ProjectScopeSlide> ScopeSlides,
    List<ProjectPart> Parts,
    DateTimeOffset CreatedAt
);

public record RecurringChatSchedule(
    string ScheduleId,
    string ChatTitle,
    string PromptText,
    string IntervalType, // "Daily", "Weekly", "Monthly", "Custom"
    int IntervalStep,
    DateTimeOffset NextRun,
    DateTimeOffset? LastRun,
    bool IsActive,
    List<string> AttachedContextFiles
);

public record SearchableChatEntry(
    string ChatId,
    string Title,
    string Snippet,
    DateTimeOffset Timestamp,
    bool IsRecurring,
    bool IsReadOnly,
    double RelevanceScore = 0.0
);

public class ClassroomOrchestratorService
{
    private StudentAgeTier _currentAgeTier = StudentAgeTier.HighSchoolPlus;
    private readonly ConcurrentDictionary<string, OrchestratedProject> _projects = new();
    private readonly ConcurrentDictionary<string, RecurringChatSchedule> _recurringSchedules = new();
    private readonly List<SearchableChatEntry> _chatHistory = new();

    public ClassroomOrchestratorService()
    {
        SeedDefaultProject();
        SeedDefaultSchedules();
        SeedChatHistory();
    }

    public StudentAgeTier GetCurrentAgeTier() => _currentAgeTier;
    public void SetAgeTier(StudentAgeTier tier) => _currentAgeTier = tier;

    public AgeLayoutConfiguration GetLayoutConfig(StudentAgeTier tier) => tier switch
    {
        StudentAgeTier.MiddleSchoolUnder => new AgeLayoutConfiguration(
            AgeTier: StudentAgeTier.MiddleSchoolUnder,
            IsSimplifiedLayout: true,
            AllowShellTerminal: false,
            AllowNetworkEgress: false,
            AllowAdvancedSettings: false,
            GuidedPromptsOnly: true,
            UIMode: "friendly_blocks"
        ),
        _ => new AgeLayoutConfiguration(
            AgeTier: StudentAgeTier.HighSchoolPlus,
            IsSimplifiedLayout: false,
            AllowShellTerminal: true,
            AllowNetworkEgress: true,
            AllowAdvancedSettings: true,
            GuidedPromptsOnly: false,
            UIMode: "pro_sde"
        )
    };

    public OrchestratedProject CreateOrchestratedProject(string title, string teacherPrompt, bool usePodsForBeginners)
    {
        var projectId = "proj_" + Guid.NewGuid().ToString("N")[..8];
        var mode = usePodsForBeginners ? "Beginner_Pods" : "Advanced_Individual";

        var slides = new List<ProjectScopeSlide>
        {
            new ProjectScopeSlide(1, "Project Architecture & Scope", new List<string> {
                "Overall objective: " + title,
                "Teacher prompt: " + teacherPrompt,
                "Microservice architecture split across autonomous team modules"
            }, "Defines system boundary and shared API specifications."),
            new ProjectScopeSlide(2, "Task Distribution & Pod Workflows", new List<string> {
                usePodsForBeginners ? "Beginner Pods: 3-student pods reduce individual workload" : "Advanced Track: 1:1 module ownership with automated unit tests",
                "Continuous integration with automated test suite",
                "AI Pair Programmer guidance enabled per student role"
            }, "Orchestrates individual deliverables and integration merge points.")
        };

        var parts = new List<ProjectPart>();
        if (usePodsForBeginners)
        {
            parts.Add(new ProjectPart("part_1", "Cart & Calculation Engine", "cart.py", "Pod Alpha (Alex, Sam, Jamie)", true, new List<string> { "Alex", "Sam", "Jamie" }, "In Progress", 95));
            parts.Add(new ProjectPart("part_2", "Payment Gateway & Stripe Webhooks", "payment.py", "Pod Beta (Jordan, Taylor, Morgan)", true, new List<string> { "Jordan", "Taylor", "Morgan" }, "Submitted", 100));
            parts.Add(new ProjectPart("part_3", "Search & Product Indexing", "search.py", "Pod Gamma (Casey, Riley, Quinn)", true, new List<string> { "Casey", "Riley", "Quinn" }, "In Progress", 90));
        }
        else
        {
            parts.Add(new ProjectPart("part_1", "Discount Calculation Algorithm", "cart.py", "Alex Morgan", false, new List<string> { "Alex Morgan" }, "In Progress", 100));
            parts.Add(new ProjectPart("part_2", "Stripe Payment Tokenizer", "stripe_handler.py", "Taylor Swift", false, new List<string> { "Taylor Swift" }, "Submitted", 100));
            parts.Add(new ProjectPart("part_3", "Inverted Index Parser", "indexer.py", "Jordan Lee", false, new List<string> { "Jordan Lee" }, "In Progress", 85));
        }

        var project = new OrchestratedProject(projectId, title, teacherPrompt, mode, slides, parts, DateTimeOffset.UtcNow);
        _projects[projectId] = project;
        return project;
    }

    public OrchestratedProject? GetProject(string projectId) =>
        _projects.TryGetValue(projectId, out var p) ? p : null;

    public IReadOnlyList<OrchestratedProject> ListProjects() => _projects.Values.ToList();

    private void SeedDefaultProject()
    {
        CreateOrchestratedProject(
            "E-Commerce Microservices Engine",
            "Build a modular Python e-commerce application with discount calculation, Stripe billing, and Google Classroom autograded turn-in.",
            usePodsForBeginners: true
        );
    }

    public RecurringChatSchedule ScheduleRepeatChat(string title, string prompt, string intervalType, int intervalStep, List<string> attachedFiles)
    {
        var id = "sched_" + Guid.NewGuid().ToString("N")[..8];
        var now = DateTimeOffset.UtcNow;
        var next = intervalType switch
        {
            "Daily" => now.AddDays(intervalStep),
            "Weekly" => now.AddDays(7 * intervalStep),
            "Monthly" => now.AddMonths(intervalStep),
            _ => now.AddDays(1)
        };

        var sched = new RecurringChatSchedule(id, title, prompt, intervalType, intervalStep, next, null, true, attachedFiles);
        _recurringSchedules[id] = sched;
        return sched;
    }

    public IReadOnlyList<RecurringChatSchedule> GetRecurringSchedules() =>
        _recurringSchedules.Values.OrderBy(s => s.NextRun).ToList();

    private void SeedDefaultSchedules()
    {
        var now = DateTimeOffset.UtcNow;
        ScheduleRepeatChat("Daily Standup & Test Health", "@coder summarize test status, git diffs, and failing tests", "Daily", 1, new List<string> { "test_cart.py" });
        ScheduleRepeatChat("Weekly Security & Compliance Audit", "@reviewer audit dependencies and off-company access permissions", "Weekly", 1, new List<string> { "access.js" });
    }

    private void SeedChatHistory()
    {
        var now = DateTimeOffset.UtcNow;
        _chatHistory.Add(new SearchableChatEntry("chat_1", "Fix the discount bug in cart.py", "Discussion on applying discounts without losing 2 decimal rounding precision.", now.AddHours(-1), false, false));
        _chatHistory.Add(new SearchableChatEntry("chat_2", "Native C# Device & Corporate Security", "Architecture discussion for desktop app logged-on device management and SOC-2 audit locks.", now.AddHours(-3), false, false));
        _chatHistory.Add(new SearchableChatEntry("chat_3", "Google Classroom Autograder Sync", "Batch export of grades and student assignment turn-in integration with Google Classroom.", now.AddHours(-6), false, false));
        _chatHistory.Add(new SearchableChatEntry("chat_4", "Off-Company Partner Chat", "Guest view-only session for external audit team.", now.AddDays(-1), false, true));
        _chatHistory.Add(new SearchableChatEntry("chat_5", "Daily Standup & Test Health", "Scheduled recurrence: daily check on test pass rates.", now.AddDays(-2), true, false));
    }

    public IReadOnlyList<SearchableChatEntry> SearchChats(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return _chatHistory.OrderByDescending(c => c.Timestamp).ToList();
        }

        var q = query.ToLowerInvariant().Trim();
        var terms = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return _chatHistory
            .Select(c =>
            {
                var text = $"{c.Title} {c.Snippet}".ToLowerInvariant();
                double score = 0;
                foreach (var term in terms)
                {
                    if (c.Title.ToLowerInvariant().Contains(term)) score += 3.0;
                    if (c.Snippet.ToLowerInvariant().Contains(term)) score += 1.0;
                }
                return c with { RelevanceScore = score };
            })
            .Where(c => c.RelevanceScore > 0)
            .OrderByDescending(c => c.RelevanceScore)
            .ThenByDescending(c => c.Timestamp)
            .ToList();
    }
}
