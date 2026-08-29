/**
 * TabProfile — the GST state, which no screen in this product could set.
 *
 * `client_billing._tax_split` refuses to raise an invoice when
 * `organisations.state_code` is empty, and the refusal it prints is "Set the
 * organisation's state in Settings -> Profile". This screen IS Settings ->
 * Profile, and it had no such field — the TDS-challan failure repeated one
 * column over, and documented in `org_profile.py`'s own header before it
 * happened again.
 *
 * Measured live 2026-08-29: `GET /api/v1/org/profile` returned seventeen keys
 * and `state_code` was not among them while the column held '24'; a PATCH
 * naming it answered 400 "Nothing to update", because pydantic dropped the
 * undeclared key. Two of five organisations sat at NULL and could not raise a
 * GST invoice by any route.
 *
 * ⚠ The two rules under test are opposites and both matter:
 *   · The control must EXIST and must bind the numeric code.
 *   · "Not set" must stay choosable and saveable. Two live orgs are empty, and
 *     a blocking field would refuse them their name, address and bank details
 *     over a column they had never been able to fill.
 *
 * `createRoot` + `act` rather than @testing-library/react — the house pattern,
 * and testing-library is not installed (its @testing-library/dom peer is
 * missing, so importing it throws).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider } from '../../../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** What the server sends. Seventeen keys plus the one this fix adds. */
const profile = (overrides = {}) => ({
  name: 'Unicode Group',
  gstin: '', pan: '', tan: '',
  state_code: '24',
  logo_url: '', logo_key: '', email: '', phone: '', website: '',
  billing_address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
  bank_details: { account_name: '', account_number: '', ifsc: '', bank_name: '', branch: '', upi_id: '' },
  invoice_note: '',
  description: null, industry: null, team_size: null, founded_year: null,
  id: 'fae87907-2f99-4b35-a241-c94d9e1e4a17',
  ...overrides,
});

let payload;
let patchResponse;
const patches = [];

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn(() => (payload instanceof Error
      ? Promise.reject(payload)
      : Promise.resolve({ data: payload }))),
    patch: vi.fn((url, body) => {
      patches.push({ url, body });
      return Promise.resolve({ data: { ...payload, ...body, ...patchResponse } });
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const { default: TabProfile } = await import('../TabProfile');
const { api } = await import('../../../lib/api');

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

/** Poll rather than sleep a fixed span — these run beside other suites. */
const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { return check(); } catch (err) {
      if (Date.now() > deadline) throw err;
      await settle(15);
    }
  }
};

const mount = async () => {
  await act(async () => {
    root.render(<ToastProvider><TabProfile /></ToastProvider>);
  });
  await settle();
};

const stateSelect = () => container.querySelector('#org-state-code');
const saveButton = () => [...container.querySelectorAll('button')]
  .find(b => /save company profile/i.test(b.textContent));

/** React keeps its own value on the node; the native setter is what a real
 *  interaction reaches. Assigning `.value` is reverted on the next render. */
