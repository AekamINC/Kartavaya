import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, ExternalLink, Trash2, Upload, Image as ImageIcon, FileText, Film, Lock, Unlock, X, Eye, Check } from 'lucide-react';
import Popover from '../ui/Popover';
import FocusTrap from '../ui/FocusTrap';
import { useExitAnimation } from '../../hooks/useExitAnimation';

/**
 * DrawerAttachments — the largest file in the drawer, restyled to the drop-zone
 * spec in MOTION-SPEC §6 with the upload machinery kept intact (03 §5).
 *
 * What was kept, because it is careful work:
 *  · the drag COUNTER rather than a boolean. `dragleave` fires when the pointer
 *    crosses into a child element, so a boolean flickers the overlay off every
 *    time the cursor passes over the file list inside the zone;
 *  · the split doc/video inputs with their own accept lists and size limits;
 *  · the per-file progress and the Office/PDF viewer fallbacks in the lightbox.
 *
 * What changed is colour and semantics. Every surface here was an inline style
 * object with literal hexes — `#fef3c7` / `#fbbf24` / `#92400e` for the private
 * badge, `#8b5cf6` for video, `rgba(0,0,0,.85)` for the lightbox — none of
 * which flip with the theme, so the private badge was pale amber on amber in
 * dark mode. The private badge is now `--warn-container` / `--on-warn-container`,
 * which is the pairing rule from 00 §7: a token may sit behind text only if it
 * has a declared `on-` partner.
 *
 * The thumbnails and the drop zone were `div`s with `onClick`. They are buttons.
 * A clickable div is invisible to the keyboard and announces nothing.
 */

const MAX_FILES     = 10;
const MAX_MB        = 25;
const MAX_MB_VIDEO  = 50;
const VIDEO_EXT     = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;
const IMAGE_EXT     = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
const PDF_EXT       = /\.pdf$/i;
const OFFICE_EXT    = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i;

const DOC_ACCEPT   = '.jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt';
const VIDEO_ACCEPT = 'video/*,.mov,.mp4,.webm,.avi,.mkv,.m4v,.3gp,.flv,.wmv,.ogv,.ts';

const isImage  = n => IMAGE_EXT.test(n);
const isVideo  = n => VIDEO_EXT.test(n);
const isPdf    = n => PDF_EXT.test(n);
const isOffice = n => OFFICE_EXT.test(n);
const hasPreview = n => isImage(n) || isVideo(n) || isPdf(n) || isOffice(n);

function FileIcon({ name }) {
  if (isImage(name)) return <ImageIcon size={13} aria-hidden="true" />;
  if (isVideo(name)) return <Film size={13} aria-hidden="true" />;
  return <FileText size={13} aria-hidden="true" />;
}

/**
 * Per-file visibility. It stays open across toggles, which is why it is a
 * `Popover` and not a `Menu` — Menu closes on every select, and setting three
 * people's access one reopen at a time is the kind of thing that gets a feature
 * abandoned rather than reported.
 */
