/**
 * "Post as…?" — the question the product never asked.
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────────
 *
 * The OAuth callback used to take the FIRST thing the network returned — the
 * first Facebook Page, the first Google location, and for LinkedIn the personal
 * feed of whichever partner happened to click Connect — file it under the
 * client, and redirect to a page saying "connected". A firm administering three
 * Pages got one of them, was never asked which, and was never told. The other
 * two could not be added afterwards either: the row's uniqueness key was the
 * consenting PERSON, so a second Page overwrote the first, token and all.
 *
 * ── THE OWNER'S RULE ─────────────────────────────────────────────────────────
 *
 *   "any connectors can do both. depends on org — someone org is sole business
 *    owner who is its own page."
 *   "and also option to have multiple for all connectors ... as a company can
 *    have multiple account across social media."
 *
 * So: ONE picker, EVERY network, MANY destinations. Not "which Page?" — that
 * question presumes a Page. **Post as…?**, listing everything the consent
 * actually returned, with more than one allowed.
 *
 * ── WHY EACH LINE SAYS WHAT IT IS ────────────────────────────────────────────
 *
 * "Aekam Inc" on its own does not tell anybody whether they are about to post
 * to a personal timeline or a company page, and those are different acts with
 * different audiences. The kind comes from the server — it is the only side
 * that saw what the network answered — and is drawn beside the name, never
 * instead of it. There is no id anywhere on this component: a destination is
 * chosen by an opaque positional key and shown by NAME, which is the standing
 * product rule.
 *
 * ── NOTHING IS STORED UNTIL THIS FORM IS SUBMITTED ───────────────────────────
 *
 * The consent is parked server-side — tokens encrypted, thirty-minute expiry,
 * keyed on nothing — and `staging.hub_social_accounts` is not written at all
 * until somebody presses Connect here. Closing this page connects nothing. The
 * browser never receives a token, which is the whole reason the list comes back
 * rather than the account.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errText } from '../hub/_shared';

/** The `?choose=…` handle the OAuth callback hands the browser, if this is
 *  that return leg and it is for THIS network. Read from the URL rather than
 *  held in React state because the round trip through the provider is a full
 *  page load — every scrap of state from before Connect is gone. */
export function pendingChoiceToken(platform, search = window.location.search) {
  const p = new URLSearchParams(search);
  if (p.get('platform') !== platform) return '';
  return p.get('choose') || '';
}

/** True when the network came back with nothing this product can post to. The
 *  callback sends this instead of parking a consent, so that live tokens are
 *  not kept against a choice nobody can make. */
export function cameBackWithNothing(platform, search = window.location.search) {
  const p = new URLSearchParams(search);
  return p.get('platform') === platform && p.get('oauth') === 'nodestination';
}

/**
 * Take the return-leg parameters out of the address bar.
 *
 * DELIBERATELY NOT ON MOUNT. While `?choose=` is in the URL a refresh reopens
 * the picker, and the parked consent is still good for half an hour — so a
 * person who reloads, or lands here on a phone that restored the tab, can still
 * finish. It is cleared when they are done with it: connected and acknowledged,
 * or dismissed. Pressing Connect twice cannot double-connect either way, because
 * the server deletes the consent as it stores the rows.
 */
export function forgetTheReturnLeg() {
  const url = new URL(window.location.href);
  ['choose', 'oauth', 'platform'].forEach(k => url.searchParams.delete(k));
  window.history.replaceState({}, '', url.toString());
}

