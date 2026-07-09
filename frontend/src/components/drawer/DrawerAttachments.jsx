import React, { useRef, useState } from 'react';
import { Paperclip, ExternalLink, Trash2, Upload, Image, FileText, Film, Lock, Unlock, X } from 'lucide-react';
import { avatarColor, userInitials } from '../../lib/utils';

const MAX_FILES     = 10;
const MAX_MB        = 25;
const MAX_MB_VIDEO  = 50;
const VIDEO_EXT     = /\.(mov|mp4|webm|avi|mkv|m4v|3gp|3gpp|flv|wmv|asf|ogv|ts|mts|m2ts)$/i;
const IMAGE_EXT     = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;

const DOC_ACCEPT  = '.jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt';
const VIDEO_ACCEPT = 'video/*,.mov,.mp4,.webm,.avi,.mkv,.m4v,.3gp,.flv,.wmv,.ogv,.ts';

function fileIcon(name) {
  if (IMAGE_EXT.test(name)) return <Image size={13} style={{ color: 'var(--k-primary)', flexShrink: 0 }} />;
  if (VIDEO_EXT.test(name)) return <Film size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />;
  return <FileText size={13} style={{ color: 'var(--k-primary)', flexShrink: 0 }} />;
}

const PDF_EXT     = /\.pdf$/i;
const OFFICE_EXT  = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i;
const TEXT_EXT    = /\.(txt|csv)$/i;

function isImage(name)  { return IMAGE_EXT.test(name); }
function isVideo(name)  { return VIDEO_EXT.test(name); }
function isPdf(name)    { return PDF_EXT.test(name); }
function isOffice(name) { return OFFICE_EXT.test(name); }
function isText(name)   { return TEXT_EXT.test(name); }
function hasPreview(name) { return isImage(name) || isVideo(name) || isPdf(name) || isOffice(name); }

function PrivacyPicker({ file, members, currentUserId, onChange }) {
  const [open, setOpen] = useState(false);
  const isPrivate = file.is_private || false;
  const visibleTo = file.visible_to || [];

  function toggleMember(uid) {
    const next = visibleTo.includes(uid) ? visibleTo.filter(x => x !== uid) : [...visibleTo, uid];
    onChange({ ...file, is_private: true, visible_to: next });
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        title={isPrivate ? 'Private — click to manage' : 'Public to project — click to make private'}
        onClick={() => setOpen(v => !v)}
        style={{
          background: isPrivate ? '#fef3c7' : 'transparent',
          border: isPrivate ? '1px solid #fbbf24' : 'none',
          borderRadius: 6, padding: '2px 5px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 3,
          color: isPrivate ? '#92400e' : 'var(--ink-3)',
        }}
      >
        {isPrivate ? <Lock size={11} /> : <Unlock size={11} />}
        {isPrivate && visibleTo.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700 }}>{visibleTo.length}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, zIndex: 300,
          background: 'var(--surface)', border: '1px solid var(--rule)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          minWidth: 200, padding: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', padding: '2px 6px 6px' }}>
            File visibility
          </div>
          <button
            onClick={() => { onChange({ ...file, is_private: false, visible_to: [] }); setOpen(false); }}
            style={{
              width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6,
              border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              background: !isPrivate ? 'var(--side-active)' : 'transparent',
              color: 'var(--ink)',
            }}
          >
            <Unlock size={11} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            Visible to all project members
          </button>
          {members.filter(m => (m.user_id || m.member_id) !== currentUserId).map((m) => {
            const uid  = m.user_id || m.member_id;
            const name = m.display_name || m.full_name || m.name || '';
            const checked = visibleTo.includes(uid);
            return (
              <button
                key={uid}
                onClick={() => { toggleMember(uid); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6,
                  border: 'none', cursor: 'pointer', fontSize: 12,
                  background: checked ? 'var(--side-active)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)',
                }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', fontSize: 9, fontWeight: 700, flexShrink: 0,
                  background: avatarColor(name), color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {userInitials(name)}
                </span>
                <span style={{ flex: 1 }}>{name}</span>
                {checked && <span style={{ color: 'var(--k-primary)', fontSize: 14 }}>✓</span>}
              </button>
            );
          })}
          {members.filter(m => (m.user_id || m.member_id) !== currentUserId).length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: '6px 8px' }}>No other members</div>
          )}
        </div>
      )}
    </div>
  );
}

