/**
 * KanbanTab — the three behaviours that were wrong, asserted so they cannot
 * quietly come back.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws —
 * `pageHeader.test.jsx` records the same constraint.
 *
 * jsdom cannot perform a real pointer drag, so the drop path is exercised
 * through the stage buttons. That is not a compromise: both paths call the same
 * `moveStage`, and what is under test is the OPTIMISTIC CONTRACT, not the drag
 * library's hit-testing. `@hello-pangea/dnd`'s behaviour is its own business;
 * ours is what we do with the result it hands back.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the transport is mocked. `rows()` / `body()` are imported from the real
// module, because they are the thing that decides whether `{"data": […]}` and a
// bare array both read correctly — stubbing them would mock out the logic under
// test and let a shape bug through.
//
// A bare `() => ({ api: … })` factory here would leave every other export
// undefined, so the first component to adopt `body()` throws on render and all
// eight tests fail with `Cannot read properties of undefined`. That is exactly
// what happened when KanbanTab started unwrapping through it. `importOriginal`
// is safe: vitest.config.js defines `import.meta.env.VITE_BACKEND_URL`, so
// evaluating lib/api does not hit its missing-config guard.
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), patch: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import KanbanTab from '../KanbanTab';

const BOARD = {
  columns: {
    New: [{ id: 'd1', title: 'Wipro renewal', value: 340000, updated_at: new Date().toISOString() }],
    Qualified: [], Proposal: [], Negotiation: [], Won: [], Lost: [],
  },
  stages: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
};

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = () => act(() => root.render(<ToastProvider><KanbanTab /></ToastProvider>));
/** Flush the microtask queue and any state updates it produced. */
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };

const text = () => container.textContent;
const cardFor = (title) => [...container.querySelectorAll('.ix-drag-card')]
  .find(el => el.textContent.includes(title));
const stageBtn = (label) => [...container.querySelectorAll('button')]
  .find(b => b.textContent.trim() === label);

describe('KanbanTab — a failed fetch is not an empty board', () => {
  it('renders an error with a retry, never "No deals", when the load fails', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 500 } });
    mount();
    await settle();

    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    // The exact regression: an empty `kanban` used to paint six columns of
    // "No deals", which is a confident wrong answer the user cannot tell apart
    // from a genuinely empty pipeline.
    expect(text()).not.toContain('No deals');
    expect(text()).toContain('Try again');
  });

  it('retry re-issues the request and shows the board', async () => {
    api.get
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ data: BOARD });
    mount();
    await settle();

    await click([...container.querySelectorAll('button')].find(b => /try again/i.test(b.textContent)));
    expect(text()).toContain('Wipro renewal');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('a rejection with no response is classified offline, not as a server error', async () => {
    api.get.mockRejectedValueOnce({ message: 'Network Error' });
    mount();
    await settle();
    expect(container.querySelector('[role="alert"]').dataset.kind).toBe('offline');
  });
});

describe('KanbanTab — the move is optimistic', () => {
  it('moves the card before the server answers and dims it while in flight', async () => {
    api.get.mockResolvedValueOnce({ data: BOARD });
    let resolvePatch;
    api.patch.mockReturnValueOnce(new Promise(r => { resolvePatch = r; }));
    mount();
    await settle();

    expect(cardFor('Wipro renewal').className).not.toMatch(/ix-pending/);

    await click(stageBtn('Qualified'));

    // MOTION-SPEC §7.1 — on screen immediately, and visibly not yet committed.
    expect(cardFor('Wipro renewal').className).toMatch(/ix-pending/);
    // It really moved: a card offers every stage EXCEPT its own, so the absence
    // of a "Qualified" button is proof the card is now in Qualified.
    expect(stageBtn('Qualified')).toBeUndefined();
    expect(stageBtn('New')).toBeTruthy();

    await act(async () => { resolvePatch({ data: { id: 'd1', stage: 'Qualified' } }); });
    await settle();

    const settled = cardFor('Wipro renewal');
    expect(settled.className).not.toMatch(/ix-pending/);
    // 9.1's settle flash, so the card is findable in the column it landed in.
    expect(settled.className).toMatch(/ix-landed/);
  });

  it('puts the card back where it came from when the write fails', async () => {
    api.get.mockResolvedValueOnce({ data: BOARD });
    api.patch.mockRejectedValueOnce({ response: { status: 500 } });
    mount();
    await settle();

    await click(stageBtn('Qualified'));

    const card = cardFor('Wipro renewal');
    expect(card.className).not.toMatch(/ix-pending/);
    // Back in New. Never lie about state: the failed value must not stay up.
    expect(stageBtn('New')).toBeUndefined();
    expect(stageBtn('Qualified')).toBeTruthy();
    expect(text()).toContain('Could not move deal');
  });

  it('does not strand the card dimmed when the same deal is moved twice', async () => {
    api.get.mockResolvedValueOnce({ data: BOARD });
    api.patch.mockResolvedValue({ data: { id: 'd1' } });
    mount();
    await settle();

    await click(stageBtn('Qualified'));
    expect(cardFor('Wipro renewal').className).not.toMatch(/ix-pending/);
    await click(stageBtn('Proposal'));
    expect(cardFor('Wipro renewal').className).not.toMatch(/ix-pending/);
  });

  it('never refetches the board on a successful move', async () => {
    api.get.mockResolvedValueOnce({ data: BOARD });
    api.patch.mockResolvedValueOnce({ data: { id: 'd1', stage: 'Won' } });
    mount();
    await settle();

    await click(stageBtn('Won'));
    // A whole-board refetch would discard any other card moved while this one
    // was in flight — the common case on a board being tidied.
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe('KanbanTab — loading', () => {
  it('shows a shaped skeleton, not the word "Loading"', async () => {
    api.get.mockReturnValueOnce(new Promise(() => {}));
    mount();
    // 26 §9 / MOTION-SPEC §7.4: a skeleton beats a spinner when the shape is
    // known, and it must match the real geometry so nothing shifts on arrival.
    expect(container.querySelector('.k-skeleton-grid')).toBeTruthy();
    expect(container.querySelector('[role="status"]').getAttribute('aria-busy')).toBe('true');
  });
});
