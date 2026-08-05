/**
 * Varta → Accounts: the control has to reach the endpoint.
 *
 * `POST /api/v1/whatsapp/accounts` was built with the module and never called
 * from anywhere. The Accounts sub-tab listed accounts and, when there were
 * none, printed "Connect your Meta Business Account to send and receive on your
 * own number" — an instruction the product had no control for. So
 * `varta_business_accounts` held zero rows in every org including Aekam's own,
 * and the reason was not that nobody had connected one. Nobody could.
 *
 * That is the same shape as four other defects found this week — Sanvaad
 * pinning with no entry point, the payslip screen with no role that reaches it,
 * the attendance shell with no such role in the database. Each compiled,
 * typechecked and bundled. A build cannot tell that a button is missing.
 *
 * So these assertions are about REACHABILITY, not markup: that the empty state
 * offers a way in, that submitting sends all six values Meta needs, and that a
 * refusal says which of them was wrong.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but its
 * @testing-library/dom peer is not. Same constraint as srijanHub.test.jsx.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => (Array.isArray(r?.data) ? r.data : r?.data?.data ?? []),
  body: (r) => r?.data ?? {},
}));

vi.mock('../../../../lib/auth', () => ({
  currentUser: () => ({ user_id: 'user_test', name: 'Tester' }),
}));

import { api } from '../../../../lib/api';
import { ToastProvider } from '../../../../components/ui/toast';
import WhatsAppTab from '../WhatsAppTab';

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (el) => act(() => root.render(<ToastProvider>{el}</ToastProvider>));
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };
const text = () => document.body.textContent;

/** The Accounts sub-tab, with the account list answering `rows`. */
async function openAccounts(rows = []) {
  api.get.mockResolvedValue({ data: rows });
  mount(<WhatsAppTab />);
  await settle();
  const tab = [...container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Accounts');
  await click(tab);
}

const find = (label) =>
  [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label));

/**
 * The dialog's submit button, specifically.
 *
 * `find('Connect')` matches "Connect an account" — the empty-state button is
 * still in the document behind the open modal, and `startsWith` reached it
 * first. Four tests then clicked the thing that OPENS the dialog and asserted
 * that submitting had happened, which is a test that can only ever fail. Scoped
 * to the form so it cannot pick up a button outside it.
 */
const submit = () => {
  const form = document.querySelector('.wa-conn');
  return [...form.querySelectorAll('button')]
    .find(b => b.textContent.trim().startsWith('Connect'));
};

/** Type into the field whose <label> starts with `label`. */
async function type(label, value) {
  const lab = [...document.querySelectorAll('label')]
    .find(l => l.textContent.trim().startsWith(label));
  const input = document.getElementById(lab.getAttribute('for'));
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

describe('Varta · Accounts — the empty state offers a way in', () => {
  it('renders a control, not just an instruction', async () => {
    await openAccounts([]);
    // The exact regression. The description told the reader to connect an
    // account; nothing on the page could.
    expect(text()).toContain('No WhatsApp Business account connected');
    expect(find('Connect an account')).toBeTruthy();
  });

  it('offers another one even when an account already exists', async () => {
    await openAccounts([{
      id: 'a1', display_name: 'Unicode Group', phone_number: '+919876543210',
      waba_id: '104', status: 'active',
    }]);
    expect(find('Connect another account')).toBeTruthy();
  });
});

describe('Varta · Accounts — connecting reaches the API', () => {
  it('sends all six values Meta needs', async () => {
    await openAccounts([]);
    await click(find('Connect an account'));

    await type('Display name', 'Unicode Group');
    await type('WhatsApp number', '+919876543210');
    await type('WhatsApp Business Account ID', '104111222333');
    await type('Phone number ID', '109444555666');
    await type('Permanent access token', 'EAAGtest');
    await type('Webhook verify token', 'a-phrase');

    api.post.mockResolvedValue({ data: { id: 'a1' } });
    await click(submit());

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/whatsapp/accounts');
    // Every field the backend's WAAccountCreate declares. A payload missing one
    // is a 422 the user reads as "it just didn't work".
    expect(payload).toEqual({
      display_name: 'Unicode Group',
      phone_number: '+919876543210',
      waba_id: '104111222333',
      phone_number_id: '109444555666',
      access_token: 'EAAGtest',
      webhook_verify_token: 'a-phrase',
    });
  });

  it('reloads the list afterwards, so the new account appears', async () => {
    await openAccounts([]);
    await click(find('Connect an account'));
    for (const [l, v] of [
      ['Display name', 'X'], ['WhatsApp number', '+91'], ['WhatsApp Business Account ID', '1'],
      ['Phone number ID', '2'], ['Permanent access token', 't'],
    ]) await type(l, v);

    const before = api.get.mock.calls.length;
    api.post.mockResolvedValue({ data: { id: 'a1' } });
    await click(submit());
    expect(api.get.mock.calls.length).toBeGreaterThan(before);
  });

  it('the token is masked and never pre-filled', async () => {
    await openAccounts([]);
    await click(find('Connect an account'));
    const lab = [...document.querySelectorAll('label')]
      .find(l => l.textContent.trim().startsWith('Permanent access token'));
    const input = document.getElementById(lab.getAttribute('for'));
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
  });
});

describe('Varta · Accounts — a refusal says which value was wrong', () => {
  it('names the fields still missing rather than "fill in the form"', async () => {
    await openAccounts([]);
    await click(find('Connect an account'));
    await type('Display name', 'Unicode Group');
    await click(submit());

    expect(api.post).not.toHaveBeenCalled();
    // Six near-identical long numbers is exactly where "required fields are
    // missing" is useless.
    expect(text()).toContain('WhatsApp Business Account ID');
    expect(text()).toContain('Permanent access token');
  });

  it('shows the server’s reason, not a generic failure', async () => {
    await openAccounts([]);
    await click(find('Connect an account'));
    for (const [l, v] of [
      ['Display name', 'X'], ['WhatsApp number', '+91'], ['WhatsApp Business Account ID', '1'],
      ['Phone number ID', '2'], ['Permanent access token', 'expired'],
    ]) await type(l, v);

    api.post.mockRejectedValue({
      response: { status: 400, data: { detail: 'That access token has expired.' } },
    });
    await click(submit());
    expect(text()).toContain('That access token has expired.');
  });

  it('the webhook verify token is optional', async () => {
    await openAccounts([]);
    await click(find('Connect an account'));
    for (const [l, v] of [
      ['Display name', 'X'], ['WhatsApp number', '+91'], ['WhatsApp Business Account ID', '1'],
      ['Phone number ID', '2'], ['Permanent access token', 't'],
    ]) await type(l, v);

    api.post.mockResolvedValue({ data: { id: 'a1' } });
    await click(submit());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][1].webhook_verify_token).toBe('');
  });
});
