/**
 * Tests for the two pure helpers `pages/sanvaad/messageUtils.js` gained in the
 * 06 pixel pass. Both are the kind that regress silently:
 *
 *  · `splitMentions` is a generated RegExp. `components/drawer/DrawerComments`
 *    already learned this the hard way — 03 §5 records a version that split on
 *    `/(@[\w.-]+)/g`, so "@Keval Shah" bolded "@Keval" and left " Shah" as plain
 *    text. This is the same shape of parser on the messaging surface, so it gets
 *    the same guards, plus the one that file does not need: which mention is
 *    yours, which is what `.msg__mn--me` paints.
 *  · `dayLabel` returns `{en, hi}` rather than a string, because the Devanagari
 *    half has to be a separate node to pick up `--font-indic` (00 §2). A caller
 *    that stringifies it renders "[object Object]" between two hairlines and
 *    nothing throws.
 */
import { describe, it, expect } from 'vitest';
import { dayLabel, splitMentions } from '../pages/sanvaad/messageUtils';

const NAMES = ['Keval Shah', 'Keval', 'Rohan Iyer'];

/** Just the mention markers. */
const mentions = parts => parts.filter(p => typeof p === 'object').map(p => p.mention);
/** Everything put back together, to prove nothing is dropped. */
const text = parts => parts.map(p => (typeof p === 'string' ? p : p.mention)).join('');

describe('splitMentions()', () => {
  it('matches a multi-word display name in full', () => {
    const out = splitMentions('hey @Keval Shah please look', NAMES);
    expect(mentions(out)).toEqual(['@Keval Shah']);
  });

  it('prefers the longest matching name so a short one cannot shadow it', () => {
    expect(mentions(splitMentions('@Keval Shah', NAMES))).toEqual(['@Keval Shah']);
  });

  it('still matches a bare handle nobody in the channel has posted under', () => {
    expect(mentions(splitMentions('ping @priya about it', NAMES))).toEqual(['@priya']);
  });

  it('does not light up the domain of a pasted email address', () => {
    const out = splitMentions('contact user@example.com please', NAMES);
    expect(mentions(out)).toEqual([]);
    expect(text(out)).toBe('contact user@example.com please');
  });

  it('marks the mention that names you, and only that one', () => {
    const out = splitMentions('@Keval Shah and @Rohan Iyer', NAMES, 'Keval Shah');
    const flags = out.filter(p => typeof p === 'object').map(p => [p.name, p.me]);
    expect(flags).toEqual([['Keval Shah', true], ['Rohan Iyer', false]]);
  });

  it('reconstructs the body exactly, mentions or not', () => {
    const body = 'no mentions here at all';
    expect(text(splitMentions(body, NAMES))).toBe(body);
    const withOne = 'start @Rohan Iyer end';
    expect(text(splitMentions(withOne, NAMES))).toBe(withOne);
  });

  it('survives an empty or missing body', () => {
    expect(splitMentions('', NAMES)).toEqual(['']);
    expect(splitMentions(undefined, NAMES)).toEqual(['']);
  });

  it('does not break on a name containing regex metacharacters', () => {
    const out = splitMentions('hi @A. B (ops)', ['A. B (ops)']);
    expect(mentions(out)).toEqual(['@A. B (ops)']);
  });
});

describe('dayLabel()', () => {
  it('returns both halves for today and yesterday', () => {
    expect(dayLabel(new Date().toISOString())).toEqual({ en: 'Today', hi: 'आज' });
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(dayLabel(y.toISOString())).toEqual({ en: 'Yesterday', hi: 'कल' });
  });

  it('pairs a weekday inside the last week with its Devanagari name', () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    const { en, hi } = dayLabel(d.toISOString());
    expect(hi).toBe(['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'][d.getDay()]);
    expect(en).toBeTruthy();
  });

  it('leaves hi null for an older date, where a numeric date has no partner', () => {
    const d = new Date();
    d.setDate(d.getDate() - 40);
    expect(dayLabel(d.toISOString()).hi).toBeNull();
  });
});
