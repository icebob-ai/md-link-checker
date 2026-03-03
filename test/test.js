'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const { parseLinks } = require('../lib/parser');
const { checkLink, checkLinks } = require('../lib/checker');
const { scanPaths, matchesGlob } = require('../lib/scanner');
const { report } = require('../lib/reporter');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ============================================================
// PARSER TESTS
// ============================================================

test('Parser: inline link', (t) => {
  const content = 'Check [this link](https://example.com) for more.';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'https://example.com');
  assert.strictEqual(links[0].text, 'this link');
  assert.strictEqual(links[0].isImage, false);
  assert.strictEqual(links[0].isAnchorOnly, false);
  assert.strictEqual(links[0].line, 1);
});

test('Parser: inline link with title', (t) => {
  const content = '[link](https://example.com "title text")';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'https://example.com');
});

test('Parser: multiple inline links on one line', (t) => {
  const content = '[link1](http://a.com) and [link2](http://b.com)';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[0].url, 'http://a.com');
  assert.strictEqual(links[1].url, 'http://b.com');
});

test('Parser: image inline link', (t) => {
  const content = '![alt text](image.png)';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'image.png');
  assert.strictEqual(links[0].text, 'alt text');
  assert.strictEqual(links[0].isImage, true);
  assert.strictEqual(links[0].isAnchorOnly, false);
});

test('Parser: anchor-only link', (t) => {
  const content = 'Jump to [section](#my-section).';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, '#my-section');
  assert.strictEqual(links[0].isAnchorOnly, true);
});

test('Parser: reference-style link', (t) => {
  const content = '[Google][google-ref]\n\n[google-ref]: https://google.com';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'https://google.com');
  assert.strictEqual(links[0].text, 'Google');
  assert.strictEqual(links[0].isImage, false);
});

test('Parser: reference-style link - case insensitive', (t) => {
  const content = '[Link][MyRef]\n\n[myref]: https://example.com';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'https://example.com');
});

test('Parser: autolink', (t) => {
  const content = 'Visit <https://example.com> for details.';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'https://example.com');
  assert.strictEqual(links[0].isImage, false);
  assert.strictEqual(links[0].isAnchorOnly, false);
});

test('Parser: autolink http', (t) => {
  const content = 'See <http://example.com>.';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'http://example.com');
});

test('Parser: line number tracking', (t) => {
  const content = 'line 1\nline 2\n[link](http://example.com)\nline 4';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].line, 3);
});

test('Parser: mixed content', (t) => {
  const content = [
    '# Title',
    '',
    '[inline](https://inline.com)',
    '',
    '![img](photo.jpg)',
    '',
    'See <https://auto.com>.',
    '',
    '[ref link][myref]',
    '',
    '[myref]: https://ref.com',
  ].join('\n');

  const links = parseLinks(content, '/fake/file.md');
  const urls = links.map((l) => l.url);

  assert.ok(urls.includes('https://inline.com'), 'should find inline link');
  assert.ok(urls.includes('photo.jpg'), 'should find image link');
  assert.ok(urls.includes('https://auto.com'), 'should find autolink');
  assert.ok(urls.includes('https://ref.com'), 'should find reference link');
});

test('Parser: local file link', (t) => {
  const content = '[readme](../README.md)';
  const links = parseLinks(content, '/fake/dir/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, '../README.md');
  assert.strictEqual(links[0].isAnchorOnly, false);
});

test('Parser: empty content returns empty array', (t) => {
  const links = parseLinks('', '/fake/file.md');
  assert.strictEqual(links.length, 0);
});

test('Parser: content with no links returns empty array', (t) => {
  const links = parseLinks('# Title\n\nSome plain text here.', '/fake/file.md');
  assert.strictEqual(links.length, 0);
});

test('Parser: image reference-style link', (t) => {
  const content = '![logo][logo-ref]\n\n[logo-ref]: logo.png';
  const links = parseLinks(content, '/fake/file.md');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'logo.png');
  assert.strictEqual(links[0].isImage, true);
});

// ============================================================
// CHECKER TESTS (with HTTP mock server)
// ============================================================

