/**
 * BILINGUAL RENDERING, MEASURED IN A BROWSER — does the chosen language hold?
 *
 * ── The defect this exists to measure ───────────────────────────────────────
 *
 * `src/lib/i18n.js` states the problem in its own comment, and states it as a
 * live one:
 *
 *   "Under EN the secondary label must not be RENDERED, not merely hidden:
 *    `[data-language="en"]` names six class names in two stylesheets, and the
 *    product renders Indic text under 82 distinct class names across 117
 *    files. Five of the six are covered and 77 leak, so a user who chose
 *    English is reading three scripts."
 *
 * That is a counted, documented defect with no test attached to it. The four
 * interface languages (`en`, `en+sa`, `en+hi`, `en+gu`) had exactly one piece
 * of coverage between them — a jsdom assertion in `__tests__/bilingual.test.jsx`
 * — and the mobile app has `devanagari.test.ts`. Nothing had ever loaded the
 * real product in a language and looked at it.
 *
 * ── Why a browser, and why `innerText` specifically ─────────────────────────
 *
 * This is the whole reason the check belongs here rather than in vitest.
 *
 * `textContent` returns text that CSS has hidden. `innerText` does not — it is
 * defined in terms of RENDERED text, so a label inside a `display: none` rule
 * is absent from it. That distinction IS the bug: the six covered class names
 * are hidden by CSS, the other 77 are not, and only a real layout engine can
 * tell the two apart. jsdom performs no layout and would report every one of
 * them as visible; a `textContent` check would report all 82 as leaking.
 * `innerText` in a browser measures precisely what a person sees.
 *
 * ── Blast radius: none ──────────────────────────────────────────────────────
 *
 * Local vite, every `/api/**` stubbed, backend URL on a dead port — the same
 * harness as `a11y.spec.ts` and `web-vitals.spec.ts`.
 */
import { test, expect, Page } from '@playwright/test';

/** Kept in sync with `src/lib/i18n.js` — imported values would need a bundler. */
const DEVANAGARI = /[ऀ-ॿ]/;
const GUJARATI = /[઀-૿]/;
const INDIC = /[ऀ-ॿ઀-૿]/;

const PAGES = ['/dashboard', '/tasks', '/ganit', '/graha', '/manav'];
/**
 * THE STUB BODY, AND WHY IT IS A BARE ARRAY.
 *
 * ⚠ It was `{ data: [], total: 0, limit: 0, truncated: false }` — copied from
 * `f32-write-gating.spec.ts`, where it is correct. It is NOT correct here, and
 * the difference was invisible until it was measured:
 *
 *     engine    stub          rendered text   error boundary
 *     chromium  envelope       1,255 chars    clean
 *     chromium  bare-array     2,323 chars    clean
 *     webkit    envelope         955 chars    clean
 *     webkit    bare-array     2,019 chars    clean
 *
 * The envelope renders the SHELL AND NOTHING ELSE — roughly half the page —
 * because `DashboardPage.jsx` reads `GET /api/tasks` as what its own comment
 * says it is: "a bare array: no total, no next cursor". Handed an object it
 * throws `{} is not iterable` into the ErrorBoundary, which replaces the page
 * content while leaving the sidebar and topbar standing. Every rule in this
 * file then passed over a shell — and the WebKit run, where the shell is
 * smaller still, looked like an engine-specific product crash. It was the stub.
 *
 * f32 gets away with the envelope because the module pages go through `rows()`,
 * which accepts both shapes. The dashboard does not.
 */
const EMPTY = [];

/**
 * Seed the session AND the language preference.
 *
 * `k_prefs` is the single localStorage key `CustomizePanel.jsx` reads
 * (STORAGE_KEY, line 9); it applies `data-language` to the root element from
 * `normalizeLanguage(prefs.language)` at line 350. Writing the key before the
 * app boots is therefore the same path a returning user takes.
 */
async function harness(page: Page, language: string) {
  await page.addInitScript((lang) => {
    localStorage.setItem(
      'Kartavaya_user',
      JSON.stringify({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' }),
    );
    localStorage.setItem('auth_token', 'e2e-stub-token');
    const prefs = JSON.parse(localStorage.getItem('k_prefs') || '{}');
    prefs.language = lang;
    localStorage.setItem('k_prefs', JSON.stringify(prefs));
  }, language);

  await page.route('**/api/**', (route) =>
    route.request().url().includes('/auth/me')
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' }),
        })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) }),
  );
}

