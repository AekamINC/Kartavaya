/**
 * `label` on Input/Select/Textarea must NAME the control, not decorate the DOM.
 *
 * ── THE DEFECT, SUITE 16.02c ON 2026-08-31 ─────────────────────────────────
 *
 * `Field.jsx` exported `Input` as `({className, ...p}) => <input {...p}/>`, so
 * `<Input label="What is this rule called?">` spread `label` straight onto the
 * `<input>` — where it is not a labelling mechanism for anything. Not for a
 * screen reader, not as a visible caption. The attribute sat in the DOM looking
 * exactly like intent that had been honoured.
 *
 * Measured on the Niyam rule editor: **10 of 10 controls had no accessible name
 * at all**, and five carried a stranded `label="…"` proving somebody had tried.
 * A person meets four identical-looking boxes and has to guess which is which.
 *
 * ── WHY THE FIX IS IN THE PRIMITIVE AND NOT THE PAGE ───────────────────────
 *
 * The failure mode was a caller reasonably believing the simple thing worked.
 * Making each page reach for `Field` by hand would leave the next caller to
 * make the same reasonable assumption. So `label` now wraps the control in
 * `Field` — a real `<label htmlFor>`, with hint and error ids wired to it.
 *
 * ⚠ AND THE OTHER HALF: WITHOUT `label`, THE OUTPUT MUST NOT MOVE. Hundreds of
 * call sites pass no label and many sit inside their own `<Field>` already; if
 * this wrapper fired unconditionally it would nest one Field in another and
 * change layout across the product. `label === undefined` is the only trigger,
 * and the tests below hold both directions.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Input, Select, Textarea, Field } from '../Field';

describe('a label NAMES the control', () => {
  it('Input: the control is reachable by its label text', () => {
    render(<Input label="What is this rule called?" defaultValue="" />);
    expect(screen.getByLabelText('What is this rule called?')).toBeInTheDocument();
  });

  it('Select: same', () => {
    render(<Select label="When this happens"><option value="a">a</option></Select>);
    expect(screen.getByLabelText('When this happens').tagName).toBe('SELECT');
  });

  it('Textarea: same', () => {
    render(<Textarea label="Message" defaultValue="" />);
    expect(screen.getByLabelText('Message').tagName).toBe('TEXTAREA');
  });

  it('the label is VISIBLE, not just an aria string', () => {
    // The Niyam editor's complaint was two-fold: no accessible name AND no
    // caption on screen. An aria-label would have fixed only the first.
    render(<Input label="Minutes" defaultValue="" />);
    expect(screen.getByText('Minutes')).toBeVisible();
  });

  it('`label` no longer leaks onto the DOM node as a dead attribute', () => {
    const { container } = render(<Input label="Title" defaultValue="" />);
    const input = container.querySelector('input');
    expect(input).not.toHaveAttribute('label');
  });

  it('hint and error are wired to the control, not stranded beside it', () => {
    render(<Input label="Amount" hint="In rupees" error="Too small" defaultValue="" />);
    const el = screen.getByLabelText('Amount');
    const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    expect(described.length).toBeGreaterThan(0);
    const text = described.map((id) => document.getElementById(id)?.textContent).join(' ');
    expect(text).toContain('In rupees');
    expect(text).toContain('Too small');
  });
});

describe('WITHOUT a label nothing moves', () => {
  it('Input renders a bare input — no wrapper, no label element', () => {
    const { container } = render(<Input defaultValue="" placeholder="value" />);
    expect(container.querySelector('label')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('INPUT');
  });

  it('Select renders a bare select and keeps its options', () => {
    const { container } = render(<Select><option value="a">a</option></Select>);
    expect(container.querySelector('label')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('SELECT');
    expect(container.querySelectorAll('option')).toHaveLength(1);
  });

  it('an explicit aria-label still names an unwrapped control', () => {
    // The Niyam condition row uses this deliberately: [field][operator][value]
    // reads as one sentence, and a stacked caption would break the line.
    render(<Select aria-label="Condition operator"><option value="a">a</option></Select>);
    expect(screen.getByLabelText('Condition operator').tagName).toBe('SELECT');
  });

  it('a control already inside a Field is NOT double-wrapped', () => {
    const { container } = render(
      <Field label="Outer"><Input defaultValue="" /></Field>,
    );
    expect(container.querySelectorAll('label')).toHaveLength(1);
  });

  it('the class contract survives both paths', () => {
    const bare = render(<Input defaultValue="" />).container.querySelector('input');
    expect(bare.className).toContain('inp');
    const wrapped = render(<Input label="X" defaultValue="" />).container.querySelector('input');
    expect(wrapped.className).toContain('inp');
  });
});
