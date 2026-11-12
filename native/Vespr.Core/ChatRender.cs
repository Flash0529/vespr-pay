using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Vespr.Core;

/// <summary>
/// Conversation rendering for markdown, hand-over markers, folded work boxes, plans, and usage limits.
/// Faithful C# port of app/chat-render.js.
/// </summary>
public static class ChatRender
{
    public const int MaxMarkdownLen = 200_000;
    public const int MaxPlanItems = 20;
    public const int MaxPlanTextLen = 160;
    public const int DefaultLiveMs = 45_000;

    public static readonly Dictionary<string, string[]> Kinds = new(StringComparer.Ordinal)
    {
        ["image"] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"],
        ["svg"] = ["svg"],
        ["3d"] = ["stl", "obj", "glb", "gltf"],
        ["pdf"] = ["pdf"],
        ["code"] = ["py", "js", "mjs", "cjs", "ts", "jsx", "tsx", "html", "css", "json", "sh", "c", "h", "cpp", "go", "rs", "java", "sql", "yml", "yaml", "toml", "ipynb"],
        ["doc"] = ["md", "txt", "doc", "docx", "rtf", "csv", "tsv"],
        ["sheet"] = ["xls", "xlsx"],
        ["deck"] = ["ppt", "pptx", "key"],
        ["audio"] = ["mp3", "wav", "m4a", "ogg", "flac"],
        ["video"] = ["mp4", "mov", "webm", "mkv"]
    };

    public static readonly Dictionary<string, string> KindLabels = new(StringComparer.Ordinal)
    {
        ["image"] = "Image",
        ["svg"] = "Image",
        ["3d"] = "3D model",
        ["pdf"] = "PDF",
        ["code"] = "Code",
        ["doc"] = "Document",
        ["sheet"] = "Spreadsheet",
        ["deck"] = "Slides",
        ["audio"] = "Audio",
        ["video"] = "Video",
        ["file"] = "File"
    };

    public static readonly string[] PlanStates = ["pending", "in_progress", "done"];

    public static readonly Dictionary<string, string> PlanLabels = new(StringComparer.Ordinal)
    {
        ["done"] = "done",
        ["in_progress"] = "in progress",
        ["pending"] = "not started"
    };

    public record AttachedItem(string Name, long Size, string Id);

    public record MarkdownHooks(
        Func<string, string, string, string>? Marker = null,
        Func<AttachedItem, string>? Attached = null,
        Func<string, string>? Ic = null,
        Func<string, string, string?>? Highlight = null,
        Func<string, string>? LinkAttrs = null
    );

    public record WorkStep(
        string? Id = null,
        string? Text = null,
        long? Ts = null,
        bool? Ok = true,
        string? Detail = null,
        string? Status = null,
        double? Started = null,
        double? Ended = null
    );

    public record WorkGroup(
        string Id,
        List<WorkStep> Steps,
        bool Live = false
    );

    public record WorkGroupOptions(
        long? Now = null,
        bool Busy = false,
        long LiveMs = DefaultLiveMs
    );

    public record WorkBoxOptions(
        Func<string, string>? Ic = null,
        string Who = "The agent",
        bool Open = false,
        ISet<string>? OpenSteps = null,
        long? Now = null
    );

    public record PlanItem(string Text, string Status = "pending");

    public record PlanData(List<PlanItem> Items, long? Updated = null);

    public record PlanViewResult(
        List<PlanItem> Steps,
        int Done,
        int Total,
        string Current,
        bool Finished
    );

    public record LimitInfo(
        string? Id = null,
        string? Who = null,
        string? Title = null,
        string? Detail = null,
        double? Resets = null
    );

    public record CreditPack(string Id, double Usd);

    public record UserInfo(
        double? BalanceUsd = null,
        double? SpentUsd = null,
        List<CreditPack>? Packs = null
    );

