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
import {
  dayLabel, dropSettled, isContinuation, isPending, mergeById, optimisticMessage,
  splitMentions,
} from '../pages/sanvaad/messageUtils';

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

/**
 * Grouping decides whether a row keeps its header. A `type='system'` row carries
 * the `sender_id` of whoever triggered it — a task moved by Aanya produces a
 * Kartavya event stamped with Aanya's id — so without an explicit guard the
 * module event groups under her message and loses the header naming the module.
 * `MESSAGING-ATTENDANCE-SPEC.md:20` requires that header.
 */
describe('isContinuation()', () => {
  const at = (min, extra = {}) => ({
    sender_id: 'u1',
    created_at: new Date(Date.UTC(2026, 6, 27, 10, min)).toISOString(),
    ...extra,
  });

  it('groups two close messages from the same sender', () => {
    expect(isContinuation(at(2), at(0))).toBe(true);
  });

  it('does not group across senders', () => {
    expect(isContinuation(at(2, { sender_id: 'u2' }), at(0))).toBe(false);
  });

  it('never groups a system message under the message that triggered it', () => {
    expect(isContinuation(at(2, { type: 'system' }), at(0))).toBe(false);
  });

  it('never groups a human message under a system message', () => {
    expect(isContinuation(at(2), at(0, { type: 'system' }))).toBe(false);
  });

  it('has no opinion without a previous row', () => {
    expect(isContinuation(at(0), null)).toBe(false);
  });
});

/* ── The optimistic-send helpers ────────────────────────────────────────────
 *
 * These three carry `MOTION-SPEC.md` §7.1 ("never lie about state") and every
 * one of them fails silently rather than loudly:
 *
 *  · `markFresh` decides whether `.msg--new` plays on ONE row or on fifty. Get
 *    the "was the log already populated" guard wrong and the entire first page
 *    of a channel animates in on every channel switch, which reads as a bug in
 *    the layout rather than in a flag.
 *  · `dropSettled` is the only thing standing between the reader and seeing
 *    their own message twice, and the window it covers — poll tick lands between
 *    the optimistic push and the POST's response — is exactly the one a manual
 *    test on a fast connection never reaches.
 *  · a placeholder id that could collide with a server id would send a PATCH or
 *    a reaction to a real, unrelated message.
 */
/* A fixed date in the past, not a template around "now". `mergeById` sorts on
   `created_at` and `optimisticMessage` stamps the real clock, so a fixture
   built from today's date puts the placeholder BEFORE the fixtures whenever the
   suite runs earlier in the UTC day than the hard-coded hour — a test that
   passes in the afternoon and fails in the morning. */
const row = (id, over = {}) => ({
  id, content: `m${id}`, sender_id: 1, created_at: `2020-01-01T10:0${id}:00Z`, ...over,
});

describe('mergeById() freshness marking', () => {
  it('marks nothing on the first page, however many rows arrive', () => {
    const out = mergeById([], [row(1), row(2), row(3)], { markFresh: true });
    expect(out.map(m => !!m.__fresh)).toEqual([false, false, false]);
  });

  it('marks only the row the poll actually added', () => {
    const out = mergeById([row(1), row(2)], [row(1), row(2), row(3)], { markFresh: true });
    expect(out.map(m => [m.id, !!m.__fresh])).toEqual([[1, false], [2, false], [3, true]]);
  });

  it('marks nothing at all without the flag — loadOlder must stay silent', () => {
    const out = mergeById([row(3)], [row(1), row(2)]);
    expect(out.some(m => m.__fresh)).toBe(false);
  });

  it('does not re-mark a row it already holds, so an update cannot replay the entrance', () => {
    const first = mergeById([row(1)], [row(2)], { markFresh: true });
    expect(first.find(m => m.id === 2).__fresh).toBe(true);
    const second = mergeById(first, [row(2, { is_edited: true })], { markFresh: true });
    // Still fresh from the first merge, but not re-flagged — and crucially the
    // edit came through rather than being dropped by the branch that adds it.
    expect(second.find(m => m.id === 2).is_edited).toBe(true);
  });
});

describe('optimisticMessage()', () => {
  it('cannot collide with a server id', () => {
    const a = optimisticMessage('hello', { meId: 7 });
    const b = optimisticMessage('hello', { meId: 7 });
    expect(isPending(a)).toBe(true);
    expect(isPending(b)).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(isPending(row(1))).toBe(false);
    expect(isPending(row('1'))).toBe(false);
  });

  it('sorts last, because it is the newest thing in the channel', () => {
    const opt = optimisticMessage('newest', { meId: 1 });
    const out = mergeById([row(1), row(2)], [opt]);
    expect(out[out.length - 1].id).toBe(opt.id);
  });

  it('carries who sent it, so the placeholder is not an "Unknown" avatar', () => {
    const opt = optimisticMessage('hi', { meId: 7, me: { full_name: 'Keval Shah' } });
    expect(opt.sender_id).toBe(7);
    expect(opt.sender_name).toBe('Keval Shah');
    expect(opt.__pending).toBe(true);
  });
});

describe('dropSettled()', () => {
  it('retires a placeholder whose real row arrived on the poll first', () => {
    const opt = optimisticMessage('rows 14 and 27', { meId: 1 });
    const local = [row(1), opt];
    const incoming = [row(1), row(2, { content: 'rows 14 and 27', sender_id: 1 })];
    expect(dropSettled(local, incoming).map(m => m.id)).toEqual([1]);
  });

  it('keeps a placeholder the server has not echoed yet', () => {
    const opt = optimisticMessage('not sent yet', { meId: 1 });
    expect(dropSettled([opt], [row(1)])).toHaveLength(1);
  });

  it('does not retire it against an identical message from someone else', () => {
    const opt = optimisticMessage('same words', { meId: 1 });
    const incoming = [row(2, { content: 'same words', sender_id: 99 })];
    expect(dropSettled([opt], incoming)).toHaveLength(1);
  });

  it('is identity-stable when there is nothing pending, so React skips the render', () => {
    const local = [row(1), row(2)];
    expect(dropSettled(local, [row(1)])).toBe(local);
  });
});
