// Graha · `/graha/deals/:dealId` — one deal, as a URL.
//
// ── What this replaces ──────────────────────────────────────────────────────
//
// A deal could only be opened by swapping its card in `DealsTab` for a form
// held in that tab's local state. It had no address, so a salesperson could not
// bookmark one, send one to a colleague, press Back out of one, or reload
// without losing it — and every notification or email that wanted to point at a
// deal had nowhere to point.
//
// The edit form and the notes editor MOVED here; they were not copied. There is
// one screen that changes a deal, so there is nothing for a second one to
// disagree with.
//
// ── Why a drawer and not a full page ────────────────────────────────────────
//
// `27-vikray.md` §6 settled this for the sales order and the argument is the
// same one: everywhere else in the product, opening a record opens a drawer
// over the list it came from. Two navigation models for "open this row" is a
// learned inconsistency and it is the one learned second that costs the reader.
// This uses the shared `.dr` chrome — scrim, focus trap, Escape, exit
// animation — so it is the same object the task drawer and the order drawer
// are, not one that resembles them.
//
// The list underneath is genuinely still there: `GrahaModule` renders this
// through an `<Outlet/>`, so `GrahaPage` never unmounted and Back returns the
// reader to the tab, the stage filter and the chip they left.
//
// ── Cold arrival ────────────────────────────────────────────────────────────
//
// Nothing here reads the list. The id comes from the path and the record comes
// from `GET /v1/graha/deals/{id}`, which is org-scoped and carries `client_name`
// from its own join — so a link opened in a fresh tab, with no Graha state in
// memory at all, renders the same record it renders after a click.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import FocusTrap from '../../components/ui/FocusTrap';
import DateInput from '../../components/ui/DateInput';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import CustomFieldInputs from './CustomFieldInputs';
import {
  RotBadge, Badge, stageColor, dealsChanged, isRecordId, notFound,
} from './_shared';

/** The default pipeline stages, as `DealsTab` spells them. */
const STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

/** `YYYY-MM-DD` out of whatever the column hands back, or ''. */
const asDate = v => (typeof v === 'string' ? v.slice(0, 10) : '');

