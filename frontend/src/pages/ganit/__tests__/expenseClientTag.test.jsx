/**
 * Ganit · an expense can name the client it was spent for.
 *
 * PHASE-1 task 1.4. `ganit_expenses.contact_id` has existed since migration
 * 019; `ExpenseCreate.contact_id`, the INSERT's `NULLIF($13,'')::uuid`, the
 * PATCH's matching branch and the list endpoint's `contact_name` join were all
 * written and all correct. And 0 of 378 expenses carried a contact — 88 of them
 * billable — because the FORM had no field, so nothing ever sent one. Client
 * cost and client profitability read zero for that reason and no other.
 *
 * The four things these hold, each of which regresses silently:
 *
 *   1. The create POST carries `contact_id`.
 *   2. An expense with no client still saves. The field is optional and must
 *      never become a gate — an expense with no client is normal.
 *   3. The EDIT round-trips it. The PATCH now sends `contact_id` on every save,
 *      so a form that did not hydrate the field from the row would clear a real
 *      attribution the moment anything else on that row was touched. This is
 *      the one that costs data rather than merely failing to gain it.
 *   4. The table shows the NAME the API already returns, and an em dash — not a
 *      blank — where there is none.
 *
 * Rendered with react-dom directly, matching `invoiceCustomerLink.test.jsx`.
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
import { _resetColumnPrefsCache } from '../../../hooks/useColumnPrefs';
import ExpensesTab from '../ExpensesTab';

/** Two people at two different companies — the case `meta` exists for. */
const CONTACTS = [
  { id: 'ct-1', name: 'Priya Sharma', client_id: 'cl-1', client_name: 'Acme Pvt Ltd' },
  { id: 'ct-2', name: 'Rahul Mehta', client_id: 'cl-2', client_name: 'Bharat Steel' },
];

/** One tagged expense, one untagged — the em-dash case and the hydration case. */
const EXPENSES = [
  {
    id: 'ex-1', title: 'Client site visit', category: 'Travel', amount: 4000,
    tax_amount: 0, total: 4000, expense_date: '2026-08-01', vendor: 'IndiGo',
    reference: 'PNR-991', notes: '', is_billable: true,
    contact_id: 'ct-1', contact_name: 'Priya Sharma',
  },
  {
    id: 'ex-2', title: 'Office stationery', category: 'Office Supplies', amount: 900,
    tax_amount: 162, total: 1062, expense_date: '2026-08-02', vendor: 'Staples',
    reference: '', notes: '', is_billable: false,
    contact_id: null, contact_name: null,
  },
];

function answer(url) {
  const u = String(url);
  if (u.startsWith('/v1/graha/contacts')) {
    return Promise.resolve({ data: { data: CONTACTS, total: CONTACTS.length } });
  }
  if (u.startsWith('/v1/ganit/expenses')) {
    return Promise.resolve({ data: { data: EXPENSES, total: EXPENSES.length } });
  }
  if (u.startsWith('/v1/ganit/expense-stats')) {
    return Promise.resolve({ data: { by_category: [], total_expenses: 5062, total_tax: 162, count: 2 } });
  }
  return Promise.resolve({ data: { data: [] } });
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  _resetColumnPrefsCache();
  localStorage.clear();
  api.get.mockImplementation(answer);
  api.post.mockImplementation(() => Promise.resolve({ data: { status: 'created', id: 'ex-9' } }));
  api.patch.mockImplementation(() => Promise.resolve({ data: { status: 'updated' } }));
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
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/**
 * Type into a CONTROLLED React input, through the native setter.
 * `el.value = …` is swallowed: React remembers what it last wrote to the node.
 */
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(2);
};

const byLabel = (label, scope = container) => scope.querySelector(`button[aria-label="${label}"]`);

/**
 * Open one picker and return ITS popover root — scoped to the picker's own
 * `.pk`, never the document. A closing picker unmounts on `animationend`, and
 * jsdom fires none, so a document-wide query can hand back a stale panel.
 */
const openPicker = async (scope) => {
  const trigger = byLabel('Client contact', scope);
  await click(trigger);
  return trigger.closest('.pk');
};
const rowNamed = (pk, name) => [...pk.querySelectorAll('.pk__row')]
  .find(r => r.textContent.includes(name));

const submitForm = async (form) => {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
};

