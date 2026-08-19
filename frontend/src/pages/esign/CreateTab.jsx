import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Card, CardHead, CardBody, Button, Field, Input, Textarea } from '../../components/ui';
import { FileDropZone } from '../../components/documents';
import Note from '../../components/module/Note';
import FieldPlacer from './FieldPlacer';
import { countPdfPages, toApiFields, placementErrors, dropSigner } from './fieldPlacement';
/* This screen's own cap was 20 MB and the endpoint's is 10 — `_MAX_PDF_BYTES`
   in `backend/routers/esign.py`. A 15 MB scan therefore passed the drop zone,
   uploaded in full, and failed at stage two, which for e-sign is the expensive
   half: the document row is written FIRST, so a refused upload leaves a draft
   at `file_url === 'pending'` that the user then has to find and finish. */
import { MAX_MB_ESIGN_PDF } from '../../lib/uploadLimits';
import '../../styles/esign.css';

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
 *
 * ── FIELD PLACEMENT, AND THE THREE LAYERS THAT DO NOT EXIST YET ────────────
 *
 * The prototype's create screen (`ScreensThin.jsx:391`) is a two-column
 * surface: a page stage with placed signature/initials/date/text/checkbox boxes
 * on the left, signing order and send options on the right. Nothing in this
 * repo placed, stored, transmitted or consumed a field position; this file was
 * a single card of text inputs.
 *
 * The stage and the placement editor are built here. They produce
 * `fields: [{kind, signer_order, page, top, left, width, height}]`, mapped
 * column for column onto `staging.sign_fields` — the table
 * `backend/migrations/114_esign_field_placement.sql` declares. The mapping is
 * written out in `./fieldPlacement.js`.
 *
 * **The other three layers are specified, not written**, because this run may
 * not edit `backend/routers/esign.py`, `backend/services/esign_service.py` or
 * `pages/SigningPage.jsx`, and because 114 is UNAPPLIED — staging and
 * production share one database, so nothing applies a migration automatically.
 * Measured, today: `DocumentCreate` has no `fields` member, `sign_fields` does
 * not exist on the live database, `POST /verify/{token}/sign` accepts
 * `{signature_data, signature_type}` only, and
 * `esign_signed_doc.build_signed_pdf` APPENDS a signature page rather than
 * stamping a coordinate.
 *
 * **So this screen refuses to lie about what it saved.** Pydantic v2 ignores
 * unknown members by default, which means sending `fields` to today's endpoint
 * SUCCEEDS and silently discards them — the worst possible failure, and exactly
 * the "decorative" outcome the brief names. After the create, if any field was
 * placed, the document is read back and the placement is counted. If the server
 * did not keep it, the user is told, in those words, and the document is still
 * created and still sends — identical to today's behaviour. Nothing here can
 * 500 a create that would otherwise have worked: the read-back is wrapped and
 * its failure is treated as "not stored", never as a failed create.
 */
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
  const [fields, setFields] = useState([]);
  const [pageCount, setPageCount] = useState(1);
  const [pageCountKnown, setPageCountKnown] = useState(false);

  /* The page count comes out of the file's own bytes — see `countPdfPages`,
     which is a heuristic and returns 0 rather than guessing. `arrayBuffer` is
     guarded because a File shim in a test environment may not have it, and a
     missing page count must degrade to "one page", never to a crash. */
  useEffect(() => {
    if (!file || typeof file.arrayBuffer !== 'function') {
      setPageCount(1);
      setPageCountKnown(false);
      return undefined;
    }
    let cancelled = false;
    file.arrayBuffer()
      .then((buf) => {
        if (cancelled) return;
        const n = countPdfPages(buf);
        setPageCount(n || 1);
        setPageCountKnown(n > 0);
      })
      .catch(() => {
        if (cancelled) return;
        setPageCount(1);
        setPageCountKnown(false);
      });
    return () => { cancelled = true; };
  }, [file]);

  const addSigner = () => {
    if (signers.length >= MAX_SIGNERS) return;
    setSigners([...signers, blankSigner(signers.length + 1)]);
  };

  const updateSigner = (idx, key, value) => {
    setSigners(prev => prev.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));
  };

  // Re-numbering on removal keeps sign_order dense. A sequential flow with a
  // gap at position 2 is a document the server will wait on forever.
  //
  // And because it renumbers, every placed field must be renumbered with it:
  // a field carrying `signer_order: 2` after signer 1 is deleted now points at
  // a different person than the one it was placed for. `dropSigner` drops the
  // removed signer's own fields and shifts the rest down. Without it the
  // placement silently changes owner — which on a signature box is the worst
  // class of bug this surface can have.
  const removeSigner = (idx) => {
    if (signers.length <= 1) return;
    const order = signers[idx].sign_order;
    setFields(prev => dropSigner(prev, order));
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
    const placement = placementErrors(fields, signers.length);
    if (placement.length) next.fields = placement.join(' ');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /**
   * Did the server keep the placement? Returns true only on positive evidence.
   * Every failure path — a rejected read, a body with no `fields`, a shorter
   * array — answers false, because "I could not tell" and "it was dropped" have
   * the same consequence for the person about to send this document.
   */
  const placementStored = async (docId, sent) => {
    try {
      const r = await api.get(`/v1/esign/documents/${docId}`);
      const got = r.data?.fields ?? r.data?.document?.fields;
      return Array.isArray(got) && got.length >= sent;
    } catch {
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    setProgress(0);

    const placed = toApiFields(fields);
    let docId = null;
    try {
      const r = await api.post('/v1/esign/documents', {
        title: title.trim(),
        description: description.trim(),
        signers: signers.map(s => ({
          name: s.name.trim(), email: s.email.trim(), phone: s.phone.trim(), sign_order: s.sign_order,
        })),
        expires_days: expiresDays,
        // Omitted entirely when nothing was placed, so a document created the
        // way it always was produces a byte-identical request body.
        ...(placed.length ? { fields: placed } : {}),
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

      if (placed.length && !(await placementStored(docId, placed.length))) {
        toast.warning(
          `Document created — but this server does not store field placement yet, so the `
          + `${placed.length} field${placed.length === 1 ? '' : 's'} you positioned were not saved. `
          + 'Signers will sign on the signature page bound in at the end.',
        );
      } else {
        toast.success('Document created. Open it to send for signing.');
      }
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
    <div className="docfp-two">
      <Card>
        <CardHead
          title="New document"
          actions={fields.length
            ? <span className="docfp-pgn">{fields.length} field{fields.length === 1 ? '' : 's'} placed</span>
            : null}
        />
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
              hint={`PDF only, up to ${MAX_MB_ESIGN_PDF} MB.`}
            >
              <FileDropZone
                file={file}
                onFile={(f) => { setFile(f); setErrors(({ file: _drop, ...rest }) => rest); }}
                accept={ACCEPT}
                maxMB={MAX_MB_ESIGN_PDF}
                uploading={saving && !!file}
                progress={progress}
                disabled={saving}
                label="Drop the PDF here, or click to browse"
                hint="This is the file every signer sees and signs."
              />
            </Field>

            {errors.fields && <span className="fld__err" role="alert">{errors.fields}</span>}
          </div>
        </CardBody>

        <FieldPlacer
          fields={fields}
          setFields={setFields}
          signers={signers}
          pageCount={pageCount}
          pageCountKnown={pageCountKnown}
          hasFile={!!file}
          disabled={saving}
        />
      </Card>

      <div className="docfp-col">
        <Card>
          <CardHead
            title="Signing order"
            actions={(
              <Button
                variant="text"
                size="sm"
                onClick={addSigner}
                disabled={signers.length >= MAX_SIGNERS}
              >
                <Plus size={13} aria-hidden="true" /> Add signer
              </Button>
            )}
          />
          <CardBody>
            {errors.dupe && <span className="fld__err" role="alert">{errors.dupe}</span>}

            <div className="docfp-ord">
              {signers.map((s, i) => {
                const mine = fields.filter(f => f.signer_order === s.sign_order).length;
                return (
                  <div className="docfp-ord__r" key={i}>
                    <div className="docfp-ord__rail">
                      {/* The order number is the whole point of a sequential
                          flow — it was not shown at all, so a three-signer
                          document gave no clue who receives it first. */}
                      <span className="docfp-ord__n" aria-hidden="true">{s.sign_order}</span>
                      {i < signers.length - 1 && <span className="docfp-ord__line" />}
                    </div>
                    <div className="docfp-ord__b">
                      <div className="docfp-ord__top">
                        <span className="docfp-ord__cnt">
                          {mine ? `${mine} field${mine === 1 ? '' : 's'}` : 'no fields'}
                        </span>
                        {signers.length > 1 && (
                          <button
                            type="button"
                            className="docdz__x"
                            aria-label={`Remove signer ${s.sign_order}`}
                            onClick={() => removeSigner(i)}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
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
                      {errors[`s${i}`] && (
                        <span className="fld__err" role="alert">{errors[`s${i}`]}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Send" />
          <CardBody>
            <div className="docfp-send">
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

              {/* The prototype's Send card offers four switches: Deliver by
                  WhatsApp/Email/Both, Verify by OTP, Remind every 3 days,
                  Expire after 30 days. THREE OF THEM ARE NOT SWITCHES IN THIS
                  PRODUCT and are shown as the facts they are rather than as
                  controls that do nothing:
                   · Delivery is email. There is no WhatsApp send anywhere in
                     `backend/services` — `outbound_log.py` knows "whatsapp"
                     only as the name of a log channel.
                   · OTP is unconditional: `get_signing_page` computes
                     `otp_required` as `not signer["otp_verified"]`, so there is
                     no per-document opt-out to expose.
                   · Reminders are manual — `DetailTab`'s per-signer "Remind"
                     button calls `/resend/{signer_id}`. Nothing schedules them.
                  A toggle a user can flip that changes nothing is worse than an
                  absent toggle, because they will rely on it. */}
              <div className="docfp-send__row">
                <span>Deliver by</span>
                <span className="docfp-send__v">Email</span>
              </div>
              <div className="docfp-send__row">
                <span>Verify signer by OTP</span>
                <span className="docfp-send__v">Always</span>
              </div>
              <div className="docfp-send__row">
                <span>Reminders</span>
                <span className="docfp-send__v">Sent by hand, per signer</span>
              </div>

              <Note variant="info">
                An OTP-verified signature with the audit trail is accepted under section 10A
                of the IT Act. It is not a digital signature certificate — a few registrars
                still insist on DSC.
              </Note>

              <Button variant="fill" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Creating…' : 'Create document'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
