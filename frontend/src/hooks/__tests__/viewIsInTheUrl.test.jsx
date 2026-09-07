/**
 * Which VIEW you are looking at is an address, not a piece of component state.
 *
 * ── THE LAST LAYER ─────────────────────────────────────────────────────────
 * Three passes preceded this one, all from the same complaint: the app shell
 * (2026-09-01), the module tab strip and every record drawer (09-07). Verifying
 * that third pass on the live site turned up eleven more `role="tab"` strips
 * that had never been looked at, and the useful half of them had the identical
 * defect one level down — Board/Table/Calendar/Timeline on a project, Register/
 * Expiring on DSCs, Task requests/Work approvals, Messages/WhatsApp. Every one
 * held in `useState`, so none could be opened in a second tab beside another
 * and a refresh always came back to whichever shipped as the default.
 *
 * ── WHY `useUrlView` IS NOT `useOpenRecord` ────────────────────────────────
 * They look alike and their history contracts are opposites, which is the whole
 * reason there are two hooks:
 *
 *   opening a RECORD pushes — Back should close it and return to the list;
 *   switching a VIEW replaces — these strips have roving tabindex, so ←/→ moves
 *   between them and a push would leave one entry per ARROW KEY. Back would
 *   walk the strip instead of leaving the page.
 *
 * The replace assertion below is the one that catches that being "simplified"
 * into a push later.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import useUrlView from '../useUrlView';

const SRC = ['src', 'frontend/src']
  .map((p) => path.resolve(process.cwd(), p))
  .find(existsSync);

const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

/** Line comments FIRST — `module/__tests__/tabsAreLinkable` records the run
 *  where the other order swallowed a file and the check passed over nothing. */
const live = (rel) => read(rel)
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const VALUES = ['kanban', 'table', 'timeline'];

let container = null;
let root = null;
let seen = null;
let api = null;
let go = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  seen = null; api = null; go = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

function Probe({ param = 'view', values = VALUES, fallback = 'kanban' }) {
  const hook = useUrlView(param, values, fallback);
  const loc = useLocation();
  go = useNavigate();
  api = hook;
  seen = { value: hook.value, search: loc.search, pathname: loc.pathname };
  return (
    <div role="tablist">
      {values.map((v) => (
        <a key={v} {...hook.linkProps(v)} role="tab" aria-selected={hook.value === v}>{v}</a>
      ))}
    </div>
  );
}

const mount = (entries = ['/projects/p1'], props = {}) => act(() => {
  root.render(<MemoryRouter initialEntries={entries}><Probe {...props} /></MemoryRouter>);
});

const tab = (v) => [...container.querySelectorAll('[role="tab"]')]
  .find((el) => el.textContent === v);

/** A click the way a browser makes one: cancelable, so preventDefault means
 *  something. Returns the event — whether it was prevented IS the assertion. */
const clickWith = (el, init = {}) => {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};

/* ── The address ─────────────────────────────────────────────────────────── */

describe('the open view has an address', () => {
  it('reads the value the URL names', () => {
    mount(['/projects/p1?view=timeline']);
    expect(seen.value).toBe('timeline');
  });

  it('falls back on a value that is not in the allow-list', () => {
    /* A URL is user input. `?view=drop%20table` must render the default board,
       not an empty panel and not whatever the string happens to match. */
    mount(['/projects/p1?view=nonsense']);
    expect(seen.value).toBe('kanban');
  });

  it('gives every tab on the strip an href', () => {
    mount();
    const missing = [...container.querySelectorAll('[role="tab"]')]
      .filter((el) => !el.getAttribute('href'));
    expect(missing.map((el) => el.textContent), 'these cannot be opened in a new tab').toEqual([]);
  });

  it('KEEPS the other parameters', () => {
    /* On `/manav` this address also carries the module tab and possibly an open
       record. A link that dropped them would switch view on a different tab
       than the reader is looking at. */
    mount(['/manav?tab=dsc&open=e7']);
    const href = tab('table').getAttribute('href');
    expect(href).toContain('tab=dsc');
    expect(href).toContain('open=e7');
    expect(href).toContain('view=table');
  });
});

/* ── The history contract, which is the OPPOSITE of useOpenRecord's ──────── */

