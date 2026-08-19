/**
 * ViewGrid board behaviour (proposal 67) — the review findings, pinned.
 *
 * Each test here is a mutant that survived the first review:
 *  · #18  the narrow board kept 84px auto-rows under auto-height cards, so
 *         every stacked card painted over the next (asserted against the
 *         stylesheet text — jsdom applies no author CSS, same reasoning as
 *         motionTokens.test.jsx).
 *  · #20  density re-measured only on prop changes, so edit chrome moving
 *         the body left stale fill counts — the ResizeObserver is the fix.
 *  · #22  DOM order never followed the arrangement, so Tab order and
 *         reading order diverged from visual order after any drag.
 *  · #23  trend bars had no accessible values (title tooltips on
 *         non-focusable spans reach nobody without a mouse).
 *  · #24  removing a widget dropped focus to <body>.
 *  · #27  the live region swallowed repeated identical messages and
 *         announced no-op clamped resizes.
 *  · #28  both edit handles sat under the 24px WCAG 2.5.8 floor.
 *  · #30  a keyboard carry survived Tab-away as an uncommitted ghost move.
 *  · #31  trend x labels rendered raw periods ('2026-07-01').
 *  · #7   the commit/remove merge-back (mergeLayout) was untested.
 */
import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import ViewGrid, { mergeLayout } from '../pages/dristi/ViewGrid';

const BYKEY = {
  'graha.contacts_added': {
    key: 'graha.contacts_added', module: 'graha', label: 'Contacts added',
    unit: 'count', grain: 'stock', dimensions: [],
  },
  'graha.pipeline_value': {
    key: 'graha.pipeline_value', module: 'graha', label: 'Open pipeline',
    unit: 'count', grain: 'stock', dimensions: [],
  },
};
const RANGE = { from: '2026-07-19', to: '2026-08-17' };

// Full geometry everywhere: these specs are about the board, not about the
// legacy-layout upgrade, and full geometry passes normalizeLayout untouched.
const A = { metric: 'graha.contacts_added', viz: 'kpi', x: 0, y: 2, w: 4, h: 2 };
const B = { metric: 'graha.pipeline_value', viz: 'kpi', x: 0, y: 0, w: 4, h: 2 };

let runData;

/** RO stub: the component must drive re-measures through this, so the test
 *  can move a body box without any React prop changing. */
let roInstances;
class ROStub {
  constructor(cb) { this.cb = cb; roInstances.push(this); }

