/**
 * Metric alerts (S3 / proposal 62 D7) — the bell on a KPI widget and the
 * per-module alerts panel.
 *
 * The contracts under test, each read off routers/analytics.py rather than
 * guessed:
 *
 * · POST /v1/analytics/alerts takes EXACTLY AlertCreate's shape —
 *   {metric, operator, threshold, window_days} with operator gt|lt.
 * · A 403 on create is an ordinary answer (alerts are org administration);
 *   the server's detail becomes a toast and nothing crashes.
 * · The panel renders metric LABELS — never the key, never any uuid. Alert
 *   ids exist only in React keys and the DELETE url, which is the third
 *   contract: DELETE /v1/analytics/alerts/{id}.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import AlertsPanel from '../pages/dristi/AlertsPanel';
import ViewGrid from '../pages/dristi/ViewGrid';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const BYKEY = {
  'graha.pipeline_value': {
    key: 'graha.pipeline_value', module: 'graha', label: 'Open pipeline',
    unit: 'inr', grain: 'stock', dimensions: [],
  },
};

// Ids are uuids ON PURPOSE: the DOM scan below is what keeps them out of it.
const ALERTS = {
  alerts: [
    {
      id: '3f9a1c2e-8b4d-4e6f-9a10-77c2d5b81f04',
      metric: 'graha.pipeline_value', label: 'Open pipeline', unit: 'inr',
      operator: 'gt', threshold: 5000000, window_days: 30,
    },
    // Another module's alert — the panel must cut it, not render it.
    {
      id: '9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e',
      metric: 'ganit.dso', label: 'DSO', unit: 'days',
      operator: 'gt', threshold: 45, window_days: 60,
    },
  ],
};

const RANGE = { from: '2026-07-19', to: '2026-08-17' };
const KPI_WIDGET = { metric: 'graha.pipeline_value', viz: 'kpi', w: 1 };

const mountPanel = () => render(
  <ToastProvider>
    <AlertsPanel module="graha" byKey={BYKEY} />
  </ToastProvider>,
);

const mountGrid = () => render(
  <ToastProvider>
    <ViewGrid layout={[KPI_WIDGET]} byKey={BYKEY} range={RANGE} editable={false} onLayoutChange={() => {}} />
  </ToastProvider>,
);

/** Open the bell's mini-form and fill it: falls below 2500000 over 14 days. */
async function fillAlertForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Alert when Open pipeline crosses a line' }));
  fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'lt' } });
  fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '2500000' } });
  fireEvent.change(screen.getByLabelText('Window in days'), { target: { value: '14' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set alert' }));
}

beforeEach(() => vi.clearAllMocks());

describe('AlertsPanel · this module\'s alerts, by label', () => {
  it('renders metric LABELS, filters to the module, and leaks no key or uuid', async () => {
    api.get.mockResolvedValue({ data: ALERTS });
    mountPanel();

    expect(await screen.findByText('Open pipeline')).toBeInTheDocument();
    // The condition line prints in the metric's unit.
    expect(screen.getByText(/goes above/)).toBeInTheDocument();

    // ganit's alert never reaches graha's panel.
    expect(screen.queryByText('DSO')).toBeNull();

    // Labels, not keys; and the uuid ids exist only in keys and DELETE urls.
    expect(document.body.innerHTML).not.toContain('graha.pipeline_value');
    expect(document.body.innerHTML).not.toMatch(UUID);
  });

  it('deletes through the alert\'s own URL and drops the row', async () => {
    api.get.mockResolvedValue({ data: ALERTS });
    api.delete.mockResolvedValue({ data: { ok: true } });
    mountPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete the alert on Open pipeline' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
      '/v1/analytics/alerts/3f9a1c2e-8b4d-4e6f-9a10-77c2d5b81f04',
    ));
    // The row leaves; the quiet empty line takes its place.
    await waitFor(() => expect(screen.queryByText('Open pipeline')).toBeNull());
    expect(screen.getByText(/No alerts here yet/)).toBeInTheDocument();
  });
});

describe('the bell on a KPI widget', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({
      data: { metric: 'graha.pipeline_value', unit: 'inr', grain: 'stock', data: [{ value: 2640000 }] },
    });
  });

  it('POSTs the exact shape AlertCreate declares', async () => {
    api.post.mockResolvedValue({
      data: { id: 'x', metric: 'graha.pipeline_value', operator: 'lt', threshold: 2500000, window_days: 14 },
    });
    mountGrid();
    await fillAlertForm();

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/analytics/alerts', {
      metric: 'graha.pipeline_value',
      operator: 'lt',
      threshold: 2500000,
      window_days: 14,
    }));
    // Success closes the form.
    await waitFor(() => expect(screen.queryByLabelText('Threshold')).toBeNull());
  });

  it('a 403 surfaces the server\'s org-admin detail as a toast and nothing crashes', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('403'), {
      response: { status: 403, data: { detail: 'Alerts are managed by an org admin' } },
    }));
    mountGrid();
    await fillAlertForm();

    // findAll: the toast card and its aria-live announcement both carry it.
    const toasts = await screen.findAllByText('Alerts are managed by an org admin');
    expect(toasts.length).toBeGreaterThan(0);
    // The widget is still standing, form and all — a refusal is not a crash.
    expect(screen.getByText('Open pipeline')).toBeInTheDocument();
    expect(screen.getByLabelText('Threshold')).toBeInTheDocument();
  });
});
