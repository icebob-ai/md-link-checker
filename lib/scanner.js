'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Mini glob matcher that supports * and ** wildcards.
 * - `**` matches anything including directory separators (recursive)
 * - `*`  matches anything except directory separators
 * @param {string} pattern
 * @param {string} str
 * @returns {boolean}
 */
function matchesGlob(pattern, str) {
  // Normalize separators
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const normalizedStr = str.replace(/\\/g, '/');

  // If the pattern contains /, match against the full path
  // Otherwise, match against just the basename
  const subject = normalizedPattern.includes('/')
    ? normalizedStr
    : path.basename(normalizedStr);

  // Convert glob pattern to regex.
  // Process ** before *, to avoid double-escaping.
  // Escape all special regex chars first (except *), then replace ** and *.
  let regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (not *)
    .replace(/\*\*/g, '\x00')              // temporarily replace ** with placeholder
    .replace(/\*/g, '[^/]*')              // single * does not match /
    .replace(/\x00/g, '.*');             // ** matches everything including /

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(subject);
}

/**
 * Check if a file path matches any of the given ignore patterns.
 * @param {string} filePath
 * @param {string[]} ignorePatterns
 * @returns {boolean}
 */
function isIgnored(filePath, ignorePatterns) {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;
  return ignorePatterns.some((pattern) => matchesGlob(pattern, filePath));
}

/**
 * Recursively collect all .md and .markdown files from a directory.
 * @param {string} dir - Absolute directory path
 * @param {string[]} ignorePatterns
 * @returns {string[]}
 */
function collectMarkdownFiles(dir, ignorePatterns) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    if (isIgnored(fullPath, ignorePatterns)) {
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (err) {
      continue;
    }

    if (stat.isDirectory()) {
      const nested = collectMarkdownFiles(fullPath, ignorePatterns);
      results.push(...nested);
    } else if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase();
      if (ext === '.md' || ext === '.markdown') {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Scan a list of paths (files and/or directories) and return all markdown file paths.
 * @param {string[]} paths - File or directory paths to scan
 * @param {Object} [options]
 * @param {string[]} [options.ignore] - Glob patterns to ignore
 * @returns {string[]} List of absolute markdown file paths
 */
function scanPaths(paths, options = {}) {
  const ignorePatterns = options.ignore || [];
  const results = [];
  const seen = new Set();

  for (const inputPath of paths) {
    const absPath = path.resolve(inputPath);

    if (isIgnored(absPath, ignorePatterns)) {
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch (err) {
      // Path doesn't exist - skip silently
      continue;
    }

    if (stat.isDirectory()) {
      const files = collectMarkdownFiles(absPath, ignorePatterns);
      for (const f of files) {
        if (!seen.has(f)) {
          seen.add(f);
          results.push(f);
        }
      }
    } else if (stat.isFile()) {
      const ext = path.extname(absPath).toLowerCase();
      if ((ext === '.md' || ext === '.markdown') && !seen.has(absPath)) {
        seen.add(absPath);
        results.push(absPath);
      }
    }
  }

  return results;
}

module.exports = { scanPaths, matchesGlob };
