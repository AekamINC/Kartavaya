// What each platform will actually PRINT, which is not what the model wrote.
//
// The generator returns markdown. Four of the eight destinations render none of
// it: an Instagram caption prints `**Diwali**` as five literal characters and
// two asterisks, and so do Facebook, X and the Google Ads editor. LinkedIn is
// worse than that — it strips markdown AND has no formatting of its own, so the
// only way to get bold into a LinkedIn post is to substitute the Unicode
// mathematical alphanumerics, character by character. WhatsApp does have markup
// and it is not markdown: its bold is `*one asterisk*`, so the `**two**` that
// markdown means renders there as a literal asterisk wrapped around bold text.
//
// A preview that shows the markdown source is therefore worse than no preview,
// because it shows formatting on a screen where the person is deciding whether
// the post is ready and the platform will not honour any of it.
//
// ── One table, because the last two disagreed ────────────────────────────────
//
// `charLimit` used to sit in `_shared.PLATFORM_HINTS` while the shaping lived
// in `toWhatsApp`/`toPlain` beside it — the same split that put a skill's
// `credits` in the frontend while the server owned `CREDIT_COSTS`, and which
// ended with four of seven skills quoting a price they did not charge. A
// platform's cap and a platform's markup are one fact about one platform, so
// they are one row here. `_shared` re-exports the names its old callers use.
//
// ── No underscore emphasis, on purpose ──────────────────────────────────────
//
// Markdown reads `_x_` as italic. Generated marketing copy is full of hashtags
// like `#diwali_sale_2026`, and a naive `_..._` rule turns the middle of that
// tag into italics and eats the underscores — silently corrupting the one token
// in the post that has to be copied exactly. Models emit `*` and `**` for
// emphasis in practice; the underscore forms buy a rare case and cost a common
// one.

/* ── The Unicode substitution LinkedIn forces ───────────────────────────────
 *
 * There is no bold in a LinkedIn composer. The convention is Unicode's
 * Mathematical Alphanumeric Symbols block, whose sans-serif runs are the ones
 * that match a UI font rather than looking like a theorem.
 *
 * Two limits, both real, both deliberate:
 *
 *   · The block covers ASCII letters and digits ONLY. Devanagari, Gujarati,
 *     Tamil and Marathi have no bold codepoints at all, and this product ships
 *     six languages — so a Hindi post falls through the map unchanged rather
 *     than turning into tofu boxes. That is why every branch below ends in
 *     `out += ch` instead of a lookup that can miss.
 *   · Sans-serif italic has no digits in Unicode. `SANS_ITALIC.digit` is 0 and
 *     the digit branch is skipped, which leaves `2026` readable instead of
 *     mixing one italic style with another for the numerals. What to do about
 *     a RUN that mixes the two is decided one layer up, in `inlineToText` —
 *     see the note there; the mapper only maps.
 */
const SANS_BOLD = { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec };
const SANS_ITALIC = { upper: 0x1d608, lower: 0x1d622, digit: 0 };
const SANS_BOLD_ITALIC = { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec };

function mapAscii(text, map) {
  let out = '';
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) out += String.fromCodePoint(map.upper + (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(map.lower + (c - 97));
    else if (map.digit && c >= 48 && c <= 57) out += String.fromCodePoint(map.digit + (c - 48));
    else out += ch;
  }
  return out;
}

/** `Diwali` → `𝗗𝗶𝘄𝗮𝗹𝗶`. ASCII only — see the block comment above. */
export const unicodeBold = t => mapAscii(t, SANS_BOLD);
/** `Diwali` → `𝘋𝘪𝘸𝘢𝘭𝘪`. Digits are left alone; Unicode has no italic ones here. */
export const unicodeItalic = t => mapAscii(t, SANS_ITALIC);
const unicodeBoldItalic = t => mapAscii(t, SANS_BOLD_ITALIC);

/* ── The platforms ─────────────────────────────────────────────────────────
 *
 * `shape` is the only thing the formatter branches on:
 *
 *   rich      the destination accepts HTML, so the reader keeps real headings,
 *             real lists and live links (email clients, a CMS body field)
 *   whatsapp  WhatsApp's own markup — `*bold*`, `_italic_`, `~strike~`
 *   unicode   no markup at all, so emphasis is substituted characters
 *   plain     no markup at all and no convention either; every mark is removed
 *
 * `note` is what the reader needs to know BEFORE they judge the preview, not
 * general advice — "Instagram prints this literally" explains why the bold they
 * asked for is not on screen.
 *
 * `charLimit` is the number the destination itself enforces, and it has to be
 * the SAME number the server renderer budgets against: `rich_content.py`'s
 * `DESTINATIONS` is the other copy. WhatsApp said 1,000 here against the Cloud
 * API's — and `DESTINATIONS["whatsapp"].limit`'s — 4,096, so a 1,400-character
 * broadcast that is legal, sendable and inside the server's own budget was
 * shown to the customer as 400 characters over a hard limit, in red. That is
 * the split this file's header says it exists to prevent, re-opened across the
 * frontend/backend boundary instead of within one file; the numbers below are
 * `DESTINATIONS`'s.
 *
 * `measure` is how the destination COUNTS those characters, which is not
 * `String.length` anywhere and is not the same rule everywhere — see
 * `countText`.
 */
