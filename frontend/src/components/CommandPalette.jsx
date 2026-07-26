/**
 * CommandPalette.jsx — ⌘K. `20-search-palette.md`.
 *
 * ── What this file used to be ────────────────────────────────────────────
 *
 * A magnifying glass, the placeholder "Type a command or search…", and 30
 * hardcoded routes. Type a client's name, an invoice number or a colleague's
 * name and it answered "No results found" — for data the user had open in
 * another tab. The placeholder was a promise the component could not keep, and
 * "no results" is a stronger claim than "I didn't look".
 *
 * ── What it is now ───────────────────────────────────────────────────────
 *
 * Commands render immediately from `lib/commands.js` and never wait on the
 * network — `⌘K → "new task" → Enter` is a muscle-memory path. Records arrive
 * below them, debounced 180ms, from `GET /api/search`, without reordering what
 * is already on screen: a list that reflows under a moving selection causes
 * wrong activations.
 *
 * ── The endpoint does not exist yet, and this file does not pretend it does ──
 *
 * There is no `/api/search` in `backend/server.py`. Rather than ship a
 * placeholder that lies in the other direction, record search is PROVEN before
 * it is advertised:
 *
 *   unknown → the placeholder reads "Type a command…" and no scope chips show.
 *   live    → one successful response, and the palette starts promising search.
 *   absent  → a 404/501 once per session, and it stops asking and says so.
 *
 * So the component is correct today (commands only, and it says so), correct
 * the day the endpoint lands (search appears with no frontend change), and it
 * never renders "no results" for a query it did not run. `20` calls that
 * distinction out twice and it is the whole reason the state is tri-valued
 * rather than a boolean.
 *
 * The mode is module-scoped, not component state, so a 404 costs one request
 * per page load rather than one per palette open.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fuzzyMatch } from '../lib/fuzzyMatch';
import { SCOPES, ENTITIES, rankCommands, loadRecent, pushRecent } from '../lib/commands';
import { FocusTrap } from './ui';

const ICONS = {
  nav: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>,
  action: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>,
  search: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>,
  record: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 2.5h5L12 6v7.5H4z" /><path d="M9 2.5V6h3" /></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.2" /></svg>,
};

/** 'unknown' until a request proves otherwise. See the header. */
let RECORD_SEARCH = 'unknown';

const IDLE = { status: 'idle', data: null };

function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * `20` §Search hook, hand-rolled because there is no react-query in this
 * project (`package.json` has axios and nothing else in that family).
 *
 * Four details from the spec that are load-bearing:
 *
 * - `q.length >= 2`. One character matches everything and costs a round trip
 *   for nothing.
 * - The previous list stays visible while the next one loads, rather than
 *   flashing empty between keystrokes. That is the difference between search
 *   that feels instant and search that feels broken.
 * - The `signal` is passed so superseded requests abort — without it a slow
 *   response for "ra" can land after "rakesh" and overwrite it.
 * - `noRetry`. `lib/api.js`'s response interceptor treats ANY rejection with no
 *   `response` as retryable, and an aborted axios request is exactly that — so
 *   without this flag every keystroke that supersedes an in-flight query would
 *   be retried three times, at 800/1600/2400ms, against a query the user has
 *   already moved past. Flagged for `api.js`'s owner; opting out is the fix
 *   available from inside this file.
 *
 * There is deliberately NO client-side cache. `20` asks for `staleTime: 60s`,
 * which needs a cache keyed by query — and a module-level cache outlives an org
 * switch, so it would serve one tenant's records to the next. A cache that can
 * cross the org boundary is worse than no cache.
 */
