/**
 * File classification and formatting — one implementation.
 *
 * The extension tests were written out a third time in EsignPage's create flow
 * after `drawer/DrawerAttachments.jsx` and `components/TaskEditor.jsx` had each
 * grown their own copy. Three copies of `isImage` is how a `.heic` preview
 * works in the drawer and silently falls through to a generic icon everywhere
 * else. This file is the shared set; the drawer's copy is left alone because
 * `components/drawer/**` belongs to another surface owner (reported, not edited).
 */

export const IMAGE_EXT  = /\.(jpg|jpeg|png|gif|webp|heic|heif|avif|bmp|svg)$/i;
export const VIDEO_EXT  = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;
export const PDF_EXT    = /\.pdf$/i;
export const SHEET_EXT  = /\.(xls|xlsx|csv|ods)$/i;
export const DOC_EXT    = /\.(doc|docx|odt|rtf|txt|md)$/i;
export const SLIDE_EXT  = /\.(ppt|pptx|odp)$/i;
export const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz)$/i;

export const isImage = n => IMAGE_EXT.test(n || '');
export const isVideo = n => VIDEO_EXT.test(n || '');
export const isPdf   = n => PDF_EXT.test(n || '');

/**
 * One of eight kinds. The kind drives both the icon and its tint, so a PDF is
 * the same colour in the list, the grid and the upload row — which is the only
 * reason a colour-coded icon is worth more than a single grey glyph.
 */
export function fileKind(name = '') {
  if (isImage(name))         return 'image';
  if (isVideo(name))         return 'video';
  if (isPdf(name))           return 'pdf';
  if (SHEET_EXT.test(name))  return 'sheet';
  if (SLIDE_EXT.test(name))  return 'slide';
  if (DOC_EXT.test(name))    return 'doc';
  if (ARCHIVE_EXT.test(name)) return 'archive';
  return 'file';
}

/** Uppercase extension for the icon's label: "report.final.pdf" → "PDF". */
export function fileExt(name = '') {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m ? m[1].toUpperCase() : '';
}

/**
 * Bytes as a human size. Returns null — not "0 B" — when the size is unknown,
 * because the backend `Attachment` model does not persist one (reported). A
 * fabricated "0 B" beside a real 2 MB file is worse than an absent column: it
 * reads as a corrupt upload rather than as missing metadata.
 */
export function formatBytes(bytes) {
  // `Number(null)` and `Number('')` are both 0, which is finite — so a coercion
  // check alone reported a MISSING size as a real zero-byte file. Absence is
  // rejected before the coercion, not after it.
  if (bytes === null || bytes === undefined || bytes === '') return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Absolute date, Indian order, no "ago".
 *
 * `lib/utils.js relTime` appends "ago" unconditionally, so `EsignPage` rendered
 * an expiry twelve days in the FUTURE as "12d ago" — the document read as long
 * expired when it was still live. Anything that can be in the future is
 * formatted here instead.
 */
export function formatDate(iso, { time = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Signed, so a future date reads "in 12d" and a past one "12d ago". */
export function relSigned(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  const future = ms > 0;
  const s = Math.abs(ms) / 1000;
  // Round, not floor. A deadline five days out is a few milliseconds short of
  // 5 × 86400s, and flooring renders it "in 4d" — an off-by-one on the number
  // a person uses to decide whether to chase a signature today.
  const n = s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m`
    : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  return future ? `in ${n}` : `${n} ago`;
}
