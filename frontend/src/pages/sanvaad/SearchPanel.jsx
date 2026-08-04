/**
 * SearchPanel.jsx — the only way to reach a message that has scrolled away.
 *
 * There was none. `useChannelMessages` holds the newest 50 rows and `loadOlder`
 * walks back one page per press, so a sentence from March was reachable only by
 * pressing "Load older messages" until it appeared — a channel with four
 * thousand messages is eighty round trips deep, and nothing at all was reachable
 * in a channel the reader was not already looking at.
 *
 * THE TRAP THIS FILE MUST NOT FALL INTO is looking like the box above it.
 * `.sv__lsearch` in the rail is a filter over CHANNEL NAMES — it never touched a
 * message body — and two search fields on one screen that search different
 * things and look identical is worse than one. So this is a panel with results,
 * a scope switch and a sender on every row, and the rail's field keeps its
 * narrow "Search channels" label.
 *
 * ── It is a panel OVER the shell, not a fourth grid column
 *
 * `.sv__srch` is `position: absolute; inset: 0 0 0 264px` — it starts at the
 * rail's right edge and covers the chat and the thread column together. The
 * reasoning is stated in `sanvaad.css`'s Search band and it decides this file's
 * markup: the grid is already `264px | 1fr | 330px` at its widest, a fourth
 * track would take the message log below the width a conversation is readable
 * at, and a result is read INSTEAD of the log rather than beside it. The rail
 * stays uncovered on purpose — scoping a search to a channel is only useful if
 * you can still change which channel. So the shell needs no modifier for this
 * panel and `ChannelsTab` adds none.
 *
 * The markup below is the one that band documents, class for class:
 * `.sv__srch-f` (field row) · `.sv__srch-in` · `.sv__srch-l` (scrolling list) ·
 * `.sv__srch-r` (one result) · `.sv__srch-c` (where and when) · `.sv__srch-s`
 * (the body, clamped to three lines) · `.sv__srch-e` (the nothing-found line).
 * A panel whose DOM does not match the stylesheet that was written for it is
 * how a surface ends up with two half-styled layouts.
 *
 * ── Debounced, aborted, and not retried
 *
 * 300ms. The server matches `search_tsv @@ to_tsquery('simple', …)` over a GIN
 * index plus an ILIKE arm; a request per keystroke turns one colleague typing
 * "reconciliation" into fifteen index scans on a service this org already pays
 * too much for. The `AbortController` is what stops a slow answer for "rec"
 * landing on top of the results for "reconciliation" — a superseded response is
 * not merely wasted, it is WRONG, because it overwrites a newer one.
 *
 * `noRetry: true` for the reason `CommandPalette.jsx` records: `lib/api.js`'s
 * response interceptor treats any rejection with no `response` as retryable, and
 * an aborted axios request is exactly that — so without the flag every keystroke
 * that supersedes an in-flight query is retried three times, at 800/1600/2400ms,
 * against a query the reader has already moved past.
 *
 * ── Three states, and they say different things
 *
 * Searching, nothing found, and did-not-run are three different sentences.
 * "No messages found" for a request that 500'd is a claim about the org's
 * history made from a failure, which is the same defect `ChannelList` fixed for
 * the rail. The empty state names the words that were searched for and the
 * scope they were searched in, because "no results" without the query is a
 * dead end — the reader cannot tell whether they mistyped.
 *
 * Results already on screen SURVIVE the next keystroke's request (they are
 * replaced when it answers, not when it starts). A list that empties between
 * keystrokes reads as broken; `CommandPalette` settles this the same way.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, errorKind, Input, SkeletonList } from '../../components/ui';
import { useExitAnimation } from '../../hooks/useExitAnimation';
import { formatTime } from '../../lib/timeFormat';
import { dayLabel } from './messageUtils';
import { channelIcon, SvIcons } from './icons';

/** `q: str = Query(..., min_length=2, max_length=120)` — one character matches
 *  half the org and costs a round trip to prove it. */
const MIN_Q = 2;
const MAX_Q = 120;
/** `limit: int = Query(25, ge=1, le=50)`. */
const PAGE = 25;
/** `offset: int = Query(0, ge=0, le=500)` — past this the server answers 422,
 *  so the control has to disappear before the request can be built. */
const MAX_OFFSET = 500;
const DEBOUNCE_MS = 300;

