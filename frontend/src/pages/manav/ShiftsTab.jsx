import React, { useState } from 'react';
import { useToast } from '../../components/ui/toast';
import ShiftDefinitions from './ShiftDefinitions';
import ScheduleGrid from './ScheduleGrid';
import ShiftBids from './ShiftBids';
import SwapRequests from './SwapRequests';

export default function ShiftsTab() {
  const { pushToast } = useToast();
  const [view, setView] = useState('definitions');
  const SHIFT_VIEWS = ['definitions', 'schedules', 'bids', 'swaps'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {SHIFT_VIEWS.map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: view === v ? 700 : 400,
              color: view === v ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: view === v ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {v}
          </button>
        ))}
      </div>
      {view === 'definitions' && <ShiftDefinitions pushToast={pushToast} />}
      {view === 'schedules' && <ScheduleGrid pushToast={pushToast} />}
      {view === 'bids' && <ShiftBids pushToast={pushToast} />}
      {view === 'swaps' && <SwapRequests pushToast={pushToast} />}
    </div>
  );
}
