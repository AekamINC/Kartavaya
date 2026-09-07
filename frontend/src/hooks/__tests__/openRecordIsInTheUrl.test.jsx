/**
 * A record that is open is a record with an address.
 *
 * ── THE COMPLAINT, THIRD PASS ──────────────────────────────────────────────
 * The owner, 2026-09-01 and again 09-07: "user cannot open anything in new tab
 * ... they cannot work two different module at same time". The shell was made
 * linkable, then the module tab strip (`module/__tests__/tabsAreLinkable`).
 * This is the part a CRM person actually lives in, and it was the largest:
 *
 *     const [openId, setOpenId] = useState(null);
 *
 * That line appeared verbatim in twelve list files. A record opened through it
 * has no URL — it cannot be opened in a second tab, cannot be sent to a
 * colleague, cannot be bookmarked, and does not survive a refresh. None of it
 * shows in a screenshot, because opening the drawer works perfectly.
 *
 * ── WHAT THESE ASSERT, AND WHY EACH ONE ────────────────────────────────────
 * The rendered half pins the HISTORY CONTRACT, which is the part that is easy
 * to get wrong and impossible to see: opening pushes (so Back closes the
 * record instead of leaving the module), and closing consumes that entry
 * rather than pushing a third — otherwise Back re-opens what was just
 * dismissed. A reader who arrived COLD has no entry to consume, and
 * `navigate(-1)` there walks out of the app.
 *
 * The source half is the ratchet. It fails when somebody adds a list next year
 * and reaches for `useState` for its open row.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import useOpenRecord from '../useOpenRecord';

const SRC = ['src', 'frontend/src']
  .map((p) => path.resolve(process.cwd(), p))
  .find(existsSync);

const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

/** Line comments FIRST — see `module/__tests__/tabsAreLinkable` for the run
 *  where the other order swallowed a whole file and the check passed over
 *  nothing. */
const live = (rel) => read(rel)
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

let container = null;
let root = null;
let seen = null;         // the last {openId, search, pathname} the probe rendered
let api = null;          // the hook's own handles, for driving it from a test
let go = null;           // the router's own navigate, to press Back with

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  seen = null;
  api = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

function Probe({ options }) {
  const hook = useOpenRecord(options);
  const loc = useLocation();
  /* The ROUTER's navigate, not the hook's. `window.history` is not what a
     MemoryRouter walks, so pressing Back has to go through the router that
     owns the entries — otherwise the assertion runs against a history nothing
     in this test ever wrote to, and passes for the wrong reason. */
  go = useNavigate();
  api = hook;
  seen = { openId: hook.openId, search: loc.search, pathname: loc.pathname };
  return <a href={hook.hrefFor('r9')}>open r9</a>;
}

const mount = (entries = ['/ganit?tab=invoices'], options = undefined) => act(() => {
  root.render(
    <MemoryRouter initialEntries={entries}>
      <Probe options={options} />
    </MemoryRouter>,
  );
});

const href = () => container.querySelector('a').getAttribute('href');

/* ── The address ─────────────────────────────────────────────────────────── */

describe('the open record has an address', () => {
  it('reads the id the URL names', () => {
    mount(['/ganit?tab=invoices&open=inv-7']);
    expect(seen.openId).toBe('inv-7');
  });

  it('is null when the URL names none — an absent parameter is not an empty one', () => {
    mount();
    expect(seen.openId).toBeNull();
  });

  it('builds an href on the current path', () => {
    mount();
    expect(href()).toBe('/ganit?tab=invoices&open=r9');
  });

  it('KEEPS the other parameters', () => {
    /* `?tab=` decides which list is underneath and the filters decide which
       rows. A link that dropped them would open the record over a different
       list than the reader is looking at — a wrong answer, not a fresh one. */
    mount(['/vikray?tab=orders&status=dispatched']);
    expect(href()).toContain('tab=orders');
    expect(href()).toContain('status=dispatched');
  });

  it('replaces an id already in the URL rather than appending a second', () => {
    mount(['/ganit?open=inv-1']);
    expect(href()).toBe('/ganit?open=r9');
  });

  it('honours basePath, so a list mounted under a record route still links to itself', () => {
    /* `/graha/deals/:dealId` renders as a CHILD of the module page, so the
       Clients list is still mounted beneath an open deal. Without basePath a
       row link would read `/graha/deals/d1?open=c1` and reopen the deal. */
    mount(['/graha/deals/d1?tab=clients'], { basePath: '/graha' });
    expect(href()).toBe('/graha?tab=clients&open=r9');
  });
});

/* ── The history contract ────────────────────────────────────────────────── */

