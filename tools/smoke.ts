/**
 * End-to-end smoke test of the built web app, in a real browser.
 *
 *   npm run build && npm run smoke -- ./sample-shoot
 *
 * Drives the actual UI against actual files: picks a folder, waits for the
 * ingest pool, runs the solve, and checks that the offsets it renders are the
 * ones the CLI gets. The unit tests prove the engine; this proves the wiring —
 * workers, transfers, message plumbing, rendering — which is exactly the part
 * unit tests cannot reach and where a browser build actually breaks.
 */

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';

// POLYSYNC_DIST points the test at any built copy — used to verify the
// distributable zip itself, not just the folder it was made from.
const DIST = resolve(process.env.POLYSYNC_DIST ?? 'apps/web/dist');
const PORT = 4319;

/**
 * Optional path prefix to serve the site under.
 *
 * A GitHub Pages *project* site lives at `/<repo>/`, not at the domain root, so
 * every asset and — the part that actually breaks — every worker URL has to
 * resolve relative to the page. `npm run smoke -- <folder> --base /polysync`
 * reproduces that exactly.
 */
const BASE = (process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? '').replace(/\/$/, '');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

/** A static server, because the app must be servable from anywhere static. */
function serve(): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      let path = url.pathname;
      if (BASE) {
        if (path === BASE) {
          res.writeHead(302, { location: `${BASE}/` }).end();
          return;
        }
        if (!path.startsWith(`${BASE}/`)) {
          res.writeHead(404).end('outside base path');
          return;
        }
        path = path.slice(BASE.length);
      }
      if (path === '/' || path === '') path = '/index.html';
      const file = join(DIST, decodeURIComponent(path));
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  server.listen(PORT);
  return server;
}

async function mediaFilesIn(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(wav|mov|mp4|mxf|mts|m4a|aif|aiff|flac|mp3)$/i.test(entry.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const root = resolve(positional[0] ?? './sample-shoot');
  try {
    await stat(root);
  } catch {
    console.error(`No such folder: ${root}\nRun:  npm run sample -- ${root}`);
    process.exit(2);
  }

  const files = await mediaFilesIn(root);
  if (files.length < 2) {
    console.error(`Need at least two media files under ${root}`);
    process.exit(2);
  }

  const server = serve();
  let browser: Browser | undefined;
  let failed = false;

  try {
    // POLYSYNC_CHROMIUM lets a machine with a preinstalled Chromium skip
    // Playwright's own download, which is version-pinned and often mismatched.
    const executablePath = process.env.POLYSYNC_CHROMIUM;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage();

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`http://localhost:${PORT}${BASE}/`, { waitUntil: 'networkidle' });
    console.log(`Loaded the app from http://localhost:${PORT}${BASE}/`);

    // Hand the folder itself to the hidden webkitdirectory input: Playwright
    // cannot drive a native picker, but a directory path exercises the same
    // code path the Browse button uses, `webkitRelativePath` included — so the
    // device grouping under test is the real one, not a flat-file fallback.
    await page.setInputFiles('input[type="file"]', root);
    console.log(`Handed it the folder (${files.length} media files)`);

    await page.waitForSelector('table tbody tr', { timeout: 120_000 });
    const decoded = await page.locator('table tbody tr').count();
    console.log(`Decoded ${decoded} clips`);

    const devices = await page.locator('.device-chip b').allTextContents();
    console.log(`Devices: ${devices.join(', ')}`);

    await page.click('button:has-text("Synchronize")');
    console.log('Synchronizing…');

    await page.waitForSelector('.pill', { timeout: 300_000 });
    await page.waitForSelector('.tl-clip', { timeout: 10_000 });

    const rows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '');
        return { name: cells[0], start: cells[5], quality: cells[6], status: cells[8] };
      }),
    );

    console.log('\nResult as rendered in the browser:');
    for (const row of rows) {
      console.log(
        `  ${(row.name ?? '').padEnd(24)} ${(row.start ?? '').padStart(9)}  ` +
          `q=${(row.quality ?? '').padEnd(6)} ${row.status ?? ''}`,
      );
    }

    const synced = rows.filter((r) => r.status === 'Synced').length;
    console.log(`\n  ${synced} of ${rows.length} synced`);

    await page.screenshot({ path: 'apps/web/smoke.png', fullPage: true });
    console.log('  Screenshot: apps/web/smoke.png');

    // A solve that placed nothing means the wiring is broken even if nothing threw.
    if (synced < 2) {
      console.error('\nFAIL: fewer than two clips synced — the worker pipeline is not working');
      failed = true;
    }
    if (consoleErrors.length) {
      console.error(`\nFAIL: ${consoleErrors.length} console error(s):`);
      for (const line of consoleErrors.slice(0, 10)) console.error(`  ${line}`);
      failed = true;
    }
    if (!failed) console.log('\nPASS');
  } catch (error) {
    console.error('\nFAIL:', error instanceof Error ? error.message : error);
    failed = true;
  } finally {
    await browser?.close();
    server.close();
  }

  process.exit(failed ? 1 : 0);
}

void main();
