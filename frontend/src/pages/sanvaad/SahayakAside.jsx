/**
 * SahayakAside — `.sh-aside`, the assistant scoped to the open conversation.
 *
 * `28-messaging-v2.md` §7, entry point two: "A side panel (`.sh-aside`), scoped
 * to the open conversation. Scope is stated at the top, because 'summarise this'
 * is a different question in a channel of nine and a customer thread."
 * Transcribed from `Msg2Aside.jsx`.
 *
 * IT IS THE THIRD GRID TRACK, not an overlay. `.m2--rail.m2--aside` is
 * `296px | 1fr | 336px` (sanvaad.css §V2.3) and this component renders the
 * `.m2__col sh-aside` that fills it — so opening the panel narrows the
 * conversation rather than covering it, which is the difference between a
 * reference beside the thing it refers to and a dialog over it. `ChannelsTab`
 * owns the open flag, because the class that makes the track exist is on the
 * grid and the component that fills it is a sibling of `ChatPane`.
 *
 * ── THE SCOPE LINE IS NOT DECORATION ────────────────────────────────────────
 *
 * `.sh-aside__scope` says which conversation is being read and nothing else.
 * It deliberately does NOT narrate the RBAC filter — 29-sahayak.md §2 rule 3 —
 * and it deliberately does not claim the assistant can see records: this
 * endpoint reads the channel's messages and only those, so a line promising
 * "and the records you can already open yourself" (which is what the prototype
 * writes, against a prototype backend) would be a scope no endpoint here
 * guarantees. It says what is true of the request that will actually be made.
 *
 * ── WHAT IT SHOWS WHEN THE ANSWER IS EMPTY ──────────────────────────────────
 *
 * `.sh-none` — "An answer with nothing behind it. Shown instead of a guess."
 * Three different empty results reach it and they are three different
 * sentences, because the reader's next move differs: nothing since you last
 * read, nothing in the channel at all, and "the model answered but every claim
 * it made failed the citation check". The third is the one worth naming out
 * loud; a blank card there would read as a quiet conversation.
 */
import React from 'react';
import SahayakCard from '../../components/sanvaad/SahayakCard';
import { SAHAYAK_ASKS, ASK_LABEL } from './useSahayak';
import { SvIcons } from './icons';
import { Secondary } from '../../components/Bilingual';

/** "3 messages · 2 credits" — `.sh-card__foot`. The two facts a reader needs to
 *  judge an answer they did not watch being produced: how much was read, and
 *  what it cost. */
function foot(answer) {
  const n = Number(answer?.message_count) || 0;
  const c = Number(answer?.credits) || 0;
  const parts = [`${n} message${n === 1 ? '' : 's'} read`];
  if (c > 0) parts.push(`${c} credit${c === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export default function SahayakAside({
  channelName,
  isDm = false,
  /** The whole of `useSahayak`'s return. */
  sahayak,
  since,
  onClose,
  onCite,
}) {
  const { asked, answer, error, busy, ask: run, clear } = sahayak;
  const points = Array.isArray(answer?.points) ? answer.points : [];
  const label = channelName ? (isDm ? channelName : `#${channelName}`) : 'this conversation';
  const hasAsked = !!asked;

  return (
    <div className="m2__col sh-aside">
      <div className="sh-aside__hd">
        <span className="sh-card__ic" aria-hidden="true">{SvIcons.spark}</span>
        {/* 24-bilingual-devanagari.md: the Devanagari half carries `lang` or a
            screen reader announces Hindi with English phonemes. `.sh-aside__t
            span` is the rule that gives it `--font-hindi`. */}
        <span className="sh-aside__t">Sahayak<Secondary  value="सहायक" /></span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="svbtn"
          onClick={onClose}
          aria-label="Close the assistant panel"
        >
          {SvIcons.close}
        </button>
      </div>

      <div className="sh-aside__body">
        <div className="sh-aside__scope">
          <span aria-hidden="true" style={{ display: 'grid' }}>{SvIcons.hash}</span>
          <span>Reading <b>{label}</b> only — the messages in it, and nothing else.</span>
        </div>

        {!hasAsked && (
          <div className="sh-ask">
            {SAHAYAK_ASKS.map(a => (
              <button
                type="button"
                className="sh-ask__q"
                key={a.id}
                disabled={busy}
                onClick={() => run(a.id, since)}
              >
                {SvIcons.spark}
                <span>
                  <b style={{ display: 'block', fontWeight: 600 }}>{a.q}</b>
                  <span style={{ fontSize: 'var(--t-label-sm)', color: 'var(--on-surface-3)' }}>
                    {a.d}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* No second spinner in this product, and none here either — the word
            says what is happening and `aria-live` announces it, which a spinner
            cannot. `sahayak.css` reserves the lotus for the module's own thread
            at 30px; a 336px panel is not that surface. */}
        {busy && (
          <p className="sv__none" role="status">
            Reading {label}…
          </p>
        )}

        {!busy && error && <div className="sh-none"><b>It could not answer</b><p>{error}</p></div>}

        {!busy && !error && hasAsked && points.length > 0 && (
          <SahayakCard
            title={ASK_LABEL[asked] || 'Sahayak'}
            points={points}
            dropped={Number(answer?.dropped) || 0}
            foot={foot(answer)}
            onCite={onCite}
          />
        )}

        {/* THREE EMPTIES, THREE SENTENCES. See the header. */}
        {!busy && !error && hasAsked && points.length === 0 && (
          <div className="sh-none">
            <b>Nothing it could stand behind</b>
            <p>
              {answer?.empty === 'since'
                ? `Nothing has been said in ${label} since you last read it.`
                : answer?.empty === 'channel'
                  ? `There is nothing in ${label} to read yet.`
                  : `It read ${Number(answer?.message_count) || 0} messages and could not
                     point at one for anything it wanted to say, so it is showing you
                     nothing rather than a guess.`}
            </p>
          </div>
        )}

        {/* The prototype's `.sh-none` is a permanent block naming one thing the
            assistant would not answer. Here it is the SERVER's own sentence and
            it is present only when the server wrote one — a standing paragraph
            about a question nobody asked is copy pretending to be evidence. */}
        {!busy && !error && answer?.unanswered && (
          <div className="sh-none">
            <b>One thing it would not answer</b>
            <p>{answer.unanswered}</p>
          </div>
        )}

        {hasAsked && !busy && (
          <button type="button" className="btn btn--out btn--sm" onClick={clear}>
            Ask something else
          </button>
        )}
      </div>
    </div>
  );
}
