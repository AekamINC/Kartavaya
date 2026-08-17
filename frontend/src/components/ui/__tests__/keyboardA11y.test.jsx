/**
 * The keyboard gate for the overlay primitives.
 *
 * WHY THIS FILE EXISTS. `Picker.jsx` declares `role="listbox"` with
 * `role="option"` rows and `aria-selected` on each — it tells every screen
 * reader it is a list box — and then delivered about half of what that
 * promises. `usePicker` did carry a document-level `keydown` listener with
 * Arrow/Home/End/Enter, which is easy to miss when grepping for `onKeyDown`
 * and which this file's first draft did miss. What was genuinely absent:
 *
 *   · the trigger did not open on Down/Up, so the working handler was
 *     unreachable from the keyboard in the first place;
 *   · nothing ever took focus, and there was no `aria-activedescendant`, so
 *     the cursor existed as a CSS class and was announced to nobody;
 *   · no typeahead, on a control every user treats as a `<select>`;
 *   · the cursor opened at row 0 rather than on the current value;
 *   · Tab walked into the options one by one instead of leaving.
 *
 * These tests were written and committed FAILING, before any of that was
 * fixed. A gate written after its fix only proves the fix agrees with itself;
 * this one named the defect first, so what closed it had to satisfy a spec it
 * did not get to write.
 *
 * The Tooltip and Menu blocks cover defects fixed in the same change, and are
 * here so the fixes cannot quietly rot.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import Picker from '../Picker';
import Tooltip from '../Tooltip';
import Menu from '../Menu';
import CalendarGrid from '../CalendarGrid';

const STATUSES = [
  { id: 'active', name: 'Active' },
  { id: 'blocked', name: 'Blocked' },
  { id: 'onhold', name: 'On hold' },
  { id: 'done', name: 'Done' },
];

function PickerHarness() {
  const [value, setValue] = useState(null);
  return (
    <Picker items={STATUSES} value={value} onChange={setValue}
            placeholder="Select status" ariaLabel="Project status" />
  );
}

describe('Picker — keyboard', () => {
  /**
   * The whole contract in one test, because a user does not get partial credit
   * for a list box they can open but not choose from.
   */
  it('opens, moves and selects with the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    const trigger = screen.getByRole('button', { name: 'Project status' });
    await user.tab();
    expect(trigger).toHaveFocus();

    // ArrowDown on a collapsed listbox trigger opens it. This is the ARIA
    // authoring practice for a select, not a preference.
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const list = screen.getByRole('listbox');
    // Either the row takes DOM focus or the list points at it with
    // aria-activedescendant. One of the two must be true, or nothing has been
    // announced and the cursor does not exist as far as a screen reader knows.
    const active = () => {
      const ad = list.getAttribute('aria-activedescendant');
      if (ad) return document.getElementById(ad);
      const f = document.activeElement;
      return f && f.getAttribute('role') === 'option' ? f : null;
    };
    expect(active(), 'no keyboard cursor in the listbox').not.toBeNull();

    await user.keyboard('{ArrowDown}');
    expect(active()).toHaveTextContent('Blocked');

    await user.keyboard('{Enter}');
    // The value and the focus return are immediate; the PANEL is not. It
    // unmounts on `animationend` so `dmPopOut` gets to play, and jsdom fires
    // no animation events at all — what actually clears it here is the
    // EXIT_FALLBACK_MS ceiling. Asserting synchronously would be asserting
    // that the exit animation does not exist.
    expect(trigger).toHaveTextContent('Blocked');
    expect(trigger, 'focus must return to the trigger').toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('Escape closes without changing the value', async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);
    const trigger = screen.getByRole('button', { name: 'Project status' });

    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Escape}');

    expect(trigger).toHaveTextContent('Select status');
    expect(trigger, 'focus must return to the trigger').toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('typeahead jumps to the first option that matches', async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    await user.click(screen.getByRole('button', { name: 'Project status' }));
    await user.keyboard('on');           // "On hold", not "Active"

    const list = screen.getByRole('listbox');
    const ad = list.getAttribute('aria-activedescendant');
    const cursor = ad ? document.getElementById(ad) : document.activeElement;
    expect(cursor).toHaveTextContent('On hold');
  });
});

describe('Tooltip — the description link', () => {
  /**
   * `role="tooltip"` on the bubble is not a link to anything. Without
   * `aria-describedby` on the control, the text is decoration that only
   * sighted users receive.
   */
  it('points the focused control at the tip while it is open', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Optional — leave blank if unregistered">
        <button type="button">GSTIN</button>
      </Tooltip>,
    );

    const btn = screen.getByRole('button', { name: 'GSTIN' });
    expect(btn).not.toHaveAttribute('aria-describedby');

    await user.tab();
    expect(btn).toHaveFocus();

    // No dwell on focus: a description that arrives 300ms after focus has
    // already missed the announcement it was meant to be part of.
    const id = btn.getAttribute('aria-describedby');
    expect(id, 'focused control is not described by its tooltip').toBeTruthy();
    expect(document.getElementById(id)).toHaveTextContent('leave blank if unregistered');
    expect(document.getElementById(id)).toHaveAttribute('role', 'tooltip');
  });

  it('Escape dismisses it while focus stays put', async () => {
    const user = userEvent.setup();
    render(<Tooltip content="Help"><button type="button">GSTIN</button></Tooltip>);

    const btn = screen.getByRole('button', { name: 'GSTIN' });
    await user.tab();
    expect(btn).toHaveAttribute('aria-describedby');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });
});

