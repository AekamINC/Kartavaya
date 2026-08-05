/**
 * The outbound log tells the truth about four things, or it is worse than
 * nothing.
 *
 * The block exists because an AWS alert — 2,586 of 3,000 SES message units gone
 * for the month — could not be answered. The honest answer took an hour of
 * inference and was still only a floor, because nothing recorded a send. A
 * screen that replaces that floor with a figure which merely LOOKS complete has
 * not fixed the problem; it has hidden it behind a number.
 *
 * So these pin the claims the screen must never make:
 *
 *   1. A SUPPRESSED SEND IS NOT A SENT ONE. `OUTBOUND_MODE=dry` is set on
 *      staging, so on staging every one of these rows is suppressed. Folding
 *      them into a "sent" total is the exact bug that once made a campaign
 *      report "3 sent" for a send that went nowhere.
 *   2. A SEND WITH NO PROVIDER MESSAGE ID IS NOT EVIDENCE. It is a record that
 *      we tried, and it must not render like one that can be looked up at the
 *      provider.
 *   3. ROWS BEFORE THE LOG EXISTED DO NOT EXIST, and neither do sends that
 *      carry no organisation. Both are floors and both have to say so.
 *   4. AN ABSENT TABLE IS NOT AN EMPTY MONTH. A 503 must render as the server's
 *      sentence, never as zeros.
 *
 * Rendered with react-dom directly, not @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws.
 * `grahaTabStates.test.jsx` and `kanbanTab.test.jsx` record the same
 * constraint.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the transport is mocked. Everything else in `lib/api` stays real, per
// the note in kanbanTab.test.jsx — a bare factory leaves the helpers undefined
// and anything unwrapping through them throws on render.
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import OutboundLog from '../OutboundLog';

const NONE = {
  sent: 0, confirmed: 0, suppressed: 0, failed: 0, unanswered: 0, other: 0,
  total: 0, ses_units: 0, unmeasured: 0,
};

/** A period the log covers in full — nothing to warn about. */
const COVERED = {
  org_id: 'org-1',
  period: '2026-08',
  period_start: '2026-08-01',
  period_end: '2026-09-01',
  recording_since: '2026-07-02T04:00:00+00:00',
  covers_whole_period: true,
  excludes_orgless: true,
  totals: { ...NONE, sent: 40, confirmed: 40, total: 40, ses_units: 52 },
  by_status: { sent: 40 },
  by_mode: { live: 40 },
  kill_switch_bypassed: 0,
  purposes: [
    {
      ...NONE, purpose: 'payslip', channel: 'email', label: 'Payslip',
      sent: 40, confirmed: 40, total: 40, ses_units: 52,
      last_at: '2026-08-01T06:30:00+00:00',
    },
  ],
  statuses: ['sent', 'suppressed', 'failed', 'attempted', 'queued'],
};

let host;
let root;

async function render(node) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(node); });
  return host;
}

function text() {
  return host.textContent.replace(/\s+/g, ' ');
}

/**
 * The FIGURE on a stat tile, not the tile's whole text.
 *
 * Asserting over the tile as a string is not good enough here, and it was not
 * good enough in practice: the "Sent" tile carries "N of these came back with a
 * provider id" as its sub-line, so a tile whose value had been mutated to
 * `sent + suppressed` still contained the digits of `sent` and the assertion
 * passed. A test that cannot fail is the same shape of defect as the screen it
 * is guarding.
 */
function tileValue(label) {
  const tile = [...host.querySelectorAll('.k-stat')].find(
    n => n.querySelector('.k-stat__lbl')?.textContent.trim() === label,
  );
  return tile?.querySelector('.k-stat__val')?.textContent.trim();
}

