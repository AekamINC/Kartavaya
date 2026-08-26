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
 *  · A DUE DATE IS READ, NEVER COMPUTED, and an obligation with no recorded
 *    due day is listed WITHOUT one rather than dropped or guessed. The
 *    `authority` values are the live column's own spelling, because the one
 *    that was tidied — `incometax` for `income_tax` — dropped 22 of the 45
 *    rows off the Finance page and nothing errored.
 *
 * TWO CASES WERE DELETED FROM THIS FILE, NOT SKIPPED. Both asserted that the
 * statute calendar was unreachable, which was true when they were written and
 * is no longer. Each is replaced in place by the forward-facing rule it was
 * standing in for, and the deletion is written up where it happened.
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
import {
  pageModules, matchesPage, DUE_SOURCE, DUE_AUTHORITIES,
} from '../../../lib/routeModules';
import {
  runCost, costLabel, runIntent, summariseOutput, skillsForPage,
  metricsForPage, automationsForPage, dockCount, buildLists, moduleGate,
  dueForPage,
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

/* ── the statute fixtures ─────────────────────────────────────────────────
   NOT INVENTED. Every field below is a live row of `staging.statute_calendar`
   as `/v1/statute/due` projects it, read read-only on 2026-08-26:

     income_tax  22 rows      gst  18      esic  4      epfo  1

   Coupling the fixture to the real rows is the same discipline
   `backend/tests/test_statute.py` uses when it parses migration 158 rather
   than hand-writing a seed: a fixture written to agree with the renderer
   passes green while the wire shape drifts underneath it. */
const AS_OF = '2026-08-26';

/** GSTR-3B: monthly, day 20 of the following month. A real deadline. */
const GSTR3B = {
  key: 'gst.return.gstr3b', title: 'GSTR-3B — summary return and payment',
  authority: 'gst', cadence: 'monthly', due_on: '2026-09-20', days_away: 25,
  as_of: AS_OF, basis: 'for August 2026 — day 20 of the following month',
  form_number: null, notes: '', state_code: null,
};

/** PF: monthly, day 15 of the following month. Payroll's, not Finance's. */
const EPF = {
  key: 'epf.remittance', title: 'Provident fund contribution and ECR',
  authority: 'epfo', cadence: 'monthly', due_on: '2026-09-15', days_away: 20,
  as_of: AS_OF, basis: 'for August 2026 — day 15 of the following month',
  form_number: null, notes: '', state_code: null,
};

/** One of the 22. In force, real, and with NO due day recorded — the Q4
    statement falls on 31 May where the others fall on the 31st of the month
    after the quarter, so migration 158 seeded `due_day` NULL rather than a
    rule that is wrong four times a year. */
const TDS_SALARY = {
  key: 'tds.statement.salary', title: 'TDS statement — salary',
  authority: 'income_tax', cadence: 'quarterly', due_on: null, days_away: null,
  as_of: AS_OF, basis: 'the calendar records no due day for this obligation',
  form_number: '138', notes: '', state_code: null,
};

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

  /* WHAT USED TO BE HERE, and why it is gone rather than skipped.

     A case called `has no statute source, and says so rather than guessing a
     due date` asserted `expect(DUE_SOURCE).toBeNull()`. It was true when it
     was written — no router served `staging.statute_calendar` — but it was
     written as an assertion about the DESIGN rather than about the state, and
     so it survived into a test that could only ever fail on the day somebody
     fixed the thing it was describing. Phase 4.5 calls that "a test pinning
     the dead state shut". It is deleted, not skipped: a skipped test is the
     same claim with the alarm switched off.

     What replaces it is the same rule stated forwards — the browser still
     computes no date; it reads one from a route that resolves the effective
     window first. */
  it('reads due dates from a route, and names the four authorities exactly',
    () => {
      expect(DUE_SOURCE).toBe('/v1/statute/due');
      // THE ONE-TOKEN BUG, AS A CHECK. `/ganit` asked for `incometax` and the
      // column has only ever held `income_tax`: 22 of the 45 live rows are
      // income-tax rows and every one was dropped by the missing underscore,
      // silently, because a filter matching nothing looks like a page with
      // nothing on it. `routers/statute.py` allowlists the same four values
      // and 422s anything else, so the spelling is now load-bearing twice.
      expect(DUE_AUTHORITIES).toEqual(['gst', 'income_tax', 'epfo', 'esic']);
      expect(pageModules('/ganit').authorities).toEqual(['gst', 'income_tax']);
      expect(pageModules('/vetana').authorities).toEqual(['epfo', 'esic']);
    });

  it('claims no authority the live column does not hold', () => {
    // The four values above are the live `SELECT DISTINCT authority` — read
    // 2026-08-26: income_tax 22 rows, gst 18, esic 4, epfo 1. A page naming a
    // fifth would be a tab that can never fill and never errors.
    for (const path of ['/dashboard', '/tasks', '/ganit', '/graha', '/vikray',
                        '/manav', '/vetana', '/pahchan', '/prachar', '/esign',
                        '/sanvaad', '/dristi', '/reports', '/settings']) {
      for (const a of pageModules(path).authorities) {
        expect(DUE_AUTHORITIES).toContain(a);
      }
    }
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

  /* REVERSED BY THE OWNER, and the old test is left here in words because the
     reasoning it encoded was wrong in a way worth remembering.
     
     It asserted that an array becomes a COUNT — "rather than spilling rows into
     the corner". The panel is small and that felt tidy. Then he ran "Overdue
     follow-up chase", got "Result: 2", and said the only true thing about it:
     "not giving the data is useless".
     
     A read-only check that reports a count has told the reader there is work
     and withheld the work. The findings were already in the response;
      threw them away one line from the screen. */
  it('renders the findings, because a count is not an answer', () => {
    const s = summariseOutput({
      data: [
        { entity: { label: 'Call Sharma & Co' }, owner_name: 'Priya Nair', days_past: 12 },
        { entity: { label: 'Chase GST workings' }, owner_name: 'Unassigned', days_past: 3 },
      ],
    });
    expect(s.lines).toEqual([
      ['Call Sharma & Co', 'Priya Nair · 12d late'],
      ['Chase GST workings', 'Unassigned · 3d late'],
    ]);
  });

  it('caps the list and SAYS it capped it', () => {
    // A silent slice reads as the whole answer. Eight findings shown as six
    // with no note is the same failure as the count, one degree quieter.
    const rows = Array.from({ length: 9 }, (_, i) => ({
      label: 'Item ' + i, days_past: i,
    }));
    const s = summariseOutput({ data: rows });
    expect(s.lines).toHaveLength(7);
    expect(s.lines[6][1]).toContain('and 3 more');
  });

  it('never prints an owner id, only a name', () => {
    //  is a user id the callers key on;  is the printable
    // one. Rendering the id would fail check-rendered-ids and tell the reader
    // nothing anyway.
    const s = summariseOutput({
      data: [{ label: 'Renew DSC', owner: 'usr_9f2c41ab', owner_name: 'Anil Mehta', days_past: 5 }],
    });
    expect(JSON.stringify(s.lines)).not.toContain('usr_9f2c41ab');
    expect(s.lines[0]).toEqual(['Renew DSC', 'Anil Mehta · 5d late']);
  });

  it('says so when a check found nothing, rather than showing an empty block', () => {
    const s = summariseOutput({ data: [] });
    expect(s.lines).toEqual([['Nothing found', 'nothing is overdue']]);
  });

  it('carries the server\'s own truncation flag', () => {
    expect(summariseOutput({ data: null, truncated: true }).truncated).toBe(true);
  });

  /* THE SHAPE THE API ACTUALLY SENDS.

     Every case above passes `data` as a bare array -- a shape the server cannot
     produce. `skill_dispatcher.py` wraps a bare list as `{result: [...]}`, and
     the `check_*` handlers return a dict of NAMED lists. So the fix above
     tested green and shipped broken: a live run of "What we are waiting on"
     with nineteen findings printed "Nudges due: 19".

     Caught by driving the real dock in a browser, not by this file. These
     three cases are the shapes taken off the wire. */
  it('draws the findings out of a dict of named lists', () => {
    const s = summariseOutput({
      label: 'What is waiting',
      data: {
        as_at: '2026-08-21',
        counts: { fields: 11 },
        ladder: [{ days_past_due: 2, action: 'first nudge' }],
        limitations: ['a sentence', 'another sentence'],
        nudges_due: [
          { entity: { label: 'Call Sharma & Co' }, owner_name: 'Priya Nair',
            phone: '+91 90000 00001', days_past: 12 },
          { entity: { label: 'Chase GST workings' }, owner_name: 'Unassigned',
            days_past: 3 },
        ],
        escalations_due: [],
      },
    });
    // The findings themselves, with the number to ring.
    expect(s.lines).toContainEqual(
      ['Call Sharma & Co', 'Priya Nair · +91 90000 00001 · 12d late']);
    expect(s.lines).toContainEqual(['Chase GST workings', 'Unassigned · 3d late']);
    // Named, and never reduced to its length.
    expect(s.lines[0]).toEqual(['Nudges due', '2 findings']);
    expect(s.lines).not.toContainEqual(['Nudges due', '2']);
  });

  it('picks the findings, not the longest list of prose or config', () => {
    // `limitations` is strings, so it is not a finding however long it runs.
    const s = summariseOutput({
      data: {
        limitations: ['one', 'two', 'three', 'four', 'five'],
        escalations_due: [{ label: 'Escalate Patel audit', days_past: 20 }],
      },
    });
    expect(s.lines[0]).toEqual(['Escalations due', '1 finding']);
    expect(s.lines[1]).toEqual(['Escalate Patel audit', '20d late']);
  });

  it("unwraps the dispatcher's own {result: [...]} wrapper", () => {
    const s = summariseOutput({
      data: { result: [{ label: 'Renew DSC', owner_name: 'Anil Mehta', days_past: 5 }] },
    });
    expect(s.lines[0]).toEqual(['Result', '1 finding']);
    expect(s.lines[1]).toEqual(['Renew DSC', 'Anil Mehta · 5d late']);
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
    due: [GSTR3B, EPF, TDS_SALARY],
  };

  it('is the sum of the four tabs, so the user can check it', () => {
    const page = pageModules('/ganit');
    const lists = buildLists(page, DATA, {});
    expect(lists.skills).toHaveLength(2);
    expect(lists.metrics).toHaveLength(2);
    expect(lists.automations).toHaveLength(2);
    // Two of the three: the PF deposit is Payroll's, not Finance's. The Due
    // tab is a real contributor to the pill now, so a page whose only
    // applicable rows are statutory no longer shows a badge of zero.
    expect(lists.due).toHaveLength(2);
    expect(dockCount(lists)).toBe(
      lists.skills.length + lists.metrics.length
      + lists.automations.length + lists.due.length);
    expect(dockCount(lists)).toBe(8);
  });

  it('gives a page that claims no authority no due rows at all', () => {
    // `/graha` carries no `authorities`, and an unfiltered pass-through would
    // put GST deadlines on the CRM page. `[]` is the correct answer and it is
    // reached without reading the list.
    expect(dueForPage(pageModules('/graha'), DATA.due)).toEqual([]);
    expect(buildLists(pageModules('/graha'), DATA, {}).due).toEqual([]);
  });

  it('puts the payroll deposits on Payroll and the returns on Finance', () => {
    expect(dueForPage(pageModules('/vetana'), DATA.due).map(d => d.key))
      .toEqual(['epf.remittance']);
    expect(dueForPage(pageModules('/ganit'), DATA.due).map(d => d.key))
      .toEqual(['gst.return.gstr3b', 'tds.statement.salary']);
  });

  it('keeps an undated obligation in the list rather than dropping it', () => {
    // If this ever filters on `due_on` the 22 income-tax rows vanish again,
    // this time for a reason that reads like tidiness.
    const out = dueForPage(pageModules('/ganit'), DATA.due);
    expect(out.some(d => d.due_on === null)).toBe(true);
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
                 ruleTemplates = [], due = [], dueAsOf = AS_OF,
                 niyam403 = false, dueDown = false } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/v1/hub/org/skills') return Promise.resolve({ data: { data: orgSkills } });
    if (path === '/v1/hub/skills/templates') return Promise.resolve({ data: templates });
    if (path === '/v1/hub/skills/capabilities') {
      return Promise.resolve({ data: { skill_functions: [], unimplemented: [] } });
    }
    if (path === '/v1/analytics/catalogue') return Promise.resolve({ data: { metrics } });
    if (path === '/v1/statute/due') {
      if (dueDown) return Promise.reject(new Error('502'));
      // The envelope the router returns, not a bare list: `as_of` is what the
      // countdowns were measured from and the pane prints it.
      return Promise.resolve({ data: { as_of: dueAsOf, data: due,
                                       count: due.length } });
    }
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

  /* WHAT USED TO BE HERE. A case called `says the statute calendar is not
     served rather than inventing a due date` clicked to the Due tab and
     asserted the words "statute calendar is not served". That sentence was
     true and is now false — `routers/statute.py` serves it — so the test is
     DELETED rather than skipped or reworded around the new behaviour, which is
     what Phase 4.5 asks for in as many words. The four cases below are what a
     served calendar has to prove instead. */

  it('shows the dated obligation, with its date and not just a countdown',
    async () => {
      serve({ due: [GSTR3B, TDS_SALARY] });
      mount('/ganit');
      fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
      fireEvent.click(await screen.findByRole('tab', { name: /Due/ }));
      expect(await screen.findByText('GSTR-3B — summary return and payment'))
        .toBeTruthy();
      // The ABSOLUTE date, never "in 25 days" alone. Matched loosely on the
      // month because `en-IN` renders September as "Sept" and every other
      // month with three letters — asserting the exact string would be
      // testing CLDR's abbreviation table, not this pane.
      expect(screen.getByText(/due 20 Sept? 2026/)).toBeTruthy();
      // The countdown rides beside the date, never instead of it.
      expect(screen.getByText('25d')).toBeTruthy();
      // And the day it was all measured from, printed once.
      expect(screen.getByText(/The law as it stood on 26 Aug 2026/)).toBeTruthy();
    });

  it('lists an obligation with no recorded due day, and never dates it',
    async () => {
      // THE 22 ROWS, at the far end of the wire. Six of the income-tax rows in
      // force carry due_day NULL, and the answer is to name the duty and admit
      // the calendar has no day for it — not to drop it, and not to guess.
      serve({ due: [GSTR3B, TDS_SALARY] });
      mount('/ganit');
      fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
      fireEvent.click(await screen.findByRole('tab', { name: /Due/ }));
      expect(await screen.findByText('TDS statement — salary')).toBeTruthy();
      expect(screen.getByText(/no date recorded/)).toBeTruthy();
      expect(screen.getByText(/records no due day/)).toBeTruthy();
      // The column's spelling is `income_tax` and the filter matches on it
      // exactly; the underscore is a database artefact and does not belong
      // on a row a person reads.
      expect(screen.getByText(/INCOME TAX/)).toBeTruthy();
      expect(screen.queryByText(/INCOME_TAX/)).toBeNull();
    });

  it('does not put payroll deposits on the Finance page', async () => {
    // `authorities` is what separates them: gst + income_tax for Finance,
    // epfo + esic for Payroll. One list, filtered per page, no second fetch.
    serve({ due: [GSTR3B, EPF, TDS_SALARY] });
    mount('/ganit');
    fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /Due/ }));
    await screen.findByText('GSTR-3B — summary return and payment');
    expect(screen.queryByText('Provident fund contribution and ECR')).toBeNull();
  });

  it('says the calendar did not answer, never that nothing is due', async () => {
    // The two sentences are opposite claims about a firm's own compliance.
    // A read that failed must not surface as "nothing statutory falls here".
    serve({ dueDown: true });
    mount('/ganit');
    fireEvent.click(screen.getByRole('button', { name: /quick actions/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /Due/ }));
    expect(await screen.findByText(/did not answer/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing statutory falls on this page/)).toBeNull();
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
