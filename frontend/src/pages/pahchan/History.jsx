import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, body, rows as unwrapRows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonCard, SkeletonTable } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';
import { noticeLines } from '../../lib/pahchanNotice';

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
 * ── ASKING FOR A CORRECTION, HERE, ON THE WEB ───────────────────────────────
 *
 * This screen used to end a day with no punch on it by saying: "open this day on
 * your own register in the Kartavaya app and ask for a correction". That was
 * accurate and it is the wrong thing for a product to have to say. A missing
 * clock-out costs the employee that day's pay, and the remedy was on a different
 * device.
 *
 * Both endpoints are SELF-SERVICE and need no grant at all:
 *
 *   · `POST /v1/pahchan/regularisations` resolves the employee from the caller's
 *     own row and refuses anybody else's with a 403.
 *   · `GET /v1/pahchan/regularisations/mine` takes no employee parameter — the
 *     rows are selected by joining the caller's user_id, so asking for somebody
 *     else's is not a request it can express.
 *
 * `mobile/src/api/pahchan.ts` has called both since they were written. Neither
 * had a caller anywhere in `frontend/src`, so the reviewer's queue on the
 * Corrections tab could only ever receive rows from people holding a phone.
 *
 * `decision_note` is shown for a settled request, and that is the point rather
 * than a detail: `pahchan_attendance.py` states it — "A refusal with no reason is
 * the thing that generates the phone call this endpoint exists to prevent."
 *
 * The form is offered ONLY when `/me` resolved an employee. `POST` needs
 * `manav_employees.user_id` to match the caller, and no employee row on this
 * database carries one today — a button that always 403s is worse than no
 * button, because the person stops looking for the real remedy.
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

/** The three states a settled request can be in, in this table's vocabulary. */
const REQ_CHIP = { pending: 'pending', approved: 'approved', declined: 'rejected' };

