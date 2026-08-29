// Graha · dedupe — duplicate contact groups and the merge ledger.
//
// 47 inline styles are now `gr__*` classes.
//
// ── The defect this tab had ────────────────────────────────────────────────
// Both loads were `catch { toast }` with no error state, so a failed fetch fell
// through to `groups.length === 0` and painted a green tick over "No duplicates
// found — all contacts have unique email and phone values". That is a specific,
// checkable claim about the customer's data, asserted on the strength of a
// request that failed. The merge history did the same with "No merges yet".
// Both panels now carry their own error state and retry, and they are
// independent: the history failing must not hide the duplicates.
//
// The group header was a `<div onClick>` that expands a panel; it is a
// `<button aria-expanded>` now, so it is reachable by keyboard and announces
// its state.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { Badge, TYPE_COLORS, SOURCE_COLORS } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import { HeadCell } from '../../components/ui/Table';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'contact_type', label: 'Type' },
  { key: 'source', label: 'Source' },
  { key: 'lead_score', label: 'Score' },
];

/**
 * The candidate table inside an expanded duplicate group. Built FROM `FIELDS`
 * rather than restating it, so the seven comparison columns stay one list —
 * this table exists to let a person compare the same fields across two records
 * that claim to be one person, and a second copy of the field list is how the
 * comparison quietly stops comparing something.
 *
 * `fixed` on Keep and Name. Keep is the radio the whole screen is for: hide it
 * and the merge button below has nothing that can ever enable it. Name is how
 * you tell the two candidates apart before you decide which one survives.
 *
 * One key for every group, not one per group: it is the same table rendered
 * once per expansion, and a per-group key would mean arranging it again for
 * each duplicate a firm happens to have.
 */
const DEDUPE_GROUP_COLUMNS = [
  { id: 'keep', label: 'Keep', fixed: true },
  ...FIELDS.map(f => ({ id: f.key, label: f.label, fixed: f.key === 'name' })),
  { id: 'created_at', label: 'Created' },
];

