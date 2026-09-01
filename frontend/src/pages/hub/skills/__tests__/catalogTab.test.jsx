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

  /* ── Grouped by what kind of thing each skill is ─────────────────────────
     Migration 166 gave every template a real `skill_type`; before it the
     column was 'content' on all nineteen rows and carried no information, so
     the shelf could only be split by whether a pack could RUN. These pin the
     grouping, its ORDER, and the two things that must not come back with it. */

  /** A runnable pack of a given kind. No agent steps, so it is free. */
  const kindPack = (id, name, skill_type) => pack({
    id, name, skill_type, estimated_credits: 0,
    steps: [{ order: 1, skill_function: 'find_overdue_invoices', generate_image: false }],
  });

  const headings = () =>
    [...container.querySelectorAll('.mkt-sec')].map(h => h.textContent);

  it('groups the shelf by skill_type, and counts each group', async () => {
    await mount({
      packs: [
        kindPack('t1', 'Dead GST rates', 'check'),
        kindPack('t2', 'Statutory dues brief', 'brief'),
        kindPack('t3', 'Collection message pack', 'pack'),
        kindPack('t4', 'Invoice series gaps', 'check'),
      ],
    });
    const h = headings();
    expect(h.some(x => x.includes('Checks') && x.includes('2'))).toBe(true);
    expect(h.some(x => x.includes('Briefs') && x.includes('1'))).toBe(true);
    expect(h.some(x => x.includes('Packs') && x.includes('1'))).toBe(true);
  });

  it('puts the things that find problems above the things that cost money', async () => {
    // Not alphabetical and not seed order. A firm opening this screen should
    // meet the checks over its own records before the marketing copy, and this
    // ordering also puts every free skill above every priced one. Mounted in
    // deliberately the WRONG order so a stable sort cannot pass by accident.
    await mount({
      packs: [
        pack({ id: 't4', name: 'SEO Blog Series', skill_type: 'content' }),
        kindPack('t3', 'Collection message pack', 'pack'),
        kindPack('t2', 'Statutory dues brief', 'brief'),
        kindPack('t1', 'Dead GST rates', 'check'),
      ],
    });
    const order = headings().map(x => x.trim().split(/\s/)[0]);
    expect(order).toEqual(['Checks', 'Briefs', 'Packs', 'Content']);
  });

  it('renders no heading for a kind nothing is filed under', async () => {
    // Before 167 the whole catalogue was content, so three of the four would
    // have been permanently empty headings. A shelf that is mostly labels
    // teaches the reader to skip labels.
    await mount({ packs: [kindPack('t1', 'Dead GST rates', 'check')] });
    const h = headings();
    expect(h.some(x => x.includes('Checks'))).toBe(true);
    expect(h.some(x => x.includes('Briefs'))).toBe(false);
    expect(h.some(x => x.includes('Packs'))).toBe(false);
    expect(h.some(x => x.includes('Content'))).toBe(false);
  });

  it('keeps every unrunnable pack in ONE group, not split across four', async () => {
    // What those cards have in common is that they are BROKEN, which matters
    // more than what they would have done. `nope` is in no capability list, so
    // `blockersFor` holds both of them back.
    await mount({
      packs: [
        pack({ id: 't1', name: 'Broken check', skill_type: 'check',
               steps: [{ order: 1, skill_function: 'nope' }] }),
        pack({ id: 't2', name: 'Broken brief', skill_type: 'brief',
               steps: [{ order: 1, skill_function: 'nope' }] }),
      ],
    });
    expect(text()).toContain('Cannot run yet');
    expect(headings().filter(x => x.includes('Cannot run yet'))).toHaveLength(1);
    expect(headings().some(x => x.includes('Checks'))).toBe(false);
  });

  it('files a row written before the taxonomy under Content, not a fifth shelf', async () => {
    // `skill_type` defaults to 'content' in the database and every row carried
    // it before 166. An unrecognised value is an OLD row, not a new kind, so
    // the fallback gives the same answer the column would.
    await mount({ packs: [kindPack('t1', 'Ancient pack', 'automation')] });
    const h = headings();
    expect(h.some(x => x.includes('Content'))).toBe(true);
    expect(h.some(x => x.includes('Other') || x.includes('Uncategorised'))).toBe(false);
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

// ══════════════════════════════════════════════════════════════════════════════
//  Who it is for, and when to run it — migration 261
// ══════════════════════════════════════════════════════════════════════════════
//
// The catalogue answered "what is this and what does it cost" and never "is this
// mine, and when would I run it". Across 78 templates that made the shelf a list
// of names nobody could choose between, and it is most of why 234 grants have
// produced one run between them: nothing in the product ever said when to run
// anything, so nothing was ever scheduled.
//
// The absent case is asserted as hard as the present one. A template written
// before 261 genuinely has nobody's word on when to run it, and a label with
// nothing after it reads as an answer.

describe('Skill pack catalog · who it is for and when', () => {
  it('shows the seat and the cadence when the template carries them', async () => {
    await mount({
      packs: [pack({
        used_by: 'Compliance owner',
        when_to_run: 'Monthly, days before filing',
      })],
    });
    expect(text()).toContain('Compliance owner');
    expect(text()).toContain('Monthly, days before filing');
    // Labelled, so the two are not read as one run-on phrase.
    expect(text()).toContain('For');
    expect(text()).toContain('When');
  });

  it('draws nothing at all when the template carries neither', async () => {
    await mount({ packs: [pack()] });
    // Not an empty row, not an em dash, not the labels with blanks after them:
    // the element is absent. `pack()` sets neither field.
    expect(container.querySelector('.mkt-fit')).toBeNull();
  });

  it('draws only the half it has', async () => {
    await mount({ packs: [pack({ used_by: 'Payroll' })] });
    const fit = container.querySelector('.mkt-fit');
    expect(fit).toBeTruthy();
    expect(fit.textContent).toContain('Payroll');
    // Knowing the seat and not the cadence is a real state, and the missing
    // half must not print a "When" with nothing after it.
    expect(fit.textContent).not.toContain('When');
  });

  it('treats an empty string the same as a missing value', async () => {
    // The API normalises blanks to NULL on create, but a template written
    // directly, or one whose text was cleared, can still arrive as ''. A
    // confident nothing is worse than an admitted nothing.
    await mount({ packs: [pack({ used_by: '   ', when_to_run: '' })] });
    expect(container.querySelector('.mkt-fit')).toBeNull();
  });
});
