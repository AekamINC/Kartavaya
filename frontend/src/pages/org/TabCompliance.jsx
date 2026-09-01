import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, ErrorState, Modal, ServerPicker, SkeletonCard, Tag, useToast,
} from '../../components/ui';
import Seg from '../../components/customize/Seg';
import { Secondary } from '../../components/Bilingual';
import { formatDate, formatTime } from '../../lib/timeFormat';
import { moduleByCode, moduleLabel } from './catalogue';
import '../../styles/compliance.css';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabCompliance — the firm ticks what applies to it, and to whom.
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
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE SCOPE SWITCHER (migration 253)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The owner's ask, verbatim: "by default settings default will apply on all
 * but if org, client asked to or remove gst, or employee negotiation on leave
 * and commission then it override default setting."
 *
 * So this panel answers the same question about three different subjects: the
 * firm, one client, one employee. `Seg` at the top chooses which, and the two
 * override scopes then ask WHO before showing anything — a rule list with no
 * subject is the firm's defaults wearing a client's heading, which is the one
 * misreading this whole feature is dangerous for.
 *
 * ── THE SENTENCE IS NOT THE SAME SENTENCE ───────────────────────────────────
 *
 * "Not applicable for Acme Traders" and "Not applicable at this firm" are
 * different facts, and an administrator who confuses them edits what looks
 * like one client's exception and silently rewrites the answer for every
 * client at once. So a scoped row never shows one state: it shows the firm's
 * default, the exception if there is one, and which of the two is in force —
 * each labelled with whose answer it is.
 *
 * ── `source`, NEVER A COMPARISON ────────────────────────────────────────────
 *
 * An exception that sets the SAME value as the firm default is still an
 * exception. Somebody decided it deliberately, and when the firm default later
 * moves, this client must NOT move with it. `state === default.state` cannot
 * see that difference; the server's `source` can, and it is the only thing
 * this file is allowed to branch on. The one place values are compared at all
 * is to say that sentence out loud on the row — see `sameAsFirm` below, which
 * decides no behaviour.
 *
 * ── ONE DIRECTION IS NOT SYMMETRICAL ────────────────────────────────────────
 *
 * An exception can be removed. A firm default cannot: every rule always
 * resolves to something, so there is no state for "unset" to mean, and
 * `services/compliance_settings.py::clear_rule` refuses `scope_type='org'`
 * outright. The screen says that in words rather than leaving a user to
 * discover it as a missing button.
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

/**
 * Whose answer is being edited.
 *
 * `noun` is the singular the row sentences are built from, so "an exception
 * for this client" and "an exception for this employee" come out of one
 * template instead of two nearly-identical branches that drift.
 *
 * `org` deliberately carries no `noun` and no picker copy: it is not an
 * override, it has no subject to choose, and it reads through a different
 * endpoint. The absence is the type distinction — anything that reaches for
 * `SCOPE_META[scope].noun` is by construction on an override path.
 */
const SCOPE_META = {
  org: { label: 'This firm', hi: 'यह फर्म' },
  client: {
    label: 'One client',
    hi: 'एक क्लाइंट',
    noun: 'client',
    plural: 'clients',
    pick: 'Which client?',
  },
  employee: {
    label: 'One employee',
    hi: 'एक कर्मचारी',
    noun: 'employee',
    plural: 'employees',
    pick: 'Which employee?',
  },
};

/** Display order for the switcher. Matches `services/compliance_settings.SCOPES`. */
const SCOPE_ORDER = ['org', 'client', 'employee'];

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

