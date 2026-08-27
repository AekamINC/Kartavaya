/**
 * ONE vendor form, two callers — Kray · Vendors and Ganit · Payables.
 *
 * PHASE-0 decision 0.20. Vendors are reachable from both modules on purpose:
 * not every org buys Kray, so Ganit keeps a full vendor surface. What was
 * wrong is that the two surfaces had forked. `ganit/PayablesTab.jsx` carried
 * its own four-field form — name, GSTIN, email, phone — so a supplier recorded
 * while entering a bill was born with all six MSME/TDS columns NULL, and the
 * 43B(h) skill that reads them reported "nobody has said" about a vendor the
 * user had just finished describing. Live on 2026-08-26: 12 of 84 active
 * vendors across the two in-scope orgs carry the six columns, and all 12 are in
 * E2E Test & Associates — Unicode Group's nine real suppliers carry none.
 *
 * The fields now live in `components/VendorForm.jsx` and nowhere else. These
 * tests hold the four things that regress the moment somebody adds a field to
 * one screen "just for now":
 *
 *   1. All six compliance controls are reachable FROM GANIT, not only Kray.
 *   2. The two tabs render the SAME field set — asserted as set equality, so a
 *      fork fails here rather than being discovered in a report months later.
 *   3. The Ganit POST carries all six values.
 *   4. Nothing about compliance blocks a save. A vendor with no GSTIN and
 *      nothing recorded still saves — the GSTIN/PAN/TAN rule, which has drifted
 *      back more than once.
 *
 * Rendered with react-dom directly, matching `ganit/__tests__/expenseClientTag`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import PayablesTab from '../pages/ganit/PayablesTab';
import VendorsTab from '../pages/kray/VendorsTab';
import VendorForm, { vendorPayload, vendorFormFrom, BLANK_VENDOR } from '../components/VendorForm';

/** The six columns owner decision 0.20 is about, and the four that were never
 *  in doubt. Label text is the first text node of each field's label. */
const COMPLIANCE = [
  'MSME registered', 'Enterprise class', 'Vendor kind',
  'Udyam number', 'TDS section', 'Payment terms',
];
/** The six address boxes open finding 4 added, in render order. They sit
 *  between the contact block and the compliance block: an address is part of
 *  who the supplier IS, and the MSME/TDS answers are what is claimed about it.
 *  Listed here rather than left out because this file's set-equality assertion
 *  is exactly what stops one tab growing a field the other lacks — and the
 *  address boxes are the newest candidate for that. */
const ADDRESS = ['Address line 1', 'Address line 2', 'City', 'State', 'Pincode', 'Country'];
const ALL_FIELDS = ['Name', 'GSTIN', 'Email', 'Phone', ...ADDRESS, ...COMPLIANCE];

/** A supplier that already carries all six — the shape Kray has been writing. */
const EXISTING = {
  id: 'v-1', name: 'Shree Metals', gstin: '24AAACS1234A1Z5',
  email: 'ap@shreemetals.example', phone: '9876543210',
  is_msme: true, enterprise_class: 'small', vendor_kind: 'manufacturer',
  udyam_number: 'UDYAM-GJ-01-0001234', tds_section: '194C', payment_terms_days: 45,
};

let container = null;
let root = null;
let vendorRows = [];
/** The body of the last POST to /v1/ganit/vendors. */
let posted = null;

