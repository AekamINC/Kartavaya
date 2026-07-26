/**
 * docErrors.js — turn a document-generation failure into something actionable.
 *
 * The backend refuses to render a statutory document that is missing a
 * mandatory field (`services/doc_validation.py`) and answers 422 with the list:
 *
 *   { detail: { error: "document_incomplete", document: "tax invoice",
 *               message: "...", blocking: [{ field, label, reason, fix }], ... } }
 *
 * That list is the whole point of refusing. A toast reading "Failed to generate
 * PDF" tells the user nothing and leaves them clicking the button again; the
 * useful message names the field and where to set it.
 *
 * Blob caveat: these downloads use `responseType: 'blob'`, so an error body
 * arrives as a Blob rather than parsed JSON and has to be read back as text.
 * That is why this helper is async.
 */

/** Read an axios error body that may be a Blob (blob responseType) or JSON. */
async function readErrorBody(err) {
  const data = err?.response?.data;
  if (!data) return null;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      return JSON.parse(await data.text());
    } catch {
      return null;
    }
  }
  return data;
}

/**
 * Describe a failed document download.
 *
 * @param {Error} err       the axios error
 * @param {string} fallback title to use when nothing better is available
 * @returns {Promise<{title: string, message: string}>}
 */
export async function describeDocumentError(err, fallback = 'Failed to generate document') {
  const status = err?.response?.status;

  if (status === 403) {
    return { title: 'Access denied', message: 'You do not have access to this module.' };
  }

  const body = await readErrorBody(err);
  const detail = body?.detail ?? body;

  if (detail && detail.error === 'document_incomplete') {
    const blocking = Array.isArray(detail.blocking) ? detail.blocking : [];
    const doc = detail.document || 'document';
    // Name the fields, then one place to fix them. Listing every `fix` string
    // when they are all the same setting page reads as noise.
    const labels = blocking.map((g) => g.label).filter(Boolean);
    const fixes = [...new Set(blocking.map((g) => g.fix).filter(Boolean))];
    const missing = labels.length ? labels.join(', ') : 'a mandatory field';
    const where = fixes.length === 1 ? ` Set it in ${fixes[0]}.` : '';
    return {
      title: `This ${doc} cannot be issued`,
      message: `Missing: ${missing}.${where} Nothing has been invented to fill the gap.`,
    };
  }

  if (typeof detail === 'string' && detail) return { title: detail, message: '' };
  if (detail?.message) return { title: fallback, message: detail.message };
  return { title: fallback, message: '' };
}
