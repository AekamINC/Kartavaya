/**
 * The four channels, and the one switch that is meant to govern all of them.
 *
 * `shouldDeliver` gated `push` and `email` on the person's per-kind setting and
 * gated `toast` and `sound` on the clock alone. So a kind switched OFF still
 * slid a card across the screen and still made a noise, while the two channels
 * they could not see stayed correctly silent. Off has to mean off on the
 * channel you are actually looking at, or the setting is advice.
 */
import { describe, it, expect } from 'vitest';
import { shouldDeliver } from '../context/NotificationContext';

const NO_QUIET = { enabled: false, modes: {} };
const at = new Date('2026-08-23T12:00:00Z');
const call = (modes, extra = {}) => shouldDeliver('message', {
  quiet: { ...NO_QUIET, modes }, prefs: {}, now: at, ...extra,
});

describe('shouldDeliver — off means off, on every channel', () => {
  it('delivers on all four when nothing is switched off', () => {
    const g = call({});
    expect(g.toast).toBe(true);
    expect(g.sound).toBe(true);
    expect(g.email).toBe(true);
  });

  it('silences the TOAST and the SOUND for a kind set to off', () => {
    const g = call({ message: 'off' });
    expect(g.toast).toBe(false);
    expect(g.sound).toBe(false);
    expect(g.push).toBe(false);
    expect(g.email).toBe(false);
  });

  it('honours "mine only" on the toast when the item is somebody else\'s', () => {
    const g = call({ message: 'mine_only' }, { isMine: false });
    expect(g.toast).toBe(false);
    expect(g.sound).toBe(false);
  });

  it('still toasts a "mine only" kind when the item IS mine', () => {
    const g = call({ message: 'mine_only' }, { isMine: true });
    expect(g.toast).toBe(true);
  });

  it('leaves an unset kind alone — no row means "not switched off"', () => {
    expect(call({ other: 'off' }).toast).toBe(true);
  });

  it('never gags support, whatever else is set', () => {
    const g = shouldDeliver('support', {
      quiet: { enabled: true, modes: { support: 'off' } }, prefs: { notifSound: false }, now: at,
    });
    expect(g).toEqual({ toast: true, sound: true, push: true, email: true });
  });

  it('keeps EMAIL alive through quiet hours — that channel is queued', () => {
    // A held email is delivered late. A held toast is lost, which is why the
    // clock silences one and not the other.
    const quiet = { enabled: true, start: '00:00', end: '23:59', modes: {} };
    const g = shouldDeliver('message', { quiet, prefs: {}, now: at });
    expect(g.email).toBe(true);
    expect(g.toast).toBe(false);
  });
});
