// Sahayak → Skills. The org's own shelf of skills, and the catalogue to ask from.
//
// ── What was wrong with this screen ──────────────────────────────────────────
//
// Seventy-eight skills exist and fifty-nine of them are `skill_function`-only:
// they read the org's own records, call no model, cost nothing. From a
// customer's seat every one of them DID NOTHING. A run finished and the page
// said, in full:
//
//     Finished — 1 steps, 0 credits. 0 items are waiting in the Content tab.
//
// Every clause of that was true. The skill had found four invoices that would
// fail a GSTR-1 filing, said which edit each one needed, and stated in its own
// words what it could not see — and the page reported a count of content items,
// which for a check skill is zero by construction and always will be. The
// finding itself went into an in-memory list used to ground a LATER AI prompt
// and was then discarded. Six changes, in the order they matter:
//
//  1. THE FINDING IS RENDERED. `components/skills/findings` turns a handler's
//     dict into counts, tables and — first, whole, never behind a disclosure —
//     the caveat. See that file's header for why the caveat leads.
//
//  2. THE RESULT LINE STOPPED LYING. "0 items are waiting in the Content tab"
//     is only said when a run could have produced content items and did not.
//     A check skill says what it is instead.
//
//  3. THE SHELF IS A SHELF. Sixty-one newly assigned cards arrived as one flat
//     grid with no search and no filter. Grouped by module, ordered within a
//     module by `skill_type` — check → brief → pack → content, which is
//     `SKILL_TYPES` and is deliberately not alphabetical: it runs from the most
//     actionable to the least, which also puts every free skill above every
//     priced one. One ordering, shared with the agency catalogue.
//
//  4. A FREE SKILL SAYS IT IS FREE. The cost line read
//     `skill.estimated_credits || estimateCredits(steps, costs)`, and for a
//     free skill the stored 0 is falsy — so it fell through to a helper that
//     answers `null` while the price table is in flight and the caption read
//     "Cost table unavailable" on a skill that costs nothing. Fixed at the
//     root: `estimateCredits` now answers 0 for a pack with no AI step, because
//     that is knowable without any price table. The rule itself is `packPrice`,
//     shared with the agency catalogue so the two can never quote differently.
//
//  5. NOBODY TYPES A UUID. `Account brief` rendered a free-text box labelled
//     "contact id". See `RunField` below.
//
//  6. "REQUEST THIS SKILL" IS WIRED. The catalogue used to end in a paragraph
//     saying "Ask your account contact" while `POST /v1/hub/skills/{id}/request`
//     had been working the whole time. The card opens `SkillDrawer`, which
//     already says what a run reads and changes and already files the request.
//
// ── Built against a backend change ───────────────────────────────────────────
//
// The run response gains `outputs`, each data step carrying its handler's
// actual return under `data`; `GET /v1/hub/org/skills` gains `module` and
// `skill_type`. Every one of those is read defensively — an absent `outputs`
// renders as "the server did not report per-step detail", which is a different
// sentence from "the skill found nothing", and an absent `module` falls back
// through `CATEGORY_MODULE` exactly as the agency catalogue does.
import React, { useState, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Resource, StatusPill, useList, useResource, errText } from '../hub/_shared';
import {
  SkillGlyph, CATEGORY_TONE, CATEGORY_LABELS, CATEGORY_MODULE, parseSteps,
  extractVariables, runtimeParamsOf, imagedSteps, packPrice, blockersFor,
  SKILL_TYPES, skillTypeOf, SkillFit,
} from '../hub/skills/_shared';
import { ORG_MODULES, moduleEntry, orgModuleColor } from '../org/catalogue';
import SkillDrawer, { permissionsFor } from '../../components/skills/SkillDrawer';
import { Findings } from '../../components/skills/findings';
import { AGENT_LABELS, LANGUAGES, words, creditLabel } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

/** Where a module sits on the shelf. An unknown code goes last, never dropped. */
const MODULE_ORDER = Object.fromEntries(ORG_MODULES.map((m, i) => [m.code, i]));
const moduleRank = code => (code in MODULE_ORDER ? MODULE_ORDER[code] : ORG_MODULES.length);

/** Where a type sits within a module. `SKILL_TYPES` order, and only that. */
const TYPE_ORDER = Object.fromEntries(SKILL_TYPES.map((t, i) => [t.key, i]));
const TYPE_LABEL = Object.fromEntries(SKILL_TYPES.map(t => [t.key, t.label]));

