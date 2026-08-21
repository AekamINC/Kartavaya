/**
 * Ganit has Clients and Contacts, and they are the CRM's own components.
 *
 * The owner's brief, repeated: "my brief for contact and client needs to be
 * inside in sales and ganit same as same crm". What shipped against it the
 * first time was an inline "add a client" button inside the invoice form —
 * a create path, not the two tabs he asked for, and nothing at all for a firm
 * that wants to LOOK at its customers.
 *
 * `graha_clients` is THE company record for the whole product. Finance bills
 * it. Until now Finance had no door to it.
 *
 * ── WHAT THIS FILE HOLDS ───────────────────────────────────────────────────
 *   1. Both tabs exist on the page.
 *   2. They render `pages/graha/*` — the SAME components, not copies. The
 *      assertion is the request each tab issues: a fork would drift, and the
 *      first thing to drift is the endpoint.
 *   3. The tabs Ganit already had are all still there. Adding two must not
 *      quietly cost one.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not — the constraint every Graha and
 * Vikray suite in this repo records.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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
import GanitPage from '../../GanitPage';

/** Every tab Ganit shipped before this change, AS RENDERED. None may be lost.
 *
 *  The labels are not the ids: `tabEn` turns `e-sign` into `e sign`, and
 *  `GanitPage` relabels `stats` to "GST filing" because that is what the panel
 *  actually opens. Written out rather than derived, so a tab that silently
 *  disappears cannot take its own expectation with it. */
const PRE_EXISTING = [
  'invoices', 'products', 'expenses', 'payables', 'contracts', 'e sign',
  'collections', 'recurring', 'bank', 'timesheet', 'GST filing', 'analytics',
];

let container = null;
let root = null;

const answer = (url) => {
  if (url.startsWith('/v1/me/tab-prefs')) return { data: { modules: {} } };
  if (url.startsWith('/v1/ganit/stats')) {
    return { data: {
      total_outstanding: 0, unpaid_count: 0, total_invoices: 0,
      overdue_count: 0, total_collected: 0,
    } };
  }
  if (url.startsWith('/v1/ganit/payables-summary')) {
    return { data: { outstanding: 0, open_bills: 0 } };
  }
  return { data: { data: [] } };
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetTabPrefsCache();
  localStorage.clear();
  api.get.mockImplementation((url) => Promise.resolve(answer(String(url))));
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

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter><ToastProvider><GanitPage /></ToastProvider></MemoryRouter>,
    );
  });
  await settle();
};

/**
 * Every tab the strip offers, whether inline or behind More.
 *
 * `ModuleTabs` puts the first `max` inline and the rest in a popover, and the
 * split depends on a ResizeObserver measurement that jsdom does not make. A
 * test that read only the inline row would pass or fail on that measurement
 * rather than on the tab list, so this opens the popover when there is one.
 */
const tabLabels = async () => {
  const more = container.querySelector('.mt__more');
  if (more && more.getAttribute('aria-expanded') !== 'true') {
    await act(async () => { more.click(); });
  }
  return [
    ...container.querySelectorAll('[role="tab"] .mt__en'),
    ...container.querySelectorAll('[role="menuitem"] .mt__pop-en'),
  ].map(n => n.textContent.trim());
};

/** Click a tab by its label, wherever it is rendered. */
const openTab = async (label) => {
  const more = container.querySelector('.mt__more');
  if (more && more.getAttribute('aria-expanded') !== 'true') {
    await act(async () => { more.click(); });
  }
  const hit = [
    ...container.querySelectorAll('[role="tab"], [role="menuitem"]'),
  ].find(b => b.textContent.trim().startsWith(label));
  expect(hit, `no tab labelled "${label}"`).toBeTruthy();
  await act(async () => { hit.click(); });
  await settle();
};

const urls = () => api.get.mock.calls.map(c => String(c[0]));

describe('Ganit · clients and contacts are first-class tabs', () => {
  it('offers both tabs', async () => {
    await mount();
    const labels = await tabLabels();
    expect(labels).toContain('clients');
    expect(labels).toContain('contacts');
  });

  it('keeps every tab it already had', async () => {
    await mount();
    const labels = await tabLabels();
    PRE_EXISTING.forEach(id => expect(labels).toContain(id));
  });

  it('the Clients tab is the CRM component — it reads /v1/graha/clients', async () => {
    await mount();
    await openTab('clients');
    expect(urls().some(u => u.startsWith('/v1/graha/clients'))).toBe(true);
    // A fork that duplicated the list against a Ganit endpoint would pass the
    // tab-exists test above and fail here, which is the point.
    expect(urls().some(u => u.startsWith('/v1/ganit/clients'))).toBe(false);
  });

  it('the Contacts tab is the CRM component — it reads /v1/graha/contacts', async () => {
    await mount();
    await openTab('contacts');
    expect(urls().some(u => u.startsWith('/v1/graha/contacts'))).toBe(true);
  });
});
