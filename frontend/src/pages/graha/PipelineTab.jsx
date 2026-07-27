// Graha · pipeline — the stage board.
//
// This tab used to be a grid of per-stage COUNT tiles: a summary of a board
// that was nowhere on the page. The rendered reference
// (`design-reference/Kartavaya Redesign/ScreensCore.jsx`, `.pipe`) draws a
// column per stage carrying the deals themselves, each with its value, its next
// step and who owns it — and the whole CRM opens on it, which is what
// "pipeline-first" in that file's header comment means.
//
// ── Why this is not KanbanTab ─────────────────────────────────────────────
// The reference keeps `pipeline` and `kanban` as two tabs and they are two
// jobs. This one answers "what is my pipeline worth, and what has stalled" — so
// it leads with money per column, stage likelihood, and a loud marker on any
// deal with no next step. Kanban is where a deal gets MOVED, which is why the
// stage buttons live there and not here. Read-only is the point, not a gap: a
// forecast you can accidentally edit by clicking is worse than one you cannot.
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Empty, Shimmer } from '../../components/editorial';
import { stageColor } from './_shared';

const lakh = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

// Devanagari for the six default stages. Org-configurable stages (13 §2) fall
// through to nothing rather than being transliterated on the fly — a wrong
// Hindi word on screen is worse than none.
const STAGE_HI = {
  New: 'नवीन', Qualified: 'योग्य', Proposal: 'प्रस्ताव',
  Negotiation: 'वार्ता', Won: 'विजित', Lost: 'खोया',
};

/** "Today" / "Tomorrow" / "In 4d" / "6d overdue" — the reference's `when`. */
function due(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.round((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return { text: 'Today', late: false, soon: true };
  if (days === 1) return { text: 'Tomorrow', late: false, soon: true };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, late: true, soon: false };
  return { text: `In ${days}d`, late: false, soon: false };
}

export default function PipelineTab() {
  const [stages, setStages] = useState([]);
  const [columns, setColumns] = useState({});
  const [next, setNext] = useState({});
  const [likely, setLikely] = useState({});
  const [owners, setOwners] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setErr('');
    try {
      const r = await api.get('/v1/graha/deals/kanban');
      setStages(r.data.stages || []);
      setColumns(r.data.columns || {});
    } catch (e) {
      // The board itself failing is the only fatal case — without deals there
      // is nothing to draw. The three enrichments below each fail on their own.
      setErr(e.response?.status === 403
        ? 'You do not have access to the CRM pipeline.'
        : 'The pipeline did not load. Retry, or check your connection.');
      setLoading(false);
      return;
    }
    setLoading(false);

    // Next step per deal. `/follow-ups` returns open items ordered by due_at, so
    // the FIRST row for a deal is its soonest — hence the `??=`.
    try {
      const f = await api.get('/v1/graha/follow-ups');
      const map = {};
      for (const x of f.data.data || []) {
        if (x.deal_id && !map[x.deal_id]) map[x.deal_id] = x;
      }
      setNext(map);
    } catch { /* every deal then reads as having no next step — see below */ }

    // Stage likelihood, derived from the weighting the server already does.
    try {
      const fc = await api.get('/v1/graha/reports/forecast');
      const map = {};
      for (const s of fc.data.stages || []) {
        const total = Number(s.total_value) || 0;
        if (total > 0) map[s.stage] = Math.round((Number(s.weighted_value) / total) * 100);
      }
      setLikely(map);
    } catch { /* column heads simply omit "N% likely" */ }

    // Owner names. `/v1/org/members` is org_admin+ only, so a plain member gets
    // 403 — in which case the card shows no owner rather than eight characters
    // of a UUID, which tells nobody anything.
    try {
      const m = await api.get('/v1/org/members');
      const map = {};
      for (const x of m.data || []) map[x.user_id] = x.full_name || x.email;
      setOwners(map);
    } catch { setOwners(null); }
  }

  if (loading) return <Shimmer count={6} />;
  if (err) return <div className="note note--warn" role="status">{err}</div>;
  if (!stages.length) {
    return (
      <Empty
        title="No pipeline set up yet"
        sub="A pipeline defines the stages a deal moves through. Create one from the Deals tab and your board appears here."
      />
    );
  }

  // Deals with no open follow-up. The reference reads this off `deal.next`; the
  // build has no such column, so it is the absence of a follow-up row.
  const stale = stages
    .filter(s => s !== 'Won' && s !== 'Lost')
    .reduce((n, s) => n + (columns[s] || []).filter(d => !next[d.id]).length, 0);

  return (
    <>
      {stale > 0 && (
        <p className="gpipe__lede">
          {stale} {stale === 1 ? 'deal has' : 'deals have'} no next step. They are marked below.
        </p>
      )}
      <div className="gpipe">
        {stages.map(stage => {
          const deals = columns[stage] || [];
          const sum = deals.reduce((a, d) => a + (Number(d.value) || 0), 0);
          const pct = likely[stage];
          return (
            <section key={stage} className="gpipe__col" aria-label={`${stage} — ${deals.length} deals`}>
              <header className="gpipe__head" style={{ '--c': stageColor(stage) }}>
                <div className="gpipe__t">
                  <span>{stage}</span>
                  {STAGE_HI[stage] && <span className="gpipe__hi" lang="hi" aria-hidden="true">{STAGE_HI[stage]}</span>}
                </div>
                <div className="gpipe__sum">{sum ? lakh(sum) : '—'}</div>
                <div className="gpipe__n">
                  {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
                  {pct != null && ` · ${pct}% likely`}
                </div>
              </header>

              {deals.map(d => {
                const f = next[d.id];
                const when = f && due(f.due_at);
                const closed = stage === 'Won' || stage === 'Lost';
                const owner = owners && d.assigned_to ? owners[d.assigned_to] : null;
                return (
                  <article key={d.id} className={`gdeal${!f && !closed ? ' gdeal--stale' : ''}`}>
                    <div className="gdeal__co">{d.title}</div>
                    {(d.client_name || d.contact_company || d.contact_name) && (
                      <div className="gdeal__who">{d.client_name || d.contact_company || d.contact_name}</div>
                    )}
                    <div className="gdeal__v">{lakh(d.value)}</div>
                    {closed ? null : f ? (
                      <div className="gdeal__next">
                        {f.title}
                        {when && <b className={when.late ? 'gdeal__late' : when.soon ? 'gdeal__soon' : ''}> {when.text}</b>}
                      </div>
                    ) : (
                      <div className="gdeal__none">No next step</div>
                    )}
                    {owner && <div className="gdeal__own">{owner}</div>}
                  </article>
                );
              })}

              {!deals.length && <div className="gpipe__empty">Empty</div>}
            </section>
          );
        })}
      </div>
    </>
  );
}
