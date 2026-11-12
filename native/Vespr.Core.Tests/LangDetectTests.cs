namespace Vespr.Core.Tests;

public class LangDetectTests
{
    [Fact]
    public void Constants_exist_and_contain_core_languages()
    {
        Assert.Equal(300, LangDetect.MaxPath);
        Assert.Contains("python", LangDetect.KnownLanguages);
        Assert.Contains("javascript", LangDetect.KnownLanguages);
        Assert.Contains("typescript", LangDetect.KnownLanguages);
        Assert.Contains("html", LangDetect.KnownLanguages);
        Assert.Contains("css", LangDetect.KnownLanguages);
        Assert.Contains("json", LangDetect.KnownLanguages);
        Assert.Contains("markdown", LangDetect.KnownLanguages);
        Assert.Contains("shell", LangDetect.KnownLanguages);
        Assert.Contains("rust", LangDetect.KnownLanguages);
        Assert.Contains("go", LangDetect.KnownLanguages);
        Assert.Contains("c", LangDetect.KnownLanguages);
        Assert.Contains("cpp", LangDetect.KnownLanguages);
        Assert.Contains("yaml", LangDetect.KnownLanguages);
        Assert.Contains("toml", LangDetect.KnownLanguages);
        Assert.Contains("sql", LangDetect.KnownLanguages);
        Assert.Contains("docker", LangDetect.KnownLanguages);
        Assert.Contains("git", LangDetect.KnownLanguages);
        Assert.Contains("make", LangDetect.KnownLanguages);
        Assert.Contains("plaintext", LangDetect.KnownLanguages);
    }

    [Fact]
    public void LangOf_resolves_common_file_extensions_to_display_names()
    {
        Assert.Equal("Python", LangDetect.LangOf("cart.py"));
        Assert.Equal("JavaScript", LangDetect.LangOf("index.js"));
        Assert.Equal("JavaScript", LangDetect.LangOf("module.mjs"));
        Assert.Equal("JavaScript", LangDetect.LangOf("bundle.cjs"));
        Assert.Equal("TypeScript", LangDetect.LangOf("app.ts"));
        Assert.Equal("TypeScript", LangDetect.LangOf("component.tsx"));
        Assert.Equal("JavaScript", LangDetect.LangOf("widget.jsx"));
        Assert.Equal("HTML", LangDetect.LangOf("index.html"));
        Assert.Equal("HTML", LangDetect.LangOf("icon.svg"));
        Assert.Equal("CSS", LangDetect.LangOf("style.css"));
        Assert.Equal("CSS", LangDetect.LangOf("theme.scss"));
        Assert.Equal("JSON", LangDetect.LangOf("data.json"));
        Assert.Equal("Markdown", LangDetect.LangOf("README.md"));
        Assert.Equal("Shell", LangDetect.LangOf("build.sh"));
        Assert.Equal("Rust", LangDetect.LangOf("main.rs"));
        Assert.Equal("Go", LangDetect.LangOf("server.go"));
        Assert.Equal("C", LangDetect.LangOf("main.c"));
        Assert.Equal("C", LangDetect.LangOf("header.h"));
        Assert.Equal("C++", LangDetect.LangOf("native.cpp"));
        Assert.Equal("YAML", LangDetect.LangOf("config.yml"));
        Assert.Equal("YAML", LangDetect.LangOf("deploy.yaml"));
        Assert.Equal("TOML", LangDetect.LangOf("settings.toml"));
        Assert.Equal("SQL", LangDetect.LangOf("query.sql"));
        Assert.Equal("Java", LangDetect.LangOf("App.java"));
        Assert.Equal("Ruby", LangDetect.LangOf("script.rb"));
        Assert.Equal("Plain text", LangDetect.LangOf("notes.txt"));
    }

    [Fact]
    public void LangOf_handles_uppercase_and_mixed_case_extensions()
    {
        Assert.Equal("Python", LangDetect.LangOf("MAIN.PY"));
        Assert.Equal("JavaScript", LangDetect.LangOf("index.JS"));
        Assert.Equal("CSS", LangDetect.LangOf("STYLE.CSS"));
        Assert.Equal("HTML", LangDetect.LangOf("PAGE.HTML"));
        Assert.Equal("Markdown", LangDetect.LangOf("README.MD"));
    }

