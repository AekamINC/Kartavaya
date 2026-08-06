// Ganit · गणित — Finance route shell.
//
// Was 2,030 lines / 124 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Now on the shared .mh/.mt chrome from 13-module-pages.md §1.
//
// ── "Finance", not "Invoicing" ────────────────────────────────────────────
// Three independent places in the design reference call this module Finance:
// `Chrome.jsx`'s NAV renders the sidebar item **Finance**, `ScreenGanit`'s page
// title is **गणित FINANCE & GST**, and `Landing2.jsx:265` lists it as
// "Ganit · Finance". "Invoicing" was a paraphrase, and a narrower one than the
// module: the tab bar below carries expenses, payables, bank, contracts and
// timesheet, none of which is invoicing.
import React, { useState, useEffect } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api, rows } from '../lib/api';

import InvoicesTab from './ganit/InvoicesTab';
import ProductsTab from './ganit/ProductsTab';
import ExpensesTab from './ganit/ExpensesTab';
import PayablesTab from './ganit/PayablesTab';
import ContractsTab from './ganit/ContractsTab';
import ESignTab from './ganit/ESignTab';
import RecurringTab from './ganit/RecurringTab';
import BankTab from './ganit/BankTab';
import TimesheetTab from './ganit/TimesheetTab';
import StatsTab from './ganit/StatsTab';

const TABS = [
  ['invoices', InvoicesTab], ['products', ProductsTab], ['expenses', ExpensesTab],
  ['payables', PayablesTab], ['contracts', ContractsTab], ['e-sign', ESignTab],
  ['recurring', RecurringTab], ['bank', BankTab], ['timesheet', TimesheetTab],
  ['stats', StatsTab],
];

const lakh = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

export default function GanitPage() {
  const [tab, setTab] = useState('invoices');
  const [newInvoiceNonce, setNewInvoiceNonce] = useState(0);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `VikrayPage.jsx:47`.
  const { key: panelKey, ...motion } = useTabPanelMotion(TABS.map(([id]) => id), tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');
  const [counts, setCounts] = useState({});

  useEffect(() => { loadSummary(); }, []);

  async function loadSummary() {
    setKpiErr('');
    try {
      // Receivables and payables are two different tables and two different
      // routes. Settled with allSettled rather than all: a firm that has raised
      // invoices but entered no vendor bills yet must still see its
      // receivables, and Promise.all would throw the whole strip away.
      const [inv, pay] = await Promise.allSettled([
        api.get('/v1/ganit/stats'),
        api.get('/v1/ganit/payables-summary'),
      ]);
      if (inv.status === 'rejected') throw inv.reason;
      const s = inv.value.data;
      const p = pay.status === 'fulfilled' ? pay.value.data : null;

      setKpi([
        {
          label: 'Receivables', hi: 'प्राप्य', tone: 'warn',
          value: lakh(s.total_outstanding),
          sub: `${s.unpaid_count} unpaid of ${s.total_invoices}`,
        },
        {
          label: 'Overdue', hi: 'विलंब', tone: s.overdue_count > 0 ? 'danger' : undefined,
          value: s.overdue_count,
          // 43B(h) disallows the deduction if an MSME supplier is paid late, so
          // an overdue count is a tax exposure here, not just a chasing list.
          sub: s.overdue_count > 0 ? 'MSME rule 43B(h) applies' : 'nothing past due',
        },
        { label: 'Collected', hi: 'प्राप्त', tone: 'ok', value: lakh(s.total_collected), sub: 'paid invoices' },
        {
          label: 'Payables', hi: 'देय',
          value: p ? lakh(p.outstanding) : '—',
          sub: p ? `${p.open_bills} open ${p.open_bills === 1 ? 'bill' : 'bills'}` : 'vendor bills unavailable',
        },
      ]);
      setCounts(k => ({ ...k, payables: p ? Number(p.open_bills) : undefined }));
    } catch (e) {
      setKpi(null);
      setKpiErr(e.response?.status === 403 ? 'You do not have access to Finance figures.' : 'Retry, or check your connection.');
    }
    try {
      const r = await api.get('/v1/ganit/invoices');
      setCounts(k => ({ ...k, invoices: rows(r).length }));
    } catch { /* the tab simply carries no count */ }
  }

  // The reference's tab id is `stats` (Data.jsx:122) and the panel it names is
  // the GST filing screen, not a figures page. The id stays; the LABEL says
  // what the tab actually opens, because "stats" sends a preparer looking for
  // GSTR-3B everywhere except the tab that holds it.
  const tabs = TABS.map(([id]) => ({
    id, label: id === 'stats' ? 'GST filing' : id.replace(/-/g, ' '), count: counts[id],
  }));

  return (
    <div className="mpage">
      <ModuleHeader
        module="ganit"
        kick="section.revenue"
        en="Finance"
        hi="ganit"
        sub="Invoices, GST, expenses and payables."
        icon={ICONS.ganit}
        actions={
          <button
            type="button"
            className="btn btn--fill btn--sm"
            onClick={() => { setTab('invoices'); setNewInvoiceNonce(n => n + 1); }}
          >
            + Invoice
          </button>
        }
      />

      {/* Figures above the tabs — the order Ganit and Vikray use in the
          reference. Graha is the exception, and only because its tab row
          shares a line with the no-next-step warning. */}
      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <ModuleTabs tabs={tabs} value={tab} onChange={setTab} label="Finance sections" />

      <div
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        key={panelKey}
        {...motion}
      >
        {tab === 'invoices' ? <InvoicesTab newNonce={newInvoiceNonce} /> : <Active />}
      </div>
    </div>
  );
}
