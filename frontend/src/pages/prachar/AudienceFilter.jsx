// Who a campaign actually goes to — the control that was never built.
//
// `CampaignsTab` hard-coded `audience_filter: {}` into the payload shared by
// create AND edit, so every campaign this product has ever made targeted every
// contact in the org, and every save of an existing campaign silently wiped
// whatever filter it had. `_resolve_audience` has read the filter since the
// module was written; nothing on this side could set one.
//
// ── Three controls, and only three ──────────────────────────────────────────
// The backend accepts five keys. Two of them have no control here on purpose:
//
//   tag        `graha_contacts.tags` is empty in every org because no write
//              path sets it. A tag picker would be a control that matches
//              nobody, every time, with nothing on screen to say why.
//   min_score  `lead_score` is 0 on every row — `graha_scoring_rules` is empty
//              and nothing has seeded it since migration 023. Same problem.
//
// Both keys still round-trip untouched (`normaliseFilter`), so a filter written
// by anything else survives a save made here, and a future scoring feature
// needs no API change. Shipping the controls before the data exists would ship
// two broken controls.
//
// ── The preview is the feature, not the garnish ─────────────────────────────
// A marketer pressing Send is entitled to know, BEFORE the send, how many
// people it reaches, how many are dropped as unsubscribed, and who a sample of
// them are. `GET /campaigns/{id}/audience` cannot answer that: it needs a
// persisted campaign and takes no parameters, so a filter could not be counted
// until after it was saved. `POST /audience/preview` resolves an unsaved one
// through the same `_resolve_audience`, which is why there is exactly one
// resolver and this is not a second.
//
// ── "Everyone" is now a choice ──────────────────────────────────────────────
// It was the default and it was silent. It is still the default — anything else
// would change what an existing campaign does — but it is now a segment button
// somebody presses, and it says what it means underneath.
import React, { useEffect, useMemo, useState } from 'react';
import { DataTable, Td } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import {
  api, body, useResource,
  CONTACT_TYPES, normaliseFilter, parseFilter, isEveryone, reachSentence,
  humanise, plural,
} from './_shared';

/** How many of the ≤50 sampled contacts the form shows before it stops. */
const SAMPLE = 8;

/** The floor the options endpoint falls back to — see `CONTACT_TYPES`. */
const FALLBACK = { types: CONTACT_TYPES, sources: [], companies: [] };

