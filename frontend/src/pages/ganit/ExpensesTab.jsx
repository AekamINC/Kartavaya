// Ganit · expenses — what the business spent, and on what.
//
// ── The three tiles that always read ₹0 ───────────────────────────────────
// This tab rendered `expStats.total_amount`, `expStats.this_month` and
// `expStats.billable_amount`. `GET /v1/ganit/expense-stats` returns none of
// those three names — it answers `{by_category, total_expenses, total_tax,
// count}` (routers/ganit.py:1586). Every one of them resolved to `undefined`,
// hit the `|| 0` fallback, and printed ₹0. Three headline figures on a finance
// screen were permanently zero, and because the fallback made them render
// cleanly there was nothing to notice.
//
// The names below are the ones the endpoint actually returns, and `by_category`
// — real data the panel was discarding — is now shown rather than thrown away.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
// `CreatedHead` is gone: the header comes out of the column declaration below,
// which is what lets it be moved, hidden and resized. The CELLS are unchanged.
// `ByCell` is the one that renders a NAME and never the user id behind it, and
// `UpdatedCell` is `CreatedCell` under a second key — one date format for the
// whole product, so a reader never has to work out whether "16 Jun 2026" and
// "16/06/2026" in adjacent columns mean the same thing.
import {
  CreatedCell, UpdatedCell, ByCell, CREATED_KEY, UPDATED_KEY,
} from '../../components/ui/CreatedColumn';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';
// The same control the invoice form names its customer with. `GET
// /v1/graha/contacts` stops at 200 rows and this product already has an org
// with 292 live contacts, so the list is narrowed by the SERVER as the user
// types — filtering a truncated array in the browser hides people silently.
import ServerPicker from '../../components/ui/ServerPicker';

/**
 * The two tables on this tab, declared once each. Two keys, not one: they are
 * different lists of different things that happen to share a screen, and a
 * single key would make hiding Tax on the summary hide it on the entries too.
 *
 * `fixed` on Category: it is the whole identity of a summary row — the other
 * four cells are numbers that mean nothing without it. There is no actions
 * column here because the summary is a read-only roll-up.
 *
 * And no audit columns either, deliberately: a row here is a GROUP BY over
 * many expenses, not a record. "Created by" on a category total would have to
 * pick one of the twenty people who contributed to it, and any pick is a
 * sentence the screen cannot support. The audit columns belong on the entries
 * table below, where a row is one thing one person did.
 */
const EXPENSE_CATEGORY_COLUMNS = [
  { id: 'category', label: 'Category', fixed: true },
  { id: 'count', label: 'Entries', num: true },
  { id: 'total_amount', label: 'Net', num: true },
  { id: 'total_tax', label: 'Tax', num: true },
  { id: 'total', label: 'Total', num: true },
];

