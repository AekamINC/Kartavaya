/**
 * ONE LABEL SHAPE.
 *
 * ── What this is guarding ────────────────────────────────────────────────────
 *
 * "EN" was a stylesheet decision. `[data-language="en"]` names SIX class names,
 * in two stylesheets that each hold a copy of the same block, plus a seventh
 * scoped inside `.k-today`. Against that: 727 lines of Indic text across 175
 * files under `src/pages` alone, and 192 distinct elements carrying a `lang`
 * attribute across the tree.
 *
 * `components/Bilingual.jsx` and `lib/labels.js` fixed the mechanism — under EN
 * the secondary is not RENDERED, so there is nothing for a stylesheet to have to
 * know about — and then almost nothing used them. Three files imported
 * `Bilingual`, one of which was its own test.
 *
 * The call sites are not spread evenly. NINE shared components hold 532 of them,
 * and 240 of those passed Devanagari when this was measured:
 *
 *     Field         123   ui/Field.jsx              .fld__hi
 *     StatTile      112   ui/StatTile.jsx           .k-stat__hi
 *     EmptyState     97   ui/EmptyState.jsx         .empty__title-hi
 *     Card (k-card)  68   editorial/Card.jsx        .k-card__sans
 *     CardHead       51   ui/Card.jsx               .card__hi
 *     Section        35   editorial/ModuleUI.jsx    .k-section__title-hi
 *     PageHeader     22   editorial/PageHeader.jsx  .k-pageh__sans
 *     ModuleHeader   13   module/ModuleHeader.jsx   .mh__hi · .mh__kick-hi
 *     KpiStrip       11   module/KpiStrip.jsx       .mk__hi
 *
 * EXACTLY ONE of those ten class names — `.k-pageh__sans` — is in the six-name
 * list. The other nine leaked, and no amount of care fixes it in CSS: the rule
 * has to know every class name anyone will ever add, and the person adding the
 * eleventh will not know the rule exists.
 *
 * ── The rule this check used to have, and why it was wrong ───────────────────
 *
 * A label site used to be "any JSX element carrying a `lang` attribute", and an
 * Indic literal inside one was classified FIXED-GLYPH and exempted. Both halves
 * were wrong, and both were wrong in the direction that makes a check look
 * clean:
 *
 *   · Keying on `lang=` missed 24 second-script spans in 13 class names —
 *     `k-card__sans` (9), `gr__block-sans` (4), `dr__lbl-hi`, `bd__cn-hi`,
 *     `k-statuslegend__hi`, `k-quickacts__hi`, `k-onboard__hi`, `ob__mod-hi`,
 *     `gr__export-hi`, `gr__history-hi`, `gr__preview-brand-hi` — invisible
 *     exactly BECAUSE they lacked the attribute a screen reader needs. A rule
 *     that rewards deleting `lang=` is a rule that rewards an a11y regression.
 *   · "An Indic literal is decorative" swept 123 sites into an exemption nobody
 *     chose. A watermark is decorative; `<span className="k-card__sans">
 *     स्वचालन</span>` at `BoardsPage.jsx:339` is a LABEL, and it rendered
 *     Devanagari to a user who chose English.
 *
 * So the question is now asked of the CONTENT (see `SITE` below), the
 * fixed-glyph exemption is a named list of nine files with a reason each, and
 * the remainder is pinned and can only shrink. That remainder went 37 → 8, and
 * every one of the 8 sits in a file a concurrent run owns.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

import { CustomizeProvider } from '../components/CustomizePanel';
import { secondaryOf, LABELS, missingGujarati } from '../lib/labels';
import { DEVANAGARI_RE, GUJARATI_RE, INDIC_RE } from '../lib/i18n';
import { VIEWS } from '../components/views/viewDefs';

import PageHeader from '../components/editorial/PageHeader';
import KCard from '../components/editorial/Card';
import { Section } from '../components/editorial/ModuleUI';
import ModuleHeader from '../components/module/ModuleHeader';
import KpiStrip from '../components/module/KpiStrip';
import StatTile from '../components/ui/StatTile';
import { CardHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field } from '../components/ui/Field';
import ViewToolbar from '../components/views/ViewToolbar';
import DrawerLabel from '../components/drawer/DrawerLabel';
import ModuleTabs from '../components/module/ModuleTabs';
import ReceivablesKPI from '../pages/today/ReceivablesKPI';

/* `import.meta.url` is not a file: URL under the vitest transform, so the source
   root is found by walking up from the working directory — same approach as
   `tableSystem.test.jsx`. */
