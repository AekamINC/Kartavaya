// Graha · today — one row inside a Today card.
//
// 25 inline styles are now `gr__t*` classes. The five branches shared an almost
// identical row shape with small differences in what sat at each end, which is
// why the same six declarations were repeated five times.
import React from 'react';
import { Badge, SOURCE_COLORS, ACT_ICONS } from './_shared';
import { inr } from '../../lib/inr';

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const daysAgo = d => (d ? `${Math.floor((Date.now() - new Date(d).getTime()) / 86400000)}d ago` : '');

export default function TodayItem({ item, section }) {
  if (section === 'overdue_followups') {
    const overdueDays = Math.floor((Date.now() - new Date(item.due_at).getTime()) / 86400000);
    return (
      <div className="gr__titem">
        <span className="gr__tage">{overdueDays}d</span>
        <div className="gr__tmain">
          <div className="gr__tt">{item.title}</div>
          {item.contact_name && <div className="gr__ts">{item.contact_name}</div>}
        </div>
        <span className="gr__twhen">{fmtDate(item.due_at)}</span>
      </div>
    );
  }

  if (section === 'stale_deals') {
    return (
      <div className="gr__titem">
        <div className="gr__tmain">
          <div className="gr__tt">{item.title}</div>
          <div className="gr__ts">{item.contact_name} · {daysAgo(item.updated_at)} since activity</div>
        </div>
        {item.value && <span className="gr__tval">{inr(Number(item.value))}</span>}
      </div>
    );
  }

  if (section === 'new_leads') {
    return (
      <div className="gr__titem">
        <div className="gr__tmain">
          <div className="gr__tt">{item.name}</div>
          <div className="gr__ts">{item.company || item.email || item.phone}</div>
        </div>
        {item.source && <Badge text={item.source} color={SOURCE_COLORS[item.source] || 'var(--on-surface-3)'} />}
      </div>
    );
  }

  if (section === 'todays_activities') {
    return (
      <div className="gr__titem">
        <span className="gr__tic" aria-hidden="true">{ACT_ICONS[item.activity_type] || '●'}</span>
        <div className="gr__tmain">
          <div className={item.is_completed ? 'gr__tt gr__tt--done' : 'gr__tt'}>{item.title}</div>
          {item.contact_name && <div className="gr__ts">{item.contact_name}</div>}
        </div>
      </div>
    );
  }

  if (section === 'recent_closures') {
    const won = item.stage === 'Won';
    return (
      <div className="gr__titem">
        <Badge text={item.stage} color={won ? 'var(--ok)' : 'var(--danger)'} />
        <div className="gr__tmain">
          <div className="gr__tt">{item.title}</div>
          {item.contact_name && <div className="gr__ts">{item.contact_name}</div>}
        </div>
        {item.value && (
          <span className={`gr__tval ${won ? 'gr__tval--ok' : 'gr__tval--bad'}`}>{inr(Number(item.value))}</span>
        )}
      </div>
    );
  }

  return null;
}
