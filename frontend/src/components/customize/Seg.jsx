import React, { useRef } from 'react';

/**
 * Seg — segmented control, token-styled.
 *
 * The version in CustomizePanel.jsx was styled with an inline style object
 * against --bg-soft / --surface-2 / --ink / --ink-3, all of which survive only
 * through the legacy alias block. Same control, moved onto .seg in settings.css
 * so it themes with everything else and can be focused visibly.
 *
 * Roving tabindex (26 §5): the GROUP is one tab stop and arrows move within it.
 * Giving each option its own tab stop costs a keyboard user one keystroke per
 * option on every screen carrying a segmented control — four view modes is four
 * keystrokes to get past a single control.
 *
 * ARIA deviates from 26 §5 on one point, deliberately. That file says the
 * segmented group carries `aria-selected`; `aria-selected` is only valid on
 * option/tab/row/gridcell/treeitem, and a segmented control that sets a value
 * is a radio group. So it is role="radiogroup" + role="radio" + aria-checked,
 * which is the pairing that actually announces "2 of 3, selected".
 */
export default function Seg({ options, value, onChange, label }) {
  const refs = useRef({});

  const move = (e) => {
    const i = options.findIndex(o => o.value === value);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = options[(i + 1) % options.length];
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   next = options[(i - 1 + options.length) % options.length];
    if (e.key === 'Home') next = options[0];
    if (e.key === 'End')  next = options[options.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    refs.current[next.value]?.focus();
  };

  // If the stored value matches no option the group would have no tab stop at
  // all and become unreachable by keyboard. Fall back to the first.
  const focused = options.some(o => o.value === value) ? value : options[0]?.value;

  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={move}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            ref={el => { refs.current[o.value] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={o.value === focused ? 0 : -1}
            className={`seg__b${on ? ' on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
            {/* Optional count, as a distinct node rather than folded into the
                label string. 07-pahchan.md asks for exactly that: the register
                needs "All 12" and "Needs a look 6", and baking the number into
                the label makes it untranslatable. Rendered inside the button so
                it is part of the radio's accessible name — a reviewer using a
                screen reader needs to hear the count too. */}
            {o.count != null && <span className="seg__n">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