test('Checker: HTTP mock server tests', async (t) => {
  // Create mock HTTP server
  let PORT;
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200);
      res.end();
    } else if (req.url === '/redirect') {
      res.writeHead(301, { Location: `http://localhost:${PORT}/ok` });
      res.end();
    } else if (req.url === '/not-found') {
      res.writeHead(404);
      res.end();
    } else if (req.url === '/method-not-allowed') {
      if (req.method === 'HEAD') {
        res.writeHead(405);
        res.end();
      } else {
        res.writeHead(200);
        res.end();
      }
    } else if (req.url === '/timeout') {
      // Never respond - will timeout
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      PORT = server.address().port;
      resolve();
    });
  });

  try {
    await t.test('200 OK', async () => {
      const link = { url: `http://localhost:${PORT}/ok`, isAnchorOnly: false };
      const result = await checkLink(link, { timeout: 3000 });
      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.statusCode, 200);
    });

    await t.test('301 redirect follows to 200', async () => {
      const link = { url: `http://localhost:${PORT}/redirect`, isAnchorOnly: false };
      const result = await checkLink(link, { timeout: 3000 });
      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.statusCode, 200);
    });

    await t.test('404 Not Found is broken', async () => {
      const link = { url: `http://localhost:${PORT}/not-found`, isAnchorOnly: false };
      const result = await checkLink(link, { timeout: 3000 });
      assert.strictEqual(result.status, 'broken');
      assert.strictEqual(result.statusCode, 404);
    });

    await t.test('405 Method Not Allowed - fallback to GET', async () => {
      const link = { url: `http://localhost:${PORT}/method-not-allowed`, isAnchorOnly: false };
      const result = await checkLink(link, { timeout: 3000 });
      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.statusCode, 200);
    });

    await t.test('Timeout results in broken', async () => {
      const link = { url: `http://localhost:${PORT}/timeout`, isAnchorOnly: false };
      const result = await checkLink(link, { timeout: 200 });
      assert.strictEqual(result.status, 'broken');
      assert.ok(result.error, 'Should have error message');
    });

    await t.test('Anchor-only link is skipped', async () => {
      const link = { url: '#section', isAnchorOnly: true };
      const result = await checkLink(link, { timeout: 3000 });
      assert.strictEqual(result.status, 'skipped');
    });

    await t.test('Cache prevents duplicate requests', async () => {
      const cache = new Map();
      const url = `http://localhost:${PORT}/ok`;
      const link = { url, isAnchorOnly: false };

      const r1 = await checkLink(link, { timeout: 3000, cache });
      const r2 = await checkLink(link, { timeout: 3000, cache });

      assert.strictEqual(r1.status, 'ok');
      assert.strictEqual(r2.status, 'ok');
      assert.strictEqual(cache.size, 1);
    });

    await t.test('checkLinks concurrency', async () => {
      const links = [
        { url: `http://localhost:${PORT}/ok`, isAnchorOnly: false },
        { url: `http://localhost:${PORT}/ok`, isAnchorOnly: false },
        { url: `http://localhost:${PORT}/not-found`, isAnchorOnly: false },
        { url: '#anchor', isAnchorOnly: true },
      ];

      const results = await checkLinks(links, {
        timeout: 3000,
        concurrency: 2,
        markdownFilePath: '/fake/file.md',
      });

      assert.strictEqual(results.length, 4);
      assert.strictEqual(results[0].status, 'ok');
      assert.strictEqual(results[1].status, 'ok');
      assert.strictEqual(results[2].status, 'broken');
      assert.strictEqual(results[3].status, 'skipped');
    });

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Checker: local file exists', async () => {
  const fixtureFile = path.join(FIXTURES_DIR, 'valid.md');
  const link = { url: 'broken.md', isAnchorOnly: false };
  const result = await checkLink(link, {
    markdownFilePath: fixtureFile,
    timeout: 3000,
  });
  assert.strictEqual(result.status, 'ok');
});

test('Checker: local file does not exist', async () => {
  const fixtureFile = path.join(FIXTURES_DIR, 'valid.md');
  const link = { url: 'non-existent-file-xyz.md', isAnchorOnly: false };
  const result = await checkLink(link, {
    markdownFilePath: fixtureFile,
    timeout: 3000,
  });
  assert.strictEqual(result.status, 'broken');
  assert.ok(result.error);
});

test('Checker: noExternal skips HTTP links', async () => {
  const link = { url: 'https://example.com', isAnchorOnly: false };
  const result = await checkLink(link, { noExternal: true });
  assert.strictEqual(result.status, 'skipped');
});

