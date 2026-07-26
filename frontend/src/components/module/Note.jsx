import React from 'react';

/**
 * Note — a block that states a constraint honestly (13-module-pages.md §1).
 *
 * Used for the things the module screens have to say out loud: a leave crossing
 * the payroll cut-off, OTP signing not being a DSC, a pivot that excluded rows
 * the viewer cannot see. Variant carries severity, not decoration.
 */
export default function Note({ variant, children }) {
  return (
    <div className={`note${variant ? ` note--${variant}` : ''}`}>
      {children}
    </div>
  );
}

/* THE SECOND `EmptyState` IS GONE.
 *
 * This file exported an `EmptyState` on `.mempty` while `ui/EmptyState.jsx`
 * exports one on `.empty` — two different components under one name, which is
 * the kind of duplication that only ever gets found by accident. They were not
 * equivalent: this one took `title`/`children`/`action` and rendered three bare
 * elements; the ui one takes `illustration`/`icon`/`title`/`description`/
 * `action`/`onAction`/`tone`, carries eight SVG illustrations, handles a
 * bilingual `{ en, hi | gu }` title WITH the matching `lang` attribute, and has
 * the `tone="ok"` state that distinguishes "finished" from "empty".
 *
 * Converging them cost nothing, because this one had ZERO importers. Only four
 * files import from `components/module/Note`, and all four take the default
 * export:
 *
 *   pages/esign/DetailTab.jsx          `import Note from …`
 *   pages/EsignPage.jsx                `import Note from …`
 *   pages/pahchan/EnrollQueue.jsx      `import Note from …`  (and separately
 *                                       imports the REAL EmptyState from ui/)
 *   pages/pahchan/PahchanPolicy.jsx    `import Note from …`
 *
 * `EnrollQueue.jsx` is the proof the name collision was already live: it sits
 * one import line away from both and reaches past this one for the ui version.
 *
 * `ui/EmptyState.jsx` is the survivor. `editorial/ModuleUI.jsx`'s `Empty` is
 * already a thin pass-through to it, so the module surfaces route there too —
 * one empty state, one class, one set of props.
 *
 * The `.mempty` / `.mempty__t` / `.mempty__p` rules go with it: `grep -rn
 * mempty frontend/src` showed this component was their only user.
 */
