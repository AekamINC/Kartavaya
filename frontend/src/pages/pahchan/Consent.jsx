import React, { useCallback, useEffect, useState } from 'react';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, Card, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonCard } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';
import DateInput from '../../components/ui/DateInput';
import useModuleWrite from '../../hooks/useModuleWrite';
import { PAHCHAN_NOTICE_VERSION, noticeLines } from '../../lib/pahchanNotice';
import {
  CONSENT_TITLE, CONSENT_LEDE, AGREE_LINES, DECLINE_LINES, WITHDRAW_LINES,
  METHOD_LABEL, ADMIN_METHODS, ADMIN_LEDE, ATTENDANCE_STATUSES,
} from './consentCopy';

/**
 * Consent — the choice about the photograph, and what happens when it is "no".
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 *
 * `staging.pahchan_employee_consents` (migration 209), `POST /consent`,
 * `GET /consent` and the enrolment refusal that reads them all shipped in
 * August and had no caller. Measured read-only on the live database
 * 2026-08-26: **24 reference photographs stored against 12 employees, all at
 * Unicode Group, and 0 rows in the consent table.** Twelve faces are on file
 * and not one recorded answer says anybody agreed.
 *
 * That is the finding this screen renders rather than describes. The roster
 * below is the whole payroll, LEFT JOINed to the consent table, so "2 photos ·
 * no answer recorded" is a row somebody can act on instead of a number in a
 * report.
 *
 * ── TWO AUDIENCES, ONE TAB, AND THE ORDER MATTERS ───────────────────────────
 *
 * The employee's own card is FIRST and is shown to everybody with the module,
 * including admins — an org owner is also somebody whose face may be on file.
 * The roster is second and 403s for anyone who is not `org_owner`/`org_admin`,
 * which is the same gate that gets somebody another person's reference photo
 * (`_may_view_others_biometrics`). A 403 there is not an error state: it is a
 * non-admin using their own tab correctly, so the panel is absent and says so
 * in one line. Any OTHER failure of that request says something different —
 * see `load()`, where the two are told apart.
 *
 * ── THE WORDS ARE NOT WRITTEN HERE ──────────────────────────────────────────
 *
 * The six disclosure lines come through `noticeLines()` from
 * `lib/pahchanNotice.js`, retention figures and all, because that file is the
 * single source of the DPDP copy and forbids paraphrase. Everything this screen
 * adds — the choice, the withdrawal, the alternative path — is in
 * `./consentCopy.js` with the reasoning for each line and a banned-claims list
 * a test enforces against the rendered output.
 *
 * ── AND IT DEGRADES THE SAME WAY THE CLOCK DOES ─────────────────────────────
 *
 * `manav_employees.user_id` is set on 2 of 109 rows, so `_employee_for`
 * resolves nobody for almost every account and `POST /consent/me` answers 409.
 * `Clock.jsx` states that plainly rather than rendering a button that always
 * fails; this does the same, in the same shape, and points at the admin path
 * that works today.
 */

/**
 * `null`/`undefined` is "nobody has answered", which is NOT "declined".
 *
 * Three states, not two, and collapsing them is the bug this screen exists to
 * make visible: twelve enrolled faces with no consent row are not twelve
 * refusals and they are not twelve agreements. `false` is an answer; absent is
 * a job.
 */
function stanceOf(consented) {
  if (consented === true) return 'agreed';
  if (consented === false) return 'declined';
  return 'none';
}

/**
 * Chip tone per stance.
 *
 * Existing `STATUS_MAP` keys with a `label` override, rather than three new
 * entries in `lib/statusColors.js`: that file is shared by every module and a
 * consent state is not a task state. `StatusChip` was built to take exactly
 * this pair — the tone from `status`, the word from `label`.
 */
const STANCE_CHIP = {
  agreed: { status: 'approved', label: 'Agreed' },
  declined: { status: 'rejected', label: 'Declined' },
  none: { status: 'requested', label: 'No answer yet' },
};

function onDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  // Built by hand rather than through toISOString(), which is UTC and moves an
  // IST date back a day for every moment before 05:30 — `DateInput` states the
  // same rule for the same reason.
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * `YYYY-MM-DD` + `HH:mm` → the instant that wall clock names, as an offset-
 * bearing ISO string.
 *
 * `manav_attendance.check_in` is `timestamptz`, and the supervisor is typing
 * the time on the clock in front of them — 09:30 in Ahmedabad, not 09:30 UTC.
 * `new Date('2026-08-26T09:30:00')` with no zone is parsed as LOCAL time per
 * ES2015, so `toISOString()` on it is the correct instant with the browser's
 * own offset already applied.
 *
 * The alternative — sending the naive string and letting Postgres cast it, as
 * `routers/manav.py` does — resolves it in the SESSION's time zone, which is
 * the server's and not the person's. That is a five-and-a-half hour error on a
 * row payroll reads, and it is silent.
 *
 * Returns null for an unparseable pair rather than `Invalid Date`, so a
 * half-typed field sends nothing instead of sending nonsense.
 */
function wallClockIso(day, hm) {
  if (!day || !hm) return null;
  const at = new Date(`${day}T${hm}:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** `manav_attendance.status` in words, falling back to the raw value. */
function statusWord(value) {
  const found = ATTENDANCE_STATUSES.find(([v]) => v === value);
  return found ? found[1] : value;
}

/* ══ The employee's own card ═══════════════════════════════════════════════ */

function MyConsent({ me, onSaved }) {
  const { pushToast } = useToast();
  const [saving, setSaving] = useState(null);
  const lines = noticeLines(me?.retention);
  const consent = me?.consent || null;
  const where = stanceOf(consent?.consented);

  const answer = async (consented) => {
    setSaving(consented ? 'agree' : 'decline');
    try {
      const out = body(await api.post('/v1/pahchan/consent/me', {
        consented,
        notice_version: PAHCHAN_NOTICE_VERSION,
      }));
      onSaved(out);
      pushToast({
        type: 'success',
        title: consented ? 'Recorded — you agreed' : 'Recorded — you declined',
        message: consented
          ? 'Your clock-in photographs are stored as described above.'
          : 'No further photograph of you will be taken or stored.',
      });
    } catch (e) {
      const detail = e?.response?.data?.detail;
      pushToast({
        type: 'error',
        title: 'That answer was not recorded',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card title={CONSENT_TITLE.en} sanskrit={CONSENT_TITLE.hi}>
      <div className="ph__consent">
        <p className="ph__consent-lede">{CONSENT_LEDE}</p>

        {/* The six disclosure lines, from the one place they live. Rendered
            open rather than behind six accordions: the notice tab is where you
            go to read them again, and this is the screen where you are being
            asked to decide on them. A decision made behind a chevron is a
            decision made on the first line only. */}
        <dl className="ph__consent-facts">
          {lines.map((line) => (
            <div className="ph__consent-fact" key={line.key}>
              <dt>{line.key}</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>

        <div className="ph__consent-cols">
          <div className="ph__consent-col">
            <h4 className="ph__consent-h">If you agree</h4>
            <ul className="ph__consent-list">
              {AGREE_LINES.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
          <div className="ph__consent-col">
            <h4 className="ph__consent-h">If you decline</h4>
            <ul className="ph__consent-list">
              {DECLINE_LINES.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
        </div>

        <h4 className="ph__consent-h">Changing your mind</h4>
        <ul className="ph__consent-list">
          {WITHDRAW_LINES.map((t) => <li key={t}>{t}</li>)}
        </ul>

        {/* `me.employee` null means `_employee_for` resolved nobody, which is
            107 of 109 employee rows today. `POST /consent/me` answers 409 for
            those accounts, so the buttons would be a control that always
            fails. Same shape as `Clock.jsx`'s unlinked branch. */}
        {!me?.employee ? (
          <Note variant="warn">
            Your account is not linked to an employee record, so there is nothing
            here to record your answer against. Tell your HR admin what you have
            decided — they can record it for you, on this same screen.
          </Note>
        ) : (
          <div className="ph__consent-choice">
            <div className="ph__consent-now">
              <StatusChip {...STANCE_CHIP[where]} />
              {consent?.recorded_at && (
                <span className="ph__consent-when">
                  {where === 'agreed' ? 'Agreed on ' : 'Declined on '}
                  {onDate(consent.recorded_at) || 'a date this browser could not read'}
                  {consent.method && METHOD_LABEL[consent.method]
                    ? ` · ${METHOD_LABEL[consent.method].toLowerCase()}`
                    : ''}
                </span>
              )}
            </div>
            <div className="ph__consent-acts">
              {where !== 'agreed' && (
                <button
                  type="button"
                  className="btn btn--fill"
                  disabled={saving !== null}
                  onClick={() => answer(true)}
                >
                  {saving === 'agree' ? 'Saving…' : 'I agree to the photograph'}
                </button>
              )}
              {where !== 'declined' && (
                <button
                  type="button"
                  className="btn"
                  disabled={saving !== null}
                  onClick={() => answer(false)}
                >
                  {saving === 'decline'
                    ? 'Saving…'
                    : where === 'agreed' ? 'Withdraw my agreement' : 'I decline'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ══ Recording somebody else's answer ══════════════════════════════════════ */

function RecordForm({ person, onDone }) {
  // Declared HERE and not passed down from the tab. `scripts/check-write-gates.mjs`
  // is the reason and it is a good one: a `canWrite` closed over from a sibling
  // scope is a ReferenceError the build cannot see, on whichever panel the
  // reviewer did not happen to open. A component that owns a write control asks
  // for itself.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record consent' });
  const { pushToast } = useToast();
  const [method, setMethod] = useState(ADMIN_METHODS[0][0]);
  const [consented, setConsented] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post('/v1/pahchan/consent', {
        employee_id: person.employee_id,
        method,
        consented,
        note: note.trim() || null,
        notice_version: PAHCHAN_NOTICE_VERSION,
      });
      pushToast({
        type: 'success',
        title: consented ? 'Agreement recorded' : 'Decline recorded',
        message: consented
          ? `${person.employee_name} can be enrolled.`
          : `${person.employee_name} must be offered the manual attendance path.`,
      });
      onDone();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      pushToast({
        type: 'error',
        title: 'That was not recorded',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ph__consent-form">
      <p className="ph__consent-formh">
        Recording for <strong>{person.employee_name}</strong>
      </p>

      <div className="ph__consent-row">
        <label className="fld ph__fld--name">
          <span className="fld__l">What did they say?</span>
          <select
            className="inp"
            value={consented ? 'yes' : 'no'}
            onChange={(e) => setConsented(e.target.value === 'yes')}
          >
            <option value="yes">They agreed</option>
            <option value="no">They declined</option>
          </select>
        </label>

        <label className="fld ph__fld--name">
          <span className="fld__l">How was it obtained?</span>
          <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
            {ADMIN_METHODS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="fld ph__f">
        <span className="fld__l">
          Note <span className="ph__opt">optional</span>
        </span>
        <input
          className="inp"
          value={note}
          maxLength={2000}
          placeholder="Where the form is filed, or who witnessed it"
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="fld__hint">
          This is the only place the evidence is described. A form nobody can find
          later is the same as no form.
        </span>
      </label>

      {!consented && (
        <Note variant="warn">
          Recording a decline stops every future enrolment and clock-in photograph
          for this person, from any source. Their hours are then recorded on the
          manual path below.
        </Note>
      )}

      <div className="ph__acts">
        <button
          type="button"
          className="btn btn--fill"
          disabled={saving || !canWrite}
          title={denial || undefined}
          onClick={submit}
        >
          {saving ? 'Recording…' : 'Record this answer'}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ══ The alternative attendance path ═══════════════════════════════════════ */

function ManualDay({ person, onDone }) {
  // Its own gate — see `RecordForm`.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record attendance' });
  const { pushToast } = useToast();
  const [day, setDay] = useState(today());
  const [from, setFrom] = useState('09:30');
  const [to, setTo] = useState('18:30');
  const [status, setStatus] = useState('present');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // A status with no hours — leave, a holiday, an absence — has no times to
  // send, and sending a pair for one would put work_hours on a day nobody
  // worked. `present`, `half_day` and `late` are the three that do.
  const timed = status === 'present' || status === 'half_day' || status === 'late';

  const submit = async () => {
    setSaving(true);
    try {
      await api.post('/v1/pahchan/attendance/manual', {
        employee_id: person.employee_id,
        for_date: day,
        // See `wallClockIso` — the browser's offset, applied here, because the
        // server's session zone is not the supervisor's.
        check_in: timed ? wallClockIso(day, from) : null,
        check_out: timed ? wallClockIso(day, to) : null,
        status,
        note: note.trim() || null,
      });
      pushToast({
        type: 'success',
        title: 'Day recorded',
        message: `${person.employee_name} — ${day}. Payroll reads this row directly.`,
      });
      onDone();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      pushToast({
        type: 'error',
        title: 'That day was not recorded',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ph__consent-form">
      <p className="ph__consent-formh">
        Recording a day for <strong>{person.employee_name}</strong>, who declined
        the photograph
      </p>

      <div className="ph__consent-row">
        <label className="fld ph__fld--date">
          <span className="fld__l">Date</span>
          <DateInput className="inp" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="fld ph__fld--name">
          <span className="fld__l">Status</span>
          <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
            {ATTENDANCE_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {timed && (
          <>
            <label className="fld ph__fld--time">
              <span className="fld__l">From</span>
              <DateInput className="inp" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="fld ph__fld--time">
              <span className="fld__l">To</span>
              <DateInput className="inp" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
      </div>

      <label className="fld ph__f">
        <span className="fld__l">
          Note <span className="ph__opt">optional</span>
        </span>
        <input
          className="inp"
          value={note}
          maxLength={400}
          placeholder="How you know — signed register, seen on site"
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="fld__hint">
          There is no photograph and no location on this row. Your account is the
          only attestation it carries, so say what it rests on.
        </span>
      </label>

      <div className="ph__acts">
        <button
          type="button"
          className="btn btn--fill"
          disabled={saving || !canWrite}
          title={denial || undefined}
          onClick={submit}
        >
          {saving ? 'Recording…' : 'Record this day'}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ══ The tab ══════════════════════════════════════════════════════════════ */

export default function Consent() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record consent' });

  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [me, setMe] = useState(null);
  /**
   * `null` in flight · an array when it loaded · `false` on a 403, which is a
   * non-admin rather than a fault · `'error'` on anything else.
   */
  const [roster, setRoster] = useState(null);
  const [manualDays, setManualDays] = useState([]);
  /** `{ employee_id, mode: 'consent' | 'day' }` — one row open at a time. */
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      // `days: 1` — this tab wants `retention` and `consent`, not the register.
      const r = await api.get('/v1/pahchan/me', {
        params: { days: 1, notice_version: PAHCHAN_NOTICE_VERSION },
      });
      setMe(body(r));
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
      return;
    }
    // Separately, and never fatal to the tab: a 403 here is the ordinary state
    // for every employee who is not an admin, and their own answer above is the
    // point of the screen.
    //
    // 403 and everything else are told apart deliberately. Collapsing them
    // would tell an admin whose request timed out that they are not an admin —
    // a permission sentence for a network fault is the kind of wrong answer
    // somebody acts on.
    try {
      const out = body(await api.get('/v1/pahchan/consent/roster'));
      setRoster(Array.isArray(out.employees) ? out.employees : []);
    } catch (err) {
      setRoster(err?.response?.status === 403 ? false : 'error');
      return;
    }
    try {
      const days = body(await api.get('/v1/pahchan/attendance/manual', { params: { days: 60 } }));
      setManualDays(Array.isArray(days) ? days : []);
    } catch {
      setManualDays([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state === 'loading') {
    return (
      <SkeletonRegion label="Loading your consent record…">
        <SkeletonCard lines={8} />
      </SkeletonRegion>
    );
  }

  if (state === 'error') {
    return (
      <ErrorState
        kind={errKind}
        detail={
          errKind === 'offline'
            ? 'Your consent record needs a connection to load. Nothing has changed.'
            : 'Your consent record did not load. This is a read failure — your answer is unchanged.'
        }
        onRetry={load}
      />
    );
  }

  const declinedCount = Array.isArray(roster)
    ? roster.filter((p) => p.consented === false).length : 0;
  const enrolledWithoutAnswer = Array.isArray(roster)
    ? roster.filter((p) => Number(p.approved_refs) > 0 && p.consented === null).length : 0;

  return (
    <>
      <Section title="Your answer" hi="आपका उत्तर">
        <MyConsent
          me={me}
          onSaved={(consent) => setMe((prev) => ({ ...prev, consent }))}
        />
        {/* `false`, not "no rows" — `GET /consent/roster` answered 403, which is
            the ordinary state for an employee who is not an admin. Said once,
            here, rather than left as an unexplained absence at the bottom of
            the tab. */}
        {roster === false && (
          <Note variant="info">
            Only your organisation&apos;s owner or an admin can see everyone
            else&apos;s answers.
          </Note>
        )}
        {roster === 'error' && (
          <Note variant="warn">
            Everyone else&apos;s answers did not load. Your own answer above is
            correct and unchanged — this is a read failure.
          </Note>
        )}
      </Section>

      {Array.isArray(roster) && (
        <Section title="Everyone's answer" hi="सहमति अभिलेख">
          <p className="ph__lede">{ADMIN_LEDE}</p>

          {enrolledWithoutAnswer > 0 && (
            <Note variant="warn">
              {enrolledWithoutAnswer === 1
                ? 'One person has reference photographs on file and no recorded answer.'
                : `${enrolledWithoutAnswer} people have reference photographs on file and no recorded answer.`}
              {' '}
              The photographs are already stored. Record what was actually
              obtained from each of them — do not record an answer nobody gave.
            </Note>
          )}

          {roster.length === 0 ? (
            <EmptyState
              icon="generic"
              title={{ en: 'Nobody on the rolls', hi: 'कोई कर्मचारी नहीं' }}
              description="There are no active employees to ask."
            />
          ) : (
            <DataTable
              arrange="pahchan.consent_roster"
              columns={['Employee', 'Photos on file', 'Answer', 'Recorded', 'Action']}
            >
              {roster.map((p) => {
                const where = stanceOf(p.consented);
                const isOpen = open?.employee_id === p.employee_id;
                return (
                  <React.Fragment key={p.employee_id}>
                    <tr>
                      <Td>
                        <strong className="ph__name">{p.employee_name}</strong>
                        {p.employee_code && <span className="ph__sub">{p.employee_code}</span>}
                      </Td>
                      <Td mono>{Number(p.approved_refs) || 0} of 2</Td>
                      <Td><StatusChip {...STANCE_CHIP[where]} /></Td>
                      <Td>
                        {p.recorded_at ? (
                          <span className="ph__consent-when">
                            {onDate(p.recorded_at)}
                            {p.method && METHOD_LABEL[p.method]
                              ? ` · ${METHOD_LABEL[p.method].toLowerCase()}` : ''}
                            {p.recorded_by_name ? ` · by ${p.recorded_by_name}` : ''}
                          </span>
                        ) : (
                          <span className="ph__consent-when">—</span>
                        )}
                      </Td>
                      <Td>
                        <div className="ph__rowacts">
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={!canWrite}
                            title={denial || undefined}
                            onClick={() => setOpen(
                              isOpen && open.mode === 'consent'
                                ? null
                                : { employee_id: p.employee_id, mode: 'consent' },
                            )}
                          >
                            {p.consented === null ? 'Record answer' : 'Change'}
                          </button>
                          {p.consented === false && (
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={!canWrite}
                              title={denial || undefined}
                              onClick={() => setOpen(
                                isOpen && open.mode === 'day'
                                  ? null
                                  : { employee_id: p.employee_id, mode: 'day' },
                              )}
                            >
                              Record a day
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr className="ph__expand">
                        <td colSpan={5}>
                          {open.mode === 'consent' ? (
                            <RecordForm person={p} onDone={() => { setOpen(null); load(); }} />
                          ) : (
                            <ManualDay person={p} onDone={() => { setOpen(null); load(); }} />
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </DataTable>
          )}
        </Section>
      )}

      {Array.isArray(roster) && declinedCount > 0 && (
        <Section title="Attendance without a photograph" hi="वैकल्पिक उपस्थिति">
          <Note variant="warn">
            These days carry no photograph and no location. They are written
            straight to the payroll attendance register and are never overwritten
            by a Pahchan publish — which is exactly why they need a supervisor
            behind each one.
          </Note>
          {manualDays.length === 0 ? (
            <EmptyState
              icon="generic"
              title={{ en: 'No days recorded yet', hi: 'कोई दिन दर्ज नहीं' }}
              description={
                declinedCount === 1
                  ? 'One person has declined. Record their days from the roster above.'
                  : `${declinedCount} people have declined. Record their days from the roster above.`
              }
            />
          ) : (
            <DataTable
              arrange="pahchan.consent_manual_days"
              columns={['Date', 'Employee', 'Status', 'Hours', 'Note']}
            >
              {manualDays.map((d) => (
                <tr key={d.id}>
                  <Td mono>{onDate(d.date) || d.date}</Td>
                  <Td>
                    <strong className="ph__name">{d.employee_name}</strong>
                    {d.employee_code && <span className="ph__sub">{d.employee_code}</span>}
                  </Td>
                  <Td>{statusWord(d.status)}</Td>
                  <Td mono>{d.work_hours == null ? '—' : `${d.work_hours} h`}</Td>
                  <Td><span className="ph__reason">{d.notes}</span></Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      )}

    </>
  );
}
