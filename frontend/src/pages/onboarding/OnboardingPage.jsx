import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { useToast, Button } from '../../components/ui';
import { latchOnboardingDone } from '../../components/layout/Protected';
import '../../styles/auth.css';

import StepProfile from './StepProfile';
import StepOrg from './StepOrg';
import StepModules from './StepModules';
import StepInvite from './StepInvite';
import StepTemplate from './StepTemplate';
import StepDone from './StepDone';
import { OB_PRESETS, OB_TEMPLATES } from './data';
import { Check, ChevLeft } from './icons';

/**
 * OnboardingWizard — 12-auth-onboarding.md §2.
 *
 *   StepRail
 *   StepProfile · StepOrg · StepModules · StepInvite · StepTemplate
 *   StepDone   or SkippedSummary
 *
 * WHAT THIS FILE IS HONEST ABOUT — RECHECKED AGAINST THE ROUTERS, 2026-08-06
 *
 * 1. There is still no `GET/POST /v1/onboarding` for RESUME STATE. 12 §4 lists
 *    it as NEW and no such route exists, so resume is the local `kv_onboarding`
 *    write that the same paragraph asks for — and only that. Dropping off on a
 *    phone does NOT resume on a laptop; the footer says "Saved on this device"
 *    and means it.
 *
 * 2. FOUR of the five steps now reach the server, and the note that used to
 *    stand here — "there is no endpoint for a user profile, an organisation
 *    record, or an org's enabled module set" — was two thirds wrong by the time
 *    anyone checked. `PATCH /v1/org/profile` (`routers/org_profile.py`) takes
 *    `name`, `industry` and `team_size`, which is exactly StepOrg's three
 *    fields; `PATCH /v1/org/modules` (`routers/org_modules.py`) takes
 *    `{code, active}[]`, which is exactly StepModules' output. Both are wired.
 *
 *    The one that really has no endpoint is the USER'S OWN NAME. Every
 *    `UPDATE users SET` in the backend is a password reset, an admin edit
 *    through `invite_router`, or the mobile-number write in `org_members.py`;
 *    there is no self-serve profile route. StepProfile therefore still saves
 *    locally, and StepDone still reports what landed rather than what was typed.
 *
 * 3. THE WIZARD NOW CLOSES ITSELF. `POST /v1/org/profile/onboarding-complete`
 *    clears `staging.organisations.onboarding_complete`, which is the flag
 *    `Protected.jsx` redirects on. Before this, `finish()` removed a
 *    localStorage key and navigated, so nothing the user did here was ever
 *    visible to the gate — see `finish()` for why the navigation does not wait
 *    on that write.
 *
 * WHO SEES WHICH STEPS, and the three different role tests behind it:
 *
 *   · `isOrgOwner` (org_owner OR org_admin) decides which STEPS render. An
 *     invited member skips Organisation and Modules — AUTH-SPEC: "An invited
 *     user must not see module selection — the org already decided" — and skips
 *     Team, because `POST /v1/org/invites` is `require_org_role('org_admin',
 *     'org_owner')` and offering a form that will 403 is worse than not
 *     offering it. An invited ADMIN does still get the step.
 *   · `canSaveOrg` is the same set, because `PATCH /v1/org/profile` carries the
 *     same `ORG_SETTINGS_ROLES` guard.
 *   · `canSetModules` is NARROWER — org_owner alone. `patch_modules` is
 *     `require_org_role(*ORG_OWNER_ONLY)`, so an org_admin gets the step and
 *     can pick, but the switch is not theirs to throw and the step says so
 *     rather than collecting a choice and 403ing on Continue.
 */

const KEY = 'kv_onboarding';

const ALL_STEPS = [
  { id: 'profile', label: 'Profile' },
  { id: 'org', label: 'Organisation' },
  { id: 'modules', label: 'Modules' },
  { id: 'invite', label: 'Team' },
  { id: 'project', label: 'Project' },
];

const DEFAULT_INDUSTRY = 'CA / Legal practice';

