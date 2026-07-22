import React from 'react';

export default function Card({ title, sanskrit, right, children, noPad, style, onClick, ...rest }) {
  const baseStyle = noPad ? { padding: 0, overflow: 'hidden' } : undefined;
  const merged = style ? { ...baseStyle, ...style } : baseStyle;
  return (
    <section className="k-card" style={merged} onClick={onClick} {...rest}>
      {(title || right) && (
        <header className="k-card__head">
          <div className="k-card__titles">
            {title && <h3 className="k-card__title">{title}</h3>}
            {sanskrit && <span className="k-card__sans">{sanskrit}</span>}
          </div>
          {right && <div>{right}</div>}
        </header>
      )}
      <div className="k-card__body">{children}</div>
    </section>
  );
}
