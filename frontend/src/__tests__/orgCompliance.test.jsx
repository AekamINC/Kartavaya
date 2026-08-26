/**
 * TabCompliance — the panel that must not tell a customer they are compliant.
 *
 * PHASE-4 §4.1 states the rule in capitals: never a control that makes a
 * compliance CLAIM. "This org chose X" is a fact; "we are compliant with X" is
 * a lie the customer repeats to their own regulator. Three of the tests below
 * are that rule, and the reason they are here as well as server-side is that
 * the server owns the per-rule sentences and this file owns everything around
 * them — the lede, the legend, the dialog, the caveat on an unwired row.
 *
 * The other property under test is structural: a rule nothing reads may not be
 * offered "Enforced". "Enforced" means the firm asked to be STOPPED, and
 * offering it where nothing can stop anything is the same lie wearing a
 * control. The server refuses it too (`test_compliance_settings_screen.py`);
 * this is the half a user can see.
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern (see orgSenders.test.jsx) and is NOT installed — its
 * @testing-library/dom peer is missing, so importing it throws.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider } from '../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The raw id the table stores. It must never reach the DOM. */
const SETTER_ID = 'user_f1a0a472b98f';

let payload;
const patches = [];

const bare = (overrides = {}) => ({
  default_state: 'applicable',
  modules: [
    {
      module: 'ganit',
      active: true,
      rules: {
        hsn_required: {
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
        },
        composition_scheme: {
          label: 'Composition scheme',
          consequence: 'A composition dealer may not charge GST on an invoice.',
          state: 'not_applicable',
          default_state: 'applicable',
          wired: false,
          enforced_at: null,
          states: ['not_applicable', 'applicable'],
          set_at: '2026-08-26T09:30:00+00:00',
          reason: 'we are a regular dealer',
          has_setter: true,
          set_by_name: 'Keval Shah',
        },
      },
    },
    {
      module: 'vetana',
      active: false,
      rules: {
        pf_applicable: {
          label: 'Provident fund (EPF)',
          consequence: 'Where the establishment is covered, both halves are owed.',
          state: 'applicable',
          default_state: 'applicable',
          wired: false,
          enforced_at: null,
          states: ['not_applicable', 'applicable'],
          set_at: null,
          reason: null,
          has_setter: false,
          set_by_name: null,
        },
      },
    },
  ],
  ...overrides,
});

/** What `routers/audit.py` returns for `action=compliance.setting_updated`. */
let auditEvents;

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn((url) => {
      if (url === '/v1/audit/events') {
        return auditEvents instanceof Error
          ? Promise.reject(auditEvents)
          : Promise.resolve({ data: { data: auditEvents, next_before_id: null } });
      }
      return payload instanceof Error
        ? Promise.reject(payload)
        : Promise.resolve({ data: payload });
    }),
    patch: vi.fn((url, body) => {
      patches.push({ url, body });
      return Promise.resolve({
        data: {
          status: 'updated',
          module: 'ganit',
          rule_key: body.rule_key,
          previous_state: 'applicable',
          state: body.state,
          reason: body.reason,
          set_at: '2026-08-26T10:00:00+00:00',
          has_setter: true,
          set_by_name: 'Keval Shah',
        },
      });
    }),
  },
}));

const { default: TabCompliance } = await import('../pages/org/TabCompliance');
const { api } = await import('../lib/api');

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

/** Poll rather than sleep a fixed span — these run beside other suites. */
const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { return check(); } catch (err) {
      if (Date.now() > deadline) throw err;
      await settle(15);
    }
  }
};

const mount = async () => {
  await act(async () => {
    root.render(
      <ToastProvider>
        <TabCompliance />
      </ToastProvider>,
    );
  });
  await settle();
};

const rows = () => [...container.querySelectorAll('.cmpl__rule')];
const rowFor = label => rows().find(r => r.querySelector('.cmpl__t')?.textContent === label);
const segButtons = row => [...row.querySelectorAll('.seg__b')];
const click = async el => { await act(async () => { el.click(); }); };
const dialog = () => document.querySelector('[data-testid="compliance-confirm"]');
const dialogButton = re => [...(dialog()?.querySelectorAll('button') || [])]
  .find(b => re.test(b.textContent));

