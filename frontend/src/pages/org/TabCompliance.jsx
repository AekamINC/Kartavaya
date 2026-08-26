import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, ErrorState, Modal, SkeletonCard, Tag, useToast,
} from '../../components/ui';
import Seg from '../../components/customize/Seg';
import { Secondary } from '../../components/Bilingual';
import { formatDate, formatTime } from '../../lib/timeFormat';
import { moduleByCode, moduleLabel } from './catalogue';
import '../../styles/compliance.css';

/**
 * TabCompliance — the firm ticks what applies to it.
 *
 * ── What was here before ────────────────────────────────────────────────────
 *
 * Nothing. `staging.module_compliance_settings` (migration 210), the resolver,
 * the three-state vocabulary, the freeze onto issued invoices (211) and
 * `GET/PATCH /api/v1/org/compliance` all shipped in workstream H, and no screen
 * in the product has ever called any of it — measured 2026-08-26, the table
 * holds 0 rows across all five organisations. Proposal 80's entire premise is
 * that the FIRM decides, and until this panel there was nowhere for a firm to
 * decide anything.
 *
 * ── THE ONE RULE THIS SCREEN IS BUILT AROUND ────────────────────────────────
 *
 * PHASE-4 §4.1: never a control that makes a compliance CLAIM. "This firm
 * recorded that the composition scheme applies to it, on 26 August, and here
 * is who recorded it" is a FACT — the product observed it happen. "You are GST
 * compliant" is a sentence the customer would repeat to their own regulator on
 * our word, and Kartavaya does not have that word to give: it cannot see the
 * firm's registrations, its filings, its turnover or its returns.
 *
 * So every string on this panel is one of three things and never a fourth:
 *
 *   · what a STATE means            ("the field is hidden, nothing is missing")
 *   · what a GAP costs              ("the buyer's input tax credit may be
 *                                     questioned") — a consequence, from the
 *                                     server's registry, not this file
 *   · what the PRODUCT will do      ("Kartavaya does not read this yet")
 *
 * The banned-phrase check lives on the registry, server-side
 * (`tests/test_compliance_settings_screen.py`), because that is where the
 * sentences come from — this file renders whatever the API sends.
 *
 * ── WHY THE THIRD STATE DISAPPEARS ON SOME ROWS ─────────────────────────────
 *
 * `wired: false` means no code reads that rule's state yet. "Enforced" means
 * the firm asked to be STOPPED, and offering it where nothing can stop
 * anything would be the same lie wearing a control — so the segmented group is
 * built from `rule.states`, which the server sends, and the row carries a line
 * saying in as many words that recording it changes nothing the product does.
 * The API refuses `enforced` for those rules too; this is not the only guard.
 *
 * ── EVERY CHANGE GOES THROUGH THE DIALOG ────────────────────────────────────
 *
 * Including a change BACK to the default. Proposal 80's rule 1 is that "not
 * applicable is a decision, not an absence" — and so is reversing one. The
 * dialog states what the new state will do, in the same words the legend uses,
 * and takes the optional reason. Six months later that reason is what tells
 * "we are a composition dealer, so GST does not apply" apart from "somebody
 * unticked it to make a warning go away", which is the distinction the whole
 * feature exists to preserve.
 *
 * The reason is OPTIONAL and stays optional. Making it mandatory would be a
 * requirement the product invented, on a screen whose subject is that this
 * product invents no requirements.
 */

/** The three states, in the order the segmented control shows them.
 *
 *  `blurb` is what the state DOES — the same sentence in the legend, in the
 *  dialog and in the row, so a user reads it once and recognises it twice.
 *  These describe product behaviour, which is the only thing this file is
 *  entitled to describe; what a GAP costs comes from the server per rule.
 */
const STATE_META = {
  not_applicable: {
    label: 'Not applicable',
    hi: 'लागू नहीं',
    blurb: 'You are telling us this does not apply to your firm. The field is '
         + 'hidden and nothing is counted as missing, because nothing is.',
    tone: 'var(--on-surface-3)',
  },
  applicable: {
    label: 'Applicable',
    hi: 'लागू',
    blurb: 'It applies, and we never stop you. The field is shown, it stays '
         + 'optional, and we say what leaving it empty costs.',
    tone: 'var(--ok)',
  },
  enforced: {
    label: 'Enforced',
    hi: 'अनिवार्य',
    blurb: 'You have asked to be stopped. Kartavaya refuses to issue the '
         + 'document until this is filled in.',
    tone: 'var(--warn)',
  },
};

const Info = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" />
  </svg>
);

/**
 * Who decided this, and when.
 *
 * THREE outcomes, not two. `has_setter` false is "nobody has touched this rule
 * and it is running on the default"; `has_setter` true with no name is "a
 * person decided this and their account is gone". Collapsing those into one
 * blank line throws away the difference between nothing having been decided
 * and us no longer being able to say who decided it — which is most of what an
 * attribution is for. `services/audit_actors.py` draws the same distinction
 * server-side and this is its rendering.
 */
