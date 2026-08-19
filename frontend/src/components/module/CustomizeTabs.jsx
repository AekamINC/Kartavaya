import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Modal from '../ui/modal';
import { Secondary } from '../Bilingual';
import { TAB_HI, tabEn } from './tabLabels';
import { currentUser } from '../../lib/auth';
import { navContext } from '../layout/navConfig';

/**
 * CustomizeTabs — the sheet behind "Customise tabs…" (proposal 67 · demo 2).
 *
 * Reorder the module's tabs and star the one it opens on. The dialog chrome is
 * `<Modal>` — the house scrim + FocusTrap + Escape + exit pair — because a
 * hand-rolled veil here would be the thirteenth copy of the three bugs Modal
 * exists to end. The reorder is @hello-pangea/dnd (already a dependency, and
 * its drag handle carries the keyboard grammar: Space lifts, arrows move,
 * Space drops), with ↑/↓ buttons beside it so the reorder also works without
 * knowing that grammar.
 *
 * Nothing here can hide a tab. The list is the module's whole set; order and
 * the star are the only two facts, which is why Save posts exactly
 * `{order, defaultTab, forTeam}` and nothing else.
 *
 * "Make this the team default" renders only for an org admin, decided by
 * `navContext(currentUser()).isOrgAdmin` — the ACTIVE org's role row, the same
 * predicate that decides the admin rows of the sidebar. A per-page copy of
 * that check is how the product once ended up with three competing access
 * rules (see the drawer-403 incident), so it is read from the one place.
 *
 * "Reset to standard" rearranges the DRAFT to `standard` (the hook's shipped
 * order + opening tab) and nothing else — Save is still what writes. The
 * server-row reset (the personal DELETE, with its org-default resolution)
 * lives on useTabPrefs as `reset()` for any page that needs it; wiring it to
 * this button would make "reset" write while "save" also writes, two commit
 * verbs in one sheet.
 */

/**
 * The row shell of one draggable tab, portalled to document.body while it is
 * being dragged. `.modal__panel` carries a backdrop-filter, and a filtered
 * element is a CONTAINING BLOCK for position:fixed descendants — the dnd
 * clone is fixed-positioned, so rendered inside the panel it offsets from the
 * pointer by the panel's own top-left. document.body restores the viewport as
 * the containing block; the classes travel with the row, so the visuals do
 * not change. Exported because jsdom cannot lift a real drag: the spec pins
 * the portal decision directly.
 */
export function DragRow({ provided, snapshot, children }) {
  const row = (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      className={`ktabs__row${snapshot.isDragging ? ' is-dragging' : ''}`}
    >
      {children}
    </div>
  );
  return snapshot.isDragging ? createPortal(row, document.body) : row;
}