/** One rule at the FIRM's level: the control, what a gap costs, and who decided. */
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
            onPick({ kind: 'firm', module, ruleKey, rule, next });
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
 * One rule for ONE client or employee. Three answers on the row, never one.
 *
 * ── WHY THE SEGMENTED CONTROL STARTS ON NOTHING ─────────────────────────────
 *
 * `value` is the OVERRIDE's state, not the effective one — so a subject with
 * no exception shows a group with no segment on. That looks like an empty
 * control and it is exactly right: there IS no exception, and the answer in
 * force is stated in words above it, attributed to the firm.
 *
 * Pre-selecting the effective state instead would draw the firm's answer as
 * though this client had chosen it — the exact confusion this whole screen
 * exists to prevent. An empty control says "this client has made no decision";
 * a filled one says "this client decided", and only one of those is true.
 *
 * ⚠ AN EARLIER VERSION OF THIS COMMENT GAVE A SECOND REASON THAT WAS FICTION:
 * that pre-selecting would make the click unreachable "because clicking the
 * already-selected segment does nothing". `Seg.jsx:56` is a bare
 * `onClick={() => onChange(o.value)}` with no equality guard, so that click
 * fires like any other. The design above is right; that justification was not,
 * and a future author would have built on it. Corrected rather than deleted,
 * because the thing worth recording is that somebody checked.
 *
 * What IS true and matters: pinning a client to the value the firm happens to
 * hold today is a real, different decision from letting that client follow the
 * firm. It is the owner's "client asked to remove gst" written down, so that
 * changing the firm default later does not quietly change it back.
 */
function ScopedRuleRow({
  module, ruleKey, rule, scopeType, scopeName, busy, onPick, onClear,
}) {
  const def = rule.default || {};
  const override = rule.override || null;
  // ⚠ `source`, from the server. NEVER `rule.state !== def.state` — see the
  // file header. An exception that agrees with the firm is still an exception.
  const isOverride = rule.source === 'override';
  const noun = SCOPE_META[scopeType]?.noun || 'subject';

  const options = (rule.states || []).map(s => ({
    value: s,
    label: STATE_META[s]?.label || s,
  }));

  // The ONE value comparison on this screen, and it drives no behaviour — only
  // the sentence below, which exists because an exception that reads identical
  // to the firm default looks like a mistake until somebody says why it is not.
  const sameAsFirm = isOverride && override?.state === def.state;

  return (
    <div className={`cmpl__rule${isOverride ? ' cmpl__rule--off' : ''}`}>
      <div className="cmpl__head">
        <div className="cmpl__name">
          <span className="cmpl__t">{rule.label}</span>
          {!rule.wired && (
            <Tag className="cmpl__tag" color="var(--on-surface-3)">Recorded only</Tag>
          )}
          <Tag
            className="cmpl__tag"
            color={isOverride ? 'var(--primary)' : 'var(--on-surface-3)'}
          >
            {isOverride ? `Exception for this ${noun}` : 'Following the firm'}
          </Tag>
        </div>
        <Seg
          options={options}
          value={override ? override.state : ''}
          label={`${rule.label} — exception for ${scopeName}?`}
          onChange={next => {
            if (busy) return;
            onPick({ kind: 'override', module, ruleKey, rule, next });
          }}
        />
      </div>

      {/* What actually applies to this subject, and WHOSE answer it is. The
          same block the confirmation dialog uses for a state: one dot, one
          name, one sentence. Two spellings of "here is a state and what it
          means" is how a vocabulary stops being one. */}
      <p className="cmpl__modstate">
        <span className="cmpl__dot" style={{ '--c': STATE_META[rule.state]?.tone }} />
        <span>
          <strong>{STATE_META[rule.state]?.label || rule.state}</strong>
          {' for '}{scopeName}
          {isOverride
            ? <> — an exception recorded for this {noun}, not the firm’s answer.</>
            : <> — the firm’s answer, because no exception is recorded for this {noun}.</>}
        </span>
      </p>

      <p className="cmpl__why">{rule.consequence}</p>

      {!rule.wired && (
        <p className="cmpl__note">
          Kartavaya does not read this yet — recording it stores the position
          with your name and the date, and changes nothing the product does.
        </p>
      )}

      {/* The firm's own answer, always, whether or not it is the one in force.
          A person about to record an exception needs to see what they are
          making an exception TO. */}
      <p className="cmpl__meta">
        At this firm:
        {' '}<strong>{STATE_META[def.state]?.label || def.state}</strong>.
      </p>
      <Provenance rule={def} defaultState={def.default_state} />

      {isOverride && (
        <p className="cmpl__meta">
          For <strong>{scopeName}</strong>:
          {' '}<strong>{STATE_META[override.state]?.label || override.state}</strong>
          {override.set_by_name
            ? <> — recorded by <strong>{override.set_by_name}</strong></>
            : <> — recorded by someone whose account has since been removed</>}
          {override.set_at ? <> on {formatDate(override.set_at)}</> : null}
          {override.reason
            ? <> — <span className="cmpl__reason">“{override.reason}”</span></>
            : <> — <span className="cmpl__noreason">no reason recorded</span></>}
        </p>
      )}

      {sameAsFirm && (
        <p className="cmpl__note">
          This exception says the same thing as the firm’s answer today, and it
          is still an exception: if the firm’s answer changes, {scopeName} keeps
          this one.
        </p>
      )}

      {isOverride ? (
        <p className="cmpl__meta">
          <Button
            variant="out"
            size="sm"
            disabled={busy}
            onClick={() => onClear({ kind: 'clear', module, ruleKey, rule })}
          >
            Remove this exception
          </Button>
        </p>
      ) : (
        <p className="cmpl__note">
          There is nothing to remove — {scopeName} has no exception on this
          rule. Choose a state above to record one. The firm’s own answer is
          changed rather than removed; it has no “unset”, because every rule
          always resolves to something.
        </p>
      )}
    </div>
  );
}

