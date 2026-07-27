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
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';

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
import AutomationsTab from './graha/AutomationsTab';
import TerritoriesTab from './graha/TerritoriesTab';
import CustomFieldsTab from './graha/CustomFieldsTab';
import WebFormsTab from './graha/WebFormsTab';
import ApprovalsTab from './graha/ApprovalsTab';
import DocumentsTab from './graha/DocumentsTab';
import DedupeTab from './graha/DedupeTab';

const TABS = [
  ['today', TodayTab], ['clients', ClientsTab], ['contacts', ContactsTab],
  ['deals', DealsTab], ['kanban', KanbanTab], ['pipeline', PipelineTab],
  ['follow-ups', FollowUpsTab], ['labels', LabelsTab], ['activities', ActivitiesTab],
  ['reports', ReportsTab], ['automations', AutomationsTab], ['territories', TerritoriesTab],
  ['fields', CustomFieldsTab], ['web-forms', WebFormsTab], ['approvals', ApprovalsTab],
  ['documents', DocumentsTab], ['dedupe', DedupeTab],
];

const lakh = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

export default function GrahaPage() {
  const [tab, setTab] = useState('pipeline');
  const [newDealNonce, setNewDealNonce] = useState(0);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  // Seventeen tabs, and switching between them had no motion at all: the
  // underline teleported and the panel swapped between one frame and the next.
  // `key` is destructured out, never spread: React 19 drops a `key` inside a
  // spread, and the changing key IS the mechanism — see `VikrayPage.jsx:47`.
  const { key: panelKey, ...motion } = useTabPanelMotion(TABS.map(([id]) => id), tab);

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
      const [f, c] = await Promise.all([
        api.get('/v1/graha/reports/forecast'),
        api.get('/v1/graha/reports/conversion?days=90'),
      ]);
      const openDeals = (f.data.stages || []).reduce((s, r) => s + Number(r.count || 0), 0);
      setKpi([
        { label: 'Open pipeline', hi: 'प्रवाह', tone: 'p', value: lakh(f.data.total_pipeline), sub: `${openDeals} ${openDeals === 1 ? 'deal' : 'deals'}` },
        { label: 'Weighted forecast', hi: 'अनुमान', value: lakh(f.data.weighted_forecast), sub: 'by stage probability' },
        { label: 'Won this quarter', hi: 'विजित', tone: 'ok', value: lakh(c.data.won_value), sub: `${c.data.won} of ${c.data.total_deals} deals` },
        { label: 'Avg cycle', hi: 'चक्र', value: c.data.avg_cycle_days ? `${c.data.avg_cycle_days}d` : '—', sub: c.data.avg_cycle_days ? 'from open to won' : 'no closed deals yet' },
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
      setCounts(k => ({ ...k, contacts: (r.data.data || []).length }));
    } catch { /* the tab simply carries no count */ }
    try {
      const [d, f] = await Promise.all([
        api.get('/v1/graha/deals'),
        api.get('/v1/graha/follow-ups'),
      ]);
      const open = (d.data.data || []).filter(x => x.stage !== 'Won' && x.stage !== 'Lost');
      const covered = new Set((f.data.data || []).map(x => x.deal_id).filter(Boolean));
      setNoNext(open.filter(x => !covered.has(x.id)).length);
    } catch { setNoNext(null); }
  }

  const tabs = TABS.map(([id]) => ({ id, label: id.replace(/-/g, ' '), count: counts[id] }));

  return (
    <div style={{ padding: '0 0 48px' }}>
      <ModuleHeader
        module="graha"
        kick={<>Revenue <span className="mh__kick-hi" lang="hi">· राजस्व</span></>}
        en="CRM"
        hi="ग्रह"
        sub="Every deal carries its next step."
        icon={ICONS.graha}
        actions={
          <button
            type="button"
            className="k-btn k-btn--primary"
            style={{ fontSize: 13 }}
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
        <ModuleTabs tabs={tabs} value={tab} onChange={setTab} label="Graha sections" />
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
