import React, { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { logger } from '../../lib/utils';
import { oversizeMessage } from '../../lib/uploadLimits';
import { apiErrorText } from '../../lib/apiError';

/**
 * FilesField.
 *
 * The paperclip was an emoji (📎) and the design system has no emoji — 07 §175.
 * It is an SVG now, which also means it takes the surrounding text colour
 * instead of rendering as a full-colour glyph that ignores the theme.
 *
 * The remove control was a ✕ in a `k-iconbtn` with no accessible name beyond
 * "Remove file", identical on every row: a screen-reader user heard the same
 * label five times with no way to tell which file each one removed. It now
 * names the file.
 *
 * ── The key, and why an entry without one is already broken ─────────────────
 *
 * This stored `{name, url}` and threw away the `key` the upload returned. The
 * url is a PRESIGNED url with a nine-hour life; the key is the object it was
 * signed from. With the key discarded there is nothing left to re-sign, so the
 * link in this field goes dead within the day and no amount of reloading brings
 * it back — the same way five executed e-sign PDFs became permanently
 * unservable. Every other attachment surface (`TaskDrawer`, `NewTaskModal`,
 * mobile's `NewTaskSheet`) already kept it; this one did not.
 *
 * The value is a jsonb column (`field_values.value`), and nothing between here
 * and the database reads the entries: `FieldRenderer` and `TableView` pass the
 * array through untouched and `PUT /fields/task/{id}/values` stores it whole.
 * So the extra member costs nothing and old entries — which have no key and
 * cannot be given one — keep rendering exactly as they do now.
 */
const CLIP = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5l-8.8 8.8a5 5 0 0 1-7.1-7.1l8.9-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.3l8.1-8.1" />
  </svg>
);

export default function FilesField({ field, value, onChange, readOnly }) {
  const files = Array.isArray(value) ? value : [];
  const inputRef = useRef(null);
  /* A refused upload used to reach `logger.error` and stop there: the console
     got the reason and the person got a field that had simply not changed.
     Now that the server refuses rather than inlining the bytes when storage is
     unconfigured, silence here would read as "nothing happened" for every file
     anyone picked. */
  const [error, setError] = useState('');

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');

    // Before the request, not after it. The server counts the bytes too, but it
    // can only do that once they have all arrived.
    const tooBig = oversizeMessage([file]);
    if (tooBig) {
      setError(tooBig);
      e.target.value = '';
      return;
    }

    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post('/upload', form);
      onChange([...files, { name: res.data.name, url: res.data.url, key: res.data.key ?? null }]);
    } catch (err) {
      logger.error('Upload failed', err);
      setError(apiErrorText(err, 'Upload failed — the file was not attached.'));
    }
    e.target.value = '';
  };

  const removeFile = (idx) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div className="stack--tight">
      {files.map((f, i) => (
        <div key={f.key || f.url || i} className="filerow">
          <span className="filerow__ic" aria-hidden="true">{CLIP}</span>
          <a className="filerow__n" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
          {!readOnly && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-label={`Remove ${f.name}`}
              onClick={() => removeFile(i)}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {error && <span className="fld__err" role="alert">{error}</span>}
      {!readOnly && (
        <>
          {/* display:none, not .sr-only — a visually-hidden but focusable file
              input is a phantom tab stop between the list and the button. */}
          <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
          <button type="button" className="btn btn--out btn--sm" onClick={() => inputRef.current?.click()}>
            Attach file
          </button>
        </>
      )}
    </div>
  );
}