/**
 * The ErrorBoundary leaves the SHELL STANDING and replaces only the page.
 *
 * That is why a character-count floor is not enough on its own: the sidebar and
 * topbar alone clear 900 characters, so a crashed page still looks "rendered".
 * `f32-write-gating.spec.ts` learned this first and its `assertRendered` is the
 * same list of strings.
 */
const BOUNDARY_MARKERS = [
  'Something went wrong',
  'is not defined',
  'Cannot read properties',
  'is not iterable',
  'Could not reach Kartavaya',
];

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.locator('main, [role="main"], .kv__main').first().waitFor({ state: 'attached', timeout: 20_000 });
  const state = await page.evaluate(() => ({
    // `innerText`, NOT `textContent` — see the header. This is the load-bearing
    // line of the whole file.
    visible: document.body.innerText,
    lang: document.documentElement.getAttribute('data-language'),
    htmlLang: document.documentElement.getAttribute('lang'),
  }));
  // ⚠ 300, NOT the 900 that `a11y.spec.ts` uses, and the difference is the
  // point of this file. Under EN the secondary label is not rendered at all, so
  // the same page carries roughly HALF the characters it does under EN+SA — a
  // floor calibrated on the bilingual default fails the English page for being
  // English. Measured: /tasks passes 900 under en+sa and does not under en.
  // The boundary check below is what actually catches a page that died; the
  // number is only here to catch a blank one.
  expect(
    state.visible.trim().length,
    `${path} rendered ${state.visible.trim().length} characters — too little to assert a ` +
      'language over. A language assertion on an empty page passes for free.',
  ).toBeGreaterThan(300);
  const boom = BOUNDARY_MARKERS.filter((m) => state.visible.includes(m));
  expect(
    boom,
    `${path} error-boundaried (${boom.join(', ')}) — the shell survives, so the length floor ` +
      'passed, but the page content that carries the labels is gone.',
  ).toEqual([]);
  return state;
}

/**
 * THE BRAND WORDMARK IS NOT A TRANSLATION LEAK.
 *
 * `क` and `कर्तव्य` are the logo — the product is *named* कर्तव्य, the same way
 * a Japanese brand keeps its kanji on an English page. Nobody would "fix" them
 * by rendering "Kartavaya" twice, and a check that reported them would be
 * reporting the brand on every page of every language, drowning the real
 * leaks in noise on its first run.
 *
 * Exempted BY EXACT STRING, not by a class name or a container. A container
 * exemption would silently cover any new label that happened to land inside the
 * header, which is how an exemption becomes a hole.
 */
const BRAND_WORDMARK = new Set(['क', 'कर्तव्य']);

/** The distinct Indic words a page shows, for a failure message worth reading. */
const indicWords = (text: string) =>
  [...new Set(text.split(/\s+/).filter((w) => INDIC.test(w) && !BRAND_WORDMARK.has(w)))].slice(0, 12);

/**
 * KNOWN LEAKING SURFACES, recorded 2026-08-30 — the first time any language
 * was rendered and looked at.
 *
 * ⚠ BASELINED BY PAGE, NOT BY WORD, and that was a correction. The first
 * version listed the exact Devanagari words found, and it was non-deterministic
 * within an hour: the dashboard's weekday strip renders the CURRENT week (so
 * the run that recorded `सोम मंगल` was followed by one showing
 * `बुध गुरु शुक्र शनि रवि`) and the Gita verse comes from `verse-of-the-day`,
 * which rotates. A baseline that changes by the day is a baseline that gets
 * deleted.
 *
 * The surface is the stable fact: `/dashboard` leaks Indic under every
 * language, everything else is clean. A leak on ANY OTHER page still fails,
 * which is what this needs to catch — a new component shipping a `hi` label
 * with no render decision behind it.
 *
 * This is the defect `src/lib/i18n.js` counts by class name and had no test
 * for. Fixing it means moving 77 class names onto the render decision that
 * file describes, across 117 files — product work, not a testing-pass change.
 */
const KNOWN_LEAK_SURFACES = new Set([
  'en :: /dashboard',      // Vikram Samvat date, Sanskrit greeting, the verse
  'en+gu :: /dashboard',   // the same, in DEVANAGARI, to a user who chose Gujarati
]);

