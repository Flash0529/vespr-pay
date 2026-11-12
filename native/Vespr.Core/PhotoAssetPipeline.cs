using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Vespr.Core;

/// <summary>
/// Photo asset ingestion pipeline, intelligent photo filename normalization,
/// paired descriptive metadata generation (.meta.json), and deep search indexing.
/// Port of app/photo-asset-pipeline.js.
/// </summary>
public static class PhotoAssetPipeline
{
    public const int DefaultWidth = 1200;
    public const int DefaultHeight = 800;

    public static readonly string[] ValidImageExts = ["png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "bmp"];

    public static readonly HashSet<string> SemanticPhotoKeywords = new(StringComparer.OrdinalIgnoreCase)
    {
        "architecture", "diagram", "flow", "schema", "user", "profile", "avatar",
        "logo", "banner", "header", "footer", "nav", "sidebar", "button", "icon",
        "favicon", "card", "mockup", "wireframe", "preview", "thumb", "thumbnail",
        "graph", "chart", "spec", "hero", "splash", "login", "signup", "checkout",
        "cart", "payment", "settings", "modal", "dialog", "layout", "background",
        "pattern", "badge", "illustration", "cover", "branding", "auth", "dashboard",
        "metrics", "analytics", "pipeline", "workflow", "state", "theme", "dark", "light"
    };

    public static readonly Dictionary<string, string> ExtToMime = new(StringComparer.Ordinal)
    {
        ["png"] = "image/png",
        ["jpg"] = "image/jpeg",
        ["jpeg"] = "image/jpeg",
        ["webp"] = "image/webp",
        ["svg"] = "image/svg+xml",
        ["gif"] = "image/gif",
        ["avif"] = "image/avif",
        ["bmp"] = "image/bmp"
    };

    public record PhotoMetadata(
        string AssetPath,
        string OriginalName,
        string Format,
        string MimeType,
        int Width,
        int Height,
        string AspectRatio,
        long SizeBytes,
        long CreatedAt,
        string Description,
        List<string> Tags,
        List<string> OcrTokens,
        List<string> SearchIndex
    );

    public record PhotoAssetItem(
        string Path,
        PhotoMetadata? Meta = null
    );

    public record PhotoSearchResult(
        string AssetPath,
        int Score,
        List<string> MatchedTerms,
        PhotoMetadata Meta
    );

    public record PhotoMetaOptions(
        string? OriginalName = null,
        int Width = DefaultWidth,
        int Height = DefaultHeight,
        long SizeBytes = 0,
        long? CreatedAt = null,
        string? Description = null,
        List<string>? Tags = null,
        List<string>? OcrTokens = null
    );

    public record ProcessedPhotoResult(
        string FinalName,
        bool Renamed,
        string OriginalName,
        string? SidecarPath,
        PhotoMetadata? Meta
    );

    public static string ExtOf(string? name)
    {
        if (string.IsNullOrEmpty(name)) return "";
        var m = Regex.Match(name, @"\.([A-Za-z0-9]{1,6})$");
        return m.Success ? m.Groups[1].Value.ToLowerInvariant() : "";
    }

    public static string Slugify(string? str)
    {
        if (string.IsNullOrEmpty(str)) return "";
        var normalized = str.Normalize(NormalizationForm.FormKD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            var uc = CharUnicodeInfo.GetUnicodeCategory(c);
            if (uc != UnicodeCategory.NonSpacingMark)
            {
                if (char.IsLetterOrDigit(c))
                {
                    sb.Append(char.ToLowerInvariant(c));
                }
                else
                {
                    sb.Append('-');
                }
            }
        }
        var cleaned = Regex.Replace(sb.ToString(), @"-+", "-").Trim('-');
        return cleaned.Length > 50 ? cleaned[..50] : cleaned;
    }

    private static string FormatDateTag(long ts)
    {
        var dt = DateTimeOffset.FromUnixTimeMilliseconds(ts).UtcDateTime;
        return dt.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);
    }

