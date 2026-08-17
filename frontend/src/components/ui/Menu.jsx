import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss } from '../../hooks/useDismiss';

/**
 * Menu — trigger + portal + roving tabindex (02-common-components.md §2).
 *
 * No menu primitive existed, so every overflow menu in the build is a hand-made
 * absolutely-positioned div. Two consequences this fixes:
 *
 *  · **Clipping.** An absolute menu inside a card with `overflow: hidden` or a
 *    scrolling table cell is cut off at the container edge. This one renders
 *    through a portal at `position: fixed`, so it cannot be clipped by an
 *    ancestor, and it sits at z-index 340 on the ladder in 26 §4 rather than at
 *    whatever number the page happened to pick.
 *  · **Keyboard.** Arrow keys move between items, Home/End jump, Escape closes
 *    and returns focus to the trigger. A menu you can open with the keyboard
 *    and not navigate is worse than one you cannot open at all.
 *
 * `items` is `[{ id, label, icon, danger, disabled, onSelect }]`; a falsy entry
 * is skipped and `{ sep: true }` draws a divider, so call sites can build the
 * list with `&&` without filtering.
 *
 * THE EXIT. This menu used to unmount on the spot — `setOpen(false)` and the
 * panel was gone on the next frame — which made it the only overlay on the 340
 * rung with no motion at all, beside a Popover and a Picker that both fade and
 * scale. `.menu--float.is-closing` now carries `dmPopOut` and the unmount waits
 * for `animationend`, exactly as Popover does. Not a timer: the CSS side is
 * `calc(var(--dur-fast) * .85)`, which the user's Animations preference scales
 * and no constant can track — at "None" a hardcoded delay would make somebody
 * who asked for no animation wait for one anyway.
 */
const EXIT_FALLBACK_MS = 400;