const SRC = (() => {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'src', 'lib', 'labels.js'))) return join(dir, 'src');
    dir = dirname(dir);
  }
  throw new Error('src not found from ' + process.cwd());
})();

// ── Discovery ────────────────────────────────────────────────────────────────

/** The accessors that make a value follow the language setting. */
const ACCESSOR = '(?:useSecondary|useLabel|secondaryOf|resolve|label)';

/**
 * A label site, classified by CONTENT rather than by the presence of `lang=`.
 *
 * ── Why the old rule had to go ───────────────────────────────────────────────
 *
 * `SITE` used to require a `lang=` attribute. Measured against the tree that
 * rule missed 24 secondary-script spans in 13 class names — `k-card__sans` (9),
 * `gr__block-sans` (4), `dr__lbl-hi`, `bd__cn-hi`, `k-statuslegend__hi`,
 * `k-quickacts__hi`, `k-onboard__hi`, `ob__mod-hi`, `gr__chip-hi`,
 * `gr__export-hi`, `gr__history-hi`, `gr__preview-brand-hi` — every one of them
 * a real second-script run, invisible to the check exactly BECAUSE it was
 * missing the attribute a screen reader needs. A rule keyed to `lang=` rewards
 * deleting `lang=`, which is also an accessibility regression: without it the
 * `[lang="hi"]` leading and zero-tracking rules never fire and the conjuncts
 * pull apart under the parent's letter-spacing.
 *
 * So the question is asked of the CONTENT. An element is a site if its child
 * run holds Indic codepoints, or if the element is a second-script SLOT — a
 * `lang=` of hi/sa/gu, or a class name that says so (`*__hi`, `*-hi`, `*__sans`,
 * `hi`, `hi-mute`). Both halves are needed: the first finds a hardcoded
 * `<span className="k-card__sans">स्वचालन</span>`, the second finds
 * `<span className="mt__hi">{TAB_HI[t.id]}</span>`, where the Devanagari is one
 * indirection away in a dictionary and no regex over this file will ever see it.
 *
 * ── Why only DOM tags ────────────────────────────────────────────────────────
 *
 * `<StatTile label="Contacts" sanskrit="संपर्क" />` holds Devanagari and is
 * CORRECT: StatTile calls `useSecondary` and renders nothing under EN. A
 * component's props are that component's problem, and the `CONVERTED` list below
 * is where that problem is asserted. Only a lowercase tag — a real DOM
 * element — can leak on its own, because nothing downstream of it can decide.
 */
