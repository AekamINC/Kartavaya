/**
 * Vikray's order form can add a company and a contact without leaving it.
 *
 * The owner's ask, 2026-08-20: "ganit, sales BOTH need capacity to add
 * clients, contacts — same feature as CRM." Ganit's invoice form got this on
 * 2026-08-20; this is the other half, and it holds the same five facts.
 *
 * What stood here instead: two bare `<select>`s over a page the server
 * truncates at 200 rows, and no create path at all — so a salesperson taking
 * an order from a company nobody had met yet had to leave for the CRM, make it
 * there, and come back to a form they had already filled in.
 *
 *   1. Vikray INSERTS nothing. It calls the CRM's own endpoints, which is what
 *      makes "in sync" true by construction rather than by two INSERTs kept
 *      identical by hand — a background sync would be the second source of
 *      truth migration 136 exists to prevent.
 *   2. A person created here is filed as a CUSTOMER. The endpoint defaults
 *      `contact_type` to 'lead', and a lead default quietly poisons every lead
 *      list and the lead scoring behind it.
 *   3. Two writes now stand where one did. A refused order must not create a
 *      second company on the retry.
 *   4. The pickers ask the SERVER to narrow. `GET /v1/graha/contacts` stops at
 *      200 and this product already has an org with 292 live contacts —
 *      filtering that truncated array in the browser hides 92 people silently,
 *      and a user who cannot find a customer creates a second copy of them.
 *   5. The order still carries both ids, and the company is still inherited
 *      from the person when only a person is named — the server resolves the
 *      same way (`resolve_order_company`), so the form must not disagree.
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
import OrderForm from '../OrderForm';

const CONTACTS = [
  { id: 'ct-1', name: 'Priya Sharma', client_id: 'cl-1', client_name: 'Acme Pvt Ltd' },
  { id: 'ct-2', name: 'Rahul Mehta', client_id: 'cl-2', client_name: 'Bharat Steel' },
];
const CLIENTS = [
  { id: 'cl-1', name: 'Acme Pvt Ltd', ref_no: 'AC-01' },
  { id: 'cl-2', name: 'Bharat Steel', ref_no: 'BS-02' },
];

function answer(url) {
  if (String(url).startsWith('/v1/graha/contacts')) {
    return Promise.resolve({ data: { data: CONTACTS, total: CONTACTS.length } });
  }
  if (String(url).startsWith('/v1/graha/clients')) {
    return Promise.resolve({ data: { data: CLIENTS, total: CLIENTS.length } });
  }
  return Promise.resolve({ data: { data: [] } });
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockImplementation(answer);
  api.post.mockImplementation(() => Promise.resolve({ data: { status: 'created', id: 'x', order_number: 'SO-1' } }));
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
 * `ServerPicker` reads the picker's search box by bubbling, so a
 * synthetic-only change would prove nothing about the thing under test.
 */
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(2);
};

/** Real timers past ServerPicker's 250ms search debounce. */
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
 * just finished with.
 */
const openPicker = async (label) => {
  await click(byLabel(label));
  return byLabel(label).closest('.pk');
};
const createRow = (pk) => pk.querySelector('.pk__new');
const rowNamed = (pk, name) => [...pk.querySelectorAll('.pk__row')]
  .find(r => r.textContent.includes(name));
const searchBox = (pk) => pk.querySelector('input[aria-label="Search options"]');
const postsTo = (path) => api.post.mock.calls.filter(c => String(c[0]).startsWith(path));
const getsTo = (path) => api.get.mock.calls.filter(c => String(c[0]).startsWith(path));
const panelButton = (panel, text) => [...panel.querySelectorAll('button')]
  .find(b => b.textContent.includes(text));

/** One usable line, so "Add at least one line item" is not what stops a save. */
const fillOneLine = async () => {
  await type(container.querySelector('input[aria-label="Line 1 description"]'), 'Steel plate');
  await type(container.querySelector('input[aria-label="Line 1 rate"]'), '1000');
};

