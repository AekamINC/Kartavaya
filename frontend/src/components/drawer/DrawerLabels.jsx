import React, { useState, useRef } from 'react';
import Tag from '../ui/Tag';
import Lbl from './DrawerLabel';

/**
 * DrawerLabels — the task's free-text labels.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `public.tasks.tags` is a TEXT[] that the backend has supported end to end
 * since the table was written: `TaskCreate.tags` and `TaskUpdate.tags` accept
 * it (server.py:1482, :1490), the response model returns it (:1505, :1745),
 * the list query selects it (:3805) and the insert writes it (:3974).
 *
 * Nothing in the UI has ever rendered it. Not the drawer, not NewTaskModal.
 * So the column is writable only by API and invisible in the product — a
 * feature that exists everywhere except where somebody could use it.
 *
 * ── Free text, not a fixed list ─────────────────────────────────────────────
 *
 * These are NOT `categories`. A category is one per task, comes from
 * `task_categories`, and is already its own control two rows up. Labels are
 * many-per-task and invented by the firm as it goes — "urgent-client",
 * "awaiting-docs", "Q3-audit". A Picker needs a known item list and would
 * therefore refuse the first label anybody wanted; the input is free text for
 * that reason.
 *
 * `suggestions` are drawn from labels already used in this workspace, so the
 * common case is one click and the vocabulary converges without being
 * enforced. Typing something new is always allowed.
 *
 * ── The two rules the input enforces ────────────────────────────────────────
 *
 * TRIMMED, and DE-DUPLICATED CASE-INSENSITIVELY. Both exist because a label
 * set is a filter key: " urgent" and "urgent" look identical in a chip row and
 * behave as two different filters, which is the failure mode that makes people
 * stop trusting labels. The first spelling entered wins, so the display keeps
 * whatever case the firm chose.
 *
 * Comma is a submit key as well as Enter — pasting "a, b, c" is the way people
 * actually enter several at once.
 */
export default function DrawerLabels({ tags = [], suggestions = [], onChange }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  const current = Array.isArray(tags) ? tags : [];
  const lower = new Set(current.map(t => String(t).toLowerCase()));

  /** Add one or many. Returns silently on a blank or an existing label —
   *  re-adding a label the task already has is not an error worth a toast. */
  const add = (raw) => {
    const incoming = String(raw || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (!incoming.length) return;

    const next = [...current];
    const seen = new Set(lower);
    for (const label of incoming) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(label);
    }
    setText('');
    if (next.length !== current.length) onChange(next);
  };

  const remove = (label) => {
    onChange(current.filter(t => t !== label));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
      return;
    }
    // Backspace on an empty input removes the last chip — the behaviour every
    // token field has, and the reason people do not reach for the mouse.
    if (e.key === 'Backspace' && !text && current.length) {
      e.preventDefault();
      remove(current[current.length - 1]);
    }
  };

  // Only labels this task does not already carry, capped so the row cannot
  // push the rest of the drawer off screen in a workspace with 200 labels.
  const unused = suggestions
    .filter(s => s && !lower.has(String(s).toLowerCase()))
    .slice(0, 6);

  return (
    <div className="dr__prop dr__prop--labels">
      <Lbl hi="लेबल">Labels</Lbl>

      <div
        className="dr__labels"
        onClick={() => inputRef.current?.focus()}
      >
        {current.map(label => (
          <Tag key={label} className="dr__label">
            {label}
            <button
              type="button"
              className="dr__label-x"
              aria-label={`Remove label ${label}`}
              onClick={(e) => { e.stopPropagation(); remove(label); }}
            >
              ×
            </button>
          </Tag>
        ))}

        <input
          ref={inputRef}
          className="dr__label-input"
          value={text}
          aria-label="Add a label"
          placeholder={current.length ? '' : 'Add a label…'}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          // Committing on blur means a typed-but-not-entered label is not
          // silently discarded when the user clicks away to save the task.
          onBlur={() => add(text)}
        />
      </div>

      {unused.length > 0 && (
        <div className="dr__label-suggest">
          {unused.map(s => (
            <button
              key={s}
              type="button"
              className="dr__label-chip"
              onClick={() => add(s)}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
