/**
 * Sahayak → Skills. The four sentences this screen used to get wrong.
 *
 * Every assertion here is on a CLAIM the page makes to a paying customer, not
 * on markup. The four:
 *
 *   1. "0 items are waiting in the Content tab" — said after every run of every
 *      one of the fifty-nine function-only skills, where the count is zero by
 *      construction and there is no content tab entry to wait for. It read as a
 *      failure of a run that had succeeded.
 *   2. "Cost table unavailable" — printed on a skill that is FREE, because the
 *      stored `estimated_credits` of 0 is falsy and the fallback answers null
 *      while the price table is in flight.
 *   3. A free-text box asking a human to type a contact's UUID.
 *   4. Sixty-one cards in one flat grid with no search and no grouping.
 *
 * `createRoot` + `act` rather than @testing-library/react — see the note in
 * `sahayak.test.jsx`; its @testing-library/dom peer is not installed.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let posted = [];
let handlers = {};

/** Routed most-specific-first — see the note in sahayak.test.jsx. */
function route(url) {
  const u = String(url);
  if (u.includes('/skills/capabilities')) return handlers.caps;
  if (u.includes('/skills/templates')) return handlers.templates;
  if (u.includes('/org/skills')) return handlers.mine;
  if (u.includes('/graha/contacts')) return handlers.contacts;
  return {};
}

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual('../../../lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(url => Promise.resolve({ data: route(url) ?? {} })),
      post: vi.fn((url, body) => {
        posted.push([String(url), body]);
        return Promise.resolve({ data: handlers.run ?? {} });
      }),
      put: vi.fn(() => Promise.resolve({ data: {} })),
      patch: vi.fn(() => Promise.resolve({ data: {} })),
      delete: vi.fn(() => Promise.resolve({ data: {} })),
    },
  };
});

vi.mock('../../../components/ui/toast', () => ({
  useToast: () => ({ pushToast: () => {} }),
}));

vi.mock('../../../hooks/useModuleWrite', () => ({
  default: () => ({ canWrite: true, reason: '' }),
}));

const SkillsTab = (await import('../SkillsTab')).default;

const checkStep = (fn, runtime = []) => ({
  order: 1, skill_function: fn, ...(runtime.length ? { runtime_params: runtime } : {}),
});

const orgSkill = (over = {}) => ({
  id: 'os-1',
  template_id: 't-1',
  template_name: 'GSTR-1 readiness',
  template_description: 'Which invoices cannot be filed, and why.',
  category: 'compliance',
  module: 'ganit',
  skill_type: 'check',
  icon: 'search',
  estimated_credits: 0,
  steps: [checkStep('check_gstr1_readiness')],
  ...over,
});

let host;
let root;

