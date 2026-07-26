import React from 'react';

/**
 * Radio and RadioGroup — 26-component-inventory.md §5.
 *
 * The group is the roving-tabindex case: ONE tab stop for the whole group,
 * arrows move within it. Four separate tab stops for four options is three
 * keystrokes a keyboard user pays on every screen that has one.
 */
export function Radio({ checked = false, onChange, label, disabled, className = '', ...rest }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      tabIndex={checked ? 0 : -1}
      className={`rdo${checked ? ' on' : ''} ${className}`.trim()}
      onClick={() => onChange?.(true)}
      {...rest}
    />
  );
}

export function RadioGroup({ options = [], value, onChange, label, className = '' }) {
  const move = (dir) => {
    const i = options.findIndex(o => o.id === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange?.(next.id);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`stack--tight ${className}`.trim()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  { e.preventDefault(); move(-1); }
      }}
    >
      {options.map(o => (
        <label key={o.id} className="fldc">
          <Radio checked={value === o.id} onChange={() => onChange?.(o.id)} label={o.label} />
          <span className="fldc__b">
            <span className="fldc__t">{o.label}</span>
            {o.hint && <span className="fldc__s">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export default Radio;
