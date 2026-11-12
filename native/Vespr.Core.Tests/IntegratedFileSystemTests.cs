namespace Vespr.Core.Tests;

using Xunit;
using Vespr.Core;
using static Vespr.Core.IntegratedFileSystem;

public class IntegratedFileSystemTests
{
    private readonly AccountFlavors.AccountProfile _student = AccountFlavors.PreconfiguredAccounts.First(a => a.Role == "student");
    private readonly AccountFlavors.AccountProfile _seniorDev = AccountFlavors.PreconfiguredAccounts.First(a => a.Role == "senior_dev");
    private readonly AccountFlavors.AccountProfile _juniorDev = AccountFlavors.PreconfiguredAccounts.First(a => a.Role == "junior_dev");
    private readonly AccountFlavors.AccountProfile _legal = AccountFlavors.PreconfiguredAccounts.First(a => a.Role == "corporate_legal");

    [Fact]
    public void GetScopeInfo_ReturnsAccurateScopeState()
    {
        var projInfo = GetScopeInfo(FsScope.Project, _student);
        Assert.Equal(FsScope.Project, projInfo.Scope);
        Assert.True(projInfo.CanRead);
        Assert.True(projInfo.CanWrite);
        Assert.False(projInfo.IsSandboxed);

        var sysInfoStudent = GetScopeInfo(FsScope.SystemHost, _student);
        Assert.Equal(FsScope.SystemHost, sysInfoStudent.Scope);
        Assert.False(sysInfoStudent.CanRead);
        Assert.False(sysInfoStudent.CanWrite);
        Assert.True(sysInfoStudent.IsSandboxed);

        var sysInfoDev = GetScopeInfo(FsScope.SystemHost, _seniorDev);
        Assert.True(sysInfoDev.CanRead);
        Assert.True(sysInfoDev.CanWrite);
        Assert.False(sysInfoDev.IsSandboxed);
    }

    [Fact]
    public void CanAccessScope_EnforcesRoleBasedMatrix()
    {
        // Student: Project ok, System denied
        Assert.True(CanAccessScope(_student, FsScope.Project, forWrite: true));
        Assert.False(CanAccessScope(_student, FsScope.SystemHost, forWrite: false));
        Assert.False(CanAccessScope(_student, FsScope.SystemHost, forWrite: true));

        // Junior Dev: Project ok, System read-only
        Assert.True(CanAccessScope(_juniorDev, FsScope.Project, forWrite: true));
        Assert.True(CanAccessScope(_juniorDev, FsScope.SystemHost, forWrite: false));
        Assert.False(CanAccessScope(_juniorDev, FsScope.SystemHost, forWrite: true));

        // Senior Dev: Full access
        Assert.True(CanAccessScope(_seniorDev, FsScope.Project, forWrite: true));
        Assert.True(CanAccessScope(_seniorDev, FsScope.SystemHost, forWrite: true));

        // Corporate Legal: Read-only across scopes
        Assert.True(CanAccessScope(_legal, FsScope.Project, forWrite: false));
        Assert.False(CanAccessScope(_legal, FsScope.Project, forWrite: true));
        Assert.True(CanAccessScope(_legal, FsScope.SystemHost, forWrite: false));
        Assert.False(CanAccessScope(_legal, FsScope.SystemHost, forWrite: true));
    }

    [Fact]
    public void NormalizePath_ResolvesTraversalsAndPrefixes()
    {
        Assert.Equal("cart.py", NormalizePath("project://cart.py", FsScope.Project));
        Assert.Equal("server/app.py", NormalizePath("project://server/./app.py", FsScope.Project));
        Assert.Equal("app.py", NormalizePath("server/../app.py", FsScope.Project));
        Assert.Equal("home/user/script.sh", NormalizePath("system:///home/user/script.sh", FsScope.SystemHost));
        Assert.Equal("", NormalizePath("", FsScope.Project));
    }

