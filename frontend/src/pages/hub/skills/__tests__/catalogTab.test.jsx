/**
 * Skill pack catalog — the four things a marketplace card must not get wrong.
 *
 * Every assertion here is a specific sentence that was wrong, missing, or
 * misleading on the screen this replaced:
 *
 *   · THE PRICE. The card led with `estimated_credits`, a column
 *     `routers/hub.py:1141` describes as "an ESTIMATE that prices nothing" —
 *     the wallet is charged the sum of the steps at run time, resolved through
 *     `credits.price_of`, which is the same table `costs` comes from. A stale
 *     column beating the live table is a wrong price on a screen people buy
 *     from, so it is pinned in both directions: the live sum wins when it is
 *     there, and the stored figure is labelled as stored when it is all there
 *     is.
 *
 *   · WHY A PACK CANNOT RUN. `_run_function_step` refuses a handler that has no
 *     implementation, or one it cannot scope to a single organisation — after
 *     the pack has been assigned and someone has pressed Run. The catalog knew
 *     nothing about it.
 *
 *   · NOT KNOWING IS NOT THE SAME AS BEING FINE. When the capability list fails
 *     to load, the screen must say availability was not checked, and must NOT
 *     disable everything as though it had found a problem.
 *
 *   · WHAT A STEP IS. Every step was drawn as `words(s.agent_type)`; a data step
 *     has no `agent_type`, so `String(undefined ?? '')` gave every one of them a
 *     numbered chip with no label in it.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws — the same
 * constraint `hub/__tests__/sahayakHub.test.jsx` records, and the same shape.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../../lib/api';
import { ToastProvider } from '../../../../components/ui/toast';
import CatalogTab from '../CatalogTab';

/** The server's live price table, as `/v1/hub/org/credits` serves it. */
const COSTS = { social_media: 2, blog: 5, ad_copy: 3, email: 2 };

/** Two AI steps and one data step: 2 + 3 credits of AI, the data step free. */
const STEPS = [
  { order: 1, agent_type: 'social_media', prompt_template: 'Post about {festival_name}.', platform: 'instagram' },
  { order: 2, agent_type: 'ad_copy', prompt_template: 'Offer copy for {festival_name}.' },
  { order: 3, skill_function: 'find_overdue_invoices', params: {} },
];

const pack = (over = {}) => ({
  id: 't1',
  name: 'Festival Calendar',
  description: 'Posts for the festivals coming up.',
  category: 'festival',
  icon: 'calendar',
  estimated_credits: 99,          // deliberately NOT the sum of the steps
  steps: STEPS,
  ...over,
});

/** `/v1/hub/skills/capabilities`, with everything this pack names available. */
const CAPS = {
  skill_functions: [
    { name: 'find_overdue_invoices', available: true, kind: 'read', writes: false, needs: [], runtime_eligible: [] },
  ],
  context_sources: [{ key: 'receivables', label: 'Receivables', kind: 'read' }],
  unimplemented: [],
};

const listState = (items) => ({ loading: false, error: '', items, data: { data: items }, reload: vi.fn() });

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockResolvedValue({ data: CAPS });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/** Mount the tab with one pack and whatever else the case needs. */
async function mount({ packs = [pack()], costs = COSTS, canManage = true } = {}) {
  await act(async () => {
    root.render(
      <ToastProvider>
        <CatalogTab
          clientId="c1"
          state={listState(packs)}
          available={packs}
          costs={costs}
          canManage={canManage}
          onCreate={() => {}}
          onChanged={() => {}}
        />
      </ToastProvider>,
    );
  });
  await settle();
}

const text = () => container.textContent;
const assignBtn = () =>
  [...container.querySelectorAll('button')].find(b => b.textContent.includes('Assign to this client'));

describe('Skill pack catalog · the price', () => {
  it('quotes the live sum of the steps, not the stored estimate', async () => {
    await mount();
    // social_media 2 + ad_copy 3, and the data step is free.
    expect(text()).toContain('5 credits per run');
    expect(text()).not.toContain('99');
  });

  it('falls back to the stored figure ONLY when the price table did not load, and labels it', async () => {
    await mount({ costs: null });
    expect(text()).toContain('listed at 99 credits');
    expect(text()).not.toContain('per run');
    // And the hero says the price list is the thing that is missing.
    expect(text()).toContain('run costs are not shown');
  });

  it('says the cost is unavailable rather than inventing one', async () => {
    await mount({ costs: null, packs: [pack({ estimated_credits: 0 })] });
    expect(text()).toContain('cost unavailable');
  });

  it('counts the free data steps separately from the AI steps that spend', async () => {
    await mount();
    expect(text()).toContain('1 free');
    expect(text()).toContain('2 AI steps spend credits');
  });
});

