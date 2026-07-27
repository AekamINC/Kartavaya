import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import Seg from '../../components/customize/Seg';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind, OfflineBanner } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';

/**
 * The attendance register — 07-pahchan.md §3, "the surface that decides whether
 * this works".
 *
 * Human comparison is the only verification in v1, so the reviewer's throughput
 * IS the feature. §3 names the failure mode precisely: "Twelve punches at three
 * clicks each is thirty-six interactions before anyone has looked at a face, and a
 * reviewer who cannot keep up confirms everything without looking — which is worse
 * than no review, because it manufactures a record of verification that did not
 * happen."
 *
 * Hence: the punch selfie and BOTH references inline on every row at 50×62, and a
 * keyboard path. J/K to move, ↵ to confirm, F to flag, O to open. Mouse-only is
 * one row at a time however dense the layout.
 *
 * THE TWO KEYBOARD TRAPS §3 DOCUMENTS, both reproduced from the prototype:
 *
 * 1. A handler closing over `cursor` reads a stale value for every press in a
 *    burst. Five fast confirms wrote the verdict against the SAME row five times
 *    while the cursor advanced five times — the counter said one row reviewed and
 *    four people were silently skipped, in the queue whose entire purpose is not
 *    skipping anyone. Functional setState does not help: the value read from the
 *    closure is stale, not the state being written. So the cursor lives in a ref
 *    that mutates synchronously and every write goes through seek().
 *
 * 2. The listener is bound only when rows are on screen. Gating inside the
 *    handler is not enough — ↵ during a fetch would record a verdict against a
 *    row nobody can see, and that is exactly when it happens, because someone
 *    mid-burst keeps pressing while the next page loads. No binding means no path.
 */

const PHOTO_W = 50;
const PHOTO_H = 62;

/**
 * How long a face may say "still loading" before it is called a failure.
 *
 * `lib/api.js` creates the axios instance with no `timeout`, so its default is
 * 0 — never. Its response interceptor then RETRIES a network error three times
 * with backoff before rejecting. Between those two facts a request against a
 * socket that accepts and never answers has no terminal state at all: the slot
 * sits at 'load' for as long as the tab is open.
 *
 * That is the failure this screen already had. Three permanent ellipses read as
 * "nearly there", not as "these never arrived", and a reviewer clearing a day
 * confirmed against them — which is the one outcome the register exists to
 * prevent, because it manufactures a record of a verification that did not
 * happen. A loading state that cannot become a failed state is indistinguishable
 * from a slow one, so this one is given a deadline and a word.
 *
 * 12s: past the p99 of a signed-URL round trip on a bad connection, well inside
 * the patience of someone holding J down.
 */
export const PHOTO_DEADLINE_MS = 12000;

/** A slot is 'load' | 'ok' | 'gone' | 'err'. Derived per row, and named: */
export const COMPARE = { PENDING: 'pending', READY: 'ready', BROKEN: 'broken' };

/**
 * The comparison as one word.
 *
 *   pending — at least one image is still in flight. Nothing can be judged yet.
 *   ready   — punch AND both references are on screen. This is the only state
 *             in which confirming means anything.
 *   broken  — something resolved to nothing: retention deleted it, the fetch
 *             failed, the deadline passed. There is a row, but there is no
 *             comparison, and confirming it would be trust with a checkmark on
 *             it — the same thing `noref` already suppresses, arrived at from a
 *             different direction.
 */
function compareStatus(slots) {
  if (slots.some(s => s.st === 'load')) return COMPARE.PENDING;
  if (slots.every(s => s.st === 'ok'))  return COMPARE.READY;
  return COMPARE.BROKEN;
}

/** Which flags mean "a human needs to look at this". */
const NEEDS_LOOK = new Set(['geo', 'accuracy', 'noref', 'mock', 'offline', 'late', 'reuse']);

const FLAG_LABEL = {
  late:     'Late',
  geo:      'Outside site',
  noref:    'No reference pair',
  accuracy: 'Weak GPS',
  offline:  'Synced late',
  overtime: 'Overtime',
  mock:     'Simulated location',
  reuse:    'Photo reused',
};

