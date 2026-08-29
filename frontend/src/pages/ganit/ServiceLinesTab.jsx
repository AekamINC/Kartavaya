import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useToast } from '../../components/ui/toast';
import { Modal } from '../../components/ui/modal';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';
import { apiErrorText } from '../../lib/apiError';

const KINDS = ['retainer', 'subscription', 'one_off'];
const CADENCES = ['monthly', 'quarterly', 'annual', 'one_off'];

const BLANK = {
  profile_id: '', kind: 'retainer', description: '', amount: '',
  cadence: 'monthly', period_start: '', period_end: '',
  billing_direction: 'advance', auto_invoice: false,
};

const COLUMNS_ACTIVE = [
  'Client', 'Kind', 'Description',
  { label: 'Amount', align: 'right' },
  'Cadence', 'Start', 'Auto', '',
];

// ⚠ THE TRAILING ACTION CELL IS WHY A SUBSCRIPTION CAN BE RESUMED.
//
// This was `Client · Description · Amount · Period` and nothing else, so an
// ended line was drawn with no Edit control and could not be opened from the
// screen that shows it. Ending a line was a ONE-WAY DOOR: the only way to bill
// that customer again was to create a second service line and lose the first
// one's history. `PATCH /v1/ganit/billing/service-lines/{id}` could always have
// reopened it — the door was missing, not the route. Found by proposal 93
// Suite 17 (17.04), 2026-08-29.
//
// It matches COLUMNS_ACTIVE's own trailing '' so both tables end on the same
// cell, which is what keeps them on one row contract.
const COLUMNS_ENDED = [
  'Client', 'Description',
  { label: 'Amount', align: 'right' },
  'Period', '',
];