/** How much body text a row shows, and how much of it sits before the match. */
const SNIPPET = 210;
const LEAD = 48;

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regex for every token in the query, longest first.
 *
 * Longest-first matters for the same reason it does in `splitMentions`: with
 * `nag|nagar` the shorter alternative wins at the same offset and only "nag"
 * is marked inside "nagar", so the highlight looks like a truncation bug.
 *
 * Every alternative is an escaped LITERAL over a fixed alternation — no `.+?`,
 * no lookaround. A 4 000-character message with a 120-character query has to
 * parse in linear time, and the query is user input.
 */
function useMarker(term) {
  return useMemo(() => {
    const toks = [...new Set(String(term || '').toLowerCase().split(/\s+/).filter(Boolean))]
      .filter(t => t.length >= MIN_Q)
      .sort((a, b) => b.length - a.length)
      .map(escapeRe);
    if (!toks.length) return null;
    return new RegExp(toks.join('|'), 'gi');
  }, [term]);
}

/**
 * A window of the body centred on the first match, with every match in it
 * marked.
 *
 * `search()` can return -1 on a row the server legitimately matched: the tsquery
 * arm is `raakesh:* & nag:*`, which matches a message holding both stems in any
 * order and in any word — the literal query string need not appear anywhere in
 * the text. When that happens the window starts at the beginning of the message
 * rather than pretending to point at something; a row with no visible mark is
 * honest, a row cropped around a match that does not exist is not.
 *
 * Whitespace is collapsed first. A message with a fenced code block in it would
 * otherwise contribute a snippet that is mostly newlines.
 */
function snippetParts(content, marker) {
  const body = String(content || '').replace(/\s+/g, ' ').trim();
  if (!marker) {
    return [body.length > SNIPPET ? `${body.slice(0, SNIPPET)}…` : body];
  }

  marker.lastIndex = 0;
  const first = body.search(marker);
  const start = first < 0 ? 0 : Math.max(0, first - LEAD);
  const end = Math.min(body.length, start + SNIPPET);
  const cut = body.slice(start, end);

  const out = [];
  if (start > 0) out.push('…');

  marker.lastIndex = 0;
  let last = 0;
  let m;
  let i = 0;
  while ((m = marker.exec(cut)) !== null) {
    if (m.index > last) out.push(cut.slice(last, m.index));
    // `<mark>`, not a styled span: the highlight is a statement about WHY this
    // row is here, and a screen reader that supports it says so. `.msg__hl`
    // must set its own background — the UA default for `mark` is black on
    // yellow, which is the one raw colour that can reach this surface.
    out.push(<mark key={`h${i}`} className="msg__hl">{m[0]}</mark>);
    i += 1;
    last = m.index + m[0].length;
    // A zero-length match cannot happen with non-empty literal alternatives,
    // but an exec loop that does not guard it hangs the tab if one ever can.
    if (m[0].length === 0) marker.lastIndex += 1;
  }
  if (last < cut.length) out.push(cut.slice(last));
  if (end < body.length) out.push('…');
  return out;
}

/**
 * `#` comes from the icon OR from the server's string, never from both.
 *
 * `GET /search` documents `channel_name` as `"#accounts"` while `GET /channels`
 * returns the bare `name`, and the row already draws `channelIcon(type)` — a
 * hash glyph followed by a literal `#` is the visible half of that disagreement,
 * and `##accounts` is what it looks like. Stripping one leading hash makes the
 * row correct under either shape.
 */
