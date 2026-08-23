import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Modal from './modal';
import { MIN_WIDTH, MAX_WIDTH, clampWidth } from '../../hooks/useColumnPrefs';
import { currentUser } from '../../lib/auth';
import { navContext } from '../layout/navConfig';

/**
 * CustomizeColumns — the sheet behind "Columns…" on any table that opts into
 * `useColumnPrefs`. Inbox item 3, the control half.
 *
 * It is deliberately the same object as `module/CustomizeTabs`: the same
 * `<Modal>` chrome (house scrim + FocusTrap + Escape + exit pair), the same
 * @hello-pangea/dnd reorder with ↑/↓ buttons beside it, the same "Reset to
 * standard" draft-only verb, the same "Make this the team default" tick for org
 * admins. A user who has arranged their tabs already knows how to do this, and
 * a second dialect of the same idea is a second set of bugs.
 *
 * WHAT IS DIFFERENT, AND WHY
 * ──────────────────────────
 * A tab strip hides nothing — CustomizeTabs says so in as many words, because
 * what does not fit goes to More. A TABLE genuinely hides: a firm that never
 * looks at Source wants the column gone, not folded away. So each row here
 * carries a visibility checkbox and a width, and the two rules that follow from
 * hiding being real are enforced in this file as well as on the server:
 *
 *   · a column the page declared `fixed` cannot be hidden. That is the page
 *     asserting the column is load-bearing — the name column you identify the
 *     row by, the actions cell — and it is a checkbox rendered disabled with
 *     the reason on it, never a checkbox that silently does nothing.
 *   · the LAST visible column cannot be unticked. An arrangement that hides
 *     everything renders a table whose own "Columns…" button is inside the
 *     table it emptied. The server refuses that body with a 422; refusing the
 *     click is what stops the user meeting the 422.
 *
 * KEYBOARD
 * ────────
 * The grip carries dnd's own grammar (Space lifts, arrows move, Space drops)
 * and the ↑/↓ buttons do the same job without knowing it. Those buttons are
 * `aria-disabled`, never `disabled`: they hit their edge WHILE FOCUSED
 * (repeat-pressing ↑ walks a row to the top), and a disabled element drops
 * keyboard focus to <body>. The press past the edge is a no-op, announced as
 * dimmed, with focus kept. That is CustomizeTabs' fix and it is repeated
 * verbatim rather than rediscovered.
 */

/** Portalled to document.body while dragging: `.modal__panel` carries a
 *  backdrop-filter, and a filtered element is a CONTAINING BLOCK for
 *  position:fixed descendants — the dnd clone is fixed-positioned, so rendered
 *  inside the panel it offsets from the pointer by the panel's own top-left.
 *  Exported because jsdom cannot lift a real drag; the spec pins the decision
 *  directly. (Same fix, same reason, as CustomizeTabs' DragRow.) */
export function DragRow({ provided, snapshot, children }) {
  const row = (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      className={`kcols__row${snapshot.isDragging ? ' is-dragging' : ''}`}
    >
      {children}
    </div>
  );
  return snapshot.isDragging ? createPortal(row, document.body) : row;
}