export const PLATFORM_RENDERING = {
  Instagram: {
    shape: 'plain',
    charLimit: 2200,
    note: 'Instagram captions print every character literally — no bold, no italic, and no clickable link.',
    hint: 'An image is required. Captions cannot carry a clickable link — use “link in bio”. Five to fifteen hashtags is the useful range.',
  },
  LinkedIn: {
    shape: 'unicode',
    charLimit: 3000,
    note: 'LinkedIn has no formatting controls, so bold and italic are substituted Unicode characters. They paste correctly and read correctly, but a screen reader announces them letter by letter.',
    hint: 'A professional register reads best. Tag companies with @. Long-form articles reach further than plain text.',
  },
  WhatsApp: {
    shape: 'whatsapp',
    charLimit: 4096,
    note: 'WhatsApp has its own markup, not markdown: bold is one asterisk, italic is an underscore.',
    hint: 'Short and conversational — the cap is 4,096 characters but a broadcast that reads well is far shorter. A broadcast list holds up to 256 contacts.',
  },
  Facebook: {
    shape: 'plain',
    charLimit: 63206,
    note: 'Facebook prints the caption literally. Links are unfurled into a preview card rather than styled.',
    hint: 'Images and video lift engagement. Links get an automatic preview, so you rarely need to describe them.',
  },
  'Twitter / X': {
    shape: 'plain',
    charLimit: 280,
    measure: 'weighted',
    note: 'X prints the post literally, and the 280 below counts the whole thing — with emoji and most non-Latin characters counting double, as X counts them.',
    hint: 'One tweet is 280 characters. Use a thread for anything longer; one or two hashtags is plenty.',
  },
  Email: {
    shape: 'rich',
    charLimit: null,
    note: 'An email body is HTML, so headings, bold and live links survive the paste.',
    hint: 'The subject line does most of the work — keep it under about 50 characters. The first line shows as preview text in the inbox.',
  },
  'Google Ads': {
    shape: 'plain',
    charLimit: null,
    note: 'The Ads editor takes plain text only. Headlines are capped at 30 characters and descriptions at 90, per field.',
    hint: 'Headlines are capped at 30 characters and descriptions at 90. Include the keyword and one clear action.',
  },
  Website: {
    shape: 'rich',
    charLimit: null,
    note: 'A page body is HTML, so the headings and lists below are what publishes.',
    hint: 'Write for search as well as for people: a meta description around 155 characters, and real headings for structure.',
  },
};

export const PLATFORMS = Object.keys(PLATFORM_RENDERING);

/** The `{ hint, charLimit }` shape the Generate form has always read. */
export const PLATFORM_HINTS = Object.fromEntries(
  Object.entries(PLATFORM_RENDERING).map(([k, v]) => [k, { hint: v.hint, charLimit: v.charLimit }]),
);

/* ── Counting characters, which is not counting `.length` ───────────────────
 *
 * `String.length` is UTF-16 code units. Every character the LinkedIn shape
 * substitutes is a Mathematical Alphanumeric Symbol outside the BMP and so
 * costs TWO of them — `'𝗗𝗶𝘄𝗮𝗹𝗶'.length` is 12 for the six letters a reader sees.
 * A 2,900-character LinkedIn post with 150 bolded characters therefore reported
 * 3,050 and turned red, over a cap nothing was going to enforce, on a screen
 * whose own stylesheet says the red means "the platform will truncate this".
 * Emoji are the same trap in the other direction and this product's copy is
 * full of them.
 *
 * So the default unit is the CODE POINT, and X is measured X's way: its
 * published weighting counts one for the ranges below and two for everything
 * else, which is what makes an emoji cost two characters of a tweet and a
 * Devanagari letter cost one.
 */
const X_LIGHT = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];

/** How many characters `text` costs at `measure` — 'weighted' is X's rule. */
export function countText(text, measure) {
  let n = 0;
  for (const ch of String(text ?? '')) {
    if (measure !== 'weighted') { n += 1; continue; }
    const cp = ch.codePointAt(0);
    n += X_LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
  }
  return n;
}