beforeEach(() => {
  posted = [];
  handlers = {
    mine: { data: [orgSkill()], skill_requests: [] },
    templates: { data: [] },
    caps: {
      skill_functions: [{ name: 'check_gstr1_readiness', available: true, kind: 'read', writes: false }],
      context_sources: [],
      unimplemented: [],
    },
    contacts: { data: [{ id: 'c-1', name: 'Rakesh Shah' }] },
    run: {},
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

/** Mount and let every fetch settle. */
async function mount(props = {}) {
  await act(async () => {
    root.render(<SkillsTab canAssign={false} costs={null} onSpent={() => {}} {...props} />);
  });
  return host;
}

const byText = (el, sel, text) =>
  [...el.querySelectorAll(sel)].find(n => n.textContent.trim() === text);

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/* ── 2. The cost line ───────────────────────────────────────────────────── */

describe('what a free skill costs', () => {
  it('says it is free, with no price table loaded at all', async () => {
    // `costs` null is the real state for the whole time /org/credits is in
    // flight, and fifty-nine skills are all-data-step. The old line read
    // "Cost table unavailable" for every one of them, on a shelf where the
    // customer's question is exactly whether it will cost anything.
    const el = await mount({ costs: null });
    await click(byText(el, 'button', 'Run'));
    const foot = el.querySelector('.hb-form__foot .hb-cap');
    expect(foot.textContent).toContain('Free');
    expect(foot.textContent).not.toContain('unavailable');
  });

  it('prices images as their own number, not as "more with images"', async () => {
    // Images are a SECOND charge on the same step and were never inside the
    // step sum. ", more with images" is a warning with no number on the one
    // screen where the number is the question.
    handlers.mine = {
      data: [orgSkill({ steps: [{ order: 1, agent_type: 'blog', prompt_template: 'x' }] })],
      skill_requests: [],
    };
    const el = await mount({ costs: { blog: 8, image: 3 } });
    await click(byText(el, 'button', 'Run'));
    await act(async () => {
      el.querySelector('.sk-check input').click();
    });
    expect(el.querySelector('.hb-form__foot .hb-cap').textContent)
      .toContain('plus 3 credits for 1 image');
  });
});

/* ── 1. The result sentence ─────────────────────────────────────────────── */

describe('what the page says after a run', () => {
  it('never claims 0 items are waiting for a skill that makes none', async () => {
    handlers.run = {
      run_id: 'r1', status: 'completed', steps_completed: 1, credits_used: 0,
      content_ids: [],
      outputs: [{
        step: 1, skill_function: 'check_gstr1_readiness', status: 'ok', credits_used: 0,
        data: {
          period: '2026-07',
          invoices: [{ invoice_number: 'INV-9', defect: 'place of supply missing' }],
          caveat: 'Only the first 200 invoices in the period were examined.',
        },
      }],
    };
    const el = await mount({ costs: {} });
    await click(byText(el, 'button', 'Run'));
    await act(async () => {
      el.querySelector('form.sk-run').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    const done = el.querySelector('.sr-done');
    expect(done.textContent).not.toContain('items are waiting');
    expect(done.textContent).toContain('creates no content items');
    // And the finding it actually made is on the screen, caveat included.
    expect(done.textContent).toContain('INV-9');
    expect(done.textContent).toContain('Only the first 200 invoices');
  });

  it('says the server reported nothing rather than that nothing was found', async () => {
    // A deploy whose run response has no `outputs`. The distinction is the
    // whole point: one of these sentences is about the firm's records and the
    // other is about ours.
    handlers.run = {
      run_id: 'r1', status: 'completed', steps_completed: 1, credits_used: 0, content_ids: [],
    };
    const el = await mount({ costs: {} });
    await click(byText(el, 'button', 'Run'));
    await act(async () => {
      el.querySelector('form.sk-run').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(el.querySelector('.sr-done').textContent)
      .toContain('did not report what each step read');
  });
});

/* ── 3. The contact box ─────────────────────────────────────────────────── */

describe('a skill that needs a contact', () => {
  beforeEach(() => {
    handlers.mine = {
      data: [orgSkill({
        template_name: 'Account brief',
        steps: [checkStep('get_account_brief', ['contact_id'])],
      })],
      skill_requests: [],
    };
    // The handler has to be IN the capability list or `blockersFor` holds the
    // pack back first and this test would assert the wrong sentence — which is
    // exactly what it did on its first run.
    handlers.caps.skill_functions.push({
      name: 'get_account_brief', available: true, kind: 'read', writes: false,
    });
  });

  it('offers names to choose from and never a box to type an id into', async () => {
    const el = await mount({ costs: {} });
    await click(byText(el, 'button', 'Run'));

    const picker = el.querySelector('#run-contact_id');
    expect(picker.tagName).toBe('SELECT');
    expect(picker.textContent).toContain('Rakesh Shah');
    // The id is the option's VALUE — an attribute, never a rendered position.
    expect([...picker.options].some(o => o.textContent.includes('c-1'))).toBe(false);
    // And no text input survived anywhere in the form for it.
    expect(el.querySelector('input#run-contact_id')).toBeNull();
  });

  it('greys Run out with a reason rather than letting it fail', async () => {
    const el = await mount({ costs: {} });
    await click(byText(el, 'button', 'Run'));
    const go = el.querySelector('button[type="submit"]');
    expect(go.title).toBe('Choose a contact first.');
  });

  it('does not fetch the contact list until a skill that needs one is opened', async () => {
    // The org may not carry Graha at all. Firing this on mount would 403 on
    // every visit to a tab that is mostly not about contacts.
    const { api } = await import('../../../lib/api');
    await mount({ costs: {} });
    expect(api.get.mock.calls.some(([u]) => String(u).includes('/graha/contacts'))).toBe(false);
  });
});

/* ── 4. The shelf ──────────────────────────────────────────────────────── */

describe('the shelf', () => {
  beforeEach(() => {
    handlers.mine = {
      data: [
        orgSkill({ id: 'a', template_id: 'ta', template_name: 'Payroll readiness', module: 'vetana', skill_type: 'check' }),
        orgSkill({ id: 'b', template_id: 'tb', template_name: 'Festival calendar', module: 'ganit', skill_type: 'content' }),
        orgSkill({ id: 'c', template_id: 'tc', template_name: 'GST cliffs', module: 'ganit', skill_type: 'check' }),
      ],
      skill_requests: [],
    };
  });

  it('groups by module and orders checks above content inside one', async () => {
    const el = await mount({ costs: {} });
    const headings = [...el.querySelectorAll('.sk-shelf__t')].map(h => h.textContent);
    expect(headings.length).toBe(2);
    // Ganit before Vetana: the ORG_MODULES order, not alphabetical.
    expect(headings[0]).toContain('Ganit');
    expect(headings[1]).toContain('Vetana');

    const ganit = el.querySelectorAll('.sk-shelf')[0];
    const names = [...ganit.querySelectorAll('.sk-card__t')].map(n => n.textContent);
    // check before content — SKILL_TYPES order, which also puts every free
    // skill above every priced one.
    expect(names).toEqual(['GST cliffs', 'Festival calendar']);
  });

  it('searches by the records a step reads, not only by the title', async () => {
    const el = await mount({ costs: {} });
    const box = el.querySelector('.sk-shelf__q input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(box, 'gstr1');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Every card's step is `check_gstr1_readiness`; none of the three titles
    // contains "gstr1". A search that only reads titles finds nothing here.
    expect(el.querySelectorAll('.sk-card__t').length).toBe(3);
  });
});
