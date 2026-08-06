/**
 * Two screens that promised work no code performs.
 *
 * ── 1 · Prachar's automations tab ─────────────────────────────────────────
 *
 * The form rendered its own rule back as a sentence — "<name> will run when
 * <trigger>, and will <action>" — and not one of its seven trigger names exists
 * anywhere in the backend outside the CRUD that stores them. There is no engine.
 * `staging.prachar_automations` held 0 rows in the product's entire life, so
 * nothing was lost by unmounting the tab; what was expensive was leaving a form
 * standing that promises unattended execution.
 *
 * This test pins the ABSENCE, which is the awkward kind to pin: a tab that
 * disappears for an unrelated reason would pass it. So it also asserts the tabs
 * that must still be there, and would fail if the tab list broke wholesale.
 *
 * ── 2 · Pahchan's summary reports ─────────────────────────────────────────
 *
 * Three checkboxes under a heading that says "Reports", naming a daily, weekly
 * and monthly attendance summary. No function in the backend reads those flags
 * or the recipient list — no sender, no template, no cron. The flags defaulted
 * to TRUE, so the promise was made to every org that had never opened the page.
 *
 * The defaults are false now and the sender was deliberately NOT built (it
 * needs a cron, and this product already has twelve cron routes with no
 * scheduler). What remains is the screen's duty to say so, which is what this
 * pins: a customer who ticks one of these must not spend a month wondering
 * where the email went.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost } from './_harness';

import PracharPage from '../../pages/PracharPage';
import PahchanPolicy from '../../pages/pahchan/PahchanPolicy';

let host;

const DASHBOARD = {
  campaigns: { total: 0, sent: 0, sending: 0, drafts: 0, scheduled: 0 },
  delivery: { total_sent: 0, total_opened: null, total_clicked: null, total_bounced: null },
  templates_count: 0, automations_count: 0, unsubscribes_count: 0,
  recent_campaigns: [],
  engagement_measured: false,
  engagement_note: 'Opens, clicks and bounces are not measured.',
};

const POLICY = {
  default_radius_m: 150, grace_minutes: 10, allow_outside_geofence: true,
  accuracy_flag_threshold_m: 100, punch_photo_retention_days: 90,
  reference_photo_grace_days: 45, record_retention_years: 3,
  report_recipients: [], report_daily: false, report_weekly: false,
  report_monthly: false,
  standard_hours_per_day: 8, overtime_daily_threshold_hours: 9,
  overtime_weekly_threshold_hours: 48, overtime_multiplier: 2,
  overtime_enabled: false, week_starts_on: 1,
  shift_start_time: null, shift_end_time: null, overnight_shift: false,
};

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
});

describe('Prachar — no tab offers an automation nothing can run', () => {
  beforeEach(() => {
    installMockApi({
      'GET /v1/prachar/dashboard': DASHBOARD,
      'GET /v1/prachar/campaigns': { data: [] },
    });
  });

  // A tab's text is bilingual — "dashboard" renders as "dashboardमुख्य". An
  // equality or a `toContain` on the array would be satisfied by the Hindi
  // suffix being present and the English name absent, and, worse, `not
  // .toContain('automations')` would PASS on a rendered "automationsस्वचालन".
  // Matching the leading English name is the test that can actually fail.
  const tabNames = () => host.$$('[role="tab"]')
    .map(t => t.textContent.trim().toLowerCase());
  const hasTab = (name) => tabNames().some(t => t.startsWith(name));

  it('does not render an Automations tab', async () => {
    await host.mount(<PracharPage />);
    expect(hasTab('automations')).toBe(false);
  });

  it('still renders the tabs that do work — so an empty tab list cannot pass this', async () => {
    await host.mount(<PracharPage />);
    for (const kept of ['dashboard', 'campaigns', 'ads', 'sequences', 'templates',
      'unsubscribes', 'events']) {
      expect(hasTab(kept)).toBe(true);
    }
  });

  it('says nothing anywhere about running without anybody watching', async () => {
    // The empty state's exact promise: "An automation watches for something
    // happening in CRM and responds without anyone pressing anything."
    await host.mount(<PracharPage />);
    expect(host.text()).not.toMatch(/without anyone pressing anything/i);
  });
});

describe('Pahchan policy — the summary reports say they are not sent', () => {
  beforeEach(() => {
    installMockApi({
      'GET /v1/pahchan/policy': POLICY,
      'GET /v1/pahchan/sites': { data: [] },
    });
  });

  it('warns that nothing is delivered yet', async () => {
    await host.mount(<PahchanPolicy />);
    expect(host.text()).toMatch(/not being delivered yet/i);
  });

  it('says plainly that ticking a box does not start a send', async () => {
    await host.mount(<PahchanPolicy />);
    expect(host.text()).toMatch(/does not start sending anything/i);
  });

  it('still offers all three checkboxes — the preference is real, the delivery is not', async () => {
    // Disabling them would strand the org that already has weekly and monthly
    // on: it could no longer turn them OFF either. The stored intent is what a
    // sender will read the day one exists.
    await host.mount(<PahchanPolicy />);
    const labels = host.$$('.ph__check--row').map(l => l.textContent.trim());
    expect(labels).toContain('Daily summary');
    expect(labels).toContain('Weekly summary');
    expect(labels).toContain('Monthly summary');
    for (const box of host.$$('.ph__check--row input[type="checkbox"]')) {
      expect(box.disabled).toBe(false);
    }
  });

  it('does not tick a box the server did not tick', async () => {
    // The defaults are the server's to choose. This guards the other direction:
    // a screen that defaults a checkbox on locally would put the promise back
    // without touching the backend.
    await host.mount(<PahchanPolicy />);
    for (const box of host.$$('.ph__check--row input[type="checkbox"]')) {
      expect(box.checked).toBe(false);
    }
  });
});
