/**
 * Unit tests for frontend/src/lib/utils.js
 *
 * These are pure-function tests — no React, no DOM, no network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cn,
  userInitials,
  avatarColor,
  priorityColor,
  relTime,
  PRIORITY_COLOR,
  AVATAR_COLORS,
} from '../lib/utils';

// ── cn (class merging) ────────────────────────────────────────────────────────

describe('cn()', () => {
  it('returns a single class unchanged', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('merges multiple classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('deduplicates conflicting Tailwind utilities (last wins)', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('handles conditional object syntax', () => {
    expect(cn({ 'font-bold': true, italic: false })).toBe('font-bold');
  });
});

// ── userInitials ──────────────────────────────────────────────────────────────

describe('userInitials()', () => {
  it('returns initials for a two-word name', () => {
    expect(userInitials('John Doe')).toBe('JD');
  });

  it('returns single initial for one-word name', () => {
    expect(userInitials('Alice')).toBe('A');
  });

  it('uppercases the result', () => {
    expect(userInitials('ravi kumar')).toBe('RK');
  });

  it('returns ? for empty or null name', () => {
    expect(userInitials('')).toBe('?');
    expect(userInitials(null)).toBe('?');
    expect(userInitials(undefined)).toBe('?');
  });

  it('caps at 2 characters for multi-word names', () => {
    expect(userInitials('A B C D').length).toBeLessThanOrEqual(2);
  });
});

// ── avatarColor ───────────────────────────────────────────────────────────────

describe('avatarColor()', () => {
  it('returns a hex color string', () => {
    const color = avatarColor('Alice');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic for the same name', () => {
    expect(avatarColor('Alice')).toBe(avatarColor('Alice'));
  });

  it('returns a valid color from AVATAR_COLORS palette', () => {
    const color = avatarColor('Bob');
    expect(AVATAR_COLORS).toContain(color);
  });

  it('returns the first palette color for null/empty', () => {
    expect(avatarColor(null)).toBe(AVATAR_COLORS[0]);
    expect(avatarColor('')).toBe(AVATAR_COLORS[0]);
  });

  it('returns different colors for clearly different names', () => {
    // Not guaranteed to differ, but highly likely for these two
    const colors = new Set(AVATAR_COLORS.map((_, i) => avatarColor(`User${i * 100}`)));
    expect(colors.size).toBeGreaterThan(1);
  });
});

// ── priorityColor ─────────────────────────────────────────────────────────────

describe('priorityColor()', () => {
  it('returns the urgent color for "urgent"', () => {
    expect(priorityColor('urgent')).toBe(PRIORITY_COLOR.urgent);
  });

  it('returns the high color for "high"', () => {
    expect(priorityColor('high')).toBe(PRIORITY_COLOR.high);
  });

  it('returns medium color for "medium"', () => {
    expect(priorityColor('medium')).toBe(PRIORITY_COLOR.medium);
  });

  it('returns low color for "low"', () => {
    expect(priorityColor('low')).toBe(PRIORITY_COLOR.low);
  });

  it('returns default color for unknown priority', () => {
    expect(priorityColor('critical')).toBe(PRIORITY_COLOR._default);
    expect(priorityColor(undefined)).toBe(PRIORITY_COLOR._default);
    expect(priorityColor(null)).toBe(PRIORITY_COLOR._default);
    expect(priorityColor('')).toBe(PRIORITY_COLOR._default);
  });

  it('all known priorities return a design token reference', () => {
    // Priority colour is a token reference, not a hex. 00-tokens.md §9 requires
    // these to flip with the theme (--pr-urgent/--pr-high alias --danger/--warn),
    // and a baked hex cannot flip — that is the defect this replaced.
    const tokenRe = /^var\(--[a-z0-9-]+\)$/;
    ['urgent', 'high', 'medium', 'low'].forEach((p) => {
      expect(priorityColor(p)).toMatch(tokenRe);
    });
  });
});

// ── relTime ───────────────────────────────────────────────────────────────────

describe('relTime()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for null/undefined', () => {
    expect(relTime(null)).toBe('');
    expect(relTime(undefined)).toBe('');
    expect(relTime('')).toBe('');
  });

  it('shows seconds for < 60s ago', () => {
    const ts = new Date('2026-01-01T11:59:45Z').toISOString();
    expect(relTime(ts)).toMatch(/^\d+s ago$/);
  });

  it('shows minutes for 1–59 min ago', () => {
    const ts = new Date('2026-01-01T11:30:00Z').toISOString();
    expect(relTime(ts)).toMatch(/^\d+m ago$/);
  });

  it('shows hours for 1–23 h ago', () => {
    const ts = new Date('2026-01-01T09:00:00Z').toISOString();
    expect(relTime(ts)).toMatch(/^\d+h ago$/);
  });

  it('shows days for >= 24 h ago', () => {
    const ts = new Date('2025-12-30T12:00:00Z').toISOString();
    expect(relTime(ts)).toMatch(/^\d+d ago$/);
  });

  it('returns empty string for invalid date string', () => {
    expect(relTime('not-a-date')).toBe('');
  });
});

// ── PRIORITY_COLOR object integrity ───────────────────────────────────────────

describe('PRIORITY_COLOR object', () => {
  const required = ['urgent', 'high', 'medium', 'low', '_default'];

  required.forEach((key) => {
    it(`has key "${key}" as a design token reference`, () => {
      expect(PRIORITY_COLOR[key]).toMatch(/^var\(--[a-z0-9-]+\)$/);
    });
  });

  it('urgent is distinct from medium', () => {
    expect(PRIORITY_COLOR.urgent).not.toBe(PRIORITY_COLOR.medium);
  });

  it('carries no baked hex — a literal cannot flip with the theme', () => {
    Object.values(PRIORITY_COLOR).forEach((v) => {
      expect(v).not.toMatch(/#[0-9a-f]{3,8}/i);
    });
  });
});
