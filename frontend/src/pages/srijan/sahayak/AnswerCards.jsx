/**
 * The answer cards — the reply, colour-coded by where each part of it came from.
 *
 * `docs/proposals/19-sahayak-final.html` puts three of them inside one bot
 * reply: a fact from the org's own files, a fact from the web, and something
 * the assistant noticed that was not asked about. Its own closing note names the
 * dependency:
 *
 *     "the three answer cards need the model to return structured sections
 *      rather than one block of prose. That is a backend change — a response
 *      schema plus a prompt that asks for it — not styling. If you want to ship
 *      sooner, the same layout renders a single card and upgrades later without
 *      touching anything else."
 *
 * ── ONE CARD SHIPS. The other two are already renderable. ────────────────────
 *
 * `services/ai_router.generate` returns `{text, model, cost_usd, …}` and
 * `routers/hub_chat.py` stores that text whole. Nothing in the chain asks the
 * model for sections and nothing parses them out, so a second card today would
 * be a card this product invented — a heading over a slice of prose, asserting
 * a provenance nobody established. That is the opposite of what the cards are
 * for.
 *
 * So `toCards` reads `message.sections` FIRST and falls back to one card built
 * from the whole reply. The day the response schema lands, the array arrives,
 * this function returns three descriptors instead of one, and nothing below it
 * changes — the renderer has never known how many there were. That is the whole
 * of the upgrade: no rewrite, no new component, no new CSS.
 *
 * The single card is not neutral by default either. It is coloured by what
 * actually grounded it — `provenanceOf` reads the sources the server attached —
 * so a reply drawn from the org's knowledge base already reads as one, and a
 * reply the model produced unaided does not pretend to.
 */
import React from 'react';
import { provenanceOf } from './sources';

/**
 * The four card kinds. `notice` is unreachable until the model returns
 * sections; it is declared now because adding a kind must be one entry here and
 * one line of CSS, and because leaving it out is how the upgrade turns into a
 * rewrite.
 *
 * The tones live in `sahayak.css` as `--mc` per `data-kind` — they are the
 * module palette, and the file records the ten-literal check that proved the
 * proposal's five accents ARE that palette.
 */
export const KIND = {
  files: { label: 'From your files', hi: 'आपकी फ़ाइलों से' },
  web: { label: 'From the web', hi: 'वेब से' },
  notice: { label: 'Worth knowing', hi: 'ध्यान देने योग्य' },
  answer: { label: 'Answer', hi: 'उत्तर' },
};

/* The glyphs. Drawn rather than typed: the proposal uses 📁 🌐 💡 because it is
   a specimen, and an emoji renders as a different picture on every platform and
   as a black-and-white outline on several — beside 29 hand-drawn nav icons that
   is the difference the owner called cheap. Same geometry as
   `layout/navIcons.jsx`: 16-unit box, currentColor, 1.4 stroke, no fill. */
const GLYPH = {
  files: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 5l1.5-2H7l1.5 2H14v8H2V5z" />
    </svg>
  ),
  web: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2C6.2 4 6.2 12 8 14" />
    </svg>
  ),
  notice: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M6 12.5h4M6.5 14h3" />
      <path d="M8 1.8a4.2 4.2 0 00-2.5 7.6c.4.3.6.7.6 1.1h3.8c0-.4.2-.8.6-1.1A4.2 4.2 0 008 1.8z" />
    </svg>
  ),
  answer: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M8 1.5l1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7L8 1.5z" />
    </svg>
  ),
};

/**
 * A reply → the cards to draw for it.
 *
 * `message.sections` is the forward contract, and it is deliberately loose:
 * `{ kind, title, body, meta }`, with an unrecognised `kind` falling back to
 * `answer` rather than rendering a card with no colour. A model that starts
 * returning sections with a kind we have not seen yet degrades to a readable
 * card instead of an unstyled one.
 */
export function toCards(message) {
  const sections = Array.isArray(message?.sections) ? message.sections : null;

  if (sections && sections.length) {
    return sections
      .map((s, i) => ({
        key: `sec${i}`,
        kind: KIND[s?.kind] ? s.kind : 'answer',
        title: String(s?.title ?? '').trim(),
        body: String(s?.body ?? s?.text ?? ''),
        meta: String(s?.meta ?? '').trim(),
      }))
      .filter(c => c.body.trim() || c.title);
  }

  return [{
    key: 'whole',
    kind: provenanceOf(message?.sources),
    title: '',
    body: String(message?.content ?? ''),
    meta: metaOf(message),
  }];
}

