/**
 * Manav → DSC, UDIN, Notices, Custody — the four registers, now writable.
 *
 * Three of the four tabs rendered an honest empty state that ended "there is no
 * way to add one from this screen yet", and it was true: `staging.dsc_register`,
 * `staging.udin_register` and `staging.notice_register` all held 0 rows on
 * 2026-08-21 because nothing in the product could put one there. A register
 * nobody can add to is a compliance claim a firm cannot actually make.
 *
 * What this file pins is not that the forms exist — a screenshot shows that. It
 * is the four judgements the forms had to encode, each of which is invisible
 * once it is right and wrong in a way nobody notices:
 *
 *   1. THE DSC FORM OFFERS NO STATUS. All five verdicts are derived, and two of
 *      them have their own control (a revocation date, a custody move) rather
 *      than a dropdown entry.
 *   2. AN OMITTED CLIENT IS `null`, NEVER `''`. An empty string reaching a
 *      `::uuid` cast is an instant 500, and an absent client MEANS the
 *      practice's own certificate.
 *   3. THE UDIN "ADD UDIN" CONTROL DISAPPEARS ONCE THE WINDOW HAS CLOSED. The
 *      ICAI portal will not issue a number then, so offering the button offers
 *      to record something that cannot have happened.
 *   4. THE NOTICE FORM NEVER SENDS A STATUTORY WINDOW, and requires a reply-by
 *      date exactly when the statute fixes no period at all.
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
import DscTab from '../DscTab';
import UdinTab from '../UdinTab';
import NoticesTab from '../NoticesTab';
import CustodyTab from '../CustodyTab';

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

/** The labelled control whose `<span>` label matches exactly. */
function field(label) {
  const spans = [...container.querySelectorAll('label > span')];
  const span = spans.find(s => s.textContent.trim() === label);
  return span ? span.parentElement.querySelector('input, select, textarea') : null;
}

/**
 * Is the `DateInput` under this label required?
 *
 * Not `input.required`. `DateInput` keeps a hidden native input for
 * serialisation and programmatic values and deliberately does not forward
 * `required` to it, because a hidden required field makes the browser refuse to
 * submit with a message it cannot show. The requirement lives as
 * `aria-required` on the visible trigger.
 */
function dateRequired(label) {
  const spans = [...container.querySelectorAll('label > span')];
  const span = spans.find(s => s.textContent.trim() === label);
  const trigger = span && span.parentElement.querySelector('button.pk__tr');
  return Boolean(trigger && trigger.getAttribute('aria-required') === 'true');
}

function labels() {
  return [...container.querySelectorAll('label > span')]
    .map(s => s.textContent.trim());
}

function buttons(text) {
  return [...container.querySelectorAll('button')]
    .filter(b => b.textContent.trim() === text);
}

function click(text) {
  const el = buttons(text)[0];
  if (!el) throw new Error(`no button reading "${text}"; have ${
    [...container.querySelectorAll('button')].map(b => b.textContent.trim())
  }`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  return el;
}

function type(input, value) {
  const proto = input.tagName === 'SELECT'
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input',
      { bubbles: true }));
  });
}

function submit(index = 0) {
  const form = container.querySelectorAll('form')[index];
  act(() => form.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  ));
}

/** Answer `api.get` by URL, so a screen that reads three endpoints is not
 *  hostage to the order it happens to read them in. */
function routes(map) {
  api.get.mockImplementation((url) => {
    for (const [needle, body] of Object.entries(map)) {
      if (String(url).startsWith(needle)) return Promise.resolve({ data: body });
    }
    return Promise.resolve({ data: { data: [] } });
  });
}

const CLIENTS = { data: [{ id: 'c-1', name: 'Sharma Textiles Pvt Ltd' }] };

const CERT = {
  id: 'd-1',
  client_name: 'Sharma Textiles Pvt Ltd',
  belongs_to_firm: false,
  holder_name: 'Anil Sharma',
  holder_designation: 'Director',
  certificate_class: 'class_3',
  issuing_authority_canonical: 'e-Mudhra',
  valid_to: '2027-02-28',
  days_to_expiry: 556,
  custody_status: 'with_firm',
  custody_location: 'Cabinet 2',
  revoked_on: null,
  status: 'usable',
  warnings: [],
};

