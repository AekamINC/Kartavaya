/**
 * Manav → Commission — the band editor, and the three rules it must not break.
 *
 * ── 1 · An eligible scheme with NO BANDS never reaches the network ──────────
 *
 * Migration 190 refuses that state with a DEFERRABLE CONSTRAINT TRIGGER
 * (`manav_commission_terms_stated()`), which fires at COMMIT. So without a
 * check in the browser, a person who ticks "on commission", leaves the ladder
 * empty and presses Save gets a 400 carrying a database sentence about a
 * constraint — after the write was attempted, about something they could have
 * been told before they clicked. This asserts `api.post` is NOT CALLED.
 *
 * ── 2 · There is no default rate, anywhere ──────────────────────────────────
 *
 * The owner: "no default commission percentage please org decide its own
 * commission." The rate box must be empty AND carry no placeholder — a greyed
 * "e.g. 3" is a default with deniability, and it is the shape the rule was
 * written against. Asserted on the attribute, not on appearance.
 *
 * ── 3 · A band has NO UPPER BOUND ───────────────────────────────────────────
 *
 * A rung runs to the next rung's floor, or to infinity. The editor must offer
 * two boxes per rung and not three: a third box is how two neighbours come to
 * disagree about where one ends and the next begins. Asserted by counting the
 * inputs in a rung and by the derived text on the highest one.
 *
 * Rendered with react-dom directly, following the constraint recorded in
 * `manavTabs.test.jsx`: `@testing-library/react` is installed but its
 * `@testing-library/dom` peer is not, so importing it throws.
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
import CommissionTab from '../CommissionTab';
import {
  bandProblems, schemeProblems, payloadBands, ladder, describeLadder,
  blankScheme, splitByDate, schemeIdentity, figure,
} from '../commissionModel';

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

/** Every labelled control whose `<span>` reads exactly `label`. */
function fieldInputs(label) {
  return [...container.querySelectorAll('label')]
    .filter(l => [...l.querySelectorAll('span')].some(s => s.textContent.trim() === label))
    .map(l => l.querySelector('input, select, textarea'))
    .filter(Boolean);
}
const fieldInput = label => fieldInputs(label)[0] || null;

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

