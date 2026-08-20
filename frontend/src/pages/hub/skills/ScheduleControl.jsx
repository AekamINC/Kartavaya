/**
 * ScheduleControl — the control that decides whether a skill ever runs by itself.
 *
 * ── Why it did not exist ────────────────────────────────────────────────────
 *
 * `/cron/skills` selects work with `trigger_config->>'type' = 'cron'`. Every
 * template in the catalogue carried NULL there, so the cron matched nothing and
 * all 104 skill runs in the product's history were somebody pressing Run. That
 * was never a bug in the scheduler — nothing in the product could write the
 * column. This is the missing half.
 *
 * ── The two shapes, and why there is no third ───────────────────────────────
 *
 * The backend understands an interval or a day of the month, and nothing else
 * (`services/skills/schedule.py`, which is validated against the cron's own SQL
 * by a test). This control offers exactly those, because a picker that can
 * express a schedule the cron cannot select on produces a skill that saves
 * cleanly, shows a cadence on its card, and never fires — which reads as a
 * broken scheduler rather than a wrong schedule.
 *
 * Statutory work is why the monthly option is anchored to a DATE rather than
 * offered as "every 30 days": GSTR-1 is due on the 11th, 3B on the 20th, PF and
 * ESI on the 15th. An interval drifts backwards through the month until the
 * reminder for a deadline lands after the deadline.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/toast';

/* Mirrors `services/skills/schedule.py:describe`. Duplicated deliberately: this
   renders before any request is made, so the person sees the consequence of the
   choice while making it rather than after saving it. The server's version is
   the one that reaches a log or a card loaded from the API. */
export function describeSchedule(cfg) {
  if (!cfg || !cfg.type) return 'Not scheduled — runs only when somebody presses Run.';
  if (cfg.interval_minutes != null) {
    const m = cfg.interval_minutes;
    if (m % 1440 === 0) {
      const d = m / 1440;
      return `Runs ${d === 1 ? 'every day' : `every ${d} days`}.`;
    }
    if (m % 60 === 0) {
      const h = m / 60;
      return `Runs ${h === 1 ? 'every hour' : `every ${h} hours`}.`;
    }
    return `Runs every ${m} minutes.`;
  }
  const d = cfg.day_of_month;
  const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
  const at = cfg.hour_utc ? `, after ${String(cfg.hour_utc).padStart(2, '0')}:00 UTC` : '';
  /* Said out loud because it is the surprising part: somebody choosing 31 has
     not thought about February, and finding out in February is worse. */
  const clamp = d > 28 ? ' (the last day, in shorter months)' : '';
  return `Runs on the ${d}${ord(d)} of every month${at}${clamp}.`;
}

const CADENCES = [
  ['none',    'Not scheduled',    'Only when somebody presses Run'],
  ['daily',   'Every day',        'Once every 24 hours'],
  ['weekly',  'Every week',       'Once every 7 days'],
  ['monthly', 'A date each month', 'Anchored — the way statutory work is'],
];

function toConfig(cadence, day, hour) {
  if (cadence === 'none')    return null;
  if (cadence === 'daily')   return { type: 'cron', interval_minutes: 1440 };
  if (cadence === 'weekly')  return { type: 'cron', interval_minutes: 10080 };
  const cfg = { type: 'cron', day_of_month: Number(day) };
  if (Number(hour) > 0) cfg.hour_utc = Number(hour);
  return cfg;
}

function fromConfig(cfg) {
  if (!cfg || !cfg.type) return { cadence: 'none', day: 1, hour: 0 };
  if (cfg.interval_minutes === 1440)  return { cadence: 'daily', day: 1, hour: 0 };
  if (cfg.interval_minutes === 10080) return { cadence: 'weekly', day: 1, hour: 0 };
  if (cfg.day_of_month != null) {
    return { cadence: 'monthly', day: cfg.day_of_month, hour: cfg.hour_utc || 0 };
  }
  /* An interval this control did not author — set by another interval, or by
     hand. Shown as monthly-shaped would be a lie, so it opens on "not
     scheduled" and the sentence above it still reports the truth. */
  return { cadence: 'none', day: 1, hour: 0 };
}

