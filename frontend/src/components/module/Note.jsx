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

export function EmptyState({ title, children, action }) {
  return (
    <div className="mempty">
      <p className="mempty__t">{title}</p>
      {children && <p className="mempty__p">{children}</p>}
      {action}
    </div>
  );
}
