/**
 * ACCESSIBILITY, MEASURED IN A BROWSER — the rules a static gate cannot reach.
 *
 * ── What already exists, and what it cannot see ─────────────────────────────
 *
 * Two static gates cover colour: `check-contrast.mjs` (baselined) and
 * `check-accent-contrast.mjs`. One covers hit size: `check-touch-targets.mjs`,
 * which reads CSS declarations and says in its own header that it cannot see
 * padding or flex centring reaching 44px. Keyboard access was fixed BY HAND
 * (`ui_keyboard_a11y`), with nothing pinning it.
 *
 * Everything else — accessible names, heading order, label association, broken
 * ARIA references, duplicate ids, the `lang` attribute — is a property of the
 * RENDERED tree. A stylesheet scan cannot compute it, and jsdom cannot either
 * for the parts that need layout. So it had no coverage at all.
 *
 * ── Why not axe-core ────────────────────────────────────────────────────────
 *
 * `@axe-core/playwright` is the obvious answer and is deliberately not used.
 * Adding it means regenerating `yarn.lock`, and this repo has a standing rule
 * that a lockfile regenerated on Windows breaks the Vercel and Railway builds
 * (yarn rewrites esbuild `linux-x64` → `win32-x64`) — the same reason recorded
 * at the top of `scripts/visual-baseline.mjs`. The rules below are the
 * high-impact subset, written against the DOM directly, and they cost nothing
 * but this file. If axe is ever wanted, it should be added from a Linux
 * checkout, and it would SUPERSEDE this file rather than sit beside it.
 *
 * ── Blast radius: none ──────────────────────────────────────────────────────
 *
 * Identical isolation to `f32-write-gating.spec.ts` — session seeded into
 * localStorage, every `/api/**` answered from a stub, `VITE_BACKEND_URL` on a
 * dead port. Nothing here can reach the database staging and production share.
 *
 * ── The KNOWN list is a baseline, not an exemption ──────────────────────────
 *
 * These rules were run against the product for the first time on 2026-08-30.
 * What they found is recorded BY EXACT FINDING below, so a NEW violation fails
 * while the existing ones stay visible and countable. Same contract as
 * `contrast-baseline.json` and `playwright-baseline.json`: it may shrink, it
 * may never grow. Every run prints what is being held.
 */
import { test, expect, Page } from '@playwright/test';

/** The module surfaces, same list `f32-write-gating.spec.ts` drives. */
const PAGES = [
  '/dashboard', '/tasks', '/ganit', '/graha', '/vikray',
  '/manav', '/vetana', '/prachar', '/pahchan', '/dristi',
];

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

async function stubApi(page: Page) {
  await page.route('**/api/**', (route) => {
    if (route.request().url().includes('/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin',
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) });
  });
}

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'Kartavaya_user',
      JSON.stringify({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' }),
    );
    localStorage.setItem('auth_token', 'e2e-stub-token');
  });
}

/**
 * GO TO A PAGE AND WAIT FOR IT TO ACTUALLY BE THERE, then prove it is.
 *
 * ⚠ THE FIRST VERSION OF THIS FILE HAD NO WAIT, AND SEVEN OF ITS NINE RULES
 * PASSED VACUOUSLY. `waitUntil: 'domcontentloaded'` returns before React has
 * mounted anything, so every rule was scanning an empty <div id="root">: zero
 * images all have alt text, zero controls all have names, and the two rules
 * that did fail — "no <main> landmark" on all ten pages, and "twelve Tab
 * presses moved focus to nothing" — were reporting an unmounted page as a
 * product defect. Measured with a standalone probe: after 3.5s the same
 * /dashboard has 1,255 characters of text, 59 focusable controls and exactly
 * one <main>. Both "findings" were mine.
 *
 * That is the `static_ratchets_are_not_coverage` lesson in its browser form, so
 * the floor is enforced rather than assumed: this helper waits for the shell,
 * and RETURNS THE CENSUS each rule then asserts it actually had something to
 * look at. A rule that runs over zero elements is not a passing rule.
 */
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
  // `.kv__main` is the shell's own main region; `main` is what the a11y rule
  // below wants to find. Either proves React has run.
  await page.locator('main, [role="main"], .kv__main').first().waitFor({ state: 'attached', timeout: 20_000 });
  const census = await page.evaluate(() => ({
    text: document.body.innerText.trim().length,
    body: document.body.innerText,
    controls: document.querySelectorAll('a[href], button, [role="button"], input, select, textarea').length,
  }));
  expect(
    census.text,
    `${path} rendered ${census.text} characters — the page did not mount, so every rule ` +
      'below would pass over nothing. This is a harness failure, not a clean result.',
  ).toBeGreaterThan(900);

  const boom = BOUNDARY_MARKERS.filter((m) => census.body.includes(m));
  expect(
    boom,
    `${path} error-boundaried (${boom.join(', ')}). The shell is still standing, so the ` +
      'character floor above passed — but the page content is gone and every rule below would ' +
      'be measuring a sidebar. Fix the harness or the page before trusting any result here.',
  ).toEqual([]);
  return census;
}

