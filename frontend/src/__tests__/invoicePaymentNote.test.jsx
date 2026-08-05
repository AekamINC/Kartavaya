/**
 * "This invoice cannot be paid" has to reach the operator's screen.
 *
 * THE DEFECT THIS PINS was not in either file that looked wrong. `InvoiceBuilder`
 * awaits `onCreate` and renders `payment_note` off the body it gets back;
 * `POST /admin/invoices` computes that note and returns it. Both halves shipped
 * and were correct. In between, `AdminBillingPage`'s `createInvoice` ran
 * `await api.post(…)` and returned nothing, and its `guard()` wrapper did
 * `await fn(...args)` and dropped the value — so the awaited body was always
 * `undefined`, `payNote` was always `''`, and the note could never render.
 *
 * Nothing failed. No test went red, no console warning fired, the invoice was
 * raised and the success toast appeared. The only symptom is a sentence that
 * does not get said — and what it says is that the document just raised carries
 * no UPI details, which with no payment gateway anywhere in this product means
 * the client has no way to pay it. It is said at the one moment somebody can
 * still act on it, and it is returned nowhere else: no later read recomputes it.
 *
 * A prop scan in both directions is the only thing that finds a defect shaped
 * like this, so it gets a guard rather than a note in a report.
 *
 * TWO ASSERTIONS, DELIBERATELY OF DIFFERENT KINDS:
 *
 *   1. A RENDER of `InvoiceBuilder`, driven through the real form to a real
 *      submit. This proves the consumer end — that a body resolved from
 *      `onCreate` becomes visible text, and that a caller which resolves with
 *      nothing renders nothing rather than `undefined`.
 *
 *   2. A SOURCE assertion on `AdminBillingPage`, in the style
 *      `onboardingChecklistHooks.test.jsx` sets and argues for. The break was a
 *      MISSING `return` in a closure defined inside a page component; reaching
 *      it at runtime needs the whole page mounted behind a router, a toast
 *      provider, `currentUser`, and four API reads — a test that elaborate fails
 *      for reasons of its own long before it fails for this one. The trade is
 *      stated rather than hidden: this catches the shape, and the shape is
 *      exactly what regressed.
 *
 * No network. `api` is mocked; this module raises invoices against real clients.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  rows: () => [],
  body: (r) => r?.data ?? {},
}));

const { default: InvoiceBuilder } = await import('../pages/admin/InvoiceBuilder');

const NOTE =
  'KSUB-202608-0001 carries no UPI details, so the client has no way to pay it.';

/** React tracks the last value it wrote on the DOM node, so assigning `.value`
 *  directly is swallowed as a no-op. Going through the prototype setter is what
 *  makes a controlled input see the change. */
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  ).set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

let host;
let root;

beforeEach(() => {
  // The house convention for a render test (`errorBoundaryScope`, `kanbanTab`
  // and six others set it the same way). Without it React logs "the current
  // testing environment is not configured to support act(...)" on every update
  // and stops flushing effects synchronously, so an assertion can read the DOM
  // one render too early.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.clearAllMocks();
});

/** Fill the form to the point where Create is enabled, and press it.
 *  `ready` needs an org, all three dates and one row with a description and an
 *  amount above zero — see `payable`. */
async function raise(onCreate) {
  await act(async () => {
    root.render(<InvoiceBuilder org={{ id: 'org-1', name: 'Acme' }} onCreate={onCreate} />);
  });

  const dates = [...host.querySelectorAll('input[type="date"]')];
  expect(dates).toHaveLength(3);        // start, end, due — the form's shape
  await act(async () => {
    type(dates[0], '2026-08-01');
    type(dates[1], '2026-08-31');
    type(dates[2], '2026-09-07');
  });

  const desc = host.querySelector('input[aria-label="Line 1 description"]')
    || [...host.querySelectorAll('input[type="text"]')][0];
  const amount = host.querySelector('input[aria-label="Line 1 amount"]')
    || [...host.querySelectorAll('input[type="number"]')].pop();
  await act(async () => {
    type(desc, 'Platform fee');
    type(amount, '25000');
  });

  const create = [...host.querySelectorAll('button')]
    .find(b => /create invoice/i.test(b.textContent));
  expect(create, 'the Create invoice button is not on the form').toBeTruthy();
  expect(create.disabled, 'the form never became ready to submit').toBe(false);

  await act(async () => {
    create.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('the invoice-cannot-be-paid note', () => {
  it('renders what the create response said', async () => {
    await raise(async () => ({ invoice_number: 'KSUB-202608-0001', payment_note: NOTE }));
    expect(host.textContent).toContain(NOTE);
  });

  it('also accepts the raw axios response, since the caller may hand over either', async () => {
    await raise(async () => ({ data: { payment_note: NOTE } }));
    expect(host.textContent).toContain(NOTE);
  });

  it('says nothing when the invoice is payable', async () => {
    // `payment_note` is null when the document carries a payee. Silence is the
    // whole point: a note that appeared on every invoice would be ignored on
    // the one that matters.
    await raise(async () => ({ invoice_number: 'KSUB-202608-0002', payment_note: null }));
    expect(host.textContent).not.toContain('no UPI details');
    expect(host.textContent).not.toContain('undefined');
  });

  it('does not print "undefined" when the caller resolves with nothing', async () => {
    // The state this test exists for. It must degrade to silence, never to the
    // word `undefined` sitting under a money form.
    await raise(async () => undefined);
    expect(host.textContent).not.toContain('undefined');
  });
});

describe('AdminBillingPage hands the create response back', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../pages/AdminBillingPage.jsx'), 'utf8',
  );

  it('guard() returns the wrapped call instead of swallowing it', () => {
    const guard = SRC.match(/const guard = \(fn\) => async \(\.\.\.args\) => \{[\s\S]*?\n  \};/);
    expect(guard, 'guard() is no longer where this test looks for it').toBeTruthy();
    expect(
      /return await fn\(\.\.\.args\)/.test(guard[0]),
      'guard() awaits the wrapped call and drops its value, so every return '
      + 'value passed through it — including the invoice body carrying '
      + 'payment_note — is undefined by the time the caller sees it',
    ).toBe(true);
  });

  it('createInvoice returns the response body', () => {
    const fn = SRC.match(/const createInvoice = guard\(async \(body\) => \{[\s\S]*?\n  \}\);/);
    expect(fn, 'createInvoice is no longer where this test looks for it').toBeTruthy();
    expect(
      /return res\.data;/.test(fn[0]),
      'createInvoice discards the response body, so InvoiceBuilder cannot '
      + 'render payment_note and nobody is told the invoice is unpayable',
    ).toBe(true);
  });
});