    /// <summary>HTML escaping matching esc() in chat-render.js.</summary>
    public static string Esc(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            switch (c)
            {
                case '&': sb.Append("&amp;"); break;
                case '<': sb.Append("&lt;"); break;
                case '>': sb.Append("&gt;"); break;
                case '"': sb.Append("&quot;"); break;
                case '\'': sb.Append("&#39;"); break;
                default: sb.Append(c); break;
            }
        }
        return sb.ToString();
    }

    /// <summary>File extension extractor matching extOf().</summary>
    public static string ExtOf(string? name)
    {
        if (string.IsNullOrEmpty(name)) return "";
        var m = Regex.Match(name, @"\.([A-Za-z0-9]{1,6})$");
        return m.Success ? m.Groups[1].Value.ToLowerInvariant() : "";
    }

    /// <summary>Determine category kind of file by name or MIME type.</summary>
    public static string FileKind(string? name, string? type = "")
    {
        var e = ExtOf(name);
        foreach (var (k, list) in Kinds)
        {
            if (Array.IndexOf(list, e) >= 0) return k;
        }
        if (!string.IsNullOrEmpty(type) && Regex.IsMatch(type, @"^image/"))
        {
            return type == "image/svg+xml" ? "svg" : "image";
        }
        if (type == "application/pdf") return "pdf";
        return "file";
    }

    /// <summary>Format byte count to human readable B, KB, MB.</summary>
    public static string HumanSize(double n)
    {
        if (double.IsNaN(n) || double.IsInfinity(n) || n < 0) n = 0;
        if (n < 1024)
        {
            var val = n == 0 ? 1 : (long)n;
            return $"{val} B";
        }
        if (n < 1048576)
        {
            var kb = (long)Math.Floor((n / 1024.0) + 0.5);
            return $"{kb} KB";
        }
        var mb = n / 1048576.0;
        var format = n < 10485760 ? "0.0" : "0";
        return mb.ToString(format, CultureInfo.InvariantCulture) + " MB";
    }

    /// <summary>Format USD money amount.</summary>
    public static string Money(double? n)
    {
        var val = n is double d && !double.IsNaN(d) && !double.IsInfinity(d) ? d : 0.0;
        var sign = val < 0 ? "-$" : "$";
        var abs = Math.Abs(val);
        return sign + abs.ToString("F2", CultureInfo.InvariantCulture);
    }

    /// <summary>Render Markdown to safe HTML.</summary>
    public static string RenderMarkdown(string? raw, MarkdownHooks? hooks = null)
    {
        var stash = new List<string>();
        string Keep(string html)
        {
            stash.Add(html);
            return "\u0000" + (stash.Count - 1) + "\u0000";
        }

        var ic = hooks?.Ic ?? (_ => "");
        var s = (raw ?? "").Replace("\r\n", "\n").Replace("\r", "\n").Replace("\u0000", "");

        string Code(string lang, string body)
        {
            var l = (lang ?? "").ToLowerInvariant();
            string? inner = null;
            if (hooks?.Highlight != null)
            {
                try { inner = hooks.Highlight(l, body); } catch { }
            }
            return $"<div class=\"mdcode\"><div class=\"mdch\"><span class=\"mdlang\">{Esc(string.IsNullOrEmpty(l) ? "text" : l)}</span><button class=\"mdcopy\" data-copy aria-label=\"Copy the code\">{ic("copy")}<span>Copy</span></button></div><pre><code>{(inner ?? Esc(body))}</code></pre></div>";
        }

        // Fenced code blocks (closed)
        s = Regex.Replace(s, @"^```([\w+.#-]*)[^\n]*\n([\s\S]*?)\n?```[ \t]*$", m =>
            Keep(Code(m.Groups[1].Value, m.Groups[2].Value)), RegexOptions.Multiline);

        // Fenced code blocks (open fence at end of streaming reply)
        s = Regex.Replace(s, @"^```([\w+.#-]*)[^\n]*\n([\s\S]*)$", m =>
            Keep(Code(m.Groups[1].Value, m.Groups[2].Value)), RegexOptions.Multiline);

        // Hand-over markers: {{file:...}}, {{card:...}}, {{image:...}}
        s = Regex.Replace(s, @"\{\{(file|card|image):([^}|]+)(?:\|([^}]*))?\}\}", m =>
        {
            var kind = m.Groups[1].Value;
            var arg = m.Groups[2].Value.Trim();
            var opt = m.Groups[3].Success ? m.Groups[3].Value.Trim() : "";
            return Keep(hooks?.Marker != null ? hooks.Marker(kind, arg, opt) : Esc(m.Value));
        });

        // Attached marker: [attached: name size id=xxx]
        s = Regex.Replace(s, @"\[attached:\s*(\S+)\s*(\d+)\s*id=([a-zA-Z0-9_-]+)\]", m =>
        {
            var name = m.Groups[1].Value;
            var size = long.TryParse(m.Groups[2].Value, out var sz) ? sz : 0;
            var id = m.Groups[3].Value;
            return Keep(hooks?.Attached != null ? hooks.Attached(new AttachedItem(name, size, id)) : Esc(m.Value));
        });

        string Inline(string text)
        {
            var t = Esc(text);
            // Inline code: `code`
            t = Regex.Replace(t, @"`([^`\n]+)`", m => Keep("<code>" + m.Groups[1].Value + "</code>"));
            // Links: [label](url)
            t = Regex.Replace(t, @"\[([^\]\n]+)\]\((https?://[^\s)]+|mailto:[^\s)]+)\)", m =>
            {
                var label = m.Groups[1].Value;
                var url = m.Groups[2].Value;
                var extra = hooks?.LinkAttrs != null ? hooks.LinkAttrs(url) : "";
                return Keep($"<a href=\"{url}\" target=\"_blank\" rel=\"noopener noreferrer\"{extra}>{label}</a>");
            });
            // Bare URLs
            t = Regex.Replace(t, @"(^|[\s(])(https?://[^\s<)]+[^\s<).,;:!?])", m =>
            {
                var pre = m.Groups[1].Value;
                var url = m.Groups[2].Value;
                var extra = hooks?.LinkAttrs != null ? hooks.LinkAttrs(url) : "";
                return pre + Keep($"<a href=\"{url}\" target=\"_blank\" rel=\"noopener noreferrer\"{extra}>{url}</a>");
            });
            // Bold
            t = Regex.Replace(t, @"\*\*([^*\n]+?)\*\*", "<strong>$1</strong>");
            t = Regex.Replace(t, @"(^|[^\w])__([^_\n]+?)__(?!\w)", "$1<strong>$2</strong>");
            // Italics
            t = Regex.Replace(t, @"(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)", "$1<em>$2</em>");
            t = Regex.Replace(t, @"(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)", "$1<em>$2</em>");
            // Strikethrough
            t = Regex.Replace(t, @"~~([^~\n]+?)~~", "<del>$1</del>");
            return t;
        }

        var lines = s.Split('\n');
        var output = new List<string>();
        int i = 0;

        bool IsBlank(string l) => Regex.IsMatch(l, @"^\s*$");

        bool BlockPh(string l)
        {
            var m = Regex.Match(l, @"^\s*\u0000(\d+)\u0000\s*$");
            if (!m.Success) return false;
            var idx = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            return idx < stash.Count && Regex.IsMatch(stash[idx], @"^<(div|figure)");
        }

        const string listRe = @"^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$";

        bool TableSep(string l) =>
            Regex.IsMatch(l, @"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$") &&
            l.Contains('-') &&
            (l.Contains('|') || !Regex.IsMatch(l, @"^\s*:?-+:?\s*$"));

        string[] Cells(string l) =>
            Regex.Replace(Regex.Replace(l.Trim(), @"^\|", ""), @"\|$", "")
                 .Split('|')
                 .Select(c => c.Trim())
                 .ToArray();

        while (i < lines.Length)
        {
            var l = lines[i];
            if (IsBlank(l)) { i++; continue; }
            if (BlockPh(l)) { output.Add(l.Trim()); i++; continue; }

            // Headings
            var hm = Regex.Match(l, @"^(#{1,4})\s+(.*?)\s*#*$");
            if (hm.Success)
            {
                var level = hm.Groups[1].Value.Length + 2;
                output.Add($"<h{level} class=\"mdh\">{Inline(hm.Groups[2].Value)}</h{level}>");
                i++;
                continue;
            }

            // Horizontal rule
            if (Regex.IsMatch(l, @"^\s*([-_*])(\s*\1){2,}\s*$") && !Regex.IsMatch(l, listRe))
            {
                output.Add("<hr>");
                i++;
                continue;
            }

            // Blockquote
            if (Regex.IsMatch(l, @"^\s*>"))
            {
                var q = new List<string>();
                while (i < lines.Length && Regex.IsMatch(lines[i], @"^\s*>"))
                {
                    q.Add(Regex.Replace(lines[i++], @"^\s*>\s?", ""));
                }
                output.Add("<blockquote>" + string.Join("<br>", q.Select(Inline)) + "</blockquote>");
                continue;
            }

            // Table
            if (l.Contains('|') && i + 1 < lines.Length && TableSep(lines[i + 1]) && Cells(l).Length > 1)
            {
                var head = Cells(l);
                var align = Cells(lines[i + 1]).Select(c =>
                    Regex.IsMatch(c, @"^:-+:$") ? "center" :
                    Regex.IsMatch(c, @"-:$") ? "right" : "").ToArray();
                i += 2;
                var rows = new List<string[]>();
                while (i < lines.Length && !IsBlank(lines[i]) && lines[i].Contains('|'))
                {
                    rows.Add(Cells(lines[i++]));
                }
                string Td(string tag, string c, int k) =>
                    $"<{tag}{(k < align.Length && !string.IsNullOrEmpty(align[k]) ? $" style=\"text-align:{align[k]}\"" : "")}>{Inline(c)}</{tag}>";

                var thead = "<thead><tr>" + string.Join("", head.Select((c, k) => Td("th", c, k))) + "</tr></thead>";
                var tbody = "<tbody>" + string.Join("", rows.Select(r => "<tr>" + string.Join("", head.Select((_, k) => Td("td", k < r.Length ? r[k] : "", k))) + "</tr>")) + "</tbody>";
                output.Add($"<div class=\"mdtable\"><table>{thead}{tbody}</table></div>");
                continue;
            }

            // Lists
            if (Regex.IsMatch(l, listRe))
            {
                var stack = new Stack<(int ind, string tag)>();
                var html = new StringBuilder();
                Match lm;
                while (i < lines.Length && (lm = Regex.Match(lines[i], listRe)).Success)
                {
                    var ind = lm.Groups[1].Value.Replace("\t", "    ").Length;
                    var ord = Regex.IsMatch(lm.Groups[2].Value, @"\d");
                    var tag = ord ? "ol" : "ul";
                    while (stack.Count > 0 && ind < stack.Peek().ind)
                    {
                        html.Append($"</li></{stack.Pop().tag}>");
                    }
                    if (stack.Count == 0 || ind > stack.Peek().ind)
                    {
                        html.Append($"<{tag}>");
                        stack.Push((ind, tag));
                    }
                    else
                    {
                        html.Append("</li>");
                    }
                    html.Append("<li>").Append(Inline(lm.Groups[3].Value));
                    i++;
                    while (i < lines.Length && !IsBlank(lines[i]) && !Regex.IsMatch(lines[i], listRe) && Regex.IsMatch(lines[i], @"^\s{2,}\S"))
                    {
                        html.Append("<br>").Append(Inline(lines[i++].Trim()));
                    }
                }
                while (stack.Count > 0)
                {
                    html.Append($"</li></{stack.Pop().tag}>");
                }
                output.Add(html.ToString());
                continue;
            }

            // Paragraph
            var para = new List<string>();
            while (i < lines.Length &&
                   !IsBlank(lines[i]) &&
                   !Regex.IsMatch(lines[i], @"^(#{1,4})\s") &&
                   !Regex.IsMatch(lines[i], @"^\s*>") &&
                   !BlockPh(lines[i]) &&
                   !(Regex.IsMatch(lines[i], listRe) && para.Count > 0))
            {
                para.Add(lines[i++]);
            }
            if (para.Count == 0) para.Add(lines[i++]);
            output.Add("<p>" + string.Join("<br>", para.Select(Inline)) + "</p>");
        }

        var result = string.Join("", output);
        for (int n = 0; n < 4 && Regex.IsMatch(result, @"\u0000\d+\u0000"); n++)
        {
            result = Regex.Replace(result, @"\u0000(\d+)\u0000", m =>
            {
                var idx = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
                return idx < stash.Count ? stash[idx] : "";
            });
        }
        return string.IsNullOrEmpty(result) ? "<p></p>" : result;
    }

    private static bool IsRunning(WorkStep? s) => s != null && s.Status == "running";

    public static List<object> GroupWork(IEnumerable<object> items, WorkGroupOptions? options = null)
    {
        var now = options?.Now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var busy = options?.Busy ?? false;
        var liveMs = options?.LiveMs ?? DefaultLiveMs;

        var outList = new List<object>();
        foreach (var it in items)
        {
            if (it is WorkStep step)
            {
                WorkGroup? g = outList.Count > 0 ? outList[^1] as WorkGroup : null;
                if (g == null)
                {
                    g = new WorkGroup(step.Id ?? "w" + outList.Count, new List<WorkStep>(), false);
                    outList.Add(g);
                }
                g.Steps.Add(step);
            }
            else
            {
                outList.Add(it);
            }
        }

        foreach (var item in outList)
        {
            if (item is WorkGroup g && g.Steps.Any(IsRunning))
            {
                // update live
                var idx = outList.IndexOf(g);
                outList[idx] = g with { Live = true };
            }
        }

        if (outList.Count > 0 && outList[^1] is WorkGroup last && !last.Live)
        {
            var ts = last.Steps.Count > 0 ? (last.Steps[^1].Ts ?? 0) : 0;
            var isLive = busy || (ts > 0 && now - ts < liveMs);
            outList[^1] = last with { Live = isLive };
        }

        return outList;
    }

    public static string FormatDuration(double? ms)
    {
        if (ms is not double d || double.IsNaN(d) || double.IsInfinity(d) || d < 0) return "";
        if (d < 1000) return "<1s";
        var s = (long)Math.Floor((d / 1000.0) + 0.5);
        if (s < 60) return $"{s}s";
        var m = s / 60;
        if (m < 60) return $"{m}m {(s % 60):D2}s";
        return $"{m / 60}h {(m % 60):D2}m";
    }

    public static string StepTime(WorkStep? s, long? now = null)
    {
        if (s?.Started is not double started || double.IsNaN(started) || double.IsInfinity(started)) return "";
        var currentNow = (double)(now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var ended = s.Ended;
        var b = ended is double endVal && !double.IsNaN(endVal) && !double.IsInfinity(endVal) ? endVal : currentNow;
        return FormatDuration(b - started);
    }

    public static bool IsCommand(string? t) => t != null && t.StartsWith("$ ", StringComparison.Ordinal);

    public static string StepIcon(string? text, bool ok = true)
    {
        if (!ok) return "alert";
        var t = text ?? "";
        if (IsCommand(t)) return "term";
        if (Regex.IsMatch(t, @"^(read|open|view|look|list)", RegexOptions.IgnoreCase)) return "eye";
        if (Regex.IsMatch(t, @"^(edit|wrote|creat|updat|fix|renam|delet|add)", RegexOptions.IgnoreCase)) return "edit";
        if (Regex.IsMatch(t, @"^(search|find|grep|skill)", RegexOptions.IgnoreCase)) return "search";
        return "check";
    }

    private static string Plural(int n, string one, string many) => $"{n} {(n == 1 ? one : many)}";

    private class WorkKindGroup
    {
        public int N { get; set; }
        public HashSet<string> Names { get; } = new(StringComparer.Ordinal);
    }

    public static string SummarizeWork(IEnumerable<WorkStep> steps)
    {
        var list = steps.ToList();
        var groups = new Dictionary<string, WorkKindGroup>(StringComparer.Ordinal);
        var failed = list.Count(s => s.Ok == false);

        var workKinds = new (string Kind, Func<string, bool> Test)[]
        {
            ("cmd", t => IsCommand(t)),
            ("web", t => Regex.IsMatch(t, @"^search(ing)? the web", RegexOptions.IgnoreCase)),
            ("list", t => Regex.IsMatch(t, @"^list", RegexOptions.IgnoreCase)),
            ("read", t => Regex.IsMatch(t, @"^(read|open|view|look)", RegexOptions.IgnoreCase)),
            ("edit", t => Regex.IsMatch(t, @"^(edit|replac|updat)", RegexOptions.IgnoreCase)),
            ("write", t => Regex.IsMatch(t, @"^(writ|creat)", RegexOptions.IgnoreCase)),
            ("delete", t => Regex.IsMatch(t, @"^delet", RegexOptions.IgnoreCase))
        };

        foreach (var s in list)
        {
            var t = (s.Text ?? "").Split('\n')[0];
            string k = "other";
            foreach (var (kind, test) in workKinds)
            {
                if (test(t)) { k = kind; break; }
            }
            if (!groups.TryGetValue(k, out var g))
            {
                g = new WorkKindGroup();
                groups[k] = g;
            }
            g.N++;
            var name = Regex.Replace(t, @"^\$?\s*\S+\s+", "");
            g.Names.Add(name);
        }

        string FileVerb(string verb, WorkKindGroup g) =>
            g.Names.Count == 1 ? $"{verb} {g.Names.First()}" : $"{verb} {Plural(g.Names.Count, "file", "files")}";

        string Say(string k, WorkKindGroup g) => k switch
        {
            "cmd" => $"ran {Plural(g.N, "command", "commands")}",
            "web" => g.N == 1 ? "searched the web" : $"searched the web {g.N} times",
            "list" => "listed the files",
            "read" => FileVerb("read", g),
            "edit" => FileVerb("edited", g),
            "write" => FileVerb("wrote", g),
            "delete" => FileVerb("deleted", g),
            _ => Plural(g.N, "other step", "other steps")
        };

        var line = string.Join(", ", groups.Select(pair => Say(pair.Key, pair.Value)));
        var summary = string.IsNullOrEmpty(line)
            ? "No steps"
            : char.ToUpper(line[0], CultureInfo.InvariantCulture) + line[1..];

        return failed > 0 ? $"{summary}, {failed} failed" : summary;
    }

    public static string StepLine(WorkStep? s)
    {
        var t = (s?.Text ?? "").Split('\n')[0];
        return t.StartsWith("$ ", StringComparison.Ordinal) ? t[2..] : t;
    }

    public static string WorkBox(WorkGroup g, WorkBoxOptions? options = null)
    {
        var ic = options?.Ic ?? (_ => "");
        var who = options?.Who ?? "The agent";
        var open = options?.Open ?? false;
        var openSteps = options?.OpenSteps;
        var now = options?.Now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var last = g.Steps.Count > 0 ? g.Steps[^1] : new WorkStep();
        var failed = g.Steps.Any(s => s.Ok == false);
        var current = g.Steps.FirstOrDefault(IsRunning) ?? last;

        var firstStarted = g.Steps.Count > 0 ? g.Steps[0].Started : null;
        var lastEnded = last.Ended;
        var total = !g.Live && firstStarted.HasValue && lastEnded.HasValue
            ? FormatDuration(lastEnded.Value - firstStarted.Value)
            : "";

        var head = g.Live
            ? $"<span class=\"wsp\" aria-hidden=\"true\"></span><span class=\"wl\"><b>{Esc(who)} is working</b><span class=\"wcur\">{Esc(StepLine(current))}</span></span>"
            : $"<span class=\"wdone{(failed ? " bad" : "")}\" aria-hidden=\"true\">{ic(failed ? "alert" : "check")}</span><span class=\"wl\">{Esc(SummarizeWork(g.Steps))}{(string.IsNullOrEmpty(total) ? "" : $"<span class=\"wtot\"> · {total}</span>")}</span>";

        var rows = new StringBuilder();
        for (int k = 0; k < g.Steps.Count; k++)
        {
            var s = g.Steps[k];
            var run = IsRunning(s);
            var t = StepTime(s, now);
            var icon = run ? "<span class=\"wsp sm\" aria-hidden=\"true\"></span>" : ic(StepIcon(s.Text, s.Ok != false));
            var time = !string.IsNullOrEmpty(t)
                ? $"<span class=\"wdur\"{(run && s.Started.HasValue ? $" data-start=\"{s.Started.Value}\"" : "")}>{t}</span>"
                : "";
            var cls = $"wst{(s.Ok == false ? " err" : "")}{(run ? " run" : "")}";
            var kClamped = Math.Min(k, 12);

            if (openSteps == null || string.IsNullOrEmpty(s.Detail))
            {
                var pre = openSteps == null && !string.IsNullOrEmpty(s.Detail) ? $"<pre>{Esc(s.Detail)}</pre>" : "";
                rows.Append($"<div class=\"{cls}\" style=\"--k:{kClamped}\"><span class=\"wsi\">{icon}</span><span class=\"wt\">{Esc(StepLine(s))}</span>{time}{pre}</div>");
            }
            else
            {
                var id = s.Id ?? (g.Id + ":" + k);
                var isOpen = openSteps.Contains(id);
                var pre = isOpen ? $"<pre>{Esc(s.Detail)}</pre>" : "";
                rows.Append($"<div class=\"{cls}\" style=\"--k:{kClamped}\" data-step=\"{Esc(id)}\"{(isOpen ? " data-open=\"1\"" : "")}><button class=\"wsr\" data-step-toggle aria-expanded=\"{(isOpen ? "true" : "false")}\"><span class=\"wsi\">{icon}</span><span class=\"wt\">{Esc(StepLine(s))}</span>{time}<span class=\"wc\">{ic("chevr")}</span></button>{pre}</div>");
            }
        }

        var openAttr = open ? " data-open=\"1\"" : "";
        var openExpanded = open ? "true" : "false";
        var liveClass = g.Live ? "busy" : "done";
        var ts = last.Ts ?? 0;

        return $"<div class=\"wbox {liveClass}\" data-work=\"{Esc(g.Id)}\" data-ts=\"{ts}\"{openAttr}><button class=\"wh\" data-work-toggle aria-expanded=\"{openExpanded}\">{head}<span class=\"wn\">{g.Steps.Count}</span><span class=\"wc\">{ic("chevr")}</span></button><div class=\"wb\"><div class=\"wbi\">{rows}</div></div></div>";
    }

    public static PlanViewResult PlanView(PlanData? plan)
    {
        var raw = plan?.Items ?? [];
        var steps = new List<PlanItem>();
        foreach (var it in raw.Take(MaxPlanItems))
        {
            if (it == null) continue;
            var text = Regex.Replace(it.Text ?? "", @"\s+", " ").Trim();
            if (text.Length > MaxPlanTextLen) text = text[..MaxPlanTextLen];
            if (!string.IsNullOrEmpty(text))
            {
                var status = Array.IndexOf(PlanStates, it.Status) >= 0 ? it.Status : "pending";
                steps.Add(new PlanItem(text, status));
            }
        }
        var done = steps.Count(s => s.Status == "done");
        var cur = steps.FirstOrDefault(s => s.Status == "in_progress");
        return new PlanViewResult(
            steps,
            done,
            steps.Count,
            cur?.Text ?? "",
            steps.Count > 0 && done == steps.Count
        );
    }

    public static string PlanBox(PlanData? plan, Func<string, string>? ic = null, string who = "The agent")
    {
        var v = PlanView(plan);
        if (v.Total == 0) return "";
        var iconFn = ic ?? (_ => "");

        var rows = string.Join("", v.Steps.Select(s =>
        {
            var icon = s.Status == "done"
                ? iconFn("check")
                : s.Status == "in_progress"
                    ? "<span class=\"wsp sm\" aria-hidden=\"true\"></span>"
                    : "";
            var label = PlanLabels.TryGetValue(s.Status, out var lbl) ? lbl : "not started";
            return $"<li class=\"pst {s.Status}\"><span class=\"psi\" role=\"img\" aria-label=\"{label}\">{icon}</span><span class=\"pt\">{Esc(s.Text)}</span></li>";
        }));

        var doneClass = v.Finished ? " done" : "";
        return $"<div class=\"planbox{doneClass}\" data-plan=\"{Esc(who)}\"><div class=\"ph\"><span class=\"pw\">{Esc(who)}'s plan</span><span class=\"pn\">{v.Done}/{v.Total}</span></div><ol class=\"pl\">{rows}</ol></div>";
    }

    public static string LimitCard(LimitInfo? it, Func<string, string>? ic = null, bool mine = false)
    {
        var iconFn = ic ?? (_ => "");
        var who = it?.Who ?? "The agent";
        if (!mine)
        {
            return $"<div class=\"m note\"><div class=\"body\">{Esc(who)} paused: the person who asked is out of usage.</div></div>";
        }
        var resets = "";
        if (it?.Resets is double r && r > 0)
        {
            var dt = DateTimeOffset.FromUnixTimeMilliseconds((long)r).ToLocalTime();
            var timeStr = dt.ToString("h:mm tt", CultureInfo.InvariantCulture);
            resets = $" · Resets at {timeStr}";
        }

        var id = it?.Id ?? "";
        var title = it?.Title ?? "Usage limit reached";
        var detail = it?.Detail ?? "Get more usage to keep working";

        return $"<div class=\"limitcard\" role=\"status\" data-limit=\"{Esc(id)}\"><div class=\"lt\">{iconFn("clock")}<span><b>{Esc(title)}</b>{Esc(resets)}</span></div>" +
               $"<div class=\"ld\">{Esc(detail)}</div>" +
               "<div class=\"lb\"><button type=\"button\" class=\"lbtn pri\" data-billing=\"buy\">Get more usage</button><button type=\"button\" class=\"lbtn\" data-billing=\"usage\">Open usage settings</button></div><div class=\"lu\" hidden></div></div>";
    }

    public static string UsagePanel(UserInfo? me)
    {
        var balance = Money(me?.BalanceUsd);
        var spent = Money(me?.SpentUsd);
        var packsList = me?.Packs ?? [];
        var packButtons = string.Join("", packsList.Select(p =>
            $"<button type=\"button\" class=\"lbtn\" data-billing=\"buy\" data-pack=\"{Esc(p.Id)}\">Add {Esc(Money(p.Usd))}</button>"));

        return $"<div class=\"lus\"><span>Balance <b>{balance}</b></span><span>Used <b>{spent}</b></span></div><div class=\"lb\">{packButtons}</div>";
    }
}
