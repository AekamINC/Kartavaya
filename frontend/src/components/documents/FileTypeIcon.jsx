import React from 'react';
import {
  FileText, FileSpreadsheet, FileArchive, Presentation, Image as ImageIcon, Film, File,
} from 'lucide-react';
import { fileKind, fileExt } from './fileMeta';

/**
 * FileTypeIcon — a tinted glyph plus the extension, sized from one prop.
 *
 * The tints are EXISTING semantic tokens, not a new palette. A file-type colour
 * map is exactly the kind of thing that gets written as seven literals and then
 * fails in dark mode, so PDF borrows `--danger`, a spreadsheet `--ok`, a
 * document `--st-in-progress` and a deck `--tertiary` — the conventional
 * red/green/blue/orange every user already reads, in tokens that flip with the
 * theme. Nothing here declares a colour of its own.
 */
const GLYPH = {
  pdf:     FileText,
  sheet:   FileSpreadsheet,
  doc:     FileText,
  slide:   Presentation,
  image:   ImageIcon,
  video:   Film,
  archive: FileArchive,
  file:    File,
};

const TINT = {
  pdf:     'var(--danger)',
  sheet:   'var(--ok)',
  doc:     'var(--st-in-progress)',
  slide:   'var(--tertiary)',
  image:   'var(--st-in-review)',
  video:   'var(--secondary)',
  archive: 'var(--on-surface-3)',
  file:    'var(--on-surface-3)',
};

/**
 * `withExt` prints the extension under the glyph for the grid tile, where a
 * 20px icon alone cannot distinguish .xlsx from .csv. In a dense row the name
 * is right there and the label is redundant, so rows leave it off.
 */
export default function FileTypeIcon({ name, size = 20, withExt = false, className = '' }) {
  const kind = fileKind(name);
  const Glyph = GLYPH[kind] || File;
  const ext = fileExt(name);

  return (
    <span
      className={`fti fti--${kind} ${className}`.trim()}
      style={{ '--fk': TINT[kind] || TINT.file }}
      /* The extension is decoration beside the filename, which is already
         announced. Only the kind is worth reading aloud. */
      aria-label={ext ? `${ext} file` : 'File'}
      role="img"
    >
      <Glyph size={size} strokeWidth={1.6} aria-hidden="true" />
      {withExt && ext && <span className="fti__ext">{ext}</span>}
    </span>
  );
}

export { FileTypeIcon };
