import React from 'react';
import { PUNCH_LABELS, punchColor } from '../../lib/statusColors';

/**
 * RulesPanel — the rules an employee is judged by, on their own screen.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Every rule in Pahchan was visible to the org and invisible to the person it
 * decides about. The Policy tab — radius, grace, accuracy threshold, and since
 * migration 193 the altitude window — is behind
 * `require_org_role('org_owner','org_admin')`. The employee's own History showed
 * their punches and the flags on them and could not show a single number behind
 * any of it. "Outside site" on a punch made from the office doorway is a
 * question the employee cannot answer without knowing the radius they missed by.
 *
 * That asymmetry is the whole objection to biometric attendance, and 07's own
 * header sets out to avoid it. The DPDP notice already says what is RECORDED;
 * this says what is JUDGED.
 *
 * ── EVERY FIGURE IS THE ORG'S OWN ───────────────────────────────────────────
 *
 * `rules` comes from `GET /v1/pahchan/me` — the one Pahchan endpoint an
 * employee may call — and its numbers are read from the policy row the org
 * actually saved. Nothing here has a hardcoded default, and the panel renders
 * NOTHING when `rules` is absent. A screen that quotes 100m at an org running
 * 40m is worse than a screen that quotes nothing: it is the exact failure
 * `_retention` was fixed for, where a hardcoded 90-day figure was printed on
 * every DPDP notice the product ever served.
 *
 * ── IT NAMES NOBODY ─────────────────────────────────────────────────────────
 *
 * Sites, thresholds and flag meanings only. No employee ids, no colleagues, no
 * reviewer names — a site is a place, not a person, and there is nothing here
 * that would put a UUID on screen (`check-rendered-ids.mjs`).
 */

/** A metre figure that may legitimately be absent. Never rendered as 0. */
const m = v => (v == null ? null : `${Math.round(Number(v))} m`);

function Rule({ k, v, note }) {
  return (
    <div className="ph__rule">
      <span className="ph__rule-k">{k}</span>
      <span className="ph__rule-v">{v}</span>
      {note && <span className="ph__rule-n">{note}</span>}
    </div>
  );
}

export default function RulesPanel({ rules }) {
  if (!rules) return null;

  const sites = rules.sites || [];
  const meanings = rules.flag_meanings || {};
  const checked = sites.filter(s => s.checks_altitude);

  return (
    <div className="ph__rules">
      <p className="ph__lede">
        These are your organisation’s own settings, not general ones. They decide
        which of your punches get a flag beside them.
        {rules.nothing_is_refused && (
          <> <b>No punch is ever refused.</b> A flag asks somebody to look at the day;
          it never stops you clocking in or out, and none of it happens on your phone.</>
        )}
      </p>

      <div className="ph__rulegrid">
        {rules.grace_minutes != null && (
          <Rule
            k="Grace before “late”"
            v={`${rules.grace_minutes} minutes`}
            note="After your shift start. Inside it, nothing is flagged."
          />
        )}
        {rules.accuracy_flag_threshold_m != null && (
          <Rule
            k="Weakest GPS accepted"
            v={`±${Math.round(rules.accuracy_flag_threshold_m)} m`}
            note="A looser fix than this is flagged. That is normal indoors and is not something you caused."
          />
        )}
        {rules.allow_outside_geofence != null && (
          <Rule
            k="Punching away from a site"
            v={rules.allow_outside_geofence ? 'Allowed, and flagged' : 'Flagged for review'}
            note="Either way it is recorded. Site visits and field work look like this."
          />
        )}
        {rules.standard_hours_per_day != null && (
          <Rule k="A full day" v={`${rules.standard_hours_per_day} hours`} />
        )}
        {rules.overtime_enabled != null && (
          <Rule
            k="Overtime"
            v={rules.overtime_enabled ? 'Counted' : 'Not counted'}
            note={rules.overtime_enabled
              ? undefined
              : 'Extra hours are still recorded — they are simply not paid as overtime here.'}
          />
        )}
      </div>

      {/* ── The fences ───────────────────────────────────────────────────────
          Named because an employee needs to know which fence they are inside,
          and because a "geo" flag at a site that also checks height is otherwise
          unanswerable. Only active sites come back from the server; a fence
          nobody is judged against would be noise here. */}
      {sites.length > 0 && (
        <>
          <h4 className="ph__ruleh">Where you can clock in</h4>
          <ul className="ph__sitelist">
            {sites.map(s => (
              <li key={s.name}>
                <b>{s.name}</b>
                <span className="ph__sub">
                  Anywhere within {m(s.radius_m) || 'its set radius'} of the pin.
                  {s.checks_altitude
                    ? ` This one also checks height: within ${m(s.altitude_tolerance_m)} of ${m(s.altitude_m)} above sea level, which is roughly its floor.`
                    : ' Height is not checked here — only distance.'}
                </span>
              </li>
            ))}
          </ul>
          {checked.length > 0 && (
            <p className="fld__hint ph__hint-wide">
              A phone measures height far less precisely than position, so a punch can be
              flagged on height while your distance was fine. If that keeps happening at a
              site you really were standing in, say so — the window is a setting, and it
              can be widened.
            </p>
          )}
        </>
      )}

      {/* ── What each flag means ─────────────────────────────────────────────
          Keyed by the code stored on the punch, labelled with the same words the
          reviewer sees (`PUNCH_LABELS`) and coloured with the same map. Two
          vocabularies for one flag is how an employee and their manager end up
          describing different things. */}
      {Object.keys(meanings).length > 0 && (
        <>
          <h4 className="ph__ruleh">What a flag means</h4>
          <dl className="ph__flags">
            {Object.entries(meanings).map(([code, text]) => (
              <div className="ph__flag" key={code}>
                <dt style={{ color: punchColor(code) }}>{PUNCH_LABELS[code] || code}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
