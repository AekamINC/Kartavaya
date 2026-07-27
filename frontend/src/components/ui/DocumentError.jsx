/**
 * DocumentError — why a document was refused, left on screen.
 *
 * The document endpoints answer 422 with a structured refusal listing every
 * mandatory field that is missing and where to set it. `describeDocumentError`
 * turns that into a title and a sentence; this renders it.
 *
 * It is an inline `role="alert"` block rather than a toast because these are
 * WORKLISTS, not notifications: "this challan has no TAN" is something the user
 * leaves the screen to go and fix, and a message that has faded by the time
 * they come back has told them nothing. A refusal is also not a failure — the
 * backend declined to emit a document that would have LOOKED complete — so the
 * copy must never read as a crash.
 */
import React from 'react';

export default function DocumentError({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="docerr" role="alert">
      <div className="docerr__body">
        <p className="docerr__t">{error.title}</p>
        {error.message && <p className="docerr__m">{error.message}</p>}
      </div>
      {onDismiss && (
        <button type="button" className="docerr__x" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
