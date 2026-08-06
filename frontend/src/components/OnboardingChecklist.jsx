/**
 * OnboardingChecklist.jsx — first-run "setup guide" checklist.
 *
 * Persistent, dismissible floating card (bottom-right) that nudges brand-new
 * accounts toward first value fast — creating a project first, not "complete
 * your profile". Never a forced modal; always skippable.
 *
 * Completion state (per browser) lives in localStorage under
 * `kartavya_onboarding` — { dismissed: bool, minimized: bool }.
 * Step completion itself is derived live from the API (not cached) so the
 * checklist always reflects real progress across devices.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { ChevronRight, X, ListChecks } from 'lucide-react';
import { Secondary } from './Bilingual';

const STORAGE_KEY = 'kartavya_onboarding';

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}

export default function OnboardingChecklist({ onNewTask }) {
  const navigate = useNavigate();
  const me = currentUser();

  const initial = readState();
  const [dismissed, setDismissed] = useState(!!initial.dismissed);
  const [minimized, setMinimized] = useState(!!initial.minimized);
  const [closing, setClosing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [steps, setSteps] = useState({ project: false, invite: false, task: false, org: false });

  /* ── An unbounded fetch loop lived here ───────────────────────────────────
     `currentUser()` is `JSON.parse(localStorage…)` (`lib/auth.js:145`), so `me`
     is a BRAND NEW OBJECT on every render. `refresh` listed it in its
     `useCallback` deps, so `refresh` was a new function on every render; the
     effect below listed `refresh` in ITS deps, so the effect re-ran on every
     render; `refresh` ends in `setSteps` + `setLoaded`, which renders again.
     Nothing broke the cycle.

     `AppShell:501` mounts this on EVERY authenticated page, so the cycle ran
     for every signed-in user on every screen, three requests a turn:
     `/teams`, `/users`, `/tasks`.

     MEASURED, with 80ms of latency on every response so a fast stub could not
     be the explanation: 209 requests in 8.0s on /boards, 251 on /tasks, 212 on
     /dashboard — roughly 24 requests per second, per open tab, indefinitely.
     Against the Supabase project staging and production share.

     The fix is to depend on a STRING instead of an object. `org_name` is the
     only thing `me` contributes, and `useCallback` compares deps with Object.is
     — a string that has not changed keeps `refresh` stable, so the effect runs
     once per `dismissed` change, which is what it always meant to do. */
  const orgRole = me?.org_roles?.find(r => r.role_code === 'org_admin' || r.role_code === 'org_owner') || me?.org_roles?.[0];
  const orgName = (orgRole?.org_name || '').trim();

  const refresh = useCallback(async () => {
    const [projectsRes, usersRes, tasksRes] = await Promise.all([
      api.get('/teams').catch(() => null),
      api.get('/users').catch(() => null),
      api.get('/tasks').catch(() => null),
    ]);
    const projects = Array.isArray(projectsRes?.data) ? projectsRes.data : [];
    const users = Array.isArray(usersRes?.data) ? usersRes.data : [];
    const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : [];

    setSteps({
      project: projects.length > 0,
      invite: users.length > 1,
      task: tasks.length > 0,
      org: !!orgName,
    });
    setLoaded(true);
  }, [orgName]);

  useEffect(() => { if (!dismissed) refresh(); }, [dismissed, refresh]);

  /* ── Every hook must sit ABOVE the early returns below ────────────────────
     This component is mounted by `AppShell` (`:484`), OUTSIDE the page-scoped
     ErrorBoundary that wraps `<Outlet>` — so a throw here escapes to the root
     boundary and blanks the whole product, sidebar and all.

     And it did throw. `dismiss()` was called from a `useEffect` that sat AFTER
     `if (dismissed) return null`. The moment `allDone` became true the effect
     set `dismissed`, the next render took the early return, and React saw a
     render with fewer hooks than the one before it — "Rendered fewer hooks than
     expected", which is a crash, not a warning.

     The trigger is the worst possible one: `allDone` means the firm just
     finished all four setup steps. So the product died for every new customer,
     at the exact moment they completed onboarding.

     `allDone` is computed here from `steps` rather than from `list` (built
     below) purely so this effect can live above the returns. The two are the
     same predicate — `list` has one entry per key of `steps` and each `done` is
     that key — and the test asserts they cannot drift. */
  const allDone = loaded && Object.values(steps).every(Boolean);

  const dismiss = () => {
    setClosing(true);
    setTimeout(() => {
      setDismissed(true);
      writeState({ dismissed: true });
    }, 220);
  };

  useEffect(() => {
    if (allDone && !closing) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, closing]);

  if (dismissed) return null;

  const list = [
    {
      key: 'project',
      en: 'Create your first project',
      hi: 'पहली योजना बनाएं',
      done: steps.project,
      go: () => navigate('/projects?new=1'),
    },
    {
      key: 'invite',
      en: 'Invite a team member',
      hi: 'टीम सदस्य आमंत्रित करें',
      done: steps.invite,
      go: () => navigate('/teams'),
    },
    {
      key: 'task',
      en: 'Add your first task',
      hi: 'पहला कार्य जोड़ें',
      done: steps.task,
      go: () => onNewTask?.(),
    },
    {
      key: 'org',
      en: 'Set up your organisation',
      hi: 'संगठन सेट करें',
      done: steps.org,
      go: () => navigate('/settings/organisation'),
    },
  ];

  const doneCount = list.filter(s => s.done).length;

  const toggleMinimize = () => {
    setMinimized(v => {
      const next = !v;
      writeState({ minimized: next });
      return next;
    });
  };

  if (allDone) return null;

  if (minimized) {
    return (
      <button
        className={'k-onboard-pill' + (closing ? ' is-closing' : '')}
        onClick={toggleMinimize}
        aria-label="Open setup guide"
      >
        <ListChecks size={14} />
        Setup guide
        <span className="k-onboard-pill__count">{doneCount}/{list.length}</span>
      </button>
    );
  }

  const pct = Math.round((doneCount / list.length) * 100);

  return (
    <div className={'k-onboard' + (closing ? ' is-closing' : '')} role="complementary" aria-label="Onboarding checklist">
      <div className="k-onboard__head">
        <div className="k-onboard__titles">
          <div className="k-onboard__title">Setup guide</div>
          <div className="k-onboard__count">{doneCount} of {list.length} complete</div>
        </div>
        <div className="k-onboard__headbtns">
          <button className="k-onboard__iconbtn" onClick={toggleMinimize} aria-label="Minimize">
            <span style={{ fontSize: 16, lineHeight: 1 }}>–</span>
          </button>
          <button className="k-onboard__iconbtn" onClick={dismiss} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="k-onboard__bar">
        <div className="k-onboard__bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="k-onboard__list">
        {list.map(step => (
          <button key={step.key} className="k-onboard__row" onClick={step.go}>
            <span className={'k-onboard__check' + (step.done ? ' is-done' : '')}>
              {step.done && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5L3.2 5.7L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="k-onboard__labels">
              <span className={'k-onboard__en' + (step.done ? ' is-done' : '')}>{step.en}</span>
              <Secondary className="k-onboard__hi" value={step.hi} />
            </span>
            {!step.done && <ChevronRight size={14} className="k-onboard__arrow" />}
          </button>
        ))}
      </div>

      <button className="k-onboard__skip" onClick={dismiss}>
        Skip setup
      </button>
    </div>
  );
}
