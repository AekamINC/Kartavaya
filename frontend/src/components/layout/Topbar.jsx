/**
 * Topbar.jsx — breadcrumb, palette trigger, actions. 01-navigation.md §1.
 *
 * The search control opens AppShell's palette via onOpenCmdk. It used to
 * render a SECOND CommandPalette of its own, with its own command list — and
 * since both that component and AppShell bind Cmd/Ctrl+K on window, pressing
 * the shortcut opened two stacked palettes with two different command sets.
 * The onOpenCmdk prop was already being passed in and simply ignored.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { resolveRouteMeta } from './navConfig';
import { ICONS } from './navIcons';
import { NotificationsModal } from '../NotificationsModal';
import { useCustomize } from '../CustomizePanel';
import OrgSwitcher from './OrgSwitcher';

// PAGE_META removed — the breadcrumb now derives from navConfig.js.
// It had 21 entries against far more live routes, so /sanvaad, /graha,
// /ganit, /manav, /vikray, /vetana, /dristi, /prachar, /settings/customize,
// /admin/orgs and /admin/costs all fell through and rendered the app name.
// It also disagreed with the sidebar on two labels (see navConfig.js).

export default function Topbar({ unread = 0, notifOpen = false, onNotifOpenChange, onNewTask, onOpenCmdk, onOpenShortcuts }) {
  const location = useLocation();
  const meta = resolveRouteMeta(location.pathname);

  /**
   * The ORGANISATION is the first breadcrumb segment, and it is now a CONTROL.
   *
   * `Chrome.jsx:347` renders `<OrgSwitcher>` as the first child of
   * `.bar__crumb`, before the `/`. This bar rendered the name as a plain
   * `.crumb__org` span, on the grounds that "a second, unguarded way in does
   * not belong in a breadcrumb" — which was right about the PROTOTYPE'S chip,
   * one control flipping between "Aekam Inc" and "Aekam platform" and therefore
   * able to show the state of neither.
   *
   * 01 §"Organisation switcher" splits that conflation and supersedes the
   * objection: the console is one row inside a menu, below a rule, still gated
   * on `navContext().canOpenAdmin` — the same predicate `Protected` uses. And
   * the switching itself had nowhere to live but a `<select>` in the sidebar
   * footer, which answered "whose data am I in?" in the one place nobody looks
   * while raising an invoice. `OrgSwitcher` owns the segment now, and renders
   * the bare name when there is nothing to choose between.
   */

  /**
   * The Indic half is the PAGE's name, not the product's.
   *
   * It was a hardcoded `कर्तव्य`, so every breadcrumb in the app read
   * "कर्तव्य / <page>" — "कर्तव्य / CRM" on Graha, "कर्तव्य / Payroll" on
   * Vetana. `resolveRouteMeta` had been returning `hi` and `gu` for exactly this
   * the whole time and nothing read either field, which is why the earlier fix
   * to `ROUTE_META`'s first-wins ordering (so Organisation stopped resolving to
   * "Billing") could not actually be seen on this surface.
   *
   * `Chrome.jsx:260-261` is the reference: `{m.hi}` then `{m.en}`, the module's
   * own pair, and 01 §1's `.crumb__hi` / `.crumb__sep` / `.crumb__cur` is the
   * three-part structure that renders it.
   *
   * It follows the language preference the same way the sidebar does. That is
   * also what keeps `--font-indic` honest here: the token resolves to Noto Sans
   * Gujarati under an EN+GU preference, which has zero Devanagari coverage, so a
   * span that is Devanagari-whatever-the-setting must not use it. This one is
   * Gujarati under a Gujarati preference, so it may.
   */
  const { prefs } = useCustomize();
  const showGu = prefs.language === 'gu' || prefs.language === 'en+gu';
  const indic  = (showGu && meta.gu) ? meta.gu : meta.hi;

  return (
    <header className="top">
      <div className="crumb">
        {/* The leading `/` belongs to the switcher, not to this bar: only it
            knows whether it rendered anything, and a separator alone at the
            head of the trail is a breadcrumb that begins with a slash. */}
        <OrgSwitcher withSeparator />
        <span className="crumb__hi" lang={(showGu && meta.gu) ? 'gu' : 'hi'}>{indic}</span>
        <span className="crumb__sep" aria-hidden="true">/</span>
        <span className="crumb__cur">{meta.en}</span>
      </div>

      {/* A BUTTON that opens the palette, not an input. It was a readOnly
          <input value="">, which puts a focusable, uneditable text field in the
          tab order for no reason: a keyboard user tabs into something that
          looks like a search box and cannot type in it. */}
      <button
        type="button"
        className="top__search"
        onClick={onOpenCmdk}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>{ICONS.search}</span>
        <span className="top__search-ph">Search tasks, projects, people…</span>
        <kbd className="k-kbd">⌘K</kbd>
      </button>

      <div className="top__right">
        {/* Keyboard shortcuts.

            The sheet and its state have existed in AppShell all along; the ONLY
            way to reach them was pressing `?` with no field focused, which is
            a shortcut for discovering shortcuts. Anyone who did not already
            know could not find out, and on a layout where `?` needs Shift it is
            two keys for a control the mockup gives a button
            (`Chrome.jsx:271`). Hidden ≤767px by `.top` itself, where there is
            no keyboard to shortcut. */}
        {onOpenShortcuts && (
          <button
            type="button"
            className="k-iconbtn"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
            onClick={onOpenShortcuts}
          >
            <kbd className="k-kbd k-kbd--bare" aria-hidden="true">?</kbd>
          </button>
        )}
        {/* The panel is anchored HERE, not rendered as a centred overlay from
            the shell — 21 asks for a popover under the bell. The wrapper is the
            positioning context; without it the panel would hang off the page. */}
        <div className="k-notif-anchor">
          <button
            type="button"
            className="k-iconbtn"
            data-notif-trigger=""
            title="Notifications"
            // The count, not just the word. A dot is invisible to anyone not
            // looking at it, so the badge has to be in the accessible name —
            // 21 · Accessibility.
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notifOpen}
            aria-haspopup="dialog"
            onClick={() => onNotifOpenChange?.(!notifOpen)}
          >
            {ICONS.bell}
            {unread > 0 && <span className="k-iconbtn__dot" />}
          </button>
          <NotificationsModal open={notifOpen} onOpenChange={onNotifOpenChange} />
        </div>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={onNewTask}>
          {ICONS.plus}
          New task
        </button>
      </div>
    </header>
  );
}
