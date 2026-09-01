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
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api, rows } from '../lib/api';

// THE SAME COMPONENTS Graha renders, imported rather than copied.
//
// A client is the company you bill; a contact is the person you send the bill
// to. Finance had no door to either — `graha_clients` is THE company record for
// the whole product, and it was reachable only through the CRM, so a firm that
// bought Ganit and not Graha could raise an invoice and never see, or add, the
// customer it was raised against.
//
// Imported, never forked: one component is what makes "kept in sync with CRM"
// true by construction instead of by remembering. Where the tab has to behave
// differently here it takes a PROP — `crm={false}` hides the controls that call
// a CRM-only route (see `graha/ContactsTab.jsx`).
import ClientsTab from './graha/ClientsTab';
import ContactsTab from './graha/ContactsTab';

import InvoicesTab from './ganit/InvoicesTab';
import ProductsTab from './catalogue/ProductsTab';
import ExpensesTab from './ganit/ExpensesTab';
import PayablesTab from './ganit/PayablesTab';
import ContractsTab from './ganit/ContractsTab';
import ESignTab from './ganit/ESignTab';
import RecurringTab from './ganit/RecurringTab';
import BankTab from './ganit/BankTab';
import TimesheetTab from './ganit/TimesheetTab';
import StatsTab from './ganit/StatsTab';
import CollectionsTab from './ganit/CollectionsTab';
// Procurement moved to its own module page (KrayPage, proposal 85).
// The universal analytics surface (proposal 62 D4). It lives in dristi/
// because it stands on that module's window and chart vocabulary, but the
// metrics are Ganit's own — this tab is one of its two doors.
import AnalyticsTab from './dristi/AnalyticsTab';
import BillingProfilesTab from './ganit/BillingProfilesTab';
import ServiceLinesTab from './ganit/ServiceLinesTab';
import MeteredUsageTab from './ganit/MeteredUsageTab';
import RateCardsTab from './ganit/RateCardsTab';
import SLACreditsTab from './ganit/SLACreditsTab';
import AgeingTab from './ganit/AgeingTab';
import TabDocNumbers from './org/TabDocNumbers';

const TABS = [
  ['invoices', InvoicesTab],
  // Directly after invoices, because they are what an invoice is addressed to.
  // `crm={false}`: this firm may hold no CRM at all, and the CRM-only controls
  // inside the contact record would 403 if it does not.
  ['clients', ClientsTab], ['contacts', () => <ContactsTab crm={false} />],
  ['products', ProductsTab], ['expenses', ExpensesTab],
  ['payables', PayablesTab], ['contracts', ContractsTab], ['e-sign', ESignTab],
  // Beside invoices, not at the end: it is the same money seen from the other
  // side — what is owed and whether the customer has looked at the link.
  ['collections', CollectionsTab],
  ['billing-profiles', BillingProfilesTab], ['service-lines', ServiceLinesTab], ['metered-usage', MeteredUsageTab],
  ['rate-cards', RateCardsTab], ['sla-credits', SLACreditsTab], ['ageing', AgeingTab],
  ['recurring', RecurringTab], ['bank', BankTab], ['timesheet', TimesheetTab],
  ['stats', StatsTab],
  // DSO, collection rate, ageing — the /v1/analytics registry, read here the
  // way every Ganit tab is reached: behind the module's own page.
  ['analytics', AnalyticsTab],
  ['settings', TabDocNumbers],
];

const lakh = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

export default function GanitPage() {
  // Tab prefs (proposal 67): order and the opening tab are the user's own.
  const prefs = useTabPrefs('ganit', TABS.map(([id]) => id), { fallback: 'invoices' });
  // ── The open tab lives in the URL ──────────────────────────────────────
  //
  // The comment here used to say this page read its tab "from nowhere deeper
  // than local state — no URL param". That is no longer true: `?tab=<id>` is
  // the source of truth, so a tab can be linked, opened in a new browser tab,
  // and survives a refresh. An unknown `?tab=` falls through to the default.
  //
  // Precedence is URL, then the starred default. There is no third source —
  // `setTab` writes the URL, so every existing caller (the header's + Invoice
  // included) keeps working and there is exactly one answer to "which tab is
  // open". `replace: true` keeps five tab clicks out of the back button.
  const [params, setParams] = useSearchParams();
  const urlTab = params.get('tab');
  const tab = TABS.some(([id]) => id === urlTab) ? urlTab : prefs.defaultTab;
  const setTab = useCallback((next) => {
    setParams((prev) => {
      // Mutating the existing params rather than replacing them: this page
      // carries others, and a fresh URLSearchParams would silently drop them.
      const p = new URLSearchParams(prev);
      p.set('tab', next);
      return p;
    }, { replace: true });
  }, [setParams]);

  const [customize, setCustomize] = useState(false);
  const [newInvoiceNonce, setNewInvoiceNonce] = useState(0);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `VikrayPage.jsx:47`.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

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
  const tabs = prefs.order.map(id => ({
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

      <ModuleTabs
        tabs={tabs} value={tab} onChange={setTab} label="Finance sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab before the sheet can change the default under it:
        // saving a new "opens here" must not yank the panel mid-read.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={tabs} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

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
