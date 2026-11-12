using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class UserSettingsManagerTests
{
    [Fact]
    public void Service_InitializesWithSensibleDefaults()
    {
        var svc = new UserSettingsService();
        var code = svc.GetCodeSettings();
        Assert.Equal("vespr", code.BranchPrefix);
        Assert.True(code.LabelSessionsByStatus);
        Assert.Equal("Normal", code.DefaultTranscriptView);
        Assert.True(code.SummaryAndNextSteps);

        var profile = svc.GetAccountProfile();
        Assert.Equal("the VESPR team", profile.FullName);
        Assert.Equal("the team", profile.PreferredName);

        var usage = svc.GetUsageMetrics();
        Assert.Equal(100, usage.WeeklyPercentUsed);
        Assert.True(usage.LimitHit);
        Assert.Equal(13.45m, usage.PurchasedCredits);
    }

    [Fact]
    public void ShortcutsAndMacros_CanBeRetrievedAndModified()
    {
        var svc = new UserSettingsService();
        var shortcuts = svc.GetShortcuts();
        Assert.True(shortcuts.ContainsKey("settings"));
        Assert.Equal("Ctrl+,", shortcuts["settings"]);

        svc.SetShortcut("settings", "Ctrl+Alt+S");
        Assert.Equal("Ctrl+Alt+S", svc.GetShortcuts()["settings"]);

        var macros = svc.GetMacros();
        Assert.NotEmpty(macros);
        Assert.Contains(macros, m => m.Name.Contains("Clean, Build"));
    }

    [Fact]
    public void PaymentMethodsAndBilling_ManagesDefaultsAndCredits()
    {
        var svc = new UserSettingsService();
        var pms = svc.GetPaymentMethods();
        Assert.Equal(3, pms.Count);

        svc.SetDefaultPaymentMethod("pm_1");
        var updated = svc.GetPaymentMethods();
        Assert.True(updated.First(p => p.Id == "pm_1").IsDefault);
        Assert.False(updated.First(p => p.Id == "pm_3").IsDefault);

        var billing = svc.GetBillingPlan();
        Assert.Equal("Pro plan", billing.PlanTier);
        Assert.Equal(13.45m, billing.UsageCreditBalance);
    }

    [Fact]
    public void Connectors_IntegratesGoogleClassroomCanvaAndD2L()
    {
        var svc = new UserSettingsService();
        var connectors = svc.GetConnectors();
        Assert.Contains(connectors, c => c.Id == "google_classroom" && c.IsConnected);
        Assert.Contains(connectors, c => c.Id == "canva" && c.IsConnected);
        Assert.Contains(connectors, c => c.Id == "d2l_brightspace" && c.IsConnected);

        svc.ToggleConnector("canvas_lms", true, "canvas_prof@lincoln.edu");
        var canvas = svc.GetConnectors().First(c => c.Id == "canvas_lms");
        Assert.True(canvas.IsConnected);
        Assert.Equal("canvas_prof@lincoln.edu", canvas.ConnectedAccount);
    }

    [Fact]
    public void ExpandedSettings_ManagesAllSubpanelsAndApiKeys()
    {
        var svc = new UserSettingsService();

        // Appearance
        Assert.Equal("dark", svc.GetAppearance().Theme);
        svc.UpdateAppearance(new AppearanceSettings("light", "compact", "monokai", HighContrast: true, ReducedMotion: false));
        Assert.Equal("light", svc.GetAppearance().Theme);
        Assert.Equal("compact", svc.GetAppearance().FontScale);
        Assert.Equal("monokai", svc.GetAppearance().SyntaxTheme);

        // AI Persona
        Assert.Equal("concise_sde", svc.GetAiPersona().Tone);
        svc.UpdateAiPersona(new AiPersonaSettings("senior_architect", "Custom instructions", false, true));
        Assert.Equal("senior_architect", svc.GetAiPersona().Tone);

        // Capabilities
        Assert.True(svc.GetCapabilities().AutonomousSwarm);
        Assert.Equal("allowlist", svc.GetCapabilities().WebSearchReach);

        // Notifications
        Assert.True(svc.GetNotifications().AudioChimes);
        Assert.Equal("subtle", svc.GetNotifications().SoundTheme);

        // Privacy
        Assert.True(svc.GetPrivacy().ZeroDataTraining);
        Assert.Equal(180, svc.GetPrivacy().RetentionDays);

        // Wellbeing
        Assert.True(svc.GetWellbeing().PomodoroReminders);
        Assert.Equal(50, svc.GetWellbeing().BreakIntervalMinutes);

        // Cowork
        Assert.True(svc.GetCowork().CollaborativePairing);

        // Desktop App
        Assert.Equal("http://10.0.0.8:8240", svc.GetDesktopApp().DirectPiHost);
        Assert.Equal(30, svc.GetDesktopApp().AutoSyncIntervalSeconds);

        // API Keys
        var keys = svc.GetApiKeys();
        Assert.Empty(keys);

        var newKey = svc.AddApiKey("Local Production Worker", "OpenAI", "sk-proj-testkey1234567890abcdef");
        Assert.StartsWith("key_", newKey.Id);
        Assert.Single(svc.GetApiKeys());

        var revoked = svc.RevokeApiKey(newKey.Id);
        Assert.True(revoked);
        Assert.Empty(svc.GetApiKeys());
    }
}
