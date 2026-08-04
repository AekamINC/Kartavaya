/**
 * The url a mention push carries, turned into somewhere this app can go.
 *
 * ── Why this is a separate module from `linking.ts` ───────────────────────────
 *
 * There are two entry points and only one of them is a URL in the sense React
 * Navigation means. `linking.ts` handles the RN form —
 * `kartavaya://sanvaad/<channelId>?message=…` — which arrives through
 * `Linking.getInitialURL()` and is matched against the path config.
 *
 * The mention push does not arrive that way. `send_push` puts the WEB path on
 * the notification's data bag (`data={"url": url}` in
 * `services/samvaad_mentions.py:_push_one`), and `Linking` never sees a data
 * bag. It is a bare string that the tap handler has to read itself, which is
 * why the same feature needs a parser as well as a linking config.
 *
 * The server builds it in `samvaad_mentions._deep_link`:
 *
 *     /sanvaad?channel=<id>&message=<id>[&thread=<root>]
 *
 * ── The parameter is `thread` ─────────────────────────────────────────────────
 *
 * `MENTION_URL_THREAD_PARAM = "thread"` is a named constant on the server with a
 * contract note above it. A client that reads `parent` or `root` instead finds
 * nothing, opens no panel, and lands the reader at the bottom of a channel with
 * nothing highlighted — while the mentions feed shows them the body of the reply
 * they cannot navigate to. `&thread=` appears only when the mentioned message is
 * ITSELF a reply; threads are flat, so `parent_message_id` IS the root and there
 * is no chain to walk.
 */
import { isUuid } from '../api/messages';

export interface SanvaadTarget {
  channelId: string;
  message?:  string;
  thread?:   string;
}

/** The server's `MENTION_URL_THREAD_PARAM`. Named here so a rename over there
 *  has one place to land rather than a string literal buried in a condition. */
const THREAD_PARAM = 'thread';

/** Percent-decoding that cannot take the whole url down with it. A lone `%` in
 *  a value makes `decodeURIComponent` throw a URIError, and a notification that
 *  crashes the tap handler is worse than one that opens the wrong room. */
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/**
 * The query string, if and only if this url addresses `/sanvaad`. `null` for
 * anything else, including a url for another feature.
 *
 * Parsed by hand rather than with `new URL()`: the string the server sends is a
 * bare path with no origin, and `new URL('/sanvaad?…')` throws `Invalid URL`
 * rather than returning null. Hermes has no `URL` constructor at all on older
 * runtimes, which would make the failure a crash rather than a caught throw.
 */
function sanvaadQuery(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;

  const qAt   = raw.indexOf('?');
  const query = qAt === -1 ? '' : raw.slice(qAt + 1);
  let   path  = qAt === -1 ? raw : raw.slice(0, qAt);

  const hashAt = path.indexOf('#');
  if (hashAt !== -1) path = path.slice(0, hashAt);

  // A custom scheme puts the first word in the AUTHORITY slot, not the path:
  // in `kartavaya://sanvaad?channel=…` the word `sanvaad` is the host. So the
  // authority cannot simply be dropped — it is only dropped when there is a
  // path segment behind it, which is the `https://host/sanvaad` shape.
  const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
  const hadAuthority = SCHEME.test(path);
  if (hadAuthority) path = path.replace(SCHEME, '');

  const segments = path.split('/').filter(Boolean);
  if (hadAuthority && segments.length > 1) segments.shift();

  if (segments.length !== 1) return null;
  if (segments[0].toLowerCase() !== 'sanvaad') return null;

  return query;
}

/**
 * Is this url addressed to Sanvaad at all?
 *
 * Exists because `Notification.url` is a SHARED column — approvals, reminders
 * and task notifications all write it (`server.py:565`, `utils.py:169`,
 * `approvals_router.py:145`). The in-app banner therefore has to tell "a url I
 * cannot use" apart from "a url that was never mine", or every tap on a task
 * notification would raise a "Can't open that" alert. The PUSH handler needs no
 * such care: `data.url` is set by exactly one caller in the whole backend, so
 * an unparseable one there really is a product bug and is said out loud.
 */
export function isSanvaadUrl(url: unknown): boolean {
  return sanvaadQuery(url) !== null;
}

/**
 * `data.url` → a Chat target, or null.
 *
 * Every id is uuid-checked before it leaves here, through the same `isUuid` the
 * API layer guards its call sites with — two copies of that regex would be two
 * chances to disagree about what an id is. `channel` failing the check returns
 * null and the caller SAYS SO; `message` or `thread` failing is dropped and the
 * reader still lands in the right room, which is the more useful half.
 */
export function parseSanvaadUrl(url: unknown): SanvaadTarget | null {
  const query = sanvaadQuery(url);
  if (query === null) return null;

  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    const val = eq === -1 ? '' : decode(pair.slice(eq + 1));
    // First wins. A crafted `?channel=<good>&channel=<other>` cannot overwrite
    // the value the server put there.
    if (!(key in params)) params[key] = val;
  }

  if (!isUuid(params.channel)) return null;

  const target: SanvaadTarget = { channelId: params.channel };
  if (isUuid(params.message)) target.message = params.message;
  if (isUuid(params[THREAD_PARAM])) target.thread = params[THREAD_PARAM];
  return target;
}
