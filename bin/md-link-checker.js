#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scanPaths } = require('../lib/scanner');
const { parseLinks } = require('../lib/parser');
const { checkLinks } = require('../lib/checker');
const { report } = require('../lib/reporter');

const VERSION = '1.0.0';

const HELP = `
md-link-checker - Zero-dependency CLI tool to check links in Markdown files

USAGE
  md-link-checker [options] <file|directory> [<file|directory> ...]

OPTIONS
  --timeout <ms>       HTTP request timeout in milliseconds (default: 5000)
  --concurrency <n>    Maximum parallel requests (default: 5)
  --ignore <pattern>   Glob pattern to ignore (can be used multiple times)
  --no-external        Skip external HTTP/HTTPS links
  --no-local           Skip local file links
  --json               Output results as JSON
  --quiet              Only show broken links
  --color              Force color output
  --no-color           Disable color output
  --help               Show this help message
  --version            Show version number

EXAMPLES
  md-link-checker README.md
  md-link-checker docs/
  md-link-checker --timeout 10000 --concurrency 10 docs/
  md-link-checker --ignore "node_modules/*" --ignore "*.draft.md" docs/
  md-link-checker --json README.md | jq '.broken'
  md-link-checker --quiet --no-color docs/
`.trim();

/**
 * Parse process.argv into options and positional arguments.
 * @param {string[]} argv
 * @returns {{ options: Object, paths: string[] }}
 */
function parseArgs(argv) {
  const args = argv.slice(2); // remove node and script path
  const options = {
    timeout: 5000,
    concurrency: 5,
    ignore: [],
    noExternal: false,
    noLocal: false,
    json: false,
    quiet: false,
    color: false,
    noColor: false,
  };
  const paths = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP + '\n');
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      process.stdout.write(`md-link-checker ${VERSION}\n`);
      process.exit(0);
    } else if (arg === '--timeout') {
      i++;
      const val = parseInt(args[i], 10);
      if (isNaN(val) || val <= 0) {
        process.stderr.write(`Error: --timeout must be a positive integer\n`);
        process.exit(2);
      }
      options.timeout = val;
    } else if (arg.startsWith('--timeout=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (isNaN(val) || val <= 0) {
        process.stderr.write(`Error: --timeout must be a positive integer\n`);
        process.exit(2);
      }
      options.timeout = val;
    } else if (arg === '--concurrency') {
      i++;
      const val = parseInt(args[i], 10);
      if (isNaN(val) || val <= 0) {
        process.stderr.write(`Error: --concurrency must be a positive integer\n`);
        process.exit(2);
      }
      options.concurrency = val;
    } else if (arg.startsWith('--concurrency=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (isNaN(val) || val <= 0) {
        process.stderr.write(`Error: --concurrency must be a positive integer\n`);
        process.exit(2);
      }
      options.concurrency = val;
    } else if (arg === '--ignore') {
      i++;
      if (i >= args.length) {
        process.stderr.write(`Error: --ignore requires a pattern argument\n`);
        process.exit(2);
      }
      options.ignore.push(args[i]);
    } else if (arg.startsWith('--ignore=')) {
      options.ignore.push(arg.split('=').slice(1).join('='));
    } else if (arg === '--no-external') {
      options.noExternal = true;
    } else if (arg === '--no-local') {
      options.noLocal = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--color') {
      options.color = true;
    } else if (arg === '--no-color') {
      options.noColor = true;
    } else if (arg.startsWith('--')) {
      process.stderr.write(`Error: Unknown option: ${arg}\n`);
      process.stderr.write(`Run md-link-checker --help for usage\n`);
      process.exit(2);
    } else {
      paths.push(arg);
    }

    i++;
  }

  return { options, paths };
}

async function main() {
  const { options, paths } = parseArgs(process.argv);

  if (paths.length === 0) {
    process.stderr.write('Error: No files or directories specified.\n\n');
    process.stderr.write(HELP + '\n');
    process.exit(2);
  }

  // 1. Scan paths for markdown files
  const markdownFiles = scanPaths(paths, { ignore: options.ignore });

  if (markdownFiles.length === 0) {
    process.stderr.write('Error: No Markdown files found in specified paths.\n');
    process.exit(2);
  }

  // 2. Shared cache across all files
  const cache = new Map();

  // 3. Process each file: parse + check
  const fileResults = [];

  for (const filePath of markdownFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write(`Warning: Could not read ${filePath}: ${err.message}\n`);
      continue;
    }

    const links = parseLinks(content, filePath);

    const results = await checkLinks(links, {
      markdownFilePath: filePath,
      timeout: options.timeout,
      concurrency: options.concurrency,
      noExternal: options.noExternal,
      noLocal: options.noLocal,
      cache,
    });

    fileResults.push({
      file: filePath,
      links: links.map((link, i) => ({ link, result: results[i] })),
    });
  }

  // 4. Report
  const exitCode = report(fileResults, {
    json: options.json,
    quiet: options.quiet,
    color: options.color,
    noColor: options.noColor,
  });

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  if (process.env.DEBUG) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(2);
});
