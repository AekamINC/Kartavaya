/**
 * The corner dock — the contracts that are worth a check rather than a sweep.
 *
 * Six of these exist because the rule they hold is one this product has
 * already broken once somewhere else:
 *
 *  · ORDERING is `check → brief → pack → content` and comes from the file
 *    CatalogTab reads. A second ordering invented here is how two catalogs
 *    came to quote 5 and 99 credits for one template.
 *  · A PRICE IS NEVER DEFAULTED. Migration 166 fixed thirteen cards that read
 *    "0 credits" and charged 2. `runCost` must say "not stated" rather than
 *    guess, and must only say "free" where it can prove it.
 *  · A PACK MUST NOT READ AS THOUGH IT SENDS. Proposal 71's fourth rule names
 *    the collection pack specifically.
 *  · NO ID IS EVER DRAWN. `check-rendered-ids.mjs` is positional and cannot see
 *    a loop over the keys of a JSON blob, so the run-result summariser is
 *    tested directly against both halves of the rule.
 *  · NOTHING IS PERSISTED. The count on the pill was accepted on the condition
 *    that no seen/unseen state exists anywhere, so the test watches
 *    `localStorage.setItem` while the dock opens, navigates and runs.
 *  · THE COUNT RECONCILES. Whatever the pill says, the four tab counts must
 *    add up to it — a number nobody can check is a number nobody should trust.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => (Array.isArray(r?.data) ? r.data : (r?.data?.data ?? [])),
}));
vi.mock('../../../lib/auth', () => ({ currentUser: () => ({ user_id: 'u1' }) }));

import { api } from '../../../lib/api';
import { pageModules, matchesPage, DUE_SOURCE } from '../../../lib/routeModules';
import {
  runCost, costLabel, runIntent, summariseOutput, skillsForPage,
  metricsForPage, automationsForPage, dockCount, buildLists, moduleGate,
} from '../dock/dockItems';
import SkillDock from '../SkillDock';
import { __resetDockCache } from '../dock/useDockData';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const dataStep = (fn) => ({ skill_function: fn, params: {} });
const aiStep = (agent = 'blog') => ({ agent_type: agent, prompt_template: 'x' });

const tpl = (over = {}) => ({
  id: over.id || 't1', name: 'A skill', module: 'ganit', skill_type: 'check',
  description: '', icon: 'star', estimated_credits: 0,
  steps: [dataStep('find_overdue_invoices')], ...over,
});

/* ── the map ─────────────────────────────────────────────────────────────── */

describe('routeModules', () => {
  it('resolves core PM routes, which navConfig.ROUTE_META cannot', () => {
    // `/tasks` carries no `module` in navConfig — core PM is not a gated
    // module — and kartavya has skills of its own. This is the half of the
    // problem the existing route map does not solve.
    expect(pageModules('/tasks').skills).toContain('kartavya');
    expect(pageModules('/tasks').metrics).toContain('core');
  });

  it('takes the LONGEST prefix, not the first', () => {
    // `/hub` and `/hub/org` both match. Order-independence is the whole point:
    // resolving `/hub/org` to `/hub` is the bug navConfig fixed in the topbar.
    expect(pageModules('/hub/org').label).toBe('Sahayak');
    expect(pageModules('/hub').label).toBe('Sahayak Admin');
    expect(pageModules('/hub/clients/anything').label).toBe('Sahayak Clients');
  });

  it('gives an unknown page an honest empty page rather than a guess', () => {
    const p = pageModules('/some/route/nobody/mapped');
    expect(p.skills).toEqual([]);
    expect(p.metrics).toEqual([]);
    expect(p.label).toBe('This page');
  });

  it('puts srijan on Sahayak — one page, two skill modules', () => {
    // `srijan` owns the six content packs and has no route of its own. One
    // value per page would hide all six.
    expect(pageModules('/hub/org').skills).toEqual(
      expect.arrayContaining(['sahayak', 'srijan']));
  });

  it('claims every niyam family that the registry can emit', () => {
    // Verbatim from `EVENT_META` in backend/services/niyam/registry.py. A
    // family nobody claims is a set of automations no page can ever show, and
    // the four-section dock's promise is that the empty tab is never the same
    // tab twice.
    const FAMILIES = ['task', 'approval', 'invoice', 'crm', 'sales', 'hr',
                      'analytics', 'esign', 'payroll', 'marketing', 'whatsapp'];
    const claimed = new Set();
    for (const path of ['/dashboard', '/tasks', '/approvals', '/ganit', '/graha',
                        '/vikray', '/manav', '/vetana', '/prachar', '/esign',
                        '/sanvaad', '/dristi', '/reports']) {
      for (const f of pageModules(path).families) claimed.add(f);
    }
    expect([...FAMILIES].filter(f => !claimed.has(f))).toEqual([]);
  });

  it('shows an attendance correction on Attendance as well as HR', () => {
    // The registry files it under family `hr`. It is true on both pages, and
    // picking one would be a lie on the other.
    const row = { family: 'hr', event_type: 'correction.requested' };
    expect(matchesPage(pageModules('/manav'), row)).toBe(true);
    expect(matchesPage(pageModules('/pahchan'), row)).toBe(true);
    expect(matchesPage(pageModules('/ganit'), row)).toBe(false);
  });

  it('has no statute source, and says so rather than guessing a due date', () => {
    // `staging.statute_calendar` is read by services/statute.py and by nothing
    // else; no router serves it. A due date computed in the browser would be
    // a date read without its effective window, which is how you print last
    // year's rule.
    expect(DUE_SOURCE).toBeNull();
  });
});

