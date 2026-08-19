// Dristi · दृष्टि — analytics route shell.
//
// This file was 603 lines carrying eight tabs, seventy-five inline styles and
// every table, chart and form in the module. Per 13-module-pages.md the module
// pages are split into a route file plus a directory of tab components BEFORE
// any styling is applied: a restyle of a single-file module touches every tab,
// every table and every form at once, and the diff is unreviewable. Graha,
// Ganit and Manav were split and then styled; this one was not, which is why it
// ignored the token system, the density control and the theme.
//
// ── The KPI strip ────────────────────────────────────────────────────────────
// Every other restyled module opens with four figures. This one opened with a
// tab strip and nothing else, so an analytics module — the module whose entire
// job is to put numbers in front of you — showed none until you picked a tab.
// The four here are the cross-module summary `/overview` already computes.
//
// `/overview` withholds per source rather than refusing outright, because
// `dristi` is in STAFF_MODULES while ganit, manav and vetana deliberately are
// not. So the strip renders the figures the caller may actually see and simply
// omits the rest — a 403 on payroll must not take the whole dashboard down.
import React, { useState, useEffect } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { inrShort, grouped } from '../lib/inr';
import { DristiWindowProvider, windowQuery, resolvePreset } from './dristi/_shared';
import WindowBar from './dristi/WindowBar';

import OverviewTab from './dristi/OverviewTab';
import RevenueTab from './dristi/RevenueTab';
import PipelineTab from './dristi/PipelineTab';
import HRTab from './dristi/HRTab';
import SalesTab from './dristi/SalesTab';
import ReportsTab from './dristi/ReportsTab';
import DashboardsTab from './dristi/DashboardsTab';
import PivotTab from './dristi/PivotTab';
import { AnalyticsTabEmbedded } from './dristi/AnalyticsTab';
import ClientReportTab from './dristi/ClientReportTab';

// Order is `MODULE_TABS.dristi` from the reference's Data.jsx, verbatim.
const TABS = [
  ['overview', OverviewTab], ['revenue', RevenueTab], ['pipeline', PipelineTab],
  ['hr', HRTab], ['sales', SalesTab], ['reports', ReportsTab],
  ['dashboards', DashboardsTab], ['pivot', PivotTab],
];

// Every tab id this page can EVER show: the eight static ones plus the two
// the catalogue may add. The ?tab= deep link is validated against this set —
// an id the page has never shipped falls through silently to the normal
// resolution, never to a blank panel.
const DEEP_TAB_IDS = new Set([...TABS.map(([id]) => id), 'analytics', 'clients']);

