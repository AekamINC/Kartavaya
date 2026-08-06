/**
 * useSahayak — one conversation's assistant, and the one place it is asked.
 *
 * `28-messaging-v2.md` §7 gives Sahayak three entry points into Messaging — the
 * catch-up card at the unread divider, the side panel, and `.m2cp__ai` in the
 * composer. All three ask the SAME endpoint, and this hook is what stops them
 * becoming three request paths with three error shapes: `ChatPane` holds one of
 * these and hands the answer to whichever surface is showing it.
 *
 * ── ASKING COSTS A CREDIT, AND THAT CHANGES THE RULES ───────────────────────
 *
 * `POST …/sahayak` charges before the model runs. Two consequences are
 * enforced here rather than left to the caller:
 *
 *  · `busy` gates every ask. A second click while one is in flight is a second
 *    charge for an answer the reader will never see, and a button that looks
 *    idle while a request is out invites exactly that.
 *  · Nothing asks on mount. The catch-up card in the prototype is open on first
 *    paint because a prototype has no wallet; here the reader presses "Catch me
 *    up". An assistant that spends a credit because a channel was opened is a
 *    bill nobody authorised.
 *
 * ── `since` COMES FROM THE CLIENT, DELIBERATELY ─────────────────────────────
 *
 * `useChannelMessages` fires `POST …/read` on channel open, so by the time
 * anybody can press a button `samvada_channel_members.last_read_at` is already
 * NOW() and a server-side "since you last read" would select nothing, every
 * time. The value passed in is the same `lastReadAt` the unread divider is
 * drawn from — captured before the mark-read landed — which is why the card
 * appears at the divider and covers exactly the run under it.
 */
import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { errText } from '../hub/_shared';

/** The closed list, and the words on the buttons.
 *
 *  It is closed on the server too (`ASKS` in `routers/sanvaad_sahayak.py`): a
 *  free-text question over a channel transcript is a different product, because
 *  every message in the window is text somebody else wrote.
 *
 *  TWO OF THE PROTOTYPE'S FOUR ARE NOT HERE, and it is not an oversight.
 *  `Msg2Aside.jsx` lists "Turn this into tasks" and "Draft a reply". The first
 *  is a write into Kaarya with its own permissions and a confirm step — half of
 *  it, a card that proposes and a button that does nothing, is worse than not
 *  offering it. The second cannot carry a citation, and an answer that cannot
 *  point at where it came from is the one thing this surface does not show.
 *  "What is still open?" takes the slot: same shape, same evidence, answerable.
 */
export const SAHAYAK_ASKS = [
  { id: 'catch_up', q: 'Catch me up', d: 'Everything since you last read' },
  { id: 'decided', q: 'What was decided?', d: 'Decisions only, with who said them' },
  { id: 'open', q: 'What is still open?', d: 'Questions asked, and nothing said back' },
];

export const ASK_LABEL = Object.fromEntries(SAHAYAK_ASKS.map(a => [a.id, a.q]));

export default function useSahayak(channelId) {
  const [state, setState] = useState({ asked: null, answer: null, error: '', busy: false });
  // The channel the in-flight request was made for. A reader who switches
  // conversations mid-request must not have the previous room's summary land in
  // the new one — the answer names no channel, so there would be nothing on
  // screen to reveal that it had.
  const forChannel = useRef(channelId);
  /**
   * The re-entry guard is a REF and not the `busy` flag in state, because the
   * flag is only true after React has committed the render that set it. Two
   * clicks inside one frame — a double-click, or a keyboard Enter that repeats
   * — both read the old `false` and both spend a credit. A ref is written
   * synchronously, so the second one loses.
   */
  const inFlight = useRef(false);

  const ask = useCallback(async (id, since) => {
    if (!channelId || !id || inFlight.current) return;
    inFlight.current = true;
    setState({ asked: id, answer: null, error: '', busy: true });

    forChannel.current = channelId;
    try {
      const r = await api.post(`/v1/messaging/channels/${channelId}/sahayak`, {
        ask: id,
        since: since || null,
      });
      if (forChannel.current !== channelId) return;
      setState({ asked: id, answer: r.data || null, error: '', busy: false });
    } catch (err) {
      if (forChannel.current !== channelId) return;
      setState({
        asked: id,
        answer: null,
        // `errText` carries the server's own sentence when there is one, which
        // matters here more than usual: a 402 names what the answer costs and
        // what the org has left, and replacing that with "something went wrong"
        // leaves the reader with no way to learn their wallet is empty.
        error: errText(err, 'Sahayak could not answer just now.'),
        busy: false,
      });
    } finally {
      inFlight.current = false;
    }
  }, [channelId]);

  const clear = useCallback(() => {
    setState({ asked: null, answer: null, error: '', busy: false });
  }, []);

  return { ...state, ask, clear };
}
