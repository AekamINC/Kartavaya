/**
 * The ACCOUNTS half of a network card — who is actually connected.
 *
 * ── THE MATRIX DECIDES WHAT IS DRAWN ─────────────────────────────────────────
 *
 * `test_social_access_matrix.py` settles it, and `hub_publish._authority`
 * enforces it:
 *
 *     level      see the accounts   schedule / publish   connect / disconnect
 *     ───────────────────────────────────────────────────────────────────────
 *     viewer            yes                no                    no
 *     editor            yes                YES                   no
 *     approver          yes                YES                   no
 *     admin             yes                YES                   YES
 *
 * A viewer sees the accounts and no buttons. An editor gets the link into the
 * publishing queue and still no Connect. Connect and Disconnect are drawn only
 * for admin. **The page never renders a control that will 403** — that is F32's
 * whole finding, and the direction it fails in is the safe one: an unknown
 * level hides the control rather than offering it.
 *
 * The booleans are the SERVER's (`GET /v1/hub/connectors/social-status` →
 * `can` and `denials`), resolved by the very function the connect route gates
 * on. A second copy of the ladder in JavaScript is how a screen and its API
 * come to disagree.
 *
 * ── WHY THIS COMPONENT ALSO FETCHES THE ACCOUNTS LIST ────────────────────────
 *
 * The roll-up deliberately returns account NAMES and never account ids — the
 * standing product rule, and a payload carrying an id invites a screen that
 * draws it. `DELETE /clients/{id}/social-accounts/{account_id}` needs the id.
 *
 * So the page ALSO reads `/clients/{id}/social-accounts`, and only when the
 * caller may disconnect: the id is fetched by the one person entitled to spend
 * it, and by nobody else. The card's STATE still comes from the roll-up, so
 * what a viewer sees and what an admin sees cannot disagree about whether a
 * network is live.
 *
 * ── CONNECT DOES NOT FINISH HERE. IT FINISHES IN THE PICKER ──────────────────
 *
 * Connect sends the browser out to the provider and the provider sends it back
 * with a consent that has NOT been stored. `DestinationPicker` is the last step:
 * it lists everything that consent can post to — a personal profile, Company
 * Pages, Instagram business accounts, Google Business locations — and the person
 * chooses ONE OR SEVERAL. Only then is anything written.
 *
 * The owner's rule, 2026-08-21: "any connectors can do both. depends on org —
 * someone org is sole business owner who is its own page", and "also option to
 * have multiple for all connectors ... as a company can have multiple account
 * across social media". A sole trader picks themselves; a firm picks its page;
 * an agency picks several, and each becomes a separate connected account.
 */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui';
import { errText, MANUAL_PAGE_FIELD } from '../hub/_shared';
import DestinationPicker, {
  pendingChoiceToken, cameBackWithNothing, forgetTheReturnLeg,
} from './DestinationPicker';

const BLANK_MANUAL = { account_name: '', account_id: '', page_id: '', access_token: '' };

