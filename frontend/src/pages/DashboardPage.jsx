/**
 * DashboardPage.jsx — editorial Today screen.
 * Layout: Hero → StatRow (4 tiles) → k-twocol (main + side columns)
 * Data: existing /tasks + /activity/team/:id + /api/verse-of-the-day
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import {
  Hero, StatTile, Card, DueChip, PriorityDot, ProjectTag, AvatarStack, Citation,
} from '../components/editorial';
import { AVATAR_COLORS, relTime, userInitials, logger } from '../lib/utils';
import { STATUS_COLORS, STATUS_LABELS } from '../components/drawer/constants';

const VIKRAM_MONTHS = ['Chaitra','Vaishākha','Jyēṣṭha','Āṣāḍha','Śrāvaṇa','Bhādra',
  'Āśvina','Kārtika','Mārgaśīrṣa','Pauṣa','Māgha','Phālguna'];
const STATUS_HI = { todo:'कार्य', in_progress:'चालू', in_review:'समीक्षा', done:'सम्पन्न', requested:'अनुरोध' };

const ONBOARD_STEPS = [
  { key: 'logo', label: 'Add your company logo', hi: 'लोगो जोड़ें', hint: 'You can always change this later', route: '/settings/organisation' },
  { key: 'team', label: 'Invite your team', hi: 'टीम को आमंत्रित करें', hint: 'Get paid faster with collaboration', route: '/teams' },
  { key: 'project', label: 'Create your first project', hi: 'पहली योजना बनाएं', hint: 'Organize work across boards', route: '/projects' },
  { key: 'contact', label: 'Add a contact', hi: 'संपर्क जोड़ें', hint: 'Know your clients and leads', route: '/graha' },
  { key: 'invoice', label: 'Send your first invoice', hi: 'पहला चालान भेजें', hint: 'Get paid faster', route: '/ganit' },
];

function OnboardingChecklist({ tasks, teams, navigate }) {
  const storageKey = 'kv_onboard_dismissed';
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');
  if (dismissed) return null;

  const done = {
    logo: false,
    team: (teams || []).length > 1,
    project: (teams || []).length > 0,
    contact: false,
    invoice: false,
  };
  const taskCount = Array.isArray(tasks) ? tasks.length : 0;
  if (taskCount > 0) done.project = true;

  const doneCount = Object.values(done).filter(Boolean).length;
  const total = ONBOARD_STEPS.length;
  if (doneCount >= total) return null;

  return (
    <div className="k-onboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 className="k-onboard__title">Get started with Kartavya</h3>
          <p className="k-onboard__sub">{doneCount} of {total} steps complete · <span style={{ fontFamily: 'var(--font-hindi)' }}>{doneCount}/{total} चरण पूर्ण</span></p>
        </div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => { localStorage.setItem(storageKey, '1'); setDismissed(true); }}>
          Dismiss
        </button>
      </div>
      <div className="k-onboard__progress">
        <div className="k-onboard__progress-fill" style={{ width: `${(doneCount / total) * 100}%` }} />
      </div>
      {ONBOARD_STEPS.map(s => (
        <div key={s.key} className="k-onboard__step" onClick={() => navigate(s.route)}>
          <div className={`k-onboard__check ${done[s.key] ? 'k-onboard__check--done' : ''}`}>
            {done[s.key] ? '✓' : ''}
          </div>
          <div>
            <div className={`k-onboard__step-label ${done[s.key] ? 'k-onboard__step-label--done' : ''}`}>
              {s.label} <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, color: 'var(--ink-faint)' }}>{s.hi}</span>
            </div>
            <div className="k-onboard__step-hint">{s.hint}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function vikramDate(now) {
  const year  = now.getFullYear() + 56 + (now.getMonth() >= 3 ? 1 : 0);
  const month = VIKRAM_MONTHS[(now.getMonth() + 1) % 12];
  return { year, month };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardPage({ teams = [] }) {
  const navigate  = useNavigate();
  const user      = currentUser();
  const firstName = (user?.full_name || user?.name || 'there').split(' ')[0];

  const now    = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const { year: vikYear, month: vikMonth } = vikramDate(now);

  const weekDates = useMemo(() => {
    const base = new Date(); base.setHours(0,0,0,0);
    const idx  = (base.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() - idx + i); return d;
    });
  }, []);

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(true);
  const [tasks,    setTasks]    = useState([]);
  const [activity, setActivity] = useState([]);
  const [verse,    setVerse]    = useState(null);
  const [teamId,   setTeamId]   = useState('');
  const [finStats, setFinStats] = useState(null);

  // ── Fetch tasks ────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/tasks'),
      api.get('/verse-of-the-day').catch(() => null),
      api.get('/v1/ganit/stats').catch(() => null),
    ]).then(([tRes, vRes, fRes]) => {
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
      if (vRes) setVerse(vRes.data);
      if (fRes?.data) setFinStats(fRes.data);
    }).catch(logger.error).finally(() => setLoading(false));
  }, []);

  // ── Fetch activity across all teams ────────────────────────────────────────
  useEffect(() => {
    if (!teams?.length) return;
    setTeamId(teams[0]?.team_id);
    api.get('/activity/feed', { params: { limit: 6 } })
       .then(r => setActivity(r.data || []))
       .catch(() => {});
  }, [teams]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const { today, tomorrow, weekEnd, weekAgo } = useMemo(() => {
    const t = new Date(); t.setHours(0,0,0,0);
    const tom = new Date(t); tom.setDate(t.getDate()+1);
    const we  = new Date(t); we.setDate(t.getDate()+7);
    const wa  = new Date(t); wa.setDate(t.getDate()-7);
    return { today: t, tomorrow: tom, weekEnd: we, weekAgo: wa };
  }, []);

  const myId = user?.user_id;
  const {
    myPlate, openTasks, openProjectCount, dueToday, overdue, completedWeek, inProgress, inReview, upcoming,
  } = useMemo(() => {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const myTasks   = safeTasks.filter(t => t.created_by_user_id === myId || t.user_id === myId || t.assignee_user_ids?.includes(myId));
    const open      = safeTasks.filter(t => t.status !== 'done');
    return {
      myPlate:       myTasks.filter(t => t.status !== 'done').slice(0, 6),
      openTasks:     open,
      openProjectCount: new Set(open.map(t => t.team_id).filter(Boolean)).size || 1,
      dueToday:      safeTasks.filter(t => t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) < tomorrow),
      overdue:       safeTasks.filter(t => t.due_at && new Date(t.due_at) < today && t.status !== 'done'),
      completedWeek: safeTasks.filter(t => t.status === 'done' && t.updated_at && new Date(t.updated_at) >= weekAgo),
      inProgress:    safeTasks.filter(t => t.status === 'in_progress'),
      inReview:      safeTasks.filter(t => t.status === 'in_review'),
      upcoming:      safeTasks
        .filter(t => t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) <= weekEnd && t.status !== 'done')
        .sort((a,b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 6),
    };
  }, [tasks, myId, today, tomorrow, weekEnd, weekAgo]);

  // Status breakdown
  const statusOrder = ['todo','in_progress','in_review','done'];
  const statusCounts = tasks.reduce((a, t) => { a[t.status] = (a[t.status]||0)+1; return a; }, {});
  const totalTasks   = tasks.length || 1;
  const doneCount    = statusCounts.done || 0;
  const donePct      = Math.round((doneCount / totalTasks) * 100);

  // Task dots on week strip
  const dotsByDay = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      if (!t.due_at) return;
      const key = new Date(t.due_at).toDateString();
      map[key] = (map[key]||0)+1;
    });
    return map;
  }, [tasks]);

  // Date line for Hero
  const DAYS_HI = ['रविवार','सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार'];
  const dateLine = [
    { label: now.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase() },
    { label: DAYS_HI[now.getDay()], hindi: true },
    { label: now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) },
    { label: `विक्रम संवत् ${vikYear}`, hindi: true },
  ];

  const ledeCopy = loading ? null : (
    <>
      You have <b>{myPlate.length} open task{myPlate.length !== 1 ? 's' : ''}</b>
      {dueToday.length > 0 && <>, <b>{dueToday.length} due today</b></>}
      {overdue.length > 0   && <>, <b style={{ color: 'var(--danger)' }}>{overdue.length} running late</b></>}.
      {' '}<span className="hi-mute">करणीयं कुरु —</span> <em>Do what must be done.</em>
    </>
  );

  return (
    <div className="k-screen">
      {/* Hero */}
      <Hero
        name={firstName}
        dateLine={dateLine}
        lede={ledeCopy}
        weekDates={weekDates}
        dotsByDay={dotsByDay}
        todayIdx={dayIdx}
      />

      {/* Onboarding checklist — shown for new orgs */}
      {!loading && <OnboardingChecklist tasks={tasks} teams={teams} navigate={navigate} />}

      {/* Hero KPI — "How's my business?" */}
      {finStats && (
        <div className="k-hero-kpi">
          <div className="k-hero-kpi__main">
            <div className="k-hero-kpi__label">RECEIVABLES <span className="hi-mute">प्राप्य</span></div>
            <div className="k-hero-kpi__value">₹{Number(finStats.total_outstanding || 0).toLocaleString('en-IN')}</div>
            <div className="k-hero-kpi__sub">{finStats.unpaid_count || 0} unpaid invoice{(finStats.unpaid_count || 0) !== 1 ? 's' : ''}</div>
          </div>
          <div className="k-hero-kpi__secondary">
            <div className="k-hero-kpi__card">
              <div className="k-hero-kpi__card-val" style={{ color: 'var(--ok)' }}>₹{Number(finStats.total_collected || 0).toLocaleString('en-IN')}</div>
              <div className="k-hero-kpi__card-lbl">Collected <span className="hi-mute">वसूला</span></div>
            </div>
            <div className="k-hero-kpi__card">
              <div className="k-hero-kpi__card-val" style={{ color: 'var(--danger)' }}>{finStats.overdue_count || 0}</div>
              <div className="k-hero-kpi__card-lbl">Overdue <span className="hi-mute">विलंबित</span></div>
            </div>
            <div className="k-hero-kpi__card">
              <div className="k-hero-kpi__card-val">{finStats.total_invoices || 0}</div>
              <div className="k-hero-kpi__card-lbl">Total invoices <span className="hi-mute">कुल चालान</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Stat row */}
      <div className="k-stats">
        <StatTile variant="blue"  label="OPEN TASKS"          sanskrit="खुला"      value={openTasks.length}     sub={`across ${openProjectCount} project${openProjectCount !== 1 ? 's' : ''}`} />
        <StatTile variant="teal"  label="DUE TODAY"           sanskrit="आज"        value={dueToday.length}      sub={`${dueToday.filter(t=>t.priority==='high'||t.priority==='urgent').length} high priority`} />
        <StatTile variant="amber" label="OVERDUE"             sanskrit="विलंबित"   value={overdue.length}       sub={overdue.length > 0 ? 'needs attention' : 'all on track'} />
        <StatTile variant="red"   label="DONE THIS WEEK"      sanskrit="इस सप्ताह" value={completedWeek.length} sub={completedWeek.length > 0 ? `${Math.round((completedWeek.length/(tasks.length||1))*100)}% completion rate` : 'keep going'} />
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: '+ New Task', icon: '✏️', action: () => navigate('/tasks') },
          { label: 'Create Invoice', icon: '🧾', action: () => navigate('/ganit') },
          { label: 'Add Contact', icon: '👤', action: () => navigate('/graha') },
          { label: 'Log Time', icon: '⏱️', action: () => navigate('/time') },
        ].map(q => (
          <button key={q.label} className="k-btn k-btn--ghost" onClick={q.action}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
            <span>{q.icon}</span> {q.label}
          </button>
        ))}
      </div>

      {/* Two-column body */}
      {!loading && (
        <section className="k-twocol">
          {/* LEFT column */}
          <div className="k-col k-col--main">
            {/* On your plate */}
            <Card
              title="On your plate"
              sanskrit="आपके हाथ में"
              right={<button className="k-link" onClick={() => navigate('/tasks')}>View all →</button>}
              noPad
            >
              {myPlate.length === 0 ? (
                <div style={{ padding: '20px 24px', color: 'var(--ink-3)', fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
                  Nothing assigned to you right now.
                </div>
              ) : myPlate.map((t, i) => {
                const assignees = (t.assignee_names || []).map((name, j) => ({
                  name, color: AVATAR_COLORS[j % AVATAR_COLORS.length],
                }));
                return (
                  <button key={t.task_id} className="k-taskrow" onClick={() => navigate('/tasks')}>
                    <PriorityDot priority={t.priority} />
                    <span className="k-taskrow__id">KAR-{String(i+100)}</span>
                    <span className="k-taskrow__title">{t.title}</span>
                    {t.team_name && <ProjectTag name={t.team_name} dense />}
                    <DueChip date={t.due_at} status={t.status} completedAt={t.completed_at} />
                    <AvatarStack users={assignees} size={20} max={3} />
                  </button>
                );
              })}
            </Card>

            {/* Status breakdown */}
            <Card title="Project status" sanskrit="स्थिति विवरण" right={<button className="k-link" onClick={() => navigate('/projects')}>Open projects →</button>}>
              <div className="k-stackbar">
                {statusOrder.map(s => {
                  const count = statusCounts[s] || 0;
                  if (!count) return null;
                  return (
                    <div key={s} className="k-stackbar__seg"
                      style={{ flex: count, background: STATUS_COLORS[s] }}
                      title={`${STATUS_LABELS[s]}: ${count}`}
                    />
                  );
                })}
              </div>
              <div className="k-statuslegend">
                {statusOrder.map(s => (
                  <div key={s} className="k-statuslegend__row">
                    <span className="k-statuslegend__dot" style={{ background: STATUS_COLORS[s] }} />
                    <span className="k-statuslegend__lbl">{STATUS_LABELS[s]}</span>
                    <span className="k-statuslegend__hi">{STATUS_HI[s]}</span>
                    <span className="k-statuslegend__count">{statusCounts[s] || 0}</span>
                  </div>
                ))}
              </div>
              <div className="k-meter">
                <div className="k-meter__bar">
                  <div className="k-meter__fill" style={{ width: donePct + '%' }} />
                </div>
                <div className="k-meter__lbl">
                  {donePct}% complete · <span className="hi-mute">{donePct}% सम्पन्न</span>
                </div>
              </div>
            </Card>
          </div>

          {/* RIGHT column */}
          <div className="k-col k-col--side">
            {/* Upcoming */}
            <Card title="Upcoming this week" sanskrit="आगामी सप्ताह">
              <div className="k-upcoming">
                {upcoming.length === 0 ? (
                  <div style={{ color: 'var(--ink-3)', fontStyle: 'italic', fontSize: 13 }}>Nothing due this week.</div>
                ) : upcoming.map(t => {
                  const assignees = (t.assignee_names || []).map((name, j) => ({ name, color: AVATAR_COLORS[j % AVATAR_COLORS.length] }));
                  return (
                    <button key={t.task_id} className="k-upcoming__row" onClick={() => navigate('/tasks')}>
                      <DueChip date={t.due_at} flush status={t.status} completedAt={t.completed_at} />
                      <div className="k-upcoming__body">
                        <div className="k-upcoming__title">{t.title}</div>
                        {t.team_name && <div className="k-upcoming__meta"><ProjectTag name={t.team_name} dense /></div>}
                      </div>
                      <AvatarStack users={assignees} size={18} max={2} />
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Recent activity */}
            <Card title="Team pulse" sanskrit="दल की गतिविधि" right={<button className="k-link" onClick={() => navigate('/activity')}>All activity →</button>}>
              <div className="k-activity">
                {activity.length === 0 ? (
                  <div style={{ color: 'var(--ink-3)', fontStyle: 'italic', fontSize: 13 }}>No recent activity.</div>
                ) : activity.slice(0,6).map((a, i) => {
                  const initials = userInitials(a.actor_name || a.actor || '');
                  const color    = AVATAR_COLORS[i % AVATAR_COLORS.length];
                  return (
                    <div key={a.event_id || i} className="k-activity__row">
                      <span className="k-avatar" style={{ width: 22, height: 22, fontSize: 9, background: color, flexShrink: 0 }}>
                        {initials}
                      </span>
                      <div className="k-activity__body">
                        <div className="k-activity__line">
                          <b>{(a.actor_name || a.actor || 'Someone').split(' ')[0]}</b>{' '}
                          <span className="k-mute">{a.verb || a.type || 'updated'}</span>{' '}
                          <span className="k-activity__what">{a.subject_title || a.task_title || ''}</span>
                        </div>
                        <div className="k-activity__when">{relTime(a.created_at || a.at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Verse of the day */}
            {verse ? (
              <Citation
                sanskrit={verse.sanskrit}
                english={verse.english}
                source={verse.ref || 'Bhagavad Gītā'}
              />
            ) : (
              <Citation
                sanskrit="कर्मण्येवाधिकारस्ते मा फलेषु कदाचन"
                english="You have a right to action alone, never to its fruits."
                source="Bhagavad Gītā 2.47"
              />
            )}
          </div>
        </section>
      )}

      {loading && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
          Loading…
        </div>
      )}
    </div>
  );
}
