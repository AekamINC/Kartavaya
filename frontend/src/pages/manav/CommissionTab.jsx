// Manav → Commission. The arrangements a firm has agreed, and their ladders.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// The commission model was built end to end — migration 190, services/
// commission.py, five endpoints in routers/manav.py, a payroll line — and
// shipped with NO SCREEN. Two of those endpoints had no caller anywhere in the
// browser, so a firm could be told the feature existed and had no way to record
// a single rate. This is the screen.
//
// ── The four things this screen has to get right ────────────────────────────
//
// 1 · NO DEFAULT RATE. The owner: "no default commission percentage please org
//     decide its own commission." Every rate box starts empty, with no
//     placeholder — a greyed "e.g. 3" in a rate field is a suggestion, and a
//     suggestion about somebody's pay from a product that knows nothing about
//     the firm is exactly what was asked against.
//
// 2 · A BAND HAS NO UPPER BOUND. It runs to the next band's floor, or to
//     infinity. The editor shows the upper edge as DERIVED TEXT that moves as
//     you type, never as a second box: two boxes is how two rungs come to
//     disagree about where one ends and the next begins. Bands are MARGINAL —
//     each pays on its own slice — and the preview says so in rupees.
//
// 3 · AN ELIGIBLE SCHEME WITH NO BANDS IS REFUSED BEFORE THE REQUEST IS SENT.
//     Migration 190 enforces it with a DEFERRED constraint trigger, which fires
//     at COMMIT — so without a check here the user learns it from a 400 carrying
//     a database sentence, after the write was attempted. `schemeProblems()` in
//     commissionModel.js refuses it at the button.
//
// 4 · TWO CONCURRENT ARRANGEMENTS ARE TWO ARRANGEMENTS, NOT A DUPLICATE. The
//     owner's own example is one person on monthly commission for their own
//     sales AND annual commission on their department's gross profit. A
//     scheme's identity is (period, scope) — which is what migration 190 keys
//     its uniqueness on — so that pair is printed on every row and every card,
//     and the two group side by side under "In force now" rather than reading
//     as the same record entered twice.
//
// ── NO SALARY FIGURE APPEARS ANYWHERE ON THIS SCREEN ────────────────────────
//
// A rate and a threshold are not pay. There is no CTC here, no basic, no
// payslip amount and no computed commission — the arrangement is one thing and
// what it paid is another, and the second belongs to a period with a date on
// it, not to a configuration screen.
//
// ── AND NOTHING PRINTS ZERO WHERE THE TRUTH IS "NOT KNOWN" ──────────────────
//
// Four different absences, four different words, following
// services/commission.py's own vocabulary:
//
//   not checked yet     nobody has asked the server about this person. The
//                       roster does NOT survey 98 people on tab open — see
//                       `runSurvey` — so until it is run this is the honest
//                       answer, and "no scheme" would be a claim nobody made.
//   no scheme recorded  asked, and there is nothing. Different from a recorded
//                       "not on commission".
//   not on commission   a scheme exists and says no. A recorded fact.
//   department not set  a department-scoped scheme against one of the eleven
//                       employees with no department. The commission cannot be
//                       computed for them and the answer is never ₹0.
import React, { useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td, BackButton, Section } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Badge, useList, ErrorNote, Shim, errText, FMT } from './_shared';
import {
  BASES, PERIODS, REVENUE_SCOPES, BASIS_LABEL, PERIOD_LABEL, SCOPE_LABEL,
  blankBand, blankScheme, describeLadder, figure, ladder, payloadBands,
  schemeIdentity, schemePayload, schemeProblems, splitByDate, todayISO, trimRate,
} from './commissionModel';

/** Asked, and there is nothing recorded. */
const NO_SCHEME = 'no scheme recorded';
/** Nobody has asked the server about this person yet. */
const UNCHECKED = 'not checked yet';

/**
 * Run `fn` over `items` a few at a time.
 *
 * The survey is one request PER PERSON — there is no org-wide commission
 * endpoint — and 98 of them at once is a burst this product has no reason to
 * send. Six in flight keeps it quick and keeps the connection pool alone.
 */
