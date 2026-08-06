/**
 * The Requests tab — Aekam's side of "Request this skill".
 *
 * The customer half has been complete for a while: the drawer files the ask,
 * the endpoint writes the row on a partial unique index, the card shows a
 * Requested pill. The Aekam half was an email and nothing else — no screen in
 * this product read `hub_skill_requests` except the customer's own catalogue,
 * reading back its own org's rows.
 *
 * What makes that a defect rather than a missing nicety is the shape of the
 * write path. `_announce_skill_request` is deliberately wrapped so a failing
 * mail cannot 500 the customer's request: the row commits, `notified_to` stays
 * empty, and the customer is told "Aekam has it". Correct — and it means the
 * empty array is the ONLY surviving trace of an ask that reached nobody. Until
 * there is a reader, that trace is unreadable.
 *
 * THREE STATES, NOT TWO, is most of what this file pins. `available:false`
 * (migration 112 unapplied) must not render as an empty queue: an operator who
 * reads "no requests" concludes customers are quiet, when in fact no request
 * could have been recorded at all.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws — the same
 * constraint `hub/skills/__tests__/catalogTab.test.jsx` records.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../../lib/api';
import RequestsTab from '../RequestsTab';

const REQ = (over = {}) => ({
  request_id: 'r1',
  org_id: 'org-a',
  org_name: 'Bharat Textiles',
  template_id: 't1',
  template_name: 'Chase overdue invoices',
  category: 'festival',
  requested_by: 'user_asha',
  requester_name: 'Asha Rao',
  requester_email: 'success+asha@simulator.amazonses.com',
  note: 'We chase forty invoices by hand every month.',
  status: 'open',
  requested_at: '2026-08-06T10:00:00Z',
  decided_at: null,
  decided_by: null,
  notified_to: ['success+accountmgr@simulator.amazonses.com'],
  already_active: false,
  ...over,
});

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

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

function serve(body) {
  api.get.mockImplementation(async (path) => {
    if (String(path).includes('/skills/requests')) {
      if (body instanceof Error) throw body;
      return { data: body };
    }
    return { data: {} };
  });
}

async function mount() {
  await act(async () => { root.render(<RequestsTab />); });
  await settle();
}

const text = () => container.textContent;


describe('the queue reads what the customer asked for', () => {
  it('names the org, the skill, the person and their note', async () => {
    // Every one of these is already in the email the same accounts receive.
    // The screen makes an existing disclosure durable; it adds none.
    serve({ available: true, data: [REQ()] });
    await mount();

    expect(text()).toContain('Bharat Textiles');
    expect(text()).toContain('Chase overdue invoices');
    expect(text()).toContain('Asha Rao');
    expect(text()).toContain('We chase forty invoices by hand every month.');
  });

  it('says a request left no note rather than rendering a blank line', async () => {
    serve({ available: true, data: [REQ({ note: '' })] });
    await mount();

    expect(text()).toContain('They left no note.');
  });

  it('asks the queue endpoint and not the org catalogue', async () => {
    // `GET /v1/hub/org/skills` returns the CALLER's own org's requests. Reading
    // Aekam's queue off it would show one org's asks and call it the queue.
    serve({ available: true, data: [] });
    await mount();

    expect(api.get).toHaveBeenCalledWith('/v1/hub/skills/requests');
  });
});


describe('an ask that reached nobody', () => {
  it('marks the row and says so in words', async () => {
    serve({ available: true, data: [REQ({ notified_to: [] })] });
    await mount();

    expect(container.querySelector('.mkq__row--unheard')).not.toBeNull();
    expect(text()).toContain('the notification failed');
  });

  it('counts them at the top, because a long queue buries one row', async () => {
    serve({
      available: true,
      data: [
        REQ({ request_id: 'r1', notified_to: [] }),
        REQ({ request_id: 'r2' }),
        REQ({ request_id: 'r3', notified_to: [] }),
      ],
    });
    await mount();

    expect(text()).toContain('2 requests reached nobody');
  });

  it('does not mark a DECIDED request with no recipients as unheard', async () => {
    // `notified_to` is empty on rows written before the fan-out ran and on rows
    // whose mail failed — but a decided request has already been acted on, so
    // "nobody was told" is no longer a thing anyone can do something about.
    serve({
      available: true,
      data: [REQ({ status: 'declined', notified_to: [], decided_at: '2026-08-07T09:00:00Z', decided_by: 'user_aekam' })],
    });
    await mount();

    expect(container.querySelector('.mkq__row--unheard')).toBeNull();
    expect(text()).not.toContain('reached nobody');
  });

  it('shows who WAS emailed when the fan-out worked', async () => {
    serve({ available: true, data: [REQ()] });
    await mount();

    expect(text()).toContain('success+accountmgr@simulator.amazonses.com');
    expect(container.querySelector('.mkq__row--unheard')).toBeNull();
  });
});


describe('dormant is not empty', () => {
  it('says requests cannot be recorded yet, and names the migration', async () => {
    serve({ available: false, data: [] });
    await mount();

    expect(text()).toContain('cannot be recorded');
    expect(text()).toContain('112');
  });

  it('never prints the empty-queue sentence over a dormant table', async () => {
    // The failure this forecloses: an operator reads "no open requests",
    // concludes the marketplace is quiet, and the truth is that the button in
    // the catalogue has been refusing every press.
    serve({ available: false, data: [] });
    await mount();

    expect(text()).not.toContain('No open requests');
  });

  it('says nobody has asked only when the table exists and is empty', async () => {
    serve({ available: true, data: [] });
    await mount();

    expect(text()).toContain('No open requests');
    expect(text()).not.toContain('112');
  });
});


describe('what the queue refuses to do', () => {
  it('offers no grant, approve or decline control', async () => {
    // `assign_skill_to_org` grants to the CALLER's active org, so there is no
    // sanctioned cross-org write behind such a button — and migration 112 is
    // explicit that `status='granted'` is a record of a grant, not the grant.
    // A control that recorded a grant nobody made is worse than no control.
    serve({ available: true, data: [REQ()] });
    await mount();

    const labels = [...container.querySelectorAll('button')]
      .map(b => b.textContent.toLowerCase());
    expect(labels.some(l => l.includes('grant'))).toBe(false);
    expect(labels.some(l => l.includes('approve'))).toBe(false);
    expect(labels.some(l => l.includes('decline'))).toBe(false);
    expect(labels.some(l => l.includes('assign'))).toBe(false);
  });

  it('reports already-active from the grant table even while the row is open', async () => {
    // An operator who granted the skill through the console touched no request
    // row. Reading `status` would keep showing a live ask for something that
    // has already been delivered.
    serve({ available: true, data: [REQ({ status: 'open', already_active: true })] });
    await mount();

    expect(text()).toContain('already active');
  });
});


describe('a failure is not an empty queue', () => {
  it('says the queue did not load and offers a retry', async () => {
    serve(new Error('gateway timeout'));
    await mount();

    expect(text()).toContain('did not load');
    expect(text()).not.toContain('No open requests');
    expect([...container.querySelectorAll('button')]
      .some(b => b.textContent.includes('Try again'))).toBe(true);
  });
});
