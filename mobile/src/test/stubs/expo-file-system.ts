/**
 * Filesystem stub that records deletions.
 *
 * The recording is the point. `punchQueue.discardPhoto` is the only thing on the
 * device that ever removes a punch selfie — the app never lists that directory —
 * so "was the face deleted, and at which of the three moments" is a real
 * assertion about a biometric retention promise, not a filesystem detail.
 *
 * No real file is ever created or removed by this suite. `photo_uri` values in
 * tests are synthetic paths that do not exist.
 */

export interface FsCall { uri: string; idempotent?: boolean }

export const fs = {
  /** Every `deleteAsync` this suite has made, oldest first. */
  deleted: [] as FsCall[],
  /** URIs that will throw when deleted, to prove a punch survives a failed unlink. */
  throwOn: new Set<string>(),
};

export async function deleteAsync(
  uri: string,
  options: { idempotent?: boolean } = {},
): Promise<void> {
  if (fs.throwOn.has(uri)) throw new Error(`EACCES: refusing to delete ${uri}`);
  fs.deleted.push({ uri, idempotent: options.idempotent });
}

export function __resetFs(): void {
  fs.deleted.length = 0;
  fs.throwOn.clear();
}

/** Whether `discardPhoto` removed this URI. */
export function __wasDeleted(uri: string): boolean {
  return fs.deleted.some(c => c.uri === uri);
}

export const documentDirectory = '/__test__/documents/';
export const cacheDirectory = '/__test__/cache/';
