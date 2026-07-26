import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, AlertTriangle } from 'lucide-react';
import FileTypeIcon from './FileTypeIcon';
import { formatBytes, fileExt } from './fileMeta';

/**
 * FileDropZone — one drop target with all five states it can be in.
 *
 * The build had two drop zones before this one and they disagreed on every
 * state: `drawer/DrawerAttachments.jsx` (converted, correct) and
 * `components/TaskEditor.jsx` (still on `#8b5cf6`, `#c4b5fd` and
 * `var(--k-primary-dim, rgba(0,130,198,0.06))`). EsignPage had no drop zone at
 * all — it shipped a bare `<input type="file">`, so the create flow's only
 * affordance was the browser's default button.
 *
 * Two things carried over from the drawer's implementation because they are
 * the non-obvious parts:
 *
 *  · **A drag COUNTER, not a boolean.** `dragleave` fires when the pointer
 *    crosses into a child element, so a boolean flickers the active state off
 *    every time the cursor passes over the file row inside the zone.
 *  · **`dragover` must preventDefault** or the browser navigates to the file.
 *
 * What is new here is the ERROR state. Both existing zones validate size and
 * then report through a toast, which disappears — leaving a zone that looks
 * idle next to a file that was silently rejected. The rejection is rendered
 * in the zone, next to the control that caused it, until it is resolved.
 */
export default function FileDropZone({
  file,
  onFile,
  accept = '',
  maxMB = 25,
  disabled = false,
  uploading = false,
  progress = 0,
  hint,
  label = 'Drop a file here, or click to browse',
  id,
}) {
  const inputRef = useRef(null);
  const dragCount = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  /** Extension allow-list from the same `accept` string the input uses, so the
   *  two can never drift apart. An empty accept means "anything". */
  const allowed = useCallback((name) => {
    if (!accept) return true;
    const exts = accept.split(',').map(s => s.trim().toLowerCase()).filter(s => s.startsWith('.'));
    if (!exts.length) return true;
    return exts.some(e => name.toLowerCase().endsWith(e));
  }, [accept]);

  const take = useCallback((picked) => {
    if (!picked) return;
    if (!allowed(picked.name)) {
      setError(`${fileExt(picked.name) || 'That file type'} is not accepted here. Allowed: ${accept}`);
      return;
    }
    if (picked.size > maxMB * 1024 * 1024) {
      setError(`${picked.name} is ${formatBytes(picked.size)} — the limit is ${maxMB} MB.`);
      return;
    }
    setError('');
    onFile?.(picked);
  }, [allowed, accept, maxMB, onFile]);

  const onDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (disabled) return;
    dragCount.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current -= 1;
    if (dragCount.current <= 0) { dragCount.current = 0; setDragging(false); }
  };
  // Without this the browser opens the dropped file as a navigation.
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current = 0;
    setDragging(false);
    if (disabled) return;
    take(e.dataTransfer?.files?.[0]);
  };

  const cls = [
    'docdz',
    dragging && !disabled ? 'docdz--drag' : '',
    error ? 'docdz--err' : '',
    disabled ? 'docdz--off' : '',
  ].filter(Boolean).join(' ');

  const errId = error && id ? `${id}-dz-err` : undefined;

  return (
    <div
      className="docdz__wrap"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!file && (
        <button
          type="button"
          className={cls}
          disabled={disabled}
          aria-describedby={errId}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={22} className="docdz__ic" aria-hidden="true" />
          <span className="docdz__t">{dragging && !disabled ? 'Release to add the file' : label}</span>
          {hint && <span className="docdz__d">{hint}</span>}
        </button>
      )}

      {file && (
        <div className={`docdz__picked${error ? ' docdz--err' : ''}`}>
          <FileTypeIcon name={file.name} size={22} />
          <span className="docdz__nm">{file.name}</span>
          {/* Only rendered when a size genuinely exists — see fileMeta.formatBytes. */}
          {formatBytes(file.size) && <span className="docdz__sz">{formatBytes(file.size)}</span>}
          {!uploading && (
            <button
              type="button"
              className="docdz__x"
              aria-label={`Remove ${file.name}`}
              onClick={() => { setError(''); onFile?.(null); }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {uploading && (
        <div className="docdz__up">
          <div
            className="prg"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {/* A bar pinned at 6% while the server thinks reads as stalled, not
                as busy — the same floor the drawer's uploader uses. */}
            <div className="prg__f" style={{ width: `${Math.max(progress || 0, 6)}%` }} />
          </div>
          <span className="docdz__pct">
            {progress > 0 ? `Uploading ${progress}%` : 'Uploading…'}
          </span>
        </div>
      )}

      {error && (
        <p className="docdz__err" id={errId} role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