    [Fact]
    public void LangOf_handles_nested_paths_and_Windows_backslashes()
    {
        Assert.Equal("TypeScript", LangDetect.LangOf("src/components/Button.tsx"));
        Assert.Equal("Python", LangDetect.LangOf("deeply/nested/dir/test.py"));
        Assert.Equal("JavaScript", LangDetect.LangOf(@"server\routes\auth.js"));
        Assert.Equal("Python", LangDetect.LangOf(@"mixed/path\to/file.py"));
    }

    [Fact]
    public void LangOf_handles_compound_extensions()
    {
        Assert.Equal("TypeScript", LangDetect.LangOf("types.d.ts"));
        Assert.Equal("TypeScript", LangDetect.LangOf("src/globals.d.ts"));
    }

    [Fact]
    public void LangOf_handles_special_exact_names_and_dotfiles()
    {
        Assert.Equal("Docker", LangDetect.LangOf("Dockerfile"));
        Assert.Equal("Docker", LangDetect.LangOf("dockerfile"));
        Assert.Equal("Make", LangDetect.LangOf("Makefile"));
        Assert.Equal("Make", LangDetect.LangOf("makefile"));
        Assert.Equal("Git", LangDetect.LangOf(".gitignore"));
        Assert.Equal("Git", LangDetect.LangOf(".gitattributes"));
        Assert.Equal("Git", LangDetect.LangOf(".gitmodules"));
        Assert.Equal("Config", LangDetect.LangOf(".env"));
        Assert.Equal("Config", LangDetect.LangOf(".env.local"));
        Assert.Equal("Shell", LangDetect.LangOf(".bashrc"));
        Assert.Equal("Shell", LangDetect.LangOf(".zshrc"));
        Assert.Equal("TOML", LangDetect.LangOf("Cargo.toml"));
        Assert.Equal("JSON", LangDetect.LangOf("package.json"));
        Assert.Equal("JSON", LangDetect.LangOf("tsconfig.json"));
    }

    [Fact]
    public void LangOf_handles_multi_dot_filenames()
    {
        Assert.Equal("JavaScript", LangDetect.LangOf("app.test.js"));
        Assert.Equal("TypeScript", LangDetect.LangOf("schema.spec.ts"));
        Assert.Equal("JSON", LangDetect.LangOf(".eslintrc.json"));
        Assert.Equal("Plain text", LangDetect.LangOf("archive.tar.gz"));
    }

    [Fact]
    public void Hostile_input_immunity_for_langOf_and_langId()
    {
        Assert.Equal("Plain text", LangDetect.LangOf(null));
        Assert.Equal("Plain text", LangDetect.LangOf(""));
        Assert.Equal("Plain text", LangDetect.LangOf("no_extension_file"));
        Assert.Equal("Python", LangDetect.LangOf("weird\0file.py"));
        Assert.Equal("Plain text", LangDetect.LangOf("trailing/slash/"));
        Assert.Equal("Plain text", LangDetect.LangOf("dot_at_end."));

        var longPath = string.Concat(Enumerable.Repeat("a/", 200)) + "test.py";
        Assert.Equal("Python", LangDetect.LangOf(longPath));

        Assert.Equal("plaintext", LangDetect.LangId(null));
        Assert.Equal("plaintext", LangDetect.LangId(""));
        Assert.Equal("javascript", LangDetect.LangId("app.js"));
        Assert.Equal("plaintext", LangDetect.LangId("__proto__"));
        Assert.Equal("plaintext", LangDetect.LangId("constructor"));
    }

