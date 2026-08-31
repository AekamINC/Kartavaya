/**
 * Two territories can claim one pincode, and now the firm decides which wins.
 *
 * ── THE SHAPE, WHICH IS THE ONE THIS PROGRAMME KEEPS FINDING ───────────────
 * `services/territory_routing.py` has sorted overlapping claims on
 * `rules.priority` since Phase 7.1 — lowest wins, blank sorts last, ties broken
 * by name — and `_priority_of` explains at length why it answered the question
 * deterministically rather than arbitrarily: *"two runs over the same data must
 * route a contact the same way, or the first support ticket is unanswerable."*
 *
 * ⚠ NOTHING COULD SET IT. `TerritoriesTab` is the only writer of the `rules`
 * column and it wrote exactly one key, `pincodes`. Six live territories, none
 * carrying a priority of any kind. Suite 04.07b named the consequence: the
 * product DETECTS the collision, resolves it inside the router, and tells the
 * customer about it afterwards — with no control anywhere to decide the outcome
 * in advance.
 *
 * Owner's ruling, 2026-08-31: *"let org decide not hard coded, org can decide in
 * setting of the module."* So this is a number the firm sets per patch, not a
 * strategy chosen by us.
 *
 * ── WHAT THIS FILE PINS ────────────────────────────────────────────────────
 *  1. the control exists and is reachable;
 *  2. what it sends is an INTEGER under `rules.priority`, which is the only
 *     shape `_priority_of` accepts — a string would be silently ignored and the
 *     firm would believe it had set an order;
 *  3. BLANK deletes the key rather than writing null or '' — an empty value
 *     that sits in the jsonb looks like an answer somebody gave;
 *  4. and the rest of `rules` survives, because the PATCH REPLACES the whole
 *     column and `pincodes` is what a territory actually IS.
 *
 * Rendered with react-dom directly — `@testing-library/react` is installed and
 * its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import TerritoriesTab from '../TerritoriesTab';

const WEST = {
  id: 'terr-1', name: 'West Ahmedabad', description: 'The west patch',
  assigned_users: [], rules: { pincodes: ['380015', '380054'], priority: 2 },
};

let territories = [];
let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  territories = [];
  api.get.mockImplementation((url) => {
    if (String(url).startsWith('/v1/graha/territories')) {
      return Promise.resolve({ data: { data: territories } });
    }
    return Promise.resolve({ data: { data: [] } });
  });
  api.post.mockResolvedValue({ data: { id: 'terr-new' } });
  api.patch.mockResolvedValue({ data: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter><ToastProvider><TerritoriesTab /></ToastProvider></MemoryRouter>,
    );
  });
  await settle();
};

const all = (sel) => Array.from(container.querySelectorAll(sel));
const byLabel = (re) => all('label.gr__f')
  .find((l) => re.test(l.querySelector('.gr__fl')?.textContent || ''));
const priorityBox = () => container.querySelector('input[aria-label="Priority when patches overlap"]');
const btn = (re) => all('button').find((b) => re.test(b.textContent || ''));

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

const type = async (el, value) => {
  const { set } = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};

const openNew = async () => {
  const b = btn(/New Territory|\+ New/i);
  expect(b, 'there is no control that opens the territory form').toBeTruthy();
  await click(b);
};

describe('Graha — a territory can be given a priority', () => {
  it('offers the control on the form', async () => {
    await mount();
    await openNew();
    expect(
      priorityBox(),
      'THE DEFECT: the routing engine has sorted on `rules.priority` since '
      + 'Phase 7.1 and no screen could ever set one',
    ).toBeTruthy();
    expect(byLabel(/priority/i), 'the priority box carries no visible label').toBeTruthy();
  });

  it('says which way round it goes, because lower-wins is not guessable', async () => {
    await mount();
    await openNew();
    const hint = byLabel(/priority/i).querySelector('.gr__fh');
    expect(hint, 'nothing on screen says whether a high or a low number wins').toBeTruthy();
    expect(hint.textContent.toLowerCase()).toContain('lower');
  });

  it('sends an integer, which is the only shape the engine accepts', async () => {
    await mount();
    await openNew();
    await type(container.querySelector('input.k-input'), 'East Ahmedabad');
    await type(priorityBox(), '3');
    await click(btn(/^Create$/));

    expect(api.post).toHaveBeenCalled();
    const body = api.post.mock.calls[0][1];
    expect(
      body.rules.priority,
      '`_priority_of` accepts an INTEGER and ignores everything else, so a '
      + 'string here is silently dropped and the firm believes it set an order',
    ).toBe(3);
    expect(typeof body.rules.priority).toBe('number');
  });

  it('leaving it blank deletes the key rather than writing an empty answer', async () => {
    await mount();
    await openNew();
    await type(container.querySelector('input.k-input'), 'No preference');
    await type(priorityBox(), '4');
    await type(priorityBox(), '');
    await click(btn(/^Create$/));

    const { rules } = api.post.mock.calls[0][1];
    expect(
      Object.prototype.hasOwnProperty.call(rules, 'priority'),
      'a blank priority was stored as null or "" — the engine ignores it either '
      + 'way, but it sits in the jsonb looking like an answer somebody gave',
    ).toBe(false);
  });

  it('editing a territory keeps its pincodes, which is what a territory IS', async () => {
    territories = [WEST];
    await mount();
    const edit = btn(/^Edit$/);
    expect(edit, 'the territory row offers no Edit').toBeTruthy();
    await click(edit);

    expect(priorityBox().value, 'the form opened without the stored priority, so '
      + 'saving would silently clear it').toBe('2');

    await type(priorityBox(), '1');
    await click(btn(/^Save changes$/));

    const { rules } = api.patch.mock.calls[0][1];
    expect(rules.priority).toBe(1);
    expect(
      rules.pincodes,
      'the PATCH replaces the whole rules column, so a save that forgets the '
      + 'pincodes empties the territory',
    ).toEqual(['380015', '380054']);
  });

  it('shows the priority on the row, not only inside the form', async () => {
    territories = [WEST];
    await mount();
    expect(
      container.textContent,
      'the order can only be read by opening every territory one at a time, '
      + 'which is the whole thing a priority exists to make visible',
    ).toMatch(/Priority\s*2/);
  });
});
