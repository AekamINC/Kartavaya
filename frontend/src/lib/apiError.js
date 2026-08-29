/**
 * apiError.js — turn any FastAPI error body into one line a person can act on.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * 177 call sites were written as
 *
 *     pushToast({ title: e.response?.data?.detail || 'Failed to save' })
 *
 * which is correct for exactly one of the three shapes FastAPI actually sends.
 *
 *   1. `{"detail": "Pending claim not found"}`        — a string. Fine.
 *   2. `{"detail": [{loc, msg, type}, …]}`            — **422 VALIDATION.**
 *      An ARRAY OF OBJECTS. It is truthy, so `||` keeps it and the array goes
 *      into a React child. That is React error #31, "Objects are not valid as
 *      a React child" — the same crash that replaced a whole tab earlier in
 *      this programme — or, where a toast stringifies first, the person reads
 *      `[object Object]`.
 *   3. `{"detail": {error, message, blocking: […]}}`  — document validation,
 *      the shape `docErrors.js` already exists to unpack.
 *
 * ⚠ **FOUND BY PROPOSAL 93 SUITE 05, 2026-08-29.** Every rate card without a
 * note was refused with a 422 (`RateCardCreate.notes` was `str = ""` while the
 * form sent `null`), and the only thing the screen said was **"Failed to
 * save"**. Rate cards stood at 0 of 3 while every other Ganit volume filled,
 * and the person typing had no way to learn that the empty Notes box was the
 * cause. The refusal was fixed at its source; this is the other half — a 422
 * whose reason nobody can read is a support ticket every single time.
 *
 * `docErrors.js` already argues this case for PDF generation: "A toast reading
 * 'Failed to generate PDF' tells the user nothing and leaves them clicking the
 * button again; the useful message names the field and where to set it." The
 * same sentence is true of every other refusal in the product.
 *
 * ── WHAT IT RETURNS ─────────────────────────────────────────────────────────
 *
 * Always a STRING, never an object or an array, so it is always safe to render.
 * The fallback is used only when there is genuinely nothing to say.
 */

/** `["body", "notes"]` → `Notes`. The field name as the person sees it. */
function fieldLabel(loc) {
  if (!Array.isArray(loc)) return '';
  // Drop the FastAPI envelope segments; what remains is the field path.
  const parts = loc.filter((p) => !['body', 'query', 'path', 'header'].includes(p));
  if (!parts.length) return '';
  return String(parts[parts.length - 1])
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * One readable line from an axios error.
 *
 * @param {unknown} err       the caught error
 * @param {string}  fallback  what to say when the server said nothing useful
 * @returns {string}
 */
export function apiErrorText(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;

  // 422 — a list of field errors. Name the fields; that is the actionable part.
  if (Array.isArray(detail)) {
    const lines = detail
      .map((d) => {
        const label = fieldLabel(d?.loc);
        const msg = typeof d?.msg === 'string' ? d.msg : '';
        if (label && msg) return `${label}: ${msg}`;
        return label || msg;
      })
      .filter(Boolean);
    // Two is already a mouthful in a toast; beyond that, count the rest.
    if (lines.length > 2) return `${lines.slice(0, 2).join('; ')} (+${lines.length - 2} more)`;
    if (lines.length) return lines.join('; ');
    return fallback;
  }

  if (detail && typeof detail === 'object') {
    // The document-validation shape. `blocking` is the list of fields that
    // stopped it, and naming one is far better than naming none.
    const blocking = Array.isArray(detail.blocking) ? detail.blocking : [];
    const names = blocking.map((b) => b?.label || b?.field).filter(Boolean);
    if (typeof detail.message === 'string' && detail.message.trim()) {
      return names.length ? `${detail.message} (${names.join(', ')})` : detail.message;
    }
    if (names.length) return `Missing: ${names.join(', ')}`;
    if (typeof detail.error === 'string' && detail.error.trim()) return detail.error;
  }

  // Nothing usable in `detail` — a 500, a gateway page, a network drop.
  if (typeof err?.response?.data === 'string' && err.response.data.trim()
      && !err.response.data.trim().startsWith('<')) {
    return err.response.data.trim().slice(0, 300);
  }
  return fallback;
}

export default apiErrorText;