function useRecordSearch(query, scope, open) {
  const q = useDebounced(query.trim(), 180);
  const [state, setState] = useState(IDLE);
  const [mode, setMode] = useState(RECORD_SEARCH);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || RECORD_SEARCH === 'absent' || q.length < 2) {
      setState(IDLE);
      return undefined;
    }
    const ctrl = new AbortController();
    setState((prev) => ({ status: 'loading', data: prev.data, for: prev.for }));

    api.get('/search', { params: { q, scope, limit: 5 }, signal: ctrl.signal, noRetry: true })
      .then((res) => {
        RECORD_SEARCH = 'live';
        setMode('live');
        setState({ status: 'ready', data: res.data || {}, for: q });
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.code === 'ERR_CANCELED') return;
        const code = err?.response?.status;
        // 404/501 is "this build has no search", not "this query failed".
        // Stop asking, and stop advertising it.
        if (code === 404 || code === 501) {
          RECORD_SEARCH = 'absent';
          setMode('absent');
          setState(IDLE);
          return;
        }
        setState({ status: 'failed', data: null, for: q });
      });

    return () => ctrl.abort();
  }, [q, scope, open, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, mode, q, retry };
}

export default function CommandPalette({ open, onClose, onNewTask }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Set by the keyboard, cleared by real pointer movement. Without it a
  // stationary cursor sitting over a row steals the selection back on every
  // re-render, so arrowing past it is impossible.
  const keyboardNav = useRef(false);
  const navigate = useNavigate();

  const search = useRecordSearch(query, scope, open);
  const showScopes = search.mode === 'live';

  const commands = useMemo(() => rankCommands(query, fuzzyMatch), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setScope('all');
    setActiveIdx(0);
    setRecent(loadRecent());
    // No setTimeout focus call: FocusTrap takes `initialFocus` and focuses the
    // input during its own mount effect, with `preventScroll`. Two focus calls
    // racing on one element is how a palette ends up stealing focus back from
    // whatever the first one triggered.
  }, [open]);

  useEffect(() => { setActiveIdx(0); }, [query, scope]);

  /**
   * One flat list of selectable rows, plus the section headers between them.
   * The flat index is what ArrowDown moves and what `aria-activedescendant`
   * points at, so it must be built in exactly render order — a second traversal
   * that drifts from the first is how a palette activates the wrong row.
   */
  const { sections, rows } = useMemo(() => {
    const out = [];
    const flat = [];
    const push = (title, meta, items) => {
      if (!items.length) return;
      const withIdx = items.map((r) => {
        const idx = flat.length;
        flat.push(r);
        return { ...r, idx };
      });
      out.push({ title, meta, items: withIdx });
    };

    const isBlank = !query.trim();
    const recentIds = new Set(isBlank ? recent.map((c) => c.id) : []);

    if (isBlank && recent.length) {
      push('Recent', null, recent.map((c) => ({ key: `recent-${c.id}`, kind: 'recent', item: c })));
    }

    for (const title of ['Actions', 'Navigate']) {
      push(
        title,
        null,
        commands
          .filter((c) => c.section === title && !recentIds.has(c.id))
          .map((c) => ({ key: `cmd-${c.id}`, kind: 'command', item: c })),
      );
    }

    // `search.data`, not `search.status === 'ready'`. The previous list stays
    // on screen while the next one loads rather than flashing empty between
    // keystrokes — that is `placeholderData: prev => prev` in `20`'s hook, and
    // it is the difference between search that feels instant and search that
    // feels broken. The spinner in the input says a newer answer is coming.
    if (search.data) {
      const counts = search.data.counts || {};
      for (const ent of ENTITIES) {
        if (scope !== 'all' && scope !== ent.key) continue;
        const hits = Array.isArray(search.data[ent.key]) ? search.data[ent.key] : [];
        const total = Number.isFinite(counts[ent.key]) ? counts[ent.key] : hits.length;
        push(
          ent.label,
          // `20` wants "See all 23 →". There is no search-results page to send
          // them to, and a link to nowhere is the defect this handover keeps
          // finding — so the count is stated, not offered as an affordance.
          total > hits.length ? `${hits.length} of ${total}` : null,
          hits.map((r) => ({ key: `${ent.key}-${r.id}`, kind: 'record', entity: ent, item: r })),
        );
      }
    }

    return { sections: out, rows: flat };
  }, [commands, recent, query, scope, search.status, search.data]);

  useEffect(() => {
    setActiveIdx((i) => (rows.length ? Math.min(i, rows.length - 1) : 0));
  }, [rows.length]);

  const execute = useCallback((row) => {
    if (!row) return;
    onClose();
    if (row.kind === 'record') {
      navigate(row.item.route || row.entity.route);
      return;
    }
    pushRecent(row.item.id);
    if (row.item.action === 'newTask') onNewTask?.();
    else if (row.item.route) navigate(row.item.route);
  }, [navigate, onClose, onNewTask]);

  const cycleScope = useCallback((dir) => {
    setScope((cur) => {
      const i = SCOPES.findIndex((s) => s.id === cur);
      return SCOPES[(i + dir + SCOPES.length) % SCOPES.length].id;
    });
  }, []);

  const onKeyDown = useCallback((e) => {
    // Arrows only. Home/End are NOT bound: this is a text input, and stealing
    // them to jump the list costs the user the two keys that move the caret to
    // the ends of a query they are still editing.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      keyboardNav.current = true;
      const last = Math.max(rows.length - 1, 0);
      if (e.key === 'ArrowDown') setActiveIdx((i) => Math.min(i + 1, last));
      else setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      execute(rows[activeIdx]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    // Tab cycles the scope chips rather than moving focus. stopPropagation
    // keeps FocusTrap — which listens for Tab on the panel — from also wrapping
    // focus on the same keystroke.
    if (e.key === 'Tab' && showScopes) {
      e.preventDefault();
      e.stopPropagation();
      cycleScope(e.shiftKey ? -1 : 1);
    }
  }, [rows, activeIdx, execute, onClose, cycleScope, showScopes]);

  /**
   * scrollIntoView — even with `block: 'nearest'` — can scroll ANCESTOR
   * containers, which is the call that made Sanvaad's scrollback unreadable.
   * The list is a known height with known rows, so scroll it directly and touch
   * nothing outside it.
   */
  useEffect(() => {
    const el = listRef.current;
    const row = el?.querySelector('[data-active="true"]');
    if (!el || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [activeIdx, rows.length]);

  if (!open) return null;

  const q = query.trim();
  const activeId = rows[activeIdx] ? `cmdk-${rows[activeIdx].key}` : undefined;
  const searching = search.status === 'loading';

  /**
   * `20`: the empty states are distinct on purpose. "No results found" for a
   * request that failed is a lie about the data, and so is "no results" for a
   * request that was never made.
   */
  let empty = null;
  if (!rows.length) {
    if (searching) {
      empty = { title: 'Searching…', detail: null };
    } else if (search.status === 'failed') {
      empty = { title: 'Search failed', detail: "Couldn't reach the server. Your commands are still here.", retry: true };
    } else if (q.length >= 2 && search.mode === 'live' && search.status === 'ready') {
      empty = { title: `No matches for “${q}”`, detail: 'No command and no record matches this. Try fewer words.' };
    } else if (q.length >= 2) {
      empty = {
        title: `No command matches “${q}”`,
        detail: search.mode === 'absent'
          ? 'Record search is not available in this workspace yet, so only commands were searched.'
          : 'Only commands were searched.',
      };
    } else if (q) {
      empty = { title: `No command matches “${q}”`, detail: 'Records are searched from two characters.' };
    }
  }

  /* When records cannot be shown, say so WHERE the records would have been —
     below the commands, which the user can still act on. Replacing the whole
     list with an error would take those away over a failure that did not
     affect them. Suppressed once real record rows are on screen; a "Results"
     header sitting under the results it describes is noise. */
  const hasRecords = rows.some((r) => r.kind === 'record');
  const showResultsNote = rows.length > 0 && q.length >= 2 && search.mode !== 'absent' &&
    (search.status === 'failed' || (!hasRecords && (searching || search.status === 'ready')));

  const announce = searching
    ? 'Searching records'
    : search.status === 'failed'
      ? 'Record search failed'
      : `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`;

  return (
    <div
      className="k-cmdk-overlay"
      data-k-palette=""
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <FocusTrap active initialFocus={inputRef}>
        <div className="k-cmdk" role="dialog" aria-modal="true" aria-label="Search and commands">
          <div className="k-cmdk__input-wrap">
            <span className="k-cmdk__icon">{ICONS.search}</span>
            <input
              ref={inputRef}
              className="k-cmdk__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              /* The placeholder only promises search once search has answered
                 once. See the file header. */
              placeholder={search.mode === 'live' ? 'Type a command or search…' : 'Type a command…'}
              spellCheck={false}
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmdk-list"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label="Search and commands"
            />
            {searching && <span className="k-cmdk__spin" aria-hidden="true" />}
            <kbd className="k-kbd">ESC</kbd>
          </div>

          {showScopes && (
            <div className="k-cmdk__scopes" role="group" aria-label="Search scope">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="k-cmdk__scope"
                  aria-pressed={scope === s.id}
                  /* Out of the Tab order on purpose: Tab cycles them from the
                     input, which keeps one tab stop for the group (26 §5)
                     without spending six keystrokes to cross it. */
                  tabIndex={-1}
                  onClick={() => { setScope(s.id); inputRef.current?.focus(); }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div
            className="k-cmdk__list"
            id="cmdk-list"
            role="listbox"
            aria-label="Commands and results"
            ref={listRef}
            onMouseMove={() => { keyboardNav.current = false; }}
          >
            {empty && (
              <div className="k-cmdk__empty">
                <div className="k-cmdk__empty-t">{empty.title}</div>
                {empty.detail && <div className="k-cmdk__empty-d">{empty.detail}</div>}
                {empty.retry && (
                  <button type="button" className="k-cmdk__retry" onClick={search.retry}>Try again</button>
                )}
              </div>
            )}

            {sections.map((sec) => (
              <React.Fragment key={sec.title}>
                <div className="k-cmdk__section">
                  {sec.title}
                  {sec.meta && <span className="k-cmdk__section-meta">{sec.meta}</span>}
                </div>
                {sec.items.map((row) => (
                  /* role="option" on a DIV, not a button — a button inside a
                     listbox is announced twice. The click handler stays. */
                  <div
                    key={row.key}
                    id={`cmdk-${row.key}`}
                    className="k-cmdk__item"
                    role="option"
                    aria-selected={row.idx === activeIdx}
                    data-active={row.idx === activeIdx}
                    onMouseEnter={() => { if (!keyboardNav.current) setActiveIdx(row.idx); }}
                    onClick={() => execute(row)}
                  >
                    <span className="k-cmdk__icon">
                      {row.kind === 'record' ? ICONS.record
                        : row.kind === 'recent' ? ICONS.clock
                          : row.item.section === 'Actions' ? ICONS.action : ICONS.nav}
                    </span>
                    <span className="k-cmdk__label">
                      {row.kind === 'record' ? row.entity.title(row.item) : row.item.label}
                    </span>
                    {row.kind === 'record'
                      ? (row.entity.meta(row.item) && <span className="k-cmdk__meta">{row.entity.meta(row.item)}</span>)
                      : <span className="k-cmdk__hi" lang="hi">{row.item.hi}</span>}
                    {row.idx === activeIdx && (
                      <span className="k-cmdk__hint"><kbd className="k-kbd">↵</kbd></span>
                    )}
                  </div>
                ))}
              </React.Fragment>
            ))}

            {showResultsNote && (
              <div className="k-cmdk__section">
                Results
                <span className="k-cmdk__section-meta">
                  {searching ? 'Searching…'
                    : search.status === 'failed' ? "Couldn't reach the server"
                      : 'No records match'}
                </span>
                {search.status === 'failed' && (
                  <button type="button" className="k-cmdk__retry" onClick={search.retry}>Try again</button>
                )}
              </div>
            )}
          </div>

          <div className="k-cmdk__foot">
            <span className="k-cmdk__foot-i"><kbd className="k-kbd">↑</kbd><kbd className="k-kbd">↓</kbd>navigate</span>
            <span className="k-cmdk__foot-i"><kbd className="k-kbd">↵</kbd>open</span>
            {showScopes && <span className="k-cmdk__foot-i"><kbd className="k-kbd">tab</kbd>scope</span>}
            <span className="k-cmdk__foot-i"><kbd className="k-kbd">esc</kbd>close</span>
          </div>
        </div>
      </FocusTrap>

      <div className="k-cmdk__live" role="status" aria-live="polite">{announce}</div>
    </div>
  );
}