/** `fixed` on Survivor (which record won) and Actions (Undo). */
const DEDUPE_MERGE_COLUMNS = [
  { id: 'survivor_name', label: 'Survivor', fixed: true },
  { id: 'merged_name', label: 'Merged Contact' },
  { id: 'moved_rows', label: 'Rows Moved' },
  { id: 'created_at', label: 'Date' },
  { id: 'status', label: 'Status' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

/**
 * "Rows Moved" — a COUNT, from a jsonb object of per-table counts.
 *
 * ⚠ THIS CELL USED TO CRASH THE WHOLE PAGE, and it had never once been seen.
 *
 * It rendered `{m.moved_rows ?? '—'}` directly. `moved_rows` is jsonb —
 * `services/contact_dedupe.py` writes `{t: len(v) for t, v in moved_rows.items()}`,
 * so it arrives as an OBJECT like `{"graha_activities": 3, "graha_deals": 1}`.
 * React refuses to render an object as a child (error #31), the ErrorBoundary
 * caught it, and the Dedupe tab rendered NOTHING AT ALL — not a broken cell, a
 * blank page.
 *
 * `?? '—'` never helped: an object is not null.
 *
 * ── WHY NOBODY EVER SAW IT, WHICH IS THE INTERESTING PART ─────────────────
 * `graha_contact_merges` held ZERO ROWS for its entire life, because the write
 * path 500d on a column declared UUID against ids that never were (migration
 * 240, 2026-08-29). An empty ledger renders an empty table, and an empty table
 * cannot hit this line.
 *
 * So fixing the write revealed the read. The same shape as the notice register
 * the same day: **a broken write hides every bug downstream of it**, and the
 * emptiness reads as "nobody has used this yet" rather than "this has never
 * worked".
 *
 * The number is what the column asks for; the breakdown goes in the tooltip,
 * because "9" without "which tables" is the question a person asks next.
 */
export function movedRowsTotal(moved) {
  if (moved == null) return '—';
  if (typeof moved === 'number') return moved;          // older rows, if any
  if (typeof moved !== 'object') return String(moved);
  const total = Object.values(moved).reduce(
    (n, v) => n + (typeof v === 'number' ? v : 0), 0,
  );
  return total;
}

export function movedRowsDetail(moved) {
  if (moved == null || typeof moved !== 'object') return undefined;
  const parts = Object.entries(moved)
    // The table name is the product's own, so it is shown as-is rather than
    // guessed at a label — a wrong friendly name is worse than a raw one here.
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([t, v]) => `${t}: ${v}`);
  return parts.length ? parts.join('\n') : undefined;
}

export default function DedupeTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'merge contacts' });
  const { pushToast } = useToast();
  const [groups, setGroups] = useState([]);
  const [merges, setMerges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergesLoading, setMergesLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [mergesErr, setMergesErr] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [survivors, setSurvivors] = useState({});
  const [merging, setMerging] = useState(false);
  const [undoing, setUndoing] = useState(null);

  const groupCols = useColumnPrefs('graha.dedupe_candidates', DEDUPE_GROUP_COLUMNS);
  const mergeCols = useColumnPrefs('graha.dedupe_merges', DEDUPE_MERGE_COLUMNS);

  useEffect(() => { loadGroups(); loadMerges(); }, []);

  async function loadGroups() {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get('/v1/graha/contacts/duplicates');
      setGroups(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load duplicate groups', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function loadMerges() {
    setMergesLoading(true);
    setMergesErr(null);
    try {
      const r = await api.get('/v1/graha/contacts/merges');
      setMerges(rows(r));
    } catch (e) {
      setMergesErr(e);
      pushToast({ title: 'Failed to load merge history', type: 'error' });
    }
    finally { setMergesLoading(false); }
  }

  function selectSurvivor(groupIdx, contactId) {
    setSurvivors(prev => ({ ...prev, [groupIdx]: contactId }));
  }

  async function doMerge(groupIdx) {
    const group = groups[groupIdx];
    const survivorId = survivors[groupIdx];
    if (!survivorId) { pushToast({ title: 'Select a contact to keep first', type: 'error' }); return; }
    const mergeIds = group.contacts.filter(c => c.id !== survivorId).map(c => c.id);
    if (mergeIds.length === 0) return;
    setMerging(true);
    try {
      await api.post(`/v1/graha/contacts/${survivorId}/merge`, { merge_ids: mergeIds });
      pushToast({ title: 'Contacts merged successfully', type: 'success' });
      setExpandedIdx(null);
      setSurvivors(prev => { const n = { ...prev }; delete n[groupIdx]; return n; });
      loadGroups();
      loadMerges();
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Merge failed', type: 'error' }); }
    finally { setMerging(false); }
  }

  async function undoMerge(mergeId) {
    setUndoing(mergeId);
    try {
      await api.post(`/v1/graha/contacts/merges/${mergeId}/undo`);
      pushToast({ title: 'Merge undone', type: 'success' });
      setExpandedIdx(null);
      setSurvivors({});
      loadGroups();
      loadMerges();
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Undo failed', type: 'error' }); }
    finally { setUndoing(null); }
  }

  return (
    <div>
      <h3 className="gr__st--lg">Dedupe Review <Secondary  value="(द्वैतनिवारण)" /></h3>
      <p className="gr__lede">
        Contacts sharing the same email or phone are grouped below. Select the record to keep and merge the rest.
      </p>

      {loading ? (
        <SkeletonRegion label="Loading duplicates"><SkeletonList rows={4} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={loadGroups} />
      ) : groups.length === 0 ? (
        <EmptyState
          illustration="generic"
          tone="ok"
          title={{ en: 'No duplicates found', hi: 'कोई द्वैत नहीं' }}
          description="Every contact has a unique email and phone value."
        />
      ) : (
        <div className="gr__dd">
          {groups.map((g, gi) => {
            const expanded = expandedIdx === gi;
            const survivorId = survivors[gi];
            return (
              <div key={`${g.match_type}-${g.match_key}`} className="gr__ddg">
                <button
                  type="button"
                  className="gr__ddhead"
                  aria-expanded={expanded}
                  onClick={() => setExpandedIdx(expanded ? null : gi)}
                >
                  <span className="gr__ddcaret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <Badge text={g.match_type} color={g.match_type === 'email' ? 'var(--st-in-progress)' : 'var(--ok)'} />
                  <span className="gr__ddkey">{g.match_key}</span>
                  <span className="gr__count gr__count--warn">{g.count} contacts</span>
                </button>

                {expanded && (
                  <div className="gr__ddbody">
                    <p className="gr__lede">
                      Select the record to keep (survivor). All others will be merged into it.
                    </p>
                    <div className="tbl__abar"><ColumnsButton cols={groupCols} /></div>
                    <div className="tbl__wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            {groupCols.columns.map(c => (
                              <HeadCell key={c.id} width={c.width} onResize={w => groupCols.setWidth(c.id, w)}>
                                {c.label}
                              </HeadCell>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {g.contacts.map(c => {
                            const selected = survivorId === c.id;
                            return (
                              <tr
                                key={c.id}
                                className={`gr__tr--click${selected ? ' on' : ''}`}
                                onClick={() => selectSurvivor(gi, c.id)}
                              >
                                {groupCols.cells({
                                  keep: (
                                    <td className="gr__td--mid">
                                      <input
                                        type="radio"
                                        name={`survivor-${gi}`}
                                        checked={selected}
                                        aria-label={`Keep ${c.name || c.email || c.phone}`}
                                        onChange={() => selectSurvivor(gi, c.id)}
                                      />
                                    </td>
                                  ),
                                  // Still built from FIELDS, so the seven
                                  // comparison cells and the seven declared
                                  // columns cannot drift; `cells()` then drops
                                  // whichever the arrangement hides.
                                  ...Object.fromEntries(FIELDS.map(f => [f.key, (
                                    <td className="gr__td--mute">
                                      {f.key === 'contact_type' && c[f.key]
                                        ? <Badge text={c[f.key]} color={TYPE_COLORS[c[f.key]] || 'var(--on-surface-3)'} />
                                        : f.key === 'source' && c[f.key]
                                          ? <Badge text={c[f.key]} color={SOURCE_COLORS[c[f.key]] || 'var(--on-surface-3)'} />
                                          : (c[f.key] ?? '—')}
                                    </td>
                                  )])),
                                  created_at: (
                                    <td className="gr__td--when">
                                      {c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                    </td>
                                  ),
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="gr__acts">
                      <button className="k-btn k-btn--ghost" onClick={() => setExpandedIdx(null)}>Cancel</button>
                      <button className="k-btn k-btn--primary" disabled={!survivorId || merging || !canWrite} onClick={() => doMerge(gi)} title={denial || undefined}>
                        {merging ? 'Merging…' : `Merge ${g.count - 1} into survivor`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="gr__stack">
        <h3 className="gr__st--lg">Recent Merges <Secondary  value="(विलय इतिहास)" /></h3>
        <p className="gr__lede">Previously merged contacts. Undo is available for recent merges.</p>

        {mergesLoading ? (
          <SkeletonRegion label="Loading merge history"><SkeletonList rows={3} /></SkeletonRegion>
        ) : mergesErr ? (
          <ErrorState kind={errorKind(mergesErr)} onRetry={loadMerges} />
        ) : merges.length === 0 ? (
          <p className="gr__quiet">No merges yet.</p>
        ) : (
          <>
          <div className="tbl__abar"><ColumnsButton cols={mergeCols} /></div>
          <div className="tbl__wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {mergeCols.columns.map(c => (
                    <HeadCell key={c.id} width={c.width} onResize={w => mergeCols.setWidth(c.id, w)}>
                      {c.sr ? <span className="sr-only">{c.label}</span> : c.label}
                    </HeadCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {merges.map(m => (
                  <tr key={m.id}>
                    {mergeCols.cells({
                      survivor_name: <td className="gr__td--name">{m.survivor_name}</td>,
                      merged_name: <td className="gr__td--mute">{m.merged_name}</td>,
                      moved_rows: (
                        <td className="gr__td--mute" title={movedRowsDetail(m.moved_rows)}>
                          {movedRowsTotal(m.moved_rows)}
                        </td>
                      ),
                      created_at: (
                        <td className="gr__td--when">
                          {m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                      ),
                      status: (
                        <td>
                          {m.undone_at
                            ? <Badge text="Undone" color="var(--on-surface-3)" />
                            : <Badge text="Merged" color="var(--ok)" />}
                        </td>
                      ),
                      actions: (
                        <td>
                          {!m.undone_at && (
                            <button className="k-btn k-btn--ghost" disabled={undoing === m.id} onClick={() => undoMerge(m.id)}>
                              {undoing === m.id ? 'Undoing…' : 'Undo'}
                            </button>
                          )}
                        </td>
                      ),
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
