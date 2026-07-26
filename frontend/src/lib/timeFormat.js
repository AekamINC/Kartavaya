/**
 * timeFormat.js — global 12h/24h display preference for due dates & reminders.
 * Per-browser (localStorage), does not affect the native datetime-local
 * picker's own popup (that's OS-controlled) — only text we render ourselves.
 */
const STORAGE_KEY = 'kv_time_format';
const DEFAULT_FORMAT = '12h';

export function getTimeFormat() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === '24h' ? '24h' : DEFAULT_FORMAT;
  } catch (_) { return DEFAULT_FORMAT; }
}

export function setTimeFormat(fmt) {
  try { localStorage.setItem(STORAGE_KEY, fmt === '24h' ? '24h' : '12h'); } catch (_) {}
}

/** "5:00 PM" or "17:00" depending on the stored preference. */
export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hour12 = getTimeFormat() === '12h';
  const s = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12 });
  return hour12 ? s.replace(/\b(am|pm)\b/i, m => m.toUpperCase()) : s;
}

/** True if the ISO timestamp carries a real time-of-day (not midnight — legacy date-only tasks). */
export function hasTimeComponent(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

/** "16 Jun, 5:00 PM" — date + time in the stored preference, omitting time if there isn't one. */
export function formatDueDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return hasTimeComponent(iso) ? `${datePart}, ${formatTime(iso)}` : datePart;
}

/** "16 Jun 2026" — a plain calendar date, for invoice due dates and the like. */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * A billing period as "Jul 2026", or "Jul – Sep 2026" when it spans months.
 *
 * Invoice rows printed the raw ISO pair ("2026-07-01 → 2026-07-31"), which is
 * three times the width of the useful information and reads as a database
 * value rather than a statement period.
 */
export function formatPeriod(startIso, endIso) {
  if (!startIso && !endIso) return '—';
  const s = new Date(startIso || endIso);
  const e = new Date(endIso || startIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return [startIso, endIso].filter(Boolean).join(' → ');
  }
  const month = d => d.toLocaleDateString('en-IN', { month: 'short' });
  if (s.getFullYear() === e.getFullYear()) {
    return month(s) === month(e)
      ? `${month(s)} ${s.getFullYear()}`
      : `${month(s)} – ${month(e)} ${s.getFullYear()}`;
  }
  return `${month(s)} ${s.getFullYear()} – ${month(e)} ${e.getFullYear()}`;
}
