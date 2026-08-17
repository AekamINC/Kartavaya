// Dristi · the date range the whole module is read through (proposal 62, D1).
//
// Before this, one endpoint in the reporting module accepted a date range and
// the other five did not, so "last quarter" was not a question the product
// could be asked. The control lives on the page rather than inside each tab
// because the period is a property of what the user is looking at, not of the
// chart they happen to have open — switching tabs keeps it.
//
// `All time` is the default and sends nothing, which is exactly what every tab
// did before. Changing the default would have quietly restated every existing
// screen.
import React, { useEffect, useRef, useState } from 'react';
import DateInput from '../../components/ui/DateInput';
import { WINDOW_PRESETS, resolvePreset } from './_shared';

/** `2026-04-01` → `1 Apr 2026`. Built by hand; see the note in _shared. */
function pretty(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return v || '';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}`;
}

export default function WindowBar({ value, onChange }) {
  const { from, to, preset } = value;
  const [custom, setCustom] = useState(preset === 'custom');
  // Held separately so a half-entered custom range does not fire a request on
  // every keystroke: the window only moves when both ends are present.
  const [draft, setDraft] = useState({ from, to });
  const first = useRef(true);

  useEffect(() => { setDraft({ from, to }); }, [from, to]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!custom) return;
    if (draft.from && draft.to && draft.from <= draft.to
        && (draft.from !== from || draft.to !== to)) {
      onChange({ from: draft.from, to: draft.to, preset: 'custom' });
    }
  }, [draft, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(next) {
    if (next === 'custom') {
      setCustom(true);
      // Seed the custom fields from whatever is on screen, so the user edits a
      // range rather than starting from two empty boxes.
      const seed = from && to ? { from, to } : resolvePreset('30d');
      setDraft({ from: seed.from, to: seed.to });
      onChange({ from: seed.from, to: seed.to, preset: 'custom' });
      return;
    }
    setCustom(false);
    onChange(resolvePreset(next));
  }

  const invalid = custom && draft.from && draft.to && draft.from > draft.to;

  return (
    <div className="dwin" role="group" aria-label="Reporting period">
      <div className="dwin__presets">
        {WINDOW_PRESETS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="k-btn k-btn--ghost k-btn--sm"
            aria-pressed={preset === id}
            onClick={() => pick(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {custom && (
        <div className="dwin__custom">
          <DateInput
            className="k-input"
            aria-label="From date"
            value={draft.from}
            onChange={(e) => setDraft(d => ({ ...d, from: e.target.value }))}
          />
          <span className="dwin__sep" aria-hidden="true">→</span>
          <DateInput
            className="k-input"
            aria-label="To date"
            value={draft.to}
            onChange={(e) => setDraft(d => ({ ...d, to: e.target.value }))}
          />
        </div>
      )}

      <p className="dwin__note" role="status">
        {invalid
          ? 'The end date is before the start date.'
          : from || to
            ? <>Showing <b>{pretty(from)}</b> to <b>{pretty(to)}</b>. Counts of what
                exists now — headcount, open deals, tasks on hand — are as at today,
                whatever period is chosen.</>
            : 'Showing everything on record. Pick a period to narrow it.'}
      </p>
    </div>
  );
}
