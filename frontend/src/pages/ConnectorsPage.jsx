import React, { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../components/editorial';
import { ErrorState, Button, Input, useToast } from '../components/ui';
import { api } from '../lib/api';

import '../styles/connectors.css';

/**
 * ConnectorsPage — every network on one page, each with its own form.
 *
 * ── Why one page and why every card is always drawn ─────────────────────────
 *
 * There was nowhere to put an app id and secret at all. Every connector in
 * `routers/hub_publish.py` read one hard-coded environment variable per network,
 * and none of them is set on staging — so no OAuth flow in the product could
 * complete, and no screen existed to fix that. `hub_social_accounts` holds
 * CONNECTED ACCOUNTS, which is the other end of the flow.
 *
 * Every platform gets a card whether or not anything is saved for it. A screen
 * that only lists what is already configured cannot be used to configure
 * anything, which is the state this replaces.
 *
 * ── The forms are the network's, not ours ───────────────────────────────────
 *
 * The owner rejected a generic "client id / secret" pair explicitly, and the
 * reason is what the person filling this in is actually doing: they have the
 * network's console open in another tab. It does not say "client id" — Meta says
 * App ID under Settings → Basic, Google says Client ID under Credentials,
 * WhatsApp says Phone number ID and has no secret beside it at all.
 *
 * So nothing about a field is decided here. `GET /v1/hub/connectors` returns
 * each platform's fields with the label the network prints and the console path
 * to find it on, and this file renders what it is given. A form built in the
 * frontend would be a second copy of that table, and the copy that drifts is
 * always the one telling an operator where to click.
 *
 * ── What a secret does on this page ─────────────────────────────────────────
 *
 * Arrives never, leaves once. The API returns `has_secret` and the last four
 * characters; a saved secret input renders empty with that hint beside it, and
 * submitting it empty means "leave it alone" rather than "clear it" — clearing
 * is the Remove control, which is explicit. So an operator correcting a typo in
 * an app id never has to go and re-copy a secret they already saved.
 *
 * ── Two levels ─────────────────────────────────────────────────────────────
 *
 * Aekam-level default and a per-client override, which is the owner's decision.
 * The scope switch at the top is the whole difference: with a client selected
 * each card also says which of the two would actually answer a publish, because
 * "whose app is this posting as" is the question this page exists to make
 * answerable.
 */

/** A saved-state word, not a colour. The card's edge carries the colour. */
function statusOf(card, scope) {
  const row = scope === 'client' ? card.client : card.org;
  if (!row || (!row.has_secret && !row.fields.some(f => f.value))) return 'not set';
  if (!row.is_active) return 'saved, off';
  return 'on';
}

function TestResult({ row }) {
  if (!row?.last_tested_at) return null;
  return (
    <p className={`cn__test cn__test--${row.last_test_ok ? 'ok' : 'bad'}`} role="status">
      {row.last_test_detail}
    </p>
  );
}

/**
 * One network. The form is built from `card.fields`, which the server sent.
 *
 * `draft` holds only what has been typed in this session. An untouched field
 * falls back to the saved public value, and an untouched SECRET field stays
 * empty — see the header. That is why the submit sends `draft` and not the
 * whole form: sending the rendered values would send a saved app id back
 * unchanged (harmless) and a blank secret (not harmless).
 */
function ConnectorCard({ card, scope, clientId, onSaved }) {
  const { pushToast } = useToast();
  const row = (scope === 'client' ? card.client : card.org) || card;
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);

  const set = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  const save = async (activate) => {
    setBusy('save');
    try {
      await api.put('/v1/hub/connectors', {
        platform: card.platform,
        client_id: scope === 'client' ? clientId : null,
        values: draft,
        is_active: activate,
      });
      setDraft({});
      pushToast({ title: `${card.label} saved`, type: 'success' });
      await onSaved();
    } catch (e) {
      // The server's sentence, not ours. It is the one that names which field
      // is still empty, and a generic "Could not save" would throw that away.
      pushToast({ title: e?.response?.data?.detail || 'Could not save', type: 'error' });
    } finally { setBusy(''); }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.post(`/v1/hub/connectors/${card.platform}/test`, null, {
        params: scope === 'client' ? { client_id: clientId } : {},
      });
      pushToast({ title: r.data?.detail || '', type: r.data?.ok ? 'success' : 'error' });
      await onSaved();
    } catch (e) {
      pushToast({ title: e?.response?.data?.detail || 'Could not test', type: 'error' });
    } finally { setBusy(''); }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await api.delete(`/v1/hub/connectors/${card.platform}`, {
        params: scope === 'client' ? { client_id: clientId } : {},
      });
      pushToast({ title: `${card.label} credentials removed`, type: 'success' });
      await onSaved();
    } finally { setBusy(''); }
  };

  const status = statusOf(card, scope);

  // JustDial has no redirect URL because it is not OAuth — it has a WEBHOOK
  // url, which is the same idea and is fetched rather than derived: the key in
  // it is minted on first read, so an operator who filled this card in before
  // ingestion existed does not have to re-save it to get one.
  const [hookUrl, setHookUrl] = React.useState('');
  React.useEffect(() => {
    if (card.platform !== 'justdial' || !open) return;
    api.get('/v1/graha/leads/justdial/url')
      .then(r => setHookUrl(r.data?.url || ''))
      .catch(() => setHookUrl(''));
  }, [card.platform, open]);

  return (
    <section className={`cn__card cn__card--${status.replace(/[ ,]+/g, '-')}`}>
      <header className="cn__head">
        <div>
          <h3 className="cn__name">{card.label}</h3>
          <span className="cn__kind">
            {card.kind === 'oauth' ? 'Connects by consent'
              : card.kind === 'token' ? 'Connects by pasted token'
              : 'Inbound leads'}
          </span>
        </div>
        <span className="cn__status" data-status={status}>{status}</span>
      </header>

      {/* Stated before the form, never after. A caution the operator reads
          after filling four fields is a caution that arrived too late. */}
      {card.caution && <p className="cn__caution">{card.caution}</p>}

      <button type="button" className="cn__toggle" aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        {open ? 'Hide the form' : status === 'not set' ? 'Set it up' : 'Edit'}
      </button>

      {open && (
        <div className="cn__body">
          {/* The redirect URL, before the fields. Consent fails before it starts
              if this is not in the network's console, and it is the one value on
              this card that is copied OUT rather than in. */}
          {card.redirect_url && (
            <div className="cn__redirect">
              <span className="cn__redirect-l">Paste this into {card.label}&rsquo;s console first</span>
              <code>{card.redirect_url}</code>
              <button type="button" onClick={() => {
                navigator.clipboard?.writeText(card.redirect_url);
                pushToast({ title: 'Redirect URL copied', type: 'success' });
              }}>Copy</button>
            </div>
          )}

          {hookUrl && (
            <div className="cn__redirect">
              <span className="cn__redirect-l">
                Send this to your JustDial account manager — leads posted here
                arrive in Graha
              </span>
              <code>{hookUrl}</code>
              <button type="button" onClick={() => {
                navigator.clipboard?.writeText(hookUrl);
                pushToast({ title: 'Webhook URL copied', type: 'success' });
              }}>Copy</button>
            </div>
          )}

          {card.fields.map(f => (
            <label className="cn__f" key={f.key}>
              <span className="cn__f-l">
                {f.label}
                {!f.required && <i className="cn__f-opt"> · optional</i>}
              </span>
              {/* WHERE IT IS, in the network's own navigation. This sentence is
                  the difference between a form somebody can fill in and one they
                  guess at. It comes from the server so there is one copy. */}
              <span className="cn__f-where">{f.where}</span>
              {f.help && <span className="cn__f-help">{f.help}</span>}
              <Input
                type={f.secret ? 'password' : 'text'}
                value={draft[f.key] ?? (f.secret ? '' : f.value)}
                placeholder={f.secret && f.saved
                  ? `saved · ends ${row.secret_hint || '····'}`
                  : f.placeholder}
                autoComplete="off"
                onChange={e => set(f.key, e.target.value)}
              />
              {f.secret && f.saved && !draft[f.key] && (
                <span className="cn__f-kept">
                  Already saved. Leave this empty to keep it.
                </span>
              )}
            </label>
          ))}

          {!!card.notes.length && (
            <ul className="cn__notes">
              {card.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}

          <div className="cn__acts">
            <Button onClick={() => save(true)} disabled={!!busy}>
              {busy === 'save' ? 'Saving…' : 'Save and switch on'}
            </Button>
            <Button variant="ghost" onClick={() => save(false)} disabled={!!busy}>
              Save without switching on
            </Button>
            <Button variant="ghost" onClick={test} disabled={!!busy}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </Button>
            {row.has_secret && (
              <Button variant="ghost" onClick={remove} disabled={!!busy}>
                Remove
              </Button>
            )}
            {card.console && (
              <a className="cn__console" href={card.console}
                target="_blank" rel="noopener noreferrer">
                Open {card.label}&rsquo;s console
              </a>
            )}
          </div>

          <TestResult row={row} />

          {/* Whose app a publish would actually use. The single most useful
              sentence on the page when something posts to the wrong account. */}
          {scope === 'client' && (
            <p className="cn__eff">
              {card.effective_scope === 'client'
                ? 'This client uses its own app.'
                : card.effective_scope === 'org'
                ? 'This client falls back to your organisation’s app.'
                : 'Nothing is switched on — this platform cannot connect yet.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function ConnectorsPage() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [scope, setScope] = useState('org');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/v1/hub/connectors', {
        params: scope === 'client' && clientId ? { client_id: clientId } : {},
      });
      setState({ loading: false, error: '', data: r.data });
    } catch (e) {
      setState({
        loading: false,
        error: e?.response?.data?.detail || 'Could not load the connectors.',
        data: null,
      });
    }
  }, [scope, clientId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/v1/hub/clients')
      .then(r => setClients(r.data?.data || r.data || []))
      .catch(() => setClients([]));
  }, []);

  if (state.error) {
    return (
      <>
        <PageHeader title="Connectors" hi="जोड़" />
        <ErrorState error={state.error} onRetry={load} />
      </>
    );
  }

  const cards = state.data?.data || [];
  const publishing = cards.filter(c => c.publishes);
  const inbound = cards.filter(c => !c.publishes);

  return (
    <>
      <PageHeader
        title="Connectors"
        hi="जोड़"
        sub="The app credentials each network needs before anyone can connect an account."
      />

      <div className="cn__scope" role="group" aria-label="Whose credentials">
        <button type="button" className={scope === 'org' ? 'on' : undefined}
          onClick={() => setScope('org')}>
          Your organisation&rsquo;s default
        </button>
        <button type="button" className={scope === 'client' ? 'on' : undefined}
          onClick={() => setScope('client')}>
          One client&rsquo;s own app
        </button>
        {scope === 'client' && (
          <select value={clientId} onChange={e => setClientId(e.target.value)}
            aria-label="Client">
            <option value="">Choose a client…</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {scope === 'client' && !clientId ? (
        <p className="cn__pick">
          Choose a client to give them their own app on any of these networks.
          Anything left unset falls back to your organisation&rsquo;s default.
        </p>
      ) : state.loading ? (
        <p className="cn__pick">Loading…</p>
      ) : (
        <>
          <div className="cn__grid">
            {publishing.map(c => (
              <ConnectorCard key={c.platform} card={c} scope={scope}
                clientId={clientId} onSaved={load} />
            ))}
          </div>

          {!!inbound.length && (
            <>
              <h2 className="cn__h2">Inbound lead sources</h2>
              {/* Said once, here, rather than implied by their position: these
                  are not publish destinations and nothing reads their keys yet.
                  A card that looks like the others and does nothing is worse
                  than one that says what it is. */}
              <p className="cn__sub">
                Credentials are stored so they are in one place. Lead ingestion
                is a separate piece of work — nothing reads these yet.
              </p>
              <div className="cn__grid">
                {inbound.map(c => (
                  <ConnectorCard key={c.platform} card={c} scope={scope}
                    clientId={clientId} onSaved={load} />
                ))}
              </div>
            </>
          )}

          {/* Named, so a platform somebody remembers configuring does not just
              vanish. */}
          {!!state.data?.retired?.length && (
            <p className="cn__retired">
              Removed: {state.data.retired.join(', ')}. TikTok is not available
              in India; the other two could not be connected and were dropped.
            </p>
          )}
          <p className="cn__checked">
            Console locations last checked {state.data?.where_checked}.
          </p>
        </>
      )}
    </>
  );
}
