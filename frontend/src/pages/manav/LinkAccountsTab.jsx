// Manav → Link logins. Saying "this employee is that person", one at a time.
//
// ── The gap this screen exists to close ──────────────────────────────────────
//
// `manav_employees.user_id` is the only column joining a personnel file to an
// account that can sign in. Measured read-only against the live database on
// 2026-08-21: 98 employee rows, ZERO carrying a user_id, 32 accounts, and not
// one employee email equal to any address in `users`. There is no edge between
// the two halves of this product and none that can be inferred.
//
// Everything downstream dies on that NULL, and the split is clean:
//
//   · Commission and revenue are keyed on an ACCOUNT. Measured the same day:
//     `sales_commission_assignments.user_id`, `sales_commissions.user_id`,
//     `vikray_targets.salesperson_id` — all three commission tables empty, 34
//     targets. (There is no `manav_commission_schemes` table and no
//     `salesperson_id` on `vikray_orders` or `ganit_invoices`; orders and
//     invoices carry `created_by` and nothing else about who sold.)
//   · The personnel side is keyed on an EMPLOYEE: `vetana_payslips`,
//     `manav_attendance`, `manav_leave_requests` and twenty more.
//
// `manav_employees.user_id` is the only column joining those two halves. While
// it is NULL nothing an account earns can reach the personnel file it belongs
// to — not onto a payslip, not onto an HR record, not into a report by person —
// and clock-in, own payslip, own attendance and own leave dead-end on it too.
//
// ── Why nothing here is matched ──────────────────────────────────────────────
//
// Because a wrong link pays the wrong person their colleague's commission, and
// neither available signal is safe:
//
//   · Name. Six accounts in this database already share two display labels
//     between them. A name match on those is a coin toss wearing a tick.
//   · Email. Nothing to match on — measured, zero overlap between the addresses
//     HR types onto a personnel file and the addresses people sign in with.
//
// So a human decides each one and owns it. The server enforces that: the
// account list is built by `account_options`, which IS NOT TOLD which employee
// is being linked (see the signature test in
// `backend/tests/test_employee_user_link.py`) — a function that cannot see the
// name cannot rank by resemblance to it. Nothing arrives preselected and the
// confirm button is disabled until a person clicks.
//
// The one concession is the ordering toggle below: OFF by default, labelled a
// hint rather than a match, and it only reorders — it never selects, never
// filters anything out, and never marks a row as the likely one.
//
// ── Telling two people with one name apart, with no id ───────────────────────
//
// No user, member or org id is ever drawn (`scripts/check-rendered-ids.mjs`),
// so "check the UUID" is not available and would be useless to a human anyway.
// What separates two "Amit Shah"s here is five facts this organisation already
// knows about its own people: the address they sign in with, their role here,
// the day they joined here, the modules they were granted, and the last four
// digits of their mobile — HR holds the full number on the personnel file, so
// four digits is a check they can make and not a directory export.
//
// When a label really does repeat, the row says so out loud rather than leaving
// it to be noticed.
//
// ── Why this is a screen and not the panel already inside a record ───────────
//
// `EmployeesTab` has a picker on one employee's detail page. At 98 records and
// zero links, working that panel is 98 round trips through a directory, a row,
// a detail pane and a modal, with no way to see what is left. This is the queue:
// both halves of the number in one read, the accounts still free, and the links
// already made — because seeing that Priya's record points at Rahul's account is
// how a wrong one gets found.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Badge, useList, useResource, ErrorNote, Shim, errText } from './_shared';

/** `org_admin` is a column value, not something to show a person. */
const ROLE_LABEL = {
  org_owner: 'Organisation owner',
  org_admin: 'Organisation admin',
  org_member: 'Member',
};

/** `3 Feb 2024` from `2024-02-03`. Two people with one name are most often
 *  separated by WHEN they arrived, so the date has to be readable, not ISO.
 *  Parsed at local midnight — `new Date('2024-02-03')` is UTC and renders the
 *  previous day for everybody west of Greenwich. */
export function day(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * How much two names look alike, 0 to 1. AN ORDERING HINT AND NOTHING ELSE.
 *
 * It is never consulted unless a human switches the toggle on, it only sorts,
 * and its result is never rendered as a score, a percentage or a tick — because
 * a number beside a name is read as an answer, and on the six accounts here that
 * share a label it would be a confident wrong answer.
 *
 * Shared tokens over the smaller name's token count, so "Amit Shah" against
 * "Amit Kumar Shah" scores 1 rather than 0.67: a middle name is not evidence
 * against a person.
 */
export function similarityHint(a, b) {
  const tokens = (s) => new Set(
    String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean),
  );
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  x.forEach(t => { if (y.has(t)) shared += 1; });
  return shared / Math.min(x.size, y.size);
}

