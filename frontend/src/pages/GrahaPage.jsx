// Graha · ग्रह — CRM route shell.
//
// This file was 2,648 lines and 148 KB. Per 13-module-pages.md the module pages
// are split into a route file plus a directory of tab components BEFORE any
// styling is applied: a restyle of a single-file module touches every tab, every
// table and every form at once, and the diff is unreviewable.
//
// Now on the shared .mh/.mt chrome from 13-module-pages.md §1.
//
// ── Pipeline-first ────────────────────────────────────────────────────────
// The rendered reference (`design-reference/Kartavaya Redesign/ScreensCore.jsx`,
// under the comment "Graha (CRM) — pipeline-first, per research") opens this
// module on `pipeline`, not on `today`, and puts four figures and a
// deals-without-a-next-step warning above the board. The build opened on
// `today` with no figures at all, so the first thing a CRM showed you was a
// task list rather than the state of your pipeline.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api, rows, body } from '../lib/api';

import TodayTab from './graha/TodayTab';
import ClientsTab from './graha/ClientsTab';
import ContactsTab from './graha/ContactsTab';
import DealsTab from './graha/DealsTab';
import KanbanTab from './graha/KanbanTab';
import PipelineTab from './graha/PipelineTab';
import FollowUpsTab from './graha/FollowUpsTab';
import LabelsTab from './graha/LabelsTab';
import ActivitiesTab from './graha/ActivitiesTab';
import ReportsTab from './graha/ReportsTab';
import TerritoriesTab from './graha/TerritoriesTab';
import CustomFieldsTab from './graha/CustomFieldsTab';
import WebFormsTab from './graha/WebFormsTab';
import ApprovalsTab from './graha/ApprovalsTab';
import DocumentsTab from './graha/DocumentsTab';
import DedupeTab from './graha/DedupeTab';
// The universal analytics surface, pointed at Graha's slice of the registry.
import { ModuleAnalyticsTab } from './dristi/AnalyticsTab';
// The blended client report (A5). It LIVES in dristi/ because the window and
// panel vocabulary do, but its natural audience is here — the endpoint serves
// Graha-only callers, and until this import its only door was Dristi's.
import ClientReportTab from './dristi/ClientReportTab';
import BillingProfilesTab from './ganit/BillingProfilesTab';

const TABS = [
  ['today', TodayTab], ['clients', ClientsTab], ['contacts', ContactsTab],
  ['deals', DealsTab], ['kanban', KanbanTab], ['pipeline', PipelineTab],
  ['follow-ups', FollowUpsTab], ['labels', LabelsTab], ['activities', ActivitiesTab],
  ['reports', ReportsTab], ['territories', TerritoriesTab],
  ['fields', CustomFieldsTab], ['web-forms', WebFormsTab], ['approvals', ApprovalsTab],
  ['documents', DocumentsTab], ['dedupe', DedupeTab],
  ['analytics', () => <ModuleAnalyticsTab module="graha" />],
  ['client-report', ClientReportTab],
  ['billing', BillingProfilesTab],
];

const lakh = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

