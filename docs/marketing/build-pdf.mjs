/**
 * build-pdf.mjs — renders module-flows.html to print-ready PDFs.
 *
 * Outputs, into ./pdf/:
 *   kartavaya-module-flows.pdf      the deck: cover + ecosystem map + one page per module
 *   modules/kartavaya-<code>.pdf    one single-page sheet per module
 *
 * The single-page sheets are the SAME source: `?only=<code>` hides every other
 * sheet, so a one-pager can never drift from the page in the deck.
 *
 * Fonts are EMBEDDED, from `fonts.css` (see build-fonts.mjs). They were linked
 * from Google Fonts and that silently substituted a Windows system face into
 * nine of the twelve one-pagers; the check in `open()` below is what remains
 * of that, and it fails the build rather than shipping the substitution.
 *
 * Run:  node docs/marketing/build-pdf.mjs        (from the repo root)
 */
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const src = pathToFileURL(join(here, 'module-flows.html')).href;
const outDir = join(here, 'pdf');
const modDir = join(outDir, 'modules');

/* Kept in step with the MODULES array in the HTML. A code that is not in the
   document produces an empty sheet rather than an error, so the render below
   asserts the page is actually there. */
const CODES = ['graha', 'vikray', 'ganit', 'kray', 'esign', 'manav', 'pahchan',
               'vetana', 'prachar', 'varta', 'sanvaad', 'sahayak', 'dristi'];

/* preferCSSPageSize honours the `@page { size: A4 landscape }` in the source,
   so the sheet size lives in the design file and not in two places. */
const PDF_OPTS = { printBackground: true, preferCSSPageSize: true };

/* Every Devanagari glyph the deck sets, so the face can be demanded by name
   rather than waited for. Google Fonts serves unicode-range subsets, so a
   family only downloads once a glyph in its range is laid out. */
const DEVANAGARI = 'कर्तव्यग्रहविक्रयक्रयगणितप्रमाणमानवपहचानवेतनप्रचारवार्तासंवादसहायकदृष्टि';

/**
 * `networkidle` + `document.fonts.ready` is NOT enough, and the proof is in the
 * output: nine of the twelve one-pagers embedded Windows' Nirmala UI where Tiro
 * Devanagari Hindi should be, while the deck and three others were clean. Same
 * source, same build, different result per render — a race, not a bug in the
 * CSS. `fonts.ready` settles the loads pending at that instant; a subset
 * requested during layout can start after it resolves.
 *
 * Demanding each face by name and awaiting it removes the race, and the check
 * below turns a silent substitution into a failed build.
 */
async function open(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async (deva) => {
    const jobs = [];
    for (const w of [400, 500, 600, 700]) jobs.push(document.fonts.load(`${w} 16px "Tiro Devanagari Hindi"`, deva));
    for (const fam of ['Newsreader', 'Inter', 'JetBrains Mono']) {
      for (const w of [300, 400, 500, 600, 700]) jobs.push(document.fonts.load(`${w} 16px "${fam}"`, 'AaBbCc0123'));
      jobs.push(document.fonts.load(`italic 400 16px "${fam}"`, 'AaBbCc'));
    }
    await Promise.all(jobs);
    await document.fonts.ready;
  }, DEVANAGARI);

  const ok = await page.evaluate((deva) => document.fonts.check(`400 16px "Tiro Devanagari Hindi"`, deva), DEVANAGARI);
  if (!ok) throw new Error(`${url}: Tiro Devanagari Hindi did not load — the Devanagari would fall back to a system font`);
  return page;
}

/**
 * Fail loudly on a sheet that runs past the bottom of the page.
 *
 * A .page is a fixed 210mm box with `overflow: hidden`, so an overrun does not
 * error, does not warn, and does not shift anything — the words at the bottom
 * are simply not in the PDF. That happened here for real: an unsized footer
 * mark took 13 of 14 sheets past the edge and ate their footers.
 *
 * Measuring `scrollHeight` on the fixed box CANNOT see this — it clamps, and
 * reports 210mm whether the page fits exactly or is clipped by 20mm. Releasing
 * the height first is the only honest measure. Verified against a deliberately
 * broken sheet before being relied on.
 */
async function assertNoOverflow(page, label) {
  const rows = await page.evaluate(() => {
    const mm = 96 / 25.4;
    const pages = [...document.querySelectorAll('.page')].filter(el => el.offsetParent !== null || !document.body.classList.contains('only'));
    pages.forEach(el => { el.style.height = 'auto'; el.style.overflow = 'visible'; });
    const out = pages.map(el => ({ code: el.dataset.code, h: el.getBoundingClientRect().height / mm }));
    pages.forEach(el => { el.style.height = ''; el.style.overflow = ''; });
    return out;
  });
  const over = rows.filter(r => r.h > 210);
  if (over.length) {
    throw new Error(`${label}: ${over.length} sheet(s) overflow 210mm and would be silently clipped — `
      + over.map(r => `${r.code} ${r.h.toFixed(1)}mm`).join(', '));
  }
  return rows.length;
}

const browser = await chromium.launch();
await mkdir(modDir, { recursive: true });

// ── The deck ───────────────────────────────────────────────────────────────
const deck = await open(browser, src);
const sheets = await deck.locator('.page').count();
if (sheets !== CODES.length + 2) throw new Error(
    `expected ${CODES.length + 2} sheets (cover + map + ${CODES.length} modules), rendered ${sheets}`);
await assertNoOverflow(deck, 'deck');
await deck.pdf({ ...PDF_OPTS, path: join(outDir, 'kartavaya-module-flows.pdf') });
await deck.close();
console.log(`deck: ${sheets} sheets, none clipped -> pdf/kartavaya-module-flows.pdf`);

// ── One sheet per module ───────────────────────────────────────────────────
for (const code of CODES) {
  const page = await open(browser, `${src}?only=${code}`);
  const visible = await page.locator('.page.show').count();
  if (visible !== 1) throw new Error(`${code}: expected 1 visible sheet, got ${visible}`);
  await page.pdf({ ...PDF_OPTS, path: join(modDir, `kartavaya-${code}.pdf`) });
  await page.close();
  console.log(`  ${code} -> pdf/modules/kartavaya-${code}.pdf`);
}

await browser.close();
