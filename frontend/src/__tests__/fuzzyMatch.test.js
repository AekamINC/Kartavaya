/**
 * Tests for the command palette's ranking and its registry.
 *
 * The bug: one subsequence test over a 40-character concatenation of
 * label + hi + keywords, so almost any three-letter query matched almost
 * everything. "ate" scored most of the 30 items at 1, and they then sorted in
 * source order because the comparator had nothing to break ties with — the list
 * barely changed as you typed, which reads as "search is broken".
 *
 * These lock the ORDERING guarantees, not the absolute numbers, so the scoring
 * curve can be retuned without rewriting the suite.
 *
 * `fuzzyMatch` moved to `lib/fuzzyMatch.js` — importing it from the component
 * pulled react-router into a test of a pure function.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../lib/fuzzyMatch';
import { COMMANDS, ACTION_ITEMS, SCOPES, ENTITIES, rankCommands } from '../lib/commands';

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
    expect(fuzzyMatch('सहायक', item('Sahayak', 'सहायक'))).toBeGreaterThan(0);
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
    const scored = items.map((i) => fuzzyMatch('tem', i)).sort((a, b) => b - a);
    expect(scored[0]).toBeGreaterThan(scored[1] + 10);
  });
});

describe('the command registry', () => {
  it('has no duplicate ids — an id is a React key and an ARIA option id', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never points two commands at the same route', () => {
    // `sahayak` and `scrapers` were both '/hub/org', so choosing "Data Tools"
    // landed you on Sahayak.
    const routes = COMMANDS.map((c) => c.route).filter(Boolean);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('gives every command exactly one of route or action', () => {
    for (const c of COMMANDS) {
      expect(Boolean(c.route) !== Boolean(c.action), `${c.id} must have one of route/action`).toBe(true);
    }
  });

  it('does not file a plain navigation under Actions', () => {
    // The defect: New Invoice -> /ganit under a header that said Actions, so
    // the user landed on the invoice LIST to hunt for the create button.
    for (const a of ACTION_ITEMS) {
      const isCreate = Boolean(a.action) || /[?&]new=1\b/.test(a.route || '');
      expect(isCreate, `${a.id} is a navigation filed under Actions`).toBe(true);
    }
  });

  it('still finds the module when the fake create action is typed', () => {
    const forInvoice = rankCommands('new invoice', fuzzyMatch);
    const forContact = rankCommands('new contact', fuzzyMatch);
    expect(forInvoice.some((c) => c.id === 'ganit')).toBe(true);
    expect(forContact.some((c) => c.id === 'graha')).toBe(true);
  });

  it('ranks the exact command first for a muscle-memory query', () => {
    expect(rankCommands('new task', fuzzyMatch)[0].id).toBe('new-task');
  });

  it('returns everything for a blank query and nothing for a miss', () => {
    expect(rankCommands('', fuzzyMatch)).toHaveLength(COMMANDS.length);
    expect(rankCommands('qqqqzz', fuzzyMatch)).toHaveLength(0);
  });

  it('keeps the scope chips and the entity groups in step', () => {
    // `scope` is sent to the endpoint AND used as the response key, so a scope
    // with no entity would filter every group out and render an empty list.
    const entityKeys = new Set(ENTITIES.map((e) => e.key));
    for (const s of SCOPES) {
      if (s.id === 'all') continue;
      expect(entityKeys.has(s.id), `scope "${s.id}" has no entity`).toBe(true);
    }
    expect(SCOPES.length - 1).toBe(ENTITIES.length);
  });
});
