/**
 * DockRow.jsx — ONE row shape, four tabs.
 *
 * Proposal 72's demo is built on a single `rowEl(dot, name, meta, go)` and that
 * is the load-bearing part of it: a skill, a metric, an automation and a due
 * date are four different kinds of thing, and if each got its own row the dock
 * would read as four widgets stacked in a box rather than one surface. Same
 * height, same three slots, same focus behaviour — the tone dot and the meta
 * line carry the difference.
 *
 * `data-dockrow` is how the panel's arrow keys find the rows, following
 * `ui/Picker.jsx`'s `data-pkrow`: the roving cursor is owned by the container
 * and the rows are queried out of the DOM, so a pane can render whatever it
 * likes between them (a heading, a note) without the cursor counting it.
 *
 * `data-tone` rather than a modifier class, deliberately: `check-classes.mjs`
 * matches static class strings, and a computed `k-dock__dot--${type}` would
 * either fail it or need an entry on the DYNAMIC allow-list. An attribute
 * needs neither and the CSS reads the same.
 */
import React from 'react';

/**
 * One row.
 *
 * `reason` is why the row's ACTION is unavailable — and the row itself stays
 * fully live: readable, focusable, and openable, because the detail behind it
 * (what the skill does, what it reads, what it costs) is exactly what somebody
 * who cannot run it needs in order to ask for it. Proposal 71's first rule is
 * "say WHY a skill is greyed rather than hiding it silently"; greying the row
 * out of reach as well would hide the answer along with the button.
 *
 * The `go` chip is what disappears. A row with a reason offers no verb, so
 * nothing invites a click that would 403.
 */
export default function DockRow({
  tone, name, meta, go, reason, selected, onSelect, id,
}) {
  return (
    <button
      type="button"
      id={id}
      className="k-dock__row"
      data-dockrow=""
      data-blocked={reason ? '' : undefined}
      role="option"
      aria-selected={!!selected}
      onClick={() => onSelect?.()}
    >
      <span className="k-dock__dot" data-tone={tone} aria-hidden="true" />
      <span className="k-dock__rowmain">
        <span className="k-dock__rowname">{name}</span>
        <span className="k-dock__rowmeta">{meta}</span>
        {reason && <span className="k-dock__flag">{reason}</span>}
      </span>
      {go && !reason && <span className="k-dock__go">{go}</span>}
    </button>
  );
}

/**
 * The honest empty state.
 *
 * Proposal 71 calls this "the most valuable thing here" and it is the reason
 * the dock renders on every page rather than only where it has something: a
 * firm opening the dock on a page with nothing is telling us, with their hand,
 * on the actual page, which module they wanted help inside. Falling back to
 * "here are some popular skills" — or hiding the dock — throws that away and
 * tells a small lie besides.
 *
 * `hint` points at a tab that DOES have something, which is the four-section
 * dock's whole argument: skills reach 10 modules, automations 11, metrics 14,
 * so the empty tab is never the same tab twice.
 */
export function DockEmpty({ title, body, hint }) {
  return (
    <div className="k-dock__empty">
      <b className="k-dock__empty-t">{title}</b>
      {body && <span className="k-dock__empty-b">{body}</span>}
      {hint && <span className="k-dock__empty-b">{hint}</span>}
    </div>
  );
}

/** Loading. Three bars, no spinner — the panel is 360px wide. */
export function DockShim({ count = 4 }) {
  return (
    <div className="k-dock__shim" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span className="k-dock__shim-row" key={i} />
      ))}
    </div>
  );
}

/**
 * A refusal, which is not a failure.
 *
 * `/v1/niyam/rules` is `require_org_role(*ORG_SETTINGS_ROLES)` and `/v1/hub/*`
 * is behind `_hub_gate`, so 403 is an ORDINARY answer for most members. An
 * empty list and a refusal look identical on screen and mean opposite things:
 * one says the firm has nothing, the other says this person may not see it.
 * Same distinction `pages/dristi/_shared.jsx` draws with RestrictedNote, and
 * for the same reason.
 */
export function DockRestricted({ what, who }) {
  return (
    <div className="k-dock__empty">
      <b className="k-dock__empty-t">{what} are not yours to see.</b>
      <span className="k-dock__empty-b">{who}</span>
    </div>
  );
}
