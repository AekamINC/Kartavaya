// Skill Packs → Catalog. The marketplace: every template the org owns that this
// client does not already have.
//
// ── What this screen is for ──────────────────────────────────────────────────
//
// It was a list of name + description + step count, and a run of a skill pack
// SPENDS REAL CREDITS out of the org's wallet. Somebody deciding whether to
// assign one had no way to see what it would do, what it would ask them for,
// what it would cost, or whether it could run at all. This is the same
// information the run path already knows, shown before the decision instead of
// after it.
//
// ── Four things it now says that it did not ──────────────────────────────────
//
//  · WHAT IT COSTS, from the server's own price table. `estimated_credits` on
//    the template row is NOT that number: `routers/hub.py:1141` says so in as
//    many words — "an ESTIMATE that prices nothing … the charge is the sum of
//    the steps at run time, resolved by `credits.price_of`, so a template edited
//    after this number was written bills the new steps and not this stale
//    total". `costs` is that same table (`/v1/hub/org/credits` →
//    `_display_credit_costs` → `credits.price_of`), so the live sum is the
//    figure a run will actually debit and it leads. The stored column is used
//    only when the price table did not load, and is labelled as the stored
//    figure when it is. Neither is ever invented: with no table and no stored
//    value the card says the cost is unavailable, because a wrong price on a
//    screen someone buys from is worse than a missing one.
//
//  · WHY A PACK CANNOT RUN. A step naming a skill function that this server has
//    no implementation for, or one whose handler cannot be scoped to a single
//    organisation, is refused by `_run_function_step` — AFTER the pack has been
//    assigned, in front of whoever pressed Run rather than whoever chose it.
//    `/v1/hub/skills/capabilities` already answers this (`available`,
//    `unavailable_reason`, `unimplemented`) and the step editor already consumes
//    it; the catalog did not, so a pack that can never work looked identical to
//    one that works. It is now marked, the reason is the server's own sentence,
//    and Assign is disabled rather than failing later. When the capability list
//    itself fails to load, the cards say availability was not checked — they do
//    not quietly imply everything is fine.
//
//  · WHO MAY ASSIGN. `assign_skill` is guarded by
//    `require_platform_role(*OPERATIONS_CONSOLE_ROLES)` AND by
//    `_hub_gate = require_module("sahayak")` — two gates, and the button was
//    offered to everyone regardless of either. That is the same defect the
//    Create tab documents and fixed for itself ("Create Template was offered to
//    everyone and 403'd on submit"). `canManage` mirrors the first gate,
//    `useModuleWrite` the second. Disabled with the reason in the title, never
//    hidden: a greyed control carrying the API's own sentence teaches what the
//    role means, per the F32 note in module.css.
//
//  · WHAT A STEP ACTUALLY IS. Every step rendered as `words(s.agent_type)`, and
//    a data step has no `agent_type` at all — `words(undefined)` is the empty
//    string, so every data step in the catalog drew a numbered chip with no
//    label in it. Data steps are the reason the dispatcher exists; they now say
//    which records they read, and that they are free.
//
// ── Colour ───────────────────────────────────────────────────────────────────
//
// Per-category tone, from the module palette in `styles/module.css` and nowhere
// else. `CATEGORY_MODULE` maps a category onto a module id whose colour it
// borrows; the value itself is resolved by `orgModuleColor`, so there is no
// second colour table to drift and both themes are handled by the tokens. It is
// what `docs/proposals/14-whole-product.html` does with the same idea — its
// marketplace cards carry `--mc: var(--m-graha)`, `var(--m-prachar)` and so on,
// one tone per catalogue category.
//
// `t.module` is preferred when it is there, because a template that declares its
// own module should be coloured and labelled as that module rather than by the
// category it was filed under. It is usually NOT there:
// `migrations/PROPOSED_085_skill_template_columns.sql` records that the column
// 059 declared never landed on the live database. This reads it defensively for
// the day it does, and shows a module label only when one is actually present —
// never a filter row of twelve modules that nothing populates.
//
// The module list itself is imported from `pages/org/catalogue.js`. That file's
// header records what a second local copy costs: eight codes here against
// twelve in `role_tiers`, and four modules unreachable through the UI built to
// reach them. There is one list.
import React, { useState, useMemo } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/toast';
import { Empty } from '../../../components/editorial';
import { Resource, errText, words, creditLabel, useResource } from '../_shared';
import {
  SkillGlyph, CATEGORY_LABELS, parseSteps, extractVariables, estimateCredits, stepKind,
  blockersFor, packPrice,
} from './_shared';
import { moduleEntry, orgModuleColor } from '../../org/catalogue';
import useModuleWrite from '../../../hooks/useModuleWrite';

