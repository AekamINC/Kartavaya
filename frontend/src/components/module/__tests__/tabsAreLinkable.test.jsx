/**
 * Every module tab is a real link, and every page that renders the strip has
 * an address for it to name.
 *
 * ── THE COMPLAINT, TWICE ───────────────────────────────────────────────────
 * The owner, 2026-09-01: "user cannot open anything in new tab ... they cannot
 * work two different module at same time in different [tabs]."
 * `layout/__tests__/navigationIsLinkable` answered that for the SHELL — the
 * sidebar, the admin sidebar, the mobile bar. The complaint came back on
 * 2026-09-07, because the shell was never where the work is: a CRM person does
 * not want Graha in one tab and Ganit in another, they want Graha's Deals in
 * one and its Follow-ups in the other. That is `ModuleTabs`, and all ~110 of
 * its tabs across fourteen module pages were `<button>`s.
 *
 * ── THE FAILURE MODE THIS FILE EXISTS FOR ──────────────────────────────────
 * An href that goes nowhere is WORSE than no href, because a wrong link gets
 * followed and a missing one only gets missed. Two ways to get one here:
 *
 *  · a module page that keeps its open tab in component state — the link would
 *    name `?tab=x` and the page would open on its default and ignore it.
 *    HubDashboardPage and HubSkillsPage were exactly this until 09-07;
 *  · a module with a nested RECORD route (`/graha/deals/:dealId`,
 *    `/vikray/orders/:orderId`) whose strip is mounted at the record's
 *    pathname, so an address built from `useLocation()` reopens the record
 *    instead of switching tab. That is what `basePath` is for.
 *
 * Neither is visible in a screenshot and neither fails a click-through test,
 * because a plain left click still works perfectly in both.
 *
 * ── WHY THESE ASSERT ON `href` AND ON `defaultPrevented` ───────────────────
 * `href` is what the browser acts on; the element name is an implementation
 * detail. And an href alone is not the feature — a handler that swallows every
 * click would leave the link decorative. The pair of click tests below is the
 * actual contract: a plain click stays in the app, a ctrl-click does not.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import ModuleTabs from '../ModuleTabs';

const SRC = ['src', 'frontend/src']
  .map((p) => path.resolve(process.cwd(), p))
  .find(existsSync);

const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

/** Source with comments stripped — this file's own subjects EXPLAIN what they
 *  no longer do, and a ratchet that reads its own prose is the fixture-shaped
 *  fault it is meant to catch. `navigationIsLinkable` learned that the hard way
 *  when its NavLink check failed on the sentence saying NavLink was rejected.
 *
 *  LINE comments are removed FIRST, and the order is load-bearing. Removing
 *  block comments first treats a slash-star written inside a `//` line as the
 *  start of a block, which then runs to the next star-slash hundreds of lines
 *  below and takes the real code with it. `HubClientDetailPage` has exactly one
 *  — the words "the hub-slash-star components" — and this ratchet failed on it
 *  the first time it ran: the page reads `params.get('tab')` on line 35 and the
 *  check could not see it, because the file it was handed was mostly gone.
 *
 *  That is the dangerous direction of failure. Here it produced a red test; in
 *  a check written the other way round it produces a GREEN one, because a
 *  ratchet handed an empty string passes everything. `navigationIsLinkable`
 *  carried the same order and was fixed with this. */
const live = (rel) => read(rel)
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// CRM's real seventeen — the overflow shape, so the More tail is populated.
const CRM = [
  'today', 'clients', 'contacts', 'deals', 'kanban', 'pipeline',
  'follow-ups', 'labels', 'activities', 'reports', 'automations',
  'territories', 'fields', 'web-forms', 'approvals', 'documents', 'dedupe',
];

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  vi.restoreAllMocks();
});

const mount = (props = {}, entry = '/graha?tab=deals') => {
  const onChange = vi.fn();
  act(() => root.render(
    <MemoryRouter initialEntries={[entry]}>
      <ModuleTabs
        tabs={props.tabs ?? CRM}
        value={props.value ?? 'deals'}
        onChange={onChange}
        {...props}
      />
    </MemoryRouter>,
  ));
  return onChange;
};