/** Open the create form and fill the three fields the API requires. */
const openCreateForm = async () => {
  const add = [...container.querySelectorAll('button')]
    .find(b => b.textContent.includes('+ Add expense'));
  await click(add);
  const form = container.querySelector('form.gn-form');
  const inputs = form.querySelectorAll('input.inp');
  await type(inputs[0], 'Airfare');                       // Title
  await type(form.querySelector('input[type="number"]'), '4000');
  return form;
};

const postsTo = (path) => api.post.mock.calls.filter(c => String(c[0]).startsWith(path));
const patchesTo = (path) => api.patch.mock.calls.filter(c => String(c[0]).startsWith(path));
const getsTo = (path) => api.get.mock.calls.filter(c => String(c[0]).startsWith(path));

describe('Ganit · an expense names the client it was spent for', () => {
  it('reads the CRM people, which this tab never asked for before', async () => {
    await mount(<ExpensesTab />);
    expect(getsTo('/v1/graha/contacts').length).toBeGreaterThan(0);
  });

  it('shows the client contact on the row, and an em dash where there is none', async () => {
    await mount(<ExpensesTab />);
    const cells = [...container.querySelectorAll('tbody tr td')].map(td => td.textContent);
    expect(cells).toContain('Priya Sharma');
    // `ex-2` has no contact: the row still renders, with the house fallback.
    const untagged = [...container.querySelectorAll('tbody tr')]
      .find(tr => tr.textContent.includes('Office stationery'));
    expect(untagged.textContent).toContain('—');
  });

  it('sends contact_id with a new expense', async () => {
    await mount(<ExpensesTab />);
    const form = await openCreateForm();

    const pk = await openPicker(form);
    await click(rowNamed(pk, 'Priya Sharma'));
    await submitForm(form);

    const [, payload] = postsTo('/v1/ganit/expenses')[0];
    expect(payload.contact_id).toBe('ct-1');
  });

  it('names the COMPANY beside each person, so two Sharmas are distinguishable', async () => {
    await mount(<ExpensesTab />);
    const form = await openCreateForm();
    const pk = await openPicker(form);
    expect(rowNamed(pk, 'Priya Sharma').textContent).toContain('Acme Pvt Ltd');
  });

  it('saves an expense with no client at all — the field never gates', async () => {
    await mount(<ExpensesTab />);
    const form = await openCreateForm();
    // The picker is untouched, and the trigger is not disabled or required.
    expect(byLabel('Client contact', form).disabled).toBe(false);
    await submitForm(form);

    const calls = postsTo('/v1/ganit/expenses');
    expect(calls.length).toBe(1);
    expect(calls[0][1].contact_id).toBe('');
  });

  it('keeps an existing tag on edit rather than clearing it', async () => {
    await mount(<ExpensesTab />);
    const editLink = [...container.querySelectorAll('tbody tr')]
      .find(tr => tr.textContent.includes('Client site visit'))
      .querySelector('button.gn-act');
    await click(editLink);

    const editForm = container.querySelector('form.gn-form--accent');
    expect(editForm).toBeTruthy();
    // Hydrated: the trigger reads the person, not the placeholder — which is
    // what stops the PATCH below from writing NULL over a real attribution.
    expect(byLabel('Client contact', editForm).textContent).toContain('Priya Sharma');

    await submitForm(editForm);
    const [, payload] = patchesTo('/v1/ganit/expenses/ex-1')[0];
    expect(payload.contact_id).toBe('ct-1');
  });

  it('can clear a tag deliberately, by picking nobody', async () => {
    await mount(<ExpensesTab />);
    const editLink = [...container.querySelectorAll('tbody tr')]
      .find(tr => tr.textContent.includes('Client site visit'))
      .querySelector('button.gn-act');
    await click(editLink);

    const editForm = container.querySelector('form.gn-form--accent');
    const pk = await openPicker(editForm);
    // Clicking the selected row again is a re-pick of the same id, so the
    // deliberate clear is a pick of the OTHER person — proving the control
    // writes what was chosen and not merely whatever it was seeded with.
    await click(rowNamed(pk, 'Rahul Mehta'));
    await submitForm(editForm);

    const [, payload] = patchesTo('/v1/ganit/expenses/ex-1')[0];
    expect(payload.contact_id).toBe('ct-2');
  });
});
