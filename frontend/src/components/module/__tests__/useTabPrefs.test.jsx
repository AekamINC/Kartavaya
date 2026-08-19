/**
 * useTabPrefs — the reconcile contract and the three storage layers.
 *
 * The reconcile rules are the part that regresses silently: a saved row is
 * WRITTEN once and READ for ever, so the page's tab set will drift under it —
 * tabs renamed, dropped, shipped later — and every drift has to degrade to
 * something sensible rather than to a crash or a stolen slot.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not, so importing it throws. Same reason as
 * `moduleTabs.test.jsx`.
 *
 * Only the transport is mocked; `body()` comes from the real module because
 * envelope-vs-bare unwrapping is part of what is under test.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../ui/toast';
import useTabPrefs, { reconcileTabPrefs, _resetTabPrefsCache } from '../useTabPrefs';

const BASE = ['invoices', 'products', 'expenses', 'bank'];

let container = null;
let root = null;
/** The latest hook return, captured by the probe on every render. */
const h = {};

function Probe({ moduleKey = 'ganit', base = BASE, fallback }) {
  Object.assign(h, useTabPrefs(moduleKey, base, { fallback }));
  return (
    <>
      <div data-t="order">{h.order.join(',')}</div>
      <div data-t="def">{h.defaultTab}</div>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetTabPrefsCache();
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // A quiet server by default; tests that care override per-case.
  api.get.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (props = {}) => act(() => root.render(
  <ToastProvider><Probe {...props} /></ToastProvider>,
));
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const orderText = () => container.querySelector('[data-t="order"]').textContent;
const defText = () => container.querySelector('[data-t="def"]').textContent;

describe('reconcileTabPrefs — the rules, stated pure', () => {
  it('applies a saved order over the base', () => {
    const r = reconcileTabPrefs(BASE, { order: ['bank', 'invoices', 'expenses', 'products'] });
    expect(r.order).toEqual(['bank', 'invoices', 'expenses', 'products']);
  });

  it('drops a saved id the page no longer ships', () => {
    const r = reconcileTabPrefs(BASE, { order: ['retired', 'bank', 'invoices', 'products', 'expenses'] });
    expect(r.order).toEqual(['bank', 'invoices', 'products', 'expenses']);
  });

  it('appends a tab shipped after the row was saved — it never steals an arranged slot', () => {
    // The row predates `bank`. The user put expenses first; bank must queue
    // at the END, not land where the base order would have put it.
    const r = reconcileTabPrefs(BASE, { order: ['expenses', 'invoices', 'products'] });
    expect(r.order).toEqual(['expenses', 'invoices', 'products', 'bank']);
  });

  it('appends several new tabs in base order', () => {
    const r = reconcileTabPrefs(BASE, { order: ['expenses'] });
    expect(r.order).toEqual(['expenses', 'invoices', 'products', 'bank']);
  });

  it('ignores a duplicate id rather than rendering a tab twice', () => {
    const r = reconcileTabPrefs(BASE, { order: ['bank', 'bank', 'invoices'] });
    expect(r.order).toEqual(['bank', 'invoices', 'products', 'expenses']);
  });

  it('answers the base order for no saved row at all', () => {
    expect(reconcileTabPrefs(BASE, null).order).toEqual(BASE);
    expect(reconcileTabPrefs(BASE, undefined).order).toEqual(BASE);
  });

  it('keeps a default that still exists and nulls one that does not', () => {
    expect(reconcileTabPrefs(BASE, { order: null, default_tab: 'bank' }).defaultTab).toBe('bank');
    expect(reconcileTabPrefs(BASE, { order: null, default_tab: 'retired' }).defaultTab).toBeNull();
  });

  it('accepts {id} objects as the base — the pages hold both shapes', () => {
    const r = reconcileTabPrefs(BASE.map((id) => ({ id })), { order: ['bank'] });
    expect(r.order).toEqual(['bank', 'invoices', 'products', 'expenses']);
  });
});

describe('useTabPrefs — first paint and the server', () => {
  it('paints the warm copy first, before the server answers', async () => {
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['bank', 'invoices', 'products', 'expenses'], default_tab: 'bank' }));
    api.get.mockReturnValue(new Promise(() => {})); // in flight for ever
    mount();
    expect(orderText()).toBe('bank,invoices,products,expenses');
    expect(defText()).toBe('bank');
  });

  it('lets the server win on arrival, and rewrites the warm copy', async () => {
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['bank', 'invoices', 'products', 'expenses'] }));
    api.get.mockResolvedValue({ data: { ganit: { order: ['expenses', 'invoices', 'products', 'bank'], default_tab: 'expenses' } } });
    mount();
    await settle();
    expect(orderText()).toBe('expenses,invoices,products,bank');
    expect(defText()).toBe('expenses');
    expect(JSON.parse(localStorage.getItem('ktabs:ganit'))).toEqual(
      { order: ['expenses', 'invoices', 'products', 'bank'], default_tab: 'expenses' },
    );
  });

  it('clears a stale warm copy when the server has no row for the module', async () => {
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['bank', 'invoices', 'products', 'expenses'] }));
    api.get.mockResolvedValue({ data: {} });
    mount();
    await settle();
    expect(orderText()).toBe(BASE.join(','));
    expect(localStorage.getItem('ktabs:ganit')).toBeNull();
  });

  it('reads the {data: {...}} envelope and a bare map alike', async () => {
    // The bare-map shape: axios body IS the module map, no envelope.
    api.get.mockResolvedValue({ data: { modules: { ganit: { order: ['products', 'invoices', 'expenses', 'bank'] } } } });
    mount();
    await settle();
    expect(orderText()).toBe('products,invoices,expenses,bank');
  });

  it('issues ONE GET however many module pages mount', async () => {
    api.get.mockResolvedValue({ data: {} });
    await act(() => root.render(
      <ToastProvider>
        <Probe moduleKey="ganit" />
        <Probe moduleKey="graha" base={['today', 'deals']} />
      </ToastProvider>,
    ));
    await settle();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/v1/me/tab-prefs');
  });

  it('survives a failed GET on the warm copy, silently', async () => {
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['bank', 'invoices', 'products', 'expenses'] }));
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount();
    await settle();
    expect(orderText()).toBe('bank,invoices,products,expenses');
    // No toast: a module page must not open with an error about a nicety.
    expect(container.querySelector('.tst')).toBeNull();
  });
});

