/**
 * labels.js — ONE registry, ONE shape, ONE accessor.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * Measured across `frontend/src` before this file existed: 463 Devanagari
 * values under `hi`, 48 Gujarati under `gu`, 22 under `sans`, 4 under
 * `sanskrit`, 2 under `_hindi` — held in FIFTEEN distinct keyed object shapes
 * plus four mechanisms that are not objects at all (parallel Devanagari-only
 * dictionaries, `"LATIN · देवनागरी"` single strings, bare JSX literals, and a
 * prop-alias in PageHeader that accepts the same value under two names).
 * Eighteen ways to write one concept.
 *
 * The cost is not aesthetic. Gujarati exists in exactly ONE file
 * (`components/layout/navConfig.js`) because it is the only shape with a slot
 * to put it in, so EN+GU is unexpressible on 116 of the 117 files that render
 * Indic text. And `lib/notifSound.js` stores 19 GUJARATI strings under the key
 * `hi`, which anything reading `.hi` renders with `lang="hi"` — a screen reader
 * announcing Gujarati in a Hindi voice. A key name that means two things is how
 * that happens.
 *
 * ── Why {en, hi, gu, sa?} and not one of the other fourteen ──────────────────
 *
 * Argued from the census, not taste:
 *   · `{en, hi}` is the plurality BY FILE — 65 of the 95 `hi`-bearing files
 *     already call the English key `en`, against 23 for `label`. File count is
 *     the migration cost; instance count is not (101 of the 222 `{label, hi}`
 *     instances sit in just two files).
 *   · `{en, hi, gu}` is the only shape carrying Gujarati anywhere, so it is the
 *     only one that can express EN+GU.
 *   · `label` already collides: `pages/org/catalogue.js` carries BOTH `label`
 *     and `en` in the same object.
 *   · 24-bilingual-devanagari.md §"One registry" writes the resolver against
 *     `en`.
 *
 * ── `sa` is a closed set, and a missing `sa` is the normal case ─────────────
 *
 * 24 §"`sa` is a closed set, not a translation job": roughly 50-60 strings get
 * a Sanskrit form, everything else falls through `sa → hi`. So `en+sa` and
 * `en+hi` rendering the same word on most rows is the SPECIFIED behaviour, not
 * the defect it looks like. Do not machine-fill this column; §24 works the
 * example (`फ़लक` is Persian-by-way-of-Urdu and wrong in `sa`, where a
 * transliteration was dropped in without choice).
 *
 * ── A missing `gu` falls through to ENGLISH, not to `hi` ────────────────────
 *
 * This is the one resolution rule §24 does not state, and it has to go the
 * other way from `sa`. Falling `gu → hi` would hand Devanagari to a reader who
 * asked for Gujarati and label it `lang="gu"` — which is precisely the
 * notifSound bug above, reproduced by design. Showing English alone is less
 * decoration; showing the wrong script is a wrong answer. `coverage()` below
 * makes the gap countable so it can be filled rather than hidden.
 */

import { NAV_FULL, NAV_CLIENT, MOBILE_NAV, EXTRA_ROUTES } from '../components/layout/navConfig';
import { normalizeLanguage, secondaryField, hasDevanagari, hasGujarati } from './i18n';

/**
 * Terms outside the nav.
 *
 * Every Devanagari value here is LIFTED from an existing file rather than
 * coined — statuses from `lib/statusColors.js` STATUS_LABELS_HI, the seven
 * board views from `components/module/tabLabels.js` TAB_HI, which already
 * carries all seven ids. §24 is right that the views are a join, not a
 * translation job.
 *
 * Gujarati is present only where `navConfig.js` already had it. The rest is
 * deliberately absent — see the header. Filling it needs a Gujarati speaker,
 * not this file.
 */
