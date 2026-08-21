/**
 * The APP half of a network card — the id and secret the network issued.
 *
 * ── WHY THIS SITS ON THE SAME CARD AS THE ACCOUNTS ───────────────────────────
 *
 * The owner: "rather than seating two different place connectors on
 * organisation and connect on sahayak we move connectors to same page as
 * well?" — the app was set in Settings → Connectors and the accounts were
 * connected in Sahayak → Publish, and a person who could not connect had no way
 * to tell which of the two halves was missing. Both halves, one card.
 *
 * ── TWO AUDIENCES, ONE CARD, AND THE HARDER HALF IS THE READ-ONLY ONE ────────
 *
 * An app secret can post as the client for as long as it is valid, so writing
 * one stays `require_org_role("org_owner", "org_admin")` and that does not
 * change. But the other reader of this card — a Marketing admin who connects
 * accounts and publishes — very often holds no org role at all, and for them
 * the app is a FACT, not a form: they still have to know whether one is set,
 * because it decides whether their Connect can work.
 *
 * So the panel has two shapes. The form is drawn only for someone who may
 * submit it; everyone else gets the same sentence with no controls and a note
 * saying who to ask. A greyed-out form full of a secret's placeholder would be
 * neither.
 *
 * ── WHAT A SECRET DOES HERE ──────────────────────────────────────────────────
 *
 * Arrives never, leaves once. `public_view()` redacts structurally, so a saved
 * secret renders as an empty box with a four-character hint beside it, and
 * submitting it empty means "leave it alone" rather than "clear it" — clearing
 * is Remove, which is explicit. `draft` therefore holds only what was typed in
 * this session, and only `draft` is submitted: sending the rendered values would
 * send a blank secret back over a saved one.
 *
 * ── THE FIELDS COME FROM THE SERVER ──────────────────────────────────────────
 *
 * Meta says App ID, Google says Client ID, WhatsApp says Phone number ID and
 * has no secret beside it at all. `GET /v1/hub/connectors` returns each
 * platform's fields with the label the network prints and the console path to
 * find it on. A form built here would be a second copy of that table, and the
 * copy that drifts is always the one telling an operator where to click.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button, Input, useToast } from '../../components/ui';
import { errText } from '../hub/_shared';
import { appSentence } from './stateWords';

/**
 * @param {object}  props.card       one roll-up entry (state, app, accounts)
 * @param {object}  props.appCard    the same platform out of `/v1/hub/connectors`,
 *                                   or null when the caller may not read it
 * @param {boolean} props.canEdit    org owner/admin
 * @param {string}  props.denial     the API's own sentence, when they may not
 * @param {string}  props.clientId   the client whose accounts are on screen
 * @param {string}  props.clientName that client's name — never its id
 * @param {boolean} props.isInternal whether that client is the firm itself
 */
