// Manav → Custody.
//
// What a leaver still holds, as a query rather than a memo.
//
// ── What this replaces ───────────────────────────────────────────────────────
// The Exits tab already covers the HR half of an exit: exit type, notice, the
// clearance checklist, the settlement, the interview. It covers none of the
// security half, and the security half is the one with a clock on it:
//
//   WORK    Tasks still assigned to somebody who no longer works here, and
//           clients they were the named person for. Orphaned work does not
//           announce itself — the task simply sits in a list nobody reads until
//           the filing deadline goes past.
//   ACCESS  In a practice this is never one login. It is the role grant, the
//           per-module grant, and a membership row in every team — three
//           separate tables, any one of which left behind is a person with a
//           live door into forty clients' data.
//
// ── READ "we could not identify them" BEFORE BELIEVING "nothing outstanding" ─
// `staging.manav_employees.user_id` is NULL on all 98 live rows, and not one of
// the 98 employee emails matches a row in `public.users`. The HR module and the
// auth module have never been joined in this database. So today every real
// employee resolves as UNRESOLVED and all four lists come back empty BECAUSE
// NOBODY COULD BE LOOKED UP — not because the desk is empty.
//
// Those two are opposite answers and they look identical on any screen that
// omits the distinction. This one does not omit it: an unresolved leaver gets a
// warning band across the top and never the word "clear".
//
// ── The register is a ledger, and the scan is idempotent ─────────────────────
// Recording a line upserts on (exit, action, subject type, subject ref). That
// is what makes opening this screen twice safe: without it, the second visit
// writes the leaver's whole desk into the register again and by the fourth the
// count of outstanding items is four times the truth.
//
// A recorded line then DISAPPEARS from the list above it, because the server
// subtracts what the register already settles. That is the loop: scan, hand
// over, revoke, and the page empties as the exit is actually dealt with.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import { ErrorNote, Shim, errText, useList, useResource } from './_shared';

/** `access_kind` describes a live grant; `subject_type` describes a line in the
 *  register. Same words, different spellings, on purpose — and the map lives on
 *  the server too, where it decides whether a recorded revocation actually
 *  suppresses the grant it names. */
const ACCESS_LABELS = {
  role_grant: 'Role',
  module_grant: 'Module',
  team_membership: 'Team',
};

