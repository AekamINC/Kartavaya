// Vikray · विक्रय — sales route shell.
//
// This file was 756 lines with 71 inline styles and four tab components
// declared inside it. Per 13-module-pages.md the module pages are split into a
// route file plus a directory of tab components BEFORE any styling is applied:
// a restyle of a single-file module touches every tab, every table and every
// form at once, and the diff is unreviewable. Graha, Ganit and Manav were split
// and then styled; this one was not, which is why it stayed on the legacy
// `--ink-*` / `--k-*` vocabulary while they moved.
//
// ── Six tabs, as the approved design specifies ────────────────────────────
// This file previously shipped four and carried a note arguing the reference's
// six were a stale mirror of an old tab bar. That argument does not survive
// reading the reference:
//
//   · `Data.jsx:125` declares the set — dashboard, orders, stock, pipeline,
//     targets, customers — and the comment above it at `:119` says the
//     structures were lifted from staging "— nothing dropped", which is an
//     instruction to preserve them, not licence to prune.
//   · `TAB_HI` (`Data.jsx:139`) carries Devanagari for both: प्रवाह and ग्राहक.
//     Nobody writes a label for a tab they mean to delete.
//   · `ScreenVikray` (`ScreensBiz.jsx:142`) OPENS this module on `pipeline`.
//
// The substantive claim was that both belong to Graha. Pipeline does not:
// Graha's is a CRM deal board, and the one the reference draws here is
// `FLOW = ['Quote','Sent','Signed','Invoiced','Paid']` over quote documents —
// this module's object. Customers does not either: Graha owns the contact,
// Vikray owns that contact's trading history, and the tab is built by grouping
// this module's own orders rather than by reading the CRM.
//
// Both now have a Vikray endpoint behind them — `GET /v1/vikray/pipeline` and
// `GET /v1/vikray/customers`, added in `backend/routers/vikray.py` — so the
// "no endpoint" half of the old argument is answered rather than argued with.
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { moduleMeta } from '../lib/moduleColors';
import { inrShort } from '../lib/inr';

// THE SAME COMPONENTS Graha renders, imported rather than copied. See the note
// on TABS below for why `customers` stays beside them.
import ClientsTab from './graha/ClientsTab';
import ContactsTab from './graha/ContactsTab';

import DashboardTab from './vikray/DashboardTab';
import OrdersTab from './vikray/OrdersTab';
import StockTab from './vikray/StockTab';
import PipelineTab from './vikray/PipelineTab';
import TargetsTab from './vikray/TargetsTab';
import CustomersTab from './vikray/CustomersTab';

// The reference's order exactly (`Data.jsx:125`), plus the analytics door —
// the owner's rule is analytics on every module — plus clients and contacts.
//
// ── WHY `customers` STAYS, RIGHT NEXT TO THEM ──────────────────────────────
// `vikray/CustomersTab.jsx` is NOT a client list and its own header says so:
// every row is produced by GROUPing `vikray_orders`, so it answers "who has
// bought from us, how much, and when did they last order" — TRADING HISTORY. A
// company that has never placed an order does not appear in it, and cannot: it
// has no orders to group. That is the right answer to its question and the
// wrong one to "who are our customers", which is why the module needed both.
//
// So the three sit together and read left to right: CLIENTS are the companies
// (`graha_clients` — the same record Ganit bills and the CRM keeps), CONTACTS
// are the people at them, and CUSTOMERS is what those companies have actually
// bought. Nothing was replaced.
//
// Nine tabs now, past ModuleTabs' inline max of 8, so the tail moves into the
// More popover — and the order is a preference every user can rearrange
// (`useTabPrefs`), which is what that popover is for.
const TABS = [
  'dashboard', 'orders', 'stock', 'pipeline', 'targets',
  'clients', 'contacts', 'customers', 'analytics',
];