/**
 * WHICH client, or WHICH employee.
 *
 * `ServerPicker`, not a plain list: `GET /v1/graha/clients` is LIMIT 200 and
 * this product already has organisations past it (292 live contacts against a
 * 200-row window — see the component's own header). A picker that filters an
 * already-truncated array hides the rest SILENTLY, and a user who cannot find
 * a client concludes it is not there. So the search goes to the server, and
 * when the server says the page was cut short this says so out loud.
 */
function ScopePicker({
  scopeType, scopeId, targets, truncated, failed, onSearch, onChange,
}) {
  const meta = SCOPE_META[scopeType] || {};

  if (failed) {
    return (
      <p className="cmpl__note">
        Couldn’t load the list of {meta.plural}. Nothing is recorded or changed
        by this — try switching scope again.
      </p>
    );
  }
  if (!targets) return <p className="cmpl__note">Loading {meta.plural}…</p>;

  return (
    <div>
      <span className="of__l">{meta.pick}</span>
      <ServerPicker
        items={targets}
        value={scopeId || null}
        onChange={onChange}
        onSearch={onSearch}
        search
        field
        placeholder={meta.pick}
        ariaLabel={meta.pick}
      />
      {truncated && (
        <span className="of__h">
          Showing the first {targets.length} by name. Type to search the rest —
          the list is cut short, not complete.
        </span>
      )}
      {!targets.length && (
        <p className="cmpl__note">
          No {meta.plural} to choose from. An exception is recorded against a
          real {meta.noun}, so there is nothing to record one for yet.
        </p>
      )}
    </div>
  );
}

