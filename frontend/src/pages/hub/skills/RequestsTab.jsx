import React from 'react';
import { useResource, ErrorNote, Shim, stamp } from '../_shared';

/**
 * Requests — the Aekam side of the drawer's "Request this skill".
 *
 * ── WHY THIS TAB EXISTS ────────────────────────────────────────────────────
 *
 * `SkillDrawer` lets a customer ask for a skill they do not have, and
 * `POST /v1/hub/skills/{id}/request` writes the row and mails the account
 * contact. The mail was the ONLY place the ask surfaced. Nothing in this
 * product read `hub_skill_requests` except the customer's own catalogue, which
 * reads back its own org's open rows to draw a "Requested" pill.
 *
 * That is a problem because of a decision the write path makes deliberately and
 * correctly: the fan-out is wrapped so a mail failure cannot fail the
 * customer's request. The row commits and `notified_to` stays empty — the
 * truthful record of "written, nobody told" — and until this tab there was
 * nowhere that record could be read. A customer could ask, be told "Aekam has
 * it", and have the ask exist nowhere a human would look.
 *
 * ── THREE STATES, NOT TWO ──────────────────────────────────────────────────
 *
 * `GET /v1/hub/skills/requests` answers `{available, data}`. `available:false`
 * means migration 112 is unapplied, so requests cannot be RECORDED yet — which
 * is neither "nobody asked" nor "the request failed". Collapsing it into an
 * empty list would print "no requests" over a feature that was never switched
 * on, and an operator reading that would conclude the marketplace is quiet.
 *
 * ── WHAT THIS TAB DELIBERATELY DOES NOT DO ─────────────────────────────────
 *
 * IT DOES NOT GRANT, AND IT HAS NO DECIDE BUTTON. `assign_skill_to_org` grants
 * to the CALLER'S ACTIVE ORG, so granting from here would need a cross-org
 * write this product has no sanctioned path for. Migration 112 is explicit that
 * `status='granted'` is "a RECORD of the grant, not the grant itself" — so a
 * control here that flipped the status without writing `hub_org_skills` would
 * manufacture exactly the drift that column warns against. A button that
 * records a grant nobody made is worse than no button.
 *
 * `already_active` is therefore read LIVE from the grant table, per row, so the
 * queue reports what is TRUE rather than what somebody once ticked: a request
 * still marked `open` whose org already holds the skill says "already active",
 * because that is what the grant table says.
 */

/** The queue is Aekam's, so a row names an org. Nothing else about it. */
function RequestRow({ r }) {
  // NOBODY WAS TOLD. This is the fan-out having failed and it is the single
  // most important thing this screen carries — the row is the only surviving
  // trace of an ask that never reached a person. It gets its own line rather
  // than a subtle tint, because the whole point of the tab is that this case
  // stops being invisible.
  const unheard = r.status === 'open' && (r.notified_to || []).length === 0;

  return (
    <li className={`mkq__row${unheard ? ' mkq__row--unheard' : ''}`}>
      <div className="mkq__head">
        <b className="mkq__skill">{r.template_name}</b>
        <span className="mkq__org">{r.org_name}</span>
        <span className={`mkq__st mkq__st--${r.status}`}>{r.status}</span>
        {r.already_active && (
          /* Read live from `hub_org_skills`, never from `status`. An operator
             who granted the skill through the console touched no request row,
             so without this the queue keeps showing a live ask for something
             already delivered. */
          <span className="mkq__st mkq__st--active">already active</span>
        )}
      </div>

      <p className="mkq__note">
        {r.note
          ? <q>{r.note}</q>
          /* Not blank. "They left no note" is a fact about the request; an
             empty paragraph reads as a rendering failure. */
          : <span className="mkq__none">They left no note.</span>}
      </p>

      <div className="mkq__meta">
        <span>
          {r.requester_name || r.requested_by}
          {r.requester_email ? ` · ${r.requester_email}` : ''}
        </span>
        <span>{stamp(r.requested_at)}</span>
        {unheard ? (
          <b className="mkq__warn">
            Nobody was emailed about this — the notification failed. Reply to
            them directly.
          </b>
        ) : (
          <span className="mkq__told">
            Emailed to {(r.notified_to || []).join(', ')}
          </span>
        )}
      </div>

      {r.decided_at && (
        <div className="mkq__meta">
          <span>{r.status} {stamp(r.decided_at)} by {r.decided_by}</span>
        </div>
      )}
    </li>
  );
}

export default function RequestsTab() {
  const q = useResource('/v1/hub/skills/requests', []);

  if (q.loading) return <Shim count={3} />;
  if (q.error) {
    return (
      <ErrorNote
        what="The request queue"
        error={q.error}
        onRetry={q.reload}
      />
    );
  }

  // MIGRATION 112 IS UNAPPLIED. Said plainly, and not as an empty state: an
  // operator who reads "no requests" here would conclude nobody wants anything.
  if (q.data?.available === false) {
    return (
      <div className="note note--warn hb-note" role="status">
        <b>Skill requests cannot be recorded on this environment yet.</b>{' '}
        The <code>hub_skill_requests</code> table (migration 112) has not been
        created, so the request button in the catalogue refuses rather than
        writing. This is <b>not</b> the same as nobody having asked — until the
        migration runs there is nothing that could have been written. Customers
        asking today have to reach their account contact directly.
      </div>
    );
  }

  const rows = q.data?.data || [];

  if (rows.length === 0) {
    // `k-empty__sub`, not `k-empty__body` — the empty-state family is
    // __icon / __title / __sub / __cta, and __body has no rule anywhere, so
    // this paragraph rendered unstyled. check-classes caught it.
    return (
      <p className="k-empty__sub mkq__empty">
        No open requests. When a customer asks for a skill from the catalogue it
        appears here, with what they said and whether the notification reached
        anyone.
      </p>
    );
  }

  const unheard = rows.filter(
    r => r.status === 'open' && (r.notified_to || []).length === 0,
  ).length;

  return (
    <div className="mkq">
      {unheard > 0 && (
        <div className="note note--warn hb-note" role="status">
          <b>{unheard} request{unheard === 1 ? '' : 's'} reached nobody.</b>{' '}
          The row was written and the notification did not send, so these are
          asks no account contact has seen. They are marked below.
        </div>
      )}

      <ul className="mkq__list">
        {rows.map(r => <RequestRow key={r.request_id} r={r} />)}
      </ul>
    </div>
  );
}
