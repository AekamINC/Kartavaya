import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Production-safe logger — strips all output in production builds. */
const isDev = import.meta.env.DEV;
export const logger = {
  log:   (...a) => isDev && console.log(...a),
  warn:  (...a) => isDev && console.warn(...a),
  error: (...a) => isDev && console.error(...a),
  debug: (...a) => isDev && console.debug(...a),
};

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const AVATAR_COLORS = ['#0082c6','#05b7aa','#8b5cf6','#ec4899','#f59e0b','#10b981','#6366f1'];
export const PROJECT_COLORS = ['#ec4899','#6366f1','#0A7A6E','#B06A00','#0082c6','#10b981','#a855f7','#f59e0b','#14b8a6','#d97706'];

/** Single source of truth for priority colours across all views. */
// Token references, not hexes — see lib/statusColors.js. urgent/high alias
// --danger/--warn and so inherit the 00 §7 contrast fix; medium is the shared
// blue that --st-in-progress also uses (priority renders as a 6px dot, status
// as a labelled chip, so they can share a hue). Consumers must build tints with
// color-mix, not string concatenation — "var(--pr-high)22" is not a colour.
export const PRIORITY_COLOR = {
  urgent: 'var(--pr-urgent)',
  high:   'var(--pr-high)',
  medium: 'var(--pr-medium)',
  low:    'var(--pr-low)',
  _default: 'var(--on-surface-3)',
};

/** Lookup helper — returns the colour for a priority string or the default. */
export function priorityColor(priority) {
  return PRIORITY_COLOR[priority] ?? PRIORITY_COLOR._default;
}

export function relTime(ts) {
  if (!ts) return '';
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms)) return '';
  const s = Math.floor(Math.abs(ms) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function userInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * Indian-numbering compact currency format — ₹99,999 below 1 lakh, ₹1L–₹99.9L
 * in lakhs, ₹1Cr+ in crores. Keeps stat tiles from overflowing on 6+ digit
 * amounts while staying in the units Indian users actually think in.
 */
export function formatINR(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const trim = s => s.replace(/\.0$/, '');
  if (abs >= 1_00_00_000) return `${sign}₹${trim((abs / 1_00_00_000).toFixed(1))}Cr`;
  if (abs >= 1_00_000)    return `${sign}₹${trim((abs / 1_00_000).toFixed(1))}L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}