/** 07 §8: mock location is flagged PROMINENTLY. It is the only flag that implies
 *  intent rather than circumstance, so it reads as danger where the rest read as
 *  circumstance. */
const FLAG_TONE = {
  mock:     'rejected',
  // Like `mock`, this implies intent rather than circumstance: the same
  // photograph on two punches is what §1's camera-only rule exists to prevent.
  reuse:    'rejected',
  noref:    'requested',
  geo:      'requested',
  accuracy: 'in_review',
  offline:  'in_review',
  late:     'requested',
  overtime: 'in_progress',
};

function timeOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * One image slot's whole lifecycle: 'load' | 'ok' | 'gone' | 'err'.
 *
 * A single nullable URL cannot express the difference between "still fetching"
 * and "retention deleted this three weeks ago", and those must not look alike.
 * Nor may 'load' be terminal — see PHOTO_DEADLINE_MS. The deadline is armed
 * here rather than in the caller so that no slot can be added later without one.
 *
 * `path` null means there is nothing to fetch, which is 'gone', not 'load'.
 */
function useSignedPhoto(path) {
  const [s, setS] = useState(() => (path ? { st: 'load' } : { st: 'gone' }));

  useEffect(() => {
    if (!path) { setS({ st: 'gone' }); return undefined; }
    let alive = true;
    setS({ st: 'load' });

    // The clock starts with the request. Cleared by whichever settles first, so
    // a slow-but-successful fetch is not overwritten by its own deadline.
    const deadline = setTimeout(() => { if (alive) setS({ st: 'err' }); }, PHOTO_DEADLINE_MS);
    const settle = (next) => { if (!alive) return; clearTimeout(deadline); setS(next); };

    api.get(path)
      .then(r => settle({ st: 'ok', url: r.data.url }))
      // 404 is the retention case and is not an error: the punch record outlives
      // the photo by law (07 §5/§8), so a missing photo on an old row is expected.
      .catch(err => settle({ st: err?.response?.status === 404 ? 'gone' : 'err' }));

    return () => { alive = false; clearTimeout(deadline); };
  }, [path]);

  return s;
}

