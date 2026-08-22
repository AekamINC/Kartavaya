import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FAMILY } from '../../theme/fonts';
import type { AttendanceRules } from '../../api/pahchan';

/**
 * The rules this employee is judged by — 07 §9, on the Me tab.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Every rule in Pahchan was visible to the org and invisible to the person it
 * decides about. The policy screen — radius, grace, the accuracy threshold, and
 * since migration 193 the altitude window — is behind an org-admin gate. The
 * employee's own register showed their punches and the flags on them and could
 * not show one number behind any of it.
 *
 * "Outside site" on a punch made standing in the office doorway is a question
 * the employee cannot answer without the figure they missed by, and it is the
 * question they will be asked. `MyBiometrics` already answers "what is held
 * about me"; this answers "what decides about me", which is the half that costs
 * somebody a conversation with their manager.
 *
 * ── EVERY NUMBER IS THE ORG'S OWN ───────────────────────────────────────────
 *
 * `rules` arrives on `GET /v1/pahchan/me` — the one Pahchan endpoint an
 * employee may call — and the server reads it from the policy row the org
 * actually saved. There is no fallback here and there must not be: this
 * component renders NOTHING when `rules` is absent. A hardcoded 100m on a
 * screen belonging to an org running 40m is the same failure that printed a
 * hardcoded 90-day retention figure on every DPDP notice the product served.
 *
 * ── IT NAMES NOBODY ─────────────────────────────────────────────────────────
 *
 * Sites, thresholds and flag meanings. No ids of any kind, no colleagues, no
 * reviewer names — a site is a place, not a person.
 */

/** A metre figure that may legitimately be absent. Never rendered as 0. */
const m = (v: number | null | undefined) =>
  (v == null ? null : `${Math.round(Number(v))}m`);

/** The reviewer's own words for a flag, so the phone and the register do not
 *  develop two vocabularies for the same code. Mirrors `PUNCH_LABELS` in
 *  `frontend/src/lib/statusColors.js`. */
const FLAG_LABELS: Record<string, string> = {
  late:     'Late',
  overtime: 'Overtime',
  geo:      'Outside site',
  accuracy: 'Weak GPS',
  offline:  'Sent later',
  mock:     'Simulated location',
  reuse:    'Photo reused',
  noref:    'No reference pair',
  retries:  'Repeated attempts',
};

function Rule({ t, k, v, note }: { t: any; k: string; v: string; note?: string }) {
  return (
    <View style={s.rule}>
      <Text style={[s.ruleK, { color: t.ink2 }]}>{k}</Text>
      <Text style={[s.ruleV, { color: t.ink }]}>{v}</Text>
      {note ? <Text style={[s.ruleN, { color: t.ink3 }]}>{note}</Text> : null}
    </View>
  );
}