/* ── price, order, intent ────────────────────────────────────────────────── */

describe('what a run costs, and what it does', () => {
  it('calls a data-only skill free, because it can prove it', () => {
    const c = runCost({ estimated_credits: 0 }, [dataStep('find_overdue_invoices')]);
    expect(c).toEqual({ credits: 0, kind: 'free' });
    expect(costLabel(c)).toBe('0 credits');
  });

  it('refuses to call an AI skill free just because the column says 0', () => {
    // THE MIGRATION-166 BUG, as a test. Thirteen cards read "0 credits" and
    // charged 2. A stored zero means nobody set a price, not that it is free.
    const c = runCost({ estimated_credits: 0 }, [aiStep()]);
    expect(c.kind).toBe('unknown');
    expect(costLabel(c)).toBe('cost not stated');
  });

  it('shows the stored figure unrounded', () => {
    expect(costLabel(runCost({ estimated_credits: 7 }, [aiStep()]))).toBe('7 credits');
    expect(costLabel(runCost({ estimated_credits: 1 }, [aiStep()]))).toBe('1 credit');
  });

  it('never lets a pack read as though it will send', () => {
    const caps = { skill_functions: [{ name: 'draft_chase', writes: false }] };
    expect(runIntent('pack', [dataStep('draft_chase')], caps))
      .toBe('drafts, sends nothing');
  });

  it('says CHANGES DATA when the capability list says a step writes', () => {
    // A `brief` whose handler is in WRITE_SKILL_FUNCTIONS really does change
    // records, and being filed under `brief` does not make it read-only.
    const caps = { skill_functions: [{ name: 'raise_invoice', writes: true }] };
    expect(runIntent('brief', [dataStep('raise_invoice')], caps))
      .toMatch(/CHANGES DATA/);
  });

  it('says the effect was not checked when the capability list is missing', () => {
    // An empty list reads as "it touches nothing", which is the most dangerous
    // thing this surface could say — SkillDrawer's header makes the same point.
    expect(runIntent('check', [dataStep('x')], null)).toMatch(/not checked/);
  });

  it('orders check → brief → pack → content, not alphabetically', () => {
    const page = pageModules('/ganit');
    const templates = [
      tpl({ id: 'a', name: 'Zebra', skill_type: 'check' }),
      tpl({ id: 'b', name: 'Alpha', skill_type: 'content', steps: [aiStep()] }),
      tpl({ id: 'c', name: 'Mango', skill_type: 'brief' }),
      tpl({ id: 'd', name: 'Apple', skill_type: 'pack' }),
    ];
    const out = skillsForPage(page, { orgSkills: [], templates, caps: null }, {});
    expect(out.map(s => s.name)).toEqual(['Zebra', 'Mango', 'Apple', 'Alpha']);
  });

  it('joins module and skill_type off the template when the org row lacks them', () => {
    // `/v1/hub/org/skills` does not select `t.module`/`t.skill_type` today.
    // The dock joins by template_id so it works before and after that change.
    const page = pageModules('/ganit');
    const templates = [tpl({ id: 'T', module: 'ganit', skill_type: 'brief' })];
    const orgSkills = [{ id: 'O', template_id: 'T', template_name: 'Live one',
                         steps: [dataStep('x')], estimated_credits: 0 }];
    const out = skillsForPage(page, { orgSkills, templates, caps: null }, {});
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Live one');
    expect(out[0].active).toBe(true);
    // The RUN id is the org-skill id. Posting a template id 404s.
    expect(out[0].runId).toBe('O');
  });

  it('leaves every skill runnable for a caller the server has no opinion about', () => {
    // `module_levels` absent is org_owner / org_admin / platform staff. Reading
    // it as "holds nothing" would grey the whole dock out for administrators.
    expect(moduleGate(['ganit', 'graha'], {})).toEqual([]);
    expect(moduleGate(['ganit', 'graha'], { module_levels: { ganit: 'viewer' } }))
      .toEqual(['graha']);
  });
});

