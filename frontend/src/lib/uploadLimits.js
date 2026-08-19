/**
 * The upload size caps, stated once.
 *
 * Every number here is the SERVER's. `MAX_MB` and `MAX_MB_VIDEO` are
 * `MAX_BYTES` and `MAX_BYTES_VIDEO` in `backend/routers/uploads.py`;
 * `MAX_MB_ESIGN_PDF` is `_MAX_PDF_BYTES` in `backend/routers/esign.py`. The
 * server is the only thing that actually enforces a limit — a client check is
 * a courtesy that saves the transfer, never the guard.
 *
 * They live in one module because five screens each carried their own literal
 * and four of them were wrong in the harmful direction: `TaskDrawer` and
 * `drawer/DrawerAttachments` both offered 25 MB for a document and 50 MB for
 * video against a server that stops at 10 and 25, `esign/CreateTab` offered
 * 20 MB against a 10 MB endpoint, and `NewTaskModal` checked nothing at all.
 * Claiming MORE than the server accepts is not a cosmetic error: the file
 * uploads for however long the connection takes and is refused at the end, so
 * the user pays the whole transfer to be told no — on a phone, twice, because
 * the first refusal looked like a glitch.
 *
 * A screen may be stricter than the server (an e-sign PDF is not video, so it
 * gets the document cap and says so), never looser. What it prints and what it
 * enforces must be the same constant, and that constant must be here.
 *
 * `mobile/src/lib/uploadLimits.ts` is the same table for the app; the two are
 * separate packages, so they are copies of the server's numbers rather than of
 * each other.
 */

/** Documents and images — `uploads.MAX_BYTES`. */
export const MAX_MB = 10;

/** Video — `uploads.MAX_BYTES_VIDEO`. */
export const MAX_MB_VIDEO = 25;

/** The PDF an e-sign document is built from — `esign._MAX_PDF_BYTES`. */
export const MAX_MB_ESIGN_PDF = 10;

/**
 * Which files the server sizes as video.
 *
 * Extension, not MIME, because that is what `uploads.py` decides on:
 * `VIDEO_EXTENSIONS` there is keyed off the filename, so a `.mov` sent as
 * `application/octet-stream` still gets the video cap. A client that guessed
 * from `file.type` would disagree with the server on exactly the files people
 * upload from a phone.
 */
export const VIDEO_EXT = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;

/** The cap that applies to this filename, in MB. */
export const limitMbFor = (name) => (VIDEO_EXT.test(name || '') ? MAX_MB_VIDEO : MAX_MB);

/**
 * Over its own cap?
 *
 * A file whose size the browser has not reported is NOT over the limit. `size`
 * is absent on the `File` shims the tests build and on a drag from some
 * remote-desktop clients, and refusing an upload because we could not measure
 * it would reject work the server would have accepted. The server still counts
 * the bytes.
 */
export const isOversize = (file, limitMb = null) =>
  !!file
  && typeof file.size === 'number'
  && file.size > (limitMb ?? limitMbFor(file.name)) * 1024 * 1024;

/** The oversized members of a FileList or array, in the order they were picked. */
export const oversizedFiles = (files, limitMb = null) =>
  Array.from(files || []).filter((f) => isOversize(f, limitMb));

/**
 * What to tell the user, or null when nothing is over.
 *
 * It names the file, its actual size and the limit that applies to it. "One or
 * more files exceed the file size limit" was the old message and it is useless
 * to someone who picked eight: it does not say which, and it does not say what
 * the limit is, so the only way to find out is to try them one at a time.
 */
export function oversizeMessage(files, limitMb = null) {
  const over = oversizedFiles(files, limitMb);
  if (!over.length) return null;
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  if (over.length === 1) {
    const f = over[0];
    return `${f.name} is ${mb(f.size)} MB — the limit is ${limitMb ?? limitMbFor(f.name)} MB.`;
  }
  const each = over.map((f) => `${f.name} (${mb(f.size)} MB)`).join(', ');
  return limitMb
    ? `${each} — the limit is ${limitMb} MB.`
    : `${each} — the limit is ${MAX_MB} MB for documents and images, ${MAX_MB_VIDEO} MB for video.`;
}
