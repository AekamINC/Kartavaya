/**
 * AdminPulsePage — the Aekam Pulse console (proposal 68), pinned.
 *
 * What matters here:
 *  · The board renders the PULSE catalog through the same ViewGrid the tenant
 *    surface uses, with every widget run going through /v1/pulse/run — never
 *    /v1/analytics/run. The seam is one prop; these specs are what keep it
 *    honest.
 *  · Save PUTs the drafted layout to /v1/pulse/view with full board geometry,
 *    and the code default's w:3 KPI stays a quarter-width KPI — the engine's
 *    legacy ×4 upgrade must never touch a Pulse default (hydratePulseLayout).
 *  · The download chips build the widget's own /v1/pulse/run URL plus format=,
 *    and the board-level report buttons hit /v1/pulse/report as a blob.
 *  · A 403 renders the house error state, never a blank; a declared-absent
 *    metric renders the stated-absence card, never an error, and is never run.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import AdminPulsePage, { hydratePulseLayout } from '../pages/admin/AdminPulsePage';
import ViewGrid from '../pages/dristi/ViewGrid';

const METRICS = [
  {
    key: 'pulse.active_users_week', module: 'pulse', label: 'Active this week',
    unit: 'count', grain: 'stock', dimensions: [], viz: 'kpi',
  },
  {
    key: 'pulse.active_users', module: 'pulse', label: 'Daily active users',
    unit: 'count', grain: 'flow', dimensions: [], viz: 'trend',
  },
  {
    key: 'pulse.top_orgs', module: 'pulse', label: 'Most active orgs',
    unit: 'count', grain: 'flow', dimensions: [], viz: 'table',
  },
  {
    key: 'pulse.api_health', module: 'pulse', label: 'API health',
    unit: 'count', grain: 'stock', dimensions: [], viz: 'kpi',
    absent: 'measured in Railway and Sentry — linked, not queried',
  },
];

const CATALOG = {
  metrics: METRICS,
  buckets: ['day', 'month', 'quarter', 'week', 'year'],
  compare_modes: ['mom', 'yoy'],
  formats: ['json', 'csv', 'xlsx', 'pdf'],
};

/** The code default's shape: 12-column widths, NO positions (source: default). */
const DEFAULT_VIEW = {
  source: 'default',
  layout: [
    { metric: 'pulse.active_users_week', viz: 'kpi', w: 3 },
    { metric: 'pulse.active_users', viz: 'trend', w: 6 },
    { metric: 'pulse.top_orgs', viz: 'table', w: 6 },
  ],
  updated_at: null,
};

const RUNS = {
  'pulse.active_users_week': {
    metric: 'pulse.active_users_week', label: 'Active this week',
    unit: 'count', grain: 'stock', data: [{ value: 312 }],
  },
  'pulse.active_users': {
    metric: 'pulse.active_users', label: 'Daily active users',
    unit: 'count', grain: 'flow', data: [{ period: '2026-08-01', value: 14 }],
  },
  // Org NAMES, never ids — the canned rows keep the server's contract.
  'pulse.top_orgs': {
    metric: 'pulse.top_orgs', label: 'Most active orgs',
    unit: 'count', grain: 'flow', data: [{ label: 'Unicode Group', value: 4812 }],
  },
};

let viewResponse;

beforeEach(() => {
  vi.clearAllMocks();
  viewResponse = DEFAULT_VIEW;
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.get.mockImplementation((url, cfg) => {
    if (url === '/v1/pulse/catalog') return Promise.resolve({ data: CATALOG });
    if (url === '/v1/pulse/view') return Promise.resolve({ data: viewResponse });
    if (url.startsWith('/v1/pulse/report')) return Promise.resolve({ data: new Blob(['report']) });
    if (url.startsWith('/v1/pulse/run')) {
      if (cfg?.responseType === 'blob') return Promise.resolve({ data: new Blob(['csv']) });
      const metric = new URLSearchParams(url.split('?')[1]).get('metric');
      return Promise.resolve({ data: RUNS[metric] });
    }
    return Promise.reject(new Error(`unmocked ${url}`));
  });
  api.put.mockImplementation((url, body) => Promise.resolve({
    data: { source: 'personal', layout: body.layout, updated_at: '2026-08-19T00:00:00' },
  }));
});

afterEach(() => vi.restoreAllMocks());

const mount = () => render(
  <ToastProvider>
    <AdminPulsePage />
  </ToastProvider>,
);