describe('switching a view replaces, it does not push', () => {
  it('leaves no history entry behind', () => {
    /* THE POINT. These strips are arrow-key navigable, so a push would leave
       one entry per keystroke and Back would walk the strip rather than leave
       the page. With a single initial entry, going back must be a no-op —
       which is only true if the switch replaced it. */
    mount(['/projects/p1']);
    expect(seen.value).toBe('kanban');

    act(() => api.select('timeline'));
    expect(seen.value).toBe('timeline');

    act(() => go(-1));
    expect(seen.value, 'the view switch pushed an entry — Back now walks the strip').toBe('timeline');
  });

  it('keeps a plain left click inside the app', () => {
    mount();
    const ev = clickWith(tab('table'));
    expect(ev.defaultPrevented, 'a plain click must not reload the page').toBe(true);
    expect(seen.value).toBe('table');
  });

  /* These four log `Not implemented: navigation` to stderr, and that log IS the
     assertion passing: jsdom is reporting that it was asked to follow an href
     and cannot. A silent run of these would mean the clicks were swallowed
     after all. Do not quiet it. */
  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['middle', { button: 1 }],
  ])('lets a %s click through to the browser', (_label, init) => {
    mount();
    const ev = clickWith(tab('table'), init);
    expect(ev.defaultPrevented, 'this click was swallowed — no second tab opens').toBe(false);
    // And this page does not move: the reader asked for another tab, not this one.
    expect(seen.value).toBe('kanban');
  });

  it('still activates on Space, which an anchor does not do by itself', () => {
    // The buttons these replaced answered Enter AND Space (APG · Tabs). Enter
    // comes free with an anchor; Space scrolls the page instead.
    mount();
    act(() => {
      tab('table').dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });
    expect(seen.value).toBe('table');
  });
});

/* ── The source ratchet ──────────────────────────────────────────────────── */

/** Every view strip that now says which view it is showing in the URL. */
const CONVERTED = [
  'pages/ApprovalsPage.jsx',
  'pages/BoardsPage.jsx',
  'pages/ProjectBoardPage.jsx',
  'pages/TemplatesPage.jsx',
  'pages/manav/DscTab.jsx',
  'pages/manav/NoticesTab.jsx',
  'pages/manav/ShiftBids.jsx',
  'pages/manav/ShiftsTab.jsx',
  'pages/sanvaad/MessagingTabs.jsx',
];

describe('no view strip keeps its open view in component state', () => {
  it.each(CONVERTED)('%s uses useUrlView', (rel) => {
    expect(live(rel)).toMatch(/useUrlView\(/);
  });

  it.each(CONVERTED)('%s renders the strip as anchors, not buttons', (rel) => {
    expect(
      /<button[\s\S]{0,200}role="tab"/.test(live(rel)),
      `${rel} still renders a <button role="tab"> — it has no href, so ctrl-click, `
      + 'middle-click and "Open link in new tab" have nothing to act on',
    ).toBe(false);
  });
});

describe('the strips that carry a caller-supplied address', () => {
  it('ViewToolbar renders an anchor when given one, and a button when not', () => {
    /* Optional on purpose: a caller that keeps the view in component state has
       no address, and `<Link to="">` renders an anchor that goes nowhere —
       which is worse than the button, because a wrong link gets followed. */
    const src = live('components/views/ViewToolbar.jsx');
    expect(src).toMatch(/viewLink \?/);
    expect(src).toMatch(/<a key=\{v\.id\} \{\.\.\.viewLink\(v\.id\)\}/);
    expect(src).toMatch(/<button key=\{v\.id\}/);
  });

  it('BoardToolbar passes it through rather than swallowing it', () => {
    // The two owner pages reach ViewToolbar only through this shell.
    expect(live('components/views/BoardToolbar.jsx')).toMatch(/viewLink=\{viewLink\}/);
  });
});

/* ── The three that are DELIBERATELY not converted ───────────────────────── */

describe('the exclusions are decisions, not omissions', () => {
  /**
   * All three still render `<button role="tab">`, and all three should. Written
   * down because the next person to grep for `role="tab"` will find them.
   */
  const EXCLUDED = {
    /* The DRAWER's internal notebook — Comments / Attachments / Activity on a
       task, the sections of an invoice. It swaps a panel inside a record that
       is already addressable through `?open=`; it does not go anywhere. */
    'components/ui/Tabs.jsx': 'a drawer notebook inside an addressable record',
    /* An ephemeral OVERLAY that closes on Escape. A dock with a URL would be a
       dock you could land in with nothing behind it. */
    'components/skills/SkillDock.jsx': 'an overlay, not a place',
    /* "Choose where to pay" on the PUBLIC payment page — a payment-method form
       control, not a destination. Putting it in the URL would also mean a payer
       could be linked straight into a method they did not choose. */
    'pages/PayPage.jsx': 'a form control on a public payment page',
  };

  it.each(Object.keys(EXCLUDED))('%s still renders buttons, on purpose', (rel) => {
    expect(live(rel)).toMatch(/role="tab"/);
    expect(live(rel)).not.toMatch(/useUrlView\(/);
  });
});

/* ── The floor ───────────────────────────────────────────────────────────── */

describe('anti-vacuity', () => {
  it('there are strips to check in the first place', () => {
    expect(CONVERTED.length).toBeGreaterThan(7);
  });

  it('every file in both lists exists', () => {
    const all = [...CONVERTED, 'components/ui/Tabs.jsx', 'components/skills/SkillDock.jsx',
      'pages/PayPage.jsx', 'components/views/ViewToolbar.jsx'];
    expect(all.filter((rel) => !existsSync(path.join(SRC, rel))), 'the list is stale').toEqual([]);
  });

  it('the fixture renders a populated strip', () => {
    mount();
    expect(container.querySelectorAll('[role="tab"]').length).toBe(VALUES.length);
  });
});