export default function AppPanel({
  card, appCard, canEdit, denial, clientId, clientName, isInternal, onSaved,
}) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  /**
   * WHICH LEVEL IS BEING EDITED, and why the internal client cannot choose.
   *
   * A firm publishing for itself is one `hub_clients` row flagged
   * `is_internal`. Giving that row its own app "override" of the organisation's
   * default is a distinction with no difference — same firm, same app, two
   * places to look when it stops working. So the toggle appears only for a real
   * client, which is the case the two levels exist for.
   */
  const [level, setLevel] = useState('org');
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [howOpen, setHowOpen] = useState(false);

  const row = (level === 'client' ? appCard?.client : appCard?.org) || null;
  const fields = row?.fields || [];
  const scopedClient = level === 'client' ? clientId : null;

  const set = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  async function save(activate) {
    setBusy('save');
    try {
      await api.put('/v1/hub/connectors', {
        platform: card.platform,
        client_id: scopedClient,
        values: draft,
        is_active: activate,
      });
      setDraft({});
      pushToast({ title: `${card.label} saved`, type: 'success' });
      await onSaved();
    } catch (err) {
      // The server's sentence, not ours. It is the one that names which field
      // is still empty; a generic "Could not save" throws that away.
      pushToast({ title: errText(err, 'Could not save it.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function test() {
    setBusy('test');
    try {
      const r = await api.post(`/v1/hub/connectors/${card.platform}/test`, null, {
        params: scopedClient ? { client_id: scopedClient } : {},
      });
      pushToast({ title: r.data?.detail || '', type: r.data?.ok ? 'success' : 'error' });
      await onSaved();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not test it.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function remove() {
    setBusy('remove');
    try {
      await api.delete(`/v1/hub/connectors/${card.platform}`, {
        params: scopedClient ? { client_id: scopedClient } : {},
      });
      pushToast({ title: `${card.label} credentials removed`, type: 'success' });
      await onSaved();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not remove it.'), type: 'error' });
    } finally { setBusy(''); }
  }

  return (
    <section className="sa__half">
      <h4 className="sa__half-t">The app</h4>
      <p className="sa__app-line">{appSentence(card, clientName)}</p>

      {/* The long-form guide that already exists, kept reachable from the card
          rather than from the other page. It is written for somebody who has no
          app yet, which is precisely the reader of a `Not set` card. */}
      <Link className="sa__guide" to={`/settings/connectors/guide/${card.platform}`}>
        What {card.label} needs first, and what each error means
      </Link>

      {!canEdit && denial && (
        <p className="sa__denied">{denial}</p>
      )}

      {canEdit && !appCard && (
        <p className="sa__denied">
          The app form did not load, so it cannot be edited here right now.
        </p>
      )}

      {canEdit && appCard && (
        <>
          <button type="button" className="sa__toggle" aria-expanded={open}
            onClick={() => setOpen(o => !o)}>
            {open ? 'Hide the app form'
              : card.app?.configured ? `Edit the ${card.label} app`
              : `Set up the ${card.label} app`}
          </button>

          {open && (
            <div className="sa__form">
              {!isInternal && (
                <div className="sa__level" role="group" aria-label="Which app">
                  <button type="button" className={level === 'org' ? 'on' : undefined}
                    onClick={() => { setLevel('org'); setDraft({}); }}>
                    Your organisation’s default
                  </button>
                  <button type="button" className={level === 'client' ? 'on' : undefined}
                    onClick={() => { setLevel('client'); setDraft({}); }}>
                    {clientName}’s own app
                  </button>
                </div>
              )}

              {/* Copied OUT of this page, not in. Consent fails before it starts
                  if this is not in the network's console first. */}
              {appCard.redirect_url && (
                <div className="sa__redirect">
                  <span className="sa__redirect-l">
                    Paste this into {card.label}’s console first
                  </span>
                  <code>{appCard.redirect_url}</code>
                  <button type="button" onClick={() => {
                    navigator.clipboard?.writeText(appCard.redirect_url);
                    pushToast({ title: 'Redirect URL copied', type: 'success' });
                  }}>Copy</button>
                </div>
              )}

              {/* HOW THE APP IS MADE, above the boxes it fills. Every `where`
                  line below assumes the app already exists, and for a first-time
                  operator that is the whole failure. */}
              {!!appCard.setup_steps?.length && (
                <div className="sa__setup">
                  <button type="button" className="sa__setup-t" aria-expanded={howOpen}
                    onClick={() => setHowOpen(o => !o)}>
                    {howOpen ? 'Hide the steps' : `How to get these from ${card.label}`}
                  </button>
                  {howOpen && (
                    <ol className="sa__setup-l">
                      {appCard.setup_steps.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                  )}
                </div>
              )}

              {fields.map(f => (
                <label className="sa__f" key={f.key}>
                  <span className="sa__f-l">
                    {f.label}
                    {!f.required && <i className="sa__f-opt"> · optional</i>}
                  </span>
                  {/* WHERE IT IS, in the network's own navigation. The
                      difference between a form somebody can fill in and one
                      they guess at. */}
                  <span className="sa__f-where">{f.where}</span>
                  <Input
                    type={f.secret ? 'password' : 'text'}
                    value={draft[f.key] ?? (f.secret ? '' : f.value)}
                    placeholder={f.secret && f.saved
                      ? `saved · ends ${row?.secret_hint || '····'}`
                      : f.placeholder}
                    autoComplete="off"
                    onChange={e => set(f.key, e.target.value)}
                  />
                  {f.secret && f.saved && !draft[f.key] && (
                    <span className="sa__f-kept">
                      Already saved. Leave this empty to keep it.
                    </span>
                  )}
                </label>
              ))}

              <div className="sa__acts">
                <Button onClick={() => save(true)} disabled={!!busy}>
                  {busy === 'save' ? 'Saving…' : 'Save and switch on'}
                </Button>
                <Button variant="ghost" onClick={() => save(false)} disabled={!!busy}>
                  Save without switching on
                </Button>
                <Button variant="ghost" onClick={test} disabled={!!busy}>
                  {busy === 'test' ? 'Testing…' : 'Test connection'}
                </Button>
                {row?.has_secret && (
                  <Button variant="ghost" onClick={remove} disabled={!!busy}>
                    Remove
                  </Button>
                )}
              </div>

              {row?.last_tested_at && (
                <p className={`sa__test sa__test--${row.last_test_ok ? 'ok' : 'bad'}`}
                  role="status">
                  {row.last_test_detail}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
