namespace Vespr.Core;

/// <summary>
/// Language detection and file metadata helper for the SDE shell. Port of app/langdetect.js.
/// </summary>
public static class LangDetect
{
    public const int MaxPath = 300;

    public static readonly string[] KnownLanguages =
    [
        "python",
        "javascript",
        "typescript",
        "html",
        "css",
        "json",
        "markdown",
        "shell",
        "rust",
        "go",
        "c",
        "cpp",
        "yaml",
        "toml",
        "sql",
        "docker",
        "git",
        "make",
        "config",
        "plaintext"
    ];

    public record LangMeta(
        string Id,
        string Name,
        string Icon,
        string? CommentToken,
        string? RunCmd,
        bool IsExecutable
    );

    public static readonly LangMeta DefaultMeta = new(
        "plaintext",
        "Plain text",
        "file",
        null,
        null,
        false
    );

    private static readonly Dictionary<string, LangMeta> LangMap = new(StringComparer.Ordinal)
    {
        ["python"] = new("python", "Python", "python", "#", "python3", true),
        ["javascript"] = new("javascript", "JavaScript", "javascript", "//", "node", true),
        ["typescript"] = new("typescript", "TypeScript", "typescript", "//", "node", false),
        ["html"] = new("html", "HTML", "html", "<!--", null, false),
        ["css"] = new("css", "CSS", "css", "/*", null, false),
        ["json"] = new("json", "JSON", "json", null, null, false),
        ["markdown"] = new("markdown", "Markdown", "markdown", null, null, false),
        ["shell"] = new("shell", "Shell", "terminal", "#", "sh", true),
        ["rust"] = new("rust", "Rust", "rust", "//", "cargo run", false),
        ["go"] = new("go", "Go", "go", "//", "go run", false),
        ["c"] = new("c", "C", "code", "//", null, false),
        ["cpp"] = new("cpp", "C++", "code", "//", null, false),
        ["yaml"] = new("yaml", "YAML", "gear", "#", null, false),
        ["toml"] = new("toml", "TOML", "gear", "#", null, false),
        ["sql"] = new("sql", "SQL", "database", "--", null, false),
        ["docker"] = new("docker", "Docker", "container", "#", null, false),
        ["git"] = new("git", "Git", "branch", "#", null, false),
        ["make"] = new("make", "Make", "terminal", "#", "make", true),
        ["config"] = new("config", "Config", "gear", "#", null, false),
        ["java"] = new("java", "Java", "code", "//", null, false),
        ["ruby"] = new("ruby", "Ruby", "code", "#", "ruby", true)
    };

    private static readonly Dictionary<string, string> ExtToLang = new(StringComparer.Ordinal)
    {
        ["py"] = "python",
        ["pyw"] = "python",
        ["pyi"] = "python",
        ["js"] = "javascript",
        ["mjs"] = "javascript",
        ["cjs"] = "javascript",
        ["jsx"] = "javascript",
        ["ts"] = "typescript",
        ["mts"] = "typescript",
        ["cts"] = "typescript",
        ["tsx"] = "typescript",
        ["html"] = "html",
        ["htm"] = "html",
        ["xhtml"] = "html",
        ["svg"] = "html",
        ["css"] = "css",
        ["scss"] = "css",
        ["sass"] = "css",
        ["less"] = "css",
        ["json"] = "json",
        ["json5"] = "json",
        ["jsonc"] = "json",
        ["md"] = "markdown",
        ["markdown"] = "markdown",
        ["mdown"] = "markdown",
        ["mkd"] = "markdown",
        ["sh"] = "shell",
        ["bash"] = "shell",
        ["zsh"] = "shell",
        ["fish"] = "shell",
        ["rs"] = "rust",
        ["go"] = "go",
        ["c"] = "c",
        ["h"] = "c",
        ["cpp"] = "cpp",
        ["cc"] = "cpp",
        ["cxx"] = "cpp",
        ["hpp"] = "cpp",
        ["hxx"] = "cpp",
        ["hh"] = "cpp",
        ["yml"] = "yaml",
        ["yaml"] = "yaml",
        ["toml"] = "toml",
        ["sql"] = "sql",
        ["java"] = "java",
        ["rb"] = "ruby",
        ["dockerfile"] = "docker",
        ["txt"] = "plaintext",
        ["text"] = "plaintext",
        ["log"] = "plaintext",
        ["env"] = "config",
        ["ini"] = "config",
        ["conf"] = "config"
    };

