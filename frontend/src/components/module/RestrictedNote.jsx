import React from 'react';

/**
 * RestrictedNote — shown when the viewer has no grant for a module.
 *
 * Restricted is NOT an error and must not be styled as one: no red, no warning
 * triangle. A member without a Ganit grant who sees a red alert learns that
 * something is broken. The correct message is neutral, names who can grant
 * access, and offers the request action.
 */
export default function RestrictedNote({
  module = 'this module',
  grantedBy = 'an organisation owner or admin',
  onRequest,
}) {
  return (
    <div className="mrestrict" role="note">
      <svg className="mrestrict__ic" width="20" height="20" viewBox="0 0 20 20" fill="none"
        stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="9" width="12" height="8" rx="1.5" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      </svg>
      <div>
        <p className="mrestrict__t">You don’t have access to {module}</p>
        <p className="mrestrict__p">
          Access is granted by role, not by request approval — {grantedBy} can enable it for you.
          {onRequest && ' You can ask for it below.'}
        </p>
        {onRequest && (
          <button className="k-btn k-btn--ghost k-btn--sm" style={{ marginTop: 10 }} onClick={onRequest}>
            Request access
          </button>
        )}
      </div>
    </div>
  );
}