const SITE = /<([a-z][\w-]*)((?:[^<>{}"'`]|"[^"]*"|'[^']*'|`[^`]*`|\{(?:[^{}]|\{[^{}]*\})*\})*?)>([^<]*)/g;

/** A class name token that names a second-script slot. */
const SLOT_CLASS = /(?:^|\s)(?:hi|hi-mute|sans|[\w-]+(?:__|-)(?:hi|sans|gu|sa))(?=\s|$)/;

/**
 * Fixed-glyph BY DESIGN — Devanagari that does not follow the language setting
 * and must not.
 *
 * Every entry is named with its reason, and the list is short on purpose: it is
 * the door an exemption walks through, so it has to be a door somebody opens
 * deliberately rather than a bucket that grows. `fixedGlyph` used to be inferred
 * — "an Indic literal is decorative" — which swept 123 sites into an exemption
 * nobody chose, including 91 that were plain hardcoded labels.
 */
const FIXED_GLYPH_FILES = new Map([
  ['components/layout/AuthShell.jsx',      'the sign-in watermark (कर्तव्य), the crown क and the Hindi tagline — pre-auth chrome, and there is no language preference to read yet'],
  ['components/editorial/Hero.jsx',        'the today watermark, the नमस्ते greeting and the Vikram Samvat date line — 24 names all three'],
  ['components/editorial/Citation.jsx',    'the Gītā / Kālaḥ citation. A quotation is not a label'],
  ['components/editorial/WeekStrip.jsx',   'the day names on the week strip — 24 names them'],
  ['components/layout/BrandLoader.jsx',    'the brand mark क'],
  ['components/layout/SideBrand.jsx',      'the sidebar watermark'],
  ['pages/onboarding/OnboardingPage.jsx',  'the onboarding watermark'],
  ['pages/prachar/CampaignsTab.jsx',       'the calendar day-of-week initials, same class as the week strip'],
  ['pages/pahchan/History.jsx',            'the attendance calendar day initials, same class again'],
]);
/** …and the two class names that are fixed-glyph wherever they appear. */
const FIXED_GLYPH_CLASS = /\b(k-citation__sans|k-hero__[\w-]+|au__(wm|crown-ka|appwm|sub)|bl__ka|side__wm-hi|ob__wm)\b/;

/** Pre-auth marketing pages: no provider, no preference, one fixed language. */
const FIXED_GLYPH_PREFIX = ['pages/marketing/'];

const isFixedGlyph = (rel, cls) =>
  FIXED_GLYPH_FILES.has(rel)
  || FIXED_GLYPH_PREFIX.some(p => rel.startsWith(p))
  || FIXED_GLYPH_CLASS.test(cls);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue;
      walk(p, out);
    } else if (name.endsWith('.jsx')) out.push(p);
  }
  return out;
}

function scan() {
  const gated = [];
  const fixedGlyph = [];
  const leaking = [];

  for (const root of ['components', 'pages']) {
    for (const file of walk(join(SRC, root))) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
      /* Comments that QUOTE markup are not markup. This file is full of them —
         every conversion left behind the line it replaced — and that quoted
         line is precisely the text a content-based scanner would otherwise
         report as the defect it just fixed. Newlines are preserved so the
         reported line number is the one the reader will find. */
      const blank = (c) => c.replace(/[^\n]/g, ' ');
      const body = src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^[ \t]*\/\/.*$/gm, '');

      for (const m of body.matchAll(SITE)) {
        const [, , attrs, child] = m;
        const cls = (/className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attrs) || [, ''])[1] || '';
        /* The child has to BE a label: one text run, or one expression. A
           `<div>` whose body opens an array literal is not a label site, and
           reading its first 200 characters as one is how `sahayak/CreditsTab`
           came back as a leak when the Devanagari it holds is a data table two
           lines further down, resolved through `secondaryOf` like everything
           else. */
        const t = child.trim();
        const oneValue = !/[{}]/.test(t) || /^\{(?:[^{}]|\{[^{}]*\})*\}$/.test(t);
        if (!oneValue) continue;

        const literal = INDIC_RE.test(child);
        const slot = SLOT_CLASS.test(cls) || /\slang=(?:"(?:hi|sa|gu)"|\{)/.test(attrs);
        if (!literal && !slot) continue;

        const at = `${rel}:${body.slice(0, m.index).split('\n').length}`;
        if (isFixedGlyph(rel, cls)) { fixedGlyph.push(at); continue; }

        if (literal) { leaking.push(at); continue; }

        const expr = /\{\s*([A-Za-z_$][\w$]*)((?:\.[\w$]+|\[[^\]]*\])*)/.exec(child);
        if (!expr) {
          // A slot with no Indic and no expression is not a label at all — an
          // English count wearing an `-hi` class name. Not a leak; not a site.
          if (!child.trim()) continue;
          leaking.push(at);
          continue;
        }
        const [, root_, path_] = expr;
        // Two bindings count, and both are in the tree: destructured straight
        // off the accessor, and named then read as `.secondary`. The second form
        // is what a `.map` body needs, where the pair is computed per row.
        const destructured = new RegExp(
          `(?:const|let)\\s*\\{[^}]*\\b${root_}\\b[^}]*\\}\\s*=\\s*${ACCESSOR}\\(`,
        ).test(src);
        const named = new RegExp(`(?:const|let)\\s+${root_}\\s*=\\s*${ACCESSOR}\\(`).test(src)
          && /^\.(secondary|primary)$/.test(path_);
        (destructured || named ? gated : leaking).push(at);
      }

      /* `<Secondary …/>` is the gated form for a run the call site renders
         itself: it asks `secondaryOf` and returns null under EN, so the node is
         absent rather than hidden. Counted so the census is not merely emptied
         by conversion — a green run has to be green over something. */
      for (const s of body.matchAll(/<Secondary\b/g)) {
        gated.push(`${rel}:${body.slice(0, s.index).split('\n').length}`);
      }
    }
  }
  return { gated, fixedGlyph, leaking };
}

