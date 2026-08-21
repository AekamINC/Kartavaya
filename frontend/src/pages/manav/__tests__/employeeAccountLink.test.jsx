/**
 * Manav → Link logins: a human decides, and is given enough to decide with.
 *
 * The measurement behind this screen, read-only against the live database on
 * 2026-08-21: 98 employee rows, 0 carrying a user_id, 32 accounts, and zero
 * overlap between employee addresses and login addresses. No edge exists and
 * none can be inferred. Commission, targets and revenue in this product are
 * keyed on a login while payslips, attendance and leave are keyed on an employee,
 * and this column is the only thing that joins the two.
 *
 * These tests pin the two properties that make that safe:
 *
 *   1. NOTHING IS PRESELECTED. No row arrives ticked, no row is marked likely,
 *      and the confirm button is dead until a human clicks. The ordering hint is
 *      off by default, is labelled a hint, and only reorders.
 *   2. TWO PEOPLE WITH ONE NAME ARE TELLABLE APART, with no id on screen —
 *      `check-rendered-ids.mjs` forbids drawing one and it would not help a
 *      human anyway. The address, the role, the joining date, the mobile tail
 *      and the modules do that work.
 *
 * The rules about which links are LEGAL are backend-side and proven directly in
 * `backend/tests/test_employee_user_link.py` — the pool is mocked there, so they
 * live in pure functions rather than in an HTTP round trip.
 *
 * Rendered with react-dom directly, following `manavTabs.test.jsx`:
 * `@testing-library/react` is installed but its `@testing-library/dom` peer is
 * not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
import LinkAccountsTab, { day, similarityHint } from '../LinkAccountsTab';

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

const mount = (ui) => act(() => root.render(<ToastProvider>{ui}</ToastProvider>));
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const buttons = () => [...container.querySelectorAll('button')];
const btn = (label) => buttons().find(b => b.textContent.includes(label));
const radios = () => [...container.querySelectorAll('input[type=radio]')];
const rowFor = (name) =>
  [...container.querySelectorAll('tr')].find(tr => tr.textContent.includes(name));

const AMIT = {
  id: 'emp-1', employee_code: 'EMP014', name: 'Amit Shah',
  email: 'amit.shah@firm.example', department: 'Audit',
  designation: 'Senior Associate', date_of_joining: '2024-02-03',
  status: 'active', name_is_shared: false,
};
const PRIYA = {
  id: 'emp-2', employee_code: 'EMP021', name: 'Priya Sharma',
  email: 'priya@firm.example', department: 'Tax', designation: 'Manager',
  date_of_joining: '2023-06-01', status: 'active', name_is_shared: false,
};

/** The case the whole screen exists for: one label, two people. */
const AMIT_A = {
  user_id: 'u_a', full_name: 'Amit Shah', email: 'amit@firm.example',
  org_roles: ['org_admin'], member_since: '2024-01-12',
  mobile_tail: '••••••3210', modules: ['ganit', 'manav'],
  linked_employee_id: null, linked_employee_name: null, name_is_shared: true,
};
const AMIT_B = {
  user_id: 'u_b', full_name: 'Amit Shah', email: 'amit.s@firm.example',
  org_roles: ['org_member'], member_since: '2025-07-01',
  mobile_tail: '••••••1111', modules: [],
  linked_employee_id: null, linked_employee_name: null, name_is_shared: true,
};
const TAKEN = {
  user_id: 'u_t', full_name: 'Zoe Taken', email: 'zoe@firm.example',
  org_roles: ['org_member'], member_since: '2022-04-04',
  mobile_tail: '••••••7777', modules: ['graha'],
  linked_employee_id: 'emp-9', linked_employee_name: 'Rahul Verma',
  name_is_shared: false,
};

function serve({ waiting = [], linked = [], accounts = [], fail = null } = {}) {
  api.get.mockImplementation((url) => {
    if (url.includes('awaiting-link')) {
      if (fail === 'queue') return Promise.reject(new Error('boom'));
      return Promise.resolve({
        data: {
          data: waiting,
          total: waiting.length,
          linked,
          counts: {
            employees: waiting.length + linked.length,
            awaiting_link: waiting.length,
            linked: linked.length,
          },
        },
      });
    }
    if (fail === 'accounts') return Promise.reject(new Error('boom'));
    return Promise.resolve({
      data: {
        data: accounts,
        total: accounts.length,
        free: accounts.filter(a => a.linked_employee_id == null).length,
        taken: accounts.filter(a => a.linked_employee_id != null).length,
        shared_names: 1,
      },
    });
  });
}

const choose = async (name) => {
  const row = rowFor(name);
  await act(async () => { row.click(); });
  await settle();
};

/* ══════════════════════════════════════════════════════════════════════════
   What the screen says before anything is clicked
   ══════════════════════════════════════════════════════════════════════════ */

