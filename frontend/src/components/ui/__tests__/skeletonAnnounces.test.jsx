/**
 * A loading state that is drawn must also be SAID.
 *
 * ── THE DEFECT, SUITE 20.06 ON 2026-08-31 ───────────────────────────────────
 *
 * Seven of ten sampled screens announced NOTHING while loading —
 * `role=status 0, aria-busy 0`. `vetana#payslips` was the sharp one: a skeleton
 * IS drawn, so the screen looks busy to an eye and is completely silent to a
 * screen reader. Which is worse than drawing nothing, because a sighted user
 * sees progress and a blind one sees an empty page that never says why.
 *
 * The three screens that passed had each remembered to hand-write
 * `<SkeletonRegion label="…"><SkeletonList/></SkeletonRegion>`. THAT is the
 * defect: the contract lived in a wrapper every call site had to remember, and
 * `if (loading) return <SkeletonList />` — shorter, obvious, and what most
 * screens actually wrote — was silent.
 *
 * So the primitive carries the contract now. Fixing the seven call sites would
 * have left the eighth to be written next month.
 *
 * ── AND THE HALF THAT IS EASY TO GET WRONG ──────────────────────────────────
 *
 * Making the primitives announce must NOT punish the screens that already did
 * it properly: two nested `role="status" aria-live` regions make a screen
 * reader say "Loading contacts" twice. `Announced` reads a context that
 * `SkeletonRegion` provides and steps aside when one is already above it. The
 * nesting tests below are the ones that would catch a regression there, and
 * they are the reason this is a context rather than an unconditional wrapper.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SkeletonList, SkeletonRegion, Announced } from '../Skeleton';
import { Shim } from '../../../pages/vetana/_shared';

const regions = (c) => c.querySelectorAll('[role="status"]');

describe('a bare skeleton announces itself', () => {
  it('SkeletonList exposes role=status and aria-busy', () => {
    const { container } = render(<SkeletonList rows={3} />);
    const r = regions(container);
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveAttribute('aria-busy', 'true');
    expect(r[0]).toHaveAttribute('aria-live', 'polite');
  });

  it('SkeletonList says something a screen reader can read', () => {
    render(<SkeletonList rows={2} />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('a caller can name what is loading', () => {
    render(<SkeletonList rows={2} label="Loading rate cards" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading rate cards');
  });

  it('Shim announces too — vetana#payslips drew one and said nothing', () => {
    const { container } = render(<Shim count={4} />);
    expect(regions(container)).toHaveLength(1);
    expect(regions(container)[0]).toHaveAttribute('aria-busy', 'true');
  });

  it('the shimmer tiles themselves stay hidden from the reader', () => {
    // The label carries the meaning; a dozen empty tiles are noise.
    const { container } = render(<SkeletonList rows={3} />);
    expect(container.querySelector('.k-skeleton-table')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('it does NOT double-announce inside an explicit region', () => {
  it('SkeletonList inside SkeletonRegion yields exactly ONE status region', () => {
    const { container } = render(
      <SkeletonRegion label="Loading contacts"><SkeletonList rows={3} /></SkeletonRegion>,
    );
    expect(regions(container)).toHaveLength(1);
  });

  it('and the region keeps ITS label, not the primitive default', () => {
    render(<SkeletonRegion label="Loading contacts"><SkeletonList rows={3} /></SkeletonRegion>);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading contacts');
    expect(status.textContent).not.toMatch(/Loading…\s*Loading/);
  });

  it('Shim inside a region does not double up either', () => {
    const { container } = render(
      <SkeletonRegion label="Loading payslips"><Shim count={3} /></SkeletonRegion>,
    );
    expect(regions(container)).toHaveLength(1);
  });

  it('several skeletons in ONE region still announce once', () => {
    const { container } = render(
      <SkeletonRegion label="Loading the page">
        <SkeletonList rows={2} />
        <SkeletonList rows={2} />
        <Shim count={2} />
      </SkeletonRegion>,
    );
    expect(regions(container)).toHaveLength(1);
  });

  it('but two INDEPENDENT bare skeletons are two regions, which is correct', () => {
    // Anti-vacuity: if `Announced` suppressed unconditionally the tests above
    // would pass for the wrong reason and every screen would go silent again.
    const { container } = render(<><SkeletonList rows={1} /><SkeletonList rows={1} /></>);
    expect(regions(container)).toHaveLength(2);
  });

  it('Announced used directly outside a region wraps; inside, it passes through', () => {
    const bare = render(<Announced label="x"><i>c</i></Announced>);
    expect(regions(bare.container)).toHaveLength(1);
    const inside = render(
      <SkeletonRegion label="outer"><Announced label="x"><i>c</i></Announced></SkeletonRegion>,
    );
    expect(regions(inside.container)).toHaveLength(1);
  });
});
