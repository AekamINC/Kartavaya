/**
 * Document and file surfaces — the shared set.
 *
 * Everything here composes an existing primitive where one exists:
 * `EsignStatusPill` renders `.k-statuschip` from editorial.css, the progress
 * bar is the shipped `.prg`, and buttons, fields, tables, empty and error
 * states come from `components/ui/**` at the call site. Nothing in this
 * directory reimplements a primitive that already ships.
 */
export { default as FileTypeIcon } from './FileTypeIcon';
export { default as FileDropZone } from './FileDropZone';
export { default as EsignStatusPill, DOC_STATES, SIGNER_STATES } from './EsignStatusPill';
export { default as AuditTrail } from './AuditTrail';
export {
  fileKind, fileExt, formatBytes, formatDate, relSigned,
  isImage, isVideo, isPdf,
} from './fileMeta';
