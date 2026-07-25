import React from 'react';

const PRI_COLOR = { urgent: '#C0392B', high: '#B06A00', medium: '#0082c6', low: '#6E7B91' };

export function PriorityDot({ priority, size = 8 }) {
  return (
    <span className="k-pdot" style={{ width: size, height: size, background: PRI_COLOR[priority] || '#6E7B91' }} />
  );
}