const CENSUS = scan();

/** Every file that must decide, rather than render and hope a stylesheet hides it. */
const CONVERTED = [
  'components/editorial/PageHeader.jsx',
  'components/editorial/Card.jsx',
  'components/editorial/ModuleUI.jsx',
  'components/module/ModuleHeader.jsx',
  'components/module/KpiStrip.jsx',
  'components/ui/StatTile.jsx',
  'components/ui/Card.jsx',
  'components/ui/EmptyState.jsx',
  'components/ui/Field.jsx',
  'components/views/ViewToolbar.jsx',
  // The eleventh, which sat beside the ten unmeasured: `DrawerLabel` rendered
  // `<span className="dr__lbl-hi" aria-hidden>{hi}</span>` with no lang and no
  // gate, from 12 call sites across five drawer files. The old `SITE` regex
  // could not see it precisely BECAUSE it had no `lang=`.
  'components/drawer/DrawerLabel.jsx',
  // The shared module tab bar — five module pages, and the same span twice
  // (the strip and the overflow menu).
  'components/module/ModuleTabs.jsx',
];

describe('the label sites, discovered from source', () => {
  it('finds every one of the eleven shared label components gated', () => {
    const gatedFiles = new Set(CENSUS.gated.map(s => s.split(':')[0]));
    const missing = CONVERTED.filter(f => !gatedFiles.has(f));
    // Named, not counted: a failure should say WHICH component went back to
    // rendering a prop straight into a second-script span.
    expect(missing).toEqual([]);
  });

  it('is not vacuous — it finds a large gated population', () => {
    // The instrument, checked for signs of life. A content-based scanner that
    // walked no files would report zero leaks, which is the same output as a
    // clean tree.
    expect(CENSUS.gated.length).toBeGreaterThan(120);
  });

  it('exempts fixed-glyph Devanagari by NAME, not by inference', () => {
    // This bucket used to be "any Indic literal", which swept 123 sites into an
    // exemption nobody chose — 91 of them ordinary hardcoded labels that leaked
    // under English. It is now the nine files and the handful of class names
    // above, each with its reason written down.
    expect(CENSUS.fixedGlyph.length).toBeGreaterThan(10);
    expect(FIXED_GLYPH_FILES.size).toBe(9);
  });

  it('pins the leaking remainder so it can only shrink', () => {
    // A second script rendered under EN: a hardcoded Indic literal in a DOM
    // element, or a prop rendered straight into a second-script span.
    //
    // Raise NOTHING here. Lower it when you convert more.
    //
    // 7 — down from 8, and the drift in between is the reason this line is a
    // number rather than a note. It reached ELEVEN: `TabMembers.jsx` was
    // converted, and then FOUR new leaks arrived behind it —
    // `CatalogTab.jsx:463`, `ModuleGrantEditor.jsx:53`, `PayPage.jsx:371` and
    // `SkillsTab.jsx:589`. Three were `{hi && <span lang="hi">…}`, which
    // guards on the VALUE and not the language, so the Devanagari rendered
    // under EN; the fourth was a hardcoded `कर्तव्य` in the Pay footer. All
    // four converted on 2026-08-29, and this ratchet is what found them.
    //
    //   components/layout/Topbar.jsx           the breadcrumb's second script
    //   pages/approvals/ApprovalModals.jsx     the modal title
    //   pages/hub/skills/CatalogTab.jsx  x2    the marketplace hero and stats
    //   pages/hub/skills/CreateTab.jsx         the card head
    //   pages/hub/skills/GuideTab.jsx          the card head
    //   pages/org/ModuleCard.jsx               the module name
    // Each is one `<Secondary …/>` away, and none of them is this run's to make.
    const REMAINING = 7;
    expect(
      CENSUS.leaking.length,
      `leaking label sites:\n  ${CENSUS.leaking.join('\n  ')}`,
    ).toBeLessThanOrEqual(REMAINING);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Mount inside the real provider with a chosen language.
 *
 * `localStorage` rather than a prop, because `CustomizeProvider` reads its
 * preferences at mount and there is no other door — which is itself the point:
 * these assertions go through the same path a user's setting does.
 */
function mountAs(lang, ui) {
  localStorage.setItem('k_prefs', JSON.stringify({ language: lang }));
  return render(<CustomizeProvider>{ui}</CustomizeProvider>);
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

/**
 * One specimen per shared component, each carrying BOTH scripts.
 *
 * Devanagari and Gujarati together, because two different things are being
 * asserted with one fixture: that EN drops the second script entirely, and that
 * EN+ગુ picks the Gujarati rather than falling through to the Devanagari.
 */
const HI = 'कर्तव्य';
const GU = 'કાર્ય';
const PAIR = { hi: HI, gu: GU };

const SPECIMENS = [
  ['PageHeader',   <PageHeader title="Tasks" sanskrit={PAIR} />],
  ['ModuleHeader', <ModuleHeader en="Tasks" hi={PAIR} />],
  ['KpiStrip',     <KpiStrip items={[{ label: 'Open', value: 3, hi: PAIR }]} />],
  ['StatTile',     <StatTile label="Tasks" sanskrit={PAIR} value={3} />],
  ['EmptyState',   <EmptyState title={{ en: 'Nothing here', ...PAIR }} />],
  ['CardHead',     <CardHead title="Tasks" sanskrit={PAIR} />],
  ['KCard',        <KCard title="Tasks" sanskrit={PAIR} />],
  ['Section',      <Section title="Tasks" hi={PAIR} />],
  ['Field',        <Field label="Tasks" sanskrit={PAIR}><input /></Field>],
  ['ViewToolbar',  <ViewToolbar views={[{ id: 'kanban', k: 'view.kanban', label: 'Board' }]} view="kanban" />],
  /* The eleventh and twelfth, neither of which the old `lang=`-keyed scanner
     could see. `DrawerLabel` rendered the literal `Priority प्राथमिकता` under a
     real `en` preference — measured by render, not inferred — from 12 call
     sites across five drawer files. `ModuleTabs` is the shared tab bar on five
     module pages and leaked the same way twice, once for the strip and once for
     the overflow menu. */
  ['DrawerLabel',  <DrawerLabel hi={PAIR}>Priority</DrawerLabel>],
  ['ModuleTabs',   <ModuleTabs tabs={[{ id: 'overview', label: 'Overview' }]} value="overview" onChange={() => {}} />],
];

describe('EN renders no second script — through the components, not the stylesheet', () => {
  it.each(SPECIMENS)('%s', (name, ui) => {
    const { container } = mountAs('en', ui);
    // The node is ABSENT, not hidden. A `display:none` rule has to know the
    // class name; nothing to hide means nothing to miss.
    expect([name, INDIC_RE.test(container.textContent)]).toEqual([name, false]);
  });

  it('and the same components DO render Devanagari under EN + हि', () => {
    for (const [name, ui] of SPECIMENS) {
      const { container } = mountAs('en+hi', ui);
      expect([name, DEVANAGARI_RE.test(container.textContent)]).toEqual([name, true]);
      const node = container.querySelector('[lang="hi"]');
      expect([name, node?.getAttribute('lang')]).toEqual([name, 'hi']);
    }
  });
});

describe('a real call site, not a shared component', () => {
  /* The audit named this file by line: `pages/today/ReceivablesKPI.jsx:37`,
     which under a real `en` preference produced
     "RECEIVABLES प्राप्य … Collected वसूला … Overdue विलंबित … Invoices कुल चालान".
     Four hardcoded Devanagari spans, three of them without even a `lang`, on
     the first card of the home screen.

     It is asserted HERE rather than only in the static census because the
     census reads text and this reads the DOM: the two fail for different
     reasons, and a call site that renders through a component the census cannot
     follow is exactly the case the census misses. */
  it('ReceivablesKPI shows one script under EN and two under EN + हि', () => {
    const stats = {
      total_outstanding: 125000, total_collected: 90000,
      overdue_count: 3, total_invoices: 12, unpaid_count: 4,
    };
    const en = mountAs('en', <ReceivablesKPI stats={stats} />).container;
    expect(en.textContent).toContain('RECEIVABLES');
    expect(en.textContent).toContain('Collected');
    expect([...en.textContent].filter(c => INDIC_RE.test(c)).join('')).toBe('');

    const hi = mountAs('en+hi', <ReceivablesKPI stats={stats} />).container;
    expect(DEVANAGARI_RE.test(hi.textContent)).toBe(true);
    // Every one of the four now carries the script it is in, which three of
    // them did not: `[lang="hi"]`'s zero-tracking never fired on them.
    expect(hi.querySelectorAll('.hi-mute[lang="hi"]')).toHaveLength(4);
  });
});

describe('the Gujarati slot — present everywhere, and it never substitutes', () => {
  it('every shared label component can carry Gujarati, and marks it lang="gu"', () => {
    // Before this package, FOUR of the five biggest label components had no
    // `gu` slot at all — the value arrived as a bare string in a prop called
    // `sanskrit` or `hi` and was rendered with a hardcoded lang="hi". So EN+ગુ
    // was unexpressible on all of them.
    /* `ModuleTabs` is EXCLUDED, and the exclusion is the finding rather than a
       waiver. Its second script does not arrive in a prop: it is looked up in
       `module/tabLabels.js` TAB_HI, a Devanagari-ONLY dictionary keyed by tab
       id, so there is no slot a caller could put Gujarati in and no specimen
       here could supply one. That is the same gap `missingGujarati()` reports
       for the registry, in a table that is not the registry — and the fix is to
       move TAB_HI's ids onto registry keys, which is what `view.*` already did
       for the seven board views. It is not gated here because pretending the
       slot exists would be worse than saying it does not. */
    for (const [name, ui] of SPECIMENS.filter(([n]) => n !== 'ModuleTabs')) {
      const { container } = mountAs('en+gu', ui);
      const node = container.querySelector('[lang="gu"]');
      expect([name, Boolean(node)]).toEqual([name, true]);
      expect([name, GUJARATI_RE.test(node.textContent)]).toEqual([name, true]);
      // The wrong-script bug, as a check: never Devanagari under lang="gu".
      expect([name, DEVANAGARI_RE.test(node.textContent)]).toEqual([name, false]);
    }
  });

  it('a label with only Devanagari shows ENGLISH to a Gujarati reader, not Devanagari', () => {
    // The one resolution rule that has to go the other way from `sa`. Falling
    // `gu → hi` would hand Devanagari to a reader who asked for Gujarati and
    // label it lang="gu" — which is `lib/notifSound.js`'s live bug, reproduced
    // by design. Showing one script less is a smaller lie than showing the
    // wrong one.
    const { container } = mountAs('en+gu', <StatTile label="Tasks" sanskrit={HI} value={1} />);
    expect(container.querySelector('.k-stat__hi')).toBeNull();
    expect(container.textContent).toContain('Tasks');
    expect(INDIC_RE.test(container.textContent)).toBe(false);
  });

  it('reports which surfaces HAVE a Gujarati string and which have the slot and none', () => {
    // The slot is now universal; the strings are not. `navConfig.js` is still
    // the only source of Gujarati in the frontend, so what carries a string is
    // exactly what reaches a nav key.
    const withString = Object.keys(LABELS).filter(k => LABELS[k].gu);
    const slotOnly = missingGujarati();
    expect(withString.length).toBeGreaterThanOrEqual(45);
    expect(slotOnly.length).toBeGreaterThan(0);
    expect(withString.length + slotOnly.length).toBe(Object.keys(LABELS).length);
    // Every registry key resolves to NOTHING rather than to the wrong script.
    for (const k of slotOnly) expect([k, secondaryOf(k, 'en+gu').secondary]).toEqual([k, null]);
  });
});

// ── The seven Boards views ───────────────────────────────────────────────────

describe('the Boards view switcher', () => {
  it('all seven views carry Devanagari — none of them did', () => {
    // `Board List Calendar Timeline Workload Priority My Tasks`, English only,
    // on the control a user of this product touches more than any other. The
    // Devanagari existed in `module/tabLabels.js` TAB_HI under these same seven
    // ids the whole time; it was a join, not a translation job.
    expect(VIEWS).toHaveLength(7);
    for (const v of VIEWS) {
      expect([v.id, v.k]).toEqual([v.id, `view.${v.id}`]);
      const { secondary, script } = secondaryOf(v.k, 'en+hi');
      expect([v.id, DEVANAGARI_RE.test(secondary || '')]).toEqual([v.id, true]);
      expect([v.id, script]).toEqual([v.id, 'hi']);
    }
  });

  it('two of the seven carry Gujarati, and the other five have the slot and no string', () => {
    // `kanban` and `mytasks`, because navConfig already had those two words.
    // Stated rather than hidden: an empty slot is honest, a missing one is the
    // defect. Raise this list when a Gujarati speaker fills more of the column.
    const withGu = VIEWS.filter(v => LABELS[v.k]?.gu).map(v => v.id);
    expect(withGu).toEqual(['kanban', 'mytasks']);
    for (const v of VIEWS) {
      const has = withGu.includes(v.id);
      expect([v.id, Boolean(secondaryOf(v.k, 'en+gu').secondary)]).toEqual([v.id, has]);
    }
  });

  it('the switcher renders the pair, and hides the second script under EN', () => {
    const bar = <ViewToolbar views={VIEWS} view="kanban" />;

    const hi = mountAs('en+hi', bar).container;
    const seconds = hi.querySelectorAll('.k-segctrl__btn [lang]');
    expect(seconds).toHaveLength(7);
    expect(hi.textContent).toContain('Board');
    expect(DEVANAGARI_RE.test(hi.textContent)).toBe(true);
    // aria-hidden: the same word in a second script is not more information,
    // and the button already announces its English label and selected state.
    for (const s of seconds) expect(s.getAttribute('aria-hidden')).toBe('true');

    const gu = mountAs('en+gu', bar).container;
    // Two, not seven — and not five falling through to Devanagari.
    expect(gu.querySelectorAll('.k-segctrl__btn [lang="gu"]')).toHaveLength(2);
    expect(DEVANAGARI_RE.test(gu.textContent)).toBe(false);

    const en = mountAs('en', bar).container;
    expect(en.querySelectorAll('.k-segctrl__btn [lang]')).toHaveLength(0);
    expect(INDIC_RE.test(en.textContent)).toBe(false);
  });
});

// ── The module page header, which had the same leak twice ────────────────────

describe('the module header kicker', () => {
  it('resolves a registry key, so the section band is written once and not twelve times', () => {
    // All twelve module pages hand-wrote it as JSX:
    //   kick={<>Growth <span className="mh__kick-hi" lang="hi">· वृद्धि</span></>}
    // — no slot for Gujarati, no way to follow the setting, and twelve chances
    // for `प्रचालन` here to disagree with the sidebar the way `स्वचालन` and
    // `स्वतंत्र` once did.
    const ui = <ModuleHeader module="graha" kick="section.growth" en="CRM" hi="graha" />;

    const hi = mountAs('en+hi', ui).container;
    expect(hi.querySelector('.mh__kick').textContent).toBe('Growth · वृद्धि');
    expect(hi.querySelector('.mh__hi').textContent).toBe('ग्रह');

    const gu = mountAs('en+gu', ui).container;
    expect(gu.querySelector('.mh__kick').textContent).toBe('Growth · વૃદ્ધિ');
    expect(gu.querySelector('.mh__hi').textContent).toBe('ગ્રહ');

    const en = mountAs('en', ui).container;
    expect(en.querySelector('.mh__kick').textContent).toBe('Growth');
    expect(en.querySelector('.mh__hi')).toBeNull();
  });

  it('still renders a node kicker unchanged, so the migration need not be one commit', () => {
    const { container } = mountAs('en+hi', <ModuleHeader en="X" kick={<b>RAW</b>} />);
    expect(container.querySelector('.mh__kick').textContent).toBe('RAW');
  });
});

// ── The accessor itself ──────────────────────────────────────────────────────

describe('secondaryOf — the decision, without the markup', () => {
  it('reads a bare Indic string, a registry key, and the object form', () => {
    expect(secondaryOf(HI, 'en+hi')).toEqual({ secondary: HI, script: 'hi' });
    expect(secondaryOf('view.kanban', 'en+hi').secondary).toBe('फलक');
    expect(secondaryOf({ hi: HI, gu: GU }, 'en+gu')).toEqual({ secondary: GU, script: 'gu' });
  });

  it('puts a bare string in the slot its CODEPOINTS say, never the one the prop is named', () => {
    // `StatTile`'s prop is called `sanskrit` and its own comment says the values
    // are Hindi — संस्थाएँ takes the -एँ plural, which does not exist in
    // Sanskrit. A name is a claim; the codepoints are evidence.
    expect(secondaryOf(GU, 'en+gu')).toEqual({ secondary: GU, script: 'gu' });
    expect(secondaryOf(GU, 'en+hi').secondary).toBeNull();
    // Latin in an Indic slot is not a second script.
    expect(secondaryOf('Tasks', 'en+hi').secondary).toBeNull();
  });

  it('falls through sa ↔ hi both ways and NEVER to or from gu', () => {
    expect(secondaryOf(HI, 'en+sa')).toEqual({ secondary: HI, script: 'hi' });
    expect(secondaryOf({ sa: HI }, 'en+hi')).toEqual({ secondary: HI, script: 'sa' });
    expect(secondaryOf({ hi: HI }, 'en+gu').secondary).toBeNull();
    expect(secondaryOf({ gu: GU }, 'en+hi').secondary).toBeNull();
  });

  it('returns nothing under EN and never throws on nothing', () => {
    expect(secondaryOf(HI, 'en')).toEqual({ secondary: null, script: null });
    expect(secondaryOf(null, 'en+hi')).toEqual({ secondary: null, script: null });
    expect(secondaryOf(undefined, 'en+hi')).toEqual({ secondary: null, script: null });
    expect(secondaryOf({}, 'en+hi')).toEqual({ secondary: null, script: null });
  });
});
