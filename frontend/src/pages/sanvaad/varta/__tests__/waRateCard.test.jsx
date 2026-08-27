/**
 * Varta → Pricing: the estimate has to be VISIBLE, not just true.
 *
 * Phase 0.27 seeds `staging.varta_rate_card` with figures read off public
 * sources, because Meta's own INR card is behind a Business Manager login. The
 * owner's decision attaches one condition to that seed and this file is the
 * ratchet on it: **an unmarked guess about what a customer will be charged is
 * worse than no number.**
 *
 * So these assertions are about what a reader SEES, not about markup. A
 * `rate_basis` column that says 'estimate' while the screen renders a bare
 * ₹0.8631 satisfies the schema and fails the decision.
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
import WARateCard from '../WARateCard';
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

/** The envelope `GET /v1/whatsapp/rate-card` really returns, shape for shape. */
const CARD = {
  country_code: 'IN',
  currency: 'INR',
  as_at: null,
  estimate_count: 2,
  all_estimates: true,
  any_estimates: true,
  source_read_on: '2026-08-27',
  billed_by: 'meta',
  billed_to: 'organisation',
  billing_note:
    'Meta bills your own WhatsApp Business Account directly for these messages. '
    + 'Kartavaya does not resell WhatsApp messages and adds no margin to them '
    + '— these are your costs with Meta, not a Kartavaya charge. GST is not included.',
  estimate_note:
    "These figures are ESTIMATES read from public sources, not from Meta's own "
    + 'rate card.',
  rates: [
    {
      category: 'marketing', label: 'Marketing',
      rate_per_message: 0.8631, rate_display: '₹0.8631 (estimate)',
      currency: 'INR', country_code: 'IN', pricing_model: 'per_message',
      free_in_service_window: false, free_in_entry_point_window: true,
      is_estimate: true, rate_basis: 'estimate',
      estimate_note: "ESTIMATE — not Meta's own rate card.",
      source_url: 'https://whautomate.com/whatsapp-business-api-pricing-india',
      source_read_on: '2026-08-27', withheld_reason: null,
      billed_by: 'meta', billed_to: 'organisation',
      effective_from: '2026-01-01', effective_to: null, notes: '',
      org_specific: false,
    },
    {
      category: 'service', label: 'Service',
      rate_per_message: 0, rate_display: 'Free (estimate)',
      currency: 'INR', country_code: 'IN', pricing_model: 'per_message',
      free_in_service_window: true, free_in_entry_point_window: true,
      is_estimate: true, rate_basis: 'estimate',
      estimate_note: 'ESTIMATE — seeded alongside four guessed rows.',
      source_url:
        'https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing',
      source_read_on: '2026-08-27', withheld_reason: null,
      billed_by: 'meta', billed_to: 'organisation',
      effective_from: '2026-01-01', effective_to: null, notes: '',
      org_specific: false,
    },
  ],
};

const withCard = (over = {}) => ({ ...CARD, ...over });

async function open(card = CARD) {
  api.get.mockResolvedValue({ data: card });
  mount(<WARateCard />);
  await settle();
}

