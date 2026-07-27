import React, { useState, useRef } from 'react';
import { api, body } from '../../lib/api';
import { Card, CardHead, CardBody } from '../../components/ui/Card';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import Button from '../../components/ui/Button';
import Toggle from '../../components/ui/Toggle';
import BrandKit from '../../components/BrandKit';

/**
 * The task-template editor — the largest single block in the old
 * TemplatesPage.jsx and the reason that file was 621 lines.
 *
 * Three real defects came out with it:
 *
 *  · The "set as default" control was a <div> inside a <label> with a second
 *    <div> sliding across it on an inline `left`. Invisible to a screen reader,
 *    unreachable by keyboard, and named in Toggle.jsx's own docblock as the
 *    thing that component exists to replace. It is a `role="switch"` now.
 *
 *  · The file upload swallowed its failure: `catch (_) {}` with an empty body.
 *    A rejected upload cleared the spinner and added nothing, so the user saw
 *    the file simply not appear and had no reason to believe anything broke.
 *
 *  · Every label was `k-label` + an inline 11px/700/uppercase rule repeated
 *    nine times. They are `Field` labels now and follow the system.
 */

const ICONS = ['📋', '✅', '🎨', '📹', '📸', '📊', '💡', '🔖', '⚡', '🚀', '📝', '🎯', '🔧', '📦', '🌐'];

const ACCEPT = '.jpg,.jpeg,.png,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt';

function AttachUrlRow({ onAdd }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const add = () => {
    if (!url.trim()) return;
    const label = name.trim() || url.trim().split('/').pop().split('?')[0] || url.trim();
    onAdd({ name: label, url: url.trim(), key: null });
    setName(''); setUrl('');
  };
  return (
    <div className="tpl-url">
      <div className="tpl-url__col">
        <Input
          value={url}
          aria-label="Attachment URL"
          placeholder="Paste URL (Google Drive, Figma, Notion…)"
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <Input
          value={name}
          aria-label="Attachment label"
          placeholder="Label (optional — e.g. Brand Kit, Figma mockup)"
          onChange={e => setName(e.target.value)}
        />
      </div>
      <Button variant="ghost" size="sm" disabled={!url.trim()} onClick={add}>+ Add URL</Button>
    </div>
  );
}