    public static bool IsDescriptiveImageName(string? fileName)
    {
        var raw = (fileName ?? "").Trim();
        if (string.IsNullOrEmpty(raw)) return false;

        var baseName = Regex.Replace(raw.Replace('\\', '/').Split('/').Last(), @"\.[A-Za-z0-9]{1,6}$", "").Trim();
        if (string.IsNullOrEmpty(baseName)) return false;

        var lower = baseName.ToLowerInvariant();

        // 1. Generic screenshot patterns
        if (Regex.IsMatch(lower, @"^screen[\s_-]*shot", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^capture[\s_-]*\d*$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^snip[\s_-]*\d*$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^schermopname", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^capture[\s_-]*d[\s_-]*e", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^bildschirmfoto", RegexOptions.IgnoreCase)) return false;

        // 2. Camera dumps
        if (Regex.IsMatch(lower, @"^img[\s_-]*\d+$", RegexOptions.IgnoreCase) || lower == "img") return false;
        if (Regex.IsMatch(lower, @"^dsc[n0-9]?[\s_-]*\d+$", RegexOptions.IgnoreCase) || lower == "dsc") return false;
        if (Regex.IsMatch(lower, @"^dcim[\s_-]*\d+$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^sam[\s_-]*\d+$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^p\d{6,}$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^cimg\d+$", RegexOptions.IgnoreCase)) return false;

        // 3. Generic paste or editor fragments
        if (Regex.IsMatch(lower, @"^pasted[\s_-]*image", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^(image|photo|pic|picture)[\s_-]*\d*$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^untitled[\s_-]*\d*$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^(clipboard|upload|file|temp|tmp|new|test)[\s_-]*\d*$", RegexOptions.IgnoreCase)) return false;

        // 4. UUID / Hex hashes / pure numeric timestamps
        if (Regex.IsMatch(lower, @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^[0-9a-f]{16,64}$", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(lower, @"^\d{6,}$")) return false;

        // 5. Tokenize
        var expanded = Regex.Replace(baseName, @"([a-z])([A-Z])", "$1 $2");
        var tokens = Regex.Split(expanded, @"[-_.\s]+")
            .Select(t => t.ToLowerInvariant())
            .Where(t => !string.IsNullOrEmpty(t))
            .ToList();

        if (tokens.Any(t => SemanticPhotoKeywords.Contains(t)))
        {
            return true;
        }

        var alphaWords = tokens.Where(t => Regex.IsMatch(t, @"^[a-z]{2,}$") && !Regex.IsMatch(t, @"^\d+$")).ToList();
        if (alphaWords.Count >= 2)
        {
            return true;
        }

        return false;
    }

    public static bool ShouldNormalizeImageName(string? fileName, bool autoNormalizeNames = true, bool avoidDescriptiveNames = true, string prefix = "asset-photo")
    {
        var raw = (fileName ?? "").Trim();
        if (string.IsNullOrEmpty(raw)) return false;
        if (!autoNormalizeNames) return false;

        var cleanPrefix = Slugify(prefix);
        if (string.IsNullOrEmpty(cleanPrefix)) cleanPrefix = "asset-photo";
        if (raw.ToLowerInvariant().StartsWith(cleanPrefix + "-", StringComparison.Ordinal)) return false;

        if (avoidDescriptiveNames && IsDescriptiveImageName(raw))
        {
            return false;
        }

        return true;
    }

    public static string NormalizePhotoName(string? originalName, long? timestamp = null, string prefix = "asset-photo", int sequence = 1)
    {
        var raw = (originalName ?? "").Trim();
        var ext = ExtOf(raw);
        if (Array.IndexOf(ValidImageExts, ext) < 0) ext = "png";

        var baseWithoutExt = Regex.Replace(raw, @"\.[A-Za-z0-9]{1,6}$", "");
        var hint = Slugify(baseWithoutExt);

        hint = Regex.Replace(hint, @"^screenshot[-_0-9a-z]*", "screenshot", RegexOptions.IgnoreCase);
        hint = Regex.Replace(hint, @"^screen[-_]shot[-_0-9a-z]*", "screenshot", RegexOptions.IgnoreCase);
        hint = Regex.Replace(hint, @"^img[-_0-9]*", "capture", RegexOptions.IgnoreCase);
        hint = Regex.Replace(hint, @"^pasted[-_]image[-_0-9]*", "pasted", RegexOptions.IgnoreCase);

        if (string.IsNullOrEmpty(hint) || hint is "image" or "photo") hint = "capture";

        var cleanPrefix = Slugify(prefix);
        if (string.IsNullOrEmpty(cleanPrefix)) cleanPrefix = "asset-photo";

        var ts = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var dateStr = FormatDateTag(ts);
        var seqStr = sequence > 1 ? $"-{sequence}" : "";

        return $"{cleanPrefix}-{dateStr}-{hint}{seqStr}.{ext}";
    }

    public static string FormatSidecarPath(string? photoPath, string format = "json")
    {
        var p = (photoPath ?? "").Replace('\\', '/');
        return format == "text" ? $"{p}.desc.txt" : $"{p}.meta.json";
    }

    private static int Gcd(int a, int b) => b == 0 ? a : Gcd(b, a % b);

    public static PhotoMetadata GeneratePairedMeta(string? photoPath, PhotoMetaOptions? options = null)
    {
        var p = (photoPath ?? "").Replace('\\', '/');
        var ext = ExtOf(p);
        if (string.IsNullOrEmpty(ext)) ext = "png";
        var mime = ExtToMime.TryGetValue(ext, out var m) ? m : "image/png";

        var width = Math.Max(1, options?.Width ?? DefaultWidth);
        var height = Math.Max(1, options?.Height ?? DefaultHeight);
        var sizeBytes = Math.Max(0, options?.SizeBytes ?? 0);

        var div = Gcd(width, height);
        var aspectRatio = $"{width / div}:{height / div}";

        var tags = (options?.Tags ?? [])
            .Select(Slugify)
            .Where(t => !string.IsNullOrEmpty(t))
            .Distinct()
            .Take(30)
            .ToList();

        var ocr = (options?.OcrTokens ?? [])
            .Select(t => t.Trim().ToLowerInvariant())
            .Where(t => !string.IsNullOrEmpty(t))
            .Distinct()
            .Take(100)
            .ToList();

        var fileName = p.Split('/').LastOrDefault() ?? "";
        var nameTokens = Regex.Replace(fileName, @"\.[A-Za-z0-9]+$", "")
            .Split(['-', '_'], StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.ToLowerInvariant())
            .ToList();

        var searchIndex = nameTokens.Concat(tags).Concat(ocr).Distinct().ToList();

        var originalName = options?.OriginalName ?? fileName;
        var description = options?.Description ?? "";
        var createdAt = options?.CreatedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        return new PhotoMetadata(
            p,
            originalName,
            ext,
            mime,
            width,
            height,
            aspectRatio,
            sizeBytes,
            createdAt,
            description,
            tags,
            ocr,
            searchIndex
        );
    }

    public static ProcessedPhotoResult ProcessIncomingPhoto(
        string? fileName,
        PhotoMetaOptions? metaOptions = null,
        bool autoNormalizeNames = true,
        bool avoidDescriptiveNames = true,
        bool generatePairedSidecar = true,
        string prefix = "asset-photo",
        string sidecarFormat = "json",
        long? timestamp = null)
    {
        var raw = (fileName ?? "").Trim();
        var shouldNorm = ShouldNormalizeImageName(raw, autoNormalizeNames, avoidDescriptiveNames, prefix);
        var finalName = shouldNorm ? NormalizePhotoName(raw, timestamp, prefix) : raw;
        var renamed = !string.Equals(finalName, raw, StringComparison.Ordinal);

        string? sidecarPath = null;
        PhotoMetadata? meta = null;

        if (generatePairedSidecar)
        {
            sidecarPath = FormatSidecarPath(finalName, sidecarFormat);
            var opt = new PhotoMetaOptions(
                OriginalName: raw,
                Width: metaOptions?.Width ?? DefaultWidth,
                Height: metaOptions?.Height ?? DefaultHeight,
                SizeBytes: metaOptions?.SizeBytes ?? 0,
                CreatedAt: metaOptions?.CreatedAt,
                Description: metaOptions?.Description,
                Tags: metaOptions?.Tags,
                OcrTokens: metaOptions?.OcrTokens
            );
            meta = GeneratePairedMeta(finalName, opt);
        }

        return new ProcessedPhotoResult(finalName, renamed, raw, sidecarPath, meta);
    }

    public static List<PhotoSearchResult> SearchPhotoAssets(string query, IEnumerable<PhotoAssetItem> assets)
    {
        var q = (query ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(q)) return [];

        var terms = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var results = new List<PhotoSearchResult>();

        foreach (var item in assets)
        {
            var meta = item.Meta ?? GeneratePairedMeta(item.Path);
            var path = (item.Path ?? meta.AssetPath).ToLowerInvariant();
            var desc = (meta.Description ?? "").ToLowerInvariant();

            int score = 0;
            var matched = new List<string>();

            foreach (var term in terms)
            {
                if (path.Contains(term, StringComparison.Ordinal))
                {
                    score += 10;
                    matched.Add(term);
                }
                else if (meta.Tags.Any(t => t.Contains(term, StringComparison.Ordinal)))
                {
                    score += 8;
                    matched.Add(term);
                }
                else if (desc.Contains(term, StringComparison.Ordinal))
                {
                    score += 5;
                    matched.Add(term);
                }
                else if (meta.OcrTokens.Any(o => o.Contains(term, StringComparison.Ordinal)))
                {
                    score += 4;
                    matched.Add(term);
                }
                else if (meta.SearchIndex.Any(i => i.Contains(term, StringComparison.Ordinal)))
                {
                    score += 2;
                    matched.Add(term);
                }
            }

            if (score > 0)
            {
                results.Add(new PhotoSearchResult(item.Path ?? meta.AssetPath, score, matched.Distinct().ToList(), meta));
            }
        }

        return results.OrderByDescending(r => r.Score).ToList();
    }
}