export default function History() {
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [openDay, setOpenDay] = useState(null);

  // The corrections this person has asked for. Kept in its own three states —
  // a failed fetch must not render as "you have asked for none", which on this
  // screen would tell somebody their request was never filed.
  const [mine, setMine] = useState({ loading: true, error: '', items: [] });
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState({ direction: 'out', time: '', reason: '' });
  const [sending, setSending] = useState(false);

  const loadMine = useCallback(async () => {
    setMine(m => ({ ...m, loading: true, error: '' }));
    try {
      // The route answers a BARE ARRAY today. `rows()` so a later envelope does
      // not silently become an empty list, which here reads as "you never asked".
      const r = await api.get('/v1/pahchan/regularisations/mine');
      setMine({ loading: false, error: '', items: unwrapRows(r) });
    } catch (err) {
      setMine({
        loading: false,
        items: [],
        error: errorKind(err) === 'offline'
          ? 'Your corrections need a connection to load. Anything already asked for is safe.'
          : 'Your corrections did not load. This is a read failure — nothing you asked for has been lost.',
      });
    }
  }, []);

  useEffect(() => { loadMine(); }, [loadMine]);

  // A half-typed request belongs to the day it was opened on. Switching days
  // with the form still open would carry a time and a reason onto a different
  // date, and `for_date` is what decides which day's pay changes.
  useEffect(() => {
    setAsking(false);
    setAsk({ direction: 'out', time: '', reason: '' });
  }, [openDay]);

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

  async function submitAsk(e) {
    e.preventDefault();
    const reason = ask.reason.trim();
    // The endpoint's own floor is 3 characters. Said here so the answer is a
    // sentence and not a 422 the person cannot read.
    if (reason.length < 3) {
      pushToast({
        type: 'warning',
        title: 'Say what happened',
        message: 'Someone has to decide this. A line about the day is what they go on.',
      });
      return;
    }
    if (!ask.time) {
      pushToast({
        type: 'warning',
        title: 'Which time?',
        message: 'The correction replaces a clock-in or clock-out, so it needs the time you actually worked to.',
      });
      return;
    }
    setSending(true);
    try {
      // `for_date` is a plain day; `requested_at_time` is a full timestamp on
      // that day, because the column is `timestamptz` and "18:05" is not one.
      // Built from a LOCAL datetime string so the instant is the one the
      // employee means, whatever the server's timezone is.
      const at = new Date(`${openDay}T${ask.time}:00`);
      await api.post('/v1/pahchan/regularisations', {
        // From `/me`, never typed. The endpoint refuses anybody else's record,
        // so a field here would only ever be a way to get a 403.
        employee_id: data.employee.id,
        for_date: openDay,
        requested_direction: ask.direction,
        requested_at_time: at.toISOString(),
        reason,
      });
      pushToast({
        type: 'success',
        title: 'Correction requested',
        // Named, because "submitted" leaves people refreshing this page.
        message: 'Someone at your organisation decides it. Their answer, and their reason, appear below.',
      });
      setAsking(false);
      setAsk({ direction: 'out', time: '', reason: '' });
      loadMine();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'That request was not filed',
        message: err.response?.data?.detail
          || 'Nothing was recorded. Try again, or ask HR to correct the day directly.',
      });
    } finally {
      setSending(false);
    }
  }

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
        <Section
          title={new Date(openDay).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          hi="विवरण"
          right={(
            /* On EVERY day, not only an empty one. A clock-out recorded an hour
               after the person left is as costly as one that never arrived, and
               it is the case a "nothing recorded" empty state cannot reach. */
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-expanded={asking}
              onClick={() => setAsking(a => !a)}
            >
              {asking ? 'Cancel' : 'Ask for a correction'}
            </button>
          )}
        >
          {asking && (
            <form className="ph__askform" onSubmit={submitAsk}>
              <p className="ph__askhead">
                Someone at your organisation decides this, and it reaches payroll only
                when attendance for the period is published. Say what actually happened —
                a decline has to carry a reason, and so should a request.
              </p>
              <div className="ph__askgrid">
                <label className="fld ph__fld">
                  <span className="fld__l">Which punch is wrong?</span>
                  <select
                    className="inp"
                    value={ask.direction}
                    onChange={e => setAsk(a => ({ ...a, direction: e.target.value }))}
                  >
                    <option value="in">Clock in</option>
                    <option value="out">Clock out</option>
                  </select>
                </label>
                <label className="fld ph__fld">
                  <span className="fld__l">The time it should be</span>
                  <input
                    className="inp"
                    type="time"
                    value={ask.time}
                    onChange={e => setAsk(a => ({ ...a, time: e.target.value }))}
                  />
                </label>
              </div>
              <label className="fld ph__fld">
                <span className="fld__l">What happened?</span>
                <textarea
                  className="inp"
                  rows={2}
                  value={ask.reason}
                  onChange={e => setAsk(a => ({ ...a, reason: e.target.value }))}
                  placeholder="I clocked out at the gate but the app had no signal."
                />
              </label>
              <div className="ph__acts">
                <button className="btn btn--fill btn--sm" type="submit" disabled={sending}>
                  {sending ? 'Sending…' : 'Send the request'}
                </button>
              </div>
            </form>
          )}

          {openList.length === 0 ? (
            <EmptyState
              icon="clock"
              title={{ en: 'Nothing recorded', hi: 'कुछ दर्ज नहीं' }}
              /* Names the control directly above rather than a different device.
                 It said "open this day on your own register in the Kartavaya app"
                 for as long as `POST /pahchan/regularisations` had no web
                 caller — accurate, and an answer that sent somebody whose pay
                 was wrong to go and find a phone. */
              description="No punch on this day. If that is wrong, use Ask for a correction above — someone at your organisation can then add the time you actually worked."
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

      <Section title="Corrections you have asked for" hi="आपके सुधार">
        {/* The half of the correction loop the employee could not see. `GET
            /regularisations` is the REVIEWER's queue and is gated on
            org_owner/org_admin — correctly — which left the person who filed
            the request with no way to learn the outcome. The mobile register
            said so in as many words: "This app cannot show you their answer."

            `/regularisations/mine` takes no employee parameter; the rows come
            from joining the caller's own user_id, so this section is safe on a
            tab that needs no grant. */}
        {mine.loading ? (
          <SkeletonRegion label="Loading your corrections…">
            <SkeletonTable rows={2} columns={4} />
          </SkeletonRegion>
        ) : mine.error ? (
          <div className="note note--warn" role="status">
            <b>Your corrections did not load.</b> {mine.error}
            <button type="button" className="btn btn--ghost btn--sm" onClick={loadMine}>
              Try again
            </button>
          </div>
        ) : mine.items.length === 0 ? (
          <EmptyState
            icon="clock"
            title={{ en: 'Nothing asked for', hi: 'कोई अनुरोध नहीं' }}
            description="You have not asked for any corrections. Open a day above and use Ask for a correction if a clock-in or clock-out is wrong."
          />
        ) : (
          <DataTable columns={['Day', 'Asked for', 'Your reason', 'Answer']}>
            {mine.items.map(r => (
              <tr key={r.id}>
                <Td mono>{new Date(r.for_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                <Td>
                  {r.requested_direction === 'in' ? 'Clock in' : 'Clock out'}
                  {r.requested_at_time && (
                    <span className="ph__mono">{hhmm(r.requested_at_time)}</span>
                  )}
                </Td>
                <Td><span className="ph__reason">{r.reason}</span></Td>
                <Td>
                  <StatusChip status={REQ_CHIP[r.status] || 'pending'} />
                  {/* The reason, always, and not only on a decline. It is the
                      only thing the employee can act on. */}
                  {r.decision_note && (
                    <span className="ph__decision">{r.decision_note}</span>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="What is held about you" hi="आपका विवरण">
        {/* 07 §9, in plain words and not buried in a policy page: "someone whose
            face is photographed twice a day should be able to see what is held
            and for how long without asking". The figures come from the same
            request as the punches.

            THE WORDS ARE THE NOTICE'S OWN, not a second statement of the same
            facts. This block used to restate "How long" and "Who sees it" in
            its own phrasing; once the `What we record` tab existed that made two
            independently-worded paragraphs about retention on one page, and the
            first person to edit one of them would have left the product saying
            two things about how long it keeps a photograph of somebody's face.
            `noticeLines()` resolves line 4 against the same `data.retention`
            this section already had in scope. */}
        <Note>
          {noticeLines(data.retention).find(l => l.key === 'How long').text}
          {' '}Deleted means deleted, not moved to an archive.
          {' '}The full notice — six lines, including who can see this and what you
          can ask for — is on the <b>What we record</b> tab above.
        </Note>
      </Section>
    </>
  );
}
