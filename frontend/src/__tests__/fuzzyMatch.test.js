/**
 * Tests for the command palette's ranking.
 *
 * The bug: one subsequence test over a 40-character concatenation of
 * label + hi + keywords, so almost any three-letter query matched almost
 * everything. "ate" scored most of the 30 items at 1, and they then sorted in
 * source order because the comparator had nothing to break ties with — the list
 * barely changed as you typed, which reads as "search is broken".
 *
 * These lock the ORDERING guarantees, not the absolute numbers, so the scoring
 * curve can be retuned without rewriting the suite.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../components/CommandPalette';

const item = (label, hi = '', keywords = '') => ({ label, hi, keywords });

describe('fuzzyMatch()', () => {
  it('ranks a label prefix above a label substring', () => {
    const prefix = fuzzyMatch('inv', item('Invoices'));
    const middle = fuzzyMatch('inv', item('New Invoice'));
    expect(prefix).toBeGreaterThan(middle);
  });

  it('ranks a label substring above a keyword-only hit', () => {
    const inLabel = fuzzyMatch('task', item('Tasks'));
    const inKeywords = fuzzyMatch('task', item('Boards', '', 'task kanban'));
    expect(inLabel).toBeGreaterThan(inKeywords);
  });

  it('NEVER ranks a subsequence above a substring — the core regression', () => {
    const substring = fuzzyMatch('ate', item('Templates'));
    const subsequence = fuzzyMatch('ate', item('Automations'));
    expect(substring).toBeGreaterThan(subsequence);
  });

  it('does not match a subsequence spread across the keyword blob', () => {
    // The old version concatenated keywords into the haystack, so this matched.
    expect(fuzzyMatch('xyz', item('Boards', 'फ़लक', 'kanban lists columns'))).toBe(0);
  });

  it('prefers word-boundary matches over mid-word ones', () => {
    const boundary = fuzzyMatch('rep', item('Time Report'));
    const midWord = fuzzyMatch('rep', item('Prepaid'));
    expect(boundary).toBeGreaterThan(midWord);
  });

  it('prefers a shorter label when both match at the prefix', () => {
    expect(fuzzyMatch('ta', item('Tasks'))).toBeGreaterThan(fuzzyMatch('ta', item('Tasks and subtasks')));
  });

  it('matches Devanagari labels', () => {
    expect(fuzzyMatch('सृजन', item('Srijan', 'सृजन'))).toBeGreaterThan(0);
  });

  it('returns 0 for a genuine miss', () => {
    expect(fuzzyMatch('zzzz', item('Boards', 'फ़लक', 'kanban'))).toBe(0);
  });

  it('treats an empty query as "show everything"', () => {
    expect(fuzzyMatch('', item('Anything'))).toBeGreaterThan(0);
    expect(fuzzyMatch('   ', item('Anything'))).toBeGreaterThan(0);
  });

  it('is not defeated by a 3-letter query matching most items', () => {
    // The observable symptom: type three letters, get a list that barely
    // changed. Assert that a real substring hit clearly separates from the tail.
    const items = [
      item('Templates'), item('Automations'), item('Approvals'),
      item('Activity'), item('Time Report'), item('Teams'),
    ];
    const scored = items.map(i => fuzzyMatch('tem', i)).sort((a, b) => b - a);
    expect(scored[0]).toBeGreaterThan(scored[1] + 10);
  });
});
