/**
 * The income-tax slab ladder, as something a person can set.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 *
 * `routers/vetana.py` computed TDS from two ladders written into its own
 * source, and `test_payroll_reads_the_dated_law.py` recorded why: of the
 * thirteen `tds.*` keys in the dated-law store, every one is a statement, a
 * certificate or a deposit DATE. The slab ladder was not in the database at
 * all, so a Finance Act change meant a deploy. Migration 228 gave it a table,
 * one row per band, on the owner's instruction of 2026-08-26.
 *
 * ── The three rules this screen has to make legible ─────────────────────────
 *
 * 1. THE SHARED LADDER IS READ BY EVERYONE AND EDITABLE BY NOBODY. It is
 *    national reference data; one firm editing it would move every other
 *    firm's deductions. Shared rows are listed — hiding them would show an
 *    empty ladder as "no tax is deducted" — but they carry no controls.
 *
 * 2. AN ORG'S OWN BANDS REPLACE THE SHARED LADDER WHOLESALE, not band by
 *    band. This is the one thing about this screen that will surprise
 *    somebody, so it is printed the moment it becomes true rather than left
 *    to be discovered from a payslip. Professional tax works the other way —
 *    one band at a time — and that difference is real: income tax slices
 *    across the whole ladder, so half of yours plus half of ours is a ladder
 *    no Finance Act ever enacted.
 *
 * 3. ONLY ONE GENERATION APPLIES. The table below holds several years of
 *    bands on purpose, so that re-running an old month uses that month's law.
 *    A screen that listed twenty-three bands without saying which seven apply
 *    today would be misread, so the heading of each regime says which
 *    generation is in force and from when.
 *
 * Nothing here is required and nothing here blocks a payroll run: an
 * organisation that sets nothing keeps the shared ladder, and one that
 * matches no band at all has ₹0 deducted.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Section, DataTable, Td } from '../../components/editorial';
import Tag from '../../components/ui/Tag';
import DateInput from '../../components/ui/DateInput';
import { Secondary } from '../../components/Bilingual';
import { api } from '../../lib/api';
import useModuleWrite from '../../hooks/useModuleWrite';

const REGIMES = [
  { key: 'new', label: 'New regime', hi: 'नई व्यवस्था' },
  { key: 'old', label: 'Old regime', hi: 'पुरानी व्यवस्था' },
];

const BLANK = {
  regime: 'new', slab_from: '', slab_to: '', rate_percent: '',
  effective_from: '', assessment_year: '', source_ref: '', notes: '',
};

const inr = (n) =>
  n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

/** The statute's own wording — "5% above ₹4,00,000" — not "from/to". The
 *  bounds are contiguous thresholds, and a reader who takes them as inclusive
 *  will enter the next band a rupee too high. */
function bandLabel(from, to) {
  const lo = Number(from || 0);
  if (lo === 0) return `Up to ${inr(to)}`;
  if (to == null || to === '') return `Above ${inr(lo)}`;
  return `Above ${inr(lo)}, up to ${inr(to)}`;
}

const COLUMNS = [
  'Band', { label: 'Rate', align: 'right' }, 'Applies from',
  'Assessment year', 'Source', '',
];

/** Plain English for the one thing an administrator can act on. */
function advisoryText(a) {
  if (a.kind === 'gap') {
    return `Nothing is set between ${inr(a.from)} and ${inr(a.to)}, so that `
      + 'slice of salary is taxed at nothing.';
  }
  if (a.kind === 'overlap') {
    return `Two bands both claim ${inr(a.from)} to ${inr(a.to)}. Payroll `
      + 'charges it once, at the lower band’s rate — but one of the two is '
      + 'wrong.';
  }
  if (a.kind === 'unreachable') {
    return `A band ending in “and above” sits below ${inr(a.from)}, so this `
      + 'band is never reached.';
  }
  if (a.kind === 'capped') {
    return `Nothing is set above ${inr(a.from)}, so salary beyond it is taxed `
      + 'at nothing. Leave the top band’s upper figure blank for “and above”.';
  }
  return '';
}

