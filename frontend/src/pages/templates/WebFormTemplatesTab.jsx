/**
 * WebFormTemplatesTab.jsx — the third tab on `/templates`.
 *
 * Project and task templates both answer "set this up the way it worked last
 * time". A web form is the same question asked about the surface a STRANGER
 * touches, and it is the only one of the three where getting it wrong is
 * visible outside the firm.
 *
 * ── WHY THE JOB-APPLICATION CARD IS THE POINT ──────────────────────────────
 * `destination` has been in the database since migration 251 and dispatched on
 * since the day it shipped, and no screen could set it: `WebFormCreate` had no
 * such field, so every form took the default. Two forms existed on 2026-09-01,
 * both `crm_contact`, 24 submissions between them. This tab is the first thing
 * in the product that can publish a form landing anywhere else.
 *
 * ── WHAT "PUBLISH" DOES ────────────────────────────────────────────────────
 * One POST to the same authenticated endpoint the Web Forms tab uses. No new
 * route, no new table, no privileged path. The row it creates is an ordinary
 * form the firm can then rename, edit or delete — a template is a starting
 * point, and after the click there is no link back to it.
 */
import React, { useState, useEffect } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Card, CardHead, CardBody } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import Button from '../../components/ui/Button';
import { apiErrorText } from '../../lib/apiError';
import useModuleWrite from '../../hooks/useModuleWrite';
import { WEB_FORM_TEMPLATES, DEST_LABELS } from './webFormTemplates';

/** A slug the customer can still read, made unique without a round trip. */
const suffixed = (slug) => `${slug}-${Math.random().toString(36).slice(2, 6)}`;

export default function WebFormTemplatesTab() {
  const { pushToast } = useToast();
  // The CRM module gates web forms; publishing one is an org-admin action and
  // the server checks that again. This only decides whether the button is live.
  const { canWrite, reason: denial } = useModuleWrite({
    module: 'graha', label: 'publish a web form',
  });

  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [opening, setOpening] = useState('');
  const [openings, setOpenings] = useState([]);
  const [openingsErr, setOpeningsErr] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Openings are fetched only when a template actually needs one. A firm
     without the hiring module gets a 403 here, and that is not an error worth
     showing on a tab about contact forms — the card explains the requirement
     and the button stays disabled. */
  const needsOpening = (picked?.needs || []).includes('job_opening_id');
  useEffect(() => {
    if (!needsOpening) return undefined;
    let dead = false;
    api.get('/v1/manav/job-openings?status=open')
      .then((r) => { if (!dead) { setOpenings(asRows(r)); setOpeningsErr(false); } })
      .catch(() => { if (!dead) { setOpenings([]); setOpeningsErr(true); } });
    return () => { dead = true; };
  }, [needsOpening]);

  function choose(t) {
    setPicked(t);
    setName(t.name);
    setSlug(suffixed(t.slug));
    setOpening('');
  }

  async function create() {
    if (!picked) return;
    setBusy(true);
    try {
      const settings = { ...picked.settings };
      if (needsOpening) settings.job_opening_id = opening;
      const r = await api.post('/v1/graha/web-forms', {
        name: name.trim() || picked.name,
        slug: slug.trim(),
        fields: [],
        settings,
        auto_source: picked.auto_source,
        destination: picked.destination,
      });
      const made = r?.data ?? r;
      pushToast({
        type: 'success',
        title: `"${made?.name || name}" published`,
        message: `Live at /f/${made?.slug || slug} — manage it under CRM, Web forms.`,
      });
      setPicked(null);
    } catch (e) {
      pushToast({ type: 'error', title: apiErrorText(e, 'Could not publish this form') });
    } finally {
      setBusy(false);
    }
  }

  const blocked = needsOpening && !opening;

  return (
    <>
      <div className="k-tmpl-grid">
        {WEB_FORM_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`k-tmpl-card${picked?.id === t.id ? ' is-active' : ''}`}
            onClick={() => choose(t)}
            aria-pressed={picked?.id === t.id}
          >
            <div className="k-tmpl-card__kicker">{t.kicker}</div>
            <div className="k-tmpl-card__name">{t.name}</div>
            <div className="k-tmpl-card__desc">{t.summary}</div>
            <div className="tpl-card__meta">{DEST_LABELS[t.destination]}</div>
          </button>
        ))}
      </div>

      {picked && (
        <Card>
          <CardHead title={`Publish "${picked.name}"`} sanskrit={picked.hi} />
          <CardBody>
            <div className="tpl-form">
              <p className="k-tmpl-card__desc">{picked.detail}</p>

              <div className="tpl-grid2">
                <Field label="Heading visitors see" required htmlFor="wf-name">
                  <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field
                  label="Web address"
                  required
                  htmlFor="wf-slug"
                  hint={`Your form will live at /f/${slug || '...'}`}
                >
                  <Input id="wf-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
                </Field>
              </div>

              {needsOpening && (
                <Field
                  label="Which role are people applying for?"
                  required
                  htmlFor="wf-open"
                  hint="Read from the form on every submission, never from what the applicant sends."
                >
                  <Select id="wf-open" value={opening} onChange={(e) => setOpening(e.target.value)}>
                    <option value="">Choose a role...</option>
                    {openings.map((o) => (
                      <option key={o.id} value={o.id}>{o.title}</option>
                    ))}
                  </Select>
                </Field>
              )}

              {/* Two different reasons the list can be empty, and they need
                  different sentences: a firm without the module has nothing to
                  fix on this screen, a firm with no open role does. */}
              {needsOpening && openingsErr && (
                <p className="note note--warn" role="status">
                  This template needs the Hiring module. Everything else on this tab works without it.
                </p>
              )}
              {needsOpening && !openingsErr && openings.length === 0 && (
                <p className="note note--warn" role="status">
                  You have no open roles yet. Open one under Hiring, then come back.
                </p>
              )}

              <div className="wf-acts">
                <Button
                  variant="fill"
                  loading={busy}
                  disabled={!canWrite || !slug.trim() || blocked}
                  title={denial || undefined}
                  onClick={create}
                >
                  Publish form
                </Button>
                <Button variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}
