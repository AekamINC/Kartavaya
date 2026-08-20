/**
 * THE TASK LABEL THAT EXISTED EVERYWHERE EXCEPT ON SCREEN.
 *
 * `public.tasks.tags` has been a TEXT[] with full backend support since the
 * table was written — accepted on create (`server.py:1482`), on patch
 * (`:1490`), returned by the response model (`:1505`, `:1745`), selected by the
 * list query (`:3805`), written by the insert (`:3974`). It was renderable by
 * nothing. No drawer component read it and `NewTaskModal` never offered it, so
 * the column was writable only by someone holding an API token.
 *
 * That is the failure this file guards: not "labels are broken" but "labels are
 * invisible", which no unit test of the API would ever have caught.
 *
 * WHY THE DE-DUPLICATION RULES ARE TESTED AND NOT JUST THE RENDER. A label set
 * is a filter key. " urgent" and "urgent" look identical in a chip row and sort
 * as two different filters, and the moment a firm has both, it stops trusting
 * the label as a way to find anything. Trimming and case-insensitive matching
 * are therefore load-bearing behaviour, not tidiness.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawerLabels from '../DrawerLabels';

const setup = (props = {}) => {
  const onChange = vi.fn();
  const utils = render(
    <DrawerLabels tags={[]} suggestions={[]} onChange={onChange} {...props} />,
  );
  return { onChange, ...utils };
};

describe('the labels a task can actually be given', () => {
  it('renders every label the task already carries', () => {
    setup({ tags: ['urgent-client', 'awaiting-docs'] });
    expect(screen.getByText('urgent-client')).toBeInTheDocument();
    expect(screen.getByText('awaiting-docs')).toBeInTheDocument();
  });

  it('adds a typed label on Enter', () => {
    const { onChange } = setup({ tags: ['a'] });
    const input = screen.getByLabelText('Add a label');
    fireEvent.change(input, { target: { value: 'Q3-audit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['a', 'Q3-audit']);
  });

  it('treats a comma as a submit key, so a pasted list becomes several labels', () => {
    const { onChange } = setup();
    const input = screen.getByLabelText('Add a label');
    fireEvent.change(input, { target: { value: 'alpha, beta, gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['alpha', 'beta', 'gamma']);
  });

  it('trims, because " urgent" and "urgent" are two filters that look like one', () => {
    const { onChange } = setup();
    const input = screen.getByLabelText('Add a label');
    fireEvent.change(input, { target: { value: '   spaced   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['spaced']);
  });

  it('refuses a duplicate case-insensitively, and keeps the first spelling', () => {
    const { onChange } = setup({ tags: ['Urgent'] });
    const input = screen.getByLabelText('Add a label');
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // No call at all: re-adding a label the task already has is not a change,
    // and firing onChange would write an identical array and dirty the task.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('ignores an empty submit rather than storing a blank label', () => {
    const { onChange } = setup({ tags: ['a'] });
    const input = screen.getByLabelText('Add a label');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a label from its own chip', () => {
    const { onChange } = setup({ tags: ['keep', 'drop'] });
    fireEvent.click(screen.getByLabelText('Remove label drop'));
    expect(onChange).toHaveBeenCalledWith(['keep']);
  });

  it('commits a typed label on blur, so clicking away does not discard it', () => {
    const { onChange } = setup();
    const input = screen.getByLabelText('Add a label');
    fireEvent.change(input, { target: { value: 'typed-not-entered' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['typed-not-entered']);
  });

  it('offers labels used nearby, and never one the task already has', () => {
    setup({ tags: ['urgent'], suggestions: ['urgent', 'billing', 'onsite'] });
    expect(screen.getByRole('button', { name: '+ billing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ onsite' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ urgent' })).toBeNull();
  });

  it('survives a task whose tags are null rather than an empty array', () => {
    // The API returns `list(r["tags"] or [])`, but a task built optimistically
    // in the client has no tags key at all. A crash here would take the whole
    // drawer down on the one field that is meant to be optional.
    expect(() => setup({ tags: null })).not.toThrow();
  });
});