const CORE = {
  // ── Task status (statusColors.js STATUS_LABELS / STATUS_LABELS_HI) ────────
  'status.todo':        { en: 'To do',       hi: 'कार्य' },
  'status.in_progress': { en: 'In progress', hi: 'चालू' },
  'status.in_review':   { en: 'In review',   hi: 'समीक्षा' },
  'status.done':        { en: 'Done',        hi: 'सम्पन्न' },
  'status.requested':   { en: 'Requested',   hi: 'अनुरोध' },
  'status.rejected':    { en: 'Declined',    hi: 'अस्वीकृत' },

  // ── Approval states (statusColors.js APPROVAL_LABELS) ─────────────────────
  // `sammati` is already Sanskrit, so `sa` would duplicate `hi`; §24 says the
  // duplication is correct where it happens and wrong where it is machine-made,
  // so it is simply left out and the resolver falls through.
  'approval.pending':        { en: 'Awaiting Approval',        hi: 'प्रतीक्षित' },
  'approval.pending_client': { en: 'Awaiting Client Approval', hi: 'ग्राहक प्रतीक्षित' },
  'approval.approved':       { en: 'Approved',                 hi: 'स्वीकृत' },
  'approval.rejected':       { en: 'Rejected',                 hi: 'अस्वीकृत' },

  // ── Priority (statusColors.js PRIORITY_LABELS) ────────────────────────────
  'priority.low':    { en: 'Low',    hi: 'न्यून' },
  'priority.medium': { en: 'Medium', hi: 'मध्यम' },
  'priority.high':   { en: 'High',   hi: 'उच्च' },
  'priority.urgent': { en: 'Urgent', hi: 'तत्काल' },

  // ── The seven board views ─────────────────────────────────────────────────
  // `components/views/viewDefs.jsx` VIEWS is seven `{id, label, icon}` entries
  // with no Indic key at all, which is the finding. The Devanagari has existed
  // in TAB_HI the whole time, keyed by the SAME seven ids. `boards` and `tasks`
  // carry Gujarati because navConfig already had those two words.
  'view.kanban':   { en: 'Board',    hi: 'फलक',         gu: 'ફલક' },
  'view.table':    { en: 'List',     hi: 'सूची' },
  'view.calendar': { en: 'Calendar', hi: 'पंचांग' },
  'view.timeline': { en: 'Timeline', hi: 'कालरेखा' },
  'view.workload': { en: 'Workload', hi: 'भार' },
  'view.priority': { en: 'Priority', hi: 'प्राथमिकता' },
  'view.mytasks':  { en: 'My Tasks', hi: 'मेरे कार्य',  gu: 'મારા કાર્ય' },

  // ── The product itself ────────────────────────────────────────────────────
  app: { en: 'Kartavaya', hi: 'कर्तव्य', sa: 'कर्तव्य' },
};

/** Merge a seed entry without letting a later, thinner source overwrite a fuller one. */
function seed(into, key, value) {
  if (!key) return;
  const prev = into[key];
  const next = {
    en: value.en ?? prev?.en,
    hi: value.hi ?? prev?.hi,
    gu: value.gu ?? prev?.gu,
    sa: value.sa ?? prev?.sa,
  };
  // Drop absent slots rather than storing `undefined`, so `'gu' in entry` is a
  // usable coverage question.
  into[key] = Object.fromEntries(Object.entries(next).filter(([, v]) => v != null));
}

/**
 * The registry.
 *
 * Built rather than written out, because navConfig.js IS the shape and IS the
 * only Gujarati source. A hand-copied second table would drift the same way the
 * sidebar and topbar drifted before navConfig was extracted — the comment at
 * the top of that file records `स्वचालन` against `स्वतंत्र`, which means
 * "independent" rather than "automated".
 */
export const LABELS = (() => {
  const out = {};

  for (const group of [...NAV_FULL, ...NAV_CLIENT]) {
    // Section headings: `{section, sans, gu}` — `sans` is a Sanskrit form, so it
    // seeds `sa`, and `en` is the section slug title-cased. That `sans` never
    // followed the language setting is the second half of the EN leak: the nine
    // headings render Devanagari under every option including EN.
    seed(out, `section.${group.section}`, {
      en: group.section.charAt(0).toUpperCase() + group.section.slice(1),
      sa: group.sans,
      hi: group.sans,
      gu: group.gu,
    });
    for (const it of group.items || []) seed(out, it.key, it);
  }

  for (const it of MOBILE_NAV) seed(out, it.key, it);
  for (const r of EXTRA_ROUTES) seed(out, r.key, r);

  for (const [k, v] of Object.entries(CORE)) seed(out, k, v);

  return Object.freeze(out);
})();

