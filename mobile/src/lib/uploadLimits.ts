/**
 * The upload size caps, stated once for the app.
 *
 * These are the SERVER's numbers — `MAX_BYTES` and `MAX_BYTES_VIDEO` in
 * `backend/routers/uploads.py` — and the web client states the same pair in
 * `frontend/src/lib/uploadLimits.js`. They are copies of the server rather than
 * of each other: two npm packages that cannot import across, so the one thing
 * that keeps them honest is that both name the same source.
 *
 * `NewTaskSheet` carried `MAX_MB = 5`, which was never used for anything and
 * was wrong in both directions at once — half the server's document cap, a
 * fifth of its video cap. A phone is where the oversized file actually comes
 * from: a 90-second 4K clip is well past 25 MB, and on a mobile connection the
 * user paid the whole upload before the server said no.
 *
 * Nothing here rejects a file whose size the platform did not report. A picker
 * that returns no size is a fact about the device, not about the file, and the
 * server still counts the bytes — refusing on a missing number would block
 * uploads that would have worked.
 */

/** Documents and images — `uploads.MAX_BYTES`. */
export const MAX_MB = 10;

/** Video — `uploads.MAX_BYTES_VIDEO`. */
export const MAX_MB_VIDEO = 25;

/**
 * Which files the server sizes as video.
 *
 * Extension, not MIME. `uploads.py` decides with `VIDEO_EXTENSIONS`, keyed off
 * the filename, so a `.mov` handed over as `application/octet-stream` — which
 * is exactly what the Android document picker produces — still gets the video
 * cap there. Guessing from the MIME type here would disagree with the server on
 * the files phones actually send.
 */
export const VIDEO_EXT = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;

/** The cap that applies to this filename, in MB. */
export function limitMbFor(name: string | null | undefined): number {
  return VIDEO_EXT.test(name || '') ? MAX_MB_VIDEO : MAX_MB;
}

/** A picked file as far as the size rule is concerned. */
export interface SizedFile {
  name: string;
  /** Bytes, or null/undefined when the picker did not report a size. */
  size?: number | null;
}

/** Over its own cap? A file of unknown size never is — see the note above. */
export function isOversize(file: SizedFile | null | undefined): boolean {
  if (!file || typeof file.size !== 'number' || !Number.isFinite(file.size)) return false;
  return file.size > limitMbFor(file.name) * 1024 * 1024;
}

/**
 * What to tell the user, or null when nothing is over.
 *
 * It names the file, the size it actually is, and the limit that applies to it.
 * A message that says only "file too large" leaves someone who picked four
 * clips to find the offender by uploading them one at a time.
 */
export function oversizeMessage(files: readonly SizedFile[]): string | null {
  const over = files.filter(isOversize);
  if (!over.length) return null;
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  if (over.length === 1) {
    const f = over[0];
    return `${f.name} is ${mb(f.size as number)} MB — the limit is ${limitMbFor(f.name)} MB.`;
  }
  const each = over.map(f => `${f.name} (${mb(f.size as number)} MB)`).join(', ');
  return `${each} — the limit is ${MAX_MB} MB for documents and images, ${MAX_MB_VIDEO} MB for video.`;
}
