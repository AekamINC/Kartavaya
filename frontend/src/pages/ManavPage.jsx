// Manav · मानव — HRMS route shell.
//
// Was 2,213 lines / 132 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Now on the shared .mh/.mt/.mk chrome from 13-module-pages.md §1.
import React, { useState, useEffect } from 'react';
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

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    try {
      const r = await api.get('/v1/manav/stats');
      setStats(r.data);
    } catch {}
  }

  return (
    <div style={{ padding: '0 0 48px' }}>
      <ModuleHeader
        module="manav"
        en="HRMS"
        hi="मानव"
        sub="Employees, attendance and leave"
        icon={ICONS.manav}
      />

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
