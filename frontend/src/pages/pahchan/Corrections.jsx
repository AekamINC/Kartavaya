import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import Seg from '../../components/customize/Seg';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';

/**
 * Corrections — `POST`/`GET`/`PATCH /api/v1/pahchan/regularisations`.
 *
 * `staging.pahchan_regularisations` has existed since migration 064. The three
 * endpoints were written this cycle. Until now nothing called them, so an
 * employee whose phone was flat at 09:00 had no way to say so and an HR admin
 * had no way to hear it.
 *
 * The screen states two things the endpoints alone cannot:
 *
 * A decline is gated on a reason. The employee is being told that their own
 * record of a day is wrong; "declined" on its own is not something anyone can
 * act on. 064's `pahchan_reg_decline_needs_reason` CHECK enforces it too, and
 * `17-mobile-app.md`'s approval row asks for it — but a CHECK violation reaches
 * the user as a 500, so the gate is here as well as there.
 *
 * An approval does not reach payroll by itself. `POST /attendance/publish` is
 * what reads approved corrections and pairs them into `manav_attendance`. An HR
 * admin who approves twenty corrections and assumes payroll now knows is the
 * predictable failure, so the Publish tab is named on this screen rather than
 * left to be discovered.
 */

const FILTERS = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'all',      label: 'All' },
];

/* The DB vocabulary, which is not the task vocabulary. 064's CHECK is
   `('pending','approved','declined')` — `rejected` is not a value this table can
   hold, and the endpoint used to send it. */
const CHIP = { pending: 'pending', approved: 'approved', declined: 'rejected' };

