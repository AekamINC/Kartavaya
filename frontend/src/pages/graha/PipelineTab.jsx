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
// deal with no follow-up scheduled. Kanban is where a deal gets MOVED, so the
// stage buttons live there and not here. Read-only is the point, not a gap: a
// forecast you can accidentally edit by clicking is worse than one you cannot.
import React, { useState, useEffect } from 'react';
import { api, rows, body } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import { Empty, Shimmer } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import { stageColor } from './_shared';
import { useLanguage } from '../../components/CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../../components/Bilingual';

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

// The router's own closed-deal vocabulary, verbatim: `GET /deals?no_follow_up=true`
// selects with `d.stage NOT IN ('Won','Lost')`. A closed deal owes nobody a next
// date, so it is neither marked here nor counted there — and both have to spell
// "closed" the same way, or the board contradicts the banner above it.
const isClosed = stage => stage === 'Won' || stage === 'Lost';

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
  // ONE LABEL SHAPE — `.gpipe__hi` is not in `[data-language="en"]`'s six-name
  // list, so the pipeline named every stage twice under English. Read once
  // because the stages are mapped.
  const lang = useLanguage();
  const [stages, setStages] = useState([]);
  const [columns, setColumns] = useState({});
  const [next, setNext] = useState({});
  // How much of the org's open follow-ups `next` actually holds:
  //   'all'    — the page was not truncated, so a deal absent from the map has
  //              genuinely nothing scheduled
  //   'capped' — `/follow-ups` hit its 200-row cap, so the map holds the soonest
  //              200 and says nothing whatever about the rest
  //   'none'   — the request failed, or answered without saying which it was
  // Only 'all' licenses this screen to call a deal stale, in the marker on a
  // card and in the count above them alike. Under the other two, that marker is
  // an accusation the data in hand cannot support.
  const [reach, setReach] = useState('none');
  const [likely, setLikely] = useState({});
  const [owners, setOwners] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  /* ── THE PIPELINES THEMSELVES, WHICH THIS TAB NEVER ASKED FOR ──────────
     `POST /v1/graha/pipelines` has existed since the module shipped and a
     grep for `pipelines` across `frontend/src` returned ONE hit: the word
     inside a module-catalogue blurb. Nothing called it, no screen listed
     them, and this tab's own empty state sent the reader to a Deals tab that
     has no such control either. Suite 04.18 found it by looking for the
     button and enumerating every one that is actually on those two screens.
     What happened instead: `create_deal` silently INSERTs a pipeline called
     "Default Pipeline" the first time a deal is raised without one. So every
     org has exactly one pipeline, nobody typed it, and §4's "2 pipelines"
     could not be reached by a person. */
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const { pushToast } = useToast();
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change the pipeline' });

  useEffect(() => { load(); }, [pipelineId]);

  async function load() {
    setErr('');
    // The list of pipelines is an ENRICHMENT and must not be able to take the
    // board down with it — the same standing this file already gives the
    // follow-up map, the forecast and the member directory. A 403 here leaves
    // the picker absent and the default board exactly as it was.
    try {
      const pl = rows(await api.get('/v1/graha/pipelines'));
      setPipelines(pl);
    } catch { /* no picker; the default board still draws */ }
    try {
      // `deals_kanban` takes `pipeline_id` and falls back to the org's default
      // when it is absent, so an unset selection is the behaviour this tab has
      // always had rather than a new empty case.
      const q = pipelineId ? `?pipeline_id=${encodeURIComponent(pipelineId)}` : '';
      const r = body(await api.get(`/v1/graha/deals/kanban${q}`));
      setStages(r.stages || []);
      setColumns(r.columns || {});
    } catch (e) {
      // The board itself failing is the only fatal case — without deals there
      // is nothing to draw. The four enrichments below each fail on their own.
      setErr(e.response?.status === 403
        ? 'You do not have access to the CRM pipeline.'
        : 'The pipeline did not load. Retry, or check your connection.');
      setLoading(false);
      return;
    }
    setLoading(false);

    // The next follow-up per deal. `/follow-ups` returns open items ordered by
    // due_at, so the FIRST row for a deal is its soonest — hence the guard.
    //
    // That ordering is also the trap. The route stops at 200 rows, so once an
    // org has more open follow-ups than that, the deals whose follow-up falls
    // later in the queue are missing from this map and look exactly like deals
    // that have none — the marker would then be loudest on precisely the orgs
    // doing the most follow-up work. So the map is read as evidence of PRESENCE
    // always, and as evidence of ABSENCE only when the envelope says the page
    // was not truncated. An envelope carrying no such flag is not a promise, so
    // it is not read as one.
    try {
      const f = await api.get('/v1/graha/follow-ups');
      const map = {};
      for (const x of rows(f)) {
        if (x.deal_id && !map[x.deal_id]) map[x.deal_id] = x;
      }
      setNext(map);
      const capped = body(f).truncated;
      setReach(capped === false ? 'all' : capped === true ? 'capped' : 'none');
    } catch { /* no follow-up is shown on any card, and none is called missing */ }

    // Stage likelihood, derived from the weighting the server already does.
    try {
      const fc = await api.get('/v1/graha/reports/forecast');
      const map = {};
      for (const s of body(fc).stages || []) {
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
      // `/v1/org/members` answers a BARE array, not `{"data": […]}` — one of the
      // 28 routes that do. `rows()` is indifferent to which.
      for (const x of rows(m)) map[x.user_id] = x.full_name || x.email;
      setOwners(map);
    } catch { setOwners(null); }
  }

  async function createPipeline(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      // `stages` is left to the server's own default — the six this module
      // spells everywhere else. A stage editor is a separate job and shipping
      // the create control without one is still the difference between "cannot
      // be done at all" and "cannot yet be customised".
      const res = await api.post('/v1/graha/pipelines', { name });
      pushToast({ title: `Pipeline "${name}" created`, type: 'success' });
      setNewName('');
      const made = body(res)?.id;
      // Select it immediately. A board created and not shown is the shape this
      // whole change exists to close.
      if (made) setPipelineId(String(made)); else load();
    } catch (e2) {
      pushToast({ title: apiErrorText(e2, 'Could not create the pipeline'), type: 'error' });
    } finally { setCreating(false); }
  }

  /** The picker and the create box, drawn above the board AND above the empty
   *  state — the empty state is exactly where somebody needs them most. */
  const controls = (
    <div className="gpipe__bar">
      {pipelines.length > 1 && (
        <label className="gr__f">
          <span className="gr__fl">Pipeline</span>
          <select className="k-input" value={pipelineId}
            onChange={e => setPipelineId(e.target.value)}>
            {pipelines.map(p => (
              <option key={p.id} value={String(p.id)}>
                {p.name}{p.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <form className="gpipe__new" onSubmit={createPipeline}>
        <label className="gr__f">
          <span className="gr__fl">New pipeline</span>
          <input className="k-input" value={newName} maxLength={80}
            placeholder="Retainers, Audit work, Referrals…"
            onChange={e => setNewName(e.target.value)} />
        </label>
        <button type="submit" className="k-btn k-btn--ghost"
          disabled={!canWrite || creating || !newName.trim()}
          title={denial || undefined}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );

  if (loading) return <Shimmer count={6} />;
  if (err) return <div className="note note--warn" role="status">{err}</div>;
  if (!stages.length) {
    return (
      <>
        {controls}
        {/* ⚠ THE OLD SENTENCE HERE WAS FALSE: "Create one from the Deals tab
            and your board appears here". The Deals tab has never carried a
            control that makes a pipeline — Suite 04.18 enumerated every button
            on both screens to establish it. An empty state that names a place
            with nothing in it costs the reader the trip and teaches them the
            product is lying to them. The control is now on this line. */}
        <Empty
          title="No pipeline set up yet"
          sub="A pipeline defines the stages a deal moves through. Name one above and your board appears here."
        />
      </>
    );
  }

  // Counted off the cards this board actually draws, and deliberately NOT read
  // from `GET /deals?no_follow_up=true`. That query is the right one for the
  // module banner and the wrong one for a lede ending "marked below": it counts
  // every open deal in the ORG across every pipeline, while `/deals/kanban`
  // returns one pipeline, so repeating its number here would promise markers for
  // deals that are not on this page. This tally can promise them — the board
  // carries no LIMIT, so every deal in the set is drawn, and `reach === 'all'`
  // is what makes an absence from `next` mean something. The org-wide figure
  // stays on the banner, where the action that fixes it lives.
  const stale = reach === 'all'
    ? stages.reduce((n, s) => (isClosed(s) ? n : n + (columns[s] || []).filter(d => !next[d.id]).length), 0)
    : 0;

  return (
    <>
      {controls}
      {stale > 0 && (
        <p className="gpipe__lede">
          {stale} {stale === 1 ? 'deal on this board has' : 'deals on this board have'} no follow-up scheduled.
          {' '}{stale === 1 ? 'It is' : 'They are'} marked below.
        </p>
      )}
      {reach === 'capped' && (
        // Said out loud rather than shown as a board with no markers on it. The
        // absence of markers is indistinguishable from a pipeline in good order,
        // which is the more dangerous of the two readings.
        <p className="gpipe__lede">
          More than 200 follow-ups are open, so this board is not marking which deals are missing one —
          it can see only the 200 falling due soonest.
        </p>
      )}
      <div className="gpipe">
        {stages.map(stage => {
          const deals = columns[stage] || [];
          const sum = deals.reduce((a, d) => a + (Number(d.value) || 0), 0);
          const pct = likely[stage];
          const stageIn = secondaryOf(STAGE_HI[stage], lang);
          return (
            // `--c` moved from the head to the COLUMN: the column's ground is
            // tinted with its own stage colour, and the head's 3px cap keeps
            // the same variable by inheritance. Same object as `.bd__col`.
            <section key={stage} className="gpipe__col" style={{ '--c': stageColor(stage) }} aria-label={`${stage} — ${deals.length} deals`}>
              <header className="gpipe__head">
                <div className="gpipe__t">
                  <span>{stage}</span>
                  {stageIn.secondary && (
                    <Secondary className="gpipe__hi" value={stageIn.secondary} script={stageIn.script} />
                  )}
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
                const closed = isClosed(stage);
                // Not `!f`: a deal can be absent from `next` because it has no
                // follow-up, or because the page ran out before its follow-up
                // came due. `reach` is the only thing that tells those apart,
                // and this is the same predicate the count above is summing.
                const missing = !f && !closed && reach === 'all';
                const owner = owners && d.assigned_to ? owners[d.assigned_to] : null;
                return (
                  <article key={d.id} className={`gdeal${missing ? ' gdeal--stale' : ''}`}>
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
                    ) : missing ? (
                      // Word-for-word the lede's phrase, because the lede ends
                      // "They are marked below" and points at this. "Next step"
                      // is retired vocabulary — the tab is Follow-ups — so a
                      // reader scanning for what that sentence named would
                      // otherwise meet a different word on every card.
                      // `gdeal__none` stays: it is the CSS contract, not a label.
                      <div className="gdeal__none">No follow-up scheduled</div>
                    ) : null}
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