  observe() {}

  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  roInstances = [];
  vi.stubGlobal('ResizeObserver', ROStub);
  runData = {
    'graha.contacts_added': {
      metric: 'graha.contacts_added', unit: 'count', grain: 'stock', data: [{ value: 5 }],
    },
    'graha.pipeline_value': {
      metric: 'graha.pipeline_value', unit: 'count', grain: 'stock', data: [{ value: 9 }],
    },
  };
  api.get.mockImplementation((url) => {
    if (url.includes('/v1/analytics/run')) {
      const metric = new URLSearchParams(url.split('?')[1]).get('metric');
      return Promise.resolve({ data: runData[metric] });
    }
    return Promise.reject(new Error(`unmocked ${url}`));
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Controlled parent: ViewGrid never owns the layout, so a spec that ends at
 *  onLayoutChange has not shown the board re-rendering what it committed. */
function Board({ initial, editable = true, onChange }) {
  const [layout, setLayout] = useState(initial);
  return (
    <ToastProvider>
      <ViewGrid
        layout={layout}
        byKey={BYKEY}
        range={RANGE}
        editable={editable}
        onLayoutChange={(next) => { onChange?.(next); setLayout(next); }}
      />
    </ToastProvider>
  );
}

const headOrder = (container) => [...container.querySelectorAll('section.vgw .dbi__en')]
  .map((n) => n.textContent);
const liveRegion = (container) => container.querySelector('[aria-live="polite"]');

describe('mergeLayout — the commit/remove merge-back (#7)', () => {
  const NORM = [
    { metric: 'a.one', viz: 'kpi', group_by: 'source', x: 0, y: 0, w: 4, h: 2 },
    { metric: 'a.two', viz: 'table', columns: ['x', 'y'], x: 4, y: 0, w: 5, h: 2 },
    { metric: 'a.three', viz: 'bars', x: 0, y: 2, w: 4, h: 3 },
  ];

  it('lands geometry on the right rows by id, whatever order the engine returns', () => {
    const geo = [
      { id: 2, x: 8, y: 0, w: 4, h: 2 },
      { id: 0, x: 0, y: 4, w: 6, h: 3 },
      { id: 1, x: 0, y: 0, w: 12, h: 2 },
    ];
    const out = mergeLayout(NORM, geo);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ metric: 'a.one', x: 0, y: 4, w: 6, h: 3, group_by: 'source' });
    expect(out[1]).toMatchObject({ metric: 'a.two', x: 0, y: 0, w: 12, h: 2 });
    expect(out[1].columns).toEqual(['x', 'y']);
    expect(out[2]).toMatchObject({ metric: 'a.three', x: 8, y: 0, w: 4, h: 2 });
  });

  it('a row the engine did not place keeps its own geometry', () => {
    const out = mergeLayout(NORM, [{ id: 0, x: 6, y: 6, w: 4, h: 2 }]);
    expect(out[1]).toEqual(NORM[1]);
    expect(out[2]).toEqual(NORM[2]);
  });

  it('remove drops the row and pairs survivors with their OWN geometry, not by position', () => {
    // Survivor ids are the original indices — after removing 1, the geometry
    // for id 2 must land on a.three, never on whatever sits at position 1.
    const geo = [
      { id: 0, x: 0, y: 0, w: 4, h: 2 },
      { id: 2, x: 4, y: 0, w: 4, h: 3 },
    ];
    const out = mergeLayout(NORM, geo, 1);
    expect(out).toHaveLength(2);
    expect(out.map((w) => w.metric)).toEqual(['a.one', 'a.three']);
    expect(out[0]).toMatchObject({ x: 0, y: 0, group_by: 'source' });
    expect(out[1]).toMatchObject({ x: 4, y: 0, h: 3 });
  });
});

describe('DOM order follows the arrangement (#22)', () => {
  it('renders cards in (y, x) order, not list order, and follows a keyboard move', async () => {
    const onChange = vi.fn();
    const { container } = render(<Board initial={[A, B]} onChange={onChange} />);
    await screen.findByText('Open pipeline');

    // The list says [A, B]; the geometry says B sits above A.
    expect(headOrder(container)).toEqual(['Open pipeline', 'Contacts added']);

    // Carry A one row up: it lands above B, and the DOM follows the drop.
    const grip = screen.getByRole('button', { name: /^Move Contacts added/ });
    fireEvent.keyDown(grip, { key: 'Enter' });
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    fireEvent.keyDown(grip, { key: 'Enter' });

    await waitFor(() => {
      expect(headOrder(container)).toEqual(['Contacts added', 'Open pipeline']);
    });
    // The committed rows keep their identity: geometry moved, fields did not.
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.map((w) => w.metric)).toEqual(['graha.contacts_added', 'graha.pipeline_value']);
    expect(next[0].y).toBe(0);
    expect(next[1].y).toBe(2);
  });
});

describe('a keyboard carry does not survive focus leaving the grip (#30)', () => {
  it('restores the pre-carry layout and drops the carry on Tab-away', async () => {
    const onChange = vi.fn();
    const { container } = render(<Board initial={[A, B]} onChange={onChange} />);
    await screen.findByText('Open pipeline');

    const grip = screen.getByRole('button', { name: /^Move Contacts added/ });
    fireEvent.keyDown(grip, { key: 'Enter' });
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    // Mid-carry the preview has reordered the board.
    expect(headOrder(container)).toEqual(['Contacts added', 'Open pipeline']);

    // Focus genuinely moves elsewhere — the deferred verdict must cancel.
    const other = screen.getByRole('button', { name: /^Move Open pipeline/ });
    act(() => { other.focus(); });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Move Contacts added/ }))
        .toHaveAttribute('aria-pressed', 'false');
    });
    expect(headOrder(container)).toEqual(['Open pipeline', 'Contacts added']);
    expect(onChange).not.toHaveBeenCalled();
    expect(liveRegion(container).textContent).toContain('Cancelled. Contacts added is back where it was.');
  });
});

