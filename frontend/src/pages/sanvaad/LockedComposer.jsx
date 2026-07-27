/**
 * LockedComposer.jsx — the bar that replaces the composer, and says why.
 *
 * `ScreensSanvaad.jsx:286-294` has two of these and they are not
 * interchangeable. One is about the reader — "Your Sanvaad access is Viewer" —
 * and offers a way out. The other is about the room — "This channel is archived
 * — nobody can post, including admins" — and deliberately offers none, because
 * there is nothing the reader can ask for.
 *
 * A single "You cannot post here" would collapse the two and be wrong about
 * both: it would imply an archived channel is a permissions problem, and imply
 * a viewer's own grant cannot change.
 *
 * ── The way out is a sentence, not a button ─────────────────────────────────
 *
 * `ScreensSanvaad.jsx:293` puts a `Request Editor` button on the viewer bar,
 * and this file's own header used to promise one while rendering nothing — so
 * the viewer branch dead-ended with no way out at all, which is the one thing
 * that distinguishes it from the archived branch.
 *
 * A button is still the wrong shape here, because there is nothing behind it.
 * `RestrictedNote.jsx:26` is this app's settled answer for exactly this
 * situation: "Access is granted by role, not by request approval — an
 * organisation owner or admin can enable it for you." There is no
 * request-approval flow for grants anywhere in Kartavaya, so a `Request Editor`
 * button would either do nothing or file a request into a queue that does not
 * exist. Naming who can grant it is the way out, in the same words the rest of
 * the product already uses.
 */
import React from 'react';
import { SvIcons } from './icons';

export default function LockedComposer({ reason }) {
  if (reason === 'archived') {
    return (
      <div className="cmp cmp--locked">
        <span className="ch__ic" aria-hidden="true">{SvIcons.lock}</span>
        <span className="cmp__locked-t">
          This channel is archived — nobody can post, including admins.
        </span>
      </div>
    );
  }

  return (
    <div className="cmp cmp--locked">
      <span className="ch__ic" aria-hidden="true">{SvIcons.lock}</span>
      <span className="cmp__locked-t">
        Your Sanvaad access is <strong>Viewer</strong>: you can read every channel you are a
        member of, but not send. <span className="cmp__locked-m">Editor adds sending and
        channel creation — an organisation owner or admin can enable it for you.</span>
      </span>
    </div>
  );
}
