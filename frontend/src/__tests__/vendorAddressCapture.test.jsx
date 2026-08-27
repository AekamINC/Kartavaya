/**
 * The vendor address — capture, and the promise not to destroy one.
 *
 * OPEN FINDING 4. `staging.ganit_vendors.address` is `jsonb NOT NULL DEFAULT
 * '{}'`; `POST /v1/ganit/vendors` has always bound `body.address` into the
 * INSERT and `PATCH /vendors/{id}` into the SET — and `VendorForm`'s
 * `BLANK_VENDOR` had no `address` key. API-writable, already populated, and
 * unenterable by a human.
 *
 * Live against the staging schema, 2026-08-27 (read-only, `railway run`):
 *
 *   org                              active vendors   address a non-empty object
 *   Unicode Group                                 9                           6
 *   E2E Test & Associates [TEST]                 75                          40
 *   Aekam Inc                                     2                           0
 *
 *   keys ever present on any ganit_vendors.address:
 *     city 46 · line1 46 · country 6 · pincode 6 · state 6 · state_code 6
 *   jsonb_typeof(address) = 'string': 0 rows, all three orgs.
 *
 * Two things are being held here, and the second is the one that bites.
 *
 *   1. THE VOCABULARY. Six boxes writing the keys `AddressBlock` reads and
 *      `services/invoice_pdf.py:_fmt_addr` prints. A seventh spelling would
 *      make a vendor's address invisible to the bill raised against it, so the
 *      payload's key set is asserted against a literal list rather than against
 *      the component's own constant — a test that imports the thing it is
 *      checking cannot catch a rename.
 *
 *   2. NON-DESTRUCTION. The addresses in this database are not uniform. The
 *      canonical wreck is Unicode Group's `Navrang Polymers`: 43 keys, "0"
 *      through "41" spelling `{"city": "Mumbai", "state": "Maharashtra"}` one
 *      character per key, plus a genuine `city` reading "Navi Mumbai" that
 *      contradicts the exploded copy. (It is a `graha_clients` row, not a
 *      vendor — `backend/db.py:_json_encoder` documents the double-encode that
 *      produced it across 38 jsonb columns in 26 tables, and
 *      `ganit_vendors.address` is one of them. It is the shape this form has to
 *      survive, not one it may assume away.) Reproduced here verbatim from the
 *      live row.
 *
 *      Whether that row renders is `AddressBlock`'s problem and is tested
 *      there. Whether opening the vendor to fix its TDS section quietly
 *      rewrites it is THIS form's problem, and it is the more expensive one:
 *      a bad render is visible, a bad write is not.
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
import { vendorPayload, vendorFormFrom, vendorAddress } from '../components/VendorForm';

/* The seven, written out rather than imported. `AddressBlock` and `_fmt_addr`
   are the two consumers and neither would fail loudly on a renamed key — the
   address would simply stop appearing. */
const VOCABULARY = ['line1', 'line2', 'city', 'state', 'pincode', 'country', 'state_code'];

/** The exact live value of `Navrang Polymers`, keys and all. */
const NAVRANG = {
  0: '{', 1: '"', 2: 'c', 3: 'i', 4: 't', 5: 'y', 6: '"', 7: ':', 8: ' ', 9: '"',
  10: 'M', 11: 'u', 12: 'm', 13: 'b', 14: 'a', 15: 'i', 16: '"', 17: ',', 18: ' ', 19: '"',
  20: 's', 21: 't', 22: 'a', 23: 't', 24: 'e', 25: '"', 26: ':', 27: ' ', 28: '"',
  29: 'M', 30: 'a', 31: 'h', 32: 'a', 33: 'r', 34: 'a', 35: 's', 36: 'h', 37: 't', 38: 'r', 39: 'a',
  40: '"', 41: '}',
  city: 'Navi Mumbai',
};

/** The shape Unicode Group's six populated vendors actually hold. */
const SEEDED = {
  city: 'Ahmedabad', line1: 'Seeded demo address', state: 'Gujarat',
  country: 'India', pincode: '380009', state_code: '24',
};

