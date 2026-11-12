using System.Collections.Concurrent;

namespace Vespr.Core;

public record CodeSettings(
    string BranchPrefix = "vespr",
    bool LabelSessionsByStatus = true,
    string DefaultTranscriptView = "Normal",
    bool DynamicWorkflows = false,
    bool PromptSuggestions = true,
    bool SummaryAndNextSteps = true,
    string UnrelatedTaskAction = "Ask me",
    string OutputStyle = "Default",
    bool OpenPullRequestsAutomatically = true
);

public record AccountProfileSettings(
    string FullName = "the VESPR team",
    string PreferredName = "the team",
    string WorkDescription = "Software Engineer & Architect",
    string OrgId = "b7b8fed3-4269-4452-8ef8-be53ed03510e",
    string ProfilePhotoUrl = "brand/avatar-sb.png"
);

public record AppearanceSettings(
    string Theme = "dark",
    string FontScale = "normal",
    string SyntaxTheme = "jetbrains-dark",
    bool HighContrast = false,
    bool ReducedMotion = false
);

public record AiPersonaSettings(
    string Tone = "concise_sde",
    string CustomInstructions = "Prefer high-performance C# .NET 8.0/10.0 and modern vanilla ES modules without unnecessary build-step frameworks.",
    bool AutoExtractConventions = true,
    bool MemoryRetentionActive = true
);

public record CapabilitiesSettings(
    bool AutonomousSwarm = true,
    string WebSearchReach = "allowlist",
    string SandboxBackend = "managed_sandbox",
    bool AutoPullRequests = true,
    bool BenchmarkTelemetryCollection = true
);

public record NotificationSettings(
    bool AudioChimes = true,
    string SoundTheme = "subtle",
    bool DesktopPush = true,
    bool EmailSummaries = false,
    string SlackWebhookUrl = ""
);

public record PrivacySettings(
    bool ZeroDataTraining = true,
    bool TelemetryOptIn = true,
    int RetentionDays = 180, // SOC-2
    string SecretRedactionLevel = "strict"
);

public record WellbeingSettings(
    bool PomodoroReminders = true,
    int BreakIntervalMinutes = 50,
    bool EyeComfortMode = false,
    decimal DailySpendWarningDollars = 20.00m
);

public record CoworkSettings(
    bool CollaborativePairing = true,
    bool CursorPresence = true,
    bool SharedTerminal = true,
    bool VoiceTranscription = true
);

public record DesktopAppSettings(
    string DirectPiHost = "http://10.0.0.8:8240",
    int AutoSyncIntervalSeconds = 30,
    bool AutoRestartOnNewBuild = true,
    bool OfflineFileCache = true
);

public record ApiKeyRecord(
    string Id,
    string Label,
    string KeyPrefix,
    string KeyMasked,
    string Provider,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt
);

public record PaymentMethod(
    string Id,
    string Brand,
    string Last4,
    string ExpDate,
    bool IsDefault
);

public record BillingPlanSettings(
    string PlanTier = "Pro plan",
    string Cadence = "Monthly",
    DateTimeOffset NextRenewalDate = default,
    decimal UsageCreditBalance = 13.45m,
    decimal AutoReloadThreshold = 5.00m,
    decimal AutoReloadAmount = 15.00m,
    bool AutoReloadEnabled = true
);

public record UsageMetrics(
    int CurrentSessionPercent = 0,
    int WeeklyPercentUsed = 100,
    string ResetSchedule = "Saturday, 3:00 PM EST",
    bool LimitHit = true,
    decimal PurchasedCredits = 13.45m,
    bool UsageCreditsEnabled = false
);

public record MacroDefinition(
    string Id,
    string Name,
    string TriggerKey,
    List<string> Actions
);

public record MouseConfiguration(
    string LeftClickAction = "select_and_open",
    string RightClickAction = "context_menu_with_report",
    bool SwapButtons = false
);

public record ConnectorIntegration(
    string Id,
    string Name,
    string Category,
    string Icon,
    bool IsConnected,
    string? ConnectedAccount,
    DateTimeOffset? LastSync
);

