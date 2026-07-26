import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section } from '../../components/editorial';
import Note from '../../components/module/Note';
import ErrorState from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonCard } from '../../components/ui/Skeleton';

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
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/policy');
      setPolicy(r.data);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setPolicy(p => ({ ...p, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      for (const f of [...FIELDS, ...RETENTION]) {
        const n = Number(policy[f.key]);
        if (Number.isFinite(n) && n >= f.min) body[f.key] = n;
      }
      body.allow_outside_geofence = !!policy.allow_outside_geofence;
      body.report_daily   = !!policy.report_daily;
      body.report_weekly  = !!policy.report_weekly;
      body.report_monthly = !!policy.report_monthly;
      await api.patch('/v1/pahchan/policy', body);
      pushToast({ type: 'success', title: 'Policy saved' });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not save the policy',
        message: err.response?.data?.detail || 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return <SkeletonRegion label="Loading the policy…"><SkeletonCard lines={6} /></SkeletonRegion>;
  }
  if (state === 'error') {
    return <ErrorState kind="server" detail="The policy did not load." onRetry={load} />;
  }

  const numberRow = (f) => (
    <label className="fld" key={f.key} style={{ display: 'block', marginBottom: 14 }}>
      <span className="fld__l">{f.label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="inp"
          type="number"
          min={f.min}
          value={policy[f.key] ?? ''}
          onChange={e => set(f.key, e.target.value)}
          style={{ maxWidth: 120 }}
        />
        <span style={{ fontSize: 12.5, color: 'var(--on-surface-2)' }}>{f.unit}</span>
      </span>
      <span className="fld__hint">{f.help}</span>
    </label>
  );

  return (
    <>
      <Section title="Geofence and flags" hi="सीमा व चिह्न">
        {FIELDS.map(numberRow)}

        <label className="fld" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={!!policy.allow_outside_geofence}
            onChange={e => set('allow_outside_geofence', e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <span className="fld__l" style={{ marginBottom: 2 }}>Count punches made outside a site</span>
            <span className="fld__hint">
              {/* The clarification that stops a reasonable misreading. */}
              Turning this off does not reject those punches — they are still recorded,
              and always will be. It only marks them for review.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Retention" hi="प्रतिधारण">
        <Note variant="warn">
          These are promises to your staff. Shortening a window deletes records sooner
          and cannot be undone — deleted means deleted, not moved to an archive.
          Changes here are recorded in the audit log.
        </Note>
        {RETENTION.map(numberRow)}
      </Section>

      <Section title="Reports" hi="प्रतिवेदन">
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
          <label key={key} className="fld" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={!!policy[key]} onChange={e => set(key, e.target.checked)} />
            <span className="fld__l" style={{ marginBottom: 0 }}>{label}</span>
          </label>
        ))}
      </Section>

      <div style={{ marginTop: 20 }}>
        <button className="btn btn--fill" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </>
  );
}
