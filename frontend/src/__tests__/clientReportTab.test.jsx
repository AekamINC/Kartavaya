/**
 * The blended client report (proposal 60, A5) — the tab's four contracts:
 *
 * · A failed picker fetch must NEVER render as "no clients" — collapsing a
 *   500 into an empty state is the exact defect dristi/_shared.jsx's header
 *   exists to name, and the empty copy here accuses either the CRM or the
 *   user's role, both falsely.
 * · The server's stated absences ("not connected") render verbatim, never a
 *   zero of our own invention.
 * · Re-picking the placeholder clears EVERY report state — no stale error or
 *   eternal shimmer under the "pick a client" hint.
 * · No client UUID ever reaches the DOM as text; the canned rows carry real
 *   ids precisely so this test would catch one leaking.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import ClientReportTab from '../pages/dristi/ClientReportTab';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CID = '33333333-3333-3333-3333-333333333333';

const CLIENTS = {
  data: [
    { id: CID, name: 'Khanna Electronics' },
    { id: '44444444-4444-4444-4444-444444444444', name: 'Mehta Trading Co' },
  ],
  total: 2, limit: 200, truncated: false,
};

const REPORT = {
  client: { name: 'Khanna Electronics', since: '2025-04-01' },
  window: { date_from: '2026-05-01', date_to: '2026-08-17' },
  sections: ['leads', 'deals', 'invoices', 'ads', 'sessions'],
  leads: { total: 12, by_source: [{ source: 'Referral', value: 8 }, { source: 'No source', value: 4 }] },
  deals: { won_count: 2, won_value: 500000, open_pipeline_value: 120000 },
  invoices: { invoiced: 478032, invoice_count: 4, collected: 478032, outstanding: 0 },
  ads: { absent: 'No Meta ads account is connected for this client yet — the column fills in the day one is.' },
  sessions: { total: 8214, source: 'ga4', account_name: 'khanna.in — GA4' },
  monthly: [
    { period: '2026-05', invoiced: 183912, collected: 183912 },
    { period: '2026-06' },
    { period: '2026-07', invoiced: 294120 },
  ],
};

function mount() {
  return render(
    <ToastProvider>
      <ClientReportTab />
    </ToastProvider>,
  );
}

const okClients = () => {
  api.get.mockImplementation((url) => {
    if (url.startsWith('/v1/graha/clients')) return Promise.resolve({ data: CLIENTS });
    if (url.startsWith('/v1/analytics/client-report')) return Promise.resolve({ data: REPORT });
    return Promise.reject(new Error(`unmocked ${url}`));
  });
};

beforeEach(() => vi.clearAllMocks());

describe('the picker states stay apart', () => {
  it('a failed client list is an error with a retry, never "no clients"', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    mount();
    await waitFor(() => expect(screen.getByText(/client list did not load/i)).toBeInTheDocument());
    expect(screen.queryByText(/No clients yet/i)).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('a 403 is the restricted note, not a warning', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });
    mount();
    await waitFor(() => expect(screen.getByText(/don’t have access to the CRM/i)).toBeInTheDocument());
    expect(screen.queryByText(/did not load/i)).toBeNull();
  });

  it('an empty CRM is the honest empty state', async () => {
    api.get.mockResolvedValue({ data: { data: [], total: 0, limit: 200, truncated: false } });
    mount();
    await waitFor(() => expect(screen.getByText(/No clients yet/i)).toBeInTheDocument());
  });

  it('the search box appears only when the list is truncated', async () => {
    okClients();
    const { unmount } = mount();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Khanna Electronics' }).selected).toBe(false));
    expect(screen.queryByLabelText(/search clients/i)).toBeNull();
    unmount();

    api.get.mockResolvedValue({ data: { ...CLIENTS, total: 480, truncated: true } });
    mount();
    await waitFor(() => expect(screen.getByLabelText(/search clients/i)).toBeInTheDocument());
  });
});

describe('the report', () => {
  it('renders the blend, states the absence verbatim, and leaks no uuid', async () => {
    okClients();
    const { container } = mount();
    // wait for the OPTIONS, not the select — changing the value before the
    // list arrives silently keeps the placeholder selected
    await waitFor(() => expect(screen.getByRole('option', { name: 'Khanna Electronics' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: CID } });

    await waitFor(() => expect(screen.getByText(/Client since/)).toBeInTheDocument());
    // the absence is the server's sentence, not a zero of ours
    expect(screen.getByText(/No Meta ads account is connected/)).toBeInTheDocument();
    // the connected column is a real figure with its account's name
    expect(screen.getByText('khanna.in — GA4')).toBeInTheDocument();
    // a quiet month appears as a row of dashes instead of vanishing
    expect(screen.getByText('Jun 2026')).toBeInTheDocument();
    // names, never ids
    expect(container.textContent).not.toMatch(UUID);
  });

  it('re-picking the placeholder clears every report state', async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/graha/clients')) return Promise.resolve({ data: CLIENTS });
      return Promise.reject({ response: { status: 500, data: { detail: 'boom' } } });
    });
    mount();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Khanna Electronics' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: CID } });
    await waitFor(() => expect(screen.getByText(/report did not load/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByText(/report did not load/i)).toBeNull());
    expect(screen.getByText(/Pick a client to see/i)).toBeInTheDocument();
  });
});