async function mapLimit(items, limit, fn) {
  const queue = [...items.entries()];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      // eslint-disable-next-line no-await-in-loop
      await fn(next[1], next[0]);
    }
  });
  await Promise.all(workers);
}

export default function CommissionTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record commission arrangements' });
  const employees = useList('/v1/manav/employees');
  const [survey, setSurvey] = useState({ running: false, done: 0, total: 0, by: {}, failed: [] });
  const [openFor, setOpenFor] = useState(null);
  const [creatingFor, setCreatingFor] = useState(null);
  // Bumped after a write so the person panel re-reads. Without it the panel's
  // `useList` keys on the employee alone, and returning to it after recording
  // an arrangement would show the list as it was BEFORE the write — the new
  // ladder invisible on the one screen that exists to show it.
  const [tick, setTick] = useState(0);

  const people = employees.items || [];

  /**
   * Ask the server about every person, once, on an explicit click.
   *
   * NOT on mount, and the reason is not only the 98 requests. Every one of them
   * writes a `manav.commission_schemes_read` row to the audit log, so an
   * automatic survey would mean opening a tab leaves 98 audit entries behind —
   * an audit trail that records the screen rather than the reader.
   */
  const runSurvey = useCallback(async () => {
    if (!people.length) return;
    setSurvey({ running: true, done: 0, total: people.length, by: {}, failed: [] });
    const by = {};
    const failed = [];
    await mapLimit(people, 6, async (emp) => {
      try {
        const r = await api.get(`/v1/manav/employees/${emp.id}/commission-schemes`);
        by[emp.id] = r.data?.data || [];
      } catch (err) {
        // A failed read is NOT "no scheme". The person stays unchecked and is
        // named in the failure note — an error rendered as an empty answer is
        // the one mistake this module was rebuilt to stop making.
        failed.push({ name: emp.name, why: errText(err) });
      }
      setSurvey(s => ({ ...s, done: s.done + 1 }));
    });
    setSurvey({ running: false, done: people.length, total: people.length, by, failed });
  }, [people]);

  if (creatingFor) {
    return (
      <SchemeForm
        employee={creatingFor.employee}
        preset={creatingFor.preset}
        onCancel={() => setCreatingFor(null)}
        onSaved={(savedFor) => {
          setCreatingFor(null);
          setTick(t => t + 1);
          // The roster's answer for whoever was written is now stale. DROP it
          // rather than keep showing the old ladder as though it were current —
          // an unchecked person is an honest state, a stale one is not.
          if (savedFor) {
            setSurvey(s => {
              const by = { ...s.by };
              delete by[savedFor];
              return { ...s, by };
            });
          }
        }}
      />
    );
  }

  if (openFor) {
    return (
      <PersonCommission
        employee={openFor}
        tick={tick}
        onBack={() => setOpenFor(null)}
        onRecord={(preset) => setCreatingFor({ employee: openFor, preset })}
      />
    );
  }

  const checked = Object.keys(survey.by).length;

  return (
    <div>
      <p className="note note--info mn-intro">
        <b>A commission arrangement is a ladder, and it is marginal.</b> Each rate pays on
        its own slice — 3% on the part between ₹1,00,000 and ₹5,00,000, 3.75% on the part
        between ₹5,00,000 and ₹7,50,000, and so on. There is no default rate anywhere on
        this screen: the firm decides every figure. One person may hold more than one
        arrangement at a time — monthly on their own sales and annual on their
        department&rsquo;s — and both pay.
      </p>

      <div className="mn-bar">
        <span className="mn-count">
          {employees.loading ? 'Loading the register…'
            : `${people.length} ${people.length === 1 ? 'person' : 'people'} on the register`}
          {checked > 0 && `, ${checked} checked`}
        </span>
        <div className="mn-bar__gap" />
        <button
          type="button"
          className="k-btn k-btn--ghost"
          disabled={survey.running || !people.length}
          onClick={runSurvey}
        >
          {survey.running
            ? `Checking ${survey.done} of ${survey.total}…`
            : checked > 0 ? 'Check again' : 'Check who is on commission'}
        </button>
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite || !people.length}
          title={denial || undefined}
          onClick={() => setCreatingFor({ employee: null, preset: null })}
        >
          + Record an arrangement
        </button>
      </div>

      {checked === 0 && !survey.running && !employees.loading && people.length > 0 && (
        <p className="note mn-intro">
          Nobody has been checked yet, so the column below says so rather than saying
          &ldquo;no scheme&rdquo;. Checking asks the server once per person — {people.length}{' '}
          requests, each one recorded in the audit log — which is why it is a button and not
          something this tab does on its own every time it opens.
        </p>
      )}

      {survey.failed.length > 0 && (
        <p className="note note--warn mn-err" role="status">
          <b>{survey.failed.length} of {survey.total} could not be read.</b>{' '}
          {survey.failed.slice(0, 3).map(f => f.name).join(', ')}
          {survey.failed.length > 3 && ` and ${survey.failed.length - 3} more`}
          {' '}— they are left as &ldquo;{UNCHECKED}&rdquo;, not as &ldquo;{NO_SCHEME}&rdquo;.
          {' '}{survey.failed[0].why}
        </p>
      )}

      {employees.loading ? <Shim count={5} />
        : employees.error ? (
          <ErrorNote what="The employee register" error={employees.error} onRetry={employees.reload} />
        ) : people.length === 0 ? (
          <Empty
            icon="📈"
            title="Nobody on the register"
            sub="Commission is an arrangement with a person. Add employees in the Employees tab first."
          />
        ) : (
          <DataTable columns={['Person', 'Department', 'Commission', 'Terms', '']}>
            {people.map(emp => (
              <RosterRow
                key={emp.id}
                emp={emp}
                schemes={survey.by[emp.id]}
                onOpen={() => setOpenFor(emp)}
              />
            ))}
          </DataTable>
        )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One line of the roster
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `schemes` is deliberately three-valued: `undefined` = nobody asked,
 * `[]` = asked and there is nothing, a list = asked and here it is. An empty
 * array and an unasked person must never render the same, which is why this
 * takes the raw value rather than `schemes || []`.
 */
function RosterRow({ emp, schemes, onOpen }) {
  const today = todayISO();
  const known = Array.isArray(schemes);
  const { current, later } = known ? splitByDate(schemes, today) : { current: [], later: [] };
  const paying = current.filter(s => s.eligible);
  const closedCount = known ? schemes.length - current.length - later.length : 0;

  return (
    <tr>
      <Td bold>{emp.name}</Td>
      <Td className={emp.department ? undefined : 'mn-t__mute'}>
        {emp.department || 'department not set'}
      </Td>
      <Td>
        {!known ? <span className="mn-t__mute">{UNCHECKED}</span>
          : schemes.length === 0 ? <span className="mn-t__mute">{NO_SCHEME}</span>
            : paying.length === 0 ? <Badge text="not on commission" color="var(--on-surface-3)" />
              : (
                <span className="mn-lad__ids">
                  {paying.map(s => (
                    <Badge key={s.id} text={schemeIdentity(s)} color="var(--ok)" />
                  ))}
                </span>
              )}
      </Td>
      <Td>
        {!known ? <span className="mn-t__mute">—</span>
          : paying.length === 0 ? <span className="mn-t__mute">—</span>
            : (
              <span className="mn-lad__sum">
                {paying.map(s => (
                  <span key={s.id} className="mn-lad__sumline">
                    {describeLadder(s.bands, FMT) || 'terms not recorded'}
                    {s.revenue_scope === 'department' && !emp.department && (
                      <b className="mn-t__warn"> · department not set</b>
                    )}
                  </span>
                ))}
              </span>
            )}
      </Td>
      <Td>
        <div className="mn-rowact">
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={onOpen}>
            Open
          </button>
          {closedCount > 0 && (
            <span className="mn-t__mute mn-count">
              {closedCount} earlier {closedCount === 1 ? 'version' : 'versions'}
            </span>
          )}
        </div>
      </Td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One person's arrangements — every version, grouped by whether it is in force
   ══════════════════════════════════════════════════════════════════════════ */

function PersonCommission({ employee, tick, onBack, onRecord }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record commission arrangements' });
  const state = useList(
    `/v1/manav/employees/${employee.id}/commission-schemes`,
    [employee.id, tick],
  );
  const today = todayISO();
  const groups = splitByDate(state.items || [], today);

  return (
    <div>
      <BackButton onClick={onBack} label="Back to the register" />
      <div className="k-detail__header mn-head">
        <div>
          <h3 className="k-detail__title">{employee.name}</h3>
          <p className="k-detail__sub">
            {employee.designation ? `${employee.designation} · ` : ''}
            {employee.department || 'no department recorded'}
          </p>
        </div>
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => onRecord(null)}
        >
          + Record an arrangement
        </button>
      </div>

      {state.loading ? <Shim count={3} />
        : state.error ? (
          <ErrorNote what="This person's commission arrangements" error={state.error} onRetry={state.reload} />
        ) : (state.items || []).length === 0 ? (
          <Empty
            icon="📈"
            title={`No commission arrangement recorded for ${employee.name}`}
            sub={'Nothing has been agreed, or nothing has been written down — this screen '
              + 'cannot tell those apart and does not guess. They have not earned nothing; '
              + 'there is simply no arrangement on file.'}
            cta={canWrite ? '+ Record an arrangement' : undefined}
            onCta={canWrite ? () => onRecord(null) : undefined}
          />
        ) : (
          <>
            <SchemeGroup
              title="In force now"
              hi="अभी लागू"
              sub={groups.current.length > 1
                ? 'Two arrangements, and they are not duplicates: each is resolved on its own '
                  + 'period and its own scope, and both pay.'
                : ''}
              schemes={groups.current}
              employee={employee}
              onRevise={onRecord}
              empty="Nothing is in force today."
            />
            {groups.later.length > 0 && (
              <SchemeGroup
                title="Agreed, starting later"
                hi="आगे से"
                sub="Already agreed. Not yet in force."
                schemes={groups.later}
                employee={employee}
                onRevise={onRecord}
              />
            )}
            {groups.earlier.length > 0 && (
              <SchemeGroup
                title="Earlier versions"
                hi="पुराना"
                sub={"History, and it is kept: last quarter's commission has to keep computing "
                  + "on last quarter's terms."}
                schemes={groups.earlier}
                employee={employee}
                onRevise={onRecord}
                muted
              />
            )}
          </>
        )}
    </div>
  );
}

function SchemeGroup({ title, hi, sub, schemes, employee, onRevise, empty, muted }) {
  return (
    <Section title={title} hi={hi}>
      {sub && <p className="mn-count mn-grp__sub">{sub}</p>}
      {schemes.length === 0
        ? <p className="mn-t__mute mn-count">{empty}</p>
        : (
          <div className="mn-list">
            {schemes.map(s => (
              <SchemeCard
                key={s.id}
                scheme={s}
                employee={employee}
                muted={muted}
                onRevise={onRevise}
              />
            ))}
          </div>
        )}
    </Section>
  );
}

function SchemeCard({ scheme, employee, muted, onRevise }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record commission arrangements' });
  const rungs = ladder(scheme.bands);
  const scopeUnresolvable = scheme.revenue_scope === 'department' && !employee.department;

  return (
    <div className={`mn-sch${muted ? ' mn-sch--past' : ''}`}>
      <div className="mn-sch__h">
        <span className="mn-sch__id">{schemeIdentity(scheme)}</span>
        {scheme.eligible
          ? <Badge text="on commission" color="var(--ok)" />
          : <Badge text="not on commission" color="var(--on-surface-3)" />}
        <div className="mn-bar__gap" />
        <span className="mn-sch__when">
          From {scheme.effective_from}
          {scheme.effective_to
            ? ` until ${scheme.effective_to} (exclusive — the first day it no longer applies)`
            : ' · still in force'}
        </span>
      </div>

      <p className="mn-sch__meta">
        Measured on <b>{BASIS_LABEL[scheme.basis] || scheme.basis}</b>
        {scheme.revenue_scope
          ? <>, over <b>{(SCOPE_LABEL[scheme.revenue_scope] || scheme.revenue_scope).toLowerCase()}</b></>
          : <>, and the firm has not said whose revenue this measures</>}
        , settling <b>{(PERIOD_LABEL[scheme.period] || scheme.period).toLowerCase()}</b>.
      </p>

      {scopeUnresolvable && (
        <p className="note note--warn mn-sch__warn">
          <b>Department not set.</b> {employee.name} has no department on their record, and
          this arrangement is measured on their department&rsquo;s revenue. Until a department
          is recorded, the revenue this ladder applies to cannot be identified — the answer is
          &ldquo;department not set&rdquo;, and it is never ₹0.
        </p>
      )}

      {scheme.eligible && rungs.length === 0 && (
        <p className="note note--danger mn-sch__warn">
          <b>Terms not recorded.</b> This arrangement says the person is on commission and
          states no rate. The database refuses that state, so a row in it was written around
          the rule — it should be raised rather than relied on.
        </p>
      )}

      {rungs.length > 0 && (
        <ul className="mn-lad">
          {rungs.map(r => (
            <li key={r.from} className="mn-lad__r">
              <span className="mn-lad__rate">{trimRate(r.rate)}%</span>
              <span className="mn-lad__span">
                {r.to !== null
                  ? <>on {FMT(r.from)} – {FMT(r.to)}</>
                  : r.from === 0 ? <>on everything</> : <>on everything above {FMT(r.from)}</>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {scheme.notes && <p className="mn-sch__notes">{scheme.notes}</p>}

      {!scheme.effective_to && (
        <div className="mn-sch__act">
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--sm"
            disabled={!canWrite}
            title={denial || undefined}
            onClick={() => onRevise(scheme)}
          >
            Record the next version
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The form, and the band editor
   ══════════════════════════════════════════════════════════════════════════ */

function SchemeForm({ employee, preset, onCancel, onSaved }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record commission arrangements' });
  const { pushToast } = useToast();
  const employees = useList('/v1/manav/employees');
  const [form, setForm] = useState(() => {
    const base = blankScheme();
    if (employee) base.employee_id = employee.id;
    // Revising carries the IDENTITY across — same period, same scope, same
    // basis — and NOT the rates. Prefilling the old rates into a revision is
    // how a rate change silently keeps the old ladder for the one band nobody
    // scrolled to.
    if (preset) {
      base.eligible = true;
      base.basis = preset.basis || base.basis;
      base.period = preset.period || base.period;
      base.revenue_scope = preset.revenue_scope || '';
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [serverError, setServerError] = useState('');

  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  const problems = schemeProblems(form);

  const chosen = (employees.items || []).find(e => e.id === form.employee_id) || employee || null;
  const deptMissing = form.revenue_scope === 'department' && chosen && !chosen.department;

  async function submit(e) {
    e.preventDefault();
    // THE REFUSAL THAT MATTERS. `problems` contains the eligible-with-no-bands
    // sentence, so this returns before any request leaves the browser — the
    // database's own rule is a DEFERRED trigger and would only speak at COMMIT.
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    setServerError('');
    try {
      await api.post('/v1/manav/commission-schemes', schemePayload(form));
      pushToast({ title: 'Commission arrangement recorded', type: 'success' });
      onSaved(form.employee_id);
    } catch (err) {
      // The server's own sentence wins. `create_commission_scheme` answers a
      // clash with a paragraph explaining that a different period or scope is
      // allowed, and replacing that with "Failed" throws away the only text
      // that says what to do next.
      setServerError(errText(err, 'The arrangement could not be recorded.'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <BackButton onClick={onCancel} label="Back" />
      <form onSubmit={submit} className="k-formpanel">
        <h3 className="k-section__title">
          {preset ? 'The next version of this arrangement' : 'Record a commission arrangement'}
        </h3>

        {preset && (
          <p className="note note--warn mn-sch__warn">
            <b>The current version is still open-ended.</b> Two arrangements for the same
            period and scope cannot both be open at once, so this one needs an end date on
            the current version — and there is no way to close an existing arrangement from
            this screen, because the API offers none. Give this version a start date and an
            end date, or expect the server to refuse it.
          </p>
        )}

        {employees.error && (
          <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
        )}

        <div className="k-formpanel__grid k-formpanel__grid--3">
          <label className="k-formpanel__label">
            <span>Person</span>
            <select
              className="k-formpanel__input"
              value={form.employee_id}
              disabled={!!employee || employees.loading || !!employees.error}
              onChange={e => set({ employee_id: e.target.value })}
            >
              <option value="">{employees.loading ? 'Loading…' : 'Select…'}</option>
              {(employees.items || []).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>

          <label className="k-formpanel__label">
            <span>In force from</span>
            <DateInput
              type="date"
              className="k-formpanel__input"
              value={form.effective_from}
              onChange={e => set({ effective_from: e.target.value })}
            />
          </label>

          <label className="k-formpanel__label">
            <span>Until (optional)</span>
            <DateInput
              type="date"
              className="k-formpanel__input"
              value={form.effective_to}
              onChange={e => set({ effective_to: e.target.value })}
            />
          </label>
        </div>
        <p className="mn-count mn-grp__sub">
          &ldquo;Until&rdquo; is the first day the arrangement no longer applies, not the last
          day it does. Leave it empty while it is still in force. Written this way, a rate
          change is one date written once: the old version ends on 1 April and the new one
          begins on 1 April, so 31 March answers the old rate and 1 April the new one.
        </p>

        <label className="mn-chk mn-elig">
          <input
            type="checkbox"
            checked={form.eligible}
            onChange={e => set({ eligible: e.target.checked })}
          />
          <span>
            <b>This person is on commission.</b> Unticked, this records the opposite — that
            the firm has decided they are not — which is a different fact from having no
            arrangement at all.
          </span>
        </label>

        <div className="k-formpanel__grid k-formpanel__grid--3">
          <label className="k-formpanel__label">
            <span>Measured on</span>
            <select
              className="k-formpanel__input"
              value={form.basis}
              onChange={e => set({ basis: e.target.value })}
            >
              {/* NO DEFAULT. Turnover and gross profit are different amounts
                  of money, so the product does not pick one. */}
              <option value="">Not stated</option>
              {BASES.map(b => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
          </label>

          <label className="k-formpanel__label">
            <span>Settles</span>
            <select
              className="k-formpanel__input"
              value={form.period}
              onChange={e => set({ period: e.target.value })}
            >
              {/* NO DEFAULT. Monthly and annual are the same rate paid a
                  different number of times, so the product does not pick. */}
              <option value="">Not stated</option>
              {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </label>

          <label className="k-formpanel__label">
            <span>Whose revenue</span>
            <select
              className="k-formpanel__input"
              value={form.revenue_scope}
              onChange={e => set({ revenue_scope: e.target.value })}
            >
              {/* NO DEFAULT. Their own sales and their whole department's are
                  different amounts of money, so the product does not pick. */}
              <option value="">Not stated</option>
              {REVENUE_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
            </select>
          </label>
        </div>

        {deptMissing && (
          <p className="note note--warn mn-sch__warn">
            <b>{chosen.name} has no department recorded.</b> A department-scoped arrangement
            is resolved through that field and through nothing else, so this one will not
            resolve to any revenue — the answer for them will read &ldquo;department not
            set&rdquo;, never ₹0. You can still record this; it is a real agreement. Setting
            their department in the Employees tab is what makes it computable.
          </p>
        )}

        <BandEditor
          bands={form.bands}
          onChange={bands => set({ bands })}
          required={form.eligible}
        />

        <label className="k-formpanel__label mn-fw">
          <span>Notes</span>
          <textarea
            className="k-formpanel__input mn-ta"
            value={form.notes}
            onChange={e => set({ notes: e.target.value })}
          />
        </label>

        {showProblems && problems.length > 0 && (
          <div className="note note--danger mn-prob" role="status">
            <b>This cannot be recorded yet.</b>
            <ul className="mn-prob__l">
              {problems.map(p => <li key={p}>{p}</li>)}
            </ul>
          </div>
        )}

        {serverError && (
          <p className="note note--danger mn-sch__warn" role="status">
            <b>The server refused this arrangement.</b> {serverError}
          </p>
        )}

        <div className="k-formpanel__actions">
          <button type="button" className="k-btn k-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            type="submit"
            className="k-btn k-btn--primary"
            disabled={saving || !canWrite}
            title={denial || undefined}
          >
            {saving ? 'Recording…' : 'Record arrangement'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The ladder editor.
 *
 * ── There is no upper-bound box, and that is the whole design ───────────────
 *
 * Each row takes an amount and a rate. Where the rung ENDS is derived from the
 * next rung's amount and rendered as text that moves as you type, so the two
 * neighbours cannot be given contradicting edges. The highest rung reads "and
 * everything above", not an empty box somebody feels obliged to fill.
 *
 * ── The rate box starts empty and stays empty ───────────────────────────────
 *
 * No `defaultValue`, no `placeholder`. The owner asked for no default
 * percentage, and a greyed suggestion in a rate field is a default with
 * deniability.
 */
function BandEditor({ bands, onChange, required }) {
  const rows = bands.length ? bands : [blankBand()];
  const rungs = ladder(rows);
  const complete = payloadBands(rows);

  const edit = (i, patch) => onChange(rows.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const add = () => onChange([...rows, blankBand()]);
  // Never below one row — there has to be somewhere to type. Removing the last
  // one blanks it instead, which is also how an eligible scheme's ladder is
  // emptied deliberately rather than by accident.
  const remove = i => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [blankBand()]);

  /** Where this row's rung ends, once the rows are read in amount order. */
  const upperFor = (i) => {
    const r = rungs.find(x => x.index === i);
    if (!r) return null;
    return r.to;
  };

  return (
    <Section title="The rates" hi="दरें">
      <p className="mn-count mn-grp__sub">
        Each rate applies only to the part of the period&rsquo;s revenue inside its own range.
        A rate runs up to the next rate&rsquo;s amount, and the highest one runs on for ever —
        which is why there is nothing here to fill in for the top of a range.
        {required && ' At least one rate is required, because this person is marked as on commission.'}
      </p>

      <ul className="mn-lad mn-lad--ed">
        {rows.map((b, i) => {
          const from = figure(b.from_amount);
          const to = upperFor(i);
          return (
            /* eslint-disable-next-line react/no-array-index-key */
            <li key={i} className="mn-lad__ed">
              <span className="mn-lad__no">{i + 1}</span>
              <label className="mn-field mn-lad__f">
                <span className="mn-field__l">From (₹)</span>
                <input
                  className="k-formpanel__input"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={b.from_amount}
                  onChange={e => edit(i, { from_amount: e.target.value })}
                />
              </label>
              <label className="mn-field mn-lad__f">
                <span className="mn-field__l">Rate (%)</span>
                {/* No placeholder. See the docblock. */}
                <input
                  className="k-formpanel__input"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={b.rate_percent}
                  onChange={e => edit(i, { rate_percent: e.target.value })}
                />
              </label>
              <span className="mn-lad__to">
                {!Number.isFinite(from) ? 'runs to — '
                  : to !== null ? `runs to ${FMT(to)}`
                    : 'and everything above'}
              </span>
              <button
                type="button"
                className="k-btn k-btn--ghost k-btn--sm mn-lad__x"
                onClick={() => remove(i)}
                aria-label={`Remove rate ${i + 1}`}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mn-lad__add">
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={add}>
          + Add a rate
        </button>
      </div>

      {complete.length > 0 && (
        <p className="note note--info mn-lad__prev">
          <b>Reads as:</b> {describeLadder(rows, FMT)}.
          {complete[0].from_amount > 0 && (
            <> Below {FMT(complete[0].from_amount)} nothing is due.</>
          )}
        </p>
      )}
      {required && complete.length === 0 && (
        <p className="note note--warn mn-lad__prev">
          <b>No rate is stated.</b> An arrangement that says somebody is on commission and
          names no rate reads as configured on every screen and pays nothing every period.
          This will not be saved until a rate is entered, or &ldquo;on commission&rdquo; is
          unticked.
        </p>
      )}
    </Section>
  );
}