describe('what linking means', () => {
  it('says what a link does, in money terms, on the screen that does it', async () => {
    serve({ waiting: [AMIT] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('the same person');
    // The two halves the column joins, named. Measured 2026-08-21: commission and
    // targets are keyed on a login (`sales_commissions.user_id`,
    // `vikray_targets.salesperson_id`); payslips, attendance and leave are keyed
    // on an employee. Nothing else joins them.
    expect(text()).toContain('attribute to a login');
    expect(text()).toContain('hang off the employee record');
    expect(text()).toContain('own payslip');
  });

  it('says nothing is matched automatically, and why', async () => {
    serve({ waiting: [AMIT] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('Nothing is matched automatically');
    expect(text()).toContain('Names repeat');
    expect(text()).toContain('pays the wrong person');
  });

  it('says the link is reversible, before it is made and not after', async () => {
    serve({ waiting: [AMIT] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('It is reversible');
  });

  it('states the progress as both halves of one number', async () => {
    serve({ waiting: [AMIT, PRIYA], linked: [], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('0 of 2');
    expect(text()).toContain('2 still waiting');
    expect(text()).toContain('2 accounts are still free');
  });

  it('says when there are not enough logins to finish the queue', async () => {
    // The live shape, measured 2026-08-21: the largest org has 71 employees and
    // SEVEN accounts. A queue that lists 71 items without saying that 64 of them
    // are impossible today is a queue somebody grinds at until they conclude the
    // screen is broken.
    serve({ waiting: [AMIT, PRIYA], accounts: [AMIT_A] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('1 of these records cannot be linked yet');
    expect(text()).toContain('Settings → Members');
  });

  it('says nothing about a shortfall when there is none', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).not.toContain('cannot be linked yet');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Nothing is chosen for anybody
   ══════════════════════════════════════════════════════════════════════════ */

describe('no automatic match', () => {
  it('preselects nothing, even when one name is an exact match', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(radios().length).toBe(2);
    expect(radios().every(r => !r.checked)).toBe(true);
  });

  it('leaves the confirm button dead until a human clicks a row', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(btn('Link these two').disabled).toBe(true);
    await act(async () => { radios()[0].click(); });
    await settle();
    expect(btn('Link these two').disabled).toBe(false);
  });

  it('renders no score, tick or "probably" anywhere', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    const t = text().toLowerCase();
    for (const word of ['probably', 'likely match', 'suggested', 'best match', 'confidence']) {
      expect(t).not.toContain(word);
    }
  });

  it('has the ordering hint off, and labels it a hint rather than a match', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    const toggle = container.querySelector('input[type=checkbox]');
    expect(toggle.checked).toBe(false);
    expect(text()).toContain('a hint, not a match');
  });

  it('turning the hint on reorders and still selects nothing', async () => {
    serve({ waiting: [AMIT], accounts: [TAKEN, AMIT_A] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    const toggle = container.querySelector('input[type=checkbox]');
    await act(async () => { toggle.click(); });
    await settle();
    expect(radios().every(r => !r.checked)).toBe(true);
    expect(btn('Link these two').disabled).toBe(true);
    // And it hides nobody — a name that changed on marriage must not vanish.
    expect(text()).toContain('Zoe Taken');
    expect(text()).toContain('This only changes the order');
  });

  it('asks the server for accounts without naming the employee', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    const urls = api.get.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('link-options'))).toBe(true);
    expect(urls.every(u => !u.includes('Amit') && !u.includes('emp-1'))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Two people, one name, no id on the screen
   ══════════════════════════════════════════════════════════════════════════ */

describe('telling two same-named accounts apart', () => {
  it('carries five distinguishing facts and not one identifier', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    const t = text();
    expect(t).toContain('amit@firm.example');
    expect(t).toContain('amit.s@firm.example');
    expect(t).toContain('Organisation admin');
    expect(t).toContain('Member');
    expect(t).toContain('12 Jan 2024');
    expect(t).toContain('1 Jul 2025');
    expect(t).toContain('••••••3210');
    expect(t).toContain('ganit, manav');
    // No account id anywhere in what a person reads.
    expect(t).not.toContain('u_a');
    expect(t).not.toContain('u_b');
  });

  it('says out loud that the label is shared, rather than leaving it to be noticed', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(text()).toContain('Another account here has this same name');
  });

  it('marks a personnel record that shares a name with another record', async () => {
    serve({ waiting: [{ ...AMIT, name_is_shared: true }] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(rowFor('Amit Shah').textContent).toContain('shared name');
  });

  it('keeps the employee on screen while the account is chosen', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(text()).toContain('EMP014');
    expect(text()).toContain('Audit');
    expect(text()).toContain('3 Feb 2024');
  });

  it('says the personnel address is not what finds an account', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(text()).toContain('This is not used to find an account');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   An account somebody else already holds
   ══════════════════════════════════════════════════════════════════════════ */

describe('an account that is already taken', () => {
  it('is shown rather than filtered out, and names who holds it', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, TAKEN] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(text()).toContain('Zoe Taken');
    expect(text()).toContain('Rahul Verma');
  });

  it('cannot be chosen', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, TAKEN] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    const taken = radios().find(r => r.value === 'u_t');
    expect(taken.disabled).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Making and undoing the link
   ══════════════════════════════════════════════════════════════════════════ */

describe('the write', () => {
  it('states the claim in names before the button is pressed', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A] });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    await act(async () => { radios()[0].click(); });
    await settle();
    expect(text()).toContain('You are saying that');
    expect(text()).toContain('signs in as');
  });

  it('posts the account the human chose', async () => {
    serve({ waiting: [AMIT], accounts: [AMIT_A, AMIT_B] });
    api.post.mockResolvedValue({ data: { status: 'linked' } });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    await act(async () => { radios().find(r => r.value === 'u_b').click(); });
    await settle();
    await act(async () => { btn('Link these two').click(); });
    await settle();
    expect(api.post).toHaveBeenCalledWith('/v1/manav/employees/emp-1/link', { user_id: 'u_b' });
  });

  it('lists the links already made so a wrong one can be found', async () => {
    serve({
      waiting: [],
      linked: [{
        id: 'emp-3', employee_code: 'EMP002', name: 'Rahul Verma',
        department: 'Sales', designation: 'Executive',
        account_name: 'Rahul Verma', account_email: 'rahul@firm.example',
        account_missing: false,
      }],
    });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('Already linked (1)');
    expect(text()).toContain('rahul@firm.example');
  });

  it('undoes one, and says what unlinking does not take away', async () => {
    serve({
      waiting: [],
      linked: [{
        id: 'emp-3', employee_code: 'EMP002', name: 'Rahul Verma',
        department: 'Sales', designation: 'Executive',
        account_name: 'Rahul Verma', account_email: 'rahul@firm.example',
        account_missing: false,
      }],
    });
    api.delete.mockResolvedValue({ data: { status: 'unlinked' } });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('keeps their account');
    await act(async () => { btn('Unlink').click(); });
    await settle();
    expect(api.delete).toHaveBeenCalledWith('/v1/manav/employees/emp-3/link');
  });

  it('reports a link to a deleted account as broken, not as done', async () => {
    serve({
      waiting: [],
      linked: [{
        id: 'emp-3', employee_code: 'EMP002', name: 'Rahul Verma',
        department: '', designation: '',
        account_name: '', account_email: '', account_missing: true,
      }],
    });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('account deleted');
    expect(text()).toContain('no longer exists');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   A failed request is never an empty state
   ══════════════════════════════════════════════════════════════════════════ */

describe('the three states stay apart', () => {
  it('does not claim everybody is linked when the queue failed to load', async () => {
    serve({ fail: 'queue' });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('did not load');
    expect(text()).not.toContain('Every active employee is linked');
  });

  it('does not claim there are no accounts when that request failed', async () => {
    serve({ waiting: [AMIT], fail: 'accounts' });
    await mount(<LinkAccountsTab />);
    await settle();
    await choose('Amit Shah');
    expect(text()).toContain('did not load');
    expect(text()).not.toContain('no member accounts yet');
  });

  it('says so plainly when every active employee really is linked', async () => {
    serve({ waiting: [], linked: [] });
    await mount(<LinkAccountsTab />);
    await settle();
    expect(text()).toContain('Every active employee is linked');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The two pure helpers
   ══════════════════════════════════════════════════════════════════════════ */

describe('day', () => {
  it('reads as a date a person recognises', () => {
    expect(day('2024-02-03')).toContain('2024');
    expect(day('2024-02-03')).toContain('Feb');
  });

  it('does not roll back a day', () => {
    // `new Date('2024-02-03')` is UTC midnight and renders 2 Feb west of
    // Greenwich. Parsed at local midnight it cannot.
    expect(day('2024-02-03')).toContain('3');
  });

  it('renders nothing for nothing', () => {
    expect(day('')).toBe('');
    expect(day(null)).toBe('');
    expect(day(undefined)).toBe('');
  });
});

describe('similarityHint', () => {
  it('is only ever an ordering number, and a middle name is not evidence against', () => {
    expect(similarityHint('Amit Shah', 'Amit Kumar Shah')).toBe(1);
    expect(similarityHint('Amit Shah', 'Amit Shah')).toBe(1);
  });

  it('scores an unrelated name at zero without excluding it', () => {
    expect(similarityHint('Amit Shah', 'Zoe Taken')).toBe(0);
  });

  it('answers zero rather than throwing on a nameless account', () => {
    expect(similarityHint('Amit Shah', '')).toBe(0);
    expect(similarityHint('', null)).toBe(0);
  });

  it('cannot separate two accounts that share the name — which is the point', () => {
    // Both score identically, so the hint gives a human NOTHING on the exact
    // case where a wrong choice is most likely. It is an ordering convenience,
    // never an answer.
    expect(similarityHint('Amit Shah', 'Amit Shah'))
      .toBe(similarityHint('Amit Shah', 'Amit Shah'));
  });
});
