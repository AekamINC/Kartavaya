/**
 * TabCompliance — the firm / client / employee scope switcher.
 *
 * Migration 253 lets one compliance rule be answered differently for one
 * client or one employee. `src/__tests__/orgCompliance.test.jsx` already holds
 * the firm-level panel; this file is about the three things that are only true
 * once a second subject exists, and each of them is a way the screen can look
 * completely right while being wrong.
 *
 * ── 1 · AN EXCEPTION THAT AGREES WITH THE FIRM IS STILL AN EXCEPTION ────────
 *
 * The obvious implementation of "is this overridden?" is `state !==
 * default.state`, and it is wrong. A client can be pinned to the value the
 * firm happens to hold today — that is the whole of the owner's "client asked
 * to remove gst" once the firm later changes its mind: the client must NOT
 * move with it. A value comparison cannot see that row at all; it reads as
 * "following the firm", the exception is invisible, there is no way to remove
 * it, and the day the firm default moves the client silently moves too.
 *
 * `resolve_effective` returns `source` for exactly this reason and its
 * docstring says so. `records an exception whose value MATCHES the firm` below
 * is the assertion that fails the moment somebody re-derives it — the fixture
 * sets `source: 'override'` with both states equal, so a comparison-based
 * implementation renders the opposite of every string it checks.
 *
 * ── 2 · A SUBJECT WITH NO EXCEPTION MUST START ON NOTHING ───────────────────
 *
 * If the segmented control pre-selected the EFFECTIVE state, it would draw the
 * firm's answer as though this client had chosen it — and "pin this client to
 * Applicable" is a real, different decision from "let this client follow the
 * firm, which currently says Applicable". `pins a subject to the value the
 * firm already holds` drives that click and asserts the write.
 *
 * ⚠ This paragraph used to add "clicking the already-selected segment is a
 * no-op in `Seg`". That is FALSE — `Seg.jsx:56` is a bare
 * `onClick={() => onChange(o.value)}` with no equality guard. The test below
 * does not rest on it either way (it asserts `.seg__b.on` is absent, not that
 * a click was swallowed), but the sentence would have misled the next reader.
 *
 * ── 3 · THE RULES MUST NOT APPEAR BEFORE THE SUBJECT DOES ───────────────────
 *
 * A rule list rendered before a client is chosen is the firm's own answers
 * under a client's heading, which is the single misreading that makes this
 * feature dangerous — an administrator edits what looks like one client's
 * exception and rewrites the answer for every client at once.
 *
 * ── ANTI-VACUITY ────────────────────────────────────────────────────────────
 *
 * Every test here could pass over a screen that renders nothing, so each one
 * that asserts an absence also asserts a presence: rows counted, requests
 * counted, the fixture's own override asserted to exist before anything is
 * concluded from how it is drawn. The `does not draw the subject's id` test in
 * particular is worthless without proof the id was ever in play, so it asserts
 * the id DID reach a request URL and did NOT reach the DOM.
 *
 * The mocked API is the harness's, so an unstubbed call is a failure rather
 * than a real request — staging and production share one database and a GET
 * from a test run is a GET against production.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import TabCompliance from '../TabCompliance';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, settle,
} from '../../../__tests__/e2e/_harness';

/**
 * A real client uuid shape and a real employee uuid shape. Neither may be
 * drawn; both are legitimate as request parameters, which is the distinction
 * `check-rendered-ids.mjs` is built on and the one this file measures.
 */
const CLIENT_ID = '9c2f6d4e-1a5b-4c3d-8e7f-0a1b2c3d4e5f';
const OTHER_CLIENT_ID = '3b8a1f22-77cc-4e11-9d0a-6f5e4d3c2b1a';
const EMPLOYEE_ID = '11111111-2222-3333-4444-555555555555';

const CLIENT_NAME = 'Acme Traders';
const EMPLOYEE_NAME = 'Ramesh Patel';