public class UserSettingsService
{
    private CodeSettings _codeSettings = new();
    private AccountProfileSettings _accountProfile = new();
    private AppearanceSettings _appearance = new();
    private AiPersonaSettings _aiPersona = new();
    private CapabilitiesSettings _capabilities = new();
    private NotificationSettings _notifications = new();
    private PrivacySettings _privacy = new();
    private WellbeingSettings _wellbeing = new();
    private CoworkSettings _cowork = new();
    private DesktopAppSettings _desktopApp = new();
    private BillingPlanSettings _billingPlan;
    private UsageMetrics _usageMetrics = new();
    private MouseConfiguration _mouseConfig = new();
    private readonly ConcurrentDictionary<string, string> _shortcuts = new();
    private readonly List<MacroDefinition> _macros = new();
    private readonly List<PaymentMethod> _paymentMethods = new();
    private readonly List<ConnectorIntegration> _connectors = new();
    private readonly List<ApiKeyRecord> _apiKeys = new();

    public UserSettingsService()
    {
        var now = DateTimeOffset.UtcNow;
        _billingPlan = new BillingPlanSettings(
            NextRenewalDate: now.AddDays(8)
        );

        _paymentMethods.Add(new PaymentMethod("pm_1", "Visa", "3948", "03/2030", false));
        _paymentMethods.Add(new PaymentMethod("pm_2", "American Express", "3029", "05/2030", false));
        _paymentMethods.Add(new PaymentMethod("pm_3", "Visa", "6860", "06/2030", true));

        // Default shortcuts
        _shortcuts["settings"] = "Ctrl+,";
        _shortcuts["palette"] = "Ctrl+K";
        _shortcuts["chatToggle"] = "Ctrl+J";
        _shortcuts["runCode"] = "Ctrl+Enter";
        _shortcuts["reportIssue"] = "Shift+Alt+R";
        _shortcuts["formatCode"] = "Shift+Alt+F";

        // Default macros
        _macros.Add(new MacroDefinition(
            Id: "macro_clean_test",
            Name: "Clean, Build & Test All",
            TriggerKey: "Ctrl+Shift+T",
            Actions: new List<string> { "git status", "dotnet test native/Vespr.sln", "pytest -q" }
        ));
        _macros.Add(new MacroDefinition(
            Id: "macro_ai_review",
            Name: "Trigger AI Code Review",
            TriggerKey: "Ctrl+Shift+R",
            Actions: new List<string> { "@reviewer review staged changes for security and style" }
        ));

        // Connectors (including school LMS)
        _connectors.Add(new ConnectorIntegration("google_classroom", "Google Classroom", "Education LMS", "book", true, "alex.morgan@lincoln.edu", now.AddMinutes(-12)));
        _connectors.Add(new ConnectorIntegration("canva", "Canva", "Design & Creative", "image", true, "shamit@canva-partner.org", now.AddHours(-1)));
        _connectors.Add(new ConnectorIntegration("d2l_brightspace", "D2L Brightspace", "Education LMS", "book", true, "owner@d2l-edu.org", now.AddHours(-2)));
        _connectors.Add(new ConnectorIntegration("canvas_lms", "Canvas LMS", "Education LMS", "book", false, null, null));
        _connectors.Add(new ConnectorIntegration("github", "GitHub", "Code & Cloud", "github", true, "shamit-basu", now.AddMinutes(-5)));
        _connectors.Add(new ConnectorIntegration("google_drive", "Google Drive", "Storage & Docs", "folder", true, "owner@example.com", now.AddDays(-1)));

        // No default API keys: the list starts empty (no invented sample keys)
    }

    public CodeSettings GetCodeSettings() => _codeSettings;
    public void UpdateCodeSettings(CodeSettings settings) => _codeSettings = settings;

    public AccountProfileSettings GetAccountProfile() => _accountProfile;
    public void UpdateAccountProfile(AccountProfileSettings profile) => _accountProfile = profile;

    public AppearanceSettings GetAppearance() => _appearance;
    public void UpdateAppearance(AppearanceSettings appearance) => _appearance = appearance;

