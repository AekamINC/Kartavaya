// Manav → Notices.
//
// The department notice and assessment register, and the clock on it.
//
// ── Why this register is not like the others ─────────────────────────────────
// An invoice that goes unpaid stays an unpaid invoice. A DSC that expires stays
// an expired DSC. A GST ASMT-10 that goes unanswered is escalated BY SOMEBODY
// ELSE, on a date nobody in the practice chose, into a s.73/74 determination. A
// DRC-01 that goes unanswered becomes a DRC-07 demand order passed on whatever
// the record happens to show. Nobody has to remember to punish the practice.
// Missing the date is the punishment.
//
// ── Two things this screen refuses to get wrong ──────────────────────────────
//  · A notice due TODAY has 0 days remaining and is NOT overdue. The reply is
//    filed on the due date all the time, and a register that calls that late
//    trains people to ignore it — which is how a compliance list dies.
//  · `escalated` outranks every merely-overdue row, however far past due. The
//    deadline passed AND the consequence landed; a notice 90 days overdue and
//    one that has already become a demand order are not the same emergency.
//
// ── A LOG DOES NOT OVERWRITE ────────────────────────────────────────────────
// This screen writes as of 2026-08-21, and every control on it is shaped by one
// sentence: a statutory correspondence log records, it does not edit.
//
//  · The statutory window is NOT on the form. It is snapshotted onto the row
//    from the catalogue by the statement that files the notice, so that a later
//    edit to the catalogue cannot move the due date of a notice filed last year.
//    What you may set is the date the officer actually wrote — and where the
//    statute fixes no period at all ('notice_specified' — rule 142 prescribes
//    none for a DRC-01) that date is the only one there is, so the form
//    requires it.
//  · `closed` and `withdrawn` are terminal. The department's next step is a NEW
//    notice with its own reference and its own clock: an ASMT-11 that is
//    rejected becomes a DRC-01, a different form under a different section.
//  · Changing the reply date writes the previous one into the notes, in the
//    same statement, so a moved deadline can still be read as evidence.
//
// ── Who can open this ────────────────────────────────────────────────────────
// Org owners and org admins only, and writes need Manav editor on top of that —
// a notice write is never easier to reach than the notice read it changes. This
// screen answers "which of our clients are under assessment", which is the most
// commercially sensitive question the product can answer, and
// `services/custody/notices.py` explicitly declined to pick an access rule for
// it. `routers/custody.py` picks one and writes down why. Anyone else gets a
// 403 and reads the server's own sentence — NOT an empty table, because every
// register in this product has been genuinely empty and "no rows" is a sentence
// a reader believes.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useToast } from '../../components/ui/toast';
import { Badge, ErrorNote, Shim, errText, useResource, today } from './_shared';

// The bands, most urgent first — the same order `notices.URGENCY_ORDER` sorts
// on. `critical` starts at 0 days because 0 means due today: rule 88C and rule
// 88D give SEVEN days for a DRC-01B / DRC-01C, so a three-day "urgent" would
// leave a seven-day notice calm for more than half its life.
const BAND_COLORS = {
  escalated: 'var(--danger)',
  overdue: 'var(--danger)',
  critical: 'var(--warn)',
  urgent: 'var(--tertiary)',
  soon: 'var(--st-in-progress)',
  scheduled: 'var(--on-surface-3)',
  stopped: 'var(--ok)',
};

const BAND_LABELS = {
  escalated: 'Escalated',
  overdue: 'Overdue',
  critical: 'Critical',
  urgent: 'Urgent',
  soon: 'Soon',
  scheduled: 'Scheduled',
  stopped: 'Closed',
};

// Where a notice may go from where it is. THE SERVER IS THE AUTHORITY — it
// carries the same table and refuses anything outside it in a sentence — and
// this copy exists only so the screen does not offer a control that is going to
// be refused. `closed` and `withdrawn` lead nowhere.
const NEXT = {
  open: ['replied', 'closed', 'escalated', 'withdrawn'],
  escalated: ['replied', 'closed', 'withdrawn'],
  replied: ['closed', 'escalated', 'withdrawn'],
  closed: [],
  withdrawn: [],
};

