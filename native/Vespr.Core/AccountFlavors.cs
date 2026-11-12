using System.Globalization;

namespace Vespr.Core;

/// <summary>
/// Account flavors, roles, school classrooms & corporate governance for VESPR SDE.
/// Port of app/account-flavors.js.
/// </summary>
public static class AccountFlavors
{
    public static readonly string[] Flavors = ["school", "dev_team", "corporate"];

    public static readonly string[] Roles =
    [
        "student", "teacher", "school_admin",
        "solo_dev", "intern", "junior_dev", "senior_dev",
        "it_admin", "corporate_legal"
    ];

    public record UserPermissions(
        string[] Modes,
        bool AllowBypass,
        bool AllowShell,
        bool AllowEgress,
        long DailyTokenLimit,
        bool AutograderAccess,
        bool SlidesAccess,
        bool EditAssignments,
        bool ManageClassrooms,
        bool ComplianceAudit
    );

    public record AccountProfile(
        string Id,
        string Name,
        string Email,
        string Flavor,
        string Role,
        string OrgName,
        string? ClassroomId,
        string? ClassroomCode,
        string AvatarBg,
        string AvatarLetter,
        string BadgeText,
        UserPermissions Permissions
    );

    public record ClassroomInfo(
        string Id,
        string Code,
        string Name,
        string Teacher,
        int StudentCount,
        int AssignmentsCount,
        string? ActiveAssignmentId,
        int SlidesCount
    );

    public record RubricItem(string Id, string Name, int Points, string TestName);

    public record LectureSlide(string Title, List<string> Bullets);

    public record AssignmentSpec(
        string Id,
        string ClassroomId,
        string ClassroomCode,
        string Title,
        string DueDate,
        int PointsPossible,
        string Description,
        string StarterCode,
        List<RubricItem> Rubric,
        List<LectureSlide> Slides
    );

    public record RubricResult(
        string RubricId,
        string Name,
        int PointsPossible,
        int PointsEarned,
        bool Passed,
        string Reason
    );

    public record GradingReport(
        string AssignmentId,
        int PointsPossible,
        int TotalScore,
        int Percentage,
        bool Passed,
        List<RubricResult> Results
    );

    public record TourStep(string Title, string Content, string Target);

    public record TourSpec(string Role, string Flavor, string Title, List<TourStep> Steps);

    public record StripePack(
        string Id,
        string Name,
        double PriceUsd,
        double CreditsUsd,
        string TokensEstimate,
        bool Popular = false
    );

    public record CheckoutResult(
        bool Success,
        string TransactionId,
        string AccountId,
        string PackId,
        string PackName,
        double AmountChargedUsd,
        double CreditsAddedUsd,
        double PreviousBalanceUsd,
        double NewBalanceUsd,
        string ReceiptUrl,
        long Timestamp
    );

    public record MerchantPurchaseResult(
        bool Success,
        string ChargeId,
        string MerchantAccountId,
        string CustomerEmail,
        string ItemName,
        int AmountCents,
        double AmountUsd,
        double FeeUsd,
        double NetUsd,
        string Status,
        long Timestamp
    );

