import React from 'react';

export function SegmentedControl({ options, active, onChange }) {
  return (
    <div className="k-segctrl">
      {options.map(opt => (
        <button
          key={opt.id}
          className={'k-segctrl__btn' + (active === opt.id ? ' is-active' : '')}
          onClick={() => onChange?.(opt.id)}
        >
          {opt.label}
          {opt.count != null && <span className="k-segctrl__count">{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}