describe('Skill pack catalog · a pack that cannot run', () => {
  it('says why, in the server’s own words, and refuses to assign it', async () => {
    api.get.mockResolvedValue({
      data: {
        ...CAPS,
        skill_functions: [{
          name: 'find_overdue_invoices',
          available: false,
          unavailable_reason: 'cannot be scoped to one organisation — its handler does not take org_id',
        }],
      },
    });
    await mount();

    expect(text()).toContain('This pack cannot run.');
    expect(text()).toContain('cannot be scoped to one organisation');
    expect(text()).toContain('Cannot run yet');
    expect(assignBtn().disabled).toBe(true);
  });

  it('distinguishes a function with no implementation from one the server has never heard of', async () => {
    api.get.mockResolvedValue({
      data: { ...CAPS, skill_functions: [], unimplemented: ['find_overdue_invoices'] },
    });
    await mount();
    expect(text()).toContain('has no implementation behind it');
    expect(text()).not.toContain('never heard');

    await act(async () => { root.render(<div />); });
    api.get.mockResolvedValue({ data: { ...CAPS, skill_functions: [], unimplemented: [] } });
    await mount();
    expect(text()).toContain('is not a skill function this server knows about');
  });

  it('does not claim a pack is fine when availability could not be checked', async () => {
    api.get.mockRejectedValue({ response: { status: 500, data: { detail: 'The registry is unavailable.' } } });
    await mount();

    expect(text()).toContain('Availability could not be checked');
    expect(text()).toContain('availability was not checked');
    // Not knowing is not a finding: the control stays live rather than being
    // greyed out as though a problem had been found.
    expect(assignBtn().disabled).toBe(false);
  });
});

describe('Skill pack catalog · what the pack does', () => {
  it('names a data step by its function instead of drawing an empty chip', async () => {
    await mount();
    // Scoped to the step chain ON PURPOSE. Asserting against the whole card
    // passes for the wrong reason — "find overdue invoices" also appears in the
    // Reads row below, so the assertion survived reverting this very fix.
    const chips = [...container.querySelectorAll('.mkt-flow__s')].map(li => li.textContent);
    expect(chips).toHaveLength(3);
    expect(chips[2]).toContain('find overdue invoices');
    // The old rendering left the third chip as its number and nothing else.
    expect(chips[2].replace(/\s/g, '')).not.toBe('3');
  });

  it('lists what a run will ask the person for', async () => {
    await mount();
    expect(text()).toContain('Asks you for');
    expect(text()).toContain('festival name');
  });

  it('marks a step that changes data', async () => {
    await mount({
      packs: [pack({
        steps: [{ order: 1, skill_function: 'generate_due_invoices', allow_writes: true, params: {} }],
      })],
    });
    expect(text()).toContain('changes your data');
  });
});

describe('Skill pack catalog · who may assign', () => {
  it('offers no button that will 403 — assigning is an Aekam function', async () => {
    await mount({ canManage: false });
    expect(text()).toContain('This catalog is read-only for you');
    expect(text()).toContain('Assigning a template is an Aekam function');
    expect(assignBtn().disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('assigns through the client-scoped route when the caller may', async () => {
    api.post.mockResolvedValue({ data: {} });
    await mount();
    await act(async () => { assignBtn().click(); });
    await settle();
    expect(api.post).toHaveBeenCalledWith('/v1/hub/clients/c1/skills/t1', {});
  });
});

describe('Skill pack catalog · the shelf', () => {
  it('offers one filter per category actually present, with its count', async () => {
    await mount({
      packs: [pack(), pack({ id: 't2', name: 'Launch Pack', category: 'launch' }), pack({ id: 't3', name: 'Diwali', category: 'festival' })],
    });
    const chips = [...container.querySelectorAll('.mkt-cat')].map(c => c.textContent);
    expect(chips.some(c => c.includes('All') && c.includes('3'))).toBe(true);
    expect(chips.some(c => c.includes('Festival') && c.includes('2'))).toBe(true);
    expect(chips.some(c => c.includes('Launch') && c.includes('1'))).toBe(true);
  });

  it('every card carries a tone from the module palette, never a raw colour', async () => {
    await mount();
    const card = container.querySelector('.mkt-card');
    // `--mc` is set from JS as a var() reference into module.css — the tone
    // flips by theme because this file never names a colour.
    expect(card.style.getPropertyValue('--mc')).toBe('var(--m-prachar)');
  });

  it('runs on the product palette, with no scoped theme of its own', async () => {
    // WAS: asserted `.mkt.k-surface-theme`, the scoped Slate palette.
    //
    // The owner scrapped Slate on 2026-08-07 — "prototype tokens.css follow
    // latest one, scrap my slate approved" — and surface-theme.css is deleted.
    // The class is gone rather than left inert, so this asserts its ABSENCE:
    // re-adding it here would silently give one tab a palette no other tab has,
    // which is the state that made Sanvaad unable to match the prototype.
    //
    // This is a one-class deletion and not a restyle: marketplace.css was
    // written on the product's canonical token names, its own header says every
    // rule is correct on the cream palette, and check-contrast reports no new
    // failures with the class removed.
    await mount();
    expect(container.querySelector('.mkt')).toBeTruthy();
    expect(container.querySelector('.k-surface-theme')).toBeNull();
  });
});
