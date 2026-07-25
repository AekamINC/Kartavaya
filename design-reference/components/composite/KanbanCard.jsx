import React from 'react';

export function KanbanCard({ id, title, priority, assignees = [], comments, attachments, due, onClick }) {
  const PRI = { urgent: '#C0392B', high: '#B06A00', medium: '#0082c6', low: '#6E7B91' };
  const PRI_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
  const COLORS = ['#0082c6','#03a1b6','#05b7aa','#d97706','#6366f1'];
  return (
    <button className="k-bcard" onClick={onClick}>
      <div className="k-bcard__top">
        <span className="k-pdot" style={{ width: 8, height: 8, background: PRI[priority] || '#6E7B91' }} />
        <span className="k-bcard__id">{id}</span>
        <span className="k-bcard__priolbl">{PRI_LABEL[priority]}</span>
      </div>
      <div className="k-bcard__title">{title}</div>
      <div className="k-bcard__foot">
        {due}
        <div className="k-bcard__meta">
          {comments > 0 && <span>💬 {comments}</span>}
          {attachments > 0 && <span>📎 {attachments}</span>}
        </div>
        <span className="k-avstack">
          {assignees.slice(0, 2).map((u, i) => (
            <span key={i} className="k-avatar k-avatar--ring"
              style={{ width: 22, height: 22, fontSize: 9, background: u.color || COLORS[i % COLORS.length] }}
            >{(u.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2)}</span>
          ))}
        </span>
      </div>
    </button>
  );
}