export default function RulesCard({ t, rules }: { t: any; rules?: AttendanceRules }) {
  if (!rules) return null;

  const sites = rules.sites ?? [];
  const meanings = rules.flag_meanings ?? {};
  const anyChecksHeight = sites.some(x => x.checks_altitude);

  return (
    <View style={s.wrap}>
      <View style={s.labelRow}>
        <Text style={[s.label, { color: t.primary }]}>What decides a flag</Text>
        <Text style={[s.hi, { color: t.ink3 }]}>नियम</Text>
      </View>

      <View style={[s.card, { backgroundColor: t.surfaceLow }]}>
        <Text style={[s.lede, { color: t.ink2 }]}>
          Your organisation’s own settings, not general ones.
          {rules.nothing_is_refused
            ? ' No punch is ever refused — a flag asks somebody to look at the day, and nothing is decided on this phone.'
            : ''}
        </Text>

        {rules.grace_minutes != null && (
          <Rule
            t={t}
            k="Grace before “late”"
            v={`${rules.grace_minutes} minutes`}
            note="After your shift start. Inside it, nothing is flagged."
          />
        )}
        {rules.accuracy_flag_threshold_m != null && (
          <Rule
            t={t}
            k="Weakest GPS accepted"
            v={`±${Math.round(rules.accuracy_flag_threshold_m)}m`}
            note="A looser fix is flagged. That is normal indoors and is not something you caused."
          />
        )}
        {rules.allow_outside_geofence != null && (
          <Rule
            t={t}
            k="Punching away from a site"
            v={rules.allow_outside_geofence ? 'Allowed, and flagged' : 'Flagged for review'}
            note="Either way it is recorded. Site visits and field work look like this."
          />
        )}
        {rules.standard_hours_per_day != null && (
          <Rule t={t} k="A full day" v={`${rules.standard_hours_per_day} hours`} />
        )}
        {rules.overtime_enabled != null && (
          <Rule
            t={t}
            k="Overtime"
            v={rules.overtime_enabled ? 'Counted' : 'Not counted'}
            note={rules.overtime_enabled
              ? undefined
              : 'Extra hours are still recorded — they are simply not paid as overtime here.'}
          />
        )}

        {/* ── The fences ───────────────────────────────────────────────────
            Only active sites come back. A site that also checks height says so
            HERE, because otherwise a "geo" flag on a punch made fifteen metres
            from the door is unanswerable: the distance was fine and the floor
            was not, and nothing on this phone would ever have said so. */}
        {sites.length > 0 && (
          <View style={[s.block, { borderTopColor: t.outlineVar }]}>
            <Text style={[s.head, { color: t.ink }]}>Where you can clock in</Text>
            {sites.map(site => (
              <View key={site.name} style={s.site}>
                <Text style={[s.siteName, { color: t.ink }]}>{site.name}</Text>
                <Text style={[s.siteNote, { color: t.ink3 }]}>
                  {`Anywhere within ${m(site.radius_m) ?? 'its set radius'} of the pin. `}
                  {site.checks_altitude
                    ? `This one also checks height: within ${m(site.altitude_tolerance_m)} of ${m(site.altitude_m)} above sea level, which is roughly its floor.`
                    : 'Height is not checked here — only distance.'}
                </Text>
              </View>
            ))}
            {anyChecksHeight && (
              <Text style={[s.foot, { color: t.ink3 }]}>
                A phone measures height far less precisely than position, so a punch can be
                flagged on height while your distance was fine. If that keeps happening at a
                place you really were standing in, say so — the window is a setting and it
                can be widened.
              </Text>
            )}
          </View>
        )}

        {Object.keys(meanings).length > 0 && (
          <View style={[s.block, { borderTopColor: t.outlineVar }]}>
            <Text style={[s.head, { color: t.ink }]}>What a flag means</Text>
            {Object.entries(meanings).map(([code, text]) => (
              <View key={code} style={s.flag}>
                <Text style={[s.flagK, { color: t.ink2 }]}>{FLAG_LABELS[code] ?? code}</Text>
                <Text style={[s.flagV, { color: t.ink3 }]}>{text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:     { paddingHorizontal: 16, paddingBottom: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 6, paddingBottom: 8 },
  label:    { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  hi:       { fontSize: 12, fontFamily: FAMILY.devanagari },
  card:     { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  lede:     { fontSize: 12, lineHeight: 17.5 },
  rule:     { gap: 1 },
  ruleK:    { fontSize: 12 },
  ruleV:    { fontSize: 14, fontWeight: '700' },
  ruleN:    { fontSize: 11.5, lineHeight: 16.5 },
  block:    { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 8 },
  head:     { fontSize: 13, fontWeight: '700' },
  site:     { gap: 1 },
  siteName: { fontSize: 13, fontWeight: '600' },
  siteNote: { fontSize: 11.5, lineHeight: 16.5 },
  foot:     { fontSize: 11.5, lineHeight: 16.5 },
  flag:     { gap: 1 },
  flagK:    { fontSize: 12, fontWeight: '700' },
  flagV:    { fontSize: 11.5, lineHeight: 16.5 },
});
