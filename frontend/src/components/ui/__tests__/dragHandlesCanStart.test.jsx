/**
 * A drag handle rendered as a `<button>` needs the library's escape hatch.
 *
 * ── THE DEFECT, SUITE 20.12b ON 2026-08-31 ──────────────────────────────────
 *
 * `@hello-pangea/dnd` refuses to start a drag when the source event's target is
 * one of its own `interactiveTagNames` — and `button` is in that list. So
 * `tryStart` returns null before a lock is ever claimed, and **neither the
 * mouse path nor the keyboard path ever begins**.
 *
 * Two handles were inert:
 *   · `.ktabs__grip` — module tab order (`CustomizeTabs`)
 *   · `.kcols__grip` — table column order (`CustomizeColumns`)
 *
 * Measured: a mouse press-and-drag past the threshold lifted NOTHING — no
 * `[data-rfd-placeholder-context-id]`, no live-region announcement — and Space
 * did nothing either, while the grips are labelled *"Space picks it up, arrows
 * move it, Space drops it."* Column order is a SAVED preference, so a user
 * could not reorder columns by any means the UI offered.
 *
 * ⚠ THIS IS THE THIRD TIME. The identical guard stopped every kanban card until
 * 2026-08-29, and `KanbanView.jsx` already carried the fix with the reasoning
 * written out — it simply was not applied to the other two handles.
 *
 * ── WHY A SOURCE ASSERTION AND NOT A DRAG ───────────────────────────────────
 *
 * The real behaviour needs layout: `@hello-pangea/dnd` measures boxes and a
 * mouse sensor needs a ~5px threshold, neither of which jsdom provides. A drag
 * test here would pass on a component that cannot drag, which is the failure
 * this file exists to prevent. Suite 20.12b drives the real thing in a real
 * browser; this stops the prop being dropped between those runs, and says why
 * so nobody removes it as noise.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const HANDLES = [
  ['CustomizeTabs', '../../module/CustomizeTabs.jsx', 'ktabs__grip'],
  ['CustomizeColumns', '../CustomizeColumns.jsx', 'kcols__grip'],
  ['KanbanView', '../../views/KanbanView.jsx', null],
];

describe('every <button> drag handle keeps the dnd escape hatch', () => {
  it.each(HANDLES)('%s passes disableInteractiveElementBlocking', (_name, path) => {
    const src = read(path);
    // ⚠ THE PROP, NOT A MENTION OF IT. This was `toContain(...)` and mutation
    // testing killed it: `KanbanView.jsx` names the prop in its own comment
    // explaining the fix, so deleting the actual prop left the string behind
    // and the assertion passed over a fully reverted component. A JSX prop
    // stands alone on its line; a comment line carries `*` or prose with it.
    expect(src, 'the prop is absent (a comment mentioning it does not count)')
      .toMatch(/^\s*disableInteractiveElementBlocking\s*$/m);
  });

  it.each(HANDLES.filter(([, , grip]) => grip))(
    '%s still renders its grip as a <button>, which is why the prop is needed',
    (_name, path, grip) => {
      // If a handle ever stops being a <button>, the prop becomes unnecessary
      // rather than wrong — and this test should be deleted deliberately, with
      // the reason, instead of quietly passing on a component it no longer
      // describes.
      const src = read(path);
      expect(src).toContain(grip);
      const at = src.indexOf(grip);
      const before = src.slice(Math.max(0, at - 400), at);
      expect(before, `${grip} is no longer rendered by a <button> — re-check whether `
        + 'disableInteractiveElementBlocking is still required').toContain('<button');
    },
  );

  it('the prop sits on the Draggable, not on the button', () => {
    // On the button it is silently ignored: it is a `<Draggable>` prop, and the
    // blocking happens inside the sensor before the handle is consulted.
    for (const [, path] of HANDLES) {
      const src = read(path);
      const at = src.indexOf('disableInteractiveElementBlocking');
      const region = src.slice(Math.max(0, at - 2200), at);
      expect(region, `${path}: the prop is not inside a <Draggable>`).toContain('<Draggable');
    }
  });

  it('each one says WHY, so it is not deleted as a stray prop', () => {
    for (const [, path] of HANDLES) {
      const src = read(path);
      const at = src.indexOf('disableInteractiveElementBlocking');
      const region = src.slice(Math.max(0, at - 2200), at);
      expect(region.toLowerCase(), `${path}: the prop carries no explanation`)
        .toMatch(/interactivetagnames|trystart|escape hatch/);
    }
  });
});
