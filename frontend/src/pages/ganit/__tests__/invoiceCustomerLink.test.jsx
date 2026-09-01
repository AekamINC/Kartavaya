/**
 * Ganit's invoice form names a CRM company, and can create one without leaving.
 *
 * The owner's ask, 2026-08-20: "ganit should be able to add client, contact
 * same as crm and in sync, so if client added via invoice it auto gets seen in
 * crm or sales."
 *
 * What stood here instead: one bare `<select>` of contacts with no create path,
 * and a payload that never carried `client_id` at all — so no invoice this
 * product has ever created is attached to a company. That NULL is why
 * receivables ageing files them all under a literal "Unlinked client", why
 * Client 360 reports zero against the customer, and why every Niyam rule keyed
 * on `client_id` has never fired.
 *
 * The four things these hold, all of which regress silently:
 *
 *   1. The invoice POST carries the company.
 *   2. Ganit does not INSERT a company or a contact — it calls the CRM's own
 *      endpoints. One table, one writer; that is what makes "in sync" true by
 *      construction rather than by two INSERTs kept identical by hand.
 *   3. A person created from an invoice is filed as a CUSTOMER. The endpoint
 *      defaults `contact_type` to 'lead', and a lead default here quietly
 *      poisons every lead list and the lead scoring behind it.
 *   4. Two writes now stand where one did. A refused invoice must not create a
 *      second company on the retry.
 *
 * And one that is not about correctness but about duplicates: the pickers ask
 * the SERVER to narrow the list. `GET /v1/graha/contacts` stops at 200 and this
 * product already has an org with 292 live contacts — filtering that truncated
 * array in the browser hides 92 people silently, and a user who cannot find a
 * customer creates a second copy of them.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, the constraint the Graha suites
 * record.
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
import InvoiceForm from '../InvoiceForm';

/** 27 = Maharashtra. The prefix is what derives place of supply. */
const ORG_GSTIN = '27AAAAA0000A1Z5';

const CONTACTS = [
  { id: 'ct-1', name: 'Priya Sharma', gstin: '27BBBBB1111B1Z5', client_id: 'cl-1', client_name: 'Acme Pvt Ltd' },
  { id: 'ct-2', name: 'Rahul Mehta', gstin: '', client_id: 'cl-2', client_name: 'Bharat Steel' },
];
const CLIENTS = [
  { id: 'cl-1', name: 'Acme Pvt Ltd', gstin: '27BBBBB1111B1Z5', ref_no: 'AC-01' },
  { id: 'cl-2', name: 'Bharat Steel', gstin: '', ref_no: 'BS-02' },
];

function answer(url) {
  if (String(url).startsWith('/v1/graha/contacts')) {
    return Promise.resolve({ data: { data: CONTACTS, total: CONTACTS.length } });
  }
  if (String(url).startsWith('/v1/graha/clients')) {
    return Promise.resolve({ data: { data: CLIENTS, total: CLIENTS.length } });
  }
  if (String(url).startsWith('/v1/org/profile')) {
    return Promise.resolve({ data: { gstin: ORG_GSTIN } });
  }
  return Promise.resolve({ data: { data: [] } });
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockImplementation(answer);
  api.post.mockImplementation(() => Promise.resolve({ data: { status: 'created', id: 'x', name: 'x' } }));
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
 * Type into a CONTROLLED React input.
 *
 * The native value setter, not `el.value = …`: React records the last value it
 * wrote on the DOM node, sees an unchanged one, and swallows the event. This is
 * also what makes the `input` event REAL, which matters more than usual here —
 * the picker's server search reads it by bubbling, so a synthetic-only change
 * would prove nothing about the thing under test.
 */
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(2);
};

/** Real timers past the picker's 250ms search debounce. */
const pastDebounce = async () => {
  await act(async () => { await new Promise(r => { setTimeout(r, 320); }); });
  await settle();
};

const byLabel = (label) => container.querySelector(`button[aria-label="${label}"]`);

/**
 * Open one picker and return ITS popover.
 *
 * Scoped to the picker's own `.pk` root, never `container.querySelector`: a
 * closing picker unmounts on `animationend`, and jsdom fires no animation
 * events, so the previous popover lingers until the component's own 500ms
 * fallback. A document-wide query therefore hands back the picker the test
 * just finished with — which is how a "create contact" click opened the
 * company panel and the assertion still looked plausible.
 */
const openPicker = async (label) => {
  await click(byLabel(label));
  return byLabel(label).closest('.pk');
};
const createRow = (pk) => pk.querySelector('.pk__new');
const rowNamed = (pk, name) => [...pk.querySelectorAll('.pk__row')]
  .find(r => r.textContent.includes(name));
