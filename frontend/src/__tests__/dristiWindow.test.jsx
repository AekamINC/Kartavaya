/**
 * Dristi · the reporting period reaches the wire (proposal 62, phase D1).
 *
 * The assertions are on the REQUEST URLs, because that is where the defect
 * lived: the endpoints accepted no range and the page sent none, so "last
 * quarter" was unanswerable. A screenshot of a date picker proves nothing about
 * what was fetched.
 *
 * The first test is the one that protects existing clients: on load, with the
 * default period, the requests must carry no date parameters at all.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { resolvePreset, windowQuery } from '../pages/dristi/_shared';
import DristiPage from '../pages/DristiPage';

/**
 * `DristiPage` reads `useSearchParams` — it puts its open tab in the URL so a
 * second browser tab lands where the reader was — and that hook needs a Router
 * above it. These tests rendered the page bare, which was fine while the page
 * read `window.location` directly and throws now.
 */
const render = (node) => rtlRender(<MemoryRouter>{node}</MemoryRouter>);

const OVERVIEW = {
  tasks: { total_tasks: 12, overdue_tasks: 2 },
  crm: { total_contacts: 5 },
  deals: { total_deals: 3, pipeline_value: 90000 },
  revenue: { total_invoiced: 100, total_collected: 80, outstanding: 20 },
  hr: {}, orders: { total_orders: 2, order_value: 400 }, payroll: {},
  withheld: [], window: null,
};

const urls = () => api.get.mock.calls.map(c => c[0]);
const overviewUrls = () => urls().filter(u => u.includes('/dristi/overview'));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: OVERVIEW });
});


// ── the resolver ──────────────────────────────────────────────────────────────

describe('the presets resolve to real dates', () => {
  it('All time is empty, and therefore sends nothing', () => {
    const w = resolvePreset('all');
    expect(w).toEqual({ from: '', to: '', preset: 'all' });
    expect(windowQuery(w)).toBe('');
  });

  it('the financial year starts on 1 April, not 1 January', () => {
    // India's FY. A January date belongs to the FY that opened the previous April.
    expect(resolvePreset('fytd', new Date(2026, 7, 17)).from).toBe('2026-04-01');
    expect(resolvePreset('fytd', new Date(2026, 0, 9)).from).toBe('2025-04-01');
  });

  it('last month is the whole of it, not thirty days back', () => {
    const w = resolvePreset('lastmonth', new Date(2026, 7, 17));
    expect([w.from, w.to]).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('this quarter starts at the quarter boundary', () => {
    expect(resolvePreset('quarter', new Date(2026, 7, 17)).from).toBe('2026-07-01');
    expect(resolvePreset('quarter', new Date(2026, 4, 2)).from).toBe('2026-04-01');
  });

  it('30 days is inclusive of today, so it spans 29 days back', () => {
    const w = resolvePreset('30d', new Date(2026, 7, 17));
    expect([w.from, w.to]).toEqual(['2026-07-19', '2026-08-17']);
  });

  it('a date near midnight IST is not pushed back a day', () => {
    // toISOString() is UTC and would return the 16th for this instant.
    const w = resolvePreset('mtd', new Date(2026, 7, 17, 2, 30));
    expect(w.to).toBe('2026-08-17');
  });

  it('builds date_from and date_to, and honours a custom separator', () => {
    const w = { from: '2026-04-01', to: '2026-06-30' };
    expect(windowQuery(w)).toBe('?date_from=2026-04-01&date_to=2026-06-30');
    expect(windowQuery(w, '&')).toBe('&date_from=2026-04-01&date_to=2026-06-30');
  });
});


// ── the page ──────────────────────────────────────────────────────────────────

describe('DristiPage · the window on the wire', () => {
  it('sends no date parameters until a period is chosen', async () => {
    render(<DristiPage />);
    await waitFor(() => expect(overviewUrls().length).toBeGreaterThan(0));
    // The retrofit must not change what an existing client receives.
    for (const u of urls()) expect(u).not.toContain('date_from');
  });

  it('refetches with the range when a preset is picked', async () => {
    render(<DristiPage />);
    await waitFor(() => expect(overviewUrls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'This quarter' }));

    await waitFor(() => {
      const last = overviewUrls().at(-1);
      expect(last).toContain('date_from=');
      expect(last).toContain('date_to=');
    });
  });

  it('marks the chosen preset pressed, and only that one', async () => {
    render(<DristiPage />);
    await waitFor(() => expect(overviewUrls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Last 30 days' }))
        .toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'All time' }))
        .toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('says which figures ignore the period, so a headcount is not misread', async () => {
    render(<DristiPage />);
    await waitFor(() => expect(overviewUrls().length).toBeGreaterThan(0));
    expect(screen.getByText(/Showing everything on record/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() =>
      expect(screen.getByText(/are as at today/i)).toBeInTheDocument());
  });

  it('going back to All time drops the parameters again', async () => {
    render(<DristiPage />);
    await waitFor(() => expect(overviewUrls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'This quarter' }));
    await waitFor(() => expect(overviewUrls().at(-1)).toContain('date_from='));

    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(overviewUrls().at(-1)).not.toContain('date_from='));
  });

  it('reveals two date fields for a custom range', async () => {
    render(<DristiPage />);
    await waitFor(() => expect(overviewUrls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }));
    await waitFor(() => {
      expect(screen.getByLabelText('From date')).toBeInTheDocument();
      expect(screen.getByLabelText('To date')).toBeInTheDocument();
    });
    // and it seeds them rather than opening on two empty boxes. DateInput puts
    // the aria-label on its TRIGGER, not on the hidden native input, so the
    // seeded value is read off the button's rendered label.
    expect(screen.getByLabelText('From date')).not.toHaveTextContent(/No date/);
    expect(screen.getByLabelText('From date').textContent)
      .toMatch(/\d{1,2} \w{3} \d{4}/);
  });
});