describe('useTabPrefs — the default tab', () => {
  it('falls back to the page\'s own tab when nothing is saved', async () => {
    mount({ fallback: 'expenses' });
    expect(defText()).toBe('expenses');
  });

  it('falls back to the FIRST base tab when no fallback is given', async () => {
    mount();
    expect(defText()).toBe('invoices');
  });

  it('falls back when the saved default no longer exists', async () => {
    api.get.mockResolvedValue({ data: { ganit: { order: null, default_tab: 'retired' } } });
    mount({ fallback: 'products' });
    await settle();
    expect(defText()).toBe('products');
  });

  it('exposes the shipped arrangement as `standard`, untouched by the saved row', async () => {
    // The sheet's draft-only "Reset to standard" rearranges to THIS — it must
    // stay the page's own order even while a saved row reorders the strip.
    api.get.mockResolvedValue({ data: { ganit: { order: ['bank', 'invoices', 'products', 'expenses'], default_tab: 'bank' } } });
    mount({ fallback: 'expenses' });
    await settle();
    expect(orderText()).toBe('bank,invoices,products,expenses');
    expect(h.standard.order).toEqual(BASE);
    expect(h.standard.defaultTab).toBe('expenses');
  });
});

describe('useTabPrefs — save and reset', () => {
  it('PUTs {order, default_tab} to /v1/me/tab-prefs/<module>', async () => {
    api.put.mockResolvedValue({});
    mount();
    await settle();
    let ok;
    await act(async () => {
      ok = await h.save({ order: ['bank', 'invoices', 'products', 'expenses'], defaultTab: 'bank', forTeam: false });
    });
    expect(ok).toBe(true);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/v1/me/tab-prefs/ganit', {
      order: ['bank', 'invoices', 'products', 'expenses'],
      default_tab: 'bank',
    });
    await settle();
    expect(orderText()).toBe('bank,invoices,products,expenses');
    expect(JSON.parse(localStorage.getItem('ktabs:ganit')).default_tab).toBe('bank');
  });

  it('forTeam ALSO writes the org default row, same payload — and the ORG row goes first', async () => {
    // Org-first is the ordering that keeps the server honest with the screen:
    // personal-then-org meant an org failure left the personal row changed on
    // the server and unchanged locally.
    api.put.mockResolvedValue({});
    mount();
    await settle();
    await act(async () => {
      await h.save({ order: BASE, defaultTab: 'expenses', forTeam: true });
    });
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenNthCalledWith(1, '/v1/org/tab-prefs/ganit', { order: BASE, default_tab: 'expenses' });
    expect(api.put).toHaveBeenNthCalledWith(2, '/v1/me/tab-prefs/ganit', { order: BASE, default_tab: 'expenses' });
  });

  it('org fails, personal lands: the personal half applies locally and the toast names the team half', async () => {
    const NEXT = ['bank', 'invoices', 'products', 'expenses'];
    api.put.mockImplementation((url) => (url.startsWith('/v1/org/')
      ? Promise.reject({ response: { data: { detail: 'org denied' } } })
      : Promise.resolve({})));
    mount();
    await settle();
    let ok;
    await act(async () => {
      ok = await h.save({ order: NEXT, defaultTab: 'bank', forTeam: true });
    });
    expect(ok).toBe(false);
    await settle();
    // The write that SUCCEEDED is applied — the strip shows what the server holds.
    expect(orderText()).toBe(NEXT.join(','));
    expect(JSON.parse(localStorage.getItem('ktabs:ganit')).order).toEqual(NEXT);
    expect(container.textContent).toContain('Saved your tabs, but not the team default');
    expect(container.textContent).toContain('org denied');
  });

  it('personal fails after the org write landed: local state stays, and the toast says which half', async () => {
    api.put.mockImplementation((url) => (url.startsWith('/v1/me/')
      ? Promise.reject({ response: { data: { detail: 'me denied' } } })
      : Promise.resolve({})));
    mount();
    await settle();
    let ok;
    await act(async () => {
      ok = await h.save({ order: ['bank', 'invoices', 'products', 'expenses'], defaultTab: 'bank', forTeam: true });
    });
    expect(ok).toBe(false);
    // The personal row did not change on the server, so it must not change here.
    expect(orderText()).toBe(BASE.join(','));
    expect(container.textContent).toContain('Saved the team default, but not your own tabs');
  });

  it('both halves fail: nothing applies and the toast says neither landed', async () => {
    api.put.mockRejectedValue({ response: { status: 500 } });
    mount();
    await settle();
    let ok;
    await act(async () => {
      ok = await h.save({ order: ['bank', 'invoices', 'products', 'expenses'], defaultTab: 'bank', forTeam: true });
    });
    expect(ok).toBe(false);
    expect(orderText()).toBe(BASE.join(','));
    expect(container.textContent).toContain('neither your tabs nor the team default');
  });

  it('a failed save answers false, toasts the house error, and keeps the old order', async () => {
    api.put.mockRejectedValue({ response: { data: { detail: 'no row for you' } } });
    mount();
    await settle();
    let ok;
    await act(async () => {
      ok = await h.save({ order: ['bank', 'invoices', 'products', 'expenses'], defaultTab: 'bank' });
    });
    expect(ok).toBe(false);
    expect(orderText()).toBe(BASE.join(','));
    expect(container.textContent).toContain('Could not save your tabs');
    expect(container.textContent).toContain('no row for you');
  });

  it('reset() DELETEs the personal row, re-fetches past the cache, and lands on base when the server has nothing', async () => {
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['bank', 'invoices', 'products', 'expenses'], default_tab: 'bank' }));
    api.get
      .mockResolvedValueOnce({ data: { ganit: { order: ['bank', 'invoices', 'products', 'expenses'], default_tab: 'bank' } } })
      // After the DELETE nothing resolves underneath — no org default row.
      .mockResolvedValueOnce({ data: {} });
    api.delete.mockResolvedValue({});
    mount({ fallback: 'invoices' });
    await settle();
    expect(orderText()).toBe('bank,invoices,products,expenses');
    let ok;
    await act(async () => { ok = await h.reset(); });
    expect(ok).toBe(true);
    expect(api.delete).toHaveBeenCalledWith('/v1/me/tab-prefs/ganit');
    // The module cache held the pre-DELETE world; it must NOT be trusted.
    expect(api.get).toHaveBeenCalledTimes(2);
    await settle();
    expect(orderText()).toBe(BASE.join(','));
    expect(defText()).toBe('invoices');
    expect(localStorage.getItem('ktabs:ganit')).toBeNull();
    expect(container.textContent).toContain('Back to the standard tabs');
  });

  it('reset() applies the ORG default that was behind the personal row — and does not promise "standard"', async () => {
    api.get
      .mockResolvedValueOnce({ data: { ganit: { order: ['bank', 'invoices', 'products', 'expenses'], default_tab: 'bank' } } })
      // The personal DELETE uncovers the org default: the same GET now
      // resolves to the layer underneath, not to nothing.
      .mockResolvedValueOnce({ data: { ganit: { order: ['expenses', 'products', 'invoices', 'bank'], default_tab: 'expenses' } } });
    api.delete.mockResolvedValue({});
    mount({ fallback: 'invoices' });
    await settle();
    expect(orderText()).toBe('bank,invoices,products,expenses');
    let ok;
    await act(async () => { ok = await h.reset(); });
    expect(ok).toBe(true);
    await settle();
    // What the server RESOLVED, not the page's shipped order.
    expect(orderText()).toBe('expenses,products,invoices,bank');
    expect(defText()).toBe('expenses');
    expect(JSON.parse(localStorage.getItem('ktabs:ganit')).default_tab).toBe('expenses');
    // The toast must not claim the standard tabs when the org default won.
    expect(container.textContent).not.toContain('standard tabs');
    expect(container.textContent).toContain('team');
  });

  it('a failed re-read after a landed DELETE still drops the stale copy', async () => {
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['bank', 'invoices', 'products', 'expenses'] }));
    api.get
      .mockResolvedValueOnce({ data: { ganit: { order: ['bank', 'invoices', 'products', 'expenses'] } } })
      .mockRejectedValueOnce({ response: { status: 500 } });
    api.delete.mockResolvedValue({});
    mount({ fallback: 'invoices' });
    await settle();
    let ok;
    await act(async () => { ok = await h.reset(); });
    expect(ok).toBe(true);
    await settle();
    // The deleted row must not survive in any layer; the next good GET decides.
    expect(orderText()).toBe(BASE.join(','));
    expect(localStorage.getItem('ktabs:ganit')).toBeNull();
  });

  it('a failed reset answers false and toasts', async () => {
    api.delete.mockRejectedValue({ response: { status: 500 } });
    mount();
    await settle();
    let ok;
    await act(async () => { ok = await h.reset(); });
    expect(ok).toBe(false);
    expect(container.textContent).toContain('Could not reset your tabs');
  });
});

describe('useTabPrefs — a base that changes under a saved order (Dristi)', () => {
  it('keeps the arranged head and queues the newcomers', async () => {
    api.get.mockResolvedValue({ data: { dristi: { order: ['pivot', 'overview', 'revenue'] } } });
    await act(() => root.render(
      <ToastProvider>
        <Probe moduleKey="dristi" base={['overview', 'revenue', 'pivot']} fallback="overview" />
      </ToastProvider>,
    ));
    await settle();
    expect(orderText()).toBe('pivot,overview,revenue');
    // The catalogue lands: two tabs the row has never heard of.
    await act(() => root.render(
      <ToastProvider>
        <Probe moduleKey="dristi" base={['overview', 'revenue', 'pivot', 'analytics', 'clients']} fallback="overview" />
      </ToastProvider>,
    ));
    await settle();
    expect(orderText()).toBe('pivot,overview,revenue,analytics,clients');
  });
});
