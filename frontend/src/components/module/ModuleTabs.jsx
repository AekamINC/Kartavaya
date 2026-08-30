import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { TAB_HI, tabEn } from './tabLabels';
import { Secondary } from '../Bilingual';

/**
 * ModuleTabs — the shared module tab bar (13-module-pages.md §1).
 *
 * `tabs` is [{ id, label, count? }] or a bare string id.
 *
 * ── Why there is a More menu ────────────────────────────────────────────────
 *
 * Because the design has one. `design-reference/Kartavaya Redesign/Data.jsx`'s
 * `TabBar` opens with the comment "Keeps every tab. First `max` inline, the rest
 * in a More popover", and every module screen in the runnable mockups renders
 * through it.
 *
 * The build did not. It put all of them in an `overflow-x: auto` strip with
 * `scrollbar-width: none`, so on CRM — SEVENTEEN tabs, the same seventeen the
 * reference declares — you saw the first handful and the rest were reachable
 * only by horizontally scrolling a bar with no scrollbar. Present in the DOM,
 * absent from the product. The two edge gradients in `module.css` are the only
 * hint they exist, and a fade is not an affordance.
 *
 * Nine module pages render this component, which is why it looked like a
 * different bug on each of them.
 *
 * ── Two behaviours that are easy to miss and load-bearing ───────────────────
 *
 * The active tab is never hidden. If it falls in the tail it is swapped into the
 * last inline slot, so choosing `dedupe` from the menu leaves it visible rather
 * than collapsing it back behind "More" the instant it becomes current.
 *
 * The count in `More +N` and the popover's `All tabs · N` are the point: the
 * strip has to say how much it is not showing. That is the whole difference
 * between an overflow menu and hidden content.
 */
/*
 * `max` is 8, not 6.
 *
 * At 6, four of the nine module pages pushed leaves into the overflow menu that
 * comfortably fit on the strip: Dristi hid `Dashboards` and `Pivot` behind
 * "More +2" on a 1600px viewport with room to spare, and Prachar did the same
 * with two of its eight. A tab behind a menu is materially less discoverable
 * than one on the strip — that is the whole reason this component exists — so
 * hiding a leaf that fits is the same defect in miniature.
 *
 * 8 covers every module except Graha (17), which genuinely needs the menu and
 * is the case the component was written for. Ganit at 10 now shows 8 inline
 * with 2 in the tail rather than 6 and 4.
 *
 * This is a display cap, not a layout guarantee: the strip is still
 * `overflow-x: auto`, so a narrow viewport scrolls as before. The cap exists to
 * bound how many tabs compete for the row, not to promise they all fit.
 */
/*
 * `onCustomize` / `defaultTab` — proposal 67 · demo 2.
 *
 * With `onCustomize` set the More trigger renders even when NOTHING is in the
 * tail: it is no longer only the overflow door, it is also the door to
 * "Customise tabs…", and a door that exists only sometimes cannot be learned.
 * The label stays a plain "More" then — `+0` would claim something is hidden,
 * and the count's whole job is to be true.
 *
 * `defaultTab` marks the tab the module opens on with a small star (title
 * "Opens here", with the same words for a screen reader) — on its strip
 * button AND on its popover row, because the default can live in the More
 * tail and a mark that vanishes there would read as "no default any more".
 * Display only: which tab OPENS is the pages' business, decided through
 * useTabPrefs.
 */
