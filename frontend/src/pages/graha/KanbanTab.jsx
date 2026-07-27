import React, { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonBoard, SkeletonRegion } from '../../components/ui/Skeleton';
import { dealStaleness, RotBadge, Badge, stageColor } from './_shared';
import { mixAlpha } from '../../lib/statusColors';
import { inr } from '../../lib/inr';

/**
 * KanbanTab — the CRM deal board.
 *
 * Three things were wrong with it, and all three are behaviour rather than
 * pixels, so the geometry below is untouched.
 *
 * 1 · **There was no drag.** Moving a deal meant clicking one of a row of tiny
 *     stage buttons printed on every card — five buttons per card, on a board
 *     whose entire purpose is dragging. `@hello-pangea/dnd` is already a
 *     dependency and `views/KanbanView.jsx` already uses it for the task board;
 *     this is the same construction, so the two boards now behave alike. The
 *     buttons stay as the keyboard and touch fallback, which is not a
 *     concession — the library's own keyboard sensor needs the card focused,
 *     and MOTION-SPEC §7.7 requires every hover/drag affordance to have a
 *     non-pointer equivalent.
 *
 * 2 · **The move was not optimistic and refetched the whole board.**
 *     `await PATCH` then `load()`: the card sat still for a round trip, then
 *     every column re-rendered from scratch and the card reappeared somewhere
 *     else. MOTION-SPEC §7.1 — the card now moves immediately, renders at
 *     `opacity .6` until the server acknowledges, flashes once when it lands,
 *     and is put back where it came from if the write fails. No refetch: the
 *     response replaces the one card it is about.
 *
 * 3 · **A failed fetch rendered as an empty state.** `catch { pushToast }` left
 *     `kanban` at `{}`, so a 500 painted a full board of "No deals" columns —
 *     a confident, wrong answer. There is no way for the user to tell that from
 *     a genuinely empty pipeline, and the toast that says otherwise is gone in
 *     four seconds. It now renders `ErrorState` with the retry.
 */
// `draggableId` is always a string — the library stringifies it — while
// `deal.id` arrives as whatever the API sent. Comparing the two directly is a
// silent no-op that would make drag "work" right up until ids stop being
// strings, so every id crossing that boundary goes through `sid`. Module scope,
// not the component body, so it is stable across renders and safe to leave out
// of every dependency array below.
const sid = (v) => String(v);

