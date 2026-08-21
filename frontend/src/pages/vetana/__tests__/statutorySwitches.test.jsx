/**
 * Vetana → Salary structures — the five statutory switches migration 190 added.
 *
 * `tds_applicable`, `commission_in_pf_base`, `commission_in_esi_base`,
 * `bonus_in_pf_base`, `bonus_in_esi_base`. All five existed as columns with
 * nothing in the browser that could set them.
 *
 * ── What these tests pin ────────────────────────────────────────────────────
 *
 * 1 · ALL FIVE ARE ON THE SCREEN, and labelled in words about PF, ESI and tax
 *     rather than in column names. A person setting these is deciding whether
 *     a payment attracts a statutory deduction.
 *
 * 2 · EACH SAYS WHAT UNTICKED MEANS. Four of the five default to OFF and
 *     migration 190 is explicit that this is a choice and not a neutral
 *     position — "unticked means the component does not attract the
 *     deduction". A row of bare labels leaves a person guessing which way
 *     "off" points, on a question that changes what comes out of somebody's
 *     pay.
 *
 * 3 · WHAT IS TICKED IS WHAT IS POSTED, under the column names the API and the
 *     migration use.
 *
 * 4 · AND A SAVE THAT DID NOT STORE THEM SAYS SO. `SalaryStructureCreate` and
 *     `SalaryStructureUpdate` in routers/vetana.py do not declare these five
 *     field names, and a Pydantic model IGNORES fields it does not declare —
 *     so today the request is accepted and the answers are dropped. Both
 *     routes return the stored row, so the screen compares against the echo
 *     and says so rather than showing a green tick over a discarded answer
 *     about somebody's provident fund. This test is the one that will start
 *     passing differently the day the backend field lists are widened, and it
 *     is written so that both worlds are covered explicitly.
 *
 * Rendered with react-dom directly, following the constraint recorded in
 * `manav/__tests__/manavTabs.test.jsx`: `@testing-library/react` is installed
 * but its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import StructuresTab, {
  STAT_SWITCHES, statDefaults, unrecordedSwitches,
} from '../StructuresTab';

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

const mount = ui => act(() => root.render(<ToastProvider>{ui}</ToastProvider>));
const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const text = () => container.textContent;

/** The checkbox whose `.vt-sw__l` wording matches exactly. */
function switchBox(label) {
  const l = [...container.querySelectorAll('.vt-sw__l')]
    .find(x => x.textContent.trim() === label);
  return l ? l.querySelector('input[type="checkbox"]') : null;
}

/** The sentence rendered under one switch. */
function switchNote(label) {
  const l = [...container.querySelectorAll('.vt-sw__l')]
    .find(x => x.textContent.trim() === label);
  const note = l && l.parentElement.querySelector('.vt-sw__off');
  return note ? note.textContent : '';
}

/** A `k-formpanel__label` whose own text begins with `label`. */
function panelField(label) {
  const l = [...container.querySelectorAll('label.k-formpanel__label')]
    .find(x => x.textContent.trim().startsWith(label));
  return l ? l.querySelector('input, select, textarea') : null;
}

