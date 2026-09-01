/**
 * Vikray has Clients and Contacts — beside Customers, never instead of it.
 *
 * The owner's brief: "my brief for contact and client needs to be inside in
 * sales and ganit same as same crm". Sales had one tab that LOOKED like an
 * answer and was not: `CustomersTab` GROUPs `vikray_orders`, so it lists who
 * has bought and cannot list a company that has never ordered. It answers
 * "trading history". The brief asks for the company record.
 *
 * So the module now carries three, and this file holds all three at once —
 * deleting `customers` to "tidy up" is the regression it exists to catch.
 *
 * It also holds the `crm` prop, which is the whole reason the two tabs can be
 * ONE component rather than a fork: the CRM's own working objects (the contact
 * timeline, lead conversion) are still `graha`-gated on the server, so outside
 * Graha the controls that call them are not rendered. A firm on Sales alone
 * must not be shown a button that 403s.
 *
 * ── AND ONE THING IT FOUND ─────────────────────────────────────────────────
 * Opening a contact record threw "Rendered fewer hooks than expected": the
 * list's `useTableView` — five useStates and four useMemos — was called BELOW
 * the `if (detail)` early return, so the detail branch rendered nine fewer
 * hooks than the list and React refused the update. The record screen could not
 * open, in Graha either. The hook moved above the return; the two tests at the
 * bottom of this file are what hold it there.
 *
 * Rendered with react-dom directly — the `@testing-library/dom` peer is not
 * installed, per `vikrayTabStates.test.jsx`.
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
import VikrayPage from '../../VikrayPage';
import ContactsTab from '../../graha/ContactsTab';

/** Every tab Vikray shipped before this change, as rendered. */
const PRE_EXISTING = [
  'dashboard', 'orders', 'stock', 'pipeline', 'targets', 'customers',
  'analytics',
];

const CONTACT = {
  id: 'ct-1', name: 'Priya Sharma', email: 'priya@acme.test', phone: null,
  company: 'Acme Pvt Ltd', client_id: 'cl-1', client_name: 'Acme Pvt Ltd',
  contact_type: 'lead', source: 'referral', lead_score: 40,
};

let container = null;
let root = null;

const answer = (url) => {
  if (url.startsWith('/v1/me/tab-prefs')) return { data: { modules: {} } };
  if (url.startsWith('/v1/vikray/dashboard')) {
    return { data: {
      total_orders: 0, open_deals: 0, pipeline_value: 0,
      order_value: 0, total_revenue: 0, collected: 0,
    } };
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

const render = async (node) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{node}</ToastProvider></MemoryRouter>);
  });
  await settle();
};

/** Open the More popover if there is one, so every tab is in the DOM. */
const openOverflow = async () => {
  const more = container.querySelector('.mt__more');
  if (more && more.getAttribute('aria-expanded') !== 'true') {
    await act(async () => { more.click(); });
  }
};

const tabLabels = async () => {
  await openOverflow();
  return [
    ...container.querySelectorAll('[role="tab"] .mt__en'),
    ...container.querySelectorAll('[role="menuitem"] .mt__pop-en'),
  ].map(n => n.textContent.trim());
};

const openTab = async (label) => {
  await openOverflow();
  const hit = [
    ...container.querySelectorAll('[role="tab"], [role="menuitem"]'),
  ].find(b => b.textContent.trim().startsWith(label));
  expect(hit, `no tab labelled "${label}"`).toBeTruthy();
  await act(async () => { hit.click(); });
  await settle();
};

const urls = () => api.get.mock.calls.map(c => String(c[0]));

describe('Vikray · clients and contacts, beside customers', () => {
  it('offers all three', async () => {
    await render(<VikrayPage />);
    const labels = await tabLabels();
    expect(labels).toContain('clients');
    expect(labels).toContain('contacts');
    // THE ONE THAT MUST NOT BE TRADED AWAY. `customers` is trading history
    // derived from vikray_orders; `clients` is the company record. Two
    // questions, two tabs.
    expect(labels).toContain('customers');
  });

  it('keeps every tab it already had', async () => {
    await render(<VikrayPage />);
    const labels = await tabLabels();
    PRE_EXISTING.forEach(id => expect(labels).toContain(id));
  });

  it('the Clients tab is the CRM component — it reads /v1/graha/clients', async () => {
    await render(<VikrayPage />);
    await openTab('clients');
    expect(urls().some(u => u.startsWith('/v1/graha/clients'))).toBe(true);
    expect(urls().some(u => u.startsWith('/v1/vikray/clients'))).toBe(false);
  });

  it('the Contacts tab is the CRM component — it reads /v1/graha/contacts', async () => {
    await render(<VikrayPage />);
    await openTab('contacts');
    expect(urls().some(u => u.startsWith('/v1/graha/contacts'))).toBe(true);
  });

  it('Customers still reads its own endpoint, unchanged', async () => {
    await render(<VikrayPage />);
    await openTab('customers');
    expect(urls().some(u => u.startsWith('/v1/vikray/customers'))).toBe(true);
  });
});

describe('ContactsTab · one component, `crm` decides the CRM-only controls', () => {
  const openRecord = async () => {
    const link = container.querySelector('.gr__link');
    expect(link, 'the contact row did not render').toBeTruthy();
    await act(async () => { link.click(); });
    await settle();
  };

  const withDetail = () => {
    api.get.mockImplementation((url) => {
      const u = String(url);
      if (/\/v1\/graha\/contacts\/[^/]+$/.test(u)) {
        return Promise.resolve({ data: { contact: CONTACT, deals: [],
          activities: [], follow_ups: [], labels: [] } });
      }
      if (u.startsWith('/v1/graha/contacts')) {
        return Promise.resolve({ data: { data: [CONTACT] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
  };

  it('inside the CRM it offers conversion and loads the timeline', async () => {
    withDetail();
    await render(<ContactsTab />);
    await openRecord();

    // Renamed by migration 254 — the lead becomes a contact AT a client,
    // and the client is the customer.
    expect(container.textContent).toContain('Convert to client');
    expect(container.textContent).not.toContain('Convert to Customer');
    expect(urls().some(u => u.includes('/timeline'))).toBe(true);
  });

  it('outside the CRM it offers neither — those routes are graha-gated', async () => {
    withDetail();
    await render(<ContactsTab crm={false} />);
    await openRecord();

    // Both would answer 403 for a firm that never bought the CRM, and the
    // timeline panel renders a full ErrorState on one — a loud, wrong "this
    // failed" on a screen that worked.
    expect(container.textContent).not.toContain('Convert to Customer');
    expect(urls().some(u => u.includes('/timeline'))).toBe(false);

    // And everything that is about the PERSON is still there. The prop hides
    // controls; it must not produce a second, thinner contact screen.
    expect(container.textContent).toContain('Priya Sharma');
    expect(container.textContent).toContain('Statement of account');
    expect(container.textContent).toContain('Edit');
  });
});
