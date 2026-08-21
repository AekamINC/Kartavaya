/**
 * Manav → Employees: "this person needs to sign in", and the default that
 * matters more than the checkbox.
 *
 * Measured read-only against the live database on 2026-08-21: 98 employee rows
 * across 3 organisations, 0 carrying a user_id, 32 accounts. The largest firm
 * has 71 employees and 7 accounts. A screen that links the two by hand shipped
 * the day before and it cannot work for most of those rows, because there is no
 * account on the other end to point at.
 *
 * The owner's correction, verbatim:
 *
 *   "Not all employee will be sales user or will need full login they will be
 *    only pachand [Pahchan] users. If users need to login for all this then when
 *    creating employee the forms need check box to check and it create login
 *    invite as well. so that it can link perfectly."
 *
 * So the properties pinned here are:
 *
 *   1. OFF BY DEFAULT, and nothing about the form changes while it is off. An
 *      employee with no login is the ORDINARY case, not an incomplete record.
 *   2. THE LABEL SAYS WHAT HAPPENS — both halves. Ticking it emails somebody an
 *      invitation and takes an organisation seat; leaving it off still gives you
 *      an employee who can be marked present in Pahchan and paid. A checkbox
 *      whose consequence is an email to a real person must not be discoverable
 *      only by ticking it.
 *   3. AN EMAIL IS REQUIRED ONLY WHEN IT IS TICKED. There is nowhere to send an
 *      invitation without one, and a great many employees legitimately have no
 *      address on file.
 *   4. A HIRE THAT SUCCEEDED WITH AN INVITATION THAT DID NOT SAYS SO. The
 *      backend commits the personnel file first and treats a failed invitation
 *      as costing the invitation, not the hire.
 *
 * The rules about who MAY create a login are backend-side and proven in
 * `backend/tests/test_employee_login_invite.py` — the pool is mocked there, so
 * they live where they can be exercised directly.
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
import EmployeesTab from '../EmployeesTab';

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
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/** The labelled input whose <span> label matches exactly. */
function fieldInput(label) {
  const spans = [...container.querySelectorAll('label > span')];
  const span = spans.find(s => s.textContent.trim() === label);
  return span ? span.parentElement.querySelector('input, select') : null;
}

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  ).set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pick(select, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value',
  ).set;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const clickText = (label) => {
  const el = [...container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === label);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  return el;
};

const submit = () => act(() => {
  container.querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});

/** The one checkbox in the "Signing in" block. */
const loginBox = () => fieldInput('This person needs to sign in to Kartavaya');

/** `.click()`, not a hand-set `.checked` plus a synthetic event. React binds a
 *  checkbox's onChange to the click event, and setting `.checked` first makes
 *  jsdom's own activation behaviour toggle it straight back off — the box ends
 *  up unticked and the test passes for the wrong reason. */
const tick = (box) => act(() => { box.click(); });

