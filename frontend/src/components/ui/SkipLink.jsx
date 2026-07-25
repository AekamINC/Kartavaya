import React from 'react';

/**
 * First tab stop on every page. The sidebar is 15 module links plus a settings
 * group, so without this a keyboard user tabs through all of them on every
 * page load before reaching content.
 *
 * Requires <main id="main" tabIndex={-1}> — without the tabIndex the jump moves
 * the scroll position but not focus, so the next Tab continues from the nav.
 */
export default function SkipLink({ href = '#main', children = 'Skip to content' }) {
  return (
    <a className="k-skip" href={href}>
      {children}
    </a>
  );
}