    [Fact]
    public void Meta_returns_complete_language_descriptors()
    {
        var pyMeta = LangDetect.Meta("agent.py");
        Assert.Equal("python", pyMeta.Id);
        Assert.Equal("Python", pyMeta.Name);
        Assert.Equal("python", pyMeta.Icon);
        Assert.Equal("#", pyMeta.CommentToken);
        Assert.Equal("python3", pyMeta.RunCmd);
        Assert.True(pyMeta.IsExecutable);

        var jsMeta = LangDetect.Meta("server.js");
        Assert.Equal("javascript", jsMeta.Id);
        Assert.Equal("JavaScript", jsMeta.Name);
        Assert.Equal("javascript", jsMeta.Icon);
        Assert.Equal("//", jsMeta.CommentToken);
        Assert.Equal("node", jsMeta.RunCmd);
        Assert.True(jsMeta.IsExecutable);

        var mdMeta = LangDetect.Meta("docs/guide.md");
        Assert.Equal("markdown", mdMeta.Id);
        Assert.Equal("Markdown", mdMeta.Name);
        Assert.Equal("markdown", mdMeta.Icon);
        Assert.Null(mdMeta.CommentToken);
        Assert.Null(mdMeta.RunCmd);
        Assert.False(mdMeta.IsExecutable);

        var unknownMeta = LangDetect.Meta("LICENSE");
        Assert.Equal("plaintext", unknownMeta.Id);
        Assert.Equal("Plain text", unknownMeta.Name);
        Assert.Equal("file", unknownMeta.Icon);
        Assert.Null(unknownMeta.CommentToken);
        Assert.False(unknownMeta.IsExecutable);
    }

    [Fact]
    public void Meta_returns_new_copies_preventing_map_mutation()
    {
        var m1 = LangDetect.Meta("test.py");
        var m1Modified = m1 with { Name = "Hacked", IsExecutable = false };

        var m2 = LangDetect.Meta("test.py");
        Assert.Equal("Python", m2.Name);
        Assert.True(m2.IsExecutable);
    }

    [Fact]
    public void IsExecutable_correctly_identifies_runnable_scripts()
    {
        Assert.True(LangDetect.IsExecutable("cart.py"));
        Assert.True(LangDetect.IsExecutable("deploy.sh"));
        Assert.True(LangDetect.IsExecutable("server.js"));
        Assert.True(LangDetect.IsExecutable("task.rb"));
        Assert.True(LangDetect.IsExecutable("Makefile"));
        Assert.False(LangDetect.IsExecutable("style.css"));
        Assert.False(LangDetect.IsExecutable("index.html"));
        Assert.False(LangDetect.IsExecutable("data.json"));
        Assert.False(LangDetect.IsExecutable(null));
    }

    [Fact]
    public void IsCode_distinguishes_source_code_and_markup_from_plain_text()
    {
        Assert.True(LangDetect.IsCode("main.py"));
        Assert.True(LangDetect.IsCode("app.ts"));
        Assert.True(LangDetect.IsCode("index.html"));
        Assert.True(LangDetect.IsCode("styles.css"));
        Assert.True(LangDetect.IsCode("Dockerfile"));
        Assert.False(LangDetect.IsCode("notes.txt"));
        Assert.False(LangDetect.IsCode("unknown_file"));
        Assert.False(LangDetect.IsCode(null));
    }

    [Fact]
    public void CommentPrefix_returns_correct_comment_delimiters()
    {
        Assert.Equal("#", LangDetect.CommentPrefix("app.py"));
        Assert.Equal("//", LangDetect.CommentPrefix("app.js"));
        Assert.Equal("//", LangDetect.CommentPrefix("app.ts"));
        Assert.Equal("<!--", LangDetect.CommentPrefix("app.html"));
        Assert.Equal("/*", LangDetect.CommentPrefix("app.css"));
        Assert.Equal("--", LangDetect.CommentPrefix("app.sql"));
        Assert.Equal("#", LangDetect.CommentPrefix("app.sh"));
        Assert.Equal("", LangDetect.CommentPrefix("app.txt"));
        Assert.Equal("", LangDetect.CommentPrefix(null));
    }

    [Fact]
    public void ExtensionOf_extracts_normalized_extensions()
    {
        Assert.Equal("py", LangDetect.ExtensionOf("test.py"));
        Assert.Equal("js", LangDetect.ExtensionOf("TEST.JS"));
        Assert.Equal("d.ts", LangDetect.ExtensionOf("types.d.ts"));
        Assert.Equal("gz", LangDetect.ExtensionOf("archive.tar.gz"));
        Assert.Equal("", LangDetect.ExtensionOf(".gitignore"));
        Assert.Equal("", LangDetect.ExtensionOf("noext"));
        Assert.Equal("", LangDetect.ExtensionOf(""));
        Assert.Equal("", LangDetect.ExtensionOf(null));
        Assert.Equal("", LangDetect.ExtensionOf("file."));
    }
}
