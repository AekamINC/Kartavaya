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
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { inrShort, grouped } from '../lib/inr';

import OverviewTab from './dristi/OverviewTab';
import RevenueTab from './dristi/RevenueTab';
import PipelineTab from './dristi/PipelineTab';
import HRTab from './dristi/HRTab';
import SalesTab from './dristi/SalesTab';
import ReportsTab from './dristi/ReportsTab';
import DashboardsTab from './dristi/DashboardsTab';
import PivotTab from './dristi/PivotTab';

// Order is `MODULE_TABS.dristi` from the reference's Data.jsx, verbatim.
const TABS = [
  ['overview', OverviewTab], ['revenue', RevenueTab], ['pipeline', PipelineTab],
  ['hr', HRTab], ['sales', SalesTab], ['reports', ReportsTab],
  ['dashboards', DashboardsTab], ['pivot', PivotTab],
];

export default function DristiPage() {
  const [tab, setTab] = useState('overview');
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  const motion = useTabPanelMotion(TABS.map(([id]) => id), tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');

  useEffect(() => { loadSummary(); }, []);

  async function loadSummary() {
    setKpiErr('');
    try {
      const { data } = await api.get('/v1/dristi/overview');
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
        kick={<>Growth <span className="mh__kick-hi" lang="hi">· वृद्धि</span></>}
        en="Reports"
        hi="दृष्टि"
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
        tabs={TABS.map(([id]) => (id === 'hr' ? { id, label: 'HR' } : { id }))}
        value={tab} onChange={setTab} label="Dristi sections" />

      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <div
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...motion}
      >
        <Active />
      </div>
    </div>
  );
}
