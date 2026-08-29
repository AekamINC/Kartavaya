import React, { useCallback, useEffect, useState } from 'react';
import { api, body as unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section } from '../../components/editorial';
import Note from '../../components/module/Note';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonCard } from '../../components/ui/Skeleton';
import Sites from './Sites';
import useModuleWrite from '../../hooks/useModuleWrite';
import DateInput from '../../components/ui/DateInput';
import { apiErrorText } from '../../lib/apiError';

/**
 * Attendance policy — geofence, flag thresholds, retention and reports.
 *
 * Two things this screen is careful about, both from 07-pahchan.md:
 *
 * §2 "Nothing blocks a punch." `allow_outside_geofence` defaults to ON and the
 * copy says what turning it off does NOT do — it still records, it only stops
 * counting as inside. Someone reading a checkbox called "allow outside geofence"
 * would reasonably assume unchecking it rejects the punch, and that assumption is
 * the one this module cannot afford.
 *
 * §5 Retention is a PROMISE. Shortening a window deletes people's records sooner,
 * so the three retention fields state their consequence in plain words and the
 * change is audited server-side. "Deleted means deleted, not archived to cold
 * storage. A retention promise with an archive behind it is not a retention
 * promise."
 */

const FIELDS = [
  {
    key: 'default_radius_m', label: 'Geofence radius', unit: 'metres', min: 10,
    help: 'How close to a site a punch has to be. 150m is the default because a gate 60m from the pin is still at work.',
  },
  {
    key: 'accuracy_flag_threshold_m', label: 'Flag GPS worse than', unit: 'metres', min: 10,
    help: 'Weak GPS is not fraud. Indoor and basement fixes routinely exceed 100m, so this flags for review — it never blocks.',
  },
  {
    key: 'grace_minutes', label: 'Late grace', unit: 'minutes', min: 0,
    help: 'Minutes after shift start before a punch is flagged late.',
  },
];

/**
 * The shift definition — migration 082's nine columns.
 *
 * They existed in the database and in `PATCH /policy` and had no UI at all, so
 * an org could not set a shift policy and `POST /attendance/publish` computed no
 * overtime for anyone. The defaults are statutory, not invented, and the help
 * text says which section each comes from — a threshold nobody can trace is a
 * threshold nobody will trust when a payslip is disputed.
 */
const SHIFT = [
  {
    key: 'standard_hours_per_day', label: 'Contracted day', unit: 'hours', min: 1, step: 0.25,
    help: 'What a half-day or an absence is measured against. Not the overtime threshold — those are two different facts that get conflated because they are usually close.',
  },
  {
    key: 'overtime_daily_threshold_hours', label: 'Overtime after', unit: 'hours in a day', min: 1, step: 0.25,
    help: 'Factories Act 1948 §54 — nine hours. Nine and not eight: the ninth hour is ordinary time under the Act, so paying it at the overtime rate is as wrong as not paying the tenth.',
  },
  {
    key: 'overtime_weekly_threshold_hours', label: 'Overtime after', unit: 'hours in a week', min: 1, step: 0.5,
    help: 'Factories Act 1948 §51 — forty-eight hours. Crossing this earns overtime even in a week where no single day did.',
  },
  {
    key: 'overtime_multiplier', label: 'Overtime rate', unit: '× ordinary wage', min: 1, step: 0.25,
    help: 'Factories Act 1948 §59 — twice the ordinary rate. Stored rather than applied in code, because it varies by state and by contract and a rate in code is a rate nobody can audit.',
  },
];