function blankState(user) {
  return {
    name: user?.name || '',
    org: '',
    industry: DEFAULT_INDUSTRY,
    size: 'Just me',
    modules: OB_PRESETS[DEFAULT_INDUSTRY],
    modulesTouched: false,
    invites: [],
    project: '',
    template: 'gst',
    sentInvites: 0,
    createdProject: '',
    //: What actually reached the server, so StepDone can tick what landed and
    //: leave the rest dashed. Persisted with the rest of the wizard state
    //: because a refresh mid-flow must not turn a completed write back into a
    //: pending one.
    orgSaved: false,
    modulesApplied: 0,
  };
}

/**
 * `kv_onboarding` is written by whichever version of this wizard the user last
 * opened, and the invite roles changed vocabulary — `member`/`admin` (account
 * types) to `org_member`/`org_admin` (what `staging.user_roles` stores and what
 * `POST /v1/org/invites` validates). A half-finished list from before the change
 * would otherwise be sent as `Invalid role: member`, one 400 per person.
 */
function normaliseInvites(list) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => ({
    ...x,
    role: x?.role === 'admin' ? 'org_admin' : x?.role === 'member' ? 'org_member' : (x?.role || 'org_member'),
  }));
}

function load(user) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const merged = { ...blankState(user), ...saved };
      return { ...merged, invites: normaliseInvites(merged.invites) };
    }
  } catch { /* corrupt entry is the same as no entry */ }
  return blankState(user);
}

/**
 * Shape a fresh project's columns to the chosen template.
 *
 * `POST /teams` seeds five defaults server-side, so the template is applied by
 * renaming in place and then adding or removing the difference — never by
 * creating the template's columns alongside the defaults, which would leave an
 * eight-column board nobody asked for.
 *
 * Returns true only if the whole shape landed. A partial result is reported as
 * a partial result.
 */
