// Ganit · गणित — GST invoicing route shell.
//
// Was 2,030 lines / 124 KB. Split per 13-module-pages.md: route file + one file
// per tab, applied BEFORE any restyle so the styling diff stays reviewable.
// Visually unchanged in this commit by design.
import React, { useState } from 'react';
import { PageHeader } from '../components/editorial';

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

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Ganit · गणित" subtitle="GST Invoicing — Tax Invoices, Quotations & Payments" />

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(([t]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
}
