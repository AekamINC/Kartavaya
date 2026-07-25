import React from 'react';

export function TaskRow({ id, title, project, priority, assignees = [], due, onClick }) {
  const PRI = { urgent: '#C0392B', high: '#B06A00', medium: '#0082c6', low: '#6E7B91' };
  const COLORS = ['#0082c6','#03a1b6','#05b7aa','#d97706','#6366f1'];
  return (
    <button className="k-trow" onClick={onClick}>
      <div className="k-trow__cell k-c-task">
        <span className="k-pdot" style={{ width: 8, height: 8, background: PRI[priority] || '#6E7B91' }} />
        <span className="k-trow__id">{id}</span>
        <span className="k-trow__title">{title}</span>
      </div>
      <div className="k-trow__cell k-c-project">
        {project && (
          <span className="k-ptag">
            <span className="k-ptag__dot" style={{ background: project.color }} />
            <span className="k-ptag__name">{project.name}</span>
          </span>
        )}
      </div>
      <div className="k-trow__cell">
        <span className="k-avstack">
          {assignees.slice(0, 2).map((u, i) => (
            <span key={i} className="k-avatar k-avatar--ring"
              style={{ width: 22, height: 22, fontSize: 9, background: u.color || COLORS[i % COLORS.length] }}
            >{(u.name || '?').split(' ').map(w => w[0]).join('').slice(0,2)}</span>
          ))}
        </span>
      </div>
      <div className="k-trow__cell">{priority}</div>
      <div className="k-trow__cell">{due}</div>
    </button>
  );
}