const historyButton = () => [...container.querySelectorAll('button')]
  .find(b => /show history/i.test(b.textContent));

beforeEach(() => {
  payload = bare();
  auditEvents = [];
  patches.length = 0;
  api.get.mockClear();
  api.patch.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('TabCompliance', () => {
  it('renders one control per rule the server names, grouped by module', async () => {
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    expect(rowFor('HSN/SAC code on every line')).toBeTruthy();
    expect(rowFor('Composition scheme')).toBeTruthy();
    expect(rowFor('Provident fund (EPF)')).toBeTruthy();
  });

  it('states the safe default, and the consequence beside every control', async () => {
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    const text = container.textContent;
    // The default is NAMED, not implied by which segment happens to be on.
    expect(text).toContain('Applicable');
    expect(text).toContain('Nothing arrives enforced');
    // Every rule's consequence is on screen at every state — a firm choosing
    // whether something applies needs to know what riding on the default costs
    // BEFORE it chooses.
    for (const row of rows()) {
      expect(row.querySelector('.cmpl__why')?.textContent?.trim()).toBeTruthy();
    }
  });

  // ── The rule PHASE-4 §4.1 puts in capitals ──────────────────────────────
  it('never tells the firm it is compliant', async () => {
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    const text = container.textContent.toLowerCase();
    for (const claim of [
      'compliant', 'compliance with', 'certified', 'we guarantee',
      'keeps you legal', 'legally safe', 'meets the requirement',
    ]) {
      expect(text).not.toContain(claim);
    }
    // And it says what it IS, in as many words.
    expect(container.textContent).toContain('record your firm’s own position');
  });

  it('offers two states for a rule nothing reads, and says so on the row', async () => {
    await mount();
    const row = await until(() => {
      const r = rowFor('Composition scheme');
      expect(r).toBeTruthy();
      return r;
    });
    expect(segButtons(row).map(b => b.textContent))
      .toEqual(['Not applicable', 'Applicable']);
    // The caveat that stops a recorded position reading as a control.
    expect(row.textContent).toContain('does not read this yet');
    expect(row.textContent).toContain('Recorded only');
  });

  it('offers all three states for a rule the product actually reads', async () => {
    await mount();
    const row = await until(() => {
      const r = rowFor('HSN/SAC code on every line');
      expect(r).toBeTruthy();
      return r;
    });
    expect(segButtons(row).map(b => b.textContent))
      .toEqual(['Not applicable', 'Applicable', 'Enforced']);
    expect(row.textContent).not.toContain('does not read this yet');
  });

  // ── Names, not ids ──────────────────────────────────────────────────────
  it('names the person who decided and never draws their id', async () => {
    payload = bare();
    // Even if a server were to leak the raw id alongside the name, it must not
    // reach the DOM. `check-rendered-ids.mjs` is positional and would not see
    // it inside a template string, so this is the behavioural half.
    payload.modules[0].rules.composition_scheme.set_by = SETTER_ID;
    await mount();
    const row = await until(() => {
      const r = rowFor('Composition scheme');
      expect(r.textContent).toContain('Keval Shah');
      return r;
    });
    expect(row.textContent).toContain('26 Aug 2026');
    expect(row.textContent).toContain('we are a regular dealer');
    expect(container.textContent).not.toContain(SETTER_ID);
    expect(container.innerHTML).not.toContain(SETTER_ID);
  });

  it('tells "nobody decided this" apart from "the account is gone"', async () => {
    payload = bare();
    payload.modules[0].rules.hsn_required = {
      ...payload.modules[0].rules.hsn_required,
      has_setter: true, set_by_name: null, set_at: '2026-08-26T09:30:00+00:00',
    };
    await mount();
    await until(() => expect(rows()).toHaveLength(3));

    // An id with no user row behind it: somebody decided, we cannot say who.
    expect(rowFor('HSN/SAC code on every line').textContent)
      .toContain('account has since been removed');
    // No row at all: nobody has decided, and the default is NAMED so the user
    // knows what they are riding on.
    const untouched = rowFor('Provident fund (EPF)').textContent;
    expect(untouched).toContain('Nobody has set this');
    expect(untouched).toContain('Applicable');
  });

  // ── The write path ──────────────────────────────────────────────────────
  it('confirms before writing, and writes nothing if you cancel', async () => {
    await mount();
    const row = await until(() => {
      const r = rowFor('HSN/SAC code on every line');
      expect(r).toBeTruthy();
      return r;
    });
    await click(segButtons(row).find(b => b.textContent === 'Enforced'));

    await until(() => expect(dialog()).toBeTruthy());
    // The dialog states what the state DOES before the user agrees to it.
    expect(dialog().textContent).toContain('asked to be stopped');
    expect(api.patch).not.toHaveBeenCalled();

    await click(dialogButton(/cancel/i));
    await settle();
    expect(api.patch).not.toHaveBeenCalled();
    // And the control is back where it was — a segment that stays moved after
    // a cancelled dialog shows a state the server does not hold.
    expect(rowFor('HSN/SAC code on every line')
      .querySelector('.seg__b.on').textContent).toBe('Applicable');
  });

  it('sends the rule, the state and the reason, and a blank reason as null', async () => {
    await mount();
    const row = await until(() => {
      const r = rowFor('Provident fund (EPF)');
      expect(r).toBeTruthy();
      return r;
    });
    await click(segButtons(row).find(b => b.textContent === 'Not applicable'));
    await until(() => expect(dialog()).toBeTruthy());
    await click(dialogButton(/^record as/i));
    await settle();

    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe('/v1/org/compliance/vetana');
    expect(patches[0].body).toEqual({
      rule_key: 'pf_applicable',
      state: 'not_applicable',
      // Optional, and it stays optional — an empty box is null, not "".
      reason: null,
    });
  });

  it('carries a typed reason through to the write', async () => {
    await mount();
    const row = await until(() => {
      const r = rowFor('Provident fund (EPF)');
      expect(r).toBeTruthy();
      return r;
    });
    await click(segButtons(row).find(b => b.textContent === 'Not applicable'));
    await until(() => expect(dialog()).toBeTruthy());

    const box = dialog().querySelector('#cmpl-reason');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value').set;
    await act(async () => {
      setter.call(box, '  fewer than twenty employees  ');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(dialogButton(/^record as/i));
    await settle();

    expect(patches[0].body.reason).toBe('fewer than twenty employees');
    // The saved row replaces the old one in place, so the panel shows the new
    // state without re-fetching and scrolling back to the top.
    await until(() => expect(rowFor('Provident fund (EPF)')
      .querySelector('.seg__b.on').textContent).toBe('Not applicable'));
  });

  it('offers no way to enforce a rule nothing reads', async () => {
    await mount();
    const row = await until(() => {
      const r = rowFor('Composition scheme');
      expect(r).toBeTruthy();
      return r;
    });
    expect(segButtons(row).some(b => b.textContent === 'Enforced')).toBe(false);
  });

  // ── The failure that must not look like data ────────────────────────────
  it('shows the error rather than a panel of unchosen defaults', async () => {
    payload = new Error('boom');
    await mount();
    await until(() => expect(rows()).toHaveLength(0));
    // A blank panel of every rule at its default would read as "your firm has
    // recorded nothing", which is a claim about the data rather than about the
    // request that could not be made.
    expect(container.textContent).toContain('is not the same as a decision');
  });

  it('keeps a switched-off module visible so its record stays correctable', async () => {
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    expect(rowFor('Provident fund (EPF)')).toBeTruthy();
    expect(container.textContent).toContain('Not switched on');
  });

  // ── Decision history ────────────────────────────────────────────────────
  //
  // The settings table is an UPSERT, so a reversal takes the earlier reason
  // off every screen with it. That sequence is exactly what proposal 80's
  // rule 1 needs to stay legible, and the events are already in the audit log.

  it('does not fetch the history until it is opened', async () => {
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    expect(api.get.mock.calls.map(c => c[0])).not.toContain('/v1/audit/events');

    await click(historyButton());
    await until(() =>
      expect(api.get.mock.calls.map(c => c[0])).toContain('/v1/audit/events'));
    // Filtered to this panel's own action, not the whole log.
    const call = api.get.mock.calls.find(c => c[0] === '/v1/audit/events');
    expect(call[1].params.action).toBe('compliance.setting_updated');
  });

  it('shows what each decision changed FROM, who made it and why', async () => {
    auditEvents = [{
      id: 9, ts: '2026-08-26T09:30:00+00:00',
      user_id: SETTER_ID, actor_name: 'Keval Shah',
      action: 'compliance.setting_updated', severity: 'warn',
      detail: {
        module: 'ganit', rule_key: 'composition_scheme',
        previous_state: 'applicable', state: 'not_applicable',
        reason: 'we are a regular dealer',
      },
    }];
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    await click(historyButton());

    const list = await until(() => {
      const el = container.querySelector('.cmpl__hist');
      expect(el).toBeTruthy();
      return el;
    });
    const text = list.textContent;
    // The rule by its LABEL, resolved from the registry — the audit row stores
    // the key, because a label is copy that gets reworded.
    expect(text).toContain('Composition scheme');
    expect(text).toContain('Applicable');
    expect(text).toContain('Not applicable');
    expect(text).toContain('Keval Shah');
    expect(text).toContain('we are a regular dealer');
    // audit.py ships `user_id` because its own filter needs it. Only the name
    // is ever drawn.
    expect(container.textContent).not.toContain(SETTER_ID);
    expect(container.innerHTML).not.toContain(SETTER_ID);
  });

  it('says so when a decision carries no reason', async () => {
    auditEvents = [{
      id: 9, ts: '2026-08-26T09:30:00+00:00',
      user_id: SETTER_ID, actor_name: 'A removed account',
      detail: {
        module: 'vetana', rule_key: 'pf_applicable',
        previous_state: 'applicable', state: 'not_applicable', reason: null,
      },
    }];
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    await click(historyButton());
    await until(() =>
      expect(container.querySelector('.cmpl__hist')?.textContent)
        .toContain('no reason recorded'));
    expect(container.querySelector('.cmpl__hist').textContent)
      .toContain('Provident fund (EPF)');
  });

  it('re-reads the history after a decision, so it is never one behind', async () => {
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    await click(historyButton());
    // The empty list has landed, so the section is genuinely open and settled.
    const before = await until(() => {
      const n = api.get.mock.calls.filter(c => c[0] === '/v1/audit/events').length;
      expect(n).toBe(1);
      expect(container.textContent).toContain('nothing to');
      return n;
    });

    // Record a decision with the section still open.
    auditEvents = [{
      id: 10, ts: '2026-08-26T10:00:00+00:00', actor_name: 'Keval Shah',
      detail: {
        module: 'vetana', rule_key: 'pf_applicable',
        previous_state: 'applicable', state: 'not_applicable', reason: null,
      },
    }];
    const row = rowFor('Provident fund (EPF)');
    await click(segButtons(row).find(b => b.textContent === 'Not applicable'));
    await until(() => expect(dialog()).toBeTruthy());
    await click(dialogButton(/^record as/i));
    await settle();

    await until(() => {
      expect(api.get.mock.calls.filter(c => c[0] === '/v1/audit/events').length)
        .toBe(before + 1);
      expect(container.querySelector('.cmpl__hist')?.textContent)
        .toContain('Provident fund (EPF)');
    });
  });

  it('says the settings are unaffected when the history cannot be read', async () => {
    auditEvents = new Error('boom');
    await mount();
    await until(() => expect(rows()).toHaveLength(3));
    await click(historyButton());
    // The controls above must not read as broken because a SEPARATE record
    // could not be fetched.
    await until(() =>
      expect(container.textContent).toContain('decisions above are unaffected'));
    expect(rows()).toHaveLength(3);
  });
});
