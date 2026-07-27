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
// ── Four tabs, and it stays four ──────────────────────────────────────────
// The reference's `MODULE_TABS.vikray` lists six — it adds `pipeline` and
// `customers`. `Data.jsx:119` records that those structures were "lifted from
// staging pages", so the reference is mirroring the build's OLD tab bar rather
// than specifying a new one. `cae0e0a` removed both because neither has a
// Vikray endpoint behind it: pipeline and customers are Graha's, the page lede
// says so, and two tabs pointing at another module's data is the scope creep
// 27 §1 names. Four.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { moduleMeta } from '../lib/moduleColors';
import { inrShort } from '../lib/inr';

import DashboardTab from './vikray/DashboardTab';
import OrdersTab from './vikray/OrdersTab';
import StockTab from './vikray/StockTab';
import TargetsTab from './vikray/TargetsTab';

const TABS = ['dashboard', 'orders', 'stock', 'targets'];

export default function VikrayPage() {
  const [tab, setTab] = useState('dashboard');
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
  const { key: panelKey, ...panelMotion } = useTabPanelMotion(TABS, tab);

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
        kick={<>Revenue <span className="mh__kick-hi" lang="hi">· राजस्व</span></>}
        en={meta.en}
        hi={meta.hi}
        sub="Orders, stock and targets. Customers and pipeline live in Graha (CRM)."
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
        tabs={TABS.map(id => ({ id, count: counts[id] }))}
        value={tab}
        onChange={setTab}
        label="Vikray sections"
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
        {tab === 'targets' && <TargetsTab />}
      </div>
    </div>
  );
}
