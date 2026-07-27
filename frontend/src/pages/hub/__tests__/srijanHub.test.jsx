/**
 * Srijan / Hub — a failed fetch is never an empty state.
 *
 * The cluster's four pages shared one defect in eleven places: `catch { toast }`
 * followed by `list.length === 0`. The toast is gone in four seconds and the
 * panel underneath then says "No content yet", "No posts in queue", "No
 * transactions yet", "No data runs yet" — four sentences that are false
 * statements about the account rather than a report that the request failed.
 *
 * Every assertion below is a specific sentence that used to be printed over a
 * rejected promise, so the exact regression cannot come back quietly.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws —
 * `pageHeader.test.jsx` and `graha/__tests__/kanbanTab.test.jsx` record the same
 * constraint and use the same shape.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  // The real unwrapper, not a stub: what it does with each envelope shape is
  // part of what these tests are checking.
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';

import HubContentTab from '../ContentTab';
import HubCreditsTab from '../CreditsTab';
import PublishTab from '../PublishTab';
import DataRunsTab from '../../srijan/DataRunsTab';
import SrijanCreditsTab from '../../srijan/CreditsTab';

const FAIL = { response: { status: 500, data: { detail: 'The upstream service is unavailable.' } } };
const ok = (data) => ({ data });

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (el) => act(() => root.render(<ToastProvider>{el}</ToastProvider>));
const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const status = () => container.querySelector('[role="status"]');

/** Answer per URL, so a test can fail exactly one of several requests. */
const routeBy = (map) => (url) => {
  const key = Object.keys(map).find(k => String(url).includes(k));
  const v = key ? map[key] : { data: [] };
  return v instanceof Error || v?.response ? Promise.reject(v) : Promise.resolve(ok(v));
};

describe('Hub · Content — a failed load is not an empty library', () => {
  it('reports the failure and never claims nothing has been generated', async () => {
    api.get.mockRejectedValue(FAIL);
    mount(<HubContentTab clientId="c1" />);
    await settle();

    expect(status()).toBeTruthy();
    expect(text()).toContain('did not load');
    // The exact regression. "Nothing generated yet" over a rejected promise
    // invites someone to re-generate work that already exists — and to spend
    // credits doing it.
    expect(text()).not.toContain('Nothing generated yet');
  });

  it('says the library is empty only when the request actually succeeded', async () => {
    api.get.mockResolvedValue(ok({ data: [] }));
    mount(<HubContentTab clientId="c1" />);
    await settle();

    expect(text()).toContain('Nothing generated yet');
    expect(status()).toBeFalsy();
  });

  it('keeps "filtered to nothing" distinct from "nothing exists"', async () => {
    api.get.mockResolvedValue(ok({ data: [
      { id: '1', title: 'Post', agent_type: 'blog', status: 'approved', body: 'x' },
    ] }));
    mount(<HubContentTab clientId="c1" />);
    await settle();

    const rejected = [...container.querySelectorAll('.hb-chip')]
      .find(b => b.textContent.startsWith('Rejected'));
    await act(async () => { rejected.click(); });
    await settle();

    // A library with one approved item and no rejected ones is not an empty
    // library, and the way out is the filter rather than the Generate tab.
    expect(text()).toContain('No content with that status');
    expect(text()).not.toContain('Nothing generated yet');
  });
});

describe('Hub · Credits — the ledger cannot lie about the wallet', () => {
  it('reports a failed ledger instead of printing "nothing has moved"', async () => {
    api.get.mockRejectedValue(FAIL);
    mount(<HubCreditsTab clientId="c1" wallet={{ balance: 497, monthly_allocation: 500 }} />);
    await settle();

    expect(text()).toContain('The credit ledger did not load');
    // On a money screen this sentence over a failed request is the worst version
    // of the bug in the whole cluster.
    expect(text()).not.toContain('Nothing has moved through this wallet yet');
  });

  it('shows an unloaded balance as unknown, not as zero', async () => {
    api.get.mockResolvedValue(ok({ recent_transactions: [] }));
    mount(<HubCreditsTab clientId="c1" wallet={null} />);
    await settle();

    expect(text()).toContain('The wallet did not load');
    expect(container.querySelector('.hb-fig').textContent.trim()).toBe('—');
  });
});

