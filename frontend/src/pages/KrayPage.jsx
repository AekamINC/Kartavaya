// Kray · क्रय — Procurement module page (proposal 85).
//
// Moved out of GanitPage so procurement is independently grantable, visible
// in the sidebar, and separately sellable. Same module-page pattern as every
// other module (ModuleHeader, ModuleTabs, KpiStrip).
import React, { useState, useEffect } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import useTabPrefs from '../components/module/useTabPrefs';
import CustomizeTabs from '../components/module/CustomizeTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';

import PurchaseOrdersTab from './procurement/PurchaseOrdersTab';
import VendorsTab from './kray/VendorsTab';
import PayablesTab from './ganit/PayablesTab';
import POApprovalsTab from './procurement/POApprovalsTab';
import BudgetsTab from './kray/BudgetsTab';
import KrayReportsTab from './kray/KrayReportsTab';
import KraySettingsTab from './kray/KraySettingsTab';
import RateCardsTab from './ganit/RateCardsTab';
import SLACreditsTab from './ganit/SLACreditsTab';
import AgeingTab from './ganit/AgeingTab';

const TABS = [
  ['purchase orders', PurchaseOrdersTab],
  ['vendors', VendorsTab],
  ['payables', PayablesTab],
  ['approvals', POApprovalsTab],
  ['budgets', BudgetsTab],
  ['rate-cards', RateCardsTab], ['sla-credits', SLACreditsTab], ['ageing', AgeingTab],
  ['reports', KrayReportsTab],
  ['settings', KraySettingsTab],
];

const lakh = n => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

export default function KrayPage() {
  const prefs = useTabPrefs('kray', TABS.map(([id]) => id), { fallback: 'purchase orders' });
  const [picked, setTab] = useState(null);
  const tab = picked ?? prefs.defaultTab;
  const [customize, setCustomize] = useState(false);
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  const { key: panelKey, ...motion } = useTabPanelMotion(prefs.order, tab);

  const [kpi, setKpi] = useState(null);
  const [kpiErr, setKpiErr] = useState('');

  useEffect(() => { loadKpi(); }, []);

  async function loadKpi() {
    setKpiErr('');
    try {
      const [po, pay] = await Promise.allSettled([
        api.get('/v1/procurement/reports/committed-spend'),
        api.get('/v1/ganit/payables-summary'),
      ]);
      const p = po.status === 'fulfilled' ? po.value.data : null;
      const b = pay.status === 'fulfilled' ? pay.value.data : null;

      setKpi([
        {
          label: 'Committed', hi: 'प्रतिबद्ध',
          value: p ? lakh(p.total || 0) : '—',
          sub: p ? `${p.orders || 0} open orders` : 'unavailable',
        },
        {
          label: 'Received', hi: 'प्राप्त', tone: 'ok',
          value: p?.budgets ? lakh(p.budgets.reduce((s, b2) => s + (b2.committed || 0), 0)) : '—',
          sub: 'across departments',
        },
        {
          label: 'Payables', hi: 'देय',
          value: b ? lakh(b.outstanding) : '—',
          sub: b ? `${b.open_bills} open ${b.open_bills === 1 ? 'bill' : 'bills'}` : 'unavailable',
        },
        {
          label: 'Overdue', hi: 'विलंब', tone: b && b.overdue > 0 ? 'danger' : undefined,
          value: b ? lakh(b.overdue || 0) : '—',
          sub: b && b.overdue > 0 ? 'MSME rule 43B(h) applies' : 'nothing past due',
        },
      ]);
    } catch {
      setKpi(null);
      setKpiErr('Retry, or check your connection.');
    }
  }

  const tabs = prefs.order.map(id => ({
    id, label: id.replace(/-/g, ' '),
  }));

  return (
    <div className="mpage" style={{ '--c': 'var(--m-kray)' }}>
      <ModuleHeader
        module="kray"
        kick="section.revenue"
        en="Procurement"
        hi="kray"
        sub="Purchase orders, vendors and approvals."
        icon={ICONS.kray}
      />

      <KpiStrip items={kpi} loading={!kpi && !kpiErr} error={kpiErr} count={4} />

      <ModuleTabs
        tabs={tabs} value={tab} onChange={setTab} label="Procurement sections"
        defaultTab={prefs.defaultTab}
        onCustomize={() => { setTab(tab); setCustomize(true); }}
      />
      <CustomizeTabs
        open={customize} onClose={() => setCustomize(false)}
        tabs={tabs} defaultTab={prefs.defaultTab}
        onSave={prefs.save} standard={prefs.standard}
      />

      <div
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        key={panelKey}
        {...motion}
      >
        <Active />
      </div>
    </div>
  );
}