export default function AudienceFilter({ value, onChange }) {
  // F32 — this component owns write controls, so it asks the question itself
  // rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });

  // The raw value is what the fields render, the normalised one is what gets
  // counted and saved. Keeping them apart matters for the free-text field:
  // trimming on every keystroke eats the space between "acme" and "corp" as it
  // is typed, and the user watches their own input being deleted.
  const raw = useMemo(() => parseFilter(value), [value]);
  const filter = useMemo(() => normaliseFilter(value), [value]);
  const everyone = isEveryone(value);

  // Seeded once, from what the campaign arrived with. A campaign that already
  // has a filter opens on the builder; a new one opens on "Everyone", which is
  // what a new campaign has always done.
  const [mode, setMode] = useState(() => (everyone ? 'all' : 'segment'));
  const [opts, setOpts] = useState(FALLBACK);

  useEffect(() => {
    // An enrichment, the same shape as Graha's client dropdown: if it fails,
    // the four contact types are still the four CHECK values and Source
    // degrades to "Any source" rather than taking the campaign form down.
    api.get('/v1/prachar/audience/options')
      .then((r) => {
        const d = body(r);
        // De-duplicated on receipt. The endpoint selects DISTINCT, so a repeat
        // would be a server defect — but it would arrive here as a React key
        // collision, which reports itself as a rendering bug in this file and
        // sends the next person looking in the wrong place.
        const uniq = (a) => [...new Set((a || []).filter(Boolean))];
        setOpts({
          types: d.types?.length ? uniq(d.types) : CONTACT_TYPES,
          sources: uniq(d.sources),
          companies: uniq(d.companies),
        });
      })
      .catch(() => {});
  }, []);

  // Company is free text. Counting on every keystroke would both hammer the
  // endpoint and quote a figure for a prefix nobody meant to search.
  const key = JSON.stringify(filter);
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setSettled(key), 350);
    return () => clearTimeout(t);
  }, [key]);

  const preview = useResource(
    () => api.post('/v1/prachar/audience/preview', { audience_filter: JSON.parse(settled) }).then(body),
    [settled],
  );

  const set = (k) => (e) => {
    const next = { ...raw, [k]: e.target.value };
    // An empty control is not a filter. `{"type": ""}` must never reach the
    // wire — the server rejects it, and rightly.
    if (next[k] === '') delete next[k];
    onChange(next);
  };

  /** "Everyone" is destructive to a filter, so it clears rather than hides. */
  const toAll = () => { setMode('all'); onChange({}); };

  const p = preview.data || {};
  const matched = Number(p.matched ?? p.count ?? 0);
  const sample = (p.contacts || []).slice(0, SAMPLE);

  return (
    <div className="pr__aud">
      <div className="pr__aud-head">
        <span className="pr__aud-l">
          Audience
          <span className="pr__aud-hi" lang="hi">श्रोता</span>
        </span>
        <div className="seg" role="group" aria-label="Who this campaign goes to">
          <button
            type="button"
            className={`seg__b${mode === 'all' ? ' on' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={toAll}
            disabled={!canWrite}
            title={denial || undefined}
          >
            Everyone
          </button>
          <button
            type="button"
            className={`seg__b${mode === 'segment' ? ' on' : ''}`}
            aria-pressed={mode === 'segment'}
            onClick={() => setMode('segment')}
            disabled={!canWrite}
            title={denial || undefined}
          >
            A segment
          </button>
        </div>
      </div>

      {mode === 'segment' && (
        <div className="k-formpanel__grid k-formpanel__grid--3">
          <label className="k-formpanel__label">Contact type
            <select
              className="k-formpanel__input"
              value={raw.type || ''}
              onChange={set('type')}
              disabled={!canWrite}
              title={denial || undefined}
            >
              <option value="">Any type</option>
              {opts.types.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
            </select>
          </label>
          <label className="k-formpanel__label">Source
            <select
              className="k-formpanel__input"
              value={raw.source || ''}
              onChange={set('source')}
              disabled={!canWrite}
              title={denial || undefined}
            >
              <option value="">Any source</option>
              {opts.sources.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
            </select>
          </label>
          <label className="k-formpanel__label">Company
            {/* A datalist, not a select. `company` is an ILIKE on a substring,
                so the org's existing company names are a suggestion and never
                the whole set of valid answers. */}
            <input
              className="k-formpanel__input"
              list="pr-aud-companies"
              placeholder="part of a company name"
              value={raw.company || ''}
              onChange={set('company')}
              disabled={!canWrite}
              title={denial || undefined}
            />
            <datalist id="pr-aud-companies">
              {opts.companies.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
        </div>
      )}

      {everyone && (
        <p className="note note--warn pr__aud-warn">
          <b>No filter set.</b> This campaign goes to every contact in this
          organisation who has an email address. Choose <b>A segment</b> to narrow it.
        </p>
      )}

      {/* aria-live, because this figure changes under the operator without
          anything being clicked, and it is the figure they are deciding on. */}
      <p className={`pr__aud-sum${preview.loading ? ' is-stale' : ''}`} aria-live="polite">
        {preview.error
          ? `The audience could not be counted. ${preview.error}`
          : preview.data
            ? reachSentence(p)
            : 'Counting…'}
      </p>

      {!preview.error && preview.data && matched === 0 && (
        <p className="note note--warn pr__aud-warn">
          Nothing matches this filter, so this campaign would reach nobody. Widen
          it, or add the contacts in CRM first.
        </p>
      )}

      {sample.length > 0 && (
        <>
          <DataTable columns={['Name', 'Email', 'Company', 'Type']}>
            {sample.map((c) => (
              <tr key={c.id}>
                <Td bold>{c.name}</Td>
                <td>{c.email}</td>
                <td>{c.company || '—'}</td>
                <td>{humanise(c.type)}</td>
              </tr>
            ))}
          </DataTable>
          {matched > sample.length && (
            <p className="pr__aud-more">
              Showing the first {sample.length} of {plural(matched, 'match', 'matches')}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
