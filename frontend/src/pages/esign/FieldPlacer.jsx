import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Select } from '../../components/ui';
import {
  FIELD_KINDS, KIND, makeField, moveField, resizeField, clampField,
  dropSigner, describeField,
} from './fieldPlacement';

/**
 * The page stage: place a signature box where it goes on the page.
 *
 * ── WHAT THIS IS A PREVIEW OF, HONESTLY ────────────────────────────────────
 *
 * It is NOT the PDF. There is no PDF renderer in this repo — zero pdf packages
 * in `package.json`, zero in `node_modules` — and the brief forbids pulling one
 * off a CDN. So the page is the prototype's own stand-in
 * (`ScreensThin.jsx:404-407`): a 1:1.294 sheet with twelve placeholder text
 * rules on it. The prototype ships exactly this and calls it "page 2 of 2".
 *
 * That limit is stated ON the surface (`.docfp-hint` below), not hidden in a
 * comment, because a person placing a signature over a paragraph they cannot
 * see is entitled to know that is what they are doing. The stage becomes a real
 * page render the moment `pdfjs-dist` is added — the coordinates this produces
 * do not change, because they are percentages of the page box.
 *
 * ── WHY DRAG *AND* ARROW KEYS ──────────────────────────────────────────────
 *
 * The prototype writes `cursor: 'grab'` and implements no dragging at all; its
 * fields are a static arrangement. Dragging is the obvious interaction and it
 * is here. It is also unusable without a pointer, so the focused field moves on
 * the arrow keys (1%, or 5% with Shift) and resizes with Alt held, and Delete
 * removes it. 23-accessibility.md §2 — a surface whose only affordance is a
 * drag has no keyboard path, and this one is a legal document.
 */

/* The prototype's placeholder paragraph (ScreensThin.jsx:404). 0 is a gap. */
const RULES = [96, 88, 92, 76, 0, 94, 90, 84, 62, 0, 88, 91];

/** Rotated per page so two pages are visibly different pages. */
const rulesFor = page => {
  const n = ((page - 1) * 3) % RULES.length;
  return RULES.slice(n).concat(RULES.slice(0, n));
};

