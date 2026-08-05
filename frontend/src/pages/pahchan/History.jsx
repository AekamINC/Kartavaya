import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, body } from '../../lib/api';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonCard } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';

/**
 * History — the employee's own month. `17-mobile-app.md:129` lists it as
 * "Pahchan history · month calendar, 7 states, legend" and
 * `mobile/src/screens/PahchanHistoryScreen.tsx` in the files to create. It
 * existed in no form, on either platform.
 *
 * It reads `GET /v1/pahchan/me`, which is the one Pahchan endpoint that returns
 * NO photo keys and no coordinates — deliberately, and it is why this screen is
 * safe for every employee rather than only a reviewer. Everything else on this
 * page is behind `require_org_role('org_owner','org_admin')`.
 *
 * WHAT THIS SCREEN IS FOR, and it is not decoration: 07 §9 says someone whose
 * face is photographed twice a day should be able to see what is held and for
 * how long without asking. So the retention figures come back with the punches
 * and are stated in plain words at the bottom, in the same request.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never renders "absent" for a day with no
 * punches. `/me` returns punches, not a muster roll — a day can be empty because
 * somebody was on leave, because it was a weekly off, or because the row is
 * still queued on a phone inside the 72-hour offline buffer. Colouring it red
 * would be the same manufactured fact the bridge refuses to write, and the
 * employee would be the one arguing against it. Days with no punch read as
 * "nothing recorded", which is exactly what is known.
 */

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_HI = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];

/** The states a day can actually be in, given what `/me` returns. */
const DAY_STATE = {
  complete:   ['Clocked in and out', 'var(--ok)'],
  open:       ['Still clocked in', 'var(--st-in-progress)'],
  flagged:    ['Flagged, awaiting review', 'var(--warn)'],
  reviewed:   ['Reviewed and cleared', 'var(--ok)'],
  questioned: ['Flagged by a reviewer', 'var(--danger)'],
  none:       ['Nothing recorded', 'var(--on-surface-faint)'],
};

const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function localDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return key(d);
}

