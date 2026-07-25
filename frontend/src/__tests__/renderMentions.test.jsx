/**
 * Tests for renderMentions() in components/drawer/DrawerComments.jsx.
 *
 * The bug this guards: MentionTextarea inserts the member's FULL display name
 * ("@Keval Shah"), while the old renderer split on /(@[\w.-]+)/g, which stops at
 * the space. So the mention rendered as a bolded "@Keval" followed by plain
 * " Shah" — the visible symptom of the inserter and the parsers disagreeing.
 * The backend had the same truncation and silently sent no notification.
 */

import { describe, it, expect } from 'vitest';
import { renderMentions } from '../components/drawer/DrawerComments';

const MEMBERS = [
  { display_name: 'Keval Shah' },
  { display_name: 'Keval' },
  { display_name: 'Rohan Iyer' },
];

/** The substrings that were rendered bold. */
const bolded = nodes =>
  (Array.isArray(nodes) ? nodes : [nodes])
    .filter(n => n && typeof n === 'object' && n.type === 'strong')
    .map(n => n.props.children);

/** Full reconstructed text, to prove nothing is dropped. */
const text = nodes =>
  (Array.isArray(nodes) ? nodes : [nodes])
    .map(n => (typeof n === 'string' ? n : n?.props?.children ?? ''))
    .join('');

describe('renderMentions()', () => {
  it('matches a multi-word display name in full', () => {
    const out = renderMentions('hey @Keval Shah please look', MEMBERS);
    expect(bolded(out)).toEqual(['@Keval Shah']);
  });

  it('prefers the longest matching name so a short one cannot shadow it', () => {
    // Both "Keval" and "Keval Shah" are members. The longer must win, or the
    // mention resolves to the wrong person.
    const out = renderMentions('@Keval Shah', MEMBERS);
    expect(bolded(out)).toEqual(['@Keval Shah']);
  });

  it('still matches a bare handle that is a member', () => {
    expect(bolded(renderMentions('ping @Keval now', MEMBERS))).toEqual(['@Keval']);
  });

  it('does NOT treat an email domain as a mention', () => {
    // "contact user@example.com" used to render "@example.com" as a mention.
    const out = renderMentions('contact user@example.com please', MEMBERS);
    expect(bolded(out)).toEqual([]);
  });

  it('never drops or duplicates text', () => {
    const body = 'hey @Keval Shah and @Rohan Iyer — mail user@example.com';
    expect(text(renderMentions(body, MEMBERS))).toBe(body);
  });

  it('handles multiple mentions in one comment', () => {
    const out = renderMentions('@Keval Shah and @Rohan Iyer', MEMBERS);
    expect(bolded(out)).toEqual(['@Keval Shah', '@Rohan Iyer']);
  });

  it('falls back to bare handles when no members are supplied', () => {
    expect(bolded(renderMentions('hi @alice', []))).toEqual(['@alice']);
  });

  it('is inert on empty or missing input', () => {
    expect(renderMentions('', MEMBERS)).toBe('');
    expect(renderMentions(undefined, MEMBERS)).toBe(undefined);
  });

  it('does not break on regex metacharacters in a display name', () => {
    const out = renderMentions('hi @A. B (ops)', [{ display_name: 'A. B (ops)' }]);
    expect(bolded(out)).toEqual(['@A. B (ops)']);
  });
});