export default function AccountsPanel({
  card, clientId, canConnect, connectDenial, canSend, rows, onChanged,
}) {
  const { pushToast } = useToast();
  const [busy, setBusy] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState(BLANK_MANUAL);
  /**
   * The platform whose CREDENTIALS are missing, and the server's sentence.
   *
   * Distinct from a failed connection: nothing is wrong with the account or the
   * network, there is simply no app registered yet — and on THIS page the fix
   * is the panel directly above, not another screen. That is the whole reason
   * the two halves were brought together.
   */
  const [needsApp, setNeedsApp] = useState('');

  const accounts = card.accounts || {};
  const connected = accounts.connected || 0;
  const expired = new Set(accounts.expired_names || []);
  const oauth = card.kind === 'oauth';

  /**
   * THE RETURN LEG, and why it is read from the URL rather than from state.
   *
   * Connect leaves this application entirely — `window.location.href` to the
   * provider — so the browser that comes back is a fresh page load with no
   * memory of which card was clicked. The callback puts the platform and an
   * opaque, short-lived choice handle in the address bar, and exactly one card
   * recognises them.
   *
   * HELD IN STATE, not read at every render. Connecting reloads the accounts
   * list, and the address bar is cleared when the person is finished with the
   * picker — a value re-read on each render would unmount the picker in the
   * middle of telling them what they just connected.
   */
  const [choiceToken, setChoiceToken] = useState(() => pendingChoiceToken(card.platform));
  const [nothingToPostTo, setNothingToPostTo] =
    useState(() => cameBackWithNothing(card.platform));

  function finishedWithTheReturnLeg() {
    forgetTheReturnLeg();
    setChoiceToken('');
    setNothingToPostTo(false);
  }

  async function connect() {
    setBusy('connect');
    setNeedsApp('');
    try {
      const r = await api.get(`/v1/hub/oauth/${card.platform}/authorize`,
        { params: { client_id: clientId } });
      window.location.href = r.data.auth_url;
    } catch (err) {
      const msg = errText(err, 'This network is not set up to connect yet.');
      if (/credential/i.test(msg)) setNeedsApp(msg);
      else pushToast({ title: msg, type: 'error' });
      setBusy('');
    }
  }

  async function connectManual(e) {
    e.preventDefault();
    setBusy('manual');
    try {
      await api.post(`/v1/hub/clients/${clientId}/social-accounts`,
        { platform: card.platform, ...manual });
      pushToast({ title: 'Account connected', type: 'success' });
      setManual(BLANK_MANUAL);
      setManualOpen(false);
      await onChanged();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not connect the account.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function disconnect(row) {
    setBusy('disconnect');
    try {
      await api.delete(`/v1/hub/clients/${clientId}/social-accounts/${row.id}`);
      pushToast({ title: 'Account disconnected', type: 'success' });
      await onChanged();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not disconnect it.'), type: 'error' });
    } finally { setBusy(''); }
  }

  /**
   * One line per connected account.
   *
   * Named from the roll-up when the caller cannot disconnect, and from the
   * accounts list when they can — the two agree, because the roll-up counts the
   * same rows. Never an id, in either direction.
   */
  const lines = canConnect && rows
    ? rows.map(r => ({
        key: r.id, row: r, name: r.account_name || 'Unnamed account',
        /* WHAT IT IS, beside the name. With several accounts on one network a
           list of names alone cannot say which is the Company Page and which
           is somebody's personal profile, and those are different audiences.
           The sentence is the server's — the browser keeps no second copy of a
           map it cannot keep correct. */
        what: r.what || '',
      }))
    : (accounts.names || []).map((n, i) => ({
        key: `${n}-${i}`, row: null, name: n, what: '',
      }));

  return (
    <section className="sa__half">
      <h4 className="sa__half-t">Connected accounts</h4>

      {connected === 0 ? (
        <p className="sa__none">
          {card.app?.configured
            ? 'Nothing is connected yet. Connect one below.'
            : 'Nothing is connected, and nothing can be until the app above is set.'}
        </p>
      ) : (
        <ul className="sa__accts">
          {lines.map(l => (
            <li className="sa__acct" key={l.key}>
              <span className="sa__acct-n">
                {l.name}
                {l.what && <span className="sa__f-where">{l.what}</span>}
                {expired.has(l.name) && (
                  <span className="sa__acct-x">
                    Token expired — reconnect to keep publishing
                  </span>
                )}
              </span>
              {canConnect && l.row && (
                <button type="button" className="k-btn k-btn--ghost sa__btn"
                  disabled={!!busy} onClick={() => disconnect(l.row)}>
                  Disconnect
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {needsApp && (
        <p className="sa__denied" role="status">
          {needsApp} The app form is on this card, directly above.
        </p>
      )}

      {/* THE CONSENT CAME BACK AND NOTHING IS SAVED YET. The picker is the last
          step of Connect and it is drawn for the person who may connect — the
          same admin rung the OAuth flow was started on. Anyone else seeing this
          URL sees nothing, and the server refuses them by name anyway: a parked
          consent can only be read by the person who started it. */}
      {canConnect && choiceToken && (
        <DestinationPicker
          platform={card.platform}
          label={card.label}
          token={choiceToken}
          onConnected={onChanged}
          onDone={finishedWithTheReturnLeg}
        />
      )}

      {nothingToPostTo && (
        <p className="sa__denied" role="status">
          {card.label} came back with nothing this product can post to, so
          nothing was saved. That usually means the account administers no page,
          location or channel — connecting again will return the same answer
          until it does.
        </p>
      )}

      {canConnect ? (
        <div className="sa__acts">
          {oauth && (
            <button type="button" className="k-btn k-btn--primary sa__btn"
              disabled={!!busy} onClick={connect}>
              {busy === 'connect' ? 'Redirecting…'
                : connected ? `Reconnect ${card.label}`
                : `Connect ${card.label}`}
            </button>
          )}
          <button type="button" className="k-btn k-btn--ghost sa__btn"
            aria-expanded={manualOpen}
            onClick={() => { setManualOpen(o => !o); setManual(BLANK_MANUAL); }}>
            {oauth ? 'Connect with a token instead' : 'Connect with a token'}
          </button>
        </div>
      ) : (
        // NEVER A GREYED CONNECT. The reason is the API's own sentence, which
        // names the rung to ask for rather than saying "forbidden" — the
        // distinction `moduleAccess.js` was written to preserve.
        <p className="sa__denied">{connectDenial}</p>
      )}

      {canConnect && manualOpen && (
        <form className="sa__manual" onSubmit={connectManual}>
          <input className="k-input sa__in" placeholder="Account display name"
            value={manual.account_name}
            onChange={e => setManual({ ...manual, account_name: e.target.value })} />
          <input className="k-input sa__in" placeholder="Account / user ID on the network"
            required value={manual.account_id}
            onChange={e => setManual({ ...manual, account_id: e.target.value })} />
          {MANUAL_PAGE_FIELD[card.platform] && (
            <input className="k-input sa__in" placeholder={MANUAL_PAGE_FIELD[card.platform]}
              value={manual.page_id}
              onChange={e => setManual({ ...manual, page_id: e.target.value })} />
          )}
          <input className="k-input sa__in" type="password" required
            placeholder="Access token" autoComplete="off"
            value={manual.access_token}
            onChange={e => setManual({ ...manual, access_token: e.target.value })} />
          <div className="sa__acts">
            <button type="button" className="k-btn k-btn--ghost sa__btn"
              onClick={() => setManualOpen(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary sa__btn" disabled={!!busy}>
              {busy === 'manual' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      )}

      {/* An editor may SEND but not CONNECT, and that is the rung most people
          on this page hold. Saying so — and pointing at where sending happens —
          is more use than a button they cannot press. */}
      {canSend && !canConnect && connected > 0 && (
        <p className="sa__hint">
          You can schedule and publish to {connected === 1 ? 'this account' : 'these accounts'} from Sahayak.
        </p>
      )}
    </section>
  );
}
