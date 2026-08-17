/**
 * Analytics · the universal metric surface (proposal 62, phase D4).
 *
 * Three contracts, each of which has been broken elsewhere in this product:
 *
 * · A KPI is the SERVER's number formatted by its unit — days as days, a rate
 *   as a percentage, money in lakh/crore — never a raw float.
 * · A declared-absent metric renders as a stated absence with its reason in
 *   the tooltip, NEVER as a zero. A withheld figure drawn as ₹0 is
 *   indistinguishable from a company nobody owes (proposal 62 §10).
 * · No user/member/org/client UUID ever reaches the DOM. The canned
 *   top-debtors payload carries client_id precisely so this test would catch
 *   the component rendering it.
 *
 * The URL assertions matter as much as the render ones: a flow metric must
 * carry the window (the endpoint 400s without one) and a stock metric must
 * not — a date range above an as-at figure implies an authority it lacks.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import AnalyticsTab from '../pages/dristi/AnalyticsTab';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const cat = (key, unit, grain, extra = {}) => ({
  key, module: 'ganit', label: key, unit, grain,
  dimensions: [], sensitivity: 'financial', drill: null, description: '',
  ...extra,
});

const TDS_REASON =
  'staging.ganit_tds_challans holds 0 rows and has no section column; '
  + 'sections would sit in its deductions jsonb.';

const CATALOGUE = {
  metrics: [
    cat('ganit.dso', 'days', 'flow', { label: 'DSO' }),
    cat('ganit.collection_rate', 'pct', 'flow', { label: 'Collection rate' }),
    cat('ganit.outstanding', 'inr', 'stock', { label: 'Outstanding' }),
    cat('ganit.invoiced', 'inr', 'flow', { label: 'Invoiced' }),
    cat('ganit.collected', 'inr', 'flow', { label: 'Collected' }),
    cat('ganit.receivables_ageing', 'inr', 'stock', { label: 'Receivables ageing' }),
    cat('ganit.top_debtors', 'inr', 'stock', { label: 'Top debtors' }),
    cat('ganit.tds_by_section', 'inr', 'flow', {
      label: 'TDS deducted by section', absent: TDS_REASON,
    }),
  ],
  buckets: ['day', 'month'], compare_modes: [], formats: ['json', 'csv', 'xlsx', 'pdf'],
  withheld_count: 0,
};

const run = (metric, unit, grain, data) => ({
  metric, label: metric, unit, grain, group_by: null,
  bucket: grain === 'flow' ? 'month' : null,
  window: grain === 'flow'
    ? { date_from: '2026-07-19', date_to: '2026-08-17', windowed: [metric], as_at: [] }
    : { as_at: '2026-08-17', windowed: [] },
  as_of: '2026-08-17T10:00:00+00:00',
  data, compare: null,
});

const RUNS = {
  'ganit.dso': run('ganit.dso', 'days', 'flow', [{ value: 42 }]),
  'ganit.collection_rate': run('ganit.collection_rate', 'pct', 'flow', [{ value: 87.4 }]),
  'ganit.outstanding': run('ganit.outstanding', 'inr', 'stock', [{ value: 2640000 }]),
  'ganit.invoiced': run('ganit.invoiced', 'inr', 'flow', [
    { period: '2026-07-01', value: 500000 },
    { period: '2026-08-01', value: 300000 },
  ]),
  'ganit.collected': run('ganit.collected', 'inr', 'flow', [
    { period: '2026-07-01', value: 400000 },
    { period: '2026-08-01', value: 250000 },
  ]),
  'ganit.receivables_ageing': run('ganit.receivables_ageing', 'inr', 'stock', [
    { bucket: '0-30', value: 120000, invoices: 4 },
    { bucket: '31-60', value: 60000, invoices: 2 },
    { bucket: '61-90', value: 30000, invoices: 1 },
    { bucket: '90+', value: 15000, invoices: 1 },
  ]),
  // client_id is IN the payload on purpose: the component must render the
  // name and only the name, and 'Unlinked client' must render as itself.
  'ganit.top_debtors': run('ganit.top_debtors', 'inr', 'stock', [
    {
      label: 'Mehta & Sons Pvt Ltd',
      client_id: '3f9a1c2e-8b4d-4e6f-9a10-77c2d5b81f04',
      value: 90000, invoices: 3,
    },
    { label: 'Unlinked client', client_id: null, value: 12000, invoices: 1 },
  ]),
};

const urls = () => api.get.mock.calls.map((c) => c[0]);
const runUrlOf = (metric) =>
  urls().find((u) => u.includes('/v1/analytics/run') && u.includes(`metric=${encodeURIComponent(metric)}`));

const mount = () => render(<ToastProvider><AnalyticsTab /></ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url.includes('/v1/analytics/catalogue')) {
      return Promise.resolve({ data: CATALOGUE });
    }
    const m = /[?&]metric=([^&]+)/.exec(url);
    const key = decodeURIComponent(m?.[1] || '');
    const payload = RUNS[key];
    if (!payload) {
      return Promise.reject(Object.assign(new Error('404'), {
        response: { status: 404, data: { detail: `unknown metric: ${key}` } },
      }));
    }
    return Promise.resolve({ data: payload });
  });
});

describe('AnalyticsTab · the KPI strip', () => {
  it('renders each figure formatted by its unit', async () => {
    mount();
    // days as days, a rate as a percentage, money in lakh — never raw floats.
    expect(await screen.findByText('42 days')).toBeInTheDocument();
    expect(await screen.findByText('87.4%')).toBeInTheDocument();
    expect(await screen.findByText('₹26.4L')).toBeInTheDocument();
  });

  it('sends the window on flows and never on stocks', async () => {
    mount();
    await screen.findByText('42 days');

    const dso = runUrlOf('ganit.dso');
    expect(dso).toContain('date_from=');
    expect(dso).toContain('date_to=');

    // The chart series ask for month buckets over the same window.
    expect(runUrlOf('ganit.invoiced')).toContain('bucket=month');

    // A stock is as-at-today; the request must not pretend otherwise.
    expect(runUrlOf('ganit.receivables_ageing')).not.toContain('date_from');
    expect(runUrlOf('ganit.top_debtors')).not.toContain('date_from');
  });
});

describe('AnalyticsTab · stated absence', () => {
  it('renders the declared-absent metric as a reason, never a zero', async () => {
    mount();
    const row = (await screen.findByText('TDS deducted by section')).closest('li');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Not yet measurable');
    // The reason travels in the tooltip.
    expect(row).toHaveAttribute('title', TDS_REASON);
    // And no figure is invented for it — a zero here would be a false statement.
    expect(row.textContent).not.toContain('₹');
    expect(row.textContent).not.toMatch(/\b0\b/);
  });
});

describe('AnalyticsTab · names, not ids', () => {
  it('renders client names, keeps Unlinked client as itself, and leaks no uuid', async () => {
    mount();
    expect(await screen.findByText('Mehta & Sons Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('Unlinked client')).toBeInTheDocument();

    // The ageing meters and the debtors table both landed by now.
    await waitFor(() => expect(screen.getByText('Over 90 days')).toBeInTheDocument());

    // The payload carried client_id; the DOM must not.
    expect(document.body.innerHTML).not.toMatch(UUID);
  });
});
