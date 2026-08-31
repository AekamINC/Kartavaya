/**
 * `<DateInput type="month">` — the month mode that closed suite 20.04.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * CLAUDE.md: no native date-family controls anywhere. `Field.jsx` forwarded
 * `date`, `datetime-local` and `time` to `DateInput` and NOT `month`, so five
 * screens still emitted the browser's own widget. Suite 20.04 failed on that
 * deliberately and named the fix as a FEATURE — "closing it means giving
 * `DateInput` a month mode" — rather than excusing it into a green.
 *
 * Three of the five screens were Vetana, and `manav/BonusTab.jsx:56` had
 * already written down the cost of getting a month wrong there: the value must
 * match `vetana_payroll_runs.month` EXACTLY, and a wrong one "does not fail, it
 * files the award against a month no payroll run will ever look at, and the
 * person is simply not paid."
 *
 * So the assertions that matter most here are about the WIRE VALUE — `2026-08`,
 * zero-padded, never a Date object and never a display string. `DateInput`'s
 * `emit()` is input-shaped on purpose (`onChange({target:{value}})`), and
 * `check-dateinput-handlers.mjs` exists because call sites got that wrong eight
 * times; these tests hold the other side of that contract.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DateInput from '../DateInput';
import { fmtMonth, parseMonth } from '../MonthGrid';
import { Input } from '../Field';

const open = async (user) => {
  await user.click(screen.getByRole('button', { expanded: false }));
  return screen.getByRole('dialog');
};

describe('parseMonth / fmtMonth — the wire format', () => {
  it('round-trips a zero-padded month', () => {
    expect(fmtMonth(parseMonth('2026-08'))).toBe('2026-08');
    expect(fmtMonth(parseMonth('2026-01'))).toBe('2026-01');
    expect(fmtMonth(parseMonth('2026-12'))).toBe('2026-12');
  });

  it('pads a single-digit month, because the column is text and 2026-8 never matches', () => {
    expect(fmtMonth({ y: 2026, m: 0 })).toBe('2026-01');
    expect(fmtMonth({ y: 2026, m: 8 })).toBe('2026-09');
  });

  it('takes the month out of a longer date rather than failing', () => {
    expect(fmtMonth(parseMonth('2026-08-31'))).toBe('2026-08');
  });

  it('refuses what is not a month', () => {
    for (const bad of ['', null, undefined, 'August', '2026', '2026-13', '2026-00']) {
      expect(parseMonth(bad)).toBeNull();
    }
  });
});

describe('<DateInput type="month">', () => {
  it('renders the value as a readable label, not the raw wire string', () => {
    render(<DateInput type="month" value="2026-08" onChange={() => {}} aria-label="Month" />);
    expect(screen.getByRole('button')).toHaveTextContent('Aug 2026');
  });

  it('says "No month", not "No date", when empty', () => {
    render(<DateInput type="month" value="" onChange={() => {}} aria-label="Month" />);
    expect(screen.getByRole('button')).toHaveTextContent('No month');
  });

  it('emits the WIRE value in an input-shaped event', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateInput type="month" value="2026-08" onChange={onChange} aria-label="Month" />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'March 2026' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const evt = onChange.mock.calls[0][0];
    expect(evt).toHaveProperty('target.value', '2026-03');
    expect(typeof evt.target.value).toBe('string');
  });

  it('opens on the selected month\'s year, not on today', async () => {
    const user = userEvent.setup();
    render(<DateInput type="month" value="2019-04" onChange={() => {}} aria-label="Month" />);
    const dialog = await open(user);
    expect(within(dialog).getByText('2019')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'April 2019' })).toHaveClass('on');
  });

  it('honours `max` — a payroll month that has not happened is not selectable', async () => {
    const user = userEvent.setup();
    render(<DateInput type="month" value="2026-06" max="2026-08" onChange={() => {}} aria-label="Month" />);
    const dialog = await open(user);
    expect(within(dialog).getByRole('button', { name: 'August 2026' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'September 2026' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'December 2026' })).toBeDisabled();
  });

  it('honours `min`', async () => {
    const user = userEvent.setup();
    render(<DateInput type="month" value="2026-06" min="2026-05" onChange={() => {}} aria-label="Month" />);
    const dialog = await open(user);
    expect(within(dialog).getByRole('button', { name: 'April 2026' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'May 2026' })).toBeEnabled();
  });

  it('offers no "Next month" quick button, because every month field is capped at today', async () => {
    const user = userEvent.setup();
    render(<DateInput type="month" value="2026-06" onChange={() => {}} aria-label="Month" />);
    const dialog = await open(user);
    expect(within(dialog).queryByText('Next month')).toBeNull();
    expect(within(dialog).getByText('This month')).toBeInTheDocument();
    expect(within(dialog).getByText('Last month')).toBeInTheDocument();
  });

  it('the grid is ONE tab stop, not twelve', async () => {
    const user = userEvent.setup();
    render(<DateInput type="month" value="2026-06" onChange={() => {}} aria-label="Month" />);
    const dialog = await open(user);
    const stops = within(dialog).getAllByRole('gridcell')
      .map(c => c.querySelector('button'))
      .filter(b => b.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
  });

  it('keeps the hidden native input for form serialisation by name', () => {
    const { container } = render(
      <DateInput type="month" name="month" value="2026-08" onChange={() => {}} aria-label="Month" />);
    const native = container.querySelector('input.pk__native');
    expect(native).toHaveAttribute('type', 'month');
    expect(native).toHaveAttribute('name', 'month');
    expect(native).toHaveAttribute('aria-hidden', 'true');
    expect(native).toHaveAttribute('tabindex', '-1');
  });

  it('drives a controlled parent end to end', async () => {
    const user = userEvent.setup();
    function Host() {
      const [m, setM] = useState('2026-08');
      return (<>
        <DateInput type="month" value={m} onChange={e => setM(e.target.value)} aria-label="Month" />
        <output>{m}</output>
      </>);
    }
    render(<Host />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'February 2026' }));
    expect(screen.getByRole('status', { hidden: true }) || document.querySelector('output'))
      .toBeTruthy();
    expect(document.querySelector('output').textContent).toBe('2026-02');
  });
});

describe('Field.jsx routes `month` to DateInput', () => {
  it('<Input type="month"> is NOT a native control', () => {
    // The exact hole suite 20.04 named: `DATEY` forwarded three types, not four.
    const { container } = render(<Input type="month" value="2026-08" onChange={() => {}} aria-label="Month" />);
    expect(container.querySelector('.pk')).toBeTruthy();
    const natives = [...container.querySelectorAll('input[type="month"]')]
      .filter(el => !el.classList.contains('pk__native'));
    expect(natives).toHaveLength(0);
  });
});
