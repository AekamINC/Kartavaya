/**
 * The no-follow-up banner, and the door it opens.
 *
 * Measured against the live database for Aekam Inc: 512 open deals, one
 * follow-up in the whole org, and a banner that could only ever say ~200. It
 * was subtracting two lists in the BROWSER and each of them stops at LIMIT
 * 200, so the figure was a guess with nothing on screen admitting it —
 * `routers/graha.py`'s `_listed()` docstring names the same arithmetic ("199
 * deals have no next step against a true 510").
 *
 * The Fix beside it landed on Follow-ups, which lists the follow-ups that
 * EXIST. That is the complement of what the banner counts, so the one set the
 * reader was being warned about was the one set unreachable from the warning.
 *
 * And it said "next step", a phrase this module's UI uses nowhere else — the
 * tab is Follow-ups, the filter chip is Follow-ups, and a reader scanning for
 * the thing the banner named met a different word everywhere they looked.
 *
 * Three defects, one shape: a number nobody could check, a door to the wrong
 * room, and a name for neither. These state the fix as behaviour, because all
 * three regress silently — a capped count and a true one look identical, and so
 * do the two tabs from anywhere except the request log.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws — the same
 * constraint `kanbanTab.test.jsx` and `grahaTabStates.test.jsx` record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Only the transport is mocked; `rows()` / `body()` stay real, because reading
// `total` out of the envelope is half of what is under test and stubbing the
// unwrapper would mock it out. `interceptors` is part of the surface here and
// not in the sibling files: GrahaPage registers a response interceptor to
// recount after a write, and a transport without one throws on mount.
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import { _resetTabPrefsCache } from '../../../components/module/useTabPrefs';
import GrahaPage from '../../GrahaPage';
import DealsTab from '../DealsTab';

/** The live shape, and the whole reason this file exists: 512 matching rows
 *  behind a page that stops at 200. Anything that reads a count off the array
 *  rather than off `total` reports 200 here and looks perfectly healthy. */
const TOTAL = 512;
const PAGE = Array.from({ length: 200 }, (_, i) => ({
  id: `d${i}`,
  title: `Deal ${i}`,
  value: 100000,
  stage: 'New',
  probability: 20,
  updated_at: '2026-08-01T00:00:00Z',
}));

const BOARD = {
  stages: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
  columns: {
    New: [{ id: 'd0', title: 'Wipro renewal', value: 340000 }],
    Qualified: [], Proposal: [], Negotiation: [], Won: [], Lost: [],
  },
};

/** The endpoints a mounted Graha touches, each answering its real envelope. */
function answer(url) {
  // `/v1/graha/deals/kanban` is not a deals LIST — the `?` is what separates
  // them, and matching on the prefix alone hands the board a page of deals.
  if (url.startsWith('/v1/graha/deals?')) {
    return Promise.resolve({ data: { data: PAGE, total: TOTAL, truncated: true } });
  }
  if (url.startsWith('/v1/graha/deals/kanban')) return Promise.resolve({ data: BOARD });
  if (url.startsWith('/v1/graha/follow-ups')) {
    return Promise.resolve({ data: { data: [], truncated: false } });
  }
  if (url.startsWith('/v1/graha/reports/forecast')) {
    return Promise.resolve({ data: { total_pipeline: 0, weighted_forecast: 0, stages: [] } });
  }
  if (url.startsWith('/v1/graha/reports/conversion')) {
    return Promise.resolve({ data: { won: 0, won_value: 0, total_deals: 0, avg_cycle_days: null } });
  }
  if (url.startsWith('/v1/me/tab-prefs')) return Promise.resolve({ data: { modules: {} } });
  return Promise.resolve({ data: { data: [] } });
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  // The prefs cache is module-level and shared by all nine module pages, so it
  // would carry one case's answer into the next.
  _resetTabPrefsCache();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockImplementation(answer);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

/**
 * Flush the microtask queue and the state updates it produced.
 *
 * Eight rounds, as in `grahaTabStates.test.jsx`: this page runs the KPI pair,
 * the contact count and the banner recount as separate awaits, and the panel
 * beneath it starts its own loads after those.
 */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async (ui) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
  });
  await settle();
};

const text = () => container.textContent;
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};
/** Every deals-LIST url asked for, in order. The kanban board is not one. */
const dealUrls = () => api.get.mock.calls
  .map(c => String(c[0]))
  .filter(u => u.startsWith('/v1/graha/deals?'));

describe('Graha · the no-follow-up banner', () => {
  it('states the count the server made, not the length of the page it was sent', async () => {
    await mount(<GrahaPage />);

    // 512, from `total` in the envelope. 200 is what every browser-side
    // subtraction of two capped lists produced, and it is the number that made
    // the banner readable as "nearly half the pipeline is fine".
    expect(text()).toContain('512 open deals have no follow-up scheduled');
    expect(text()).not.toContain('200 open deals have no follow-up scheduled');
  });

  it('asks one question of the server instead of subtracting two answers', async () => {
    await mount(<GrahaPage />);

    // Both conditions in one WHERE clause: the count is then over every
    // matching row rather than over whatever survived two LIMITs.
    expect(dealUrls().some(u => u.includes('no_follow_up=true'))).toBe(true);
  });

  it('says follow-up, the word the rest of the module uses', async () => {
    await mount(<GrahaPage />);

    // Not a copy preference. "Next step" named a thing with no tab, no filter
    // and no column, so there was nothing a reader could do with the phrase.
    expect(text().toLowerCase()).not.toContain('next step');
  });

  it('opens the deals that are missing one, not the follow-ups that exist', async () => {
    await mount(<GrahaPage />);

    await click(container.querySelector('.mwarn'));

    // Follow-ups lists the complement of what the banner counts, which is how
    // the warning came to have no door at all.
    expect(container.querySelector('#mt-panel-follow-ups')).toBeNull();
    expect(container.querySelector('#mt-panel-deals')).toBeTruthy();
    // Landing on Deals is only half of it — unfiltered, the reader arrives at
    // the whole pipeline and still cannot see which deals were meant. These two
    // sentences are printed by the narrowed list and by nothing else. The count
    // is asserted through the panel deliberately: the same figure has to survive
    // the trip from the banner into the list, or the two contradict each other
    // a few pixels apart.
    expect(text()).toContain('512 open deals with no follow-up');
    expect(text()).toContain('Schedule follow-up');
  });
});

describe('Graha · deals, narrowed to the ones missing a follow-up', () => {
  it('asks the server for the set rather than filtering a page in the browser', async () => {
    await mount(<DealsTab focusNoFollowUp={1} />);

    // Seeded from the prop, so the mount's own fetch already carries it: the
    // unfiltered pipeline must not land first and be replaced a moment later.
    expect(dealUrls()).toHaveLength(1);
    expect(dealUrls()[0]).toContain('no_follow_up=true');
  });

  it('counts with `total` and says out loud that the page is short of it', async () => {
    await mount(<DealsTab focusNoFollowUp={1} />);

    expect(container.querySelector('[role="status"]').textContent)
      .toContain('Showing the first 200 of 512 open deals with no follow-up');
  });

  it('offers the way back out of a list this much shorter than the pipeline', async () => {
    await mount(<DealsTab focusNoFollowUp={1} />);

    const out = container.querySelector('[aria-label="Show all deals again"]');
    expect(out).toBeTruthy();

    await click(out);

    expect(dealUrls().at(-1)).not.toContain('no_follow_up=true');
  });
});
