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
import React, { useState, useEffect } from 'react';
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

const TABS = [
  ['today', TodayTab], ['clients', ClientsTab], ['contacts', ContactsTab],
  ['deals', DealsTab], ['kanban', KanbanTab], ['pipeline', PipelineTab],
  ['follow-ups', FollowUpsTab], ['labels', LabelsTab], ['activities', ActivitiesTab],
  ['reports', ReportsTab], ['territories', TerritoriesTab],
  ['fields', CustomFieldsTab], ['web-forms', WebFormsTab], ['approvals', ApprovalsTab],
  ['documents', DocumentsTab], ['dedupe', DedupeTab],
  ['analytics', () => <ModuleAnalyticsTab module="graha" />],
  ['client-report', ClientReportTab],
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
  // module opens; `picked` (a click, the header's + New deal, the no-next-step
  // warning) wins from the first choice. `pipeline` stays the shipped default.
  const prefs = useTabPrefs('graha', TABS.map(([id]) => id), { fallback: 'pipeline' });
  const [picked, setTab] = useState(null);
  const tab = picked ?? prefs.defaultTab;
  const [customize, setCustomize] = useState(false);
  const [newDealNonce, setNewDealNonce] = useState(0);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // Seventeen tabs, and switching between them had no motion at all: the
  // underline teleported and the panel swapped between one frame and the next.
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `VikrayPage.jsx:47`.
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');
  const [counts, setCounts] = useState({});
  // Deals carrying no open follow-up. The reference reads this off `deal.next`;
  // the build has no such column — a "next step" IS a follow-up row
  // (staging.graha_follow_ups), so it is derived by difference here.
  const [noNext, setNoNext] = useState(null);

  useEffect(() => { loadSummary(); }, []);

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
        { label: 'Won this quarter', hi: 'विजित', tone: 'ok', value: lakh(c.won_value), sub: `${c.won} of ${c.total_deals} deals` },
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
    try {
      const [d, f] = await Promise.all([
        api.get('/v1/graha/deals'),
        api.get('/v1/graha/follow-ups'),
      ]);
      const open = rows(d).filter(x => x.stage !== 'Won' && x.stage !== 'Lost');
      const covered = new Set(rows(f).map(x => x.deal_id).filter(Boolean));
      setNoNext(open.filter(x => !covered.has(x.id)).length);
    } catch { setNoNext(null); }
  }

  const tabs = prefs.order.map(id => ({ id, label: id.replace(/-/g, ' '), count: counts[id] }));

  return (
    <div className="mpage">
      <ModuleHeader
        module="graha"
        kick="section.revenue"
        en="CRM"
        hi="graha"
        sub="Every deal carries its next step."
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
          no-next-step warning. Ganit and Vikray put figures first. */}
      <div className="mrow">
        <ModuleTabs
          tabs={tabs} value={tab} onChange={setTab} label="Graha sections"
          defaultTab={prefs.defaultTab}
          // Pin the open tab first: saving a new "opens here" from the sheet
          // must not yank the panel the user is reading.
          onCustomize={() => { setTab(tab); setCustomize(true); }}
        />
        {noNext > 0 && (
          <button
            type="button"
            className="mwarn"
            onClick={() => setTab('follow-ups')}
          >
            {noNext} {noNext === 1 ? 'deal has' : 'deals have'} no next step
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
        {tab === 'deals' ? <DealsTab newNonce={newDealNonce} /> : <Active />}
      </div>
    </div>
  );
}