export default function ServiceLinesTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage service lines' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [resuming, setResuming] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sl, pr] = await Promise.allSettled([
        api.get('/v1/ganit/billing/service-lines'),
        api.get('/v1/ganit/billing/profiles'),
      ]);
      if (sl.status === 'rejected') throw sl.reason;
      setItems(asRows(sl.value));
      setProfiles(pr.status === 'fulfilled' ? asRows(pr.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/service-lines/${form.id}`, {
          description: form.description,
          amount: Number(form.amount),
          period_end: form.period_end || null,
          auto_invoice: form.auto_invoice,
        });
        pushToast({ title: 'Service line updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/billing/service-lines', {
          ...form,
          amount: Number(form.amount),
          period_end: form.period_end || null,
        });
        pushToast({ title: 'Service line created', type: 'success' });
      }
      setEditing(null);
      load();
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Failed to save'), type: 'error' });
    }
  }

  /**
   * RESUME — put an ended service line back into billing.
   *
   * ── WHY THIS IS ITS OWN BUTTON AND NOT "OPEN THE EDITOR AND CLEAR THE DATE"
   *
   * Resuming a subscription is clearing `period_end`, and the editor's Period
   * End field has a real Clear button for it. **That Clear button cannot be
   * clicked.** Measured in a real browser 2026-08-29, 1280×720, on this very
   * modal:
   *
   *     modal panel      y 203 → 517   (.modal__panel, overflow:hidden;
   *                                     .modal__body, overflow:auto)
   *     date popover     y  65 → 381   ('pk__pop pk__pop--up')
   *     Clear button     y 106 → 133   — ABOVE the panel, outside both clips
   *     elementFromPoint at its centre → div.modal__scrim
   *
   * The popover is 316px tall and the panel is 314px, so it does not fit
   * below and flips up — into a region its clipping ancestors do not paint.
   * The button exists in the DOM, is `visible` and `enabled` to a test
   * runner, and lands on the scrim: a person clicking there closes the modal.
   * That is a defect in the SHARED picker (`ui/DateInput.jsx` positions the
   * popover absolutely inside a clipped container instead of portalling it),
   * it is not specific to this screen, and it is reported separately rather
   * than worked around quietly here.
   *
   * So this button does not depend on it. It is also the better affordance on
   * its own merits: §10 of proposal 93 asks for "pause; resume" as operations,
   * and "open the editor, find Period End, open the picker, press Clear" is
   * four steps of discovery for one verb. Reversible — the line can be ended
   * again from the same editor — so it needs no confirmation.
   */
  async function resume(sl) {
    setResuming(sl.id);
    try {
      // `null`, never `''`. The server tells an OMITTED key from an EXPLICIT
      // null by `model_fields_set` (`client_billing._assignments`), and only
      // the explicit null clears the column.
      await api.patch(`/v1/ganit/billing/service-lines/${sl.id}`, { period_end: null });
      pushToast({ title: `${sl.description || 'Service line'} resumed`, type: 'success' });
      await load();
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Could not resume this service line'), type: 'error' });
    }
    setResuming(null);
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const active = items.filter(i => !i.period_end || new Date(i.period_end) > new Date());
  const ended = items.filter(i => i.period_end && new Date(i.period_end) <= new Date());

  return (
    <div>
      <div className="gn-bar">
        <span className="gn-bar__sp" />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={() => setEditing({ ...BLANK })}>
            + Service Line
          </button>
        )}
        {!canWrite && denial && <span className="gn-denial">{denial}</span>}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="ganit"
          title="No service lines"
          description="Add recurring retainers, subscriptions, or one-off charges for your clients."
          action={canWrite ? '+ Service Line' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      ) : null}

      {active.length > 0 && (
        <>
          <h3 className="gn-section-head">Active <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'सक्रिय'}</span></h3>
          <DataTable columns={COLUMNS_ACTIVE} label="Active service lines">
            {active.map(sl => (
              <tr key={sl.id}>
                <Td bold>{sl.client_name}</Td>
                <Td>{sl.kind.replace('_', ' ')}</Td>
                <Td>{sl.description}</Td>
                <Td align="right" mono>{inr(sl.amount)}</Td>
                <Td>{sl.cadence.replace('_', ' ')}</Td>
                <Td>{sl.period_start}</Td>
                <Td>{sl.auto_invoice ? 'Yes' : '—'}</Td>
                <Td>
                  {canWrite && (
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => setEditing({ ...sl, amount: String(sl.amount) })}>
                      Edit
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      {ended.length > 0 && (
        <>
          <h3 className="gn-section-head" style={{ marginTop: 'var(--sp-5)' }}>Ended <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'समाप्त'}</span></h3>
          <DataTable columns={COLUMNS_ENDED} label="Ended service lines">
            {ended.map(sl => (
              <tr key={sl.id} style={{ opacity: 0.6 }}>
                <Td>{sl.client_name}</Td>
                <Td>{sl.description}</Td>
                <Td align="right" mono>{inr(sl.amount)}</Td>
                <Td>{sl.period_start} – {sl.period_end}</Td>
                <Td>
                  {canWrite && (
                    <>
                      <button type="button" className="btn btn--ghost btn--xs"
                        onClick={() => setEditing({ ...sl, amount: String(sl.amount) })}>
                        Edit
                      </button>
                      <button type="button" className="btn btn--ghost btn--xs"
                        disabled={resuming === sl.id}
                        title="Clear the end date so this line bills again"
                        onClick={() => resume(sl)}>
                        {resuming === sl.id ? 'Resuming…' : 'Resume'}
                      </button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <Modal
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        title={editing?.id ? 'Edit Service Line' : 'New Service Line'}
        footer={<>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn btn--fill btn--sm" onClick={save}>Save</button>
        </>}
      >
        {editing && (
          <div className="gn-form__grid">
            {!editing.id && (
              <label className="fld">
                <span className="fld__l">Billing Profile <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'बिलिंग प्रोफ़ाइल'}</span></span>
                <select className="inp" value={editing.profile_id}
                  onChange={e => setEditing({ ...editing, profile_id: e.target.value })}>
                  <option value="">Select…</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.client_name} ({p.billing_cycle})</option>
                  ))}
                </select>
              </label>
            )}
            {!editing.id && (
              <label className="fld">
                <span className="fld__l">Kind <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'प्रकार'}</span></span>
                <select className="inp" value={editing.kind}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                  {KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                </select>
              </label>
            )}
            <label className="fld">
              <span className="fld__l">Description <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'विवरण'}</span></span>
              <input className="inp" value={editing.description}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Amount <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'राशि'}</span></span>
              <input className="inp" type="number" min={0} step="0.01"
                value={editing.amount}
                onChange={e => setEditing({ ...editing, amount: e.target.value })} />
            </label>
            {!editing.id && (
              <label className="fld">
                <span className="fld__l">Cadence <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'आवृत्ति'}</span></span>
                <select className="inp" value={editing.cadence}
                  onChange={e => setEditing({ ...editing, cadence: e.target.value })}>
                  {CADENCES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </label>
            )}
            {!editing.id && (
              <label className="fld">
                <span className="fld__l">Period Start <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'अवधि प्रारंभ'}</span></span>
                <DateInput value={editing.period_start}
                  onChange={e => setEditing({ ...editing, period_start: e.target.value })} />
              </label>
            )}
            <label className="fld">
              <span className="fld__l">Period End <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'अवधि समाप्ति'}</span></span>
              <DateInput value={editing.period_end}
                onChange={e => setEditing({ ...editing, period_end: e.target.value })} />
            </label>
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <input type="checkbox" checked={editing.auto_invoice}
                onChange={e => setEditing({ ...editing, auto_invoice: e.target.checked })} />
              <span>Auto-generate invoices <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'स्वतः चालान'}</span></span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
