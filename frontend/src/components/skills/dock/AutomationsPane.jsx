/**
 * AutomationsPane — the rules that watch this page, and the ones that could.
 *
 * ── ARMING IS NOT OFFERED, AND THAT IS THE FEATURE ──────────────────────────
 *
 * Proposal 72 settles this in one line: "arming from a corner popover is how a
 * firm ends up emailing its customers by accident." So there is no Arm button
 * here, no Enable, no clone-from-template, and no PATCH of any kind. Every
 * verb in this pane is `Preview`, and every way out of it is a link into the
 * builder at `/settings/automations`, where arming has a page, a confirmation
 * and an audit trail around it.
 *
 * `trigger_config` is NULL on all 78 templates and stays NULL. Nothing in this
 * directory writes to Niyam at all — the only two calls it makes are GETs.
 *
 * ── What it shows, and why both halves ──────────────────────────────────────
 *
 * LIVE RULES first, from `/v1/niyam/rules`, each with `effective_mode` rather
 * than `is_armed`. The endpoint computes that field precisely because "a UI
 * that shows only `is_armed` tells somebody their rule is live when the engine
 * is not" — the master switch can veto a rule its author believes is running.
 *
 * STARTER TEMPLATES after them, from `/v1/niyam/templates`. Without these the
 * tab would be empty for every firm that has not written a rule yet, which is
 * every firm today — and the four-section dock's whole argument is that
 * automations reach eleven modules where skills reach ten, so the empty tab is
 * never the same tab twice.
 *
 * ── Matching ────────────────────────────────────────────────────────────────
 *
 * Both endpoints decorate every row with `family` through `meta_for()`, done
 * server-side "so the picker and the builder cannot disagree about what a
 * trigger is called". `routeModules.matchesPage` reads that, plus a short list
 * of event types named per page for the handful the family grouping files
 * elsewhere (attendance, which the registry puts under `hr`).
 *
 * ── 403 is an answer ────────────────────────────────────────────────────────
 *
 * Both routes are `require_org_role(*ORG_SETTINGS_ROLES)`, so an ordinary
 * member is refused. That renders as a refusal, never as "you have no
 * automations" — those look identical and mean opposite things.
 */
import React, { useState } from 'react';
import DockRow, { DockEmpty, DockRestricted } from './DockRow';

/** What `effective_mode` means, in words rather than a colour. */
const MODE_WORD = {
  armed: 'armed — this fires for real',
  shadow: 'shadow — it records what it would have done',
  idle: 'idle — it is not running',
  off: 'off — the master switch is down',
};

export default function AutomationsPane({
  page, automations, restricted, listId, cursor, onCursor, onGo,
}) {
  const [open, setOpen] = useState(null);

  if (restricted) {
    return <DockRestricted
      what="Automations"
      who="Rules are an organisation setting. Ask an org admin or owner." />;
  }

  if (!automations.length) {
    return <DockEmpty
      title="No automation watches this page."
      body={page.note || `No event the engine can emit is filed under ${page.label}.`}
      hint="Try Skills or Numbers — the empty tab is rarely the same tab twice." />;
  }

  const selected = automations.find(a => a.key === open);

  if (selected) {
    return (
      <div className="k-dock__detail">
        <button type="button" className="k-dock__back" onClick={() => setOpen(null)}>
          ← back
        </button>
        <h4 className="k-dock__dh">{selected.name}</h4>
        {selected.why && <p className="k-dock__why">{selected.why}</p>}

        <div className="k-dock__out">
          <span className="k-dock__outline">WHEN · {selected.trigger}</span>
          <span className="k-dock__outline">
            STATE · {selected.live
              ? (MODE_WORD[selected.mode] || selected.mode)
              : 'not created — this is a starter template'}
          </span>
        </div>

        {/* Said out loud, on the surface where somebody might expect a switch. */}
        <p className="k-dock__fine">
          Arming is deliberately not offered from the corner. A rule that sends
          on your behalf gets turned on where it can be read in full.
        </p>

        <div className="k-dock__act">
          <button type="button" className="k-btn k-btn--primary"
            onClick={() => onGo('/settings/automations')}>
            Open in the builder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="k-dock__list" role="listbox" id={listId}
      aria-label={`Automations for ${page.label}`}>
      {automations.map((a, i) => (
        <DockRow
          key={a.key}
          id={`${listId}-${i}`}
          tone={a.live ? 'auto' : 'autotpl'}
          name={a.name}
          meta={a.live
            ? `on ${a.trigger} · ${MODE_WORD[a.mode] || a.mode}`
            : `on ${a.trigger} · starter template`}
          go="Preview"
          selected={cursor === i}
          onSelect={() => { onCursor(i); setOpen(a.key); }}
        />
      ))}
    </div>
  );
}