const vendorRow = (over = {}) => ({
  id: 'v-1', name: 'Rachana Print Solutions', gstin: '', email: '', phone: '9876543210',
  address: { ...SEEDED }, is_msme: null, enterprise_class: '', vendor_kind: '',
  udyam_number: '', tds_section: '194C', payment_terms_days: 45, ...over,
});

let container = null;
let root = null;
let vendorRows = [];
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
  vendorRows = [vendorRow()];
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

const clickText = async (label) => {
  const el = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  if (!el) throw new Error(`no button reading "${label}"`);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

const vendorForm = () => [...container.querySelectorAll('form.gn-form')]
  .find(f => f.querySelector('label.gn-form__field'));

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

describe('a vendor address can be typed at all', () => {
  it('Ganit · Payables sends the address it collected, under the printed keys', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();

    setValue(control(form, 'Name'), 'Rachana Print Solutions');
    setValue(control(form, 'Address line 1'), '12, Ashram Road');
    setValue(control(form, 'City'), 'Ahmedabad');
    setValue(control(form, 'State'), 'Gujarat');
    setValue(control(form, 'Pincode'), '380009');
    await settle();
    await submitForm(form);

    // The exact defect: this POST used to carry no `address` key at all, into a
    // router that has always bound one.
    expect(posted.address).toEqual({
      line1: '12, Ashram Road', line2: '', city: 'Ahmedabad',
      state: 'Gujarat', pincode: '380009', country: '',
    });
  });

  it('writes NO key outside the vocabulary the two renderers read', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();
    setValue(control(form, 'Name'), 'Kirana Supplies');
    setValue(control(form, 'City'), 'Surat');
    await settle();
    await submitForm(form);

    for (const k of Object.keys(posted.address)) {
      expect(VOCABULARY, `'${k}' is a second address spelling — invisible to _fmt_addr`)
        .toContain(k);
    }
  });

  it('a half-typed pincode blocks nothing — same rule as GSTIN/PAN/TAN', async () => {
    await mount(<PayablesTab />);
    await clickText('+ Vendor');
    const form = vendorForm();
    setValue(control(form, 'Name'), 'Kirana Supplies');
    setValue(control(form, 'Pincode'), '38');
    await settle();
    await submitForm(form);

    expect(api.post, 'a four-short pincode refused the save').toHaveBeenCalledTimes(1);
    expect(posted.address.pincode).toBe('38');
  });

  it('hydrates a stored address into the boxes, so it can be CORRECTED', async () => {
    await mount(<VendorsTab />);
    await clickText('Edit');
    const form = vendorForm();

    expect(control(form, 'Address line 1').value).toBe('Seeded demo address');
    expect(control(form, 'City').value).toBe('Ahmedabad');
    expect(control(form, 'Pincode').value).toBe('380009');
    expect(control(form, 'Country').value).toBe('India');
  });

  it('does not render state_code — a GST code is resolved to a name, never typed', async () => {
    await mount(<VendorsTab />);
    await clickText('Edit');
    const labels = [...vendorForm().querySelectorAll('label.gn-form__field')]
      .map(l => (l.childNodes[0]?.textContent || '').trim());
    expect(labels).not.toContain('State code');
    // …and no box anywhere is showing the raw '24'.
    const values = [...vendorForm().querySelectorAll('input')].map(i => i.value);
    expect(values).not.toContain('24');
  });
});