const dscBody = (rows) => ({
  as_of: '2026-08-21',
  data: rows,
  count: rows.length,
  summary: {
    usable: rows.length, not_in_possession: 0, not_yet_valid: 0,
    expired: 0, revoked: 0, total: rows.length,
  },
  note: 'This is the complete register.',
});


/* ══════════════════════════════════════════════════════════════════════════
   DSC
   ══════════════════════════════════════════════════════════════════════════ */

describe('the DSC register can be added to', () => {
  it('the empty state stops claiming nothing can be added', async () => {
    routes({ '/v1/custody/dsc': dscBody([]) });
    mount(<DscTab />);
    await settle();
    expect(container.textContent).not.toContain('no way to add');
    expect(container.textContent).toContain('Record the first one');
    expect(buttons('+ Record a certificate').length).toBe(1);
  });

  it('offers no status field, because all five verdicts are derived', async () => {
    routes({ '/v1/custody/dsc': dscBody([]), '/v1/custody/clients': CLIENTS });
    mount(<DscTab />);
    await settle();
    click('+ Record a certificate');
    await settle();

    // Not "no field called Status" as a spelling — the two facts a person CAN
    // record are offered and the verdict is not.
    expect(labels()).not.toContain('Status');
    expect(labels()).toContain('Where the token is');
    expect(container.textContent).toContain('There is no status to choose');
  });

  it('an omitted client is posted as null and never as an empty string', async () => {
    // `''` reaching a `::uuid` cast is an instant PgBouncer 500 rather than a
    // null, and an absent client MEANS the practice's own certificate.
    routes({ '/v1/custody/dsc': dscBody([]), '/v1/custody/clients': CLIENTS });
    api.post.mockResolvedValue({ data: { ...CERT, status: 'usable' } });
    mount(<DscTab />);
    await settle();
    click('+ Record a certificate');
    await settle();

    type(field('Holder’s name *'), 'Anil Sharma');
    type(field('Valid from *'), '2025-03-01');
    type(field('Valid to *'), '2027-02-28');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/dsc');
    expect(payload.client_id).toBeNull();
    expect(payload.holder_name).toBe('Anil Sharma');
    // The status is never sent at all.
    expect(payload.status).toBeUndefined();
  });

  it('the portal list is split into names rather than posted as one string', async () => {
    routes({ '/v1/custody/dsc': dscBody([]), '/v1/custody/clients': CLIENTS });
    api.post.mockResolvedValue({ data: CERT });
    mount(<DscTab />);
    await settle();
    click('+ Record a certificate');
    await settle();

    type(field('Holder’s name *'), 'Anil Sharma');
    type(field('Valid from *'), '2025-03-01');
    type(field('Valid to *'), '2027-02-28');
    type(field('Registered on'), 'incometax, mca');
    submit();
    await settle();

    expect(api.post.mock.calls[0][1].registered_portals).toEqual(['incometax', 'mca']);
  });

  it('a revocation is recorded against the row, with its own date', async () => {
    routes({ '/v1/custody/dsc': dscBody([CERT]) });
    api.post.mockResolvedValue({ data: {} });
    mount(<DscTab />);
    await settle();
    click('Revoke');
    await settle();

    type(field('Revoked from *'), '2026-06-01');
    type(field('Why'), 'Holder left the company');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/dsc/d-1/revoke');
    expect(payload.revoked_on).toBe('2026-06-01');
    expect(payload.reason).toBe('Holder left the company');
  });

  it('a certificate already carrying a revocation offers no revoke control', async () => {
    // The server refuses a second revocation rather than replacing the first —
    // a register with two dates and no way to say which is which — so the
    // control is simply absent rather than present and doomed.
    routes({ '/v1/custody/dsc': dscBody([{ ...CERT, revoked_on: '2026-03-12', status: 'revoked' }]) });
    mount(<DscTab />);
    await settle();
    expect(buttons('Revoke').length).toBe(0);
    expect(buttons('Custody').length).toBe(1);
  });

  it('a custody move is its own control, and posts where the token went', async () => {
    routes({ '/v1/custody/dsc': dscBody([CERT]) });
    api.post.mockResolvedValue({ data: {} });
    mount(<DscTab />);
    await settle();
    click('Custody');
    await settle();

    type(field('It is now *'), 'with_client');
    type(field('Held by'), 'Anil Sharma');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/dsc/d-1/custody');
    expect(payload.custody_status).toBe('with_client');
    expect(payload.custody_holder_name).toBe('Anil Sharma');
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   UDIN
   ══════════════════════════════════════════════════════════════════════════ */

const SIGNING = {
  id: 'u-1',
  client_name: 'Sharma Textiles Pvt Ltd',
  document_kind: 'certificate',
  document_kind_label: 'Certificate',
  document_title: 'Net worth certificate',
  document_ref: 'NW/26/11',
  financial_year: '2026-27',
  signed_on: '2026-08-01',
  signed_by_member: 'CA Anil Sharma',
  signed_by_membership_no: '304576',
  generate_by: '2026-09-29',
  day_of_window: 21,
  window_days: 60,
  days_left: 39,
  is_lapsed: false,
  urgency: 'open',
};

const UDIN_SUMMARY = {
  as_of: '2026-08-21',
  by_status: { signed: 1, generated: 0, revoked: 0, not_required: 0 },
  open_by_urgency: {},
  open_total: 1,
  lapsed: 0,
  next_deadline: '2026-09-29',
  window_days: 60,
  revoke_window_hours: 48,
  window_sources: { generate: 'table', revoke: 'table' },
};

function udinRoutes(rows, extra = {}) {
  routes({
    '/v1/custody/udin/summary': UDIN_SUMMARY,
    '/v1/custody/udin/at-risk': { as_of: '2026-08-21', data: rows, count: rows.length },
    '/v1/custody/udin/revocable': { now: '', data: [], count: 0 },
    '/v1/custody/clients': CLIENTS,
    ...extra,
  });
}

describe('the UDIN register can be added to, and the window is honoured', () => {
  it('the signing form carries no UDIN field — a row is born unnumbered', async () => {
    udinRoutes([]);
    mount(<UdinTab />);
    await settle();
    click('+ Record a signing');
    await settle();

    expect(labels()).not.toContain('UDIN *');
    expect(labels()).toContain('Signed on *');
    expect(container.textContent).toContain('The number is not recorded here');
  });

  it('a signing is posted with the client snapshot, not just the link', async () => {
    udinRoutes([]);
    api.post.mockResolvedValue({ data: { ...SIGNING, is_lapsed: false } });
    mount(<UdinTab />);
    await settle();
    click('+ Record a signing');
    await settle();

    type(field('Recorded as *'), 'Sharma Textiles Pvt Ltd');
    type(field('Document *'), 'Net worth certificate');
    type(field('Signed on *'), '2026-08-01');
    type(field('Signed by *'), 'CA Anil Sharma');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/udin');
    expect(payload.client_name).toBe('Sharma Textiles Pvt Ltd');
    expect(payload.signed_on).toBe('2026-08-01');
    expect(payload.udin).toBeUndefined();
  });

  it('a row inside its window offers the number, and a lapsed one does not', async () => {
    udinRoutes([SIGNING]);
    mount(<UdinTab />);
    await settle();
    expect(buttons('Add UDIN').length).toBe(1);

    act(() => root.unmount());
    root = createRoot(container);
    udinRoutes([{ ...SIGNING, is_lapsed: true, days_left: -3, urgency: 'lapsed' }]);
    mount(<UdinTab />);
    await settle();
    // The portal will not issue a number now, so offering the control would be
    // offering to record something that cannot have happened. The row stays,
    // and it stays in the lapsed count.
    expect(buttons('Add UDIN').length).toBe(0);
    expect(buttons('Not required').length).toBe(1);
  });

  it('the number is posted to the generate route, on the row', async () => {
    udinRoutes([SIGNING]);
    api.post.mockResolvedValue({ data: {} });
    mount(<UdinTab />);
    await settle();
    click('Add UDIN');
    await settle();

    type(field('UDIN *'), '26304576AKTSBN1359');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/udin/u-1/generate');
    expect(payload.udin).toBe('26304576AKTSBN1359');
    // The clock is the server's. Nothing here sends one.
    expect(payload.generated_at ?? null).toBeNull();
  });

  it('"not required" demands a reason, because it is a judgement', async () => {
    udinRoutes([SIGNING]);
    api.post.mockResolvedValue({ data: {} });
    mount(<UdinTab />);
    await settle();
    click('Not required');
    await settle();

    const why = field('Why *');
    expect(why.required).toBe(true);
    type(why, 'Not an attestation function');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/udin/u-1/not-required');
    expect(payload.reason).toBe('Not an attestation function');
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   Notices
   ══════════════════════════════════════════════════════════════════════════ */

const TYPES = {
  data: [
    {
      code: 'gst_asmt_10', label: 'GST ASMT-10 — scrutiny of returns',
      authority: 'gst', form_no: 'ASMT-10', reply_form_no: 'ASMT-11',
      statute_ref: 'rule 99(1)', window_basis: 'statutory_max',
      reply_window_days: 30, reply_window_months: 0,
      window_in_working_days: false, is_system: true,
      consequence: 's.73/74 determination', source_url: '',
    },
    {
      code: 'gst_drc_01', label: 'GST DRC-01 — show cause notice',
      authority: 'gst', form_no: 'DRC-01', reply_form_no: 'DRC-06',
      statute_ref: 'rule 142', window_basis: 'notice_specified',
      reply_window_days: 0, reply_window_months: 0,
      window_in_working_days: false, is_system: true,
      consequence: 'A determination is passed on the record as it stands.',
      source_url: '',
    },
  ],
};

const NOTICE = {
  id: 'n-1',
  reference_no: 'ZA2708260001',
  received_on: '2026-08-01',
  due_on: '2026-08-31',
  due_date_from_notice: false,
  status: 'open',
  client_name: 'Sharma Textiles Pvt Ltd',
  notice_type: 'gst_asmt_10',
  notice_type_label: 'GST ASMT-10 — scrutiny of returns',
  authority: 'gst',
  form_no: 'ASMT-10',
  reply_form_no: 'ASMT-11',
  statute_ref: 'rule 99(1)',
  owner_name: 'Priya Nair',
  urgency: { band: 'soon', days_remaining: 10, due_on: '2026-08-31', conservative: false },
  urgency_note: '10 days left.',
};

function noticeRoutes(rows) {
  routes({
    '/v1/custody/notices/types': TYPES,
    '/v1/custody/notices': { as_of: '2026-08-21', data: rows, count: rows.length },
    '/v1/custody/clients': CLIENTS,
  });
}

describe('the notice register can be added to, and never overwritten', () => {
  it('the empty state stops claiming nothing can be added', async () => {
    noticeRoutes([]);
    mount(<NoticesTab />);
    await settle();
    expect(container.textContent).not.toContain('no way to add');
    expect(buttons('+ File a notice').length).toBe(1);
  });

  it('no statutory window is ever posted — it is snapshotted server-side', async () => {
    noticeRoutes([]);
    api.post.mockResolvedValue({ data: { ...NOTICE } });
    mount(<NoticesTab />);
    await settle();
    click('+ File a notice');
    await settle();

    type(field('Client *'), 'c-1');
    type(field('Notice *'), 'gst_asmt_10');
    type(field('Department reference *'), 'ZA2708260001');
    type(field('Served on *'), '2026-08-01');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/notices');
    expect(payload.notice_type_code).toBe('gst_asmt_10');
    for (const key of Object.keys(payload)) {
      expect(key).not.toMatch(/window/);
    }
    // An empty date field is null, never '' — `''` at a `::date` cast is a 500.
    expect(payload.due_on_override).toBeNull();
  });

  it('a form whose statute fixes no reply period requires the date off the paper', async () => {
    // rule 142 prescribes none for a DRC-01. Without it the row would resolve
    // to `received_on + 0` — due the day it arrived, then overdue for ever.
    noticeRoutes([]);
    mount(<NoticesTab />);
    await settle();
    click('+ File a notice');
    await settle();

    expect(field('Reply by, if stated')).toBeTruthy();
    expect(dateRequired('Reply by, if stated')).toBe(false);

    type(field('Notice *'), 'gst_drc_01');
    await settle();

    // The label itself changes, and so does the requirement. `DateInput`
    // deliberately does NOT forward `required` to its hidden native input — a
    // hidden required field makes the browser refuse to submit with an error it
    // cannot show — so the requirement is carried as `aria-required` on the
    // trigger, and that is what has to be asserted.
    expect(field('Reply by *')).toBeTruthy();
    expect(dateRequired('Reply by *')).toBe(true);
    expect(container.textContent).toContain('read off the notice itself');
  });

  it('a terminal notice offers nothing to record', async () => {
    noticeRoutes([{
      ...NOTICE, status: 'closed',
      urgency: { band: 'stopped', days_remaining: null, due_on: '2026-08-31', conservative: false },
      urgency_note: 'The clock has stopped.',
    }]);
    mount(<NoticesTab />);
    await settle();
    // Closed is the end of this row. The department's next step is a new notice
    // with its own reference and its own clock.
    expect(buttons('Record').length).toBe(0);
    expect(buttons('Reply date').length).toBe(0);
  });

  it('a reply is recorded against the row with its own date', async () => {
    noticeRoutes([NOTICE]);
    api.post.mockResolvedValue({ data: {} });
    mount(<NoticesTab />);
    await settle();
    click('Record');
    await settle();

    type(field('On'), '2026-08-20');
    type(field('Note'), 'ASMT-11 filed');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/notices/n-1/status');
    expect(payload.status).toBe('replied');
    expect(payload.on_date).toBe('2026-08-20');
  });

  it('changing the reply date says what it is replacing', async () => {
    noticeRoutes([NOTICE]);
    api.post.mockResolvedValue({ data: {} });
    mount(<NoticesTab />);
    await settle();
    click('Reply date');
    await settle();

    expect(container.textContent).toContain('Currently 2026-08-31');
    type(field('Reply by *'), '2026-09-15');
    type(field('Why'), 'Extension granted');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/notices/n-1/due-date');
    expect(payload.due_on_override).toBe('2026-09-15');
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   Custody — what the scan cannot find
   ══════════════════════════════════════════════════════════════════════════ */

const EXIT_LIST = {
  data: [{
    id: 'o-1', employee_id: 'e-1', employee_name: 'Priya Sharma',
    status: 'in_progress', last_working_day: '2026-09-30',
  }],
};

const CUSTODY = {
  leaver: { employee_name: 'Priya Sharma', login_link: 'unresolved' },
  unknown: true,
  clear: false,
  counts: { tasks: 0, clients: 0, follow_ups: 0, access: 0 },
  tasks: [], clients: [], follow_ups: [], access: [],
  ledger_outstanding: [],
};

describe('a leaver can be recorded as holding something the scan cannot see', () => {
  it('the form posts a line with no subject_ref, because there is no row to point at', async () => {
    routes({
      '/v1/manav/offboarding': EXIT_LIST,
      '/v1/custody/offboarding/e-1': CUSTODY,
    });
    api.post.mockResolvedValue({ data: {} });
    mount(<CustodyTab />);
    await settle();

    type(field('Whose exit'), 'e-1');
    await settle();

    click('+ Record something they hold');
    await settle();

    type(field('Which one *'), 'Sharma Textiles DSC token');
    type(field('Hand over or shut off'), 'revoke');
    submit();
    await settle();

    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/custody/offboarding/e-1/lines');
    expect(payload.subject_type).toBe('dsc_token');
    expect(payload.subject_label).toBe('Sharma Textiles DSC token');
    expect(payload.action).toBe('revoke');
    // No row in this product to point at — which is exactly why it had to be
    // typed in. The upsert key is partial on the ref being non-null, so a
    // second submission is a second line rather than a silent overwrite.
    expect(payload.subject_ref).toBeNull();
  });

  it('a waived line cannot be recorded without a reason', async () => {
    routes({
      '/v1/manav/offboarding': EXIT_LIST,
      '/v1/custody/offboarding/e-1': CUSTODY,
    });
    mount(<CustodyTab />);
    await settle();
    type(field('Whose exit'), 'e-1');
    await settle();
    click('+ Record something they hold');
    await settle();

    type(field('Where it stands'), 'waived');
    await settle();
    const reason = field('Waived because *');
    expect(reason).toBeTruthy();
    expect(reason.required).toBe(true);
  });
});