export default function VikrayPage() {
  // OPENS ON PIPELINE, not on dashboard — the header note above already said so
  // at `:22` and the file did the other thing. `ScreenVikray`
  // (`ScreensBiz.jsx:142`) is `React.useState('pipeline')`, and the two sibling
  // modules already follow their own reference screen rather than their first
  // tab: Ganit opens on `invoices` (`GanitPage.jsx:48`) and Graha on `pipeline`
  // (`GrahaPage.jsx:60`), neither of which is first in its TABS array. Vikray
  // was the only one taking the first entry by default.
  //
  // The tab ORDER is untouched — `Data.jsx:125` declares it and the two are
  // separate facts. This is the landing tab, not the sequence.
  //
  // It is also the right tab on its own terms: the four money figures the
  // dashboard exists to show are in `KpiStrip` BELOW the header, above the tab
  // bar, and they render on every tab. Opening on `dashboard` spent the first
  // screen restating numbers the user could already see.
  //
  // Tab prefs (proposal 67): `pipeline` survives as the shipped fallback; a
  // starred default outranks it. This page reads its tab from local state only
  // — no URL param, no route state — so `picked` (a click, the header's + New
  // order, a dashboard drill-in) wins from the first choice.
  const prefs = useTabPrefs('vikray', TABS, { fallback: 'pipeline' });
  // ── The open tab lives in the URL ──────────────────────────────────────
  //
  // It used to be `useState(null)`, and the comment above still described that
  // world: "no URL param, no route state". Two things were wrong with it.
  //
  // A tab nobody can link to cannot be shared, cannot be bookmarked, and does
  // not survive a refresh — every reload dropped the reader back on the starred
  // default, whichever tab they were actually working in.
  //
  // And it broke the record routes added beside this page. ``/vikray/orders/:orderId`` renders
  // as a CHILD of this module so the list stays mounted underneath, which is
  // what makes Back return to the list the reader left. But a COLD arrival —
  // a bookmark, a link from an email — mounted this page with no state at all,
  // so the list underneath was the starred default rather than the one the
  // record belongs to. Back landed them somewhere they had never been.
  //
  // `replace: true` on a tab switch, deliberately: hopping tabs should not fill
  // the history stack, so Back leaves the module rather than walking backwards
  // through every tab visited. Opening a record is a real push and stays one.
  //
  // Precedence is URL, then the starred default. There is no third source —
  // `setTab` writes the URL, so every existing caller keeps working and there
  // is exactly one answer to "which tab is open".
  const [params, setParams] = useSearchParams();
  const urlTab = params.get('tab');
  const tab = TABS.some(((id) => id === urlTab)) ? urlTab : prefs.defaultTab;
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
  const [newOrderNonce, setNewOrderNonce] = useState(0);
  // Order-tab state that survives a tab switch. It lives here rather than in
  // OrdersTab so the Dashboard's status counts and its "needs attention" list
  // can open an order or filter the list — which is the only thing that makes a
  // count worth rendering.
  const [orderStatus, setOrderStatus] = useState('');
  const [openOrderId, setOpenOrderId] = useState(null);

  const meta = moduleMeta('vikray');
  // `useTabPanelMotion` returns `{ key, style }` and every module page spreads
  // the pair straight onto the panel. React 19 refuses a `key` inside a spread
  // and logs an error on every tab switch — the key is silently dropped, which
  // is the whole mechanism: without a changing key the panel is reconciled in
  // place, the enter animation never restarts, and the motion this hook exists
  // to produce does not happen. Destructured here rather than spread.
  const { key: panelKey, ...panelMotion } = useTabPanelMotion(prefs.order, tab);

  // The four money figures sit above the tab bar, where they are true of the
  // module rather than of one tab — a revenue number that disappears when you
  // click "Orders" was never about the dashboard.
  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');
  const [counts, setCounts] = useState({});

  const loadSummary = useCallback(async () => {
    setKpiErr('');
    try {
      const { data: d } = await api.get('/v1/vikray/dashboard');
      const orders = Number(d.total_orders) || 0;
      const open = Number(d.open_deals) || 0;
      setKpi([
        { label: 'Pipeline value', hi: 'प्रवाह', tone: 'p', value: inrShort(d.pipeline_value), sub: `${open} open ${open === 1 ? 'deal' : 'deals'} in CRM` },
        { label: 'Order value', hi: 'आदेश', value: inrShort(d.order_value), sub: `${orders} ${orders === 1 ? 'order' : 'orders'}` },
        { label: 'Revenue', hi: 'राजस्व', tone: 'ok', value: inrShort(d.total_revenue), sub: 'invoiced' },
        { label: 'Collected', hi: 'प्राप्त', tone: 'ok', value: inrShort(d.collected), sub: 'payments received' },
      ]);
      setCounts({ orders: orders || undefined });
    } catch (e) {
      setKpi(null);
      setKpiErr(e.response?.status === 403
        ? 'You do not have access to Sales figures.'
        : 'Retry, or check your connection.');
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const goOrders = useCallback(status => { setOrderStatus(status); setTab('orders'); }, []);
  const openOrder = useCallback(id => { setOpenOrderId(id); if (id) setTab('orders'); }, []);

  return (
    <div className="mpage">
      <ModuleHeader
        module="vikray"
        kick="section.revenue"
        en={meta.en}
        hi="vikray"
        sub="Quote to cash as one flow — every order, what it is waiting on, and who buys."
        icon={ICONS.vikray}
        actions={
          <button
            type="button"
            className="btn btn--fill btn--sm"
            onClick={() => { setTab('orders'); setNewOrderNonce(n => n + 1); }}
          >
            + New order
          </button>
        }
      />

      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <ModuleTabs
        tabs={prefs.order.map(id => ({ id, count: counts[id] }))}
        value={tab}
        onChange={setTab}
        label="Vikray sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab first — a new "opens here" must not yank the panel.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={prefs.order.map(id => ({ id, count: counts[id] }))} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

      <div
        key={panelKey}
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...panelMotion}
      >
        {tab === 'dashboard' && <DashboardTab onOpenOrder={openOrder} onFilter={goOrders} />}
        {tab === 'orders' && (
          <OrdersTab
            newNonce={newOrderNonce}
            status={orderStatus}
            onStatus={setOrderStatus}
            openId={openOrderId}
            onOpen={setOpenOrderId}
          />
        )}
        {tab === 'stock' && <StockTab />}
        {tab === 'pipeline' && <PipelineTab onOpenOrder={openOrder} />}
        {tab === 'targets' && <TargetsTab />}
        {/* `crm={false}`: a firm on Sales alone holds no CRM, and the
            CRM-only controls inside the contact record would 403. */}
        {tab === 'clients' && <ClientsTab />}
        {tab === 'contacts' && <ContactsTab crm={false} />}
        {tab === 'customers' && <CustomersTab onOpenOrder={openOrder} />}
        {tab === 'analytics' && <ModuleAnalyticsTab module="vikray" />}
      </div>
    </div>
  );
}
