/**
 * WARateCard.jsx — Varta → Pricing. What META charges THIS ORG per message.
 *
 * ── THE ONE THING THIS SCREEN MUST NOT DO ───────────────────────────────────
 *
 * Phase 0.27 seeds `staging.varta_rate_card` with ESTIMATE figures, because
 * Meta's own INR card is only visible inside a Business Manager login. The
 * owner's decision attaches a condition to that: **the estimate must be visibly
 * an estimate wherever it surfaces.** A number a customer plans against, which
 * is actually a guess and does not say so, is worse than no number.
 *
 * So the caveat is carried FOUR ways on this screen, deliberately redundantly,
 * because each one fails differently:
 *
 *   1. A banner above the grid, so it is read before any figure is.
 *   2. An "Estimate" chip in every tile's head — the caveat survives a reader
 *      who scrolls past the banner or lands mid-page.
 *   3. Inside the price string itself. `rate_display` comes off the API
 *      pre-formatted as "₹0.8631 (estimate)", so the caveat cannot be dropped
 *      by a future edit that renders the number and forgets a sibling field.
 *      This screen never formats `rate_per_message` itself — that is the point.
 *   4. The row's own sentence, under the figure, saying what is uncertain
 *      about THAT rate specifically.
 *
 * A tile whose figure was withheld (an estimate the server could not stamp)
 * renders the refusal instead of the number. That path is unreachable while
 * `varta_rate_card_estimate_note_ck` exists; it is rendered anyway because the
 * whole design is that the failure mode is "no number", never "bare number".
 *
 * ── WHOSE MONEY ─────────────────────────────────────────────────────────────
 *
 * Not Kartavaya's. Meta bills the org's own WhatsApp Business Account directly
 * (decision 0.18; P7 — "sell the automation, never the messages"). The billing
 * note is not decoration: a pricing screen inside our product that does not say
 * whose bill this is invites exactly the wrong reading. It comes off the API
 * rather than being written here, so it cannot drift from the row.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  EmptyState, ErrorState, errorKind, SkeletonList, StatusChip,
} from '../../../components/ui';
import { formatDate } from '../../../lib/timeFormat';
import { ChatArt } from '../icons';

/** The host of a citation, so a source reads as a name and not a URL. */
function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * When Meta does not charge. Both facts are per-category and both are the
 * reason anyone reads this screen twice: a utility template inside the service
 * window is free and the same template an hour later is not.
 */
function freeWhen(rate) {
  const when = [];
  if (rate.free_in_service_window) when.push('inside the 24-hour reply window');
  if (rate.free_in_entry_point_window) when.push('inside a 72-hour Click-to-WhatsApp window');
  return when;
}

function RateTile({ rate }) {
  const free = freeWhen(rate);
  return (
    <div className="k-card">
      <div className="k-card__head">
        <div className="k-card__titles">
          <h3 className="k-card__title">{rate.label}</h3>
        </div>
        {/* MECHANISM 2. Not a colour alone — 26 §8: a chip's hue never carries
            meaning by itself, so the word is the label. */}
        {rate.is_estimate
          ? <StatusChip columnName="Estimate" columnColor="var(--warn)" />
          : <StatusChip columnName="Meta rate card" columnColor="var(--ok)" />}
      </div>
      <div className="k-card__body">
        {/* MECHANISM 3. `rate_display` already reads "₹0.8631 (estimate)".
            `rate_per_message` is deliberately NOT rendered here. */}
        <div className="wa__estrate">{rate.rate_display}</div>
        <div className="wa__row-s">
          {rate.rate_per_message === 0
            ? 'no charge from Meta'
            : 'per message delivered'}
        </div>

        {free.length > 0 && (
          <p className="wa__estfree">Free {free.join(', and ')}.</p>
        )}

        {/* MECHANISM 4, or the refusal in its place. */}
        {rate.withheld_reason
          ? <p className="wa__estnote wa__estnote--stop">{rate.withheld_reason}</p>
          : rate.is_estimate && rate.estimate_note
            ? <p className="wa__estnote">{rate.estimate_note}</p>
            : null}

        {rate.org_specific && (
          <p className="wa__estfree">Your organisation&rsquo;s own negotiated rate.</p>
        )}

        <p className="wa__estsrc">
          {/* rel="noreferrer" — the citation is a third-party page and this app
              is behind a login. */}
          Source: <a href={rate.source_url} target="_blank" rel="noreferrer">
            {sourceHost(rate.source_url)}
          </a>
          {rate.source_read_on ? `, read ${formatDate(rate.source_read_on)}` : ''}
        </p>
      </div>
    </div>
  );
}

export default function WARateCard() {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  // Three states, not two. The rest of this module learned the same lesson:
  // a failed fetch rendered as an empty list is a confident statement about
  // pricing that is false and unfalsifiable from the screen.
  const [error, setError] = useState(null);
  const [reloadAt, setReloadAt] = useState(0);
  const retry = useCallback(() => setReloadAt(n => n + 1), []);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setError(null);
    api.get('/v1/whatsapp/rate-card')
      .then(r => { if (!dead) setCard(r.data || null); })
      .catch(e => { if (!dead) { setCard(null); setError(e); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [reloadAt]);

  const rates = card?.rates || [];

  return (
    <div className="m2__col m2r__scroll">
      {loading && <SkeletonList rows={4} showAvatar={false} />}

      {!loading && error && (
        <ErrorState
          kind={errorKind(error)}
          detail="The rate card did not load. No pricing is shown rather than a stale one."
          onRetry={retry}
        />
      )}

      {!loading && !error && rates.length === 0 && (
        <EmptyState
          icon={ChatArt}
          title={{ en: 'No rate card for this country', hi: 'कोई दर सूची नहीं' }}
          description="Meta's per-message pricing has not been recorded for this country yet."
        />
      )}

      {!loading && !error && rates.length > 0 && (
        <>
          {/* MECHANISM 1 — above every figure, so it is read first. */}
          {card.any_estimates && (
            <div className="wa__estbar" role="note">
              <span className="wa__estbar-tag">Estimate</span>
              <div className="wa__estbar-txt">
                <b>
                  {card.all_estimates
                    ? 'Every price below is an estimate.'
                    : `${card.estimate_count} of these prices are estimates.`}
                </b>
                {' '}{card.estimate_note}
                {card.source_read_on && (
                  <span className="wa__estsrc">
                    {' '}Figures last read {formatDate(card.source_read_on)}.
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="wa__estbill">{card.billing_note}</p>

          <div className="wa__grid">
            {rates.map(r => <RateTile key={r.category} rate={r} />)}
          </div>
        </>
      )}
    </div>
  );
}
