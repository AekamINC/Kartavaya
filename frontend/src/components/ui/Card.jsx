import React from 'react';

/**
 * Card (02-common-components.md §1) — ← editorial/Card.jsx.
 *
 * The titles are inline, not a flex column. `.card__title` and `.card__hi` sit
 * on the same baseline and wrap together, because the Hindi is an apposition to
 * the English, not a subtitle beneath it. Stacking them reads as heading +
 * subheading, which says something different about the relationship.
 */
export function Card({ variant, className = '', children, ...rest }) {
  const cls = ['card', variant ? `card--${variant}` : '', className].filter(Boolean).join(' ');
  return <section className={cls} {...rest}>{children}</section>;
}

export function CardHead({ title, sanskrit, actions, children }) {
  return (
    <header className="card__head">
      {title && (
        <div className="card__titles">
          <h3 className="card__title">{title}</h3>
          {sanskrit && <span className="card__hi" lang="hi" aria-hidden="true">{sanskrit}</span>}
        </div>
      )}
      {children}
      {actions}
    </header>
  );
}

export function CardBody({ flush, className = '', children }) {
  return <div className={`card__body${flush ? ' card__body--flush' : ''} ${className}`.trim()}>{children}</div>;
}

export default Card;
