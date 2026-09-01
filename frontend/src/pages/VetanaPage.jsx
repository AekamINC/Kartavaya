// Vetana · वेतन — payroll route shell.
//
// This file was 857 lines and carried 87 inline styles with all six tabs inside
// it. Per 13-module-pages.md a module page is split into a route file plus a
// directory of tab components BEFORE any styling is applied: a restyle of a
// single-file module touches every tab, every table and every form at once, and
// the diff is unreviewable. Graha, Ganit and Manav were split and then styled;
// Vetana was not, which is why it still looked like the pre-design build.
//
// ── Figures first ────────────────────────────────────────────────────────────
//
// The rendered reference (`design-reference/Kartavaya Redesign/ScreensMore.jsx`,
// `ScreenVetana`) puts four figures ABOVE the tab strip — gross, deductions, net
// payable and the next compliance deadline — and only then the tabs. The build
// opened on a bare tab row, so the first thing a payroll module showed you was
// a set of section names rather than what this month costs and what is owed to
// whom.
//
// The fourth tile is the one that makes this a payroll header rather than a
// generic KPI row: a filing deadline is the figure on this page that has a date
// attached to it, and missing it has a penalty. It is derived in
// `vetana/statutoryCalendar.js` from the wage month by named statutory rule.
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import { moduleMeta } from '../lib/moduleColors';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { inrShort } from '../lib/inr';
import { errText, monthName, shortDate } from './vetana/_shared';
import { complianceCalendar, nextFiling } from './vetana/statutoryCalendar';

import DashboardTab from './vetana/DashboardTab';
import StructuresTab from './vetana/StructuresTab';
import PayrollTab from './vetana/PayrollTab';
import PayslipsTab from './vetana/PayslipsTab';
import LoansTab from './vetana/LoansTab';
import StatutoryTab from './vetana/StatutoryTab';

const TABS = [
  ['dashboard', DashboardTab], ['structures', StructuresTab], ['payroll', PayrollTab],
  ['payslips', PayslipsTab], ['loans', LoansTab], ['statutory', StatutoryTab],
  ['analytics', () => <ModuleAnalyticsTab module="vetana" />],
];

export default function VetanaPage() {
  // Tab prefs (proposal 67) still decide where the module opens when the URL is
  // silent, but the URL is now the source of truth for which tab is open — so a
  // link, a reload or a new browser tab lands on the tab you were looking at.
  const prefs = useTabPrefs('vetana', TABS.map(([id]) => id), { fallback: 'dashboard' });
  // Precedence is URL, then the starred default. There is no third source —
  // 'setTab' writes the URL, so every existing caller keeps working and there
  // is exactly one answer to "which tab is open".
  const [params, setParams] = useSearchParams();
  const urlTab = params.get('tab');
  const tab = TABS.some((([id]) => id === urlTab)) ? urlTab : prefs.defaultTab;
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
  // Bumped by "Run payroll" in the header. The Payroll tab watches it and opens
  // its month picker, so the header button lands somewhere useful instead of
  // merely switching tabs and leaving the person to find the control again.
  const [runNonce, setRunNonce] = useState(0);
  const meta = moduleMeta('vetana');
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // `key` is destructured out rather than spread: React 19 warns that a key
  // arriving through a spread is not seen as a key, and the remount is the whole
  // mechanism — without it the panel's entrance animation never restarts.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');

  useEffect(() => { loadSummary(); }, []);

  async function loadSummary() {
    setKpiErr('');
    let dash;
    try {
      dash = (await api.get('/v1/vetana/dashboard')).data;
    } catch (e) {
      setKpi(null);
      setKpiErr(errText(e));
      return;
    }

    const run = dash.latest_run;
    // No run yet is NOT a failure, and must not read as one. The strip says so
    // in words rather than showing four zeroes, which would claim this month
    // costs nothing.
    if (!run) {
      setKpi([
        { label: 'Headcount', hi: 'कर्मचारी', value: dash.headcount ?? '—', sub: 'active employees' },
        { label: 'Gross', hi: 'सकल', value: '—', sub: 'no payroll run yet' },
        { label: 'Net payable', hi: 'देय', value: '—', sub: 'process a month to see this' },
        { label: 'Compliance due', hi: 'अनुपालन', value: '—', sub: 'nothing filed yet' },
      ]);
      return;
    }

    const gross = Number(run.total_gross || 0);
    const deductions = Number(run.total_deductions || 0);
    const net = Number(run.total_net || 0);
    const count = run.employee_count || 0;

    // The compliance tile needs the month's statutory totals. It is a SECOND
    // request and is allowed to fail on its own — the three money figures above
    // it are already known and must not be blanked because a fourth call broke.
    let filing = null;
    let filingErr = false;
    try {
      const st = (await api.get(`/v1/vetana/statutory-summary?month=${encodeURIComponent(run.month)}`)).data;
      filing = nextFiling(complianceCalendar(run.month, st.totals || {}));
    } catch {
      filingErr = true;
    }

    setKpi([
      {
        label: 'Gross', hi: 'सकल', tone: 'p', value: inrShort(gross),
        sub: `${monthName(run.month)} · ${count} ${count === 1 ? 'employee' : 'employees'}`,
      },
      {
        label: 'Deductions', hi: 'कटौती', value: inrShort(deductions),
        sub: 'PF · ESI · PT · TDS',
      },
      {
        label: 'Net payable', hi: 'देय', tone: 'ok', value: inrShort(net),
        sub: run.status === 'disbursed' ? 'disbursed' : `run is ${run.status}`,
      },
      filingErr ? {
        label: 'Compliance due', hi: 'अनुपालन', value: '—',
        sub: 'statutory totals did not load',
      } : filing ? {
        label: 'Compliance due', hi: 'अनुपालन',
        tone: filing.status === 'overdue' ? 'danger' : 'warn',
        value: shortDate(filing.due),
        sub: `${filing.form} · ${filing.status === 'overdue' ? 'overdue' : `in ${filing.daysLeft}d`}`,
      } : {
        label: 'Compliance due', hi: 'अनुपालन', value: 'None',
        sub: 'nothing deducted this month',
      },
    ]);
  }

  return (
    <div className="vt-page">
      <ModuleHeader
        module="vetana"
        kick="section.people"
        en={meta.en}
        hi="vetana"
        sub="Every run reads attendance from Manav — no re-entry, no second system."
        icon={ICONS.vetana}
        actions={
          <button
            type="button"
            className="k-btn k-btn--primary vt-hdr__go"
            onClick={() => { setTab('payroll'); setRunNonce(n => n + 1); }}
          >
            Run payroll
          </button>
        }
      />

      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <ModuleTabs
        tabs={prefs.order.map(id => ({ id }))}
        value={tab}
        onChange={setTab}
        label="Vetana sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab first — a new "opens here" must not yank the panel.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={prefs.order.map(id => ({ id }))} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

      <div
        key={panelKey}
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...motion}
      >
        {tab === 'payroll'
          ? <PayrollTab runNonce={runNonce} onChanged={loadSummary} />
          : <Active onChanged={loadSummary} />}
      </div>
    </div>
  );
}
