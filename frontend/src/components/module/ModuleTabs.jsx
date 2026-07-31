import React, { useState, useRef, useEffect } from 'react';
import { TAB_HI, tabEn } from './tabLabels';

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
export default function ModuleTabs({ tabs, value, onChange, label = 'Sections', max = 8 }) {
  const [openMore, setOpenMore] = useState(false);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

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
  // no other way back to the strip.
  useEffect(() => {
    if (!openMore) return undefined;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpenMore(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenMore(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMore]);

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
        {TAB_HI[t.id] && <span className="mt__hi" lang="hi">{TAB_HI[t.id]}</span>}
        {t.count != null && <span className="mt__n">{t.count}</span>}
      </button>
    );
  };

  return (
    <div className="mt__wrap" ref={wrapRef}>
      <div className="mt" role="tablist" aria-label={label} onKeyDown={onKeyDown} ref={listRef}>
        {head.map(t => <Tab key={t.id} t={t} />)}
      </div>

      {tail.length > 0 && (
        <div className="mt__ovf">
          <button
            type="button"
            className={`mt__b mt__more${openMore ? ' on' : ''}`}
            aria-expanded={openMore}
            aria-haspopup="menu"
            onClick={() => setOpenMore(o => !o)}
          >
            <span className="mt__en">More</span>
            <span className="mt__hi">+{tail.length}</span>
          </button>

          {openMore && (
            <div className="mt__pop" role="menu">
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
                {tail.length} more · {norm.length} tabs in all
              </div>
              {tail.map(t => (
                <button
                  key={t.id}
                  role="menuitem"
                  className="mt__pop-row"
                  onClick={() => { onChange(t.id); setOpenMore(false); }}
                >
                  <span className="mt__pop-en">{t.label}</span>
                  {TAB_HI[t.id] && <span className="mt__pop-hi" lang="hi">{TAB_HI[t.id]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
