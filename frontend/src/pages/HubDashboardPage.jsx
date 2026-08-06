// Sahayak Admin · सहायक व्यवस्था — the org's own client workspace. Route shell.
//
// 1,355 lines and 248 inline styles before the split, with all seven tabs
// inside it and roughly 700 of those lines duplicated verbatim in
// `HubClientDetailPage.jsx`. Both files now render `pages/hub/*`, so the two
// copies of Chat, Knowledge, Publish and Credits are one copy — and the drift
// between them (the client-detail Publish tab had no calendar, no platform
// allow-list and four fewer platforms) is gone with it.
import React, { useState, useCallback, useEffect } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import { moduleMeta } from '../lib/moduleColors';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { errText } from './hub/_shared';

import GenerateTab from './hub/GenerateTab';
import ContentTab from './hub/ContentTab';
import ChatTab from './hub/ChatTab';
import KnowledgeTab from './hub/KnowledgeTab';
import PublishTab from './hub/PublishTab';
import BrandTab from './hub/BrandTab';
import CreditsTab from './hub/CreditsTab';

/** Tab order, verbatim from `Data.jsx:131` MODULE_TABS.hub. */
const TABS = ['generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits'];

export default function HubDashboardPage() {
  const meta = moduleMeta('hub');
  const [tab, setTab] = useState('generate');
  const { key: panelKey, ...motion } = useTabPanelMotion(TABS, tab);

  const [state, setState] = useState({ loading: true, error: '', data: null });
  const { client, brand, wallet, contentCount } = state.data || {};

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      // Two requests: the org's own client row, then that client's wallet. The
      // second is allowed to fail on its own — knowing WHICH workspace you are
      // in is worth having even when the balance did not come back.
      const oc = await api.get('/v1/hub/org-client');
      const c = oc.data?.client;
      if (!c?.id) {
        setState({ loading: false, error: '', data: null });
        return;
      }
      let wallet = null;
      let contentCount = null;
      try {
        const d = await api.get(`/v1/hub/clients/${c.id}`);
        wallet = d.data?.wallet ?? null;
        contentCount = d.data?.content_count ?? null;
      } catch { /* the strip reports the gap; the page still works */ }
      setState({ loading: false, error: '', data: { client: c, brand: oc.data?.brand ?? null, wallet, contentCount } });
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clientId = client?.id || null;

  const kpi = clientId ? [
    {
      label: 'Credits', hi: 'श्रेय', tone: 'p',
      value: wallet?.balance ?? '—',
      sub: wallet ? (wallet.monthly_allocation ? `of ${wallet.monthly_allocation} a month` : 'no monthly allocation') : 'the wallet did not load',
    },
    {
      label: 'Content items', hi: 'सामग्री',
      value: contentCount ?? '—',
      sub: contentCount == null ? 'not reported' : 'generated for this workspace',
    },
    {
      label: 'Brand profile', hi: 'पहचान',
      tone: brand ? 'ok' : 'warn',
      value: brand ? 'Set' : 'Not set',
      sub: brand ? 'injected into every prompt' : 'output will be generic until it is',
    },
    {
      label: 'Workspace', hi: 'कार्यक्षेत्र',
      value: client?.name || '—',
      sub: client?.industry || client?.slug || 'no industry recorded',
    },
  ] : null;

  return (
    <div className="hb-page">
      <ModuleHeader
        module="hub"
        kick="section.growth"
        en={meta.en}
        hi="sahayakAdmin"
        sub="AI content, the client chatbot, its knowledge base and social publishing — one workspace."
        icon={ICONS.hub}
      />

      <KpiStrip items={kpi} loading={state.loading} error={state.error} count={4} />

      {/* No client row is NOT a failure and must not read as one: it means the
          Sahayak module has not been provisioned for this org yet. The old page
          rendered the same grey "Sahayak module not available." for that AND for
          a 500. */}
      {!state.loading && !state.error && !clientId ? (
        <div className="note note--info hb-note hb-page__none" role="status">
          <b>This organisation has no Sahayak workspace yet.</b> One is created when the module is
          provisioned. Everything else on this page becomes available at that point.
        </div>
      ) : (
        <>
          <ModuleTabs
            tabs={TABS.map(id => ({ id }))}
            value={tab}
            onChange={setTab}
            label="Sahayak Admin sections"
          />

          <div
            key={panelKey}
            role="tabpanel"
            id={`mt-panel-${tab}`}
            aria-labelledby={`mt-tab-${tab}`}
            className="ix-panel"
            {...motion}
          >
            {tab === 'generate' && (
              <GenerateTab clientId={clientId} wallet={wallet}
                onSpent={left => setState(s => ({
                  ...s, data: { ...s.data, wallet: s.data?.wallet ? { ...s.data.wallet, balance: left } : s.data?.wallet },
                }))} />
            )}
            {tab === 'content' && <ContentTab clientId={clientId} onReviewed={load} />}
            {tab === 'chat' && <ChatTab clientId={clientId} />}
            {tab === 'knowledge' && <KnowledgeTab clientId={clientId} />}
            {tab === 'publish' && <PublishTab clientId={clientId} />}
            {tab === 'brand' && <BrandTab clientId={clientId} state={state} brand={brand} onSaved={load} />}
            {tab === 'credits' && <CreditsTab clientId={clientId} wallet={wallet} onRefresh={load} />}
          </div>
        </>
      )}
    </div>
  );
}
