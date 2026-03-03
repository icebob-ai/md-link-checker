'use strict';

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

/**
 * Determine if color output should be used.
 * Respects --color / --no-color flags, then falls back to TTY detection.
 * @param {Object} options
 * @param {boolean} [options.color]
 * @param {boolean} [options.noColor]
 * @returns {boolean}
 */
function shouldUseColor(options) {
  if (options.noColor) return false;
  if (options.color) return true;
  return !!process.stdout.isTTY;
}

/**
 * @typedef {Object} FileResult
 * @property {string} file - Absolute file path
 * @property {Array<{link: import('./parser').ParsedLink, result: import('./checker').CheckResult}>} links
 */

/**
 * Format and output results.
 * @param {FileResult[]} fileResults
 * @param {Object} options
 * @param {boolean} [options.json] - JSON output mode
 * @param {boolean} [options.quiet] - Only show broken links
 * @param {boolean} [options.color]
 * @param {boolean} [options.noColor]
 * @returns {number} Exit code: 0 (all ok), 1 (has broken), 2 (error)
 */
function report(fileResults, options = {}) {
  const useColor = shouldUseColor(options);
  const c = useColor ? COLORS : {};

  // Flatten all link results for summary
  let totalLinks = 0;
  let okCount = 0;
  let brokenCount = 0;
  let skippedCount = 0;

  const allResults = [];

  for (const fileResult of fileResults) {
    for (const { link, result } of fileResult.links) {
      totalLinks++;
      if (result.status === 'ok') okCount++;
      else if (result.status === 'broken') brokenCount++;
      else if (result.status === 'skipped') skippedCount++;

      allResults.push({
        file: fileResult.file,
        url: result.url,
        line: link.line,
        text: link.text,
        status: result.status,
        statusCode: result.statusCode,
        error: result.error,
        isImage: link.isImage,
      });
    }
  }

  if (options.json) {
    const output = {
      files: fileResults.length,
      links: totalLinks,
      ok: okCount,
      broken: brokenCount,
      skipped: skippedCount,
      results: allResults,
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return brokenCount > 0 ? 1 : 0;
  }

  // Pretty print mode
  for (const fileResult of fileResults) {
    if (fileResult.links.length === 0) continue;

    // File header
    const hasbroken = fileResult.links.some((l) => l.result.status === 'broken');
    if (options.quiet && !hasbroken) continue;

    const fileHeader = `${c.bold || ''}${c.cyan || ''}${fileResult.file}${c.reset || ''}`;
    process.stdout.write('\n' + fileHeader + '\n');

    for (const { link, result } of fileResult.links) {
      if (options.quiet && result.status !== 'broken') continue;

      let icon, color;
      if (result.status === 'ok') {
        icon = 'V';
        color = c.green || '';
      } else if (result.status === 'broken') {
        icon = 'X';
        color = c.red || '';
      } else {
        icon = '?';
        color = c.yellow || '';
      }

      // Build status string
      let statusStr = '';
      if (result.statusCode) {
        statusStr = ` [${result.statusCode}]`;
      }
      if (result.error) {
        statusStr += ` (${result.error})`;
      }

      const lineInfo = `${c.dim || ''}line ${link.line}${c.reset || ''}`;
      const linkText = link.text ? ` "${link.text}"` : '';
      const imageTag = link.isImage ? ' [image]' : '';

      process.stdout.write(
        `  ${color}${icon}${c.reset || ''} ${result.url}${statusStr} — ${lineInfo}${linkText}${imageTag}\n`
      );
    }
  }

  // Summary line
  const summaryParts = [];
  summaryParts.push(`${c.green || ''}${okCount} ok${c.reset || ''}`);
  summaryParts.push(`${c.red || ''}${brokenCount} broken${c.reset || ''}`);
  summaryParts.push(`${c.yellow || ''}${skippedCount} skipped${c.reset || ''}`);

  process.stdout.write(
    `\n${c.bold || ''}Summary:${c.reset || ''} ${summaryParts.join(', ')}\n`
  );

  return brokenCount > 0 ? 1 : 0;
}

module.exports = { report, shouldUseColor };