beforeEach(() => {
  // The house convention — `notifications.test.jsx`, `grahaTabStates.test.jsx`
  // and six others set it the same way. Without it React 19 prints "the current
  // testing environment is not configured to support act(...)" on every state
  // change, and a suite that shouts fourteen warnings per run trains people to
  // stop reading its output.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  if (host) host.remove();
  root = null;
  host = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('1 · suppressed is not sent', () => {
  it('reports a fully suppressed period as zero sent, not as the row count', async () => {
    // A staging payroll run: 71 payslips, every one suppressed by
    // OUTBOUND_MODE=dry. Nothing left the building.
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        totals: { ...NONE, suppressed: 71, total: 71 },
        by_status: { suppressed: 71 },
        by_mode: { dry: 71 },
        purposes: [{
          ...NONE, purpose: 'payslip', channel: 'email', label: 'Payslip',
          suppressed: 71, total: 71, last_at: '2026-08-01T06:30:00+00:00',
        }],
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // The whole point. 71 things happened and none of them was a send.
    expect(tileValue('Sent')).toBe('0');
    expect(tileValue('Suppressed')).toBe('71');
    expect(text()).toContain('71 rows recorded');
  });

  it('never calls anything delivered', async () => {
    api.get.mockResolvedValue({ data: COVERED });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // Nothing in this product hears back from a mailbox. The word must not
    // appear except where the screen is explicitly denying it.
    expect(text()).toContain('Sent is not delivered');
    expect(text()).not.toMatch(/\b\d+ delivered\b/);
  });

  it('keeps the suppressed count out of the sent tile even when both exist', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        totals: {
          ...NONE, sent: 10, confirmed: 10, suppressed: 5, failed: 2,
          total: 17, ses_units: 12,
        },
        by_status: { sent: 10, suppressed: 5, failed: 2 },
        purposes: [{
          ...NONE, purpose: 'invoice', channel: 'email', label: 'Invoice',
          sent: 10, confirmed: 10, suppressed: 5, failed: 2, total: 17,
          last_at: '2026-08-04T09:00:00Z',
        }],
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    expect(tileValue('Sent')).toBe('10');
    expect(tileValue('Suppressed')).toBe('5');
    expect(tileValue('Failed')).toBe('2');
  });

  it('shouts when something reached a provider while the kill switch was on', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        by_mode: { dry: 40 },
        kill_switch_bypassed: 3,
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // Migration 098: this must be zero on staging forever, and it has already
    // been non-zero twice. It is above the figures because it changes what
    // they mean.
    expect(text()).toContain('Kill switch bypassed');
    expect(text()).toContain('3 of these went to a provider');
  });
});

describe('2 · a provider message id is evidence and its absence is not', () => {
  it('marks a purpose where nothing came back with an id', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        totals: { ...NONE, sent: 40, confirmed: 0, total: 40, ses_units: 52 },
        purposes: [{
          ...NONE, purpose: 'payslip', channel: 'email', label: 'Payslip',
          sent: 40, confirmed: 0, total: 40, last_at: '2026-08-01T06:30:00Z',
        }],
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // Forty attempts and no proof of any of them. That is what a broken
    // provider integration looks like, and it is indistinguishable from a
    // healthy one if the screen only prints "40".
    expect(text()).toContain('none confirmed');
    expect(host.querySelector('.ob__unconf')).not.toBeNull();
  });

  it('shows the confirmed count when there is one', async () => {
    api.get.mockResolvedValue({ data: COVERED });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);
    expect(text()).toContain('40 confirmed');
    expect(host.querySelector('.ob__unconf')).toBeNull();
  });

  it('distinguishes the two in the drill-down, row by row', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/outbound')) return Promise.resolve({ data: COVERED });
      return Promise.resolve({
        data: {
          scope: 'period',
          period: '2026-08',
          data: [
            {
              id: 'a', created_at: '2026-08-01T06:30:00Z', channel: 'email',
              purpose: 'payslip', ref: 'payslip:PS-1', subject: 'Your payslip',
              target: 'asha@client.com', status: 'sent', provider: 'ses',
              provider_message_id: '0100018f-abc', bytes: 900000,
              error: null, mode: 'live',
            },
            {
              id: 'b', created_at: '2026-08-01T06:31:00Z', channel: 'email',
              purpose: 'payslip', ref: 'payslip:PS-2', subject: 'Your payslip',
              target: 'bhavesh@client.com', status: 'sent', provider: null,
              provider_message_id: null, bytes: null, error: null, mode: 'live',
            },
          ],
          truncated: false,
        },
      });
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    await act(async () => { host.querySelector('.ob__fig').click(); });

    const body = text();
    expect(body).toContain('0100018f-abc');   // can be looked up at the provider
    expect(body).toContain('Not confirmed');  // cannot
  });

  it('gives a suppressed row a tone of its own and never paints a sent one green', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/outbound')) return Promise.resolve({ data: COVERED });
      return Promise.resolve({
        data: {
          scope: 'period',
          period: '2026-08',
          data: [
            {
              id: 'a', created_at: '2026-08-01T06:30:00Z', channel: 'email',
              purpose: 'payslip', ref: 'payslip:PS-1', subject: 'Your payslip',
              target: 'asha@client.com', status: 'sent', provider: 'ses',
              provider_message_id: '0100018f-abc', bytes: 1, error: null,
              mode: 'live',
            },
            {
              id: 'b', created_at: '2026-08-01T06:31:00Z', channel: 'email',
              purpose: 'payslip', ref: 'payslip:PS-2', subject: 'Your payslip',
              target: 'bhavesh@client.com', status: 'suppressed', provider: null,
              provider_message_id: null, bytes: 1, error: null, mode: 'dry',
            },
          ],
          truncated: false,
        },
      });
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);
    await act(async () => { host.querySelector('.ob__fig').click(); });

    const tone = word => [...host.querySelectorAll('.tag')]
      .find(n => n.textContent.trim() === word)
      ?.style.getPropertyValue('--c').trim();

    // A suppressed send carries a warning tone because it is a problem: it
    // never left. Losing that tone makes it read like the row above it, which
    // is the whole confusion.
    expect(tone('Suppressed')).toBe('var(--warn)');
    // And `sent` is DELIBERATELY untinted. `--ok` here would read as "it
    // arrived", and nothing in this product hears back from a mailbox.
    expect(tone('Sent')).toBe('');
  });

  it('prints the provider’s own reason for a failure, unrewritten', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/outbound')) {
        return Promise.resolve({
          data: {
            ...COVERED,
            totals: { ...NONE, failed: 1, total: 1 },
            by_status: { failed: 1 },
            purposes: [{
              ...NONE, purpose: 'payslip', channel: 'email', label: 'Payslip',
              failed: 1, total: 1, last_at: '2026-08-01T06:30:00Z',
            }],
          },
        });
      }
      return Promise.resolve({
        data: {
          scope: 'period',
          period: '2026-08',
          data: [{
            id: 'c', created_at: '2026-08-01T06:30:00Z', channel: 'email',
            purpose: 'payslip', ref: 'payslip:PS-3', subject: 'Your payslip',
            target: 'nobody@example.com', status: 'failed', provider: 'ses',
            provider_message_id: null, bytes: 900000,
            error: 'Email address is not verified', mode: 'live',
          }],
          truncated: false,
        },
      });
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    await act(async () => { host.querySelector('.ob__fig').click(); });

    // Verbatim. Rewriting it into our own words loses the one string that
    // explains the bounce — and `@example.com` is how 960 of them happened.
    expect(text()).toContain('Email address is not verified');
    expect(text()).toContain('nobody@example.com');
  });

  it('flags a row that reached a provider from a dry-mode process', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/outbound')) return Promise.resolve({ data: COVERED });
      return Promise.resolve({
        data: {
          scope: 'period',
          period: '2026-08',
          data: [{
            id: 'd', created_at: '2026-08-01T06:30:00Z', channel: 'email',
            purpose: 'payslip', ref: 'payslip:PS-4', subject: 'Your payslip',
            target: 'asha@client.com', status: 'sent', provider: 'ses',
            provider_message_id: '0100018f-xyz', bytes: 1, error: null,
            mode: 'dry',
          }],
          truncated: false,
        },
      });
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);
    await act(async () => { host.querySelector('.ob__fig').click(); });

    expect(text()).toContain('bypassed dry mode');
  });
});