function LightboxOverlay({ file, onClose }) {
  const name = file.name || file.url?.split('/').pop() || 'File';
  const showDoc = isPdf(name) || isOffice(name);
  const viewerUrl = isOffice(name)
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`
    : file.url;

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, gap: 12,
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)',
          border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <X size={20} />
      </button>
      {isImage(name) && (
        <img src={file.url} alt={name} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain' }} />
      )}
      {isVideo(name) && (
        <video src={file.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8 }} />
      )}
      {showDoc && (
        <div style={{ width: '90vw', height: '82vh', position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <object
            data={viewerUrl}
            type={isPdf(name) ? 'application/pdf' : undefined}
            style={{ width: '100%', height: '100%', border: 'none' }}
          >
            <iframe
              src={viewerUrl}
              title={name}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </object>
        </div>
      )}
      {/* Open in new tab fallback — always shown for docs */}
      {showDoc && (
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: '#fff', fontSize: 13, fontWeight: 500,
            background: 'rgba(255,255,255,0.15)', borderRadius: 8,
            padding: '8px 16px', textDecoration: 'none',
          }}
        >
          <ExternalLink size={14} />
          Open in new tab
        </a>
      )}
    </div>
  );
}

function FileChip({ file, onRemove, members, currentUserId, onPrivacyChange }) {
  const name = file.name || file.url?.split('/').pop() || 'File';
  const [lightbox, setLightbox] = useState(false);
  const previewable = hasPreview(name);

  return (
    <>
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--rule)',
        borderRadius: 'var(--r-md)', fontSize: 13, overflow: 'hidden',
      }}>
        {/* Image preview thumbnail */}
        {isImage(name) && file.url && (
          <div
            onClick={() => setLightbox(true)}
            style={{
              cursor: 'pointer', position: 'relative',
              background: 'var(--rule-soft)', borderBottom: '1px solid var(--rule)',
            }}
          >
            <img
              src={file.url}
              alt={name}
              style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover' }}
              loading="lazy"
            />
          </div>
        )}
        {/* Video preview thumbnail */}
        {isVideo(name) && file.url && (
          <div
            onClick={() => setLightbox(true)}
            style={{
              cursor: 'pointer', position: 'relative',
              background: '#000', borderBottom: '1px solid var(--rule)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: 100,
            }}
          >
            <video
              src={file.url}
              preload="metadata"
              style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover' }}
              muted
            />
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.3)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'rgba(255,255,255,0.9)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Film size={18} style={{ color: '#8b5cf6', marginLeft: 2 }} />
              </div>
            </div>
          </div>
        )}
        {/* Document preview banner — PDF & Office */}
        {(isPdf(name) || isOffice(name)) && file.url && (
          <div
            onClick={() => setLightbox(true)}
            style={{
              cursor: 'pointer', padding: '14px 16px',
              background: 'var(--bg-soft)', borderBottom: '1px solid var(--rule)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <FileText size={20} style={{ color: 'var(--k-primary)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-primary)' }}>
              Click to preview
            </span>
          </div>
        )}
        {/* File info row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
          {fileIcon(name)}
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--ink-2)', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {name}
          </a>
          {file.is_private && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
              Private
            </span>
          )}
          {previewable && (
            <button
              onClick={e => { e.preventDefault(); setLightbox(true); }}
              title="Preview"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, display: 'flex', flexShrink: 0 }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="3"/><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/>
              </svg>
            </button>
          )}
          <a href={file.url} target="_blank" rel="noreferrer" title="Open in new tab" style={{ display: 'flex', flexShrink: 0, color: 'var(--ink-3)' }}>
            <ExternalLink size={11} />
          </a>
          {onPrivacyChange && members && (
            <PrivacyPicker file={file} members={members} currentUserId={currentUserId} onChange={onPrivacyChange} />
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, display: 'flex', marginLeft: 2 }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {lightbox && <LightboxOverlay file={file} onClose={() => setLightbox(false)} />}
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

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    const dt = e.dataTransfer;
    if (!dt?.files?.length) return;
    handleFileChange({ target: { files: dt.files, value: '' } });
  };

  const full = attachments.length >= MAX_FILES;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={!full ? handleDrop : undefined}
      style={{ position: 'relative' }}
    >
      {/* Hidden inputs — docs and video separate */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={videoRef}
        type="file"
        multiple
        accept={VIDEO_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Drag overlay — always visible when dragging, covers the whole section */}
      {dragging && !full && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'var(--k-primary-dim, rgba(0,130,198,0.08))',
          border: '2px dashed var(--k-primary)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <Upload size={24} style={{ color: 'var(--k-primary)', marginBottom: 4 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--k-primary)' }}>
              Drop files here
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <button
          className="k-btn k-btn--ghost k-btn--sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || full}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Paperclip size={13} />
          {uploading ? 'Uploading…' : 'Attach files'}
        </button>
        <button
          className="k-btn k-btn--ghost k-btn--sm"
          onClick={() => videoRef.current?.click()}
          disabled={uploading || full}
          style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b5cf6' }}
        >
          <Film size={13} />
          Attach video
        </button>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 'auto' }}>
          {attachments.length}/{MAX_FILES}
        </span>
      </div>

      {/* Limit hints */}
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 10, lineHeight: 1.6 }}>
        Docs &amp; images up to {MAX_MB} MB &nbsp;&middot;&nbsp; Video (any format) up to {MAX_MB_VIDEO} MB
      </div>

      {/* Drop zone — shown only when empty */}
      {attachments.length === 0 && !uploading && (
        <div
          onClick={() => !full && fileRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragging ? 'var(--k-primary)' : 'var(--rule-strong)'}`,
            borderRadius: 10,
            padding: '28px 20px',
            textAlign: 'center',
            cursor: full ? 'default' : 'pointer',
            background: dragging ? 'var(--k-primary-dim, rgba(0,130,198,0.06))' : 'transparent',
            transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          <Upload size={22} style={{ color: 'var(--ink-3)', marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
            Drop files here or use buttons above
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Images, PDF, Word, Excel, PowerPoint &middot; max {MAX_MB} MB<br />
            Video: MOV, MP4, MKV and more &middot; max {MAX_MB_VIDEO} MB
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div style={{ padding: '12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 13, marginBottom: 8 }}>
            <div className="k-spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
            <span>Uploading{uploadProgress > 0 ? ` ${uploadProgress}%` : '…'}</span>
          </div>
          <div style={{ height: 4, background: 'var(--rule)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${uploadProgress || 0}%`,
              background: 'var(--k-primary)',
              borderRadius: 2,
              transition: 'width 0.25s ease',
              minWidth: uploadProgress > 0 ? undefined : '15%',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 5 }}>
            If this takes more than a minute, try a smaller file or check your connection.
          </div>
        </div>
      )}

      {/* File list */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attachments.map((f, i) => (
            <FileChip
              key={i}
              file={f}
              onRemove={() => removeAttachment(i)}
              members={isProjectTask ? members : null}
              currentUserId={currentUserId}
              onPrivacyChange={isProjectTask ? (updated) => onPrivacyChange?.(i, updated) : null}
            />
          ))}
          {!full && !uploading && (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8,
                  border: '1.5px dashed var(--rule-strong)',
                  background: 'transparent', cursor: 'pointer',
                  color: 'var(--ink-3)', fontSize: 12, fontWeight: 600,
                }}
              >
                <Paperclip size={12} /> Add files
              </button>
              <button
                onClick={() => videoRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8,
                  border: '1.5px dashed var(--rule-strong)',
                  background: 'transparent', cursor: 'pointer',
                  color: '#8b5cf6', fontSize: 12, fontWeight: 600,
                }}
              >
                <Film size={12} /> Add video
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