describe('Varta · Pricing — the caveat reaches the eye', () => {
  it('says every price is an estimate, above the prices', async () => {
    await open();
    const banner = container.querySelector('.wa__estbar');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Every price below is an estimate');
    // The stamp is a WORD, not a colour. 26 §8.
    expect(container.querySelector('.wa__estbar-tag').textContent.trim())
      .toBe('Estimate');
  });

  it('puts an Estimate chip on every priced tile', async () => {
    await open();
    const tiles = [...container.querySelectorAll('.k-card')];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.textContent).toContain('Estimate');
    }
  });

  it('renders the caveat INSIDE the figure, never a bare number', async () => {
    // The regression this guards: a future edit renders `rate_per_message`
    // instead of `rate_display` and the caveat silently leaves the screen.
    await open();
    const figures = [...container.querySelectorAll('.wa__estrate')]
      .map(el => el.textContent.trim());
    expect(figures).toEqual(['₹0.8631 (estimate)', 'Free (estimate)']);
    for (const f of figures) expect(f.toLowerCase()).toContain('estimate');
  });

  it('marks a FREE price as an estimate too', async () => {
    // "Free" reads like a fact rather than a figure, which is exactly why it
    // is the easiest one to render without its caveat.
    await open();
    expect(text()).toContain('Free (estimate)');
  });

  it('shows the source and the date it was read, per rate', async () => {
    await open();
    const srcs = [...container.querySelectorAll('.wa__estsrc')]
      .map(el => el.textContent);
    expect(srcs.some(s => s.includes('whautomate.com'))).toBe(true);
    expect(srcs.some(s => s.includes('developers.facebook.com'))).toBe(true);
    // A figure with no read-date is a number nobody can check.
    expect(text()).toContain('27 Aug 2026');
  });

  it('says whose bill this is', async () => {
    await open();
    const note = container.querySelector('.wa__estbill').textContent;
    expect(note).toContain('Meta bills your own WhatsApp Business Account');
    expect(note).toContain('does not resell');
  });

  it('counts the estimates when only some rows are guesses', async () => {
    await open(withCard({
      all_estimates: false, estimate_count: 1,
      rates: [CARD.rates[0], { ...CARD.rates[1], is_estimate: false,
        rate_basis: 'meta_rate_card', rate_display: 'Free' }],
    }));
    expect(container.querySelector('.wa__estbar').textContent)
      .toContain('1 of these prices are estimates');
    // And the verified row must NOT be labelled a guess — the stamp has to be
    // able to come off, or it means nothing.
    const tiles = [...container.querySelectorAll('.k-card')];
    expect(tiles[1].textContent).toContain('Meta rate card');
    expect(tiles[1].querySelector('.wa__estrate').textContent.trim()).toBe('Free');
  });

  it('drops the banner entirely once nothing is a guess', async () => {
    await open(withCard({
      all_estimates: false, any_estimates: false, estimate_count: 0,
      estimate_note: null,
      rates: CARD.rates.map(r => ({
        ...r, is_estimate: false, rate_basis: 'meta_rate_card',
        rate_display: r.rate_per_message === 0 ? 'Free' : '₹0.8631',
      })),
    }));
    expect(container.querySelector('.wa__estbar')).toBeNull();
    expect(text()).not.toContain('estimate');
  });

  it('renders the refusal instead of a number it could not stamp', async () => {
    await open(withCard({
      rates: [{
        ...CARD.rates[0], rate_per_message: null, rate_display: 'Withheld',
        estimate_note: '',
        withheld_reason:
          'This row is marked an estimate but carries no explanation, so the '
          + 'figure is not shown.',
      }],
    }));
    expect(text()).toContain('Withheld');
    expect(text()).toContain('the figure is not shown');
    expect(text()).not.toContain('0.8631');
    expect(container.querySelector('.wa__estnote--stop')).toBeTruthy();
  });
});

describe('Varta · Pricing — the surface is reachable and does not lie', () => {
  it('is a sub-tab of WhatsApp and loads the rate card when opened', async () => {
    // Conversations load first (a bare array), then the Pricing tab fetches
    // its own envelope.
    api.get.mockImplementation((url) => Promise.resolve(
      url === '/v1/whatsapp/rate-card' ? { data: CARD } : { data: [] }));
    mount(<WhatsAppTab />);
    await settle();

    const tab = [...container.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Pricing');
    expect(tab).toBeTruthy();

    await click(tab);
    expect(api.get).toHaveBeenCalledWith('/v1/whatsapp/rate-card');
    expect(text()).toContain('₹0.8631 (estimate)');
  });

  it('never calls the shared list endpoint with an undefined url', async () => {
    // The shared `useEffect` drives four sub-tabs off one ENDPOINT map that has
    // no `pricing` key. Unguarded, `api.get(undefined)` is a request to the
    // app's own origin that RESOLVES — so the bug would be silent.
    api.get.mockImplementation((url) => Promise.resolve(
      url === '/v1/whatsapp/rate-card' ? { data: CARD } : { data: [] }));
    mount(<WhatsAppTab />);
    await settle();
    await click([...container.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Pricing'));
    for (const call of api.get.mock.calls) {
      expect(call[0]).toBeTruthy();
    }
  });

  it('shows nothing rather than a stale price when the fetch fails', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount(<WARateCard />);
    await settle();
    expect(text()).not.toContain('₹');
    expect(text()).toContain('No pricing is shown rather than a stale one');
  });

  it('renders no organisation identifier', async () => {
    // Names, not IDs. The API sends `org_specific`, never `org_id`.
    await open();
    expect(text()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });
});