/** One rule as `services/compliance_settings.py::_shape` emits it, named. */
const shape = (o = {}) => ({
  label: 'HSN/SAC code on every line',
  consequence: 'No HSN — the buyer’s input tax credit may be questioned.',
  state: 'applicable',
  default_state: 'applicable',
  wired: true,
  enforced_at: 'services/doc_validation.py:validate_tax_invoice',
  states: ['not_applicable', 'applicable', 'enforced'],
  set_at: null,
  reason: null,
  has_setter: false,
  set_by_name: null,
  ...o,
});

/** The firm's own answer, as somebody actually recorded it. */
const FIRM_DEFAULT = shape({
  state: 'applicable',
  has_setter: true,
  set_by_name: 'Sunita Rao',
  set_at: '2026-08-26T09:30:00+00:00',
  reason: 'we invoice with HSN throughout',
});

/**
 * One rule for one subject, exactly as `GET /scope/{type}/{id}` returns it —
 * `default`, `override` and `source` together, and NO `scope_id`, which the
 * router strips before the payload leaves the process.
 */
const effective = ({ override = null, source } = {}) => ({
  ...(override || FIRM_DEFAULT),
  default: FIRM_DEFAULT,
  override,
  // Passed through from the fixture rather than derived here, so a test can
  // construct the case the screen is not allowed to derive either.
  source: source || (override ? 'override' : 'default'),
  scope_type: 'client',
});

const OVERRIDE_DIFFERENT = shape({
  state: 'not_applicable',
  has_setter: true,
  set_by_name: 'Vikram Desai',
  set_at: '2026-08-28T11:00:00+00:00',
  reason: 'client is unregistered and asked for no HSN',
});

/** The trap: an exception that says exactly what the firm says. */
const OVERRIDE_SAME = shape({
  state: 'applicable',
  has_setter: true,
  set_by_name: 'Vikram Desai',
  set_at: '2026-08-28T11:00:00+00:00',
  reason: 'pinned deliberately — do not follow the firm if it changes',
});

/** `GET /v1/org/compliance` — the firm's own page, unchanged by 253. */
const ORG_PAYLOAD = {
  default_state: 'applicable',
  modules: [{
    module: 'ganit',
    active: true,
    rules: { hsn_required: shape() },
  }],
};

const scopePayload = (rule, name = CLIENT_NAME, scopeType = 'client') => ({
  scope_type: scopeType,
  scope_name: name,
  default_state: 'applicable',
  modules: [{ module: 'ganit', active: true, rules: { hsn_required: rule } }],
});

let host;
let mock;
/** What `GET /scope/...` will answer with. Reassigned per test. */
let scoped;

const TARGETS = {
  client: [
    { id: CLIENT_ID, name: CLIENT_NAME },
    { id: OTHER_CLIENT_ID, name: 'Bharat Steel' },
  ],
  employee: [{ id: EMPLOYEE_ID, name: EMPLOYEE_NAME }],
};

beforeEach(() => {
  installNetworkKillSwitch();
  scoped = scopePayload(effective({ override: OVERRIDE_DIFFERENT }));
  mock = installMockApi({
    'GET /v1/org/compliance': () => ORG_PAYLOAD,
    'GET /v1/org/compliance/targets/:scope_type': ({ params }) => ({
      scope_type: params.scope_type,
      targets: TARGETS[params.scope_type] || [],
      truncated: false,
      page_size: 200,
    }),
    'GET /v1/org/compliance/scope/:scope_type/:scope_id': () => scoped,
    'GET /v1/audit/events': { data: [], next_before_id: null },
    'PATCH /v1/org/compliance/:module': ({ body }) => ({
      status: 'updated',
      module: 'ganit',
      rule_key: body.rule_key,
      previous_state: 'applicable',
      state: body.state,
      reason: body.reason,
      set_at: '2026-08-29T10:00:00+00:00',
      has_setter: true,
      set_by_name: 'Sunita Rao',
    }),
    'PATCH /v1/org/compliance/:module/override': ({ body }) => ({
      status: 'updated',
      module: 'ganit',
      scope_type: body.scope_type,
      scope_name: CLIENT_NAME,
      rule_key: body.rule_key,
      previous_state: 'applicable',
      previous_source: 'default',
      rule: effective({
        override: shape({
          state: body.state,
          has_setter: true,
          set_by_name: 'Vikram Desai',
          set_at: '2026-08-29T10:00:00+00:00',
          reason: body.reason,
        }),
      }),
    }),
    'DELETE /v1/org/compliance/:module/override': () => ({
      status: 'cleared',
      module: 'ganit',
      scope_type: 'client',
      scope_name: CLIENT_NAME,
      rule_key: 'hsn_required',
      previous_state: 'not_applicable',
      rule: effective(),
    }),
  });
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
});

