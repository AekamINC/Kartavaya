import React from 'react';
import { useSecondary, Secondary } from '../Bilingual';

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

/**
 * ONE LABEL SHAPE — 50 call sites, 27 carrying Devanagari across 16 files.
 *
 * `.card__hi` is not in `[data-language="en"]`'s six-name list either, so every
 * one of those 27 card headings showed Devanagari to a user reading English.
 * That is the sixth shared label component with the same defect, and the reason
 * the fix is a render decision rather than a longer list of class names: nobody
 * writing `<CardHead sanskrit="बीजक">` was ever going to know the list existed.
 *
 * `sanskrit` takes a bare string as it always has, a registry key, or `{hi, gu}`
 * — the slot is the same one every other label site now has.
 */
export function CardHead({ title, sanskrit, actions, children }) {
  const { secondary, script } = useSecondary(sanskrit);
  return (
    <header className="card__head">
      {title && (
        <div className="card__titles">
          <h3 className="card__title">{title}</h3>
          {secondary && <Secondary className="card__hi" value={secondary} script={script} />}
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
