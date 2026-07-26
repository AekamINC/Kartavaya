import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import Seg from '../../components/customize/Seg';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
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

/** Which flags mean "a human needs to look at this". */
const NEEDS_LOOK = new Set(['geo', 'accuracy', 'noref', 'mock', 'offline', 'late']);

const FLAG_LABEL = {
  late:     'Late',
  geo:      'Outside site',
  noref:    'No reference pair',
  accuracy: 'Weak GPS',
  offline:  'Synced late',
  overtime: 'Overtime',
  mock:     'Simulated location',
};

/** 07 §8: mock location is flagged PROMINENTLY. It is the only flag that implies
 *  intent rather than circumstance, so it reads as danger where the rest read as
 *  circumstance. */
const FLAG_TONE = {
  mock:     'rejected',
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
 * The punch-and-two-references comparison. Genuinely new — §3's "Reuse before you
 * create" table lists `.rv__trip` as one of four things no primitive covers.
 *
 * Keys, not URLs. A signed URL is fetched per image actually rendered, so
 * scrolling past a row never mints a link to that person's face.
 */
function Triple({ hasPhoto, referenceIds, punchId, name }) {
  // Each slot is its own little state machine: 'load' | 'ok' | 'gone' | 'err'.
  // A single nullable URL cannot express the difference between "still fetching"
  // and "retention deleted this three weeks ago", and those must not look alike —
  // a permanent spinner reads as a broken page, and a reviewer who thinks the
  // page is broken stops reviewing.
  const [punch, setPunch] = useState(() => (hasPhoto ? { st: 'load' } : { st: 'gone' }));
  const [refs, setRefs] = useState(() =>
    (referenceIds || []).slice(0, 2).map(() => ({ st: 'load' })));

  useEffect(() => {
    let alive = true;
    if (!punchId || !hasPhoto) return undefined;
    setPunch({ st: 'load' });
    api.get(`/v1/pahchan/punches/${punchId}/photo`)
      .then(r => { if (alive) setPunch({ st: 'ok', url: r.data.url }); })
      // 404 is the retention case and is not an error: the punch record outlives
      // the photo by law (07 §5/§8), so a missing photo on an old row is expected.
      .catch(err => {
        if (alive) setPunch({ st: err?.response?.status === 404 ? 'gone' : 'err' });
      });
    return () => { alive = false; };
  }, [punchId, hasPhoto]);

  useEffect(() => {
    let alive = true;
    const ids = (referenceIds || []).slice(0, 2);
    if (!ids.length) { setRefs([]); return undefined; }
    setRefs(ids.map(() => ({ st: 'load' })));
    ids.forEach((id, i) => {
      api.get(`/v1/pahchan/enrollment/photos/${id}/url`)
        .then(r => {
          if (!alive) return;
          setRefs(prev => { const next = prev.slice(); next[i] = { st: 'ok', url: r.data.url }; return next; });
        })
        .catch(err => {
          if (!alive) return;
          const st = err?.response?.status === 404 ? 'gone' : 'err';
          setRefs(prev => { const next = prev.slice(); next[i] = { st }; return next; });
        });
    });
    return () => { alive = false; };
    // Joined, so a re-render with an equal-but-new array does not refetch every
    // face on the page — which at 12 rows is 36 signed URLs per keystroke.
  }, [(referenceIds || []).join(',')]);

  const slot = (s, label, emptyWord) => (
    <div
      className="rv__slot"
      style={{
        width: PHOTO_W, height: PHOTO_H,
        background: s?.st === 'ok' ? 'var(--s-low)' : 'var(--s-container)',
        border: '1px solid var(--outline-variant)',
        borderRadius: 'var(--r-sm)',
        overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {s?.st === 'ok' ? (
        <img src={s.url} alt={label} width={PHOTO_W} height={PHOTO_H}
             style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
      ) : (
        <span
          style={{
            fontSize: 'var(--t-label-sm)', color: 'var(--on-surface-3)',
            textAlign: 'center', padding: 2, lineHeight: 1.2,
          }}
        >
          {s?.st === 'load' ? '…' : s?.st === 'err' ? 'failed' : emptyWord}
        </span>
      )}
    </div>
  );

  // Two APPROVED references are what makes a row verifiable. One is not half a
  // comparison — 07 §0 is explicit that the pair exists because a single frontal
  // photo fails on anyone who turns their head.
  const hasRefs = (referenceIds || []).length >= 2;

  return (
    <div className="rv__trip" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {slot(punch, `Clock-in photo for ${name}`, 'deleted')}
      {/* A divider, not a gap: the left image is the claim and the right two are
          the evidence, and the reviewer is comparing across that line. */}
      <span aria-hidden="true" style={{ width: 1, height: PHOTO_H - 12, background: 'var(--outline-variant)' }} />
      {slot(hasRefs ? refs[0] : null, `Reference 1 for ${name}`, 'none')}
      {slot(hasRefs ? refs[1] : null, `Reference 2 for ${name}`, 'none')}
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

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/register');
      setRows(r.data.punches || []);
      setState('ready');
    } catch {
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

    setVerdict(v => ({ ...v, [row.id]: val }));
    seek(curRef.current + 1);
    try {
      await api.patch(`/v1/pahchan/punches/${row.id}/review`, { verdict: val });
      setRows(rs => rs.map(p => (p.id === row.id ? { ...p, review_verdict: val } : p)));
    } catch {
      // Roll the optimistic mark back. A verdict that failed to save must not
      // look recorded — this queue's whole value is that it is accurate.
      setVerdict(v => { const next = { ...v }; delete next[row.id]; return next; });
      pushToast({ type: 'error', title: 'Could not save that verdict', message: 'Try again.' });
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
      {/* §3: the column header labels the table, so it belongs to any state where
          a table is present OR arriving — bound to hasTable, not to ready. Not
          shown for empty or error, where column labels would sit over nothing. */}
      {state === 'loading' && (
        <SkeletonRegion label="Loading the register…">
          <SkeletonTable rows={6} cols={6} />
        </SkeletonRegion>
      )}

      {state === 'error' && (
        <ErrorState
          kind="server"
          title="The register did not load"
          // §3's exact reassurance. A read failure that reads like data loss sends
          // an HR admin into a panic about attendance records that are perfectly safe.
          message="Punches are safe — this is a read failure, not data loss."
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
                      ? <StatusChip status={mine === 'ok' ? 'done' : 'rejected'}
                                    label={mine === 'ok' ? 'Confirmed' : 'Flagged'} />
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
                        : <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>—</span>}
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
