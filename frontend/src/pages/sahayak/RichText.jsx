// Generated copy, rendered as the document it is.
//
// The Content tab printed a whole post inside one pre-wrapped paragraph: every
// `##`, `**` and `- ` on screen as the literal characters the model typed. A
// generated blog post is headings, lists, emphasis and links; shown that way
// the reader cannot judge the structure they are about to publish, only the
// punctuation.
//
// ── Why this is elements and never an HTML string ───────────────────────────
//
// `_shared.Markdown`'s own header records what this replaced: an implementation
// that built an HTML string and set it with `dangerouslySetInnerHTML`, escaping
// by hand. Model output is untrusted text and the model is perfectly capable of
// writing `<img src=x onerror=…>` if a scraped page told it to — any gap in a
// hand-rolled escaper is stored XSS with an AI writing the payload. React
// escapes text children by construction, so returning elements removes the
// class of bug rather than patching it. Nothing in this file concatenates
// markup, and `href` is the one attribute that carries an outside value, which
// is why `safeHref` exists below.
//
// ── Why it is not `_shared.Markdown` ────────────────────────────────────────
//
// That renderer is the chat transcript's, shared with `assistant/AnswerBody`,
// and it makes every line its own `<p>` with a 2px margin — correct for a reply
// streaming in a column, wrong for a post whose stanzas are paragraphs. It also
// has no lists (a bullet is a `<div>` with a bullet glyph in it, which a screen
// reader announces as prose), no links, no quotes and no code blocks. This one
// emits real `<ul>`/`<ol>`/`<blockquote>`, because the reader here is checking
// document structure and so is anything the HTML is pasted into.
import React from 'react';

/**
 * The only attribute in this file that takes a value from the model.
 *
 * `javascript:`, `data:` and `vbscript:` are all live script in an `href`, and a
 * protocol-relative `//host/path` silently leaves the site. Anything that is not
 * plainly a web or mail address comes back null and the caller renders the label
 * as text — a dead link is a nuisance, a live one is a hole.
 */
export function safeHref(raw) {
  const s = String(raw ?? '').trim();
  // Whitespace and control characters go first: a scheme survives having them
  // spliced into it — the browser strips them before it parses — and no real
  // address here contains either.
  if (!s || /[\s\u0000-\u001f]/.test(s)) return null;
  if (/^https?:\/\/[^/]/i.test(s) || /^mailto:[^@\s]+@/i.test(s)) return s;
  if (/^www\.[^\s/]+\./i.test(s)) return `https://${s}`;
  return null;
}

/* Longest-first, exactly as in `./platformText` — `***x***` must not be eaten
 * by the `**x**` branch. Every alternative forbids a newline, so an unclosed
 * `**` at the end of a truncated generation cannot bold the rest of the post. */
const INLINE = new RegExp([
  '(`[^`\\n]+`)',
  '(!?\\[[^\\]\\n]*\\]\\([^)\\s]*\\))',
  '(\\*\\*\\*[^*\\n]+\\*\\*\\*)',
  '(\\*\\*[^*\\n]+\\*\\*)',
  '(~~[^~\\n]+~~)',
  '(\\*[^*\\n]+\\*)',
  '(https?://[^\\s<>]+)',
  '(#[\\p{L}\\p{N}_]+)',
].join('|'), 'gu');

const LINK = /^(!?)\[([^\]]*)\]\(([^)\s]*)\)$/;

/** A link, or — when the address is not one we will follow — its words. */
function Anchor({ href, children }) {
  const safe = safeHref(href);
  if (!safe) return <>{children}</>;
  return (
    <a className="sr-rt__a" href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** `**bold**`, `*italic*`, `~~struck~~`, links, bare URLs and #hashtags. */
function inline(text) {
  const src = String(text ?? '');
  const out = [];
  let last = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(src)) !== null) {
    const tok = m[0];
    const k = `i${m.index}`;

    // A `#` only opens a hashtag at the start of a word. Without this check
    // every `#` inside a URL fragment or an `RS#1200` reference became a tag,
    // which is a colour change on a piece of text that is not one.
    if (tok.startsWith('#') && m.index > 0 && !/\s/.test(src[m.index - 1])) continue;

    if (m.index > last) out.push(src.slice(last, m.index));
    last = m.index + tok.length;

    if (tok.startsWith('`')) {
      out.push(<code className="hb-code" key={k}>{tok.slice(1, -1)}</code>);
      continue;
    }
    const link = tok.match(LINK);
    if (link) {
      const [, bang, label, url] = link;
      // An image is not rendered from a model-supplied URL. The generated image
      // arrives as a signed R2 key on its own field; a `![…](…)` in the prose is
      // a remote fetch we did not ask for and a tracking pixel if the model was
      // led there.
      if (bang) { if (label) out.push(label); continue; }
      out.push(<Anchor key={k} href={url}>{label || url}</Anchor>);
      continue;
    }
    if (tok.startsWith('***')) {
      out.push(<strong key={k}><em>{tok.slice(3, -3)}</em></strong>);
      continue;
    }
    if (tok.startsWith('**')) { out.push(<strong key={k}>{tok.slice(2, -2)}</strong>); continue; }
    if (tok.startsWith('~~')) {
      out.push(<del className="sr-rt__del" key={k}>{tok.slice(2, -2)}</del>);
      continue;
    }
    if (tok.startsWith('#')) { out.push(<span className="sr-rt__tag" key={k}>{tok}</span>); continue; }
    if (/^https?:/i.test(tok)) {
      // Trailing punctuation belongs to the sentence, not to the address.
      const trimmed = tok.replace(/[.,;:!?)\]]+$/, '');
      out.push(<Anchor key={k} href={trimmed}>{trimmed}</Anchor>);
      if (trimmed.length < tok.length) out.push(tok.slice(trimmed.length));
      continue;
    }
    out.push(<em key={k}>{tok.slice(1, -1)}</em>);
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