/** ISO-8601 weekday numbering, which is what `week_starts_on` stores. */
const WEEK_DAYS = [
  [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'],
  [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday'],
];

/** A `TIME` column round-trips as `HH:MM:SS`; `<input type="time">` wants `HH:MM`. */
const toTimeInput = v => (v ? String(v).slice(0, 5) : '');

const RETENTION = [
  {
    key: 'punch_photo_retention_days', label: 'Clock-in photos', unit: 'days', min: 1,
    help: 'Then deleted. The punch record itself is kept — hours worked is a payroll fact and the photo was evidence.',
  },
  {
    key: 'reference_photo_grace_days', label: 'Reference photos after an employee leaves', unit: 'days', min: 1,
    help: 'Kept while employed, then deleted this many days after they leave.',
  },
  {
    key: 'record_retention_years', label: 'Attendance records', unit: 'years', min: 1,
    help: 'Three years by default; some states require five. Check your obligation before shortening this.',
  },
];

export default function PahchanPolicy() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change attendance' });
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  // Which KIND of failure. This screen was hardcoded to `kind="server"`, so a
  // reviewer on a train was told the fault was ours and sent to report a bug
  // that was their own signal. `errorKind` treats a rejection with no response
  // as offline, which is the honest reading.
  const [errKind, setErrKind] = useState('server');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/policy');
      // `body()` (imported as `unwrap`, since `body` is the name this file's
      // `save()` already gives the PATCH payload it builds).
      setPolicy(unwrap(r));
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setPolicy(p => ({ ...p, [key]: value }));

  /**
   * The three CHECK constraints migration 082 adds, stated in English before the
   * request goes out. Postgres would reject these too, but a reviewer would get
   * back `pahchan_policy_ot_threshold_sane` and have to guess — and this is the
   * screen that decides what people are paid.
   */
  const shiftProblem = (() => {
    if (!policy) return null;
    const start = toTimeInput(policy.shift_start_time);
    const end = toTimeInput(policy.shift_end_time);
    if (!!start !== !!end) {
      return 'A shift is a window or it is nothing. Set both a start and an end, or clear both.';
    }
    if (policy.overnight_shift && !start) {
      return 'An overnight shift needs a window — there is nothing for it to carry over without one.';
    }
    const std = Number(policy.standard_hours_per_day);
    const daily = Number(policy.overtime_daily_threshold_hours);
    if (Number.isFinite(std) && Number.isFinite(daily) && daily < std) {
      return 'The overtime threshold is below the contracted day, so every ordinary day would earn overtime. That is always a misconfiguration.';
    }
    return null;
  })();

  const save = async () => {
    if (shiftProblem) {
      pushToast({ type: 'warning', title: 'The shift policy is not valid yet', message: shiftProblem });
      return;
    }
    setSaving(true);
    try {
      const body = {};
      for (const f of [...FIELDS, ...RETENTION, ...SHIFT]) {
        const n = Number(policy[f.key]);
        if (Number.isFinite(n) && n >= f.min) body[f.key] = n;
      }
      body.allow_outside_geofence = !!policy.allow_outside_geofence;
      body.report_daily   = !!policy.report_daily;
      body.report_weekly  = !!policy.report_weekly;
      body.report_monthly = !!policy.report_monthly;

      body.overtime_enabled = !!policy.overtime_enabled;
      body.overnight_shift  = !!policy.overnight_shift;
      const wk = Number(policy.week_starts_on);
      if (Number.isInteger(wk) && wk >= 1 && wk <= 7) body.week_starts_on = wk;
      // Empty string, not null. `PATCH /policy` drops any field that is None, so
      // null cannot clear a window — the handler's `NULLIF($n,'')::time` is the
      // documented way to say "no fixed shift", and 082's CHECK requires both
      // ends to go together.
      body.shift_start_time = toTimeInput(policy.shift_start_time);
      body.shift_end_time   = toTimeInput(policy.shift_end_time);

      await api.patch('/v1/pahchan/policy', body);
      pushToast({ type: 'success', title: 'Policy saved' });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not save the policy',
        message: apiErrorText(err, 'Try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return <SkeletonRegion label="Loading the policy…"><SkeletonCard lines={6} /></SkeletonRegion>;
  }
  if (state === 'error') {
    return (
      <ErrorState
        kind={errKind}
        detail={
          errKind === 'offline'
            ? 'The policy needs a connection to load. Nothing already saved has changed.'
            : 'The policy did not load. This is a read failure — no setting was changed.'
        }
        onRetry={load}
      />
    );
  }

  const numberRow = (f) => (
    <label className="fld ph__f ph__fld--num" key={f.key}>
      <span className="fld__l">{f.label}</span>
      <span className="ph__inline">
        <input
          className="inp"
          type="number"
          min={f.min}
          step={f.step}
          value={policy[f.key] ?? ''}
          onChange={e => set(f.key, e.target.value)}
        />
        <span className="ph__unit">{f.unit}</span>
      </span>
      <span className="fld__hint">{f.help}</span>
    </label>
  );

  return (
    <>
      <Section title="Shift and overtime" hi="पारी व अतिरिक्त">
        <Note variant="warn">
          Turning overtime on changes what people are paid. It is off until you set
          this, deliberately — no migration switches it on, and until it is on the
          payroll push leaves <code>overtime_hours</code> untouched rather than
          writing a zero, because &ldquo;0.0 overtime&rdquo; and &ldquo;overtime was
          never computed&rdquo; look identical on a payslip and mean opposite things.
        </Note>

        <label className="fld ph__check">
          <input
            type="checkbox"
            checked={!!policy.overtime_enabled}
            onChange={e => set('overtime_enabled', e.target.checked)}
          />
          <span>
            <span className="fld__l ph__check-l">Compute overtime</span>
            <span className="fld__hint">
              Hours beyond either threshold below are recorded as overtime when attendance
              is pushed to payroll.
            </span>
          </span>
        </label>

        {SHIFT.map(numberRow)}

        <label className="fld ph__f ph__fld--week">
          <span className="fld__l">Week starts on</span>
          <select
            className="inp"
            value={policy.week_starts_on ?? 1}
            onChange={e => set('week_starts_on', Number(e.target.value))}
          >
            {WEEK_DAYS.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
          </select>
          <span className="fld__hint">
            The weekly threshold is meaningless without knowing where the week starts,
            and the answer differs by employer.
          </span>
        </label>

        <div className="ph__times">
          {[['shift_start_time', 'Shift starts'], ['shift_end_time', 'Shift ends']].map(([key, label]) => (
            <label className="fld ph__fld ph__fld--time" key={key}>
              <span className="fld__l">{label}</span>
              <DateInput
                className="inp"
                type="time"
                value={toTimeInput(policy[key])}
                onChange={e => set(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="fld__hint ph__times-note">
          Leave both empty if there is no fixed shift — every day is then bounded by its
          own punches, which is exactly today&rsquo;s behaviour. A start without an end
          cannot bound a day, so they go together.
        </p>

        <label className="fld ph__check ph__check--tight">
          <input
            type="checkbox"
            checked={!!policy.overnight_shift}
            onChange={e => set('overnight_shift', e.target.checked)}
          />
          <span>
            <span className="fld__l ph__check-l">The shift crosses midnight</span>
            <span className="fld__hint">
              A punch at 01:00 then belongs to the shift that started at 22:00 the day
              before. Without this one night is split into two half-days, and both look
              like somebody forgot to clock out.
            </span>
          </span>
        </label>

        {shiftProblem && <Note variant="warn">{shiftProblem}</Note>}
      </Section>

      <Section title="Geofence and flags" hi="सीमा व चिह्न">
        {FIELDS.map(numberRow)}

        <label className="fld ph__check ph__check--tight">
          <input
            type="checkbox"
            checked={!!policy.allow_outside_geofence}
            onChange={e => set('allow_outside_geofence', e.target.checked)}
          />
          <span>
            <span className="fld__l ph__check-l">Count punches made outside a site</span>
            <span className="fld__hint">
              {/* The clarification that stops a reasonable misreading. */}
              Turning this off does not reject those punches — they are still recorded,
              and always will be. It only marks them for review.
            </span>
          </span>
        </label>
      </Section>

      {/* Immediately after the radius that has no effect without it. */}
      <Sites />

      <Section title="Retention" hi="प्रतिधारण">
        <Note variant="warn">
          These are promises to your staff. Shortening a window deletes records sooner
          and cannot be undone — deleted means deleted, not moved to an archive.
          Changes here are recorded in the audit log.
        </Note>
        {RETENTION.map(numberRow)}
      </Section>

      <Section title="Reports" hi="प्रतिवेदन">
        {/* THESE ARE NOT BEING SENT, AND THE SCREEN HAS TO SAY SO.
            No function in the backend reads report_daily, report_weekly,
            report_monthly or report_recipients — there is no sender, no
            template and no cron. Three ticked boxes under a heading that says
            "Reports" is a promise, and the three column defaults were TRUE, so
            it was a promise made to every org that never opened this page.
            The defaults are now false (backend/routers/pahchan.py, and
            migrations/106) and the warning below is the other half: a customer
            who ticks one of these must not spend a month wondering where the
            email went. The boxes stay usable because the preference is real and
            is what a sender will read on the day one exists — what was wrong was
            the silence, not the checkbox. */}
        <Note variant="warn">
          <b>Not being delivered yet.</b> Turning one of these on records what you want;
          it does not start sending anything. Nothing in the product mails an attendance
          summary today. Until that is built, use the attendance screen — it holds the
          same figures.
        </Note>
        <Note>
          Reports carry times, hours, flags and totals — never photographs. A mailbox
          is not a place a deletion promise can be kept, so photos stay in the portal
          where the retention job can actually reach them.
        </Note>
        {[
          ['report_daily', 'Daily summary'],
          ['report_weekly', 'Weekly summary'],
          ['report_monthly', 'Monthly summary'],
        ].map(([key, label]) => (
          <label key={key} className="fld ph__check ph__check--row">
            <input type="checkbox" checked={!!policy[key]} onChange={e => set(key, e.target.checked)} />
            <span className="fld__l">{label}</span>
          </label>
        ))}
      </Section>

      <div className="ph__save">
        <button className="btn btn--fill" onClick={save} disabled={saving || !!shiftProblem || !canWrite} title={denial || undefined}>
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </>
  );
}