describe('the live region (#27)', () => {
  it('re-announces a repeated identical message and says nothing on a no-op resize', async () => {
    const onChange = vi.fn();
    const kpi = { metric: 'graha.contacts_added', viz: 'kpi', x: 0, y: 0, w: 12, h: 3 };
    const { container } = render(<Board initial={[kpi]} onChange={onChange} />);
    await screen.findByText('Contacts added');
    const rs = screen.getByRole('button', { name: /^Resize Contacts added/ });

    // Already 12 wide: the clamp changes nothing, so nothing is said or saved.
    fireEvent.keyDown(rs, { key: 'ArrowRight' });
    expect(liveRegion(container).textContent).toBe('');
    expect(onChange).not.toHaveBeenCalled();

    // A kpi caps at h=3 — the refusal speaks, and speaks AGAIN on repeat: the
    // second identical message must differ in the DOM or aria-live sits mute.
    fireEvent.keyDown(rs, { key: 'ArrowDown' });
    const first = liveRegion(container).textContent;
    expect(first).toContain('already shows everything it has');
    fireEvent.keyDown(rs, { key: 'ArrowDown' });
    const second = liveRegion(container).textContent;
    expect(second).not.toBe(first);
    expect(second.replace(/\u200B/g, '')).toBe(first.replace(/\u200B/g, ''));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('trend accessibility (#23, #31)', () => {
  it('gives every bar a hidden text value and formats x labels through periodLabel', async () => {
    runData['graha.contacts_added'] = {
      metric: 'graha.contacts_added',
      unit: 'count',
      grain: 'stock',
      data: [{ period: '2026-06-01', value: 3 }, { period: '2026-07-01', value: 4 }],
    };
    const trend = { metric: 'graha.contacts_added', viz: 'trend', x: 0, y: 0, w: 6, h: 3 };
    const { container } = render(<Board initial={[trend]} editable={false} />);

    // The sr-only value: "Jun: 3" — the period through the house formatter,
    // the value through the unit formatter. The long timeout is load
    // tolerance, not a weaker claim: the fetch → rAF density → render chain
    // sits behind requestAnimationFrame, and the full suite on a saturated
    // machine can starve a frame past findBy's default second.
    await screen.findByText('Jun: 3', {}, { timeout: 15000 });
    // Anchored on the TEXT nodes, not a bag count: under the full suite a
    // transient extra .k-sr-only (the board's empty aria-live region during a
    // re-render tick) made a count-by-selector flake while both values were
    // present and correctly placed. Asserting each value's own node pins the
    // same claim — every bar carries a hidden text value inside its column —
    // without counting bystanders.
    for (const label of ['Jun: 3', 'Jul: 4']) {
      const el = screen.getByText(label);
      expect(el.className).toContain('k-sr-only');
      expect(el.closest('.vgw-trend__c')).not.toBeNull();
    }
    expect(container.querySelectorAll('.vgw-trend__c')).toHaveLength(2);

    // The visible axis label is the formatted month, never the raw period.
    expect(screen.getAllByText('Jul').length).toBeGreaterThan(0);
    expect(screen.queryByText('2026-07-01')).toBeNull();
  });
});

describe('density re-measures when the body box moves (#20)', () => {
  it('re-fits through the ResizeObserver with no prop change at all', async () => {
    runData['graha.contacts_added'] = {
      metric: 'graha.contacts_added',
      unit: 'count',
      grain: 'stock',
      data: Array.from({ length: 10 }, (_, i) => ({ label: `c${i}`, value: i + 1 })),
    };
    const bars = { metric: 'graha.contacts_added', viz: 'bars', x: 0, y: 0, w: 4, h: 3 };
    const { container } = render(<Board initial={[bars]} editable={false} />);
    await screen.findByText('c0');

    // Unmeasured (0px) body: one row and a note that more waits below.
    expect(container.querySelectorAll('.vgw-hbars__r')).toHaveLength(1);
    screen.getByText('+9 more — taller shows them');

    // The body box grows — edit chrome leaving, in real life — and NOTHING
    // in the props moves. Only the observer can carry this.
    const body = container.querySelector('.anx-card__b');
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 });
    expect(roInstances.length).toBeGreaterThan(0);
    act(() => { roInstances.at(-1).cb([], roInstances.at(-1)); });

    await waitFor(() => {
      expect(container.querySelectorAll('.vgw-hbars__r')).toHaveLength(10);
    });
    expect(screen.queryByText(/more — taller shows them/)).toBeNull();
  });
});

describe('a stale measure cannot cut a freshly-rendered trend', () => {
  it('a measurement scheduled before the run landed keeps every period when it fires after', async () => {
    // The transient the review found: the density pipeline schedules
    // measures asynchronously (one rAF after layout, plus ResizeObserver
    // notifications), so a measurement subscribed while the run was still
    // out can APPLY after the data has rendered. Computed against the old
    // (empty) generation it said "0 periods fit", and Trend's floor turned
    // that into a one-period cut of a trend that had just drawn in full.
    // The fix makes every measure re-read the CURRENT data generation at
    // the moment it runs — so firing the pre-data observer here must
    // change nothing.
    runData['graha.contacts_added'] = {
      metric: 'graha.contacts_added',
      unit: 'count',
      grain: 'stock',
      data: [{ period: '2026-06-01', value: 3 }, { period: '2026-07-01', value: 4 }],
    };
    const trend = { metric: 'graha.contacts_added', viz: 'trend', x: 0, y: 0, w: 6, h: 3 };
    const { container } = render(<Board initial={[trend]} editable={false} />);

    // The run has landed and the trend shows the FULL window. (Same load
    // tolerance as the trend-a11y spec above: the fetch → rAF chain can
    // starve a frame under the full suite.)
    await screen.findByText('Jun: 3', {}, { timeout: 15000 });
    expect(container.querySelectorAll('.vgw-trend__c')).toHaveLength(2);
    screen.getByText('the full window');

    // Fire the FIRST observer subscribed — the one created before the data
    // landed. Its notification arriving now is exactly the stale path.
    expect(roInstances.length).toBeGreaterThan(0);
    act(() => { roInstances[0].cb([], roInstances[0]); });

    // Every period survives; no "last 1 of 2" note appears.
    expect(container.querySelectorAll('.vgw-trend__c')).toHaveLength(2);
    expect(screen.queryByText(/last \d+ of \d+ periods/)).toBeNull();
    screen.getByText('the full window');
  });
});

describe('removing a widget hands focus on (#24)', () => {
  it('focuses the next card\'s first control, and the board when none remains', async () => {
    const first = { ...A, y: 0 };
    const second = { ...B, y: 2 };
    const { container } = render(<Board initial={[first, second]} />);
    await screen.findByText('Open pipeline');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Contacts added' }));
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label') || '')
        .toMatch(/^Move Open pipeline/);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Open pipeline' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(container.querySelector('.vg'));
    });
  });
});