/**
 * The spellings a caller may be holding that are not the label above.
 *
 * The server's destination keys are its own — `rich_content.DESTINATIONS` names
 * the tightest platform exactly `"x"` — and the normalise-and-compare below
 * cannot reach that from `Twitter / X` (`x` against `twitterx`). Left unmapped,
 * the day the server starts serving `formatted` its 280-character fitted tweet
 * would be dropped on the floor and the chip would silently fall back to the
 * browser's shape, which applies no character budget at all, while every chip
 * beside it correctly said `server`.
 *
 * Only the spellings that name a destination this screen HAS a chip for are
 * here. `google_business`, `telegram`, `reddit`, `threads` and `markdown` are
 * real server destinations with no row above, and resolving to null is the
 * right answer for them — `variantsFor` drops what it cannot label rather than
 * putting an unexplained chip on the screen.
 */
const KEY_ALIASES = {
  x: 'Twitter / X',
  twitter: 'Twitter / X',
  xtwitter: 'Twitter / X',
  wa: 'WhatsApp',
  whatsappbusiness: 'WhatsApp',
  ig: 'Instagram',
  fb: 'Facebook',
  linkedin: 'LinkedIn',
  googleads: 'Google Ads',
};

/**
 * A stored `platform` column back to a key of the table above.
 *
 * Two routes write this column and they disagree about case: `/org/quick-generate`
 * stores the label the form sent (`Instagram`), `/org/generate` stores whatever
 * the caller passed, and the seeded rows carry `instagram`. A preview that
 * matched on the exact string silently fell back to plain for every lowercase
 * row — which is the one platform state that must never be guessed, because
 * plain is also a legitimate answer and nothing on screen would look wrong.
 */
export function platformKey(raw) {
  if (!raw) return null;
  const want = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  return KEY_ALIASES[want]
    || PLATFORMS.find(p => p.toLowerCase().replace(/[^a-z]/g, '') === want)
    || null;
}

/* ── Inline marks ──────────────────────────────────────────────────────────
 *
 * Ordered longest-first so `***x***` is not eaten by the `**x**` branch, and
 * `~~x~~` not by a stray `~`. Every alternative forbids a newline inside it:
 * an unclosed `**` at the end of a truncated generation would otherwise run to
 * the far end of the post and bold half of it.
 */
const INLINE = /(`[^`\n]+`)|(!?\[[^\]\n]*\]\([^)\s]*\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)/g;

const LINK = /^(!?)\[([^\]]*)\]\(([^)\s]*)\)$/;

/**
 * Whether an italic run may be substituted at all.
 *
 * Unicode's sans-serif block has bold digits and no italic ones, so `*20 August*`
 * comes out as an upright "20" beside a slanted "August" — which reads as a font
 * fault rather than as emphasis, and the runs it catches are dates, amounts and
 * section numbers, the part of a compliance post a reader most needs to be able
 * to copy. `rich_content._emphasise` decided that a run like this drops to bold
 * if both were asked for and to plain otherwise, and this screen is labelled
 * "as each platform will print it" — so the rule is the SERVER'S, restated here
 * rather than invented. Two different answers for `*20 August*` would mean the
 * screen showed one string and the post carried another.
 *
 * `\p{Nd}` rather than `\d`, because Python's `str.isdigit()` on the other side
 * is not ASCII-only either.
 */
const hasDigit = body => /\p{Nd}/u.test(body);

function inlineToText(text, shape) {
  return String(text ?? '').replace(INLINE, tok => {
    if (tok.startsWith('`')) return tok.slice(1, -1);
    const link = tok.match(LINK);
    if (link) {
      const [, bang, label, url] = link;
      // An image has no text form. Its alt text is the only part that carries
      // meaning into a caption box, and a bare URL there is noise.
      if (bang) return label;
      if (!label) return url;
      return url && url !== label ? `${label} (${url})` : label;
    }
    if (tok.startsWith('***')) {
      const body = tok.slice(3, -3);
      if (shape === 'whatsapp') return `_*${body}*_`;
      if (shape === 'unicode') return hasDigit(body) ? unicodeBold(body) : unicodeBoldItalic(body);
      return body;
    }
    if (tok.startsWith('**')) {
      const body = tok.slice(2, -2);
      if (shape === 'whatsapp') return `*${body}*`;
      if (shape === 'unicode') return unicodeBold(body);
      return body;
    }
    if (tok.startsWith('~~')) {
      const body = tok.slice(2, -2);
      return shape === 'whatsapp' ? `~${body}~` : body;
    }
    const body = tok.slice(1, -1);
    if (shape === 'whatsapp') return `_${body}_`;
    if (shape === 'unicode') return hasDigit(body) ? body : unicodeItalic(body);
    return body;
  });
}

/**
 * Markdown as one destination's plain text.
 *
 * Line-based, and the list marker is stripped BEFORE the inline pass runs. That
 * ordering is the whole reason this is not a pile of `.replace()` calls: a
 * bullet written `* Books closed by the 20th` is one asterisk at the start of a
 * line, and any inline italic rule applied to the raw line has to guess whether
 * it opens emphasis. Removing the marker first means the guess never happens.
 */
