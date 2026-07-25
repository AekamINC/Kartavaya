import React from 'react';

export function ProjectCard({ name, sanskrit, client, color, tasks, done, daysLeft, progress, onClick }) {
  return (
    <button className="k-pcard" onClick={onClick}>
      <div className="k-pcard__head">
        <div className="k-pcard__bar" style={{ background: color }} />
        <div className="k-pcard__titles">
          {sanskrit && <div className="k-pcard__sans">{sanskrit}</div>}
          <div className="k-pcard__name">{name}</div>
          {client && <div className="k-pcard__client">{client}</div>}
        </div>
      </div>
      <div className="k-pcard__body">
        <div className="k-pcard__stat"><b>{tasks}</b><span>TASKS</span></div>
        <div className="k-pcard__stat"><b>{done}</b><span>DONE</span></div>
        <div className="k-pcard__stat"><b>{daysLeft}</b><span>DAYS</span></div>
      </div>
      {progress != null && (
        <div>
          <div className="k-pcard__bar2"><i style={{ width: (progress * 100) + '%', background: color }} /></div>
          <div className="k-pcard__meter-row">
            <span>{Math.round(progress * 100)}% complete</span>
          </div>
        </div>
      )}
    </button>
  );
}
