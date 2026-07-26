/**
 * Tests for PageHeader's prop contract.
 *
 * The bug: the signature was `{ kicker, title, sanskrit, lede, right }` with no
 * rest spread, and 12 of the 38 call sites passed `subtitle` and/or `sans`
 * instead. React does not warn about an unrecognised prop on a function
 * component, so eleven pages rendered a bare title and dropped the rest —
 * silently, in production. SanvaadPage lost both its subtitle and its
 * Devanagari.
 *
 * Every call site is now canonical, but these lock the alias behaviour so the
 * failure mode cannot return: a wrong prop must render in the right place
 * rather than vanish.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not, so importing it throws.
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import PageHeader from '../components/editorial/PageHeader';

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const render = (el) => act(() => root.render(el));

const lede = () => container.querySelector('.k-pageh__lede')?.textContent ?? null;
const sans = () => container.querySelector('.k-pageh__sans')?.textContent ?? null;

describe('PageHeader', () => {
  it('renders the canonical props', () => {
    render(<PageHeader kicker="SETTINGS" title="Customize" sanskrit="सजावट" lede="Appearance" />);
    expect(container.querySelector('.k-pageh__kicker').textContent).toBe('SETTINGS');
    expect(container.querySelector('.k-pageh__h1').textContent).toContain('Customize');
    expect(sans()).toBe('सजावट');
    expect(lede()).toBe('Appearance');
  });

  it('renders `subtitle` as the lede instead of dropping it — the core regression', () => {
    render(<PageHeader title="Billing" subtitle="Manage your plan" />);
    expect(lede()).toBe('Manage your plan');
  });

  it('renders `sans` as the Devanagari term instead of dropping it', () => {
    render(<PageHeader title="Messages" sans="संवाद" />);
    expect(sans()).toBe('संवाद');
  });

  it('handles the SanvaadPage case, which used both legacy names at once', () => {
    render(<PageHeader title="Messages" sans="संवाद" subtitle="Internal messaging & WhatsApp" />);
    expect(sans()).toBe('संवाद');
    expect(lede()).toBe('Internal messaging & WhatsApp');
  });

  it('lets the canonical prop win when both spellings are passed', () => {
    render(<PageHeader title="X" sanskrit="सही" sans="गलत" lede="right" subtitle="wrong" />);
    expect(sans()).toBe('सही');
    expect(lede()).toBe('right');
  });

  it('marks the Devanagari with lang so it is not read with English rules', () => {
    // `hi`, not `sa`: none of the values passed to the `sanskrit` prop across
    // the app is a Sanskrit-only form — several (फ़ोल्डर, डेटा, खाते, संस्थाएँ)
    // are impossible in Sanskrit. See the note in PageHeader.jsx.
    render(<PageHeader title="Customize" sanskrit="सजावट" />);
    expect(container.querySelector('.k-pageh__sans').getAttribute('lang')).toBe('hi');
  });

  it('omits the optional slots entirely when absent', () => {
    render(<PageHeader title="Bare" />);
    expect(sans()).toBeNull();
    expect(lede()).toBeNull();
    expect(container.querySelector('.k-pageh__kicker')).toBeNull();
    expect(container.querySelector('.k-pageh__right')).toBeNull();
  });

  it('does not leak an unknown prop onto the DOM', () => {
    render(<PageHeader title="X" subtitle="y" />);
    expect(container.querySelector('[subtitle]')).toBeNull();
  });
});
