// Vetana → Salary structures. What each person is paid, before a month is run.
//
// A structure is the input to every payroll run — `process_payroll` iterates
// structures, not employees, so an employee without one is skipped in silence.
// That consequence is stated on the Dashboard tab, where the two counts sit side
// by side; here the emphasis is on the split adding up.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, Empty, BackButton, ModCard, DataTable, Td } from '../../components/editorial';
import { useList, ErrorNote, FMT, Shim, errText, empName } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';

const COMPONENTS = [
  ['Basic', 'basic'], ['HRA', 'hra'], ['DA', 'da'],
  ['Special allowance', 'special_allowance'], ['Conveyance', 'conveyance'], ['Medical', 'medical'],
];

/**
 * The five statutory switches migration 190 added, in plain words.
 *
 * `[column, what ticking it means, WHAT UNTICKING IT MEANS, the column's own
 * DEFAULT]`. The third entry is the one that matters: unticked is a real
 * answer here and not a neutral one. Migration 190 is explicit about it —
 * "All four DEFAULT FALSE, and THAT IS A CHOICE, not a neutral position:
 * unticked means the component does not attract the deduction" — so a screen
 * that shows five empty boxes without saying what empty means has told the
 * person nothing.
 *
 * The wording is deliberately about PF and ESI rather than about column names.
 * Somebody setting these is deciding whether a payment attracts a statutory
 * deduction; they are not editing `commission_in_pf_base`.
 *
 * NONE OF THESE CHANGES A RATE. PF at 12% capped at ₹1,800, ESI at 0.75% and
 * 3.25% under the ₹21,000 ceiling, and the slab tables are LAW. These switches
 * change only WHAT THE BASE INCLUDES and WHETHER a component is computed.
 */
export const STAT_SWITCHES = [
  ['tds_applicable', 'Deduct income tax at source (TDS) from this salary',
    'Unticked, no TDS is deducted from this person at all, and the regime chosen '
    + 'beside it then decides nothing. Before this switch existed the slab table ran '
    + 'unconditionally, so leave it ticked unless the firm genuinely does not deduct '
    + 'tax at source on this person’s pay.', true],
  ['commission_in_pf_base', 'Commission counts towards provident fund',
    'Unticked, provident fund is worked out on the fixed salary alone and a commission '
    + 'payment attracts no PF.', false],
  ['commission_in_esi_base', 'Commission counts towards state insurance (ESI)',
    'Unticked, commission attracts no ESI — and is also left out of the ₹21,000 '
    + 'gross test that decides whether ESI applies to this person at all.', false],
  ['bonus_in_pf_base', 'Bonus counts towards provident fund',
    'Unticked, a bonus attracts no PF. Firms often answer this differently from the '
    + 'commission question above, which is why the two are separate.', false],
  ['bonus_in_esi_base', 'Bonus counts towards state insurance (ESI)',
    'Unticked, a bonus attracts no ESI and is left out of the ₹21,000 gross test.', false],
];

/** `{ tds_applicable: true, commission_in_pf_base: false, … }` */
export const statDefaults = () =>
  Object.fromEntries(STAT_SWITCHES.map(([key, , , def]) => [key, def]));

/**
 * Which of the five the server did NOT record — checked against what it echoed
 * back, not against what was clicked.
 *
 * This is not defensiveness for its own sake. `SalaryStructureCreate` and
 * `SalaryStructureUpdate` in `routers/vetana.py` do not yet carry these five
 * field names, and a Pydantic model ignores fields it does not declare, so a
 * request naming them is accepted and the answers are silently dropped. Both
 * routes return the stored row (`RETURNING *`), so the truth is in the
 * response — and comparing against it means the warning fires exactly when the
 * intent was not stored, and disappears by itself the day the two field lists
 * are added. A green tick over a discarded answer about somebody's PF is the
 * one outcome this must not produce.
 */
export function unrecordedSwitches(sent, saved) {
  if (!saved) return [];
  return STAT_SWITCHES
    .filter(([key]) => key in sent && Boolean(saved[key]) !== Boolean(sent[key]))
    .map(([, label]) => label);
}

