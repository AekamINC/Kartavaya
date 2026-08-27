/**
 * sanvaadLegacyVocabulary — the ratchet on the Messaging v2 conversion.
 *
 * WHY THIS FILE EXISTS. The `.m2*` layer was added ADDITIVELY, so the old
 * vocabulary and the new one shipped side by side and nothing went red. The
 * conversion was then reported as finished twice while most of the rendered UI
 * was still on the old names, because there was no measurement that could tell
 * the difference — `check-classes` only fails on a class that is USED and not
 * DECLARED, and an additive layer never trips that.
 *
 * So this asserts the two facts a reviewer actually needs:
 *
 *  1. THE RETIRED NAMES STAY RETIRED. Thirty-nine pre-v2 rules were deleted from
 *     `sanvaad.css` once their surface had moved to `.m2*`. If any of them comes
 *     back — as a rule or as a className — this fails by name. That is the half
 *     that stops the layer sliding back to additive.
 *
 *  2. WHAT IS LEFT IS A NAMED INVENTORY, NOT A NUMBER. `LEGACY` below lists every
 *     remaining pre-v2 class per file. It is asserted in BOTH directions: a new
 *     legacy class fails, and a converted one that is still listed also fails.
 *     A bare count would let one surface regress while another improved, which
 *     is exactly how the first two "done" reports happened.
 *
 * WHAT THE INVENTORY MEANS, and it is not a to-do list. `messaging.css` — the
 * prototype, which HANDOVER.md makes the spec — declares 151 `.m2*` names plus
 * nine shared ones. It has no design at all for the emoji picker, the mentions
 * panel, the search panel, the channel-details drawer, the thread PANEL (v2 puts
 * threads inline), the WhatsApp connect form, the Varta list views, inline edit,
 * tombstones or module-event rows. Those surfaces exist in the build and in no
 * prototype screen, so there is no `.m2*` name to CONVERT them to.
 *
 * ── THE THIRD OPTION, ADDED 2026-08-06 ─────────────────────────────────────
 * "No counterpart" was read here as "leave the old name", and for three
 * surfaces that was the wrong read. `sanvaad.css` already had the precedent at
 * `.m2--mob-chat` — a name the prototype's markup renders and its stylesheet
 * never declares, AUTHORED into the § V2 layer rather than left out — and the
 * pinned bar, the scrollback control and the thread panel are the same case
 * one step further: the build has a surface the prototype has no screen for, so
 * the § V2 namespace is EXTENDED and the pre-V2 rules are DELETED, not kept
 * beside it. `.m2pin__ic/__list/__row/__nav/__x`, `.m2older` and `.m2thp*` are
 * that, declaration for declaration, and the eleven `.sv__pins-*` /
 * `.sv__older` / `.sv__thread*` rules they replace are gone from the file.
 *
 * Extending is not free and it is not the default: it puts a name in the
 * prototype's namespace that the prototype cannot vouch for. It is right only
 * where the OLD name described the same element — a rename — and wrong wherever
 * converting would mean designing the surface first, which is why the emoji
 * picker, the search panel, the mentions panel and the details drawer are still
 * on their own names below.
 *
 * Each group below says which of the three it is. `REPLACEABLE` is work
 * someone can finish today with a name the prototype already declares.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

const ROOT = process.cwd();
const CSS = readFileSync(resolve(ROOT, 'src/styles/sanvaad.css'), 'utf8');
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* ── The thirty-nine that were deleted ─────────────────────────────────────
 * Grouped by the `.m2*` surface that replaced each one, because "why is this
 * gone" is the only question a reader will have and the answer should not
 * require a git log.
 */