export default function CustomizeColumns({
  open, onClose, all, standard, onSave, onReset, ownsVisibility = true,
}) {
  const [draft, setDraft] = useState(all || []);
  const [forTeam, setForTeam] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-seeded from the live props each time the sheet OPENS, and only then:
  // while it is open the draft belongs to the user, and a server answer
  // arriving mid-edit must not rewrite what they are holding.
  useEffect(() => {
    if (!open) return;
    setDraft(all || []);
    setForTeam(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { isOrgAdmin } = navContext(currentUser());

  const visibleCount = useMemo(
    () => draft.filter((c) => !c.hidden).length, [draft]);

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

  const toggle = (id) => setDraft((prev) => prev.map((c) => {
    if (c.id !== id) return c;
    // Belt and braces: the tick is not rendered at all when visibility is
    // someone else's, so this cannot be reached from the UI. It is still
    // refused here, because a sheet that would silently write `hidden: true`
    // into a row nothing reads is a sheet one careless prop away from lying.
    if (!ownsVisibility) return c;
    if (c.fixed) return c;
    // Un-ticking the last visible column is refused, not repaired.
    if (!c.hidden && prev.filter((x) => !x.hidden).length <= 1) return c;
    return { ...c, hidden: !c.hidden };
  }));

  const setWidth = (id, raw) => setDraft((prev) => prev.map((c) => (
    c.id === id
      ? { ...c, width: raw === '' || raw == null ? null : clampWidth(raw) }
      : c)));

  const doSave = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSave({ columns: draft, forTeam });
    setBusy(false);
    // `false` means the PUT failed and the hook has already toasted — the sheet
    // stays open over the unsaved arrangement rather than discarding it.
    if (ok !== false) onClose();
  };

  // Draft-only: no server call, no close — the user sees the standard
  // arrangement in the rows and still decides with Save or Cancel. The
  // server-row reset is the separate "Forget my layout" verb below, and the two
  // must not be merged: one rearranges what you are looking at, the other
  // deletes a row and may surface a team default underneath it.
  const doReset = () => {
    if (busy || !standard?.length) return;
    const known = new Set(draft.map((c) => c.id));
    const std = standard.filter((c) => known.has(c.id));
    const rest = draft.filter((c) => !std.some((s) => s.id === c.id));
    setDraft(std.concat(rest).map((c) => ({ ...c, hidden: false, width: c.width ?? null })));
  };

  const doForget = async () => {
    if (busy || !onReset) return;
    setBusy(true);
    const ok = await onReset();
    setBusy(false);
    if (ok !== false) onClose();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Columns"
      size="sm"
      dataTestId="customize-columns"
      footer={(
        <>
          {standard?.length > 0 && (
            <button type="button" className="btn btn--ghost kcols__reset"
              disabled={busy} onClick={doReset}>
              Reset to standard
            </button>
          )}
          {onReset && (
            <button type="button" className="btn btn--ghost kcols__forget"
              disabled={busy} onClick={doForget}>
              Forget my layout
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
      <p className="kcols__sub">
        {ownsVisibility
          ? `Drag to reorder, untick to hide, and set a width in pixels — leave
             the width blank to let the table decide. Your layout follows you to
             every device.`
          /* Named, not merely omitted. A user who has seen this sheet on
             another table will look for the tick boxes; saying where the
             switch actually lives is the difference between a considered
             design and a missing feature. */
          : `Drag to reorder and set a width in pixels — leave the width blank
             to let the table decide. Which fields appear is set in the board's
             own Fields control, so it stays the same on the board and here.
             Your layout follows you to every device.`}
      </p>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="kcols">
          {(dropProvided) => (
            <div className="kcols__rows" ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
              {draft.map((c, i) => {
                const last = !c.hidden && visibleCount <= 1;
                return (
                  <Draggable draggableId={c.id} index={i} key={c.id}>
                    {(provided, snapshot) => (
                      <DragRow provided={provided} snapshot={snapshot}>
                        <button
                          type="button"
                          className="kcols__grip"
                          aria-label={`Reorder ${c.label}. Space picks it up, arrows move it, Space drops it.`}
                          {...provided.dragHandleProps}
                        >
                          ⠿
                        </button>
                        {ownsVisibility ? (
                          <label className="kcols__show">
                            <input
                              type="checkbox"
                              checked={!c.hidden}
                              disabled={Boolean(c.fixed) || last}
                              title={c.fixed
                                ? 'This column identifies the row and cannot be hidden'
                                : last ? 'A table needs at least one column' : undefined}
                              onChange={() => toggle(c.id)}
                            />
                            <span className="kcols__lab">{c.label}</span>
                          </label>
                        ) : (
                          /* A `<span>`, not a disabled checkbox. A disabled
                             tick says "you may not change this here", which is
                             a different and wrong statement: the user may
                             absolutely change it, in the board's Fields
                             control. Rendering no tick at all says the honest
                             thing — visibility is not what this sheet is
                             about. It keeps `.kcols__show`'s layout so the
                             rows line up either way. */
                          <span className="kcols__show">
                            <span className="kcols__lab">{c.label}</span>
                          </span>
                        )}
                        <label className="kcols__w">
                          <span className="k-sr-only">{`Width of ${c.label} in pixels`}</span>
                          <input
                            className="inp kcols__wi"
                            type="number"
                            inputMode="numeric"
                            min={MIN_WIDTH}
                            max={MAX_WIDTH}
                            step={8}
                            placeholder="auto"
                            value={c.width ?? ''}
                            onChange={(e) => setWidth(c.id, e.target.value)}
                          />
                        </label>
                        {/* aria-disabled, never disabled — see the header. */}
                        <button
                          type="button"
                          className="kcols__mv"
                          aria-label={`Move ${c.label} up`}
                          aria-disabled={i === 0 ? 'true' : undefined}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="kcols__mv"
                          aria-label={`Move ${c.label} down`}
                          aria-disabled={i === draft.length - 1 ? 'true' : undefined}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </button>
                      </DragRow>
                    )}
                  </Draggable>
                );
              })}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {isOrgAdmin && (
        <label className="kcols__team">
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

/**
 * ColumnsButton — the toolbar control, so a table opts in with one element
 * rather than with a piece of dialog state per page. It goes in
 * `<TableToolbar>`'s children slot, beside the filters.
 */
export function ColumnsButton({ cols, label = 'Columns' }) {
  const [open, setOpen] = useState(false);
  const hidden = cols.all.length - cols.columns.length;
  return (
    <>
      <button type="button" className="k-btn k-btn--ghost kcols__btn"
        onClick={() => setOpen(true)}>
        {label}
        {/* The count is the point: a user who hid three columns last month has
            no other way to find out why this table looks short. */}
        {hidden > 0 && <span className="kcols__n"> · {hidden} hidden</span>}
      </button>
      <CustomizeColumns
        open={open}
        onClose={() => setOpen(false)}
        all={cols.all}
        standard={cols.standard}
        onSave={cols.save}
        onReset={cols.reset}
        ownsVisibility={cols.ownsVisibility !== false}
      />
    </>
  );
}
