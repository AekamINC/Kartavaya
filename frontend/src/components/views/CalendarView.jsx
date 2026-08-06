import React, { useState, useRef, useEffect, useMemo } from "react";
import { api } from "../../lib/api";
import TaskDrawer from "../TaskDrawer";
import { PRIORITY_COLOR as PCOLOR, logger } from '../../lib/utils';
import { mixAlpha } from '../../lib/statusColors';

const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const HOURS  = Array.from({ length: 24 }, (_, i) => i);
const ROW_H  = 54;

// Pure helper — no component deps, lives at module scope
function fmtHour(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

export default function CalendarView({ tasks, teamMembers, onDayClick, onTasksChange }) {
  // selDate is the single source of truth for all three views.
  // year/month are derived from it — no independent state that can drift.
  const [selDate,      setSelDate]      = useState(() => new Date());
  const [drawer,       setDrawer]       = useState(null);
  const [dragOver,     setDragOver]     = useState(null);
  const [hoveredDay,   setHoveredDay]   = useState(null);   // month view
  const [hoveredSlot,  setHoveredSlot]  = useState(null);   // week/day: `${dayIdx}-${hour}`
  const [viewMode,     setViewMode]     = useState('month');
  // Tick state so the component re-renders every minute and `now` stays fresh
  const [, setTick] = useState(0);

  const draggingId = useRef(null);
  const gridRef    = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fresh `now` on every render — guaranteed accurate because of the 60s tick
  const now   = new Date();
  const today = now.toDateString();

  // Derived from selDate
  const year  = selDate.getFullYear();
  const month = selDate.getMonth();

  // Scroll to 8 AM when entering week/day view
  useEffect(() => {
    if (viewMode !== 'month' && gridRef.current) {
      gridRef.current.scrollTop = ROW_H * 8 - 8;
    }
  }, [viewMode]);

  // ── Month grid helpers (memoized) ────────────────────────────────────────
  const firstDay = new Date(year, month, 1).getDay();
  const numDays  = new Date(year, month + 1, 0).getDate();

  const byDay = useMemo(() => {
    const map = {};
    (tasks || []).forEach(t => {
      if (!t.due_at) return;
      const d = new Date(t.due_at);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(t);
      }
    });
    return map;
  }, [tasks, year, month]);

  const cells = useMemo(() => {
    const c = [];
    for (let i = 0; i < firstDay; i++) c.push({ blank: true });
    for (let d = 1; d <= numDays; d++) c.push({ blank: false, day: d });
    while (c.length % 7 !== 0) c.push({ blank: true });
    return c;
  }, [firstDay, numDays]);

  // ── Week helpers (memoized) ───────────────────────────────────────────────
  const weekStart = useMemo(() => {
    const d = new Date(selDate);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [selDate]);

  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    }),
  [weekStart]);

  // ── O(1) task lookup for week/day grid ───────────────────────────────────
  // Pre-bucket once per tasks change; each slot lookup is a Map get, not O(n).
  const taskSlotIndex = useMemo(() => {
    const index = {};
    (tasks || []).forEach(t => {
      if (!t.due_at) return;
      const d = new Date(t.due_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
      if (!index[key]) index[key] = [];
      index[key].push(t);
    });
    return index;
  }, [tasks]);

  const getTasksForHour = (date, hour) =>
    taskSlotIndex[`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${hour}`] || [];

  // ── Navigation (all views mutate selDate only) ────────────────────────────
  const shiftMonth = (dir) => {
    setSelDate(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  };

  const shiftDays = (n) => {
    setSelDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + n);
      return d;
    });
  };

  const prevNav = () => viewMode === 'month' ? shiftMonth(-1) : viewMode === 'week' ? shiftDays(-7) : shiftDays(-1);
  const nextNav = () => viewMode === 'month' ? shiftMonth(1)  : viewMode === 'week' ? shiftDays(7)  : shiftDays(1);

  const goToDay = (date) => { setSelDate(new Date(date)); setViewMode('day'); };

  // ── Drag & drop — month view only ────────────────────────────────────────
  // handleDrop now receives explicit year/month/day so it never reads stale state.
  // Week/day pills have no `draggable` — the drop affordance is removed until
  // time-grid drop is fully implemented.
  const handleDragStart = (e, taskId) => { draggingId.current = taskId; e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver  = (e, day)    => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(day); };
  const handleDragLeave = (e)         => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); };

  const handleDrop = async (e, targetYear, targetMonth, targetDay) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = draggingId.current;
    if (!taskId) return;
    draggingId.current = null;
    const task   = (tasks || []).find(t => t.task_id === taskId);
    const orig   = task?.due_at ? new Date(task.due_at) : new Date();
    const newDue = new Date(targetYear, targetMonth, targetDay, orig.getHours(), orig.getMinutes(), orig.getSeconds());
    try {
      const res = await api.put(`/tasks/${taskId}`, { due_at: newDue.toISOString() });
      onTasksChange?.(prev => prev.map(t => t.task_id === taskId ? res.data : t));
    } catch (err) { logger.error("Reschedule failed", err); }
  };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const navBtn = {
    background: "var(--s-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--r-sm)",
    padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--on-surface)",
  };

  const pill = (priority) => ({
    display: "flex", alignItems: "center", gap: 4,
    borderRadius: "var(--r-sm)", padding: "2px 5px", marginBottom: 2,
    cursor: "grab", fontSize: 11, lineHeight: 1.3,
    background: mixAlpha(PCOLOR[priority] || PCOLOR._default, 13),
    color: PCOLOR[priority] || PCOLOR._default, userSelect: "none",
  });

  // ── Nav title ─────────────────────────────────────────────────────────────
  const navTitle = () => {
    if (viewMode === 'month') return `${MONTHS[month]} ${year}`;
    if (viewMode === 'week') {
      const wEnd = weekDays[6];
      return weekStart.getMonth() === wEnd.getMonth()
        ? `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}–${wEnd.getDate()}, ${weekStart.getFullYear()}`
        : `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTHS[wEnd.getMonth()]} ${wEnd.getDate()}, ${wEnd.getFullYear()}`;
    }
    return `${DAYS[selDate.getDay()]}, ${MONTHS[selDate.getMonth()]} ${selDate.getDate()}, ${selDate.getFullYear()}`;
  };

  // ── Time grid (shared by week + day) ──────────────────────────────────────
  const renderTimeGrid = (days) => (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--outline-variant)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>

      {/* Day header row */}
      <div style={{ display: 'flex', background: 'var(--s-low)', borderBottom: '1px solid var(--outline-variant)', flexShrink: 0 }}>
        <div style={{ width: 58, flexShrink: 0, borderRight: '1px solid var(--outline-variant)' }} />
        {days.map((day, i) => {
          const isToday = day.toDateString() === today;
          return (
            <div
              key={i}
              style={{
                flex: 1, textAlign: 'center', padding: '8px 4px',
                borderLeft: i > 0 ? '1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)' : 'none',
                background: isToday ? 'color-mix(in srgb, var(--primary) 10%, var(--surface))' : 'transparent',
                cursor: days.length > 1 ? 'pointer' : 'default',
              }}
              onClick={() => days.length > 1 && goToDay(day)}
              title={days.length > 1 ? 'Switch to day view' : undefined}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase' }}>{DAYS[day.getDay()]}</div>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', margin: '4px auto 0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: isToday ? 700 : 400,
                color: isToday ? 'var(--on-primary)' : 'var(--on-surface)',
                background: isToday ? 'var(--primary)' : 'transparent',
              }}>{day.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Scrollable hour rows */}
      <div ref={gridRef} style={{ overflowY: 'auto', maxHeight: 580 }}>
        {HOURS.map(hour => {
          const isCurrentHour = now.getHours() === hour;
          return (
            <div key={hour} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)', flexShrink: 0, position: 'relative' }}>
              <div style={{
                width: 58, flexShrink: 0, paddingRight: 8, paddingTop: 4,
                fontSize: 10, color: 'var(--on-surface-3)', textAlign: 'right',
                borderRight: '1px solid var(--outline-variant)', background: 'var(--s-low)',
              }}>
                {fmtHour(hour)}
              </div>

              {days.map((day, i) => {
                const slotTasks  = getTasksForHour(day, hour);
                const isToday    = day.toDateString() === today;
                const showNowBar = isToday && isCurrentHour;
                const slotKey    = `${i}-${hour}`;
                const isHovered  = hoveredSlot === slotKey;

                return (
                  <div
                    key={i}
                    onClick={() => { if (onDayClick) { const d = new Date(day); d.setHours(hour, 0, 0, 0); onDayClick(d); } }}
                    onMouseEnter={() => setHoveredSlot(slotKey)}
                    onMouseLeave={() => setHoveredSlot(null)}
                    style={{
                      flex: 1,
                      borderLeft: i > 0 ? '1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)' : 'none',
                      // Hover color controlled via React state — survives re-renders
                      background: isHovered && onDayClick
                        ? 'color-mix(in srgb, var(--primary) 9%, var(--surface))'
                        : isToday
                        ? 'color-mix(in srgb, var(--primary) 3%, var(--surface))'
                        : 'var(--surface)',
                      padding: '3px 4px',
                      cursor: onDayClick ? 'pointer' : 'default',
                      position: 'relative',
                    }}
                  >
                    {/* Current-time bar — accurate because now re-renders every 60s */}
                    {showNowBar && (
                      <div style={{
                        position: 'absolute', left: 0, right: 0,
                        top: `${(now.getMinutes() / 60) * 100}%`,
                        height: 2, background: 'var(--primary)', zIndex: 3, pointerEvents: 'none',
                      }} />
                    )}
                    {/* No `draggable` here — drop target not yet implemented for time grid */}
                    {slotTasks.map(task => (
                      <div
                        key={task.task_id}
                        style={pill(task.priority)}
                        onClick={e => { e.stopPropagation(); setDrawer(task.task_id); }}
                        title={task.title}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: PCOLOR[task.priority] || PCOLOR._default, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button style={navBtn} onClick={prevNav}>‹ Prev</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--on-surface)", fontFamily: "var(--font-display)" }}>{navTitle()}</span>
        <button style={navBtn} onClick={nextNav}>Next ›</button>
      </div>

      {/* View switcher */}
      <div style={{ display: 'flex', gap: 4, alignSelf: 'center', background: 'var(--s-low)', borderRadius: 'var(--r-md)', padding: 3, border: '1px solid var(--outline-variant)' }}>
        {['month', 'week', 'day'].map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              background: viewMode === mode ? 'var(--surface)' : 'transparent',
              border: viewMode === mode ? '1px solid var(--outline-variant)' : '1px solid transparent',
              borderRadius: 'var(--r-sm)', padding: '4px 14px', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, fontWeight: viewMode === mode ? 600 : 400,
              color: viewMode === mode ? 'var(--on-surface)' : 'var(--on-surface-3)',
              boxShadow: viewMode === mode ? 'var(--shadow-1)' : 'none',
              transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)',
            }}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Month view ── */}
      {viewMode === 'month' && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, background: "var(--outline-variant)", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--outline-variant)" }}>
            {DAYS.map(d => (
              <div key={d} style={{ background: "var(--s-low)", padding: "8px 0", textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "var(--on-surface-3)", textTransform: "uppercase" }}>{d}</div>
            ))}
            {cells.map((cell, idx) => {
              if (cell.blank) return (
                <div key={`b${idx}`} style={{ background: "var(--s-low)", minHeight: 90 }} onDragOver={e => e.preventDefault()} />
              );
              const isToday  = new Date(year, month, cell.day).toDateString() === today;
              const isOver   = dragOver === cell.day;
              const dayTasks = byDay[cell.day] || [];
              const visible  = dayTasks.slice(0, 3);
              const overflow = dayTasks.length - 3;
              return (
                <div key={cell.day}
                  style={{
                    background: isOver || isToday ? "color-mix(in srgb, var(--primary) 8%, var(--surface))" : "var(--surface)",
                    minHeight: 90, padding: "6px 8px", cursor: "default", position: "relative",
                    outline: isOver ? `2px solid var(--primary)` : "none", transition: "background var(--dur-instant) var(--ease-standard)",
                  }}
                  onDoubleClick={() => onDayClick?.(new Date(year, month, cell.day, 12, 0))}
                  onMouseEnter={() => setHoveredDay(cell.day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  onDragOver={e => handleDragOver(e, cell.day)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, year, month, cell.day)}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div
                      style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--primary)" : "var(--on-surface-3)", cursor: 'pointer' }}
                      onClick={() => goToDay(new Date(year, month, cell.day))}
                      title="Switch to day view"
                    >
                      {cell.day}
                    </div>
                    {hoveredDay === cell.day && onDayClick && (
                      <button
                        onClick={e => { e.stopPropagation(); onDayClick(new Date(year, month, cell.day, 12, 0)); }}
                        title="Add task"
                        style={{
                          background: "var(--primary)", color: "var(--on-primary)", border: "none", borderRadius: "50%",
                          width: 16, height: 16, fontSize: 14, lineHeight: 1, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          padding: 0, fontFamily: "inherit",
                        }}
                      >+</button>
                    )}
                  </div>
                  {visible.map(task => (
                    <div key={task.task_id} draggable style={pill(task.priority)}
                      onDragStart={e => { e.stopPropagation(); handleDragStart(e, task.task_id); }}
                      onClick={e => { e.stopPropagation(); setDrawer(task.task_id); }}
                      onDoubleClick={e => e.stopPropagation()}
                      title={`${task.title} — drag to reschedule`}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: PCOLOR[task.priority] || PCOLOR._default, flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{task.title}</span>
                    </div>
                  ))}
                  {overflow > 0 && (
                    <div
                      style={{ fontSize: 11, color: "var(--on-surface-3)", marginTop: 2, cursor: 'pointer' }}
                      onClick={() => goToDay(new Date(year, month, cell.day))}
                    >
                      +{overflow} more
                    </div>
                  )}
                  {isOver && <div style={{ position: "absolute", inset: 0, border: "2px dashed var(--primary)", borderRadius: "var(--r-xs)", pointerEvents: "none" }} />}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--on-surface-3)" }}>
            {Object.entries(PCOLOR).map(([p, c]) => (
              <span key={p} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />{p}
              </span>
            ))}
            <span style={{ opacity: 0.5 }}>Drag to reschedule · Click + or double-click date to add task · Click date number for day view</span>
          </div>
        </>
      )}

      {/* ── Week view ── */}
      {viewMode === 'week' && renderTimeGrid(weekDays)}

      {/* ── Day view ── */}
      {viewMode === 'day' && renderTimeGrid([selDate])}

      <TaskDrawer taskId={drawer} open={!!drawer} onClose={() => setDrawer(null)}
        teamMembers={teamMembers}
        onSaved={u => { setDrawer(null); onTasksChange?.(p => p.map(t => t.task_id === u.task_id ? u : t)); }}
      />
    </div>
  );
}