const choose = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const save = async () => {
  await act(async () => { saveButton().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

beforeEach(() => {
  payload = profile();
  patchResponse = {};
  patches.length = 0;
  api.get.mockClear();
  api.patch.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('TabProfile — the GST state control', () => {
  it('EXISTS, and is a select rather than a text box', async () => {
    await mount();
    // A missing control is a failure and never a skip: this field's absence is
    // the entire defect, and an assertion that tolerated it would have passed
    // for as long as the bug lived.
    const el = await until(() => {
      const s = stateSelect();
      expect(s, 'there is no GST state control on the company profile').toBeTruthy();
      return s;
    });
    // Free text would let "Maharastra", "MH " and "27" be stored as three
    // different states on the field that decides CGST/SGST versus IGST.
    expect(el.tagName).toBe('SELECT');
  });

  it('offers the state NAME and binds the numeric code', async () => {
    await mount();
    const el = await until(() => {
      const s = stateSelect();
      expect(s).toBeTruthy();
      return s;
    });
    const gujarat = [...el.options].find(o => o.value === '24');
    expect(gujarat, 'no option for 24').toBeTruthy();
    // The NAME, never the digits. "Ahmedabad, 24" reads as a house number —
    // the convention `AddressBlock.stateOf` exists to enforce.
    expect(gujarat.textContent).toBe('Gujarat');
    expect(gujarat.textContent).not.toMatch(/\d/);
  });

  it('carries 97 and 99, which a naive 01–38 range check would refuse', async () => {
    await mount();
    const el = await until(() => {
      const s = stateSelect();
      expect(s).toBeTruthy();
      return s;
    });
    const values = [...el.options].map(o => o.value);
    // Both are real published codes on real GSTINs — 97 for supplies outside
    // any state, 99 where the Centre holds jurisdiction. An org on either
    // could not save under a range check.
    expect(values).toContain('97');
    expect(values).toContain('99');
    expect(values).toContain('24');
    expect(values).toContain('27');
  });

  it('shows the stored code as the chosen state', async () => {
    await mount();
    await until(() => expect(stateSelect()?.value).toBe('24'));
  });

  it('sends the numeric code when a state is picked', async () => {
    await mount();
    await until(() => expect(stateSelect()).toBeTruthy());
    await choose(stateSelect(), '27');
    await save();

    await until(() => expect(patches).toHaveLength(1));
    expect(patches[0].body.state_code).toBe('27');
  });

  // ── The rule that must never regress ──────────────────────────────────────

  it('offers "Not set" FIRST and lets an empty state be saved', async () => {
    await mount();
    const el = await until(() => {
      const s = stateSelect();
      expect(s).toBeTruthy();
      return s;
    });
    // First, because "we would rather not say" is a legitimate answer and two
    // live organisations are in exactly that state.
    expect(el.options[0].value).toBe('');
    expect(el.options[0].textContent).toBe('Not set');

    await choose(el, '');
    await save();
    await until(() => expect(patches).toHaveLength(1));
    expect(patches[0].body.state_code).toBe('');
  });

  it('renders an org whose state_code is NULL as "Not set", controlled', async () => {
    // Aekam Inc and Demo - Kartavaya, live, today: the column says NULL and it
    // reaches this component as `null`, because `{...EMPTY, ...r.data}` lets
    // the server's null overwrite EMPTY's ''.
    //
    // ⚠ ASSERTED ON THE CONSOLE, not on `.value`. React renders `value={null}`
    // as an UNCONTROLLED select — it warns and then falls back to whatever the
    // browser picks, which is the first option, whose value is also ''. So
    // reading `.value` cannot tell the controlled case from the broken one and
    // an assertion on it passes either way. The warning is the only observable
    // difference, and "zero uncaught console errors" is this programme's own
    // standing rule.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      payload = profile({ state_code: null });
      await mount();
      await until(() => expect(stateSelect()).toBeTruthy());

      const nullWarning = spy.mock.calls
        .map(args => String(args[0]))
        .find(m => /`value` prop on .* should not be null/.test(m));
      expect(nullWarning, 'the select went uncontrolled on a NULL state_code').toBeUndefined();
      expect(stateSelect().value).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not send state_code when only another field changed', async () => {
    // The PATCH carries the WHOLE form, so a key that appears without the user
    // touching it is a write nobody asked for — and on this column that write
    // decides how every invoice is taxed.
    payload = profile({ state_code: null });
    await mount();
    await until(() => expect(stateSelect()).toBeTruthy());

    await type(container.querySelector('#org-name'), 'Renamed Ltd');
    await save();

    await until(() => expect(patches).toHaveLength(1));
    expect(Object.keys(patches[0].body)).toEqual(['name']);
  });

  it('stops offering to save a state that has just been saved', async () => {
    // The other half of the diff: after a successful PATCH the form must adopt
    // what it sent, or the field stays permanently "changed" and every
    // subsequent save re-writes it. Cheap to get wrong, invisible on screen,
    // and it would put state_code into a PATCH the user never edited.
    await mount();
    await until(() => expect(stateSelect()).toBeTruthy());

    await choose(stateSelect(), '27');
    await save();
    await until(() => expect(patches).toHaveLength(1));

    await save();
    await settle(30);
    expect(patches, 'the saved state was offered up again on the next save')
      .toHaveLength(1);
  });

  it('a blank state does not block the rest of the form from saving', async () => {
    // The blast radius the TAN bug actually had: one field refusing took the
    // name, address and bank details down with it.
    payload = profile({ state_code: null });
    await mount();
    await until(() => expect(stateSelect()).toBeTruthy());

    await type(container.querySelector('#org-name'), 'Still Saves Ltd');
    await save();
    await until(() => expect(patches).toHaveLength(1));
    expect(patches[0].body.name).toBe('Still Saves Ltd');
  });

  // ── Telling the truth about what is stored ────────────────────────────────

  it('keeps showing a code the table does not carry, rather than blanking it', async () => {
    // '28' is pre-bifurcation Andhra Pradesh: the server resolves it, this
    // side's table deliberately omits it. With no option for it the select
    // would render BLANK over a populated column — a control lying about what
    // is stored, and one keystroke from overwriting it with nothing.
    payload = profile({ state_code: '28' });
    await mount();
    await until(() => expect(stateSelect()?.value).toBe('28'));
    expect(container.textContent).toContain('no longer issued');
  });

  it("shows the server's warning about a retired code beside the field", async () => {
    patchResponse = {
      code_warnings: {
        state_code: 'Daman and Diu (25) is no longer issued on new GST registrations.',
      },
    };
    await mount();
    await until(() => expect(stateSelect()).toBeTruthy());
    await choose(stateSelect(), '25');
    await save();

    await until(() => {
      const err = container.querySelector('#org-state-code-e');
      expect(err, 'the warning was not rendered beside the field').toBeTruthy();
      expect(err.textContent).toContain('no longer issued');
    });
  });

  it('flags a state that disagrees with the GSTIN, and still saves', async () => {
    // The GSTIN's first two characters ARE the state of registration, so when
    // the two disagree one is a typo — and, as with the PAN check beside it,
    // neither field is invalid on its own so neither validator can see it.
    payload = profile({ gstin: '27AAAAA0000A1Z5', state_code: '24' });
    await mount();
    await until(() => {
      const err = container.querySelector('#org-state-code-e');
      expect(err, 'a GSTIN/state disagreement was not reported').toBeTruthy();
      // Named, never rendered as the digits.
      expect(err.textContent).toContain('Maharashtra');
    });

    // Reported, not enforced: it is not knowable from here which of the two is
    // wrong, and a statutory code has never been allowed to block this form.
    await type(container.querySelector('#org-name'), 'Disagreeing Ltd');
    await save();
    await until(() => expect(patches).toHaveLength(1));
  });

  it('says nothing when the GSTIN and the state agree', async () => {
    payload = profile({ gstin: '24AAAAA0000A1Z5', state_code: '24' });
    await mount();
    await until(() => expect(stateSelect()).toBeTruthy());
    expect(container.querySelector('#org-state-code-e')).toBeNull();
  });
});