/**
 * @param {object}   template   the row, carrying id, name and trigger_config
 * @param {boolean}  canManage  owner-gated: arming a skill commits credits on a
 *                              timer nobody is watching
 * @param {Function} onChanged  called after a successful save so the list refetches
 */
export default function ScheduleControl({ template, canManage, onChanged }) {
  const { pushToast } = useToast();
  const [open,  setOpen]  = useState(false);
  const [busy,  setBusy]  = useState(false);
  const initial = fromConfig(template.trigger_config);
  const [cadence, setCadence] = useState(initial.cadence);
  const [day,     setDay]     = useState(initial.day);
  const [hour,    setHour]    = useState(initial.hour);

  const current = describeSchedule(template.trigger_config);
  const next    = describeSchedule(toConfig(cadence, day, hour));
  const scheduled = Boolean(template.trigger_config?.type);

  async function save() {
    setBusy(true);
    try {
      const res = await api.put(
        `/v1/hub/skills/templates/${template.id}/schedule`,
        { trigger_config: toConfig(cadence, day, hour) },
      );
      /* The blast radius, from the server's own count rather than guessed here.
         "Runs on the 12th" is a different decision for one org than for forty,
         and the person setting it is entitled to know which. */
      const n = res?.data?.active_grants ?? 0;
      pushToast({
        type: 'success',
        title: cadence === 'none' ? 'Schedule removed' : 'Schedule saved',
        message: `${res?.data?.schedule_description || next} `
               + `${n} organisation${n === 1 ? '' : 's'} currently ${n === 1 ? 'has' : 'have'} this skill.`,
      });
      setOpen(false);
      onChanged?.();
    } catch (e) {
      /* The server's sentence, not a generic one. `validate_trigger_config`
         refuses with a message naming what to do — "Choose either
         interval_minutes or day_of_month, not both" — and replacing that with
         "Could not save" throws away the only useful part. */
      pushToast({
        type: 'error',
        title: 'Could not set the schedule',
        message: e?.response?.data?.detail || 'Try again.',
      });
    } finally { setBusy(false); }
  }

  if (!canManage) {
    return <p className="sk-sched sk-sched--ro">{current}</p>;
  }

  return (
    <div className="sk-sched">
      <p className="sk-sched__now">
        <span className={scheduled ? 'sk-sched__dot is-on' : 'sk-sched__dot'} aria-hidden="true" />
        {current}
      </p>

      {!open ? (
        <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
          onClick={() => setOpen(true)}>
          {scheduled ? 'Change schedule' : 'Set a schedule'}
        </button>
      ) : (
        <div className="sk-sched__edit">
          <label className="fld">
            <span className="fld__l">How often</span>
            <select className="k-input" value={cadence}
              onChange={e => setCadence(e.target.value)}>
              {CADENCES.map(([v, label, hint]) => (
                <option key={v} value={v}>{label} — {hint}</option>
              ))}
            </select>
          </label>

          {cadence === 'monthly' && (
            <div className="sk-sched__row">
              <label className="fld">
                <span className="fld__l">Day of the month</span>
                <select className="k-input" value={day}
                  onChange={e => setDay(Number(e.target.value))}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span className="fld__l">Not before (UTC)</span>
                <select className="k-input" value={hour}
                  onChange={e => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, i) => i).map(h => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* What is about to be true, before it is true. */}
          <p className="sk-sched__next">{next}</p>

          <div className="sk-sched__act">
            <button type="button" className="k-btn k-btn--primary hb-btn--sm"
              disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save schedule'}
            </button>
            <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
              disabled={busy}
              onClick={() => {
                const back = fromConfig(template.trigger_config);
                setCadence(back.cadence); setDay(back.day); setHour(back.hour);
                setOpen(false);
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
