import React from 'react';

/**
 * Tag — one class, coloured by an inline --c (02-common-components.md §1).
 *
 * Replaces badge.js and folds in ColorTag.jsx. `Badge` previously existed twice
 * under the same name — ui/badge.js and editorial/ModuleUI.jsx — with different
 * tones and different markup, both exported.
 *
 * `color` must resolve to a real colour. color-mix() with an undefined custom
 * property voids the whole declaration silently and the tag loses its pill, so
 * passing something like var(--info) — which is not a token in this system —
 * fails invisibly. The semantic set is --ok / --warn / --danger.
 */
export default function Tag({ color, children, className = '', ...rest }) {
  return (
    <span
      className={`tag ${className}`.trim()}
      style={color ? { '--c': color } : undefined}
      {...rest}
    >
      {children}
    </span>
  );
}

export { Tag };