describe('editing a vendor never destroys the address it already has', () => {
  it('an edit that does not touch the address sends no address key at all', async () => {
    await mount(<VendorsTab />);
    await clickText('Edit');
    const form = vendorForm();

    setValue(control(form, 'TDS section'), '194J');
    await settle();
    await submitForm(form);

    const body = api.patch.mock.calls[0][1];
    expect(body.tds_section).toBe('194J');
    // Not `toEqual(SEEDED)` — ABSENT. `VendorUpdate.address` is `dict | None`
    // and the router omits the column from the SET when it is None, so an
    // unsent key is the only way to guarantee the stored jsonb is untouched.
    expect(Object.keys(body), 'the address rode along on an unrelated edit')
      .not.toContain('address');
  });

  it('an edit that DOES touch the address keeps state_code, which has no box', async () => {
    await mount(<VendorsTab />);
    await clickText('Edit');
    const form = vendorForm();

    setValue(control(form, 'City'), 'Gandhinagar');
    await settle();
    await submitForm(form);

    const { address } = api.patch.mock.calls[0][1];
    expect(address.city).toBe('Gandhinagar');
    expect(address.state).toBe('Gujarat');
    // The seventh key. Nothing renders it and nothing may drop it.
    expect(address.state_code, 'state_code was lost by a round trip through the form')
      .toBe('24');
  });

  it('survives Navrang Polymers — 43 keys, one of them contradicting 42 others', () => {
    const f = vendorFormFrom(vendorRow({ address: { ...NAVRANG } }));

    // The genuine key is read by NAME. The exploded copy is not reassembled —
    // it would produce "Mumbai", which is not what this record says.
    expect(f.address.city).toBe('Navi Mumbai');
    expect(f.address.state).toBe('');
    expect(f.address.line1).toBe('');
    // "0".."41" are carried, not rendered and not interpreted.
    expect(Object.keys(f.address_extra)).toHaveLength(42);
    expect(f.address_extra['0']).toBe('{');
    expect(f.address_extra['41']).toBe('}');
  });

  it('an untouched Navrang leaves all 43 keys exactly where they are', () => {
    const f = vendorFormFrom(vendorRow({ address: { ...NAVRANG } }));
    expect(Object.keys(vendorPayload(f))).not.toContain('address');
  });

  it('a touched Navrang loses none of the 42, and gains the six', () => {
    const f = vendorFormFrom(vendorRow({ address: { ...NAVRANG } }));
    const out = vendorAddress({ ...f, address: { ...f.address, pincode: '400705' } });

    for (const k of Object.keys(NAVRANG)) {
      if (k === 'city') continue;
      expect(out[k], `key '${k}' was dropped from a malformed address`).toBe(NAVRANG[k]);
    }
    expect(out.city).toBe('Navi Mumbai');
    expect(out.pincode).toBe('400705');
    expect(Object.keys(out)).toHaveLength(42 + 6);
  });

  it('clearing a box writes a blank, which reads as absent and is not a delete', () => {
    const f = vendorFormFrom(vendorRow());
    const out = vendorAddress({ ...f, address: { ...f.address, city: '   ' } });
    expect(out.city).toBe('');
    // Everything else survives the clear, including the unrendered seventh.
    expect(out.state).toBe('Gujarat');
    expect(out.state_code).toBe('24');
  });
});

describe('shapes the column has held, or is documented to have held', () => {
  it('an address stored as a JSON string is read, and left alone unless touched', () => {
    const f = vendorFormFrom(vendorRow({
      address: '{"city": "Mumbai", "pincode": "400001"}',
    }));
    expect(f.address.city).toBe('Mumbai');
    expect(f.address.pincode).toBe('400001');
    expect(Object.keys(vendorPayload(f))).not.toContain('address');
  });

  it('refuses to guess at loose text — no `line1: <the whole string>` in a PAYLOAD', () => {
    // `AddressBlock.asFields` does exactly that, correctly, for DISPLAY. Doing
    // it here would put a guess into the column and save it.
    const f = vendorFormFrom(vendorRow({ address: '12, Ashram Road, Ahmedabad' }));
    expect(f.address.line1).toBe('');
    expect(Object.keys(vendorPayload(f))).not.toContain('address');
  });

  it('does not throw on an array, a number, null, or a double-encoded string', () => {
    for (const address of [[], ['a'], 42, null, undefined, '', '{{bad', '"{\\"city\\": \\"X\\"}"']) {
      expect(() => vendorPayload(vendorFormFrom(vendorRow({ address }))), String(address))
        .not.toThrow();
    }
  });

  it('reads a numeric pincode as a pincode', () => {
    const f = vendorFormFrom(vendorRow({ address: { city: 'Surat', pincode: 395002 } }));
    expect(f.address.pincode).toBe('395002');
  });
});