export default function FieldPlacer({
  fields, setFields, signers, pageCount, pageCountKnown, hasFile, disabled = false,
}) {
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(null);
  const [who, setWho] = useState(1);
  const pageRef = useRef(null);
  const drag = useRef(null);

  const signerCount = signers.length;

  /* A signer removed while their field is selected, or while they are the
     active signer, must not leave either pointing at a row that is gone. */
  useEffect(() => {
    if (who > signerCount) setWho(signerCount || 1);
  }, [who, signerCount]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount || 1);
  }, [page, pageCount]);

  const update = useCallback((id, fn) => {
    setFields(prev => prev.map(f => (f.id === id ? clampField(fn(f)) : f)));
  }, [setFields]);

  const remove = useCallback((id) => {
    setFields(prev => prev.filter(f => f.id !== id));
    setSel(s => (s === id ? null : s));
  }, [setFields]);

  /* The new field is built from `fields` — the prop — and NOT inside the
     updater. A `setSel` call inside a `setFields` updater runs during React's
     render pass and warns "Cannot update a component while rendering a
     different component"; the prop is already the current value here, so the
     updater has nothing to read. */
  const add = (kindId) => {
    const f = makeField(kindId, who, page, fields);
    setFields(prev => [...prev, f]);
    setSel(f.id);
  };

  /* ── Drag ──────────────────────────────────────────────────────────────
     Percentages of the STAGE, read at pointerdown. The element is
     `position: relative` and the field's inset percentages resolve against the
     same box, so dx/rect.width is exactly the delta in stored units — no
     scaling factor to keep in sync with the CSS. */
  const onPointerDown = (e, f) => {
    if (disabled) return;
    setSel(f.id);
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    drag.current = { id: f.id, x: e.clientX, y: e.clientY, left: f.left, top: f.top, rect };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dLeft = ((e.clientX - d.x) / d.rect.width) * 100;
    const dTop = ((e.clientY - d.y) / d.rect.height) * 100;
    update(d.id, f => ({ ...f, left: d.left + dLeft, top: d.top + dTop }));
  };

  const endDrag = (e) => {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  /* ── Keyboard ─────────────────────────────────────────────────────────── */
  const onKeyDown = (e, f) => {
    if (disabled) return;
    const step = e.shiftKey ? 5 : 1;
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nudge) {
      e.preventDefault();
      const [dx, dy] = nudge;
      update(f.id, cur => (e.altKey
        ? resizeField(cur, dx * step, dy * step)
        : moveField(cur, dx * step, dy * step)));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(f.id);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSel(f.id);
    }
  };

  const onPage = fields.filter(f => f.page === page);
  const nameOf = order => signers[order - 1]?.name?.trim() || `Signer ${order}`;
  const initialOf = order => (nameOf(order)[0] || '?').toUpperCase();

  return (
    <>
      <div className="docfp-stage">
        <div className="docfp-page" ref={pageRef}>
          {hasFile
            ? rulesFor(page).map((w, i) => (
              w
                ? <div key={i} className="docfp-rule" style={{ width: `${w}%` }} />
                : <div key={i} className="docfp-gap" />
            ))
            : <p className="docfp-blank">Attach the PDF and this becomes the page you place fields on.</p>}

          {onPage.map(f => (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              aria-pressed={sel === f.id}
              aria-label={describeField(f, nameOf(f.signer_order))}
              className={`docfp-f${sel === f.id ? ' on' : ''}`}
              style={{
                top: `${f.top}%`, left: `${f.left}%`,
                width: `${f.width}%`, height: `${f.height}%`,
              }}
              onPointerDown={e => onPointerDown(e, f)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={e => onKeyDown(e, f)}
            >
              <span className="docfp-f__w" aria-hidden="true">{initialOf(f.signer_order)}</span>
              <span className="docfp-f__l">{KIND[f.kind]?.label || f.kind}</span>
              <button
                type="button"
                className="docfp-f__x"
                aria-label={`Remove ${describeField(f, nameOf(f.signer_order))}`}
                onPointerDown={e => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); remove(f.id); }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="docfp-bar">
        <div className="docfp-who">
          <label htmlFor="docfp-who-sel">Place fields for</label>
          <Select
            id="docfp-who-sel"
            className="docfp-who__sel"
            value={who}
            onChange={e => setWho(+e.target.value)}
            disabled={disabled || signerCount === 0}
          >
            {signers.map((s, i) => (
              <option key={i} value={i + 1}>{i + 1}. {s.name.trim() || `Signer ${i + 1}`}</option>
            ))}
          </Select>
        </div>

        <div className="docfp-kinds">
          {FIELD_KINDS.map(k => (
            <button
              key={k.id}
              type="button"
              className="chip"
              disabled={disabled || !hasFile || signerCount === 0}
              onClick={() => add(k.id)}
            >
              <Plus size={12} aria-hidden="true" /> {k.label}
            </button>
          ))}
        </div>

        {pageCount > 1 && (
          <div className="docfp-pages">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => {
              const n = fields.filter(f => f.page === p).length;
              return (
                <button
                  key={p}
                  type="button"
                  className={`docfp-pg${p === page ? ' on' : ''}`}
                  aria-current={p === page ? 'true' : undefined}
                  onClick={() => setPage(p)}
                >
                  {p}{n ? ` · ${n}` : ''}
                </button>
              );
            })}
            <span className="docfp-pgn">page {page} of {pageCount}</span>
          </div>
        )}

        <p className="docfp-hint">
          {hasFile
            ? <>Drag a field to move it, or focus it and use the arrow keys — <b>Shift</b> for
              5%, <b>Alt</b> to resize, <b>Delete</b> to remove.</>
            : 'Fields can be placed once a PDF is attached.'}
          {' '}
          {hasFile && !pageCountKnown && (
            <b>This PDF stores its page tree compressed, so the page count could not be read
              from it — the stage shows one page.</b>
          )}
        </p>

        <p className="docfp-hint">
          The sheet above is a <b>page-shaped guide, not a render of your PDF</b> — this build
          has no PDF viewer. Positions are stored as percentages of the page, so they land in
          the same place once one is added.
        </p>
      </div>
    </>
  );
}

/** Re-exported so `CreateTab` has one import for the whole feature. */
export { dropSigner };