export default function KanbanTab() {
  const { pushToast } = useToast();
  const [kanban, setKanban] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [stageList, setStageList] = useState(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);

  // Transient per-card flags. `pending` is the in-flight dim, `landed` the
  // one-shot settle flash. Sets rather than a field on the deal so a refetch
  // cannot resurrect a stale flag.
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [landedIds, setLandedIds] = useState(() => new Set());
  const timers = useRef(new Set());

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const markTransient = useCallback((setter, id, ms) => {
    setter(prev => new Set(prev).add(id));
    const h = setTimeout(() => {
      timers.current.delete(h);
      setter(prev => { const n = new Set(prev); n.delete(id); return n; });
    }, ms);
    timers.current.add(h);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get('/v1/graha/deals/kanban');
      setKanban(r.data.columns || {});
      if (r.data.stages?.length) setStageList(r.data.stages);
    } catch (e) {
      // The toast still fires — it is the thing a sighted user notices first —
      // but the board no longer claims to be empty behind it.
      setErr(e);
      pushToast({ title: 'Failed to load kanban', type: 'error' });
    } finally { setLoading(false); }
  }, [pushToast]);

  useEffect(() => { load(); }, [load]);

  /**
   * Move one deal to another stage, optimistically.
   *
   * `previous` is the whole deal record and the whole source column, not just
   * the stage string: restoring the stage alone would leave the card at the
   * position it was dropped in, inside the column it came from — the failure
   * mode `KanbanView` calls out by name.
   */
  const moveStage = useCallback(async (dealId, fromStage, toStage, toIndex) => {
    if (fromStage === toStage && toIndex == null) return;

    let snapshot = null;
    // flushSync: @hello-pangea/dnd reads the DOM synchronously in its own
    // cleanup, and React 18 would otherwise batch this move past that read.
    flushSync(() => {
      setKanban(prev => {
        snapshot = prev;
        const src = [...(prev[fromStage] || [])];
        const i = src.findIndex(d => sid(d.id) === sid(dealId));
        if (i === -1) return prev;
        const [moved] = src.splice(i, 1);
        const dst = fromStage === toStage ? src : [...(prev[toStage] || [])];
        dst.splice(toIndex == null ? dst.length : toIndex, 0, { ...moved, stage: toStage });
        return { ...prev, [fromStage]: src, [toStage]: dst };
      });
    });

    setPendingIds(prev => new Set(prev).add(sid(dealId)));
    try {
      const res = await api.patch(`/v1/graha/deals/${dealId}`, { stage: toStage });
      // Replace only the card the response is about. A whole-board refetch here
      // would discard any other card the user moved while this one was in
      // flight, which is the common case on a board being tidied.
      const fresh = res?.data?.data || res?.data;
      if (fresh && fresh.id != null) {
        setKanban(prev => ({
          ...prev,
          [toStage]: (prev[toStage] || []).map(d => (sid(d.id) === sid(dealId) ? { ...d, ...fresh } : d)),
        }));
      }
      markTransient(setLandedIds, sid(dealId), 600);
    } catch {
      pushToast({ title: 'Could not move deal', type: 'error' });
      if (snapshot) setKanban(snapshot);
    } finally {
      setPendingIds(prev => { const n = new Set(prev); n.delete(sid(dealId)); return n; });
    }
  }, [markTransient, pushToast]);

  const onDragEnd = useCallback((result) => {
    const { draggableId, source, destination } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    moveStage(draggableId, source.droppableId, destination.droppableId, destination.index);
  }, [moveStage]);

  if (loading) {
    return (
      <SkeletonRegion label="Loading pipeline">
        <SkeletonBoard columns={4} cards={3} />
      </SkeletonRegion>
    );
  }

  // `errorKind` separates a train tunnel from a 500 from a missing grant. One
  // generic "something went wrong" tells the user nothing and offers nothing.
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const stages = stageList;

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
        {stages.map(stage => {
          const deals = kanban[stage] || [];
          const total = deals.reduce((s, d) => s + Number(d.value || 0), 0);
          return (
            <Droppable key={stage} droppableId={stage}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`ix-drop-target${snapshot.isDraggingOver ? ' is-over' : ''}`}
                  style={{ minWidth: 220, flex: '1 0 220px', background: 'var(--surface-1)', borderRadius: 'var(--r-md)', padding: 16 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Badge text={stage} color={stageColor(stage)} />
                    {/* The count previews the new total while a card is held
                        over this column — IxViews 9.1. The dragged card is still
                        counted in its source column until the drop commits, so
                        only the target previews; showing both would
                        double-count for the length of the hover. */}
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {deals.length + (snapshot.isDraggingOver && !deals.some(d => sid(d.id) === snapshot.draggingOverWith) ? 1 : 0)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>{inr(total)}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {deals.map((d, idx) => {
                      const rot = (stage !== 'Won' && stage !== 'Lost') ? dealStaleness(d.updated_at) : null;
                      const pending = pendingIds.has(sid(d.id));
                      return (
                        <Draggable key={sid(d.id)} draggableId={sid(d.id)} index={idx} isDragDisabled={pending}>
                          {(dp, ds) => (
                            <div
                              ref={dp.innerRef}
                              {...dp.draggableProps}
                              {...dp.dragHandleProps}
                              className={[
                                'ix-drag-card',
                                ds.isDragging && 'is-dragging',
                                pending && 'ix-pending',
                                landedIds.has(sid(d.id)) && 'ix-landed',
                              ].filter(Boolean).join(' ')}
                              style={{
                                background: rot?.level === 'critical' ? 'color-mix(in srgb, var(--danger) 4%, var(--bg))' : 'var(--bg)',
                                border: `1px solid ${rot?.level === 'critical' ? mixAlpha('var(--danger)', 19) : rot?.level === 'warning' ? mixAlpha('var(--warn)', 15) : 'var(--rule-soft)'}`,
                                borderRadius: 'var(--r-md)', padding: 10,
                                // Was two literal rgba shadows, which are black-on-black in
                                // dark mode. --shadow-1 is the token and flips with the theme.
                                boxShadow: 'var(--shadow-1)',
                                // The library writes transform/position here; it must come
                                // last or it is overwritten by the object above.
                                ...dp.draggableProps.style,
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{d.title}</div>
                              {d.client_name && <div style={{ fontSize: 11, color: 'var(--k-primary)', fontWeight: 600, marginBottom: 2 }}>{d.client_name}</div>}
                              {d.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>{d.contact_name}</div>}
                              {d.owner_id && <div style={{ fontSize: 'var(--t-label-sm)', color: 'var(--ink-3)', marginBottom: 4 }}>Owner: {d.owner_id.substring(0, 8)}…</div>}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <span style={{ fontSize: 13, fontWeight: 700 }}>{inr(Number(d.value || 0))}</span>
                                {stage !== 'Won' && stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                              </div>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {stages.filter(s => s !== stage).map(s => (
                                  // `${STAGE_COLORS[s]}18` produced the string
                                  // "var(--st-todo)18" — not a colour, silently dropped, so
                                  // every stage-move button rendered with no fill at all.
                                  <button key={s} type="button" disabled={pending}
                                    // Without this the pointerdown reaches the drag handle
                                    // and a click on the button starts a drag instead.
                                    onMouseDown={e => e.stopPropagation()}
                                    onTouchStart={e => e.stopPropagation()}
                                    onClick={e => { e.stopPropagation(); moveStage(d.id, stage, s, null); }}
                                    style={{ fontSize: 'var(--t-label-sm)', padding: '2px 6px', borderRadius: 'var(--r-xs)',
                                      background: mixAlpha(stageColor(s), 9),
                                      color: stageColor(s), border: 'none', cursor: pending ? 'progress' : 'pointer', fontWeight: 600 }}>{s}</button>
                                ))}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                    {deals.length === 0 && !snapshot.isDraggingOver && (
                      <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 12 }}>No deals</p>
                    )}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}
