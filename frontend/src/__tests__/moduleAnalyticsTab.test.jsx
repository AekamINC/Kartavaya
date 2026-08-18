/**
 * ModuleAnalyticsTab — the owner's rule made checkable: every module page
 * mounts the universal surface pointed at its own slice of the catalogue.
 *
 * · The default arrangement is DERIVED from the catalogue (flow → trend,
 *   stock → kpi) — a metric added to the registry appears on its module's
 *   page with no frontend change.
 * · A module the catalogue withholds renders the quiet not-available line,
 *   never an error and never the ganit cards.
 * · Declared-absent metrics of the module are listed with their reason —
 *   the stated-absence rule, kept on every module's own page.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import { ModuleAnalyticsTab } from '../pages/dristi/AnalyticsTab';

const CATALOGUE = {
  metrics: [
    { key: 'graha.pipeline_value', module: 'graha', label: 'Open pipeline', unit: 'inr', grain: 'stock', dimensions: [] },
    { key: 'graha.contacts_added', module: 'graha', label: 'Contacts added', unit: 'count', grain: 'flow', dimensions: [] },
    { key: 'graha.stage_conversion', module: 'graha', label: 'Stage-to-stage conversion', unit: 'pct', grain: 'flow', absent: 'No stage-transition history exists.' },
    { key: 'ganit.outstanding', module: 'ganit', label: 'Outstanding', unit: 'inr', grain: 'stock', dimensions: [] },
  ],
  buckets: ['month'], compare_modes: [], formats: ['json'], withheld_count: 0,
};

function mockApi(catalogue) {
  api.get.mockImplementation((url) => {
    if (url.startsWith('/v1/analytics/catalogue')) return Promise.resolve({ data: catalogue });
    if (url.startsWith('/v1/analytics/views')) return Promise.resolve({ data: { personal: [], org: [], presets: [], resolved: null } });
    if (url.startsWith('/v1/analytics/run')) {
      const metric = new URL(`x:${url}`).searchParams.get('metric');
      return Promise.resolve({
        data: metric === 'graha.pipeline_value'
          ? { metric, unit: 'inr', grain: 'stock', data: [{ value: 2640000 }] }
          : { metric, unit: 'count', grain: 'flow', data: [{ period: '2026-07', value: 4 }, { period: '2026-08', value: 9 }] },
      });
    }
    return Promise.reject(new Error(`unmocked ${url}`));
  });
}

const mount = (module) => render(
  <ToastProvider>
    <ModuleAnalyticsTab module={module} />
  </ToastProvider>,
);

beforeEach(() => vi.clearAllMocks());

describe('the per-module analytics surface', () => {
  it('derives the module arrangement from its own catalogue slice', async () => {
    mockApi(CATALOGUE);
    mount('graha');
    // stock → a kpi figure in lakh; flow → a trend card by its label
    await waitFor(() => expect(screen.getByText('Open pipeline')).toBeInTheDocument());
    expect(screen.getByText('Contacts added')).toBeInTheDocument();
    // the widget fetches its own run — wait for the figure, not just the card
    await waitFor(() => expect(screen.getByText('₹26.4L')).toBeInTheDocument());
    // another module's metric never leaks onto this page
    expect(screen.queryByText('Outstanding')).toBeNull();
    // only graha runs were asked for
    const runCalls = api.get.mock.calls.map(([u]) => u).filter((u) => u.includes('/run'));
    expect(runCalls.every((u) => u.includes('metric=graha.'))).toBe(true);
  });

  it('lists the module\'s declared absences with their reason', async () => {
    mockApi(CATALOGUE);
    mount('graha');
    await waitFor(() => expect(screen.getByText('Stage-to-stage conversion')).toBeInTheDocument());
    expect(screen.getByText('Stage-to-stage conversion').closest('li'))
      .toHaveAttribute('title', 'No stage-transition history exists.');
  });

  it('a withheld module is quietly not available, never the ganit cards', async () => {
    mockApi(CATALOGUE);   // catalogue lists graha+ganit, NOT vikray
    mount('vikray');
    await waitFor(() => expect(screen.getByText(/Analytics is not available/)).toBeInTheDocument());
    expect(screen.queryByText('DSO')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
