/**
 * E-sign field placement — the geometry, and the honesty of the create.
 *
 * Two halves, and the second one is the point.
 *
 * THE GEOMETRY (`pages/esign/fieldPlacement.js`) is pure and is asserted
 * directly: a field cannot leave the page, a removed signer takes their fields
 * with them and renumbers everyone after them, and the wire shape is stable and
 * carries no local id.
 *
 * THE HONESTY. Pydantic v2 ignores unknown members by default, so sending
 * `fields` to today's `POST /v1/esign/documents` SUCCEEDS and silently discards
 * them — `DocumentCreate` has no `fields` member, and there is no `sign_fields`
 * table in `staging`. A create surface that reported success there would be
 * decorative, which is what e-sign already was once: it produced no signed PDF
 * at all until 2026-08-04. So the last three tests assert the two outcomes that
 * matter — that the placement is SENT in the shape the migration defines, and
 * that when the server does not keep it the user is TOLD, while the document is
 * still created and nothing 500s.
 *
 * `createRoot` + `act` rather than @testing-library/react — the house pattern
 * (orgSettingsTabs.test.jsx, orgSenders.test.jsx, signingPageBehaviour.test.jsx).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* ── Doubles ───────────────────────────────────────────────────────────────
   Declared before the dynamic import below so the mock factories, which close
   over them, are never called while they are still in the temporal dead zone.
   That is why the component is imported with a top-level `await import` and not
   a static import. */
const posts = [];
const gets = [];
const toasts = [];
/** What `GET /v1/esign/documents/{id}` answers. Default: a server that has NOT
 *  been migrated — the body `esign.py` returns today, with no `fields`. */
let docBody = { document: { id: 'DOC1' }, signers: [], audit_trail: [] };
let docGetFails = false;

vi.mock('../lib/api', () => ({
  api: {
    post: vi.fn((url, body) => {
      posts.push({ url, body });
      return Promise.resolve({ data: { id: 'DOC1', status: 'draft' } });
    }),
    get: vi.fn((url) => {
      gets.push(url);
      if (docGetFails) return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: docBody });
    }),
  },
}));

vi.mock('../components/ui/toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({
    success: t => toasts.push({ kind: 'success', t }),
    error: t => toasts.push({ kind: 'error', t }),
    warning: t => toasts.push({ kind: 'warning', t }),
    info: t => toasts.push({ kind: 'info', t }),
  }),
}));

const {
  FIELD_KINDS, KIND, MIN_W, makeField, clampField, moveField, resizeField,
  toApiFields, dropSigner, placementErrors, countPdfPages, describeField,
} = await import('../pages/esign/fieldPlacement');

const { default: CreateTab } = await import('../pages/esign/CreateTab');

/* ── DOM helpers ───────────────────────────────────────────────────────── */

let container = null;
let root = null;

const mount = async (el) => {
  await act(async () => { root.render(el); });
};

/** React installs its own value setter on controlled inputs; assigning `.value`
 *  directly is swallowed. This is the standard escape hatch. */
const setValue = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const q = sel => container.querySelector(sel);
const qa = sel => [...container.querySelectorAll(sel)];
const byText = (sel, text) => qa(sel).find(n => n.textContent.trim().includes(text));

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

/** A two-page PDF whose page tree is UNCOMPRESSED — the case `countPdfPages`
 *  can actually read. Byte-for-byte the structure a plain writer emits. */
const TWO_PAGE_PDF =
  '%PDF-1.4\n'
  + '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'
  + '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n'
  + '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\n'
  + '4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\n'
  + 'trailer << /Root 1 0 R >>\n%%EOF\n';

const pdfFile = (text = TWO_PAGE_PDF, name = 'agreement.pdf') =>
  new File([text], name, { type: 'application/pdf' });

/** Drive the hidden `<input type="file">` inside FileDropZone. jsdom will not
 *  let a test assign `files`, hence the redefinition. */