export default function LinkAccountsTab({ onUpdate }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  // The employee under consideration, and the account picked for them. BOTH
  // start empty and neither is ever filled in by this screen — that is the
  // no-auto-match promise, expressed as state.
  const [employee, setEmployee] = useState(null);
  const [chosen, setChosen] = useState('');
  const [filter, setFilter] = useState('');
  const [useHint, setUseHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useRef(null);

  const queue = useResource('/v1/manav/employees/awaiting-link', []);
  const options = useList('/v1/manav/employees/link-options', []);

  const waiting = queue.data?.data || [];
  const linked = queue.data?.linked || [];
  const counts = queue.data?.counts || { employees: 0, awaiting_link: 0, linked: 0 };
  const accounts = options.items || [];
  // Measured live on 2026-08-21: the largest org has 71 employees and SEVEN
  // accounts. Sixty-four of those records cannot be linked today by anybody,
  // because there is no login to link them to — and a queue that lists them
  // without saying so reads as 71 items of work that a person will grind at
  // until they run out of accounts and conclude the screen is broken. The
  // shortfall is stated, with the remedy, which is an invitation and lives in
  // another module entirely.
  const free = options.data?.free ?? 0;
  const shortfall = counts.awaiting_link - free;

  function pick(row) {
    setEmployee(row);
    // A new employee clears the account. Carrying a choice across from the last
    // person is how the wrong one gets confirmed by muscle memory.
    setChosen('');
    setFilter('');
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = q
      ? accounts.filter(a => `${a.full_name} ${a.email}`.toLowerCase().includes(q))
      : accounts.slice();
    if (!useHint || !employee) return rows;
    // Sorted, never filtered: a low score must not hide the right person, which
    // is exactly what would happen to somebody who married and changed a name.
    return rows.sort(
      (p, r) => similarityHint(employee.name, r.full_name) - similarityHint(employee.name, p.full_name),
    );
  }, [accounts, filter, useHint, employee]);

  const picked = accounts.find(a => a.user_id === chosen) || null;

  // The queue is 71 rows long in the largest org measured. A click on row 60
  // opens the picker BELOW the table, off screen, and the only feedback is a
  // row highlight nobody is looking at — which reads as a dead click, and the
  // second click lands on a different person. Optional-called because jsdom has
  // no `scrollIntoView`.
  useEffect(() => {
    if (employee) panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [employee]);

  async function link() {
    if (!employee || !picked) return;
    setBusy(true);
    try {
      await api.post(`/v1/manav/employees/${employee.id}/link`, { user_id: picked.user_id });
      pushToast({
        title: `${employee.name} is linked to ${picked.email || picked.full_name}`,
        type: 'success',
      });
      setEmployee(null);
      setChosen('');
      queue.reload();
      options.reload();
      onUpdate?.();
    } catch (err) {
      // The server's own words win. It explains WHICH refusal this was — the
      // record is inactive, the account belongs to another employee, the account
      // is not a member of this organisation — and each has a different remedy.
      pushToast({ title: errText(err, 'The link was not made.'), type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function unlink(row) {
    setBusy(true);
    try {
      await api.delete(`/v1/manav/employees/${row.id}/link`);
      pushToast({ title: `${row.name} is no longer linked to an account`, type: 'success' });
      queue.reload();
      options.reload();
      onUpdate?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The link was not removed.'), type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    // `.k-screen` — a flex column on `--gap-section`. Every section below is a
    // direct child of it and none carries a margin, which is why this file has
    // no inline style: 87 of them on `EmployeesTab` were literals that already
    // existed as a class, and every one was deaf to the density settings.
    <div className="k-screen">
      {/* WHAT LINKING DOES, in the place where it is done. Stated before the
          queue rather than in a tooltip: this is the only screen in the product
          that decides whose commission figure resolves, and a person doing it
          for the first time has no way to know that from the verb. */}
      <div className="note note--info mn-err" role="note">
        <b>Linking says that this personnel record and this login are the same person.</b>{' '}
        Until it is linked, nothing this person sells or earns can be shown against
        their personnel record: <b>commission, targets and revenue attribute to a login,
        while payslips, attendance and leave hang off the employee record</b>, and this
        column is the only thing that joins the two. The person also cannot clock in,
        open their own payslip, see their own attendance or apply for leave — each of
        those reads the same column and finds nothing. Linking grants no access to
        anything else, and it invites nobody: the account has to be a member of this
        organisation already.
      </div>

      <div className="note note--warn mn-err" role="note">
        <b>Nothing is matched automatically, and it never will be.</b>{' '}
        Names repeat — some accounts here share a name with another account — and the
        addresses on a personnel file are not the addresses people sign in with. A wrong
        link pays the wrong person, so each one is a decision somebody makes and owns.{' '}
        <b>It is reversible:</b> unlinking puts the record back exactly as it was and
        takes nothing away from the person&apos;s account.
      </div>

      <div className="mn-head">
        <div className="mn-field">
          <span className="mn-field__l">Progress</span>
          <span>
            <b>{counts.linked} of {counts.employees}</b> people on the register are linked
            to a login. {counts.awaiting_link} still waiting, and{' '}
            {free} account{free === 1 ? ' is' : 's are'} still free.
          </span>
        </div>
      </div>

      {!queue.loading && !queue.error && !options.loading && !options.error && shortfall > 0 && (
        <div className="note note--warn mn-err" role="note">
          <b>
            {shortfall} of these records cannot be linked yet — there is no login for
            them.
          </b>{' '}
          This organisation has fewer free accounts than it has unlinked employees. Invite
          the rest from Settings → Members first; an invitation is what creates a login,
          and this screen only connects one that already exists.
        </div>
      )}

      {/* ── Step one: the person ─────────────────────────────────────────── */}
      <h3 className="mn-card__t">Employees with no login</h3>

      {queue.loading ? <Shim count={5} />
        : queue.error ? <ErrorNote what="The linking queue" error={queue.error} onRetry={queue.reload} />
          : waiting.length === 0 ? (
            <Empty
              icon="🔗"
              title="Every active employee is linked to a login"
              sub="Their commission and revenue figures resolve, and each of them can clock in and open their own payslip."
            />
          ) : (
            <DataTable arrange="manav.link_accounts" columns={['Code', 'Name', 'Department', 'Designation', 'Joined', '']}>
              {waiting.map(e => (
                <tr
                  key={e.id}
                  className="mn-t__row--click"
                  onClick={() => pick(e)}
                  tabIndex={0}
                  role="button"
                  aria-current={employee?.id === e.id ? 'true' : undefined}
                  aria-label={`Choose an account for ${e.name}`}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(e); }
                  }}
                >
                  <Td className="mn-t__mono">{e.employee_code || '—'}</Td>
                  <Td bold>{e.name}</Td>
                  <Td className="mn-t__mute">{e.department || '—'}</Td>
                  <Td className="mn-t__mute">{e.designation || '—'}</Td>
                  <Td className="mn-t__mute">{day(e.date_of_joining) || '—'}</Td>
                  <Td>
                    {/* Said on the row, not only in the picker. Two records with
                        one name are two chances to open the wrong file. */}
                    {e.name_is_shared
                      ? <Badge text="shared name" color="var(--warn)" />
                      : null}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}

      {/* ── Step two: the account ────────────────────────────────────────── */}
      {employee && (
        <div className="mn-card" ref={panel}>
          <h3 className="mn-card__t">Choose the account that is {employee.name}</h3>
          <div className="mn-card__meta">
            <div>
              <b>{employee.name}</b>
              {employee.employee_code ? ` · ${employee.employee_code}` : ''}
              {employee.department ? ` · ${employee.department}` : ''}
              {employee.designation ? ` · ${employee.designation}` : ''}
              {employee.date_of_joining ? ` · joined ${day(employee.date_of_joining)}` : ''}
            </div>
            {employee.email && (
              <div>
                On the personnel file: {employee.email}. This is not used to find an
                account — no employee address in this organisation matches any login.
              </div>
            )}
            {employee.name_is_shared && (
              <div>
                <b>Another employee record carries this same name.</b> Check the code and
                the department above before choosing.
              </div>
            )}
          </div>

          <div className="mn-bar">
            <input
              className="k-formpanel__input mn-f mn-f--grow"
              placeholder="Search accounts by name or address"
              aria-label="Search accounts by name or address"
              value={filter}
              onChange={ev => setFilter(ev.target.value)}
            />
            <label className="mn-check">
              <input
                type="checkbox"
                checked={useHint}
                onChange={ev => setUseHint(ev.target.checked)}
              />
              <span>Put similar names first — a hint, not a match</span>
            </label>
          </div>
          {useHint && (
            <p className="mn-card__meta">
              This only changes the order. Nothing is selected for you, nothing is hidden,
              and a similar name is not evidence — people here share names, and people
              change them.
            </p>
          )}

          {options.loading ? <Shim count={4} />
            : options.error ? <ErrorNote what="The accounts in this organisation" error={options.error} onRetry={options.reload} />
              : accounts.length === 0 ? (
                <Empty
                  icon="👤"
                  title="This organisation has no member accounts yet"
                  sub="Invite people from Settings → Members. An invitation is what creates a login; this screen only connects one that already exists."
                />
              ) : visible.length === 0 ? (
                <p className="mn-card__meta">
                  No account matches “{filter}”. Clear the search to see all{' '}
                  {accounts.length}.
                </p>
              ) : (
                <div
                  className="mn-list" role="radiogroup"
                  aria-label={`Accounts in this organisation — choose the one that is ${employee.name}`}
                >
                  <p className="mn-field__l">
                    Accounts in this organisation ({visible.length})
                  </p>
                  {visible.map(a => {
                    const taken = a.linked_employee_id != null;
                    const label = a.full_name || a.email || 'Account with no name';
                    return (
                      <label key={a.user_id} className="mn-rec">
                        <div className="mn-rec__top">
                          <div className="mn-rec__who">
                            <input
                              type="radio"
                              name="account"
                              value={a.user_id}
                              checked={chosen === a.user_id}
                              disabled={taken || !canWrite}
                              onChange={() => setChosen(a.user_id)}
                            />
                            <span className="mn-rec__name">{label}</span>
                            <span className="mn-rec__code">{a.email}</span>
                          </div>
                          <div className="mn-rec__end">
                            {a.name_is_shared && <Badge text="shared name" color="var(--warn)" />}
                            {taken && <Badge text="already linked" color="var(--on-surface-3)" />}
                          </div>
                        </div>
                        {/* The five facts that separate two people with one name,
                            none of them an id. */}
                        <div className="mn-rec__body">
                          {(a.org_roles || []).map(r => ROLE_LABEL[r] || r).join(', ') || 'No role recorded'}
                          {a.member_since ? ` · in this organisation since ${day(a.member_since)}` : ''}
                          {a.mobile_tail ? ` · mobile ${a.mobile_tail}` : ''}
                          {a.modules?.length ? ` · ${a.modules.join(', ')}` : ''}
                        </div>
                        {a.name_is_shared && (
                          <div className="mn-rec__body">
                            <b>Another account here has this same name.</b> The address, the
                            role and the joining date above are what tell them apart.
                          </div>
                        )}
                        {taken && (
                          <div className="mn-rec__body">
                            Already linked to <b>{a.linked_employee_name || 'another employee'}</b>.
                            One login belongs to one employee record — unlink that record below
                            first if this is the correction.
                          </div>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

          {/* The sentence a person is agreeing to, in names, before they press
              the button. Not a row highlight — an English claim they can read
              back and disagree with. */}
          {picked && (
            <p className="note note--info mn-err" role="status">
              You are saying that <b>{employee.name}</b>
              {employee.employee_code ? ` (${employee.employee_code})` : ''} is the person
              who signs in as <b>{picked.email || picked.full_name}</b>
              {picked.member_since ? `, in this organisation since ${day(picked.member_since)}` : ''}.
              Their commission and revenue figures will start resolving to this record.
            </p>
          )}

          <div className="mn-card__act">
            <button
              type="button" className="k-btn k-btn--primary"
              onClick={link}
              disabled={!picked || busy || !canWrite}
              title={denial || undefined}
            >
              {busy ? 'Linking…' : 'Link these two'}
            </button>
            <button
              type="button" className="k-btn k-btn--ghost"
              onClick={() => { setEmployee(null); setChosen(''); }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── The links already made ───────────────────────────────────────── */}
      {!queue.loading && !queue.error && linked.length > 0 && (
        <div>
          <h3 className="mn-card__t">Already linked ({linked.length})</h3>
          <p className="mn-card__meta">
            Here so a wrong link can be found and undone. Unlinking removes self-service
            and attribution from this record; the person keeps their account, their
            membership and every module they were granted.
          </p>
          <div className="mn-list">
            {linked.map(row => (
              <div key={row.id} className="mn-rec">
                <div className="mn-rec__top">
                  <div className="mn-rec__who">
                    <span className="mn-rec__name">{row.name}</span>
                    <span className="mn-rec__code">{row.employee_code}</span>
                  </div>
                  <div className="mn-rec__end">
                    {row.account_missing && <Badge text="account deleted" color="var(--danger)" />}
                    <button
                      type="button" className="k-btn k-btn--ghost"
                      onClick={() => unlink(row)}
                      disabled={busy || !canWrite}
                      title={denial || undefined}
                    >
                      Unlink
                    </button>
                  </div>
                </div>
                <div className="mn-rec__body">
                  {row.account_missing
                    ? 'The account this record points at no longer exists. Nothing signs in as this person — unlink it and link a current account.'
                    : `Signs in as ${row.account_email || row.account_name}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
