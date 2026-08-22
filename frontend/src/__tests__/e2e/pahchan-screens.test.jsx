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
import Sites from '../../pages/pahchan/Sites';

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
    'GET /v1/pahchan/sites': { data: [
      // No vertical pair — the default, and what most sites will always be.
      { id: 's1', name: 'Fort office', lat: 18.9333, lng: 72.8336, radius_m: 150,
        altitude_m: null, altitude_tolerance_m: null, is_active: true },
      // A site that does check height, and a retired one, so the three states
      // the row has to tell apart are all on screen at once.
      { id: 's2', name: 'Tower, 14th floor', lat: 19.0176, lng: 72.8562, radius_m: 80,
        altitude_m: 52, altitude_tolerance_m: 15, is_active: true },
      { id: 's3', name: 'Old godown', lat: 19.1, lng: 72.9, radius_m: 200,
        altitude_m: null, altitude_tolerance_m: null, is_active: false },
    ] },
    'POST /v1/pahchan/sites': { id: 's4', name: 'New', radius_m: 150 },
    'PATCH /v1/pahchan/sites/:id': ({ params, body }) => ({ id: params.id, ...body }),
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
      // The rules block. Every figure is the ORG's — the panel has no defaults
      // of its own, deliberately, so a wrong number here is the only way a
      // wrong number can reach the screen.
      rules: {
        grace_minutes: 10,
        accuracy_flag_threshold_m: 100,
        allow_outside_geofence: true,
        standard_hours_per_day: 8,
        overtime_enabled: false,
        sites: [
          { name: 'Fort office', radius_m: 150, altitude_m: null,
            altitude_tolerance_m: null, checks_altitude: false },
          { name: 'Tower, 14th floor', radius_m: 80, altitude_m: 52,
            altitude_tolerance_m: 15, checks_altitude: true },
        ],
        flag_meanings: {
          geo: 'You were outside the site’s area — or, where a site checks it, above or below its floor by more than it allows.',
          accuracy: 'Your phone was not sure where it was.',
        },
        nothing_is_refused: true,
      },
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

  /**
   * THE EMPTY QUEUE THAT MEANT "NOBODY CAN ASK".
   *
   * `POST /v1/pahchan/regularisations` had no caller anywhere in the product, so
   * this table could not receive a row for any organisation on it. The pending
   * empty state drew a green tick over "Every correction anyone has asked for has
   * been decided" — telling the one person able to notice the gap that there was
   * nothing to notice.
   *
   * The two states have to be told apart, and the only thing that can tell them
   * apart is whether the table has ever held anything.
   */
  it('an empty queue nobody has ever used does NOT render as an achievement', async () => {
    mock.route({ 'GET /v1/pahchan/regularisations': [] });
    await host.render(wrap(<Corrections />));
    const t = host.container.textContent;
    expect(t).toContain('Nobody has asked yet');
    expect(t).not.toContain('Nothing waiting');
    expect(t).not.toContain('has been decided');
    // The green tone IS the achievement — `EmptyState` paints the art with
    // `var(--ok)` for `tone="ok"` and the faint ink otherwise. Read off the
    // rendered style rather than the prop, because the prop is what we passed.
    const art = host.container.querySelector('.empty__art');
    expect(art).toBeTruthy();
    expect(art.getAttribute('style') || '').not.toContain('--ok');
    // And it says where the request actually comes from, so an admin whose
    // people are complaining knows what to check.
    expect(t).toContain('on their phone');
  });

  it('a queue that really has been cleared still reads as cleared', async () => {
    // `status: 'all'` answers with the settled ones; `status: 'pending'` with
    // none. That IS "everything asked for has been decided".
    mock.route({
      'GET /v1/pahchan/regularisations': ({ search }) =>
        (search?.status === 'all' ? [{
          id: 'g2', employee_id: 'e4', employee_name: 'Suresh Kulkarni',
          for_date: '2026-07-22', requested_direction: 'out',
          requested_at_time: new Date().toISOString(),
          reason: 'Client meeting ran late.', status: 'approved',
          decided_by: 'u1', decided_at: new Date().toISOString(),
          decision_note: null, created_at: new Date().toISOString(),
        }] : []),
    });
    await host.render(wrap(<Corrections />));
    const t = host.container.textContent;
    expect(t).toContain('Nothing waiting');
    expect(t).not.toContain('Nobody has asked yet');
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

  /* -- Sites: the vertical pair, and amending at all ------------------------
     The altitude columns reached the database in migration 193 and no screen
     read or wrote either, so the vertical fence could not be configured. The
     screen also had no edit of any kind: a radius typed as 15 instead of 150
     flagged every punch at that site for ever, and the only remedy was a second
     site the first one kept out-competing in `_nearest_site`. */

  it('sites tells apart a site that checks height, one that does not, and a retired one', async () => {
    await host.render(wrap(<Sites />));
    const t = host.container.textContent;
    // Not "0 m +/-0 m", and not a blank cell either: an operator has to be able
    // to see that the vertical check is OFF, which is the default and the right
    // setting for a ground-floor office.
    expect(t).toContain('Off \u2014 distance only');
    expect(t).toContain('52 m \u00b115 m');
    expect(t).toContain('Reactivate');   // the retired site offers the way back
    expect(t).toContain('Deactivate');
    // Never a delete. `pahchan_punches.geofence_id` names a site on every punch
    // recorded there, so deleting one orphans the register.
    expect(t).not.toContain('Delete');
  });

  it('a tolerance typed without an altitude is a sentence, not a 422', async () => {
    await host.render(wrap(<Sites />));
    await host.click('Add a site');
    await host.fill('.ph__fld--name .inp', 'Rooftop');
    const [lat, lng] = host.$$('.ph__fld--coord .inp');
    await host.fill(lat, '19.01');
    await host.fill(lng, '72.85');
    // The tolerance, and no altitude. `pahchan_sites_altitude_pair_ck` refuses
    // this, and the 422 it produces carries a Pydantic error ARRAY that the
    // toast would render as [object Object].
    const nums = host.$$('.ph__vert .inp');
    expect(nums.length).toBe(2);
    await host.fill(nums[1], '20');
    await host.click('Add site');

    expect(host.container.textContent)
      .toContain('A vertical tolerance needs an altitude to be a tolerance of');
    expect(mock.calledWith('POST', '/v1/pahchan/sites')).toHaveLength(0);
  });

  it('both altitude fields blank is allowed, and says the check is skipped', async () => {
    await host.render(wrap(<Sites />));
    await host.click('Add a site');
    expect(host.container.textContent).toContain('Leave both blank unless you need them');

    await host.fill('.ph__fld--name .inp', 'Fort office 2');
    const [lat, lng] = host.$$('.ph__fld--coord .inp');
    await host.fill(lat, '18.93');
    await host.fill(lng, '72.83');
    await host.click('Add site');

    const [post] = mock.calledWith('POST', '/v1/pahchan/sites');
    expect(post).toBeTruthy();
    // ABSENT, not 0 and not null. `Number('')` is 0, and 0 metres is sea level
    // -- a site that would then flag every punch made above it.
    expect(post.body.altitude_m).toBeUndefined();
    expect(post.body.altitude_tolerance_m).toBeUndefined();
    expect(post.body.radius_m).toBe(150);
  });

  it('editing a site PATCHes it, and says yesterday is not re-measured', async () => {
    await host.render(wrap(<Sites />));
    await host.click(host.$$('button').find(b => b.textContent === 'Edit'));
    // Prefilled from the row, so an operator amends what is there rather than
    // retyping a site from memory.
    expect(host.$('.ph__fld--name .inp').value).toBe('Fort office');
    expect(host.container.textContent).toContain('never what was already decided');

    await host.fill('.ph__fld--radius .inp', '90');
    await host.click('Save changes');

    const [patch] = mock.calledWith('PATCH', '/v1/pahchan/sites/s1');
    expect(patch).toBeTruthy();
    expect(patch.body.radius_m).toBe(90);
    // Nothing to clear on a site that had no altitude -- sending the flag
    // anyway would be a write nobody asked for.
    expect(patch.body.clear_altitude).toBeUndefined();
  });

  it('blanking the altitude on a site that had one sends clear_altitude', async () => {
    await host.render(wrap(<Sites />));
    // The second Edit button is the site that checks height.
    await host.click(host.$$('button').filter(b => b.textContent === 'Edit')[1]);
    const nums = host.$$('.ph__vert .inp');
    expect(nums[0].value).toBe('52');
    expect(nums[1].value).toBe('15');

    await host.fill(nums[0], '');
    await host.fill(nums[1], '');
    // The screen warns before it does it, because this turns a check off.
    expect(host.container.textContent).toContain('turns the vertical check off');
    await host.click('Save changes');

    const [patch] = mock.calledWith('PATCH', '/v1/pahchan/sites/s2');
    // An absent key means "leave it alone" on a PATCH, so blanking cannot be
    // said by omission -- and both columns go together, because a tolerance
    // with no altitude is what the CHECK constraint refuses.
    expect(patch.body.clear_altitude).toBe(true);
    expect(patch.body.altitude_m).toBeUndefined();
    expect(patch.body.altitude_tolerance_m).toBeUndefined();
  });

  it('deactivating a site is a PATCH, never a DELETE', async () => {
    await host.render(wrap(<Sites />));
    await host.click(host.$$('button').find(b => b.textContent === 'Deactivate'));
    const [patch] = mock.calledWith('PATCH', '/v1/pahchan/sites/s1');
    expect(patch.body).toEqual({ is_active: false });
    expect(mock.calledWith('DELETE')).toHaveLength(0);
  });

  /* -- The register: why a punch fifteen metres away is flagged ------------- */

  it('a punch flagged on HEIGHT says so -- the distance alone is unreadable', async () => {
    // Inside the radius by every horizontal measure, and four floors up. Before
    // this the reviewer read "Outside site" beside "12 m" and had nothing at all
    // to reconcile the two with.
    mock.route({
      'GET /v1/pahchan/register': {
        date: '2026-07-27',
        punches: [{
          ...PUNCH,
          flags: ['geo'], distance_m: 12, accuracy_m: 9,
          altitude_m: 84, altitude_accuracy_m: 6,
          site_altitude_m: 52, site_altitude_tolerance_m: 15, altitude_gap_m: 32,
        }],
      },
    });
    await host.render(wrap(<Register />));
    await host.click(host.$('.rv__r'));
    const t = host.container.textContent;
    expect(t).toContain('Height vs site');
    expect(t).toContain('32 m out of \u00b115 m');
    expect(t).toContain('Flagged on height, not distance');
  });

  it('a site that does not check height shows no vertical row at all', async () => {
    // Most sites, for ever. An extra "not checked" row on every punch in the
    // product would be noise added to make one line readable.
    await host.render(wrap(<Register />));
    await host.click(host.$('.rv__r'));
    expect(host.container.textContent).not.toContain('Height vs site');
  });

  /* -- The Me tab: the rules, which the employee could never see ------------ */

  it('history shows the org OWN numbers for what decides a flag', async () => {
    await host.render(wrap(<History />));
    const t = host.container.textContent;
    expect(t).toContain('What decides a flag');
    expect(t).toContain('10 minutes');        // the org's grace, not a default
    expect(t).toContain('\u00b1100 m');       // the org's accuracy threshold
    expect(t).toContain('No punch is ever refused');
    // The fences, including which of them also checks a floor.
    expect(t).toContain('Tower, 14th floor');
    expect(t).toContain('within 15 m of 52 m above sea level');
    expect(t).toContain('Height is not checked here');
    // And the flag vocabulary, in the reviewer's own words.
    expect(t).toContain('Outside site');
    expect(t).toContain('Weak GPS');
  });

  it('a backend with no rules block renders no rules -- never invented figures', async () => {
    // The failure this guards is real and shipped: `_retention` returned a raw
    // policy row whose keys nothing read, so every DPDP notice the product ever
    // served quoted a hardcoded 90 days instead of the org's own window. A
    // panel that filled in a plausible radius would repeat it.
    mock.route({
      'GET /v1/pahchan/me': {
        employee: { id: 'e4', name: 'Suresh Kulkarni' },
        punches: [PUNCH],
        retention: { punch_photo_days: 90, reference_photo_grace_days: 45, record_retention_years: 3 },
      },
    });
    await host.render(wrap(<History />));
    const t = host.container.textContent;
    expect(t).not.toContain('What decides a flag');
    expect(t).not.toContain('Grace before');
    // The rest of the tab still works.
    expect(t).toContain('90 days');
  });
});