const STATUS_LABELS = {
  open: 'Open',
  replied: 'Reply filed',
  closed: 'Closed by the department',
  escalated: 'Escalated',
  withdrawn: 'Withdrawn by the department',
};

const VIEWS = [
  ['open', 'Live'],
  ['overdue', 'Overdue'],
  ['types', 'Catalogue'],
];

const BLANK = {
  client_id: '',
  notice_type_code: '',
  reference_no: '',
  received_on: '',
  due_on_override: '',
  notes: '',
  assign_to_me: false,
};

/**
 * Two lists the create form needs, fetched only once it is open.
 *
 * `/v1/custody/clients` rather than the CRM's own route: that one is gated on
 * holding CRM, Finance or Sales, so a practice that bought HR alone could read
 * this register and not the names in it.
 *
 * Loading, failure and emptiness are kept apart. A caught error that leaves a
 * list at `[]` renders as "no clients", which is a sentence a reader believes.
 */
function useFormLists(enabled) {
  const [state, setState] = useState({
    loading: false, error: '', clients: [], types: [],
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState({ loading: true, error: '', clients: [], types: [] });
    Promise.all([
      api.get('/v1/custody/clients'),
      api.get('/v1/custody/notices/types'),
    ])
      .then(([c, t]) => {
        if (alive) {
          setState({
            loading: false, error: '',
            clients: c.data?.data || [], types: t.data?.data || [],
          });
        }
      })
      .catch(err => {
        if (alive) {
          setState({ loading: false, error: errText(err), clients: [], types: [] });
        }
      });
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

/** What the catalogue says the reply period is, in words. */
function windowWord(t) {
  if (!t) return '';
  if (t.window_basis === 'notice_specified') return 'as stated on the notice';
  if (t.reply_window_months) {
    return `${t.reply_window_months} month${t.reply_window_months === 1 ? '' : 's'}`;
  }
  return `${t.reply_window_days} day${t.reply_window_days === 1 ? '' : 's'}`
    + (t.window_in_working_days ? ' (working days)' : '');
}

export default function NoticesTab() {
  const { canWrite, reason: denial } = useModuleWrite({
    label: 'change the notice register',
  });
  const { pushToast } = useToast();

  const [view, setView] = useState('open');
  const [asOf, setAsOf] = useState(today());

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const [acting, setActing] = useState(null);   // { id, kind }
  const [change, setChange] = useState({ status: 'replied', on_date: '', note: '' });
  const [newDue, setNewDue] = useState({ due_on_override: '', note: '' });
  const [busy, setBusy] = useState('');

  const path = view === 'types'
    ? '/v1/custody/notices/types'
    : `/v1/custody/notices${view === 'overdue' ? '/overdue' : ''}?as_of=${encodeURIComponent(asOf)}`;

  const res = useResource(path, [path]);
  const lists = useFormLists(showForm);
  const rows = res.data?.data || [];

  const table = useTableView(rows, {
    filters: view === 'types'
      ? [{ key: 'authority', label: 'Authority' }]
      : [{ key: 'authority', label: 'Authority' }, { key: 'status', label: 'Status' }],
    columns: { band: r => r.urgency?.band },
    searchKeys: view === 'types'
      ? ['label', 'code', 'form_no']
      : ['client_name', 'reference_no', 'notice_type_label', 'form_no', 'owner_name'],
  });

  const chosenType = lists.types.find(t => t.code === form.notice_type_code) || null;
  // rule 142 prescribes no reply period for a DRC-01, so nothing can be
  // computed and the date has to be read off the paper. Without it the row
  // would resolve to `received_on + 0` — due the day it arrived, then overdue
  // every day after, for ever.
  const dueDateRequired = Boolean(chosenType)
    && !chosenType.reply_window_days && !chosenType.reply_window_months;

  function openAction(id, kind) {
    setActing(a => (a && a.id === id && a.kind === kind ? null : { id, kind }));
    setChange({ status: 'replied', on_date: '', note: '' });
    setNewDue({ due_on_override: '', note: '' });
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/v1/custody/notices', {
        ...form,
        // '' reaching a `::date` cast is an instant 500 rather than a null, and
        // an empty form field is exactly how one gets there.
        due_on_override: form.due_on_override || null,
      });
      pushToast({ title: `Filed — reply due ${data.due_on}`, type: 'success' });
      setShowForm(false);
      setForm(BLANK);
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The notice could not be filed.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function submitStatus(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/notices/${id}/status`, {
        ...change,
        on_date: change.on_date || null,
      });
      pushToast({ title: 'Recorded', type: 'success' });
      setActing(null);
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'That could not be recorded.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function submitDueDate(e, id) {
    e.preventDefault();
    setBusy(id);
    try {
      await api.post(`/v1/custody/notices/${id}/due-date`, newDue);
      pushToast({ title: 'Reply date recorded', type: 'success' });
      setActing(null);
      res.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The reply date could not be changed.'), type: 'error' });
    } finally { setBusy(''); }
  }

  return (
    <div>
      <div className="mn-sub" role="tablist" aria-label="Notice views">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`mn-sub__b${view === id ? ' on' : ''}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mn-bar">
        {view !== 'types' && (
          <label className="mn-field">
            <span className="mn-field__l">Position on</span>
            <DateInput
              type="date"
              className="inp mn-f"
              value={asOf}
              onChange={e => setAsOf(e.target.value || today())}
            />
          </label>
        )}
        <span className="mn-bar__gap" />
        <span className="mn-count">
          {res.loading ? 'Loading…' : `${rows.length} ${view === 'types' ? 'notice types' : 'notices'}`}
        </span>
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? 'Close' : '+ File a notice'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="k-formpanel">
          <h3 className="k-section__title">File a notice</h3>
          {lists.error && (
            <ErrorNote what="The company list and the catalogue" error={lists.error} />
          )}
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Client *</span>
              <select className="k-formpanel__input" required value={form.client_id}
                onChange={set('client_id')}>
                <option value="">Select…</option>
                {lists.clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Notice *</span>
              {/* By CODE. The catalogue carries the standard types and any this
                  practice has minted; where both share a code, the practice's
                  own wins. */}
              <select className="k-formpanel__input" required
                value={form.notice_type_code} onChange={set('notice_type_code')}>
                <option value="">Select…</option>
                {lists.types.map(t => (
                  <option key={t.code} value={t.code}>
                    {t.form_no ? `${t.form_no} — ${t.label}` : t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Department reference *</span>
              <input className="k-formpanel__input" required maxLength={128}
                placeholder="ZA2708260001"
                value={form.reference_no} onChange={set('reference_no')} />
            </label>

            <label className="k-formpanel__label">
              <span>Served on *</span>
              {/* THE DATE OF SERVICE, not the date somebody noticed it. Every
                  statutory window in the catalogue runs from service, so this is
                  the field the whole register depends on being right. */}
              <DateInput type="date" className="k-formpanel__input" required
                value={form.received_on} onChange={set('received_on')} />
            </label>
            <label className="k-formpanel__label">
              <span>{dueDateRequired ? 'Reply by *' : 'Reply by, if stated'}</span>
              {/* The officer's own date beats the statutory default — an
                  ASMT-10 that says fifteen days is due in fifteen even though
                  rule 99(1) caps the officer at thirty. */}
              <DateInput type="date" className="k-formpanel__input"
                required={dueDateRequired}
                value={form.due_on_override} onChange={set('due_on_override')} />
            </label>
            <label className="k-formpanel__label mn-chk">
              <input type="checkbox" checked={form.assign_to_me}
                onChange={e => setForm({ ...form, assign_to_me: e.target.checked })} />
              {/* An unowned notice is allowed. NULL owner is a real and
                  dangerous state the schema makes representable on purpose:
                  refusing to record a notice until somebody owns it means the
                  notice does not get recorded. */}
              <span>Put it on my desk</span>
            </label>

            <label className="k-formpanel__label mn-fw">
              <span>Notes</span>
              <input className="k-formpanel__input" value={form.notes}
                onChange={set('notes')} />
            </label>
          </div>
          {chosenType && (
            <p className="mn-quote">
              {chosenType.label} — reply in {windowWord(chosenType)}
              {chosenType.reply_form_no ? ` on ${chosenType.reply_form_no}` : ''}.
              If ignored: {chosenType.consequence}
              {dueDateRequired
                ? ' The statute fixes no reply period for this form, so the date has to be read off the notice itself.'
                : ' The window is copied onto this row now, so a later change to the catalogue cannot move this deadline.'}
            </p>
          )}
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost"
              onClick={() => { setShowForm(false); setForm(BLANK); }}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary"
              disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Filing…' : 'File notice'}
            </button>
          </div>
        </form>
      )}

      {res.loading && <Shim count={4} />}
      {!res.loading && res.error && (
        <ErrorNote
          what={view === 'types' ? 'The notice catalogue' : 'The notice register'}
          error={res.error}
          onRetry={res.reload}
        />
      )}

      {!res.loading && !res.error && rows.length === 0 && (
        <Empty
          icon="📨"
          title={view === 'overdue' ? 'Nothing is overdue' : 'No notices recorded'}
          sub={
            view === 'overdue'
              ? 'No live notice has passed its reply date on the date above.'
              : 'Every notice, intimation and assessment order a client receives belongs here with the date it was served. File the first one with the button above.'
          }
        />
      )}

      {!res.loading && !res.error && rows.length > 0 && view === 'types' && (
        <div className="tv-card">
          <TableToolbar view={table} label="notice types" searchPlaceholder="Form, code or label…" />
          <DataTable columns={['Notice', 'Authority', 'Form', 'Reply in', 'If ignored', 'Source']}>
            {table.rows.map(r => (
              <tr key={r.code}>
                <Td>
                  <div className="mn-t__n--b">{r.label}</div>
                  <div className="mn-t__mute">
                    {r.is_system ? 'Standard' : 'This practice’s own'}
                    {r.statute_ref ? ` · ${r.statute_ref}` : ''}
                  </div>
                </Td>
                <Td className="mn-t__mute mn-cap">{String(r.authority || '').replace(/_/g, ' ')}</Td>
                <Td className="mn-t__mute">
                  {r.form_no || '—'}
                  {r.reply_form_no ? ` → ${r.reply_form_no}` : ''}
                </Td>
                <Td className="mn-t__mute">
                  {/* `notice_specified` means the officer writes the date on the
                      notice — rule 142 prescribes no reply period for a DRC-01 —
                      so there is nothing to compute and the date must be read
                      off the paper. */}
                  {windowWord(r)}
                </Td>
                <Td className="mn-t__mute">{r.consequence}</Td>
                <Td className="mn-t__mute">{r.source_url ? 'Published' : '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {!res.loading && !res.error && rows.length > 0 && view !== 'types' && (
        <div className="tv-card">
          <TableToolbar view={table} label="notices" searchPlaceholder="Client, reference or form…" />
          <DataTable columns={['Client', 'Notice', 'Reference', 'Received', 'Reply due', 'Where it stands', 'Owner', '']}>
            {table.rows.map(r => (
              <React.Fragment key={`${r.reference_no}-${r.received_on}`}>
                <tr>
                  <Td>{r.client_name}</Td>
                  <Td>
                    <div className="mn-t__n--b">{r.notice_type_label}</div>
                    <div className="mn-t__mute">
                      {r.form_no}
                      {r.reply_form_no ? ` → ${r.reply_form_no}` : ''}
                      {r.statute_ref ? ` · ${r.statute_ref}` : ''}
                    </div>
                  </Td>
                  <Td mono>{r.reference_no}</Td>
                  <Td mono>{r.received_on}</Td>
                  <Td mono>
                    {r.due_on || '—'}
                    {/* The officer's own date beats the statutory default. Worth
                        showing: an ASMT-10 that says fifteen days is due in
                        fifteen even though rule 99(1) caps the officer at 30. */}
                    {r.due_date_from_notice && (
                      <div className="mn-t__mute">as stated on the notice</div>
                    )}
                  </Td>
                  <Td>
                    <Badge
                      text={BAND_LABELS[r.urgency?.band] || r.urgency?.band}
                      color={BAND_COLORS[r.urgency?.band]}
                    />
                    <div className="mn-t__mute">{r.urgency_note}</div>
                  </Td>
                  <Td className="mn-t__mute">{r.owner_name || '—'}</Td>
                  <Td>
                    <div className="mn-rowact">
                      {(NEXT[r.status] || []).length > 0 && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          disabled={!canWrite} title={denial || undefined}
                          onClick={() => openAction(r.id, 'status')}>
                          Record
                        </button>
                      )}
                      {/* A deadline is only moved while the clock is still
                          running. A replied notice's is history and a closed
                          one's is finished. */}
                      {(r.status === 'open' || r.status === 'escalated') && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          disabled={!canWrite} title={denial || undefined}
                          onClick={() => openAction(r.id, 'due')}>
                          Reply date
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>

                {acting && acting.id === r.id && acting.kind === 'status' && (
                  <tr>
                    <td colSpan={8}>
                      <form className="k-formpanel" onSubmit={e => submitStatus(e, r.id)}>
                        <h3 className="k-section__title">
                          {r.form_no} {r.reference_no} — what happened?
                        </h3>
                        <div className="k-formpanel__grid k-formpanel__grid--3">
                          <label className="k-formpanel__label">
                            <span>Now *</span>
                            <select className="k-formpanel__input" value={change.status}
                              onChange={e => setChange({ ...change, status: e.target.value })}>
                              {(NEXT[r.status] || []).map(s => (
                                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="k-formpanel__label">
                            <span>On</span>
                            {/* Defaults to today. Tomorrow is refused — a reply
                                cannot have been filed tomorrow — and so is any
                                date before the notice was served. */}
                            <DateInput type="date" className="k-formpanel__input"
                              value={change.on_date}
                              onChange={e => setChange({ ...change, on_date: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label">
                            <span>Note</span>
                            <input className="k-formpanel__input" value={change.note}
                              onChange={e => setChange({ ...change, note: e.target.value })} />
                          </label>
                        </div>
                        <p className="mn-quote">
                          Closed and withdrawn are the end of this row. If the
                          department comes back it comes back as a new notice
                          with its own reference and its own clock — file that
                          instead.
                        </p>
                        <div className="k-formpanel__actions">
                          <button type="button" className="k-btn k-btn--ghost"
                            onClick={() => setActing(null)}>Cancel</button>
                          <button type="submit" className="k-btn k-btn--primary"
                            disabled={busy === r.id || !canWrite} title={denial || undefined}>
                            {busy === r.id ? 'Recording…' : 'Record'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}

                {acting && acting.id === r.id && acting.kind === 'due' && (
                  <tr>
                    <td colSpan={8}>
                      <form className="k-formpanel" onSubmit={e => submitDueDate(e, r.id)}>
                        <h3 className="k-section__title">
                          Reply date for {r.form_no} {r.reference_no}
                        </h3>
                        <div className="k-formpanel__grid k-formpanel__grid--2">
                          <label className="k-formpanel__label">
                            <span>Reply by *</span>
                            <DateInput type="date" className="k-formpanel__input" required
                              value={newDue.due_on_override}
                              onChange={e => setNewDue({ ...newDue, due_on_override: e.target.value })} />
                          </label>
                          <label className="k-formpanel__label">
                            <span>Why</span>
                            <input className="k-formpanel__input"
                              placeholder="Extension granted, date read off the notice…"
                              value={newDue.note}
                              onChange={e => setNewDue({ ...newDue, note: e.target.value })} />
                          </label>
                        </div>
                        <p className="mn-quote">
                          Currently {r.due_on}. The old date is written into this
                          notice’s own notes as part of the same change, so a
                          moved deadline can still be read as evidence.
                        </p>
                        <div className="k-formpanel__actions">
                          <button type="button" className="k-btn k-btn--ghost"
                            onClick={() => setActing(null)}>Cancel</button>
                          <button type="submit" className="k-btn k-btn--primary"
                            disabled={busy === r.id || !canWrite} title={denial || undefined}>
                            {busy === r.id ? 'Recording…' : 'Record reply date'}
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
