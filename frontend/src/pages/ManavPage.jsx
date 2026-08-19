// Manav · मानव — HRMS route shell.
//
// Was 2,213 lines / 132 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Now on the shared .mh/.mt/.mk chrome from 13-module-pages.md §1.
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';

import EmployeesTab from './manav/EmployeesTab';
import AttendanceTab from './manav/AttendanceTab';
import ShiftsTab from './manav/ShiftsTab';
import LeavesTab from './manav/LeavesTab';
import ExpensesTab from './manav/ExpensesTab';
import RecruitmentTab from './manav/RecruitmentTab';
import AnnouncementsTab from './manav/AnnouncementsTab';
import DepartmentsTab from './manav/DepartmentsTab';
import HolidaysTab from './manav/HolidaysTab';
import PerformanceTab from './manav/PerformanceTab';
import AssetsTab from './manav/AssetsTab';
import ExitsTab from './manav/ExitsTab';

const TABS = ['employees', 'attendance', 'shifts', 'leaves', 'expenses', 'recruitment', 'announcements', 'departments', 'holidays', 'performance', 'assets', 'exits', 'analytics'];

export default function ManavPage() {
  // Tab prefs (proposal 67). This page reads its tab from local state only —
  // no URL param, no route state — so the starred default decides where the
  // module opens, and `picked` wins from the first click.
  const prefs = useTabPrefs('manav', TABS, { fallback: 'employees' });
  const [picked, setTab] = useState(null);
  const tab = picked ?? prefs.defaultTab;
  const [customize, setCustomize] = useState(false);
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `GrahaPage.jsx:67`.
  // Without this the panel was a plain <div> that React reused across every tab
  // change: measured `sameNode: true`, `animation-name: none`. Manav was the
  // only one of the three module pages with no panel motion at all.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);
  const [stats, setStats] = useState(null);
  // The headline counts failing is worth saying. `catch {}` left `stats` null
  // and the strip simply did not render — indistinguishable from an org with
  // no data, on the numbers a manager reads first.
  const [statsError, setStatsError] = useState('');

  const loadStats = useCallback(async () => {
    try {
      const r = await api.get('/v1/manav/stats');
      setStats(r.data);
      setStatsError('');
    } catch (err) {
      setStats(null);
      setStatsError(
        err?.response?.status === 403
          ? 'You do not have access to the organisation-wide HR figures.'
          : 'The headline figures did not load.',
      );
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <div className="mn-page">
      <ModuleHeader
        module="manav"
        // `kick` was missing entirely. `ScreenManav` (ScreensMore.jsx:73) opens
        // with kick="People · जन", and it is the band that files this module
        // under its group — Graha and Ganit both carry theirs.
        kick="section.people"
        en="HRMS"
        hi="manav"
        sub="Fix attendance and approve leave from the row where you see the problem."
        icon={ICONS.manav}
      />

      {statsError && (
        <p className="note note--warn mn-err" role="status">
          <b>{statsError}</b> The tabs below are unaffected and load their own data.
          <button type="button" className="k-btn k-btn--ghost mn-err__go" onClick={loadStats}>
            Try again
          </button>
        </p>
      )}

      {/* `hi`, `sub` and `tone` on every tile — the reference's `Stat` carries
          all three (`ScreensMore.jsx`:77-80) and Graha and Ganit already pass
          them. Without them Manav's row was seven untinted, unglossed numbers:
          "CLOCKED IN / 4" says less than "4 of 6". `loading` is passed so the
          first paint is a skeleton rather than nothing — the strip previously
          rendered only on `stats &&`, so a slow request looked like a page with
          no figures in it. */}
      <KpiStrip
        loading={!stats && !statsError}
        count={7}
        items={stats ? [
          { label: 'Employees',      hi: 'कर्मचारी', tone: 'p',  value: stats.total_employees, sub: 'on the register' },
          { label: 'Departments',    hi: 'विभाग',    value: stats.departments },
          { label: 'Present today',  hi: 'उपस्थित',  tone: 'ok', value: stats.today_present, sub: `of ${stats.total_employees}` },
          { label: 'Clocked in',     hi: 'समय',      value: stats.clocked_in_count ?? '—' },
          { label: 'On leave',       hi: 'अवकाश',    tone: 'warn', value: stats.on_leave_today ?? '—' },
          { label: 'Pending leaves', hi: 'सम्मति',   tone: stats.pending_leaves > 0 ? 'danger' : undefined,
            value: stats.pending_leaves, sub: stats.pending_leaves > 0 ? 'awaiting approval' : 'nothing waiting' },
          { label: 'Announcements',  hi: 'सूचना',    value: stats.announcements_count ?? '—' },
        ] : null}
      />

      <ModuleTabs
        tabs={prefs.order.map(id => ({ id, label: id }))}
        value={tab}
        onChange={setTab}
        label="Manav sections"
        defaultTab={prefs.defaultTab}
        // Pin the open tab first — a new "opens here" must not yank the panel.
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={prefs.order.map(id => ({ id, label: id }))} defaultTab={prefs.defaultTab}
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
        {tab === 'employees' && <EmployeesTab onUpdate={loadStats} />}
        {tab === 'attendance' && <AttendanceTab onUpdate={loadStats} />}
        {tab === 'shifts' && <ShiftsTab />}
        {tab === 'leaves' && <LeavesTab onUpdate={loadStats} />}
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'recruitment' && <RecruitmentTab />}
        {tab === 'announcements' && <AnnouncementsTab onUpdate={loadStats} />}
        {tab === 'departments' && <DepartmentsTab onUpdate={loadStats} />}
        {tab === 'holidays' && <HolidaysTab />}
        {tab === 'performance' && <PerformanceTab />}
        {tab === 'assets' && <AssetsTab />}
        {tab === 'exits' && <ExitsTab onUpdate={loadStats} />}
        {tab === 'analytics' && <ModuleAnalyticsTab module="manav" />}
      </div>
    </div>
  );
}
