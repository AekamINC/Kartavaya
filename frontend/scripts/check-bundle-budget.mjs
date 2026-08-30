#!/usr/bin/env node
/**
 * check-bundle-budget.mjs — what the customer actually downloads, ratcheted.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * This product is sold to Indian firms and used on Indian mobile networks, and
 * nothing in the repository has ever measured how much JavaScript it ships.
 * There is no Lighthouse, no k6, no bundle analyser; `yarn build` reports its
 * own timings and throws the sizes away. So the only way a 300KB date library
 * or a second copy of a charting package would ever have been noticed is if
 * somebody happened to look at `dist/` by hand.
 *
 * A performance budget is the cheapest possible performance test: it is
 * deterministic, needs no browser, no network and no new dependency, and it
 * catches the regression that actually happens — an import, not a slow
 * algorithm.
 *
 * ── What it measures, and why BROTLI and not raw bytes ──────────────────────
 *
 * Raw file size is not what crosses the network. Vercel and Cloudflare Pages
 * both serve `content-encoding: br`, so the number a user waits for is the
 * brotli-compressed size — and the two do not move together: minified JS
 * compresses far better than an already-compressed asset, so a raw-byte budget
 * over-reports on code and under-reports on images. `node:zlib` has brotli
 * built in, so measuring the real thing costs nothing.
 *
 * Three budgets, because they fail for different reasons:
 *
 *   ENTRY   the chunk every visitor downloads before anything renders. The one
 *           that decides how long a cold load stares at nothing.
 *   CHUNK   the largest single lazy route. A page nobody can open quickly.
 *   TOTAL   every asset in `dist/`. Catches the slow accumulation that no
 *           single commit is responsible for.
 *
 * ── Ratchet, with headroom, and why the headroom is small ───────────────────
 *
 * Budgets are recorded from a real build and allowed to grow by
 * `TOLERANCE_PCT` before failing. A budget with no tolerance fails on
 * whitespace and gets deleted in a week; a budget with generous tolerance
 * absorbs a real regression silently. 5% is about one meaningful import.
 *
 * Re-record deliberately, never to go green:
 *     yarn build && node scripts/check-bundle-budget.mjs --write
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url);
const BASELINE_URL = new URL('bundle-budget-baseline.json', import.meta.url);
const TOLERANCE_PCT = 5;

const distPath = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (!existsSync(distPath)) {
  console.error('check-bundle-budget: no dist/ — run `yarn build` first.');
  console.error('This gate measures a BUILD, not source. Without one there is nothing to say.');
  process.exit(1);
}

/** Brotli at the quality a CDN actually serves, not the maximum. */
const br = (buf) =>
  brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk(distPath);

// ANTI-VACUITY. An empty or half-written dist/ would otherwise produce the best
// scores this gate can report. A real build of this app is hundreds of files.
if (files.length < 50) {
  console.error(`check-bundle-budget: dist/ holds only ${files.length} file(s).`);
  console.error('That is not a complete build, so a passing budget would be meaningless.');
  process.exit(1);
}

const js = files.filter((f) => extname(f) === '.js');
const sized = js.map((f) => ({ file: f.slice(distPath.length).replace(/\\/g, '/'), br: br(readFileSync(f)) }));
sized.sort((a, b) => b.br - a.br);

// The entry chunk is the one Vite names `index-*.js` and `index.html` loads
// directly. Match on the name rather than parsing the HTML: the hash changes
// every build, the prefix does not.
const entry = sized.find((s) => /(^|\/)assets\/index-[^/]+\.js$/.test(s.file));
if (!entry) {
  console.error('check-bundle-budget: no assets/index-*.js in dist/ — the entry chunk could not be');
  console.error('identified, so ENTRY cannot be measured and this run proves nothing.');
  process.exit(1);
}

const largestLazy = sized.find((s) => s !== entry);
const total = files.reduce((n, f) => n + br(readFileSync(f)), 0);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const measured = { entry: entry.br, largestChunk: largestLazy.br, total };

console.log('check-bundle-budget: brotli-compressed, the size that crosses the network\n');
console.log(`    ENTRY   ${kb(measured.entry).padStart(9)}   ${entry.file}`);
console.log(`    CHUNK   ${kb(measured.largestChunk).padStart(9)}   ${largestLazy.file}`);
console.log(`    TOTAL   ${kb(measured.total).padStart(9)}   ${files.length} files`);
console.log('\n  five largest javascript chunks:');
for (const s of sized.slice(0, 5)) console.log(`    ${kb(s.br).padStart(9)}  ${s.file}`);
console.log('');

if (process.argv.includes('--write')) {
  writeFileSync(
    BASELINE_URL,
    `${JSON.stringify(
      {
        _comment:
          'Brotli-compressed bundle budget. Recorded from a real `yarn build`. Growth beyond ' +
          `${TOLERANCE_PCT}% fails check-bundle-budget.mjs. Re-record only for a deliberate, ` +
          'explained increase — never to make a red build green.',
        _recorded: new Date().toISOString().slice(0, 10),
        _units: 'bytes, brotli quality 11',
        budget: measured,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`recorded the budget to scripts/bundle-budget-baseline.json`);
  process.exit(0);
}

if (!existsSync(BASELINE_URL)) {
  console.error('check-bundle-budget: no baseline. Create it with --write after a build.');
  process.exit(1);
}

const { budget } = JSON.parse(readFileSync(BASELINE_URL, 'utf8'));
const LABEL = { entry: 'ENTRY (every cold load waits for this)', largestChunk: 'CHUNK (the slowest single route)', total: 'TOTAL (everything in dist/)' };

let failed = false;
for (const key of ['entry', 'largestChunk', 'total']) {
  const limit = Math.round(budget[key] * (1 + TOLERANCE_PCT / 100));
  const now = measured[key];
  const delta = now - budget[key];
  const pct = ((delta / budget[key]) * 100).toFixed(1);
  if (now > limit) {
    failed = true;
    console.error(`✘ ${LABEL[key]}`);
    console.error(`    ${kb(now)} against a ${kb(budget[key])} budget — up ${kb(delta)} (${pct}%), over the ${TOLERANCE_PCT}% tolerance.`);
  } else if (delta > 0) {
    console.log(`  ${LABEL[key]}: ${kb(now)}, up ${pct}% — within tolerance.`);
  } else if (delta === 0) {
    // Unchanged is the common case and must not read as a result. It said
    // "down 0.0 KB. Re-record with --write to lock the win in." on every clean
    // run, which is an instruction to re-record a baseline that has not moved.
    console.log(`  ${LABEL[key]}: ${kb(now)}, unchanged.`);
  } else {
    console.log(`  ${LABEL[key]}: ${kb(now)}, down ${kb(-delta)}. Re-record with --write to lock the win in.`);
  }
}

if (failed) {
  console.error('\n  Something got imported. Find it before deciding it is acceptable:');
  console.error('    npx vite build --mode production && node scripts/check-bundle-budget.mjs');
  console.error('  If the growth is deliberate, re-record with --write IN THE SAME COMMIT as');
  console.error('  the change that caused it, so the diff shows both.');
  process.exit(1);
}

console.log('\n✓ every budget met.');