describe('3 · what the figures do not cover has to say so', () => {
  it('calls a part-covered month a floor, in that word', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        recording_since: '2026-08-14T10:00:00+00:00',
        covers_whole_period: false,
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    const body = text();
    expect(body).toContain('Partial month');
    expect(body).toContain('floor');
    expect(body).toContain('not a total');
  });

  it('does not read an empty log as an empty month', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        recording_since: null,
        covers_whole_period: false,
        totals: { ...NONE },
        by_status: {},
        by_mode: {},
        purposes: [],
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // "Nothing was sent" and "nothing was recorded" are different statements
    // and only one of them is knowable.
    expect(text()).toContain('That is not evidence that nothing was sent');
  });

  it('says so plainly when the period IS covered', async () => {
    api.get.mockResolvedValue({ data: COVERED });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);
    expect(text()).toContain('covered in full');
  });

  it('discloses that orgless sends are not counted', async () => {
    api.get.mockResolvedValue({ data: COVERED });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // `org_id` is nullable and NULL is a real answer. An invite goes out before
    // the org exists, so it is genuinely absent from these figures — and an
    // absence nobody is told about reads as "we never emailed them".
    expect(text()).toContain('Invitations, password resets and magic links');
  });

  it('labels the message-unit figure a floor and names the unmeasured rows', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        totals: { ...COVERED.totals, ses_units: 52, unmeasured: 7 },
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // GREATEST(1, NULL) is 1 in Postgres, so an unmeasured row silently
    // contributes a unit. The pair has to be read together or the total
    // under-reports — which is the original sin this table was built to end.
    expect(tileValue('Email message units')).toBe('52');
    expect(text()).toContain('At least — 7 sends had no size recorded');
  });
});