describe('hydratePulseLayout — the code default gets board geometry, not the ×4 misread', () => {
  it('keeps w:3 a quarter-width KPI and flows row-major', () => {
    const out = hydratePulseLayout(DEFAULT_VIEW.layout);
    expect(out[0]).toMatchObject({ metric: 'pulse.active_users_week', x: 0, y: 0, w: 3, h: 2 });
    expect(out[1]).toMatchObject({ metric: 'pulse.active_users', x: 3, y: 0, w: 6, h: 3 });
    // 9 + 6 crosses the rim: the table wraps under the tallest row above it.
    expect(out[2]).toMatchObject({ metric: 'pulse.top_orgs', x: 0, y: 3, w: 6, h: 3 });
  });

  it('passes a fully-placed personal layout through untouched', () => {
    const placed = [{ metric: 'pulse.top_orgs', viz: 'table', x: 2, y: 1, w: 8, h: 4 }];
    expect(hydratePulseLayout(placed)).toBe(placed);
  });
});

describe('the board renders the Pulse catalog through /v1/pulse/run', () => {
  it('draws every default widget off the Pulse door, never the tenant one', async () => {
    mount();
    await screen.findByText('Active this week');
    await screen.findByText('Daily active users');
    await screen.findByText('Most active orgs');
    await screen.findByText('Unicode Group');

    const runs = api.get.mock.calls.map((c) => c[0]).filter((u) => u.includes('metric='));
    expect(runs.length).toBe(3);
    for (const u of runs) expect(u.startsWith('/v1/pulse/run?')).toBe(true);
    expect(api.get.mock.calls.some((c) => String(c[0]).includes('/v1/analytics/'))).toBe(false);

    // The flow widget carries the window and the widget's own bucket rule.
    // Parsed, not substring-matched: 'metric=pulse.active_users' is a prefix
    // of 'metric=pulse.active_users_week' and would find the stock KPI.
    const flow = runs.find(
      (u) => new URLSearchParams(u.split('?')[1]).get('metric') === 'pulse.active_users',
    );
    expect(flow).toContain('date_from=');
    expect(flow).toContain('date_to=');
    expect(flow).toContain('bucket=month');
  });

  it('renders the declared absence as the absence card — no error, no run', async () => {
    viewResponse = {
      ...DEFAULT_VIEW,
      layout: [...DEFAULT_VIEW.layout, { metric: 'pulse.api_health', viz: 'kpi', w: 3 }],
    };
    mount();
    await screen.findByText('Not yet measurable.');
    expect(screen.queryByText('This did not load.')).toBeNull();
    // A stated absence is never asked to run.
    expect(api.get.mock.calls.some((c) => String(c[0]).includes('pulse.api_health'))).toBe(false);
  });
});

describe('the download chips on a Pulse card', () => {
  it("builds the widget's own /v1/pulse/run URL plus format=csv", async () => {
    mount();
    const chip = await screen.findByRole('button', { name: 'Download Active this week as CSV' });
    const widgetRun = api.get.mock.calls
      .map((c) => c[0])
      .find((u) => u.includes('metric=pulse.active_users_week'));
    expect(widgetRun.startsWith('/v1/pulse/run?')).toBe(true);

    fireEvent.click(chip);

    await waitFor(() => {
      const dl = api.get.mock.calls.find((c) => c[1]?.responseType === 'blob');
      expect(dl).toBeTruthy();
      // The SAME url, character for character, with only the format appended.
      expect(dl[0]).toBe(`${widgetRun}&format=csv`);
    });
  });
});

