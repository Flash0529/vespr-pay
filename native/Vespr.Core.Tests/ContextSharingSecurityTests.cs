using Vespr.Core;
using Xunit;

namespace Vespr.Core.Tests;

public class ContextSharingSecurityTests
{
    [Fact]
    public void CanShareContext_EnforcesRoleBoundaries()
    {
        var svc = new ContextSharingSecurityService();

        // Student and Corporate Legal strictly prohibited from sharing context
        Assert.False(svc.CanShareContext("student", isExternalGuest: true));
        Assert.False(svc.CanShareContext("student", isExternalGuest: false));
        Assert.False(svc.CanShareContext("corporate_legal", isExternalGuest: false));

        // Intern cannot share with off-company guests
        Assert.False(svc.CanShareContext("intern", isExternalGuest: true));
        Assert.True(svc.CanShareContext("intern", isExternalGuest: false));

        // Senior dev and Teacher can share
        Assert.True(svc.CanShareContext("senior_dev", isExternalGuest: true));
        Assert.True(svc.CanShareContext("teacher", isExternalGuest: false));
    }

    [Fact]
    public void ScrubContext_RedactsApiKeysAndSecrets()
    {
        var svc = new ContextSharingSecurityService();
        // secret-scan: allow
        var rawContext = "Connecting with API key sk_live_test_dummy_token_12345678 and token ghp_" + "test_dummy_token_123456789012345 on host";

        var result = svc.ScrubContext(rawContext, isExternalGuest: true);
        Assert.True(result.WasCleaned);
        Assert.Equal(2, result.ScrubbedItemsCount);
        Assert.DoesNotContain("sk_live_", result.SanitizedContent);
        Assert.DoesNotContain("ghp_", result.SanitizedContent);
        Assert.Contains("[CONFIDENTIAL_SECRET_REDACTED]", result.SanitizedContent);
        Assert.NotEmpty(result.ContextHash);
    }

    [Fact]
    public void LogSharingEvent_RecordsAuditTrail()
    {
        var svc = new ContextSharingSecurityService();
        svc.LogSharingEvent(
            senderId: "owner@example.com",
            senderRole: "senior_dev",
            recipient: "external.partner@client.com",
            isExternalGuest: true,
            allowed: true,
            scrubbedCount: 1,
            hash: "a9b2c3d4"
        );

        var log = svc.GetAuditLog();
        Assert.Single(log);
        Assert.Equal("owner@example.com", log[0].SenderId);
        Assert.True(log[0].IsExternalGuest);
        Assert.Equal(1, log[0].ScrubbedSecretsCount);
    }
}