function PrivacyPicker({ file, members, currentUserId, onChange }) {
  const isPrivate = file.is_private || false;
  const visibleTo = file.visible_to || [];
  const others = members.filter(m => (m.user_id || m.member_id) !== currentUserId);

  const toggleMember = (uid) => {
    const next = visibleTo.includes(uid) ? visibleTo.filter(x => x !== uid) : [...visibleTo, uid];
    onChange({ ...file, is_private: true, visible_to: next });
  };

  return (
    <Popover
      align="right"
      label="File visibility"
      width={228}
      trigger={
        <span
          className={`dr__att-ic${isPrivate ? ' dr__att-ic--on' : ''}`}
          title={isPrivate ? 'Private — manage who can see this' : 'Visible to the project — click to restrict'}
        >
          {isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
        </span>
      }
    >
      {({ close }) => (
        <div className="dr__vis">
          <div className="dr__vis-h">File visibility</div>
          <button
            type="button"
            className={`dr__vis-r${!isPrivate ? ' on' : ''}`}
            onClick={() => { onChange({ ...file, is_private: false, visible_to: [] }); close(); }}
          >
            <Unlock size={12} aria-hidden="true" />
            <span className="dr__vis-n">Everyone on the project</span>
            {!isPrivate && <Check size={12} aria-hidden="true" />}
          </button>
          {others.map(m => {
            const uid = m.user_id || m.member_id;
            const name = m.display_name || m.full_name || m.name || '';
            const checked = visibleTo.includes(uid);
            return (
              <button key={uid} type="button" className={`dr__vis-r${checked ? ' on' : ''}`}
                aria-pressed={checked} onClick={() => toggleMember(uid)}>
                <span className="dr__vis-n">{name}</span>
                {checked && <Check size={12} aria-hidden="true" />}
              </button>
            );
          })}
          {others.length === 0 && <div className="dr__ap-none">No other members</div>}
        </div>
      )}
    </Popover>
  );
}

function Lightbox({ file, onClose, open, closing, onAnimationEnd }) {
  const name = file.name || file.url?.split('/').pop() || 'File';
  const closeRef = useRef(null);
  const [imgError, setImgError] = useState(false);
  const isHttp = /^https?:\/\//i.test(file.url || '');
  const showDoc = isPdf(name) || (isOffice(name) && isHttp);
  const viewerUrl = isOffice(name) && isHttp
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`
    : file.url;
  const fellBack = (isImage(name) && imgError)
    || (isOffice(name) && !isHttp)
    || (!isImage(name) && !isVideo(name) && !showDoc);

  return (
    /* aria-modal="true" was a promise this overlay did not keep: it told a
       screen reader the rest of the page was inert while Tab walked straight
       out of it into the drawer behind. The lightbox is opened FROM the drawer,
       which is itself trapped, so escaping it landed focus in a second modal
       layer with no way back.

       autoFocus on the close button is replaced by initialFocus. autoFocus
       fires on mount only, so re-opening the lightbox for a different file
       within the same mount left focus wherever it was; and it gave no focus
       RESTORE at all, so closing the preview dropped a keyboard user at the top
       of the document instead of back on the file row they opened. */
    /* `active={open}`, not the bare `active`: the trap must release when the
       user dismisses, so focus returns to the file row immediately rather than
       after the 140ms fade. */
    <FocusTrap active={open} initialFocus={closeRef}>
    <div
      className={`dr__lb ${closing ? 'is-closing' : ''}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      aria-hidden={closing || undefined}
      onAnimationEnd={onAnimationEnd}
      onClick={e => e.target === e.currentTarget && onClose()}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <button type="button" ref={closeRef} className="dr__lb-x" onClick={onClose} aria-label="Close preview">
        <X size={18} />
      </button>

      {isImage(name) && !imgError && (
        <img className="dr__lb-img" src={file.url} alt={name} onError={() => setImgError(true)} />
      )}
      {isVideo(name) && <video className="dr__lb-img" src={file.url} controls autoPlay />}
      {showDoc && (
        <div className="dr__lb-doc">
          <object data={viewerUrl} type={isPdf(name) ? 'application/pdf' : undefined}>
            <iframe src={viewerUrl} title={name} />
          </object>
        </div>
      )}

      {fellBack && (
        <div className="dr__lb-fall">
          <FileText size={32} aria-hidden="true" />
          <div className="dr__lb-fall-t">
            {imgError
              ? 'Image could not be loaded'
              : isOffice(name) && !isHttp
                ? 'This file was saved before cloud storage was set up'
                : 'Preview is not available for this file type'}
          </div>
          {isOffice(name) && !isHttp && (
            <div className="dr__lb-fall-d">Delete and re-upload to enable preview</div>
          )}
          <a className="btn btn--fill" href={file.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {file.url?.startsWith('data:') ? 'Download file' : 'Open in new tab'}
          </a>
        </div>
      )}

      {showDoc && (
        <a className="btn btn--out" href={file.url} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Open in new tab
        </a>
      )}
    </div>
    </FocusTrap>
  );
}

function FileRow({ file, onRemove, members, currentUserId, onPrivacyChange }) {
  const name = file.name || file.url?.split('/').pop() || 'File';
  const [lightbox, setLightbox] = useState(false);
  // The preview stays mounted through its fade-out. It is the largest overlay
  // in the app and was the last one to disappear instantly.
  const lb = useExitAnimation(lightbox);
  const previewable = hasPreview(name);

  return (
    <>
      <div className="dr__att">
        {isImage(name) && file.url && (
          <button type="button" className="dr__att-thumb" onClick={() => setLightbox(true)}
            aria-label={`Preview ${name}`}>
            <img src={file.url} alt="" loading="lazy" />
          </button>
        )}
        {isVideo(name) && file.url && (
          <button type="button" className="dr__att-thumb dr__att-vid" onClick={() => setLightbox(true)}
            aria-label={`Play ${name}`}>
            <video src={file.url} preload="metadata" muted />
            <span className="dr__att-play"><Film size={18} aria-hidden="true" /></span>
          </button>
        )}
        {(isPdf(name) || isOffice(name)) && file.url && (
          <button type="button" className="dr__att-thumb dr__att-doc" onClick={() => setLightbox(true)}>
            <FileText size={18} aria-hidden="true" /> Click to preview
          </button>
        )}

        <div className="dr__att-row">
          <FileIcon name={name} />
          <a className="dr__att-name" href={file.url} target="_blank" rel="noreferrer">{name}</a>
          {file.is_private && <span className="dr__att-priv">Private</span>}
          {previewable && (
            <button type="button" className="dr__att-ic" title="Preview"
              aria-label={`Preview ${name}`} onClick={() => setLightbox(true)}>
              <Eye size={12} />
            </button>
          )}
          <a className="dr__att-ic" href={file.url} target="_blank" rel="noreferrer"
            title="Open in new tab" aria-label={`Open ${name} in a new tab`}>
            <ExternalLink size={11} />
          </a>
          {onPrivacyChange && members && (
            <PrivacyPicker file={file} members={members} currentUserId={currentUserId} onChange={onPrivacyChange} />
          )}
          {onRemove && (
            <button type="button" className="dr__att-ic dr__att-ic--danger"
              aria-label={`Remove ${name}`} onClick={onRemove}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {lb.alive && createPortal(
        <Lightbox
          file={file}
          open={lightbox}
          closing={lb.closing}
          onAnimationEnd={lb.onAnimationEnd}
          onClose={() => setLightbox(false)}
        />,
        document.body,
      )}
    </>
  );
}

export default function DrawerAttachments({
  attachments, uploading, uploadProgress = 0, fileRef, videoRef, handleFileChange, removeAttachment,
  onPrivacyChange, members = [], currentUserId,
}) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const isProjectTask = members.length > 0;
  const full = attachments.length >= MAX_FILES;

  const onDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragging(true); };
  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); }
  };
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    if (!e.dataTransfer?.files?.length) return;
    handleFileChange({ target: { files: e.dataTransfer.files, value: '' } });
  };

  return (
    <div
      className="dr__files"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={!full ? onDrop : undefined}
    >
      <input ref={fileRef}  type="file" multiple accept={DOC_ACCEPT}   hidden onChange={handleFileChange} />
      <input ref={videoRef} type="file" multiple accept={VIDEO_ACCEPT} hidden onChange={handleFileChange} />

      {dragging && !full && (
        <div className="dr__drop" aria-hidden="true">
          <span className="dr__drop-in">
            <Upload size={24} />
            Drop files here
          </span>
        </div>
      )}

      <div className="dr__att-hd">
        <button type="button" className="btn btn--out btn--sm"
          onClick={() => fileRef.current?.click()} disabled={uploading || full}>
          <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Attach files'}
        </button>
        <button type="button" className="btn btn--out btn--sm"
          onClick={() => videoRef.current?.click()} disabled={uploading || full}>
          <Film size={13} /> Attach video
        </button>
        <span className="dr__att-n">{attachments.length}/{MAX_FILES}</span>
      </div>

      <div className="dr__att-lim">
        Docs and images up to {MAX_MB} MB · video (any format) up to {MAX_MB_VIDEO} MB
      </div>

      {attachments.length === 0 && !uploading && (
        <button type="button" className="dr__dz" disabled={full} onClick={() => fileRef.current?.click()}>
          <Upload size={22} className="dr__dz-ic" aria-hidden="true" />
          <span className="dr__dz-t">Drop files here, or use the buttons above</span>
          <span className="dr__dz-d">
            Images, PDF, Word, Excel, PowerPoint · max {MAX_MB} MB<br />
            Video: MOV, MP4, MKV and more · max {MAX_MB_VIDEO} MB
          </span>
        </button>
      )}

      {uploading && (
        <div className="dr__up">
          <div className="dr__up-h">
            <span className="spin" aria-hidden="true" />
            <span>Uploading{uploadProgress > 0 ? ` ${uploadProgress}%` : '…'}</span>
          </div>
          <div className="prg" role="progressbar" aria-label="Upload progress"
            aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
            <div className="prg__f" style={{ width: `${Math.max(uploadProgress || 0, 6)}%` }} />
          </div>
          <div className="dr__up-n">
            If this takes more than a minute, try a smaller file or check your connection.
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="dr__att-list">
          {attachments.map((f, i) => (
            <FileRow
              key={f.key || f.url || i}
              file={f}
              onRemove={() => removeAttachment(i)}
              members={isProjectTask ? members : null}
              currentUserId={currentUserId}
              onPrivacyChange={isProjectTask ? (updated) => onPrivacyChange?.(i, updated) : null}
            />
          ))}
          {!full && !uploading && (
            <div className="dr__att-more">
              <button type="button" className="dr__att-add" onClick={() => fileRef.current?.click()}>
                <Paperclip size={12} /> Add files
              </button>
              <button type="button" className="dr__att-add" onClick={() => videoRef.current?.click()}>
                <Film size={12} /> Add video
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