function answer(url) {
  const u = String(url);
  if (u.startsWith('/v1/ganit/vendors')) return Promise.resolve({ data: { data: vendorRows } });
  if (u.startsWith('/v1/ganit/vendor-bills')) return Promise.resolve({ data: { data: [] } });
  if (u.startsWith('/v1/ganit/payables-summary')) {
    return Promise.resolve({ data: { outstanding: 0, overdue: 0, open_bills: 0, aging: [] } });
  }
  return Promise.resolve({ data: { data: [] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vendorRows = [EXISTING];
  posted = null;
  api.get.mockImplementation(answer);
  api.post.mockImplementation((url, b) => {
    if (String(url) === '/v1/ganit/vendors') {
      posted = b;
      const row = { id: 'v-new', ...b };
      vendorRows = [...vendorRows, row];
      return Promise.resolve({ data: row });
    }
    return Promise.resolve({ data: {} });
  });
  api.patch.mockImplementation((url, b) => Promise.resolve({ data: { id: 'v-1', ...b } }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
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

/** Exact button text — "+ Vendor" also matches "+ Vendor bill" on a substring. */
const clickText = async (label) => {
  const el = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  if (!el) throw new Error(`no button reading "${label}"`);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/** The vendor form, which is the one carrying the Name field. */
const vendorForm = () => [...container.querySelectorAll('form.gn-form')]
  .find(f => f.querySelector('label.gn-form__field'));

/** The English run of every field label, in DOM order. */
const labelsOf = (form) => [...form.querySelectorAll('label.gn-form__field')]
  .map(l => (l.childNodes[0]?.textContent || '').trim());

const control = (form, label) => {
  const l = [...form.querySelectorAll('label.gn-form__field')]
    .find(x => (x.childNodes[0]?.textContent || '').trim() === label);
  if (!l) throw new Error(`no field labelled "${label}"`);
  return l.querySelector('input, select, textarea');
};

function setValue(el, value) {
  const proto = el.tagName === 'SELECT'
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const submitForm = async (form) => {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
};

describe('the vendor form is shared, not forked', () => {
  it('Ganit · Payables reaches all six MSME/TDS fields', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');

    const form = vendorForm();
    expect(form, 'the vendor form did not open on Payables').toBeTruthy();
    // The exact defect: this form used to carry Name/GSTIN/Email/Phone only.
    for (const label of COMPLIANCE) {
      expect(control(form, label), `${label} is missing from the Ganit form`).toBeTruthy();
    }
    expect(labelsOf(form)).toEqual(ALL_FIELDS);
  });

  it('Kray · Vendors and Ganit · Payables render the SAME field set', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const fromGanit = labelsOf(vendorForm());

    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await mount(<VendorsTab />);
    await clickText('+ Vendor');
    const fromKray = labelsOf(vendorForm());

    expect(fromKray.length, 'Kray rendered no vendor fields').toBe(ALL_FIELDS.length);
    // Set equality, not "Ganit has at least six" — a field added to one screen
    // and not the other is the failure this file exists to catch.
    expect([...fromGanit].sort()).toEqual([...fromKray].sort());
  });

  it('the Ganit POST carries every one of the six columns', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();

    setValue(control(form, 'Name'), 'Nav Udyog Traders');
    setValue(control(form, 'MSME registered'), 'yes');
    setValue(control(form, 'Enterprise class'), 'micro');
    setValue(control(form, 'Vendor kind'), 'manufacturer');
    setValue(control(form, 'Udyam number'), 'UDYAM-GJ-02-0009876');
    setValue(control(form, 'TDS section'), '194C');
    setValue(control(form, 'Payment terms'), '45');
    await settle();
    await submitForm(form);

    expect(api.post).toHaveBeenCalledWith('/v1/ganit/vendors', expect.anything());
    expect(posted).toMatchObject({
      name: 'Nav Udyog Traders',
      is_msme: true,
      enterprise_class: 'micro',
      vendor_kind: 'manufacturer',
      udyam_number: 'UDYAM-GJ-02-0009876',
      tds_section: '194C',
      payment_terms_days: 45,
    });
    // A number, not the string the input holds — the column is int.
    expect(typeof posted.payment_terms_days).toBe('number');
  });

  it('saves a vendor with no GSTIN and nothing recorded — compliance blocks nothing', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();

    setValue(control(form, 'Name'), 'Kirana Supplies');
    await settle();
    await submitForm(form);

    expect(api.post, 'a vendor with no GSTIN was refused').toHaveBeenCalledTimes(1);
    expect(posted.gstin).toBe('');
    // NULL is "nobody has said", which the 43B(h) skill counts apart from a
    // recorded answer. It is not an error state.
    expect(posted.is_msme).toBeNull();
    expect(posted.payment_terms_days).toBeNull();
  });

  it('a nameless vendor is the one thing refused, and nothing is sent', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    await submitForm(vendorForm());

    expect(api.post).not.toHaveBeenCalled();
    expect(vendorForm(), 'the form closed on a refused save').toBeTruthy();
  });

  it('Payables refetches the picker and selects the vendor just created', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();
    setValue(control(form, 'Name'), 'Nav Udyog Traders');
    await settle();
    await submitForm(form);

    // The bill form's first select is the vendor picker.
    await clickText('+ Vendor bill');
    const picker = container.querySelector('form.gn-form select');
    expect([...picker.options].map(o => o.textContent))
      .toContain('Nav Udyog Traders');
    // The value, never rendered as text — the new supplier is pre-selected so
    // the user does not have to find it again.
    expect(picker.value).toBe('v-new');
  });

  it('keeps the three selectors the e2e specs bind to', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();

    /* `e2e-real/ganit.spec.ts` finds this form by filtering `form.gn-form` on
       the heading text and clicks a button named "Save vendor";
       `e2e-real/phase1-acceptance.spec.ts` reaches every field through
       `label.gn-form__field` and matches the submit button against
       /^(Save vendor|Add vendor|Create|Save)$/. Both specs run only against
       staging, so a rename here fails there — days later, on someone else's
       run. Pinned in a unit test so it fails in seconds instead. */
    expect(form.querySelector('.gn-form__h').textContent.trim()).toBe('New vendor');
    expect(form.querySelectorAll('label.gn-form__field').length).toBe(ALL_FIELDS.length);

    const submit = form.querySelector('button[type="submit"]');
    expect(submit.textContent.trim()).toBe('Save vendor');
    expect(/^(Save vendor|Add vendor|Create|Save)$/.test(submit.textContent.trim())).toBe(true);

    // `getByLabel(/^Name/)` resolves through the WRAPPING label, so the control
    // has to stay inside it — a layout that moves the input out of the label
    // reads as "the field disappeared".
    expect(control(form, 'Name').closest('label.gn-form__field')).toBeTruthy();
  });

  it('Kray edits through the same component and PATCHes', async () => {
    await mount(<VendorsTab />);
    await clickText('Edit');

    const form = vendorForm();
    expect(control(form, 'Udyam number').value).toBe('UDYAM-GJ-01-0001234');
    expect(control(form, 'Enterprise class').value).toBe('small');
    expect(control(form, 'Payment terms').value).toBe('45');

    setValue(control(form, 'TDS section'), '194J');
    await settle();
    await submitForm(form);

    expect(api.patch).toHaveBeenCalledWith('/v1/ganit/vendors/v-1', expect.anything());
    expect(api.patch.mock.calls[0][1].tds_section).toBe('194J');
  });
});

describe('vendorPayload — the tri-state contract', () => {
  it('sends every compliance key even when blank, so a value can be taken back', () => {
    const keys = Object.keys(vendorPayload({ ...BLANK_VENDOR, name: 'X' }));
    for (const k of ['is_msme', 'enterprise_class', 'vendor_kind',
      'udyam_number', 'tds_section', 'payment_terms_days']) {
      expect(keys, `${k} is not sent when blank — it could never be cleared`).toContain(k);
    }
  });

  it('distinguishes "no" from "not recorded"', () => {
    expect(vendorPayload({ ...BLANK_VENDOR, is_msme: '' }).is_msme).toBeNull();
    expect(vendorPayload({ ...BLANK_VENDOR, is_msme: 'no' }).is_msme).toBe(false);
    expect(vendorPayload({ ...BLANK_VENDOR, is_msme: 'yes' }).is_msme).toBe(true);
  });

  it('keeps 0 payment terms, which means paid on delivery', () => {
    expect(vendorFormFrom({ payment_terms_days: 0 }).payment_terms_days).toBe(0);
    expect(vendorPayload({ ...BLANK_VENDOR, payment_terms_days: 0 }).payment_terms_days).toBe(0);
    expect(vendorFormFrom(null)).toEqual(BLANK_VENDOR);
  });

  it('hydrates a false is_msme as "no", not as unrecorded', () => {
    expect(vendorFormFrom({ is_msme: false }).is_msme).toBe('no');
    expect(vendorFormFrom({ is_msme: null }).is_msme).toBe('');
  });
});

describe('VendorForm stands alone', () => {
  it('renders ten fields for a caller that is neither tab', async () => {
    await mount(<VendorForm onSaved={() => {}} onCancel={() => {}} />);
    expect(labelsOf(vendorForm())).toEqual(ALL_FIELDS);
  });
});
