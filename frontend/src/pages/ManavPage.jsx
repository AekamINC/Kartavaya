// Manav · मानव — HRMS route shell.
//
// Was 2,213 lines / 132 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Now on the shared .mh/.mt/.mk chrome from 13-module-pages.md §1.
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';

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

const TABS = ['employees', 'attendance', 'shifts', 'leaves', 'expenses', 'recruitment', 'announcements', 'departments', 'holidays', 'performance', 'assets'];

export default function ManavPage() {
  const [tab, setTab] = useState('employees');
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
        en="HRMS"
        hi="मानव"
        sub="Employees, attendance and leave"
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

      {stats && (
        <KpiStrip items={[
          { label: 'Employees',     value: stats.total_employees },
          { label: 'Departments',   value: stats.departments },
          { label: 'Present today', value: stats.today_present },
          { label: 'Clocked in',    value: stats.clocked_in_count ?? '—' },
          { label: 'On leave',      value: stats.on_leave_today ?? '—' },
          { label: 'Pending leaves', value: stats.pending_leaves },
          { label: 'Announcements', value: stats.announcements_count ?? '—' },
        ]} />
      )}

      <ModuleTabs
        tabs={TABS.map(id => ({ id, label: id }))}
        value={tab}
        onChange={setTab}
        label="Manav sections"
      />

      <div role="tabpanel" id={`mt-panel-${tab}`} aria-labelledby={`mt-tab-${tab}`}>
        {tab === 'employees' && <EmployeesTab onUpdate={loadStats} />}
        {tab === 'attendance' && <AttendanceTab />}
        {tab === 'shifts' && <ShiftsTab />}
        {tab === 'leaves' && <LeavesTab />}
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'recruitment' && <RecruitmentTab />}
        {tab === 'announcements' && <AnnouncementsTab />}
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'holidays' && <HolidaysTab />}
        {tab === 'performance' && <PerformanceTab />}
        {tab === 'assets' && <AssetsTab />}
      </div>
    </div>
  );
}