/** The slot itself. Loading is the app's skeleton, not an ellipsis. */
function Slot({ s, label, emptyWord }) {
  const failed = s.st === 'err';
  const word = failed ? 'failed to load' : s.st === 'load' ? 'loading' : emptyWord;
  return (
    <div
      className="rv__slot"
      /* Labelled, not live. Three slots per row across twelve rows is
         thirty-six nodes; giving each one `role="status"` would fire
         thirty-six announcements as a page settles and bury the one sentence
         that matters. The verdict cell already carries the row's state as
         text, and it is the thing a reviewer is deciding from. */
      aria-label={s.st === 'ok' ? undefined : `${label} — ${word}`}
      style={{
        width: PHOTO_W, height: PHOTO_H,
        background: s.st === 'ok' ? 'var(--s-low)' : 'var(--s-container)',
        border: `1px solid ${failed ? 'var(--danger)' : 'var(--outline-variant)'}`,
        borderRadius: 'var(--r-sm)',
        overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {s.st === 'ok' ? (
        <img src={s.url} alt={label} width={PHOTO_W} height={PHOTO_H}
             style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
      ) : s.st === 'load' ? (
        // `.ix-skeleton`, not `.k-skeleton`: the sweep is a translated overlay
        // rather than an animated `background-position`, and this is the one
        // place in the app that paints 36 of them at once. Both stop under
        // reduced motion; only this one costs nothing per frame while running.
        // The shape is the loading signal, so it survives the sweep being off.
        <span className="ix-skeleton" aria-hidden="true"
              style={{ width: '100%', height: '100%', borderRadius: 0 }} />
      ) : (
        <span
          style={{
            fontSize: 'var(--t-label-sm)',
            // The state colour from the meaning table, because this is the word
            // that has to stop a reviewer, and it is the only signal that does
            // not move. It must not read as another grey caption.
            color: failed ? 'var(--danger)' : 'var(--on-surface-3)',
            fontWeight: failed ? 600 : 400,
            textAlign: 'center', padding: 2, lineHeight: 1.2,
          }}
        >
          {failed ? 'failed' : emptyWord}
        </span>
      )}
    </div>
  );
}

/**
 * The punch-and-two-references comparison. Genuinely new — §3's "Reuse before you
 * create" table lists `.rv__trip` as one of four things no primitive covers.
 *
 * Keys, not URLs. A signed URL is fetched per image actually rendered, so
 * scrolling past a row never mints a link to that person's face.
 *
 * It reports its resolved state upward, because the row's approve path depends on
 * it: a comparison nobody can see is not a comparison, and confirming against one
 * is the failure this whole screen is built to make impossible.
 */
function Triple({ hasPhoto, referenceIds, punchId, name, onStatus }) {
  // Two APPROVED references are what makes a row verifiable. One is not half a
  // comparison — 07 §0 is explicit that the pair exists because a single frontal
  // photo fails on anyone who turns their head. So a lone reference is not
  // fetched at all: it would be a face on screen next to nothing to match it to.
  const ids = (referenceIds || []).length >= 2 ? referenceIds.slice(0, 2) : [];

  // Three fixed hook calls rather than a state array indexed by a loop. The
  // count IS fixed — one punch, exactly two references — and the array version
  // spliced state by index, which is how a slot could be written after its own
  // unmount. Memoised by path, so a re-render with an equal-but-new
  // `reference_ids` array does not refetch every face on the page — at 12 rows
  // that was 36 signed URLs per keystroke.
  const punch = useSignedPhoto(hasPhoto && punchId ? `/v1/pahchan/punches/${punchId}/photo` : null);
  const ref1  = useSignedPhoto(ids[0] ? `/v1/pahchan/enrollment/photos/${ids[0]}/url` : null);
  const ref2  = useSignedPhoto(ids[1] ? `/v1/pahchan/enrollment/photos/${ids[1]}/url` : null);

  const status = compareStatus([punch, ref1, ref2]);
  useEffect(() => { onStatus(punchId, status); }, [onStatus, punchId, status]);

  return (
    <div className="rv__trip" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <Slot s={punch} label={`Clock-in photo for ${name}`} emptyWord="deleted" />
      {/* A divider, not a gap: the left image is the claim and the right two are
          the evidence, and the reviewer is comparing across that line. */}
      <span aria-hidden="true" style={{ width: 1, height: PHOTO_H - 12, background: 'var(--outline-variant)' }} />
      <Slot s={ref1} label={`Reference 1 for ${name}`} emptyWord="none" />
      <Slot s={ref2} label={`Reference 2 for ${name}`} emptyWord="none" />
    </div>
  );
}

export default function Register() {
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');   // loading | ready | error
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('needs');   // §3: default is "needs a look"
  const [cursor, setCursor] = useState(0);
  const [verdict, setVerdict] = useState({});
  const [openId, setOpenId] = useState(null);

  // Trap 1. The cursor must mutate synchronously; React state alone is read
  // stale by every handler in a burst.
  const curRef = useRef(0);

  // Which rows have a comparison the reviewer can actually see, reported up by
  // each Triple. A ref for the same reason the cursor is one, plus a second: a
  // photo resolving must not rebuild `record`, or the keydown listener is torn
  // down and rebound 36 times while the page loads — and a keypress landing in
  // that window has no handler at all.
  const compareRef = useRef({});
  // The mirror exists only to re-render the verdict cell when a row becomes
  // judgable. Nothing reads it to make a decision.
  const [compare, setCompare] = useState({});
  const onCompareStatus = useCallback((id, st) => {
    if (compareRef.current[id] === st) return;
    compareRef.current = { ...compareRef.current, [id]: st };
    setCompare(compareRef.current);
  }, []);

  // Which KIND of failure, not just that there was one. A reviewer in a basement
  // and a reviewer hitting a 500 need different words and different actions, and
  // `errorKind` already draws that line — it treats a rejection with no response
  // as offline rather than blaming us for the user's train tunnel.
  const [errKind, setErrKind] = useState('server');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/register');
      setRows(r.data.punches || []);
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flaggedCount = useMemo(
    () => rows.filter(p => (p.flags || []).some(f => NEEDS_LOOK.has(f)) && !p.review_verdict).length,
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter(p => (p.flags || []).some(f => NEEDS_LOOK.has(f)) && !p.review_verdict);
  }, [rows, filter]);

  /** Every cursor move goes through here, so the ref and the highlight cannot
   *  drift apart — including row clicks and filter changes. */
  const seek = useCallback((n) => {
    const clamped = Math.max(0, Math.min(n, visible.length - 1));
    curRef.current = clamped;
    setCursor(clamped);
  }, [visible.length]);

  const record = useCallback(async (val) => {
    const row = visible[curRef.current];
    if (!row) return;

    // ── Confirming requires something to have been compared ──────────────────
    //
    // Flagging never does. A reviewer who cannot see the faces still has an
    // opinion worth recording, and refusing F as well would strand the queue on
    // exactly the rows that most need a human — so only 'ok' is gated below.

    // No reference pair means there is nothing to compare against, so confirming
    // is not verification — §3: "it is trust with a checkmark on it". The
    // affordance is suppressed rather than silently doing nothing, so the
    // keyboard path refuses too and says why.
    if (val === 'ok' && (row.flags || []).includes('noref')) {
      pushToast({
        type: 'warning',
        title: 'Nothing to compare against',
        message: `${row.employee_name} has no approved reference photos. Send an enrollment request instead.`,
      });
      return;
    }

    // The photographs themselves. `noref` above is the server's word for an
    // employee with no approved pair; this is the client's word for a pair that
    // exists and is not on screen — a fetch still in flight, a retention
    // deletion, a signing endpoint that stopped answering. The reviewer sees the
    // same three rectangles either way, and ↵ against three rectangles is how a
    // day gets cleared without anyone looking at a face.
    if (val === 'ok') {
      const cmp = compareRef.current[row.id];
      if (cmp !== COMPARE.READY) {
        pushToast(cmp === COMPARE.BROKEN
          ? {
            type: 'warning',
            title: 'The photos did not load — nothing to compare',
            message: `${row.employee_name}'s comparison is incomplete, so confirming would record a check that did not happen. Reload, or flag the row.`,
          }
          : {
            type: 'info',
            title: 'Still loading the photos',
            message: `Wait for ${row.employee_name}'s three photos before confirming.`,
          });
        // Deliberately no seek(): the cursor stays on the row so the next ↵ lands
        // here once the faces arrive. Advancing would walk a burst straight past
        // the people whose photos are slowest, which is the same silent skip the
        // cursor ref exists to prevent.
        return;
      }
    }

    setVerdict(v => ({ ...v, [row.id]: val }));
    seek(curRef.current + 1);
    try {
      await api.patch(`/v1/pahchan/punches/${row.id}/review`, { verdict: val });
      setRows(rs => rs.map(p => (p.id === row.id ? { ...p, review_verdict: val } : p)));
    } catch (err) {
      // Roll the optimistic mark back. A verdict that failed to save must not
      // look recorded — this queue's whole value is that it is accurate.
      setVerdict(v => { const next = { ...v }; delete next[row.id]; return next; });
      // Offline is the likely case mid-burst and it needs different words: there
      // is nothing to try again until the connection returns, and a reviewer who
      // keeps pressing ↵ through a dead network is advancing the cursor past
      // people whose verdicts are not being saved.
      pushToast(
        errorKind(err) === 'offline'
          ? {
            type: 'warning',
            title: 'You are offline — that verdict was not saved',
            message: 'Stop here. Verdicts need a connection, and the rows you pass while offline stay unreviewed.',
          }
          : { type: 'error', title: 'Could not save that verdict', message: 'Try again.' },
      );
    }
  }, [visible, seek, pushToast]);

  // Trap 2. Bound only while rows are on screen, so there is no path by which a
  // keypress during a fetch can write against a row the reviewer cannot see.
  useEffect(() => {
    if (state !== 'ready' || !visible.length) return undefined;

    const onKey = (e) => {
      // Never steal a key from a field. A reviewer typing a decline reason must
      // not have F flag the row underneath.
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowDown')      { e.preventDefault(); seek(curRef.current + 1); }
      else if (k === 'k' || e.key === 'ArrowUp')   { e.preventDefault(); seek(curRef.current - 1); }
      else if (e.key === 'Enter')                  { e.preventDefault(); record('ok'); }
      else if (k === 'f')                          { e.preventDefault(); record('flagged'); }
      else if (k === 'o')                          {
        e.preventDefault();
        const row = visible[curRef.current];
        if (row) setOpenId(id => (id === row.id ? null : row.id));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, visible, seek, record]);

  // A filter change re-slices the list, so the ref has to be brought back in
  // range or the next keypress writes against the wrong row.
  useEffect(() => { seek(0); }, [filter, seek]);

  const hasTable = state === 'loading' || (state === 'ready' && visible.length > 0);

  return (
    <Section
      title="Register"
      hi="उपस्थिति पंजी"
      right={
        <Seg
          label="Which punches to show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'needs', label: 'Needs a look', count: flaggedCount },
            { value: 'all',   label: 'All',          count: rows.length },
          ]}
        />
      }
    >
      {/* Persistent while the connection is down, not just on the failed request
          that revealed it. A reviewer clearing a day needs to know saves are not
          landing BEFORE they burst through twelve rows, not after. */}
      <OfflineBanner />

      {/* §3: the column header labels the table, so it belongs to any state where
          a table is present OR arriving — bound to hasTable, not to ready. Not
          shown for empty or error, where column labels would sit over nothing. */}
      {state === 'loading' && (
        <SkeletonRegion label="Loading the register…">
          {/* `columns`, not `cols`. The prop is `columns` (Skeleton.jsx:75), so
              `cols` was silently dropped and the skeleton fell back to its default
              of 5 for a 6-column table — a column-count jump at exactly the moment
              this state exists to avoid one. */}
          <SkeletonTable rows={6} columns={6} />
        </SkeletonRegion>
      )}

      {state === 'error' && (
        <ErrorState
          // Classified, not hardcoded. A reviewer in a basement was being told
          // "something broke on our side" — which is untrue, unactionable, and
          // sends them to report a bug that is their own signal.
          kind={errKind}
          // `detail`, not `title`/`message`. ErrorState takes neither of those
          // (its signature is kind/grant/detail/onRetry/backTo/backLabel), so
          // §3's exact reassurance was being dropped on the floor and the generic
          // server copy rendered in its place.
          detail={
            errKind === 'offline'
              ? 'The register needs a connection to load. Punches already recorded are safe, and anything queued on a phone will still sync.'
              // §3's exact words. A read failure that reads like data loss sends an
              // HR admin into a panic about attendance records that are perfectly safe.
              : 'Punches are safe — this is a read failure, not data loss.'
          }
          onRetry={load}
        />
      )}

      {state === 'ready' && visible.length === 0 && (
        filter === 'needs' && rows.length > 0
          ? (
            // §3 distinguishes these two empties, and the distinction matters:
            // reaching zero flagged is the GOAL, so it gets --ok and a check
            // rather than the neutral treatment of a day that has not started.
            <EmptyState
              icon="check"
              tone="ok"
              title={{ en: 'Nothing needs a look', hi: 'सब ठीक है' }}
              description="Every punch today cleared the checks."
            />
          )
          : (
            <EmptyState
              icon="clock"
              title={{ en: 'Nobody has clocked in yet', hi: 'अभी कोई नहीं' }}
              description="On a normal weekday the first punches land between 9:00 and 9:40."
            />
          )
      )}

      {state === 'ready' && visible.length > 0 && (
        <>
          <p className="rv__hint" style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '0 0 10px' }}>
            <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>↵</kbd> confirm · <kbd>F</kbd> flag · <kbd>O</kbd> detail
          </p>

          <DataTable
            columns={[
              '', 'Person', 'Compare', 'Time',
              { label: 'Where', className: 'rv__loc' },
              { label: 'Verdict', className: 'rv__v' },
            ]}
          >
            {visible.map((p, i) => {
              const mine = verdict[p.id] || p.review_verdict;
              const noRef = (p.flags || []).includes('noref');
              return (
                <tr
                  key={p.id}
                  className={`rv__r${i === cursor ? ' is-cursor' : ''}`}
                  onClick={() => seek(i)}
                  /* aria-current, not aria-selected. `aria-selected` on a row
                     is only supported inside a grid or treegrid; DataTable
                     renders a plain <table>, where `row` does not support it
                     and the state is dropped silently. J/K move a review
                     cursor rather than building a selection, which is what
                     aria-current means and where it is valid. */
                  aria-current={i === cursor ? 'true' : undefined}
                  style={i === cursor ? { outline: '2px solid var(--primary)', outlineOffset: -2 } : undefined}
                >
                  <Td className="rv__n">{i + 1}</Td>

                  <Td className="rv__who">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5 }}>{p.employee_name}</strong>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(p.flags || []).map(f => (
                          <StatusChip key={f} status={FLAG_TONE[f] || 'todo'} label={FLAG_LABEL[f] || f} />
                        ))}
                      </div>
                    </div>
                  </Td>

                  <Td className="rv__trip-cell">
                    <Triple
                      punchId={p.id}
                      hasPhoto={p.has_photo}
                      referenceIds={p.reference_ids}
                      name={p.employee_name}
                      onStatus={onCompareStatus}
                    />
                  </Td>

                  <Td className="rv__t">
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeOf(p.captured_at)}</span>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                        {p.direction === 'in' ? 'in' : 'out'}
                      </span>
                    </div>
                  </Td>

                  <Td className="rv__loc">
                    {p.site_name || '—'}
                    {p.accuracy_m != null && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--on-surface-3)' }}>
                        ±{Math.round(p.accuracy_m)}m
                      </span>
                    )}
                  </Td>

                  <Td className="rv__v">
                    {mine
                      /* `key` on the flash wrapper, so the one-shot RESTARTS when
                         the verdict changes rather than being a class that is
                         already on the node and never fires again. The flash is
                         the polish; the chip swapping from a dash to "Confirmed"
                         is the signal, and that difference is static — under
                         `prefers-reduced-motion` --dur-slow collapses to ~0.5ms
                         and the animation is gone, which must not take the
                         confirmation with it. */
                      ? (
                        <span key={mine} className="ix-flash" style={{ display: 'inline-block', borderRadius: 'var(--r-pill)' }}>
                          <StatusChip status={mine === 'ok' ? 'done' : 'rejected'}
                                      label={mine === 'ok' ? 'Confirmed' : 'Flagged'} />
                        </span>
                      )
                      : noRef
                        // §3: no reference pair suppresses the confirm affordance
                        // and offers enrollment instead. Confirming here would be
                        // trust with a checkmark on it.
                        ? <button className="btn btn--ghost" style={{ fontSize: 11 }}
                            onClick={(e) => { e.stopPropagation(); pushToast({
                              type: 'info',
                              title: 'Enrollment request',
                              message: `${p.employee_name} needs two reference photos before their punches can be verified.`,
                            }); }}>
                            Send enrollment request
                          </button>
                        /* Not an em-dash. This cell is where the reviewer looks
                           to know whether the row is theirs to judge, and ↵ now
                           refuses on two of these three states — so it says
                           which one it is in rather than letting the refusal
                           arrive as an unexplained toast. */
                        : (
                          <span style={{
                            fontSize: 11,
                            color: compare[p.id] === COMPARE.BROKEN ? 'var(--danger)' : 'var(--on-surface-3)',
                          }}>
                            {compare[p.id] === COMPARE.BROKEN ? 'Cannot compare'
                              : compare[p.id] === COMPARE.READY ? '—'
                                : 'Loading photos'}
                          </span>
                        )}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </>
      )}
    </Section>
  );
}
