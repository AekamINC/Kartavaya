/**
 * Topbar.jsx — editorial header: "कर्तव्य / Page" breadcrumb, pill search, command palette.
 */
import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CommandPalette } from '../ui/CommandPalette';

const PAGE_META = {
  '/dashboard':              { en: 'Today',         hi: 'आज' },
  '/boards':                 { en: 'Boards',        hi: 'फ़लक' },
  '/projects':               { en: 'Projects',      hi: 'योजना' },
  '/tasks':                  { en: 'Tasks',         hi: 'कर्तव्य' },
  '/teams':                  { en: 'Teams',         hi: 'सहयोगी' },
  '/inbox':                  { en: 'Inbox',         hi: 'सन्देश' },
  '/activity':               { en: 'Activity',      hi: 'क्रिया' },
  '/automations':            { en: 'Automations',   hi: 'स्वतंत्र' },
  '/time':                   { en: 'Time Report',   hi: 'काल' },
  '/templates':              { en: 'Templates',     hi: 'रचना' },
  '/approvals':              { en: 'Approvals',     hi: 'सम्मति' },
  '/settings/categories':    { en: 'Categories',    hi: 'वर्ग' },
  '/settings/notifications': { en: 'Notifications', hi: 'सूचना' },
  '/admin':                  { en: 'Admin',         hi: 'प्रशासन' },
  '/admin/billing':          { en: 'Admin Billing', hi: 'बिलिंग प्रशासन' },
  '/billing':                { en: 'Billing',       hi: 'बिलिंग' },
  '/hub':                    { en: 'Srijan Admin',  hi: 'सृजन व्यवस्था' },
  '/hub/org':                { en: 'Srijan',        hi: 'सृजन' },
  '/hub/clients':            { en: 'Srijan Clients', hi: 'सृजन ग्राहक' },
  '/client':                 { en: 'Client Portal', hi: 'पोर्टल' },
  '/esign':                  { en: 'E-Sign',        hi: 'प्रमाण' },
};

const COMMANDS = [
  { id: 'new-task',    label: 'New Task',       section: 'Actions',    shortcut: 'N', keywords: ['create', 'add'] },
  { id: 'dashboard',   label: 'Go to Today',    section: 'Navigation', shortcut: 'G D', keywords: ['home', 'dashboard'] },
  { id: 'tasks',       label: 'Go to Tasks',    section: 'Navigation', shortcut: 'G T', keywords: ['list'] },
  { id: 'projects',    label: 'Go to Projects', section: 'Navigation', shortcut: 'G P', keywords: ['boards'] },
  { id: 'boards',      label: 'Go to Boards',   section: 'Navigation', keywords: ['kanban'] },
  { id: 'inbox',       label: 'Go to Inbox',    section: 'Navigation', shortcut: 'G I', keywords: ['messages', 'notifications'] },
  { id: 'approvals',   label: 'Go to Approvals',section: 'Navigation', keywords: ['approve', 'review'] },
  { id: 'activity',    label: 'Go to Activity',  section: 'Navigation', keywords: ['feed', 'log'] },
  { id: 'time',        label: 'Go to Time Report', section: 'Navigation', keywords: ['timer', 'tracking'] },
  { id: 'reports',     label: 'Go to Reports',  section: 'Navigation', keywords: ['analytics'] },
  { id: 'teams',       label: 'Go to Team',     section: 'Navigation', keywords: ['members', 'people'] },
  { id: 'templates',   label: 'Go to Templates',section: 'Navigation', keywords: ['template'] },
  { id: 'automations', label: 'Go to Automations', section: 'Navigation', keywords: ['rules', 'automation'] },
  { id: 'settings',    label: 'Go to Settings', section: 'Navigation', keywords: ['categories', 'preferences'] },
  { id: 'sanvaad',    label: 'Go to Messages', section: 'Navigation', keywords: ['messaging', 'chat', 'sanvaad', 'samvada'] },
];

export default function Topbar({ unread = 0, onOpenNotifications, onNewTask }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [cmdOpen, setCmdOpen] = useState(false);

  const handleCommand = (cmd) => {
    if (cmd.id === 'new-task') { onNewTask?.(); return; }
    const routes = {
      dashboard: '/dashboard', tasks: '/tasks', projects: '/projects', boards: '/boards',
      inbox: '/inbox', approvals: '/approvals', activity: '/activity', time: '/time',
      reports: '/reports', teams: '/teams', templates: '/templates', automations: '/automations',
      settings: '/settings/categories', sanvaad: '/sanvaad',
    };
    if (routes[cmd.id]) navigate(routes[cmd.id]);
  };

  const meta = PAGE_META[location.pathname]
    || Object.entries(PAGE_META).find(([k]) => location.pathname.startsWith(k + '/'))?.[1]
    || { en: 'Kartavaya', hi: 'कर्तव्य' };

  return (
    <header className="k-topbar">
      {/* Left: breadcrumb */}
      <div className="k-topbar__left">
        <div className="k-crumb">
          <span className="k-crumb__hi">कर्तव्य</span>
          <span className="k-crumb__sep">/</span>
          <span className="k-crumb__cur">{meta.en}</span>
        </div>
      </div>

      {/* Center: pill search — click opens command palette */}
      <div className="k-topbar__search" onClick={() => setCmdOpen(true)} style={{ cursor: 'pointer' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <input
          value=""
          onFocus={() => setCmdOpen(true)}
          placeholder="Search tasks, projects, people…"
          readOnly
          style={{ cursor: 'pointer' }}
        />
        <kbd className="k-kbd">⌘K</kbd>
      </div>

      {/* Right: icon buttons + new task */}
      <div className="k-topbar__right">
        <button className="k-iconbtn" title="Notifications" aria-label="Notifications" onClick={onOpenNotifications}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/>
            <path d="M6.5 13.5a1.5 1.5 0 003 0"/>
          </svg>
          {unread > 0 && <span className="k-iconbtn__dot" />}
        </button>
        <button className="k-btn k-btn--primary k-btn--sm" onClick={onNewTask}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10"/>
          </svg>
          New task
        </button>
      </div>
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        commands={COMMANDS}
        onSelect={handleCommand}
      />
    </header>
  );
}
