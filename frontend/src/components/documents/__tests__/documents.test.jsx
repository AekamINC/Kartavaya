/**
 * Document and e-sign surface tests.
 *
 * Two kinds of assertion, both locking something a DOM check cannot see:
 *
 *  · **The stylesheet.** `documents.css` may not restate a colour as a literal
 *    and may not use `--on-surface-faint` on text — it is 2.3:1 on the canvas
 *    and 00 §12 marks it non-text. It also may not centre itself in a fixed
 *    column; every page in this product is fluid and left-aligned.
 *  · **The formatters.** `formatBytes` returning null for an unknown size and
 *    `relSigned` signing a future date are both bug fixes with no visual
 *    signature — a regression in either looks like working code.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  formatBytes, formatDate, relSigned, fileKind, fileExt,
} from '../fileMeta';
import { DOC_STATES, SIGNER_STATES } from '../EsignStatusPill';

const CSS = readFileSync(
  path.resolve(__dirname, '../../../styles/documents.css'),
  'utf8',
);

describe('documents.css', () => {
  /** Declaration bodies only — the file's prose comments are not rules. */
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  it('the stylesheet was actually read', () => {
    expect(rules).toMatch(/\.docdz\s*\{/);
  });

  it('no colour is restated as a literal', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(/);
    expect(rules).not.toMatch(/\bhsla?\(/);
  });

  it('--on-surface-faint is never a text colour', () => {
    // It may back a dot or a rule; `color:` is the prohibited property.
    const colourDecls = [...rules.matchAll(/(^|[;{])\s*color\s*:\s*([^;}]+)/g)].map(m => m[2]);
    for (const v of colourDecls) expect(v).not.toMatch(/--on-surface-faint/);
  });

  it('primary-coloured text uses --primary-text, never --primary', () => {
    const colourDecls = [...rules.matchAll(/(^|[;{])\s*color\s*:\s*([^;}]+)/g)].map(m => m[2].trim());
    for (const v of colourDecls) {
      // `--primary` is a 4.04:1 FILL. Its text partner is `--primary-text`.
      expect(v).not.toMatch(/var\(\s*--primary\s*\)/);
    }
  });

  it('no radius is hard-coded — the Sharp and Pill settings must reach it', () => {
    const radii = [...rules.matchAll(/border-radius\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
    for (const r of radii) {
      expect(r === '50%' || r === 'inherit' || /var\(--r-/.test(r)).toBe(true);
    }
  });

  it('nothing centres itself in a fixed-width column', () => {
    expect(rules).not.toMatch(/margin\s*:\s*0\s+auto/);
    expect(rules).not.toMatch(/margin-inline\s*:\s*auto/);
  });
});

describe('formatBytes', () => {
  it('returns null when the size is unknown, so the row can omit the column', () => {
    // The backend Attachment model persists no size. A fabricated "0 B" beside
    // a real file reads as a corrupt upload rather than as missing metadata.
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes('nonsense')).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });

  it('a genuine zero is still zero, not unknown', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('scales and keeps one decimal only where it carries information', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('relSigned', () => {
  it('signs a future date instead of calling it the past', () => {
    // lib/utils relTime appends "ago" unconditionally, so an expiry twelve days
    // out rendered "12d ago" — the document read as long dead while it was live.
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    expect(relSigned(future)).toMatch(/^in 5d$/);
  });

  it('still reads the past as the past', () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(relSigned(past)).toMatch(/^3d ago$/);
  });
});

describe('formatDate', () => {
  it('never invents a date for an absent or unparseable value', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('fileKind', () => {
  it.each([
    ['statement.pdf', 'pdf'],
    ['gstr3b.XLSX', 'sheet'],
    ['agreement.docx', 'doc'],
    ['pitch.pptx', 'slide'],
    ['scan.HEIC', 'image'],
    ['walkthrough.mov', 'video'],
    ['bundle.zip', 'archive'],
    ['README', 'file'],
  ])('%s → %s', (name, kind) => {
    expect(fileKind(name)).toBe(kind);
  });

  it('reads the last extension, not the first', () => {
    expect(fileExt('invoice.final.pdf')).toBe('PDF');
    expect(fileKind('invoice.pdf.xlsx')).toBe('sheet');
  });
});

describe('e-sign status maps', () => {
  it('carry token references, never literals — a hex cannot flip with the theme', () => {
    for (const s of [...Object.values(DOC_STATES), ...Object.values(SIGNER_STATES)]) {
      expect(s.color).toMatch(/^var\(--[\w-]+\)$/);
    }
  });

  it('expired is neutral, not danger — a lapsed document is not a failure', () => {
    expect(DOC_STATES.expired.color).toBe('var(--on-surface-3)');
    expect(DOC_STATES.cancelled.color).toBe('var(--danger)');
  });

  it('no enum reaches the user with an underscore in it', () => {
    for (const s of [...Object.values(DOC_STATES), ...Object.values(SIGNER_STATES)]) {
      expect(s.label).not.toMatch(/_/);
    }
  });
});