    private static readonly Dictionary<string, string> ExactToLang = new(StringComparer.Ordinal)
    {
        ["dockerfile"] = "docker",
        ["makefile"] = "make",
        ["cargo.toml"] = "toml",
        ["package.json"] = "json",
        ["tsconfig.json"] = "json",
        [".gitignore"] = "git",
        [".gitattributes"] = "git",
        [".gitmodules"] = "git",
        [".bashrc"] = "shell",
        [".zshrc"] = "shell",
        [".profile"] = "shell",
        [".bash_profile"] = "shell",
        [".env"] = "config",
        [".env.local"] = "config",
        [".env.example"] = "config",
        [".env.development"] = "config",
        [".env.test"] = "config",
        [".env.production"] = "config"
    };

    private static string CleanString(string? filename)
    {
        if (filename is null) return "";
        var replaced = filename.Replace("\0", "");
        return Js.Trim(replaced);
    }

    private static string ExtractBasename(string? pathStr)
    {
        var norm = CleanString(pathStr).Replace('\\', '/');
        var lastSlash = norm.LastIndexOf('/');
        var baseStr = lastSlash >= 0 ? norm[(lastSlash + 1)..] : norm;
        return baseStr.Length > MaxPath ? baseStr[..MaxPath] : baseStr;
    }

    public static string ExtensionOf(string? filename)
    {
        var baseStr = Js.ToLowerCase(ExtractBasename(filename));
        if (string.IsNullOrEmpty(baseStr)) return "";

        // Compound extensions take priority
        if (baseStr.EndsWith(".d.ts", StringComparison.Ordinal)) return "d.ts";

        var lastDot = baseStr.LastIndexOf('.');
        if (lastDot <= 0) return "";
        return baseStr[(lastDot + 1)..];
    }

    private static string ResolveLangKey(string? filename)
    {
        var baseStr = Js.ToLowerCase(ExtractBasename(filename));
        if (string.IsNullOrEmpty(baseStr)) return "plaintext";

        // Exact filename takes precedence over extension rules
        if (ExactToLang.TryGetValue(baseStr, out var exactMatch))
        {
            return exactMatch;
        }

        // Compound extensions
        if (baseStr.EndsWith(".d.ts", StringComparison.Ordinal)) return "typescript";

        var lastDot = baseStr.LastIndexOf('.');
        if (lastDot == -1) return "plaintext";

        var ext = baseStr[(lastDot + 1)..];
        if (ExtToLang.TryGetValue(ext, out var extMatch))
        {
            return extMatch;
        }

        return "plaintext";
    }

    public static string LangId(string? filename) => ResolveLangKey(filename);

    public static string LangOf(string? filename)
    {
        var key = ResolveLangKey(filename);
        return LangMap.TryGetValue(key, out var entry) ? entry.Name : DefaultMeta.Name;
    }

    public static LangMeta Meta(string? filename)
    {
        var key = ResolveLangKey(filename);
        if (LangMap.TryGetValue(key, out var entry))
        {
            return entry with { };
        }
        return DefaultMeta with { };
    }

    public static string CommentPrefix(string? filename) => Meta(filename).CommentToken ?? "";

    public static bool IsExecutable(string? filename) => Meta(filename).IsExecutable;

    public static bool IsCode(string? filename) => ResolveLangKey(filename) != "plaintext";
}
