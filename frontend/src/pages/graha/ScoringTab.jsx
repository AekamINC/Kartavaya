// Graha · lead scoring — the rules that decide which leads get chased first.
//
// ── WHY THIS SCREEN DID NOT EXIST, AND WHAT THAT COST ───────────────────────
// `compute_lead_score` is a complete engine: fifteen signals across the contact
// row, its deals, its activities and its follow-ups, each worth whatever points
// a rule assigns, clamped to 0–100 and written back with the reasons that
// produced it. `GET /scoring-rules` listed rules and `PATCH` amended them.
//
// There was no POST and there was no screen. So `graha_scoring_rules` was empty
// in every organisation, `compute_lead_score` returned at its first line
// (`if not rules: return 0, []`), and EVERY `lead_score` in the product was 0.
// `prachar/AudienceFilter.jsx` carries a comment recording exactly that, which
// is how long it had been known and not fixed. Suite 04.17 named it.
//
// ── THE SIGNALS COME FROM THE SERVER, NEVER FROM A LIST TYPED HERE ──────────
// `GET /scoring-signals` publishes the engine's own vocabulary. A hardcoded
// copy would drift, and the drift is SILENT: a rule naming a signal the engine
// no longer builds is stored, listed, and scores nothing for ever. The picker
// therefore offers what the engine reads and nothing else, which is also why
// the create route refuses an unknown signal rather than storing it.
//
// ── DEACTIVATE, NOT DELETE ──────────────────────────────────────────────────
// `is_active` is what the PATCH route offers and it is the right control: a
// rule turned off stops scoring and its history survives, so "why was this lead
// an 80 last quarter" stays answerable. There is no delete here because there
// is no delete route, and inventing one would throw that away.
import React, { useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import { Empty, Shimmer } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function ScoringTab() {
  const [rules, setRules] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [signal, setSignal] = useState('');
  const [points, setPoints] = useState('10');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const { pushToast } = useToast();
  const { canWrite, reason: denial } = useModuleWrite({ label: 'set lead-scoring rules' });

  useEffect(() => { load(); }, []);

  async function load() {
    setErr('');
    try {
      const r = await api.get('/v1/graha/scoring-rules');
      setRules(rows(r));
    } catch (e) {
      setErr(e.response?.status === 403
        ? 'You do not have access to lead scoring.'
        : 'The scoring rules did not load. Retry, or check your connection.');
      setLoading(false);
      return;
    }
    // The vocabulary is an enrichment: without it the picker is empty and the
    // rules already set still read, which is the more useful half.
    try {
      setSignals(rows(await api.get('/v1/graha/scoring-signals')));
    } catch { /* the picker is empty and says so */ }
    setLoading(false);
  }

  /** Signals with no rule yet — the only ones worth offering.
   *  A second rule on one signal is refused by the server (both would fire and
   *  their points would add), so offering it here would be a control that can
   *  only produce a 409. */
  const unused = signals.filter(s => !rules.some(r => String(r.signal) === String(s.signal)));

  useEffect(() => {
    if (signal && unused.some(s => s.signal === signal)) return;
    setSignal(unused[0]?.signal || '');
  }, [signals, rules]);   // eslint-disable-line react-hooks/exhaustive-deps

  const labelFor = sig => signals.find(s => s.signal === sig)?.label || sig;

  async function create(e) {
    e.preventDefault();
    if (!signal) return;
    setSaving(true);
    try {
      await api.post('/v1/graha/scoring-rules', {
        signal,
        points: parseInt(points, 10) || 0,
        description: description.trim(),
      });
      pushToast({ title: 'Scoring rule added', type: 'success' });
      setDescription('');
      await load();
    } catch (e2) {
      pushToast({ title: apiErrorText(e2, 'Could not add the rule'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function patch(rule, changes, what) {
    setBusy(String(rule.id));
    try {
      await api.patch(`/v1/graha/scoring-rules/${rule.id}`, changes);
      pushToast({ title: what, type: 'success' });
      await load();
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Could not change the rule'), type: 'error' });
    } finally { setBusy(''); }
  }

  /** Rescore every contact against the rules as they now stand.
   *  A rule changed and not applied is a screen that says one thing while the
   *  contact list says another, and the route to fix that already exists. */
  async function rescoreAll() {
    setBusy('all');
    try {
      const r = await api.post('/v1/graha/contacts/rescore-all');
      const n = body(r)?.count;
      pushToast({
        title: n == null ? 'Every contact was rescored' : `${n} contacts rescored`,
        type: 'success',
      });
    } catch (e) {
      pushToast({ title: apiErrorText(e, 'Could not rescore the contacts'), type: 'error' });
    } finally { setBusy(''); }
  }

  if (loading) return <Shimmer count={5} />;
  if (err) return <div className="note note--warn" role="status">{err}</div>;

  return (
    <>
      <p className="gpipe__lede">
        A lead&apos;s score is the sum of the rules that match it, held between 0 and 100.
        {rules.length === 0 && ' With no rules set, every lead scores 0.'}
      </p>

      <form className="gpipe__bar" onSubmit={create}>
        <label className="gr__f">
          <span className="gr__fl">When a lead…</span>
          <select className="k-input" aria-label="Signal" value={signal}
            disabled={!unused.length}
            title={unused.length ? undefined : 'Every signal already has a rule.'}
            onChange={e => setSignal(e.target.value)}>
            {!unused.length && <option value="">— every signal has a rule —</option>}
            {unused.map(s => <option key={s.signal} value={s.signal}>{s.label}</option>)}
          </select>
        </label>
        <label className="gr__f">
          <span className="gr__fl">…add points</span>
          {/* -100 to 100, which is what the route accepts: the TOTAL is clamped
              to 0–100, so a rule worth 5,000 silently swallows every other rule
              the firm set. A negative rule is legitimate — an overdue follow-up
              is a reason to score a lead DOWN. */}
          <input className="k-input" type="number" min="-100" max="100" aria-label="Points"
            value={points} onChange={e => setPoints(e.target.value)} />
        </label>
        <label className="gr__f">
          <span className="gr__fl">Note (optional)</span>
          <input className="k-input" maxLength={200} value={description}
            placeholder="Why this matters to us"
            onChange={e => setDescription(e.target.value)} />
        </label>
        <button type="submit" className="k-btn k-btn--primary"
          disabled={!canWrite || saving || !signal}
          title={denial || undefined}>
          {saving ? 'Adding…' : 'Add rule'}
        </button>
      </form>

      {rules.length === 0 ? (
        <Empty
          title="No scoring rules yet"
          sub="Set a rule above and every contact can be scored against it. Until then every lead scores 0."
        />
      ) : (
        <>
          {rules.map(r => (
            <div key={r.id} className="gr__lrow">
              <div className="gr__lmain">
                <div className="gr__lt">{labelFor(r.signal)}</div>
                <div className="gr__ls">
                  {r.points > 0 ? `+${r.points}` : r.points} points
                  {r.description ? ` · ${r.description}` : ''}
                  {r.is_active ? '' : ' · turned off'}
                </div>
              </div>
              {/* The points are edited in place: PATCH takes exactly `points`
                  and `is_active`, and a rule whose weight cannot be tuned
                  without deleting it is a rule nobody will tune. */}
              <label className="gr__f">
                <span className="gr__fl">Points</span>
                <input
                  className="k-input gr__pts" type="number" min="-100" max="100"
                  aria-label={`Points for ${labelFor(r.signal)}`}
                  defaultValue={r.points}
                  disabled={!canWrite || busy === String(r.id)}
                  title={denial || undefined}
                  onBlur={e => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isNaN(v) || v === r.points) return;
                    patch(r, { points: v }, 'Points changed');
                  }}
                />
              </label>
              <button type="button" className="k-btn k-btn--ghost"
                disabled={!canWrite || busy === String(r.id)}
                title={denial || undefined}
                onClick={() => patch(r, { is_active: !r.is_active },
                  r.is_active ? 'Rule turned off' : 'Rule turned on')}>
                {r.is_active ? 'Turn off' : 'Turn on'}
              </button>
            </div>
          ))}
          <div className="gr__hint">
            A rule only changes a lead&apos;s score the next time that lead is scored.
            {' '}
            <button type="button" className="k-btn k-btn--ghost"
              disabled={!canWrite || busy === 'all'} title={denial || undefined}
              onClick={rescoreAll}>
              {busy === 'all' ? 'Rescoring…' : 'Rescore every contact now'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