describe('save PUTs the drafted board to /v1/pulse/view', () => {
  it('sends full geometry, quarter-width KPI intact', async () => {
    mount();
    await screen.findByText('Active this week');

    fireEvent.click(screen.getByRole('button', { name: 'Customise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save board' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/v1/pulse/view');
    expect(body.layout).toHaveLength(3);
    expect(body.layout[0]).toMatchObject({
      metric: 'pulse.active_users_week', viz: 'kpi', x: 0, y: 0, w: 3, h: 2,
    });
    expect(body.layout[1]).toMatchObject({
      metric: 'pulse.active_users', viz: 'trend', x: 3, y: 0, w: 6, h: 3,
    });
    expect(body.layout[2]).toMatchObject({
      metric: 'pulse.top_orgs', viz: 'table', x: 0, y: 3, w: 6, h: 3,
    });

    // The board leaves edit mode and now presents the saved personal source.
    await screen.findByText('Your arrangement.');
  });
});

describe('the board-level report download', () => {
  it('requests /v1/pulse/report as a blob with the format asked, and names the file', async () => {
    mount();
    await screen.findByText('Active this week');

    fireEvent.click(screen.getByRole('button', { name: 'Download the Pulse report as CSV' }));
    await waitFor(() => {
      const call = api.get.mock.calls.find((c) => String(c[0]).startsWith('/v1/pulse/report?'));
      expect(call).toBeTruthy();
      expect(call[1]).toMatchObject({ responseType: 'blob' });
      const q = new URLSearchParams(String(call[0]).split('?')[1]);
      expect(q.get('format')).toBe('csv');
      expect(q.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(q.get('date_to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    // The filename states the exact window — kartavaya-pulse_<from>_<to>.csv.
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const a = HTMLAnchorElement.prototype.click.mock.contexts[0];
    expect(a.download).toMatch(/^kartavaya-pulse_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('each format button asks for its own format', async () => {
    mount();
    await screen.findByText('Active this week');

    fireEvent.click(screen.getByRole('button', { name: 'Download the Pulse report as PDF' }));
    await waitFor(() => {
      const call = api.get.mock.calls.find((c) => String(c[0]).startsWith('/v1/pulse/report?'));
      expect(call).toBeTruthy();
      expect(String(call[0])).toContain('format=pdf');
    });
  });
});

describe('the bell stays off the Pulse board', () => {
  // The alert line a bell arms watches /v1/analytics/run's numbers, so a
  // board pointed at the Pulse door has no alert to offer — its POST would
  // 422. `canAlert` carries a runPath guard for exactly this; deleting that
  // guard must go red here, not on a user's screen.
  it('a Pulse KPI card renders with NO alert bell', async () => {
    const { container } = mount();
    await screen.findByText('Active this week');
    await screen.findByText('312');

    expect(container.querySelector('.anx-bell')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Alert when Active this week crosses a line' }))
      .toBeNull();
  });

  it('control: the SAME KPI widget through the tenant path DOES carry one', async () => {
    // Same metric, same viz, same byKey — only the door differs. If this half
    // ever fails too, the bell is broken everywhere and the pair says so; if
    // only the Pulse half fails, the runPath guard was deleted.
    api.get.mockImplementation((url) => {
      if (url.startsWith('/v1/analytics/run')) {
        const metric = new URLSearchParams(url.split('?')[1]).get('metric');
        return Promise.resolve({ data: RUNS[metric] });
      }
      return Promise.reject(new Error(`unmocked ${url}`));
    });
    const byKey = {};
    for (const m of METRICS) byKey[m.key] = m;
    const { container } = render(
      <ToastProvider>
        <ViewGrid
          layout={[{ metric: 'pulse.active_users_week', viz: 'kpi', x: 0, y: 0, w: 4, h: 2 }]}
          byKey={byKey}
          range={{ from: '2026-07-19', to: '2026-08-17' }}
          editable={false}
          onLayoutChange={() => {}}
        />
      </ToastProvider>,
    );
    await screen.findByText('Active this week');
    const bell = await screen.findByRole('button', { name: 'Alert when Active this week crosses a line' });
    expect(container.querySelector('.anx-bell')).toBe(bell);
  });
});

describe('the report chips keep keyboard focus mid-pull', () => {
  it('the activated chip stays focusable via aria-disabled and ignores a second activation', async () => {
    // Gate the report so `pulling` holds while the assertions run.
    let releaseReport;
    const gate = new Promise((res) => { releaseReport = res; });
    const base = api.get.getMockImplementation();
    api.get.mockImplementation((url, cfg) => {
      if (String(url).startsWith('/v1/pulse/report')) return gate.then(() => ({ data: new Blob(['report']) }));
      return base(url, cfg);
    });
    mount();
    await screen.findByText('Active this week');

    const chip = screen.getByRole('button', { name: 'Download the Pulse report as CSV' });
    act(() => chip.focus());
    fireEvent.click(chip);
    await waitFor(() => expect(chip.textContent).toBe('…'));

    // `disabled` here would drop keyboard focus to <body> the moment the
    // chip disabled itself — the CustomizeTabs edge-button rule. The state
    // is announced through aria-disabled and the element stays focusable.
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(chip);

    // A second activation mid-pull — same chip or a sibling — is a no-op:
    // the click guard covers what pointer-events cannot (the keyboard).
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: 'Download the Pulse report as PDF' }));
    const reportCalls = () =>
      api.get.mock.calls.filter((c) => String(c[0]).startsWith('/v1/pulse/report')).length;
    expect(reportCalls()).toBe(1);

    // The pull landing releases the guard: chips re-arm and a new activation
    // goes through.
    releaseReport();
    await waitFor(() => expect(chip.textContent).toBe('CSV'));
    expect(chip.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(reportCalls()).toBe(2));
  });
});

describe('the refusal', () => {
  it('a 403 from the catalog renders the house error state, never a blank', async () => {
    api.get.mockImplementation(() => Promise.reject({
      response: { status: 403, data: { detail: 'Forbidden: platform console access required' } },
    }));
    mount();

    // The denied state, with the server's own sentence — role="alert", so the
    // page is never silently empty.
    await screen.findByRole('alert');
    await screen.findByText(/don’t have access/);
    await screen.findByText('Forbidden: platform console access required');
    expect(screen.queryByText('Active this week')).toBeNull();
  });
});