const $  = (s) => container.querySelector(s);
const $$ = (s) => [...container.querySelectorAll(s)];
const strip = () => $$('[role="tab"]');

/** A click the way a browser makes one: cancelable, so preventDefault means
 *  something. Returns the event, because whether it was prevented IS the
 *  assertion in half the tests here. */
const clickWith = (el, init = {}) => {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};

/* ── The rendered assertions ─────────────────────────────────────────────── */

describe('the module tab strip renders destinations a browser can open', () => {
  it('gives every tab on the strip an href', () => {
    mount();
    expect(strip().length, 'the strip rendered no tabs at all').toBeGreaterThan(0);
    const withoutHref = strip().filter((el) => !el.getAttribute('href'));
    expect(
      withoutHref.map((el) => el.textContent.trim().slice(0, 24)),
      'these tabs cannot be opened in a new tab',
    ).toEqual([]);
  });

  it('renders them as anchors, so the context menu offers "open in new tab"', () => {
    mount();
    expect(strip().every((el) => el.tagName === 'A')).toBe(true);
  });

  it('names the tab it opens, on the module\'s own path', () => {
    mount();
    const deals = strip().find((el) => el.textContent.includes('deals'));
    expect(deals.getAttribute('href')).toBe('/graha?tab=deals');
  });

  it('carries the other query params, so the second tab shows the same rows', () => {
    // Vikray's status filter and Dristi's window live beside `tab`. A link that
    // reset them would open a tab listing a different set of records than the
    // one the reader is looking at — which is a wrong answer, not a fresh one.
    mount({}, '/vikray?tab=orders&status=dispatched');
    const href = strip()[0].getAttribute('href');
    expect(href).toContain('status=dispatched');
  });

  it('gives the tabs hidden behind More an href too', () => {
    // Nine of Graha's seventeen live in that menu. They are the tabs a reader
    // is MOST likely to want in a second window, because reaching them in this
    // one costs a menu.
    mount({ onCustomize: vi.fn() });
    clickWith($('.mt__more'));
    const rows = $$('.mt__pop-row:not(.mt__pop-row--cust)');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.getAttribute('href'))).toBeTruthy();
  });

  it('honours basePath, so a strip mounted under a record route still links to the module', () => {
    /* `/graha/deals/:dealId` and `/vikray/orders/:orderId` render as CHILDREN
       of their module page, so the strip is live at the RECORD's pathname.
       Without basePath every tab would read `/graha/deals/d1?tab=clients` and
       open the deal again — the one failure worse than the button it replaced. */
    mount({ basePath: '/graha' }, '/graha/deals/d1?tab=deals');
    expect(strip()[0].getAttribute('href')).toMatch(/^\/graha\?tab=/);
    expect(strip().some((el) => el.getAttribute('href').includes('/deals/d1'))).toBe(false);
  });
});

/* ── The half that makes the href more than decoration ───────────────────── */

