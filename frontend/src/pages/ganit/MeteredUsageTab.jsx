import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows, body } from '../../lib/api';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useToast } from '../../components/ui/toast';
import { Modal } from '../../components/ui/modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';
import { apiErrorText } from '../../lib/apiError';

const BLANK = {
  profile_id: '', metric: '', quantity: '', unit: '', rate: '',
  recorded_date: '', source_ref: '',
};

const USAGE_COLUMNS = [
  'Date', 'Metric', { label: 'Qty', align: 'right' }, 'Unit',
  { label: 'Rate', align: 'right' }, { label: 'Amount', align: 'right' },
  'Source', 'Status', '',
];

export default function MeteredUsageTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage metered usage' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [filter, setFilter] = useState('unbilled');
  const [generating, setGenerating] = useState(null);

  // ⚠ `setLoading(true)` LIVES HERE, AND ONLY HERE.
  //
  // It used to sit in the filter `<select>`'s own onChange:
  //
  //     onChange={e => { setFilter(e.target.value); setLoading(true); }}
  //
  // and `load` is memoised on `[filter]`, so the effect that clears the flag
  // only re-runs when the filter's VALUE changes. A change event carrying the
  // value the select already held therefore raised `loading` with nothing left
  // to lower it: the whole panel became a skeleton — client headings, the
  // Generate Invoice buttons, and the filter itself — and stayed one until the
  // page was reloaded. Measured on staging 2026-08-29: 7 client groups and 7
  // Generate Invoice controls before, 0 of each and 37 skeleton nodes after,
  // with the select gone so there was no way back.
  //
  // That is the "spinner that never resolves" a new customer must never meet,
  // and it read from outside as a MISSING CONTROL — proposal 93 Suite 17
  // reported "no Generate Invoice control" for a button that was there all
  // along. The state that can strand is now owned by the one function that
  // always clears it, so raising it without lowering it is not expressible.
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const invoicedParam = filter === 'all' ? '' : filter === 'unbilled' ? 'false' : 'true';
      const [u, pr] = await Promise.allSettled([
        api.get(`/v1/ganit/billing/metered-usage${invoicedParam ? `?invoiced=${invoicedParam}` : ''}`),
        api.get('/v1/ganit/billing/profiles'),
      ]);
      if (u.status === 'rejected') throw u.reason;
      setItems(asRows(u.value));
      setProfiles(pr.status === 'fulfilled' ? asRows(pr.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/metered-usage/${form.id}`, {
          metric: form.metric,
          quantity: Number(form.quantity),
          unit: form.unit,
          rate: Number(form.rate),
          recorded_date: form.recorded_date || null,
          source_ref: form.source_ref || null,
        });
        pushToast({ title: 'Usage entry updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/billing/metered-usage', {
          ...form,
          quantity: Number(form.quantity),
          rate: Number(form.rate),
          recorded_date: form.recorded_date || null,
          source_ref: form.source_ref || null,
        });
        pushToast({ title: 'Usage entry recorded', type: 'success' });
      }
      setEditing(null);
      load();
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Failed to save'), type: 'error' });
    }
  }

  function handleDelete(id) {
    setConfirm({
      message: 'Delete this usage entry?',
      intent: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/v1/ganit/billing/metered-usage/${id}`);
          pushToast({ title: 'Usage entry deleted', type: 'success' });
          load();
        } catch (e) {
          pushToast({ title: apiErrorText(e, 'Failed to delete'), type: 'error' });
        }
      },
    });
  }

  async function generateInvoice(profileId) {
    setGenerating(profileId);
    try {
      // ⚠ `body(...)`, NOT the axios response. `api` is a bare axios instance
      // (`lib/api.js:18`), so the payload lives at `.data` — this read
      // `res.entries` and `res.total` off the envelope, where neither exists.
      // The toast therefore told a firm that had just raised a real tax
      // invoice: "Invoice created: undefined entries, ₹0". `inr(undefined)`
      // returns ₹0 rather than NaN (`lib/inr.js:13`), so it did not even read
      // as broken — it read as a zero-rupee invoice. Found while fixing the
      // control that made this line reachable at all, 2026-08-29.
      const out = body(await api.post('/v1/ganit/billing/metered-usage/generate-invoice', {
        profile_id: profileId,
      }));
      pushToast({
        title: `Invoice ${out.invoice_number || 'created'}: ${out.entries} entries, ${inr(out.total)}`,
        type: 'success',
      });
      load();
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Failed to generate invoice'), type: 'error' });
    }
    setGenerating(null);
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const byProfile = {};
  for (const u of items) {
    const key = u.profile_id;
    if (!byProfile[key]) byProfile[key] = { client_name: u.client_name, profile_id: key, rows: [] };
    byProfile[key].rows.push(u);
  }
  const groups = Object.values(byProfile);

  return (
    <div>
      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Filter <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'फ़िल्टर'}</span></span>
          <select
            className="inp gn-bar__sel"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="unbilled">Unbilled</option>
            <option value="invoiced">Invoiced</option>
            <option value="all">All</option>
          </select>
        </label>
        <span className="gn-bar__sp" />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={() => setEditing({ ...BLANK })}>
            + Usage Entry
          </button>
        )}
        {!canWrite && denial && <span className="gn-denial">{denial}</span>}
      </div>

      {/* ── AN EMPTY FILTER IS NOT AN EMPTY TABLE ──────────────────────────
          This said "No usage entries" whenever the list came back empty — and
          the list is FILTERED, defaulting to Unbilled. Measured live
          2026-08-31: Unicode holds 18 usage rows and ALL 18 are invoiced, so
          the screen told a reader there were none while eighteen sat one
          dropdown away. Suite 05.01 read the same contradiction from outside
          and reported "18 rows on the wire and paints none of them".

          20.09 asks that an empty list say so in words. Saying the WRONG words
          is the version of that failure nobody checks for: the reader does not
          go looking, because they have been told there is nothing to find. */}
      {items.length === 0 && (
        <EmptyState
          icon="ganit"
          title={filter === 'unbilled' ? 'No unbilled usage'
            : filter === 'invoiced' ? 'No invoiced usage'
              : 'No usage entries'}
          description={filter === 'all'
            ? 'Record billable hours, units, or transactions for your clients. Generate invoices from unbilled usage.'
            : filter === 'unbilled'
              ? 'Everything recorded so far has been invoiced. Switch the filter to All to see it.'
              : 'Nothing has been invoiced yet. Switch the filter to All to see what is recorded.'}
          action={canWrite ? '+ Usage Entry' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      {groups.map(g => (
        <div key={g.profile_id} style={{ marginBottom: 'var(--sp-5)' }}>
          <div className="gn-bar" style={{ marginBottom: 'var(--sp-2)' }}>
            <h3 className="gn-section-head" style={{ margin: 0 }}>{g.client_name}</h3>
            <span className="gn-bar__sp" />
            {canWrite && filter !== 'invoiced' && g.rows.some(r => !r.invoiced) && (
              <button
                type="button" className="btn btn--tonal btn--sm"
                disabled={generating === g.profile_id}
                onClick={() => generateInvoice(g.profile_id)}
              >
                {generating === g.profile_id ? 'Generating…' : 'Generate Invoice'}
              </button>
            )}
          </div>
          <DataTable columns={USAGE_COLUMNS} label={`Usage: ${g.client_name}`}>
            {g.rows.map(u => (
              <tr key={u.id} style={u.invoiced ? { opacity: 0.6 } : undefined}>
                <Td>{u.recorded_date}</Td>
                <Td>{u.metric}</Td>
                <Td align="right" mono>{u.quantity}</Td>
                <Td>{u.unit}</Td>
                <Td align="right" mono>{inr(u.rate)}</Td>
                <Td align="right" mono>{inr(Number(u.quantity) * Number(u.rate))}</Td>
                <Td>{u.source_ref || '—'}</Td>
                <Td>
                  <span className={`gn-tag${u.invoiced ? ' gn-tag--ok' : ''}`}>
                    {u.invoiced ? 'Invoiced' : 'Unbilled'}
                  </span>
                </Td>
                <Td>
                  {canWrite && !u.invoiced && (
                    <>
                      <button type="button" className="btn btn--ghost btn--xs"
                        onClick={() => setEditing({
                          ...u, quantity: String(u.quantity), rate: String(u.rate),
                        })}>
                        Edit
                      </button>
                      <button type="button" className="btn btn--ghost btn--xs"
                        onClick={() => handleDelete(u.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
          {!g.rows.some(r => r.invoiced) && (
            <div style={{ textAlign: 'right', fontSize: 'var(--t-micro)', color: 'var(--on-surface-3)', marginTop: 'var(--sp-1)' }}>
              Total: {inr(g.rows.reduce((s, r) => s + Number(r.quantity) * Number(r.rate), 0))}
            </div>
          )}
        </div>
      ))}

      <Modal
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        title={editing?.id ? 'Edit Usage Entry' : 'New Usage Entry'}
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
            <label className="fld">
              <span className="fld__l">Metric <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'माप'}</span></span>
              <input className="inp" value={editing.metric}
                placeholder="e.g. Consulting Hours, Units Processed"
                onChange={e => setEditing({ ...editing, metric: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Quantity <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'मात्रा'}</span></span>
              <input className="inp" type="number" min={0} step="0.01"
                value={editing.quantity}
                onChange={e => setEditing({ ...editing, quantity: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Unit <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'इकाई'}</span></span>
              <input className="inp" value={editing.unit}
                placeholder="e.g. hours, units, transactions"
                onChange={e => setEditing({ ...editing, unit: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Rate <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'दर'}</span></span>
              <input className="inp" type="number" min={0} step="0.01"
                value={editing.rate}
                onChange={e => setEditing({ ...editing, rate: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Date <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'तिथि'}</span></span>
              <DateInput value={editing.recorded_date}
                onChange={e => setEditing({ ...editing, recorded_date: e.target.value })} />
            </label>
            <label className="fld gn-form__wide">
              <span className="fld__l">Source Reference <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'स्रोत संदर्भ'}</span></span>
              <input className="inp" value={editing.source_ref || ''}
                placeholder="e.g. task:uuid, timesheet:uuid"
                onChange={e => setEditing({ ...editing, source_ref: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