/** `2026-08` — the month a firm is actually working on, which is the last one. */
function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The last 18 completed months, newest first, as `[value, label]`.
 *
 * A `<select>` rather than a text box or `<input type="month">`. The handlers
 * take `'YYYY-MM'` and reject anything else — `gst_readiness` answers "'August'
 * is not a period" — but only AFTER the run, so a free-text box turns a typo
 * into a round trip. A native month input is out for the same reason
 * `DateInput` exists: no native date control anywhere in this product.
 *
 * `setDate(1)` FIRST, and it is load-bearing: stepping months on the 31st
 * overflows (31 June becomes 1 July) and the list would skip a month.
 */
function monthOptions() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 18; i += 1) {
    d.setMonth(d.getMonth() - 1);
    out.push([
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    ]);
  }
  return out;
}

/**
 * One field of the run form.
 *
 * ── THE `contact_id` BOX ─────────────────────────────────────────────────────
 *
 * `Account brief` declares `contact_id` as a runtime parameter, and the form
 * rendered it the way it rendered every other unknown name: a required text
 * input labelled "contact id". A human was being asked to type a UUID. That
 * breaks the owner's rule outright — a person is identified by their name — and
 * it is unusable besides: there is nowhere in this product to read a contact's
 * id from, so the only way to fill that box was a database query.
 *
 * It is a picker now, over `/v1/graha/contacts`, showing names. The id is the
 * option's VALUE and never its text, which is the same shape every other
 * contact picker in the build uses and the shape `check-rendered-ids.mjs` is
 * written around: an attribute is not a rendered position.
 *
 * When the contact list cannot be fetched — the org may not carry Graha at all
 * — the field says so and Run greys out with that sentence on it. It does not
 * fall back to a text box, because a text box for a UUID is the defect.
 *
 * The other five declared runtime parameters get real controls too, for the
 * same reason: `period` and `month` are `YYYY-MM` and a free-text box invites
 * `August`, which the handler rejects with "'August' is not a period" AFTER the
 * run. `horizon_days` and `threshold_amount` are numbers.
 */