/* ── the run result ──────────────────────────────────────────────────────── */

describe('a finished run says what it found, and never an id', () => {
  it('drops a UUID value even under an innocent key', () => {
    const s = summariseOutput({
      label: 'Duplicate vendor bills',
      data: { client: '8f3c1d2e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', pairs: 4 },
    });
    const text = JSON.stringify(s.lines);
    expect(text).not.toMatch(UUID);
    expect(s.lines).toContainEqual(['Pairs', '4']);
  });

  it('drops an id-shaped key even when its value looks harmless', () => {
    const s = summariseOutput({ data: { invoice_id: 'INV-4102', total: 48000 } });
    expect(s.lines.map(l => l[0])).not.toContain('Invoice id');
    expect(s.lines).toContainEqual(['Total', '48000']);
  });

  it('reduces an array to a count rather than spilling rows into the corner', () => {
    const s = summariseOutput({ data: [1, 2, 3] });
    expect(s.lines).toEqual([['Rows', '3']]);
  });

  it('carries the server\'s own truncation flag', () => {
    expect(summariseOutput({ data: null, truncated: true }).truncated).toBe(true);
  });
});

/* ── the count ───────────────────────────────────────────────────────────── */

describe('the count on the pill', () => {
  const DATA = {
    orgSkills: [],
    templates: [tpl({ id: 'a' }), tpl({ id: 'b', name: 'B' })],
    caps: null,
    metrics: [
      { key: 'ganit.dso', module: 'ganit', label: 'DSO', unit: 'days', grain: 'flow' },
      { key: 'ganit.outstanding', module: 'ganit', label: 'Outstanding', unit: 'inr', grain: 'stock' },
    ],
    rules: [{ rule_id: 'r1', name: 'Chase', event_type: 'invoice.overdue',
              family: 'invoice', effective_mode: 'idle' }],
    ruleTemplates: [{ id: 'n1', name: 'Weekly reminder', event_type: 'invoice.overdue',
                      family: 'invoice' }],
  };

  it('is the sum of the four tabs, so the user can check it', () => {
    const page = pageModules('/ganit');
    const lists = buildLists(page, DATA, {});
    expect(lists.skills).toHaveLength(2);
    expect(lists.metrics).toHaveLength(2);
    expect(lists.automations).toHaveLength(2);
    expect(dockCount(lists)).toBe(
      lists.skills.length + lists.metrics.length
      + lists.automations.length + lists.due.length);
    expect(dockCount(lists)).toBe(6);
  });

  it('keeps a declared-absent metric, with its reason, never as a zero', () => {
    const out = metricsForPage(pageModules('/ganit'), [
      { key: 'ganit.tds', module: 'ganit', label: 'TDS', unit: 'inr',
        grain: 'stock', absent: 'the table holds 0 rows' },
    ]);
    expect(out[0].absent).toBe('the table holds 0 rows');
  });

  it('lists live rules before starter templates', () => {
    const out = automationsForPage(pageModules('/ganit'), DATA);
    expect(out[0].live).toBe(true);
    expect(out[1].live).toBe(false);
  });
});

/* ── the component ───────────────────────────────────────────────────────── */

function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SkillDock />
    </MemoryRouter>,
  );
}

/** Everything the dock reads, answered. */
function serve({ templates = [], orgSkills = [], metrics = [], rules = [],
                 ruleTemplates = [], niyam403 = false } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/v1/hub/org/skills') return Promise.resolve({ data: { data: orgSkills } });
    if (path === '/v1/hub/skills/templates') return Promise.resolve({ data: templates });
    if (path === '/v1/hub/skills/capabilities') {
      return Promise.resolve({ data: { skill_functions: [], unimplemented: [] } });
    }
    if (path === '/v1/analytics/catalogue') return Promise.resolve({ data: { metrics } });
    if (path.startsWith('/v1/niyam/')) {
      if (niyam403) return Promise.reject({ response: { status: 403 } });
      return Promise.resolve({ data: { rules, templates: ruleTemplates } });
    }
    return Promise.reject(new Error(`unstubbed ${path}`));
  });
}

