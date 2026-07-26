import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { useToast, Button } from '../../components/ui';
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
 * TWO THINGS THIS FILE IS HONEST ABOUT
 *
 * 1. There is no `GET/POST /v1/onboarding`. 12 §4 lists it as NEW and the
 *    backend has no such route, so resume state is the local `kv_onboarding`
 *    write that the same paragraph asks for — and only that. Dropping off on a
 *    phone does NOT resume on a laptop yet; nothing here claims it does.
 *
 * 2. Two of the five steps can be applied for real (`POST /invites`,
 *    `POST /teams` + `/projects/:id/columns`) and three cannot: there is no
 *    endpoint for a user profile, an organisation record, or an org's enabled
 *    module set. Those three save locally, and StepDone reports them in the
 *    dashed PENDING state rather than ticking them. A summary that claims work
 *    the server never received is the same lie as a checkmark on a skipped step.
 *
 * An invited member skips Organisation and Modules — AUTH-SPEC: "An invited
 * user must not see module selection — the org already decided" — and skips
 * Team, because `POST /invites` requires admin and offering a form that will
 * 403 is worse than not offering it.
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
  };
}

function load(user) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...blankState(user), ...saved };
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

  // 12 §4: "the client also writes kv_onboarding locally so a refresh doesn't
  // lose a step". Server-side resume waits on GET/POST /v1/onboarding.
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, [state]);

  // Re-preselect on industry change, but never over a choice the user made.
  useEffect(() => {
    setState((s) => (s.modulesTouched ? s : { ...s, modules: OB_PRESETS[s.industry] || OB_PRESETS.Other }));
  }, [state.industry]);

  const go = useCallback((n) => {
    setDir(n > i ? 1 : -1);
    setI(Math.max(0, Math.min(steps.length - 1, n)));
  }, [i, steps.length]);

  const markApplied = (id) => setApplied((a) => (a.includes(id) ? a : [...a, id]));

  const finish = () => {
    try { localStorage.removeItem(KEY); } catch { /* nothing to clean up */ }
    navigate('/dashboard', { replace: true });
  };

  const step = steps[i];
  const last = i === steps.length - 1;

  const advance = (applyId) => {
    if (applyId) markApplied(applyId);
    if (last) setDone(true); else go(i + 1);
  };

  const skipAll = () => { setApplied([]); setDone(true); };

  const sendInvites = async () => {
    if (!state.invites.length) { advance(null); return; }
    setBusy(true);
    let sent = 0;
    const failed = [];
    for (const inv of state.invites) {
      try {
        await api.post('/invites', { email: inv.email, role: inv.role });
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
      const res = await api.post('/teams', { name });
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
   * Every label states what the press actually does, and the two that reach the
   * server say which one.
   *
   * `modules` used to read "Turn on N modules". Nothing is turned on — there is
   * no endpoint for an org's module set, the list goes to `kv_onboarding` and
   * stops there — so the button was promising a write that never happened, and
   * it also read "Turn on 1 modules". It carries the selection forward and says
   * so.
   *
   * `invite` and `project` are the only two presses in the whole wizard that
   * touch the API. Both name their effect and their count, and both fall back to
   * "Continue" when there is nothing to send or create, at which point their
   * handlers return before any request is made.
   */
  const nInv = state.invites.length;
  const primary = {
    profile: { label: 'Continue', run: () => advance(state.name.trim() ? 'profile' : null) },
    org: { label: 'Continue', run: () => advance(state.org.trim() ? 'org' : null) },
    modules: {
      label: `Continue with ${state.modules.length} module${state.modules.length === 1 ? '' : 's'}`,
      run: () => advance('modules'),
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
          {step.id === 'modules' && <StepModules value={state} onChange={setState} industry={state.industry} />}
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
