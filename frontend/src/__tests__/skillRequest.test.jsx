/**
 * The skill detail drawer and the request path — the end of a terminal card.
 *
 * `assign_skill_to_org` is `require_platform_role(*OPERATIONS_CONSOLE_ROLES)`
 * and every one of those roles is platform tier, so no org-tier account can
 * turn a skill on for itself. That is deliberate. What was not deliberate is
 * that the product's whole answer to the customer was the sentence "Assigning a
 * template is an Aekam function. Ask your account contact." and then nothing:
 * no detail, no permissions, and no way to ask. The card was the end of the
 * road, and there was no drawer, modal, dialog or detail route anywhere under
 * `pages/hub/skills/`.
 *
 * What each block below pins, and why it could have gone the other way:
 *
 *   · DORMANCY. `staging.hub_skill_requests` is migration 112 and it is a FILE.
 *     There is one `staging` schema and production writes to it too, so nothing
 *     in application code applies it. The catalogue must still render and the
 *     button must degrade to a plain "not available yet" that stays on screen —
 *     not a 500, and not a toast that vanishes and leaves the control looking
 *     like it might work on the next press.
 *
 *   · THE PERMISSION LIST IS DERIVED, NEVER GUESSED. With no capability list it
 *     says NOT CHECKED. An empty list would read as "this skill touches
 *     nothing", which is the most dangerous sentence this screen could print.
 *
 *   · THE PRICE. Live sum first, stored column only as a labelled fallback,
 *     and "unavailable" when there is neither. A wrong price on a screen
 *     someone buys from is worse than a missing one.
 *
 *   · SKILLS ARE REQUESTED, NOT INSTALLED. There is no self-serve install
 *     control anywhere in the drawer, for anyone.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws — the same
 * constraint `hub/skills/__tests__/catalogTab.test.jsx` records.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import CatalogTab from '../pages/hub/skills/CatalogTab';
import { permissionsFor } from '../components/skills/SkillDrawer';

const COSTS = { social_media: 2, blog: 5, ad_copy: 3, email: 2 };

/** Two AI steps and one data step: 2 + 3 credits of AI, the data step free. */
const STEPS = [
  { order: 1, agent_type: 'social_media', prompt_template: 'Post about {festival_name}.', context: ['receivables'] },
  { order: 2, agent_type: 'ad_copy', prompt_template: 'Offer copy.' },
  { order: 3, skill_function: 'find_overdue_invoices', params: {} },
];

const TEMPLATE = 't1';

const pack = (over = {}) => ({
  id: TEMPLATE,
  name: 'Chase overdue invoices',
  description: 'Finds what is overdue and drafts the chaser.',
  category: 'festival',
  icon: 'calendar',
  estimated_credits: 99,          // deliberately NOT the sum of the steps
  steps: STEPS,
  ...over,
});

const CAPS = {
  skill_functions: [
    { name: 'find_overdue_invoices', available: true, kind: 'read', writes: false, needs: [], runtime_eligible: [] },
    { name: 'generate_due_invoices', available: true, kind: 'act', writes: true, needs: [], runtime_eligible: [] },
  ],
  context_sources: [{ key: 'receivables', label: 'Receivables', kind: 'read' }],
  unimplemented: [],
};

/** `GET /v1/hub/org/skills` — `data` is the grant set, `skill_requests` beside it. */
const ORG_SKILLS = (requests = [], active = []) => ({
  data: active.map(id => ({ id: `os_${id}`, template_id: id })),
  skill_requests: requests,
});

const listState = (items) => ({
  loading: false, error: '', items, data: { data: items }, reload: vi.fn(),
});

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

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/**
 * Both GETs the tab fires, routed by path. `capabilities` and `org/skills` are
 * two different questions and a single `mockResolvedValue` would answer one of
 * them with the other's body.
 */
function wire({ caps = CAPS, org = ORG_SKILLS() } = {}) {
  api.get.mockImplementation(async (path) => {
    if (path.includes('capabilities')) {
      if (caps instanceof Error) throw caps;
      return { data: caps };
    }
    if (path.includes('org/skills')) return { data: org };
    return { data: {} };
  });
}

