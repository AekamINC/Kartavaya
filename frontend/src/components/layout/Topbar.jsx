/**
 * Topbar.jsx — editorial header: "कर्तव्य / Page" breadcrumb, pill search, actions.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';

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

export default function Topbar({ unread = 0, onOpenNotifications, onNewTask, onOpenCmdk }) {
  const location = useLocation();

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

      {/* Center: pill search — opens command palette */}
      <div className="k-topbar__search" onClick={onOpenCmdk} style={{ cursor: 'pointer' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <span style={{ flex: 1, color: 'var(--ink-faint)', fontSize: 13 }}>Search tasks, projects, people…</span>
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
    </header>
  );
}