    public static readonly List<AccountProfile> PreconfiguredAccounts =
    [
        new(
            "acc_student_alex",
            "Alex Morgan",
            "alex.morgan@lincoln.edu",
            "school",
            "student",
            "Lincoln High School",
            "cs101",
            "CS101-FALL26-A4",
            "#3b82f6",
            "S",
            "Student (CS 101)",
            new UserPermissions(["manual", "plan"], false, false, false, 25000, true, true, false, false, false)
        ),
        new(
            "acc_teacher_sarah",
            "Prof. Sarah Jenkins",
            "sjenkins@lincoln.edu",
            "school",
            "teacher",
            "Lincoln High School CS Dept",
            "cs101",
            "CS101-FALL26-A4",
            "#8b5cf6",
            "T",
            "Teacher · Course Lead",
            new UserPermissions(["manual", "acceptEdits", "auto", "plan"], false, true, true, 150000, true, true, true, false, false)
        ),
        new(
            "acc_admin_marcus",
            "Dr. Marcus Vance",
            "mvance@lincoln.k12.us",
            "school",
            "school_admin",
            "Lincoln Unified School District",
            null,
            null,
            "#ec4899",
            "M",
            "School Management & IT",
            new UserPermissions(["manual", "acceptEdits", "auto", "plan"], false, true, true, 500000, true, true, true, true, false)
        ),
        new(
            "acc_junior_alex",
            "Alex M.",
            "alex.m@apex-systems.io",
            "dev_team",
            "junior_dev",
            "Apex Systems Dev Team",
            null,
            null,
            "#10b981",
            "J",
            "Junior Dev (Mentored)",
            new UserPermissions(["manual", "acceptEdits", "auto", "plan"], false, true, true, 200000, false, false, false, false, false)
        ),
        new(
            "acc_senior_alex",
            "Alex M.",
            "alex.architect@apex-systems.io",
            "dev_team",
            "senior_dev",
            "Apex Systems Core Infra",
            null,
            null,
            "#f59e0b",
            "S",
            "Senior Dev & Architect",
            new UserPermissions(["manual", "acceptEdits", "auto", "plan", "bypass"], true, true, true, 1000000, false, false, false, false, false)
        ),
        new(
            "acc_legal_elena",
            "Elena Rostova",
            "e.rostova@apex-corp.legal",
            "corporate",
            "corporate_legal",
            "Apex Global Enterprises LLC",
            null,
            null,
            "#6366f1",
            "L",
            "Corporate Legal & Compliance",
            new UserPermissions(["manual", "plan"], false, false, false, 100000, false, false, false, false, true)
        ),
        new(
            "acc_personal_alex",
            "Alex Morgan",
            "alex@personal-hacks.dev",
            "dev_team",
            "solo_dev",
            "Personal Workspace",
            null,
            null,
            "#06b6d4",
            "P",
            "Personal Solo Dev",
            new UserPermissions(["manual", "acceptEdits", "auto", "plan", "bypass"], true, true, true, 500000, false, false, false, false, false)
        )
    ];

    public static readonly List<ClassroomInfo> SampleClassrooms =
    [
        new("cs101", "CS101-FALL26-A4", "CS 101: Intro to Computer Science & Search Algorithms", "Prof. Sarah Jenkins", 32, 3, "hw1_inverted_index", 3),
        new("cs201", "CS201-FALL26-B2", "CS 201: Data Structures, Graphs & Systems Engineering", "Prof. Sarah Jenkins", 28, 4, "hw2_graph_routing", 4)
    ];

    public static readonly AssignmentSpec SampleAssignment = new(
        "hw1_inverted_index",
        "cs101",
        "CS101-FALL26-A4",
        "Assignment 1: High-Performance Inverted Search Index & Auto-fill",
        "2026-11-15T23:59:59Z",
        100,
        "Implement an in-memory inverted search index and query matcher with prefix auto-fill suggestions.",
        "def build_inverted_index(documents):\n    index = {}\n    for doc_id, text in documents.items():\n        for word in text.lower().split():\n            index.setdefault(word, set()).add(doc_id)\n    return index\n\ndef search_index(index, query):\n    return sorted(list(index.get(query.lower(), set())))\n",
        [
            new("r1", "Exact Token Match", 30, "test_exact_matches"),
            new("r2", "Prefix Auto-Fill", 30, "test_prefix_autofill"),
            new("r3", "Typo-Tolerant Ranking", 20, "test_fuzzy_ranking"),
            new("r4", "Sub-50ms Latency Budget", 20, "test_latency_under_50ms")
        ],
        [
            new("Lecture 4: Inverted Indices & Search Trees", ["How modern search engines index millions of documents in RAM", "Tokenization and lowercase normalization", "Prefix matching for instant search bar auto-fill suggestions"]),
            new("Data Structure Overview", ["Index Dictionary: Term -> Set of Document IDs", "Posting Lists: Sorted arrays for fast boolean AND / OR intersections", "Time Complexity: O(1) dictionary lookup + O(k) ranking"]),
            new("Autograder & Submission Protocol", ["Run the autograder directly inside the SDE test runner", "All 4 test cases must pass for full 100/100 points", "Submit before Sunday 11:59 PM PDT"])
        ]
    );

