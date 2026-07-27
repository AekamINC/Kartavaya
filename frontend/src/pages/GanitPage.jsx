// Ganit · गणित — GST invoicing route shell.
//
// Was 2,030 lines / 124 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Now on the shared .mh/.mt chrome from 13-module-pages.md §1.
import React, { useState } from 'react';
import ModuleHeader from '../components/module/ModuleHeader';
import ModuleTabs from '../components/module/ModuleTabs';
import { ICONS } from '../components/layout/navIcons';
import useTabPanelMotion from '../lib/tabPanelMotion';

import InvoicesTab from './ganit/InvoicesTab';
import ProductsTab from './ganit/ProductsTab';
import ExpensesTab from './ganit/ExpensesTab';
import PayablesTab from './ganit/PayablesTab';
import ContractsTab from './ganit/ContractsTab';
import ESignTab from './ganit/ESignTab';
import RecurringTab from './ganit/RecurringTab';
import BankTab from './ganit/BankTab';
import TimesheetTab from './ganit/TimesheetTab';
import StatsTab from './ganit/StatsTab';

const TABS = [
  ['invoices', InvoicesTab], ['products', ProductsTab], ['expenses', ExpensesTab],
  ['payables', PayablesTab], ['contracts', ContractsTab], ['e-sign', ESignTab],
  ['recurring', RecurringTab], ['bank', BankTab], ['timesheet', TimesheetTab],
  ['stats', StatsTab],
];

export default function GanitPage() {
  const [tab, setTab] = useState('invoices');
  const Active = (TABS.find(([id]) => id === tab) || TABS[0])[1];
  const motion = useTabPanelMotion(TABS.map(([id]) => id), tab);

  return (
    <div style={{ padding: '0 0 48px' }}>
      <ModuleHeader
        module="ganit"
        en="Invoicing"
        hi="गणित"
        sub="Tax invoices, quotations and payments"
        icon={ICONS.ganit}
      />

      <ModuleTabs
        tabs={TABS.map(([id]) => ({ id, label: id.replace(/-/g, ' ') }))}
        value={tab}
        onChange={setTab}
        label="Ganit sections"
      />

      <div
        role="tabpanel"
        id={`mt-panel-${tab}`}
        aria-labelledby={`mt-tab-${tab}`}
        className="ix-panel"
        {...motion}
      >
        <Active />
      </div>
    </div>
  );
}
