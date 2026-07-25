import React from 'react';

export function StatTile({ label, sanskrit, value, sub, variant = 'blue' }) {
  return (
    <div className={'k-stat k-stat--' + variant}>
      <div className="k-stat__lbl">
        <span>{label}</span>
        {sanskrit && <span className="k-stat__hi">{sanskrit}</span>}
      </div>
      <div className="k-stat__val">{value}</div>
      {sub && <div className="k-stat__sub">{sub}</div>}
    </div>
  );
}
