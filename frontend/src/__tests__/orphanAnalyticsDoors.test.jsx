/**
 * Orphan-module analytics (owner decision, 2026-08-18): Sanvaad, Niyam and
 * Pay get NO analytics tab shell of their own. Instead —
 *
 * · each module's chrome carries an "Analytics ↗" door deep-linking to
 *   Dristi's analytics tab with its preset opened
 *   (/dristi?tab=analytics&preset=<communication|automation|payments>);
 * · AnalyticsTab honours that ?preset= param on first load — an explicit
 *   link is an explicit ask, so it outranks a saved personal/org default —
 *   but only when the entitlement cut actually offered the preset, and only
 *   ONCE, so a later views reload cannot yank a working surface back.
 *
 * The doors are LINKS (keyboard-reachable, real hrefs), never onClick divs.
 * They are one affordance in three places, so all three carry the same
 * bilingual run (Secondary "विश्लेषण") — absent under EN, aria-hidden
 * otherwise, so the aria-label stays the whole accessible name.
 *
 * And the link has to LAND: DristiPage reads ?tab= once at mount, so the
 * door's href actually opens the analytics tab with the preset applied —
 * the full journey is exercised at the bottom of this file.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

// The Sanvaad door lives in the page HEADER; the chat shell underneath is
// another team's layout and this test must not depend on its wiring.
vi.mock('../pages/sanvaad/MessagingTabs', () => ({
  default: () => <div data-testid="messaging-shell" />,
}));

// The journey tests mount the whole DristiPage; the deep link's target is the
// analytics tab, and Overview — the tab the page shows before the catalogue
// lands — is another team's surface whose fetches are not this file's
// business. A stub with a testid also lets the fall-through case assert
// WHERE an unknown ?tab= lands.
vi.mock('../pages/dristi/OverviewTab', () => ({
  default: () => <div data-testid="overview-stub" />,
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import NiyamPage from '../pages/NiyamPage';
import SanvaadPage from '../pages/SanvaadPage';
import CollectionsTab from '../pages/ganit/CollectionsTab';
import { AnalyticsTabEmbedded } from '../pages/dristi/AnalyticsTab';
import DristiPage from '../pages/DristiPage';
import { _resetTabPrefsCache } from '../components/module/useTabPrefs';

/** The bilingual run every door carries — Secondary, aria-hidden, in the
 *  link itself. One affordance, three places, one reading. */
const expectBilingual = (door) => {
  const hi = within(door).getByText('विश्लेषण');
  expect(hi).toHaveAttribute('aria-hidden', 'true');
};

const mount = (node) => render(
  <MemoryRouter>
    <ToastProvider>{node}</ToastProvider>
  </MemoryRouter>,
);

beforeEach(() => vi.clearAllMocks());

// ── the three doors ──────────────────────────────────────────────────────────

describe('the three orphan-module doors', () => {
  it('Niyam: an Analytics link beside the console strip, to the automation preset', async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/niyam/catalog')) return Promise.resolve({ data: { events: [], actions: [], flags: { engine_armed: true } } });
      if (url.startsWith('/v1/niyam/templates')) return Promise.resolve({ data: { templates: [] } });
      if (url.startsWith('/v1/niyam/rules')) return Promise.resolve({ data: { rules: [], flags: { engine_armed: true } } });
      return Promise.reject(new Error(`unmocked ${url}`));
    });
    mount(<NiyamPage />);
    const door = await screen.findByRole('link', { name: 'Automation analytics, in Dristi' });
    expect(door).toHaveAttribute('href', '/dristi?tab=analytics&preset=automation');
    expectBilingual(door);
    // The door renders even with ZERO rules — the preset answers regardless.
    expect(screen.queryByText('Runs, last 7 days')).toBeNull();
  });

  it('Sanvaad: an Analytics link in the page header, to the communication preset', () => {
    mount(<SanvaadPage />);
    const door = screen.getByRole('link', { name: 'Communication analytics, in Dristi' });
    expect(door).toHaveAttribute('href', '/dristi?tab=analytics&preset=communication');
    expectBilingual(door);
    // In the header, never inside the chat shell.
    expect(screen.getByTestId('messaging-shell')).not.toContainElement(door);
  });

  it('Collections (Pay): an Analytics link in the bar, to the payments preset', async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/ganit/collections')) return Promise.resolve({ data: { data: [] } });
      return Promise.reject(new Error(`unmocked ${url}`));
    });
    mount(<CollectionsTab />);
    const door = await screen.findByRole('link', { name: 'Payments analytics, in Dristi' });
    expect(door).toHaveAttribute('href', '/dristi?tab=analytics&preset=payments');
    expectBilingual(door);
  });
});

// ── the ?preset= deep link on the analytics surface ──────────────────────────

const CATALOGUE = {
  metrics: [
    // One ganit metric so the Dristi-embedded surface is "listed" at all.
    { key: 'ganit.dso', module: 'ganit', label: 'DSO', unit: 'days', grain: 'flow', dimensions: [] },
    { key: 'core.niyam_rules_fired', module: 'core', label: 'Rules fired', unit: 'count', grain: 'flow', dimensions: [] },
  ],
  buckets: ['month'], compare_modes: [], formats: ['json'], withheld_count: 0,
};

const AUTOMATION_PRESET = {
  key: 'automation',
  label: 'Automation',
  hi: 'स्वचालन',
  why: 'What the rules actually did.',
  layout: [{ metric: 'core.niyam_rules_fired', viz: 'trend', w: 2 }],
};