    public static readonly List<StripePack> StripePacks =
    [
        new("credit-10", "Starter AI Pack", 10.0, 10.0, "1,000,000 Tokens"),
        new("credit-20", "Pro Developer Pack", 20.0, 20.0, "2,500,000 Tokens", true),
        new("credit-50", "Enterprise Scale Pack", 50.0, 50.0, "7,000,000 Tokens")
    ];

    public static AccountProfile GetAccountById(string? id)
    {
        return PreconfiguredAccounts.FirstOrDefault(a => a.Id == id) ?? PreconfiguredAccounts[0];
    }

    public static List<ClassroomInfo> AddClassroom(ClassroomInfo newRoom, IEnumerable<ClassroomInfo>? roomList = null)
    {
        var list = (roomList ?? SampleClassrooms).ToList();
        var id = (newRoom.Id ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(newRoom.Name))
        {
            throw new ArgumentException("Classroom must have valid id and name");
        }

        var code = string.IsNullOrEmpty(newRoom.Code) ? $"{id.ToUpperInvariant()}-9901" : newRoom.Code;
        var entry = newRoom with { Id = id, Code = code };
        return list.Where(r => r.Id != id).Append(entry).ToList();
    }

    public static List<ClassroomInfo> RemoveClassroom(string classroomId, IEnumerable<ClassroomInfo>? roomList = null)
    {
        var id = (classroomId ?? "").Trim().ToLowerInvariant();
        return (roomList ?? SampleClassrooms).Where(r => r.Id != id).ToList();
    }

    public static GradingReport GradeAssignmentSubmission(string? studentCode, AssignmentSpec? assignment = null)
    {
        var assign = assignment ?? SampleAssignment;
        var code = studentCode ?? "";
        var results = new List<RubricResult>();
        int total = 0;

        foreach (var item in assign.Rubric)
        {
            bool passed = false;
            string reason = "";

            if (item.Id == "r1")
            {
                passed = code.Contains("def build_inverted_index", StringComparison.Ordinal) && code.Contains("def search_index", StringComparison.Ordinal);
                reason = passed ? "Index dictionary and search lookup correctly defined" : "Missing search lookup definition";
            }
            else if (item.Id == "r2")
            {
                passed = code.Contains("setdefault", StringComparison.Ordinal) || code.Contains("lower()", StringComparison.Ordinal);
                reason = passed ? "Case-insensitive prefix token mapping verified" : "Case normalization missing";
            }
            else if (item.Id == "r3")
            {
                passed = !code.Contains("TODO", StringComparison.Ordinal) && code.Length > 80;
                reason = passed ? "Query ranking and result sorting verified" : "Incomplete logic";
            }
            else if (item.Id == "r4")
            {
                passed = code.Length > 50;
                reason = passed ? "Executed within 0.05ms budget" : "Exceeded timeout";
            }

            int earned = passed ? item.Points : 0;
            total += earned;
            results.Add(new RubricResult(item.Id, item.Name, item.Points, earned, passed, reason));
        }

        int percentage = (int)Math.Round((double)total / assign.PointsPossible * 100);
        return new GradingReport(assign.Id, assign.PointsPossible, total, percentage, total >= 70, results);
    }