function dayOf(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v ?? '—');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function clockOf(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function Corrections() {
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  // Which row is having a decline reason typed into it, and what it says.
  const [declining, setDeclining] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async (status) => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/regularisations', { params: { status } });
      setRows(Array.isArray(r.data) ? r.data : []);
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(filter); }, [load, filter]);

  /**
   * How many are waiting, regardless of which filter is open. Derived from
   * `rows` it would read zero the moment somebody switched to Approved — and
   * the count exists precisely so a reviewer looking at settled corrections
   * still sees that three people are waiting on them.
   */
  const [pendingCount, setPendingCount] = useState(null);
  const countPending = useCallback(() => {
    api.get('/v1/pahchan/regularisations', { params: { status: 'pending' } })
      .then(r => setPendingCount(Array.isArray(r.data) ? r.data.length : null))
      .catch(() => setPendingCount(null));
  }, []);
  useEffect(() => { countPending(); }, [countPending]);

  const decide = async (row, status, decisionNote) => {
    if (status === 'declined' && !(decisionNote || '').trim()) {
      pushToast({
        type: 'warning',
        title: 'A decline needs a reason',
        message: 'The employee is being told their record of a day is wrong. Say why.',
      });
      return;
    }
    setBusy(row.id);
    try {
      await api.patch(`/v1/pahchan/regularisations/${row.id}`, {
        status,
        decision_note: (decisionNote || '').trim() || undefined,
      });
      pushToast({
        type: 'success',
        title: status === 'approved' ? 'Correction approved' : 'Correction declined',
        message: status === 'approved'
          // Said every time, because it is the step that is easy to assume has
          // already happened.
          ? 'It reaches payroll when you publish attendance for that period.'
          : `${row.employee_name || 'The employee'} will see your reason.`,
      });
      setDeclining(null);
      setNote('');
      load(filter);
      countPending();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not record that decision',
        message: err.response?.data?.detail
          || 'Only a pending correction can be decided. Reload and check whether someone already settled it.',
      });
    } finally {
      setBusy(null);
    }
  };

  const control = (
    <Seg
      label="Which corrections to show"
      value={filter}
      onChange={setFilter}
      options={FILTERS.map(f => (
        f.value === 'pending' && pendingCount != null ? { ...f, count: pendingCount } : f
      ))}
    />
  );

  return (
    <Section title="Corrections" hi="सुधार" right={control}>
      <Note>
        A correction changes what somebody is paid for a day, so it is decided here and
        recorded in the audit log with who decided it. Approving one does not reach
        payroll on its own — attendance has to be published for that period, on the
        Payroll tab.
      </Note>

      {state === 'loading' && (
        <SkeletonRegion label="Loading corrections…">
          <SkeletonTable rows={4} columns={5} />
        </SkeletonRegion>
      )}

      {state === 'error' && (
        <ErrorState
          kind={errKind}
          detail={
            errKind === 'offline'
              ? 'Corrections need a connection to load. Nothing already requested is lost.'
              : 'The corrections did not load. Requests are safe — this is a read failure, not data loss.'
          }
          onRetry={() => load(filter)}
        />
      )}

      {state === 'ready' && rows.length === 0 && (
        filter === 'pending'
          ? (
            <EmptyState
              icon="check"
              tone="ok"
              title={{ en: 'Nothing waiting', hi: 'कुछ शेष नहीं' }}
              description="Every correction anyone has asked for has been decided."
            />
          )
          : (
            <EmptyState
              icon="generic"
              title={{ en: 'No corrections', hi: 'कोई सुधार नहीं' }}
              description="Nobody has asked for a day to be corrected in this state."
            />
          )
      )}

      {state === 'ready' && rows.length > 0 && (
        <DataTable columns={['Employee', 'Day', 'Asking for', 'Reason', 'Decision']}>
          {rows.map(r => {
            const at = clockOf(r.requested_at_time);
            const open = declining === r.id;
            return (
              <React.Fragment key={r.id}>
                <tr>
                  <Td>
                    <strong style={{ fontSize: 13.5 }}>{r.employee_name || 'Unknown employee'}</strong>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--on-surface-3)' }}>
                      asked {dayOf(r.created_at)}
                    </span>
                  </Td>
                  <Td mono>{dayOf(r.for_date)}</Td>
                  <Td>
                    {r.requested_direction === 'in' ? 'Clock in' : 'Clock out'}
                    {at && (
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {at}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ fontSize: 12.5, color: 'var(--on-surface-2)' }}>{r.reason}</span>
                    {r.decision_note && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--on-surface-3)', marginTop: 3 }}>
                        Decision: {r.decision_note}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {r.status === 'pending' ? (
                      <span style={{ display: 'flex', gap: 7 }}>
                        <button
                          className="btn btn--ghost"
                          style={{ fontSize: 12 }}
                          disabled={busy === r.id}
                          onClick={() => { setDeclining(open ? null : r.id); setNote(''); }}
                        >
                          Decline
                        </button>
                        <button
                          className="btn btn--fill"
                          style={{ fontSize: 12 }}
                          disabled={busy === r.id}
                          onClick={() => decide(r, 'approved')}
                        >
                          {busy === r.id ? 'Saving…' : 'Approve'}
                        </button>
                      </span>
                    ) : (
                      <StatusChip status={CHIP[r.status] || 'pending'} />
                    )}
                  </Td>
                </tr>

                {open && (
                  <tr>
                    <td colSpan={5} style={{ background: 'var(--s-low)' }}>
                      <div style={{ padding: '12px 4px 16px', maxWidth: 560 }}>
                        <label className="fld" style={{ display: 'block' }}>
                          <span className="fld__l">Why are you declining?</span>
                          <textarea
                            className="inp"
                            rows={2}
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder="The gate log shows an entry at 10:20, not 09:00."
                          />
                          <span className="fld__hint">
                            {r.employee_name || 'The employee'} sees this. It is the only thing
                            they have to go on.
                          </span>
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button
                            className="btn btn--fill"
                            style={{ fontSize: 12 }}
                            disabled={busy === r.id || !note.trim()}
                            onClick={() => decide(r, 'declined', note)}
                          >
                            {busy === r.id ? 'Saving…' : 'Decline this correction'}
                          </button>
                          <button
                            className="btn btn--ghost"
                            style={{ fontSize: 12 }}
                            onClick={() => { setDeclining(null); setNote(''); }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </DataTable>
      )}
    </Section>
  );
}