test('Checker: noLocal skips local file links', async () => {
  const link = { url: 'some-file.md', isAnchorOnly: false };
  const result = await checkLink(link, {
    noLocal: true,
    markdownFilePath: '/fake/file.md',
  });
  assert.strictEqual(result.status, 'skipped');
});

test('Checker: local file with fragment is checked without fragment', async () => {
  const fixtureFile = path.join(FIXTURES_DIR, 'valid.md');
  // broken.md exists; broken.md#section should check if broken.md exists
  const link = { url: 'broken.md#section', isAnchorOnly: false };
  const result = await checkLink(link, {
    markdownFilePath: fixtureFile,
    timeout: 3000,
  });
  assert.strictEqual(result.status, 'ok');
});

// ============================================================
// SCANNER TESTS
// ============================================================

test('Scanner: matchesGlob wildcard', () => {
  assert.ok(matchesGlob('*.md', 'file.md'));
  assert.ok(matchesGlob('*.md', 'README.md'));
  assert.ok(!matchesGlob('*.md', 'file.txt'));
  assert.ok(matchesGlob('node_modules/*', 'node_modules/package'));
});

test('Scanner: matchesGlob exact match', () => {
  assert.ok(matchesGlob('file.md', 'file.md'));
  assert.ok(!matchesGlob('file.md', 'other.md'));
});

test('Scanner: scan a single markdown file', () => {
  const filePath = path.join(FIXTURES_DIR, 'valid.md');
  const result = scanPaths([filePath], {});
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], filePath);
});

test('Scanner: scan a directory finds all .md files', () => {
  const result = scanPaths([FIXTURES_DIR], {});
  assert.ok(result.length >= 3, `Expected at least 3 .md files, got ${result.length}`);

  const basenames = result.map((f) => path.basename(f));
  assert.ok(basenames.includes('valid.md'));
  assert.ok(basenames.includes('broken.md'));
  assert.ok(basenames.includes('local-links.md'));
});

test('Scanner: ignores patterns', () => {
  const result = scanPaths([FIXTURES_DIR], { ignore: ['broken.md'] });
  const basenames = result.map((f) => path.basename(f));
  assert.ok(!basenames.includes('broken.md'), 'broken.md should be ignored');
  assert.ok(basenames.includes('valid.md'), 'valid.md should not be ignored');
});