export default function CustomizeTabs({ open, onClose, tabs, defaultTab, standard, onSave }) {
  const ids = useMemo(
    () => (tabs || []).map((t) => (typeof t === 'string' ? t : t?.id)).filter(Boolean),
    [tabs],
  );
  const labels = useMemo(() => {
    const m = {};
    for (const t of tabs || []) {
      if (typeof t === 'string') m[t] = tabEn(t);
      else if (t?.id) m[t.id] = t.label ?? tabEn(t.id);
    }
    return m;
  }, [tabs]);

  const [draft, setDraft] = useState(ids);
  const [draftDefault, setDraftDefault] = useState(defaultTab);
  const [forTeam, setForTeam] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-seeded from the live props each time the sheet OPENS, and only then:
  // while it is open the draft belongs to the user, and a server answer
  // arriving mid-edit must not rewrite what they are holding.
  useEffect(() => {
    if (!open) return;
    setDraft(ids);
    setDraftDefault(defaultTab);
    setForTeam(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { isOrgAdmin } = navContext(currentUser());

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    setDraft((prev) => {
      const n = [...prev];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { index: from } = result.source;
    const { index: to } = result.destination;
    if (from === to) return;
    setDraft((prev) => {
      const n = [...prev];
      const [m] = n.splice(from, 1);
      n.splice(to, 0, m);
      return n;
    });
  };

  const doSave = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSave({ order: draft, defaultTab: draftDefault, forTeam });
    setBusy(false);
    // `false` means the PUT failed and the hook has already toasted — the
    // sheet stays open over the unsaved arrangement rather than discarding it.
    if (ok !== false) onClose();
  };

  // Draft-only: no server call, no close — the user sees the standard
  // arrangement in the rows and still decides with Save or Cancel. Filtered
  // against `ids` because the draft must stay a permutation of the tabs on
  // screen even if `standard` is a stale shape.
  const doReset = () => {
    if (busy || !standard) return;
    const std = (standard.order ?? []).filter((id) => ids.includes(id));
    const next = std.concat(ids.filter((id) => !std.includes(id)));
    setDraft(next);
    setDraftDefault(next.includes(standard.defaultTab) ? standard.defaultTab : next[0]);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Customise tabs"
      size="sm"
      dataTestId="customize-tabs"
      footer={(
        <>
          {standard && (
            <button
              type="button"
              className="btn btn--ghost ktabs__reset"
              disabled={busy}
              onClick={doReset}
            >
              Reset to standard
            </button>
          )}
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--fill" disabled={busy} onClick={doSave}>
            Save
          </button>
        </>
      )}
    >
      <p className="ktabs__sub">
        Drag to reorder — what fits sits on the strip, the rest waits in More.
        Star the tab this module opens on. Nothing is ever hidden.
      </p>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="ktabs">
          {(dropProvided) => (
            <div className="ktabs__rows" ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
              {draft.map((id, i) => (
                <Draggable draggableId={id} index={i} key={id}>
                  {(provided, snapshot) => (
                    <DragRow provided={provided} snapshot={snapshot}>
                      <button
                        type="button"
                        className="ktabs__grip"
                        aria-label={`Reorder ${labels[id] ?? tabEn(id)}. Space picks it up, arrows move it, Space drops it.`}
                        {...provided.dragHandleProps}
                      >
                        ⠿
                      </button>
                      <span className="ktabs__lab">
                        <span className="ktabs__en">{labels[id] ?? tabEn(id)}</span>
                        {TAB_HI[id] && <Secondary className="ktabs__hi" value={TAB_HI[id]} />}
                      </span>
                      {/* One star, always. Pressing a star MOVES it; pressing
                          the pressed one is a no-op — a module cannot open on
                          nothing, so the toggle has no off state. */}
                      <button
                        type="button"
                        className="ktabs__star"
                        aria-pressed={id === draftDefault}
                        title="Opens here"
                        aria-label={`Open this module on ${labels[id] ?? tabEn(id)}`}
                        onClick={() => setDraftDefault(id)}
                      >
                        ★
                      </button>
                      {/* aria-disabled, never disabled: these buttons hit
                          their edge WHILE FOCUSED (repeat-pressing ↑ walks a
                          row to the top), and a disabled element drops
                          keyboard focus to <body>. The press past the edge is
                          a no-op — move() guards it — announced as dimmed,
                          with focus kept. */}
                      <button
                        type="button"
                        className="ktabs__mv"
                        aria-label={`Move ${labels[id] ?? tabEn(id)} up`}
                        aria-disabled={i === 0 ? 'true' : undefined}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ktabs__mv"
                        aria-label={`Move ${labels[id] ?? tabEn(id)} down`}
                        aria-disabled={i === draft.length - 1 ? 'true' : undefined}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                    </DragRow>
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {isOrgAdmin && (
        <label className="ktabs__team">
          <input
            type="checkbox"
            checked={forTeam}
            onChange={(e) => setForTeam(e.target.checked)}
          />
          Make this the team default
        </label>
      )}
    </Modal>
  );
}