const BLANK = {
  employee_id: '', effective_from: '', ctc_annual: 0, basic: 0, hra: 0, da: 0,
  special_allowance: 0, conveyance: 0, medical: 0, pf_enabled: true, esi_enabled: false,
  pt_applicable: true, tds_regime: 'new', notes: '',
  ...statDefaults(),
};

export default function StructuresTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change salary structures' });
  const { pushToast } = useToast();
  const list = useList('/v1/vetana/salary-structures');
  const [showForm, setShowForm] = useState(false);
  const [employees, setEmployees] = useState({ loading: false, error: '', items: [] });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [detailId, setDetailId] = useState(null);
  // Named on screen when the server accepts a save but does not store the
  // statutory answers — see `unrecordedSwitches`.
  const [dropped, setDropped] = useState([]);

  async function openForm() {
    setShowForm(true);
    setEmployees({ loading: true, error: '', items: [] });
    try {
      const r = await api.get('/v1/manav/employees');
      setEmployees({ loading: false, error: '', items: r.data.data || [] });
    } catch (err) {
      // The picker failing is not the form failing, and it must say which.
      setEmployees({ loading: false, error: errText(err, 'The employee list could not be loaded.'), items: [] });
    }
  }

  /**
   * A conventional Indian CTC split, offered as a starting point.
   *
   * Basic at 40% of monthly CTC, HRA at half of basic, DA at 5%, and the
   * statutory-exempt conveyance and medical at their long-standing figures. It
   * is a convention, not a rule — every field stays editable, and the total is
   * shown against CTC so a hand-edit that stops adding up is visible.
   */
  function autoSplit(ctc) {
    const monthly = ctc / 12;
    const basic = Math.round(monthly * 0.40);
    const hra = Math.round(basic * 0.50);
    const da = Math.round(monthly * 0.05);
    const conveyance = 1600;
    const medical = 1250;
    const special = Math.round(monthly - basic - hra - da - conveyance - medical);
    setForm(f => ({
      ...f, ctc_annual: ctc, basic, hra, da,
      special_allowance: Math.max(special, 0), conveyance, medical,
    }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.employee_id) { pushToast({ title: 'Choose an employee first.', type: 'error' }); return; }
    if (!form.effective_from) { pushToast({ title: 'A structure needs an effective date — a run picks the latest one on or before the month end.', type: 'error' }); return; }
    setSaving(true);
    try {
      const r = await api.post('/v1/vetana/salary-structures', form);
      const missed = unrecordedSwitches(form, r?.data);
      setDropped(missed);
      pushToast({
        title: missed.length
          ? 'Structure saved — but the statutory answers were not stored'
          : 'Salary structure saved',
        type: missed.length ? 'error' : 'success',
      });
      setShowForm(false);
      setForm(BLANK);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The structure could not be saved.'), type: 'error' });
    } finally { setSaving(false); }
  }

  if (detailId) {
    return <StructureDetail id={detailId} onBack={() => { setDetailId(null); list.reload(); }} />;
  }

  const monthlyTotal = COMPONENTS.reduce((s, [, k]) => s + Number(form[k] || 0), 0);
  const ctcMonthly = Number(form.ctc_annual || 0) / 12;
  const drift = Math.round(monthlyTotal - ctcMonthly);

  return (
    <div>
      <div className="k-section__head vt-head">
        <h3 className="k-section__title">
          Salary structures<Secondary className="k-section__title-hi" value="वेतन ढाँचा" />
        </h3>
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => { if (showForm) { setShowForm(false); } else { openForm(); } }}
        >
          {showForm ? 'Cancel' : '+ New structure'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          {employees.error && (
            <ErrorNote what="The employee list" error={employees.error} onRetry={openForm} />
          )}
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Employee
              <select
                value={form.employee_id}
                onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                className="k-formpanel__input"
                disabled={employees.loading || !!employees.error}
              >
                <option value="">{employees.loading ? 'Loading…' : 'Select…'}</option>
                {employees.items.map(emp => (
                  <option key={emp.id} value={emp.id}>{empName(emp)} ({emp.employee_code})</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">Effective from
              <DateInput
                type="date"
                value={form.effective_from}
                onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
                className="k-formpanel__input"
              />
            </label>
            <label className="k-formpanel__label">Annual CTC (₹)
              <input
                type="number"
                min="0"
                value={form.ctc_annual}
                onChange={e => autoSplit(Number(e.target.value))}
                className="k-formpanel__input"
              />
            </label>
          </div>

          <Section title="Monthly breakdown" hi="मासिक विवरण">
            <div className="k-formpanel__grid k-formpanel__grid--3">
              {COMPONENTS.map(([label, key]) => (
                <label key={key} className="k-formpanel__label">{label}
                  <input
                    type="number"
                    min="0"
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                    className="k-formpanel__input"
                  />
                </label>
              ))}
            </div>
            {/* Entering a CTC fills the split; editing a component by hand does
                not change the CTC. Without this line the two silently disagree
                and the payslip follows the components, not the number that was
                agreed with the employee. */}
            {Number(form.ctc_annual) > 0 && (
              <p className={`note ${Math.abs(drift) > 1 ? 'note--warn' : 'note--info'}`}>
                Components total <b>{FMT(monthlyTotal)}</b>/month against a CTC of{' '}
                <b>{FMT(ctcMonthly)}</b>/month.{' '}
                {Math.abs(drift) <= 1
                  ? 'These agree.'
                  : `They differ by ${FMT(Math.abs(drift))} — payroll pays the components, not the CTC.`}
              </p>
            )}
          </Section>

          <div className="vt-toggles">
            {[['Provident fund', 'pf_enabled'], ['State insurance', 'esi_enabled'], ['Professional tax', 'pt_applicable']].map(([label, key]) => (
              <label key={key} className="vt-toggle">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
            <label className="vt-toggle">
              TDS regime
              <select
                value={form.tds_regime}
                onChange={e => setForm(f => ({ ...f, tds_regime: e.target.value }))}
                className="k-formpanel__input vt-toggle__sel"
              >
                <option value="new">New</option>
                <option value="old">Old</option>
              </select>
            </label>
          </div>

          <StatutorySwitches
            form={form}
            onChange={patch => setForm(f => ({ ...f, ...patch }))}
          />

          <div className="k-formpanel__actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save structure'}
            </button>
          </div>
        </form>
      )}

      {dropped.length > 0 && (
        <p className="note note--danger vt-dropped" role="status">
          <b>The structure was saved, but {dropped.length} statutory{' '}
          {dropped.length === 1 ? 'answer was' : 'answers were'} not stored.</b>{' '}
          The server accepted the request and returned the row without{' '}
          {dropped.join('; ').toLowerCase()}. Payroll will treat{' '}
          {dropped.length === 1 ? 'that switch' : 'those switches'} at{' '}
          {dropped.length === 1 ? 'its' : 'their'} default until the API accepts{' '}
          {dropped.length === 1 ? 'it' : 'them'}. Nothing here can fix that from the
          browser — it is a defect to raise, not a setting to retry.
        </p>
      )}

      {list.loading ? <Shim count={4} />
        : list.error ? <ErrorNote what="Salary structures" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="💰"
              title="No salary structures"
              sub={canWrite
                ? 'A payroll run prices salary structures. Until an employee has one, they are skipped by every run.'
                : `A payroll run prices salary structures, and an employee without one is skipped by every run. ${denial}`}
              cta={canWrite ? '+ New structure' : undefined}
              onCta={canWrite ? openForm : undefined}
            />
          ) : (
            <div className="vt-list">
              {list.items.map(s => (
                <ModCard key={s.id} onClick={() => setDetailId(s.id)}>
                  <div>
                    <strong className="vt-row__t">{s.employee_name}</strong>
                    <span className="vt-code">{s.employee_code}</span>
                    <p className="vt-row__s">Effective {s.effective_from}</p>
                  </div>
                  <div className="vt-row__fig">
                    <span className="vt-row__num">{FMT(s.ctc_annual)}/yr</span>
                    <p className="vt-row__sub">{FMT(Number(s.ctc_annual || 0) / 12)}/mo</p>
                  </div>
                </ModCard>
              ))}
            </div>
          )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The five statutory switches
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Five checkboxes, each with the sentence that says what LEAVING IT UNTICKED
 * means.
 *
 * Unticked is a real answer here. Four of the five default to off and that is
 * a decision — commission and bonus do not attract PF or ESI — chosen because
 * it preserves what payroll did before commission existed, not because it is
 * neutral. A row of bare labels would leave a person guessing which way "off"
 * pointed, on a question that changes what is deducted from somebody's pay.
 *
 * Nothing here blocks anything. Migration 190: "There is no NOT NULL, no CHECK
 * requiring an answer and no validation anywhere that refuses to compute
 * payroll because a firm has not ticked something."
 */
function StatutorySwitches({ form, onChange, title = 'Commission, bonus and the statutory bases' }) {
  return (
    <Section title={title} hi="वैधानिक आधार">
      <p className="note vt-sw__note">
        These decide <b>what the deduction is calculated on</b>, never how much it is. The
        rates and ceilings are law and are not editable anywhere in this product — provident
        fund at 12% capped at ₹1,800, state insurance at 0.75% and 3.25% below the ₹21,000
        ceiling. Each payslip stores which way these stood when it was computed, so changing
        one in March cannot quietly restate January.
      </p>
      <ul className="vt-sw">
        {STAT_SWITCHES.map(([key, label, whenOff]) => (
          <li key={key} className="vt-sw__i">
            <label className="vt-sw__l">
              <input
                type="checkbox"
                checked={!!form[key]}
                onChange={e => onChange({ [key]: e.target.checked })}
              />
              <span>{label}</span>
            </label>
            <p className="vt-sw__off">{whenOff}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One structure
   ══════════════════════════════════════════════════════════════════════════ */

function StructureDetail({ id, onBack }) {
  const { pushToast } = useToast();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [dropped, setDropped] = useState([]);

  React.useEffect(() => { load(); }, [id]);

  async function load() {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/vetana/salary-structures/${id}`);
      setState({ loading: false, error: '', data: r.data });
      setEditing(false);
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
  }

  function startEdit() {
    const s = state.data;
    setForm({
      ctc_annual: Number(s.ctc_annual || 0),
      ...Object.fromEntries(COMPONENTS.map(([, k]) => [k, Number(s[k] || 0)])),
      pf_enabled: !!s.pf_enabled,
      esi_enabled: !!s.esi_enabled,
      // Prefilled from the STORED row, and from its own default only where the
      // column is NULL — "nobody answered" is read the way the column itself
      // reads it, which is what routers/vetana.py's flag helper does too. An
      // edit form must not silently flip an answer somebody already gave.
      ...Object.fromEntries(STAT_SWITCHES.map(([k, , , def]) => [
        k, s[k] === null || s[k] === undefined ? def : !!s[k],
      ])),
    });
    setEditing(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.patch(`/v1/vetana/salary-structures/${id}`, form);
      const missed = unrecordedSwitches(form, r?.data);
      setDropped(missed);
      pushToast({
        title: missed.length
          ? 'Saved — but the statutory answers were not stored'
          : 'Salary structure updated',
        type: missed.length ? 'error' : 'success',
      });
      load();
    } catch (err) {
      pushToast({ title: errText(err, 'The structure could not be updated.'), type: 'error' });
    } finally { setSaving(false); }
  }

  if (state.loading) return <Shim count={5} />;
  if (state.error) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to list" />
        <ErrorNote what="This salary structure" error={state.error} onRetry={load} />
      </div>
    );
  }

  const s = state.data;
  const monthly = Number(s.ctc_annual || 0) / 12;
  const total = COMPONENTS.reduce((sum, [, k]) => sum + Number(s[k] || 0), 0);

  return (
    <div>
      <BackButton onClick={onBack} label="Back to list" />
      <div className="k-detail">
        <div className="k-detail__header">
          <div>
            <h3 className="k-detail__title">{s.employee_name}</h3>
            <p className="k-detail__sub">
              Effective {s.effective_from} · {FMT(s.ctc_annual)}/yr ({FMT(monthly)}/mo)
            </p>
          </div>
          {!editing && (
            <button type="button" className="k-btn k-btn--ghost" onClick={startEdit}>Edit</button>
          )}
        </div>

        {editing ? (
          <form onSubmit={save} className="k-formpanel vt-editform">
            <div className="k-formpanel__grid k-formpanel__grid--3">
              <label className="k-formpanel__label">Annual CTC (₹)
                <input
                  type="number"
                  min="0"
                  value={form.ctc_annual}
                  onChange={e => setForm(f => ({ ...f, ctc_annual: Number(e.target.value) }))}
                  className="k-formpanel__input"
                />
              </label>
            </div>
            <Section title="Monthly breakdown" hi="मासिक विवरण">
              <div className="k-formpanel__grid k-formpanel__grid--3">
                {COMPONENTS.map(([label, key]) => (
                  <label key={key} className="k-formpanel__label">{label}
                    <input
                      type="number"
                      min="0"
                      value={form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                      className="k-formpanel__input"
                    />
                  </label>
                ))}
              </div>
            </Section>
            <div className="vt-toggles">
              {[['Provident fund', 'pf_enabled'], ['State insurance', 'esi_enabled']].map(([label, key]) => (
                <label key={key} className="vt-toggle">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <StatutorySwitches
              form={form}
              onChange={patch => setForm(f => ({ ...f, ...patch }))}
            />
            <div className="k-formpanel__actions">
              <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <Section title="Monthly earnings" hi="मासिक आय">
              <DataTable columns={['Component', { label: 'Amount', align: 'right' }]}>
                {COMPONENTS.map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <Td align="right" mono>{FMT(s[key])}</Td>
                  </tr>
                ))}
                <tr className="vt-tot">
                  <td>Total monthly</td>
                  <Td align="right" mono bold>{FMT(total)}</Td>
                </tr>
              </DataTable>
              {Math.abs(total - monthly) > 1 && (
                <p className="note note--warn">
                  The components total <b>{FMT(total)}</b> but the recorded CTC is{' '}
                  <b>{FMT(monthly)}</b> a month. Payroll pays the components.
                </p>
              )}
            </Section>

            <Section title="Statutory configuration" hi="वैधानिक">
              <div className="vt-flags">
                {[['Provident fund', s.pf_enabled], ['State insurance', s.esi_enabled], ['Professional tax', s.pt_applicable]].map(([label, on]) => (
                  <span key={label} className={`vt-flag${on ? ' vt-flag--on' : ''}`}>
                    <i className="vt-flag__d" />
                    {label}: {on ? 'deducted' : 'not deducted'}
                  </span>
                ))}
                <span className="vt-flag">
                  TDS regime: <strong>{s.tds_regime === 'new' ? 'New' : 'Old'}</strong>
                </span>
              </div>

              {/* The five, read back from the stored row. Each says which way
                  it is set IN WORDS, and a column that was never answered says
                  that rather than borrowing the appearance of a decision. */}
              <ul className="vt-sw vt-sw--read">
                {STAT_SWITCHES.map(([key, label, whenOff, def]) => {
                  const unanswered = s[key] === null || s[key] === undefined;
                  const on = unanswered ? def : !!s[key];
                  return (
                    <li key={key} className="vt-sw__i">
                      <span className={`vt-flag${on ? ' vt-flag--on' : ''}`}>
                        <i className="vt-flag__d" />
                        {label}: <strong>{on ? 'yes' : 'no'}</strong>
                      </span>
                      <p className="vt-sw__off">
                        {on
                          ? 'Included, and every payslip records that it was.'
                          : whenOff}
                        {unanswered && ' Nobody has answered this one, so it is read at the '
                          + 'column’s own default — nothing is blocked by it.'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
