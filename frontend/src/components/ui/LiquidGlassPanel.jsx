import React, { forwardRef } from 'react';
import { Glass } from '@samasante/liquid-glass';
import { useLiquidGlass } from '../CustomizePanel';

const LiquidGlassPanel = forwardRef(function LiquidGlassPanel(
  { className, style, radius = 16, children, as: Tag = 'div', ...rest },
  ref,
) {
  const { enabled, optics } = useLiquidGlass();

  if (!enabled || !optics) {
    return (
      <Tag ref={ref} className={className} style={style} {...rest}>
        {children}
      </Tag>
    );
  }

  return (
    <Glass optics={optics} radius={radius}>
      <Tag ref={ref} className={className} style={style} {...rest}>
        {children}
      </Tag>
    </Glass>
  );
});

export default LiquidGlassPanel;