function Provenance({ rule, defaultState }) {
  if (!rule.has_setter) {
    return (
      <p className="cmpl__meta cmpl__meta--none">
        Nobody has set this. It is running on the default,
        {' '}<strong>{STATE_META[defaultState]?.label || defaultState}</strong>.
      </p>
    );
  }
  const when = rule.set_at ? formatDate(rule.set_at) : null;
  return (
    <p className="cmpl__meta">
      {rule.set_by_name
        ? <>Set by <strong>{rule.set_by_name}</strong></>
        : <>Set by someone whose account has since been removed</>}
      {when ? <> on {when}</> : null}
      {rule.reason
        ? <> — <span className="cmpl__reason">“{rule.reason}”</span></>
        : <> — <span className="cmpl__noreason">no reason recorded</span></>}
    </p>
  );
}

/** One rule: the control, what a gap costs, and who decided. */
function RuleRow({ module, ruleKey, rule, defaultState, busy, onPick }) {
  const options = (rule.states || []).map(s => ({
    value: s,
    label: STATE_META[s]?.label || s,
  }));
  const off = rule.state !== defaultState;

  return (
    <div className={`cmpl__rule${off ? ' cmpl__rule--off' : ''}`}>
      <div className="cmpl__head">
        <div className="cmpl__name">
          <span className="cmpl__t">{rule.label}</span>
          {!rule.wired && (
            <Tag className="cmpl__tag" color="var(--on-surface-3)">Recorded only</Tag>
          )}
        </div>
        <Seg
          options={options}
          value={rule.state}
          label={`${rule.label} — does this apply to your firm?`}
          onChange={next => {
            if (next === rule.state || busy) return;
            onPick({ module, ruleKey, rule, next });
          }}
        />
      </div>

      {/* The consequence, from the server's registry. Shown at every state,
          not only at the one it describes: a firm deciding whether something
          applies to it needs to know what riding on the default costs BEFORE
          it chooses, and hiding the sentence until afterwards is the shape of
          a warning that arrives too late to act on. */}
      <p className="cmpl__why">{rule.consequence}</p>

      {!rule.wired && (
        <p className="cmpl__note">
          Kartavaya does not read this yet — recording it stores your firm's
          position with your name and the date, and changes nothing the product
          does. It is a note you can show someone, not a control.
        </p>
      )}

      <Provenance rule={rule} defaultState={defaultState} />
    </div>
  );
}

/**
 * Every compliance decision this firm has made, in order.
 *
 * ── WHY THE ROW ABOVE IS NOT ENOUGH ─────────────────────────────────────────
 *
 * `module_compliance_settings` is an UPSERT — one row per (org, module, rule),
 * overwritten in place. So the panel can only ever show the LATEST decision,
 * and a firm that recorded "composition dealer, so no GST" in March and
 * reversed it in August has lost the March sentence from every screen. That is
 * precisely the case proposal 80's rule 1 exists for: six months later, telling
 * "this genuinely does not apply to us" apart from "somebody made a warning go
 * away" needs the sequence, not the current value.
 *
 * ── AND WHY THERE IS NO NEW ENDPOINT FOR IT ─────────────────────────────────
 *
 * The events are already there. `services/audit.emit` has written one per
 * change since workstream H, and `routers/audit.py` already serves them to the
 * same two roles this panel is gated on, already resolves the actor's NAME
 * (never their id, never their email) and already paginates by keyset. Writing
 * a second reader over `staging.audit_log` would be a second answer to "who
 * changed this", and audit.py's own header is about what happens when a table
 * has no reader — not about wanting two.
 *
 * Fetched on FIRST OPEN, not on mount: it is a second request for a section
 * most visits never expand, and the panel's first paint is the part somebody
 * is waiting on.
 */