/**
 * `{primary, secondary, script}` for a key.
 *
 * Returning the KEY on a miss matters (§24): a missing label should render
 * `vikray` — visibly wrong, easy to spot, harmless — not crash the sidebar.
 *
 * `script` is an addition to §24's `{primary, secondary}` and it is the
 * accessibility half: it names the field the secondary actually came from, so
 * the `lang=` attribute can never claim a script the string is not in. §24's
 * component hardcodes `'en+sa' → lang="sa"`, which mislabels every entry where
 * `sa` is absent and `hi` was used — the normal case, by §24's own rule.
 */
export function label(key, lang) {
  const entry = LABELS[key];
  const want = secondaryField(lang);
  if (!entry) return { primary: key, secondary: null, script: null };

  const primary = entry.en ?? key;
  if (!want) return { primary, secondary: null, script: null };

  if (want === 'sa') {
    if (entry.sa) return { primary, secondary: entry.sa, script: 'sa' };
    return entry.hi ? { primary, secondary: entry.hi, script: 'hi' } : { primary, secondary: null, script: null };
  }
  // `hi → sa` for the same reason `resolve()` does it: both are Devanagari, so a
  // key that only ever got a Sanskrit form still renders under EN + हि. There is
  // no `gu` arm — a different script is not a fallback.
  if (want === 'hi' && !entry.hi && entry.sa) return { primary, secondary: entry.sa, script: 'sa' };

  const value = entry[want];
  return value ? { primary, secondary: value, script: want } : { primary, secondary: null, script: null };
}

/** Whether a key is in the registry — for callers that want to fall back rather than print the key. */
export function hasLabel(key) {
  return Object.prototype.hasOwnProperty.call(LABELS, key);
}

/**
 * Registry coverage, so the Gujarati gap is a number rather than a feeling.
 *
 * `{ total, hi, gu, sa }`. Used by the test to pin the shape of the debt: `hi`
 * must be complete, `gu` is allowed to be partial and its size is asserted so
 * it cannot quietly shrink.
 */
