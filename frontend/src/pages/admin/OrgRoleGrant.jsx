/**
 * OrgRoleGrant — grant an organisation-scoped role, with what it costs.
 *
 * WHY IT EXISTS. `hr_admin`, `org_client` and `aekam_team` shipped on
 * 2026-08-06: migration 124 widened the CHECK, `CONSOLE_ASSIGNABLE_ORG_ROLES`
 * admits all four, and 19 tests cover the endpoint. Nothing could grant them.
 * The one member-adding control in the console posts to
 * `POST /v1/admin/orgs/{id}/members`, which is deliberately `org_admin`-only and
 * refuses anything else with a 400 — so three roles existed, were migrated and
 * were tested, and were reachable only by curl.
 *
 * THE ROLE LIST IS FETCHED, NOT TRANSCRIBED. `pages/admin/platformRoles.js` is a
 * hand transcription of the Tier-1 vocabulary and says so, and the catalogue
 * endpoint's own docstring gives the reason not to write a second one for
 * Tier 2: "a transcription of a billing fact is a bill that disagrees with a
 * screen the first time somebody edits one of them." `consumes_seat` decides
 * what a customer is charged, so it is READ FROM THE SERVER at the moment of
 * granting and never inferred here. If the seat model changes, this screen is
 * already right.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not invite by email. `assign` takes
 * a `user_id`, and resolving an address to an account is the invite flow's job,
 * which already exists beside this one. This changes the role of somebody the
 * organisation already has, which is the operation that had no home at all.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Field, Select } from '../../components/ui';
import { apiErrorText } from '../../lib/apiError';

/** Sentence case from a role code, for a server that sends codes and not labels. */
function roleLabel(code) {
  return String(code || '')
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}

export default function OrgRoleGrant({ orgId, orgName, members = [], canAct = true, denyReason = '', pushToast, onChanged }) {
  const [catalogue, setCatalogue] = useState(null);
  const [held, setHeld] = useState([]);
  const [userId, setUserId] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // The catalogue is the vocabulary; the org list is who holds what today.
    // Both are read together so the screen never offers a grant it cannot
    // describe, and never describes a holder it did not fetch.
    const [cat, rows] = await Promise.all([
      api.get('/v1/admin/orgs/roles/catalogue').then(r => r.data).catch(() => null),
      api.get(`/v1/admin/orgs/roles/org?org_id=${encodeURIComponent(orgId)}`)
        .then(r => r.data).catch(() => null),
    ]);
    setCatalogue(cat);
    setHeld(Array.isArray(rows) ? rows : (rows?.roles || []));
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  /* Only what the SERVER says is assignable. `assignable` is computed there from
     CONSOLE_ASSIGNABLE_ORG_ROLES, so a role retired on the server disappears
     from this list without a frontend release. */
  const options = useMemo(
    () => (catalogue?.org || []).filter(r => r.assignable),
    [catalogue],
  );

  /* The people this can act on.
     `GET /v1/admin/orgs/{id}` stopped returning `members` — the drawer's own
     comment records that — so rather than add an endpoint, the fallback is the
     role holders themselves. That matches what this control is FOR: it changes
     the role of somebody the organisation already has. An org with nobody in it
     yet has nothing to re-role, and the invite above it is the right door. */
  const people = useMemo(() => {
    if (members.length) return members;
    const seen = new Map();
    for (const h of held) {
      if (h?.user_id && !seen.has(h.user_id)) {
        seen.set(h.user_id, { user_id: h.user_id, name: h.full_name || '', email: h.email || '' });
      }
    }
    return [...seen.values()];
  }, [members, held]);

  const chosen = options.find(o => o.code === roleCode) || null;

  const grant = async () => {
    if (!userId || !roleCode) return;
    setBusy(true);
    try {
      await api.post('/v1/admin/orgs/roles/assign', {
        user_id: userId, role_code: roleCode, org_id: orgId,
      });
      setUserId(''); setRoleCode('');
      await load();
      onChanged?.();
    } catch (e) {
      // The endpoint's refusals are written to be read by a person — it names
      // the rule and the door that IS open — so it is shown rather than
      // replaced with a generic failure.
      pushToast?.({ type: 'error', title: apiErrorText(e, 'That did not go through') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="apg__sec" data-testid="org-role-grant">
      <h3 className="apg__sect">Organisation roles</h3>
      <p className="apg__lede">
        Changes what somebody already in {orgName || 'this organisation'} may reach.
        To add a new person, use the invite above.
      </p>

      <div className="adm-form adm-form--tight">
        <Field label="Person" htmlFor="org-role-person">
          {p => (
            <Select
              {...p}
              value={userId}
              disabled={!canAct || !people.length}
              title={denyReason || undefined}
              onChange={e => setUserId(e.target.value)}
            >
              <option value="">Choose a member…</option>
              {people.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email || m.user_id}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Role" htmlFor="org-role-code">
          {p => (
            <Select
              {...p}
              value={roleCode}
              disabled={!canAct || !options.length}
              title={denyReason || undefined}
              onChange={e => setRoleCode(e.target.value)}
            >
              <option value="">Choose a role…</option>
              {options.map(o => (
                <option key={o.code} value={o.code}>{roleLabel(o.code)}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {/* THE SEAT CONSEQUENCE, AT THE POINT OF GRANTING, FROM THE SERVER.
          `org_client` and `aekam_team` consume NO seat by the owner's decision —
          a client collaborating on their own project is not a licensed user —
          and an operator cannot be expected to remember which. Reading it from
          `consumes_seat` means this sentence cannot drift from the bill. */}
      {chosen && (
        <p className="apg__lede" data-testid="role-consequence">
          {chosen.consumes_seat
            ? <><b>Uses a seat.</b> {orgName || 'The organisation'} is billed for this person.</>
            : <><b>No seat.</b> This role is not billed.</>}
          {chosen.project_only && (
            <> Project work only — {chosen.surfaces.join(', ')} and nothing else.</>
          )}
        </p>
      )}

      <div className="adm-actions">
        <Button
          variant="out" size="sm"
          disabled={!canAct || !userId || !roleCode || busy}
          title={denyReason || undefined}
          onClick={grant}
        >
          {busy ? 'Granting…' : 'Grant role'}
        </Button>
        {!canAct && <span className="apg__secn">{denyReason}</span>}
      </div>

      {held.length > 0 && (
        <ul className="adm-mods" data-testid="role-holders">
          {held.map(h => (
            <li className="adm-mod__s" key={`${h.user_id}:${h.role_code}`}>
              {h.email || h.user_id} — {roleLabel(h.role_code)}
              {h.consumes_seat === false && <span className="apg__secn"> · no seat</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
