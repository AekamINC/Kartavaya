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
        channel creation.</span>
      </span>
    </div>
  );
}