function History({ labelFor, stamp }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);

  // `stamp` is bumped by every successful write. Dropping what we hold makes
  // the fetch effect below re-run while the section is open, and re-fetch on
  // the next open while it is closed. Without it, recording a decision and
  // then opening the history shows a list that does not contain it — the one
  // moment a user is most likely to look.
  useEffect(() => { setEvents(null); setFailed(false); }, [stamp]);

  useEffect(() => {
    if (!open || events || failed) return;
    api.get('/v1/audit/events', {
      params: { action: 'compliance.setting_updated', limit: 50 },
    })
      .then(r => setEvents(r.data?.data || []))
      .catch(() => setFailed(true));
  }, [open, events, failed]);

  return (
    <section className="st__group">
      <h2 className="st__gt">
        Decision history
        <Secondary className="st__gh" value="निर्णय इतिहास" />
      </h2>
      <p className="cmpl__lede">
        Each row above shows the decision in force. This is the sequence that
        got there — a setting is stored once and overwritten, so a reversal
        would otherwise take the earlier reason off the screen with it.
      </p>

      <Button variant="ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? 'Hide history' : 'Show history'}
      </Button>

      {open && failed && (
        <p className="cmpl__note">
          Couldn’t load the history. The decisions above are unaffected — this
          section reads the audit log, which is a separate record.
        </p>
      )}

      {open && !failed && !events && (
        <p className="cmpl__note">Loading…</p>
      )}

      {open && events?.length === 0 && (
        <p className="cmpl__note">
          No compliance setting has been changed yet, so there is nothing to
          show. Every rule is on its default.
        </p>
      )}

      {open && events?.length > 0 && (
        <ol className="cmpl__hist">
          {events.map(e => {
            const d = e.detail || {};
            return (
              <li className="cmpl__hev" key={e.id}>
                <span className="cmpl__hwhen">
                  {formatDate(e.ts)} · {formatTime(e.ts)}
                </span>
                <span className="cmpl__hwhat">
                  <strong>{labelFor(d.module, d.rule_key)}</strong>
                  {' — '}
                  {STATE_META[d.previous_state]?.label || d.previous_state || 'default'}
                  {' → '}
                  <strong>{STATE_META[d.state]?.label || d.state}</strong>
                </span>
                {/* `actor_name`, never `user_id`. audit.py ships both because
                    its own filter needs the key; only the name is drawn. */}
                <span className="cmpl__hwho">{e.actor_name}</span>
                {d.reason
                  ? <span className="cmpl__hwhy">“{d.reason}”</span>
                  : <span className="cmpl__hwhy cmpl__noreason">no reason recorded</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default function TabCompliance() {
  const { pushToast } = useToast();
  const [modules, setModules] = useState([]);
  const [defaultState, setDefaultState] = useState('applicable');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(null);   // the change awaiting confirm
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  // Bumped after every successful write; `History` drops what it holds on it,
  // so the trail cannot be one decision behind the controls above it.
  const [stamp, setStamp] = useState(0);

  const load = useCallback(() => {
    setFailed(false);
    return api.get('/v1/org/compliance')
      .then(r => {
        setModules(r.data?.modules || []);
        setDefaultState(r.data?.default_state || 'applicable');
      })
      // A failed GET renders the error, never an empty panel. Every control
      // here is a stored decision; a blank screen would read as "your firm has
      // recorded nothing", which is a claim about the data rather than about
      // the request that could not be made.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = useCallback((change) => {
    // Pre-fill with the reason already on the row: a firm refining its wording
    // should not have to retype it, and a blank box beside an existing note
    // reads as though the note has been lost.
    setReason(change.rule.reason || '');
    setPending(change);
  }, []);

  const commit = async () => {
    if (!pending) return;
    const { module, ruleKey, next } = pending;
    setSaving(true);
    try {
      const r = await api.patch(`/v1/org/compliance/${module}`, {
        rule_key: ruleKey,
        state: next,
        reason: reason.trim() || null,
      });
      // Patch the one rule in place from the server's answer rather than
      // re-fetching the panel: the response IS the stored row, and a reload
      // would scroll a long panel back to the top after every change.
      const saved = r.data || {};
      setModules(ms => ms.map(m => (m.module !== module ? m : {
        ...m,
        rules: {
          ...m.rules,
          [ruleKey]: { ...m.rules[ruleKey], ...saved, states: m.rules[ruleKey].states },
        },
      })));
      setPending(null);
      setStamp(s => s + 1);
      pushToast({
        type: 'success',
        title: `${pending.rule.label} recorded as ${STATE_META[next]?.label || next}`,
        message: 'Your name and the date are stored with it.',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: err?.response?.data?.detail || 'Could not save that setting',
      });
    } finally { setSaving(false); }
  };

  const shown = useMemo(
    () => modules.filter(m => Object.keys(m.rules || {}).length),
    [modules]);

  /**
   * A rule's human label, for the history list. The audit event stores
   * `module` and `rule_key` and NOT the label, deliberately — a label is
   * product copy that gets reworded, and an audit row that carries a copy of
   * it would freeze last year's wording into the trail. So it is resolved
   * against the live registry here.
   *
   * The fallback is the `rule_key` itself, which happens where a rule has
   * since left the registry. That is a rule name, not a user, member or org
   * id, so drawing it breaks nothing — and the alternative, a blank, would
   * make a real decision unreadable.
   */
  const labelFor = useCallback((module, ruleKey) => {
    const rule = modules.find(m => m.module === module)?.rules?.[ruleKey];
    return rule?.label || ruleKey || 'a setting';
  }, [modules]);

  if (loading) return <SkeletonCard lines={10} />;

  if (failed) {
    return (
      <ErrorState
        kind="server"
        detail="Couldn’t load your compliance settings. The panel stays hidden rather than showing every rule at its default — a default your firm has not chosen is not the same as a decision, and this screen exists to keep those two apart."
        onRetry={() => { setLoading(true); load(); }}
      />
    );
  }

  return (
    <div>
      <section className="st__group">
        <h2 className="st__gt">
          What applies to your firm
          <Secondary className="st__gh" value="आपकी फर्म पर क्या लागू है" />
        </h2>

        <p className="cmpl__lede">
          No government requirement is mandatory in Kartavaya. Every rule below
          starts at <strong>{STATE_META[defaultState]?.label || defaultState}</strong>,
          which shows the field, leaves it optional and tells you what a gap
          costs. Nothing arrives enforced, and nothing here was chosen for you.
        </p>

        <p className="opend opend--stack">
          {Info}
          <span>
            <strong>These settings record your firm’s own position.</strong>{' '}
            They are not an assessment of it. Kartavaya cannot see your
            registrations, your filings or your returns, so it does not judge
            whether an answer here is right — it stores what you told it, with
            who told it and when, so that six months from now the answer is
            still legible as a decision.
          </span>
        </p>

        <dl className="cmpl__legend">
          {['not_applicable', 'applicable', 'enforced'].map(s => (
            <div className="cmpl__leg" key={s}>
              <dt>
                <span className="cmpl__dot" style={{ '--c': STATE_META[s].tone }} />
                {STATE_META[s].label}
                <Secondary className="cmpl__leghi" value={STATE_META[s].hi} />
                {s === defaultState && <Tag color="var(--ok)">Default</Tag>}
              </dt>
              <dd>{STATE_META[s].blurb}</dd>
            </div>
          ))}
        </dl>
      </section>

      {shown.map(m => {
        const meta = moduleByCode(m.module);
        return (
          <section className="st__group" key={m.module}>
            <h2 className="st__gt">
              {moduleLabel(m.module)}
              {meta?.hi && <Secondary className="st__gh" value={meta.hi} />}
              {meta?.en && <span className="cmpl__en">{meta.en}</span>}
              {/* Annotated, never filtered. A firm that recorded a position and
                  later switched the module off must still be able to see and
                  correct it — hiding the section would leave a stored decision
                  nobody can reach. */}
              {!m.active && (
                <Tag className="cmpl__tag" color="var(--on-surface-3)">
                  Not switched on
                </Tag>
              )}
            </h2>

            <div className="cmpl__rules">
              {Object.entries(m.rules).map(([key, rule]) => (
                <RuleRow
                  key={key}
                  module={m.module}
                  ruleKey={key}
                  rule={rule}
                  defaultState={defaultState}
                  busy={saving}
                  onPick={open}
                />
              ))}
            </div>
          </section>
        );
      })}

      {!shown.length && (
        <section className="st__group">
          <p className="cmpl__lede">
            No module has compliance settings yet. They are added as the code
            that reads them is built, so this list grows rather than arriving
            full of controls that do nothing.
          </p>
        </section>
      )}

      {Boolean(shown.length) && <History labelFor={labelFor} stamp={stamp} />}

      <Modal
        open={Boolean(pending)}
        onOpenChange={o => { if (!o && !saving) setPending(null); }}
        dataTestId="compliance-confirm"
        size="sm"
        title={pending ? pending.rule.label : ''}
        footer={pending ? (
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={saving}>
              {saving ? 'Recording…' : `Record as ${STATE_META[pending.next]?.label || pending.next}`}
            </Button>
          </>
        ) : null}
      >
        {pending && (
          <div className="cmpl__mod">
            <p className="cmpl__modstate">
              <span className="cmpl__dot" style={{ '--c': STATE_META[pending.next]?.tone }} />
              <strong>{STATE_META[pending.next]?.label || pending.next}</strong>
              {' — '}
              {STATE_META[pending.next]?.blurb}
            </p>

            {!pending.rule.wired && (
              <p className="cmpl__note">
                Nothing in Kartavaya reads this setting yet, so recording it
                changes no behaviour. It stores your firm’s position, with your
                name and today’s date against it.
              </p>
            )}

            <label className="of__l" htmlFor="cmpl-reason">Why (optional)</label>
            <textarea
              id="cmpl-reason"
              className="of__i cmpl__reasonin"
              rows={3}
              value={reason}
              disabled={saving}
              placeholder="e.g. composition dealer — we charge no GST"
              onChange={e => setReason(e.target.value)}
            />
            <span className="of__h">
              Optional, and it stays optional. Six months from now this is what
              tells “this does not apply to our firm” apart from “somebody
              switched a warning off”.
            </span>
          </div>
        )}
      </Modal>
    </div>
  );
}
