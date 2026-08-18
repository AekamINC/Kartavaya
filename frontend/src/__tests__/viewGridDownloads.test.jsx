/**
 * ViewGrid download chips (S1) — every widget card carries CSV/XLSX/PDF off
 * the SAME `/run` URL the widget itself fetched, with only `format=` added.
 *
 * The one contract that matters: the file and the screen run the same SQL
 * with the same window, bucket and group_by. A download URL built by a second
 * code path is a file that can silently disagree with the card above it —
 * which is why the assertion is literal string equality against the widget's
 * own run URL, not a list of parameters.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import ViewGrid from '../pages/dristi/ViewGrid';

const BYKEY = {
  'graha.contacts_added': {
    key: 'graha.contacts_added', module: 'graha', label: 'Contacts added',
    unit: 'count', grain: 'flow', dimensions: ['source'],
  },
};
// 30 days — the widget's own bucket rule resolves this to bucket=month.
const RANGE = { from: '2026-07-19', to: '2026-08-17' };
const WIDGET = { metric: 'graha.contacts_added', viz: 'trend', w: 2, group_by: 'source' };

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom implements neither; the chip's blob-to-anchor path needs both.
  URL.createObjectURL = vi.fn(() => 'blob:stub');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.get.mockImplementation((url, cfg) => {
    if (url.includes('/v1/analytics/run')) {
      if (cfg?.responseType === 'blob') return Promise.resolve({ data: new Blob(['csv']) });
      return Promise.resolve({
        data: {
          metric: 'graha.contacts_added', unit: 'count', grain: 'flow',
          data: [{ period: '2026-08', value: 4 }],
        },
      });
    }
    return Promise.reject(new Error(`unmocked ${url}`));
  });
});

afterEach(() => vi.restoreAllMocks());

const mount = () => render(
  <ToastProvider>
    <ViewGrid layout={[WIDGET]} byKey={BYKEY} range={RANGE} editable={false} onLayoutChange={() => {}} />
  </ToastProvider>,
);

describe('ViewGrid · the download chips on a widget card', () => {
  it('builds the widget\'s own /run URL plus format=csv — group_by and all', async () => {
    mount();
    const chip = await screen.findByRole('button', { name: 'Download Contacts added as CSV' });

    // The widget's own run has landed by now (the chip only renders on ok).
    const widgetRun = api.get.mock.calls
      .map((c) => c[0])
      .find((u) => u.includes('/v1/analytics/run'));
    expect(widgetRun).toContain('group_by=source');
    expect(widgetRun).toContain('bucket=month');
    expect(widgetRun).toContain('date_from=2026-07-19');
    expect(widgetRun).toContain('date_to=2026-08-17');

    fireEvent.click(chip);

    await waitFor(() => {
      const dl = api.get.mock.calls.find((c) => c[1]?.responseType === 'blob');
      expect(dl).toBeTruthy();
      // The SAME url, character for character, with only the format appended.
      expect(dl[0]).toBe(`${widgetRun}&format=csv`);
    });
  });

  it('names the file by metric key and the exact window', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Download Contacts added as CSV' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    // The anchor the chip clicked carries the flow stem: key_from_to.format.
    const a = HTMLAnchorElement.prototype.click.mock.contexts[0];
    expect(a.download).toBe('graha-contacts_added_2026-07-19_2026-08-17.csv');
  });
});
