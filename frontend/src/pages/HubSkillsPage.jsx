// Skill Packs · कौशल — per-client AI workflows. Route shell.
//
// 550 lines and 100 inline styles before the split. Three things this shell
// fixes that the single file could not:
//
//  · `load()` was one try/catch over two requests, so a failure in either
//    emptied BOTH lists — "no skills assigned" and "catalog empty" at once, from
//    one broken call. They are separate resources now.
//  · The credit cost table was hard-coded in the page while the server owns it.
//    It is fetched.
//  · Create Template was offered to everyone and 403'd on submit. The grant is
//    checked up front, and the tab says what is missing.
import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import KpiStrip from '../components/module/KpiStrip';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { useList, useResource, errText } from './hub/_shared';
import { parseSteps } from './hub/skills/_shared';

import { canManageSkills } from './admin/platformRoles';

import AssignedTab from './hub/skills/AssignedTab';
import RequestsTab from './hub/skills/RequestsTab';
import CatalogTab from './hub/skills/CatalogTab';
import CreateTab from './hub/skills/CreateTab';
import GuideTab from './hub/skills/GuideTab';

// `requests` is Aekam's queue and is offered only to the roles the server lets
// read it (`OPERATIONS_CONSOLE_ROLES`, the same set `canManageSkills` mirrors).
// A tab that 403s is worse than an absent one — see `platformRoles.js`.
const TABS = ['assigned', 'catalog', 'create', 'requests', 'guide'];

export default function HubSkillsPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const me = currentUser();
  const [tab, setTab] = useState('assigned');
  const { key: panelKey, ...motion } = useTabPanelMotion(TABS, tab);

  const assigned = useList(`/v1/hub/clients/${clientId}/skills`, [clientId]);
  const catalog = useList('/v1/hub/skills/templates', []);

  // The cost table the server owns. Its own three states, because the Guide tab
  // must be able to say "the cost table did not load" rather than print a stale
  // number — a wrong figure about spending is worse than no figure.
  const wallet = useResource('/v1/hub/org/credits', []);
  const costs = wallet.data?.credit_costs || null;

  const [clientName, setClientName] = useState('');
  const [clientErr, setClientErr] = useState('');

  const loadClient = useCallback(async () => {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}`);
      setClientName(r.data?.client?.name || '');
      setClientErr('');
    } catch (err) {
      setClientErr(errText(err));
    }
  }, [clientId]);

  useEffect(() => { loadClient(); }, [loadClient]);

  const canManage = canManageSkills(me);

  const assignedIds = new Set((assigned.items || []).map(s => s.template_id));
  const available = (catalog.items || []).filter(t => !assignedIds.has(t.id));

  const stepCount = (assigned.items || []).reduce((n, s) => n + parseSteps(s.steps).length, 0);

  const kpi = [
    {
      label: 'Assigned', hi: 'सक्रिय', tone: 'p',
      value: assigned.items ? assigned.items.length : '—',
      sub: assigned.error ? 'this list did not load' : 'packs this client can run',
    },
    {
      label: 'Steps in total', hi: 'चरण',
      value: assigned.items ? stepCount : '—',
      sub: assigned.error ? 'unknown' : 'AI calls across every assigned pack',
    },
    {
      label: 'Available', hi: 'साँचा',
      value: catalog.items ? available.length : '—',
      sub: catalog.error ? 'the catalog did not load' : 'templates not yet assigned',
    },
    {
      label: 'Cost table', hi: 'व्यय',
      tone: wallet.error ? 'warn' : 'ok',
      value: wallet.error ? 'Unavailable' : costs ? 'Live' : '—',
      sub: wallet.error ? 'run costs are not shown' : 'run costs are the server’s own',
    },
  ];

  return (
    <div className="hb-page">
      <button type="button" className="k-backbtn hb-page__back" onClick={() => navigate(`/hub/clients/${clientId}`)}>
        ← Back to {clientName || 'the client'}
      </button>

      <ModuleHeader
        module="hub"
        kick="section.clients"
        en="Skill Packs"
        hi="कौशल"
        sub={clientName
          ? `Pre-built AI workflows for ${clientName}. Every step reads that client’s brand profile and nobody else’s.`
          : 'Pre-built AI workflows, assigned per client and isolated per brand.'}
        icon={ICONS.hub}
      />

      {clientErr && (
        <div className="note note--warn hb-note" role="status">
          <b>The client record did not load.</b> {clientErr} The skill lists below are still this
          client&rsquo;s.
        </div>
      )}

      <KpiStrip items={kpi} count={4} />

      <ModuleTabs
        tabs={[
          { id: 'assigned', count: assigned.items?.length },
          { id: 'catalog', count: catalog.items ? available.length : undefined },
          { id: 'create' },
          // Aekam's queue. Hidden from anyone the server would refuse, rather
          // than rendered and 403'd — the same rule `create` already follows.
          // `tabLabels.TAB_HI` has no `requests` key yet, so the strip shows the
          // English alone; that file is not this change's to edit and a missing
          // Devanagari is a gap to fill, not a placeholder to print.
          ...(canManage ? [{ id: 'requests' }] : []),
          { id: 'guide' },
        ]}
        value={tab}
        onChange={setTab}
        label="Skill pack sections"
        max={5}
      />

      <div
        key={panelKey}
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...motion}
      >
        {tab === 'assigned' && (
          <AssignedTab
            clientId={clientId} state={assigned} costs={costs}
            onBrowse={() => setTab('catalog')}
            onRan={() => { assigned.reload(); wallet.reload(); }}
          />
        )}
        {tab === 'catalog' && (
          <CatalogTab
            clientId={clientId} state={catalog} available={available} costs={costs}
            canManage={canManage}
            onCreate={() => setTab('create')}
            onChanged={() => { assigned.reload(); catalog.reload(); }}
          />
        )}
        {/* `canManage` again, not only on the strip. The tab id also arrives
            from `useTabPanelMotion`'s state, so a viewer whose grant is revoked
            mid-session would otherwise keep the panel they were already on. */}
        {tab === 'requests' && canManage && <RequestsTab />}
        {tab === 'create' && (
          <CreateTab costs={costs} canManage={canManage}
            onCreated={() => { catalog.reload(); setTab('catalog'); }} />
        )}
        {tab === 'guide' && <GuideTab costs={costs} costsError={wallet.error} />}
      </div>
    </div>
  );
}
