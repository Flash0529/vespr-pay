using System.Text.Json;
using System.Text.Json.Nodes;

namespace Vespr.Core.Tests;

/// <summary>
/// Reads native/golden/&lt;module&gt;.json (written by native/tools/golden.mjs from the JavaScript module) so a port is checked
/// against the exact JavaScript answers. Cases noted "js-only" use inputs typed C# cannot receive and are skipped.
/// </summary>
public static class Golden
{
    public record Case(string Fn, JsonElement[] Args, JsonElement? Result, string? Throws, string Note);

    public static JsonElement Constants(string module) => Doc(module).GetProperty("constants");

    public static IEnumerable<Case> Cases(string module, string fn)
    {
        foreach (var c in Doc(module).GetProperty("cases").EnumerateArray())
        {
            if (c.GetProperty("fn").GetString() != fn) continue;
            var note = c.TryGetProperty("note", out var n) ? n.GetString() ?? "" : "";
            if (note.StartsWith("js-only")) continue;
            yield return new Case(fn, c.GetProperty("args").EnumerateArray().ToArray(),
                c.TryGetProperty("result", out var r) ? r : null,
                c.TryGetProperty("throws", out var t) ? t.GetString() : null, note);
        }
    }

    /// <summary>Runs every case and fails once, listing each mismatch, so one run shows the whole picture.</summary>
    public static void Check(string module, string fn, Func<Case, string> actualJson)
    {
        var failures = new List<string>(); var count = 0;
        foreach (var c in Cases(module, fn))
        {
            count++;
            var expected = c.Result is JsonElement e ? e.GetRawText() : "(throws " + c.Throws + ")";
            string actual;
            try { actual = actualJson(c); } catch (Exception ex) { actual = "(threw " + ex.GetType().Name + ": " + ex.Message + ")"; }
            if (Normalize(actual) != Normalize(expected))
                failures.Add($"{fn}({string.Join(", ", c.Args.Select(a => a.GetRawText()))}) expected {expected} got {actual}{(c.Note == "" ? "" : "  [" + c.Note + "]")}");
        }
        Assert.True(count > 0, $"no golden cases for {module}.{fn}");
        Assert.True(failures.Count == 0, $"{failures.Count} of {count} {module}.{fn} cases differ from JavaScript:\n" + string.Join("\n", failures));
    }

    // C# results serialize like the JS objects: camelCase names, null members left out (JS objects simply lack them)
    static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
    public static string Json(object? value) => JsonSerializer.Serialize(value, Options);

    // canonical form for comparing: object keys sorted (member order is not part of the contract), spacing and escaping normalized
    static string Normalize(string json) { try { return Canonical(JsonNode.Parse(json))?.ToJsonString() ?? "null"; } catch { return json; } }
    static JsonNode? Canonical(JsonNode? n) => n switch
    {
        JsonObject o => new JsonObject(o.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => KeyValuePair.Create(kv.Key, Canonical(kv.Value?.DeepClone())))),
        JsonArray a => new JsonArray(a.Select(x => Canonical(x?.DeepClone())).ToArray()),
        _ => n?.DeepClone()
    };

    static readonly Dictionary<string, JsonElement> Docs = [];
    static JsonElement Doc(string module)
    {
        lock (Docs)
        {
            if (Docs.TryGetValue(module, out var d)) return d;
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "golden"))) dir = dir.Parent;
            if (dir is null) throw new FileNotFoundException("native/golden not found above " + AppContext.BaseDirectory);
            var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir.FullName, "golden", module + ".json"))).RootElement;
            Docs[module] = doc;
            return doc;
        }
    }
}
