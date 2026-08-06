/**
 * TabSenders — the screen that must not claim a feature is on when it is off.
 *
 * The panel has three states and two of them are the point:
 *
 *   · THE TABLE DOES NOT EXIST. `110_org_email_senders.sql` is written and not
 *     applied — staging and production share one database, so nothing applies a
 *     migration automatically. The form must be visibly disabled and must name
 *     the migration, rather than accepting what the user types and dropping it.
 *     That is `TabSecurity`'s precedent and `TabProfile`'s stated complaint.
 *
 *   · AN ADDRESS IS SAVED BUT NOT VERIFIED. Mail still goes out from the old
 *     sender, because Resend answers 403 and SES answers MessageRejected for an
 *     unverified domain, and honouring the row would delete the payslip rather
 *     than merely misfile it. The screen has to SAY so — an address sitting
 *     there with a tick beside it while the product ignores it is the specific
 *     lie this panel exists not to tell.
 *
 * And one destructive path: a failed GET must not render an empty form. Every
 * blank field means "clear this bucket", so saving a form that failed to load
 * would delete every address the org had set.
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern (see orgSettingsTabs.test.jsx) and is NOT installed — its
 * @testing-library/dom peer is missing, so importing it throws.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider } from '../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NINE = [
  'invoice', 'sales', 'payroll', 'crm', 'notifications',
  'attendance', 'hr', 'marketing', 'no-reply',
];

const FALLBACK = 'Unicode Group <info@unicodegroup.com>';

let payload;
const puts = [];

const bare = (overrides = {}) => ({
  senders: NINE.map(p => ({
    purpose: p,
    label: `what ${p} is for`,
    from_email: null,
    from_name: null,
    is_verified: false,
  })),
  fallback: FALLBACK,
  available: true,
  verification_note: 'Addresses are stored but not used until the domain is verified.',
  ...overrides,
});

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(() => (payload instanceof Error
      ? Promise.reject(payload)
      : Promise.resolve({ data: payload }))),
    put: vi.fn((url, body) => {
      puts.push({ url, body });
      return Promise.resolve({ data: payload });
    }),
  },
}));

const { default: TabSenders } = await import('../pages/org/TabSenders');
const { api } = await import('../lib/api');

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
    root.render(
      <ToastProvider>
        <TabSenders />
      </ToastProvider>,
    );
  });
  await settle();
};

const inputs = () => [...container.querySelectorAll('input')];
const emailInput = purpose => container.querySelector(`#snd-${purpose}-email`);
const saveButton = () => [...container.querySelectorAll('button')]
  .find(b => /save sender addresses/i.test(b.textContent));

const type = async (el, value) => {
  // React 19 keeps its own value on the DOM node; setting `.value` directly is
  // reverted on the next render. The native setter is what a real keystroke
  // reaches, which is why the house tests use it rather than assigning.
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  payload = bare();
  puts.length = 0;
  api.get.mockClear();
  api.put.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('TabSenders', () => {
  it('renders one row per purpose the server names', async () => {
    await mount();
    await until(() => {
      for (const p of NINE) expect(emailInput(p)).toBeTruthy();
    });
    // Two fields each: address and display name. Not nine — a panel that
    // rendered only the address would silently drop every display name on save.
    expect(inputs()).toHaveLength(NINE.length * 2);
  });

  it('says what every message is currently sent as', async () => {
    await mount();
    // The user cannot judge whether to change anything without knowing what
    // "not configured" resolves to.
    await until(() => expect(container.textContent).toContain(FALLBACK));
  });

  it('disables the whole form and names the migration when the table is absent', async () => {
    payload = bare({ available: false });
    await mount();
    await until(() => expect(emailInput('payroll')).toBeTruthy());

    expect(inputs().every(i => i.disabled)).toBe(true);
    expect(saveButton().disabled).toBe(true);
    // Naming the file is the difference between "this is broken" and "somebody
    // has to run one thing". It is the same courtesy org_profile.py's 503 pays.
    expect(container.textContent).toContain('110_org_email_senders.sql');
  });

  it('says an unverified address is stored and NOT being used', async () => {
    payload = bare();
    payload.senders[2] = {
      ...payload.senders[2],
      from_email: 'payroll@unicodegroup.com',
      from_name: 'Unicode Payroll',
      is_verified: false,
    };
    await mount();
    await until(() => expect(emailInput('payroll').value)
      .toBe('payroll@unicodegroup.com'));

    const text = container.textContent;
    expect(text).toContain('not in use');
    // And it must name what IS being used, or "not in use" leaves the user
    // guessing where their mail is coming from.
    expect(text).toContain(FALLBACK);
  });

  it('marks a verified address as in use', async () => {
    payload = bare();
    payload.senders[2] = {
      ...payload.senders[2],
      from_email: 'payroll@unicodegroup.com',
      is_verified: true,
    };
    await mount();
    await until(() => expect(container.textContent).toContain('In use'));
    expect(container.textContent).not.toContain('not in use yet');
  });

  it('sends blanks as null so an emptied field clears the row', async () => {
    payload = bare();
    payload.senders[2] = {
      ...payload.senders[2], from_email: 'payroll@unicodegroup.com',
    };
    await mount();
    await until(() => expect(emailInput('payroll').value).toBeTruthy());

    await type(emailInput('payroll'), '   ');
    await act(async () => { saveButton().click(); });
    await until(() => expect(puts).toHaveLength(1));

    const sent = puts[0].body.senders.find(s => s.purpose === 'payroll');
    // `null`, not `''` and not `'   '`. The endpoint DELETEs on null; an empty
    // string would fail the address CHECK and 400 the whole form.
    expect(sent.from_email).toBeNull();
    expect(puts[0].body.senders).toHaveLength(NINE.length);
  });

  it('refuses to save a value that is not a bare address', async () => {
    await mount();
    await until(() => expect(emailInput('payroll')).toBeTruthy());

    await type(emailInput('payroll'), 'Payroll <payroll@unicodegroup.com>');
    await act(async () => { saveButton().click(); });
    await settle(30);

    // No request at all. A round-trip that comes back 400 is a worse version of
    // the same message, and this one can name the actual mistake.
    expect(puts).toHaveLength(0);
    expect(container.textContent).toContain('The name goes in the next field');
  });

  it('does not render the form when the load failed', async () => {
    payload = new Error('boom');
    await mount();
    await settle(30);

    // THE DESTRUCTIVE PATH. Every blank field means "clear this bucket", so a
    // form rendered over a failed load is one Save away from deleting every
    // address the org had set.
    expect(inputs()).toHaveLength(0);
    expect(saveButton()).toBeUndefined();
  });
});
