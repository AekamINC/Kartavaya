/**
 * The four words a network card is allowed to say, and the sentence under each.
 *
 * ── WHY THIS IS A FILE AND NOT FOUR TERNARIES IN A CARD ──────────────────────
 *
 * The state itself is decided on the SERVER (`hub_connectors.card_state`), for
 * the reason the whole page exists: the old card said `NOT SET` / `ON`, where
 * `ON` meant a saved app id and a pasted secret. Measured live on 2026-08-21,
 * two platforms on this database are exactly that — Instagram and LinkedIn,
 * both saved, both switched on — and `hub_social_accounts` holds zero rows in
 * the entire product. Two green cards, nothing able to post anywhere.
 *
 * So the browser never decides the colour. It receives `state` and renders the
 * words for it, and this file is those words. Keeping them here rather than in
 * the card means the summary line and the accessible label cannot drift, and
 * that a test can read the sentence without mounting anything.
 *
 * ── THE SENTENCE IS THE POINT, NOT THE COLOUR ────────────────────────────────
 *
 * `Live` alone repeats what the colour already said. `3 accounts connected` is
 * the fact somebody opened the page for. `Attention` names WHO to reconnect,
 * because "1 needs attention" without a name sends a person hunting through
 * Sahayak for the one dead token among four.
 */

/** The word on the chip. Order is the ladder, weakest first. */
export const STATE_WORD = {
  not_set: 'Not set',
  ready: 'Ready',
  live: 'Live',
  attention: 'Attention',
};

/** English plural for a count that is only ever small. */
function accounts(n) {
  return n === 1 ? '1 account' : `${n} accounts`;
}

/**
 * A list of names, spoken rather than comma-joined past two.
 * Three dead tokens is already a sentence nobody reads; four is a wall.
 */
function names(list) {
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} more`;
}

/**
 * The line under the network's name. Everything in it comes from the roll-up —
 * never from whether a form has values in it.
 *
 * @param {object} card one entry of `GET /v1/hub/connectors/social-status`
 */
export function stateSentence(card) {
  const a = card?.accounts || {};
  const connected = a.connected || 0;
  const expiredNames = a.expired_names || [];

  if (card?.state === 'attention') {
    // The server sends the names with the count. If it ever sends a count
    // without them, say the count rather than a sentence with `undefined` in
    // it — a broken name list must not turn the one actionable card on the
    // page into gibberish.
    if (!expiredNames.length) {
      return `${accounts(connected)} connected · ${a.expired || 'some'} need reconnecting`;
    }
    return `${accounts(connected)} connected · ${names(expiredNames)} `
         + `${expiredNames.length === 1 ? 'needs' : 'need'} reconnecting`;
  }
  if (card?.state === 'live') {
    return `${accounts(connected)} connected`;
  }
  if (card?.state === 'ready') {
    return 'The app is set. Nobody has connected an account yet.';
  }
  return 'No app saved, so nothing can connect here yet.';
}

/**
 * Whose app would answer a publish on this card, in a sentence.
 *
 * The single most useful line on the page when something posts to the wrong
 * account — and the one thing neither of the two screens this replaces could
 * ever say, because neither of them held both halves.
 */
export function appSentence(card, clientName) {
  const app = card?.app || {};
  if (app.scope === 'client') {
    return `${clientName || 'This client'} uses its own app.`;
  }
  if (app.scope === 'org') return 'Your organisation’s default app answers here.';
  if (app.scope === 'env') return 'A platform default set by Aekam answers here.';
  if (app.saved_but_off) {
    return 'An app is saved but switched off, so nothing will use it.';
  }
  return 'No app is saved for this network.';
}
