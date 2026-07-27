/**
 * Pahchan screens — that they render, and that they say the right words.
 *
 * The first assertion is the one that earns this file. `StatusChip` takes no
 * `label` prop, and the register passed one on every flag, so every reason a
 * punch needed a look reached the reviewer as a task-tracker noun: "Requested"
 * for a punch outside the site, "Rejected" for a simulated location, "In Review"
 * for weak GPS. Nothing failed, nothing logged, and the page looked fine — a
 * dropped prop is invisible from every direction except reading the rendered
 * text, which is what this does.
 *
 * The rest are render guards on four surfaces that were built against endpoints
 * nothing had ever called. Three of those endpoints turned out not to work; a
 * screen that mounts is the cheapest evidence that the next one still does.
 *
 * `publish starts disabled` pins a deliberate rule rather than an implementation
 * detail: `POST /attendance/publish` will write on the first call, and this
 * screen refuses to let it until a preview of that range has come back. Someone
 * simplifying the button's `disabled` expression should have to see this fail.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost } from './_harness';
import { ToastProvider } from '../../components/ui/toast';

import Register from '../../pages/pahchan/Register';
import Corrections from '../../pages/pahchan/Corrections';
import PublishPayroll from '../../pages/pahchan/PublishPayroll';
import History from '../../pages/pahchan/History';
import PahchanPolicy from '../../pages/pahchan/PahchanPolicy';

let host; let mock;

const POLICY = {
  default_radius_m: 150, grace_minutes: 10, allow_outside_geofence: true,
  accuracy_flag_threshold_m: 100, punch_photo_retention_days: 90,
  reference_photo_grace_days: 45, record_retention_years: 3,
  report_daily: true, report_weekly: true, report_monthly: true,
  standard_hours_per_day: 8, overtime_daily_threshold_hours: 9,
  overtime_weekly_threshold_hours: 48, overtime_multiplier: 2,
  overtime_enabled: false, week_starts_on: 1,
  shift_start_time: null, shift_end_time: null, overnight_shift: false,
};

const PUNCH = {
  id: 'p1', direction: 'in', captured_at: new Date().toISOString(),
  received_at: new Date().toISOString(), source: 'live',
  flags: ['geo', 'accuracy'], accuracy_m: 184, distance_m: 412,
  mock_location: null, lat: 18.9358, lng: 72.8302, has_photo: true,
  review_verdict: null, reviewed_at: null, reviewed_by: null,
  employee_id: 'e4', employee_name: 'Suresh Kulkarni', employee_code: 'AK-004',
  site_name: 'Fort office', reference_ids: ['r1', 'r2'],
};

beforeEach(() => {
  installNetworkKillSwitch();
  mock = installMockApi({
    'GET /v1/pahchan/register': { date: '2026-07-27', punches: [PUNCH] },
    'GET /v1/pahchan/policy': POLICY,
    'GET /v1/pahchan/sites': { data: [{ id: 's1', name: 'Fort office', lat: 18.9333, lng: 72.8336, radius_m: 150, is_active: true }] },
    'GET /v1/pahchan/punches/p1/photo': { url: 'blob:punch' },
    'GET /v1/pahchan/enrollment/photos/r1/url': { url: 'blob:r1' },
    'GET /v1/pahchan/enrollment/photos/r2/url': { url: 'blob:r2' },
    'GET /v1/pahchan/regularisations': [{
      id: 'g1', employee_id: 'e4', employee_name: 'Suresh Kulkarni',
      for_date: '2026-07-22', requested_direction: 'out',
      requested_at_time: new Date().toISOString(),
      reason: 'Client meeting ran late.', status: 'pending',
      decided_by: null, decided_at: null, decision_note: null,
      created_at: new Date().toISOString(),
    }],
    'GET /v1/pahchan/me': {
      employee: { id: 'e4', name: 'Suresh Kulkarni' },
      punches: [PUNCH],
      retention: { punch_photo_days: 90, reference_photo_grace_days: 45, record_retention_years: 3 },
    },
  });
  host = makeHost();
});

afterEach(() => { host.unmount(); restoreNetwork(); vi.restoreAllMocks(); });

const wrap = node => <ToastProvider>{node}</ToastProvider>;

describe('pahchan screens render', () => {
  it('register shows real flag names, not task words', async () => {
    await host.render(wrap(<Register />));
    const t = host.container.textContent;
    expect(t).toContain('Outside site');
    expect(t).toContain('Weak GPS');
    expect(t).not.toContain('Requested');
    expect(t).not.toContain('In Review');
  });

  it('corrections renders a pending row', async () => {
    await host.render(wrap(<Corrections />));
    expect(host.container.textContent).toContain('Suresh Kulkarni');
    expect(host.container.textContent).toContain('Client meeting ran late.');
  });

  it('payroll starts with publish disabled', async () => {
    await host.render(wrap(<PublishPayroll />));
    const btn = [...host.container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Publish to payroll'));
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  it('history renders a month grid and the retention promise', async () => {
    await host.render(wrap(<History />));
    expect(host.container.querySelectorAll('.pcal__d').length).toBeGreaterThan(27);
    expect(host.container.textContent).toContain('90 days');
  });

  it('policy renders the shift fields and the sites section', async () => {
    await host.render(wrap(<PahchanPolicy />));
    const t = host.container.textContent;
    expect(t).toContain('Shift and overtime');
    expect(t).toContain('Contracted day');
    expect(t).toContain('Sites');
  });
});
