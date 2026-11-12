using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class SettingsPanelTests
{
    [Fact]
    public void DefaultSettings_HasAllSections()
    {
        var def = SettingsPanel.CreateDefaultSettings();
        Assert.NotNull(def.Routing);
        Assert.NotNull(def.Compute);
        Assert.NotNull(def.LiveApps);
        Assert.NotNull(def.Cloudflare);
        Assert.NotNull(def.Payments);
        Assert.NotNull(def.Search);
        Assert.NotNull(def.Photos);
        Assert.NotNull(def.Auth);

        Assert.Equal("strict", def.Routing.SslMode);
        Assert.Equal(100, def.Compute.CpuQuotaPercent);
        Assert.Equal("vespr-tunnel", def.Cloudflare.TunnelName);
        Assert.True(def.Payments.MerchantEnabled);
        Assert.Equal("fuzzy", def.Search.Engine);
        Assert.True(def.Photos.AutoNormalizeNames);
        Assert.True(def.Photos.AvoidDescriptiveNames);
        Assert.True(def.Photos.GeneratePairedSidecar);
        Assert.Equal(8, SettingsPanel.Tabs.Length);
    }

    [Fact]
    public void Validation_ClampsBoundsAndCleansInputs()
    {
        var raw = new SettingsPanel.AppSettings(
            Routing: new SettingsPanel.RoutingSettings(
                CustomDomain: " MYAPP.ONLINE ",
                SslMode: "flexible"
            ),
            Compute: new SettingsPanel.ComputeSettings(
                CpuQuotaPercent: 9999,
                MemoryLimitMb: 10
            ),
            Payments: new SettingsPanel.PaymentSettings(
                SupportedCurrencies: ["usd", "invalid-long", "eur"]
            ),
            Photos: new SettingsPanel.PhotoSettings(
                AvoidDescriptiveNames: false
            )
        );

        var cleaned = SettingsPanel.ValidateAndClean(raw);
        Assert.Equal("myapp.online", cleaned.Routing!.CustomDomain);
        Assert.Equal("flexible", cleaned.Routing.SslMode);
        Assert.Equal(400, cleaned.Compute!.CpuQuotaPercent);
        Assert.Equal(64, cleaned.Compute.MemoryLimitMb);
        Assert.Equal(["USD", "EUR"], cleaned.Payments!.SupportedCurrencies);
        Assert.False(cleaned.Photos!.AvoidDescriptiveNames);
    }

    [Fact]
    public void ConstantsCheck()
    {
        Assert.Equal(100, SettingsPanel.DefaultCpuQuota);
        Assert.Equal(512, SettingsPanel.DefaultMemoryMb);
        Assert.Equal(128, SettingsPanel.DefaultTmpfsMb);
        Assert.Equal(64, SettingsPanel.DefaultPidsMax);
    }
}
