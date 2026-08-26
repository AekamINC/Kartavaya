/**
 * The professional-tax ladder, as something a person can set.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 *
 * Nothing in this product could write `pay_professional_tax`. Every backend
 * reference was a read, and the nine live rows exist because a migration put
 * them there — so a state nobody seeded, a rate change, or Maharashtra's
 * different February figure could only be fixed by shipping another migration.
 *
 * ── The two rules this screen has to make legible ───────────────────────────
 *
 * 1. THE SHARED LADDER IS READ BY EVERYONE AND EDITABLE BY NOBODY. It is
 *    national reference data; one firm editing it would move every other
 *    firm's deductions. So shared rows are listed — hiding them would show an
 *    empty ladder as "nothing is deducted" and send an administrator to
 *    duplicate bands that already apply — but they carry no controls, and the
 *    way to change one is to add your own band over it.
 *
 * 2. NOTHING HERE IS REQUIRED. Owner's rule: like GSTIN, PAN and TAN this is
 *    optional and blocks nothing. An organisation that sets nothing keeps the
 *    shared ladder. That is said on the screen rather than left to be
 *    discovered, because a settings page full of empty fields reads as a list
 *    of obligations unless it says otherwise.
 */
import React, { useEffect, useState } from 'react';
import { Section, DataTable, Td } from '../../components/editorial';
import Tag from '../../components/ui/Tag';
import DateInput from '../../components/ui/DateInput';
import { Secondary } from '../../components/Bilingual';
import { api } from '../../lib/api';
import { GST_STATES } from '../../lib/validators';
import useModuleWrite from '../../hooks/useModuleWrite';

/** The same statutory codelist the invoice form and the employee form use.
 *  Not a second copy — a free-text state is a state nothing can join on. */
const STATE_OPTIONS = Object.entries(GST_STATES)
  .map(([code, name]) => [code, name])
  .sort((a, b) => a[1].localeCompare(b[1]));

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const BLANK = {
  state_code: '', state_name: '', slab_from: '', slab_to: '',
  monthly_tax: '', month: '', effective_from: '',
};

const inr = (n) =>
  n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

/** "₹10,001 and above" reads better than an em dash where a number should be. */
function bandLabel(from, to) {
  const lo = Number(from || 0);
  if (to == null || to === '') return `${inr(lo)} and above`;
  return `${inr(lo)} – ${inr(to)}`;
}

const COLUMNS = ['State', 'Salary band', 'Applies in', 'Per month', 'From', ''];

