/**
 * A sales order has a URL.
 *
 * It did not. `OrdersTab` rendered `OrderDetail` from an id held in
 * `VikrayPage.openOrderId`, so the open order existed nowhere but in memory: a
 * salesperson could not bookmark one, send one to a colleague, press Back out
 * of one, or reload without losing their place, and every notification or
 * email that wanted to deep-link to an order had nowhere to point.
 *
 * Five facts, one per way that defect showed:
 *
 *   1. a row click NAVIGATES — the URL is the record's address, not a piece of
 *      tab state;
 *   2. the module shell's older drill-in (`openId`, still set by the
 *      Dashboard, Pipeline and Customers tabs through `VikrayPage`) funnels
 *      into the SAME navigation, so there are not two ways to open one record
 *      that can disagree — and the shell's copy is cleared, or a stale id
 *      would reopen the drawer on a later visit;
 *   3. landing on the URL cold — a fresh tab, no list behind it — renders the
 *      record, because the route fetches by the id in the path;
 *   4. a missing or forbidden id renders an honest empty state with a way
 *      back, not a blank drawer;
 *   5. a malformed id is never sent. The endpoint casts the segment straight
 *      to `$1::uuid`, so a typo is a 500 — reported to the reader as our
 *      outage when the truth is the link is wrong.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, the constraint the sibling suites
 * record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import OrderRoute from '../OrderRoute';
import OrdersTab from '../OrdersTab';

const ID = '2b7d41c8-9a0e-4d3f-8b21-5c6e7f809a1b';

const ORDER = {
  id: ID,
  order_number: 'SO-2026-0042',
  status: 'draft',
  order_date: '2026-08-14',
  contact_name: 'Priya Sharma',
  contact_company: 'Ratan Steel Pvt Ltd',
  line_items: [],
  subtotal: 100000, cgst: 9000, sgst: 9000, igst: 0, is_igst: false,
  discount: 0, total: 118000,
};

function answer(url) {
  if (url === '/v1/vikray/orders') return Promise.resolve({ data: { data: [ORDER] } });
  if (url.startsWith(`/v1/vikray/orders/${ID}`)) return Promise.resolve({ data: ORDER });
  // Two separate reads now, and they used to be one. `loadProducts` reads the
  // SHARED catalogue (`/v1/products`, gated Ganit OR Vikray); `probeGanit` asks
  // a Finance-only endpoint whether this firm holds Finance at all.
  if (url.startsWith('/v1/products')) return Promise.resolve({ data: { data: [] } });
  if (url.startsWith('/v1/ganit/invoices')) return Promise.resolve({ data: { data: [] } });
  return Promise.resolve({ data: { data: [] } });
}

let here = null;
function Probe() {
  here = useLocation();
  return null;
}

/** The module page, stubbed — see the note in `graha/__tests__/dealRoute`. */
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

const mountAt = async (path) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Probe />
          <Routes>
            <Route path="/vikray" element={<Shell />}>
              <Route path="orders/:orderId" element={<OrderRoute />} />
            </Route>
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await settle();
};

const mountTab = async (props = {}) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/vikray']}>
        <ToastProvider>
          <Probe />
          <OrdersTab onStatus={() => {}} {...props} />
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await settle();
};

const drawer = () => document.querySelector('[role="dialog"]');
const drawerText = () => drawer()?.textContent || '';
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};
const orderReads = () => api.get.mock.calls
  .map(c => String(c[0]))
  .filter(u => /^\/v1\/vikray\/orders\/[^?]/.test(u));

describe('Vikray · an order is a URL', () => {
  it('renders the record on a cold arrival, with no list behind it', async () => {
    await mountAt(`/vikray/orders/${ID}`);

    expect(orderReads()).toEqual([`/v1/vikray/orders/${ID}`]);
    expect(drawerText()).toContain('SO-2026-0042');
    expect(drawerText()).toContain('Ratan Steel Pvt Ltd');
  });

  it('opens from the list by navigating, so the address bar keeps up', async () => {
    await mountTab();

    const row = container.querySelector('.vko__row');
    expect(row).toBeTruthy();
    await click(row);

    // Was: `onOpen(id)` set a field on the module page and the drawer appeared
    // over a URL that still said `/vikray`.
    expect(here.pathname).toBe(`/vikray/orders/${ID}`);
  });

  it('funnels the module shell’s drill-in into the same navigation', async () => {
    const onOpen = vi.fn();
    await mountTab({ openId: ID, onOpen });

    // The Dashboard, Pipeline and Customers tabs still say "open this order"
    // through `VikrayPage`. One destination, several doors — and the shell's
    // copy of the id is dropped, so returning to this tab later does not
    // reopen a record nobody asked for.
    expect(here.pathname).toBe(`/vikray/orders/${ID}`);
    expect(onOpen).toHaveBeenCalledWith(null);
    // And the tab itself no longer draws the record — one component does.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('says a cancelled or forbidden order is gone, and offers the way back', async () => {
    api.get.mockImplementation(url => (
      url.startsWith(`/v1/vikray/orders/${ID}`)
        ? Promise.reject({ response: { status: 404 } })
        : answer(url)
    ));

    await mountAt(`/vikray/orders/${ID}`);

    expect(drawer()).toBeTruthy();
    expect(drawerText()).toContain('doesn’t exist');
    expect(drawerText()).toContain('Back to orders');
    expect(drawerText()).not.toContain('Line items');
  });

  it('never sends a malformed id to the server', async () => {
    await mountAt('/vikray/orders/not-a-real-id');

    // `$1::uuid` on a bad segment is a cast failure — a 500, which `errorKind`
    // reads as "something broke on our side, not yours". Nothing broke.
    expect(orderReads()).toEqual([]);
    expect(drawerText()).toContain('doesn’t exist');
  });
});