function hhmm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function hoursBetween(a, b) {
  const t = (new Date(b) - new Date(a)) / 3600000;
  if (!Number.isFinite(t) || t <= 0) return null;
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export default function History() {
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [openDay, setOpenDay] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      // 120 is the endpoint's own ceiling. Asking for it once covers four
      // months of paging back with no further request per month.
      const r = await api.get('/v1/pahchan/me', { params: { days: 120 } });
      // `{employee, punches, retention}` — a bespoke object, so `body()`.
      setData(body(r));
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Punches grouped by the day they were CAPTURED on — 07 §4: captured_at is
   *  the punch's time, and received_at is only when it arrived. Using the
   *  receipt time silently rewrites attendance for anyone with poor signal. */
  const byDay = useMemo(() => {
    const out = {};
    for (const p of (data?.punches || [])) {
      const k = localDayKey(p.captured_at);
      if (!k) continue;
      (out[k] ||= []).push(p);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
    }
    return out;
  }, [data]);

  const dayState = useCallback((k) => {
    const list = byDay[k];
    if (!list || !list.length) return 'none';
    if (list.some(p => p.review_verdict === 'flagged')) return 'questioned';
    if (list.some(p => (p.flags || []).length && !p.review_verdict)) return 'flagged';
    const hasOut = list.some(p => p.direction === 'out');
    if (!hasOut) return 'open';
    return list.some(p => p.review_verdict === 'ok') ? 'reviewed' : 'complete';
  }, [byDay]);

  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    // Derived, never hand-typed. Monday-first, so Sunday (getDay 0) is index 6.
    const lead = (first.getDay() + 6) % 7;
    return { lead, daysIn };
  }, [month]);

  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const today = key(new Date());

  const totals = useMemo(() => {
    let present = 0;
    let flagged = 0;
    let minutes = 0;
    for (let d = 1; d <= grid.daysIn; d += 1) {
      const k = key(new Date(month.getFullYear(), month.getMonth(), d));
      const st = dayState(k);
      if (st === 'none') continue;
      present += 1;
      if (st === 'flagged' || st === 'questioned') flagged += 1;
      const list = byDay[k] || [];
      const first = list.find(p => p.direction === 'in');
      const last = [...list].reverse().find(p => p.direction === 'out');
      if (first && last) {
        const t = (new Date(last.captured_at) - new Date(first.captured_at)) / 60000;
        if (t > 0) minutes += t;
      }
    }
    return { present, flagged, hours: `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m` };
  }, [grid.daysIn, month, dayState, byDay]);

  if (state === 'loading') {
    return <SkeletonRegion label="Loading your attendance…"><SkeletonCard lines={8} /></SkeletonRegion>;
  }

  if (state === 'error') {
    return (
      <ErrorState
        kind={errKind}
        detail={
          errKind === 'offline'
            ? 'Your register needs a connection to load. Punches already recorded are safe.'
            : 'Your register did not load. Punches are safe — this is a read failure, not data loss.'
        }
        onRetry={load}
      />
    );
  }

  if (!data?.employee) {
    return (
      <EmptyState
        icon="generic"
        title={{ en: 'No employee record', hi: 'कोई रिकॉर्ड नहीं' }}
        description="Your account is not linked to an employee record yet, so there is nothing to show. Ask HR to link it."
      />
    );
  }

  const openList = openDay ? (byDay[openDay] || []) : [];

  return (
    <>
      <Section
        title={monthLabel}
        hi="मासिक"
        right={(
          <span className="ph__navbtns">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => { setOpenDay(null); setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); }}
            >
              ← Earlier
            </button>
            <button
              className="btn btn--ghost btn--sm"
              disabled={month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth()}
              onClick={() => { setOpenDay(null); setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); }}
            >
              Later →
            </button>
          </span>
        )}
      >
        <div className="pcal">
          <div className="pcal__head">
            {WEEK.map((d, i) => (
              <span key={d} className="pcal__dow">
                {d}
                <i lang="hi">{WEEK_HI[i]}</i>
              </span>
            ))}
          </div>
          <div className="pcal__grid">
            {Array.from({ length: grid.lead }, (_, i) => <span key={`lead${i}`} className="pcal__pad" />)}
            {Array.from({ length: grid.daysIn }, (_, i) => {
              const d = i + 1;
              const k = key(new Date(month.getFullYear(), month.getMonth(), d));
              const st = dayState(k);
              const [label, colour] = DAY_STATE[st];
              return (
                <button
                  key={k}
                  type="button"
                  className={`pcal__d${st === 'none' ? ' pcal__d--none' : ''}${openDay === k ? ' is-open' : ''}${k === today ? ' is-today' : ''}`}
                  /* A tint of the state colour, and the number in the colour
                     itself — never colour alone, which 23-accessibility.md
                     rules out. The label is on the button's accessible name.
                     The colour is genuinely per-day, so it arrives as `--c` and
                     pahchan.css does the mixing; "nothing recorded" is the
                     absence of a state rather than a state, so it takes a
                     modifier instead of a colour. */
                  style={st === 'none' ? undefined : { '--c': colour }}
                  aria-label={`${d} ${monthLabel} — ${label}`}
                  aria-pressed={openDay === k}
                  onClick={() => setOpenDay(openDay === k ? null : k)}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="pcal__legend">
            {Object.entries(DAY_STATE).map(([k2, [label, colour]]) => (
              <span key={k2} className="pcal__key">
                <i style={{ '--c': colour }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <p className="ph__cal-note">
          {totals.present} day{totals.present === 1 ? '' : 's'} with a punch this month · {totals.hours} between
          first clock-in and last clock-out{totals.flagged ? ` · ${totals.flagged} awaiting or under review` : ''}.
          A day with no punch reads as nothing recorded, not as an absence — this page shows
          what was clocked, and leave, a weekly off and a punch still queued on a phone all
          look the same from here.
        </p>
      </Section>

      {openDay && (
        <Section title={new Date(openDay).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} hi="विवरण">
          {openList.length === 0 ? (
            <EmptyState
              icon="clock"
              title={{ en: 'Nothing recorded', hi: 'कुछ दर्ज नहीं' }}
              /* Named the remedy and not the route to it, for as long as there
                 was no route: `POST /pahchan/regularisations` had no caller on
                 any surface. The request side lives on the phone — the employee
                 taps the day on their own register in the Kartavaya app — so
                 this says where rather than leaving "ask for a correction" as
                 an instruction with nowhere to carry it out. */
              description="No punch on this day. If that is wrong, open this day on your own register in the Kartavaya app and ask for a correction — someone at your organisation can then add the time you actually worked."
            />
          ) : (
            <DataTable columns={['Time', 'Direction', 'How it arrived', 'Flags', 'Review']}>
              {openList.map((p, i) => {
                const prevIn = openList.slice(0, i).reverse().find(x => x.direction === 'in');
                return (
                  <tr key={p.id}>
                    <Td mono>
                      {hhmm(p.captured_at)}
                      {p.direction === 'out' && prevIn && (
                        <span className="ph__sub">
                          {hoursBetween(prevIn.captured_at, p.captured_at)}
                        </span>
                      )}
                    </Td>
                    <Td>{p.direction === 'in' ? 'Clock in' : 'Clock out'}</Td>
                    <Td>
                      {p.source === 'offline' ? 'Saved on the phone' : 'Live'}
                      {/* 07 §4: an offline punch captured at 09:41 and synced at
                          11:38 is a 09:41 punch. The gap is shown rather than
                          hidden, because it is also the only honest place to see
                          a device clock that has been moved. */}
                      {p.source === 'offline' && p.received_at && (
                        <span className="ph__sub">
                          arrived {hhmm(p.received_at)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="rv__flags">
                        {(p.flags || []).length
                          ? (p.flags || []).map(f => <StatusChip key={f} status={f} />)
                          : <StatusChip status="clean" />}
                      </span>
                    </Td>
                    <Td>
                      {p.review_verdict
                        ? <StatusChip status={p.review_verdict === 'ok' ? 'done' : 'rejected'} />
                        : <span className="ph__unrev">Not yet reviewed</span>}
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Section>
      )}

      <Section title="What is held about you" hi="आपका विवरण">
        {/* 07 §9, in plain words and not buried in a policy page: "someone whose
            face is photographed twice a day should be able to see what is held
            and for how long without asking". The figures come from the same
            request as the punches. */}
        <Note>
          Your clock-in photographs are deleted after{' '}
          <b>{data.retention?.punch_photo_days ?? 90} days</b>. Your two reference
          photographs are deleted{' '}
          <b>{data.retention?.reference_photo_grace_days ?? 45} days</b> after you leave.
          The attendance record itself — dates and hours, no photograph — is kept for{' '}
          <b>{data.retention?.record_retention_years ?? 3} years</b>, because your
          employer is required by law to keep an attendance register. Deleted means
          deleted, not moved to an archive. Aekam, who runs Kartavaya, cannot see your
          photographs, times or location.
        </Note>
      </Section>
    </>
  );
}