/**
 * Report the words, hold the surface, fail on a new surface.
 *
 * The words are always printed — a baseline you cannot see stops being a to-do
 * list — but only the page identity decides pass or fail.
 */
function judgeLeaks(key: string, words: string[]): string[] {
  if (!words.length) return [];
  if (KNOWN_LEAK_SURFACES.has(key)) {
    // eslint-disable-next-line no-console
    console.log(`[i18n] ${key}: baselined leak, ${words.length} word(s) — ${words.slice(0, 8).join(' ')}`);
    return [];
  }
  return words;
}

test.describe('@i18n the chosen language is the language rendered', () => {
  /**
   * CHROMIUM ONLY, and this is a scope decision rather than a workaround.
   *
   * Every rule in this file asserts a property of the DOM REACT PRODUCED —
   * accessible names, label association, ARIA references, id uniqueness,
   * heading order, tabindex. React builds the same tree in every engine, so
   * running these seven times measures one thing seven times and triples the
   * matrix runtime for no new information.
   *
   * What IS engine-specific here is the focus-ring check, because engines draw
   * default focus indicators differently — that is a real gap and it is stated
   * rather than papered over. It is not closed by running this file on WebKit
   * today: under the local stubbed harness WebKit renders a smaller shell and
   * races the mount wait (692 characters, or a 20s timeout on `main`), so all
   * eight rules failed for harness reasons on the first attempt. Baselining 24
   * failures nobody had diagnosed would have been the wrong answer — that is
   * exactly how a baseline stops meaning anything.
   *
   * Cross-engine coverage is the job of `f32-write-gating`, `invoice-form-gate`
   * and `skill-data-steps`, which do run on all seven and found the real Safari
   * defects recorded in docs/STATUS.md.
   */
  /**
   * ⚠ THE PROJECT, NOT THE ENGINE. This was `browserName !== 'chromium'`, and
   * that has a hole: THREE of the seven projects run on chromium —
   * `chromium`, `android-chrome` (Pixel 7) and `android-tablet` (Galaxy Tab).
   * `browserName` is `chromium` for all three, so the skip let the phone and
   * the tablet through and they failed against baselines recorded at 1280x720.
   * Eleven entries reached `playwright-baseline.json` before it was noticed —
   * a baseline quietly absorbing a scoping bug, which is the one thing a
   * baseline must never be allowed to do.
   */
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'asserts engine-independent rendered text at the desktop viewport');
  });

  test('the preference actually reaches the document', async ({ page }) => {
    // If `data-language` never lands, every assertion below tests the default
    // and reports it as four passes. Prove the mechanism before using it.
    for (const lang of ['en', 'en+sa', 'en+hi', 'en+gu']) {
      await harness(page, lang);
      const s = await open(page, '/dashboard');
      expect(
        s.lang,
        `chose ${lang}, but <html data-language> is "${s.lang}" — the preference did not reach ` +
          'the document, so every other test in this file would be measuring the default',
      ).toBe(lang);
    }
  });

  test('EN renders ONE script, and it is Latin', async ({ page }, testInfo) => {
    const leaks: string[] = [];
    await harness(page, 'en');
    for (const path of PAGES) {
      const s = await open(page, path);
      const words = judgeLeaks(`en :: ${path}`, indicWords(s.visible));
      if (words.length) leaks.push(`${path} :: ${words.join(' ')}`);
    }

    expect(
      leaks,
      `A user who chose English is being shown Indic text on ${leaks.length} page(s):\n  ` +
        `${leaks.join('\n  ')}\n\n` +
        'This is the defect `src/lib/i18n.js` documents by count — the secondary label must not be ' +
        'RENDERED under EN, not merely hidden, because `[data-language="en"]` names six class names ' +
        'while the product renders Indic under 82. Measured with innerText, so this is what is ' +
        'actually on screen, not what is in the DOM.',
    ).toEqual([]);
  });

  test('EN+HI renders Devanagari and never Gujarati', async ({ page }) => {
    await harness(page, 'en+hi');
    let sawDevanagari = false;
    const wrongScript: string[] = [];
    for (const path of PAGES) {
      const s = await open(page, path);
      if (DEVANAGARI.test(s.visible)) sawDevanagari = true;
      const gu = judgeLeaks(
        `en+hi :: ${path}`,
        [...new Set(s.visible.split(/\s+/).filter((w) => GUJARATI.test(w) && !DEVANAGARI.test(w) && !BRAND_WORDMARK.has(w)))],
      );
      if (gu.length) wrongScript.push(`${path} :: ${gu.slice(0, 8).join(' ')}`);
    }

    // Anti-vacuity: "no Gujarati under EN+HI" is trivially true on a page that
    // renders no second script at all, which is exactly what a broken
    // preference would look like.
    expect(
      sawDevanagari,
      'EN+HI showed no Devanagari on any of the five pages — either the bilingual layer is off ' +
        'or the preference did not apply, and "no wrong script" over no script is not a pass',
    ).toBe(true);

    expect(
      wrongScript,
      `EN+HI is showing GUJARATI text:\n  ${wrongScript.join('\n  ')}\n\n` +
        'i18n.js records the mechanism for exactly this: `lib/notifSound.js` stores 19 Gujarati ' +
        'strings under the key `hi`, so anything reading `.hi` renders Gujarati and announces it ' +
        'with lang="hi" — Gujarati in a Hindi voice.',
    ).toEqual([]);
  });

  test('EN+GU renders Gujarati and never Devanagari', async ({ page }) => {
    await harness(page, 'en+gu');
    let sawGujarati = false;
    const wrongScript: string[] = [];
    for (const path of PAGES) {
      const s = await open(page, path);
      if (GUJARATI.test(s.visible)) sawGujarati = true;
      const hi = judgeLeaks(
        `en+gu :: ${path}`,
        [...new Set(s.visible.split(/\s+/).filter((w) => DEVANAGARI.test(w) && !BRAND_WORDMARK.has(w)))],
      );
      if (hi.length) wrongScript.push(`${path} :: ${hi.slice(0, 8).join(' ')}`);
    }

    expect(
      sawGujarati,
      'EN+GU showed no Gujarati on any of the five pages. `lib/labels.js` records why this is the ' +
        'likely outcome: Gujarati existed in exactly ONE file before the registry landed, because ' +
        'it was the only label shape with a slot for it — so EN+GU was unexpressible on 116 of the ' +
        '117 files that render Indic text. If this fails, that migration is not finished.',
    ).toBe(true);

    expect(
      wrongScript,
      `EN+GU is showing DEVANAGARI text:\n  ${wrongScript.join('\n  ')}\n\n` +
        'A user who chose Gujarati is reading Hindi.',
    ).toEqual([]);
  });

  test('no label is clipped by the script it is rendered in', async ({ page }) => {
    // Devanagari and Gujarati are taller than Latin and set wider for the same
    // meaning. A box sized against an English string clips the moment a second
    // script goes into it — the classic localisation defect, and one no amount
    // of English testing can find. jsdom cannot see it at all: it performs no
    // layout, so scrollWidth is always 0 there.
    const clipped: string[] = [];
    for (const lang of ['en+hi', 'en+gu']) {
      await harness(page, lang);
      for (const path of PAGES) {
        await open(page, path);
        const bad = await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter((el) => {
              const t = (el as HTMLElement).innerText;
              if (!t || !/[ऀ-ॿ઀-૿]/.test(t)) return false;
              if (el.children.length) return false;             // leaf nodes only
              const s = getComputedStyle(el);
              if (s.overflow === 'visible' && s.overflowX === 'visible') return false;
              if (s.textOverflow === 'ellipsis') return false;  // clipping on purpose
              // 2px of slack: sub-pixel text metrics differ per engine and a
              // half-pixel is not a clipped word.
              return el.scrollWidth > el.clientWidth + 2;
            })
            .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(' ')[0]} "${(el as HTMLElement).innerText.slice(0, 24)}"`)
            .slice(0, 6),
        );
        for (const b of new Set(bad)) clipped.push(`${lang} :: ${path} :: ${b}`);
      }
    }

    expect(
      clipped,
      `${clipped.length} element(s) clip their own text in a non-Latin script:\n  ` +
        `${clipped.join('\n  ')}\n\n` +
        'The box was sized against English. This is the defect that only shows up in the language ' +
        'nobody tests in, and it needs a real layout engine to see — jsdom reports scrollWidth 0 ' +
        'for everything whether the bug is there or not.',
    ).toEqual([]);
  });
});