export default function ModuleTabs({
  tabs, value, onChange, label = 'Sections', max = 8, onCustomize, defaultTab,
}) {
  const [openMore, setOpenMore] = useState(false);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  // The More trigger is the popover's home: every keyboard exit from the menu
  // lands back on it, and it is also what the customise sheet's focus trap
  // captures as its return target — the menuitem that opens the sheet
  // unmounts with the popover, so it cannot be the thing focus returns to.
  const moreRef = useRef(null);
  const popRef = useRef(null);

  const norm = tabs.map(t => (typeof t === 'string'
    ? { id: t, label: tabEn(t) }
    : { ...t, label: t.label ?? tabEn(t.id) }));

  /**
   * How many tabs actually FIT, measured — not a constant.
   *
   * `max` was 8 regardless of width, so the strip rendered eight whether there
   * was room or not. Measured on staging at 1340px on Graha: eight rendered,
   * SIX fully visible, two clipped mid-word, with "More +9" sitting beside
   * them. The strip scrolls so nothing was unreachable — it just looked broken.
   *
   * Width alone would not have caught it either: this row also carries module
   * alerts ("2 deals have no next step · Fix", 203px), so the space available to
   * the strip is not the space available to the row. Measuring the strip's own
   * client width is the only figure that accounts for whatever shares it.
   *
   * `max` survives as the ceiling — beyond eight the strip stops being a strip
   * and becomes a wall of similar words, which is what the overflow menu is
   * for. This only ever reduces.
   *
   * Re-measures on resize, which is also what makes it correct through a device
   * ROTATION: the same tablet turning landscape to portrait loses ~360px of
   * strip, and the count has to follow without a reload.
   */
  // ── The sliding indicator ────────────────────────────────────────────────
  // The CSS half is `.mt__ind` in module.css; animations.css §9d explains why
  // the entrance stays an animation while the travel is a transition.
  const indRef = useRef(null);
  const [fits, setFits] = useState(max);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const kids = [...el.children].filter(c => c.getAttribute('role') === 'tab');
      if (!kids.length) return;
      // Leave room for the More trigger; it is a sibling of the list, so its
      // width is not inside `clientWidth`. 96px is its rendered width plus the
      // row gap, and erring generous costs one tab rather than a clipped one.
      const room = el.clientWidth - 96;

      // Estimated from the AVERAGE rendered tab, not by summing the ones on
      // screen. Summing only ever sees the tabs currently in `head`, so the
      // count could shrink and never grow back — a tablet rotated to portrait
      // and back would keep the narrower count for ever. An average survives
      // that, because it stays roughly constant however many are rendered.
      //
      // Labels differ in length, so this is off by at most a tab. That is the
      // right way to be wrong here: one tab too few is tidy, one too many is
      // the clipped word this replaces.
      const avg = kids.reduce((s, k) => s + k.getBoundingClientRect().width, 0) / kids.length;
      if (!avg) return;
      setFits(Math.max(1, Math.min(max, Math.floor(room / avg))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, norm.length]);

  const shown = Math.min(max, fits);
  let head = norm.slice(0, shown);
  let tail = norm.slice(shown);
  if (tail.some(t => t.id === value)) {
    const active = norm.find(t => t.id === value);
    head = [...norm.slice(0, shown - 1), active];
    tail = norm.filter(t => !head.some(h => h.id === t.id));
  }

  // Close on outside click and on Escape. Escape matters more than it looks:
  // the trigger sits inside a tablist, so a keyboard user who opens the menu has
  // no other way back to the strip — which is also why Escape RETURNS focus to
  // the trigger: the menuitem that held it is about to unmount, and without a
  // handoff focus falls to <body>. An outside click keeps its own focus.
  useEffect(() => {
    if (!openMore) return undefined;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpenMore(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpenMore(false);
      moreRef.current?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMore]);

  // role="menu" is a keyboard CONTRACT, not a label: focus enters the first
  // item when the menu opens, arrows walk it (wrapping), Home/End jump. The
  // items are tabIndex -1 — the trigger is the strip's one tab stop, and the
  // menu is traversed, never tabbed through.
  useEffect(() => {
    if (openMore) popRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [openMore]);

  const onMenuKey = (e) => {
    const items = [...(popRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    if (!items.length) return;
    const i = Math.max(0, items.indexOf(document.activeElement));
    let next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    if (e.key === 'Home') next = items[0];
    if (e.key === 'End') next = items[items.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const onKeyDown = (e) => {
    const i = head.findIndex(t => t.id === value);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = head[(i + 1) % head.length];
    if (e.key === 'ArrowLeft') next = head[(i - 1 + head.length) % head.length];
    if (e.key === 'Home') next = head[0];
    if (e.key === 'End') next = head[head.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
  };

  const Tab = ({ t }) => {
    const on = t.id === value;
    return (
      <button
        role="tab"
        id={`mt-tab-${t.id}`}
        aria-selected={on}
        aria-controls={`mt-panel-${t.id}`}
        tabIndex={on ? 0 : -1}
        className={`mt__b${on ? ' on' : ''}`}
        onClick={() => onChange(t.id)}
      >
        <span className="mt__en">{t.label}</span>
        {TAB_HI[t.id] && <Secondary className="mt__hi" value={TAB_HI[t.id]} />}
        {t.count != null && <span className="mt__n">{t.count}</span>}
        {t.id === defaultTab && (
          <span className="mt__star" title="Opens here">
            <span aria-hidden="true">★</span>
            <span className="k-sr-only">Opens here</span>
          </span>
        )}
      </button>
    );
  };

  // useLayoutEffect, not useEffect: this runs after the DOM is updated but
  // BEFORE the browser paints, so the bar is never seen at its previous tab —
  // or, on the first render, at x=0 — for a frame.
  useLayoutEffect(() => {
    const list = listRef.current;
    const ind = indRef.current;
    if (!list || !ind) return undefined;

    const place = () => {
      // Scoped to the tablist on purpose. The overflow "More" button also takes
      // `.on` (when its menu is open) and would otherwise capture the bar, but
      // it lives in `.mt__ovf`, outside this element.
      const active = list.querySelector('.mt__b.on');
      if (!active) { ind.style.setProperty('--ind-o', '0'); return; }
      // offsetLeft/offsetWidth, not getBoundingClientRect: `.mt[role=tablist]`
      // is the offsetParent (module.css gives it `position: relative`), so
      // these are already in the indicator's own coordinate space and need no
      // correction for the list's border, padding or page scroll.
      ind.style.setProperty('--ind-x', `${active.offsetLeft + 12}px`);
      // The 12px inset each side is what the old per-button underline used
      // (`left: 12px; right: 12px`), so the bar keeps its exact former width.
      ind.style.setProperty('--ind-w', `${Math.max(0, active.offsetWidth - 24)}px`);
      ind.style.setProperty('--ind-o', '1');
    };

    place();
    // Tab widths move after first paint for reasons no dependency array can
    // see: a webfont swapping in, the container resizing, a count arriving.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
    // `fits` is in here because the overflow split changes which tabs are in
    // `head`, which moves every tab after the split point.
  }, [value, fits, head.length]);

  return (
    <div className="mt__wrap" ref={wrapRef}>
      <div className="mt" role="tablist" aria-label={label} onKeyDown={onKeyDown} ref={listRef}>
        {head.map(t => <Tab key={t.id} t={t} />)}
        {/* One indicator for the whole strip, so it can travel. Rendered last
            so it paints over nothing; it is `pointer-events: none` and out of
            flow, and it carries no text, so it is invisible to the tablist's
            accessibility tree rather than being an untabbable extra child. */}
        <span className="mt__ind" ref={indRef} aria-hidden="true" />
      </div>

      {(tail.length > 0 || onCustomize) && (
        <div className="mt__ovf">
          <button
            type="button"
            ref={moreRef}
            className={`mt__b mt__more${openMore ? ' on' : ''}`}
            aria-expanded={openMore}
            aria-haspopup="menu"
            onClick={() => setOpenMore(o => !o)}
          >
            <span className="mt__en">More</span>
            {/* NOT a second-script run — `+3` has no script. It borrowed
                `.mt__hi` for its muted type, which made it indistinguishable
                from a label leak to anything reading the markup.
                Absent entirely at zero: `+0` would claim hidden content. */}
            {tail.length > 0 && <span className="mt__n">+{tail.length}</span>}
          </button>

          {openMore && (
            <div className="mt__pop" role="menu" ref={popRef} onKeyDown={onMenuKey}>
              {/* Counts what is IN the menu, not what exists.
                  This read `All tabs · {norm.length}` and listed only `tail`,
                  so Ganit's menu was headed "ALL TABS · 10" above two rows and
                  Graha's "ALL TABS · 17" above nine. A heading that promises ten
                  and shows two reads as a broken menu, and the reader's next
                  move is to hunt for the missing eight — which are on screen
                  behind them.

                  The total is still worth saying, so it is said as context
                  rather than as the count of the list. */}
              <div className="mt__pop-head">
                {tail.length > 0
                  ? `${tail.length} more · ${norm.length} tabs in all`
                  : `${norm.length} tabs in all`}
              </div>
              {tail.map(t => (
                <button
                  key={t.id}
                  role="menuitem"
                  tabIndex={-1}
                  className="mt__pop-row"
                  onClick={() => { onChange(t.id); setOpenMore(false); moreRef.current?.focus(); }}
                >
                  <span className="mt__pop-en">{t.label}</span>
                  {/* The star follows the default wherever it renders. A
                      default sitting in the tail loses its strip button, so
                      without this the mark simply vanishes. */}
                  {t.id === defaultTab && (
                    <span className="mt__star" title="Opens here">
                      <span aria-hidden="true">★</span>
                      <span className="k-sr-only">Opens here</span>
                    </span>
                  )}
                  {TAB_HI[t.id] && <Secondary className="mt__pop-hi" value={TAB_HI[t.id]} />}
                </button>
              ))}
              {/* Below a divider, never mixed into the tabs: everything above
                  this line NAVIGATES, this row CONFIGURES, and a menu that
                  interleaves the two kinds is how a tab gets mis-clicked into
                  a dialog. Plain text, not `.mt__pop-en` — its
                  `text-transform: capitalize` would title-case every word. */}
              {onCustomize && (
                <>
                  <div className="mt__pop-cut" role="separator" />
                  {/* Focus moves to the trigger BEFORE onCustomize opens the
                      sheet: this menuitem unmounts with the popover, so it is
                      the trigger the sheet's focus trap must capture — and
                      later restore to — or closing the sheet strands keyboard
                      focus on <body>. */}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="mt__pop-row mt__pop-row--cust"
                    onClick={() => { setOpenMore(false); moreRef.current?.focus(); onCustomize(); }}
                  >
                    Customise tabs…
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
