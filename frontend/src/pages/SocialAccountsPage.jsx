/**
 * Social accounts — one page per network, both halves of it.
 *
 * ── WHAT THE OWNER ASKED FOR ─────────────────────────────────────────────────
 *
 *   "rather than seating two different place connectors on organisation and
 *    connect on sahayak we move connectors to same page as well?"
 *   "create another called social accounts something."
 *   "add all skills onto this related to this"
 *
 * Setting a network up and connecting an account to it happened on two screens
 * that could not see each other. Settings → Connectors held the app id and
 * secret and had never heard of an account; Sahayak → Publish held the accounts
 * and had never heard of an app. So neither screen could answer the only
 * question anybody actually has — *does this network work?* — and the failure
 * mode was a person clicking Connect on a page that could not tell them the app
 * behind it was missing.
 *
 * ── THE FOUR STATES, AND THE LIE THEY REPLACE ────────────────────────────────
 *
 * The Connectors card said `NOT SET` / `ON`. `ON` meant a saved row with
 * `is_active` — an app id and a pasted secret. MEASURED LIVE 2026-08-21 on this
 * database: two rows exist, Instagram and LinkedIn, both saved and both active,
 * and `hub_social_accounts` holds **zero rows in the entire product**. Two green
 * cards; nothing anywhere able to post. A card that goes green for a pasted
 * secret is the same lie in a nicer colour.
 *
 *     Not set    no app. Connect cannot work.
 *     Ready      the app is set and switched on; nobody has connected yet.
 *     Live       accounts are connected, and the card says HOW MANY.
 *     Attention  connected, and a token has expired — named, so nobody has to
 *                go hunting for which of four is dead.
 *
 * The state is computed on the SERVER, by `hub_connectors.card_state`, from
 * counted rows. The browser never decides the colour.
 *
 * ── TWO AUDIENCES ON ONE PAGE ────────────────────────────────────────────────
 *
 * An app secret can post as the client for as long as it is valid, so writing
 * one is org-owner/org-admin work and stays that way. Connecting an account and
 * publishing are marketing work, gated on `sahayak OR prachar` at the admin and
 * editor rungs respectively (`test_social_access_matrix.py`). The two sets of
 * people barely overlap, so every control on this page is drawn from the
 * server's own answer about this caller — `can` and `denials` — and a control
 * that would 403 is not drawn at all. It is replaced by the sentence the
 * refusal would have carried, which names the rung to go and ask for.
 *
 * ── WHAT IT ASKS FOR, AND WHY THAT IS THREE REQUESTS AND NOT ONE ─────────────
 *
 *   1. `/v1/hub/connectors/social-status`  — the spine. App status and account
 *      counts per platform, plus what this caller may do. Everyone reads it.
 *   2. `/v1/hub/connectors`                — only for an org admin, and only
 *      because it carries the FORM: the network's own field labels and the
 *      console path each value is copied from.
 *   3. `/clients/{id}/social-accounts`     — only when the caller may
 *      disconnect. The roll-up returns account NAMES and never ids; Disconnect
 *      needs an id, so it is fetched by the one person entitled to spend it.
 *
 * Three states apiece, never collapsed. A failed fetch must never render as an
 * empty state: "nothing is connected" over a 500 is a false statement about the
 * firm's accounts, and on this page it is the statement somebody acts on.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import { ErrorState } from '../components/ui';
import { api, rows as unwrapRows } from '../lib/api';
import { errText } from './hub/_shared';
import NetworkCard from './social/NetworkCard';
import SkillsStrip from './social/SkillsStrip';

import '../styles/connectors.css';

const BLANK = { loading: true, error: '', data: null };

export default function SocialAccountsPage() {
  /** Whose accounts. Empty string means "whatever the server defaults to" —
   *  the firm's own internal client, which is the common case. */
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState(BLANK);
  const [apps, setApps] = useState({ loading: false, error: '', data: null });
  const [accts, setAccts] = useState({ loading: false, error: '', data: null });

  const loadStatus = useCallback(async () => {
    setStatus(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/v1/hub/connectors/social-status', {
        params: clientId ? { client_id: clientId } : {},
      });
      setStatus({ loading: false, error: '', data: r.data });
    } catch (err) {
      setStatus({ loading: false, error: errText(err), data: null });
    }
  }, [clientId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const data = status.data;
  const can = data?.can || {};
  const denials = data?.denials || {};
  const activeId = data?.client_id || '';
  const active = (data?.clients || []).find(c => c.id === activeId) || null;
  const isInternal = !!active?.is_internal;

  /**
   * The forms, for the people who may submit them.
   *
   * `client_id` is sent only for a REAL client: the listing returns both levels
   * when it is given, and for the firm's own internal client the second level
   * is a distinction with no difference — same firm, same app, two places to
   * look when it breaks.
   */
  const loadApps = useCallback(async () => {
    if (!can.edit_app) { setApps({ loading: false, error: '', data: null }); return; }
    setApps(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/v1/hub/connectors', {
        params: activeId && !isInternal ? { client_id: activeId } : {},
      });
      setApps({ loading: false, error: '', data: r.data?.data || [] });
    } catch (err) {
      setApps({ loading: false, error: errText(err), data: null });
    }
  }, [can.edit_app, activeId, isInternal]);

  useEffect(() => { loadApps(); }, [loadApps]);

  /** The ids Disconnect needs, fetched only by somebody who may disconnect. */
  const loadAccounts = useCallback(async () => {
    if (!can.connect || !activeId) {
      setAccts({ loading: false, error: '', data: null });
      return;
    }
    setAccts(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/hub/clients/${activeId}/social-accounts`);
      setAccts({ loading: false, error: '', data: unwrapRows(r) });
    } catch (err) {
      setAccts({ loading: false, error: errText(err), data: null });
    }
  }, [can.connect, activeId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const reload = useCallback(async () => {
    await Promise.all([loadStatus(), loadApps(), loadAccounts()]);
  }, [loadStatus, loadApps, loadAccounts]);

  if (status.error) {
    return (
      <>
        <PageHeader title="Social accounts" sanskrit="माध्यम" />
        <ErrorState error={status.error} onRetry={loadStatus} />
      </>
    );
  }

  const cards = data?.data || [];
  const clients = data?.clients || [];
  const appByPlatform = Object.fromEntries(
    (apps.data || []).map(c => [c.platform, c]),
  );

  return (
    <>
      <PageHeader
        title="Social accounts"
        sanskrit="माध्यम"
        lede="Every network's app and the accounts connected to it, on one card each."
      />

      {/* WHOSE ACCOUNTS. The firm's own come first and are the default, because
          publishing for yourself is the common case and choosing a client first
          is a step nobody needs on most visits. */}
      {clients.length > 1 && (
        <div className="sa__who" role="group" aria-label="Whose accounts">
          <label className="sa__who-l" htmlFor="sa-client">Whose accounts</label>
          <select id="sa-client" value={activeId}
            onChange={e => setClientId(e.target.value)}>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.is_internal ? `${c.name} — your own accounts` : c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* WHAT THIS PERSON MAY DO, said once at the top rather than implied by
          eleven cards' worth of missing buttons. */}
      {(denials.connect || denials.edit_app) && (
        <p className="sa__note">
          {denials.connect && <>{denials.connect} </>}
          {denials.edit_app && <>{denials.edit_app}</>}
        </p>
      )}

      {apps.error && (
        <p className="sa__note">
          The app forms did not load — {apps.error} The account half below is
          unaffected.
        </p>
      )}
      {accts.error && (
        <p className="sa__note">
          The connected-account list did not load — {accts.error} Counts below
          are still the server&rsquo;s.
        </p>
      )}

      {status.loading ? (
        <p className="sa__note">Loading…</p>
      ) : !activeId ? (
        <p className="sa__note">
          Your organisation has no Sahayak client record yet, so there is
          nowhere to hang an account.{' '}
          <Link to="/hub/org">Open Sahayak once</Link> and it is created for you.
        </p>
      ) : (
        <>
          <div className="sa__grid">
            {cards.map(c => (
              <NetworkCard
                key={c.platform}
                card={c}
                appCard={appByPlatform[c.platform] || null}
                can={can}
                denials={denials}
                clientId={activeId}
                clientName={active?.name || ''}
                isInternal={isInternal}
                /* NULL until the list actually arrives, never `[]`. An empty
                   array is a real answer — "this platform has no accounts" —
                   and handing one over while the request is still in flight
                   would blank the names the roll-up already supplied. Same
                   distinction `enabled.keys` draws in PublishTab, and the same
                   bug in the other direction. */
                accountRows={accts.data
                  ? accts.data.filter(a => a.platform === c.platform)
                  : null}
                onChanged={reload}
              />
            ))}
          </div>

          <SkillsStrip />

          {/* The lead sources and the retired platforms are not social accounts
              and are not drawn here. The page that holds them is named rather
              than left for somebody to rediscover. */}
          <p className="sa__foot">
            Inbound lead sources — JustDial, IndiaMART — are not publishing
            destinations and live on the{' '}
            <Link to="/settings/connectors">Connectors page</Link>, alongside the
            same app credentials shown above.
          </p>
        </>
      )}
    </>
  );
}