const RETIRED = {
  'shell + rail → .m2 / .m2__col / .m2r*': [
    'sv__rail', 'sv__list', 'sv__chat', 'sv__scroll', 'sv__lhd', 'sv__lt', 'sv__secb',
  ],
  'conversation header → .m2c__hd / .m2c__n / .m2c__sub / .m2c__acts': [
    'sv__hd', 'sv__hd-n', 'sv__hd-d', 'sv__hd-act',
  ],
  'channel row → .m2row* (.m2row__av--ch carries the tone tile)': [
    'ch__txt', 'ch__n', 'ch__last', 'ch__arch',
  ],
  'log dividers → .m2div / .m2div__p / .m2div--new': [
    'sv__newline', 'sv__sep-t',
  ],
  'typing + jump → .m2typing / .m2dots / .m2jump': [
    'sv__typing', 'sv__dots', 'sv__jump',
  ],
  'thread control → .m2th__open / .m2th__when': [
    'msg__thr', 'msg__thr-t',
  ],
  'edited marker → .m2m__tag': [
    'msg__ed',
  ],
  'WhatsApp log + bubble → .m2log / .m2m / .m2m__b / .m2m--mine': [
    'wa__log', 'wa__b', 'wa__b--in', 'wa__b--out', 'wa__m',
  ],
  'WhatsApp account strip → .m2c__ic / .m2c__n / .m2c__sub': [
    'wahdr__ic', 'wahdr__t', 'wahdr__n', 'wahdr__d',
  ],
  'rail filter → .m2r__segs / .m2seg / .m2seg--alert': [
    'wa__filter',
  ],
  'template composer → .m2tpl*': [
    'wa__tpl', 'wa__tpl-l', 'wa__tpl-row',
  ],
  'window banner + empties → .m2c__banner--mute / .m2c__banner--warn': [
    'wa__win--open', 'wa__none',
  ],
  'locked composer → .m2cp__locked': [
    'cmp--locked',
  ],
};
const RETIRED_FLAT = Object.values(RETIRED).flat();

/* ── What is still on the old vocabulary, file by file ─────────────────────
 * The three reasons, and every entry has exactly one:
 *
 *   NO-PROTOTYPE  the surface is not in `messaging.css` at all. Nothing to
 *                 convert to. Converting means DESIGNING it first.
 *   DELIBERATE    the surface is in the prototype and the build deviates on
 *                 purpose, with the reason written at the call site.
 *   REPLACEABLE   a real `.m2*` counterpart exists and this is unfinished work.
 */
const LEGACY = {
  'components/sanvaad/SahayakCard.jsx': ['svbtn'],
  'pages/sanvaad/ChannelDetails.jsx': [
    'sv__hi', 'sv__none', 'sv__pres', 'svbtn',
    'svd', 'svd__mute', 'svd__n', 'svd__rn', 'svd__row', 'svd__sec', 'svd__t',
    'svd__tag', 'svd__tone', 'svd__tones',
  ],
  'pages/sanvaad/ChannelList.jsx': [
    'ch', 'ch__ic', 'sv__hi', 'sv__lnew', 'sv__lnew-row', 'sv__mnb', 'sv__mnb-t',
    'sv__none', 'svbtn',
  ],
  'pages/sanvaad/ChannelsTab.jsx': ['ch__ic', 'sv__banner', 'sv__blank'],
  'pages/sanvaad/ChatPane.jsx': ['ch__ic', 'sv__blank', 'sv__hd-mem', 'svbtn'],
  'pages/sanvaad/Composer.jsx': ['ch__ic', 'cmp__fmt', 'cmp__fmtb', 'cmp__reply-t', 'svbtn'],
  'pages/sanvaad/EmojiPicker.jsx': [
    'emo', 'emo__b', 'emo__cat', 'emo__g', 'emo__none', 'emo__q', 'emo__quick', 'emo__scroll',
  ],
  'pages/sanvaad/LockedComposer.jsx': ['ch__ic', 'cmp__locked-m', 'cmp__locked-t'],
  'pages/sanvaad/MentionInput.jsx': [
    'cmp__mn', 'cmp__mn-b', 'cmp__mn-e', 'cmp__mn-n', 'cmp__mn-r', 'cmp__send', 'cmp__ta',
  ],
  'pages/sanvaad/MentionsPanel.jsx': [
    'ch__ic', 'msg__mn', 'msg__mn--me', 'sv__hi', 'sv__ltog', 'sv__mnp', 'sv__mnp-c',
    'sv__mnp-e', 'sv__mnp-f', 'sv__mnp-h', 'sv__mnp-k', 'sv__mnp-l', 'sv__mnp-r',
    'sv__mnp-s', 'sv__mnp-u', 'svbtn',
  ],
  'pages/sanvaad/Message.jsx': [
    'ch__ic', 'cmp__ta', 'msg', 'msg--gone', 'msg--sys', 'msg__actb', 'msg__c',
    'msg__edit', 'msg__edit-hint', 'msg__edit-row', 'msg__edit-ta', 'msg__glyph',
    'msg__hd', 'msg__lnk', 'msg__pin', 'msg__pre', 'msg__sending', 'msg__sysa',
    'msg__sysb', 'msg__systag', 'msg__tomb', 'msg__when', 'msg__who', 'seen',
    'sv__hi', 'sv__none',
  ],
  'pages/sanvaad/MessageLog.jsx': ['sv__hi'],
  'pages/sanvaad/SahayakAside.jsx': ['sv__none', 'svbtn'],
  'pages/sanvaad/SearchPanel.jsx': [
    'ch__ic', 'msg__hl', 'sv__ltog', 'sv__srch', 'sv__srch-c',
    'sv__srch-e', 'sv__srch-f', 'sv__srch-in', 'sv__srch-l', 'sv__srch-r',
    'sv__srch-s', 'svbtn',
  ],
  'pages/sanvaad/ThreadPanel.jsx': ['sv__none', 'svbtn'],
  'pages/sanvaad/icons.jsx': ['wa__fail', 'wa__tick', 'wa__tick--read'],
  'pages/sanvaad/varta/TemplatePicker.jsx': ['cmp__send'],
  'pages/sanvaad/varta/WAChat.jsx': [
    'msg--sending', 'sv__blank', 'sv__none', 'svbtn', 'wa__err',
  ],
  'pages/sanvaad/varta/WAConnectAccount.jsx': [
    'wa-conn', 'wa-conn__act', 'wa-conn__err', 'wa-conn__lede',
  ],
  // Varta → Pricing (Phase 0.27). The tiles themselves are `.k-card` and its
  // parts, which is why they are not in here — the only names below are the
  // estimate scaffolding, and `messaging.css` draws no pricing screen at all.
  'pages/sanvaad/varta/WARateCard.jsx': [
    'wa__estbar', 'wa__estbar-tag', 'wa__estbar-txt', 'wa__estbill',
    'wa__estfree', 'wa__estnote', 'wa__estnote--stop', 'wa__estrate',
    'wa__estsrc', 'wa__grid', 'wa__row-s',
  ],
  'pages/sanvaad/varta/WhatsAppTab.jsx': [
    'sv__blank', 'sv__none', 'wa__acthdr', 'wa__asg', 'wa__asg--none', 'wa__grid',
    'wa__row', 'wa__row-m', 'wa__row-s', 'wa__row-t', 'wa__tpl-prev',
  ],
  'pages/sanvaad/varta/WindowBanner.jsx': ['wa__win-t'],
};