/**
 * Category → the module whose accent it borrows.
 *
 * Not a colour table: the seven values are module ids, and the colour comes from
 * `orgModuleColor` → `moduleColors.js` → the `--m-*` tokens in module.css, which
 * flip by theme on their own. A category this map does not know resolves to
 * `--on-surface-3`, which is `orgModuleColor`'s honest "no identity colour yet"
 * rather than a borrowed accent — the same decision that file makes for Varta.
 *
 * The pairings are by meaning, so the catalog reads as varied without the colour
 * lying about what a pack does: a festival pack is marketing, a launch pack is
 * sales, an engagement pack is conversation, a branding pack is Sahayak's own
 * work, a seasonal pack is analytics, an industry pack is CRM. `general` takes
 * the Hub's own indigo because the console it sits in is Hub.
 */
const CATEGORY_MODULE = {
  general: 'hub',
  festival: 'prachar',
  launch: 'vikray',
  engagement: 'sanvaad',
  branding: 'sahayak',
  seasonal: 'dristi',
  industry: 'graha',
};

/** The tone a card, chip and glyph carry. Declared module wins over category. */
const toneOf = t => orgModuleColor(t.module || CATEGORY_MODULE[t.category]);

const categoryLabel = c => CATEGORY_LABELS[c] || words(c) || 'Uncategorised';

/* `blockersFor` and `packPrice` moved to ./_shared — the org-side catalog in
   pages/sahayak/SkillsTab.jsx needs both, and keeping them here is exactly how
   the two screens came to quote two different prices for one template. */

/** What a run will ask for, read and change. Everything here is from the steps. */
function needsFor(steps, caps) {
  const sources = Object.fromEntries(
    (caps?.context_sources || []).map(s => [s.key, s.label]),
  );
  const reads = [];
  let writes = false;

  for (const step of steps) {
    if (step.skill_function) reads.push(words(step.skill_function));
    for (const key of step.context || []) reads.push(sources[key] || words(key));
    if (step.allow_writes) writes = true;
  }

  return { asks: extractVariables(steps), reads: [...new Set(reads)], writes };
}

