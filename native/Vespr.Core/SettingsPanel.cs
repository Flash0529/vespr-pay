using System.Text;
using System.Text.RegularExpressions;

namespace Vespr.Core;

/// <summary>
/// Developer settings system for the SDE shell. Exposes configuration for routing, compute workers,
/// live web apps, Cloudflare integration, payment gateways, search engine, photo asset pipeline, and auth.
/// Port of app/settings-panel.js.
/// </summary>
public static class SettingsPanel
{
    public const int DefaultCpuQuota = 100;
    public const int DefaultMemoryMb = 512;
    public const int DefaultTmpfsMb = 128;
    public const int DefaultPidsMax = 64;

    public record TabInfo(string Id, string Name, string Icon);

    public static readonly TabInfo[] Tabs =
    [
        new("routing", "Routing & Domains", "route"),
        new("compute", "Compute & Workers", "cpu"),
        new("liveApps", "Live Web Apps", "globe"),
        new("cloudflare", "Cloudflare", "cloud"),
        new("payments", "Payment Gateway", "card"),
        new("search", "Search Engine", "search"),
        new("photos", "Photo Assets", "image"),
        new("auth", "Auth & Session", "lock")
    ];

    public record ProxyRoute(string PathPrefix, int TargetPort, bool StripPrefix = false);

    public record RoutingSettings(
        string CustomDomain = "",
        List<ProxyRoute>? ReverseProxyPaths = null,
        bool WebSocketForwarding = true,
        string SslMode = "strict"
    );

    public record ComputeSettings(
        string RunnerMode = "managed_sandbox",
        int CpuQuotaPercent = DefaultCpuQuota,
        int MemoryLimitMb = DefaultMemoryMb,
        int TmpfsSizeMb = DefaultTmpfsMb,
        int PidsMax = DefaultPidsMax,
        bool ElasticAutoscale = true,
        int IdleTimeoutSec = 300
    );

    public record LiveAppsSettings(
        int PreviewPort = 3000,
        bool AutoDetectDevServers = true,
        bool HotReloadProxy = true,
        Dictionary<string, string>? EnvVariables = null
    );

    public record CloudflareSettings(
        bool Connected = false,
        string ApiTokenMasked = "",
        string ZoneId = "",
        string ZoneName = "",
        string TunnelId = "",
        string TunnelName = "vespr-tunnel",
        bool AutoDns = true,
        bool ProxyTraffic = true
    );

    public record PaymentSettings(
        double PlatformCreditsUsd = 20.0,
        string AutoRechargePack = "credit-20",
        bool MerchantEnabled = true,
        string Provider = "stripe",
        bool TestMode = true,
        string PublishableKey = "",
        string SecretKeyMasked = "",
        string WebhookSecretMasked = "",
        List<string>? SupportedCurrencies = null,
        string BillingModel = "checkout_and_metered"
    );

    public record SearchSettings(
        string Engine = "fuzzy",
        bool IndexPhotoMetadata = true,
        int MaxMatches = 100,
        int AutoFillLatencyTargetMs = 50,
        bool WholeWord = false
    );

    public record PhotoSettings(
        bool AutoNormalizeNames = true,
        bool AvoidDescriptiveNames = true,
        string NamePrefix = "asset-photo",
        bool GeneratePairedSidecar = true,
        string SidecarFormat = "json",
        bool ExtractOcrTags = true
    );

    public record AuthSettings(
        int SessionTimeoutDays = 30,
        bool TwoFactorEnabled = false,
        bool AllowCleverLogin = true,
        bool AllowGithubLogin = true,
        bool AllowGoogleLogin = true
    );

    public record AppSettings(
        RoutingSettings? Routing = null,
        ComputeSettings? Compute = null,
        LiveAppsSettings? LiveApps = null,
        CloudflareSettings? Cloudflare = null,
        PaymentSettings? Payments = null,
        SearchSettings? Search = null,
        PhotoSettings? Photos = null,
        AuthSettings? Auth = null
    );

    public static AppSettings CreateDefaultSettings() => new(
        Routing: new RoutingSettings(
            ReverseProxyPaths:
            [
                new("/api", 8080, false),
                new("/ws", 8241, false)
            ]
        ),
        Compute: new ComputeSettings(),
        LiveApps: new LiveAppsSettings(
            EnvVariables: new Dictionary<string, string>
            {
                ["NODE_ENV"] = "development",
                ["PORT"] = "3000"
            }
        ),
        Cloudflare: new CloudflareSettings(),
        Payments: new PaymentSettings(
            SupportedCurrencies: ["USD", "EUR", "GBP"]
        ),
        Search: new SearchSettings(),
        Photos: new PhotoSettings(),
        Auth: new AuthSettings()
    );

    public static AppSettings ValidateAndClean(AppSettings? raw)
    {
        var def = CreateDefaultSettings();
        if (raw == null) return def;

        var r = raw.Routing ?? def.Routing!;
        var c = raw.Compute ?? def.Compute!;
        var l = raw.LiveApps ?? def.LiveApps!;
        var cf = raw.Cloudflare ?? def.Cloudflare!;
        var p = raw.Payments ?? def.Payments!;
        var s = raw.Search ?? def.Search!;
        var ph = raw.Photos ?? def.Photos!;
        var a = raw.Auth ?? def.Auth!;

        var cleanR = r with
        {
            CustomDomain = (r.CustomDomain ?? "").Trim().ToLowerInvariant(),
            SslMode = r.SslMode is "strict" or "flexible" or "off" ? r.SslMode : "strict",
            ReverseProxyPaths = (r.ReverseProxyPaths ?? def.Routing!.ReverseProxyPaths!)
                .Select(route => route with
                {
                    PathPrefix = (route.PathPrefix ?? "").Trim(),
                    TargetPort = Math.Clamp(route.TargetPort, 1, 65535)
                }).ToList()
        };

        var cleanC = c with
        {
            RunnerMode = c.RunnerMode is "managed_sandbox" or "byoc_socket" or "external_worker" ? c.RunnerMode : "managed_sandbox",
            CpuQuotaPercent = Math.Clamp(c.CpuQuotaPercent, 10, 400),
            MemoryLimitMb = Math.Clamp(c.MemoryLimitMb, 64, 8192),
            TmpfsSizeMb = Math.Clamp(c.TmpfsSizeMb, 16, 2048),
            PidsMax = Math.Clamp(c.PidsMax, 16, 1024),
            IdleTimeoutSec = Math.Clamp(c.IdleTimeoutSec, 30, 86400)
        };

        var cleanP = p with
        {
            Provider = p.Provider is "stripe" or "paddle" ? p.Provider : "stripe",
            SupportedCurrencies = (p.SupportedCurrencies ?? ["USD", "EUR", "GBP"])
                .Select(cur => cur.ToUpperInvariant().Trim())
                .Where(cur => cur.Length == 3)
                .ToList()
        };

        return new AppSettings(cleanR, cleanC, l, cf, cleanP, s, ph, a);
    }

    public static string Esc(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var sb = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            switch (ch)
            {
                case '&': sb.Append("&amp;"); break;
                case '<': sb.Append("&lt;"); break;
                case '>': sb.Append("&gt;"); break;
                case '"': sb.Append("&quot;"); break;
                case '\'': sb.Append("&#39;"); break;
                default: sb.Append(ch); break;
            }
        }
        return sb.ToString();
    }
}