export function coverage() {
  const keys = Object.keys(LABELS);
  const count = f => keys.filter(k => LABELS[k][f]).length;
  return { total: keys.length, hi: count('hi'), gu: count('gu'), sa: count('sa') };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * BACKWARD COMPATIBILITY
 *
 * 202 JSX elements across 117 files carry Indic text today, in the fifteen
 * shapes and four non-shapes catalogued in the header. They cannot all be
 * migrated in one commit, and a component that only understands the new shape
 * would force exactly that.
 *
 * `resolve()` reads ANY of them. A call site migrates by swapping its own
 * markup for <Bilingual value={…} /> with the object it already has, gets the
 * EN fix immediately, and moves to a registry key later — two small steps
 * instead of one large one.
 * ───────────────────────────────────────────────────────────────────────────*/

/**
 * The English key, in precedence order.
 *
 * `en` first is what keeps navConfig items correct: they carry BOTH `en` and
 * `module: 'graha'`, and `module` is an English key in
 * `pages/dristi/_shared.jsx`. Whichever is more specific must win, and `en` is
 * the one that always means "the English label".
 */
const EN_KEYS = ['en', 'label', 'title', 'name', 'section', 'mod', 'k', 'module', 'code'];

/** The Devanagari key, in precedence order. `_hindi` is KanbanView's, `titleHi` is mobile's. */
const HI_KEYS = ['hi', '_hindi', 'hindi', 'titleHi'];

/** The Sanskrit key. `sans` is the five module page files', `sanskrit` is BillingLinesBlock's. */
const SA_KEYS = ['sa', 'sans', 'sanskrit'];

/** The middot form: `"Revenue · राजस्व"`, 48 occurrences across 20 files. */
const MIDDOT = /\s*·\s*/;

/**
 * Normalise any legacy shape to `{en, hi, gu, sa}`.
 *
 * Exported for the test, which asserts every one of the fifteen measured shapes
 * resolves — that list is the finding, stated as a check.
 */
export function toEntry(source) {
  if (source == null) return null;

  if (typeof source === 'string') {
    // A middot string is a pair; a plain string is an English label with no
    // secondary, UNLESS it is Indic on its own, in which case there is no
    // English to lead with and the caller gets it back as the primary.
    const parts = source.split(MIDDOT);
    if (parts.length >= 2) {
      const [en, ...rest] = parts;
      const second = rest.join(' · ').trim();
      return hasGujarati(second) && !hasDevanagari(second)
        ? { en: en.trim(), gu: second }
        : { en: en.trim(), hi: second };
    }
    return { en: source };
  }

  if (typeof source !== 'object') return { en: String(source) };

  const pick = (keys) => {
    for (const k of keys) {
      const v = source[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return undefined;
  };

  const entry = {};
  const en = pick(EN_KEYS);
  const hi = pick(HI_KEYS);
  const sa = pick(SA_KEYS);
  const gu = pick(['gu', 'gujarati']);
  if (en) entry.en = en;
  if (hi) entry.hi = hi;
  if (sa) entry.sa = sa;
  if (gu) entry.gu = gu;

  // The notifSound guard, applied at the boundary rather than at 19 call sites:
  // a Gujarati string sitting in an `hi` slot is moved to `gu`, so it can never
  // be rendered with lang="hi". `lib/notifSound.js` lines 29-102 do exactly
  // this — 19 values — and the audit counted one Gujarati-bearing file when
  // there are two.
  if (entry.hi && hasGujarati(entry.hi) && !hasDevanagari(entry.hi)) {
    entry.gu = entry.gu || entry.hi;
    delete entry.hi;
  }
  return Object.keys(entry).length ? entry : null;
}

/**
 * `{primary, secondary, script}` from a key OR any legacy shape OR a string.
 *
 * This is what `components/Bilingual.jsx` calls. A registry key wins when it
 * resolves, so a migrated call site keeps working if someone later passes the
 * old object too.
 */
export function resolve(source, lang) {
  if (typeof source === 'string' && hasLabel(source)) return label(source, lang);

  const entry = toEntry(source);
  if (!entry) return { primary: '', secondary: null, script: null };

  const want = secondaryField(lang);
  const primary = entry.en ?? entry.hi ?? entry.gu ?? entry.sa ?? '';
  if (!want) {
    // Under EN there is no secondary AT ALL. If the only value we were given is
    // Indic, the caller has nothing English to show — returning the Indic
    // string is the honest outcome and is visible, which is what makes the
    // missing English label findable.
    return { primary, secondary: null, script: hasDevanagari(primary) || hasGujarati(primary) ? 'unknown' : null };
  }

  let secondary = entry[want];
  let script = want;
  // Devanagari falls through to Devanagari, BOTH WAYS. `sa → hi` is §24's rule.
  // `hi → sa` is the same rule read backwards and it is the one the migration
  // needs: three of the measured shapes carry ONLY a Sanskrit key —
  // `{label, sans}` (MyTasksView), `{title, sans}` (TasksListPage),
  // `{label, sanskrit}` (BillingLinesBlock) — so without it those call sites
  // would render nothing at all under EN + हि, which is the majority option.
  //
  // Gujarati is NOT in this fallthrough in either direction. It is a different
  // script, and substituting it is the notifSound bug.
  if (!secondary && want === 'sa' && entry.hi) { secondary = entry.hi; script = 'hi'; }
  if (!secondary && want === 'hi' && entry.sa) { secondary = entry.sa; script = 'sa'; }
  if (!secondary || secondary === primary) return { primary, secondary: null, script: null };
  return { primary, secondary, script };
}

/** How many keys carry no `gu`, listed — the migration backlog, countable. */
export function missingGujarati() {
  return Object.keys(LABELS).filter(k => !LABELS[k].gu);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE SECONDARY RUN ON ITS OWN
 *
 * `resolve()` assumes the pair arrives together. Five shared components in this
 * build do not work that way, and between them they hold 255 of the product's
 * label call sites:
 *
 *   PageHeader    `title` + `sanskrit`   22 sites
 *   ModuleHeader  `en` + `hi`            13
 *   KpiStrip      item `label` + `hi`    11
 *   StatTile      `label` + `sanskrit`  112
 *   EmptyState    `title.{en,hi,gu}`     97
 *
 * The first four take the English in one prop and the Indic in another, because
 * their CSS places the two runs independently — `.mh__t` uses `order` to put
 * Devanagari first at heading weight with the English beside it at .56em, and
 * `.k-stat__lbl` pushes the Devanagari to the trailing edge of the label row.
 * Wrapping both runs in one `.bi` element, which is what `<Bilingual>` does,
 * would collapse those layouts.
 *
 * So they need the same DECISION without the same MARKUP: given the Indic value
 * alone, is it rendered at all under this language setting, and what script is
 * the string that comes back actually in. That is this function. The component
 * keeps its own DOM and its own class names; what it stops owning is the
 * question of whether to render.
 *
 * Why it cannot just call `resolve()`: `resolve('संस्थाएँ')` reads a bare string
 * as an ENGLISH label with no secondary — correct for `resolve`, wrong here,
 * where the English is sitting in a sibling prop and the string in hand is by
 * construction the secondary. Passing `{en: title, hi: sanskrit}` does not work
 * either: `title` is frequently a node rather than a string, `toEntry` only
 * picks string values, and the entry would come back with the Indic promoted to
 * primary.
 * ───────────────────────────────────────────────────────────────────────────*/

const NO_SECONDARY = { secondary: null, script: null };

/**
 * `{secondary, script}` for a value that is ALREADY the Indic half.
 *
 * Accepts a registry key, a bare Indic string (the shape the 53 `sanskrit=` and
 * `hi=` call sites use today), or any `{hi, gu, sa}` object — so a call site
 * gains a Gujarati slot by adding one key, without the component changing.
 *
 * Under `en` it returns `{null, null}`. That is the whole point: the secondary
 * is not RENDERED, so there is no node for a stylesheet to have to know about.
 * `[data-language="en"]` names six class names across two stylesheets, and
 * `.mh__hi`, `.mk__hi`, `.k-stat__hi` and `.empty__title-hi` are not among
 * them — four of the five components above leaked Devanagari into English on
 * every page that used them.
 *
 * The fallthrough rules are `resolve()`'s, for the same reasons: `sa ↔ hi` both
 * ways because both are Devanagari, and NEVER to or from `gu`, because handing
 * Devanagari to a reader who asked for Gujarati and labelling it `lang="gu"` is
 * the `notifSound.js` bug reproduced on purpose.
 */
export function secondaryOf(source, lang) {
  const want = secondaryField(lang);
  if (!want || source == null) return NO_SECONDARY;

  if (typeof source === 'string' && hasLabel(source)) {
    const { secondary, script } = label(source, lang);
    return secondary ? { secondary, script } : NO_SECONDARY;
  }

  let entry;
  if (typeof source === 'string') {
    const s = source.trim();
    // Which slot a bare string belongs in is read off the script it is written
    // in, never off the prop name. `sanskrit="संस्थाएँ"` is Hindi — the -एँ
    // plural does not exist in Sanskrit — and `PageHeader` says so at length
    // about its own prop. A name is a claim; the codepoints are evidence.
    if (hasGujarati(s) && !hasDevanagari(s)) entry = { gu: s };
    else if (hasDevanagari(s)) entry = { hi: s };
    else return NO_SECONDARY; // Latin in an Indic slot is not a second script.
  } else {
    entry = toEntry(source);
    if (!entry) return NO_SECONDARY;
  }

  if (want === 'gu') return entry.gu ? { secondary: entry.gu, script: 'gu' } : NO_SECONDARY;
  if (want === 'sa') {
    if (entry.sa) return { secondary: entry.sa, script: 'sa' };
    return entry.hi ? { secondary: entry.hi, script: 'hi' } : NO_SECONDARY;
  }
  if (entry.hi) return { secondary: entry.hi, script: 'hi' };
  return entry.sa ? { secondary: entry.sa, script: 'sa' } : NO_SECONDARY;
}