const submit = async () => {
  const form = container.querySelector('form.vk-form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
};

describe('Vikray · the order names a CRM company', () => {
  it('sends client_id and contact_id with the order', async () => {
    await mount(<OrderForm />);

    const co = await openPicker('Customer');
    await click(rowNamed(co, 'Acme Pvt Ltd'));
    const people = await openPicker('Contact');
    await click(rowNamed(people, 'Priya Sharma'));
    await fillOneLine();
    await submit();

    const [, payload] = postsTo('/v1/vikray/orders')[0];
    expect(payload.client_id).toBe('cl-1');
    expect(payload.contact_id).toBe('ct-1');
  });

  it('inherits the company from the person when only a person is picked', async () => {
    await mount(<OrderForm />);
    await fillOneLine();

    const people = await openPicker('Contact');
    await click(rowNamed(people, 'Rahul Mehta'));
    await submit();

    // An order taken from a person is an order from the firm they work for.
    // `resolve_order_company` derives the same thing server-side; the form
    // must not disagree with what gets stored.
    expect(postsTo('/v1/vikray/orders')[0][1].client_id).toBe('cl-2');
  });

  it('drops a contact who works somewhere else when the company changes', async () => {
    await mount(<OrderForm />);

    const people = await openPicker('Contact');
    await click(rowNamed(people, 'Priya Sharma'));
    expect(byLabel('Contact').textContent).toContain('Priya Sharma');

    const co = await openPicker('Customer');
    await click(rowNamed(co, 'Bharat Steel'));
    expect(byLabel('Contact').textContent).not.toContain('Priya Sharma');
    expect(byLabel('Customer').textContent).toContain('Bharat Steel');
  });
});

describe('Vikray · creating the customer from the order', () => {
  it('creates the company through the CRM endpoint, never its own INSERT', async () => {
    api.post.mockImplementation((url) => {
      if (url === '/v1/graha/clients') {
        return Promise.resolve({ data: { status: 'created', id: 'cl-new', name: 'Zenith Labs' } });
      }
      return Promise.resolve({ data: { status: 'created', id: 'so-1', order_number: 'SO-9' } });
    });
    await mount(<OrderForm />);

    const co = await openPicker('Customer');
    await type(searchBox(co), 'Zenith Labs');
    await click(createRow(co));

    const panel = container.querySelector('[aria-label="New company"]');
    // The picker hands `onCreate` whatever was typed, so the name is already
    // there — the create panel is a confirmation, not a re-typing.
    expect(panel.querySelector('input').value).toBe('Zenith Labs');
    await click(panelButton(panel, 'Add company'));

    // One writer per table: the CRM's endpoint, the same one Graha's own form
    // posts to. Vikray has no INSERT of its own to drift from it.
    expect(postsTo('/v1/graha/clients').length).toBe(1);
    expect(postsTo('/v1/graha/clients')[0][1].name).toBe('Zenith Labs');
    // The new company is the chosen one, without a re-fetch.
    expect(byLabel('Customer').textContent).toContain('Zenith Labs');
  });

  it('files a person created here as a CUSTOMER, not the endpoint default lead', async () => {
    api.post.mockImplementation((url) => {
      if (url === '/v1/graha/contacts') {
        return Promise.resolve({ data: { status: 'created', id: 'ct-new', name: 'Neha Rao' } });
      }
      return Promise.resolve({ data: { status: 'created', id: 'so-1', order_number: 'SO-9' } });
    });
    await mount(<OrderForm />);

    const co = await openPicker('Customer');
    await click(rowNamed(co, 'Acme Pvt Ltd'));

    const people = await openPicker('Contact');
    await type(searchBox(people), 'Neha Rao');
    await click(createRow(people));

    const panel = container.querySelector('[aria-label="New contact"]');
    await click(panelButton(panel, 'Add contact'));

    const [, body] = postsTo('/v1/graha/contacts')[0];
    expect(body.contact_type).toBe('customer');
    expect(body.contact_type).not.toBe('lead');
    // Attached to the company already on the form, so the CRM does not gain
    // another orphan contact.
    expect(body.client_id).toBe('cl-1');
  });

  it('does not create the company twice when the order is refused and retried', async () => {
    let orderCalls = 0;
    api.post.mockImplementation((url) => {
      if (url === '/v1/graha/clients') {
        return Promise.resolve({ data: { status: 'created', id: 'cl-new', name: 'Zenith Labs' } });
      }
      if (url === '/v1/graha/contacts') {
        return Promise.resolve({ data: { status: 'created', id: 'ct-new', name: 'Neha Rao' } });
      }
      orderCalls += 1;
      if (orderCalls === 1) {
        return Promise.reject({ response: { data: { detail: 'Server had a bad day' } } });
      }
      return Promise.resolve({ data: { status: 'created', id: 'so-1', order_number: 'SO-9' } });
    });
    await mount(<OrderForm />);

    // The whole brand-new-customer path: a company nobody has met, and a
    // person at it. Three writes now stand where one did.
    const co = await openPicker('Customer');
    await type(searchBox(co), 'Zenith Labs');
    await click(createRow(co));
    await click(panelButton(container.querySelector('[aria-label="New company"]'), 'Add company'));

    const people = await openPicker('Contact');
    await type(searchBox(people), 'Neha Rao');
    await click(createRow(people));
    await click(panelButton(container.querySelector('[aria-label="New contact"]'), 'Add contact'));

    await fillOneLine();
    await submit();          // refused
    await submit();          // retried

    expect(orderCalls).toBe(2);
    // Both ids went into form state the moment their rows existed, so the
    // retry re-used them. One company and one contact across both attempts —
    // the alternative is a CRM that grows a duplicate every time a save fails.
    expect(postsTo('/v1/graha/clients').length).toBe(1);
    expect(postsTo('/v1/graha/contacts').length).toBe(1);
    expect(postsTo('/v1/vikray/orders')[1][1].client_id).toBe('cl-new');
    expect(postsTo('/v1/vikray/orders')[1][1].contact_id).toBe('ct-new');
  });
});

describe('Vikray · the pickers narrow on the server', () => {
  it('asks the server for ?search= instead of filtering a truncated page', async () => {
    await mount(<OrderForm />);
    const before = getsTo('/v1/graha/contacts').length;

    const people = await openPicker('Contact');
    await type(searchBox(people), 'sharma');
    await pastDebounce();

    const asked = getsTo('/v1/graha/contacts');
    expect(asked.length).toBe(before + 1);
    // 292 live contacts against a LIMIT 200 window: narrowing in the browser
    // would silently hide 92 people and invite a duplicate.
    expect(asked[asked.length - 1][1]).toEqual({ params: { search: 'sharma' } });
  });

  it('spends one request for a burst of keystrokes', async () => {
    await mount(<OrderForm />);
    const before = getsTo('/v1/graha/clients').length;

    const co = await openPicker('Customer');
    const box = searchBox(co);
    await type(box, 'z');
    await type(box, 'ze');
    await type(box, 'zen');
    await pastDebounce();

    expect(getsTo('/v1/graha/clients').length).toBe(before + 1);
  });
});
