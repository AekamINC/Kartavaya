// Graha · ग्राह — CRM route shell.
//
// This file was 2,648 lines and 148 KB. Per 13-module-pages.md the module pages
// are split into a route file plus a directory of tab components BEFORE any
// styling is applied: a restyle of a single-file module touches every tab, every
// table and every form at once, and the diff is unreviewable.
//
// Now on the shared .mh/.mt chrome from 13-module-pages.md §1.
import React, { useState } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import { ICONS } from '../components/layout/navIcons';

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

export default function GrahaPage() {
  const [tab, setTab] = useState('today');
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];

  return (
    <div style={{ padding: '0 0 48px' }}>
      <ModuleHeader
        module="graha"
        en="CRM"
        hi="ग्राह"
        sub="Contacts, deals and pipeline"
        icon={ICONS.graha}
      />

      <ModuleTabs
        tabs={TABS.map(([id]) => ({ id, label: id.replace(/-/g, ' ') }))}
        value={tab}
        onChange={setTab}
        label="Graha sections"
      />

      <div role="tabpanel" id={`mt-panel-${tab}`} aria-labelledby={`mt-tab-${tab}`}>
        <Active />
      </div>
    </div>
  );
}