    [Fact]
    public void DetectMimeType_IdentifiesCommonExtensions()
    {
        Assert.Equal("text/x-python", DetectMimeType("test.py"));
        Assert.Equal("text/x-csharp", DetectMimeType("Class.cs"));
        Assert.Equal("application/javascript", DetectMimeType("bundle.mjs"));
        Assert.Equal("application/json", DetectMimeType("config.json"));
        Assert.Equal("image/png", DetectMimeType("diagram.png"));
        Assert.Equal("application/octet-stream", DetectMimeType("binary.bin"));
    }

    [Fact]
    public void BuildDirectoryTree_ConstructsHierarchicalTree()
    {
        var entries = new List<FsEntry>
        {
            new FsEntry("src/index.js", "index.js", FsScope.Project, false, 100, DateTime.UtcNow, ".js", false, "application/javascript"),
            new FsEntry("src/components/button.js", "button.js", FsScope.Project, false, 250, DateTime.UtcNow, ".js", false, "application/javascript"),
            new FsEntry("README.md", "README.md", FsScope.Project, false, 80, DateTime.UtcNow, ".md", false, "text/markdown"),
        };

        var tree = BuildDirectoryTree(entries, FsScope.Project);
        Assert.Equal(2, tree.Count); // "src" directory and "README.md" file

        var srcNode = tree.First(n => n.Name == "src");
        Assert.True(srcNode.IsDirectory);
        Assert.Equal(2, srcNode.FileCount);
        Assert.Equal(350, srcNode.Size);

        var compNode = srcNode.Children.First(c => c.Name == "components");
        Assert.True(compNode.IsDirectory);
        Assert.Equal(1, compNode.FileCount);
    }

    [Fact]
    public void ReadAndWriteFile_StoresAndRetrievesContentWithRBAC()
    {
        var storage = new Dictionary<string, string>();

        // Senior dev writes to system host
        var writeRes = WriteFile("scripts/setup.sh", FsScope.SystemHost, "echo 'hello'", storage, _seniorDev);
        Assert.True(writeRes.Success);
        Assert.Equal("scripts/setup.sh", writeRes.AffectedPath);

        // Senior dev reads back
        var readRes = ReadFile("scripts/setup.sh", FsScope.SystemHost, storage, _seniorDev);
        Assert.True(readRes.Success);
        Assert.Equal("echo 'hello'", readRes.Message);

        // Student tries to write to system host -> blocked
        var studentWrite = WriteFile("scripts/hack.sh", FsScope.SystemHost, "evil", storage, _student);
        Assert.False(studentWrite.Success);
        Assert.Contains("denied", studentWrite.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CopyBetweenScopes_IntegratesHostFilesIntoProject()
    {
        var storage = new Dictionary<string, string>
        {
            ["systemhost:datasets/sample.csv"] = "id,name,value\n1,alpha,42"
        };

        // Senior dev copies from System to Project
        var res = CopyBetweenScopes(
            srcPath: "datasets/sample.csv",
            srcScope: FsScope.SystemHost,
            dstPath: "data/imported.csv",
            dstScope: FsScope.Project,
            storage: storage,
            account: _seniorDev
        );

        Assert.True(res.Success);
        Assert.True(storage.ContainsKey("project:data/imported.csv"));
        Assert.Equal("id,name,value\n1,alpha,42", storage["project:data/imported.csv"]);

        // Student tries to copy from system -> denied
        var studentCopy = CopyBetweenScopes(
            srcPath: "datasets/sample.csv",
            srcScope: FsScope.SystemHost,
            dstPath: "data/stolen.csv",
            dstScope: FsScope.Project,
            storage: storage,
            account: _student
        );
        Assert.False(studentCopy.Success);
    }

    [Fact]
    public void Search_FiltersEntriesByQueryAndScope()
    {
        var projEntries = CreateDefaultProjectEntries();
        var sysEntries = CreateDefaultSystemEntries();
        var all = projEntries.Concat(sysEntries).ToList();

        var pySearch = Search("cart", FsScope.Project, all);
        Assert.Equal(2, pySearch.Count);
        Assert.All(pySearch, e => Assert.Equal(FsScope.Project, e.Scope));

        var msgSearch = Search("msg", FsScope.SystemHost, all);
        Assert.Single(msgSearch);
        Assert.Equal("msg.py", msgSearch[0].Name);
    }
}
