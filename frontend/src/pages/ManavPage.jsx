// Manav · मानव — HRMS route shell.
//
// Was 2,213 lines / 132 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Visually unchanged in this commit by design.
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { PageHeader, StatTile } from '../components/editorial';

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
      <PageHeader title="Manav · मानव" subtitle="HRMS — Employees, Attendance & Leave Management" />

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 24 }}>
          <StatTile label="Employees" value={stats.total_employees} />
          <StatTile label="Departments" value={stats.departments} />
          <StatTile label="Present Today" value={stats.today_present} />
          <StatTile label="Clocked In" value={stats.clocked_in_count ?? '—'} />
          <StatTile label="On Leave" value={stats.on_leave_today ?? '—'} />
          <StatTile label="Pending Leaves" value={stats.pending_leaves} />
          <StatTile label="Announcements" value={stats.announcements_count ?? '—'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

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
  );
}
