import React, { useRef } from 'react';
import { api } from '../../lib/api';
import { logger } from '../../lib/utils';

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

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post('/upload', form);
      onChange([...files, { name: res.data.name, url: res.data.url }]);
    } catch (err) {
      logger.error('Upload failed', err);
    }
    e.target.value = '';
  };

  const removeFile = (idx) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div className="stack--tight">
      {files.map((f, i) => (
        <div key={f.url || i} className="filerow">
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