export default function PtLadderSection() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'set professional tax' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError('');
    try {
      const r = await api.get('/v1/vetana/pt-slabs');
      setRows(r.data?.data ?? []);
    } catch (e) {
      setError(e?.response?.data?.detail || 'The ladder could not be loaded.');
      setRows([]);
    }
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setEditId(null);
    setForm(BLANK);
    setShowForm(true);
  }

  function startEdit(row) {
    setEditId(row.id);
    setForm({
      state_code: row.state_code ?? '',
      state_name: row.state_name ?? '',
      slab_from: row.slab_from ?? '',
      slab_to: row.slab_to ?? '',
      monthly_tax: row.monthly_tax ?? '',
      month: row.month ?? '',
      effective_from: row.effective_from ? String(row.effective_from).slice(0, 10) : '',
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    // Blank -> null, never '' and never 0. A blank upper bound means "and
    // above"; a blank month means EVERY month; and 0 is a real monthly figure
    // (a band a state levies nothing on), so it must survive as 0.
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const payload = {
      state_code: form.state_code,
      state_name: GST_STATES[form.state_code] || form.state_name || '',
      slab_from: num(form.slab_from) ?? 0,
      slab_to: num(form.slab_to),
      monthly_tax: num(form.monthly_tax) ?? 0,
      month: num(form.month),
      effective_from: form.effective_from || '',
    };
    try {
      if (editId) await api.patch(`/v1/vetana/pt-slabs/${editId}`, payload);
      else await api.post('/v1/vetana/pt-slabs', payload);
      setShowForm(false);
      setForm(BLANK);
      setEditId(null);
      await load();
    } catch (e2) {
      setError(e2?.response?.data?.detail || 'The band could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    setError('');
    try {
      await api.delete(`/v1/vetana/pt-slabs/${row.id}`);
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'The band could not be removed.');
    }
  }

  const own = (rows || []).filter(r => r.is_own).length;

  return (
    <Section
      title="Professional tax"
      hi="व्यवसाय कर"
      right={canWrite ? (
        <button type="button" className="btn btn--fill btn--sm" onClick={startNew}>
          + Add band
        </button>
      ) : null}
    >
      {/* Said out loud, because a settings page full of empty fields reads as a
          list of obligations unless it says otherwise. */}
      <p className="k-cust__hint vt-pt__note">
        Optional. Leave this alone and payroll uses the shared ladder below —
        {' '}{(rows || []).length - own} band{(rows || []).length - own === 1 ? '' : 's'}
        {' '}already set up for you. Add a band only where your organisation's
        figure differs; yours is used in place of the shared one for the same
        state and salary range. Nothing here can stop a payroll run.
      </p>

      {error && <p className="k-formpanel__err" role="alert">{error}</p>}
      {!canWrite && denial && <p className="gn-denial">{denial}</p>}

      {showForm && (
        <form className="gn-form" onSubmit={save}>
          <h3 className="gn-form__t">{editId ? 'Edit band' : 'New band'}</h3>

          <label className="gn-form__field">
            State<Secondary value="राज्य" />
            <select
              value={form.state_code}
              onChange={e => setForm(f => ({ ...f, state_code: e.target.value }))}
            >
              <option value="">Select a state…</option>
              {STATE_OPTIONS.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>

          <label className="gn-form__field">
            Salary from (₹)
            <input
              type="number" step="1" min="0" value={form.slab_from}
              onChange={e => setForm(f => ({ ...f, slab_from: e.target.value }))}
              placeholder="0"
            />
          </label>

          <label className="gn-form__field">
            Salary to (₹)
            <input
              type="number" step="1" min="0" value={form.slab_to}
              onChange={e => setForm(f => ({ ...f, slab_to: e.target.value }))}
              placeholder="Blank means “and above”"
            />
          </label>

          <label className="gn-form__field">
            Tax per month (₹)
            <input
              type="number" step="0.01" min="0" value={form.monthly_tax}
              onChange={e => setForm(f => ({ ...f, monthly_tax: e.target.value }))}
              placeholder="0"
            />
          </label>

          <label className="gn-form__field">
            Applies in<Secondary value="माह" />
            <select
              value={form.month}
              onChange={e => setForm(f => ({ ...f, month: e.target.value }))}
            >
              {/* The default, and the one almost every band wants. Named rather
                  than left as an empty option, because "blank" is a choice here
                  and not an omission. */}
              <option value="">Every month</option>
              {MONTHS.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>{m} only</option>
              ))}
            </select>
          </label>

          <label className="gn-form__field">
            Effective from
            {/* DateInput, never a native date field — the ratchet in
                scripts/ and DateInput.jsx's own header both say so. */}
            <DateInput
              value={form.effective_from}
              onChange={v => setForm(f => ({ ...f, effective_from: v || '' }))}
            />
          </label>

          <div className="gn-form__acts">
            <button
              type="button" className="btn btn--ghost btn--sm"
              onClick={() => { setShowForm(false); setEditId(null); }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Save band' : 'Add band'}
            </button>
          </div>
        </form>
      )}

      <DataTable columns={COLUMNS} label="Professional tax bands">
        {(rows || []).map(r => (
          <tr key={r.id}>
            <Td>
              {GST_STATES[r.state_code] || r.state_name || '—'}
              {!r.is_own && (
                <Tag color="var(--on-surface-3)" className="vt-pt__tag">Shared</Tag>
              )}
            </Td>
            <Td>{bandLabel(r.slab_from, r.slab_to)}</Td>
            <Td>{r.month ? `${MONTHS[r.month]} only` : 'Every month'}</Td>
            <Td align="right" mono>{inr(r.monthly_tax)}</Td>
            <Td>{r.effective_from ? String(r.effective_from).slice(0, 10) : '—'}</Td>
            <Td align="right">
              {/* Shared rows carry no controls. The way to change one is to add
                  your own band over it, which is what the note above says. */}
              {r.is_own && canWrite ? (
                <>
                  <button
                    type="button" className="btn btn--ghost btn--xs"
                    onClick={() => startEdit(r)}
                  >
                    Edit
                  </button>
                  <button
                    type="button" className="btn btn--ghost btn--xs"
                    onClick={() => remove(r)}
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </Td>
          </tr>
        ))}
      </DataTable>

      {rows && rows.length === 0 && (
        <p className="k-cust__hint">
          No bands at all — professional tax will deduct nothing until one is
          added or a shared ladder is seeded.
        </p>
      )}
    </Section>
  );
}