describe('Hub · Publish — three requests, three separate failures', () => {
  it('reports a failed queue without claiming nothing is scheduled', async () => {
    api.get.mockImplementation(url => routeBy({
      'social-accounts': { data: [] },
      'publish/queue': FAIL,
      'platforms': { enabled: [] },
    })(url));
    mount(<PublishTab clientId="c1" />);
    await settle();

    expect(text()).toContain('The publish queue did not load');
    // Telling someone nothing is scheduled when posts may be about to go out is
    // the version of this bug that costs them a publication.
    expect(text()).not.toContain('Nothing is scheduled');
  });

  it('does not blank the platform cards when only the queue failed', async () => {
    api.get.mockImplementation(url => routeBy({
      'social-accounts': { data: [{ id: 'a1', platform: 'instagram', account_name: '@acme' }] },
      'publish/queue': FAIL,
      'platforms': { enabled: ['instagram'] },
    })(url));
    mount(<PublishTab clientId="c1" />);
    await settle();

    // The original ran both through one Promise.all in one try/catch, so a queue
    // failure took the accounts down with it and nobody could tell which half
    // had broken.
    expect(container.querySelector('.hb-plat')).toBeTruthy();
    expect(text()).toContain('Instagram');
    expect(text()).toContain('The publish queue did not load');
  });

  it('never falls back to "every platform is enabled" when the allow-list fails', async () => {
    api.get.mockImplementation(url => routeBy({
      'social-accounts': { data: [] },
      'publish/queue': { data: [] },
      'platforms': FAIL,
    })(url));
    mount(<PublishTab clientId="c1" />);
    await settle();

    expect(text()).toContain('The platform allow-list did not load');
    // The original `catch { setEnabledPlatforms(ALL) }` rendered thirteen
    // connectable platforms for a client entitled to none. Not knowing which are
    // permitted is not the same as all of them being permitted.
    expect(container.querySelectorAll('.hb-plat').length).toBe(0);
  });

  it('says "none enabled" only when the allow-list really came back empty', async () => {
    api.get.mockImplementation(url => routeBy({
      'social-accounts': { data: [] },
      'publish/queue': { data: [] },
      'platforms': { enabled: [] },
    })(url));
    mount(<PublishTab clientId="c1" />);
    await settle();

    expect(text()).toContain('No platforms are enabled for this client');
    expect(container.querySelectorAll('.hb-plat').length).toBe(0);
  });
});

describe('Srijan · Data runs — a failed list is not an empty history', () => {
  it('reports the failure rather than inviting a re-run that costs credits', async () => {
    api.get.mockRejectedValue(FAIL);
    mount(<DataRunsTab />);
    await settle();

    expect(text()).toContain('did not load');
    // "No data runs yet. Go to Data Catalog to start one." over a failed fetch
    // is an instruction to spend credits repeating work that may have succeeded.
    expect(text()).not.toContain('No data runs yet');
  });

  it('shows the empty history when the request genuinely returned nothing', async () => {
    api.get.mockResolvedValue(ok({ data: [] }));
    mount(<DataRunsTab />);
    await settle();

    expect(text()).toContain('No data runs yet');
  });
});

describe('Srijan · Credits — the empty ledger is unreachable from a failure', () => {
  it('renders the error branch and returns before the table', async () => {
    mount(<SrijanCreditsTab credits={null} loading={false} error="The server failed on this request." />);
    await settle();

    expect(text()).toContain('Your credit balance did not load');
    expect(text()).not.toContain('Nothing has moved through the org wallet yet');
  });

  it('keeps loading distinct from both empty and failed', async () => {
    mount(<SrijanCreditsTab credits={null} loading error="" />);
    await settle();

    expect(container.querySelector('.k-shimmer')).toBeTruthy();
    expect(text()).not.toContain('did not load');
    expect(text()).not.toContain('Nothing has moved through the org wallet yet');
  });
});