/**
 * The reason each surviving name is still here. Asserted for completeness below,
 * so a class cannot be added to `LEGACY` without someone stating which it is.
 */
const REASON = {
  NO_PROTOTYPE: [
    // Whole screens `messaging.css` does not draw.
    'emo', 'emo__b', 'emo__cat', 'emo__g', 'emo__none', 'emo__q', 'emo__quick', 'emo__scroll',
    'sv__mnp', 'sv__mnp-c', 'sv__mnp-e', 'sv__mnp-f', 'sv__mnp-h', 'sv__mnp-k',
    'sv__mnp-l', 'sv__mnp-r', 'sv__mnp-s', 'sv__mnp-u', 'sv__ltog',
    'sv__srch', 'sv__srch-c', 'sv__srch-e', 'sv__srch-f', 'sv__srch-in',
    'sv__srch-l', 'sv__srch-r', 'sv__srch-s',
    'svd', 'svd__mute', 'svd__n', 'svd__rn', 'svd__row', 'svd__sec', 'svd__t',
    'svd__tag', 'svd__tone', 'svd__tones', 'sv__pres',
    'wa-conn', 'wa-conn__act', 'wa-conn__err', 'wa-conn__lede',
    'wa__acthdr', 'wa__asg', 'wa__asg--none', 'wa__grid', 'wa__row', 'wa__row-m',
    'wa__row-s', 'wa__row-t', 'wa__tpl-prev', 'wa__err',
    // Varta → Pricing. `messaging.css` designs no rate card — the prototype
    // predates the WhatsApp channel having a price at all — so every name on
    // that screen is necessarily outside the v2 vocabulary. They are NOT
    // REPLACEABLE: there is no `.m2*` counterpart to port to.
    'wa__estbar', 'wa__estbar-tag', 'wa__estbar-txt', 'wa__estbill',
    'wa__estfree', 'wa__estnote', 'wa__estnote--stop', 'wa__estrate', 'wa__estsrc',
    // Controls and states the prototype has no element for.
    'sv__lnew', 'sv__lnew-row', 'sv__mnb', 'sv__mnb-t', 'sv__banner', 'sv__blank',
    'sv__none', 'sv__hi', 'sv__hd-mem', 'ch__ic', 'ch',
    'msg__edit', 'msg__edit-hint', 'msg__edit-row', 'msg__edit-ta',
    'msg__lnk', 'msg__pre', 'msg__hl', 'msg__pin', 'msg__sending', 'msg--sending',
    'seen', 'msg__mn', 'msg__mn--me',
    'cmp__fmt', 'cmp__fmtb', 'cmp__reply-t', 'cmp__locked-m', 'cmp__locked-t',
    'cmp__mn', 'cmp__mn-b', 'cmp__mn-e', 'cmp__mn-n', 'cmp__mn-r',
    'wa__win-t', 'wa__fail',
  ],
  DELIBERATE: [
    // Message.jsx's own docblock: a tombstone and a module event are the two rows
    // that are NOT somebody speaking, so neither is a bubble and `messaging.css`
    // designs neither.
    'msg', 'msg--gone', 'msg--sys', 'msg__c', 'msg__glyph', 'msg__hd', 'msg__sysa',
    'msg__sysb', 'msg__systag', 'msg__tomb', 'msg__when', 'msg__who',
    // `.m2tray button` would style three of the four controls: `ui/Menu` renders
    // its trigger as a `<span role="button">`. Stated at the call site.
    'msg__actb',
    // `.icobtn` is the prototype's name and has NO rule anywhere in src/styles —
    // `.svbtn` (26px, sanvaad) and `.k-iconbtn` (34px, editorial.css) are the
    // build's two ports of it. Converting would unstyle every icon button here.
    'svbtn',
    // `.m2cp textarea` is an element selector; the build needs a class because
    // the same box is reused by the inline editor, which is not inside `.m2cp`.
    'cmp__ta', 'cmp__send',
    // The svg INSIDE `.m2tick`. `.m2tick` is the wrapper and is already applied.
    'wa__tick', 'wa__tick--read',
  ],
  REPLACEABLE: [],
};
const REASON_FLAT = Object.values(REASON).flat();

