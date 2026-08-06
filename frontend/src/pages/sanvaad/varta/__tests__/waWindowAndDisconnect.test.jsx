/**
 * Varta — the window comes from the server, a template send names the
 * template, and a connected number can be disconnected.
 *
 * Three regressions, and the first two are the same mistake in two places:
 * a rule that only the control enforcing it knows about.
 *
 * 1 · THE WINDOW WAS DERIVED FROM ONE PAGE OF MESSAGES.
 *     `waWindow.js` says so in its own header: the derivation "only sees the
 *     newest page (50 messages); a conversation with more than 50 outbound
 *     messages since the last inbound one reads as 'never opened'". The
 *     endpoint it asks for now exists and reads MAX(created_at) over every
 *     inbound row, so the client must prefer it.
 *
 * 2 · A TEMPLATE SEND CARRIED NO TEMPLATE.
 *     It posted `{content: tpl.body, type: 'template'}` — the rendered text
 *     under a template label. `varta_messages.template_name` and
 *     `template_params` stayed empty, so nothing could later say which
 *     template a customer got; and with no id on the wire the server had
 *     nothing to check approval against.
 *
 * 3 · THERE WAS NO WAY TO DISCONNECT A NUMBER.
 *     `POST /accounts` had no counterpart. An org that wanted to revoke our
 *     access, or replace an expired token, had no control for either — the
 *     same defect the Connect dialog was built to fix, one row further down.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not. Same constraint as waConnect.test.jsx.
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
import WAChat from '../WAChat';
import { fromServer, windowState } from '../waWindow';

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
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };
const text = () => document.body.textContent;
const button = (label) =>
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label);

const HOUR = 3600 * 1000;

/** Answer each endpoint from a map, so one component's fetches do not have to
 *  be ordered against another's. */
function route(map) {
  api.get.mockImplementation((url) => {
    const key = Object.keys(map).find(k => url.includes(k));
    if (!key) return Promise.reject(new Error(`unrouted GET ${url}`));
    return Promise.resolve({ data: map[key] });
  });
}

// ── The pure adapter ─────────────────────────────────────────────────

describe('waWindow · fromServer', () => {
  it('recomputes `open` from the timestamp, not from the payload flag', () => {
    // The window expired forty seconds after the response was built. Trusting
    // the boolean leaves a free-text composer on screen against a closed
    // window, and Meta rejects everything typed into it.
    const stale = {
      open: true,
      ever_inbound: true,
      expires_at: new Date(Date.now() - 40_000).toISOString(),
      remaining_seconds: 40,
    };
    expect(fromServer(stale).open).toBe(false);
  });

  it('reads a customer who has never written as closed, not unknown', () => {
    const w = fromServer({ open: false, ever_inbound: false, expires_at: null });
    expect(w.everInbound).toBe(false);
    expect(w.open).toBe(false);
  });

  it('returns null — not a closed window — when the payload is unusable', () => {
    // Null means "fall back to the local derivation". A closed window would
    // silently replace the composer on a conversation that is perfectly fine.
    expect(fromServer(null)).toBe(null);
    expect(fromServer({ ever_inbound: true, expires_at: 'nonsense' })).toBe(null);
  });

  it('agrees with the local derivation when both can see the same facts', () => {
    const lastInbound = Date.now() - 3 * HOUR;
    const local = windowState([
      { direction: 'inbound', created_at: new Date(lastInbound).toISOString() },
    ]);
    const server = fromServer({
      ever_inbound: true,
      expires_at: new Date(lastInbound + 24 * HOUR).toISOString(),
    });
    expect(server.open).toBe(local.open);
    expect(server.expiresAt).toBe(local.expiresAt);
  });
});

// ── WAChat prefers the server, and names the template ────────────────

const CONV = { id: 'c1', phone_number: '+919999900011', contact_name: 'Anita Deshmukh' };

/** A page of 50 outbound messages and no inbound one — the exact shape
 *  `waWindow.js` names as its blind spot. */
const OUTBOUND_ONLY = Array.from({ length: 50 }, (_, i) => ({
  id: `m${i}`,
  direction: 'outbound',
  content: `reply ${i}`,
  type: 'text',
  status: 'delivered',
  created_at: new Date(Date.now() - (50 - i) * 60_000).toISOString(),
}));

