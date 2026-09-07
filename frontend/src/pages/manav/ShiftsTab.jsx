// Manav → Shifts. Four sub-views under one tab.
//
// The sub-navigation was four buttons each carrying a nine-property inline
// style object, including the active underline, recomputed per render. It is
// now a real tablist: `.mn-sub`, arrow-key navigable, with `aria-selected`
// rather than a bold font weight as the only cue.
import React from 'react';
import useUrlView from '../../hooks/useUrlView';
import { useToast } from '../../components/ui/toast';
import ShiftDefinitions from './ShiftDefinitions';
import ScheduleGrid from './ScheduleGrid';
import ShiftBids from './ShiftBids';
import SwapRequests from './SwapRequests';

const VIEWS = ['definitions', 'schedules', 'bids', 'swaps'];

export default function ShiftsTab() {
  const { pushToast } = useToast();
  /* The sub-view is in the URL — see `hooks/useUrlView.js`. Held in state it
     could not be opened in a second tab beside another, and a refresh dropped
     the reader back on Definitions whichever view they were working in. */
  const { value: view, select: setView, linkProps } = useUrlView('view', VIEWS, 'definitions');

  // Left/Right move between sub-views, which is what a tablist is expected to
  // do. Without it the only way through is Tab, and Tab has to walk every
  // control in the panel before it reaches the next tab.
  function onKeyDown(e) {
    const i = VIEWS.indexOf(view);
    if (e.key === 'ArrowRight') { e.preventDefault(); setView(VIEWS[(i + 1) % VIEWS.length]); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setView(VIEWS[(i - 1 + VIEWS.length) % VIEWS.length]); }
  }

  return (
    <div>
      <div className="mn-sub" role="tablist" aria-label="Shift views" onKeyDown={onKeyDown}>
        {VIEWS.map(v => (
          /* An anchor, so a sub-view can be ctrl-clicked into a second tab.
             `linkProps` carries the href, the plain-click interception and the
             Space key together — see the hook for why all three. A bare block
             comment, not the braced JSX form: this is the arrow function's
             expression position, where braces are parsed as a block. */
          <a
            key={v}
            {...linkProps(v)}
            role="tab"
            id={`mn-shift-tab-${v}`}
            aria-selected={view === v}
            aria-controls={`mn-shift-panel-${v}`}
            tabIndex={view === v ? 0 : -1}
            className={`mn-sub__b${view === v ? ' on' : ''}`}
          >
            {v}
          </a>
        ))}
      </div>

      <div role="tabpanel" id={`mn-shift-panel-${view}`} aria-labelledby={`mn-shift-tab-${view}`}>
        {view === 'definitions' && <ShiftDefinitions pushToast={pushToast} />}
        {view === 'schedules' && <ScheduleGrid pushToast={pushToast} />}
        {view === 'bids' && <ShiftBids pushToast={pushToast} />}
        {view === 'swaps' && <SwapRequests pushToast={pushToast} />}
      </div>
    </div>
  );
}
