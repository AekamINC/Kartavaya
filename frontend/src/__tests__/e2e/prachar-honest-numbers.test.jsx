/**
 * Prachar must not draw a number nothing measured, and must not hide its own
 * only way in.
 *
 * TWO FINDINGS, ONE FILE, because both are the same failure of a screen to tell
 * the truth about what is behind it.
 *
 * ── 1 · The invented engagement figures ───────────────────────────────────
 *
 * `total_opened`, `total_clicked` and `total_bounced` are written by NOTHING in
 * this product — no Resend webhook, no pixel, no click redirect. Where the demo
 * seed did not run they read 0, which looks like "nobody opened it". On Unicode
 * Group, a paying customer, they held 51 opens and 29 clicks stamped to the
 * same microsecond on campaigns dated four months before the org's marketing
 * rows existed — and the dashboard drew that as a funnel with rates.
 *
 * The backend now serves those three as `null` with `engagement_measured:
 * false` (`backend/services/engagement_metrics.py`). The trap this file exists
 * to pin is the coercion: `Number(null || 0)` is 0, and 0 renders as a
 * confident measurement. So the tests below feed the screen the exact shape the
 * server now sends AND the old seeded shape, and require the words rather than
 * a number in the first case.
 *
 * ── 2 · The Ads tab's chicken-and-egg ─────────────────────────────────────
 *
 * The only Sync control in the product was rendered INSIDE the ad-accounts
 * table, and `Panel` replaces its children with an empty state when the list is
 * empty — so with zero ad accounts there was no sync button anywhere, and ad
 * accounts only exist after a sync. The empty state said "sync it here" and
 * here had no button. The entry point now sits above the panel, driven by
 * CONNECTED SOCIAL ACCOUNTS, which exist before any sync has run.
 *
 * The zero-ad-accounts case is the ONLY interesting one, because it is the
 * state every org in the database is in today: `prachar_ad_accounts` 0 rows,
 * `hub_social_accounts` 0 rows, measured 6 August 2026.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost } from './_harness';

import DashboardTab from '../../pages/prachar/DashboardTab';
import AdsTab from '../../pages/prachar/AdsTab';

let host; let mock;

/** What the server sends now: recipients real, engagement null. */
const REDACTED_DASHBOARD = {
  campaigns: { total: 12, sent: 8, sending: 0, drafts: 4, scheduled: 0 },
  delivery: {
    total_sent: 66,
    total_opened: null,
    total_clicked: null,
    total_bounced: null,
    engagement_measured: false,
  },
  templates_count: 3,
  automations_count: 0,
  unsubscribes_count: 2,
  recent_campaigns: [{
    id: 'c1', name: 'GSTR-1 reminder — July', status: 'sent',
    sent_at: '2026-07-08T12:41:32Z',
    total_recipients: 7, total_opened: null, total_clicked: null,
    engagement_measured: false,
  }],
  engagement_measured: false,
  engagement_note:
    'Opens, clicks and bounces are not measured — nothing in the product receives delivery events yet.',
};

/** What it used to send, verbatim from Unicode Group's live rows. */
const SEEDED_DASHBOARD = {
  ...REDACTED_DASHBOARD,
  delivery: { total_sent: 66, total_opened: 51, total_clicked: 29, total_bounced: 1 },
  recent_campaigns: [{
    id: 'c1', name: 'GSTR-1 reminder — July', status: 'sent',
    sent_at: '2026-07-08T12:41:32Z',
    total_recipients: 7, total_opened: 7, total_clicked: 5,
  }],
  engagement_measured: undefined,
  engagement_note: undefined,
};

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
});

describe('Prachar dashboard — an unmeasured figure is not a zero', () => {
  it('says "Not measured" rather than drawing an open rate', async () => {
    mock = installMockApi({ 'GET /v1/prachar/dashboard': REDACTED_DASHBOARD });
    await host.mount(<DashboardTab />);

    expect(host.text()).toContain('Not measured');
    // The trap: nulls coerced to 0 and rendered as a rate against 66 sent.
    expect(host.text()).not.toContain('0.0%');
    expect(host.text()).not.toContain('0%');
  });

  it('explains why, in the words the backend supplied', async () => {
    mock = installMockApi({ 'GET /v1/prachar/dashboard': REDACTED_DASHBOARD });
    await host.mount(<DashboardTab />);
    expect(host.text()).toMatch(/nothing in the product receives delivery events/i);
  });

  it('still shows the one delivery figure that IS measured', async () => {
    // `total_recipients` is written by the send path on every campaign. This
    // fix must not take a real number away with the invented ones.
    mock = installMockApi({ 'GET /v1/prachar/dashboard': REDACTED_DASHBOARD });
    await host.mount(<DashboardTab />);
    expect(host.text()).toContain('66');
    expect(host.text()).toContain('GSTR-1 reminder — July');
  });

  it('drops the Opened and Open rate columns instead of filling them with zeros', async () => {
    mock = installMockApi({ 'GET /v1/prachar/dashboard': REDACTED_DASHBOARD });
    await host.mount(<DashboardTab />);
    const headers = host.$$('th').map(t => t.textContent.trim());
    expect(headers).not.toContain('Open rate');
  });

  it('refuses the seeded numbers even when the server still sends them', async () => {
    // BELT AND BRACES, and the reason is concrete: the redaction lives in one
    // backend helper, and an endpoint added later that forgets to call it would
    // put 51 opens back on this screen with nothing failing. The screen trusts
    // the flag, not the values.
    mock = installMockApi({ 'GET /v1/prachar/dashboard': SEEDED_DASHBOARD });
    await host.mount(<DashboardTab />);

    expect(host.text()).toContain('Not measured');
    expect(host.text()).not.toContain('51');
    expect(host.text()).not.toContain('29');
  });

  it('shows the figures again the day the server says they are measured', async () => {
    // The fix must be conditional on one named fact, not hard-coded away.
    mock = installMockApi({
      'GET /v1/prachar/dashboard': {
        ...SEEDED_DASHBOARD,
        delivery: { ...SEEDED_DASHBOARD.delivery, engagement_measured: true },
        engagement_measured: true,
        engagement_note: null,
      },
    });
    await host.mount(<DashboardTab />);

    expect(host.text()).not.toContain('Not measured');
    expect(host.text()).toContain('51');
  });
});