export default function GrahaPage() {
  // Tab prefs (proposal 67). This page reads its tab from local state only —
  // no URL param, no route state — so the starred default decides where the
  // module opens; `picked` (a click, the header's + New deal, the no-follow-up
  // warning) wins from the first choice. `pipeline` stays the shipped default.
  const prefs = useTabPrefs('graha', TABS.map(([id]) => id), { fallback: 'pipeline' });
  // ── The open tab lives in the URL ──────────────────────────────────────
  //
  // It used to be `useState(null)`, and the comment above still described that
  // world: "no URL param, no route state". Two things were wrong with it.
  //
  // A tab nobody can link to cannot be shared, cannot be bookmarked, and does
  // not survive a refresh — every reload dropped the reader back on the starred
  // default, whichever tab they were actually working in.
  //
  // And it broke the record routes added beside this page. ``/graha/deals/:dealId`` renders
  // as a CHILD of this module so the list stays mounted underneath, which is
  // what makes Back return to the list the reader left. But a COLD arrival —
  // a bookmark, a link from an email — mounted this page with no state at all,
  // so the list underneath was the starred default rather than the one the
  // record belongs to. Back landed them somewhere they had never been.
  //
  // `replace: true` on a tab switch, deliberately: hopping tabs should not fill
  // the history stack, so Back leaves the module rather than walking backwards
  // through every tab visited. Opening a record is a real push and stays one.
  //
  // Precedence is URL, then the starred default. There is no third source —
  // `setTab` writes the URL, so every existing caller keeps working and there
  // is exactly one answer to "which tab is open".
  const [params, setParams] = useSearchParams();
  const urlTab = params.get('tab');
  const tab = TABS.some((([id]) => id === urlTab)) ? urlTab : prefs.defaultTab;
  const setTab = useCallback((next) => {
    setParams((prev) => {
      // Mutating the existing params rather than replacing them: this page
      // carries others, and a fresh URLSearchParams would silently drop them.
      const p = new URLSearchParams(prev);
      p.set('tab', next);
      return p;
    }, { replace: true });
  }, [setParams]);

  const [customize, setCustomize] = useState(false);
  const [newDealNonce, setNewDealNonce] = useState(0);
  // A counter, for the same reason `newDealNonce` is one: pressing Fix, clearing
  // the filter on the Deals tab, then pressing Fix again has to re-apply it, and
  // a boolean would already be `true` the second time.
  const [focusNoFollowUp, setFocusNoFollowUp] = useState(0);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // Seventeen tabs, and switching between them had no motion at all: the
  // underline teleported and the panel swapped between one frame and the next.
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `VikrayPage.jsx:47`.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');
  const [counts, setCounts] = useState({});
  // Open deals carrying no pending follow-up. The reference reads this off
  // `deal.next`; the build has no such column — a scheduled follow-up IS a row
  // in staging.graha_follow_ups.
  const [noNext, setNoNext] = useState(null);
  // Only the newest count may write. The recount below is debounced, which
  // coalesces a burst but does not serialise anything: two writes further apart
  // than the debounce start two overlapping GETs, and if the earlier one answers
  // second the banner settles on the count from BEFORE the last write and sits
  // there until something else writes. That is the same wrong-number-on-screen
  // this whole path exists to stop.
  const noNextSeq = useRef(0);

  // The server counts this, and the browser does not. Subtracting the two lists
  // here meant subtracting two pages that each stop at 200: for an org with 512
  // open deals and one follow-up the banner could only ever say ~200,
  // understating by more than half with nothing on screen admitting it.
  // `?no_follow_up=true` applies both conditions in the WHERE clause, so the
  // envelope's `total` is a COUNT over every matching row, not over a page.
  const loadNoNext = useCallback(async () => {
    const seq = ++noNextSeq.current;
    try {
      const { total } = body(await api.get('/v1/graha/deals?no_follow_up=true'));
      if (seq === noNextSeq.current) setNoNext(Number(total) || 0);
    } catch { if (seq === noNextSeq.current) setNoNext(null); }
  }, []);

  useEffect(() => { loadSummary(); }, []);

  /**
   * Recount after any write to this module.
   *
   * The banner and the panel beneath it state ONE fact, and only the panel
   * refetched it. Scheduling a follow-up on the Deals tab reloads that tab, so
   * its lede dropped to "0 open deals have no follow-up" while this banner, a
   * few pixels above, still said 3 and still offered a Fix for work that was
   * already done. Creating a deal moves the true count the other way and the
   * banner did not follow that either.
   *
   * There is no callback to hang this on: every tab owns its own loads and none
   * of them reports back, so the only place the page can learn that a write
   * landed is the response itself. GET is excluded or the recount would
   * retrigger itself, and the eject is what keeps this from outliving the page —
   * `api` is one module-level instance shared by the whole app.
   */
  useEffect(() => {
    let timer = null;
    const id = api.interceptors.response.use((r) => {
      const method = String(r?.config?.method || 'get').toLowerCase();
      if (method !== 'get' && String(r?.config?.url || '').includes('/v1/graha/')) {
        // Coalesced: moving a deal's stage and then saving its notes are two
        // writes a moment apart, and each would otherwise buy its own round trip.
        clearTimeout(timer);
        timer = setTimeout(loadNoNext, 400);
      }
      return r;
    });
    return () => { clearTimeout(timer); api.interceptors.response.eject(id); };
  }, [loadNoNext]);

  async function loadSummary() {
    setKpiErr('');
    try {
      const [fr, cr] = await Promise.all([
        api.get('/v1/graha/reports/forecast'),
        api.get('/v1/graha/reports/conversion?days=90'),
      ]);
      const f = body(fr);
      const c = body(cr);
      const openDeals = (f.stages || []).reduce((s, r) => s + Number(r.count || 0), 0);
      setKpi([
        { label: 'Open pipeline', hi: 'प्रवाह', tone: 'p', value: lakh(f.total_pipeline), sub: `${openDeals} ${openDeals === 1 ? 'deal' : 'deals'}` },
        { label: 'Weighted forecast', hi: 'अनुमान', value: lakh(f.weighted_forecast), sub: 'by stage probability' },
        // `c.won` counts deals CLOSED in the 90 days (on `won_at`); `c.total_deals`
        // counts deals OPENED in them. "3 of 10 deals" read as a ratio of one
        // population and was never that, so the sub-line names the two halves
        // separately rather than joining them with the word "of".
        { label: 'Won in last 90 days', hi: 'विजित', tone: 'ok', value: lakh(c.won_value), sub: `${c.won} closed · ${c.total_deals} opened` },
        { label: 'Avg cycle', hi: 'चक्र', value: c.avg_cycle_days ? `${c.avg_cycle_days}d` : '—', sub: c.avg_cycle_days ? 'from open to won' : 'no closed deals yet' },
      ]);
      setCounts(k => ({ ...k, pipeline: openDeals }));
    } catch (e) {
      setKpi(null);
      setKpiErr(e.response?.status === 403 ? 'You do not have access to CRM reports.' : 'Retry, or check your connection.');
    }
    // Contact count and the no-next-step count are independent of the KPI call:
    // one failing must not blank the other.
    try {
      const r = await api.get('/v1/graha/contacts');
      setCounts(k => ({ ...k, contacts: rows(r).length }));
    } catch { /* the tab simply carries no count */ }
    await loadNoNext();
  }

  const tabs = prefs.order.map(id => ({ id, label: id.replace(/-/g, ' '), count: counts[id] }));

  return (
    <div className="mpage">
      <ModuleHeader
        module="graha"
        kick="section.revenue"
        en="CRM"
        hi="graha"
        // Not "every deal carries its next step". That stated as a product fact
        // the exact thing the warning forty pixels below it exists to deny, and
        // it said it in a phrase this module's UI uses nowhere else — the tab,
        // the filter chip and the banner all say follow-up.
        sub="Clients, deals, and the follow-up each open deal is waiting on."
        icon={ICONS.graha}
        actions={
          // `btn btn--fill btn--sm`, not `k-btn k-btn--primary` with a 13px
          // override. That is the reference's own vocabulary for this control —
          // `ScreensCore.jsx`:123 gives ScreenGraha's "New deal" exactly these
          // classes — and it is what VikrayPage's header button already uses,
          // so the two module headers now match instead of being a size apart.
          <button
            type="button"
            className="btn btn--fill btn--sm"
            onClick={() => { setTab('deals'); setNewDealNonce(n => n + 1); }}
          >
            + New deal
          </button>
        }
      />

      {/* Tabs above the figures — Graha is the one module where the reference
          orders it this way, because the tab row shares its line with the
          no-follow-up warning. Ganit and Vikray put figures first. */}
      <div className="mrow">
        <ModuleTabs
          tabs={tabs} value={tab} onChange={setTab} label="Graha sections"
          defaultTab={prefs.defaultTab}
          // Pin the open tab first: saving a new "opens here" from the sheet
          // must not yank the panel the user is reading.
          onCustomize={() => { setTab(tab); setCustomize(true); }}
        />
        {noNext > 0 && (
          // Fix lands on Deals, not Follow-ups. Follow-ups lists the follow-ups
          // that EXIST — the complement of what this banner counts — so pressing
          // it used to show the user the one set they were not being warned
          // about, and the deals missing a follow-up were unreachable from here.
          //
          // The recount is not covered by the interceptor above: it catches the
          // writes made from THIS page, and this figure also moves when a
          // colleague schedules something or the Niyam sweep closes an item. A
          // door is the one moment worth paying a round trip to be sure.
          <button
            type="button"
            className="mwarn"
            onClick={() => { setTab('deals'); setFocusNoFollowUp(n => n + 1); loadNoNext(); }}
          >
            {noNext} {noNext === 1 ? 'open deal has' : 'open deals have'} no follow-up scheduled
            <span className="mwarn__do">Fix</span>
          </button>
        )}
      </div>

      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={tabs} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <div
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        key={panelKey}
        {...motion}
      >
        {tab === 'deals'
          ? <DealsTab newNonce={newDealNonce} focusNoFollowUp={focusNoFollowUp} />
          : <Active />}
      </div>
    </div>
  );
}