describe('WAChat · the server decides the window', () => {
  it('keeps the composer when the page shows no inbound message but the server does', async () => {
    // Locally this reads as "never opened" and the composer becomes a template
    // picker. The server can see the inbound message that fell off the page.
    route({
      '/messages': OUTBOUND_ONLY,
      '/window': {
        open: true,
        ever_inbound: true,
        expires_at: new Date(Date.now() + 6 * HOUR).toISOString(),
        remaining_seconds: 6 * 3600,
      },
      '/templates': [],
    });

    mount(<WAChat conversation={CONV} />);
    await settle();

    expect(text()).toContain('24-hour window open');
    expect(text()).not.toContain('has not messaged you yet');
  });

  it('closes the composer when the server says closed, however the page reads', async () => {
    route({
      '/messages': [{
        id: 'm1', direction: 'inbound', content: 'hi', type: 'text',
        status: 'delivered', created_at: new Date(Date.now() - HOUR).toISOString(),
      }],
      // The server saw a newer state of the world than this page did — the
      // inbound row above is 30 hours old in the database and this client's
      // clock or cache disagrees. The server is the one reading every row.
      '/window': {
        open: false, ever_inbound: true,
        expires_at: new Date(Date.now() - 6 * HOUR).toISOString(),
        remaining_seconds: 0,
      },
      '/templates': [],
    });

    mount(<WAChat conversation={CONV} />);
    await settle();

    expect(text()).toContain('The 24-hour window has closed.');
  });

  it('falls back to the page when the window request fails', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('/window')) return Promise.reject(new Error('500'));
      if (url.includes('/templates')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [{
        id: 'm1', direction: 'inbound', content: 'hi', type: 'text',
        status: 'delivered', created_at: new Date(Date.now() - HOUR).toISOString(),
      }] });
    });

    mount(<WAChat conversation={CONV} />);
    await settle();

    // A failed window request must not blank the log or lock the composer.
    expect(text()).toContain('24-hour window open');
    expect(text()).toContain('hi');
  });
});

describe('WAChat · a template send names the template', () => {
  it('posts template_id rather than the rendered body under a template label', async () => {
    route({
      '/messages': [],
      '/window': { open: false, ever_inbound: false, expires_at: null, remaining_seconds: 0 },
      '/templates': [{
        id: 'tpl-1', name: 'order_dispatched_v2', language: 'en',
        status: 'approved', body: 'Hello {{1}}, your order {{2}} has shipped.',
      }],
    });

    mount(<WAChat conversation={CONV} />);
    await settle();

    api.post.mockResolvedValue({ data: {
      id: 'm-new', direction: 'outbound', type: 'template', status: 'pending',
      content: 'Hello {{1}}, your order {{2}} has shipped.',
      created_at: new Date().toISOString(),
    } });

    const send = document.querySelector('.m2tpl .cmp__send');
    expect(send).toBeTruthy();
    await click(send);

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/whatsapp/conversations/c1/messages');
    expect(payload.type).toBe('template');
    expect(payload.template_id).toBe('tpl-1');
  });
});

// ── Disconnecting a connected number ─────────────────────────────────

const ACCOUNT = {
  id: 'acct-1', display_name: 'Unicode Group', phone_number: '+919999900001',
  waba_id: '104000000000001', status: 'active',
};

async function openAccounts(rows) {
  route({ '/accounts': rows, '/conversations': [] });
  mount(<WhatsAppTab />);
  await settle();
  await click([...container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Accounts'));
}

describe('Varta · Accounts — a connected number can be disconnected', () => {
  it('offers the control at all', async () => {
    await openAccounts([ACCOUNT]);
    expect(button('Disconnect')).toBeTruthy();
  });

  it('does not delete on the first click — it asks, and asks for typing', async () => {
    await openAccounts([ACCOUNT]);
    await click(button('Disconnect'));

    expect(api.delete).not.toHaveBeenCalled();
    // Reconnecting is not an undo: it needs the six values from Meta again and
    // a fresh permanent token, which the person clicking may not have.
    expect(text()).toContain('DISCONNECT');
    expect(text()).toContain('the stored access token is deleted');
  });

  it('calls DELETE once the confirmation is typed, and reloads the list', async () => {
    await openAccounts([ACCOUNT]);
    await click(button('Disconnect'));

    const input = document.querySelector('.cd__type input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'DISCONNECT');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const before = api.get.mock.calls.length;
    api.delete.mockResolvedValue({ data: { ok: true } });
    const confirmBtn = [...document.querySelectorAll('.modal__foot button')]
      .find(b => b.textContent.trim() === 'Disconnect');
    await click(confirmBtn);

    expect(api.delete).toHaveBeenCalledWith('/v1/whatsapp/accounts/acct-1');
    expect(api.get.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('Varta · Accounts — the state says what to do about it', () => {
  it('a pending number is not called Active', async () => {
    // The INSERT used to write `active` outright, so a typo in phone_number_id
    // — the column the webhook looks accounts up BY — showed a green Active
    // chip while every inbound message was silently dropped.
    await openAccounts([{ ...ACCOUNT, status: 'pending' }]);
    expect(text()).toContain('Waiting for Meta');
    expect(text()).not.toContain('Active');
    expect(text()).toContain('Meta Business Suite');
  });

  it('a failed number says the token has to be replaced', async () => {
    await openAccounts([{ ...ACCOUNT, status: 'failed' }]);
    expect(text()).toContain('Connection failed');
    expect(text()).toContain('fresh permanent access token');
  });

  it('suspended reads the same as failed, because it is the same situation', async () => {
    // `failed` lands in `suspended` until migration 123 relaxes the CHECK.
    // Two labels for one situation is two support conversations for one fix.
    await openAccounts([{ ...ACCOUNT, status: 'suspended' }]);
    expect(text()).toContain('Connection failed');
  });
});
