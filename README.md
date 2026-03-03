# md-link-checker

A zero-dependency CLI tool to check links in Markdown files. Validates both HTTP/HTTPS links and local file references.

## Features

- Checks inline links, reference-style links, autolinks, and image links
- Validates HTTP/HTTPS links with HEAD requests (GET fallback on 405)
- Follows redirects (up to 5 hops)
- Checks local file references relative to each Markdown file
- Concurrent link checking with configurable pool size
- URL caching to avoid duplicate requests
- Pretty colored output (auto-detects TTY) or JSON output
- Recursive directory scanning with glob-based ignore patterns
- Zero runtime dependencies (Node.js 18+ built-ins only)

## Installation

```bash
npm install -g md-link-checker
```

Or run directly with npx:

```bash
npx md-link-checker README.md
```

## Usage

```
md-link-checker [options] <file|directory> [<file|directory> ...]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--timeout <ms>` | HTTP request timeout in milliseconds | `5000` |
| `--concurrency <n>` | Maximum parallel HTTP requests | `5` |
| `--ignore <pattern>` | Glob pattern to ignore (repeatable) | — |
| `--no-external` | Skip external HTTP/HTTPS links | — |
| `--no-local` | Skip local file links | — |
| `--json` | Output results as JSON | — |
| `--quiet` | Only show broken links | — |
| `--color` | Force color output | — |
| `--no-color` | Disable color output | — |
| `--help` | Show help message | — |
| `--version` | Show version number | — |

## Examples

Check a single file:
```bash
md-link-checker README.md
```

Check all Markdown files in a directory:
```bash
md-link-checker docs/
```

Check with longer timeout and higher concurrency:
```bash
md-link-checker --timeout 10000 --concurrency 10 docs/
```

Ignore patterns:
```bash
md-link-checker --ignore "node_modules/*" --ignore "*.draft.md" docs/
```

JSON output (useful for scripting):
```bash
md-link-checker --json README.md
md-link-checker --json docs/ | jq '.broken'
```

Only check external links:
```bash
md-link-checker --no-local docs/
```

Only check local file links:
```bash
md-link-checker --no-external docs/
```

Quiet mode (only show broken links, useful in CI):
```bash
md-link-checker --quiet --no-color docs/
```

## Output

### Pretty mode (default)

```
/path/to/docs/README.md
  V https://example.com [200] — line 5 "Example"
  X https://broken-link.com (Connection refused) — line 12 "Broken"
  ? #section — line 20 "Jump to section"

Summary: 1 ok, 1 broken, 1 skipped
```

- `V` (green) — link is reachable (HTTP 200-399)
- `X` (red) — link is broken (HTTP 4xx/5xx or file not found)
- `?` (yellow) — link was skipped (anchor-only, or filtered by --no-external/--no-local)

### JSON mode

```json
{
  "files": 1,
  "links": 3,
  "ok": 1,
  "broken": 1,
  "skipped": 1,
  "results": [
    {
      "file": "/path/to/README.md",
      "url": "https://example.com",
      "line": 5,
      "text": "Example",
      "status": "ok",
      "statusCode": 200,
      "error": null,
      "isImage": false
    }
  ]
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All links OK (or none found) |
| `1` | One or more broken links found |
| `2` | Fatal error (bad arguments, no files found, etc.) |

## Development

```bash
# Run tests
npm test

# Test the CLI
node bin/md-link-checker.js README.md
```

## License

MIT
