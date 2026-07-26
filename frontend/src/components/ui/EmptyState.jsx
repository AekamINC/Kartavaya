import React from 'react';

/**
 * Named glyphs for `icon`. The previous implementation rendered a string icon as
 * TEXT at 40px, which meant `icon="check"` printed the word "check" and
 * `icon="📋"` printed an emoji — and 07 §175 is explicit that the design system
 * has no emoji. These are the small set the attendance surfaces need.
 */
const GLYPHS = {
  check: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity=".45" />
      <path d="M12 7.5V12l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  generic: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
      <path d="M7.5 10h9M7.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
    </svg>
  ),
};

const ILLUSTRATIONS = {
  tasks: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <rect x="20" y="15" width="80" height="12" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="20" y="35" width="80" height="12" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="20" y="55" width="80" height="12" rx="6" fill="currentColor" opacity="0.04" />
      <circle cx="60" cy="50" r="28" stroke="currentColor" strokeWidth="1.5" opacity="0.12" strokeDasharray="4 3" />
      <path d="M50 50l6 6 14-14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
    </svg>
  ),
  projects: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <rect x="10" y="20" width="30" height="60" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="45" y="20" width="30" height="60" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="80" y="20" width="30" height="60" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="15" y="28" width="20" height="4" rx="2" fill="currentColor" opacity="0.12" />
      <rect x="50" y="28" width="20" height="4" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="85" y="28" width="20" height="4" rx="2" fill="currentColor" opacity="0.12" />
    </svg>
  ),
  search: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <circle cx="52" cy="44" r="22" stroke="currentColor" strokeWidth="2" opacity="0.12" />
      <path d="M68 60l16 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.15" />
      <path d="M44 38h16M44 50h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.1" />
    </svg>
  ),
  teams: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <circle cx="46" cy="38" r="14" stroke="currentColor" strokeWidth="2" opacity="0.14" />
      <circle cx="78" cy="38" r="10" stroke="currentColor" strokeWidth="2" opacity="0.1" />
      <path d="M24 78c0-14 10-22 22-22s22 8 22 22" stroke="currentColor" strokeWidth="2" opacity="0.12" />
      <path d="M68 78c0-10 6-16 16-16s16 6 16 16" stroke="currentColor" strokeWidth="2" opacity="0.08" />
    </svg>
  ),
  contacts: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <circle cx="60" cy="34" r="16" stroke="currentColor" strokeWidth="2" opacity="0.14" />
      <path d="M28 82c0-18 14-28 32-28s32 10 32 28" stroke="currentColor" strokeWidth="2" opacity="0.12" />
      <circle cx="60" cy="34" r="4" fill="currentColor" opacity="0.14" />
    </svg>
  ),
  invoice: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <rect x="35" y="12" width="50" height="76" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.12" />
      <path d="M45 30h30M45 42h30M45 54h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.12" />
      <circle cx="60" cy="70" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.14" strokeDasharray="3 3" />
    </svg>
  ),
  success: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <circle cx="60" cy="46" r="26" stroke="currentColor" strokeWidth="1.5" opacity="0.14" />
      <path d="M48 46l8 8 16-16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.22" />
    </svg>
  ),
  generic: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <circle cx="60" cy="45" r="25" stroke="currentColor" strokeWidth="1.5" opacity="0.1" strokeDasharray="4 3" />
      <path d="M52 45l5 5 11-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
      <rect x="35" y="78" width="50" height="4" rx="2" fill="currentColor" opacity="0.06" />
    </svg>
  ),
};

/**
 * EmptyState — icon/illustration + one-line "why it's empty" + single prominent CTA.
 *
 * Props:
 *  - illustration: key into ILLUSTRATIONS, or a custom SVG/node
 *  - icon: emoji or small SVG shown above the title instead of/alongside illustration
 *  - title: bilingual-friendly string, or { en, hi } / { en, gu }
 *  - description: one-sentence explanation of why it's empty
 *  - action: button label string (renders a styled CTA) — or pass a custom node directly
 *  - onAction: callback fired when the CTA is clicked (used when `action` is a string)
 *  - className: extra classes for the wrapper
 */
/**
 * Ported off Tailwind, as 07-pahchan.md §175 requires: "ui/EmptyState.jsx has
 * eight real SVG illustrations, bilingual {en, hi} titles and a proper CTA — but
 * is still on Tailwind classes (text-textDefault, cn) from the old system. Use
 * EmptyState, and port it off Tailwind; the design system has no emoji."
 *
 * The `tone` prop is new. A FINISHED queue is not an empty one — 07 §179 wants
 * the "nothing needs a look" state to read as an achievement with --ok and a
 * check, where "nobody has clocked in yet" is neutral and not an error at all.
 * Without a tone both render identically and the distinction is lost.
 */
export function EmptyState({
  illustration = 'generic', icon, title, description, action, onAction, className, tone,
}) {
  let titleEn = title, titleSecondary = null;
  if (title && typeof title === 'object') {
    titleEn = title.en;
    titleSecondary = title.hi || title.gu || null;
  }

  const accent = tone === 'ok' ? 'var(--ok)' : 'var(--on-surface-faint)';

  return (
    // `cn()` (clsx + twMerge) is gone from this file: it exists to reconcile
    // conflicting Tailwind utilities, and there are none left here. 02 §5 keeps
    // it in lib/utils until the last unconverted file goes.
    <div className={`empty ${className || ''}`.trim()} style={{ maxWidth: 400 }}>
      <div className="empty__art" style={{ color: accent }}>
        {icon
          ? (typeof icon === 'string' ? GLYPHS[icon] || GLYPHS.generic : icon)
          : (typeof illustration === 'string' ? ILLUSTRATIONS[illustration] || ILLUSTRATIONS.generic : illustration)}
      </div>
      {titleEn && (
        <h3 className="empty__title">
          {titleEn}
          {titleSecondary && <span className="empty__title-hi">{titleSecondary}</span>}
        </h3>
      )}
      {description && <p className="empty__body">{description}</p>}
      {action && (
        <div className="empty__act">
          {typeof action === 'string'
            ? <button type="button" className="btn btn--fill" onClick={onAction}>{action}</button>
            : action}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
