/**
 * Vikray · targets — the zero has to say which zero it is.
 *
 * Attainment joined `graha_deals.owner_id`, a column nothing in the product
 * ever writes (0 of 649 deals on live data), so every target in every org
 * rendered "Rs 0 of Rs 15,00,000" forever. The backend now counts won deals by
 * their ASSIGNEE, which is the column the product actually writes.
 *
 * Fixing the join does not make every zero disappear, and it should not. In one
 * live org all five deals — Rs 2,50,000 of won business — have no assignee, so
 * both people holding targets there still read zero, correctly: nobody has
 * claimed that revenue. This file pins the sentence that tells them so. Without
 * it the honest zero and the old broken zero look identical on screen, and the
 * first conclusion is that the number is broken again.
 *
 * Rendered with react-dom directly rather than @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws. Same
 * constraint `vikrayTabStates.test.jsx` records.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

// The tab disables its controls through this hook, which reaches for route and
// subscription context that is not worth standing up to read a paragraph.
vi.mock('../../../hooks/useModuleWrite', () => ({
  default: () => ({ canWrite: true, reason: '' }),
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import TargetsTab from '../TargetsTab';

/** Two people, one quarter — the shape the live org actually returns. */
const twoTargetsOneUnclaimedPeriod = [
  {
    id: 't1', salesperson_id: 'user_91601f25f601', salesperson_name: 'Kasti ORG',
    period_start: '2026-07-01', period_end: '2026-09-30',
    target_amount: '1800000.00', target_deals: 12,
    actual_amount: '0', actual_deals: 0,
    unattributed_amount: '250000.00', unattributed_deals: 3,
  },
  {
    id: 't2', salesperson_id: 'user_21457956f010', salesperson_name: 'Keval UK',
    period_start: '2026-07-01', period_end: '2026-09-30',
    target_amount: '900000.00', target_deals: 8,
    actual_amount: '0', actual_deals: 0,
    unattributed_amount: '250000.00', unattributed_deals: 3,
  },
];

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  container = null;
  root = null;
});

async function renderWith(targets) {
  api.get.mockImplementation((url) => {
    if (url.includes('leaderboard')) return Promise.resolve({ data: { data: [] } });
    if (url.includes('/targets')) return Promise.resolve({ data: { data: targets } });
    return Promise.resolve({ data: { data: [] } });
  });
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastProvider><TargetsTab /></ToastProvider>
      </MemoryRouter>,
    );
  });
  return container.textContent;
}

describe('unclaimed won revenue', () => {
  it('names the money that belongs to no target', async () => {
    const text = await renderWith(twoTargetsOneUnclaimedPeriod);
    const note = container.querySelector('.vk-tg__unclaimed');
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/2,50,000/);
    expect(note.textContent).toMatch(/3 won deals/);
    expect(note.textContent).toMatch(/no\s+salesperson assigned in Graha/);
  });

  it('says it once per period, not once per person sharing it', async () => {
    // Both rows carry the same Rs 2,50,000 for the same quarter, because the
    // API reports the figure per target row. Printing it twice reads as
    // Rs 5,00,000 of unassigned revenue, which is a wrong number.
    await renderWith(twoTargetsOneUnclaimedPeriod);
    const lines = container.querySelectorAll('.vk-tg__unclaimedl');
    expect(lines.length).toBe(1);
  });

  it('separates two periods that each have unclaimed revenue', async () => {
    await renderWith([
      twoTargetsOneUnclaimedPeriod[0],
      {
        ...twoTargetsOneUnclaimedPeriod[1],
        id: 't3', period_start: '2026-04-01', period_end: '2026-06-30',
        unattributed_amount: '75000.00', unattributed_deals: 1,
      },
    ]);
    const lines = [...container.querySelectorAll('.vk-tg__unclaimedl')].map(n => n.textContent);
    expect(lines.length).toBe(2);
    expect(lines.join(' ')).toMatch(/75,000/);
    // Singular, because one deal is one deal.
    expect(lines.some(l => /1 won deal\b/.test(l))).toBe(true);
  });

  it('stays silent when every won deal is assigned', async () => {
    await renderWith([{
      ...twoTargetsOneUnclaimedPeriod[0],
      actual_amount: '1900000.00', actual_deals: 13,
      unattributed_amount: '0', unattributed_deals: 0,
    }]);
    expect(container.querySelector('.vk-tg__unclaimed')).toBeNull();
  });

  it('still renders the attainment the fixed join now produces', async () => {
    const text = await renderWith([{
      ...twoTargetsOneUnclaimedPeriod[0],
      actual_amount: '3765890.00', actual_deals: 2,
      unattributed_amount: '0', unattributed_deals: 0,
    }]);
    expect(text).toMatch(/37,65,890/);
    expect(text).toMatch(/2 of 12 deals/);
  });
});

describe('the rule the screen states', () => {
  it('tells the user assignment is what makes a deal count', async () => {
    const text = await renderWith(twoTargetsOneUnclaimedPeriod);
    // The whole cause of the remaining zero. If the screen does not say it,
    // the user has no way to know what to do about it.
    expect(text).toMatch(/assigned to that salesperson/i);
  });
});