export default function ItLadderSection() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'set the income-tax ladder' });
  const [rows, setRows] = useState(null);
  const [resolved, setResolved] = useState({});
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError('');
    try {
      const r = await api.get('/v1/vetana/it-slabs');
      setRows(r.data?.data ?? []);
      setResolved(r.data?.resolved ?? {});
    } catch (e) {
      setError(e?.response?.data?.detail || 'The ladder could not be loaded.');
      setRows([]);
      setResolved({});
    }
  }
  useEffect(() => { load(); }, []);

  function startNew(regime) {
    setEditId(null);
    setForm({ ...BLANK, regime });
    setShowForm(true);
  }

  function startEdit(row) {
    setEditId(row.id);
    setForm({
      regime: row.regime ?? 'new',
      slab_from: row.slab_from ?? '',
      slab_to: row.slab_to ?? '',
      rate_percent: row.rate_percent ?? '',
      effective_from: row.effective_from ? String(row.effective_from).slice(0, 10) : '',
      assessment_year: row.assessment_year ?? '',
      source_ref: row.source_ref ?? '',
      notes: row.notes ?? '',
    });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    // Blank -> null, never '' and never 0. A blank upper bound means "and
    // above"; 0 is a real rate (the nil band of every ladder in the country),
    // so it must survive as 0.
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const payload = {
      regime: form.regime,
      slab_from: num(form.slab_from) ?? 0,
      slab_to: num(form.slab_to),
      rate_percent: num(form.rate_percent) ?? 0,
      effective_from: form.effective_from || '',
      assessment_year: form.assessment_year || '',
      source_ref: form.source_ref || '',
      notes: form.notes || '',
    };
    try {
      if (editId) await api.patch(`/v1/vetana/it-slabs/${editId}`, payload);
      else await api.post('/v1/vetana/it-slabs', payload);
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
      await api.delete(`/v1/vetana/it-slabs/${row.id}`);
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'The band could not be removed.');
    }
  }

  const byRegime = useMemo(() => {
    const out = { new: [], old: [] };
    (rows || []).forEach((r) => {
      if (out[r.regime]) out[r.regime].push(r);
    });
    return out;
  }, [rows]);

  const ownCount = (rows || []).filter(r => r.is_own).length;
  const sharedCount = (rows || []).length - ownCount;

  return (
    <Section title="Income tax" hi="आयकर">
      {/* Said out loud, because a settings page full of empty fields reads as a
          list of obligations unless it says otherwise. */}
      <p className="k-cust__hint vt-it__note">
        Optional. Leave this alone and payroll uses the shared ladder below —
        {' '}{sharedCount} band{sharedCount === 1 ? '' : 's'} already set up for
        you, carrying the Finance Act each one comes from. Add bands only where
        your organisation’s figures differ. <b>Your bands replace the shared
        ladder for that regime completely</b>, rather than slotting in beside
        it, so enter the whole ladder or none of it. Nothing here can stop a
        payroll run — a regime with no bands has nothing deducted.
      </p>

      {error && <p className="k-formpanel__err" role="alert">{error}</p>}
      {!canWrite && denial && <p className="gn-denial">{denial}</p>}

      {showForm && (
        <form className="gn-form" onSubmit={save}>
          <h3 className="gn-form__t">{editId ? 'Edit band' : 'New band'}</h3>

          <label className="gn-form__field">
            Regime<Secondary value="कर व्यवस्था" />
            <select
              value={form.regime}
              onChange={e => setForm(f => ({ ...f, regime: e.target.value }))}
            >
              {REGIMES.map(r => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </label>

          {/* "Above" and "up to", never "from" and "to". The bounds are
              contiguous thresholds — the statute reads "5% above ₹4,00,000" —
              and a band typed 4,00,001 off a newspaper table would under-tax
              by a rupee of base. */}
          <label className="gn-form__field">
            Annual income above (₹)
            <input
              type="number" step="1" min="0" value={form.slab_from}
              onChange={e => setForm(f => ({ ...f, slab_from: e.target.value }))}
              placeholder="0"
            />
          </label>

          <label className="gn-form__field">
            …and up to (₹)
            <input
              type="number" step="1" min="0" value={form.slab_to}
              onChange={e => setForm(f => ({ ...f, slab_to: e.target.value }))}
              placeholder="Blank means “and above”"
            />
          </label>

          <label className="gn-form__field">
            Rate (%)
            <input
              type="number" step="0.001" min="0" max="100" value={form.rate_percent}
              onChange={e => setForm(f => ({ ...f, rate_percent: e.target.value }))}
              placeholder="0"
            />
          </label>

          <label className="gn-form__field">
            Applies from
            {/* DateInput, never a native date field — the ratchet in
                scripts/ and DateInput.jsx's own header both say so.
                Every band of one ladder must carry the SAME date: that
                shared date is what makes the ladder resolve as a unit. */}
            <DateInput
              value={form.effective_from}
              onChange={e => setForm(f => ({ ...f, effective_from: e.target.value || '' }))}
            />
          </label>

          <label className="gn-form__field">
            Assessment year
            <input
              type="text" value={form.assessment_year}
              onChange={e => setForm(f => ({ ...f, assessment_year: e.target.value }))}
              placeholder="AY 2026-27"
            />
          </label>

          <label className="gn-form__field">
            Source
            <input
              type="text" value={form.source_ref}
              onChange={e => setForm(f => ({ ...f, source_ref: e.target.value }))}
              placeholder="Finance Act 2025, s.115BAC(1A)"
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

      {REGIMES.map(({ key, label, hi }) => {
        const info = resolved[key] || {};
        const list = byRegime[key] || [];
        return (
          <div key={key} className="vt-it__reg">
            <div className="k-section__head vt-head">
              <h4 className="k-section__title">
                {label}<Secondary className="k-section__title-hi" value={hi} />
              </h4>
              {canWrite && (
                <button
                  type="button" className="btn btn--fill btn--sm"
                  onClick={() => startNew(key)}
                >
                  + Add band to {label.toLowerCase()}
                </button>
              )}
            </div>

            {/* WHICH generation applies, said before the table rather than
                inferred from the dates in it. */}
            <p className="k-cust__hint vt-it__note">
              {info.band_count
                ? <>
                    In force today: <b>{info.band_count} band{info.band_count === 1 ? '' : 's'}</b>
                    {info.effective_from ? <> effective {info.effective_from}</> : null}
                    {info.assessment_year ? <> ({info.assessment_year})</> : null}
                    {info.is_own
                      ? <> — <b>your organisation’s own ladder</b>, which has replaced the shared one entirely.</>
                      : <> — the shared ladder.</>}
                  </>
                : <>No bands apply, so nothing is deducted under this regime.</>}
            </p>

            {(info.advisories || []).map((a, i) => {
              const text = advisoryText(a);
              return text ? (
                <p key={`${a.kind}-${i}`} className="vt-it__adv">{text}</p>
              ) : null;
            })}

            <DataTable columns={COLUMNS} label={`${label} income-tax bands`}>
              {list.map(r => (
                <tr key={r.id}>
                  <Td>
                    {bandLabel(r.slab_from, r.slab_to)}
                    {!r.is_own && (
                      <Tag color="var(--on-surface-3)" className="vt-it__tag">Shared</Tag>
                    )}
                  </Td>
                  <Td align="right" mono>{Number(r.rate_percent ?? 0)}%</Td>
                  <Td>{r.effective_from ? String(r.effective_from).slice(0, 10) : '—'}</Td>
                  <Td>{r.assessment_year || '—'}</Td>
                  <Td>{r.source_ref || '—'}</Td>
                  <Td align="right">
                    {/* Shared rows carry no controls. The way to change one is
                        to enter your own ladder, which the note above says. */}
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

            {rows && list.length === 0 && (
              <p className="k-cust__hint">
                No bands at all under this regime — nothing is deducted until
                one is added or a shared ladder is seeded.
              </p>
            )}
          </div>
        );
      })}

      {/* Not a band, and therefore not in this table. Said here because a
          reader comparing this ladder against a payslip will otherwise
          conclude the ladder is wrong. */}
      <p className="k-cust__hint vt-it__note">
        These are the slab rates only. The section 87A rebate, the 4% health
        and education cess, surcharge and the standard deduction are not bands
        and are not set here.
      </p>
    </Section>
  );
}