describe('Menu — the disabled row', () => {
  const items = [
    { id: 'edit', label: 'Edit', onSelect: vi.fn() },
    { id: 'dup', label: 'Duplicate', disabled: true, onSelect: vi.fn() },
    { id: 'arch', label: 'Archive', onSelect: vi.fn() },
  ];

  /**
   * The regression this pins: `cursor` counted the ENABLED rows while the
   * focus call indexed every rendered `[data-menuitem]`. One disabled entry
   * and each arrow press landed a row short — and landing on the disabled row
   * itself, `focus()` is refused outright, so the keyboard stopped moving with
   * nothing on screen to explain why.
   */
  it('arrow keys walk enabled rows only', async () => {
    const user = userEvent.setup();
    render(<Menu trigger={<span>More</span>} items={items} label="More actions" />);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu');

    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

    // The second press must reach Archive — NOT the disabled Duplicate, and
    // not nothing at all.
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Menu trigger={<span>More</span>} items={items} label="More actions" />);

    const trigger = screen.getByRole('button', { name: 'More actions' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Escape}');

    expect(trigger).toHaveFocus();
  });
});

describe('CalendarGrid — the month is a grid', () => {
  // 17 August 2026 is a Monday. Every assertion below is anchored to it so
  // nothing depends on the day the suite happens to run.
  const AUG17 = new Date(2026, 7, 17);
  // Matches the tail of the accessible name, so the weekday does not have to
  // be spelled out at every call site.
  const day = (n) => screen.getByRole('button', { name: new RegExp(`, ${n} August 2026$`) });

  it('declares rows, column headers and cells — not 42 loose buttons', () => {
    render(<CalendarGrid value={AUG17} onPick={() => {}} />);

    const grid = screen.getByRole('grid', { name: 'August 2026' });
    // One header row plus one row per week. August 2026 starts on a Saturday
    // and runs 31 days, so it spans six weeks.
    expect(within(grid).getAllByRole('row')).toHaveLength(7);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(42);

    // The initials are ambiguous — S is Sunday and Saturday, T is Tuesday and
    // Thursday — so each header carries the full name.
    const heads = within(grid).getAllByRole('columnheader');
    expect(heads.map(h => h.getAttribute('aria-label')))
      .toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  });

  it('names every cell with its full date, not a bare number', () => {
    render(<CalendarGrid value={AUG17} onPick={() => {}} />);
    expect(day(17)).toHaveAccessibleName('Monday, 17 August 2026');
    expect(day(17)).toHaveAttribute('tabindex', '0');
  });

  it('is one tab stop, not forty-two', () => {
    render(<CalendarGrid value={AUG17} onPick={() => {}} />);
    const tabbable = screen.getAllByRole('button')
      .filter(b => b.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('moves a day sideways and a WEEK vertically', async () => {
    const user = userEvent.setup();
    render(<CalendarGrid value={AUG17} onPick={() => {}} />);
    expect(day(17)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(day(18)).toHaveFocus();

    // The whole reason a list handler cannot drive a calendar: one cell down
    // is seven days, not one.
    await user.keyboard('{ArrowDown}');
    expect(day(25)).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(day(17)).toHaveFocus();
  });

  it('Home and End reach the ends of the week, not of the month', async () => {
    const user = userEvent.setup();
    render(<CalendarGrid value={AUG17} onPick={() => {}} />);

    await user.keyboard('{Home}');       // Monday the 17th → Sunday the 16th
    expect(day(16)).toHaveFocus();
    await user.keyboard('{End}');        // → Saturday the 22nd
    expect(day(22)).toHaveFocus();
  });

  it('arrowing off the edge brings the month with it', async () => {
    const user = userEvent.setup();
    render(<CalendarGrid value={new Date(2026, 7, 31)} onPick={() => {}} />);

    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');           // 31 Aug → 1 Sep
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tuesday, 1 September 2026' })).toHaveFocus();
  });

  it('PageDown lands in the next month and does not overshoot a short one', async () => {
    const user = userEvent.setup();
    // 31 January → February, which has no 31st. It must clamp to the 28th,
    // not roll forward into March.
    render(<CalendarGrid value={new Date(2026, 0, 31)} onPick={() => {}} />);

    await user.keyboard('{PageDown}');
    expect(screen.getByRole('grid', { name: 'February 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saturday, 28 February 2026' })).toHaveFocus();
  });

  it('Enter picks the focused day', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CalendarGrid value={AUG17} onPick={onPick} />);

    await user.keyboard('{ArrowRight}{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].toDateString()).toBe(new Date(2026, 7, 18).toDateString());
  });

  it('respects min and max', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CalendarGrid value={AUG17} max={new Date(2026, 7, 17)} onPick={onPick} />);

    expect(day(18)).toBeDisabled();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onPick).not.toHaveBeenCalled();
  });
});