describe('3b · the two words that would be read backwards', () => {
  it('renders `queued` as "No answer", never as "waiting in a queue"', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/outbound')) {
        return Promise.resolve({
          data: {
            ...COVERED,
            totals: { ...NONE, unanswered: 4, total: 4 },
            by_status: { queued: 4 },
            purposes: [{
              ...NONE, purpose: 'payslip', channel: 'email', label: 'Payslip',
              unanswered: 4, total: 4, last_at: '2026-08-01T06:30:00Z',
            }],
          },
        });
      }
      return Promise.resolve({
        data: {
          scope: 'period',
          period: '2026-08',
          data: [{
            id: '9', created_at: '2026-08-01T06:30:00Z', channel: 'email',
            purpose: 'payslip', ref: 'payslip:PS-9', subject: 'Your payslip',
            target: 'asha@client.com', status: 'queued', provider: 'ses',
            provider_message_id: null, bytes: 900000, error: null, mode: 'live',
          }],
          truncated: false,
        },
      });
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // The column heading, before anything is opened.
    expect(text()).toContain('No answer');
    await act(async () => { host.querySelector('.ob__fig').click(); });

    // Migration 098: a row still in this state is ITSELF the finding — the
    // process died between the provider call and the reply. "Queued" would
    // read as "it is on its way", which is the opposite.
    expect(text()).not.toContain('Queued');
    const call = api.get.mock.calls.find(([u]) => u.endsWith('/outbound/messages'));
    expect(call[1].params.status).toBe('queued');
  });

  it('says so when most of the period has no purpose recorded', async () => {
    api.get.mockResolvedValue({
      data: {
        ...COVERED,
        totals: { ...NONE, sent: 90, confirmed: 90, total: 90 },
        purposes: [
          {
            ...NONE, purpose: 'unclassified', channel: 'email',
            label: 'Unclassified', sent: 80, confirmed: 80, total: 80,
            last_at: '2026-08-01T06:30:00Z',
          },
          {
            ...NONE, purpose: 'payslip', channel: 'email', label: 'Payslip',
            sent: 10, confirmed: 10, total: 10,
            last_at: '2026-08-01T06:30:00Z',
          },
        ],
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    // 098 asks for this to be watched by name. A breakdown that cannot account
    // for most of its own rows is decoration, and only the screen can say so.
    expect(text()).toContain('Mostly unclassified');
    expect(text()).toContain('80 of these 90 rows');
  });
});

describe('4 · the block never takes the rest of the billing page down with it', () => {
  it('renders the server’s own refusal rather than an error boundary', async () => {
    api.get.mockRejectedValue({
      response: {
        data: {
          detail: {
            error: 'outbound_log_unavailable',
            message: 'The outbound log table does not exist in this database.',
          },
        },
      },
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    expect(text()).toContain('The outbound log table does not exist in this database.');
    // No figures at all — an absent table must never render as a zero.
    expect(host.querySelectorAll('.k-stat')).toHaveLength(0);
  });

  it('shows no count of any kind while the request is in flight', async () => {
    let settle;
    api.get.mockReturnValue(new Promise((res) => { settle = res; }));
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    expect(host.querySelectorAll('.k-stat')).toHaveLength(0);
    await act(async () => { settle({ data: COVERED }); });
    expect(host.querySelectorAll('.k-stat').length).toBeGreaterThan(0);
  });
});

describe('5 · the recipient lookup is not a filter on the month', () => {
  it('asks the server without a period, and says so on the result', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/outbound')) return Promise.resolve({ data: COVERED });
      return Promise.resolve({
        data: {
          scope: 'recipient',
          period: null,
          recipient: 'asha@client.com',
          data: [{
            id: 'a', created_at: '2026-06-01T06:30:00Z', channel: 'email',
            purpose: 'payslip', ref: 'payslip:PS-9', subject: 'Your payslip',
            target: 'asha@client.com', status: 'sent', provider: 'ses',
            provider_message_id: '0100018f-abc', bytes: 1, error: null,
            mode: 'live',
          }],
          truncated: false,
        },
      });
    });
    await render(<OutboundLog basePath="/v1/billing/me" period="2026-08" />);

    const input = host.querySelector('#ob-recipient');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    await act(async () => {
      setter.call(input, 'asha@client.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { host.querySelector('.ob__find button').click(); });

    const call = api.get.mock.calls.find(([u]) => u.endsWith('/outbound/messages'));
    expect(call).toBeTruthy();
    // The month is deliberately absent: "did this person get their payslip" is
    // not a question about August, and sending one would silently hide a send
    // from July.
    expect(call[1].params.period).toBeUndefined();
    expect(call[1].params.recipient).toBe('asha@client.com');
    expect(text()).toContain('across all months');
  });
});