export default function CustodyTab() {
  const exits = useList('/v1/manav/offboarding');
  const [picked, setPicked] = useState('');

  const rows = exits.items || [];
  // Cancelled exits are not exits. Completed ones stay: the whole point of this
  // register is that "completed" in HR has never meant "access pulled".
  const live = rows.filter(r => r.status !== 'cancelled');
  const chosen = live.find(r => String(r.employee_id) === String(picked));

  if (exits.loading) return <Shim count={3} />;
  if (exits.error) {
    return <ErrorNote what="Exits" error={exits.error} onRetry={exits.reload} />;
  }

  if (live.length === 0) {
    return (
      <Empty
        icon="🔐"
        title="Nobody is leaving"
        sub="Start an exit in the Exits tab. This screen then shows what that person still holds — open work, named clients, and every role, module and team grant still live in their name."
      />
    );
  }

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Whose exit</span>
          <select
            className="inp mn-f--lg"
            value={picked}
            onChange={e => setPicked(e.target.value)}
          >
            <option value="">Select…</option>
            {live.map(r => (
              <option key={r.id} value={r.employee_id}>
                {r.employee_name}
                {r.last_working_day ? ` · last day ${r.last_working_day}` : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="mn-bar__gap" />
        <span className="mn-count">
          {live.length} exit{live.length === 1 ? '' : 's'} on the register
        </span>
      </div>

      {!picked && (
        <p className="mn-quote">
          Pick an exit. Nothing is scanned until you do — this reads three access
          tables and the whole task table for one person, and it is not a report
          worth running for everybody at once.
        </p>
      )}

      {picked && (
        <ExitCustody
          key={picked}
          employeeId={picked}
          employeeName={chosen?.employee_name || ''}
        />
      )}
    </div>
  );
}

function ExitCustody({ employeeId, employeeName }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record custody lines' });
  const { pushToast } = useToast();
  const path = `/v1/custody/offboarding/${employeeId}`;
  const res = useResource(path, [path]);
  const [busy, setBusy] = useState('');
  const [handover, setHandover] = useState('');

  const d = res.data;

  async function record(line, key) {
    setBusy(key);
    try {
      await api.post(`${path}/lines`, line);
      pushToast({ title: 'Recorded', type: 'success' });
      // The list shrinks because the server subtracts what the register
      // settles. Re-reading is the only honest way to show that.
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'That line could not be recorded.'), type: 'error' });
    } finally {
      setBusy('');
    }
  }

  if (res.loading) return <Shim count={4} />;
  if (res.error) {
    return <ErrorNote what={`${employeeName || 'This exit'}’s custody`} error={res.error} onRetry={res.reload} />;
  }
  if (!d) return null;

  const handOver = (subjectType, refKey) => (item) => record(
    {
      action: 'reassign',
      subject_type: subjectType,
      subject_ref: String(item[refKey]),
      subject_label: item.title || item.client_name || 'Untitled',
      reassigned_to_name: handover.trim(),
      status: 'done',
    },
    `${subjectType}:${item[refKey]}`,
  );

  const canHand = canWrite && handover.trim().length > 0;
  const handTitle = !canWrite ? denial : (handover.trim() ? undefined : 'Say who it was handed to first');

  return (
    <div>
      {d.unknown && (
        <p className="note note--warn mn-err" role="status">
          <b>We could not work out who {d.leaver.employee_name} logs in as.</b>{' '}
          The lists below are empty because nobody could be looked up — not
          because there is nothing outstanding. Link their login on the employee
          record and open this again.
        </p>
      )}

      <div className="mn-facts">
        <div>
          <span className="mn-fact__k">Open work</span>
          <span className="mn-fact__v">{d.counts.tasks}</span>
        </div>
        <div>
          <span className="mn-fact__k">Clients named to them</span>
          <span className="mn-fact__v">{d.counts.clients}</span>
        </div>
        <div>
          <span className="mn-fact__k">Follow-ups</span>
          <span className="mn-fact__v">{d.counts.follow_ups}</span>
        </div>
        <div>
          <span className="mn-fact__k">Access still live</span>
          <span
            className="mn-fact__v"
            style={{ color: d.counts.access > 0 ? 'var(--danger)' : 'var(--ok)' }}
          >
            {d.counts.access}
          </span>
        </div>
        <div>
          <span className="mn-fact__k">Exit stands at</span>
          <span className="mn-fact__v mn-cap">
            {/* `clear` is True only when nothing is outstanding AND the login
                was resolved. An unresolved leaver is never reported as clear. */}
            {d.unknown ? 'Not known' : d.clear ? 'Clear' : 'Outstanding'}
          </span>
        </div>
      </div>

      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Hand over to</span>
          <input
            className="inp mn-f--lg"
            value={handover}
            placeholder="The colleague taking it on"
            onChange={e => setHandover(e.target.value)}
          />
        </label>
        <span className="mn-bar__lbl">
          {/* A NAME, not a login. `manav_employees.user_id` is NULL on every
              live row, so there is no login id to point a handover at yet, and
              a name is what the register can actually be read by. */}
          Recorded as a name — the destination is who, not which account.
        </span>
      </div>

      <h4 className="dr__lbl">Access still live</h4>
      {d.access.length === 0 ? (
        <p className="mn-quote">
          {d.unknown
            ? 'Not checked — their login could not be identified.'
            : 'No role, module or team grant is still live in their name.'}
        </p>
      ) : (
        <ul className="mn-list">
          {d.access.map(a => (
            <li key={`${a.access_kind}:${a.access_ref}`} className="mn-rec">
              <div className="mn-rec__top">
                <span className="mn-rec__name">
                  {ACCESS_LABELS[a.access_kind] || a.access_kind} · {a.label}
                </span>
                <button
                  type="button"
                  className="btn btn--fill btn--sm"
                  disabled={!canWrite || busy === `${a.access_kind}:${a.access_ref}`}
                  title={denial || undefined}
                  onClick={() => record(
                    {
                      action: 'revoke',
                      subject_type: a.access_kind,
                      subject_ref: String(a.access_ref),
                      subject_label: a.label,
                      status: 'done',
                    },
                    `${a.access_kind}:${a.access_ref}`,
                  )}
                >
                  Record as revoked
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="dr__lbl">Open work</h4>
      {d.tasks.length === 0 ? (
        <p className="mn-quote">Nothing open is still pointed at them.</p>
      ) : (
        <ul className="mn-list">
          {d.tasks.map(t => (
            <li key={t.task_ref} className="mn-rec">
              <div className="mn-rec__top">
                <span className="mn-rec__name">{t.title}</span>
                <button
                  type="button"
                  className="btn btn--out btn--sm"
                  disabled={!canHand || busy === `task:${t.task_ref}`}
                  title={handTitle}
                  onClick={() => handOver('task', 'task_ref')(t)}
                >
                  Handed over
                </button>
              </div>
              <div className="mn-rec__body mn-t__mute mn-cap">
                {String(t.status || '').replace(/_/g, ' ')}
                {t.team_name ? ` · ${t.team_name}` : ''}
                {t.due_at ? ` · due ${String(t.due_at).slice(0, 10)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="dr__lbl">Clients named to them</h4>
      {d.clients.length === 0 ? (
        <p className="mn-quote">
          No open deal and no assigned contact names them at any client.
        </p>
      ) : (
        <ul className="mn-list">
          {d.clients.map(c => (
            <li key={c.client_ref} className="mn-rec">
              <div className="mn-rec__top">
                <span className="mn-rec__name">{c.client_name}</span>
                <button
                  type="button"
                  className="btn btn--out btn--sm"
                  disabled={!canHand || busy === `client:${c.client_ref}`}
                  title={handTitle}
                  onClick={() => handOver('client', 'client_ref')(c)}
                >
                  Handed over
                </button>
              </div>
              {/* The count is why the client appeared — this schema has no
                  owner column, so client ownership is DERIVED from open deals
                  and assigned contacts, exactly as sales customers are. */}
              <div className="mn-rec__body mn-t__mute">
                {c.open_deals} open deal{c.open_deals === 1 ? '' : 's'} ·{' '}
                {c.named_contacts} contact{c.named_contacts === 1 ? '' : 's'}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="dr__lbl">Follow-ups</h4>
      {d.follow_ups.length === 0 ? (
        <p className="mn-quote">No open follow-up is assigned to them.</p>
      ) : (
        <ul className="mn-list">
          {d.follow_ups.map(f => (
            <li key={f.follow_up_ref} className="mn-rec">
              <div className="mn-rec__top">
                <span className="mn-rec__name">{f.title}</span>
                <button
                  type="button"
                  className="btn btn--out btn--sm"
                  disabled={!canHand || busy === `follow_up:${f.follow_up_ref}`}
                  title={handTitle}
                  onClick={() => handOver('follow_up', 'follow_up_ref')(f)}
                >
                  Handed over
                </button>
              </div>
              <div className="mn-rec__body mn-t__mute">
                {f.client_name || f.contact_name || '—'}
                {f.due_at ? ` · due ${String(f.due_at).slice(0, 10)}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {d.ledger_outstanding.length > 0 && (
        <>
          <h4 className="dr__lbl">Written down and still open</h4>
          <ul className="mn-list">
            {d.ledger_outstanding.map(l => (
              <li key={`${l.action}:${l.subject_type}:${l.subject_label}`} className="mn-rec">
                <div className="mn-rec__top">
                  <span className="mn-rec__name">{l.subject_label}</span>
                  <span className="mn-rec__amt mn-cap">{l.action}</span>
                </div>
                {l.note && <div className="mn-rec__body mn-t__mute">{l.note}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