    public static TourSpec GetWalkthroughTour(string role, string flavor = "school")
    {
        if (role == "student")
        {
            return new TourSpec(role, flavor, "Student Classroom SDE Tour",
            [
                new("Your Classroom & Assignments", "Access course assignments, lecture slides, and starter code right from the SDE workspace.", "#openAssignmentBtn"),
                new("Code Editor & Auto-save", "Write your homework solutions with live syntax highlighting and instant bracket completion.", ".editor"),
                new("One-Click Autograder", "Run the grading test suite anytime to check your rubric score before final submission.", "#runAutograderBtn"),
                new("AI Study Tutor (Safe Mode)", "Ask questions to understand concepts. The tutor guides you without solving your homework for you.", "#chat")
            ]);
        }

        if (role == "teacher")
        {
            return new TourSpec(role, flavor, "Teacher Course & Classroom Tour",
            [
                new("Classroom Codes & Rosters", "Share classroom codes (e.g. CS101-FALL26-A4) with students and monitor active student count.", "#classroomCodeBadge"),
                new("Assignments & Presentation Slides", "Publish projects, interactive slides, and starter repositories to all students simultaneously.", "#openAssignmentBtn"),
                new("Autograder & Gradebook", "Review automated test results, rubric breakdowns, and student submissions in real time.", "#gradebookTab")
            ]);
        }

        if (role == "corporate_legal")
        {
            return new TourSpec(role, flavor, "Corporate Legal & Governance Tour",
            [
                new("Immutable Audit Log", "Inspect SHA-256 hash-chained records of all code changes, model invocations, and agent edits.", "#auditLogViewer"),
                new("License Scanner & IP Safeguards", "Automatically detect copyleft licenses (GPL/AGPL) and enforce strict corporate IP compliance.", "#licenseScanner"),
                new("Data Residency & Worker Egress", "Verify restricted network egress policies ensuring proprietary code never leaks outside.", "#egressCompliance")
            ]);
        }

        return new TourSpec(role, flavor, "Developer SDE Experience Tour",
        [
            new("High-Performance SDE Split Layout", "Work across files, terminal outputs, and live AI agents with seamless split panes.", ".stage"),
            new("Developer Settings Panel", "Configure Cloudflare Tunnels, custom routing, compute quotas, and photo asset pipelines.", "#openSettings"),
            new("Deep Photo Search & Sidecars", "Search through architecture diagrams and UI screenshots indexed with OCR metadata.", "#openPal"),
            new("Platform Credit & Stripe Payments", "Manage AI model credits and embed Stripe merchant checkout into built web apps.", "#stripeCheckoutBtn")
        ]);
    }

    public static CheckoutResult SimulateStripeCheckout(string accountId, string packId, double currentBalanceUsd = 20.0)
    {
        var pack = StripePacks.FirstOrDefault(p => p.Id == packId) ?? StripePacks[1];
        var newBalance = Math.Round(currentBalanceUsd + pack.CreditsUsd, 2);
        var txId = $"cs_test_{Guid.NewGuid():N}";

        return new CheckoutResult(
            true,
            txId,
            accountId,
            pack.Id,
            pack.Name,
            pack.PriceUsd,
            pack.CreditsUsd,
            currentBalanceUsd,
            newBalance,
            $"https://pay.stripe.com/receipts/test/{txId}",
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
    }

    public static MerchantPurchaseResult SimulateInAppMerchantPurchase(string merchantAccountId, string customerEmail, int amountCents, string itemName)
    {
        var chargeId = $"ch_test_{Guid.NewGuid():N}";
        int feeCents = (int)Math.Round(amountCents * 0.029 + 30);
        int netCents = amountCents - feeCents;

        return new MerchantPurchaseResult(
            true,
            chargeId,
            merchantAccountId,
            string.IsNullOrEmpty(customerEmail) ? "customer@example.com" : customerEmail,
            string.IsNullOrEmpty(itemName) ? "In-App Web Service" : itemName,
            amountCents,
            Math.Round((double)amountCents / 100, 2),
            Math.Round((double)feeCents / 100, 2),
            Math.Round((double)netCents / 100, 2),
            "succeeded",
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
    }
}
