'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_CONCURRENCY = 5;
const USER_AGENT = 'md-link-checker/1.0';

/**
 * @typedef {Object} CheckResult
 * @property {string} url
 * @property {'ok'|'broken'|'skipped'} status
 * @property {number|null} statusCode
 * @property {string|null} error
 */

/**
 * Make an HTTP/HTTPS request and return a promise resolving to the response status code.
 * Follows redirects up to MAX_REDIRECTS hops.
 * @param {string} url
 * @param {string} method - 'HEAD' or 'GET'
 * @param {number} timeout - timeout in ms
 * @param {number} [redirectCount]
 * @returns {Promise<{statusCode: number}>}
 */
function makeRequest(url, method, timeout, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${url}`));
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'User-Agent': USER_AGENT,
      },
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    }, timeout);

    const req = transport.request(options, (res) => {
      clearTimeout(timer);

      // Consume the response body to free the socket
      res.resume();

      const { statusCode } = res;

      // Handle redirects
      if (
        [301, 302, 307, 308].includes(statusCode) &&
        res.headers.location
      ) {
        if (redirectCount >= MAX_REDIRECTS) {
          return reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
        }
        // Resolve relative redirects against the current URL
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.location, url).href;
        } catch (e) {
          return reject(new Error(`Invalid redirect URL: ${res.headers.location}`));
        }
        return resolve(
          makeRequest(nextUrl, method, timeout, redirectCount + 1)
        );
      }

      resolve({ statusCode });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      if (!timedOut) {
        reject(err);
      }
    });

    req.end();
  });
}

/**
 * Check a single HTTP/HTTPS link.
 * Uses HEAD first, falls back to GET on 405 (Method Not Allowed) or 403 (Forbidden).
 * Note: 404 is NOT retried with GET — it genuinely means not found.
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<CheckResult>}
 */
async function checkHttpLink(url, timeout) {
  try {
    let result = await makeRequest(url, 'HEAD', timeout);
    if (result.statusCode === 405 || result.statusCode === 403) {
      // Method not allowed or forbidden on HEAD - fallback to GET
      result = await makeRequest(url, 'GET', timeout);
    }
    const statusCode = result.statusCode;
    const isOk = statusCode >= 200 && statusCode < 400;
    return {
      url,
      status: isOk ? 'ok' : 'broken',
      statusCode,
      error: null,
    };
  } catch (err) {
    return {
      url,
      status: 'broken',
      statusCode: null,
      error: err.message,
    };
  }
}

/**
 * Check a local file link.
 * @param {string} linkUrl - The raw link URL (relative path)
 * @param {string} markdownFilePath - Absolute path to the markdown file
 * @returns {CheckResult}
 */
function checkLocalLink(linkUrl, markdownFilePath) {
  // Strip fragment identifier for file existence check
  const urlWithoutFragment = linkUrl.split('#')[0];

  // If it's just a fragment (e.g., #section), skip
  if (!urlWithoutFragment) {
    return {
      url: linkUrl,
      status: 'skipped',
      statusCode: null,
      error: null,
    };
  }

  const dir = path.dirname(markdownFilePath);
  const resolved = path.resolve(dir, urlWithoutFragment);

  const exists = fs.existsSync(resolved);
  return {
    url: linkUrl,
    status: exists ? 'ok' : 'broken',
    statusCode: null,
    error: exists ? null : `File not found: ${resolved}`,
  };
}

/**
 * Check a single link.
 * @param {import('./parser').ParsedLink} link
 * @param {Object} options
 * @param {string} options.markdownFilePath - Absolute path to the markdown file
 * @param {number} [options.timeout]
 * @param {boolean} [options.noExternal] - Skip HTTP links
 * @param {boolean} [options.noLocal] - Skip local file links
 * @param {Map} [options.cache] - Shared URL→result cache
 * @returns {Promise<CheckResult>}
 */
async function checkLink(link, options = {}) {
  const { url, isAnchorOnly } = link;
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const cache = options.cache || new Map();

  // Anchor-only links are always skipped
  if (isAnchorOnly) {
    return { url, status: 'skipped', statusCode: null, error: null };
  }

  // Check cache
  if (cache.has(url)) {
    return cache.get(url);
  }

  let result;

  const isHttp = url.startsWith('http://') || url.startsWith('https://');

  if (isHttp) {
    if (options.noExternal) {
      result = { url, status: 'skipped', statusCode: null, error: null };
    } else {
      result = await checkHttpLink(url, timeout);
    }
  } else {
    if (options.noLocal) {
      result = { url, status: 'skipped', statusCode: null, error: null };
    } else {
      result = checkLocalLink(url, options.markdownFilePath);
    }
  }

  cache.set(url, result);
  return result;
}

/**
 * Check multiple links with a concurrency pool (semaphore pattern).
 * @param {import('./parser').ParsedLink[]} links
 * @param {Object} options
 * @param {string} options.markdownFilePath
 * @param {number} [options.timeout]
 * @param {number} [options.concurrency]
 * @param {boolean} [options.noExternal]
 * @param {boolean} [options.noLocal]
 * @param {Map} [options.cache]
 * @returns {Promise<CheckResult[]>}
 */
async function checkLinks(links, options = {}) {
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  const results = new Array(links.length);
  let index = 0;

  async function worker() {
    while (index < links.length) {
      const i = index++;
      results[i] = await checkLink(links[i], options);
    }
  }

  // Launch N concurrent workers
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, links.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

module.exports = { checkLink, checkLinks };