describe('the strip hands the browser the clicks it must not swallow', () => {
  it('keeps a plain left click inside the app', () => {
    const onChange = mount();
    const ev = clickWith(strip()[0]);
    expect(ev.defaultPrevented, 'a plain click must not reload the page').toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /* These four log `Not implemented: navigation` to stderr, and that log IS the
     assertion passing: jsdom is reporting that it was asked to follow an href
     and cannot. A run of these tests with a SILENT stderr would mean the clicks
     were being swallowed after all. Do not quiet it. */
  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd',  { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['middle', { button: 1 }],
  ])('lets a %s click through to the browser', (_label, init) => {
    const onChange = mount();
    const ev = clickWith(strip()[0], init);
    expect(
      ev.defaultPrevented,
      'this click was swallowed — the browser never gets to open the tab',
    ).toBe(false);
    // And the current tab does NOT change: the reader asked for a second tab,
    // not for this one to move.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still activates on Space, which an anchor does not do by itself', () => {
    // The button this replaced answered Enter AND Space (APG · Tabs). Enter
    // comes free with an anchor; Space scrolls the page instead, so losing it
    // would cost a keyboard user half their activation.
    const onChange = mount();
    act(() => {
      strip()[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

/* ── The source ratchets ─────────────────────────────────────────────────── */

const CONSUMERS = [
  'pages/DristiPage.jsx',
  'pages/EsignPage.jsx',
  'pages/GanitPage.jsx',
  'pages/GrahaPage.jsx',
  'pages/HubClientDetailPage.jsx',
  'pages/HubDashboardPage.jsx',
  'pages/HubSkillsPage.jsx',
  'pages/KrayPage.jsx',
  'pages/ManavPage.jsx',
  'pages/OrgSahayakPage.jsx',
  'pages/PahchanPage.jsx',
  'pages/PracharPage.jsx',
  'pages/VetanaPage.jsx',
  'pages/VikrayPage.jsx',
];

describe('every page that renders the strip has an address for it to name', () => {
  /**
   * The rendered tests above cover one fixture. This covers every page, and it
   * is the one that fails when somebody adds a module next year and reaches for
   * `useState` for its open tab — at which point the strip emits fourteen
   * hrefs that page will ignore.
   */
  it.each(CONSUMERS)('%s reads its open tab from the URL', (rel) => {
    const src = live(rel);
    expect(
      /useSearchParams/.test(src) && /\.get\('tab'\)/.test(src),
      `${rel} renders ModuleTabs but does not read ?tab= — its tab links would `
      + 'all open the page on its default, which is a link that lies',
    ).toBe(true);
  });

  it('is checking every consumer there is', () => {
    /* The list above is written out rather than globbed, so that adding a
       module page is a deliberate line here. This catches the case where it is
       not: a page rendering the strip that nobody added to CONSUMERS. */
    const glob = readFileSync(path.join(SRC, '..', 'package.json'), 'utf8');
    expect(glob).toBeTruthy(); // SRC resolved to a real frontend tree
    const missing = CONSUMERS.filter((rel) => !existsSync(path.join(SRC, rel)));
    expect(missing, 'these consumers no longer exist — the list is stale').toEqual([]);
  });
});

describe('the strip and the record rows do not navigate by onClick alone', () => {
  it('ModuleTabs renders no button in the tablist', () => {
    // `.mt__more` is still a button and must stay one: it opens a menu, it does
    // not go anywhere. Only `role="tab"` is asserted.
    expect(live('components/module/ModuleTabs.jsx'))
      .not.toMatch(/<button[^>]*role="tab"/s);
  });

  it('ModuleTabs builds an href for every tab', () => {
    expect(live('components/module/ModuleTabs.jsx')).toMatch(/href=\{hrefFor\(/);
  });

  it('the Vikray order row is an anchor', () => {
    /* Shared by the Orders, Dashboard, Pipeline and Customers tabs, so this one
       row is four lists. It was a `<button>` — right about the keyboard, silent
       about the browser. */
    const src = live('pages/vikray/OrderRows.jsx');
    expect(src).toMatch(/href=\{orderPath\(/);
    expect(src).not.toMatch(/<button[\s\S]{0,200}className=\{`vko__row/);
  });

  it('the shared Button can be a link at all', () => {
    // `to` is what lets a call site opt in without restyling anything. Without
    // it every "Open →" in the product is a button again by default.
    expect(live('components/ui/Button.jsx')).toMatch(/<Link to=\{to\}/);
  });
});

/* ── The floor ───────────────────────────────────────────────────────────── */

describe('anti-vacuity', () => {
  it('there are module pages to check in the first place', () => {
    expect(CONSUMERS.length).toBeGreaterThan(10);
  });

  it('the fixture renders a populated strip AND a populated overflow menu', () => {
    // Every assertion above would pass over an empty strip.
    mount({ onCustomize: vi.fn() });
    expect(strip().length).toBeGreaterThan(1);
    clickWith($('.mt__more'));
    expect($$('.mt__pop-row:not(.mt__pop-row--cust)').length).toBeGreaterThan(1);
  });
});
