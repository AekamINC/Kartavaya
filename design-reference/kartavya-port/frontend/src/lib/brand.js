/** Brand tokens, logo, wordmark, role badge — shared across all layouts.
 *  Editorial extension: adds Sanskrit helpers, weekday names, and a
 *  KEditorial wordmark variant. Original exports are preserved. */
import React from 'react';

export const K = {
  blue:  '#0082c6',
  mid:   '#03a1b6',
  teal:  '#05b7aa',
  dark:  '#050e1a',
  card:  '#0b1829',
  grad:  'linear-gradient(90deg,#0082c6,#03a1b6,#05b7aa)',
  gradD: 'linear-gradient(135deg,#0082c6,#05b7aa)',
};

export function KLogo({ size = 32 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: K.gradD,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 22 22" fill="none">
        <path d="M4 11L11 4L18 11L11 18L4 11Z" stroke="white" strokeWidth="1.8"/>
        <path d="M7.5 11L11 7.5L14.5 11L11 14.5L7.5 11Z" fill="white" opacity=".85"/>
      </svg>
    </div>
  );
}

export function KWordmark({ dark = false, size = 'md' }) {
  const fs  = size === 'sm' ? 11 : 14;
  const sub = size === 'sm' ? 7  : 8;
  return (
    <div>
      <div style={{ fontSize: fs, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase',
        color: dark ? '#fff' : K.dark }}>Kartavya</div>
      <div style={{ fontSize: sub, letterSpacing: 2.5, textTransform: 'uppercase',
        color: K.teal, fontWeight: 700, marginTop: 1 }}>by Aekam Inc</div>
    </div>
  );
}

/** Editorial wordmark — Newsreader display + Devanagari kicker.
 *  Use this in the editorial Sidebar / AppShell brand block. */
export function KEditorialWordmark({ dark = true }) {
  return (
    <div style={{ lineHeight: 1.1 }}>
      <div style={{ fontFamily: 'Newsreader, Georgia, serif', fontSize: 22, fontWeight: 500,
        color: dark ? '#fff' : K.dark, letterSpacing: 0.005 }}>Kartavya</div>
      <div style={{ fontFamily: '"Tiro Devanagari Hindi", serif', fontSize: 14,
        color: K.teal, marginTop: 1, letterSpacing: 0.01 }}>कर्तव्य</div>
      <div style={{ fontSize: 8.5, letterSpacing: 2.5, textTransform: 'uppercase',
        color: dark ? 'rgba(255,255,255,.4)' : K.mid, fontWeight: 600, marginTop: 4 }}>
        by Aekam Inc
      </div>
    </div>
  );
}

export function RoleBadge({ role }) {
  const cfg = {
    admin:  { bg: '#0082c622', color: '#0082c6', label: 'Admin' },
    member: { bg: '#05b7aa22', color: '#05b7aa', label: 'Member' },
    client: { bg: '#8b5cf622', color: '#8b5cf6', label: 'Client' },
  }[role] || { bg: '#88888822', color: '#888', label: role };
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase',
      background: cfg.bg, color: cfg.color, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

// ── Editorial helpers ─────────────────────────────────────────────────────

/** Hindi weekday names, Monday-first. Use with `new Date().getDay()` after
 *  remapping: Sunday(0) → index 6, others → getDay() - 1. */
export const WEEK_HI = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];
export const WEEK_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Returns the index 0..6 (Mon=0) for a given Date. */
export function mondayIndex(d) {
  const g = d.getDay();        // 0=Sun..6=Sat
  return (g + 6) % 7;          // 0=Mon..6=Sun
}

/** Sanskrit/Devanagari labels for common product nouns. Reuse across pages
 *  so vocabulary stays consistent. */
export const SANS = {
  workspace:  'कार्यक्षेत्र',
  today:      'अद्य',
  tasks:      'कर्तव्य',
  boards:     'फलक',
  projects:   'योजना',
  team:       'सहयोगी',
  inbox:      'सन्देश',
  reports:    'विवरण',
  approvals:  'सम्मति',
  activity:   'क्रिया',
  automations:'स्वचालन',
  templates:  'साँचा',
  categories: 'वर्ग',
  admin:      'प्रशासन',
  // status
  todo:       'कार्य',
  in_progress:'चालू',
  in_review:  'समीक्षा',
  done:       'सम्पन्न',
  // common
  greeting:   'नमस्ते',
  duty:       'कर्तव्य',
};

/** Sanskrit names for the four status columns, keyed by your existing
 *  status string ('todo' / 'in_progress' / 'in_review' / 'done'). */
export const STATUS_SANS = {
  todo:        'कार्य',
  in_progress: 'चालू',
  in_review:   'समीक्षा',
  done:        'सम्पन्न',
};

/** Sanskrit names for the priority levels. */
export const PRIORITY_SANS = {
  low:    'न्यून',
  medium: 'मध्यम',
  high:   'उच्च',
  urgent: 'अत्यावश्यक',
};