export function Menu({ trigger, items = [], align = 'left', label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState(null);
  const [cursor, setCursor] = useState(-1);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const rootRef = useRef(null);
  const timer = useRef(null);
  // A ref beside the state: the `animationend` handler must know whether it is
  // watching the EXIT finish or the ENTRANCE, and a closure over `closing`
  // holds the value from the render that installed it. Without the guard
  // `dmPop` completing on open would unmount the menu the instant it appeared.
  const closingRef = useRef(false);

  const rows = items.filter(i => i && !i.sep && !i.disabled);

  const finish = useCallback(() => {
    clearTimeout(timer.current);
    closingRef.current = false;
    setClosing(false);
    setOpen(false);
    setPos(null);
  }, []);

  const close = useCallback(() => {
    // Re-entrant: useDismiss stays armed while the panel plays its exit, so a
    // second outside click would otherwise restart the animation.
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setCursor(-1);
    clearTimeout(timer.current);
    timer.current = setTimeout(finish, EXIT_FALLBACK_MS);
    // Focus returns to the trigger NOW, not when the exit ends. Without this a
    // keyboard user who closes a row menu loses their place in the list
    // entirely, and deferring it would leave focus inside a panel that is
    // already leaving.
    triggerRef.current?.focus?.();
  }, [finish]);

  // `e.target !== e.currentTarget` filters animations bubbling up from the
  // items — a spinner or a flash inside a row must not read as the panel's exit.
  const onExitEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finish();
  }, [finish]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // `useDismiss` takes ONE ref, and a portalled overlay has two roots: the
  // trigger in the React tree and the panel on document.body. This adapter
  // answers "is the pointer inside either". Without it every click on a menu
  // item reads as an outside click, unmounts the menu on mousedown, and the
  // click never lands — the menu would open and be unusable.
  const bothRef = useRef(null);
  bothRef.current = {
    contains: (n) => !!(rootRef.current?.contains(n) || menuRef.current?.contains(n)),
  };
  useDismiss(open, bothRef, close);

  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    // `anchorTop` is carried so the flip below can place the panel ABOVE the
    // trigger without measuring it a second time — by then the page may have
    // scrolled, and a stale rect would put the menu somewhere else entirely.
    if (r) setPos({ top: r.bottom + 5, anchorTop: r.top, left: align === 'right' ? undefined : r.left, right: align === 'right' ? window.innerWidth - r.right : undefined });
  }, [open, align]);

  /**
   * FLIP. The panel opened downward unconditionally, so the overflow menu on
   * the last row of any long table rendered its items below the fold — at
   * `position: fixed` there is nothing to scroll to reach them, and the rows
   * were simply unreachable by mouse or keyboard.
   *
   * Measured after mount rather than estimated from `items.length`: rows carry
   * optional hints and separators, so the only honest height is the real one.
   * `done` makes it once per opening — recomputing on every render would flip
   * back and forth between two positions that each look correct from the
   * other's vantage point.
   */
  const flipped = useRef(false);
  useLayoutEffect(() => { if (!open) flipped.current = false; }, [open]);
  useLayoutEffect(() => {
    if (!open || !pos || flipped.current) return;
    const el = menuRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const h = el.getBoundingClientRect().height;
    const vh = window.innerHeight || 0;
    if (!h || !vh) return;                       // jsdom, or not laid out yet
    flipped.current = true;
    const overflows = pos.top + h > vh - 8;
    const roomAbove = pos.anchorTop - 8 >= h;
    if (overflows && roomAbove) setPos(p => ({ ...p, top: p.anchorTop - h - 5 }));
  }, [open, pos]);

  useEffect(() => {
    if (!open) return undefined;
    // A menu that stays put while the page scrolls under it is a menu attached
    // to nothing. Closing is the honest response; repositioning on every scroll
    // frame is not worth the jank.
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  /**
   * TWO LISTS THAT DISAGREED. `cursor` counts `rows` — separators and disabled
   * entries filtered out — but this looked the index up in every rendered
   * `[data-menuitem]`, which includes the disabled ones. One disabled entry
   * above the cursor and every arrow press landed one row short; land on the
   * disabled row itself and `focus()` is refused outright, so the keyboard
   * stopped moving with no visible reason. `:not([disabled])` makes the list
   * being indexed the same list the cursor was counting.
   */
  useEffect(() => {
    if (!open || cursor < 0) return;
    menuRef.current?.querySelectorAll('[data-menuitem]:not([disabled])')[cursor]?.focus();
  }, [open, cursor]);

  // Opening cancels a running exit rather than queueing behind it — clicking the
  // trigger twice in quick succession must reopen the menu, not leave it playing
  // `dmPopOut` to completion first.
  const openNow = useCallback((c = -1) => {
    clearTimeout(timer.current);
    closingRef.current = false;
    setClosing(false);
    setOpen(true);
    setCursor(c);
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(rows.length - 1, c + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
    if (e.key === 'Home')      { e.preventDefault(); setCursor(0); }
    if (e.key === 'End')       { e.preventDefault(); setCursor(rows.length - 1); }
  };

  return (
    <span ref={rootRef} className="anchor">
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        // A menu playing its exit is closed as far as anything but the
        // compositor is concerned, so the trigger must not still report itself
        // as expanded to a screen reader for the 119ms it takes to leave.
        aria-expanded={open && !closing}
        aria-label={label}
        onClick={() => (open && !closing ? close() : openNow())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNow(0); }
          if (e.key === 'ArrowDown') { e.preventDefault(); openNow(0); }
        }}
      >
        {trigger}
      </span>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className={`menu menu--float ${align === 'right' ? 'menu--right' : ''} ${closing ? 'is-closing' : ''}`.replace(/\s+/g, ' ').trim()}
          // `anchorTop` is bookkeeping for the flip, not CSS — spreading the
          // whole object would hand React an unknown style property.
          style={{ top: pos.top, left: pos.left, right: pos.right }}
          onKeyDown={onKeyDown}
          onAnimationEnd={onExitEnd}
        >
          {items.filter(Boolean).map((it, i) => it.sep
            ? <div key={`sep-${i}`} className="menu__sep" role="separator" />
            : (
              <button
                key={it.id ?? it.label}
                type="button"
                role="menuitem"
                data-menuitem
                disabled={it.disabled}
                tabIndex={-1}
                className={`menu__item ${it.danger ? 'menu__item--danger' : ''}`.trim()}
                onClick={() => { it.onSelect?.(); close(); }}
              >
                <span className="menu__t">{it.icon}{it.label}</span>
                {it.hint && <span className="menu__d">{it.hint}</span>}
              </button>
            ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

export default Menu;