function toShape(md, shape) {
  const out = String(md ?? '').split('\n').map(raw => {
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return '';

    const heading = raw.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      const body = inlineToText(heading[1], shape);
      if (shape === 'whatsapp') return `*${body}*`;
      if (shape === 'unicode') return unicodeBold(body);
      return body;
    }

    const quote = raw.match(/^\s*>\s?(.*)$/);
    // WhatsApp renders `> ` as a quote block; nowhere else does, and a stray
    // angle bracket at the head of a caption reads as a typo.
    if (quote) return `${shape === 'whatsapp' ? '> ' : ''}${inlineToText(quote[1], shape)}`;

    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) return `${bullet[1]}• ${inlineToText(bullet[2], shape)}`;

    const numbered = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numbered) return `${numbered[1]}${numbered[2]}. ${inlineToText(numbered[3], shape)}`;

    return inlineToText(raw, shape);
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Markdown stripped to clean prose — for a destination that renders nothing. */
export const toPlain = md => toShape(md, 'plain');

/** WhatsApp's own markup, where bold is one asterisk and italic an underscore. */
export const toWhatsApp = md => toShape(md, 'whatsapp');

/** LinkedIn: no markup, emphasis substituted character by character. */
export const toUnicode = md => toShape(md, 'unicode');

/**
 * The text a given platform receives.
 *
 * `rich` destinations still get a text flavour, because the clipboard always
 * carries `text/plain` beside the HTML and a terminal or a plain-text editor
 * takes that half.
 */
export function formatFor(platform, md) {
  const shape = PLATFORM_RENDERING[platform]?.shape || 'plain';
  return toShape(md, shape === 'rich' ? 'plain' : shape);
}

/**
 * The hashtag block the publish path appends, reproduced rather than described.
 *
 * `social_publisher.publish_content` builds the wire text as
 * `body + "\n\n" + " ".join(f"#{h}" for h in hashtags)`, and `hashtags` is what
 * `re.findall(r'#\w+', text)` pulled OUT of that same body — so the tags are
 * stored with their hash already on them and the sender adds a second one. The
 * post that lands carries the tags twice, the second time as `##GST`.
 *
 * That is a defect in the sender, not a fact about any platform, and it is not
 * this file's to fix. It IS this file's job not to hide it: the preview is the
 * one screen a reviewer approves from, so it shows what the sender builds. When
 * that line is corrected, this one is corrected with it — which is why the
 * shape is here, named, instead of inlined at the call site.
 */
export function tagBlock(tags) {
  const list = (Array.isArray(tags) ? tags : [])
    .map(t => String(t ?? '').trim())
    .filter(Boolean);
  return list.length ? list.map(t => `#${t}`).join(' ') : '';
}

/**
 * The variants to offer, server-first.
 *
 * A per-platform formatter belongs on the server: it is the same answer for the
 * same post on every device, and the sending paths (WhatsApp Cloud API, the
 * publish queue) have to agree with what this screen promised. Until that route
 * exists the shapes above are computed here and the preview SAYS SO — an
 * unlabelled local guess that later disagrees with what was actually sent is a
 * support ticket nobody can reconstruct.
 *
 * `served` is whatever the generate/content response carried under `formatted`:
 * a `{ platform: text }` map. Unknown platform names in it are ignored rather
 * than shown, so a server that grows a ninth platform cannot put an unlabelled
 * chip on an old screen.
 *
 * `tags` are the row's stored hashtags, and they are appended in exactly the two
 * cases the sender appends them:
 *
 *   · to a LOCAL shape only. A server that formats a post is formatting the
 *     whole post, and adding the block on top of its answer would be this
 *     screen inventing text the sender never wrote — the failure the `source`
 *     label exists to make impossible.
 *   · to a SOCIAL destination only. `publish_content` reaches a platform
 *     through `hub_social_accounts`; the two `rich` rows here are an email body
 *     and a page body, which no publish queue posts, so a tag block on either
 *     would be a promise about a path that does not exist.
 */
export function variantsFor(md, served, tags) {
  const map = served && typeof served === 'object' ? served : null;
  const block = tagBlock(tags);
  return PLATFORMS.map(platform => {
    const row = PLATFORM_RENDERING[platform];
    const key = map ? Object.keys(map).find(k => platformKey(k) === platform) : null;
    const fromServer = key ? map[key] : null;
    const local = formatFor(platform, md);
    const withTags = block && row.shape !== 'rich' ? `${local}\n\n${block}` : local;
    return {
      platform,
      text: typeof fromServer === 'string' ? fromServer : withTags,
      source: typeof fromServer === 'string' ? 'server' : 'local',
      ...row,
    };
  });
}