/** `fixed` on Title (which expense a row IS) and Actions (Edit / Delete). */
const EXPENSE_COLUMNS = [
  { id: 'expense_date', label: 'Date', sortKey: 'expense_date' },
  { id: 'title', label: 'Title', sortKey: 'title', fixed: true },
  { id: 'category', label: 'Category', sortKey: 'category' },
  { id: 'vendor_name', label: 'Vendor', sortKey: 'vendor_name' },
  /* Vendor is who we PAID; this is who we paid it FOR. `list_expenses` has
     resolved `contact_id` to `contact_name` since it was written
     (`ganit.py:1604`) and no column ever showed it, so the one fact that makes
     an expense rechargeable was on the wire and off the screen.

     "Client contact" and not "Client": the column behind it is
     `ganit_expenses.contact_id`, which points at `graha_contacts` — a PERSON.
     A CRM client is the COMPANY, and `ganit_expenses` has no `client_id` at
     all, so a heading that said "Client" would promise a company link this
     table cannot make. */
  { id: 'contact_name', label: 'Client contact', sortKey: 'contact_name' },
  { id: 'amount', label: 'Amount', sortKey: 'amount', num: true },
  { id: 'tax_amount', label: 'Tax', sortKey: 'tax_amount', num: true },
  { id: 'total', label: 'Total', sortKey: 'total', num: true },
  { id: 'is_billable', label: 'Billable', sortKey: 'is_billable' },
  { id: CREATED_KEY, label: 'Created', sortKey: CREATED_KEY, className: 'tbl__created' },
  /* WHO raised it, and who touched it last. Four columns rather than two,
     because "Rs 40,000 on 3 Aug" and "Rs 40,000 on 3 Aug, amount changed by
     someone yesterday" are different facts, and an expense book that cannot
     tell them apart is the one thing an auditor will ask this screen for.
     `created_by` / `updated_by` are `users.user_id` and can never be rendered:
     the API resolves each to a NAME, and `has_creator` / `has_updater` are
     what let ByCell say `unknown` for a deleted account rather than an em dash
     that reads as "nobody did this".

     "Raised by" and not "Created by": an expense is RAISED in the language
     this module already uses for an invoice, and a column heading that echoes
     the verb on the form is one less thing to translate while reading.

     Placed before Actions rather than after it, matching Created above — a
     row's verbs are its right-hand edge everywhere else in the product, and a
     column of buttons stranded mid-row reads as a mistake. Anyone who already
     arranged this table gets all four APPENDED and visible regardless
     (`reconcileColumnPrefs`' ships-later rule), so this ordering only decides
     the default. */
  { id: 'created_by_name', label: 'Raised by', sortKey: 'created_by_name', className: 'tbl__by' },
  { id: UPDATED_KEY, label: 'Updated', sortKey: UPDATED_KEY, className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Updated by', sortKey: 'updated_by_name', className: 'tbl__by' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

const BLANK = {
  title: '', category: 'general', amount: '', tax_amount: 0, expense_date: '',
  vendor: '', reference: '', notes: '', is_billable: false,
  /* The key that was missing, and the whole of the defect. `ExpenseCreate`
     has carried `contact_id` since migration 019, the INSERT writes it as
     `NULLIF($13,'')::uuid` and the PATCH has the same branch — and because
     `BLANK` had no such key, the `{ ...form }` spread in `save()` never sent
     one. 0 of 378 expenses carry a contact, 88 of them billable, and the
     reason was one absent line in an object literal.

     `''` and not null: the API takes a string and turns blank into NULL
     itself, so an empty picker sends an empty string on both paths and the
     column is set to NULL rather than left behind. */
  contact_id: '',
};

/**
 * Create and edit are the same nine fields — ONE component, rendered twice
 * (the create form and the inline edit row), which is what stops a field from
 * existing on one and not the other.
 */
function ExpenseFields({ value, onChange, categories, contactItems, onSearchContacts }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="gn-form__grid gn-form__grid--flush">
      <label className="fld">
        <span className="fld__l">Title<span className="fld__req">*</span></span>
        <input className="inp" required value={value.title} onChange={e => set('title', e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld__l">Category</span>
        <select className="inp" value={value.category} onChange={e => set('category', e.target.value)}>
          <option value="general">General</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      </label>
      <label className="fld">
        <span className="fld__l">Date<span className="fld__req">*</span></span>
        <DateInput className="inp" type="date" required value={value.expense_date}
          onChange={e => set('expense_date', e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld__l">Amount (₹)<span className="fld__req">*</span></span>
        <input className="inp" type="number" step="0.01" required value={value.amount}
          onChange={e => set('amount', e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld__l">Tax (₹)</span>
        <input className="inp" type="number" step="0.01" value={value.tax_amount}
          onChange={e => set('tax_amount', e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld__l">Vendor</span>
        <input className="inp" value={value.vendor} onChange={e => set('vendor', e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld__l">Reference</span>
        <input className="inp" value={value.reference} onChange={e => set('reference', e.target.value)} />
      </label>
      {/* Who the money was spent FOR — `ganit_expenses.contact_id`.
          A `<div>`, not a `<label>`: the picker's control is a real `<button>`,
          which is not a labelable element, so `ariaLabel` names it instead.
          `InvoiceForm.jsx:620` carries the same note for the same reason, and
          wrapping it in a label is how the accessible name gets lost.

          It sits BESIDE the billable tick and never behind it. The field is
          most useful when the tick is on, but hiding it until then would
          recreate exactly the bug this exists to fix — a column that can only
          be filled in a state the user has to discover first is a column
          nobody fills. So it is always drawn, always enabled, never required,
          and its hint changes rather than the control. */}
      <div className="fld">
        <span className="fld__l">Client contact</span>
        <ServerPicker
          mode="option" field ariaLabel="Client contact"
          search
          items={contactItems}
          value={value.contact_id}
          placeholder="No client"
          onChange={id => set('contact_id', id || '')}
          onSearch={onSearchContacts}
        />
        {/* Prose, not a rule. The stronger sentence appears when the expense is
            marked billable, because that is when a blank here costs something
            — but it is a consequence, stated, and not a validation. */}
        <span className="fld__hint">
          {value.is_billable
            ? 'Optional — but a billable expense with nobody named cannot be recharged or counted against a client.'
            : 'Optional. Attributes the cost to a client; the company is shown beside each name.'}
        </span>
      </div>
      <label className="gn-chk">
        <input type="checkbox" checked={value.is_billable} onChange={e => set('is_billable', e.target.checked)} />
        <span>Billable to a customer</span>
      </label>
    </div>
  );
}

/**
 * Merge server rows into the local list by id, keeping what is already there.
 *
 * The picker asks the server for `?search=` results, so the array grows a page
 * at a time and the SELECTED row has to survive every one of those answers —
 * otherwise the trigger label goes blank the moment a search returns a page the
 * chosen person is not on. `InvoiceForm` learned this first; the rule is the
 * same here, so the shape is deliberately identical.
 */
function mergeById(prev, next) {
  const seen = new Map(prev.map(r => [String(r.id), r]));
  for (const r of next) seen.set(String(r.id), { ...seen.get(String(r.id)), ...r });
  return [...seen.values()];
}

export default function ExpensesTab() {
  const { pushToast } = useToast();
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record expenses' });
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [categories, setCategories] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [stats, setStats] = useState(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', icon: '📁' });
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ ...BLANK });
  const [editSaving, setEditSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = catFilter ? { category: catFilter } : undefined;
      const r = await api.get('/v1/ganit/expenses', { params });
      setExpenses(rows(r));
    } catch (e) {
      setErr(e);
      setExpenses([]);
    } finally { setLoading(false); }
  }, [catFilter]);

  const loadStats = useCallback(async () => {
    setStatsFailed(false);
    try {
      const r = await api.get('/v1/ganit/expense-stats');
      setStats(body(r));
    } catch { setStats(null); setStatsFailed(true); }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const r = await api.get('/v1/ganit/expense-categories');
      setCategories(rows(r));
    } catch { /* the picker falls back to General, which always exists */ }
  }, []);

  /**
   * The CRM's people, for the client-contact picker.
   *
   * Silent on failure, and deliberately: `/v1/graha/contacts` sits behind the
   * CRM entity gate and answers 403 for an org without Graha. That org still
   * records expenses — the field is optional — so a toast here would be an
   * error message on every load of a tab that is working exactly as intended.
   * The picker simply offers nothing, which is the truth.
   */
  const loadContacts = useCallback(async () => {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(prev => mergeById(prev, rows(r)));
    } catch { /* no CRM, or no permission: the field stays empty and optional */ }
  }, []);

  /** What the picker's search box asks for, debounced by `ServerPicker`. */
  const searchContacts = useCallback(async (q) => {
    try {
      const r = await api.get('/v1/graha/contacts', { params: q ? { search: q } : {} });
      setContacts(prev => mergeById(prev, rows(r)));
    } catch { /* the list simply does not grow; the picker keeps what it has */ }
  }, []);

  /**
   * NAMES on screen, the id only in `value`/`onChange`.
   *
   * `meta` is the COMPANY, which is the point: two people called Sharma at two
   * different customers are one indistinguishable row without it, and picking
   * the wrong one misattributes the cost silently.
   */
  const contactItems = useMemo(() => contacts.map(c => ({
    id: String(c.id),
    name: c.name,
    meta: c.client_name || c.company || c.designation || '',
  })), [contacts]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); loadCategories(); loadContacts(); },
    [loadStats, loadCategories, loadContacts]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const amt = parseFloat(form.amount) || 0;
    const tax = parseFloat(form.tax_amount) || 0;
    try {
      await api.post('/v1/ganit/expenses', { ...form, amount: amt, tax_amount: tax, total: amt + tax });
      pushToast({ title: 'Expense recorded', type: 'success' });
      setShowForm(false);
      setForm({ ...BLANK });
      load();
      loadStats();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not record the expense', type: 'error' });
    } finally { setSaving(false); }
  }

  function startEdit(ex) {
    setEditId(ex.id);
    /* Seed the picker with the row's OWN contact before opening the form.
       The list is a 200-row window and can be empty outright (no CRM, or a
       403), so the person already on this expense may not be in it — and a
       trigger that reads "No client" over an expense that HAS one is not just
       wrong on screen. The PATCH now sends `contact_id` on every save, so a
       blank trigger would CLEAR a real attribution the moment anything else on
       the row was edited. Appended only when absent, so a full row already in
       the list is never overwritten by this thinner one. */
    if (ex.contact_id) {
      setContacts(prev => (prev.some(c => String(c.id) === String(ex.contact_id))
        ? prev
        : [...prev, { id: ex.contact_id, name: ex.contact_name || 'Client contact' }]));
    }
    setEditForm({
      title: ex.title || '', category: ex.category || 'general', amount: ex.amount ?? '',
      tax_amount: ex.tax_amount ?? 0, expense_date: ex.expense_date || '', vendor: ex.vendor || '',
      reference: ex.reference || '', notes: ex.notes || '', is_billable: !!ex.is_billable,
      contact_id: ex.contact_id || '',
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    const amt = parseFloat(editForm.amount) || 0;
    const tax = parseFloat(editForm.tax_amount) || 0;
    try {
      await api.patch(`/v1/ganit/expenses/${editId}`, { ...editForm, amount: amt, tax_amount: tax, total: amt + tax });
      pushToast({ title: 'Expense updated', type: 'success' });
      setEditId(null);
      load();
      loadStats();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not update the expense', type: 'error' });
    } finally { setEditSaving(false); }
  }

  async function remove(ex) {
    try {
      await api.delete(`/v1/ganit/expenses/${ex.id}`);
      setExpenses(prev => prev.filter(x => x.id !== ex.id));
      pushToast({ title: 'Expense deleted', type: 'success' });
      loadStats();
    } catch {
      pushToast({ title: 'Could not delete the expense', type: 'error' });
    }
  }

  async function saveCat(e) {
    e.preventDefault();
    try {
      await api.post('/v1/ganit/expense-categories', catForm);
      pushToast({ title: 'Category created', type: 'success' });
      setShowCatForm(false);
      setCatForm({ name: '', icon: '📁' });
      loadCategories();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not create the category', type: 'error' });
    }
  }

  const byCategory = Array.isArray(stats?.by_category) ? stats.by_category : [];

  const view = useTableView(expenses, {
    // `contact_name` is searchable for the same reason it is a column: "what
    // did we spend on Acme" is the question a recharge starts from.
    searchKeys: ['title', 'vendor_name', 'category', 'contact_name'],
    filters: [{ key: 'category', label: 'Category' }, { key: 'is_billable', label: 'Billable' }],
  });
  // Both hooks run unconditionally, above every branch below — the summary
  // panel only renders when `byCategory` has rows, and a hook inside that
  // condition would change the hook count between renders.
  const catCols = useColumnPrefs('ganit.expenses_by_category', EXPENSE_CATEGORY_COLUMNS);
  const cols = useColumnPrefs('ganit.expenses', EXPENSE_COLUMNS);
  return (
    <div>
      {stats && (
        <div className="gn-stats">
          <StatTile label="Total spend" sanskrit="व्यय" value={inr(Number(stats.total_expenses || 0))} />
          <StatTile label="Tax component" value={inr(Number(stats.total_tax || 0))} />
          <StatTile label="Entries" value={stats.count ?? 0} />
        </div>
      )}
      {statsFailed && (
        <p className="note note--warn" role="status">
          The expense totals could not be loaded. The entries below are unaffected.
        </p>
      )}

      {byCategory.length > 0 && (
        <div className="gn-panel">
          <h3 className="gn-panel__h">By category<Secondary className="dr__lbl-hi" value="श्रेणी" /></h3>
          {/* No TableToolbar on this panel, so the control gets the house
              trailing-aligned unframed row rather than an edge above the
              table, which would read as a second header. */}
          <div className="tbl__abar"><ColumnsButton cols={catCols} /></div>
          <div className="tbl__wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {catCols.columns.map(c => (
                    <HeadCell
                      key={c.id}
                      num={c.num}
                      className={c.className}
                      width={c.width}
                      onResize={w => catCols.setWidth(c.id, w)}
                    >
                      {c.label}
                    </HeadCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCategory.map(c => (
                  <tr key={c.category}>
                    {catCols.cells({
                      category: <td>{c.category}</td>,
                      count: <td className="tbl__num">{c.count}</td>,
                      total_amount: <td className="tbl__num">{inr(Number(c.total_amount || 0))}</td>,
                      total_tax: <td className="tbl__num gn-tbl__mute">{inr(Number(c.total_tax || 0))}</td>,
                      total: <td className="tbl__num">{inr(Number(c.total || 0))}</td>,
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Category</span>
          <select className="inp gn-bar__sel" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
        </label>
        <span className="gn-bar__sp" />
        <button
          type="button" className="btn btn--ghost btn--sm" onClick={() => setShowCatForm(v => !v)}
          disabled={!canWrite} title={denial || undefined}
        >
          {showCatForm ? 'Close' : '+ Category'}
        </button>
        <button
          type="button" className="btn btn--fill btn--sm" onClick={() => setShowForm(v => !v)}
          disabled={!canWrite} title={denial || undefined}
        >
          {showForm ? 'Close form' : '+ Add expense'}
        </button>
      </div>

      {showCatForm && canWrite && (
        <form className="gn-form" onSubmit={saveCat}>
          <h4 className="gn-form__h">New category</h4>
          <div className="gn-form__grid gn-form__grid--flush">
            <label className="fld">
              <span className="fld__l">Name<span className="fld__req">*</span></span>
              <input className="inp" required value={catForm.name}
                onChange={e => setCatForm({ ...catForm, name: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Icon</span>
              <input className="inp" value={catForm.icon}
                onChange={e => setCatForm({ ...catForm, icon: e.target.value })} />
            </label>
          </div>
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowCatForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm">Create</button>
          </div>
        </form>
      )}

      {showForm && canWrite && (
        <form className="gn-form" onSubmit={save}>
          <h3 className="gn-form__t">Record an expense</h3>
          <ExpenseFields
            value={form} onChange={setForm} categories={categories}
            contactItems={contactItems} onSearchContacts={searchContacts}
          />
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading expenses"><SkeletonTable rows={6} columns={7} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : expenses.length === 0 ? (
        catFilter ? (
          <EmptyState
            illustration="search"
            title={{ en: `Nothing under ${catFilter}`, hi: 'कोई व्यय नहीं' }}
            description="No expenses sit in this category. Clear the filter to see every entry."
            action="Show all categories"
            onAction={() => setCatFilter('')}
          />
        ) : (
          <EmptyState
            illustration="generic"
            title={{ en: 'No expenses recorded', hi: 'कोई व्यय नहीं' }}
            description={canWrite
              ? 'Log what the business spends, with the tax component split out, and the input tax credit and billable recharges follow from it.'
              : `Expenses record what the business spends, with the tax component split out for input tax credit. ${denial}`}
            action={canWrite ? '+ Add expense' : undefined}
            onAction={canWrite ? () => setShowForm(true) : undefined}
          />
        )
      ) : (
        <div className="tv-card">
        <TableToolbar view={view} label="expenses">
          <ColumnsButton cols={cols} />
        </TableToolbar>
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                {cols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    sortKey={c.sortKey}
                    sort={view.sort}
                    onSort={c.sortKey ? view.onSort : undefined}
                    num={c.num}
                    className={c.className}
                    width={c.width}
                    onResize={w => cols.setWidth(c.id, w)}
                  >
                    {c.sr ? <span className="sr-only">{c.label}</span> : c.label}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map(ex => (
                <React.Fragment key={ex.id}>
                  <tr>
                    {cols.cells({
                      expense_date: <td className="gn-tbl__mono">{ex.expense_date}</td>,
                      title: <td><button type="button" className="gn-link" onClick={() => startEdit(ex)}>{ex.title}</button></td>,
                      category: <td><Badge text={ex.category} color="var(--st-in-review)" /></td>,
                      vendor_name: <td>{ex.vendor || '—'}</td>,
                      // A NAME. `contact_id` never reaches the screen.
                      contact_name: <td>{ex.contact_name || '—'}</td>,
                      amount: <td className="tbl__num">{inr(Number(ex.amount))}</td>,
                      tax_amount: <td className="tbl__num gn-tbl__mute">{inr(Number(ex.tax_amount || 0))}</td>,
                      total: <td className="tbl__num">{inr(Number(ex.total))}</td>,
                      is_billable: <td>{ex.is_billable ? <Badge text="Yes" color="var(--ok)" /> : '—'}</td>,
                      [CREATED_KEY]: <CreatedCell value={ex.created_at} />,
                      created_by_name: <ByCell name={ex.created_by_name} hasActor={ex.has_creator} />,
                      [UPDATED_KEY]: <UpdatedCell value={ex.updated_at} />,
                      updated_by_name: <ByCell name={ex.updated_by_name} hasActor={ex.has_updater} />,
                      actions: (
                        <td>
                          <span className="gn-tbl__acts">
                            <button type="button" className="gn-act" onClick={() => startEdit(ex)}>Edit</button>
                            <button
                              type="button" className="gn-act gn-act--danger"
                              onClick={() => setConfirm({
                                title: `Delete "${ex.title}"?`,
                                message: 'The expense is removed from the books and from the category totals. This cannot be undone.',
                                confirmLabel: 'Delete',
                                onConfirm: () => remove(ex),
                              })}
                            >
                              Delete
                            </button>
                          </span>
                        </td>
                      ),
                    })}
                  </tr>
                  {editId === ex.id && (
                    <tr>
                      {/* The inline edit form spans what is actually on screen,
                          not a literal 10 that a hidden column would falsify. */}
                      <td colSpan={cols.columns.length}>
                        <form className="gn-form gn-form--accent" onSubmit={saveEdit}>
                          <h4 className="gn-form__h">Edit expense</h4>
                          <ExpenseFields
                            value={editForm} onChange={setEditForm} categories={categories}
                            contactItems={contactItems} onSearchContacts={searchContacts}
                          />
                          <div className="gn-form__acts">
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                            <button type="submit" className="btn btn--fill btn--sm" disabled={editSaving}>
                              {editSaving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