/**
 * The right-hand line of the card header: which model answered, and what the
 * org was charged for it.
 *
 * Both are facts the server already returns and neither was ever shown. The
 * credit figure especially: `hub_chat.py` charges `channel/chatbot_message` per
 * answer, and a customer who cannot see that a reply cost them anything finds
 * out from the wallet a week later.
 */
function metaOf(message) {
  const bits = [];
  const model = String(message?.model ?? '').trim();
  if (model) bits.push(model);
  const credits = Number(message?.credits);
  if (Number.isFinite(credits) && credits > 0) {
    bits.push(`${credits} credit${credits === 1 ? '' : 's'}`);
  }
  return bits.join(' · ');
}

/**
 * The body, with `[1]` as a control rather than as punctuation.
 *
 * This does NOT extend `Markdown` in `srijan/_shared`, and the reason is not
 * tidiness. That component also renders generated marketing copy on the Content
 * and Generate tabs, where `[1]` is literal text in a blog post — turning it
 * into a button there would be a defect in two tabs to fix a feature in one.
 * The block grammar is the same one, deliberately, so the two read alike.
 *
 * Text is rendered as ELEMENTS, never as HTML. Model output is untrusted and
 * `_shared` records what the previous implementation cost: a hand-rolled
 * escaper behind `dangerouslySetInnerHTML`, which is stored XSS with an AI
 * writing the payload. React escapes text content by construction.
 */
function inline(text, onCite, citable) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[\d+\])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${m.index}`;
    if (tok.startsWith('**')) {
      out.push(<b key={key}>{tok.slice(2, -2)}</b>);
    } else if (tok.startsWith('`')) {
      out.push(<code className="hb-code" key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const n = Number(tok.slice(1, -1));
      // A marker with no source behind it stays as text. hub_chat.py strips
      // invalid refs before storing, but only from the message it is storing —
      // every answer written before that guard existed is still in the table,
      // and a button that opens a panel with nothing highlighted is worse than
      // the bracket it replaced.
      if (citable.has(n)) {
        out.push(
          <button
            type="button"
            key={key}
            className="sh-cite"
            onClick={() => onCite(n)}
            aria-label={`Source ${n}`}
          >
            {n}
          </button>,
        );
      } else {
        out.push(tok);
      }
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CardBody({ text, onCite, citable }) {
  if (!text) return null;
  return (
    <div className="sr-md">
      {String(text).split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 className="sr-md__h4" key={i}>{inline(line.slice(4), onCite, citable)}</h4>;
        if (line.startsWith('## ')) return <h3 className="sr-md__h3" key={i}>{inline(line.slice(3), onCite, citable)}</h3>;
        if (line.startsWith('# ')) return <h2 className="sr-md__h2" key={i}>{inline(line.slice(2), onCite, citable)}</h2>;
        if (line.startsWith('---')) return <hr className="sr-md__hr" key={i} />;
        if (/^[-*]\s/.test(line)) {
          return (
            <div className="sr-md__li" key={i}>
              <span className="sr-md__b" aria-hidden="true">&bull;</span>
              <span>{inline(line.slice(2), onCite, citable)}</span>
            </div>
          );
        }
        const num = line.match(/^(\d+)\.\s/);
        if (num) {
          return (
            <div className="sr-md__li" key={i}>
              <span className="sr-md__b sr-md__b--n">{num[1]}.</span>
              <span>{inline(line.replace(/^\d+\.\s/, ''), onCite, citable)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div className="sr-md__gap" key={i} />;
        return <p className="sr-md__p" key={i}>{inline(line, onCite, citable)}</p>;
      })}
    </div>
  );
}

export default function AnswerCards({ message, onCite }) {
  const cards = toCards(message);
  // Only a numbered knowledge-base source can be cited inline. See sources.js.
  const citable = new Set(
    (message?.sources || []).filter(s => s.ref != null).map(s => s.ref),
  );

  return (
    <>
      {cards.map((c) => {
        const kind = KIND[c.kind] || KIND.answer;
        return (
          <article className="sh-ac" data-kind={c.kind} key={c.key}>
            <header className="sh-ac__h">
              <span className="sh-ac__i">{GLYPH[c.kind] || GLYPH.answer}</span>
              <span className="sh-ac__t">
                {kind.label}
                {' '}
                <span className="sh-hi" lang="hi">{kind.hi}</span>
              </span>
              {c.meta && <span className="sh-ac__m">{c.meta}</span>}
            </header>
            <div className="sh-ac__b">
              {c.title && <h4 className="sh-ac__ttl">{c.title}</h4>}
              <CardBody text={c.body} onCite={onCite} citable={citable} />
            </div>
          </article>
        );
      })}
    </>
  );
}