describe('Prachar campaign detail — the delivery breakdown, one click deeper', () => {
  const CAMPAIGN = {
    id: 'c1', name: 'GSTR-1 reminder — July', subject: 'Due on the 11th',
    body_html: '<p>Hi</p>', channel: 'email', status: 'sent',
    audience_filter: {}, scheduled_at: null, sent_at: '2026-07-08T12:41:32Z',
    total_recipients: 7, total_opened: null, total_clicked: null,
    engagement_measured: false,
  };

  const routes = (stats) => ({
    'GET /v1/prachar/campaigns': { data: [CAMPAIGN] },
    'GET /v1/prachar/campaigns/:id/stats': stats,
    'GET /v1/prachar/campaigns/:id/recipients': { data: [] },
    'GET /v1/prachar/templates': { data: [] },
    'GET /v1/graha/contacts': { data: [] },
  });

  it('says "Not measured" rather than a confident zero share', async () => {
    mock = installMockApi(routes({
      total: 7, sent: 7, opened: null, clicked: null, bounced: null, failed: 0,
      engagement_measured: false,
      engagement_note: 'Opens, clicks and bounces are not measured.',
    }));
    const { default: CampaignsTab } = await import('../../pages/prachar/CampaignsTab');
    await host.mount(<CampaignsTab />);
    // The tab opens on a month calendar anchored on today, and this campaign
    // was sent in July. List first, then open it.
    await host.click('List');
    await host.click(host.$('.btn--text'));

    // Row by row, because "contains 0.0%" is true either way here: `Failed 0 —
    // 0.0%` is a REAL zero out of seven and must keep reading as one.
    const cells = Object.fromEntries(
      host.$$('tr')
        .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
        .filter(row => row.length === 3)
        .map(([label, n, share]) => [label, [n, share]]),
    );
    expect(cells.Opened).toEqual(['Not measured', '—']);
    expect(cells.Clicked).toEqual(['Not measured', '—']);
    expect(cells.Bounced).toEqual(['Not measured', '—']);
    expect(cells.Sent).toEqual(['7', '100.0%']);
    expect(cells.Failed).toEqual(['0', '0.0%']);
  });
});

describe('Prachar Ads — the first sync has to be startable', () => {
  const NO_ACCOUNTS = {
    'GET /v1/prachar/ads/overview': {
      total_spend: 0, total_impressions: 0, total_clicks: 0,
      total_conversions: 0, active_campaigns: 0,
    },
    'GET /v1/prachar/ads/accounts': { data: [] },
  };

  const CONNECTED = [{
    id: 'sa-1', platform: 'facebook', account_name: 'Unicode Group Page',
    client_name: 'Unicode Group', connected_at: '2026-08-01T00:00:00Z',
  }];

  it('offers a sync control with zero ad accounts — the state every org is in', async () => {
    mock = installMockApi({
      ...NO_ACCOUNTS,
      'GET /v1/prachar/ads/syncable-accounts': { data: CONNECTED },
    });
    await host.mount(<AdsTab />);

    const sync = host.control('Sync ads');
    expect(sync).toBeTruthy();
    expect(sync.disabled).toBe(false);
  });

  it('names the connected account it will pull from', async () => {
    mock = installMockApi({
      ...NO_ACCOUNTS,
      'GET /v1/prachar/ads/syncable-accounts': { data: CONNECTED },
    });
    await host.mount(<AdsTab />);
    expect(host.text()).toContain('Unicode Group Page');
  });

  it('posts the social-account id the API actually takes', async () => {
    mock = installMockApi({
      ...NO_ACCOUNTS,
      'GET /v1/prachar/ads/syncable-accounts': { data: CONNECTED },
      'POST /v1/prachar/ads/accounts/sync': { synced: 0 },
    });
    await host.mount(<AdsTab />);
    await host.click('Sync ads');

    const posted = mock.calledWith('POST', '/ads/accounts/sync');
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual({ social_account_id: 'sa-1' });
  });

  it('says what to do when nothing is connected, instead of showing nothing', async () => {
    mock = installMockApi({
      ...NO_ACCOUNTS,
      'GET /v1/prachar/ads/syncable-accounts': { data: [] },
    });
    await host.mount(<AdsTab />);

    expect(host.control('Sync ads')).toBeNull();
    expect(host.text()).toMatch(/no facebook or instagram account is connected/i);
  });

  it('does not send the operator back to a button that is not there', async () => {
    // The old empty state read "Connect a social account in settings, then sync
    // it here" — and "here" had no control. Whatever it says now must not be
    // that sentence.
    mock = installMockApi({
      ...NO_ACCOUNTS,
      'GET /v1/prachar/ads/syncable-accounts': { data: [] },
    });
    await host.mount(<AdsTab />);
    expect(host.text()).not.toMatch(/then sync it here/i);
  });
});