/* ── Extraction, matching `check-classes.mjs` where it matters ───────────── */
const PROTO = readFileSync(
  resolve(ROOT, '../design-reference/Kartavaya Redesign/messaging.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, ' ');
const PROTO_NAMES = new Set([...PROTO.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const DECLARED = new Set([...CSS_NO_COMMENTS.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__') walk(p, out);
    } else if (/\.(jsx|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every className expression in a file, quotes included. */
function classExprs(src) {
  const out = [];
  const re = /\bclassName\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    const q0 = src[i];
    if (q0 === '"' || q0 === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== q0) { if (src[j] === '\\') j++; j++; }
      out.push(src.slice(i, j + 1));
      re.lastIndex = j + 1;
    } else if (q0 === '{') {
      let d = 0, j = i;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '{') d++;
        else if (c === '}') { d--; if (d === 0) break; }
        else if (c === '"' || c === "'" || c === '`') {
          const q = c; j++;
          while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; }
        }
      }
      out.push(src.slice(i, j + 1));
      re.lastIndex = j + 1;
    }
  }
  return out;
}

/** Every class name a file puts in a `className`, unfiltered. */
function classesIn(file) {
  const src = readFileSync(file, 'utf8');
  const found = new Set();
  for (const expr of classExprs(src)) {
    for (const lit of expr.match(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g) || []) {
      for (const t of lit.slice(1, -1).match(/[A-Za-z_][A-Za-z0-9_-]*/g) || []) found.add(t);
    }
  }
  return found;
}

/**
 * Pre-v2 classes this file renders: declared in sanvaad.css, not `.m2*`, not a
 * name the prototype states, not an `is-*` state flag.
 *
 * `DECLARED` is deliberately part of the filter HERE and deliberately not part
 * of the retired-name check below. This function answers "what old vocabulary is
 * still wired up", and a name with no rule is not wired up — it is a typo, and
 * `check-classes` already fails the build for it. The retired check has to see
 * exactly that case, because a page re-adopting `.sv__jump` would otherwise be
 * invisible to this file and only show up as a MISSING RULE with no explanation
 * of what it used to be.
 */
function legacyIn(file) {
  const found = [];
  for (const t of classesIn(file)) {
    if (!DECLARED.has(t)) continue;
    if (/^m2/.test(t) || /^is-/.test(t) || PROTO_NAMES.has(t)) continue;
    found.push(t);
  }
  return found.sort();
}

const FILES = [
  ...walk(resolve(ROOT, 'src/pages/sanvaad')),
  ...walk(resolve(ROOT, 'src/components/sanvaad')),
].map((f) => [relative(resolve(ROOT, 'src'), f).split(sep).join('/'), f]);

describe('sanvaad v2 · the retired vocabulary stays retired', () => {
  it.each(Object.entries(RETIRED))('%s — no rule survives in sanvaad.css', (_group, names) => {
    const back = names.filter((n) =>
      new RegExp(`\\.${n.replace(/-/g, '\\-')}(?![\\w-])`).test(CSS_NO_COMMENTS)
    );
    expect(back, `re-declared in sanvaad.css: ${back.join(', ')}`).toEqual([]);
  });

  it('no page or component renders one of them either', () => {
    const back = [];
    for (const [rel, file] of FILES) {
      for (const cls of classesIn(file)) {
        if (RETIRED_FLAT.includes(cls)) back.push(`${rel} → .${cls} (retired — see RETIRED above)`);
      }
    }
    expect(back, back.join('\n')).toEqual([]);
  });

  it('retires 39 names, and each one names a surface that moved', () => {
    expect(RETIRED_FLAT.length).toBe(39);
    expect(new Set(RETIRED_FLAT).size, 'a name is listed twice').toBe(39);
    // Every group's label has to name the `.m2*` it moved to, and that name has
    // to be real — a label pointing at a class the prototype never declared is a
    // story rather than a migration.
    for (const [label] of Object.entries(RETIRED)) {
      const targets = label.match(/\.m2[\w-]*/g) || [];
      expect(targets.length, `no .m2 target named in "${label}"`).toBeGreaterThan(0);
      for (const t of targets) {
        expect(PROTO_NAMES.has(t.slice(1)), `${t} is not in messaging.css`).toBe(true);
      }
    }
  });
});

describe('sanvaad v2 · what is still on the old vocabulary is an inventory', () => {
  it.each(FILES)('%s renders exactly its listed pre-v2 classes', (rel, file) => {
    expect(legacyIn(file), `update LEGACY['${rel}'] in this file`).toEqual(LEGACY[rel] ?? []);
  });

  it('lists no file that has since been fully converted', () => {
    const rendered = new Set(FILES.map(([rel]) => rel));
    const ghosts = Object.keys(LEGACY).filter((f) => !rendered.has(f));
    expect(ghosts, `LEGACY names files that no longer exist: ${ghosts.join(', ')}`).toEqual([]);
    const clean = Object.entries(LEGACY)
      .filter(([rel]) => rendered.has(rel))
      .filter(([, names]) => names.length === 0)
      .map(([rel]) => rel);
    expect(clean, `converted — delete the entry: ${clean.join(', ')}`).toEqual([]);
  });

  it('gives every surviving class one stated reason, and only one', () => {
    const all = [...new Set(Object.values(LEGACY).flat())].sort();
    const unexplained = all.filter((c) => !REASON_FLAT.includes(c));
    expect(unexplained, `no reason stated: ${unexplained.join(', ')}`).toEqual([]);
    const twice = REASON_FLAT.filter((c, i) => REASON_FLAT.indexOf(c) !== i);
    expect(twice, `two reasons for: ${twice.join(', ')}`).toEqual([]);
    const orphaned = REASON_FLAT.filter((c) => !all.includes(c));
    expect(orphaned, `reason given for a class nothing renders: ${orphaned.join(', ')}`).toEqual([]);
  });

  /**
   * The finding the previous two reports missed, stated as an assertion so it
   * cannot be forgotten again: the prototype does not cover this module. It
   * declares 151 `.m2*` names and nine shared ones, and the surfaces it has no
   * screen for are why `REPLACEABLE` is empty rather than why the work is done.
   */
  it('REPLACEABLE is empty because the prototype has no screen for the rest', () => {
    expect(REASON.REPLACEABLE).toEqual([]);
    const m2 = [...PROTO_NAMES].filter((c) => c.startsWith('m2'));
    expect(m2.length, 'messaging.css changed — re-read it before trusting this file').toBe(151);
    for (const surface of ['emo', 'svd', 'sv__mnp', 'sv__srch', 'sv__thread', 'wa-conn']) {
      expect(
        [...PROTO_NAMES].some((c) => c.startsWith(surface)),
        `${surface} now HAS a prototype counterpart — convert it and move it out of NO_PROTOTYPE`
      ).toBe(false);
    }
  });
});