/* ── driving ──────────────────────────────────────────────────────────── */

const mount = () => host.mount(<TabCompliance />);

const rows = () => host.$$('.cmpl__rule');
const firstRow = () => rows()[0];

/** A segmented button by its visible label, anywhere on the panel. */
const seg = (label, root) =>
  [...(root || host.container).querySelectorAll('.seg__b')]
    .find(b => b.textContent === label);

const dialog = () => document.querySelector('[data-testid="compliance-confirm"]');
const dialogButton = re => [...(dialog()?.querySelectorAll('button') || [])]
  .find(b => re.test(b.textContent));

const pickScope = async (label) => {
  await host.click(seg(label));
};

/** Open the subject picker and choose by NAME — the only handle on screen. */
const pickSubject = async (name) => {
  await host.click(host.$('.pk__tr'));
  const row = [...host.$$('.pk__row')].find(r => r.textContent.includes(name));
  if (!row) throw new Error(`no picker row named ${name}`);
  await host.click(row);
  await settle();
};

const calls = (verb, needle) => mock.calledWith(verb, needle);

/* ══════════════════════════════════════════════════════════════════════════
   The switcher itself
   ══════════════════════════════════════════════════════════════════════════ */

describe('TabCompliance — scope switcher', () => {
  it('offers the three scopes and starts on the firm, which is unchanged', async () => {
    await mount();

    for (const label of ['This firm', 'One client', 'One employee']) {
      expect(seg(label), `no scope option ${label}`).toBeTruthy();
    }
    // Anti-vacuity: the firm's own panel actually rendered, so "no picker" and
    // "no scoped request" below are statements about a live screen.
    expect(rows()).toHaveLength(1);
    expect(firstRow().textContent).toContain('HSN/SAC code on every line');

    // The firm's page asks nobody who it is about, and reads the route that
    // was already live before migration 253.
    expect(host.$('.pk__tr')).toBeNull();
    expect(calls('GET', '/v1/org/compliance').map(c => c.path))
      .toContain('/v1/org/compliance');
    expect(calls('GET', '/scope/')).toHaveLength(0);
    expect(calls('GET', '/targets/')).toHaveLength(0);
  });

  it('writes the firm answer through the route that was already live', async () => {
    await mount();
    await host.click(seg('Not applicable', firstRow()));
    expect(dialog()).toBeTruthy();
    await host.click(dialogButton(/^record as/i));

    const patches = calls('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe('/v1/org/compliance/ganit');
    // No scope keys at all. The firm-wide row is `scope_type='org'` and the
    // service refuses a `scope_id` beside it; a screen that started sending
    // one would 400 every firm-level save.
    expect(patches[0].body).toEqual({
      rule_key: 'hsn_required', state: 'not_applicable', reason: null,
    });
  });

  it('shows no rule until a subject is chosen', async () => {
    await mount();
    await pickScope('One client');

    // The picker is up and populated — so the absence below is "nothing has
    // been chosen", not "the switch did nothing".
    expect(host.$('.pk__tr')).toBeTruthy();
    expect(calls('GET', '/targets/client')).toHaveLength(1);

    expect(rows()).toHaveLength(0);
    expect(calls('GET', '/scope/')).toHaveLength(0);
    // And it says why, rather than leaving a blank panel to be read as "this
    // client has recorded nothing".
    expect(host.text()).toContain('Nothing is shown until then');
  });

  it('asks the picker for employees, not clients, on the employee scope', async () => {
    await mount();
    await pickScope('One employee');

    expect(calls('GET', '/targets/employee')).toHaveLength(1);
    expect(calls('GET', '/targets/client')).toHaveLength(0);
    await host.click(host.$('.pk__tr'));
    expect(host.text()).toContain(EMPLOYEE_NAME);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   One subject's answers
   ══════════════════════════════════════════════════════════════════════════ */

describe('TabCompliance — one client’s answers', () => {
  it('names whose answer is in force, and says the firm’s beside it', async () => {
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);

    const reads = calls('GET', '/scope/');
    expect(reads).toHaveLength(1);
    expect(reads[0].path).toBe(`/v1/org/compliance/scope/client/${CLIENT_ID}`);

    expect(rows()).toHaveLength(1);
    const text = firstRow().textContent;

    // The two sentences that must never be the same sentence.
    expect(text).toContain(`Not applicable for ${CLIENT_NAME}`);
    expect(text).toContain('an exception recorded for this client');
    // The firm's own answer is on the row too, attributed, so a person can see
    // what they are making an exception to.
    expect(text).toContain('At this firm:');
    expect(text).toContain('Applicable');
    expect(text).toContain('Sunita Rao');
    expect(text).toContain('we invoice with HSN throughout');
    // And the exception's own attribution, which is a different decision.
    expect(text).toContain('Vikram Desai');
    expect(text).toContain('client is unregistered and asked for no HSN');
  });

  it('says a subject is following the firm when nothing is recorded for them', async () => {
    scoped = scopePayload(effective());
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);

    const row = firstRow();
    expect(row).toBeTruthy();               // anti-vacuity: the row is there
    expect(row.textContent).toContain('because no exception is recorded for this client');
    expect(row.textContent).not.toContain('an exception recorded for this client');
    // Nothing to remove, and the asymmetry stated rather than left as a gap.
    expect([...row.querySelectorAll('button')].map(b => b.textContent))
      .not.toContain('Remove this exception');
    expect(row.textContent).toContain('There is nothing to remove');
    expect(row.textContent).toContain('changed rather than removed');
  });

  /**
   * THE ONE THIS FILE EXISTS FOR. Both states are `applicable`; only `source`
   * says this is an exception. An implementation that compares values renders
   * "following the firm", offers no way to remove the row, and fails four of
   * the five assertions below.
   */
  it('records an exception whose value MATCHES the firm as an exception', async () => {
    scoped = scopePayload(effective({ override: OVERRIDE_SAME }));
    // Anti-vacuity on the fixture itself: the trap only exists while the two
    // states really are equal and the server really did say 'override'.
    const fixture = scoped.modules[0].rules.hsn_required;
    expect(fixture.source).toBe('override');
    expect(fixture.override.state).toBe(fixture.default.state);

    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);

    const row = firstRow();
    expect(row.textContent).toContain('an exception recorded for this client');
    expect(row.textContent).not.toContain('because no exception is recorded');
    // It can be removed — a row nobody can reach is the practical cost of
    // deriving `source` from a comparison.
    expect([...row.querySelectorAll('button')].map(b => b.textContent))
      .toContain('Remove this exception');
    // And the screen explains why an exception that reads identical to the
    // firm is not a mistake.
    expect(row.textContent).toContain('and it is still an exception');
  });

  it('pins a subject to the value the firm already holds', async () => {
    scoped = scopePayload(effective());          // no override; firm says Applicable
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);

    const row = firstRow();
    // Nothing is selected, because nothing has been decided for this client.
    // Pre-selecting the effective state would say this client chose the firm's
    // answer — which is the confusion the whole screen exists to prevent.
    expect(row.querySelector('.seg__b.on')).toBeNull();
    expect(row.querySelectorAll('.seg__b')).toHaveLength(3);

    await host.click(seg('Applicable', row));
    expect(dialog()).toBeTruthy();
    // The dialog says what stays put, so nobody reads this as a firm change.
    expect(dialog().textContent).toContain('firm');
    await host.click(dialogButton(/^record for/i));

    const writes = calls('PATCH', '/override');
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('/v1/org/compliance/ganit/override');
    expect(writes[0].body).toEqual({
      rule_key: 'hsn_required',
      // The SAME value the firm holds, and still a write.
      state: 'applicable',
      scope_type: 'client',
      scope_id: CLIENT_ID,
      reason: null,
    });
    // The firm-level route is not touched by a scoped write.
    expect(calls('PATCH').filter(c => c.path === '/v1/org/compliance/ganit'))
      .toHaveLength(0);
  });

  it('carries a typed reason onto the exception', async () => {
    scoped = scopePayload(effective());
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);

    await host.click(seg('Not applicable', firstRow()));
    const box = dialog().querySelector('#cmpl-reason');
    expect(box).toBeTruthy();
    await host.fill(box, '  client asked to be billed without it  ');
    await host.click(dialogButton(/^record for/i));

    const writes = calls('PATCH', '/override');
    expect(writes).toHaveLength(1);
    expect(writes[0].body.reason).toBe('client asked to be billed without it');
    // The server's re-resolved rule replaces the row, so the panel shows the
    // exception without a re-fetch.
    expect(firstRow().textContent).toContain('an exception recorded for this client');
    expect(calls('GET', '/scope/')).toHaveLength(1);
  });

  it('removes an exception by naming the rule and the subject', async () => {
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);

    const remove = [...firstRow().querySelectorAll('button')]
      .find(b => b.textContent === 'Remove this exception');
    expect(remove).toBeTruthy();
    await host.click(remove);

    expect(dialog()).toBeTruthy();
    // A removal is confirmed like every other decision, and it says what the
    // subject falls back to.
    expect(dialog().textContent).toContain('goes back to your firm');
    expect(calls('DELETE')).toHaveLength(0);

    await host.click(dialogButton(/^remove the exception/i));

    const dels = calls('DELETE');
    expect(dels).toHaveLength(1);
    expect(dels[0].path).toBe('/v1/org/compliance/ganit/override');
    // Query parameters, because a DELETE body is not carried reliably. The
    // subject travels with the rule — a clear that named only the rule would
    // be ambiguous across every client the firm has.
    expect(dels[0].search).toEqual({
      rule_key: 'hsn_required',
      scope_type: 'client',
      scope_id: CLIENT_ID,
    });
    // And the row now says the client follows the firm again.
    expect(firstRow().textContent)
      .toContain('because no exception is recorded for this client');
  });

  it('does not draw the subject’s id anywhere, having actually used it', async () => {
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);
    await host.click([...firstRow().querySelectorAll('button')]
      .find(b => b.textContent === 'Remove this exception'));
    await host.click(dialogButton(/^remove the exception/i));

    // ANTI-VACUITY. Without this the assertions below pass on a screen that
    // never loaded a client at all.
    const used = mock.calls.filter(c =>
      c.path.includes(CLIENT_ID)
      || (c.search && c.search.scope_id === CLIENT_ID));
    expect(used.length).toBeGreaterThan(1);

    for (const id of [CLIENT_ID, OTHER_CLIENT_ID]) {
      expect(host.text()).not.toContain(id);
      expect(host.html()).not.toContain(id);
    }
    // The name is what a person reads instead.
    expect(host.text()).toContain(CLIENT_NAME);
  });

  it('drops the previous subject’s answers when the scope changes', async () => {
    await mount();
    await pickScope('One client');
    await pickSubject(CLIENT_NAME);
    expect(rows()).toHaveLength(1);          // anti-vacuity: there was something

    await pickScope('One employee');
    // Not one render of the client's exceptions under an employee's heading.
    expect(rows()).toHaveLength(0);
    expect(host.text()).not.toContain(CLIENT_NAME);
    expect(host.text()).toContain('Nothing is shown until then');
  });
});
