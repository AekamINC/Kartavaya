/**
 * KeyboardShortcuts.jsx — the `?` overlay.
 *
 * It shares `.k-cmdk-overlay` and `.k-cmdk__section` with the palette, so it
 * moves with it: `styles/palette.css` now paints both, on `00-tokens.md` values
 * instead of the retired `--ink` / `--rule-soft` set, and both carry
 * `data-k-palette` so those rules outrank the legacy block in `editorial.css`.
 *
 * Three fixes beyond the repaint, all from `23-accessibility.md` via `20`:
 *
 * - It had no `role`, no `aria-modal` and no focus trap. Tab walked straight
 *   out of it into the page behind, and a screen reader was never told a dialog
 *   had opened.
 * - The close button had no accessible name — it was a bare `×` glyph.
 * - `⌨️` in the heading. The design system has no emoji
 *   (`02-common-components.md`), and an emoji in a heading is read aloud by
 *   name: "keyboard emoji, Keyboard Shortcuts".
 *
 * The list itself is documentation of what `AppShell.jsx` binds. It is NOT the
 * binding — if a row here and the handler there disagree, the handler wins and
 * this file is the bug. Keep them in step by hand; a registry that could
 * enforce it would have to own the key handling too, which is a bigger change
 * than this file.
 */
import React from 'react';
import { FocusTrap } from './ui';
import { useExitAnimation } from '../hooks/useExitAnimation';
import { Secondary } from './Bilingual';

const CLOSE = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const SHORTCUTS = [
  { section: 'Navigation', items: [
    { keys: ['⌘', 'K'], combo: true, label: 'Command palette', hi: 'कमांड पैलेट' },
    { keys: ['G', 'D'], label: 'Go to Dashboard', hi: 'डैशबोर्ड' },
    { keys: ['G', 'T'], label: 'Go to Tasks', hi: 'कार्य' },
    { keys: ['G', 'C'], label: 'Go to CRM', hi: 'ग्राहक' },
    { keys: ['G', 'I'], label: 'Go to Invoicing', hi: 'गणित' },
    { keys: ['G', 'H'], label: 'Go to HRMS', hi: 'मानव' },
  ] },
  { section: 'Actions', items: [
    { keys: ['N'], label: 'New task', hi: 'नया कार्य' },
    { keys: ['I'], label: 'New invoice', hi: 'नया चालान' },
    { keys: ['C'], label: 'New contact', hi: 'नया संपर्क' },
    { keys: ['?'], label: 'Show shortcuts', hi: 'शॉर्टकट दिखाएं' },
    { keys: ['Esc'], label: 'Close dialog', hi: 'बंद करें' },
  ] },
];

export default function KeyboardShortcuts({ open, onClose }) {
  // It shares the palette's chrome, and it shared the palette's defect: an
  // entrance and a hard `if (!open) return null` where the exit should be. The
  // hook must be called before any early return — the unmount is what it is
  // deferring. See hooks/useExitAnimation.js.
  const exit = useExitAnimation(open);
  if (!exit.alive) return null;

  return (
    <div
      className={`k-cmdk-overlay ${exit.closing ? 'is-closing' : ''}`.trim()}
      data-k-palette=""
      aria-hidden={exit.closing || undefined}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <FocusTrap active={open}>
      <div
        className={`k-shortcuts ${exit.closing ? 'is-closing' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="k-shortcuts-title"
        onAnimationEnd={exit.onAnimationEnd}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
      >
        <div className="k-shortcuts__header">
          <h2 className="k-shortcuts__title" id="k-shortcuts-title">
            Keyboard Shortcuts
            <Secondary className="k-shortcuts__hi" value="कीबोर्ड शॉर्टकट" />
          </h2>
          <button type="button" className="k-iconbtn" onClick={onClose} aria-label="Close">{CLOSE}</button>
        </div>

        <div className="k-shortcuts__body">
          {SHORTCUTS.map((group) => (
            <div key={group.section}>
              <div className="k-cmdk__section">{group.section}</div>
              {group.items.map((s) => (
                <div key={s.label} className="k-shortcuts__row">
                  <div className="k-shortcuts__keys">
                    {s.keys.map((k, i) => (
                      <React.Fragment key={k}>
                        {/* ⌘K is one chord; G then D is a sequence. Printing
                            "then" between ⌘ and K said the palette needed two
                            presses. */}
                        {i > 0 && !s.combo && <span className="k-shortcuts__then">then</span>}
                        <kbd className="k-kbd">{k}</kbd>
                      </React.Fragment>
                    ))}
                  </div>
                  <span className="k-shortcuts__label">{s.label}</span>
                  <Secondary className="k-shortcuts__hi" value={s.hi} />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="k-shortcuts__footer">
          Press <kbd className="k-kbd">?</kbd> anytime to toggle this overlay
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