/** views payload carrying a PERSONAL DEFAULT the deep link must outrank. */
const VIEWS = {
  personal: [{ id: 'v1', scope: 'personal', name: 'My saved view', layout: [{ metric: 'ganit.dso', viz: 'kpi', w: 1 }], is_default: true, updated_at: null }],
  org: [],
  presets: [AUTOMATION_PRESET],
  resolved: { source: 'personal', id: 'v1', name: 'My saved view', layout: [{ metric: 'ganit.dso', viz: 'kpi', w: 1 }] },
};

function mockAnalyticsApi() {
  api.get.mockImplementation((url) => {
    if (url.startsWith('/v1/analytics/catalogue')) return Promise.resolve({ data: CATALOGUE });
    if (url.startsWith('/v1/analytics/views')) return Promise.resolve({ data: VIEWS });
    if (url.startsWith('/v1/analytics/alerts')) return Promise.resolve({ data: { alerts: [] } });
    if (url.startsWith('/v1/analytics/run')) {
      const metric = new URL(`x:${url}`).searchParams.get('metric');
      return Promise.resolve({
        data: { metric, unit: 'count', grain: 'flow', data: [{ period: '2026-07', value: 3 }, { period: '2026-08', value: 8 }] },
      });
    }
    // The two extra calls a whole-DristiPage mount makes (the journey tests
    // below): the KPI strip's summary and the tab-prefs row. Empty answers —
    // neither is what those tests are about.
    if (url.startsWith('/v1/dristi/overview')) {
      return Promise.resolve({ data: { withheld: [], deals: {}, revenue: {}, orders: {}, tasks: {} } });
    }
    if (url.startsWith('/v1/me/tab-prefs')) return Promise.resolve({ data: { modules: {} } });
    return Promise.reject(new Error(`unmocked ${url}`));
  });
}

describe('the ?preset= deep link', () => {
  afterEach(() => window.history.pushState({}, '', '/'));

  it('activates the named preset over a saved personal default', async () => {
    window.history.pushState({}, '', '/dristi?tab=analytics&preset=automation');
    mockAnalyticsApi();
    mount(<AnalyticsTabEmbedded />);
    // The preset chip is the ACTIVE one, not the personal default's chip.
    const chip = await screen.findByRole('button', { name: 'Automation · preset' });
    await waitFor(() => expect(chip.className).toContain('vb__chip--on'));
    expect(screen.getByRole('button', { name: 'My saved view' }).className)
      .not.toContain('vb__chip--on');
    // And the preset's own widget is what the grid draws.
    await waitFor(() => expect(screen.getByText('Rules fired')).toBeInTheDocument());
  });

  it('a preset the entitlement cut did not offer degrades to the saved default', async () => {
    window.history.pushState({}, '', '/dristi?tab=analytics&preset=payments');
    mockAnalyticsApi();   // presets offered: automation only
    mount(<AnalyticsTabEmbedded />);
    const mine = await screen.findByRole('button', { name: 'My saved view' });
    await waitFor(() => expect(mine.className).toContain('vb__chip--on'));
    expect(screen.getByRole('button', { name: 'Automation · preset' }).className)
      .not.toContain('vb__chip--on');
  });

  it('no param: the saved default resolves exactly as before', async () => {
    mockAnalyticsApi();
    mount(<AnalyticsTabEmbedded />);
    const mine = await screen.findByRole('button', { name: 'My saved view' });
    await waitFor(() => expect(mine.className).toContain('vb__chip--on'));
  });
});

// ── the full journey: the door's href, landed on DristiPage ──────────────────
//
// The three doors promise /dristi?tab=analytics&preset=<key>, and for a while
// only the second half was honoured: DristiPage never read ?tab=, so every
// door landed on Overview and the preset never applied. The page now reads
// ?tab= ONCE at mount — an explicit deep link outranks the starred default,
// the same rule the surface applies to ?preset= — and this describe mounts
// the WHOLE page to prove the two halves meet.

describe('the ?tab= deep link on DristiPage', () => {
  beforeEach(() => {
    // useTabPrefs shares one module-level cache and a warm localStorage copy
    // across the whole app life; a journey test must start from neither.
    _resetTabPrefsCache();
    localStorage.clear();
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('?tab=analytics&preset=automation opens the analytics tab AND activates the preset', async () => {
    window.history.pushState({}, '', '/dristi?tab=analytics&preset=automation');
    mockAnalyticsApi();
    const { container } = mount(<DristiPage />);

    // The page leaves Overview the moment the catalogue lists the analytics
    // tab — the door did not land on the default.
    await waitFor(() => expect(screen.queryByTestId('overview-stub')).toBeNull());
    expect(container.querySelector('#mt-panel-analytics')).not.toBeNull();

    // And the preset the door named is ACTIVE over the saved personal
    // default — the surface's half of the contract, through the page.
    const chip = await screen.findByRole('button', { name: 'Automation · preset' });
    await waitFor(() => expect(chip.className).toContain('vb__chip--on'));
    expect(screen.getByRole('button', { name: 'My saved view' }).className)
      .not.toContain('vb__chip--on');
    // The preset's own widget is what the grid draws.
    await waitFor(() => expect(screen.getByText('Rules fired')).toBeInTheDocument());
  });

  it('an unknown ?tab= falls through silently to the normal resolution', async () => {
    window.history.pushState({}, '', '/dristi?tab=no-such-tab');
    mockAnalyticsApi();
    mount(<DristiPage />);
    // Overview — the page's own opening tab — mounts as if no param existed.
    await screen.findByTestId('overview-stub');
  });
});