export default function CatalogTab({ clientId, state, available, costs, canManage, onCreate, onChanged }) {
  const { pushToast } = useToast();
  // The module half of the guard on `assign_skill`. Explicit rather than from
  // context because this page mounts no `ModuleAccess` provider, and the code is
  // `sahayak` rather than `hub` — `hub` is a surface id, no grant row can hold it.
  const { canWrite, reason: denial } = useModuleWrite({
    module: 'sahayak', label: 'assign skill packs',
  });
  // The same list the step editor is built from, and the only thing that can say
  // whether a pack's data steps can run. Its own three states, so a failure here
  // reads as "not checked" rather than as "nothing wrong".
  const caps = useResource('/v1/hub/skills/capabilities', []);
  const [cat, setCat] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const canAssign = canManage && canWrite;
  const assignBlocked = !canManage
    ? 'Assigning a template is an Aekam function. Ask your account contact.'
    : denial || null;

  async function assign(id) {
    setBusyId(id);
    try {
      await api.post(`/v1/hub/clients/${clientId}/skills/${id}`, {});
      pushToast({ title: 'Skill pack assigned', type: 'success' });
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not assign it.'), type: 'error' });
    } finally { setBusyId(null); }
  }

  async function deactivate(id) {
    try {
      await api.delete(`/v1/hub/skills/templates/${id}`);
      setConfirmDel(null);
      pushToast({ title: 'Template deactivated for the whole organisation', type: 'success' });
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not deactivate it.'), type: 'error' });
    }
  }

  /* Everything the cards need, computed once per list rather than per render of
     each card: the steps are parsed out of JSON and the capability list is
     walked for every one of them. */
  const packs = useMemo(() => (available || []).map(t => {
    const steps = parseSteps(t.steps);
    const ai = steps.filter(s => stepKind(s) === 'ai').length;
    return {
      t,
      steps,
      ai,
      data: steps.length - ai,
      tone: toneOf(t),
      module: t.module ? moduleEntry(t.module) : null,
      // live / listed / stale — the one price rule, shared with the org-side
      // catalog so the two screens cannot disagree. See packPrice in _shared.
      ...packPrice(t, steps, costs),
      blockers: blockersFor(steps, caps.data),
      needs: needsFor(steps, caps.data),
    };
  }), [available, costs, caps.data]);

  const categories = useMemo(() => {
    const seen = new Map();
    for (const p of packs) {
      const key = p.t.category || 'general';
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [packs]);

  const shown = cat === 'all' ? packs : packs.filter(p => (p.t.category || 'general') === cat);
  const ready = shown.filter(p => !p.blockers?.length);
  const held = shown.filter(p => p.blockers?.length);

  // "Ready" is only knowable once the capability list has loaded. Before that it
  // is `—`, not the pack count — the whole point of the stat is that it was
  // checked.
  const checked = !!caps.data;

  const stats = [
    { k: 'Packs', hi: 'साँचे', v: packs.length, d: 'not yet assigned here', m: 'hub' },
    { k: 'Categories', hi: 'श्रेणी', v: categories.length, d: 'filter the shelf below', m: 'sahayak' },
    {
      k: 'Ready to run', hi: 'तैयार', m: 'approvals',
      v: checked ? packs.filter(p => !p.blockers?.length).length : '—',
      d: checked ? 'every step has something behind it' : 'availability was not checked',
    },
    {
      k: 'Price list', hi: 'मूल्य', m: 'ganit',
      v: costs ? 'Live' : 'Unavailable',
      d: costs ? 'costs are the server’s own' : 'run costs are not shown',
    },
  ];

  return (
    <Resource
      state={state}
      what="The skill pack catalog"
      empty={<Empty
        icon="generic"
        title="No templates yet"
        sub="A template is a reusable workflow — build one and assign it to as many clients as you like."
        cta={canManage ? 'Create a template' : undefined}
        onCta={canManage ? onCreate : undefined}
      />}
    >
      {available.length === 0 ? (
        <p className="hb-none">
          Every template in the catalog is already assigned to this client.
        </p>
      ) : (
        /* `k-surface-theme` opts this surface into the Slate / indigo palette in
           styles/surface-theme.css. It is a class you opt into precisely so it
           can be applied per surface; the tokens underneath are the product's
           canonical names, so every rule in marketplace.css is correct on the
           cream palette too if the class is ever moved up to the page shell. */
        <div className="mkt k-surface-theme">
          <section className="mkt-hero">
            <p className="mkt-hero__k">
              Skill pack catalogue <span className="mkt-hero__hi" lang="hi">· कौशल</span>
            </p>
            <h3 className="mkt-hero__t">Work this client can have running today</h3>
            <p className="mkt-hero__s">
              A pack runs its steps in order against this client’s brand profile and your own
              records. An <b>AI step</b> writes something and spends credits; a <b>data step</b>{' '}
              reads your invoices, KPIs, stock or attendance and costs nothing. Every price below
              is the one the wallet will be charged, not a list price.
            </p>

            <div className="mkt-hero__stats">
              {stats.map(s => (
                <div className="mkt-stat" key={s.k} style={{ '--mc': orgModuleColor(s.m) }}>
                  <span className="mkt-stat__k">
                    {s.k} <span className="mkt-stat__hi" lang="hi">{s.hi}</span>
                  </span>
                  <b className="mkt-stat__v">{s.v}</b>
                  <span className="mkt-stat__d">{s.d}</span>
                </div>
              ))}
            </div>

            {canManage && (
              <div className="mkt-hero__act">
                <button type="button" className="k-btn k-btn--primary hb-btn--sm" onClick={onCreate}>
                  Create a template
                </button>
              </div>
            )}
          </section>

          {/* Said once, at the top, rather than repeated on every card. The
              per-card control is disabled and carries the same sentence in its
              title, so the answer is also where the hand is. */}
          {assignBlocked && (
            <div className="note note--info hb-note" role="status">
              <b>This catalog is read-only for you.</b> {assignBlocked} You can still see exactly
              what each pack does and what a run would cost.
            </div>
          )}

          {caps.error && (
            <div className="note note--warn hb-note" role="status">
              <b>Availability could not be checked.</b> {caps.error} The packs below are shown as
              they are; a pack whose steps this server cannot run would fail on its first run
              rather than here.
            </div>
          )}

          <div className="mkt-cats" role="group" aria-label="Filter by category">
            <button type="button" className={`mkt-cat${cat === 'all' ? ' on' : ''}`}
              aria-pressed={cat === 'all'} onClick={() => setCat('all')}
              style={{ '--mc': 'var(--primary)' }}>
              <i className="mkt-cat__dot" aria-hidden="true" />
              All <span className="mkt-cat__n">{packs.length}</span>
            </button>
            {categories.map(([key, n]) => (
              <button type="button" key={key} className={`mkt-cat${cat === key ? ' on' : ''}`}
                aria-pressed={cat === key} onClick={() => setCat(key)}
                style={{ '--mc': orgModuleColor(CATEGORY_MODULE[key]) }}>
                <i className="mkt-cat__dot" aria-hidden="true" />
                {categoryLabel(key)} <span className="mkt-cat__n">{n}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="hb-none">
              No pack in this catalog is filed under {categoryLabel(cat)}.
            </p>
          ) : (
            <>
              {ready.length > 0 && (
                <Shelf
                  title="Ready to assign"
                  note={checked ? 'every step has an implementation behind it'
                    : caps.loading ? 'checking what each step needs…'
                    : 'availability not checked — the capability list did not load'}
                  packs={ready}
                  busyId={busyId} confirmDel={confirmDel}
                  canAssign={canAssign} canManage={canManage} assignBlocked={assignBlocked}
                  onAssign={assign} onDeactivate={deactivate} onConfirmDel={setConfirmDel}
                />
              )}
              {held.length > 0 && (
                <Shelf
                  title="Cannot run yet"
                  note="a step names something this server cannot execute"
                  packs={held}
                  busyId={busyId} confirmDel={confirmDel}
                  canAssign={canAssign} canManage={canManage} assignBlocked={assignBlocked}
                  onAssign={assign} onDeactivate={deactivate} onConfirmDel={setConfirmDel}
                />
              )}
            </>
          )}
        </div>
      )}
    </Resource>
  );
}

/** One titled shelf of cards. Two of them, at most: runnable and held. */
function Shelf({
  title, note, packs, busyId, confirmDel, canAssign, canManage, assignBlocked,
  onAssign, onDeactivate, onConfirmDel,
}) {
  return (
    <section className="mkt-shelf">
      <h3 className="mkt-sec">
        {title} <small className="mkt-sec__n">{note}</small>
      </h3>
      <div className="mkt-grid">
        {packs.map(p => (
          <PackCard
            key={p.t.id} pack={p}
            busy={busyId === p.t.id} confirming={confirmDel === p.t.id}
            canAssign={canAssign} canManage={canManage} assignBlocked={assignBlocked}
            onAssign={onAssign} onDeactivate={onDeactivate} onConfirmDel={onConfirmDel}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One product card.
 *
 * The action is DISABLED and never hidden, and the reason is on the control
 * rather than only in a paragraph somewhere above it — a pack held back by an
 * unrunnable step says which step and why, in the sentence the server itself
 * would have answered with after the assignment had already been made.
 */
function PackCard({
  pack, busy, confirming, canAssign, canManage, assignBlocked,
  onAssign, onDeactivate, onConfirmDel,
}) {
  const { t, steps, ai, data, tone, live, listed, blockers, needs, module: mod } = pack;
  const held = !!blockers?.length;
  const why = held ? blockers.join(' ') : assignBlocked;

  return (
    <article className={`mkt-card${held ? ' mkt-card--held' : ''}`} style={{ '--mc': tone }}>
      <div className="mkt-card__top">
        <div className="mkt-card__row">
          <span className="mkt-card__i"><SkillGlyph name={t.icon} /></span>
          <span className="mkt-card__id">
            <b className="mkt-card__n">{t.name}</b>
            <span className="mkt-card__c">
              {categoryLabel(t.category)}
              {mod && <> · {mod.label}</>}
            </span>
          </span>
        </div>
        <p className="mkt-card__d">{t.description || 'No description.'}</p>

        {steps.length === 0 ? (
          <p className="mkt-card__d mkt-card__d--warn">
            This pack has no steps, so a run would produce nothing.
          </p>
        ) : (
          <ol className="mkt-flow">
            {steps.map((s, i) => (
              <li className={`mkt-flow__s${stepKind(s) === 'data' ? ' mkt-flow__s--data' : ''}`} key={i}>
                <span className="mkt-flow__n">{i + 1}</span>
                {/* A data step has no agent_type. Rendering `words(s.agent_type)`
                    for both is what drew an empty chip for every one of them. */}
                {stepKind(s) === 'data' ? words(s.skill_function) || 'nothing chosen' : words(s.agent_type)}
                {s.platform && <span className="mkt-flow__p"> · {s.platform}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {(needs.asks.length > 0 || needs.reads.length > 0 || needs.writes) && (
        <div className="mkt-needs">
          {needs.asks.length > 0 && (
            <p className="mkt-needs__r">
              <span className="mkt-needs__t">Asks you for</span>
              {needs.asks.map(n => <span className="mkt-need" key={n}>{words(n)}</span>)}
            </p>
          )}
          {needs.reads.length > 0 && (
            <p className="mkt-needs__r">
              <span className="mkt-needs__t">Reads</span>
              {needs.reads.map(n => <span className="mkt-need" key={n}>{n}</span>)}
            </p>
          )}
          {needs.writes && (
            <p className="mkt-needs__r">
              <span className="mkt-needs__t">Careful</span>
              <span className="mkt-need mkt-need--write">changes your data</span>
            </p>
          )}
        </div>
      )}

      {held && (
        /* No `role="status"`: this is static content that is present on first
           paint, and a live region per card announces every one of them at
           once. The words carry it, and the disabled button repeats the reason
           in its title. */
        <div className="mkt-held">
          <b className="mkt-held__t">This pack cannot run.</b>
          <span className="mkt-held__w">{blockers.join(' ')}</span>
        </div>
      )}

      <div className="mkt-card__b">
        <span className="mkt-meta">
          <b>{steps.length}</b> {steps.length === 1 ? 'step' : 'steps'}
          {data > 0 && <> · {data} free</>}
        </span>
        {/* The live sum leads because it is what the wallet is charged. The
            stored column is a fallback and says so; with neither, the card says
            the cost is unknown rather than guessing one. */}
        {live != null ? (
          <span className="mkt-cost">{creditLabel(live)} per run</span>
        ) : listed != null ? (
          <span className="mkt-cost mkt-cost--stale" title="The live price list did not load. This is the figure stored on the template.">
            listed at {creditLabel(listed)}
          </span>
        ) : (
          <span className="mkt-cost mkt-cost--none">cost unavailable</span>
        )}
      </div>

      <div className="mkt-act">
        <button type="button" className="k-btn k-btn--primary hb-btn--sm mkt-act__go"
          disabled={busy || !canAssign || held}
          title={why || undefined}
          onClick={() => onAssign(t.id)}>
          {busy ? 'Assigning…' : 'Assign to this client'}
        </button>
        {canManage && (confirming ? (
          <span className="mkt-confirm">
            {/* The blast radius, in the confirmation, because the button label
                cannot carry it. */}
            <span className="mkt-confirm__w">
              Deactivates &ldquo;{t.name}&rdquo; for every client in the org.
            </span>
            <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => onConfirmDel(null)}>Keep</button>
            <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
              disabled={!canAssign} title={assignBlocked || undefined}
              onClick={() => onDeactivate(t.id)}>Deactivate</button>
          </span>
        ) : (
          /* Gated on the same pair as Assign, because `delete_skill_template`
             carries the same two guards. Disabling the opener rather than only
             the confirmed action means the reason arrives before the
             confirmation rather than inside it. */
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
            disabled={!canAssign} title={assignBlocked || undefined}
            onClick={() => onConfirmDel(t.id)}>Deactivate</button>
        ))}
      </div>
      <p className="mkt-act__ai">
        {ai === 0
          ? 'No AI step — this pack reads and reports, and spends nothing.'
          : `${ai} AI ${ai === 1 ? 'step' : 'steps'} spend credits.`}
      </p>
    </article>
  );
}