async function applyTemplateColumns(teamId, cols) {
  const res = await api.get(`/projects/${teamId}/columns`);
  const existing = Array.isArray(res.data) ? [...res.data].sort((a, b) => a.sort_order - b.sort_order) : [];

  for (let i = 0; i < cols.length; i += 1) {
    const isDone = i === cols.length - 1;
    if (existing[i]) {
      if (existing[i].name !== cols[i] || existing[i].is_done !== isDone) {
        await api.put(`/projects/${teamId}/columns/${existing[i].column_id}`, { name: cols[i], is_done: isDone });
      }
    } else {
      await api.post(`/projects/${teamId}/columns`, { name: cols[i], is_done: isDone });
    }
  }
  // Surplus defaults, deleted last so the board is never briefly empty.
  for (let i = existing.length - 1; i >= cols.length; i -= 1) {
    await api.delete(`/projects/${teamId}/columns/${existing[i].column_id}`);
  }
  return true;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const user = useMemo(() => currentUser(), []);

  const isOrgOwner = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return (user.org_roles || []).some((r) => r.role_code === 'org_owner' || r.role_code === 'org_admin');
  }, [user]);

  /**
   * ONLY an org_owner may switch a module on or off.
   *
   * `patch_modules` is `require_org_role(*ORG_OWNER_ONLY)` and
   * `ORG_OWNER_ONLY` is the single-element tuple `("org_owner",)`
   * (`middleware/role_tiers.py:304`) — narrower than the `ORG_SETTINGS_ROLES`
   * that guards the profile PATCH and the invite POST. An org_admin who reaches
   * this step can still see and choose, and the step says plainly that the
   * switch is the owner's; collecting the choice and then 403ing on Continue is
   * the failure this whole run exists to stop shipping.
   */
  const canSetModules = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return (user.org_roles || []).some((r) => r.role_code === 'org_owner');
  }, [user]);

  const steps = useMemo(
    () => (isOrgOwner ? ALL_STEPS : ALL_STEPS.filter((s) => s.id === 'profile' || s.id === 'project')),
    [isOrgOwner],
  );

  const [state, setState] = useState(() => load(user));
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Steps finished with the primary button. Skipping never lands here. */
  const [applied, setApplied] = useState([]);
  /** True when the user left by "Skip setup entirely" rather than by walking. */
  const [skippedAll, setSkippedAll] = useState(false);
  /**
   * `GET /v1/org/modules`, or null while it is unread and `[]` if it failed.
   *
   * The grid MUST NOT be drawn from `OB_MODULES` alone. That list is twelve
   * hardcoded cards, and the endpoint behind Continue refuses three separate
   * kinds of entry: a BUNDLED module (`sahayak`, `esign`) is a plan feature with
   * no row to toggle and comes back 400; a module the org is not subscribed to
   * comes back 403 "not part of this organisation's subscription"; and switching
   * one off while another depends on it comes back 400. A card that looks
   * identical to its neighbour and fails on save is the same defect in a new
   * place, so the catalogue decides what is offered and what is merely shown.
   */
  const [catalogue, setCatalogue] = useState(null);

  // 12 §4: "the client also writes kv_onboarding locally so a refresh doesn't
  // lose a step". Server-side resume waits on GET/POST /v1/onboarding.
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, [state]);

  // Re-preselect on industry change, but never over a choice the user made.
  useEffect(() => {
    setState((s) => (s.modulesTouched ? s : { ...s, modules: OB_PRESETS[s.industry] || OB_PRESETS.Other }));
  }, [state.industry]);

  /**
   * What this org can actually switch. Read once, for the people who get the
   * step at all.
   *
   * A failure resolves to `[]` rather than staying null, and `[]` means "we
   * could not ask": the step falls back to the local-only behaviour it had
   * before, and StepDone reports the module row as pending. Nothing here is
   * allowed to block the wizard — the catalogue makes the step honest, it is not
   * a dependency of finishing.
   */
  useEffect(() => {
    if (!isOrgOwner) return undefined;
    let live = true;
    api.get('/v1/org/modules')
      .then((r) => { if (live) setCatalogue(Array.isArray(r.data?.modules) ? r.data.modules : []); })
      .catch(() => { if (live) setCatalogue([]); });
    return () => { live = false; };
  }, [isOrgOwner]);

  /**
   * Drop anything the org cannot have from an UNTOUCHED preselection.
   *
   * `OB_PRESETS` is a guess made from an industry, not from a subscription, so
   * "Manufacturing" preselects `vikray` for an org that has never been sold it.
   * Left alone, the summary would then claim five modules where three were
   * possible. A selection the user has touched is never rewritten — same rule
   * as the industry effect above, and for the same reason.
   */
  useEffect(() => {
    if (!Array.isArray(catalogue) || catalogue.length === 0) return;
    const usable = new Set(catalogue.filter((m) => m.toggleable || m.bundled).map((m) => m.code));
    setState((s) => {
      if (s.modulesTouched) return s;
      const next = s.modules.filter((c) => usable.has(c));
      return next.length === s.modules.length ? s : { ...s, modules: next };
    });
  }, [catalogue]);

  const go = useCallback((n) => {
    setDir(n > i ? 1 : -1);
    setI(Math.max(0, Math.min(steps.length - 1, n)));
  }, [i, steps.length]);

  const markApplied = (id) => setApplied((a) => (a.includes(id) ? a : [...a, id]));

  /**
   * Leave the wizard, and tell the server it is done.
   *
   * ── THE ORDER IS THE WHOLE THING ─────────────────────────────────────────
   *
   * The latch is set FIRST, before the request, and the navigation happens
   * whether or not the request lands. `Protected.jsx` redirects an org whose
   * `onboarding_complete` is false onto `/onboarding`, so if the completion
   * write were allowed to gate the exit, a user whose POST failed would be
   * navigated to `/dashboard` and immediately bounced back here — a loop with no
   * end, costing one `/auth/me` per lap, with every press of "Go to dashboard"
   * doing exactly the same thing.
   *
   * `latchOnboardingDone()` is the session-scoped key the gate also reads, so
   * the failure costs the user nothing for the rest of the sitting and the
   * wizard is re-offered tomorrow — which is right, because setup genuinely was
   * not recorded. The toast says so rather than pretending it saved.
   *
   * `noRetry`: `lib/api.js` retries 502/503/504 three times, and there is no
   * reason to hold somebody on a summary screen for four round-trips over a
   * write whose failure the latch has already absorbed.
   */
  const finish = async () => {
    latchOnboardingDone();
    try { localStorage.removeItem(KEY); } catch { /* nothing to clean up */ }
    try {
      await api.post('/v1/org/profile/onboarding-complete', { skipped: skippedAll }, { noRetry: true });
    } catch {
      pushToast({
        type: 'warning',
        title: 'Setup finished, but we could not record it',
        message: 'Everything you did was saved. You may be asked to set up again next time.',
      });
    }
    navigate('/dashboard', { replace: true });
  };

  const step = steps[i];
  const last = i === steps.length - 1;

  const advance = (applyId) => {
    if (applyId) markApplied(applyId);
    if (last) setDone(true); else go(i + 1);
  };

  const skipAll = () => { setApplied([]); setSkippedAll(true); setDone(true); };

  /**
   * StepOrg → `PATCH /v1/org/profile`.
   *
   * The three fields are the three `ProfileUpdate` declares under those names —
   * `name`, `industry`, `team_size` — and `team_size` is TEXT holding a BAND
   * ("11–50"), which is what `TEAM_SIZES` offers and what the column was
   * deliberately typed for. A failure is reported and the wizard continues: the
   * name of an organisation is not worth stranding somebody over, and StepDone
   * leaves the row dashed rather than claiming it.
   *
   * The 503 case is real and specific — `PATCH` refuses outright when
   * `PROPOSED_068_org_profile_fields.sql` has not been applied, because
   * `industry` and `team_size` are columns that migration adds. It names itself
   * in `detail`, so the toast passes that through rather than inventing a reason.
   */
  const saveOrg = async () => {
    const name = state.org.trim();
    if (!name) { advance(null); return; }
    setBusy(true);
    try {
      await api.patch(
        '/v1/org/profile',
        { name, industry: state.industry, team_size: state.size },
        { noRetry: true },
      );
      setState((s) => ({ ...s, orgSaved: true }));
      advance('org');
    } catch (err) {
      pushToast({
        type: 'warning',
        title: 'Organisation details were not saved',
        message: err?.response?.data?.detail
          || 'They are held on this device — set them in Settings → Organisation.',
      });
      advance(null);
    } finally { setBusy(false); }
  };

  /** Codes this org may actually switch here, from the catalogue. */
  const toggleable = useMemo(
    () => (Array.isArray(catalogue) ? catalogue.filter((m) => m.toggleable) : []),
    [catalogue],
  );

  /**
   * StepModules → `PATCH /v1/org/modules`, and ONLY the delta.
   *
   * Sending the twelve cards as they stand would be refused three different
   * ways (see `catalogue`), so the body is built from the catalogue: toggleable
   * rows only, and only those whose desired state differs from their current
   * one. An empty delta is not an error and is not a request — the user picked
   * exactly what the org already had.
   *
   * When nothing can be sent — an org_admin rather than an owner, or a
   * catalogue we could not read — this falls back to the local-only behaviour
   * the step has always had, and StepDone reports the row as pending. That is
   * the honest ending, not a silent success.
   */
  const applyModules = async () => {
    if (!canSetModules || !toggleable.length) { advance('modules'); return; }
    const delta = toggleable
      .filter((m) => Boolean(m.active) !== state.modules.includes(m.code))
      .map((m) => ({ code: m.code, active: state.modules.includes(m.code) }));
    if (!delta.length) {
      setState((s) => ({ ...s, modulesApplied: s.modulesApplied || 0 }));
      advance('modules');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/v1/org/modules', { modules: delta }, { noRetry: true });
      setState((s) => ({ ...s, modulesApplied: delta.length }));
      setCatalogue((c) => (Array.isArray(c) ? c.map((m) => {
        const hit = delta.find((d) => d.code === m.code);
        return hit ? { ...m, active: hit.active } : m;
      }) : c));
      advance('modules');
    } catch (err) {
      pushToast({
        type: 'warning',
        title: 'Modules were not changed',
        message: err?.response?.data?.detail
          || 'Your picks are held on this device — change them in Settings → Modules.',
      });
      advance(null);
    } finally { setBusy(false); }
  };

  const sendInvites = async () => {
    if (!state.invites.length) { advance(null); return; }
    setBusy(true);
    let sent = 0;
    const failed = [];
    for (const inv of state.invites) {
      try {
        /**
         * `POST /v1/org/invites` — the ORGANISATION's own invite endpoint, not
         * Aekam's platform console.
         *
         * This step used to post to `/admin/invites`, which is
         * `invite_router.py` behind `require_platform_role(*CONSOLE_ROLES)`.
         * That dependency reads `staging.user_roles WHERE org_id IS NULL`, and
         * a customer's org_owner has no such row — so the invite step **403'd
         * for exactly the people who run onboarding**. Aekam staff were the
         * only ones it worked for, and for them it wrote `org_id NULL`, which
         * creates an account belonging to no organisation.
         *
         * `routers/org_invites.py` is the endpoint that produces an actual
         * membership: it writes `user_roles` and `org_member_modules` on
         * acceptance, counts the seat against the org's cap, and refuses to let
         * an admin mint an owner. It is guarded by `require_org_role`, which
         * the owner running this wizard passes.
         *
         * `noRetry` is load-bearing, not caution, and it carries over. The
         * response interceptor in lib/api.js retries 502/503/504 up to three
         * times, and this endpoint SENDS AN EMAIL. Measured in the browser: one
         * call against a 503 put FOUR requests on the wire. A gateway 503 in
         * the Railway restart window — the exact case that retry was written
         * for — arrives after the backend has already created the invite and
         * emailed the person, so each retry mails them again. Four identical
         * invitations to a colleague is not a transient failure the user can
         * undo.
         */
        await api.post(
          '/v1/org/invites',
          { email: inv.email, org_role: inv.role },
          { noRetry: true },
        );
        sent += 1;
      } catch (err) {
        failed.push(`${inv.email}${err?.response?.data?.detail ? ` — ${err.response.data.detail}` : ''}`);
      }
    }
    setBusy(false);
    setState((s) => ({ ...s, sentInvites: sent }));
    if (failed.length) {
      pushToast({
        type: sent ? 'warning' : 'error',
        title: sent ? `${sent} sent, ${failed.length} could not be` : 'No invitations were sent',
        message: failed.slice(0, 3).join(' · '),
      });
    }
    advance(sent > 0 ? 'invite' : null);
  };

  const createProject = async () => {
    const name = state.project.trim();
    if (!name) { advance(null); return; }
    setBusy(true);
    try {
      // Same hazard as the invite POST above, one step less severe: `POST
      // /teams` is a non-idempotent create, so a retried 503 leaves duplicate
      // projects behind and the flow then shapes the columns of whichever
      // team_id came back last, orphaning the rest. Nothing is emailed, so the
      // damage is recoverable — but four projects from one press is still the
      // user's mess to clean up.
      const res = await api.post('/teams', { name }, { noRetry: true });
      const teamId = res.data?.team_id;
      const tpl = OB_TEMPLATES.find((t) => t.id === state.template);
      setState((s) => ({ ...s, createdProject: name }));
      if (teamId && tpl && tpl.id !== 'blank') {
        try {
          await applyTemplateColumns(teamId, tpl.cols);
        } catch {
          // The project exists; only its columns are short. Say which half worked.
          pushToast({
            type: 'warning',
            title: 'Project created, columns not fully applied',
            message: 'Adjust the columns on the board — nothing else is affected.',
          });
        }
      }
      markApplied('project');
      setDone(true);
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not create the project',
        message: err?.response?.data?.detail || 'Try again, or create it from the dashboard.',
      });
    } finally { setBusy(false); }
  };

  /**
   * EVERY LABEL STATES WHAT THE PRESS ACTUALLY DOES, and every one of them
   * falls back to plain "Continue" when the press would send nothing — at which
   * point the handler returns before any request is made. That rule is what
   * keeps the button from promising a write it cannot perform, and it is now
   * the rule for four steps rather than two.
   *
   * `modules` used to read "Turn on N modules" while turning on nothing, was
   * corrected to "Continue with N modules" for exactly that reason, and now
   * counts the CHANGES it is about to send rather than the cards that are lit.
   * "Continue with 4 modules" over a delta of one was true and unhelpful; the
   * number that matters is what the press changes.
   *
   * An org_admin, and anyone whose catalogue could not be read, gets plain
   * "Continue" here — see `canSetModules`.
   */
  const nInv = state.invites.length;
  const nModuleChanges = (canSetModules ? toggleable : [])
    .filter((m) => Boolean(m.active) !== state.modules.includes(m.code)).length;
  const primary = {
    profile: { label: 'Continue', run: () => advance(state.name.trim() ? 'profile' : null) },
    org: { label: state.org.trim() ? 'Save and continue' : 'Continue', run: saveOrg },
    modules: {
      label: nModuleChanges
        ? `Apply ${nModuleChanges} change${nModuleChanges === 1 ? '' : 's'}`
        : 'Continue',
      run: applyModules,
    },
    invite: {
      label: nInv ? `Email ${nInv} invitation${nInv === 1 ? '' : 's'}` : 'Continue',
      run: sendInvites,
    },
    project: { label: state.project.trim() ? 'Create project' : 'Continue', run: createProject },
  }[step.id];

  if (done) {
    return (
      <div className="ob">
        <span className="ob__wm" lang="hi" aria-hidden="true">कर्तव्य</span>
        <div className="ob__inner">
          <StepDone state={state} applied={applied} onFinish={finish} />
        </div>
      </div>
    );
  }

  return (
    <div className="ob">
      <span className="ob__wm" lang="hi" aria-hidden="true">कर्तव्य</span>
      <div className="ob__inner">
        <ol className="ob__rail">
          {steps.map((s, n) => (
            <React.Fragment key={s.id}>
              <li
                className={`ob__st ${n === i ? 'on' : ''} ${applied.includes(s.id) ? 'done' : ''}`.replace(/\s+/g, ' ').trim()}
                aria-current={n === i ? 'step' : undefined}
              >
                <span className="ob__n">{applied.includes(s.id) ? <Check width={12} height={12} /> : n + 1}</span>
                <span className="ob__lb">{s.label}</span>
              </li>
              {n < steps.length - 1 && <li className="ob__line" aria-hidden="true" />}
            </React.Fragment>
          ))}
        </ol>

        <div className={`ob__pane ${dir < 0 ? 'back' : ''}`.trim()} key={step.id}>
          {step.id === 'profile' && <StepProfile value={state} onChange={setState} orgKnown={!isOrgOwner} />}
          {step.id === 'org' && <StepOrg value={state} onChange={setState} />}
          {step.id === 'modules' && (
            <StepModules
              value={state}
              onChange={setState}
              industry={state.industry}
              catalogue={catalogue}
              canSet={canSetModules}
            />
          )}
          {step.id === 'invite' && <StepInvite value={state} onChange={setState} />}
          {step.id === 'project' && <StepTemplate value={state} onChange={setState} />}
        </div>

        <footer className="ob__foot">
          {i > 0 && (
            <Button variant="out" size="sm" onClick={() => go(i - 1)} disabled={busy}>
              <ChevLeft width={13} height={13} /> Back
            </Button>
          )}
          <span className="ob__save">
            <Check width={12} height={12} />
            Saved on this device — you can close this and come back
          </span>
          <button
            type="button"
            className="au__link au__link--mute"
            onClick={() => (i === 0 ? skipAll() : advance(null))}
            disabled={busy}
          >
            {i === 0 ? 'Skip setup entirely' : 'Skip this step'}
          </button>
          <button type="button" className="au__btn ob__next" onClick={primary.run} disabled={busy}>
            {busy && <span className="au__spin" aria-hidden="true" />}
            <span>{busy ? 'Working…' : primary.label}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
