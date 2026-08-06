/**
 * Today — 05-today-dashboard.md.
 *
 * Layout: Hero → OnboardingChecklist (mounted by AppShell) → ReceivablesKPI →
 * StatRow → QuickActions → two columns.
 *
 * The component is `TodayPage`, matching the nav label (§3). The FILE keeps its
 * name: renaming it means editing `App.jsx`, which this change does not own.
 *
 * Endpoints are unchanged from staging because the ones §4 specifies do not
 * exist yet. What is needed, in priority order:
 *
 *   GET /v1/me/stats      {open, due_today, overdue, completed_week,
 *                          project_count} computed server-side against
 *                          completed_at. Today the page pulls every task and
 *                          derives all five in the browser.
 *   GET /v1/tasks?scope=mine&open=1   server-side filter, so the plate is not
 *                          1,000 rows filtered client-side.
 *   GET /v1/me/onboarding  the five real booleans, so the checklist can finish.
 *   GET /v1/me/modules     active modules plus the viewer's grants, so the
 *                          receivables call is never made by someone without a
 *                          Ganit grant rather than merely 403'd.
 *
 * §4 also asks to settle on `/v1`. `/api/tasks`, `/api/activity/feed` and
 * `/api/verse-of-the-day` have no `/v1` twin in `backend/server.py`, so moving
 * them is a backend change, not a string edit here.
 *
 * SCOPE OF THE FIGURES. The hero lede is the reader's own work; the four stat
 * tiles, Project status and Team pulse are the org's. §4 names the tile source
 * `GET /v1/me/stats`, which reads as reader-scoped and would make the lede and
 * the tiles agree — but that endpoint does not exist and switching the tiles is
 * a product decision, not a defect fix. Left as it renders today and raised in
 * the report rather than changed silently.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSkeletonGate } from '../hooks/useSkeletonGate';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { Hero, Citation } from '../components/editorial';
import { SkeletonText, ErrorState, errorKind } from '../components/ui';
import { logger } from '../lib/utils';
import { DAYS_HI_SUN, mondayIndex, weekDates as weekDatesFor, dayWindow } from '../lib/dates';
import { vikramLabel } from '../lib/vikram';
import {
  StatRow, QuickActions, ReceivablesKPI, TaskListCard,
  ProjectStatus, UpcomingWeek, TeamPulse, TodaySkeleton,
  ApprovalsCard, CashPosition,
} from './today';
import '../styles/today.css';
import { Secondary } from '../components/Bilingual';

export default function TodayPage({ teams = [] }) {
  const navigate  = useNavigate();
  const user      = currentUser();
  const firstName = (user?.full_name || user?.name || 'there').split(' ')[0];
  const myId      = user?.user_id;

  const now       = new Date();
  const todayIdx  = mondayIndex(now);
  const weekDates = useMemo(() => weekDatesFor(), []);
  const { today, tomorrow, weekEnd, weekAgo } = useMemo(() => dayWindow(), []);
  // The start of the week BEFORE weekAgo, so "done this week" has something
  // honest to be compared against. `lib/dates.js` owns the four boundaries the
  // due filters share; this fifth one is local to one tile, so it stays here
  // rather than widening that contract.
  const prevWeekAgo = useMemo(() => {
    const d = new Date(weekAgo);
    d.setDate(d.getDate() - 7);
    return d;
  }, [weekAgo]);

  const [loading,  setLoading]  = useState(true);
  const [tasks,    setTasks]    = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityErr, setActivityErr] = useState(null);
  const [verse,    setVerse]    = useState(null);
  const [finStats, setFinStats] = useState(null);
  // A FAILED LOAD IS NOT AN EMPTY BOARD. `/tasks` rejecting used to land in a
  // bare `.catch(logger.error)`, so `tasks` stayed `[]` and the page rendered
  // its zero state in full confidence: four stat tiles reading 0, "Nothing is
  // assigned to you right now", and — the one that makes it a real problem —
  // "The board is clear." The user is told their work is done when what
  // actually happened is that the request failed. Every other state on this
  // page was handled; this was the one that lied.
  const [error, setError] = useState(null);
  // Whether a load has ever SUCCEEDED — the skeleton gate below needs it, and
  // the answer is not `!error`: the first load and a retry after a failure both
  // have nothing to hold, and holding would show the zero state ("The board is
  // clear") for the length of the hold. Exactly the sentence this page already
  // refuses to print on a failure, reintroduced by a loading optimisation.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get('/tasks'),
      api.get('/verse-of-the-day').catch(() => null),
      // Not gated client-side: there is no module/grant registry in the bundle.
      // A viewer without a Ganit grant gets a 403 and the KPI never renders.
      api.get('/v1/ganit/stats').catch(() => null),
    ]).then(([tRes, vRes, fRes]) => {
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
      setLoaded(true);
      if (vRes) setVerse(vRes.data);
      if (fRes?.data) setFinStats(fRes.data);
    }).catch(err => {
      // Only `/tasks` can reach here — the other two swallow their own
      // rejections above precisely so a missing verse or an ungranted Ganit
      // never reads as a broken dashboard. So the failure is unambiguous and
      // `errorKind` can classify it honestly: offline vs 403 vs 404 vs 5xx,
      // rather than one "Something went wrong".
      logger.error(err);
      setError(err);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // MOTION-SPEC §7.4 — "Hold the previous page if the fetch resolves under
  // 120ms; a flashed skeleton is worse than none." Measured before this: with
  // the retry button and a 30ms response, the whole Today body was replaced by
  // `TodaySkeleton` and put back inside one animation frame. The lede rides the
  // same flag rather than `loading`, so the hero and the body never disagree
  // about whether the page is still arriving.
  const showSkeleton = useSkeletonGate(loading, loaded);

  // Not gated on `teams.length` any more. The gate was the client guessing at a
  // server rule and getting it wrong in one direction: `/activity/feed` derives
  // visibility from team_members UNION project_assignments, and platform staff
  // from the org's teams — a user with project assignments but no team row has
  // a feed and was shown "No activity in the last few days" instead of it.
  // The `.catch(() => {})` this replaces left `activity` at `[]`, and TeamPulse
  // reads an empty list as "No activity in the last few days." — a statement
  // about the team derived from a rejected promise. Every other panel in this
  // column already distinguishes its three states; this one silently did not.
  const loadActivity = useCallback(() => {
    setActivityErr(null);
    api.get('/activity/feed', { params: { limit: 6 } })
       .then(r => setActivity(Array.isArray(r.data) ? r.data : []))
       .catch(e => { setActivity([]); setActivityErr(e); });
  }, []);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  // team_id → name. `/api/tasks` returns `team_id` and never `team_name`
  // (`server.py` list_tasks selects column_name and assignee_names, not the
  // team), so every `<ProjectTag name={t.team_name}>` on this page was reading
  // undefined and rendering nothing — the project chip has been silently absent
  // from both task lists. The name is already in the `teams` prop AppShell
  // passes down; this joins them client-side until `/v1/tasks` returns it.
  const teamNames = useMemo(() => {
    const map = {};
    for (const t of teams || []) if (t.team_id) map[t.team_id] = t.name;
    return map;
  }, [teams]);
  const withTeam = useCallback(
    list => list.map(t => (t.team_name || !teamNames[t.team_id]
      ? t
      : { ...t, team_name: teamNames[t.team_id] })),
    [teamNames],
  );

  const derived = useMemo(() => {
    const safe = Array.isArray(tasks) ? tasks : [];
    const isOpen = t => t.status !== 'done';
    const dueOn  = (t, from, to) => t.due_at && new Date(t.due_at) >= from && new Date(t.due_at) < to;

    const assignedToMe = t => !!t.assignee_user_ids?.includes(myId);
    const unassigned   = t => !(t.assignee_user_ids?.length);
    const ownedByMe    = t => t.user_id === myId || t.created_by_user_id === myId;

    // YOUR plate is what is ASSIGNED to you. Staging also matched
    // created_by_user_id and user_id, so work you created and handed to someone
    // else sat here too — for a manager the list became "everything I have ever
    // touched". Delegated work is its own section below, not this one.
    //
    // The one addition to §5's rule: a task you own with NO assignee at all is
    // still yours. Under the bare rule it left your plate and landed under
    // "Waiting on others", which named nobody to wait on — the strictly worse
    // of the two places to lose it.
    const mine     = safe.filter(t => assignedToMe(t) || (unassigned(t) && ownedByMe(t)));
    const myOpen   = mine.filter(isOpen);
    // Created by me, open, and assigned to somebody ELSE. `!unassigned` is what
    // keeps my own unassigned work out of a list about other people.
    const waiting  = safe.filter(t =>
      isOpen(t) &&
      t.created_by_user_id === myId &&
      !assignedToMe(t) &&
      !unassigned(t));

    const open = safe.filter(isOpen);
    // Due today, still OPEN. The tile was counting every task dated today
    // including the ones already ticked off, so "DUE TODAY 7" could mean four
    // done and three left — and it disagreed with the lede one block above,
    // which has always filtered to open.
    const dueTodayList = open.filter(t => dueOn(t, today, tomorrow));

    const doneSince = (from, to) => safe.filter(t =>
      t.status === 'done' && t.completed_at &&
      new Date(t.completed_at) >= from &&
      (!to || new Date(t.completed_at) < to)).length;

    return {
      myOpen,
      myPlate:  myOpen.slice(0, 6),
      waiting:  waiting.slice(0, 5),
      waitingTotal: waiting.length,
      openTotal: open.length,
      // No `|| 1`. It turned zero into one, so a brand-new org with nothing in
      // it was told its open tasks span one project.
      openProjectCount: new Set(open.map(t => t.team_id).filter(Boolean)).size,
      dueToday: dueTodayList.length,
      dueTodayHigh: dueTodayList.filter(t => t.priority === 'high' || t.priority === 'urgent').length,
      overdue:   open.filter(t => t.due_at && new Date(t.due_at) < today).length,
      myDueToday: myOpen.filter(t => dueOn(t, today, tomorrow)).length,
      myOverdue:  myOpen.filter(t => t.due_at && new Date(t.due_at) < today).length,
      // completed_at, not updated_at. A task finished two months ago but edited
      // yesterday counted as done this week. DueChip already reads completed_at.
      completedWeek: doneSince(weekAgo, null),
      // The seven days before that, so the tile can compare like with like.
      // What it used to show was completedWeek ÷ EVERY task the org has ever
      // had, called a "completion rate" — a number that falls as the board
      // grows however much work you close. See StatRow.
      completedPrevWeek: doneSince(prevWeekAgo, weekAgo),
      upcoming: safe
        .filter(t => t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) <= weekEnd && isOpen(t))
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
        .slice(0, 6),
      statusCounts: safe.reduce((a, t) => { a[t.status] = (a[t.status] || 0) + 1; return a; }, {}),
    };
  }, [tasks, myId, today, tomorrow, weekEnd, weekAgo, prevWeekAgo]);

  // OPEN tasks only. A finished task kept its dot, so the strip showed load on
  // days whose work was already done — the one thing the strip exists to say.
  const dotsByDay = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      if (!t.due_at || t.status === 'done') continue;
      const key = new Date(t.due_at).toDateString();
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [tasks]);

  const dateLine = [
    { label: now.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase() },
    { label: DAYS_HI_SUN[now.getDay()], hindi: true },
    { label: now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) },
    // Year only — the month was a naive +1 offset from the Gregorian month and
    // wrong for most of any given month. See lib/vikram.js.
    { label: vikramLabel(now), hindi: true },
  ];

  // Scoped to the reader: "You have" was counting the whole org's due-today and
  // overdue tasks, and its open count read `myPlate.length` — the SLICED list —
  // so anyone with seven or more open tasks was told they had six.
  //
  // While loading the lede is a placeholder, not nothing: `.k-hero__lede` is a
  // 14.5px/1.65 line, so an absent lede made the hero ~24px shorter and the
  // whole page stepped down when the counts arrived (26 §9). `inline-block`
  // rather than the primitive's own `display: block`, so the paragraph keeps
  // its real line box and the swap moves nothing at all.
  const ledeCopy = showSkeleton ? (
    <SkeletonText width="48%" height={14} style={{ display: 'inline-block' }} />
  ) : error ? (
    // Says nothing about the work, because nothing about the work is known.
    // The counts below are absent for the same reason.
    <>We couldn’t load your tasks just now, so the numbers below are missing rather than zero.</>
  ) : derived.myOpen.length === 0 ? (
    <>
      <b>Nothing is assigned to you right now.</b>{' '}
      {derived.openTotal > 0
        ? <>The team has {derived.openTotal} open task{derived.openTotal !== 1 ? 's' : ''} between them.</>
        : <>The board is clear.</>}
      {' '}<Secondary className="hi-mute" value="करणीयं कुरु —" /> <em>Do what must be done.</em>
    </>
  ) : (
    <>
      You have <b>{derived.myOpen.length} open task{derived.myOpen.length !== 1 ? 's' : ''}</b>
      {derived.myDueToday > 0 && <>, <b>{derived.myDueToday} due today</b></>}
      {derived.myOverdue > 0 && <>, <b className="k-today__late">{derived.myOverdue} running late</b></>}.
      {' '}<Secondary className="hi-mute" value="करणीयं कुरु —" /> <em>Do what must be done.</em>
    </>
  );

  // Every row lands on the task list, not on the task. `TasksListPage` reads no
  // query parameter and there is no route that opens the drawer, so there is
  // nothing to deep-link to yet; the handler takes the task so the call sites
  // are already correct when there is. See the report.
  const openTask = () => navigate('/tasks');

  return (
    <div className="k-screen k-today">
      <Hero
        name={firstName}
        dateLine={dateLine}
        lede={ledeCopy}
        weekDates={weekDates}
        dotsByDay={dotsByDay}
        todayIdx={todayIdx}
      />

      {/* The onboarding checklist is NOT rendered here. §5 asks to reconcile the
          two implementations; neither was dead code — `AppShell` mounts
          `components/OnboardingChecklist.jsx` on every route while this page
          declared a second, different one inline, so a new user saw two
          checklists with different steps and different storage keys at once.
          The AppShell one survives: it derives all four of its steps from the
          API, this one hardcoded three of five to `false` and could never
          finish. Its duplicate `.k-onboard` CSS block was also overriding the
          floating card's own rules. */}

      <ReceivablesKPI stats={finStats} />

      {/* ReceivablesKPI stays mounted above: it has its own source and its own
          null guard, so a task failure must not blank a figure that loaded.

          THE SAME RULE NOW GOVERNS THE BODY. `error` here means `/tasks`
          rejected and nothing else — the other two calls swallow their own
          rejections. Everything below that reads a DIFFERENT source therefore
          stays mounted through it: Approvals, Cash position, Team pulse and the
          verse. Only the task-derived panels drop out, replaced by one
          ErrorState that says what actually failed.

          Blanking the whole page was the more visible version of the defect
          this file already documents in `ledeCopy`: a failed request rendering
          as an absence. An approvals queue that vanishes because an unrelated
          call 500'd is how a payroll run sits unapproved for a day.

          `showSkeleton`, not `loading` — MOTION-SPEC §7.4's 120ms hold, added
          on staging while this branch was in flight. The skeleton still stands
          in for the WHOLE body, including the two independent cards: during the
          first load nothing about the page is known yet, so claiming anything
          about approvals or cash would be the same lie in the other direction. */}
      {showSkeleton ? <TodaySkeleton /> : (
        <>
          {error ? (
            <ErrorState
              kind={errorKind(error)}
              grant="access to this workspace"
              detail="We could not load your tasks. Everything below reads a different source and is unaffected."
              onRetry={load}
            />
          ) : (
            <>
              <StatRow
                open={derived.openTotal}
                projectCount={derived.openProjectCount}
                dueToday={derived.dueToday}
                dueTodayHigh={derived.dueTodayHigh}
                overdue={derived.overdue}
                completedWeek={derived.completedWeek}
                completedPrevWeek={derived.completedPrevWeek}
              />

              <QuickActions onNavigate={navigate} />
            </>
          )}

          <section className="k-twocol">
            <div className="k-col k-col--main">
              {!error && (
                <>
                  <TaskListCard
                    title="On your plate"
                    sanskrit="आपके हाथ में"
                    tasks={withTeam(derived.myPlate)}
                    linkLabel="View all →"
                    onLink={openTask}
                    onOpenTask={openTask}
                    emptyTitle={{ en: 'Nothing assigned to you', hi: 'आपके लिए कुछ नहीं' }}
                    emptyBody="Tasks appear here as soon as someone assigns one to you."
                  />

                  {/* New section. This is where the tasks that were polluting
                      "On your plate" belong — created by you, being done by
                      someone else. Hidden entirely when you have delegated
                      nothing, so it costs nothing to an individual
                      contributor. */}
                  {derived.waitingTotal > 0 && (
                    <TaskListCard
                      title="Waiting on others"
                      sanskrit="अन्य पर निर्भर"
                      tasks={withTeam(derived.waiting)}
                      illustration="teams"
                      linkLabel={derived.waitingTotal > derived.waiting.length ? 'View all →' : undefined}
                      onLink={openTask}
                      onOpenTask={openTask}
                      emptyTitle={{ en: 'Nothing delegated', hi: 'कुछ सौंपा नहीं' }}
                      emptyBody="Work you create and assign to someone else shows up here."
                    />
                  )}
                </>
              )}

              {/* Second card in the reference's left column, directly below the
                  task list. It sits above Project status here because that card
                  has no counterpart in the reference at all, so it takes the
                  slot after everything the design does specify. */}
              <CashPosition />

              {!error && (
                <ProjectStatus
                  counts={derived.statusCounts}
                  total={tasks.length}
                  onOpenProjects={() => navigate('/projects')}
                />
              )}
            </div>

            <div className="k-col k-col--side">
              {/* FIRST in the reference's right column, above Activity. The
                  build had no approvals panel on Today at all — clearing three
                  decisions meant navigating to /approvals and back. */}
              <ApprovalsCard onOpenApprovals={() => navigate('/approvals')} />

              {!error && <UpcomingWeek tasks={withTeam(derived.upcoming)} onOpenTask={openTask} />}
              <TeamPulse activity={activity} error={activityErr} onRetry={loadActivity}
                onOpenActivity={() => navigate('/activity')} />
              <Citation
                sanskrit={verse?.sanskrit || 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन'}
                english={verse?.english || 'You have a right to action alone, never to its fruits.'}
                source={verse?.ref || 'Bhagavad Gītā 2.47'}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
