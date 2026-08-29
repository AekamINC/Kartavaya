/**
 * Three client-billing dead ends, and the controls that end them.
 *
 * Found by proposal 93 Suite 17 driving the deployed product on 2026-08-29.
 * All three are one shape — the screen and the API disagree about what can be
 * asked — and none of them is visible in a row count.
 *
 *   1. AN ENDED SERVICE LINE HAD NO EDIT CONTROL. `COLUMNS_ENDED` was
 *      Client · Description · Amount · Period with no action cell, so a
 *      subscription that had been paused could not be reopened from the screen
 *      that draws it. `PATCH /v1/ganit/billing/service-lines/{id}` could always
 *      have done it — the door was missing, not the route.
 *
 *   2. CLEARING THE END DATE HAD TO REACH THE SERVER AS `null`. That is the
 *      only spelling the form has for "there is no end date", and the handler
 *      used to drop it. The UI half is asserted here; the server half is
 *      `backend/tests/test_client_billing_update_and_delete.py`.
 *
 *   3. THE METERED-USAGE PANEL COULD STRAND ITSELF IN A SKELETON FOREVER. The
 *      filter's onChange raised `loading` while the effect that clears it only
 *      re-runs when the filter's VALUE changes — so a change event carrying
 *      the value already held replaced the whole panel, Generate Invoice
 *      buttons and the filter itself included, with a spinner nothing could
 *      resolve. Measured on staging: 7 client groups and 7 Generate Invoice
 *      controls before, 0 of each and 37 skeleton nodes after. It read from
 *      outside as a MISSING CONTROL, which is the wrong diagnosis entirely.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not — the constraint the Graha suites
 * record and the sibling tests in this folder follow.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import ServiceLinesTab from '../ServiceLinesTab';
import MeteredUsageTab from '../MeteredUsageTab';

const PROFILES = [
  { id: 'pf-1', client_name: 'Acme Pvt Ltd', billing_cycle: 'monthly' },
];

/** One running line and one ENDED line — the second is the whole subject. */
const SERVICE_LINES = [
  {
    id: 'sl-1', profile_id: 'pf-1', client_name: 'Acme Pvt Ltd',
    kind: 'retainer', description: 'Monthly retainer', amount: 48000,
    cadence: 'monthly', period_start: '2026-08-01', period_end: null,
    auto_invoice: false,
  },
  {
    id: 'sl-2', profile_id: 'pf-1', client_name: 'Acme Pvt Ltd',
    kind: 'subscription', description: 'Paused subscription', amount: 22500,
    cadence: 'monthly', period_start: '2026-08-01', period_end: '2026-08-28',
    auto_invoice: false,
  },
];

