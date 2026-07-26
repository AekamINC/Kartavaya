import React from 'react';

// A fourth priority colour map, missed when the other three were converged onto
// lib/statusColors.js. It still hardcoded the retired brand blue for `medium`
// (#0082c6), so a medium-priority task showed one blue as a dot in the list and
// the token blue (--pr-medium #3E5C8A) everywhere else. Its hexes also could not
// flip with the theme. Now reads the shared map like everything else.
import { PRIORITY_COLORS } from '../../lib/statusColors';

const FALLBACK = 'var(--on-surface-3)';

export default function PriorityDot({ priority, size = 8 }) {
  return (
    <span
      className="k-pdot"
      style={{ width: size, height: size, background: PRIORITY_COLORS[priority] || FALLBACK }}
    />
  );
}