export default function DestinationPicker({
  platform, label, token, onConnected, onDone,
}) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: '', data: null });
    try {
      const r = await api.get(`/v1/hub/oauth/pending/${token}`);
      setState({ loading: false, error: '', data: r.data });
    } catch (err) {
      setState({ loading: false, error: errText(err, 'That connection has expired.'), data: null });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (done) {
    return (
      <div className="sa__manual" role="status">
        <h5 className="sa__half-t">Connected</h5>
        <ul className="sa__accts">
          {done.accounts.map((a, i) => (
            <li className="sa__acct" key={`${a.account_name}-${i}`}>
              <span className="sa__acct-n">
                {a.account_name}
                <span className="sa__f-where">{a.what}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="sa__hint">
          {done.accounts.length === 1
            ? 'It is a connected account of its own and can be posted to from Sahayak.'
            : `Each of these ${done.accounts.length} is a separate connected account. `
              + 'They can be scheduled and published to independently, or all at once.'}
          {done.clientName ? ` They belong to ${done.clientName}.` : ''}
        </p>
        <div className="sa__acts">
          <button type="button" className="k-btn k-btn--ghost sa__btn"
            onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (state.loading) {
    return <p className="sa__hint">Reading what this {label} consent can post to…</p>;
  }

  if (state.error) {
    return (
      <p className="sa__denied" role="status">
        {state.error} Nothing was saved — connect {label} again and the consent
        screen will take a moment.
      </p>
    );
  }

  const data = state.data || {};
  const destinations = data.destinations || [];

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      // Posted to the client the CONSENT was given for, which is not
      // necessarily the client the page happens to be showing: the round trip
      // through the provider is a full page load and the page falls back to the
      // firm's own client on the way back. The server refuses a mismatch by
      // name, so this can only ever store against the right one.
      const r = await api.post(
        `/v1/hub/clients/${data.client_id || ''}/social-accounts`,
        { choice_token: token, destinations: chosen },
      );
      setDone({
        accounts: r.data?.accounts || [],
        clientName: data.client_name || '',
      });
      // The list above refreshes underneath the confirmation rather than
      // instead of it. Clearing the address bar here would unmount this panel
      // mid-sentence and the person would never see what they just connected.
      await onConnected();
    } catch (err) {
      setState(s => ({ ...s, error: errText(err, 'Could not connect those destinations.') }));
    } finally { setBusy(false); }
  }

  function toggle(key) {
    setChosen(c => (c.includes(key) ? c.filter(k => k !== key) : [...c, key]));
  }

  return (
    <form className="sa__manual" onSubmit={save}>
      <h5 className="sa__half-t">Post as…?</h5>

      <p className="sa__hint">
        {label} came back with {destinations.length === 1
          ? 'one place'
          : `${destinations.length} places`} you can post to
        {data.client_name ? ` for ${data.client_name}` : ''}. Choose as many as
        you want — <strong>each one becomes its own connected account</strong>,
        with its own name in the list above, and can be scheduled and published
        to independently of the others.
      </p>

      {data.note && <p className="sa__denied">{data.note}</p>}

      {destinations.length === 0 ? (
        <p className="sa__none">
          Nothing here can receive a post. Nothing has been saved.
        </p>
      ) : (
        <ul className="sa__accts">
          {destinations.map(d => (
            <li className="sa__acct" key={d.key}>
              <label className="sa__acct-n">
                <input
                  type="checkbox"
                  checked={chosen.includes(d.key)}
                  onChange={() => toggle(d.key)}
                />{' '}
                {d.name}
                <span className="sa__f-where">{d.what}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="sa__acts">
        <button type="submit" className="k-btn k-btn--primary sa__btn"
          disabled={busy || chosen.length === 0}>
          {busy ? 'Connecting…'
            : chosen.length > 1 ? `Connect these ${chosen.length}`
            : 'Connect'}
        </button>
        <button type="button" className="k-btn k-btn--ghost sa__btn"
          disabled={busy}
          onClick={onDone}>
          Not now
        </button>
      </div>

      {/* Said plainly, because a half-finished consent looks identical to a
          finished one from the outside. */}
      <p className="sa__hint">
        Nothing is connected until you press Connect. Leaving this alone stores
        nothing, and the consent is forgotten after half an hour.
      </p>
    </form>
  );
}