const USAGE = [
  {
    id: 'us-1', profile_id: 'pf-1', client_name: 'Acme Pvt Ltd',
    metric: 'Consulting Hours', quantity: 12, unit: 'hours', rate: 1200,
    recorded_date: '2026-08-10', source_ref: 'timesheet/01', invoiced: false,
  },
];

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u.startsWith('/v1/ganit/billing/service-lines')) {
      return Promise.resolve({ data: { data: SERVICE_LINES } });
    }
    if (u.startsWith('/v1/ganit/billing/profiles')) {
      return Promise.resolve({ data: { data: PROFILES } });
    }
    if (u.startsWith('/v1/ganit/billing/metered-usage')) {
      return Promise.resolve({ data: { data: USAGE } });
    }
    return Promise.resolve({ data: { data: [] } });
  });
  api.patch.mockImplementation(() => Promise.resolve({ data: { id: 'sl-2' } }));
  api.post.mockImplementation(() => Promise.resolve({ data: { entries: 1, total: 1 } }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async (ui) => {
  await act(async () => { root.render(<ToastProvider>{ui}</ToastProvider>); });
  await settle();
};

const click = async (el) => {
  expect(el, 'tried to click a control that is not on the screen').toBeTruthy();
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/** Every row of the section whose heading starts with `head`. */
const sectionRows = (head) => {
  const h3 = [...container.querySelectorAll('h3.gn-section-head')]
    .find(h => h.textContent.trim().startsWith(head));
  if (!h3) return [];
  const wrap = h3.nextElementSibling;
  return wrap ? [...wrap.querySelectorAll('tbody tr')] : [];
};

const rowWith = (rows, text) => rows.find(r => r.textContent.includes(text));

const buttonsIn = (el) => [...el.querySelectorAll('button')];
const byText = (el, text) =>
  buttonsIn(el).find(b => b.textContent.trim() === text);

describe('a paused service line can be reopened from the screen that shows it', () => {
  it('renders an Edit control on an ENDED row, not only on an active one', async () => {
    await mount(<ServiceLinesTab />);

    const ended = sectionRows('Ended');
    expect(ended.length, 'the Ended section did not render at all, so this ' +
      'test is not looking at what it thinks it is').toBe(1);

    const row = rowWith(ended, 'Paused subscription');
    expect(byText(row, 'Edit'),
      'THE ENDED SERVICE-LINES TABLE HAS NO EDIT CONTROL. A subscription that ' +
      'has been paused cannot be reopened from the screen that shows it, so ' +
      'ending a line is a one-way door in the UI whatever the API allows.')
      .toBeTruthy();
  });

  it('gives the Ended table a header for the action cell it now renders', async () => {
    // ⚠ WITHOUT THIS THE TEST ABOVE IS HALF VACUOUS, AND THAT WAS MEASURED.
    //
    // `DataTable` builds the header row from its `columns` prop and takes the
    // BODY from its children, so adding a `<Td>` without adding a column leaves
    // the button on screen and the table one header short — every cell after it
    // sits under the wrong heading. The mutation that dropped the trailing ''
    // from `COLUMNS_ENDED` left the Edit-control test GREEN; this is the check
    // that makes it red, and it is what holds the one-row contract.
    await mount(<ServiceLinesTab />);

    for (const head of ['Active', 'Ended']) {
      const h3 = [...container.querySelectorAll('h3.gn-section-head')]
        .find(h => h.textContent.trim().startsWith(head));
      const table = h3.nextElementSibling.querySelector('table');
      const headers = table.querySelectorAll('thead th').length;
      for (const tr of table.querySelectorAll('tbody tr')) {
        expect(tr.querySelectorAll('td').length,
          `the ${head} table draws ${headers} headers over a row of ` +
          `${tr.querySelectorAll('td').length} cells, so at least one column ` +
          'of it is sitting under the wrong heading').toBe(headers);
      }
    }
  });

  it('offers a Resume control that clears the end date in one press', async () => {
    // ⚠ THIS IS THE ONLY ROUTE A PERSON ACTUALLY HAS, AND THAT IS MEASURED.
    //
    // The editor's Period End picker has a real Clear button, and inside this
    // modal it CANNOT BE CLICKED: at 1280×720 the panel spans y 203–517, the
    // 316px popover flips up to y 65–381, and Clear lands at y 106–133 —
    // outside `.modal__panel` (overflow:hidden) and `.modal__body`
    // (overflow:auto), where `document.elementFromPoint` returns
    // `div.modal__scrim`. A person clicking there closes the modal. That is a
    // shared-picker defect reported on its own; this control is what makes the
    // flow completable meanwhile, and it is the verb §10 asks for.
    await mount(<ServiceLinesTab />);
    const row = rowWith(sectionRows('Ended'), 'Paused subscription');
    const btn = byText(row, 'Resume');
    expect(btn, 'an ended service line offers no Resume control, so a paused subscription ' +
      'cannot be put back into billing').toBeTruthy();

    await click(btn);

    expect(api.patch).toHaveBeenCalledTimes(1);
    const [url, payload] = api.patch.mock.calls[0];
    expect(url).toBe('/v1/ganit/billing/service-lines/sl-2');
    expect(payload.period_end,
      'Resume did not send `period_end: null` — the server tells an omitted key from an ' +
      'explicit null by `model_fields_set`, and only the explicit null clears the column')
      .toBeNull();
    expect(Object.keys(payload), 'Resume sent fields other than the end date, so it would ' +
      'overwrite edits made since').toEqual(['period_end']);
  });

  it('clearing the Period End date PATCHes period_end as null, not as ""', async () => {
    await mount(<ServiceLinesTab />);
    await click(byText(rowWith(sectionRows('Ended'), 'Paused subscription'), 'Edit'));

    const modal = document.querySelector('[role="dialog"]');
    expect(modal, 'the editor did not open').toBeTruthy();

    // The Period End field's own trigger, then its Clear.
    const field = [...modal.querySelectorAll('label.fld')]
      .find(l => l.textContent.includes('Period End'));
    expect(field, 'the editor offers no Period End field').toBeTruthy();
    await click(field.querySelector('button.pk__tr'));
    const clear = [...field.querySelectorAll('button.pk__q')]
      .find(b => b.textContent.trim() === 'Clear');
    expect(clear, 'the date picker offers no Clear, so an end date once set ' +
      'can never be removed').toBeTruthy();
    await click(clear);

    await click(byText(modal, 'Save'));

    expect(api.patch).toHaveBeenCalledTimes(1);
    const [url, payload] = api.patch.mock.calls[0];
    expect(url).toBe('/v1/ganit/billing/service-lines/sl-2');
    // `null`, and the distinction matters: the server tells an omitted key from
    // an explicit null by `model_fields_set`, and `''` would be neither.
    expect(payload.period_end,
      'the resume did not send `period_end: null`, which is the only way the ' +
      'form can say "there is no end date"').toBeNull();
    expect(Object.prototype.hasOwnProperty.call(payload, 'period_end'),
      'the key was omitted rather than sent as null — the server would then ' +
      'read it as "say nothing about the end date" and leave the line ended')
      .toBe(true);
  });
});

describe('the metered-usage panel cannot strand itself in a spinner', () => {
  it('keeps the Generate Invoice control when the filter is re-picked at its current value', async () => {
    await mount(<MeteredUsageTab />);

    const before = buttonsIn(container).filter(
      b => /Generate Invoice|Generating/.test(b.textContent));
    expect(before.length, 'the panel offered no Generate Invoice control even ' +
      'before the filter was touched, so this test is not looking at what it ' +
      'thinks it is').toBe(1);

    // EXACTLY what a `selectOption` does: set the value the select already
    // holds and fire `change`. React's onChange runs, and before the fix
    // `loading` went true with nothing left to lower it.
    const select = container.querySelector('select.gn-bar__sel');
    expect(select.value).toBe('unbilled');
    await act(async () => {
      select.value = 'unbilled';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    const after = buttonsIn(container).filter(
      b => /Generate Invoice|Generating/.test(b.textContent));
    expect(after.length,
      'THE PANEL IS STUCK IN A SKELETON. Re-picking the filter value it ' +
      'already held raised `loading` and nothing lowered it: the client ' +
      'groups, the Generate Invoice buttons and the filter itself are all ' +
      'gone, and only a page reload brings them back. A spinner that never ' +
      'resolves reads from outside as a missing control.').toBe(1);
    expect(container.querySelector('select.gn-bar__sel'),
      'the filter that got the user here is gone too, so there is no way back')
      .toBeTruthy();
  });

  it('tells the firm what the generated invoice is actually worth', async () => {
    // ⚠ FOUND WHILE FIXING THE CONTROL THAT MADE THIS LINE REACHABLE.
    //
    // `api` is a bare axios instance, so the payload is at `.data` — and this
    // handler read `res.entries` and `res.total` off the ENVELOPE. Neither
    // exists there, and `inr(undefined)` returns ₹0 rather than NaN, so the
    // toast said "Invoice created: undefined entries, ₹0" about a real tax
    // invoice. A wrong figure that looks like a figure is worse than one that
    // looks broken.
    api.post.mockImplementation(() => Promise.resolve({
      data: { invoice_id: 'inv-1', invoice_number: 'UNX-2026-0054',
              entries: 3, subtotal: 43200, total: 50976 },
    }));
    await mount(<MeteredUsageTab />);

    const gen = buttonsIn(container).find(b => /Generate Invoice/.test(b.textContent));
    await click(gen);

    const toast = document.body.textContent;
    expect(toast).toContain('3 entries');
    expect(toast).toContain('50,976');
    expect(toast, 'the toast read the axios envelope, so the firm is told its ' +
      'new tax invoice is worth ₹0').not.toContain('undefined');
  });

  it('still shows a skeleton while a REAL filter change is in flight', async () => {
    // ⚠ THE OTHER HALF, AND IT HAS TO BE A REAL CHANGE AFTER MOUNT.
    //
    // The fix moved `setLoading(true)` into `load`; it must not have DELETED
    // the loading state, or a pending refetch renders the previous filter's
    // rows and the customer reads last question's answer as this one's. A
    // version of this test that only checked the FIRST mount stayed green when
    // `setLoading(true)` was removed entirely — `useState(true)` covers the
    // first paint on its own — so it is deliberately driven from an
    // already-settled panel through a genuine unbilled → all change.
    let release = null;
    await mount(<MeteredUsageTab />);
    expect(container.querySelector('select.gn-bar__sel'),
      'the panel never settled, so a later skeleton would prove nothing')
      .toBeTruthy();

    api.get.mockImplementation((url) => {
      if (String(url).startsWith('/v1/ganit/billing/metered-usage')) {
        return new Promise((resolve) => {
          release = () => resolve({ data: { data: USAGE } });
        });
      }
      return Promise.resolve({ data: { data: PROFILES } });
    });

    const select = container.querySelector('select.gn-bar__sel');
    await act(async () => {
      select.value = 'all';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(2);

    expect(container.querySelector('select.gn-bar__sel'),
      'the filter changed, the refetch has not answered, and the panel is ' +
      'still painting the PREVIOUS filter\'s rows as though they were the ' +
      'answer to the new question').toBeFalsy();

    await act(async () => { release(); });
    await settle();
    expect(container.querySelector('select.gn-bar__sel'),
      'the fetch answered and the skeleton never cleared').toBeTruthy();
  });
});