describe('SkillDock', () => {
  let setItem;

  beforeEach(() => {
    __resetDockCache();
    api.get.mockReset();
    api.post.mockReset();
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => { setItem.mockRestore(); });

  it('renders on a page with nothing applicable, and says so', async () => {
    // A settings page. The dock does NOT hide — the empty state is the signal
    // proposal 71 calls the most valuable thing here.
    serve({});
    mount('/settings/categories');
    fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
    expect(await screen.findByText(/No skill on the shelf touches this page yet/i))
      .toBeTruthy();
  });

  it('never writes anything to storage — no seen, no unread, no dismissed', async () => {
    serve({ templates: [tpl({ id: 'a' })] });
    mount('/ganit');
    fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
    await screen.findByText('A skill');
    fireEvent.click(screen.getByRole('tab', { name: /Numbers/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Due/ }));
    // The one condition the count was accepted on.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('shows a count that equals the four tab counts', async () => {
    serve({
      templates: [tpl({ id: 'a' }), tpl({ id: 'b', name: 'B' })],
      metrics: [{ key: 'ganit.outstanding', module: 'ganit', label: 'Outstanding',
                  unit: 'inr', grain: 'stock' }],
    });
    mount('/ganit');
    const pill = screen.getByRole('button', { name: /quick actions/i });
    fireEvent.click(pill);
    await screen.findByText('A skill');
    const tabTotals = screen.getAllByRole('tab')
      .map(t => Number(t.textContent.replace(/\D+/g, '')));
    const sum = tabTotals.reduce((a, b) => a + b, 0);
    expect(sum).toBe(3);
    // The pill's own number, read back off the pill.
    expect(Number(pill.textContent.replace(/\D+/g, ''))).toBe(sum);
  });

  it('says a refusal is a refusal, not an empty list', async () => {
    // `/v1/niyam/rules` is require_org_role. An ordinary member is refused,
    // and "you have no automations" is a different and false sentence.
    serve({ niyam403: true });
    mount('/ganit');
    fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /Automate/ }));
    expect(await screen.findByText(/not yours to see/i)).toBeTruthy();
  });

  it('offers no verb on a skill the organisation does not have, and says why',
    async () => {
      serve({ templates: [tpl({ id: 'a' })] });      // catalogue only, no grant
      mount('/ganit');
      fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
      await screen.findByText('A skill');
      expect(screen.getByText(/Aekam turns this on/i)).toBeTruthy();
      // No Run chip anywhere — the row cannot 403 because it offers nothing.
      expect(screen.queryByText('Run')).toBeNull();
    });

  it('has something true to say on eSign, where the skill shelf is empty',
    async () => {
      // THE FOUR-SECTION ARGUMENT, AS A CHECK. Skills reach ten module codes
      // and esign is not one of them; automations reach eleven and it IS.
      // A skills-only dock is dead on this page. This one is not, and the
      // Skills tab still says the true thing rather than falling back to
      // "here are some popular skills" — the small lie proposal 71 rules out.
      serve({
        templates: [tpl({ id: 'a', module: 'ganit' })],   // nothing for esign
        rules: [],
        ruleTemplates: [
          { id: 'n1', name: 'Tell the admins when everyone has signed',
            event_type: 'document.signed', family: 'esign' },
          { id: 'n2', name: 'Chase signatures before the request lapses',
            event_type: 'document.expiring', family: 'esign' },
        ],
        metrics: [{ key: 'esign.signed_rate', module: 'esign', label: 'Signed %',
                    unit: 'pct', grain: 'flow' }],
      });
      mount('/esign');
      fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
      expect(await screen.findByText(/No skill on the shelf touches this page yet/i))
        .toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: /Automate/ }));
      expect(await screen.findByText(/Chase signatures before the request lapses/))
        .toBeTruthy();
    });

  it('says the statute calendar is not served rather than inventing a due date',
    async () => {
      // A date read without its effective window prints last year's rule, and
      // no route serves `staging.statute_calendar` to the browser at all.
      serve({});
      mount('/ganit');
      fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
      fireEvent.click(await screen.findByRole('tab', { name: /Due/ }));
      expect(await screen.findByText(/statute calendar is not served/i)).toBeTruthy();
    });

  it('closes on Escape and hands focus back to the pill', async () => {
    serve({});
    mount('/ganit');
    const pill = screen.getByRole('button', { name: /quick actions/i });
    fireEvent.click(pill);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(pill));
  });

  it('is one dock, not one per page — the tab strip exists exactly once', async () => {
    serve({});
    mount('/ganit');
    fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
    await screen.findByRole('dialog');
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('refetches when it is opened, so the list is the one it just asked for',
    async () => {
      serve({ templates: [tpl({ id: 'a' })] });
      mount('/ganit');
      const pill = screen.getByRole('button', { name: /quick actions/i });
      fireEvent.click(pill);
      await screen.findByText('A skill');
      const first = api.get.mock.calls.length;
      fireEvent.click(pill);                       // close
      fireEvent.click(pill);                       // open again
      await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(first));
    });
});