const attach = async (file) => {
  const input = q('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The page-count read is an async effect on the File's bytes.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

/** Title + one valid signer — the minimum `validate()` accepts. */
const fillMinimum = async () => {
  await act(async () => {
    setValue(q('input[placeholder^="e.g. Service agreement"]'), 'Fit-out agreement — Phase 2');
    setValue(q('input[aria-label="Signer 1 name"]'), 'Meera Joshi');
    setValue(q('input[aria-label="Signer 1 email"]'), 'meera@tatasteel.example');
  });
};

const addField = async (label) => {
  await click(byText('.docfp-kinds .chip', label));
};

const submit = async () => {
  await click(byText('button', 'Create document'));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  posts.length = 0;
  gets.length = 0;
  toasts.length = 0;
  docBody = { document: { id: 'DOC1' }, signers: [], audit_trail: [] };
  docGetFails = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  vi.clearAllMocks();
});

/* ── The geometry ──────────────────────────────────────────────────────── */

describe('the placement format', () => {
  it('carries the prototype\'s five kinds and its own box sizes', () => {
    expect(FIELD_KINDS.map(k => k.id))
      .toEqual(['signature', 'initials', 'date', 'text', 'checkbox']);
    // ScreensThin.jsx:393-397 — signature w:40, date w:26, initials w:16, and
    // `height: '9%'` hard-coded at the render site for all three.
    expect(KIND.signature.w).toBe(40);
    expect(KIND.date.w).toBe(26);
    expect(KIND.initials.w).toBe(16);
    expect([KIND.signature.h, KIND.date.h, KIND.initials.h]).toEqual([9, 9, 9]);
  });

  it('never lets a field leave the page, in any direction', () => {
    const f = makeField('signature', 1, 1);
    expect(clampField({ ...f, left: -30 }).left).toBe(0);
    expect(clampField({ ...f, top: -30 }).top).toBe(0);
    // 100 - width, not 100: a box that STARTS on the page can still hang off it.
    expect(clampField({ ...f, left: 999 }).left).toBe(100 - f.width);
    expect(clampField({ ...f, top: 999 }).top).toBe(100 - f.height);
    // Oversize is clamped before position, so position uses the real width.
    const wide = clampField({ ...f, width: 400, left: 50 });
    expect(wide.width).toBe(100);
    expect(wide.left).toBe(0);
  });

  it('moves and resizes within those bounds', () => {
    const f = makeField('date', 1, 1);
    expect(moveField(f, 5, 5)).toMatchObject({ left: f.left + 5, top: f.top + 5 });
    expect(moveField(f, -999, -999)).toMatchObject({ left: 0, top: 0 });
    expect(resizeField(f, -999, -999).width).toBe(MIN_W);
    expect(resizeField(f, 10, 0).width).toBe(f.width + 10);
  });

  it('cascades a second field of the same kind so it is not hidden under the first', () => {
    const a = makeField('signature', 1, 1, []);
    const b = makeField('signature', 1, 1, [a]);
    expect(b.top).toBeGreaterThan(a.top);
    expect(b.left).not.toBe(a.left);
  });

  it('emits the wire shape: no local id, page order, three decimal places', () => {
    const fields = [
      { id: 'x2', kind: 'date', signer_order: 2, page: 2, top: 10.00051, left: 4, width: 26, height: 9 },
      { id: 'x1', kind: 'signature', signer_order: 1, page: 1, top: 60, left: 8, width: 40, height: 9 },
    ];
    const wire = toApiFields(fields);
    expect(wire.map(f => f.page)).toEqual([1, 2]);
    expect(wire[0]).toEqual({
      kind: 'signature', signer_order: 1, page: 1, top: 60, left: 8, width: 40, height: 9,
    });
    expect('id' in wire[0]).toBe(false);
    // NUMERIC(6,3) — 114_esign_field_placement.sql:203-206. Rounding to two
    // would discard a digit the column was sized to hold.
    expect(wire[1].top).toBe(10.001);
  });

  it('takes a removed signer\'s fields with them and renumbers the rest', () => {
    // This is the one that silently changes a signature\'s OWNER otherwise:
    // `removeSigner` renumbers densely, so signer 3\'s field would become
    // signer 2\'s field on a document where signer 2 is now somebody else.
    const fields = [
      { id: 'a', signer_order: 1 }, { id: 'b', signer_order: 2 }, { id: 'c', signer_order: 3 },
    ];
    expect(dropSigner(fields, 2)).toEqual([
      { id: 'a', signer_order: 1 }, { id: 'c', signer_order: 2 },
    ]);
  });

  it('names an orphaned field rather than sending it', () => {
    expect(placementErrors([{ signer_order: 1 }], 1)).toEqual([]);
    expect(placementErrors([{ signer_order: 3 }], 2)[0]).toMatch(/no longer on the document/);
  });

  it('reads a page count out of an uncompressed PDF, and admits when it cannot', () => {
    const bytes = new TextEncoder().encode(TWO_PAGE_PDF);
    expect(countPdfPages(bytes)).toBe(2);
    // 0 means "the bytes do not say" — the caller shows one page and says so.
    // It is NOT a guess of zero pages.
    expect(countPdfPages(new TextEncoder().encode('not a pdf at all'))).toBe(0);
    expect(countPdfPages(new Uint8Array(0))).toBe(0);
  });

  it('gives every box an accessible name that says whose it is', () => {
    expect(describeField({ kind: 'signature', signer_order: 1, page: 2 }, 'Meera Joshi'))
      .toBe('Signature for Meera Joshi, page 2');
  });
});

/* ── The surface ───────────────────────────────────────────────────────── */

describe('the create surface', () => {
  it('renders the two-column stage, and will not place a field before a PDF exists', async () => {
    await mount(<CreateTab />);
    expect(q('.docfp-two')).toBeTruthy();
    expect(q('.docfp-page')).toBeTruthy();
    // Five palette buttons, every one disabled: there is nothing to place on.
    const chips = qa('.docfp-kinds .chip');
    expect(chips).toHaveLength(5);
    expect(chips.every(c => c.disabled)).toBe(true);
    expect(q('.docfp-blank')).toBeTruthy();
  });

  it('places a field on the page once a PDF is attached', async () => {
    await mount(<CreateTab />);
    await attach(pdfFile());
    expect(qa('.docfp-kinds .chip').every(c => c.disabled)).toBe(false);

    await addField('Signature');
    const placed = qa('.docfp-f');
    expect(placed).toHaveLength(1);
    expect(placed[0].getAttribute('aria-label')).toBe('Signature for Signer 1, page 1');
    // Position is inline because it is DATA, not style.
    expect(placed[0].style.top).toMatch(/%$/);
    expect(placed[0].style.width).toBe('40%');
  });

  it('nudges the focused field with the arrow keys and removes it with Delete', async () => {
    await mount(<CreateTab />);
    await attach(pdfFile());
    await addField('Date');

    const box = q('.docfp-f');
    const before = parseFloat(box.style.left);
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(parseFloat(q('.docfp-f').style.left)).toBeCloseTo(before + 1, 5);

    await act(async () => {
      q('.docfp-f').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(qa('.docfp-f')).toHaveLength(0);
  });

  it('sends the placement in the shape the migration defines', async () => {
    await mount(<CreateTab />);
    await attach(pdfFile());
    await fillMinimum();
    await addField('Signature');
    await submit();

    const create = posts.find(p => p.url === '/v1/esign/documents');
    expect(create).toBeTruthy();
    expect(create.body.fields).toHaveLength(1);
    expect(Object.keys(create.body.fields[0]).sort()).toEqual(
      ['height', 'kind', 'left', 'page', 'signer_order', 'top', 'width'],
    );
    expect(create.body.fields[0]).toMatchObject({ kind: 'signature', signer_order: 1, page: 1 });
    // Everything the endpoint already took is untouched.
    expect(create.body.title).toBe('Fit-out agreement — Phase 2');
    expect(create.body.signers).toHaveLength(1);
    expect(create.body.expires_days).toBe(30);
  });

  it('omits `fields` entirely when nothing was placed, so the request is unchanged', async () => {
    await mount(<CreateTab />);
    await attach(pdfFile());
    await fillMinimum();
    await submit();

    const create = posts.find(p => p.url === '/v1/esign/documents');
    expect('fields' in create.body).toBe(false);
    // No placement means no read-back, so an unmigrated server is not probed.
    expect(gets).toHaveLength(0);
    expect(toasts.map(t => t.kind)).toEqual(['success']);
  });

  it('says so when the server drops the placement — and still creates the document', async () => {
    // `docBody` has no `fields`: exactly what today\'s GET returns.
    await mount(<CreateTab />);
    await attach(pdfFile());
    await fillMinimum();
    await addField('Signature');
    await submit();

    // The document WAS created and the PDF WAS uploaded. Nothing 500s.
    expect(posts.map(p => p.url)).toEqual([
      '/v1/esign/documents', '/v1/esign/documents/DOC1/upload',
    ]);
    const warned = toasts.find(t => t.kind === 'warning');
    expect(warned).toBeTruthy();
    expect(warned.t).toMatch(/does not store field placement/);
    expect(toasts.some(t => t.kind === 'success')).toBe(false);
  });

  it('treats a failed read-back as "not stored", never as a failed create', async () => {
    docGetFails = true;
    await mount(<CreateTab />);
    await attach(pdfFile());
    await fillMinimum();
    await addField('Signature');
    await submit();

    expect(toasts.find(t => t.kind === 'error')).toBeFalsy();
    expect(toasts.find(t => t.kind === 'warning')).toBeTruthy();
  });

  it('reports success once the server does keep the placement', async () => {
    docBody = {
      document: { id: 'DOC1' },
      signers: [],
      audit_trail: [],
      fields: [{ kind: 'signature', signer_order: 1, page: 1, top: 34, left: 30, width: 40, height: 9 }],
    };
    await mount(<CreateTab />);
    await attach(pdfFile());
    await fillMinimum();
    await addField('Signature');
    await submit();

    expect(toasts.map(t => t.kind)).toEqual(['success']);
  });

  it('renumbers placed fields when a signer is removed', async () => {
    await mount(<CreateTab />);
    await attach(pdfFile());
    await click(byText('button', 'Add signer'));

    // Place one field for signer 2.
    const sel = q('#docfp-who-sel');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '2');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await addField('Signature');
    expect(q('.docfp-f').getAttribute('aria-label')).toMatch(/Signer 2/);

    // Remove signer 1. Signer 2 becomes signer 1, and so must their field.
    await click(q('button[aria-label="Remove signer 1"]'));
    expect(qa('.docfp-f')).toHaveLength(1);
    expect(q('.docfp-f').getAttribute('aria-label')).toMatch(/Signer 1/);
  });

  it('drops a removed signer\'s own fields', async () => {
    await mount(<CreateTab />);
    await attach(pdfFile());
    await click(byText('button', 'Add signer'));
    await addField('Signature');            // signer 1
    expect(qa('.docfp-f')).toHaveLength(1);

    await click(q('button[aria-label="Remove signer 1"]'));
    expect(qa('.docfp-f')).toHaveLength(0);
  });
});