function RunField({ name, value, onChange, contacts, months }) {
  const id = `run-${name}`;

  if (name === 'contact_id') {
    if (contacts.loading) {
      return (
        <label className="hb-field" htmlFor={id}>
          <span className="hb-field__l">Contact</span>
          <select className="k-input" id={id} disabled><option>Loading contacts…</option></select>
        </label>
      );
    }
    if (contacts.error || !contacts.items) {
      return (
        <div className="hb-field">
          <span className="hb-field__l">Contact</span>
          <p className="hb-cap sk-run__blk">
            The contact list did not load, so there is nobody to choose. {contacts.error}
          </p>
        </div>
      );
    }
    return (
      <label className="hb-field" htmlFor={id}>
        <span className="hb-field__l">
          Contact
          <span className="hb-field__hint">Whose account this brief is about.</span>
        </span>
        <select className="k-input" id={id} required value={value || ''}
          onChange={e => onChange(e.target.value)}>
          <option value="">Choose a contact…</option>
          {contacts.items.map(c => (
            <option key={c.id} value={c.id}>
              {c.name || c.company || c.email || 'Unnamed contact'}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (name === 'period' || name === 'month') {
    return (
      <label className="hb-field" htmlFor={id}>
        <span className="hb-field__l">
          {words(name)}
          <span className="hb-field__hint">The return period, as the handler expects it.</span>
        </span>
        <select className="k-input" id={id} required value={value || ''}
          onChange={e => onChange(e.target.value)}>
          {months.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    );
  }

  if (name === 'horizon_days' || name === 'threshold_amount') {
    return (
      <label className="hb-field" htmlFor={id}>
        <span className="hb-field__l">
          {words(name)}
          <span className="hb-field__hint">
            {name === 'horizon_days' ? 'How many days ahead to look.' : 'In rupees.'}
          </span>
        </span>
        <input className="k-input" id={id} type="number" min="0" required value={value ?? ''}
          onChange={e => onChange(e.target.value)} />
      </label>
    );
  }

  // A `{topic}` placeholder out of a prompt, or a runtime parameter nothing
  // here knows about yet. Text, and the name as written.
  return (
    <label className="hb-field" htmlFor={id}>
      <span className="hb-field__l">{words(name)}</span>
      <input className="k-input" id={id} required value={value || ''}
        placeholder={`Enter ${words(name)}…`}
        onChange={e => onChange(e.target.value)} />
    </label>
  );
}

/**
 * What the run just did.
 *
 * The old block printed one sentence — steps, credits, and a count of content
 * items — and for fifty-nine of the seventy-eight skills the count was
 * structurally zero. It now reports the three things separately, because they
 * are three different facts and only one of them was ever being answered:
 *
 *   · the run: how many steps completed, and what it cost
 *   · the CONTENT, only when a step could have produced any
 *   · THE FINDINGS, which is the whole reason a check skill exists
 */
function RunResult({ result, steps }) {
  const aiSteps = steps.filter(s => !s.skill_function).length;
  const dataSteps = steps.length - aiSteps;
  const items = result.content_ids?.length || 0;
  // `outputs` absent entirely means a server that does not report per-step
  // detail. It is NOT an empty run, and the two must not read the same.
  const reported = Array.isArray(result.outputs);

  return (
    <div className="sr-done">
      <div className="note note--info" role="status">
        <b>
          Finished — {result.steps_completed} of {steps.length}{' '}
          {steps.length === 1 ? 'step' : 'steps'}, {creditLabel(result.credits_used ?? 0)}.
        </b>{' '}
        {aiSteps === 0 ? (
          // The honest sentence for a check skill. It replaces "0 items are
          // waiting in the Content tab", which was true, unhelpful, and read
          // as a failure.
          <>This skill reads your records and reports back. It writes nothing and creates
            no content items — the findings are below.</>
        ) : items > 0 ? (
          <>{items === 1 ? '1 item is' : `${items} items are`} waiting in the Content tab.</>
        ) : (
          <>No content item was created, although {aiSteps === 1 ? 'a step' : 'some steps'} could
            have produced one. Check the Content tab if you expected a draft.</>
        )}
      </div>

      {dataSteps > 0 && !reported && (
        <p className="hb-cap sk-run__blk">
          This server did not report what each step read, so the findings cannot be shown
          here. That is not a statement about your records — nothing below is a claim that
          the skill found nothing.
        </p>
      )}

      {reported && <Findings outputs={result.outputs} steps={steps} />}
    </div>
  );
}

/** What a run reads and what it changes, before it runs. Ported from SkillDrawer. */
function WhatItTouches({ steps, caps }) {
  const perms = permissionsFor(steps, caps);
  const reads = perms ? [...new Set(perms.flatMap(p => p.reads))] : null;
  const writes = perms ? [...new Set(perms.flatMap(p => p.writes))] : null;

  return (
    <div className="sk-run__perm">
      <div>
        <span className="hb-field__l">What it reads</span>
        {reads === null ? (
          // NULL IS NOT []. An empty list reads as "it touches nothing", which
          // is a claim; null is the truth, which is that nothing was checked.
          <p className="hb-cap">
            Not checked — the capability list did not load. This is not a claim that it
            reads nothing.
          </p>
        ) : reads.length === 0 ? (
          <p className="hb-cap">Nothing. No step is given any of your records.</p>
        ) : (
          <p className="hb-cap sk-run__perm-l">{reads.join(' · ')}</p>
        )}
      </div>
      <div>
        <span className="hb-field__l">What it changes</span>
        {writes === null ? (
          <p className="hb-cap">Not checked — availability and write access come from the same list.</p>
        ) : writes.length === 0 ? (
          <p className="hb-cap">Nothing. This skill only reads and reports.</p>
        ) : (
          <p className="hb-cap sk-run__perm-l sk-run__perm-l--w">{writes.join(' · ')}</p>
        )}
      </div>
    </div>
  );
}

export default function SkillsTab({ canAssign, costs, onSpent }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'run skills' });
  const { pushToast } = useToast();
  const mine = useList('/v1/hub/org/skills', []);
  const catalog = useList('/v1/hub/skills/templates', []);
  // What this server can actually run. Without it a pack naming an
  // unimplemented skill_function was offered with "Add to organisation" fully
  // enabled and no reason shown. `caps.data` null means "not loaded yet",
  // which blockersFor treats as unknown rather than as no problems.
  const caps = useResource('/v1/hub/skills/capabilities', []);

  const [pane, setPane] = useState('mine');
  const [q, setQ] = useState('');
  const [mod, setMod] = useState('all');
  const [kind, setKind] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [vars, setVars] = useState({ brand_name: '', language: 'en' });
  const [withImages, setWithImages] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [result, setResult] = useState(null);

  const months = useMemo(monthOptions, []);

  const assignedIds = new Set((mine.items || []).map(s => s.template_id));
  const available = (catalog.items || []).filter(t => !assignedIds.has(t.id));

  /* Everything a card needs, computed once per list rather than per render.
     `module` and `skill_type` are read straight off the row where the server
     supplies them and derived where it does not — the column is nullable and
     `skillTypeOf` already answers `content` for a row written before migration
     166, which is the same answer the database would give. */
  const rows = useMemo(() => (mine.items || []).map(s => {
    const steps = parseSteps(s.steps).sort((a, b) => (a.order || 0) - (b.order || 0));
    const code = s.module || CATEGORY_MODULE[s.category] || 'hub';
    return {
      s,
      steps,
      code,
      module: moduleEntry(code),
      tone: orgModuleColor(code),
      type: skillTypeOf(s),
      runtime: runtimeParamsOf(steps),
      needed: extractVariables(steps),
      blockers: blockersFor(steps, caps.data),
      ...packPrice(s, steps, costs),
    };
  }), [mine.items, caps.data, costs]);

  /* The filter row is built from what is ACTUALLY on the shelf, never from the
     twelve-module catalogue. A row of chips that mostly match nothing teaches
     the reader to ignore the row. */
  const modules = useMemo(() => {
    const seen = new Map();
    for (const r of rows) seen.set(r.code, (seen.get(r.code) || 0) + 1);
    return [...seen.entries()].sort((a, b) => moduleRank(a[0]) - moduleRank(b[0]));
  }, [rows]);

  const kinds = useMemo(() => {
    const seen = new Map();
    for (const r of rows) seen.set(r.type, (seen.get(r.type) || 0) + 1);
    return SKILL_TYPES.filter(t => seen.has(t.key)).map(t => [t.key, t.label, seen.get(t.key)]);
  }, [rows]);

  /* Search over everything a person could remember about a skill, including the
     names of the records it reads — "overdue" should find the skill whose step
     is `find_overdue_invoices` even though the word is in no title. */
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r => {
    if (mod !== 'all' && r.code !== mod) return false;
    if (kind !== 'all' && r.type !== kind) return false;
    if (!needle) return true;
    const hay = [
      r.s.template_name, r.s.name, r.s.template_description, r.s.description,
      // The seat and the cadence (261). Searching "payroll" should find
      // everything payroll runs, and "before filing" everything due then —
      // neither of which appears in a name or a description for most of the
      // shelf, so without these two the search cannot answer the question the
      // columns were added to answer.
      r.s.used_by, r.s.when_to_run,
      CATEGORY_LABELS[r.s.category] || r.s.category, r.module.label, r.module.en,
      TYPE_LABEL[r.type],
      ...r.steps.map(x => words(x.skill_function || x.agent_type || '')),
    ].join(' ').toLowerCase();
    return hay.includes(needle);
  });

  /* Module sections, and inside each the `SKILL_TYPES` order: check → brief →
     pack → content. That order is not alphabetical and is not arbitrary — it
     runs from the most actionable to the least, which also puts every free
     skill above every priced one. It is the agency catalogue's own ordering,
     imported rather than re-derived. */
  const groups = useMemo(() => {
    const by = new Map();
    for (const r of shown) {
      if (!by.has(r.code)) by.set(r.code, []);
      by.get(r.code).push(r);
    }
    return [...by.entries()]
      .sort((a, b) => moduleRank(a[0]) - moduleRank(b[0]))
      .map(([code, list]) => ({
        code,
        module: list[0].module,
        tone: list[0].tone,
        list: list.sort((a, b) => (
          (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
          || String(a.s.template_name || a.s.name).localeCompare(String(b.s.template_name || b.s.name))
        )),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, needle, mod, kind]);

  const openRow = openId ? rows.find(r => r.s.id === openId) : null;
  /* Fetched only when a skill that wants one is open. The org may not carry
     Graha at all, and firing this on mount would 403 on every visit to a tab
     that mostly has nothing to do with contacts. */
  const wantsContact = !!openRow?.runtime.includes('contact_id');
  const contacts = useList(wantsContact ? '/v1/graha/contacts' : null, [wantsContact]);

  /* The catalogue drawer needs the pack shape SkillDrawer was built for, plus
     the org's own open requests so a skill already asked for says so. */
  const catRows = useMemo(() => available.map(t => {
    const steps = parseSteps(t.steps);
    const ai = steps.filter(s => !s.skill_function).length;
    const code = t.module || CATEGORY_MODULE[t.category] || 'hub';
    return {
      t, steps, ai, data: steps.length - ai,
      tone: orgModuleColor(code),
      module: t.module ? moduleEntry(t.module) : null,
      type: skillTypeOf(t),
      blockers: blockersFor(steps, caps.data),
      ...packPrice(t, steps, costs),
    };
  }), [catalog.items, mine.items, caps.data, costs]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRequests = useMemo(() => Object.fromEntries(
    (mine.data?.skill_requests || []).map(r => [String(r.template_id), r]),
  ), [mine.data]);

  /* The drawer plays an exit, so it must stay MOUNTED after `drawerId` clears
     — `useExitAnimation` inside it holds the node there until `animationend`.
     Keeping the last row means the panel still has something to draw while it
     leaves rather than blanking a frame before it goes. A ref rather than
     state because it must not cause a render of its own; it is only ever read
     on a render the `drawerId` change already caused. Same shape as the agency
     catalogue, and for the same reason: six overlays in this product shipped
     with an entrance and no exit. */
  const opened = drawerId ? catRows.find(r => r.t.id === drawerId) : null;
  const lastOpened = useRef(null);
  if (opened) lastOpened.current = opened;
  const drawerRow = opened || lastOpened.current;

  async function assign(id) {
    setBusyId(id);
    try {
      await api.post(`/v1/hub/org/skills/${id}`, { custom_config: {} });
      pushToast({ title: 'Added to your organisation', type: 'success' });
      mine.reload();
      setPane('mine');
      setDrawerId(null);
    } catch (err) {
      pushToast({ title: errText(err, 'Could not add the skill.'), type: 'error' });
    } finally { setBusyId(null); }
  }

  /* Opening a DIFFERENT skill resets the form. `vars` was one object at this
     level, so a topic typed into one skill was still sitting in the next one's
     box — and worse, a `period` chosen for a GST check was silently submitted
     to a payroll skill that happened to declare the same parameter name. */
  function toggle(row) {
    const next = openId === row.s.id ? null : row.s.id;
    setOpenId(next);
    setResult(null);
    setWithImages(false);
    if (next) {
      const seed = { brand_name: '', language: 'en' };
      for (const n of row.needed) {
        if (n === 'period' || n === 'month') seed[n] = previousMonth();
      }
      setVars(seed);
    }
  }

  async function run(e, row) {
    e.preventDefault();
    setBusyId(row.s.id);
    setResult(null);
    try {
      const r = await api.post(`/v1/hub/org/skills/${row.s.id}/run`, {
        variables: vars, generate_images: withImages,
      });
      setResult({ id: row.s.id, ...r.data });
      onSpent?.();
      pushToast({ title: `${row.s.template_name || row.s.name} finished`, type: 'success' });
    } catch (err) {
      pushToast({ title: errText(err, 'The skill run failed.'), type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="hb-filters" role="group" aria-label="Skill view">
        {[['mine', 'Active'], ['catalog', 'Catalog']].map(([k, l]) => (
          <button type="button" key={k} className={`hb-chip${pane === k ? ' on' : ''}`}
            aria-pressed={pane === k} onClick={() => setPane(k)}>
            {l}
            <span className="hb-chip__n">{k === 'mine' ? (mine.items?.length ?? '–') : (catalog.items ? available.length : '–')}</span>
          </button>
        ))}
      </div>

      {pane === 'mine' && (
        <Resource
          state={mine}
          what="Your organisation’s skills"
          empty={<Empty
            icon="generic"
            title="No skills added yet"
            sub="A skill either checks your own records and reports what it found, or writes something and drops it into your content library."
            cta="Browse the catalog"
            onCta={() => setPane('catalog')}
          />}
        >
          {/* ── The shelf controls ───────────────────────────────────────────
              Sixty-one cards in one flat grid is a list, not a shelf. Search
              first because it is the only control that works when you already
              know what you are looking for; the two chip rows are for browsing.
              Both chip rows are built from what is on the shelf. */}
          <div className="sk-shelf__bar">
            <label className="hb-field sk-shelf__q">
              <span className="k-sr-only">Search your skills</span>
              <input className="k-input" type="search" value={q} placeholder="Search skills…"
                onChange={e => setQ(e.target.value)} />
            </label>
            <span className="hb-cap sk-shelf__n">
              {shown.length} of {rows.length}
            </span>
          </div>

          {modules.length > 1 && (
            <div className="hb-filters" role="group" aria-label="Filter by module">
              <button type="button" className={`hb-chip${mod === 'all' ? ' on' : ''}`}
                aria-pressed={mod === 'all'} onClick={() => setMod('all')}>
                All modules<span className="hb-chip__n">{rows.length}</span>
              </button>
              {modules.map(([code, n]) => (
                <button type="button" key={code} className={`hb-chip${mod === code ? ' on' : ''}`}
                  aria-pressed={mod === code} onClick={() => setMod(code)}>
                  {moduleEntry(code).label}<span className="hb-chip__n">{n}</span>
                </button>
              ))}
            </div>
          )}

          {kinds.length > 1 && (
            <div className="hb-filters" role="group" aria-label="Filter by kind">
              <button type="button" className={`hb-chip${kind === 'all' ? ' on' : ''}`}
                aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
                Every kind<span className="hb-chip__n">{rows.length}</span>
              </button>
              {kinds.map(([key, l, n]) => (
                <button type="button" key={key} className={`hb-chip${kind === key ? ' on' : ''}`}
                  aria-pressed={kind === key} onClick={() => setKind(key)}>
                  {l}<span className="hb-chip__n">{n}</span>
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="hb-none">
              No skill on your shelf matches {needle ? `“${q.trim()}”` : 'these filters'}.
            </p>
          ) : groups.map(group => (
            <section className="sk-shelf" key={group.code}>
              <h3 className="sk-shelf__t" style={{ '--mc': group.tone }}>
                {group.module.label}
                <Secondary className="sk-shelf__hi" value={group.module.hi}>{(s) => ` ${s}`}</Secondary>
                <span className="sk-shelf__c">{group.list.length}</span>
                {group.module.en && <small className="sk-shelf__d">{group.module.en}</small>}
              </h3>

              <div className="hb-list">
                {group.list.map(row => {
                  const { s: skill, steps, blockers, live, listed, stale } = row;
                  const open = openId === skill.id;
                  const held = !!blockers?.length;
                  const imaged = imagedSteps(steps, withImages);
                  const imagePrice = costs?.image;
                  const contactMissing = wantsContact && open && !vars.contact_id;
                  const contactDead = wantsContact && open && (contacts.error || (!contacts.loading && !contacts.items));
                  // GREYED WITH A REASON, NEVER A 403 ON CLICK. Every one of
                  // these is a sentence a person can act on.
                  const stop = held ? blockers.join(' ')
                    : denial
                    || (contactDead ? 'This skill needs a contact and the contact list did not load.' : '')
                    || (contactMissing ? 'Choose a contact first.' : '');

                  return (
                    <article className="hb-card sk-card" key={skill.id}>
                      <div className="sk-card__head">
                        <span className="sk-card__id">
                          <SkillGlyph name={skill.icon} />
                          <span>
                            <b className="sk-card__t">{skill.template_name || skill.name}</b>
                            <span className="hb-cap sk-card__d">
                              {skill.template_description || skill.description
                                || `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
                            </span>
                          </span>
                        </span>
                        <span className="sk-card__meta">
                          {/* WHAT KIND OF THING IT IS, first — it is what
                              decides how much of your attention the output
                              wants. The category pill is kept beside it because
                              the two answer different questions. */}
                          <span className="sk-kind" data-kind={row.type}>{TYPE_LABEL[row.type]}</span>
                          {skill.category && (
                            <StatusPill status={CATEGORY_LABELS[skill.category] || skill.category}
                              tone={CATEGORY_TONE[skill.category]} />
                          )}
                          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                            aria-expanded={open}
                            onClick={() => toggle(row)}>
                            {open ? 'Close' : 'Run'}
                          </button>
                        </span>
                      </div>

                      {/* Who it is for and when to run it (261) — outside the
                          head, because the description above it lives in a
                          <span> and this renders a <p>. */}
                      <SkillFit template={skill} />

                      {/* A data step has no `agent_type`, so it used to render as a
                          bare number with no label at all — observed on the first
                          real run: "Receivables chase pack" showed "1" then
                          "2 Email". It says what it reads, and that it is free. */}
                      <div className="sk-flow">
                        {steps.map((s, i) => (
                          <span className="sk-flow__s" key={i}>
                            <span className="sk-flow__n">{s.order || i + 1}</span>
                            {s.skill_function
                              ? <>{s.label || words(s.skill_function)}<span className="hb-cap"> · reads your data</span></>
                              : <>
                                  {AGENT_LABELS[s.agent_type] || words(s.agent_type)}
                                  {s.platform && <span className="hb-cap"> · {s.platform}</span>}
                                </>}
                          </span>
                        ))}
                      </div>

                      {held && (
                        <ul className="hb-cap sk-card__blk">
                          {blockers.map(b => <li key={b}>{b}</li>)}
                        </ul>
                      )}

                      {open && (
                        <form className="sk-run" onSubmit={e => run(e, row)}>
                          <WhatItTouches steps={steps} caps={caps.data} />

                          {/* Nothing to ask for at all is the normal case for a
                              check skill: no prompt placeholder, no declared runtime
                              parameter, no brand or language to shape. An empty grid
                              would still draw its gaps, so the whole block goes. */}
                          {(row.steps.some(s => !s.skill_function)
                            || row.needed.some(n => !['brand_name', 'language'].includes(n))) && (
                          <div className="hb-grid hb-grid--2">
                            {/* BRAND AND LANGUAGE ONLY WHERE SOMETHING READS
                                THEM. Both exist to shape what a model writes,
                                and a check skill has no model step — the
                                dispatcher strips every variable a data step did
                                not declare as a runtime parameter, so on
                                fifty-nine of the seventy-eight skills these two
                                boxes were collected, sent, and discarded. Two
                                fields that do nothing on the form you press Run
                                on teach the reader that the form does nothing. */}
                            {row.steps.some(s => !s.skill_function) && (
                              <>
                                <label className="hb-field">
                                  <span className="hb-field__l">Brand name</span>
                                  <input className="k-input" placeholder="Your brand name" value={vars.brand_name}
                                    onChange={e => setVars(v => ({ ...v, brand_name: e.target.value }))} />
                                </label>
                                <label className="hb-field">
                                  <span className="hb-field__l">Language</span>
                                  <select className="k-input" value={vars.language}
                                    onChange={e => setVars(v => ({ ...v, language: e.target.value }))}>
                                    {LANGUAGES.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                                  </select>
                                </label>
                              </>
                            )}
                            {/* The prompts' own placeholders and the data steps'
                                declared runtime parameters. `RunField` decides
                                which control each one gets; the one thing it
                                will not do is ask a person for a UUID. */}
                            {row.needed.filter(n => !['brand_name', 'language'].includes(n)).map(n => (
                              <RunField key={n} name={n} value={vars[n]} contacts={contacts} months={months}
                                onChange={val => setVars(v => ({ ...v, [n]: val }))} />
                            ))}
                          </div>
                          )}

                          {row.steps.some(s => !s.skill_function) && (
                            <label className="sk-check">
                              <input type="checkbox" checked={withImages}
                                onChange={e => setWithImages(e.target.checked)} />
                              <span>Generate an image for each AI step</span>
                            </label>
                          )}

                          <div className="hb-form__foot">
                            {/* THE PRICE, TRUTHFULLY, AND THE IMAGES SEPARATELY.
                                `live` is the sum of the steps and is what the
                                wallet is charged; images are a SECOND charge on
                                the same step and were never in it, so they are
                                stated as their own number rather than as ", more
                                with images". A step carrying `generate_image` of
                                its own is charged whether the box is ticked or
                                not, which is why `imagedSteps` is consulted
                                either way. */}
                            <span className="hb-cap">
                              {live != null
                                ? (live === 0 ? 'Free — this skill reads your records and calls no model' : `About ${creditLabel(live)}`)
                                : listed != null
                                  ? `Listed at ${creditLabel(listed)} — the live price table did not load`
                                  : 'The price table did not load, so nothing here is a price'}
                              {imaged > 0 && (
                                imagePrice != null
                                  ? ` · plus ${creditLabel(imagePrice * imaged)} for ${imaged} ${imaged === 1 ? 'image' : 'images'}`
                                  : ` · plus an image charge on ${imaged} ${imaged === 1 ? 'step' : 'steps'}, whose price did not load`
                              )}
                              {stale && ` · listed at ${creditLabel(listed)}`}
                            </span>
                            <button type="submit" className="k-btn k-btn--primary"
                              disabled={busyId === skill.id || !canWrite || held || !!contactDead}
                              title={stop || undefined}>
                              {busyId === skill.id ? 'Running…' : 'Run now'}
                            </button>
                          </div>

                          {result?.id === skill.id && <RunResult result={result} steps={steps} />}
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </Resource>
      )}

      {pane === 'catalog' && (
        <Resource
          state={catalog}
          what="The skill catalog"
          empty={<Empty icon="generic" title="The catalog is empty"
            sub="No skill pack templates exist for this organisation yet." />}
        >
          {available.length === 0 ? (
            <p className="hb-none">Every template in the catalog is already active on your organisation.</p>
          ) : (
            <div className="hb-cards">
              {catRows.map(row => {
                const { t, steps, live, listed, stale, blockers } = row;
                const held = !!blockers?.length;
                const requested = openRequests[String(t.id)];
                return (
                  <article className="hb-card sk-card" key={t.id}>
                    <div className="sk-card__head">
                      <span className="sk-card__id">
                        <SkillGlyph name={t.icon} />
                        <b className="sk-card__t">{t.name}</b>
                      </span>
                      {t.category && (
                        <StatusPill status={CATEGORY_LABELS[t.category] || t.category} tone={CATEGORY_TONE[t.category]} />
                      )}
                    </div>
                    <p className="hb-cap sk-card__d">{t.description || 'No description.'}</p>
                    <div className="hb-cap hb-mono sk-card__cost">
                      {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                      {live != null && <> · {live === 0 ? 'free' : `~${creditLabel(live)} per run`}</>}
                      {stale && <> · listed at {creditLabel(listed)}</>}
                    </div>
                    {/* A pack whose data step has no implementation behind it
                        cannot run. Showing the reason is the difference between
                        "Add" failing later and not being offered now — the same
                        treatment the agency-side catalog gives it. */}
                    {held && (
                      <ul className="hb-cap sk-card__blk">
                        {blockers.map(b => <li key={b}>{b}</li>)}
                      </ul>
                    )}
                    <div className="sk-card__act">
                      {canAssign ? (
                        <button type="button" className="k-btn k-btn--primary hb-btn--sm sk-card__go"
                          disabled={busyId === t.id || !canWrite || held} onClick={() => assign(t.id)}
                          title={held ? blockers[0] : (denial || undefined)}>
                          {busyId === t.id ? 'Adding…' : held ? 'Not available' : 'Add to organisation'}
                        </button>
                      ) : (
                        /* THE DEAD END IS GONE. This used to be a static
                           paragraph — "Ask your account contact" — and then
                           nothing, while `POST /v1/hub/skills/{id}/request` had
                           been working the whole time and no screen called it.
                           The drawer says what the skill reads, what it changes
                           and what a run costs, and files the request with a
                           note attached. A skill that cannot run is not offered
                           for request, because the answer would be no. */
                        <button type="button" className="k-btn k-btn--primary hb-btn--sm sk-card__go"
                          onClick={() => setDrawerId(t.id)}>
                          {requested ? 'Requested — see details' : held ? 'Why this cannot run' : 'See details and ask for it'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* `assign_skill_to_org` is guarded by OPERATIONS_CONSOLE_ROLES, which
              holds no org-tier role — so a customer can never turn a skill on
              for themselves and the drawer is honest about that rather than
              offering a button that 403s. */}
          {drawerRow && (
            <SkillDrawer
              key={drawerRow.t.id}
              open
              pack={drawerRow}
              caps={caps.data}
              request={openRequests[String(drawerRow.t.id)] || null}
              active={false}
              canAssign={canAssign && canWrite}
              assignBlocked={canAssign ? denial : 'Adding a skill changes what everyone in your organisation can run and what it costs, so Aekam switches it on for you.'}
              busy={busyId === drawerRow.t.id}
              onAssign={assign}
              onClose={() => setDrawerId(null)}
              onRequested={() => mine.reload()}
            />
          )}
        </Resource>
      )}
    </div>
  );
}
