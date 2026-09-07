/**
 * build-pdf.mjs — renders module-flows.html to print-ready PDFs.
 *
 * Outputs, into ./pdf/:
 *   kartavaya-product-book.pdf      the book: cover + map + FOUR sheets per module
 *   kartavaya-module-flows.pdf      the short deck: cover + map + one sheet per module
 *   modules/kartavaya-<code>.pdf    one four-sheet brochure per module
 *
 * All three are the SAME source, which is the point: `?only=<code>` selects one
 * module's four sheets and `?level=overview` drops the depth sheets, so a
 * brochure handed to a prospect cannot drift from the book it came out of.
 *
 * The four sheets of a module are: Overview (the flow), Capabilities (what is
 * actually in it), Proof (why the claims hold, each with its mechanism) and
 * In practice (a worked day, who uses it, the data it holds).
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
    /* The sheet TAG, not just the module code: a module is four sheets now, and
       "graha 215.7mm" sends you to look at the wrong one. */
    const out = pages.map(el => ({
      code: el.dataset.code,
      tag: (el.querySelector('.rhead__tag')?.textContent || 'Overview').trim(),
      h: el.getBoundingClientRect().height / mm,
    }));
    pages.forEach(el => { el.style.height = ''; el.style.overflow = ''; });
    return out;
  });
  const over = rows.filter(r => r.h > 210);
  if (over.length) {
    throw new Error(`${label}: ${over.length} sheet(s) overflow 210mm and would be silently clipped —\n  `
      + over.map(r => `${r.code}/${r.tag} ${r.h.toFixed(1)}mm (+${(r.h - 210).toFixed(1)})`).join('\n  '));
  }
  return rows.length;
}

/* Sheets per module: Overview, Capabilities, Proof, In practice. Asserted
   rather than assumed — a module missing from DEEP would otherwise render
   three sheets and be noticed by nobody until a prospect had it. */
const PER_MODULE = 4;

/**
 * Fail on a capability heading that has wrapped to a second line.
 *
 * `.cap__label` is a non-wrapping flex row: the heading text and its note sit
 * side by side, and when the pair is too wide for the 84mm column it is the
 * HEADING that breaks internally. Nothing errors — the group simply gets a
 * taller header, and its rule then sits several millimetres below the rules of
 * the other two groups in its row. Six groups, three columns: one wrap is
 * visible immediately as a row that no longer lines up.
 *
 * This is the same class of failure as the overflow check: silent, invisible to
 * the build, and obvious to the prospect holding the sheet. Twenty of these
 * wrapped on the first render, which is why it is a check and not a habit.
 */
async function assertLabelsFit(page, label) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.cap__label')) {
      if (el.offsetParent === null && document.body.classList.contains('only')) continue;
      const cs = getComputedStyle(el);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      const content = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (content > line * 1.5) {
        out.push(`${el.closest('.page').dataset.code}: "${el.textContent.trim().replace(/\s+/g, ' ')}"`);
      }
    }
    return out;
  });
  if (bad.length) {
    throw new Error(`${label}: ${bad.length} capability heading(s) wrap to a second line, `
      + `which drops that group's rule out of line with its row —\n  ` + bad.join('\n  '));
  }
}

const browser = await chromium.launch();
await mkdir(modDir, { recursive: true });

// ── The book: every sheet ──────────────────────────────────────────────────
const bookExpected = CODES.length * PER_MODULE + 2;
const book = await open(browser, src);
const bookSheets = await book.locator('.page').count();
if (bookSheets !== bookExpected) throw new Error(
    `book: expected ${bookExpected} sheets (cover + map + ${CODES.length}x${PER_MODULE}), rendered ${bookSheets}`);
await assertNoOverflow(book, 'book');
await assertLabelsFit(book, 'book');
await book.pdf({ ...PDF_OPTS, path: join(outDir, 'kartavaya-product-book.pdf') });
await book.close();
console.log(`book:    ${bookSheets} sheets, none clipped -> pdf/kartavaya-product-book.pdf`);

// ── The short deck: overview sheets only ───────────────────────────────────
const deck = await open(browser, `${src}?level=overview`);
const deckSheets = await deck.locator('.page').count();
if (deckSheets !== CODES.length + 2) throw new Error(
    `deck: expected ${CODES.length + 2} sheets (cover + map + ${CODES.length} overviews), rendered ${deckSheets}`);
if (await deck.locator('.page--deep').count() !== 0) throw new Error(
    'deck: a depth sheet survived ?level=overview');
await assertNoOverflow(deck, 'deck');
await deck.pdf({ ...PDF_OPTS, path: join(outDir, 'kartavaya-module-flows.pdf') });
await deck.close();
console.log(`deck:    ${deckSheets} sheets, none clipped -> pdf/kartavaya-module-flows.pdf`);

// ── One four-sheet brochure per module ─────────────────────────────────────
for (const code of CODES) {
  const page = await open(browser, `${src}?only=${code}`);
  const visible = await page.locator('.page.show').count();
  if (visible !== PER_MODULE) throw new Error(
      `${code}: expected ${PER_MODULE} visible sheets, got ${visible}`);
  await assertNoOverflow(page, code);
  await assertLabelsFit(page, code);
  await page.pdf({ ...PDF_OPTS, path: join(modDir, `kartavaya-${code}.pdf`) });
  await page.close();
  console.log(`  ${code.padEnd(8)} ${visible} sheets -> pdf/modules/kartavaya-${code}.pdf`);
}

await browser.close();