function setValue(el, value) {
  const proto = el.tagName === 'SELECT'
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function toggle(el) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'checked',
  ).set;
  act(() => {
    setter.call(el, !el.checked);
    el.dispatchEvent(new Event('click', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const clickText = (label) => {
  const el = [...container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === label);
  if (!el) throw new Error(`no button reading "${label}"`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  return el;
};

const submit = () => act(() => {
  container.querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});

const EMP = { id: 'emp-1', name: 'Priya Sharma', employee_code: 'EMP001' };

const TDS = 'Deduct income tax at source (TDS) from this salary';
const COMM_PF = 'Commission counts towards provident fund';
const COMM_ESI = 'Commission counts towards state insurance (ESI)';
const BONUS_PF = 'Bonus counts towards provident fund';
const BONUS_ESI = 'Bonus counts towards state insurance (ESI)';

async function openForm() {
  api.get.mockResolvedValue({ data: { data: [EMP] } });
  mount(<StructuresTab />);
  await settle();
  clickText('+ New structure');
  await settle();
}

/* ══════════════════════════════════════════════════════════════════════════
   All five are there, in plain words
   ══════════════════════════════════════════════════════════════════════════ */

describe('the five statutory switches are on the salary-structure form', () => {
  it('every column added by migration 190 has a control', async () => {
    await openForm();
    for (const label of [TDS, COMM_PF, COMM_ESI, BONUS_PF, BONUS_ESI]) {
      expect(switchBox(label), `no checkbox for "${label}"`).toBeTruthy();
    }
    expect(container.querySelectorAll('.vt-sw__l')).toHaveLength(5);
  });

  it('and none of them is labelled with its column name', async () => {
    await openForm();
    const labels = [...container.querySelectorAll('.vt-sw__l')].map(l => l.textContent);
    for (const col of STAT_SWITCHES.map(([k]) => k)) {
      expect(labels.some(l => l.includes(col)), `"${col}" is shown as a column name`).toBe(false);
    }
  });

  it('the five column names are exactly the five the migration added', () => {
    expect(STAT_SWITCHES.map(([k]) => k)).toEqual([
      'tds_applicable',
      'commission_in_pf_base',
      'commission_in_esi_base',
      'bonus_in_pf_base',
      'bonus_in_esi_base',
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Unticked is an answer, and it is written down
   ══════════════════════════════════════════════════════════════════════════ */

describe('each switch says what leaving it unticked means', () => {
  it('every one of the five carries a consequence sentence', async () => {
    await openForm();
    for (const label of [TDS, COMM_PF, COMM_ESI, BONUS_PF, BONUS_ESI]) {
      expect(switchNote(label).toLowerCase(), `"${label}" has no "unticked" sentence`)
        .toMatch(/unticked/);
    }
  });

  it('the PF sentences name provident fund, and the ESI ones name the ₹21,000 ceiling', async () => {
    await openForm();
    expect(switchNote(COMM_PF)).toMatch(/provident fund/i);
    expect(switchNote(BONUS_PF)).toMatch(/no PF/i);
    expect(switchNote(COMM_ESI)).toMatch(/₹21,000/);
    expect(switchNote(BONUS_ESI)).toMatch(/₹21,000/);
  });

  it('TDS says the regime decides nothing once it is off', async () => {
    await openForm();
    expect(switchNote(TDS)).toMatch(/no TDS is deducted/i);
    expect(switchNote(TDS)).toMatch(/decides nothing/i);
  });

  it('the block says these change the BASE and never the rate', async () => {
    await openForm();
    const note = container.querySelector('.vt-sw__note').textContent;
    expect(note).toMatch(/what the deduction is calculated on/i);
    expect(note).toMatch(/never how much/i);
    // And that a payslip freezes the answer, so a March edit cannot restate January.
    expect(note).toMatch(/cannot quietly restate January/i);
  });

  it('the defaults are the columns\' own defaults — TDS on, the four bases off', async () => {
    expect(statDefaults()).toEqual({
      tds_applicable: true,
      commission_in_pf_base: false,
      commission_in_esi_base: false,
      bonus_in_pf_base: false,
      bonus_in_esi_base: false,
    });
    await openForm();
    expect(switchBox(TDS).checked).toBe(true);
    expect(switchBox(COMM_PF).checked).toBe(false);
    expect(switchBox(COMM_ESI).checked).toBe(false);
    expect(switchBox(BONUS_PF).checked).toBe(false);
    expect(switchBox(BONUS_ESI).checked).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   What is ticked is what is sent
   ══════════════════════════════════════════════════════════════════════════ */

describe('the switches reach the request under the migration\'s column names', () => {
  it('a ticked base and an untied TDS are both in the payload', async () => {
    await openForm();
    api.post.mockResolvedValue({ data: {} });

    setValue(panelField('Employee'), 'emp-1');
    setValue(panelField('Effective from'), '2026-04-01');
    toggle(switchBox(TDS));            // → false
    toggle(switchBox(COMM_PF));        // → true
    toggle(switchBox(BONUS_ESI));      // → true
    await settle();
    submit();
    await settle();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/vetana/salary-structures');
    expect(payload.tds_applicable).toBe(false);
    expect(payload.commission_in_pf_base).toBe(true);
    expect(payload.commission_in_esi_base).toBe(false);
    expect(payload.bonus_in_pf_base).toBe(false);
    expect(payload.bonus_in_esi_base).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   A save that stored none of them says so
   ══════════════════════════════════════════════════════════════════════════ */

describe('an answer the server did not store is never shown as saved', () => {
  it('the comparison is against the echoed row, not against what was clicked', () => {
    const sent = { ...statDefaults(), tds_applicable: false, commission_in_pf_base: true };
    // The row as the API returns it TODAY: the two answers were dropped and
    // the column defaults stand.
    const saved = { tds_applicable: true, commission_in_pf_base: false,
      commission_in_esi_base: false, bonus_in_pf_base: false, bonus_in_esi_base: false };
    expect(unrecordedSwitches(sent, saved)).toEqual([
      'Deduct income tax at source (TDS) from this salary',
      'Commission counts towards provident fund',
    ]);
  });

  it('and reports nothing when the stored row agrees', () => {
    const sent = statDefaults();
    expect(unrecordedSwitches(sent, { ...statDefaults() })).toEqual([]);
  });

  it('the screen names them rather than showing a plain success', async () => {
    await openForm();
    // The route as it stands: extras ignored, the row comes back on defaults.
    api.post.mockResolvedValue({ data: { id: 's1', ...statDefaults() } });

    setValue(panelField('Employee'), 'emp-1');
    setValue(panelField('Effective from'), '2026-04-01');
    toggle(switchBox(COMM_PF));
    await settle();
    submit();
    await settle();

    expect(text()).toMatch(/statutory answer was not stored/i);
    expect(text().toLowerCase()).toContain('commission counts towards provident fund');
    // And it says it cannot be fixed by trying again.
    expect(text()).toMatch(/not a setting to retry/i);
  });

  it('and stays quiet when the server does record them', async () => {
    await openForm();
    api.post.mockResolvedValue({
      data: { id: 's1', ...statDefaults(), commission_in_pf_base: true },
    });

    setValue(panelField('Employee'), 'emp-1');
    setValue(panelField('Effective from'), '2026-04-01');
    toggle(switchBox(COMM_PF));
    await settle();
    submit();
    await settle();

    expect(text()).not.toMatch(/were not stored/i);
    expect(container.querySelector('.vt-dropped')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Reading a stored structure back
   ══════════════════════════════════════════════════════════════════════════ */

describe('a saved structure shows which way the five are set', () => {
  const STRUCTURE = {
    id: 's1', employee_name: 'Priya Sharma', employee_code: 'EMP001',
    effective_from: '2026-04-01', ctc_annual: 1200000,
    basic: 40000, hra: 20000, da: 5000, special_allowance: 30000,
    conveyance: 1600, medical: 1250,
    pf_enabled: true, esi_enabled: false, pt_applicable: true, tds_regime: 'new',
    tds_applicable: true, commission_in_pf_base: true, commission_in_esi_base: false,
    // Deliberately absent: nobody answered this one.
    bonus_in_pf_base: null, bonus_in_esi_base: false,
  };

  it('states yes or no in words, and says when nobody answered', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('/salary-structures/')) return Promise.resolve({ data: STRUCTURE });
      if (url.includes('/salary-structures')) return Promise.resolve({ data: { data: [STRUCTURE] } });
      return Promise.resolve({ data: { data: [EMP] } });
    });
    mount(<StructuresTab />);
    await settle();
    act(() => {
      container.querySelector('.k-modcard, .modcard, [role="button"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    const read = container.querySelector('.vt-sw--read');
    expect(read, 'the statutory block did not render on the detail view').toBeTruthy();
    expect(read.textContent).toMatch(/Commission counts towards provident fund: ?yes/i);
    expect(read.textContent).toMatch(/Bonus counts towards state insurance \(ESI\): ?no/i);
    // The NULL one is read at the column's default and says that it was.
    expect(read.textContent).toMatch(/Nobody has answered this one/i);
  });
});
