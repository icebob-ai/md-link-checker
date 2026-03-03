# md-link-checker

Zero-dependency Node.js CLI tool for checking links in Markdown files.

## Build & Test
- `npm test` — run all tests (uses Node.js built-in test runner)
- No build step needed

## Architecture
- `bin/md-link-checker.js` — CLI entry point
- `lib/parser.js` — extracts links from Markdown content
- `lib/checker.js` — validates HTTP and local file links
- `lib/reporter.js` — formats output (pretty/JSON)
- `lib/scanner.js` — directory traversal for .md files