function tick(el) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'checked',
  ).set;
  act(() => {
    setter.call(el, true);
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

const PRIYA = {
  id: 'emp-1', name: 'Priya Sharma', employee_code: 'EMP001',
  department: 'Audit', designation: 'Manager', status: 'active',
};
const RAJ = {
  id: 'emp-2', name: 'Raj Mehta', employee_code: 'EMP002',
  department: '', designation: 'Consultant', status: 'active',
};

/** Open the tab, then the form. */
async function openForm(people = [PRIYA]) {
  api.get.mockResolvedValue({ data: { data: people } });
  mount(<CommissionTab />);
  await settle();
  clickText('+ Record an arrangement');
  await settle();
}

/* ══════════════════════════════════════════════════════════════════════════
   The rule migration 190 enforces at COMMIT, enforced here at the button
   ══════════════════════════════════════════════════════════════════════════ */

describe('an eligible scheme with no bands is refused before the request is sent', () => {
  it('the model refuses it', () => {
    const form = { ...blankScheme(), employee_id: 'emp-1', eligible: true, revenue_scope: 'own', effective_from: '2026-04-01' };
    const problems = schemeProblems(form);
    expect(problems.some(p => /no rate is stated/i.test(p))).toBe(true);
  });

  it('and it is not refused once a rate is given', () => {
    const form = {
      ...blankScheme(),
      employee_id: 'emp-1',
      eligible: true,
      revenue_scope: 'own',
      effective_from: '2026-04-01',
      bands: [{ from_amount: '100000', rate_percent: '3' }],
    };
    expect(schemeProblems(form)).toEqual([]);
  });

  it('the form does not call the API at all', async () => {
    await openForm();

    setValue(fieldInput('Person'), 'emp-1');
    setValue(fieldInput('In force from'), '2026-04-01');
    setValue(fieldInput('Whose revenue'), 'own');
    tick(container.querySelector('.mn-elig input'));
    await settle();

    submit();
    await settle();

    expect(api.post).not.toHaveBeenCalled();
    expect(text()).toMatch(/This cannot be recorded yet/i);
    expect(text()).toMatch(/no rate is stated/i);
  });

  it('an INELIGIBLE scheme with no bands is fine — that is a recorded "no"', async () => {
    await openForm();
    api.post.mockResolvedValue({ data: {} });

    setValue(fieldInput('Person'), 'emp-1');
    setValue(fieldInput('In force from'), '2026-04-01');
    await settle();
    submit();
    await settle();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [, payload] = api.post.mock.calls[0];
    expect(payload.eligible).toBe(false);
    expect(payload.bands).toEqual([]);
    // Not stated, and expressed as null rather than as an empty string that
    // would fail the server's own IN () check.
    expect(payload.revenue_scope).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   No default rate. Not a value, not a placeholder.
   ══════════════════════════════════════════════════════════════════════════ */

describe('there is no default commission rate', () => {
  it('a fresh ladder row has an empty rate and an empty amount', () => {
    const s = blankScheme();
    expect(s.bands).toHaveLength(1);
    expect(s.bands[0].rate_percent).toBe('');
    expect(s.bands[0].from_amount).toBe('');
    expect(s.revenue_scope).toBe('');
    expect(s.eligible).toBe(false);
  });

  it('the rate box renders empty and carries NO placeholder', async () => {
    await openForm();
    const rate = fieldInput('Rate (%)');
    expect(rate).toBeTruthy();
    expect(rate.value).toBe('');
    // A greyed suggestion is a default with deniability.
    expect(rate.getAttribute('placeholder')).toBeNull();
    const from = fieldInput('From (₹)');
    expect(from.value).toBe('');
    expect(from.getAttribute('placeholder')).toBeNull();
  });

  it('adding a rate adds another empty pair, never a prefilled one', async () => {
    await openForm();
    clickText('+ Add a rate');
    await settle();
    const rates = fieldInputs('Rate (%)');
    expect(rates).toHaveLength(2);
    expect(rates.every(r => r.value === '')).toBe(true);
  });

  it('a blank rate is reported as missing rather than read as zero', () => {
    expect(figure('')).toBeNull();
    const problems = bandProblems([{ from_amount: '100000', rate_percent: '' }]);
    expect(problems.some(p => /state a rate/i.test(p))).toBe(true);
    expect(problems.some(p => /no default rate/i.test(p))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   A band has no upper bound, and the rungs are marginal
   ══════════════════════════════════════════════════════════════════════════ */

describe('the ladder has no upper-bound field', () => {
  it('a rung offers exactly two boxes — an amount and a rate', async () => {
    await openForm();
    const rung = container.querySelector('.mn-lad__ed');
    expect(rung).toBeTruthy();
    expect(rung.querySelectorAll('input')).toHaveLength(2);
  });

  it('the upper edge is derived text, and the highest rung runs on for ever', async () => {
    await openForm();
    setValue(fieldInput('From (₹)'), '100000');
    setValue(fieldInputs('Rate (%)')[0], '3');
    clickText('+ Add a rate');
    await settle();
    setValue(fieldInputs('From (₹)')[1], '500000');
    setValue(fieldInputs('Rate (%)')[1], '3.75');
    await settle();

    const edges = [...container.querySelectorAll('.mn-lad__to')].map(e => e.textContent.trim());
    expect(edges[0]).toMatch(/runs to ₹5,00,000/);
    expect(edges[1]).toMatch(/and everything above/);
  });

  it('the preview says the rates are marginal, in ranges rather than floors', () => {
    const bands = [
      { from_amount: '500000', rate_percent: '3.75' },
      { from_amount: '100000', rate_percent: '3' },
    ];
    const fmt = n => `₹${Number(n).toLocaleString('en-IN')}`;
    expect(describeLadder(bands, fmt))
      .toBe('3% on ₹1,00,000–₹5,00,000; 3.75% above ₹5,00,000');
  });

  it('a lowest rung of zero reads as "on everything", never as a blank floor', () => {
    const fmt = n => `₹${Number(n).toLocaleString('en-IN')}`;
    expect(describeLadder([{ from_amount: '0', rate_percent: '2' }], fmt))
      .toBe('2% on everything');
  });

  it('the derived ranges are computed in amount order, whatever order they were typed', () => {
    const rungs = ladder([
      { from_amount: '750000', rate_percent: '5' },
      { from_amount: '100000', rate_percent: '3' },
      { from_amount: '500000', rate_percent: '3.75' },
    ]);
    expect(rungs.map(r => [r.from, r.to])).toEqual([
      [100000, 500000], [500000, 750000], [750000, null],
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   What is typed is what is posted
   ══════════════════════════════════════════════════════════════════════════ */

describe('the payload', () => {
  it('carries the bands sorted, unrounded, under the API field names', async () => {
    await openForm();
    api.post.mockResolvedValue({ data: {} });

    setValue(fieldInput('Person'), 'emp-1');
    setValue(fieldInput('In force from'), '2026-04-01');
    setValue(fieldInput('Whose revenue'), 'own');
    setValue(fieldInput('Settles'), 'monthly');
    tick(container.querySelector('.mn-elig input'));
    await settle();

    // Typed HIGH first, deliberately.
    setValue(fieldInputs('From (₹)')[0], '750000');
    setValue(fieldInputs('Rate (%)')[0], '7.125');
    clickText('+ Add a rate');
    await settle();
    setValue(fieldInputs('From (₹)')[1], '100000');
    setValue(fieldInputs('Rate (%)')[1], '3');
    await settle();

    submit();
    await settle();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/manav/commission-schemes');
    expect(payload.employee_id).toBe('emp-1');
    expect(payload.eligible).toBe(true);
    expect(payload.revenue_scope).toBe('own');
    expect(payload.period).toBe('monthly');
    expect(payload.effective_from).toBe('2026-04-01');
    expect(payload.effective_to).toBeNull();
    // Lowest first, and 7.125 is NOT rounded to 7.13 or 7.1 on the way past.
    expect(payload.bands).toEqual([
      { from_amount: 100000, rate_percent: 3 },
      { from_amount: 750000, rate_percent: 7.125 },
    ]);
  });

  it('drops the spare empty row rather than sending a half-band', () => {
    expect(payloadBands([
      { from_amount: '100000', rate_percent: '3' },
      { from_amount: '', rate_percent: '' },
    ])).toEqual([{ from_amount: 100000, rate_percent: 3 }]);
  });

  it('but a HALF-filled row is an error, not a spare one', () => {
    expect(bandProblems([{ from_amount: '500000', rate_percent: '' }])).not.toEqual([]);
    expect(bandProblems([{ from_amount: '', rate_percent: '4' }])).not.toEqual([]);
    expect(bandProblems([{ from_amount: '', rate_percent: '' }])).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The rules that mirror the database's own CHECKs
   ══════════════════════════════════════════════════════════════════════════ */

describe('the band rules mirror the constraints', () => {
  it('a zero rate is refused — "the first lakh earns nothing" is said by the floor', () => {
    expect(bandProblems([{ from_amount: '100000', rate_percent: '0' }])[0])
      .toMatch(/above zero/i);
  });

  it('a rate over 100 is refused, and the message names the 500-means-5 mistake', () => {
    expect(bandProblems([{ from_amount: '0', rate_percent: '500' }])[0])
      .toMatch(/500 was meant/i);
  });

  it('a negative floor is refused', () => {
    expect(bandProblems([{ from_amount: '-1', rate_percent: '3' }])[0])
      .toMatch(/below zero/i);
  });

  it('two rungs at one amount are refused — which one pays would depend on row order', () => {
    const p = bandProblems([
      { from_amount: '100000', rate_percent: '3' },
      { from_amount: '100000', rate_percent: '4' },
    ]);
    expect(p.some(m => /same amount/i.test(m))).toBe(true);
  });

  it('an eligible scheme must say whose revenue it measures', () => {
    const p = schemeProblems({
      ...blankScheme(),
      employee_id: 'emp-1',
      eligible: true,
      effective_from: '2026-04-01',
      bands: [{ from_amount: '0', rate_percent: '2' }],
    });
    expect(p.some(m => /WHOSE revenue/i.test(m))).toBe(true);
  });

  it('the end date is exclusive and must be after the start', () => {
    const p = schemeProblems({
      ...blankScheme(),
      employee_id: 'emp-1',
      effective_from: '2026-04-01',
      effective_to: '2026-04-01',
    });
    expect(p.some(m => /no longer in force/i.test(m))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Two concurrent arrangements are two arrangements
   ══════════════════════════════════════════════════════════════════════════ */

describe('concurrent schemes read as two arrangements, not a duplicate', () => {
  const MONTHLY_OWN = {
    id: 's1', eligible: true, basis: 'turnover', period: 'monthly',
    revenue_scope: 'own', effective_from: '2026-04-01', effective_to: null,
    notes: '', bands: [{ from_amount: 500000, rate_percent: 3 }],
  };
  const ANNUAL_DEPT = {
    id: 's2', eligible: true, basis: 'gross_profit', period: 'annual',
    revenue_scope: 'department', effective_from: '2026-04-01', effective_to: null,
    notes: '', bands: [{ from_amount: 2000000, rate_percent: 2 }],
  };
  const CLOSED = {
    id: 's0', eligible: true, basis: 'turnover', period: 'monthly',
    revenue_scope: 'own', effective_from: '2025-04-01', effective_to: '2026-04-01',
    notes: '', bands: [{ from_amount: 500000, rate_percent: 2.5 }],
  };

  it('each carries its own identity — the (period, scope) pair', () => {
    expect(schemeIdentity(MONTHLY_OWN)).toBe('monthly, own revenue');
    expect(schemeIdentity(ANNUAL_DEPT)).toBe('annual, department revenue');
    expect(schemeIdentity(MONTHLY_OWN)).not.toBe(schemeIdentity(ANNUAL_DEPT));
  });

  it('both are in force at once, and the closed one is history', () => {
    const g = splitByDate([MONTHLY_OWN, ANNUAL_DEPT, CLOSED], '2026-08-21');
    expect(g.current.map(s => s.id).sort()).toEqual(['s1', 's2']);
    expect(g.earlier.map(s => s.id)).toEqual(['s0']);
    expect(g.later).toEqual([]);
  });

  it('the window is half-open: the end date is the first day it does not apply', () => {
    expect(splitByDate([CLOSED], '2026-03-31').current.map(s => s.id)).toEqual(['s0']);
    expect(splitByDate([CLOSED], '2026-04-01').current).toEqual([]);
  });

  it('a scheme that starts later is its own group, not filed under history', () => {
    const future = { ...MONTHLY_OWN, id: 's9', effective_from: '2026-10-01' };
    const g = splitByDate([future], '2026-08-21');
    expect(g.later.map(s => s.id)).toEqual(['s9']);
    expect(g.earlier).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Absences are words, never zeros
   ══════════════════════════════════════════════════════════════════════════ */

describe('nothing prints a zero where the truth is not known', () => {
  it('an unchecked person says so, and does not claim to have no scheme', async () => {
    api.get.mockResolvedValue({ data: { data: [PRIYA, RAJ] } });
    mount(<CommissionTab />);
    await settle();
    expect(text()).toMatch(/not checked yet/i);
    expect(text()).not.toMatch(/no scheme recorded/i);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('checking asks once per person and then says who has nothing recorded', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('commission-schemes')) return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({ data: { data: [PRIYA, RAJ] } });
    });
    mount(<CommissionTab />);
    await settle();
    clickText('Check who is on commission');
    await settle(12);

    expect(text()).toMatch(/no scheme recorded/i);
    expect(text()).not.toMatch(/not checked yet/i);
  });

  it('a failed read stays UNCHECKED — it never becomes "no scheme"', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('commission-schemes')) {
        return Promise.reject({ response: { status: 500 } });
      }
      return Promise.resolve({ data: { data: [PRIYA] } });
    });
    mount(<CommissionTab />);
    await settle();
    clickText('Check who is on commission');
    await settle(12);

    expect(text()).toMatch(/not checked yet/i);
    expect(text()).toMatch(/could not be read/i);
    expect(text()).toMatch(/Priya Sharma/);
  });

  it('a person with no department says "department not set" rather than nothing', async () => {
    api.get.mockResolvedValue({ data: { data: [RAJ] } });
    mount(<CommissionTab />);
    await settle();
    expect(text()).toMatch(/department not set/i);
  });

  it('a department-scoped arrangement for someone with no department is warned about, not blocked', async () => {
    await openForm([RAJ]);
    setValue(fieldInput('Person'), 'emp-2');
    setValue(fieldInput('Whose revenue'), 'department');
    await settle();
    expect(text()).toMatch(/has no department recorded/i);
    expect(text()).toMatch(/never ₹0/);
    // Still recordable: it is a real agreement.
    expect(container.querySelector('button[type="submit"]').disabled).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   No salary figure reaches this screen
   ══════════════════════════════════════════════════════════════════════════ */

describe('the commission screen shows no pay', () => {
  it('records no CTC, basic or payslip field anywhere on the form', async () => {
    await openForm();
    const labels = [...container.querySelectorAll('label')].map(l => l.textContent.toLowerCase());
    for (const banned of ['ctc', 'basic', 'salary', 'payslip', 'take-home', 'gross pay']) {
      expect(labels.some(l => l.includes(banned)), `a field mentioning "${banned}"`).toBe(false);
    }
  });
});
