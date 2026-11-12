---
name: agent-reach
description: Read-only multi-platform content extractor for developer and web platforms. Reads posts, comments, subtitles, transcripts, and repository updates across GitHub, Reddit, YouTube, Twitter/X, and social networks with zero write operations and structured JSON output.
---
# Agent Reach — Read-Only Multi-Platform Extractor

Use this skill when reading, inspecting, or citing content from external platforms, code repositories, video subtitles, and developer communities without mutating user accounts or performing write operations.

## Security & Operational Boundaries

1. **Strictly Read-Only:**
   - Never post, comment, like, follow, star, or delete content.
   - Never ask for, transmit, or store passwords or authentication tokens in plain text.
   - Public content must always be fetched first using standard public web interfaces before requesting authenticated credentials.

2. **Structured Output Format:**
   - Standard output is formatted as clean JSON containing:
     ```json
     {
       "ok": true,
       "platform": "github",
       "action": "read",
       "items": [
         {
           "title": "Title of content",
           "url": "https://example.com/post/123",
           "author": "username",
           "published_at": "2026-10-28T12:00:00Z",
           "text": "Extracted text content..."
         }
       ]
     }
     ```

## Supported Platform Workflows

- **GitHub:** Read public repositories, pull requests, commit diffs, issues, and discussions.
- **YouTube:** Extract video metadata, closed captions, and timecoded transcripts.
- **Reddit & Developer Forums:** Read discussion threads, top-voted answers, and code snippets.
- **Social & News Platforms:** Read public post text and verified announcements.

## Error Handling & Rate Limiting

- `RATE_LIMITED`: Platform throttled requests. Respect `retry_after_seconds` without rapid retries.
- `NOT_FOUND`: Target resource missing or URL malformed. Verify link before re-running.
- `PLATFORM_BLOCKED`: Bot protection or captcha triggered. Stop execution and notify the user; do not attempt proxy cycling or evading platform defenses.