async function openForm() {
  api.get.mockResolvedValue({ data: { data: [] } });
  mount(<EmployeesTab />);
  await settle();
  clickText('+ Add employee');
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · Off by default
   ══════════════════════════════════════════════════════════════════════════ */

describe('the login checkbox starts off', () => {
  it('is present and unticked when the form opens', async () => {
    await openForm();
    const box = loginBox();
    expect(box, 'no "needs to sign in" checkbox on the new-employee form').toBeTruthy();
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false);
  });

  it('hides the role picker until somebody asks for a login', async () => {
    await openForm();
    expect(fieldInput('Role in the organisation')).toBeFalsy();
    tick(loginBox());
    expect(fieldInput('Role in the organisation')).toBeTruthy();
  });

  it('posts create_login false for an ordinary hire', async () => {
    await openForm();
    api.post.mockResolvedValue({ data: { status: 'created' } });

    type(fieldInput('Name *'), 'Rahul Mehta');
    submit();
    await settle();

    const [, payload] = api.post.mock.calls[0];
    expect(payload.create_login).toBe(false);
  });

  it('does not require an email address while it is off', async () => {
    await openForm();
    expect(fieldInput('Email').required).toBe(false);
    // And the label does not claim it is mandatory.
    expect(fieldInput('Email *')).toBeFalsy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The label says what happens, both ways
   ══════════════════════════════════════════════════════════════════════════ */

describe('what the screen tells the person deciding', () => {
  it('says ticking it emails an invitation to create an account', async () => {
    await openForm();
    const text = container.textContent;
    expect(text).toMatch(/email this person an invitation/i);
    expect(text).toMatch(/create a Kartavaya account/i);
  });

  it('says the account links to this employee record on acceptance', async () => {
    await openForm();
    expect(container.textContent).toMatch(/linked to this employee record/i);
  });

  it('says an invitation takes a seat, and takes it when SENT', async () => {
    // `org_invites.count_seats` counts pending invitations, so the seat is held
    // from the moment the mail goes out. An admin who reads "takes a seat when
    // they accept" will not understand why the org is full.
    await openForm();
    const text = container.textContent;
    expect(text).toMatch(/seat/i);
    expect(text).toMatch(/from the moment it is sent, not from the moment it is\s+accepted/i);
  });

  it('says what leaving it off means, in terms of what still works', async () => {
    await openForm();
    const text = container.textContent;
    expect(text).toMatch(/still exists as an employee/i);
    expect(text).toMatch(/marked present in Pahchan/i);
    expect(text).toMatch(/cannot sign in/i);
    // And that it is not a deficiency.
    expect(text).toMatch(/ordinary choice/i);
  });

  it('does not offer to make an organisation owner from a personnel form', async () => {
    await openForm();
    tick(loginBox());
    const values = [...fieldInput('Role in the organisation').options]
      .map(o => o.value);
    expect(values).toContain('org_member');
    expect(values).not.toContain('org_owner');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Ticked: the address becomes mandatory and the choice is posted
   ══════════════════════════════════════════════════════════════════════════ */

describe('with the box ticked', () => {
  it('marks the email address required and says so in the label', async () => {
    await openForm();
    tick(loginBox());
    expect(fieldInput('Email *'), 'the label still reads "Email"').toBeTruthy();
    expect(fieldInput('Email *').required).toBe(true);
  });

  it('refuses to submit without an address, and posts nothing', async () => {
    await openForm();
    api.post.mockResolvedValue({ data: { status: 'created' } });
    type(fieldInput('Name *'), 'Rahul Mehta');
    tick(loginBox());
    submit();
    await settle();

    expect(api.post).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/email address is needed/i);
  });

  it('posts create_login and the chosen role', async () => {
    await openForm();
    api.post.mockResolvedValue({
      data: { status: 'created', invite: { sent: true, email: 'rahul@example.com' } },
    });

    type(fieldInput('Name *'), 'Rahul Mehta');
    tick(loginBox());
    type(fieldInput('Email *'), 'rahul@example.com');
    pick(fieldInput('Role in the organisation'), 'org_admin');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/manav/employees');
    expect(payload.create_login).toBe(true);
    expect(payload.login_role).toBe('org_admin');
    expect(payload.email).toBe('rahul@example.com');
  });

  it('confirms the invitation went out, naming the address', async () => {
    await openForm();
    api.post.mockResolvedValue({
      data: { status: 'created', invite: { sent: true, email: 'rahul@example.com' } },
    });

    type(fieldInput('Name *'), 'Rahul Mehta');
    tick(loginBox());
    type(fieldInput('Email *'), 'rahul@example.com');
    submit();
    await settle();

    expect(container.textContent).toMatch(/invited/i);
    expect(container.textContent).toContain('rahul@example.com');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · The hire succeeded, the invitation did not
   ══════════════════════════════════════════════════════════════════════════ */

describe('when the employee is created but the invitation fails', () => {
  it('says both halves rather than reporting a clean success', async () => {
    // The backend commits the personnel file and then mints the invitation; a
    // failure there costs the invitation, not the hire. A toast saying only
    // "Employee added" would hide the half that did not happen, and the admin
    // would find out when the person never received anything.
    await openForm();
    api.post.mockResolvedValue({
      data: {
        status: 'created',
        invite: {
          sent: false,
          error: 'Creating a login needs migrations/187_invite_carries_the_employee.sql.',
        },
      },
    });

    type(fieldInput('Name *'), 'Rahul Mehta');
    tick(loginBox());
    type(fieldInput('Email *'), 'rahul@example.com');
    submit();
    await settle();

    const text = container.textContent;
    expect(text).toMatch(/Employee added/i);
    expect(text).toMatch(/invitation was not sent/i);
    expect(text).toContain('187_invite_carries_the_employee.sql');
  });
});
