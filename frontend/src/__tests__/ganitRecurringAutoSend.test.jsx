/**
 * The recurring-invoice screen must not promise a send that never happens.
 *
 * `ganit_recurring.auto_send` is stored by `POST /recurring`, returned by
 * `GET /recurring`, and — since the generator was repaired — COUNTED by
 * `generate_due_invoices`, which returns `awaiting_send`. What no code anywhere
 * does is EMAIL the invoice. Nothing consumes `awaiting_send` either: the
 * scheduler takes the dict and reports the numbers.
 *
 * That gap is deliberate on the backend's side and well argued — `OUTBOUND_MODE`
 * is unset on production, which outbound.py reads as "live", so wiring a send
 * into a job about to go on a cron for the first time would mail real customers
 * on its first tick. The fault was never the missing send. It was the screen,
 * which said "Auto-send" beside the checkbox and " · auto-send" on the row, and
 * so told the operator their customer had been emailed.
 *
 * A checkbox that does nothing is worse than an absent one: it is a promise.
 * These tests hold the words to what the product actually does.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: (...a) => post(...a),
    delete: (...a) => del(...a),
  },
  rows: r => (Array.isArray(r?.data) ? r.data : (r?.data?.data ?? [])),
  body: r => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: RecurringTab } = await import('../pages/ganit/RecurringTab');

const FLAGGED = {
  id: 'rec-1', contact_name: 'Bharat Textiles', frequency: 'monthly',
  next_date: '2026-09-01', end_date: null, auto_send: true,
  subtotal: 50000, is_active: true,
};

let container = null;
let root = null;
let schedules = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  get.mockReset();
  post.mockReset();
  del.mockReset();
  schedules = [];
  get.mockImplementation((url) => {
    if (url.includes('/graha/contacts')) return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: { data: schedules } });
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

async function mount() {
  await act(async () => { root.render(<ToastProvider><RecurringTab /></ToastProvider>); });
  await act(async () => {});
}

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
}

const byText = (t) => Array.from(container.querySelectorAll('button'))
  .find(b => b.textContent.trim() === t);

describe('RecurringTab — the auto-send checkbox is a promise, so it must be honest', () => {
  it('does not say "auto-send" anywhere on a flagged schedule', async () => {
    schedules = [FLAGGED];
    await mount();
    // The exact string the row used to render: "Next 2026-09-01 · auto-send".
    expect(container.textContent).not.toMatch(/auto-send/i);
  });

  it('says the schedule is flagged, not that it sends', async () => {
    schedules = [FLAGGED];
    await mount();
    expect(container.textContent).toContain('flagged to send');
  });

  it('says nothing about sending on a schedule that is not flagged', async () => {
    schedules = [{ ...FLAGGED, auto_send: false }];
    await mount();
    expect(container.textContent).not.toContain('flagged to send');
  });

  it('the form control is not labelled "Auto-send"', async () => {
    await mount();
    await click(byText('+ New recurring invoice'));
    const labels = Array.from(container.querySelectorAll('.gn-chk'))
      .map(l => l.textContent);
    expect(labels.some(t => /auto-send/i.test(t))).toBe(false);
  });

  it('the form states plainly that no email is sent', async () => {
    await mount();
    await click(byText('+ New recurring invoice'));
    const text = container.textContent;
    // The one sentence that stops an operator assuming the customer has it.
    expect(text).toMatch(/does not email invoices on its own/i);
    expect(text).toMatch(/waits under Invoices for you to send it/i);
  });

  it('still submits auto_send, so the stored intent is not thrown away', async () => {
    // The words changed; the field did not. `generate_due_invoices` already
    // reads it, and the day sending is wired the existing flags must still mean
    // what their owners meant.
    post.mockResolvedValue({ data: { status: 'created' } });
    await mount();
    await click(byText('+ New recurring invoice'));
    const box = container.querySelector('.gn-chk--stack input[type="checkbox"]');
    expect(box).toBeTruthy();
    // A real click, not `box.checked = true` followed by one — a dispatched
    // click TOGGLES the box, so pre-setting it flips it straight back off.
    await click(box);
    expect(box.checked).toBe(true);
    const form = container.querySelector('form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].auto_send).toBe(true);
  });

  it('the empty state does not say an invoice can send itself', async () => {
    schedules = [];
    await mount();
    expect(container.textContent).not.toMatch(/sends itself/i);
  });
});
