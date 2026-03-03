'use strict';

/**
 * Parses Markdown content to extract all links.
 *
 * Supports:
 * - Inline links: [text](url)
 * - Image inline: ![alt](url)
 * - Reference-style links: [text][ref] with [ref]: url definitions
 * - Autolinks: <https://example.com>
 * - Anchor-only: #section
 */

/**
 * @typedef {Object} ParsedLink
 * @property {string} url - The resolved URL or path
 * @property {number} line - 1-based line number where the link appears
 * @property {string} text - The link text or alt text
 * @property {boolean} isAnchorOnly - True if the link is anchor-only (#section)
 * @property {boolean} isImage - True if this is an image link
 */

/**
 * Extract all links from Markdown content.
 * @param {string} content - Markdown file content
 * @param {string} filePath - Absolute path to the file (for context)
 * @returns {ParsedLink[]}
 */
function parseLinks(content, filePath) {
  const links = [];
  const lines = content.split('\n');

  // Collect reference definitions: [ref]: url "optional title"
  const refMap = {};
  const refDefRegex = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+"[^"]*")?/;
  for (const line of lines) {
    const m = refDefRegex.exec(line);
    if (m) {
      refMap[m[1].toLowerCase()] = m[2];
    }
  }

  // Track which URLs we've added per line to avoid duplicates from multiple passes
  const seen = new Set();

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const line = lines[lineIdx];

    // Skip reference definition lines themselves
    if (refDefRegex.test(line)) {
      continue;
    }

    // 1. Inline image links: ![alt](url)
    const imageInlineRegex = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
    let m;
    while ((m = imageInlineRegex.exec(line)) !== null) {
      const url = m[2];
      const text = m[1];
      const key = `${lineNum}:${url}:image:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({
          url,
          line: lineNum,
          text,
          isAnchorOnly: url.startsWith('#'),
          isImage: true,
        });
      }
    }

    // 2. Inline links: [text](url) — must not be preceded by !
    const inlineLinkRegex = /(?<!!)\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
    while ((m = inlineLinkRegex.exec(line)) !== null) {
      const url = m[2];
      const text = m[1];
      const key = `${lineNum}:${url}:link:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({
          url,
          line: lineNum,
          text,
          isAnchorOnly: url.startsWith('#'),
          isImage: false,
        });
      }
    }

    // 3. Reference-style image links: ![alt][ref]
    const imageRefRegex = /!\[([^\]]*)\]\[([^\]]*)\]/g;
    while ((m = imageRefRegex.exec(line)) !== null) {
      const refKey = (m[2] || m[1]).toLowerCase();
      const url = refMap[refKey];
      if (url) {
        const text = m[1];
        const key = `${lineNum}:${url}:image:${text}`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({
            url,
            line: lineNum,
            text,
            isAnchorOnly: url.startsWith('#'),
            isImage: true,
          });
        }
      }
    }

    // 4. Reference-style links: [text][ref] or [text][]
    const refLinkRegex = /(?<!!)\[([^\]]+)\]\[([^\]]*)\]/g;
    while ((m = refLinkRegex.exec(line)) !== null) {
      const refKey = (m[2] || m[1]).toLowerCase();
      const url = refMap[refKey];
      if (url) {
        const text = m[1];
        const key = `${lineNum}:${url}:link:${text}`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({
            url,
            line: lineNum,
            text,
            isAnchorOnly: url.startsWith('#'),
            isImage: false,
          });
        }
      }
    }

    // 5. Autolinks: <https://...> or <http://...>
    const autolinkRegex = /<(https?:\/\/[^>]+)>/g;
    while ((m = autolinkRegex.exec(line)) !== null) {
      const url = m[1];
      const key = `${lineNum}:${url}:link:${url}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({
          url,
          line: lineNum,
          text: url,
          isAnchorOnly: false,
          isImage: false,
        });
      }
    }
  }

  return links;
}

module.exports = { parseLinks };