async function mount({ packs = [pack()], costs = COSTS, canManage = false } = {}) {
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
const btn = (label) =>
  [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const drawer = () => container.querySelector('.mk-dr');

async function openDrawer() {
  await act(async () => { btn('What it needs').click(); });
  await settle();
}


// ── The card is no longer terminal ──────────────────────────────────────────

describe('the way out of a terminal card', () => {
  it('offers an opener on the card and puts a drawer behind it', async () => {
    wire();
    await mount();

    expect(drawer()).toBeNull();
    expect(btn('What it needs')).toBeTruthy();

    await openDrawer();

    expect(drawer()).not.toBeNull();
    expect(drawer().getAttribute('role')).toBe('dialog');
    expect(drawer().getAttribute('aria-label')).toBe('Chase overdue invoices');
  });

  it('closes on Escape, because a drawer with no keyboard exit is a trap', async () => {
    wire();
    await mount();
    await openDrawer();
    expect(drawer()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();

    // NOT GONE YET, and that is the contract. Six overlays in this product
    // shipped with an entrance and no exit — they crossed the screen over
    // 220-360ms and then ceased to exist between two frames. The panel stays
    // mounted carrying `.is-closing` until its exit animation reports finished.
    const panel = drawer();
    expect(panel).not.toBeNull();
    expect(panel.className).toContain('is-closing');
    expect(container.querySelector('.mk-dr__scrim').className).toContain('is-closing');

    // Driven by `animationend`, never by a constant: the CSS duration is
    // `calc(360ms * var(--ix))` and `--ix` is a runtime preference no number in
    // JavaScript could track.
    await act(async () => {
      panel.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    await settle();

    expect(drawer()).toBeNull();
  });

  it('does not carry one skill’s request into the next skill’s drawer', async () => {
    // The drawer holds three pieces of local state — the note being typed, the
    // request it just filed, the 503 it was told — and all three belong to ONE
    // skill. Held across a close and a reopen, the second skill would show as
    // already requested and would open with the first one's note in its box.
    wire();
    api.post.mockResolvedValue({ data: { request_id: 'r1', status: 'open', already_open: false } });
    const two = [pack(), pack({ id: 't2', name: 'Weekly brief' })];
    await mount({ packs: two });

    const openers = [...container.querySelectorAll('.mkt-act__more')];
    await act(async () => { openers[0].click(); });
    await settle();
    await act(async () => { btn('Request this skill').click(); });
    await settle();
    expect(drawer().textContent).toContain('Aekam has it');

    // The requested state has no "Not now" — the footer is the confirmation
    // panel — so out is the header close, which is why it exists in every state.
    await act(async () => { drawer().querySelector('.k-iconbtn').click(); });
    await settle();
    await act(async () => {
      const p = drawer();
      if (p) p.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    await settle();

    await act(async () => { openers[1].click(); });
    await settle();

    expect(drawer().getAttribute('aria-label')).toBe('Weekly brief');
    expect(drawer().textContent).not.toContain('Aekam has it');
    expect(drawer().querySelector('textarea').value).toBe('');
    expect(btn('Request this skill')).toBeTruthy();
  });

  it('offers no install control to anybody — skills are requested, not installed', async () => {
    wire();
    await mount({ canManage: false });
    await openDrawer();

    const labels = [...drawer().querySelectorAll('button')].map(b => b.textContent.toLowerCase());
    expect(labels.some(l => l.includes('install'))).toBe(false);
    expect(labels.some(l => l.includes('enable'))).toBe(false);
    expect(labels.some(l => l.includes('turn on'))).toBe(false);
    expect(labels.some(l => l.includes('request this skill'))).toBe(true);
  });
});


// ── §3 · what it reads and what it changes ──────────────────────────────────

describe('the permission list', () => {
  it('names what each step reads, from the capability list', async () => {
    wire();
    await mount();
    await openDrawer();

    const body = drawer().textContent;
    expect(body).toContain('What it reads');
    // The data step's function, and the grounding the AI step was given.
    expect(body).toContain('find overdue invoices');
    expect(body).toContain('Receivables');
  });

  it('says a read-only skill changes nothing, in those words', async () => {
    wire();
    await mount();
    await openDrawer();

    expect(drawer().textContent).toContain('This skill only reads and reports');
  });

  it('lists a write step under what it CHANGES, not under what it reads', async () => {
    wire();
    await mount({
      packs: [pack({
        steps: [{ skill_function: 'generate_due_invoices', allow_writes: true }],
      })],
    });
    await openDrawer();

    const writeRow = drawer().querySelector('.mk-perm__r--write');
    expect(writeRow).not.toBeNull();
    expect(writeRow.textContent).toContain('generate due invoices');
    expect(drawer().textContent).not.toContain('This skill only reads and reports');
  });

  it('says a write step that did not opt in would be REFUSED rather than listing it as a write that happens', async () => {
    // `skill_dispatcher.py:401` refuses a WRITE_SKILL_FUNCTION whose step has no
    // `allow_writes`. Listing it plainly under "changes" would over-report;
    // dropping it would hide a step that stops the run.
    wire();
    await mount({
      packs: [pack({ steps: [{ skill_function: 'generate_due_invoices' }] })],
    });
    await openDrawer();

    expect(drawer().textContent).toContain('does not allow writes, so a run refuses it');
  });

  it('says NOT CHECKED when the capability list did not load — never an empty list', async () => {
    // An empty permission block reads as "this skill touches nothing", which is
    // a claim. Not knowing is a different fact and has to look different.
    wire({ caps: new Error('the registry is unavailable') });
    await mount();
    await openDrawer();

    const body = drawer().textContent;
    expect(body).toContain('Not checked');
    expect(body).not.toContain('This skill only reads and reports');
    expect(body).toContain('not a claim that it reads nothing');
  });

  it('permissionsFor returns null rather than [] when nothing was checked', async () => {
    expect(permissionsFor(STEPS, null)).toBeNull();
    expect(permissionsFor(STEPS, CAPS)).toHaveLength(3);
  });
});


// ── The price ────────────────────────────────────────────────────────────────

describe('what a run costs', () => {
  it('quotes the live sum of the steps and not the stored estimate', async () => {
    wire();
    await mount();
    await openDrawer();

    // social_media 2 + ad_copy 3; the data step is free.
    expect(drawer().textContent).toContain('5 credits');
    expect(drawer().textContent).not.toContain('99');
    expect(drawer().textContent).toContain('1 data step');
  });

  it('falls back to the stored figure only when the price table did not load, and says so', async () => {
    wire();
    await mount({ costs: null });
    await openDrawer();

    expect(drawer().textContent).toContain('listed at 99 credits');
    expect(drawer().textContent).toContain('figure stored on the template');
  });

  it('says the cost is unavailable rather than inventing one', async () => {
    wire();
    await mount({ costs: null, packs: [pack({ estimated_credits: 0 })] });
    await openDrawer();

    expect(drawer().querySelector('.mk-cost__r--none')).not.toBeNull();
    expect(drawer().textContent).toContain('unavailable');
    expect(drawer().textContent).toContain('nothing here is a price');
  });

  it('shows no setup fee when the template has no setup_fee_paise column yet', async () => {
    // Migration 112 adds `setup_fee_paise INTEGER NOT NULL DEFAULT 0`. Until it
    // is applied the field is simply absent, and no billing path in this
    // product charges a setup fee, so "none" is the true answer either way.
    wire();
    await mount();
    await openDrawer();
    expect(drawer().textContent).toContain('One-off setup');
    expect(drawer().textContent).toContain('none');
  });
});


// ── The request itself ───────────────────────────────────────────────────────

describe('requesting a skill', () => {
  it('posts the note to the request endpoint and switches to the requested state', async () => {
    wire();
    api.post.mockResolvedValue({
      data: {
        request_id: 'r1', template_id: TEMPLATE, status: 'open',
        requested_at: '2026-08-06T10:00:00Z', note: 'We chase 40 invoices by hand.',
        already_open: false,
      },
    });
    await mount();
    await openDrawer();

    const ta = drawer().querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      ).set;
      setter.call(ta, 'We chase 40 invoices by hand.');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { btn('Request this skill').click(); });
    await settle();

    expect(api.post).toHaveBeenCalledWith(
      `/v1/hub/skills/${TEMPLATE}/request`,
      { note: 'We chase 40 invoices by hand.' },
    );
    expect(drawer().textContent).toContain('Aekam has it');
    expect(drawer().textContent).toContain('6 Aug 2026');
    expect(btn('Request this skill')).toBeUndefined();
  });

  it('never sends an org or a user in the body — the server takes both from the session', async () => {
    wire();
    api.post.mockResolvedValue({ data: { request_id: 'r1', status: 'open', already_open: false } });
    await mount();
    await openDrawer();
    await act(async () => { btn('Request this skill').click(); });
    await settle();

    const body = api.post.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(['note']);
  });

  it('re-reads the request state from the server rather than trusting the screen', async () => {
    // The open request is a server fact. Patching it into local state would
    // make the screen and the database disagree the moment anything else
    // touched the row.
    wire();
    api.post.mockResolvedValue({ data: { request_id: 'r1', status: 'open', already_open: false } });
    await mount();
    await openDrawer();
    api.get.mockClear();
    await act(async () => { btn('Request this skill').click(); });
    await settle();

    expect(api.get.mock.calls.some(c => String(c[0]).includes('org/skills'))).toBe(true);
  });

  it('shows a skill already requested as Requested, on the card and in the drawer', async () => {
    wire({
      org: ORG_SKILLS([{
        request_id: 'r1', template_id: TEMPLATE, status: 'open',
        requested_at: '2026-08-06T10:00:00Z', note: 'earlier',
      }]),
    });
    await mount();

    expect(container.querySelector('.mk-st--requested')).not.toBeNull();

    await openDrawer();
    expect(drawer().textContent).toContain('Aekam has it');
    expect(btn('Request this skill')).toBeUndefined();
  });

  it('shows a skill the org already has as Active, and does not offer to request it again', async () => {
    wire({ org: ORG_SKILLS([], [TEMPLATE]) });
    await mount();

    expect(container.querySelector('.mk-st--active')).not.toBeNull();

    await openDrawer();
    expect(drawer().textContent).toContain('already switched on for your organisation');
    expect(btn('Request this skill')).toBeUndefined();
  });

  it('does not offer to request a skill this server cannot run', async () => {
    // Filing a lead for something with no implementation behind it wastes the
    // customer's ask and the account contact's time, and the answer is already
    // known.
    wire({
      caps: { ...CAPS, skill_functions: [], unimplemented: ['find_overdue_invoices'] },
    });
    await mount();
    await openDrawer();

    expect(btn('Request this skill')).toBeUndefined();
    expect(drawer().textContent).toContain('Asking for it would not change that');
  });
});


// ── Dormancy: migration 112 is a file, not a table ──────────────────────────

describe('with the request table not yet created', () => {
  const dormancy = {
    response: {
      status: 503,
      data: {
        detail: 'Skill requests are not available on this environment yet — the '
          + 'hub_skill_requests table (migration 112) has not been created. Your '
          + 'request was NOT recorded. Ask your account contact directly.',
      },
    },
  };

  it('still renders the catalogue and still opens the drawer', async () => {
    wire({ org: ORG_SKILLS([]) });
    await mount();

    expect(text()).toContain('Chase overdue invoices');
    await openDrawer();
    expect(drawer()).not.toBeNull();
  });

  it('degrades to a clear "not available yet" that STAYS on screen', async () => {
    wire();
    api.post.mockRejectedValue(dormancy);
    await mount();
    await openDrawer();
    await act(async () => { btn('Request this skill').click(); });
    await settle();

    // The server's own sentence, in the panel — not a toast that vanishes and
    // leaves the button looking like it might work next time.
    const off = drawer().querySelector('.mk-req__off');
    expect(off).not.toBeNull();
    expect(off.textContent).toContain('was NOT recorded');
    expect(off.textContent).toContain('112');

    const control = btn('Not available yet');
    expect(control).toBeTruthy();
    expect(control.disabled).toBe(true);
  });

  it('does not claim the request went through', async () => {
    wire();
    api.post.mockRejectedValue(dormancy);
    await mount();
    await openDrawer();
    await act(async () => { btn('Request this skill').click(); });
    await settle();

    expect(drawer().textContent).not.toContain('Aekam has it');
    expect(container.querySelector('.mk-st--requested')).toBeNull();
  });

  it('shows an ordinary failure differently from the dormant one, and lets you try again', async () => {
    wire();
    api.post.mockRejectedValue({ response: { status: 500, data: {} } });
    await mount();
    await openDrawer();
    await act(async () => { btn('Request this skill').click(); });
    await settle();

    expect(drawer().querySelector('.mk-req__off').textContent)
      .toContain('The server failed on this request');
    // Still pressable: a 500 is transient in a way a missing table is not.
    expect(btn('Request this skill').disabled).toBe(false);
  });

  it('renders the catalogue when the org fetch itself fails, without a Requested pill', async () => {
    api.get.mockImplementation(async (path) => {
      if (path.includes('capabilities')) return { data: CAPS };
      throw new Error('org skills unavailable');
    });
    await mount();

    expect(text()).toContain('Chase overdue invoices');
    expect(container.querySelector('.mk-st--requested')).toBeNull();
    expect(container.querySelector('.mk-st--active')).toBeNull();
  });
});