export default function TaskTemplateForm({ form, setForm, editingId, projects, onSaved, onCancel, pushToast }) {
  const [saving, setSaving] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [showIcons, setShowIcons] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const cfg = form.config || {};
  const setcfg = (key, val) => setForm(f => ({ ...f, config: { ...f.config, [key]: val } }));

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    setcfg('subtasks', [...(cfg.subtasks || []), { title: newSubtask.trim(), is_done: false }]);
    setNewSubtask('');
  };

  const save = async () => {
    if (!form.name.trim()) { pushToast({ type: 'error', title: 'Template name is required' }); return; }
    setSaving(true);
    try {
      if (editingId) await api.patch(`/templates/tasks/${editingId}`, form);
      else await api.post('/templates/tasks', form);
      pushToast({ type: 'success', title: editingId ? 'Template updated' : 'Template created' });
      onSaved();
    } catch {
      pushToast({ type: 'error', title: 'Could not save template' });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (e) => {
    const picked = Array.from(e.target.files);
    if (!picked.length) return;
    setUploading(true);
    const failed = [];
    try {
      for (const file of picked) {
        try {
          const fd = new FormData();
          fd.append('file', file);
          const res = await api.post('/upload', fd);
          const d = body(res);
          setForm(f => ({
            ...f,
            config: {
              ...f.config,
              attachments: [...(f.config.attachments || []), { name: file.name, url: d.url, key: d.key || null }],
            },
          }));
        } catch {
          // Per FILE, not per batch: one rejected upload used to abandon the
          // whole loop, so files queued behind it were silently dropped too.
          failed.push(file.name);
        }
      }
    } finally {
      setUploading(false);
      e.target.value = '';
      if (failed.length) {
        pushToast({
          type: 'error',
          title: failed.length === 1 ? 'A file did not upload' : `${failed.length} files did not upload`,
          message: failed.join(', '),
        });
      }
    }
  };

  return (
    <Card>
      <CardHead title={editingId ? 'Edit template' : 'New task template'} sanskrit="साँचा" />
      <CardBody>
        <div className="tpl-form">
          <div className="tpl-grid3">
            <Field label="Icon">
              <div className="tpl-ico">
                <button
                  type="button"
                  className="tpl-ico__btn"
                  aria-label="Choose an icon"
                  aria-expanded={showIcons}
                  onClick={() => setShowIcons(v => !v)}
                >
                  {form.icon}
                </button>
                {showIcons && (
                  <div className="tpl-ico__pop" role="listbox" aria-label="Template icons">
                    {ICONS.map(ic => (
                      <button
                        key={ic}
                        type="button"
                        role="option"
                        aria-selected={form.icon === ic}
                        className="tpl-ico__opt"
                        onClick={() => { setForm(f => ({ ...f, icon: ic })); setShowIcons(false); }}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            <Field label="Template name" required htmlFor="tpl-name">
              <Input
                id="tpl-name"
                autoFocus
                value={form.name}
                placeholder="e.g. Instagram post, brand video…"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </Field>

            <Field label="Project (scope)" htmlFor="tpl-scope">
              <Select
                id="tpl-scope"
                value={form.team_id}
                onChange={e => setForm(f => ({ ...f, team_id: e.target.value }))}
              >
                <option value="">All projects (global)</option>
                {projects.map(p => <option key={p.team_id} value={p.team_id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field
            label="Pre-filled title"
            htmlFor="tpl-title"
            hint="Use {placeholders} — the person creating the task fills them in."
          >
            <Input
              id="tpl-title"
              value={cfg.title || ''}
              placeholder="e.g. Instagram post — {client name}"
              onChange={e => setcfg('title', e.target.value)}
            />
          </Field>

          <Field label="Description / brand guidelines" htmlFor="tpl-desc">
            <Textarea
              id="tpl-desc"
              rows={4}
              value={cfg.description || ''}
              placeholder="Brand guidelines, tone of voice, size specs, platform rules…"
              onChange={e => setcfg('description', e.target.value)}
            />
          </Field>

          <div className="tpl-grid2">
            <Field label="Default priority" htmlFor="tpl-prio">
              <Select id="tpl-prio" value={cfg.priority || 'medium'} onChange={e => setcfg('priority', e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Default template">
              <span className="tpl-switch">
                <Toggle
                  checked={!!form.is_default}
                  label="Set as the default template for this project"
                  onChange={v => setForm(f => ({ ...f, is_default: v }))}
                />
                Set as default for this project
              </span>
            </Field>
          </div>

          <Field label="Brand colours" hint="Workspace palette — managed in Admin → Brand Colors.">
            <BrandKit mode="display" />
          </Field>

          <Field label="Subtasks">
            <div className="tpl-stack">
              {(cfg.subtasks || []).map((s, i) => (
                <div key={i} className="tpl-item">
                  <span className="tpl-item__t">{s.title}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove subtask ${s.title}`}
                    onClick={() => setcfg('subtasks', cfg.subtasks.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <div className="tpl-url">
                <div className="tpl-url__col">
                  <Input
                    value={newSubtask}
                    aria-label="New subtask"
                    placeholder="Add subtask…"
                    onChange={e => setNewSubtask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                  />
                </div>
                <Button variant="ghost" size="sm" disabled={!newSubtask.trim()} onClick={addSubtask}>+ Add</Button>
              </div>
            </div>
          </Field>

          <Field
            label="Pre-attached files & links"
            hint="Files and URLs auto-attach whenever this template is used."
          >
            <div className="tpl-stack">
              {(cfg.attachments || []).map((a, i) => (
                <div key={i} className="tpl-item">
                  <svg className="tpl-item__ic" width="13" height="13" viewBox="0 0 16 16" fill="none"
                    stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    {a.key
                      ? <><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" /><path d="M9 1v4h4" /></>
                      : <><path d="M2 8a6 6 0 1 0 12 0A6 6 0 0 0 2 8z" /><path d="M8 5v3l2 2" /></>}
                  </svg>
                  <a className="tpl-item__link" href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setcfg('attachments', cfg.attachments.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}

              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="tpl-file"
                onChange={upload}
              />
              <div className="tpl-card__row">
                <Button variant="ghost" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                  Upload file
                </Button>
              </div>

              <AttachUrlRow onAdd={(item) => setcfg('attachments', [...(cfg.attachments || []), item])} />
            </div>
          </Field>

          <div className="tpl-foot">
            <Button variant="fill" loading={saving} disabled={!form.name.trim()} onClick={save}>
              {editingId ? 'Save changes' : 'Create template'}
            </Button>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