const postsTo = (path) => api.post.mock.calls.filter(c => String(c[0]).startsWith(path));
const getsTo = (path) => api.get.mock.calls.filter(c => String(c[0]).startsWith(path));

/** One usable line, so the Rule 46 banner is not what stops a submit. */
const fillOneLine = async () => {
  const desc = container.querySelector('input[aria-label="Line 1 description"]');
  await type(desc, 'Consulting');
  const hsn = container.querySelector('input[aria-label="Line 1 HSN or SAC code"]');
  await type(hsn, '998311');
};

const submit = async () => {
  const form = container.querySelector('form.gn-form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
};

describe('Ganit · the invoice names a CRM company', () => {
  it('reads the CRM companies, which this form never asked for before', async () => {
    await mount(<InvoiceForm />);
    expect(getsTo('/v1/graha/clients').length).toBeGreaterThan(0);
    expect(byLabel('Company')).toBeTruthy();
  });

  it('sends client_id with the invoice', async () => {
    await mount(<InvoiceForm />);

    const pop = await openPicker('Company');
    await click(rowNamed(pop, 'Acme Pvt Ltd'));
    await fillOneLine();

    // The recipient is still the person, under Rule 46(e) — the company is the
    // ledger link, not a substitute for naming who was billed.
    const people = await openPicker('Customer');
    await click(rowNamed(people, 'Priya Sharma'));

    await submit();

    const [, payload] = postsTo('/v1/ganit/invoices')[0];
    expect(payload.client_id).toBe('cl-1');
    expect(payload.contact_id).toBe('ct-1');
  });

  it('inherits the company from the person when only a person is picked', async () => {
    await mount(<InvoiceForm />);
    await fillOneLine();

    const people = await openPicker('Customer');
    await click(rowNamed(people, 'Rahul Mehta'));

    await submit();
    // An invoice raised against a person is an invoice to the firm they work
    // for. The server resolves the same way; the form must not disagree.
    expect(postsTo('/v1/ganit/invoices')[0][1].client_id).toBe('cl-2');
  });
});

describe('Ganit · creating the customer from the invoice', () => {
  it('creates the company through the CRM endpoint, never its own INSERT', async () => {
    api.post.mockImplementation((url) => {
      if (url === '/v1/graha/clients') {
        return Promise.resolve({ data: { status: 'created', id: 'cl-new', name: 'Zenith Labs' } });
      }
      return Promise.resolve({ data: { status: 'created', id: 'inv-1' } });
    });
    await mount(<InvoiceForm />);

    const pop = await openPicker('Company');
    await type(pop.querySelector('input[aria-label="Search options"]'), 'Zenith Labs');
    await click(createRow(pop));

    const panel = container.querySelector('[aria-label="New company"]');
    // The picker hands `onCreate` whatever was typed, so the name is already
    // there — the create panel is a confirmation, not a re-typing.
    expect(panel.querySelector('input').value).toBe('Zenith Labs');
    await click([...panel.querySelectorAll('button')]
      .find(b => b.textContent.includes('Add company')));

    expect(postsTo('/v1/graha/clients').length).toBe(1);
    expect(postsTo('/v1/graha/clients')[0][1].name).toBe('Zenith Labs');
    // The new company is the chosen one, without a re-fetch.
    expect(byLabel('Company').textContent).toContain('Zenith Labs');
  });

  it('files a person created here as a CONTACT at the company, never a lead', async () => {
    api.post.mockImplementation((url) => {
      if (url === '/v1/graha/contacts') {
        return Promise.resolve({ data: { status: 'created', id: 'ct-new', name: 'Neha Rao' } });
      }
      return Promise.resolve({ data: { status: 'created', id: 'inv-1' } });
    });
    await mount(<InvoiceForm />);

    const co = await openPicker('Company');
    await click(rowNamed(co, 'Acme Pvt Ltd'));

    const pop = await openPicker('Customer');
    await type(pop.querySelector('input[aria-label="Search options"]'), 'Neha Rao');
    await click(createRow(pop));

    const panel = container.querySelector('[aria-label="New contact"]');
    await click([...panel.querySelectorAll('button')]
      .find(b => b.textContent.includes('Add contact')));

    const [, body] = postsTo('/v1/graha/contacts')[0];
    // ⚠ `'contact'`, not `'customer'` — migration 254 removed `customer` as a
    // kind of person. The test's POINT is unchanged and still worth holding:
    // somebody you have just billed must not be filed as a LEAD, because that
    // pollutes every lead list and feeds lead scoring with a person who has
    // already bought. What changed is where "this is a customer" lives — on the
    // COMPANY (`graha_clients.is_sales_customer`), which this form already
    // names one line above. Before the change, 7 clients held a 'customer'
    // contact and a 'vendor' contact at the same time.
    expect(body.contact_type).toBe('contact');
    expect(body.contact_type).not.toBe('lead');
    expect(body.contact_type).not.toBe('customer');
    // Attached to the company already on the form, so the CRM does not gain
    // another orphan contact.
    expect(body.client_id).toBe('cl-1');
  });

  it('does not create the company twice when the invoice is refused and retried', async () => {
    let invoiceCalls = 0;
    api.post.mockImplementation((url) => {
      if (url === '/v1/graha/clients') {
        return Promise.resolve({ data: { status: 'created', id: 'cl-new', name: 'Zenith Labs' } });
      }
      if (url === '/v1/graha/contacts') {
        return Promise.resolve({ data: { status: 'created', id: 'ct-new', name: 'Neha Rao' } });
      }
      invoiceCalls += 1;
      if (invoiceCalls === 1) {
        return Promise.reject({ response: { data: { detail: 'Server had a bad day' } } });
      }
      return Promise.resolve({ data: { status: 'created', id: 'inv-1' } });
    });
    await mount(<InvoiceForm />);

    // The whole brand-new-customer path: a company nobody has met, and a person
    // at it. Three writes now stand where one did.
    const pop = await openPicker('Company');
    await type(pop.querySelector('input[aria-label="Search options"]'), 'Zenith Labs');
    await click(createRow(pop));
    const coPanel = container.querySelector('[aria-label="New company"]');
    await click([...coPanel.querySelectorAll('button')]
      .find(b => b.textContent.includes('Add company')));

    const people = await openPicker('Customer');
    await type(people.querySelector('input[aria-label="Search options"]'), 'Neha Rao');
    await click(createRow(people));
    const personPanel = container.querySelector('[aria-label="New contact"]');
    await click([...personPanel.querySelectorAll('button')]
      .find(b => b.textContent.includes('Add contact')));

    await fillOneLine();
    await submit();          // refused
    await submit();          // retried

    expect(invoiceCalls).toBe(2);
    // Both ids went into form state the moment their rows existed, so the retry
    // re-used them. One company and one contact across both attempts — the
    // alternative is a CRM that grows a duplicate every time a save fails.
    expect(postsTo('/v1/graha/clients').length).toBe(1);
    expect(postsTo('/v1/graha/contacts').length).toBe(1);
    expect(postsTo('/v1/ganit/invoices')[1][1].client_id).toBe('cl-new');
    expect(postsTo('/v1/ganit/invoices')[1][1].contact_id).toBe('ct-new');
  });

  it('drops a contact who works somewhere else when the company changes', async () => {
    await mount(<InvoiceForm />);

    const people = await openPicker('Customer');
    await click(rowNamed(people, 'Priya Sharma'));
    expect(byLabel('Customer').textContent).toContain('Priya Sharma');

    // Priya is at Acme. Billing Bharat Steel care of her is the one outcome
    // nobody means, so the person is dropped rather than silently carried.
    const co = await openPicker('Company');
    await click(rowNamed(co, 'Bharat Steel'));
    expect(byLabel('Customer').textContent).not.toContain('Priya Sharma');
    expect(byLabel('Company').textContent).toContain('Bharat Steel');
  });
});

describe('Ganit · the pickers narrow on the server', () => {
  it('asks the server for ?search= instead of filtering a truncated page', async () => {
    await mount(<InvoiceForm />);
    const before = getsTo('/v1/graha/contacts').length;

    const pop = await openPicker('Customer');
    await type(pop.querySelector('input[aria-label="Search options"]'), 'sharma');
    await pastDebounce();

    const asked = getsTo('/v1/graha/contacts');
    expect(asked.length).toBe(before + 1);
    // 292 live contacts against a LIMIT 200 window: narrowing in the browser
    // would silently hide 92 people and invite a duplicate.
    expect(asked[asked.length - 1][1]).toEqual({ params: { search: 'sharma' } });
  });

  it('spends one request for a burst of keystrokes', async () => {
    await mount(<InvoiceForm />);
    const before = getsTo('/v1/graha/clients').length;

    const pop = await openPicker('Company');
    const box = pop.querySelector('input[aria-label="Search options"]');
    await type(box, 'a');
    await type(box, 'ac');
    await type(box, 'acm');
    await pastDebounce();

    expect(getsTo('/v1/graha/clients').length).toBe(before + 1);
  });
});
