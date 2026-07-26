import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Card, CardHead, CardBody, Button, Field, Input, Textarea } from '../../components/ui';
import { FileDropZone } from '../../components/documents';

/**
 * The create flow.
 *
 * The upload was a bare `<input type="file">` with no drop target, no progress
 * and no rejection message — a 60 MB scan produced a spinner, then a toast that
 * vanished, and a form still holding a file the server had refused. It now uses
 * the shared `FileDropZone`, which validates before the request and renders the
 * reason in place.
 *
 * **The create is two requests and the second one can fail on its own.** The
 * document row is written first, then the PDF is uploaded to it. If the upload
 * fails the document still exists, in `draft` with `file_url === 'pending'` —
 * so the failure path says that, and offers the draft, rather than reporting a
 * total failure and leaving an orphan the user cannot see or explain.
 */
const MAX_MB = 20;
const MAX_SIGNERS = 10;
const ACCEPT = '.pdf';

const blankSigner = order => ({ name: '', email: '', phone: '', sign_order: order });

export default function CreateTab({ onDone, onOpen }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [signers, setSigners] = useState([blankSigner(1)]);
  const [file, setFile] = useState(null);
  const [expiresDays, setExpiresDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState({});

  const addSigner = () => {
    if (signers.length >= MAX_SIGNERS) return;
    setSigners([...signers, blankSigner(signers.length + 1)]);
  };

  const updateSigner = (idx, key, value) => {
    setSigners(prev => prev.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));
  };

  // Re-numbering on removal keeps sign_order dense. A sequential flow with a
  // gap at position 2 is a document the server will wait on forever.
  const removeSigner = (idx) => {
    if (signers.length <= 1) return;
    setSigners(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sign_order: i + 1 })));
  };

  const validate = () => {
    const next = {};
    if (!title.trim()) next.title = 'A title is required — signers see it in the email subject.';
    if (!file) next.file = 'Attach the PDF that will be signed.';
    signers.forEach((s, i) => {
      if (!s.name.trim() || !s.email.trim()) next[`s${i}`] = 'Name and email are both required.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) next[`s${i}`] = 'That email address is not valid.';
    });
    const emails = signers.map(s => s.email.trim().toLowerCase()).filter(Boolean);
    if (new Set(emails).size !== emails.length) next.dupe = 'Two signers share an email address.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    setProgress(0);

    let docId = null;
    try {
      const r = await api.post('/v1/esign/documents', {
        title: title.trim(),
        description: description.trim(),
        signers: signers.map(s => ({
          name: s.name.trim(), email: s.email.trim(), phone: s.phone.trim(), sign_order: s.sign_order,
        })),
        expires_days: expiresDays,
      });
      docId = r.data.id;

      const body = new FormData();
      body.append('file', file);
      await api.post(`/v1/esign/documents/${docId}/upload`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
        noRetry: true,
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      toast.success('Document created. Open it to send for signing.');
      onDone?.();
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (docId) {
        // Stage two failed. The draft exists; say so and offer it.
        toast.error(detail || 'The document was created but the PDF did not upload. Open the draft to retry.');
        onOpen?.(docId);
      } else {
        toast.error(detail || 'Could not create the document.');
      }
    } finally {
      setSaving(false);
      setProgress(0);
    }
  };

  return (
    <Card>
      <CardHead title="New document" />
      <CardBody>
        <div className="docform">
          <Field label="Title" required error={errors.title}>
            {p => (
              <Input
                {...p}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Service agreement — FY 2026-27"
              />
            )}
          </Field>

          <Field label="Description" hint="Optional. Shown to signers above the document.">
            {p => (
              <Textarea
                {...p}
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Document"
            required
            error={errors.file}
            hint={`PDF only, up to ${MAX_MB} MB.`}
          >
            <FileDropZone
              file={file}
              onFile={(f) => { setFile(f); setErrors(({ file: _drop, ...rest }) => rest); }}
              accept={ACCEPT}
              maxMB={MAX_MB}
              uploading={saving && !!file}
              progress={progress}
              disabled={saving}
              label="Drop the PDF here, or click to browse"
              hint="This is the file every signer sees and signs."
            />
          </Field>

          <Field
            label="Expires in"
            hint="Days from the moment it is sent. Signers cannot open it after that."
          >
            {p => (
              <Input
                {...p}
                type="number"
                min={1}
                max={365}
                style={{ maxWidth: 120 }}
                value={expiresDays}
                onChange={e => setExpiresDays(Math.min(365, Math.max(1, +e.target.value || 1)))}
              />
            )}
          </Field>

          <div>
            <div className="docform__hd">
              <span className="fld__l">
                Signers<span className="fld__req" aria-hidden="true">*</span>
              </span>
              <Button
                variant="text"
                size="sm"
                onClick={addSigner}
                disabled={signers.length >= MAX_SIGNERS}
              >
                <Plus size={13} aria-hidden="true" /> Add signer
              </Button>
            </div>

            {errors.dupe && <span className="fld__err" role="alert">{errors.dupe}</span>}

            {signers.map((s, i) => (
              <div key={i}>
                <div className="docform__sg">
                  {/* The order number is the whole point of a sequential flow —
                      it was not shown at all, so a three-signer document gave
                      no clue who receives it first. */}
                  <span className="docsg__n" aria-hidden="true">{s.sign_order}</span>
                  <Input
                    value={s.name}
                    onChange={e => updateSigner(i, 'name', e.target.value)}
                    placeholder="Full name"
                    aria-label={`Signer ${s.sign_order} name`}
                  />
                  <Input
                    type="email"
                    value={s.email}
                    onChange={e => updateSigner(i, 'email', e.target.value)}
                    placeholder="Email"
                    aria-label={`Signer ${s.sign_order} email`}
                  />
                  <Input
                    type="tel"
                    value={s.phone}
                    onChange={e => updateSigner(i, 'phone', e.target.value)}
                    placeholder="Phone (optional)"
                    aria-label={`Signer ${s.sign_order} phone`}
                  />
                  {signers.length > 1 ? (
                    <button
                      type="button"
                      className="docdz__x"
                      aria-label={`Remove signer ${s.sign_order}`}
                      onClick={() => removeSigner(i)}
                    >
                      <X size={14} />
                    </button>
                  ) : <span />}
                </div>
                {errors[`s${i}`] && (
                  <span className="fld__err" role="alert">{errors[`s${i}`]}</span>
                )}
              </div>
            ))}
          </div>

          <div className="docdet__acts">
            <Button variant="fill" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Creating…' : 'Create document'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