function channelLabel(r) {
  const raw = String(r.channel_name || '').trim().replace(/^#/, '');
  return raw || 'Direct message';
}

function ResultRow({ r, marker, showChannel, onJump }) {
  // Date AND time, not `relTime`. "6d ago" is right in the rail, where a row is
  // one of nine and the question is which conversation moved last; a search
  // result is one moment in a year of history, and "12 Mar 2026, 4:18 PM" is
  // what lets somebody decide whether it is the one they remember. The ISO
  // value stays on `dateTime` for anything reading the markup rather than the
  // label.
  const when = `${dayLabel(r.created_at).en}, ${formatTime(r.created_at)}`;

  return (
    <button type="button" className="sv__srch-r" onClick={() => onJump?.(r)}>
      {/* One line, in the order the reader asks the questions in: where, who,
          when. `.sv__srch-c` is `display: block` and owns the whole line — the
          message log's own `.msg__hd` flex row is deliberately NOT reused here,
          because the stylesheet for this panel was written against this shape
          and a row built out of another band's classes styles itself twice. */}
      <span className="sv__srch-c">
        {showChannel && (
          <>
            <span className="ch__ic" aria-hidden="true">{channelIcon(r.channel_type)}</span>
            {channelLabel(r)}
            {' · '}
          </>
        )}
        {/* `sender_name` comes from a LEFT JOIN on `users`, so a message from a
            since-deleted account arrives with a null name rather than no row at
            all. The message is still real and still findable; only the name is
            gone, and saying "Unknown" is the honest half of that. */}
        {r.sender_name || 'Unknown'}
        {' · '}
        <time dateTime={r.created_at}>{when}</time>
      </span>
      <span className="sv__srch-s">{snippetParts(r.content, marker)}</span>
    </button>
  );
}

export default function SearchPanel({
  open, onClose, channelId = null, channelName = '', onJump,
}) {
  const [q, setQ] = useState('');
  /** The debounced query. Every request and every sentence about "what was
   *  searched for" reads this, never `q` — otherwise the empty state names a
   *  query that has not been run yet. */
  const [term, setTerm] = useState('');
  const [scope, setScope] = useState(channelId ? 'channel' : 'all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Which term the rows on screen belong to, so a stale list is never
   *  described with the new query's words. */
  const [shownFor, setShownFor] = useState('');

  // Opening search from a different channel resets the scope to that channel.
  // Without this, a reader who searched "all" once gets org-wide results for
  // every later search and never notices the switch is still flipped.
  useEffect(() => { setScope(channelId ? 'channel' : 'all'); }, [channelId]);

  const inChannel = scope === 'channel' && channelId ? String(channelId) : null;

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => setTerm(q.trim().slice(0, MAX_Q)), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return undefined;
    if (term.length < MIN_Q) {
      setResults([]);
      setShownFor('');
      setError(null);
      setMore(false);
      setLoading(false);
      return undefined;
    }

    const ctrl = new AbortController();
    setLoading(true);
    api.get('/v1/messaging/search', {
      params: {
        q: term,
        channel_id: inChannel || undefined,
        limit: PAGE,
        offset: 0,
      },
      signal: ctrl.signal,
      noRetry: true,
    })
      .then((r) => {
        const rows = Array.isArray(r.data?.results) ? r.data.results : [];
        setResults(rows);
        setMore(!!r.data?.more);
        setShownFor(term);
        setError(null);
      })
      .catch((e) => {
        // An abort is this component superseding itself, not a failure to
        // report — surfacing it would put an error state on screen every time
        // somebody typed a sixth character.
        if (ctrl.signal.aborted) return;
        setError(e);
        setResults([]);
        setShownFor(term);
        setMore(false);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [open, term, inChannel]);

  /**
   * Offset paging, because the server orders by recency and offsets are what
   * `activity.py` and `whatsapp.py` already speak here. A message posted between
   * two pages shifts the window by one and can hand back a row the list already
   * holds, so the append de-duplicates by id rather than trusting the offset.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || !more || results.length >= MAX_OFFSET) return;
    setLoadingMore(true);
    try {
      const r = await api.get('/v1/messaging/search', {
        params: {
          q: term,
          channel_id: inChannel || undefined,
          limit: PAGE,
          offset: results.length,
        },
        noRetry: true,
      });
      const rows = Array.isArray(r.data?.results) ? r.data.results : [];
      setResults((prev) => {
        const seen = new Set(prev.map(x => String(x.id)));
        return [...prev, ...rows.filter(x => x && !seen.has(String(x.id)))];
      });
      setMore(!!r.data?.more);
    } catch (e) {
      // The page already on screen stays. A failed continuation is not a failed
      // search, and blanking twenty-five good rows to report it would be.
      setError(e);
    } finally {
      setLoadingMore(false);
    }
  }, [inChannel, loadingMore, more, results.length, term]);

  const marker = useMarker(shownFor);

  /**
   * `.sv__srch.is-closing` runs `svSrchOut` and carries `pointer-events: none`,
   * and neither happens if React has already removed the node — the exact defect
   * `useExitAnimation` was written for. It is also what makes the rule honest:
   * `overlay-motion.test.jsx` asserts that every closing overlay in the app is
   * click-through, and a panel that covers the whole message log has to be, or
   * dismissing search and immediately clicking a message hits nothing.
   */
  const { alive, closing, onAnimationEnd } = useExitAnimation(open);
  if (!alive) return null;

  const short = term.length < MIN_Q;
  const scopeLabel = channelName ? `in ${channelName}` : 'in this channel';

  return (
    <aside
      className={`sv__srch${closing ? ' is-closing' : ''}`}
      role="search"
      aria-label="Search messages"
      onAnimationEnd={onAnimationEnd}
      // Escape closes the panel and stops there. The shell above listens for
      // Escape to close the thread; without the stop, one press would close
      // both and the reader would lose the conversation they were reading.
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
      }}
    >
      <div className="sv__srch-f">
        <Input
          className="sv__srch-in"
          type="search"
          value={q}
          maxLength={MAX_Q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search messages"
          aria-label="Search messages"
          autoFocus
        />
        {channelId && (
          // `.sv__ltog` is the rail's own Active/All switch: a small pill that
          // states a scope and shows whether it is on. Reused rather than
          // redrawn — a second toggle style for the same idea is how a surface
          // ends up with two vocabularies.
          <button
            type="button"
            className="sv__ltog"
            aria-pressed={scope === 'channel'}
            onClick={() => setScope(s => (s === 'channel' ? 'all' : 'channel'))}
          >
            Only {scopeLabel}
          </button>
        )}
        <button type="button" className="svbtn" onClick={onClose} aria-label="Close search">
          {SvIcons.close}
        </button>
      </div>

      <div className="sv__srch-l" aria-busy={loading ? 'true' : undefined}>
        {short && (
          <p className="sv__srch-e">
            Type at least two characters. Search reads the channels you can
            already open — public channels in your organisation, and the private
            ones and direct messages you are in.
          </p>
        )}

        {/* The skeleton only stands in for a list that is not there yet. Once
            there are rows, the next query's request runs underneath them and
            replaces them when it answers — see the header. */}
        {!short && loading && results.length === 0 && !error && (
          <SkeletonList rows={5} showAvatar={false} />
        )}

        {!short && error && (
          <ErrorState
            kind={errorKind(error)}
            title={errorKind(error) === 'denied' ? 'Search can’t run here' : undefined}
            /* The server's own sentence wins where it has one. A 403 on this
               module is either an inactive module or a missing grant and only
               the API knows which — the same correction `ChannelList` carries
               for the rail. */
            detail={errorKind(error) === 'offline'
              ? 'Search needs a connection. Nothing has been lost — this reads history, it does not change it.'
              : (error?.response?.data?.detail
                || 'The search did not run. This is a read failure; no message was changed or removed.')}
          />
        )}

        {!short && !error && !loading && results.length === 0 && shownFor && (
          <div className="sv__srch-e">
            <EmptyState
              illustration="search"
              title={{ en: 'No messages found', hi: 'कोई संदेश नहीं मिला' }}
              /* Naming the query is the point. "No results" alone cannot tell
                 the reader whether they mistyped the word or the word is
                 genuinely not there, and the scope is half the answer — a hit
                 in another channel is invisible while the switch is on. */
              description={inChannel
                ? `Nothing matches “${shownFor}” ${scopeLabel}. Turn the switch off to search every channel you can read.`
                : `Nothing matches “${shownFor}” in any channel you can read.`}
            />
          </div>
        )}

        {results.map(r => (
          <ResultRow
            key={r.id}
            r={r}
            marker={marker}
            showChannel={!inChannel}
            onJump={onJump}
          />
        ))}

        {results.length > 0 && more && results.length < MAX_OFFSET && (
          <div className="sv__older">
            <button
              type="button"
              className="btn btn--out btn--sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more results'}
            </button>
          </div>
        )}

        {/* The server refuses an offset past 500 and there is no keyset cursor
            for a recency-ordered set that new messages keep shifting. Saying so
            is better than a button that 422s. */}
        {results.length >= MAX_OFFSET && more && (
          <p className="sv__srch-e">
            Showing the first {MAX_OFFSET} matches. Narrow the search to see more.
          </p>
        )}
      </div>
    </aside>
  );
}
