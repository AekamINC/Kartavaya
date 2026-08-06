// Sahayak Admin → one client. Route shell.
//
// 1,342 lines and 241 inline styles before the split, of which ~700 were a copy
// of `HubDashboardPage.jsx` that had fallen behind it. Both files now render the
// same `pages/hub/*` components, so this page GAINS what the copy had lost:
// the content calendar, the platform allow-list, four more platforms, the
// manual-token fields for Telegram / Reddit / Pinterest, and the expired-token
// warning on a stale OAuth connection.
import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { errText } from './hub/_shared';

import OverviewTab from './hub/OverviewTab';
import GenerateTab from './hub/GenerateTab';
import ContentTab from './hub/ContentTab';
import ChatTab from './hub/ChatTab';
import KnowledgeTab from './hub/KnowledgeTab';
import PublishTab from './hub/PublishTab';
import BrandTab from './hub/BrandTab';
import CreditsTab from './hub/CreditsTab';

const TABS = ['overview', 'generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits', 'skills'];

export default function HubClientDetailPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const p = params.get('tab');
    return TABS.includes(p) ? p : 'overview';
  });
  const { key: panelKey, ...motion } = useTabPanelMotion(TABS, tab);

  const [state, setState] = useState({ loading: true, error: '', data: null });
  const { client, brand, wallet, content_count: contentCount } = state.data || {};

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}`);
      setState({ loading: false, error: '', data: r.data });
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // The tab is in the URL so a link to a client's Publish queue lands there.
  // `replace`, for the same reason as Sahayak: nine tabs behind Back is not
  // history anyone wants.
  const selectTab = useCallback((t) => {
    setTab(t);
    setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  }, [setParams]);

  const kpi = client ? [
    {
      label: 'Credits', hi: 'श्रेय', tone: 'p',
      value: wallet?.balance ?? '—',
      sub: wallet ? (wallet.monthly_allocation ? `of ${wallet.monthly_allocation} a month` : 'no monthly allocation') : 'the wallet did not load',
    },
    {
      label: 'Content items', hi: 'सामग्री',
      value: contentCount ?? '—',
      sub: contentCount == null ? 'not reported' : 'generated for this client',
    },
    {
      label: 'Brand profile', hi: 'पहचान',
      tone: brand ? 'ok' : 'warn',
      value: brand ? 'Set' : 'Not set',
      sub: brand ? 'injected into every prompt' : 'output will be generic until it is',
    },
    {
      label: 'Industry', hi: 'क्षेत्र',
      value: client.industry || '—',
      sub: client.slug || 'no slug',
    },
  ] : null;

  return (
    <div className="hb-page">
      <button type="button" className="k-backbtn hb-page__back" onClick={() => navigate('/hub/clients')}>
        ← Back to clients
      </button>

      <ModuleHeader
        module="hub"
        kick={<>Clients <span className="mh__kick-hi" lang="hi">· ग्राहक</span></>}
        en={client?.name || 'Client'}
        hi="ग्राहक"
        sub="Everything Sahayak holds for this client. Nothing here is visible to any other client."
        icon={ICONS.hub}
      />

      <KpiStrip items={kpi} loading={state.loading} error={state.error} count={4} />

      {!state.loading && !state.error && !client ? (
        <div className="note note--warn hb-note hb-page__none" role="status">
          <b>No such client.</b> It may have been removed, or it belongs to another organisation.
        </div>
      ) : (
        <>
          <ModuleTabs
            tabs={TABS.map(id => ({ id }))}
            value={tab}
            onChange={selectTab}
            label="Client sections"
          />

          <div
            key={panelKey}
            role="tabpanel"
            id={`mt-panel-${tab}`}
            aria-labelledby={`mt-tab-${tab}`}
            className="ix-panel"
            {...motion}
          >
            {tab === 'overview' && <OverviewTab state={state} client={client} />}
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
            {tab === 'skills' && (
              <div className="hb-card hb-jump">
                <h3 className="hb-card__t hb-card__t--flush">
                  Skill packs
                  <span className="hb-card__hi" lang="hi">कौशल</span>
                </h3>
                <p className="hb-cap">
                  Skill packs have their own screen — assigning, running and building templates each
                  need room, and the catalog is shared across every client in the organisation.
                </p>
                <button type="button" className="k-btn k-btn--primary"
                  onClick={() => navigate(`/hub/clients/${clientId}/skills`)}>
                  Open skill packs for {client?.name || 'this client'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
