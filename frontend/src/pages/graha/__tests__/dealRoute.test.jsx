/**
 * A CRM deal has a URL.
 *
 * It did not. A deal opened by swapping its card in `DealsTab` for a form held
 * in that tab's local state, so the record existed nowhere but in memory:
 * nothing to bookmark, nothing to send a colleague, no Back out of it, and a
 * refresh lost the reader's place. Every notification and email that wanted to
 * deep-link to a deal had nowhere to point.
 *
 * The four facts this file holds are the four ways that defect showed:
 *
 *   1. opening a deal from the list CHANGES THE URL — it is a navigation, not
 *      a piece of component state;
 *   2. landing on that URL cold — a fresh tab, no list behind it, nothing in
 *      memory — renders the record, because the route fetches by the id in the
 *      path rather than reading a row the list happens to be holding;
 *   3. an id that is missing, forbidden or malformed renders an honest empty
 *      state with a way back, not a blank drawer and not "something broke on
 *      our side" (the sentence for a 500) over a link that is simply wrong;
 *   4. a malformed id is never sent to the server at all. `GET /deals/{id}`
 *      declares `deal_id: UUID`, so a typo would come back 422 and be reported
 *      to the reader as a request they made.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws — the same
 * constraint `grahaTabStates.test.jsx` and `noFollowUp.test.jsx` record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';

// Only the transport is mocked; `body()` stays real, because reading the
// record out of `{deal, activities}` is half of what is under test.
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import DealRoute from '../DealRoute';
import DealsTab from '../DealsTab';

const ID = '6f1c2b3a-4d5e-4f60-8a91-b2c3d4e5f607';

const DEAL = {
  id: ID,
  title: 'Ratan Steel — annual audit',
  value: 450000,
  stage: 'Proposal',
  probability: 60,
  client_name: 'Ratan Steel Pvt Ltd',
  contact_name: 'Priya Sharma',
  expected_close_date: '2026-09-30',
  notes: 'Waiting on their board sign-off.',
  updated_at: '2026-08-19T00:00:00Z',
};

function answer(url) {
  if (url.startsWith('/v1/graha/deals?')) {
    return Promise.resolve({ data: { data: [DEAL], total: 1 } });
  }
  if (url.startsWith(`/v1/graha/deals/${ID}`)) {
    return Promise.resolve({ data: { deal: DEAL, activities: [] } });
  }
  return Promise.resolve({ data: { data: [] } });
}

/** Where the router is, read out of the tree rather than guessed at. */
let here = null;
function Probe() {
  here = useLocation();
  return null;
}

/**
 * The module page, stubbed.
 *
 * Deliberately NOT `GrahaPage`: what is under test is that the record loads
 * from the path with no list state behind it, and a real module page would put
 * a deals list in memory and hide exactly the defect this file is about. The
 * `<Outlet/>` is the only thing that has to be real — it is what keeps the
 * page mounted underneath, which is how Back returns to the tab and the
 * filters the reader left.
 */
function Shell() {
  return (
    <div>
      <p>THE LIST</p>
      <Outlet />
    </div>
  );
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  here = null;
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

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/** Mount the real route tree at `path`. */
const mountAt = async (path) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Probe />
          <Routes>
            <Route path="/graha" element={<Shell />}>
              <Route path="deals/:dealId" element={<DealRoute />} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await settle();
};

/** The drawer portals to <body>, so the record is never inside `container`. */
const drawer = () => document.querySelector('[role="dialog"]');
const drawerText = () => drawer()?.textContent || '';
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};
const dealReads = () => api.get.mock.calls
  .map(c => String(c[0]))
  .filter(u => /^\/v1\/graha\/deals\/[^?]/.test(u));

describe('Graha · a deal is a URL', () => {
  it('renders the record on a cold arrival, with no list behind it', async () => {
    await mountAt(`/graha/deals/${ID}`);

    // The whole point of the route: this reader has no Graha state at all —
    // they pasted a link into a fresh tab. The record still has to arrive.
    expect(dealReads()).toEqual([`/v1/graha/deals/${ID}`]);
    expect(drawerText()).toContain('Ratan Steel — annual audit');
    expect(drawerText()).toContain('Ratan Steel Pvt Ltd');
  });

  it('opens from the list by navigating, so the address bar keeps up', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/graha']}>
          <ToastProvider>
            <Probe />
            <DealsTab />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await settle();

    const title = [...container.querySelectorAll('button')]
      .find(b => b.textContent === DEAL.title);
    expect(title).toBeTruthy();
    await click(title);

    // Was: a form appeared in place of the card and the URL never moved.
    expect(here.pathname).toBe(`/graha/deals/${ID}`);
  });

  it('says a deleted or forbidden deal is gone, and offers the way back', async () => {
    api.get.mockImplementation(url => (
      url.startsWith(`/v1/graha/deals/${ID}`)
        ? Promise.reject({ response: { status: 404 } })
        : answer(url)
    ));

    await mountAt(`/graha/deals/${ID}`);

    // Not a blank drawer and not a crash: the drawer is there and it says what
    // happened. `missing` is `errorKind`'s reading of a 404.
    expect(drawer()).toBeTruthy();
    expect(drawerText()).toContain('doesn’t exist');
    expect(drawerText()).toContain('Back to deals');
    // And it must not have rendered a record shaped like an empty one.
    expect(drawerText()).not.toContain('Probability');
  });

  it('never sends a malformed id to the server', async () => {
    await mountAt('/graha/deals/not-a-real-id');

    // `deal_id: UUID` on the endpoint means a typo is a 422, which `errorKind`
    // reads as `request` — "that request wasn't accepted" — a sentence about
    // something the reader did, over a link they merely followed.
    expect(dealReads()).toEqual([]);
    expect(drawerText()).toContain('doesn’t exist');
  });
});
