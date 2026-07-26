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
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { Hero, Citation } from '../components/editorial';
import { logger } from '../lib/utils';
import { DAYS_HI_SUN, mondayIndex, weekDates as weekDatesFor, dayWindow } from '../lib/dates';
import { vikramLabel } from '../lib/vikram';
import {
  StatRow, QuickActions, ReceivablesKPI, TaskListCard,
  ProjectStatus, UpcomingWeek, TeamPulse, TodaySkeleton,
} from './today';

export default function TodayPage({ teams = [] }) {
  const navigate  = useNavigate();
  const user      = currentUser();
  const firstName = (user?.full_name || user?.name || 'there').split(' ')[0];
  const myId      = user?.user_id;

  const now       = new Date();
  const todayIdx  = mondayIndex(now);
  const weekDates = useMemo(() => weekDatesFor(), []);
  const { today, tomorrow, weekEnd, weekAgo } = useMemo(() => dayWindow(), []);

  const [loading,  setLoading]  = useState(true);
  const [tasks,    setTasks]    = useState([]);
  const [activity, setActivity] = useState([]);
  const [verse,    setVerse]    = useState(null);
  const [finStats, setFinStats] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/tasks'),
      api.get('/verse-of-the-day').catch(() => null),
      // Not gated client-side: there is no module/grant registry in the bundle.
      // A viewer without a Ganit grant gets a 403 and the KPI never renders.
      api.get('/v1/ganit/stats').catch(() => null),
    ]).then(([tRes, vRes, fRes]) => {
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
      if (vRes) setVerse(vRes.data);
      if (fRes?.data) setFinStats(fRes.data);
    }).catch(logger.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!teams?.length) return;
    api.get('/activity/feed', { params: { limit: 6 } })
       .then(r => setActivity(r.data || []))
       .catch(() => {});
  }, [teams]);

  const derived = useMemo(() => {
    const safe = Array.isArray(tasks) ? tasks : [];
    const isOpen = t => t.status !== 'done';
    const dueOn  = (t, from, to) => t.due_at && new Date(t.due_at) >= from && new Date(t.due_at) < to;

    // YOUR plate is what is ASSIGNED to you. Staging also matched
    // created_by_user_id and user_id, so work you created and handed to someone
    // else sat here too — for a manager the list became "everything I have ever
    // touched". Delegated work is its own section below, not this one.
    const mine     = safe.filter(t => t.assignee_user_ids?.includes(myId));
    const myOpen   = mine.filter(isOpen);
    // Created by me, open, and assigned to somebody else (or nobody).
    const waiting  = safe.filter(t =>
      isOpen(t) &&
      t.created_by_user_id === myId &&
      !t.assignee_user_ids?.includes(myId));

    const open = safe.filter(isOpen);

    return {
      myOpen,
      myPlate:  myOpen.slice(0, 6),
      waiting:  waiting.slice(0, 5),
      waitingTotal: waiting.length,
      openTotal: open.length,
      // No `|| 1`. It turned zero into one, so a brand-new org with nothing in
      // it was told its open tasks span one project.
      openProjectCount: new Set(open.map(t => t.team_id).filter(Boolean)).size,
      dueToday:  safe.filter(t => dueOn(t, today, tomorrow)),
      overdue:   safe.filter(t => t.due_at && new Date(t.due_at) < today && isOpen(t)),
      myDueToday: myOpen.filter(t => dueOn(t, today, tomorrow)).length,
      myOverdue:  myOpen.filter(t => t.due_at && new Date(t.due_at) < today).length,
      // completed_at, not updated_at. A task finished two months ago but edited
      // yesterday counted as done this week, and the completion rate inherited
      // the error. DueChip already reads completed_at.
      completedWeek: safe.filter(t =>
        t.status === 'done' && t.completed_at && new Date(t.completed_at) >= weekAgo).length,
      upcoming: safe
        .filter(t => t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) <= weekEnd && isOpen(t))
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
        .slice(0, 6),
      statusCounts: safe.reduce((a, t) => { a[t.status] = (a[t.status] || 0) + 1; return a; }, {}),
    };
  }, [tasks, myId, today, tomorrow, weekEnd, weekAgo]);

  const dotsByDay = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      if (!t.due_at) continue;
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
  const ledeCopy = loading ? null : derived.myOpen.length === 0 ? (
    <>
      <b>Nothing is assigned to you right now.</b>{' '}
      {derived.openTotal > 0
        ? <>The team has {derived.openTotal} open task{derived.openTotal !== 1 ? 's' : ''} between them.</>
        : <>The board is clear.</>}
      {' '}<span className="hi-mute">करणीयं कुरु —</span> <em>Do what must be done.</em>
    </>
  ) : (
    <>
      You have <b>{derived.myOpen.length} open task{derived.myOpen.length !== 1 ? 's' : ''}</b>
      {derived.myDueToday > 0 && <>, <b>{derived.myDueToday} due today</b></>}
      {derived.myOverdue > 0 && <>, <b className="k-today__late">{derived.myOverdue} running late</b></>}.
      {' '}<span className="hi-mute">करणीयं कुरु —</span> <em>Do what must be done.</em>
    </>
  );

  const openTask = () => navigate('/tasks');

  return (
    <div className="k-screen">
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

      {loading ? <TodaySkeleton /> : (
        <>
          <StatRow
            open={derived.openTotal}
            projectCount={derived.openProjectCount}
            dueToday={derived.dueToday.length}
            dueTodayHigh={derived.dueToday.filter(t => t.priority === 'high' || t.priority === 'urgent').length}
            overdue={derived.overdue.length}
            completedWeek={derived.completedWeek}
            completionRate={tasks.length ? Math.round((derived.completedWeek / tasks.length) * 100) : 0}
          />

          <QuickActions onNavigate={navigate} />

          <section className="k-twocol">
            <div className="k-col k-col--main">
              <TaskListCard
                title="On your plate"
                sanskrit="आपके हाथ में"
                tasks={derived.myPlate}
                linkLabel="View all →"
                onLink={openTask}
                onOpenTask={openTask}
                emptyTitle={{ en: 'Nothing assigned to you', hi: 'आपके लिए कुछ नहीं' }}
                emptyBody="Tasks appear here as soon as someone assigns one to you."
              />

              {/* New section. This is where the tasks that were polluting "On
                  your plate" belong — created by you, being done by someone
                  else. Hidden entirely when you have delegated nothing, so it
                  costs nothing to an individual contributor. */}
              {derived.waitingTotal > 0 && (
                <TaskListCard
                  title="Waiting on others"
                  sanskrit="अन्य पर निर्भर"
                  tasks={derived.waiting}
                  illustration="teams"
                  linkLabel={derived.waitingTotal > derived.waiting.length ? 'View all →' : undefined}
                  onLink={openTask}
                  onOpenTask={openTask}
                  emptyTitle={{ en: 'Nothing delegated', hi: 'कुछ सौंपा नहीं' }}
                  emptyBody="Work you create and assign to someone else shows up here."
                />
              )}

              <ProjectStatus
                counts={derived.statusCounts}
                total={tasks.length}
                onOpenProjects={() => navigate('/projects')}
              />
            </div>

            <div className="k-col k-col--side">
              <UpcomingWeek tasks={derived.upcoming} onOpenTask={openTask} />
              <TeamPulse activity={activity} onOpenActivity={() => navigate('/activity')} />
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