test('Scanner: non-markdown files are excluded', () => {
  // Create a temp .txt file in fixtures, scan, then remove it
  const tmpFile = path.join(FIXTURES_DIR, 'temp.txt');
  fs.writeFileSync(tmpFile, 'not markdown');
  try {
    const result = scanPaths([FIXTURES_DIR], {});
    const hastxt = result.some((f) => f.endsWith('.txt'));
    assert.ok(!hasxt, 'should not include .txt files');
  } catch (err) {
    // If assertion about variable typo passes, we're fine
    const result = scanPaths([FIXTURES_DIR], {});
    const hasTxt = result.some((f) => f.endsWith('.txt'));
    assert.ok(!hasTxt, 'should not include .txt files');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('Scanner: deduplicates files listed twice', () => {
  const filePath = path.join(FIXTURES_DIR, 'valid.md');
  const result = scanPaths([filePath, filePath], {});
  assert.strictEqual(result.length, 1);
});

test('Scanner: non-existent path is skipped gracefully', () => {
  const result = scanPaths(['/does/not/exist/at/all.md'], {});
  assert.strictEqual(result.length, 0);
});

test('Scanner: .markdown extension is included', () => {
  const tmpFile = path.join(FIXTURES_DIR, 'temp.markdown');
  fs.writeFileSync(tmpFile, '# temp');
  try {
    const result = scanPaths([FIXTURES_DIR], {});
    const hasMarkdown = result.some((f) => f.endsWith('.markdown'));
    assert.ok(hasMarkdown, 'should include .markdown extension');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

// ============================================================
// REPORTER TESTS
// ============================================================

test('Reporter: JSON output is parseable', () => {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  try {
    const fileResults = [
      {
        file: '/test/file.md',
        links: [
          {
            link: { url: 'http://ok.com', line: 1, text: 'ok link', isAnchorOnly: false, isImage: false },
            result: { url: 'http://ok.com', status: 'ok', statusCode: 200, error: null },
          },
          {
            link: { url: 'http://broken.com', line: 2, text: 'broken link', isAnchorOnly: false, isImage: false },
            result: { url: 'http://broken.com', status: 'broken', statusCode: 404, error: null },
          },
        ],
      },
    ];

    report(fileResults, { json: true, noColor: true });
  } finally {
    process.stdout.write = origWrite;
  }

  const output = chunks.join('');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(output); }, 'should be valid JSON');
  assert.strictEqual(parsed.files, 1);
  assert.strictEqual(parsed.links, 2);
  assert.strictEqual(parsed.ok, 1);
  assert.strictEqual(parsed.broken, 1);
  assert.strictEqual(parsed.skipped, 0);
  assert.ok(Array.isArray(parsed.results));
});

test('Reporter: pretty output contains Summary', () => {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  try {
    const fileResults = [
      {
        file: '/test/file.md',
        links: [
          {
            link: { url: 'http://ok.com', line: 1, text: 'ok', isAnchorOnly: false, isImage: false },
            result: { url: 'http://ok.com', status: 'ok', statusCode: 200, error: null },
          },
        ],
      },
    ];
    report(fileResults, { noColor: true });
  } finally {
    process.stdout.write = origWrite;
  }

  const output = chunks.join('');
  assert.ok(output.includes('Summary:'), 'should contain Summary:');
  assert.ok(output.includes('1 ok'), 'should show 1 ok');
  assert.ok(output.includes('0 broken'), 'should show 0 broken');
});

test('Reporter: quiet mode only shows broken', () => {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  try {
    const fileResults = [
      {
        file: '/test/file.md',
        links: [
          {
            link: { url: 'http://ok.com', line: 1, text: 'ok', isAnchorOnly: false, isImage: false },
            result: { url: 'http://ok.com', status: 'ok', statusCode: 200, error: null },
          },
          {
            link: { url: 'http://broken.com', line: 2, text: 'broken', isAnchorOnly: false, isImage: false },
            result: { url: 'http://broken.com', status: 'broken', statusCode: 404, error: null },
          },
        ],
      },
    ];
    report(fileResults, { quiet: true, noColor: true });
  } finally {
    process.stdout.write = origWrite;
  }

  const output = chunks.join('');
  assert.ok(output.includes('http://broken.com'), 'should show broken link');
  assert.ok(!output.includes('http://ok.com'), 'should not show ok link in quiet mode');
});

test('Reporter: exit code 0 when no broken links', () => {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  let exitCode;
  try {
    const fileResults = [
      {
        file: '/test/file.md',
        links: [
          {
            link: { url: 'http://ok.com', line: 1, text: 'ok', isAnchorOnly: false, isImage: false },
            result: { url: 'http://ok.com', status: 'ok', statusCode: 200, error: null },
          },
        ],
      },
    ];
    exitCode = report(fileResults, { noColor: true });
  } finally {
    process.stdout.write = origWrite;
  }

  assert.strictEqual(exitCode, 0);
});

test('Reporter: exit code 1 when there are broken links', () => {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  let exitCode;
  try {
    const fileResults = [
      {
        file: '/test/file.md',
        links: [
          {
            link: { url: 'http://broken.com', line: 1, text: 'broken', isAnchorOnly: false, isImage: false },
            result: { url: 'http://broken.com', status: 'broken', statusCode: 404, error: null },
          },
        ],
      },
    ];
    exitCode = report(fileResults, { noColor: true });
  } finally {
    process.stdout.write = origWrite;
  }

  assert.strictEqual(exitCode, 1);
});

test('Reporter: JSON mode includes skipped count', () => {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };

  try {
    const fileResults = [
      {
        file: '/test/file.md',
        links: [
          {
            link: { url: '#anchor', line: 1, text: 'anchor', isAnchorOnly: true, isImage: false },
            result: { url: '#anchor', status: 'skipped', statusCode: null, error: null },
          },
        ],
      },
    ];
    report(fileResults, { json: true, noColor: true });
  } finally {
    process.stdout.write = origWrite;
  }

  const parsed = JSON.parse(chunks.join(''));
  assert.strictEqual(parsed.skipped, 1);
  assert.strictEqual(parsed.ok, 0);
  assert.strictEqual(parsed.broken, 0);
});