    public AiPersonaSettings GetAiPersona() => _aiPersona;
    public void UpdateAiPersona(AiPersonaSettings persona) => _aiPersona = persona;

    public CapabilitiesSettings GetCapabilities() => _capabilities;
    public void UpdateCapabilities(CapabilitiesSettings cap) => _capabilities = cap;

    public NotificationSettings GetNotifications() => _notifications;
    public void UpdateNotifications(NotificationSettings notif) => _notifications = notif;

    public PrivacySettings GetPrivacy() => _privacy;
    public void UpdatePrivacy(PrivacySettings priv) => _privacy = priv;

    public WellbeingSettings GetWellbeing() => _wellbeing;
    public void UpdateWellbeing(WellbeingSettings well) => _wellbeing = well;

    public CoworkSettings GetCowork() => _cowork;
    public void UpdateCowork(CoworkSettings cowork) => _cowork = cowork;

    public DesktopAppSettings GetDesktopApp() => _desktopApp;
    public void UpdateDesktopApp(DesktopAppSettings desktop) => _desktopApp = desktop;

    public BillingPlanSettings GetBillingPlan() => _billingPlan;
    public void UpdateBillingPlan(BillingPlanSettings billing) => _billingPlan = billing;

    public IReadOnlyList<PaymentMethod> GetPaymentMethods() => _paymentMethods.AsReadOnly();
    public void SetDefaultPaymentMethod(string id)
    {
        for (int i = 0; i < _paymentMethods.Count; i++)
        {
            var pm = _paymentMethods[i];
            _paymentMethods[i] = pm with { IsDefault = pm.Id == id };
        }
    }

    public UsageMetrics GetUsageMetrics() => _usageMetrics;
    public void UpdateUsageMetrics(UsageMetrics metrics) => _usageMetrics = metrics;

    public IReadOnlyDictionary<string, string> GetShortcuts() => _shortcuts;
    public bool SetShortcut(string action, string keyCombination)
    {
        if (string.IsNullOrWhiteSpace(action) || string.IsNullOrWhiteSpace(keyCombination)) return false;
        _shortcuts[action] = keyCombination.Trim();
        return true;
    }

    public IReadOnlyList<MacroDefinition> GetMacros() => _macros.AsReadOnly();
    public void AddMacro(MacroDefinition macro)
    {
        _macros.RemoveAll(m => m.Id == macro.Id);
        _macros.Add(macro);
    }

    public MouseConfiguration GetMouseConfig() => _mouseConfig;
    public void UpdateMouseConfig(MouseConfiguration config) => _mouseConfig = config;

    public IReadOnlyList<ConnectorIntegration> GetConnectors() => _connectors.AsReadOnly();
    public bool ToggleConnector(string id, bool connect, string? account = null)
    {
        var idx = _connectors.FindIndex(c => c.Id == id);
        if (idx == -1) return false;
        var cur = _connectors[idx];
        _connectors[idx] = cur with
        {
            IsConnected = connect,
            ConnectedAccount = connect ? (account ?? $"{id}_user@domain.com") : null,
            LastSync = connect ? DateTimeOffset.UtcNow : null
        };
        return true;
    }

    public IReadOnlyList<ApiKeyRecord> GetApiKeys() => _apiKeys.AsReadOnly();
    public ApiKeyRecord AddApiKey(string label, string provider, string rawKey)
    {
        var id = $"key_{Guid.NewGuid().ToString("N")[..6]}";
        var prefix = rawKey.Length > 6 ? rawKey[..6] : "key";
        var masked = rawKey.Length > 8 ? $"{prefix}•••••••••••••{rawKey[^3..]}" : "••••••••";
        var record = new ApiKeyRecord(id, label, prefix, masked, provider, DateTimeOffset.UtcNow, null);
        _apiKeys.Add(record);
        return record;
    }

    public bool RevokeApiKey(string id)
    {
        var idx = _apiKeys.FindIndex(k => k.Id == id);
        if (idx == -1) return false;
        _apiKeys.RemoveAt(idx);
        return true;
    }
}