export default function DealRoute() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // F32 — the module comes from the route, and `/graha/deals/…` resolves to
  // graha through the same longest-prefix match the topbar title uses.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change deals' });
  const { pushToast } = useToast();

  const [deal, setDeal] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed load must never render as an empty record. `deal` stays null and
  // this decides what is drawn — the distinction `grahaTabStates.test.jsx`
  // exists to keep.
  const [err, setErr] = useState(null);

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    // A path segment that cannot be an id never becomes a request — see
    // `isRecordId`. The reader gets "this doesn't exist" and a way back rather
    // than a 422 rendered as "that request wasn't accepted", which describes
    // something they did not do.
    if (!isRecordId(dealId)) {
      setErr(notFound());
      setDeal(null);
      setLoading(false);
      return;
    }
    try {
      const b = body(await api.get(`/v1/graha/deals/${dealId}`));
      setDeal(b?.deal || null);
      setActivities(Array.isArray(b?.activities) ? b.activities : []);
      // A 200 with no deal in it would otherwise paint an empty record.
      if (!b?.deal) setErr(notFound());
    } catch (e) {
      setErr(e);
      setDeal(null);
      setActivities([]);
    } finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Closing is a navigation, so Back, Escape and the × all mean one thing.
   *
   * `key` is `'default'` only on a history entry this app never pushed — a
   * fresh tab on a pasted link, or the first page of a session. Anything else
   * means the list is one step back, and `-1` returns the reader to it without
   * leaving a dead entry behind. Cold, there is nothing to go back TO, so the
   * module page replaces the record's own entry. Read once into a ref: the
   * question is how the reader ARRIVED, and the location may move under us.
   */
  const arrivedFromApp = useRef(location.key !== 'default');
  const finishClose = useCallback(() => {
    if (arrivedFromApp.current) navigate(-1);
    else navigate('/graha', { replace: true });
  }, [navigate]);

  const requestClose = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
  }, []);

  // The exit animation runs before the navigation, exactly as the order drawer
  // does — a panel that vanishes on the same frame as the click reads as a
  // crash rather than as a dismissal.
  const onExitEnd = useCallback(e => {
    if (e.target !== e.currentTarget || !closingRef.current) return;
    closingRef.current = false;
    finishClose();
  }, [finishClose]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); requestClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  function startEdit() {
    setDraft({
      title: deal.title || '',
      value: deal.value ?? '',
      stage: deal.stage || 'New',
      probability: deal.probability ?? 20,
      expected_close_date: asDate(deal.expected_close_date),
      notes: deal.notes || '',
      custom_data: deal.custom_data || {},
    });
  }

  /**
   * PATCH the deal. The payload is `DealsTab`'s, unchanged — including the two
   * deletes, which matter: the endpoint takes a partial and sending an empty
   * string for a date is not the same as not sending the field.
   *
   * `dealsChanged()` is what keeps the row behind this drawer honest. Without
   * it the list still showed the old title and the old value while this screen
   * showed the new ones — one record, two answers.
   */
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...draft, value: parseFloat(draft.value) || 0 };
      if (!payload.expected_close_date) delete payload.expected_close_date;
      if (!payload.notes) delete payload.notes;
      await api.patch(`/v1/graha/deals/${dealId}`, payload);
      pushToast({ title: 'Deal updated', type: 'success' });
      setDraft(null);
      await load();
      dealsChanged();
    } catch (e2) {
      pushToast({ title: e2.response?.data?.detail || 'Could not update deal', type: 'error' });
    } finally { setSaving(false); }
  }

  const field = (label, node) => (
    <label className="gr__f"><span className="gr__fl">{label}</span>{node}</label>
  );

  const d = deal;
  const party = d && [d.client_name, d.contact_name, d.contact_company].filter(Boolean).join(' · ');

  const panel = (
    <div
      className={`dr__scrim${closing ? ' is-closing' : ''}`}
      role="presentation"
      onClick={e => e.target === e.currentTarget && requestClose()}
    >
      <FocusTrap active>
        <div
          className={`dr${closing ? ' is-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={d ? `Deal ${d.title}` : 'Deal'}
          onAnimationEnd={onExitEnd}
        >
          <header className="dr__head">
            <div className="dr__crumb">
              <span className="dr__crumb-p">CRM</span>
              <span className="dr__crumb-sep">/</span>
              <span className="dr__crumb-t">{d ? d.title : 'Deal'}</span>
            </div>
            <div className="dr__acts">
              <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
            </div>
          </header>

          {err ? (
            // A deal that was deleted, or that belongs to another firm, is a
            // fact and not an outage: `missing` and `request` say so and offer
            // the list back. Without `backTo` the drawer would be a sentence
            // with no way out of it.
            <div className="dr__body">
              <ErrorState
                kind={errorKind(err)}
                onRetry={load}
                backTo={requestClose}
                backLabel="Back to deals"
              />
            </div>
          ) : loading || !d ? (
            <div className="dr__body">
              <SkeletonRegion label="Loading the deal"><SkeletonList rows={5} /></SkeletonRegion>
            </div>
          ) : (
            <div className="dr__body">
              <div className="gr__dhead">
                <h2 className="gr__dname">{d.title}</h2>
                <div className="gr__dacts">
                  <span className="gr__val">{inr(Number(d.value))}</span>
                  <Badge text={d.stage} color={stageColor(d.stage)} />
                  {d.archived_at && <Badge text="Archived" color="var(--on-surface-3)" />}
                  {d.stage !== 'Won' && d.stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                </div>
              </div>

              {/* The company and the person, by NAME. The endpoint joins
                  `graha_clients` for exactly this — it used to return the
                  company id and no name, so a detail screen held a uuid it was
                  not allowed to draw and had nothing to put here. */}
              {party && <div className="gr__dline">{party}</div>}

              <section className="dr__sec">
                <h3 className="dr__lbl">Deal<Secondary className="dr__lbl-hi" value="सौदा" /></h3>
                <div className="gr__dgrid">
                  <div className="gr__dpair">Probability: {d.probability}%</div>
                  {d.expected_close_date && (
                    <div className="gr__dpair">Expected close: {asDate(d.expected_close_date)}</div>
                  )}
                  {d.territory_name && <div className="gr__dpair">Territory: {d.territory_name}</div>}
                  {d.contact_email && <div className="gr__dpair">{d.contact_email}</div>}
                </div>
              </section>

              {d.notes && !draft && (
                <section className="dr__sec">
                  <h3 className="dr__lbl">Notes<Secondary className="dr__lbl-hi" value="टिप्पणी" /></h3>
                  <p className="gr__dnotes">{d.notes}</p>
                </section>
              )}

              {!draft && (
                <div className="gr__acts gr__acts--start">
                  <button
                    type="button"
                    className="k-btn k-btn--primary"
                    disabled={!canWrite}
                    title={denial || undefined}
                    onClick={startEdit}
                  >
                    Edit deal
                  </button>
                </div>
              )}

              {draft && (
                <form className="dr__sec" onSubmit={save}>
                  <h4 className="gr__ptitle gr__ptitle--sm">Edit Deal</h4>
                  <div className="gr__grid">
                    {field('Title *', <input className="k-input" required value={draft.title}
                      onChange={e => setDraft({ ...draft, title: e.target.value })} />)}
                    {field('Value (₹)', <input className="k-input" type="number" value={draft.value}
                      onChange={e => setDraft({ ...draft, value: e.target.value })} />)}
                    {field('Stage', (
                      <select className="k-input" value={draft.stage}
                        onChange={e => setDraft({ ...draft, stage: e.target.value })}>
                        {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ))}
                    {field('Probability (%)', <input className="k-input" type="number" min="0" max="100"
                      value={draft.probability}
                      onChange={e => setDraft({ ...draft, probability: parseInt(e.target.value, 10) || 0 })} />)}
                    {/* Never a native date input — see `ui/DateInput.jsx`. */}
                    {field('Expected Close', <DateInput className="k-input" type="date"
                      value={draft.expected_close_date}
                      onChange={e => setDraft({ ...draft, expected_close_date: e.target.value })} />)}
                    {/* The org's own fields, the same component the list's
                        create form uses — a record that cannot edit them is a
                        record that silently drops them. */}
                    <CustomFieldInputs
                      entity="deal"
                      value={draft.custom_data}
                      onChange={cd => setDraft({ ...draft, custom_data: cd })}
                      field={field}
                    />
                  </div>
                  <label className="gr__f gr__f--block"><span className="gr__fl">Notes</span>
                    <textarea className="k-input gr__ta" rows={3} value={draft.notes}
                      onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
                  <div className="gr__acts">
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setDraft(null)}>Cancel</button>
                    <button type="submit" className="k-btn k-btn--primary"
                      disabled={saving || !canWrite} title={denial || undefined}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              )}

              <section className="dr__sec">
                <h3 className="dr__lbl">Activity<Secondary className="dr__lbl-hi" value="गतिविधि" /></h3>
                {activities.length === 0 ? (
                  <p className="dr__empty">Nothing has been logged against this deal.</p>
                ) : (
                  activities.map(a => (
                    <div key={a.id} className="gr__lrow gr__lrow--tight">
                      <div className="gr__lmain">
                        <span className="gr__lt--sm">{a.title || a.activity_type}</span>
                        <div className="gr__ls">
                          {a.activity_type}
                          {a.scheduled_at ? ` · ${asDate(a.scheduled_at)}` : ''}
                          {a.is_completed ? ' · done' : ''}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
        </div>
      </FocusTrap>
    </div>
  );

  return createPortal(panel, document.body);
}
