/**
 * A deal can be marked Lost. Until this file, nobody could say why.
 *
 * ── THE SHAPE OF THE DEFECT ────────────────────────────────────────────────
 * `graha_deals.lost_reason` has existed since migration 018:64. `DealUpdate`
 * has carried the field since the beginning. `_DEAL_COLS` was taught to write
 * it in the fix whose own comment reads "the reason a deal was lost can never
 * be saved" — and that fix shipped WITHOUT A SCREEN. A grep for `lost_reason`
 * across `frontend/` returned nothing at all: not a label, not a state key,
 * not a payload key.
 *
 * So the column was writable, reachable over the API and pinned by a backend
 * test — and unreachable by any person using the product. That is the
 * orphaned-capability shape, the same one that hid an expense receipt behind a
 * route with no file input, and it is invisible to every check that reads the
 * API instead of the screen. Suite 04.11 found it by driving the real screen.
 *
 * ── WHAT IS PINNED HERE, AND HOW EACH ONE CAN FAIL ─────────────────────────
 *  1. the control EXISTS at the Lost stage — the whole defect;
 *  2. it is NOT offered at any other stage, so the form does not ask a
 *     question that has no meaning yet;
 *  3. the value REACHES the PATCH — a field that renders and is dropped from
 *     the payload is the same bug one layer along, and is precisely what
 *     `_DEAL_COLS` did for the entire life of the product;
 *  4. the box is SEEDED from the row, or opening the editor on a lost deal and
 *     saving would send an empty string over a real reason. `_DEAL_COLS` drops
 *     only `None`, so an empty string is a write;
 *  5. moving a deal OUT of Lost does not send the key at all, so the recorded
 *     reason survives a stage corrected by hand;
 *  6. it is READ BACK on the record, because a reason that can be typed and
 *     never seen has not been captured.
 *
 * Rendered with react-dom directly, for the reason `dealRoute.test.jsx` gives:
 * `@testing-library/react` is installed and its `@testing-library/dom` peer is
 * not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import DealRoute from '../DealRoute';

const ID = '6f1c2b3a-4d5e-4f60-8a91-b2c3d4e5f607';

const BASE = {
  id: ID,
  title: 'Ratan Steel annual audit',
  value: 450000,
  probability: 60,
  client_name: 'Ratan Steel Pvt Ltd',
  expected_close_date: '2026-09-30',
  notes: 'Waiting on their board sign-off.',
  updated_at: '2026-08-19T00:00:00Z',
};

let DEAL = { ...BASE, stage: 'Proposal' };
let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  DEAL = { ...BASE, stage: 'Proposal' };
  api.get.mockImplementation((url) => {
    if (String(url).startsWith(`/v1/graha/deals/${ID}`)) {
      return Promise.resolve({ data: { deal: DEAL, activities: [] } });
    }
    return Promise.resolve({ data: { data: [] } });
  });
  api.patch.mockResolvedValue({ data: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/graha/deals/${ID}`]}>
        <ToastProvider>
          <Routes>
            <Route path="/graha/deals/:dealId" element={<DealRoute />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await settle();
};

const drawer = () => document.querySelector('[role="dialog"]');
const byText = (sel, re) => Array.from(drawer().querySelectorAll(sel))
  .find((el) => re.test(el.textContent || ''));

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/** The `<select>` holding the pipeline stage, found by its options. */
const stageSelect = () => Array.from(drawer().querySelectorAll('select'))
  .find((s) => Array.from(s.options).some((o) => o.value === 'Lost'));

const reasonBox = () => drawer().querySelector('textarea[name="lost_reason"]');

/** React does not observe a raw assignment; its own setter has to be called. */
const typeInto = async (el, value) => {
  const proto = el instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  const { set } = Object.getOwnPropertyDescriptor(proto, 'value');
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
};

const openEditor = async () => {
  const edit = byText('button', /^Edit deal$/);
  expect(edit, 'the deal record has no Edit control at all').toBeTruthy();
  await click(edit);
};

describe('Graha — why a deal was lost', () => {
  it('offers no reason box while the deal is still open', async () => {
    await mount();
    await openEditor();
    expect(stageSelect().value).toBe('Proposal');
    expect(
      reasonBox(),
      'the form asks why a deal was lost while it is still at Proposal',
    ).toBeNull();
  });

  it('offers the reason box the moment the stage becomes Lost', async () => {
    await mount();
    await openEditor();
    await typeInto(stageSelect(), 'Lost');
    expect(
      reasonBox(),
      'THE DEFECT: a person can move a deal to Lost and cannot say why',
    ).toBeTruthy();
  });

  it('sends what was typed, so the reason is actually written', async () => {
    await mount();
    await openEditor();
    await typeInto(stageSelect(), 'Lost');
    await typeInto(reasonBox(), 'Undercut by a competitor on fee');
    await click(byText('button', /^(Save|Saving)/));

    expect(api.patch).toHaveBeenCalledTimes(1);
    const [url, payload] = api.patch.mock.calls[0];
    expect(url).toBe(`/v1/graha/deals/${ID}`);
    expect(payload.stage).toBe('Lost');
    expect(
      payload.lost_reason,
      'the box renders and its value never reaches the request — the same '
      + 'fault as `_DEAL_COLS` dropping the column, one layer along',
    ).toBe('Undercut by a competitor on fee');
  });

  it('seeds the box from the row, so editing a lost deal does not erase it', async () => {
    DEAL = { ...BASE, stage: 'Lost', lost_reason: 'Client went in-house' };
    await mount();
    await openEditor();
    expect(reasonBox()).toBeTruthy();
    expect(
      reasonBox().value,
      'the editor opened empty over a recorded reason; saving now sends an '
      + 'empty string, and `_DEAL_COLS` keeps those — only None is dropped',
    ).toBe('Client went in-house');

    await click(byText('button', /^(Save|Saving)/));
    expect(api.patch.mock.calls[0][1].lost_reason).toBe('Client went in-house');
  });

  it('leaves the reason alone when a deal is moved back out of Lost', async () => {
    DEAL = { ...BASE, stage: 'Lost', lost_reason: 'Client went in-house' };
    await mount();
    await openEditor();
    await typeInto(stageSelect(), 'Negotiation');
    await click(byText('button', /^(Save|Saving)/));

    const payload = api.patch.mock.calls[0][1];
    expect(payload.stage).toBe('Negotiation');
    expect(
      Object.prototype.hasOwnProperty.call(payload, 'lost_reason'),
      'reopening a deal wipes the record of why it was lost — a stage '
      + 'corrected by hand is not a retraction of the answer',
    ).toBe(false);
  });

  it('shows the reason on the record, not only inside the editor', async () => {
    DEAL = { ...BASE, stage: 'Lost', lost_reason: 'Client went in-house' };
    await mount();
    expect(
      drawer().textContent,
      'the reason can be typed and never seen, which is not capture',
    ).toContain('Client went in-house');
  });
});