export default function DristiPage() {
  // Tab prefs (proposal 67). This page reads its tab from local state; the
  // ONE outside voice is ?tab=, read ONCE at mount (the same consumed-once
  // discipline AnalyticsTab applies to ?preset=, and read FIRST — before the
  // surface it names exists). The three orphan-module doors land here as
  // /dristi?tab=analytics&preset=<key>, and an explicit deep link outranks
  // the starred default exactly as ?preset= outranks a saved view. From
  // window.location, not a router hook — this page holds its tab in local
  // state and mounts outside any Route in tests. After that first read,
  // `picked` (a click, or the header's + Add chart) wins as before.
  const [picked, setTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      return t && DEEP_TAB_IDS.has(t) ? t : null;
    } catch { return null; }
  });
  const [customize, setCustomize] = useState(false);

  // Proposal 62's "two doors into one room": the analytics tab renders the
  // SAME component Ganit mounts, and it appears here only when the catalogue
  // lists ganit metrics. The catalogue's withholding IS the entitlement
  // signal — a metric whose module the caller cannot reach is absent from the
  // response, so no ganit metrics means no door, quietly, never an error.
  const [ganitAnalytics, setGanitAnalytics] = useState(false);
  // The client report's endpoint accepts Graha OR Ganit, but the page cannot
  // exist without its picker, and the picker is `/v1/graha/clients` — a
  // Graha door. Gating on graha alone keeps a ganit-only caller from being
  // shown a tab whose only control 403s (the endpoint itself still serves
  // them, for the day a ganit-side picker exists).
  const [clientReport, setClientReport] = useState(false);
  useEffect(() => {
    let on = true;
    api.get('/v1/analytics/catalogue')
      .then((r) => {
        if (!on) return;
        const metrics = r.data?.metrics || [];
        setGanitAnalytics(metrics.some((m) => m.module === 'ganit'));
        setClientReport(metrics.some((m) => m.module === 'graha'));
      })
      .catch(() => { /* no catalogue, no tab — the other eight are unaffected */ });
    return () => { on = false; };
  }, []);
  const tabDefs = [
    ...TABS,
    ...(ganitAnalytics ? [['analytics', AnalyticsTabEmbedded]] : []),
    ...(clientReport ? [['clients', ClientReportTab]] : []),
  ];

  // The base set genuinely CHANGES here — analytics/clients arrive when the
  // catalogue lands — which is the append-at-the-end reconcile rule doing its
  // job: a saved order from before those tabs existed keeps its slots and the
  // newcomers queue behind it.
  const prefs = useTabPrefs('dristi', tabDefs.map(([id]) => id), { fallback: 'overview' });
  const tab = picked ?? prefs.defaultTab;

  const Active = (tabDefs.find(([id]) => id === tab) || tabDefs[0])[1];
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `VikrayPage.jsx:47`.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');

  // One window for the whole module — every tab reads it through context, so
  // moving between Revenue and Pipeline keeps the period rather than resetting
  // it. 'all' sends no parameters, which is what these endpoints did before D1.
  const [win, setWin] = useState(() => resolvePreset('all'));
  const winQs = windowQuery(win);

  useEffect(() => { loadSummary(); }, [winQs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSummary() {
    setKpiErr('');
    try {
      const { data } = await api.get(`/v1/dristi/overview${winQs}`);
      const withheld = new Set(data.withheld || []);
      const deals = data.deals || {};
      const revenue = data.revenue || {};
      const orders = data.orders || {};
      const tasks = data.tasks || {};
      const total = Number(deals.total_deals) || 0;

      // Built by pushing rather than filtering a fixed array, so a withheld
      // source leaves no gap in the strip.
      const items = [];
      if (!withheld.has('deals')) {
        items.push({
          label: 'Open pipeline', hi: 'प्रवाह', tone: 'p',
          value: inrShort(deals.pipeline_value),
          sub: total ? `${grouped(total)} ${total === 1 ? 'deal' : 'deals'}` : 'no deals yet',
        });
      }
      if (!withheld.has('revenue')) {
        items.push({
          label: 'Collected', hi: 'प्राप्त', tone: 'ok',
          value: inrShort(revenue.total_collected), sub: 'against invoices raised',
        });
        items.push({
          label: 'Outstanding', hi: 'बकाया',
          tone: Number(revenue.outstanding) > 0 ? 'warn' : undefined,
          value: inrShort(revenue.outstanding), sub: 'unpaid, not cancelled',
        });
      }
      if (!withheld.has('orders')) {
        items.push({
          label: 'Order value', hi: 'आदेश', value: inrShort(orders.order_value),
          sub: `${grouped(orders.total_orders)} ${Number(orders.total_orders) === 1 ? 'order' : 'orders'}`,
        });
      }
      // Tasks are ungated, and are what keeps the strip from being empty for a
      // caller who holds `dristi` and nothing else.
      if (items.length < 4) {
        items.push({
          label: 'Overdue tasks', hi: 'विलंबित',
          tone: Number(tasks.overdue_tasks) > 0 ? 'danger' : undefined,
          value: grouped(tasks.overdue_tasks),
          sub: Number(tasks.overdue_tasks) ? 'past due, not done' : 'nothing late',
        });
      }
      setKpi(items.slice(0, 4));
    } catch (e) {
      setKpi(null);
      setKpiErr(e.response?.status === 403
        ? 'You do not have access to analytics.'
        : 'Retry, or check your connection.');
    }
  }

  return (
    <div className="dpage">
      <ModuleHeader
        module="dristi"
        kick="section.growth"
        en="Reports"
        hi="dristi"
        sub="Configure the chart where it sits. No jumping to a separate query console."
        icon={ICONS.dristi}
        actions={
          <button
            type="button"
            className="k-btn k-btn--primary k-btn--sm"
            onClick={() => setTab('dashboards')}
          >
            + Add chart
          </button>
        }
      />

      {/* `hr` is the one id whose English label cannot be derived: .mt__en
          capitalizes, so the shared `tabEn` turns it into "Hr". It is an
          initialism. */}
      <ModuleTabs
        tabs={prefs.order.map(id => (id === 'hr' ? { id, label: 'HR' } : { id }))}
        value={tab} onChange={setTab} label="Dristi sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab first — a new "opens here" must not yank the panel.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={prefs.order.map(id => (id === 'hr' ? { id, label: 'HR' } : { id }))}
        defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

      <WindowBar value={win} onChange={setWin} />

      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <div
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        key={panelKey}
        {...motion}
      >
        <DristiWindowProvider value={win}>
          <Active />
        </DristiWindowProvider>
      </div>
    </div>
  );
}