/**
 * Every compliance decision this firm has made, in order.
 *
 * ── WHY THE ROW ABOVE IS NOT ENOUGH ─────────────────────────────────────────
 *
 * `module_compliance_settings` is an UPSERT — one row per (org, module, rule,
 * scope), overwritten in place, and an exception that is removed leaves no row
 * at all. So the panel can only ever show the LATEST decision, and a firm that
 * recorded "composition dealer, so no GST" in March and reversed it in August
 * has lost the March sentence from every screen. That is precisely the case
 * proposal 80's rule 1 exists for: six months later, telling "this genuinely
 * does not apply to us" apart from "somebody made a warning go away" needs the
 * sequence, not the current value.
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
 * That is also why an override is emitted under the SAME action string as a
 * firm-level change: `/v1/audit/events` filters on one action, this is one
 * list, and an exception is a compliance decision by rule 1 exactly as much as
 * a default is. `detail.scope_name` is what tells them apart on the line.
 *
 * ── AND WHY IT IS NOT FILTERED TO THE CHOSEN SCOPE ──────────────────────────
 *
 * The trail is the firm's, not the current selection's. Somebody looking at
 * one client's exception most needs to see the firm-level change that made it
 * necessary, and a list that hid it would answer "why is this here" with
 * silence.
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
        would otherwise take the earlier reason off the screen with it. Every
        scope is here, not only the one selected above.
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
                  {/* WHOSE decision. The NAME the server recorded on the event
                      at the time, not a lookup against the live table: a
                      client that has since been renamed or removed must still
                      make this line legible, which is the whole point of an
                      audit trail. Never the id — audit.py ships one because
                      its own filter needs it, and it is not drawn here. */}
                  {d.scope_name ? <> for <strong>{d.scope_name}</strong></> : null}
                  {' — '}
                  {STATE_META[d.previous_state]?.label || d.previous_state || 'default'}
                  {' → '}
                  <strong>{STATE_META[d.state]?.label || d.state}</strong>
                  {d.cleared ? <> (exception removed, back to the firm’s answer)</> : null}
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
  const [scopeType, setScopeType] = useState('org');
  const [scopeId, setScopeId] = useState('');
  const [scopeName, setScopeName] = useState('');
  const [targets, setTargets] = useState(null);       // null = not asked yet
  const [targetsTruncated, setTargetsTruncated] = useState(false);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
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

  const scoped = scopeType !== 'org';
  // An override scope with nobody chosen has nothing to show. Kept as one
  // derived boolean rather than repeated inline: three places read it, and the
  // failure it prevents — rendering the firm's defaults under a client's
  // heading — is not one to leave to three separate conditions agreeing.
  const awaitingSubject = scoped && !scopeId;

  const load = useCallback(() => {
    setFailed(false);
    const url = scoped
      ? `/v1/org/compliance/scope/${scopeType}/${scopeId}`
      : '/v1/org/compliance';
    return api.get(url)
      .then(r => {
        setModules(r.data?.modules || []);
        setDefaultState(r.data?.default_state || 'applicable');
        // Only the server names the subject. The picker knows a name too, but
        // taking it from there would draw whatever the browser last held for
        // an id the server may have refused — and a refusal is exactly when a
        // wrong name is most convincing.
        setScopeName(r.data?.scope_name || '');
      })
      // A failed GET renders the error, never an empty panel. Every control
      // here is a stored decision; a blank screen would read as "your firm has
      // recorded nothing", which is a claim about the data rather than about
      // the request that could not be made.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [scoped, scopeType, scopeId]);

  useEffect(() => {
    if (awaitingSubject) {
      setModules([]);
      setScopeName('');
      setFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [load, awaitingSubject]);

  // Who an exception can be about. Not fetched at all for the firm's own page:
  // there is nobody to choose, and a request whose answer is never read is a
  // request that eventually breaks a test nobody can explain.
  useEffect(() => {
    if (!scoped) return undefined;
    let alive = true;
    setTargetsFailed(false);
    api.get(`/v1/org/compliance/targets/${scopeType}`,
      targetQuery ? { params: { q: targetQuery } } : undefined)
      .then(r => {
        if (!alive) return;
        setTargets(r.data?.targets || []);
        setTargetsTruncated(Boolean(r.data?.truncated));
      })
      .catch(() => { if (alive) { setTargets([]); setTargetsFailed(true); } });
    return () => { alive = false; };
  }, [scoped, scopeType, targetQuery]);

  const pickScope = useCallback((next) => {
    if (next === scopeType) return;
    setScopeType(next);
    // Everything about the previous subject goes, including the rules. Leaving
    // them on screen for the render between the switch and the fetch shows one
    // client's exceptions under another's name.
    setScopeId('');
    setScopeName('');
    setTargets(null);
    setTargetsTruncated(false);
    setTargetQuery('');
    setModules([]);
  }, [scopeType]);

  const open = useCallback((change) => {
    // Pre-fill with the reason already on the row: a firm refining its wording
    // should not have to retype it, and a blank box beside an existing note
    // reads as though the note has been lost. For an exception that is the
    // exception's own reason, never the firm default's — they are different
    // decisions and copying one into the other would put words in a person's
    // mouth on a screen whose subject is attribution.
    if (change.kind === 'clear') setReason('');
    else if (change.kind === 'override') setReason(change.rule.override?.reason || '');
    else setReason(change.rule.reason || '');
    // THE SUBJECT IS STAMPED ON THE PENDING CHANGE, not read from state when
    // the write goes out. The dialog names one client by name and the button
    // says "Record for Acme Traders"; if the scope could move underneath it,
    // that sentence and the row that gets written would be about two different
    // people. Nothing in this screen is worth less than knowing whose answer
    // was just changed.
    setPending({
      ...change,
      scopeType,
      scopeId,
      scopeName,
    });
  }, [scopeType, scopeId, scopeName]);

  const applySaved = useCallback((module, ruleKey, updater) => {
    setModules(ms => ms.map(m => (m.module !== module ? m : {
      ...m,
      rules: { ...m.rules, [ruleKey]: updater(m.rules[ruleKey]) },
    })));
  }, []);

  const commit = async () => {
    if (!pending) return;
    // Destructured from `pending`, which carries the subject that was on
    // screen when the dialog opened — see `open`.
    const { kind, module, ruleKey, next } = pending;
    const forScope = pending.scopeType;
    const forSubject = pending.scopeId;
    const forName = pending.scopeName;
    setSaving(true);
    try {
      if (kind === 'firm') {
        const r = await api.patch(`/v1/org/compliance/${module}`, {
          rule_key: ruleKey,
          state: next,
          reason: reason.trim() || null,
        });
        // Patch the one rule in place from the server's answer rather than
        // re-fetching the panel: the response IS the stored row, and a reload
        // would scroll a long panel back to the top after every change.
        const saved = r.data || {};
        applySaved(module, ruleKey, prev => ({ ...prev, ...saved, states: prev.states }));
      } else if (kind === 'override') {
        const r = await api.patch(`/v1/org/compliance/${module}/override`, {
          rule_key: ruleKey,
          state: next,
          scope_type: forScope,
          scope_id: forSubject,
          reason: reason.trim() || null,
        });
        // REPLACED, not merged. The server re-resolves the whole rule after the
        // write and sends `default`, `override` and `source` together; merging
        // it over what the browser held would let a stale `source` survive the
        // very change that moved it.
        applySaved(module, ruleKey, prev => r.data?.rule || prev);
      } else {
        const r = await api.delete(`/v1/org/compliance/${module}/override`, {
          params: {
            rule_key: ruleKey,
            scope_type: forScope,
            scope_id: forSubject,
            // Recorded on the audit event only — the row it would annotate is
            // the one being removed. Omitted entirely when blank rather than
            // sent as an empty string, which would store a reason of "".
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          },
        });
        applySaved(module, ruleKey, prev => r.data?.rule || prev);
      }

      setPending(null);
      setStamp(s => s + 1);
      pushToast({
        type: 'success',
        title: kind === 'clear'
          ? `${pending.rule.label} — exception removed for ${forName}`
          : kind === 'override'
            ? `${pending.rule.label} recorded as ${STATE_META[next]?.label || next} for ${forName}`
            : `${pending.rule.label} recorded as ${STATE_META[next]?.label || next}`,
        message: 'Your name and the date are stored with it.',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: apiErrorText(err, 'Could not save that setting'),
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

  const scopeSwitcher = (
    <div className="cmpl__head">
      <div className="cmpl__name">
        <span className="cmpl__t">Whose answer are you setting?</span>
      </div>
      <Seg
        options={SCOPE_ORDER.map(s => ({ value: s, label: SCOPE_META[s].label }))}
        value={scopeType}
        label="Whose compliance answer are you setting?"
        onChange={pickScope}
      />
    </div>
  );

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

        {scopeSwitcher}

        <p className="cmpl__lede">
          Your firm’s answer applies to everyone. A single client or a single
          employee can be recorded as an exception to it — a client who asked
          to be invoiced without GST, an employee whose leave or commission was
          negotiated. An exception can be removed, and the person then follows
          the firm again. Your firm’s own answer is changed rather than removed:
          there is no “unset” for it, because every rule always resolves to
          something.
        </p>

        {scoped && (
          <ScopePicker
            scopeType={scopeType}
            scopeId={scopeId}
            targets={targets}
            truncated={targetsTruncated}
            failed={targetsFailed}
            onSearch={setTargetQuery}
            onChange={setScopeId}
          />
        )}

        {!scoped && (
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
        )}
      </section>

      {awaitingSubject && (
        <section className="st__group">
          <p className="cmpl__lede">
            Choose {SCOPE_META[scopeType]?.noun === 'client' ? 'a client' : 'an employee'}{' '}
            above. Nothing is shown until then — a list of rules with no
            {' '}{SCOPE_META[scopeType]?.noun} against it would be your firm’s own
            answers under somebody else’s name.
          </p>
        </section>
      )}

      {!awaitingSubject && loading && <SkeletonCard lines={10} />}

      {!awaitingSubject && !loading && failed && (
        <ErrorState
          kind="server"
          detail="Couldn’t load your compliance settings. The panel stays hidden rather than showing every rule at its default — a default your firm has not chosen is not the same as a decision, and this screen exists to keep those two apart."
          onRetry={() => { setLoading(true); load(); }}
        />
      )}

      {!awaitingSubject && !loading && !failed && shown.map(m => {
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
              {Object.entries(m.rules).map(([key, rule]) => (scoped ? (
                <ScopedRuleRow
                  key={key}
                  module={m.module}
                  ruleKey={key}
                  rule={rule}
                  scopeType={scopeType}
                  scopeName={scopeName}
                  busy={saving}
                  onPick={open}
                  onClear={open}
                />
              ) : (
                <RuleRow
                  key={key}
                  module={m.module}
                  ruleKey={key}
                  rule={rule}
                  defaultState={defaultState}
                  busy={saving}
                  onPick={open}
                />
              )))}
            </div>
          </section>
        );
      })}

      {!awaitingSubject && !loading && !failed && !shown.length && (
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
              {saving
                ? 'Recording…'
                : pending.kind === 'clear'
                  ? 'Remove the exception'
                  : pending.kind === 'override'
                    ? `Record for ${pending.scopeName}`
                    : `Record as ${STATE_META[pending.next]?.label || pending.next}`}
            </Button>
          </>
        ) : null}
      >
        {pending && (
          <div className="cmpl__mod">
            {pending.kind === 'clear' ? (
              <p className="cmpl__modstate">
                <span
                  className="cmpl__dot"
                  style={{ '--c': STATE_META[pending.rule.default?.state]?.tone }}
                />
                <span>
                  {pending.scopeName} goes back to your firm’s answer,{' '}
                  <strong>
                    {STATE_META[pending.rule.default?.state]?.label
                      || pending.rule.default?.state}
                  </strong>
                  . The exception recorded for them is removed; your firm’s own
                  answer is untouched.
                </span>
              </p>
            ) : (
              <p className="cmpl__modstate">
                <span className="cmpl__dot" style={{ '--c': STATE_META[pending.next]?.tone }} />
                <span>
                  <strong>{STATE_META[pending.next]?.label || pending.next}</strong>
                  {' — '}
                  {STATE_META[pending.next]?.blurb}
                </span>
              </p>
            )}

            {pending.kind === 'override' && (
              <p className="cmpl__note">
                This is recorded for <strong>{pending.scopeName}</strong> alone. Your
                firm’s answer stays{' '}
                <strong>
                  {STATE_META[pending.rule.default?.state]?.label
                    || pending.rule.default?.state}
                </strong>{' '}
                and every other {SCOPE_META[pending.scopeType]?.noun} keeps following it.
              </p>
            )}

            {!pending.rule.wired && pending.kind !== 'clear' && (
              <p className="cmpl__note">
                Nothing in Kartavaya reads this setting yet, so recording it
                changes no behaviour. It stores the position, with your name and
                today’s date against it.
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
              tells “this does not apply” apart from “somebody switched a
              warning off”.
              {pending.kind === 'clear' && (
                <> Removing an exception leaves no row behind, so this is
                {' '}recorded on the decision history and nowhere else.</>
              )}
            </span>
          </div>
        )}
      </Modal>
    </div>
  );
}