/* ── The stylesheet's half of the contract ─────────────────────────────────
   jsdom applies no author CSS, so these are text assertions against
   analytics.css — the same strictly-weaker-but-real substitute
   motionTokens.test.jsx explains. */
describe('analytics.css — the board stylesheet', () => {
  const css = readFileSync('src/styles/analytics.css', 'utf8');

  it('#18: below 720px the board rows size to content, not to the 84px track', () => {
    expect(css).toMatch(
      /@media \(max-width: 720px\)\s*\{\s*\.vg\s*\{[^}]*grid-auto-rows:\s*auto/,
    );
    // The desktop board still sits on the row token boardEngine restates.
    expect(css).toMatch(/\.vg\s*\{[^}]*grid-auto-rows:\s*var\(--anx-rowh, 84px\)/);
  });

  it('#28: both edit handles meet the 24px target-size floor', () => {
    for (const sel of ['\\.vgw-grip', '\\.vgw-rs']) {
      const block = new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
      const w = Number(/width:\s*(\d+)px/.exec(block)?.[1] || 0);
      const h = Number(/height:\s*(\d+)px/.exec(block)?.[1] || 0);
      expect(w, `${sel} width`).toBeGreaterThanOrEqual(24);
      expect(h, `${sel} height`).toBeGreaterThanOrEqual(24);
    }
  });
});