describe('opening pushes, and closing consumes what it pushed', () => {
  it('opening is a push, so Back closes the record instead of leaving the module', () => {
    mount(['/ganit?tab=invoices']);
    act(() => api.open('inv-7'));
    expect(seen.openId).toBe('inv-7');
    expect(seen.search).toContain('tab=invoices');   // and keeps the list

    /* THE POINT OF PUSHING. Before this, a drawer had no history entry at all,
       so Back left the module entirely and the reader lost the list as well as
       the record. */
    act(() => go(-1));
    expect(seen.openId).toBeNull();
    expect(seen.pathname).toBe('/ganit');
    expect(seen.search).toContain('tab=invoices');
  });

  it('closing after opening returns to the list, leaving no dead entry behind', () => {
    mount(['/ganit?tab=invoices']);
    act(() => api.open('inv-7'));
    expect(seen.openId).toBe('inv-7');

    act(() => api.close());
    expect(seen.openId).toBeNull();
    /* The list is intact underneath. If close() had pushed a third entry
       instead of consuming the second, Back from here would re-open the record
       the reader just dismissed. */
    expect(seen.search).toContain('tab=invoices');
  });

  it('closing a COLD arrival drops the parameter instead of walking out of the app', () => {
    /* This is the branch that matters on a pasted link or a second tab: there
       is no entry to go back TO, and `navigate(-1)` there leaves the app. */
    mount(['/ganit?tab=invoices&open=inv-7']);
    expect(seen.openId).toBe('inv-7');

    act(() => api.close());
    expect(seen.openId).toBeNull();
    expect(seen.pathname).toBe('/ganit');
    expect(seen.search).toContain('tab=invoices');
  });

  it('ignores an empty id rather than writing `?open=` with nothing after it', () => {
    // `PurchaseOrdersTab` hands it `body(r).data?.id` straight from a create.
    mount();
    act(() => api.open(undefined));
    act(() => api.open(''));
    expect(seen.openId).toBeNull();
  });

  it('sets other parameters in the SAME navigation', () => {
    /* `EsignPage` opens a document and switches tab at once. Two calls in one
       tick silently loses one: `setParams` is a navigate, not a setState, so
       the second reads a location the first has not landed yet. */
    mount(['/esign?tab=analytics']);
    act(() => api.open('doc-3', { params: { tab: 'documents' } }));
    expect(seen.openId).toBe('doc-3');
    expect(seen.search).toContain('tab=documents');
  });

  it('a replace open leaves nothing for close to consume', () => {
    /* The picker case — `TeamsPage`'s project `<select>` fires `change` on every
       arrow key, so pushing would make Back walk the dropdown. Closing after a
       replace must take the cold branch, not `navigate(-1)`. */
    mount(['/teams']);
    act(() => api.open('t2', { replace: true }));
    expect(seen.openId).toBe('t2');
    act(() => api.close());
    expect(seen.openId).toBeNull();
    expect(seen.pathname).toBe('/teams');
  });
});

/* ── The source ratchet ──────────────────────────────────────────────────── */

/** Every list that opens a record, and now says so in the URL. */
const CONVERTED = [
  'pages/EsignPage.jsx',
  'pages/TeamsPage.jsx',
  'pages/dristi/ReportsTab.jsx',
  'pages/ganit/ContractsTab.jsx',
  'pages/ganit/InvoicesTab.jsx',
  'pages/ganit/PayablesTab.jsx',
  'pages/graha/ClientsTab.jsx',
  'pages/graha/ContactsTab.jsx',
  'pages/hub/skills/CatalogTab.jsx',
  'pages/manav/ExitsTab.jsx',
  'pages/prachar/EventsTab.jsx',
  'pages/prachar/SequencesTab.jsx',
  'pages/procurement/POApprovalsTab.jsx',
  'pages/procurement/PurchaseOrdersTab.jsx',
  'pages/sahayak/DataRunsTab.jsx',
];

describe('no list keeps its open record in component state', () => {
  it.each(CONVERTED)('%s uses useOpenRecord', (rel) => {
    expect(live(rel)).toMatch(/useOpenRecord\(/);
  });

  it.each(CONVERTED)('%s holds no openId in useState', (rel) => {
    expect(
      /const \[\s*openId\s*,/.test(live(rel)),
      `${rel} is back to keeping the open record in component state — it has no `
      + 'URL, so it cannot be opened in a second tab and will not survive a refresh',
    ).toBe(false);
  });

  it.each(CONVERTED)('%s imports the hook', (rel) => {
    expect(read(rel)).toMatch(/import useOpenRecord from/);
  });
});

/* ── The two that are DELIBERATELY not converted ─────────────────────────── */

describe('the exclusions are decisions, not omissions', () => {
  /**
   * Both of these hold an open row in `useState`, and both should. Written down
   * because the next person to run the grep above will find them and assume
   * they were missed.
   */
  const EXCLUDED = {
    /* An inline FORM, not a record view. `toggle()` also clears the last
       result, resets the image option and re-seeds the parameter box — so
       arriving on a URL would have to reproduce all of it, on a screen that
       spends credits when it runs. The pack is not a thing anyone sends a link
       to; the run is, and that is `sahayak/DataRunsTab`, which IS converted. */
    'pages/sahayak/SkillsTab.jsx': 'an accordion form that resets run state',
    /* A REVIEW CURSOR. The open row is driven by the `O` key and by a row click
       that also moves the cursor (`seek(i)`), so a reviewer sweeping a day of
       punches would push one history entry per row examined and Back would walk
       every one of them. A URL is the wrong shape for a cursor. */
    'pages/pahchan/Register.jsx': 'a keyboard review cursor, one entry per punch',
  };

  it.each(Object.keys(EXCLUDED))('%s still holds its open row in state, on purpose', (rel) => {
    expect(live(rel)).toMatch(/const \[\s*openId\s*,/);
    expect(live(rel)).not.toMatch(/useOpenRecord\(/);
  });
});

/* ── The floor ───────────────────────────────────────────────────────────── */

describe('anti-vacuity', () => {
  it('there are lists to check in the first place', () => {
    expect(CONVERTED.length).toBeGreaterThan(12);
  });

  it('every file in the list exists', () => {
    const missing = CONVERTED.filter((rel) => !existsSync(path.join(SRC, rel)));
    expect(missing, 'the list is stale').toEqual([]);
  });

  it('the hook is what the pages think it is', () => {
    // If `useOpenRecord` ever stopped reading a parameter, every source
    // assertion above would still pass over a hook that does nothing.
    mount(['/x?open=abc']);
    expect(seen.openId).toBe('abc');
  });
});
