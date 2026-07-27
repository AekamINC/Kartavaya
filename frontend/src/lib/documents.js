/**
 * documents.js — one way to pull a generated document out of the API.
 *
 * `backend/routers/documents.py` exposes six finished PDF endpoints (quotation,
 * statement of account, GSTR-3B, TDS challan, service agreement, project
 * report) backed by ~2,100 lines of tested renderers. Until this file every one
 * of them had ZERO frontend callers: the documents existed and no user could
 * produce one.
 *
 * Six call sites doing the blob dance by hand is six chances to get it wrong,
 * and the two ways it goes wrong are both invisible in review:
 *
 *   · The object URL is never revoked, so the blob is pinned for the life of
 *     the tab. A finance user generating a morning's worth of statements leaks
 *     every one of them.
 *   · The failure is reported as "something went wrong". These endpoints answer
 *     422 with a STRUCTURED refusal naming the field that is missing — a TAN, a
 *     GSTIN, an untied balance — and that list is the entire reason the backend
 *     refuses rather than emitting a document that looks complete. Discarding it
 *     leaves the user pressing the button again.
 *
 * `describeDocumentError` already turns that payload into a sentence, including
 * the blob-body caveat: with `responseType: 'blob'` an ERROR body also arrives
 * as a Blob and has to be read back as text before it is JSON. That is why the
 * whole path here is async.
 */
import { useCallback, useState } from 'react';
import { api } from './api';
import { describeDocumentError } from './docErrors';

/**
 * Prefer the filename the server chose.
 *
 * Every one of these routes sets `Content-Disposition`, and the server's name
 * carries the real document number (`SOA-1A2B3C4D-20260731.pdf`). The header is
 * only readable cross-origin when it is in `Access-Control-Expose-Headers`, so
 * the caller's guess is kept as the fallback rather than assumed unnecessary.
 */
function filenameFrom(res, fallback) {
  const raw = res?.headers?.['content-disposition'] || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(raw);
  const name = match && decodeURIComponent(match[1].trim());
  return name || fallback || 'document.pdf';
}

/**
 * Fetch a document and hand it to the browser as a download.
 *
 * Throws the axios error on failure — deliberately. Describing it is the
 * caller's job (or `useDocumentDownload`'s), because only the caller knows
 * where the message belongs on screen.
 *
 * @param {object}  opts
 * @param {'get'|'post'} [opts.method='get']
 * @param {string}  opts.url
 * @param {object}  [opts.params]    query string
 * @param {object}  [opts.data]      request body, for the four POST routes
 * @param {string}  [opts.filename]  fallback name
 */
export async function downloadDocument({ method = 'get', url, params, data, filename }) {
  const res = await api.request({ method, url, params, data, responseType: 'blob' });

  const objectUrl = URL.createObjectURL(res.data);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filenameFrom(res, filename);
    a.click();
  } finally {
    // In a `finally` so a click that throws still releases the blob.
    URL.revokeObjectURL(objectUrl);
  }
  return true;
}

/**
 * The three states a document trigger needs: idle, generating, and a NAMED
 * failure.
 *
 * `busy` is the key of the document being generated rather than a boolean, so a
 * panel offering several documents disables and re-labels only the one that was
 * pressed.
 *
 * The error is returned as state rather than pushed to a toast on purpose. A
 * toast is transient and off to the side; these refusals are a WORKLIST ("this
 * challan has no TAN", "this agreement names no client") and the user needs it
 * still on screen while they go and fix it.
 */
export function useDocumentDownload() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);

  const clear = useCallback(() => setError(null), []);

  const run = useCallback(async (key, options = {}) => {
    setBusy(key);
    setError(null);
    try {
      await downloadDocument(options);
      return true;
    } catch (e) {
      const described = await describeDocumentError(
        e, options.fallback || 'Could not generate the document',
      );
      // `key` travels with the message so a multi-document panel can show it
      // against the control that failed.
      setError({ key, ...described });
      return false;
    } finally {
      setBusy('');
    }
  }, []);

  return { busy, error, run, clear };
}