/** Sum of what the rules actually looked at, so a vacuous pass cannot hide. */
function floor(seen: number, what: string) {
  expect(seen, `the whole sweep found ZERO ${what} across every page — a rule with nothing ` +
    'to check is not a rule that passed. Either the pages did not render or the selector is wrong.')
    .toBeGreaterThan(0);
}

/**
 * KNOWN VIOLATIONS — recorded 2026-08-30, the first time these ran.
 *
 * Keyed `rule :: page :: detail` — the same string the failure prints, so a
 * genuine finding is pasted verbatim. Fill it ONLY from a real run, and never
 * to silence something new.
 */
const KNOWN = new Set<string>([
  // ── HEADING STRUCTURE, 10 pages, recorded 2026-08-30 ──────────────────────
  //
  // Every module page opens its content at <h3> with the page title as the
  // <h1>, so a screen-reader user jumping by heading level lands two levels
  // down with nothing in between. Real, WCAG 1.3.1, and a ten-page change to
  // the shared page header — product work, recorded here rather than done in a
  // testing pass. This is the whole list; a heading fault on any OTHER page
  // still fails.
  //
  // ⚠ /dashboard was recorded as "no headings at all" for the first hour of
  // this file's life. That was the BROKEN STUB, not the page: with the envelope
  // body the dashboard error-boundaried and only the shell — which has no
  // headings — was ever measured. With the bare array it renders its own
  // content and has the same h1→h3 jump as everything else. The corrected line
  // is below, and the wrong one is described here rather than silently
  // replaced, because "the baseline changed" and "the baseline was wrong" are
  // different events.
  'heading-order :: /dashboard :: h1 jumps to h3',
  'heading-order :: /tasks :: h1 jumps to h3',
  'heading-order :: /ganit :: h1 jumps to h3',
  'heading-order :: /graha :: h1 jumps to h3',
  'heading-order :: /vikray :: h1 jumps to h3',
  'heading-order :: /manav :: h1 jumps to h3',
  'heading-order :: /vetana :: h1 jumps to h3',
  'heading-order :: /prachar :: h1 jumps to h3',
  'heading-order :: /pahchan :: h1 jumps to h3',
  'heading-order :: /dristi :: h1 jumps to h3',
]);

/** Report findings, hold the baseline, fail on anything new. */
function judge(rule: string, found: string[], testInfo: { project: { name: string } }) {
  const fresh = found.filter((f) => !KNOWN.has(f));
  const held = found.filter((f) => KNOWN.has(f));
  if (held.length) {
    // eslint-disable-next-line no-console
    console.log(`[a11y] ${rule}: ${held.length} baselined violation(s) held in ${testInfo.project.name}`);
  }
  expect(
    fresh,
    `${fresh.length} NEW ${rule} violation(s) in ${testInfo.project.name}:\n  ${fresh.join('\n  ')}\n\n` +
      'Fix them. Adding a line to KNOWN to go green is the one thing this file exists to stop.',
  ).toEqual([]);
}