/* ── Blocks ────────────────────────────────────────────────────────────────
 *
 * Line-based with run-collection: consecutive bullets are ONE list and
 * consecutive prose lines are ONE paragraph. Rendering a bullet per element and
 * a paragraph per line — which is what the chat renderer does — is what made a
 * six-item list read as six unrelated sentences to a screen reader.
 */

const FENCE = /^\s*```/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)(\d+)\.\s+(.*)$/;

/** Nested `<ul>`/`<ol>` from a flat run of `{ depth, text }`. */
function listOf(items, ordered, key) {
  const nodes = [];
  let i = 0;
  const base = items[0].depth;
  while (i < items.length) {
    const item = items[i];
    const kids = [];
    let j = i + 1;
    while (j < items.length && items[j].depth > base) { kids.push(items[j]); j += 1; }
    nodes.push(
      <li className="sr-rt__li" key={`${key}-${i}`}>
        {inline(item.text)}
        {kids.length > 0 && listOf(kids, ordered, `${key}-${i}s`)}
      </li>,
    );
    i = j;
  }
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag className={ordered ? 'sr-rt__ol' : 'sr-rt__ul'} key={key}>{nodes}</Tag>;
}

function render(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (FENCE.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      out.push(<pre className="sr-rt__pre" key={`c${i}`}><code>{body.join('\n')}</code></pre>);
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      const body = inline(h[2]);
      const level = h[1].length;
      // h2/h3/h4 and no deeper: this renders inside a card whose own title is an
      // h3, and a document that starts at h1 would outrank the page.
      if (level === 1) out.push(<h2 className="sr-md__h2" key={i}>{body}</h2>);
      else if (level === 2) out.push(<h3 className="sr-md__h3" key={i}>{body}</h3>);
      else out.push(<h4 className="sr-md__h4" key={i}>{body}</h4>);
      i += 1;
      continue;
    }

    if (RULE.test(line)) { out.push(<hr className="sr-md__hr" key={i} />); i += 1; continue; }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) { body.push(lines[i].match(QUOTE)[1]); i += 1; }
      out.push(
        <blockquote className="sr-rt__q" key={`q${i}`}>{inline(body.join(' '))}</blockquote>,
      );
      continue;
    }

    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line) && NUMBER.test(line);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? NUMBER : BULLET);
        if (!m) break;
        // Two spaces per level is the convention every generator emits; a tab
        // counts as one level too, so a model that indents with tabs does not
        // flatten the whole list.
        const indent = m[1].replace(/\t/g, '  ').length;
        items.push({ depth: Math.floor(indent / 2), text: ordered ? m[3] : m[2] });
        i += 1;
      }
      out.push(listOf(items, ordered, `l${i}`));
      continue;
    }

    if (!line.trim()) { i += 1; continue; }

    const para = [];
    while (
      i < lines.length && lines[i].trim()
      && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !RULE.test(lines[i])
      && !QUOTE.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i])
    ) { para.push(lines[i]); i += 1; }
    out.push(
      <p className="sr-rt__p" key={`p${i}`}>
        {para.map((l, n) => (
          <React.Fragment key={n}>
            {n > 0 && <br />}
            {inline(l)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return out;
}

/**
 * `.sr-md` carries the body type ramp the whole module already reads from;
 * `.sr-rt` adds the block rules a document needs and the chat column does not.
 */
export default function RichText({ text }) {
  if (!text || !String(text).trim()) return null;
  return <div className="sr-md sr-rt">{render(text)}</div>;
}
