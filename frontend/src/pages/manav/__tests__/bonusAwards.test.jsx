/**
 * Manav → Bonus — discretionary, and never a zero.
 *
 * Two rules carry this screen:
 *
 *   · NOTHING IS SUGGESTED. A bonus is derived from nothing — no turnover, no
 *     threshold, no rate — so the amount box is empty and carries no
 *     placeholder, and a ₹0 award is refused before the request is sent. The
 *     database refuses it too (`manav_bonus_awards_amount_ck`), but a zero in
 *     the box is an unfinished form and it should not take a round trip to say
 *     so.
 *   · AN ABSENCE IS A SENTENCE. No awards in a month is "no bonus awarded",
 *     not "₹0". Those are different claims about a person.
 *
 * And one honest limitation is pinned here so it cannot be quietly forgotten:
 * `manav_employees.bonus_eligible` is returned by NO read endpoint, so this
 * screen cannot show who is eligible and says so instead of guessing.
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
import BonusTab, { awardProblems, monthLabel, payrollMonths } from '../BonusTab';

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

function fieldInput(label) {
  const l = [...container.querySelectorAll('label.k-formpanel__label')]
    .find(x => [...x.querySelectorAll('span')].some(s => s.textContent.trim() === label));
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

const EMP = { id: 'emp-1', name: 'Priya Sharma', employee_code: 'EMP001', department: 'Audit' };

async function openTab(awards = []) {
  api.get.mockImplementation((url) => {
    if (url.includes('bonus-awards')) return Promise.resolve({ data: { data: awards } });
    return Promise.resolve({ data: { data: [EMP] } });
  });
  mount(<BonusTab />);
  await settle();
}

describe('an absence is a sentence, never a zero', () => {
  it('an empty register says "no bonus awarded"', async () => {
    await openTab([]);
    expect(text()).toMatch(/no bonus awarded/i);
    expect(text()).not.toMatch(/₹0\b/);
  });

  it('and explains that it is a decision nobody made, not an amount of zero', async () => {
    await openTab([]);
    expect(text()).toMatch(/not that the amounts came to zero/i);
  });
});

describe('nothing suggests what a bonus should be', () => {
  it('the amount box is empty and carries no placeholder', async () => {
    await openTab([]);
    clickText('+ Award a bonus');
    await settle();
    const amount = fieldInput('Amount (₹)');
    expect(amount).toBeTruthy();
    expect(amount.value).toBe('');
    expect(amount.getAttribute('placeholder')).toBeNull();
  });

  it('a zero is refused before the request is sent', () => {
    const p = awardProblems({ employee_id: 'emp-1', amount: '0', reason: 'Diwali', pay_period: '2026-08' });
    expect(p.some(m => /above zero/i.test(m))).toBe(true);
  });

  it('a blank amount is refused as blank, not read as zero', () => {
    const p = awardProblems({ employee_id: 'emp-1', amount: '', reason: 'Diwali', pay_period: '2026-08' });
    expect(p.some(m => /Enter the amount/i.test(m))).toBe(true);
  });

  it('a reason is required — an unexplained payment cannot be defended', () => {
    const p = awardProblems({ employee_id: 'emp-1', amount: '5000', reason: '  ', pay_period: '2026-08' });
    expect(p.some(m => /Say why/i.test(m))).toBe(true);
  });

  it('the payroll month must be YYYY-MM, because a typo files it where no run looks', () => {
    expect(awardProblems({ employee_id: 'e', amount: '1', reason: 'x', pay_period: '2026-13' })).not.toEqual([]);
    expect(awardProblems({ employee_id: 'e', amount: '1', reason: 'x', pay_period: '2026-08' })).toEqual([]);
  });

  it('an incomplete award never reaches the network', async () => {
    await openTab([]);
    clickText('+ Award a bonus');
    await settle();
    submit();
    await settle();
    expect(api.post).not.toHaveBeenCalled();
    expect(text()).toMatch(/This cannot be awarded yet/i);
  });

  it('a complete one posts the amount unrounded, under the API field names', async () => {
    await openTab([]);
    api.post.mockResolvedValue({ data: {} });
    clickText('+ Award a bonus');
    await settle();

    setValue(fieldInput('Person'), 'emp-1');
    setValue(fieldInput('Amount (₹)'), '12500.75');
    setValue(fieldInput('Why'), 'Cleared the March filing backlog');
    setValue(fieldInput('Paid in payroll month'), '2026-08');
    await settle();
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/manav/bonus-awards');
    expect(payload).toMatchObject({
      employee_id: 'emp-1',
      amount: 12500.75,
      reason: 'Cleared the March filing backlog',
      pay_period: '2026-08',
    });
  });
});

describe('the payroll month is a chosen value, not a typed one', () => {
  it('every offered month is exactly the shape vetana_payroll_runs.month uses', () => {
    for (const m of payrollMonths()) expect(m).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('and is shown to a person in words', () => {
    expect(monthLabel('2026-08')).toBe('August 2026');
    expect(monthLabel('')).toBe('—');
  });

  it('no native month or date control is used', async () => {
    await openTab([]);
    clickText('+ Award a bonus');
    await settle();
    expect(container.querySelector('input[type="month"]')).toBeNull();
    // The one hidden native date input DateInput keeps is not used on this
    // form at all — the month is a select.
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });
});

describe('eligibility is written as an action because it cannot be read back', () => {
  it('the screen says the answer cannot be read, rather than listing a guess', async () => {
    await openTab([]);
    expect(text()).toMatch(/can be set here but cannot be read back/i);
    expect(text()).toMatch(/does not show a list of who is eligible/i);
  });

  it('the recorded answer shown is the one the SERVER returned', async () => {
    await openTab([]);
    api.put.mockResolvedValue({ data: { employee: 'Priya Sharma', bonus_eligible: true } });

    const picker = [...container.querySelectorAll('select')]
      .find(s => [...s.options].some(o => o.textContent === 'Priya Sharma'));
    setValue(picker, 'emp-1');
    await settle();
    clickText('May be given a bonus');
    await settle();

    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/v1/manav/employees/emp-1/bonus-eligibility');
    expect(body).toEqual({ bonus_eligible: true });
    expect(text()).toMatch(/Recorded:/);
    expect(text()).toMatch(/may be given a bonus\./);
  });
});

describe('a list of awards', () => {
  const AWARD = {
    id: 'a1', employee_name: 'Priya Sharma', amount: 15000,
    reason: 'Cleared the March filing backlog', pay_period: '2026-08',
    awarded_at: '2026-08-20T10:00:00+05:30', notes: null,
  };

  it('shows the person by NAME and the month in words', async () => {
    await openTab([AWARD]);
    expect(text()).toContain('Priya Sharma');
    expect(text()).toContain('August 2026');
    expect(text()).toContain('Cleared the March filing backlog');
  });

  it('and says the award is picked up by its month, so a re-run does not pay twice', async () => {
    await openTab([AWARD]);
    expect(text()).toMatch(/re-running that month produces the same payslip/i);
  });
});