test.describe('@a11y the rendered tree obeys the rules a stylesheet cannot check', () => {
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
    test.skip(testInfo.project.name !== 'chromium', 'asserts engine-independent DOM properties at the desktop viewport; see the comment above for the focus-ring caveat');
  });

  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await signIn(page);
  });

  test('every image carries alt text, or is explicitly decorative', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll('img')]
          .filter((i) => !i.hasAttribute('alt') && i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true')
          .map((i) => (i.getAttribute('src') || '(no src)').slice(0, 60)),
      );
      for (const b of bad) found.push(`img-alt :: ${path} :: ${b}`);
    }
    floor(seen, 'controls (the img sweep needs a rendered page)');
    judge('img-alt', found, testInfo);
  });

  test('every control a person can operate has an accessible name', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() => {
        const named = (el: Element) => {
          const aria = el.getAttribute('aria-label');
          if (aria && aria.trim()) return true;
          const by = el.getAttribute('aria-labelledby');
          if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
          if ((el as HTMLElement).innerText?.trim()) return true;
          if (el.getAttribute('title')?.trim()) return true;
          // An <img alt> or an <svg><title> inside counts as the name.
          if (el.querySelector('img[alt]:not([alt=""])') || el.querySelector('svg > title')) return true;
          const id = el.getAttribute('id');
          if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
          return false;
        };
        return [...document.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="tab"]')]
          .filter((el) => {
            if (el.getAttribute('aria-hidden') === 'true') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !named(el);          // only what is actually visible
          })
          .map((el) => `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') || '').slice(0, 50)}">`);
      });
      for (const b of new Set(bad)) found.push(`control-name :: ${path} :: ${b}`);
    }
    floor(seen, 'operable controls');
    judge('control-name', found, testInfo);
  });

  test('every form field is associated with a label', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
          .filter((el) => {
            if (el.getAttribute('aria-hidden') === 'true') return false;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            if (el.getAttribute('aria-label')?.trim()) return false;
            const by = el.getAttribute('aria-labelledby');
            if (by && by.split(/\s+/).some((id) => document.getElementById(id))) return false;
            const id = el.getAttribute('id');
            if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return false;
            if (el.closest('label')) return false;
            // A placeholder is NOT a label — it disappears on input and is not
            // announced by every reader — but flag it distinctly so the fix is
            // obvious to whoever reads the failure.
            return true;
          })
          .map((el) => {
            const ph = el.getAttribute('placeholder');
            return `<${el.tagName.toLowerCase()}${ph ? ` placeholder="${ph.slice(0, 30)}"` : ''} class="${(el.getAttribute('class') || '').slice(0, 40)}">`;
          }),
      );
      for (const b of new Set(bad)) found.push(`field-label :: ${path} :: ${b}`);
    }
    floor(seen, 'controls (form fields are scanned on the same pages)');
    judge('field-label', found, testInfo);
  });

  test('no ARIA reference points at an element that does not exist', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
          for (const el of document.querySelectorAll(`[${attr}]`)) {
            // ── The lazy tab panel, exempted NARROWLY and on purpose ──────────
            //
            // `ModuleTabs.jsx` puts `aria-controls="mt-panel-<id>"` on every tab
            // while each page renders only the SELECTED panel (`GanitPage.jsx`
            // and eight others: `id={`mt-panel-${tab}`}`). That is the standard
            // lazy-panel tabs pattern, and flagging it produced 53 findings on
            // this rule's first run that nobody should act on — which is how a
            // new gate gets switched off in its first week.
            //
            // The exemption is only for a tab that is NOT selected. If the
            // SELECTED tab's panel is missing, that is the real bug shape — a
            // tab whose panel never rendered — and it still fails here.
            if (attr === 'aria-controls' && el.getAttribute('role') === 'tab'
                && el.getAttribute('aria-selected') === 'false') continue;
            for (const id of (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
              if (!document.getElementById(id)) out.push(`${attr}="${id}" on <${el.tagName.toLowerCase()}>`);
            }
          }
        }
        return out;
      });
      for (const b of new Set(bad)) found.push(`aria-ref :: ${path} :: ${b}`);
    }
    floor(seen, 'controls');
    judge('aria-ref', found, testInfo);
  });

  test('ids are unique — a duplicate silently breaks every ARIA reference to it', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() => {
        const seen = new Map<string, number>();
        for (const el of document.querySelectorAll('[id]')) {
          const id = el.id;
          if (id) seen.set(id, (seen.get(id) || 0) + 1);
        }
        return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `#${id} ×${n}`);
      });
      for (const b of bad) found.push(`duplicate-id :: ${path} :: ${b}`);
    }
    floor(seen, 'controls');
    judge('duplicate-id', found, testInfo);
  });

  test('headings start at h1 and never skip a level', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() => {
        const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
          .filter((h) => (h as HTMLElement).innerText.trim() && h.getAttribute('aria-hidden') !== 'true')
          .map((h) => Number(h.tagName[1]));
        const out: string[] = [];
        const h1s = levels.filter((l) => l === 1).length;
        // Zero headings is NOT a pass. A screen-reader user navigates a page by
        // its headings; a page with none is a wall of text with no structure,
        // and the first version of this rule let it through silently because it
        // only looked for skips BETWEEN headings that existed.
        if (levels.length === 0) out.push('no headings at all on the page');
        if (h1s === 0 && levels.length) out.push('no <h1> on the page');
        if (h1s > 1) out.push(`${h1s} <h1> elements`);
        for (let i = 1; i < levels.length; i += 1) {
          if (levels[i] - levels[i - 1] > 1) out.push(`h${levels[i - 1]} jumps to h${levels[i]}`);
        }
        return out;
      });
      for (const b of new Set(bad)) found.push(`heading-order :: ${path} :: ${b}`);
    }
    floor(seen, 'controls');
    judge('heading-order', found, testInfo);
  });

  test('no positive tabindex — it reorders the whole page, not just itself', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll('[tabindex]')]
          .filter((el) => Number(el.getAttribute('tabindex')) > 0)
          .map((el) => `<${el.tagName.toLowerCase()} tabindex="${el.getAttribute('tabindex')}">`),
      );
      for (const b of new Set(bad)) found.push(`positive-tabindex :: ${path} :: ${b}`);
    }
    floor(seen, 'controls');
    judge('positive-tabindex', found, testInfo);
  });

  test('the document declares its language, and there is a main landmark', async ({ page }, testInfo) => {
    const found: string[] = [];
    let seen = 0;
    for (const path of PAGES) {
      const census = await open(page, path);
      seen += census.controls;
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        const lang = document.documentElement.getAttribute('lang');
        if (!lang || !lang.trim()) out.push('<html> has no lang attribute');
        if (!document.querySelector('main, [role="main"]')) out.push('no <main> landmark');
        return out;
      });
      for (const b of bad) found.push(`document-shape :: ${path} :: ${b}`);
    }
    floor(seen, 'controls');
    judge('document-shape', found, testInfo);
  });

  test('the keyboard can reach the page, and focus is visible when it lands', async ({ page }, testInfo) => {
    // Keyboard access was fixed BY HAND and nothing pinned it. This is the pin:
    // tab into the page and require both that focus MOVED and that the focused
    // element is visually distinguishable. A focus ring removed by an
    // `outline: none` with no replacement is invisible to every static gate.
    // `open()`, not a bare goto — the first version of this test used one and
    // reported "the page is unreachable by keyboard" against a React tree that
    // had not mounted yet. There are 59 focusable controls on this page once it
    // has.
    const census = await open(page, '/dashboard');
    floor(census.controls, 'focusable controls on /dashboard');
    await page.locator('body').click({ position: { x: 2, y: 2 } });

    const seen: string[] = [];
    let sawVisibleRing = false;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const ring =
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
          (s.boxShadow && s.boxShadow !== 'none') ||
          s.borderColor !== getComputedStyle(el.parentElement || el).borderColor;
        return { tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').slice(0, 40), ring: !!ring };
      });
      if (!info) continue;
      seen.push(`${info.tag}.${info.cls}`);
      if (info.ring) sawVisibleRing = true;
    }

    expect(seen.length, 'twelve Tab presses moved focus to nothing at all — the page is unreachable by keyboard').toBeGreaterThan(0);
    expect(
      sawVisibleRing,
      `focus moved through ${seen.length} element(s) and NONE of them showed a visible ` +
        `focus indicator (outline, box-shadow or a border change):\n  ${seen.slice(0, 8).join('\n  ')}\n` +
        'WCAG 2.4.7. An `outline: none` with no replacement is invisible to every static gate here.',
    ).toBe(true);
  });
});
