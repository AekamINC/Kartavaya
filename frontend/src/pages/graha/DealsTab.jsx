// Graha · deals — the list, the create form, per-row stage movement, and the
// place the pipeline banner's "Fix" lands.
//
// 66 inline styles are now `gr__*` classes. Two behavioural corrections came
// out of the conversion and are marked below: the deal title was a `<span>`
// carrying an onClick (unreachable by keyboard, invisible to a screen reader as
// a control), and the empty state was a hand-rolled emoji block rather than the
// shared `EmptyState` every other list in the product uses.
//
// ── Opening a deal is a navigation now ──────────────────────────────────────
//
// Title, Edit and Notes each used to swap a card in this list for a form held
// in this component's state. That is why a deal had no URL: it existed only
// while this tab was mounted, so it could not be bookmarked, sent to a
// colleague, reached by Back, or survived a refresh. All three now open
// `/graha/deals/:dealId` (`DealRoute.jsx`), where the whole record lives — the
// edit form and the notes editor MOVED there rather than being copied, so
// there is exactly one place a deal can be changed.
//
// What stayed here is what belongs to a LIST rather than to a record: the
// stage buttons, archive, delete, and the follow-up scheduler the pipeline
// banner's Fix lands on — that one is a backlog tool, and making the reader
// open each of hundreds of deals to clear it would undo the screen.
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { RotBadge, Badge, stageColor, dealPath, onDealsChanged } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import DateInput from '../../components/ui/DateInput';
import CustomFieldInputs from './CustomFieldInputs';
import { apiErrorText } from '../../lib/apiError';

/** Tomorrow, 09:00, in the `YYYY-MM-DDTHH:mm` DateInput hands back. Assembled
 *  by hand rather than through `toISOString()`, which is UTC and moves an IST
 *  evening back a day. */
function nextMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`;
}

/**
 * The Fix press the reader has already dismissed, per visit to the page.
 *
 * GrahaPage keys its tab panel on the tab id, so leaving Deals unmounts this
 * component and takes every piece of its state with it, while `focusNoFollowUp`
 * only ever counts up. With no record outside the mount, a filter the reader had
 * explicitly cleared came back the next time they opened the tab — and on every
 * visit after that, for the life of the page.
 *
 * The key is the location OBJECT, not its `key` string and not a module-wide
 * flag: react-router memoises one location per navigation, so every arrival at
 * Graha — a Back to the same entry included — brings a fresh object. A later
 * arrival therefore starts the counter at 1 again without inheriting this
 * visit's dismissal, which would leave the banner's Fix looking dead. Weak, so
 * a finished navigation is not held alive by what was dismissed on it.
 */
const dismissedFix = new WeakMap();

/**
 * `newNonce` lets the page header's "New deal" button open this tab's create
 * form. It is a counter rather than a boolean so a second press re-opens the
 * form after the first was cancelled — a boolean would already be `true` and
 * the effect would not re-run.
 *
 * `focusNoFollowUp` is the same shape for the same reason, and it carries the
 * pipeline banner's "Fix": it switches this list to the deals that have no
 * pending follow-up. A counter re-applies the filter after the user has cleared
 * it, which a boolean stuck at `true` could not.
 */
export default function DealsTab({ newNonce = 0, focusNoFollowUp = 0 }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change deals' });
  const navigate = useNavigate();
  const location = useLocation();
  const { pushToast } = useToast();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed load used to leave `deals` at [] and paint "No deals yet — track
  // your sales pipeline here", which is a confident wrong answer: the user
  // cannot tell it from a genuinely empty pipeline, and the toast that says
  // otherwise is gone in four seconds.
  const [err, setErr] = useState(null);
  // Deals whose stage change is in flight. MOTION-SPEC §7.1 — the row shows the
  // new stage at opacity .6 until the server agrees, then goes solid.
  const [pending, setPending] = useState(() => new Set());
  const [showForm, setShowForm] = useState(false);
  const [stageFilter, setStageFilter] = useState('');
  /* Open deals with nothing scheduled against them. Seeded from the prop rather
     than from a later effect: arriving here already focused would otherwise
     fetch the whole pipeline first and replace it a moment later, and the list
     would visibly change under the reader. A press the reader has already
     dismissed does not re-arm on the next mount — see `dismissedFix`. */
  const [noFollowUp, setNoFollowUp] = useState(
    () => focusNoFollowUp > 0 && dismissedFix.get(location) !== focusNoFollowUp,
  );
  /* The press this list is already showing the answer to. Seeded from the
     arriving prop because the mount's own fetch carries the seeded filter
     already; treating that first press as unanswered would only send the same
     request twice. */
  const answeredFix = useRef(focusNoFollowUp);
  /* Every automatic reload goes through this counter — see the effect below. */
  const [reload, setReload] = useState(0);
  /* What the server said about its own answer — `total` is counted before the
     LIMIT, so it is the only honest denominator on screen. Subtracting two
     capped lists in the browser is what made the banner say 199 against a true
     510; nothing here derives a count from `deals.length`.

     `stage` is the stage that answer was narrowed by, carried here because the
     select is a draft until Filter is pressed and the copy below has to describe
     the query that actually produced these rows. A count taken under one stage
     and printed as the pipeline's states the opposite of the truth whenever the
     other stages are full of deals missing a follow-up. */
  const [meta, setMeta] = useState({ total: 0, truncated: false, stage: '' });
  /* Whether a list request is out. `loading` is only ever the FIRST one — the
     list deliberately stays on screen through a refetch rather than collapsing
     into a skeleton each time a follow-up is scheduled — so it cannot gate the
     caveat lines, and those are claims about an answer. Printed while the answer
     was still in flight, the filtered one announced "0 open deals have no
     follow-up. Schedule one and it leaves this list." into a live region, as a
     present-tense fact, over a request that had not come back and might yet
     fail. */
  const [fetching, setFetching] = useState(true);
  const [fu, setFu] = useState(null);
  const [fuSaving, setFuSaving] = useState(false);
  /* A Won or Lost deal leaves the board seven days after it closed, but it
     never leaves the record — this is where the record is read. Archiving does
     not touch `is_active`, so every revenue figure still counts these. */
  const [showArchived, setShowArchived] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [dealClients, setDealClients] = useState([]);
  /* Territories have existed since migration 023 and `deals.territory_id` with
     them, but no create form could set one and no screen could read one — so a
     territory could be defined and never used. */
  const [territories, setTerritories] = useState([]);
  /* The org's pipelines. `DealCreate.pipeline_id` has always been accepted and
     `resolve_deal_pipeline` has always proved it belongs to the caller's org —
     no screen ever sent one, so every deal in the product landed on whatever
     `create_deal` bootstrapped. A second pipeline could therefore be made (once
     PipelineTab grew the control) and would stay empty for ever. Suite 04.18. */
  const [pipelines, setPipelines] = useState([]);
  /* ── THE DEAL'S OWNER, AND WHY THIS FIELD HAD TO EXIST ──────────────────
     `graha_deals.assigned_to` is written by `create_deal`, sits in
     `update_deal`'s `_DEAL_COLS`, and is READ in three places — the pipeline
     card, the rep-performance report and the contact drawer. NO SCREEN WROTE
     IT. A sweep of `frontend/src` on 2026-08-29 found three readers and no
     writer anywhere in the product, web or mobile.

     What that costs is not cosmetic. Vikray's sales-target attainment is
     `graha_deals.assigned_to = vikray_targets.salesperson_id`
     (`routers/vikray.py` `_ATTAINMENT_SQL`), so with nothing ever assigned,
     EVERY TARGET IN EVERY ORG READS Rs 0 AGAINST ITS NUMBER — for ever, and
     correctly, because nobody has claimed the revenue. Live on Unicode Group
     the same day: 30 deals, 0 with an assignee, 8 of them Won, 10 people
     holding targets and 10 reading zero. The Targets tab tells the user in
     prose that actuals arrive this way.

     The directory is `GET /v1/org/members`, the same one `TargetsTab` picks a
     salesperson from — so the two sides of that join are chosen from one list
     and cannot name different things. The id lives only in the option's
     `value`; the option TEXT is the person's name, which is the shape
     `scripts/check-rendered-ids.mjs` admits and the one the territory and
     client dropdowns already use. */
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '', custom_data: {}, territory_id: '', assigned_to: '', pipeline_id: '' });
  const [saving, setSaving] = useState(false);

  /** Open one deal. The single door — see the note at the top of this file. */
  const openDeal = id => navigate(dealPath(id));

  /* One counter, bumped by every control that changes what the list means, and
     read here as the only automatic trigger. Depending on the filter VALUES
     instead cannot see a second press of Fix: it sets `noFollowUp` to a value it
     already holds, so no dependency changes and the list keeps whatever a stage
     filter last left on screen — an empty one, under a banner still counting the
     whole pipeline. The stage select is the single control that waits for its
     Filter button; the rest reload themselves, because a control that needs a
     second click to take effect reads as broken. */
  useEffect(() => { load(); }, [reload]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!newNonce) return;
    setShowForm(true);
    loadFormData();
  }, [newNonce]);
  useEffect(() => {
    if (!focusNoFollowUp || answeredFix.current === focusNoFollowUp) return;
    answeredFix.current = focusNoFollowUp;
    // The banner counts OPEN deals, and the server refuses Won and Lost for
    // this filter. A stage of "Won" left selected from an earlier Filter press
    // would answer zero against a banner that just said 512 — the reader would
    // read that as the banner lying, not as two filters meeting.
    setStageFilter('');
    setNoFollowUp(true);
    setReload(n => n + 1);
  }, [focusNoFollowUp]);
  /* A deal edited in the record route is edited BEHIND this list — the drawer
     sits over it and this component never unmounts. Without a refetch the row
     underneath kept the old title and the old value while the record showed the
     new ones, which is the two-sources-of-truth this conversion exists to
     remove.
     Through a ref, so the subscription is made ONCE: `load` is a fresh function
     every render and subscribing to it directly would add and drop a listener
     on each one, for no gain — the ref always points at the current closure. */
  const loadRef = useRef(null);
  loadRef.current = load;
  useEffect(() => onDealsChanged(() => loadRef.current?.()), []);

  async function load() {
    setErr(null);
    setFetching(true);
    try {
      let url = '/v1/graha/deals?';
      if (stageFilter) url += `stage=${stageFilter}&`;
      if (showArchived) url += 'include_archived=true&';
      if (noFollowUp) url += 'no_follow_up=true&';
      const r = await api.get(url);
      const list = rows(r);
      const b = body(r);
      setDeals(list);
      // `total` is absent on the bare-array shape, and there the list IS all of
      // it — falling back to the array's own length keeps the caveat line from
      // claiming a truncation that did not happen. `stageFilter` is recorded
      // from the same closure that built the URL, so it is the stage the server
      // was actually asked for rather than whatever the select shows by the time
      // the answer lands.
      setMeta({
        total: Number(b?.total ?? list.length),
        truncated: Boolean(b?.truncated),
        stage: stageFilter,
      });
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load deals', type: 'error' });
    }
    finally { setLoading(false); setFetching(false); }
  }

  /** Put the whole pipeline back, and record that this Fix press was answered
   *  and dismissed so returning to the tab does not re-apply it.
   *
   *  The stage goes with it. Both escape hatches are named "Show all deals", and
   *  clearing only the follow-up filter handed back the deals of whatever stage
   *  was still selected — a subset, under a control that promised the lot.
   *  "Include archived" is left alone: it adds rows rather than hiding them. */
  function clearNoFollowUp() {
    dismissedFix.set(location, focusNoFollowUp);
    setStageFilter('');
    setNoFollowUp(false);
    setReload(n => n + 1);
  }

  // The two dropdowns are an enrichment on the create form: either failing
  // leaves that select empty rather than blocking the form.
  async function loadFormData() {
    try {
      const [cr, clr, tr, pl] = await Promise.all([
        api.get('/v1/graha/contacts'),
        api.get('/v1/graha/clients'),
        api.get('/v1/graha/territories'),
        api.get('/v1/graha/pipelines'),
      ]);
      setContacts(rows(cr));
      setDealClients(rows(clr));
      setTerritories(rows(tr));
      setPipelines(rows(pl));
    } catch { /* selects offer "None" only */ }
    // Separately, and deliberately not inside the Promise.all above:
    // `/v1/org/members` is org_admin+ only, so a plain member gets a 403 and
    // taking the whole enrichment down with it would empty the contact and
    // company dropdowns for everybody below admin. A silent 403 here just
    // leaves the owner field reading "Unassigned", which is the right default.
    try {
      const mr = await api.get('/v1/org/members');
      setMembers(rows(mr));
    } catch { /* not an admin: no directory, and the field says so */ }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/deals', { ...form, value: parseFloat(form.value) || 0 });
      pushToast({ title: 'Deal created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '', custom_data: {}, territory_id: '', assigned_to: '', pipeline_id: '' });
      load();
    } catch (e2) { pushToast({ title: apiErrorText(e2, 'Failed'), type: 'error' }); }
    finally { setSaving(false); }
  }

  async function setArchived(deal, on) {
    try {
      await api.post(`/v1/graha/deals/${deal.id}/${on ? 'archive' : 'unarchive'}`);
      pushToast({ title: on ? 'Deal archived' : 'Deal back on the board', type: 'success' });
      load();
    } catch (e) {
      // A 503 here names the migration that has not been applied. Say so —
      // "could not archive" is not something the reader can act on.
      pushToast({ title: apiErrorText(e, 'Could not archive deal'), type: 'error' });
    }
  }

  async function deleteDeal(dealId, title) {
    if (!window.confirm(`Delete deal "${title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/v1/graha/deals/${dealId}`);
      pushToast({ title: 'Deal deleted', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not delete deal', type: 'error' }); }
  }

  /**
   * Optimistic stage change — MOTION-SPEC §7.1.
   *
   * Before: `await PATCH` then `load()`. The select snapped back to the old
   * stage for a whole round trip, then the entire list re-rendered. If the
   * write failed the toast fired but the row had already been reset by the
   * refetch, so the two paths looked identical from the user's side.
   *
   * Now the row shows the new stage immediately at `opacity .6`, and a failure
   * restores the WHOLE previous deal rather than just its stage — restoring one
   * field leaves a row that is half-committed and looks fine.
   */
  async function updateStage(dealId, stage) {
    const previous = deals.find(d => d.id === dealId);
    if (!previous) return;
    setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, stage } : d)));
    setPending(prev => new Set(prev).add(dealId));
    try {
      const r = await api.patch(`/v1/graha/deals/${dealId}`, { stage });
      const b = body(r);
      const fresh = b?.data ?? b;
      if (fresh && fresh.id != null) {
        setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, ...fresh } : d)));
      }
      pushToast({ title: `Deal moved to ${stage}`, type: 'success' });
    } catch {
      pushToast({ title: 'Could not update deal stage', type: 'error' });
      setDeals(prev => prev.map(d => (d.id === dealId ? previous : d)));
    } finally {
      setPending(prev => { const n = new Set(prev); n.delete(dealId); return n; });
    }
  }

  async function createOrder(dealId) {
    try {
      const r = await api.post(`/v1/vikray/orders/from-deal/${dealId}`);
      const b = body(r);
      pushToast({
        title: b.status === 'exists'
          ? `Already ordered — ${b.order_number}`
          : `Sales order ${b.order_number} created`,
        type: 'success',
      });
    } catch (e) {
      // 403 here is an org without the Sales module, and saying so beats
      // "could not create" — there is nothing they can do about the latter.
      pushToast({
        title: e.response?.status === 403
          ? 'This organisation does not have the Sales module'
          : apiErrorText(e, 'Could not create the sales order'),
        type: 'error',
      });
    }
  }

  async function createInvoice(dealId) {
    try {
      const r = await api.post(`/v1/ganit/invoices/from-deal/${dealId}`);
      const b = body(r);
      if (b.status === 'exists') {
        pushToast({ title: 'Invoice already exists for this deal', type: 'info' });
      } else {
        pushToast({ title: `Draft invoice ${b.invoice_number} created`, type: 'success' });
      }
      navigate('/ganit');
    } catch (e) { pushToast({ title: apiErrorText(e, 'Failed to create invoice'), type: 'error' }); }
  }

  /* `startEditDeal` and `saveNote` lived here and PATCHed from the list. They
     are `DealRoute.jsx` now — the same fields, the same endpoint, one screen —
     because a record that can be changed in two places is a record whose two
     places disagree the moment one of them forgets a field. Nothing was
     dropped in the move: title, value, stage, probability, expected close, the
     org's custom fields and notes all edit there. */

  function startFollowUp(d) {
    // Title and date are both prefilled because this screen exists to clear a
    // backlog of hundreds: a form that starts empty makes the tenth deal cost
    // the same as the first.
    setFu({ deal_id: d.id, title: `Follow up: ${d.title}`, due_at: nextMorning() });
  }

  /**
   * Schedule the missing follow-up on one deal.
   *
   * The refresh afterwards is the confirmation: the deal leaves the filtered
   * set and the count above it drops. A toast alone would leave the row sitting
   * in a list of deals with no follow-up right after one was given one.
   */
  async function saveFollowUp() {
    if (!fu) return;
    setFuSaving(true);
    try {
      await api.post('/v1/graha/follow-ups', {
        deal_id: fu.deal_id,
        title: fu.title.trim(),
        due_at: fu.due_at,
      });
      pushToast({ title: 'Follow-up scheduled', type: 'success' });
      setFu(null);
      load();
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Could not schedule the follow-up'), type: 'error' });
    }
    finally { setFuSaving(false); }
  }

  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  const field = (label, node) => (
    <label className="gr__f"><span className="gr__fl">{label}</span>{node}</label>
  );

  /* What `meta.total` counts, in words. Read off `meta` rather than off the
     select: with a stage applied the figure is that stage's and not the
     pipeline's, and spelling it "open deals have no follow-up" put a narrowed
     count a few pixels under a banner reporting the whole pipeline, with nothing
     on screen accounting for the gap. */
  const scope = meta.stage
    ? `open ${meta.stage} ${meta.total === 1 ? 'deal' : 'deals'}`
    : `open ${meta.total === 1 ? 'deal' : 'deals'}`;

  return (
    <div>
      <div className="gr__bar">
        <select className="k-input gr__sel" aria-label="Filter by stage" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" onClick={load}>Filter</button>
        <label className="gr__fl">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => { setShowArchived(e.target.checked); setReload(n => n + 1); }}
          />
          {' '}Include archived
        </label>
        <div className="gr__spacer" />
        <button className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}
          onClick={() => { setShowForm(true); loadFormData(); }}>+ New Deal</button>
      </div>

      {/* A list this much shorter than the pipeline has to say why it is short,
          and offer the way back in the same breath. Without both, the reader's
          available conclusion is that the CRM lost their deals. */}
      {noFollowUp && (
        <>
          <div className="gr__chips">
            <span className="gr__chip" style={{ '--c': 'var(--warn)' }}>
              No follow-up scheduled
              <button type="button" className="gr__chipx" aria-label="Show all deals again"
                onClick={clearNoFollowUp}>×</button>
            </span>
          </div>
          {/* The paragraph is mounted from the first paint and its SENTENCE
              waits: `meta` starts at zero, so a count printed through the load
              says "0 open deals have no follow-up" under a banner that just
              said 512 — and `role="status"` reads that number out. A live
              region has to exist before its text arrives to be announced at
              all, so this stays empty rather than being mounted late. A failed
              load empties it too: `meta` still holds the previous answer, and
              an error is no place to keep asserting it.
              `fetching`, not `loading`: only the first load sets `loading`, so
              on every later one — clearing the chip and pressing Fix again, or
              applying a stage — the PREVIOUS query's answer stayed on screen
              and was announced under the new chip. */}
          <p className="gr__lede" role="status">
            {fetching || err ? '' : (meta.truncated
              ? `Showing the first ${deals.length} of ${meta.total} ${scope} with no follow-up. Schedule one and it leaves this list.`
              : `${meta.total} ${scope} ${meta.total === 1 ? 'has' : 'have'} no follow-up. Schedule one and it leaves this list.`)}
          </p>
        </>
      )}

      {/* The unfiltered list is capped at the same 200 and has been as long as
          this router has existed. Held back through a fetch and through an
          error for the same reason as the line above: `meta` is the last answer
          that arrived, and a caveat about rows that are no longer on screen is
          a claim nobody made. */}
      {!noFollowUp && !fetching && !err && meta.truncated && (
        <p className="gr__lede" role="status">
          Showing the first {deals.length} of {meta.total} deals — filter by stage to reach the rest.
        </p>
      )}

      {showForm && (
        <form onSubmit={save} className="gr__panel">
          <h3 className="gr__ptitle">New Deal</h3>
          <div className="gr__grid">
            {field('Title *', <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />)}
            {field('Client / Company', (
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {dealClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ))}
            {field('Contact', (
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select>
            ))}
            {field('Value (₹)', <input className="k-input" type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />)}
            {field('Territory', (
              <select className="k-input" value={form.territory_id} onChange={e => setForm({ ...form, territory_id: e.target.value })}>
                <option value="">— None —</option>
                {territories.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ))}
            {/* WHO OWNS IT. See the note beside `members` above: this column
                is read by three screens, written by none, and it is the join
                Vikray's target attainment stands on. */}
            {field('Assigned to', (
              <select
                className="k-input"
                aria-label="Assigned to"
                value={form.assigned_to}
                disabled={!members.length}
                title={members.length ? undefined
                  : 'Only an organisation admin can list members, so a deal cannot be assigned from here.'}
                onChange={e => setForm({ ...form, assigned_to: e.target.value })}
              >
                <option value="">— Unassigned —</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || m.email}
                  </option>
                ))}
              </select>
            ))}
            {/* ⚠ ONLY WHEN THERE IS A CHOICE TO MAKE. With one pipeline the
                select would be a control with a single option that cannot be
                got wrong, and `create_deal` already puts the deal there. It
                appears the moment a second exists, which is also the moment it
                starts to matter. Blank sends nothing and keeps the server's own
                default — the behaviour every deal in the product has had. */}
            {pipelines.length > 1 && field('Pipeline', (
              <select className="k-input" value={form.pipeline_id || ''}
                onChange={e => setForm({ ...form, pipeline_id: e.target.value })}>
                <option value="">— The default —</option>
                {pipelines.map(pp => (
                  <option key={pp.id} value={String(pp.id)}>
                    {pp.name}{pp.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            ))}
            {field('Stage', (
              <select className="k-input" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ))}
            {field('Probability (%)', <input className="k-input" type="number" min="0" max="100" value={form.probability} onChange={e => setForm({ ...form, probability: parseInt(e.target.value, 10) || 0 })} />)}
            {field('Expected Close', <DateInput className="k-input" type="date" value={form.expected_close_date} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} />)}
            {/* The org's own fields — see CustomFieldInputs.jsx. */}
            <CustomFieldInputs
              entity="deal"
              value={form.custom_data}
              onChange={cd => setForm({ ...form, custom_data: cd })}
              field={field}
            />
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Deal'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading deals"><SkeletonList rows={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : deals.length === 0 ? (
        /* "No deals yet" under the filter would be a second wrong statement
           about the pipeline — the deals exist, they all have a follow-up.
           And with a stage chosen the sentence narrows again: an empty answer
           to "Proposal AND no follow-up" says nothing about the other stages,
           so claiming the whole pipeline is covered would contradict the banner
           counting 512 three lines above.
           The branch turns on `meta.stage`, the stage this empty answer came
           back from, not on the select. The select is a draft until Filter is
           pressed, so reading it here let a stage nobody had applied rewrite
           the sentence — and let clearing the select back to "All Stages"
           claim the whole pipeline while the list was still narrowed. */
        noFollowUp ? (
          meta.stage ? (
            <EmptyState
              illustration="generic"
              title={{ en: `No ${meta.stage} deal is missing a follow-up`, hi: 'इस चरण में कुछ भी शेष नहीं' }}
              description={`This list is narrowed to ${meta.stage}, and it counts open deals only. Show every stage to see the rest of the pipeline.`}
              action="Show every stage"
              onAction={() => { setStageFilter(''); setReload(n => n + 1); }}
            />
          ) : (
            <EmptyState
              illustration="generic"
              title={{ en: 'Every open deal has a follow-up', hi: 'हर खुले सौदे पर अनुसरण है' }}
              description="Nothing in the pipeline is missing a follow-up. Clear the filter to see every deal again."
              action="Show all deals"
              onAction={clearNoFollowUp}
            />
          )
        ) : (
          <EmptyState
            illustration="generic"
            title={{ en: 'No deals yet', hi: 'कोई सौदा नहीं' }}
            description="Track your sales pipeline here. Add your first opportunity to see it move through the stages."
            action={canWrite ? 'New Deal' : undefined}
            onAction={canWrite ? () => { setShowForm(true); loadFormData(); } : undefined}
          />
        )
      ) : (
        <div className="gr__cards">
          {deals.map(d => (
            <div key={d.id} className={`gr__card${pending.has(d.id) ? ' ix-pending' : ''}`}>
              <div className="gr__crow">
                <div>
                  {/* Was a <span onClick>. A control that opens an editor has
                      to be a button or it does not exist for the keyboard.
                      It opens the deal's own URL now, so the same press is
                      also a link somebody can copy out of the address bar. */}
                  <button type="button" className="gr__link" onClick={() => openDeal(d.id)}>{d.title}</button>
                  {d.client_name && <span className="gr__kbco"> {d.client_name}</span>}
                  {d.contact_name && <span className="gr__ls"> {d.contact_name} {d.contact_company && `· ${d.contact_company}`}</span>}
                </div>
                <div className="gr__cside">
                  <span className="gr__val">{inr(Number(d.value))}</span>
                  <Badge text={d.stage} color={stageColor(d.stage)} />
                  {d.archived_at && <Badge text="Archived" color="var(--on-surface-3)" />}
                  {d.stage !== 'Won' && d.stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                </div>
              </div>
              <div className="gr__cmeta">
                <span>Probability: {d.probability}%</span>
                {d.expected_close_date && <span>Close: {d.expected_close_date}</span>}
                {d.territory_name && <span>Territory: {d.territory_name}</span>}
                <div className="gr__spacer" />
                {/* Only under the filter, and only for someone who may
                    write: the list is worth reading either way, but an
                    offer to schedule that ends in a 403 is worse than no
                    offer. */}
                {noFollowUp && canWrite && (
                  <button className="k-btn k-btn--primary" onClick={() => startFollowUp(d)}>Schedule follow-up</button>
                )}
                {/* Both open the record. Editing a deal and writing a note
                    on it are the same screen there, which is what stops the
                    two from holding different ideas of the same row. */}
                <button className="k-btn k-btn--ghost" onClick={() => openDeal(d.id)}>Edit</button>
                <button className="k-btn k-btn--ghost" onClick={() => openDeal(d.id)}>Notes</button>
                <button className="k-btn k-btn--reject" onClick={() => deleteDeal(d.id, d.title)}>Delete</button>
                {/* The sweep does this by itself after seven days; these are
                    for doing it now, and for undoing it. */}
                {(d.stage === 'Won' || d.stage === 'Lost') && !d.archived_at && (
                  <button className="k-btn k-btn--ghost" onClick={() => setArchived(d, true)}>Archive</button>
                )}
                {d.archived_at && (
                  <button className="k-btn k-btn--ghost" onClick={() => setArchived(d, false)}>Unarchive</button>
                )}
                {d.stage === 'Won' && (
                  <>
                    {/* Order BEFORE invoice, and both offered. Invoicing a
                        deal skips the order entirely, which leaves stock
                        untouched — fine for a service, wrong for goods. */}
                    <button className="k-btn k-btn--primary" onClick={() => createOrder(d.id)}>Create Sales Order</button>
                    <button className="k-btn k-btn--primary" onClick={() => createInvoice(d.id)}>Create Invoice</button>
                  </>
                )}
                {stages.filter(s => s !== d.stage && s !== 'Lost').map(s => (
                  <button key={s} className="k-btn k-btn--ghost" onClick={() => updateStage(d.id, s)}>{s}</button>
                ))}
              </div>
              {fu?.deal_id === d.id && (
                <div className="gr__cedit">
                  <div className="gr__grid">
                    {field('Title *', <input className="k-input" value={fu.title} onChange={e => setFu({ ...fu, title: e.target.value })} />)}
                    {field('Due *', <DateInput className="k-input" type="datetime-local" required value={fu.due_at} onChange={e => setFu({ ...fu, due_at: e.target.value })} />)}
                  </div>
                  <div className="gr__acts gr__acts--tight">
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setFu(null)}>Cancel</button>
                    <button type="button" className="k-btn k-btn--primary"
                      disabled={fuSaving || !fu.title.trim() || !fu.due_at}
                      onClick={saveFollowUp}>{fuSaving ? 'Scheduling…' : 'Schedule'}</button>
                  </div>
                </div>
              )}
              {/* The note still READS here — it is one of the few things
                  about a deal worth seeing without opening it. Only the
                  editor moved. */}
              {d.notes && <div className="gr__cnote">{d.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
