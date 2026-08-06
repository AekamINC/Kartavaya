/**
 * The reply, drawn the way the prototype draws it.
 *
 * `design-reference/Kartavaya Redesign/sahayak.css` has no answer CARD. It has
 * `.sh__work` (the named steps), `.sh__figs` (attributable figures), `.sh__p`
 * (a bordered prose block on the patterned ground, with `<cite>` as a control)
 * and `.sh-none` (the block that says what was NOT answered). The provenance-
 * coloured `.sh-ac` family that the previous build shipped is not in the
 * prototype and is not rendered here.
 *
 * ── What the server actually returns, and what is therefore drawn ───────────
 *
 * CORRECTED 2026-08-06. This header used to say that `work`, `figs` and
 * `refusal` were "fields nothing sets today", and it was right when it was
 * written: the only send route was `POST /v1/hub/chat/sessions/{id}/send`, which
 * returns `{message, sources, model, cost_usd, credits_charged}` and nothing
 * else. `SahayakTab` now posts to `POST /v1/hub/chat`, which returns every key
 * unconditionally (`hub._sahayak_payload`) — `work`, `figs`, `evidence`,
 * `refusal`, `refusal_detail`, `read`, `answered`, `credits` — so the work
 * steps, the figures and the refusal block all render from a live response.
 *
 * `GET …/messages` still returns `{id, role, content, sources, model_used,
 * created_at}` and no structure, because migration 119 (which adds
 * `hub_chat_messages.answer`) is DELIBERATELY UNAPPLIED: one staging schema and
 * production writes to it. So a RELOADED conversation renders the prose and
 * drops the steps, and that is the state to design against, not a bug to
 * paper over. Each field falls back to null rather than to `[]`.
 *
 * `.sh__acts` is still not wired: a suggested-action button that cannot act is
 * worse than no button, and no endpoint answers for one.
 *
 * ── When there is no refusal to print ───────────────────────────────────────
 *
 * `.sh-none` in the prototype is "what it would not tell you". `message.refusal`
 * is read first and is the real block. When the server sent none, the fallback
 * states the one fact 29 §2 rule 1 can be supported by — whether `sources` came
 * back empty — and claims nothing further.
 *
 * Text is rendered as ELEMENTS, never as HTML. Model output is untrusted, and
 * the implementation before this one was a hand-rolled escaper behind
 * `dangerouslySetInnerHTML` — stored XSS with an AI writing the payload. React
 * escapes text content by construction.
 */
import React from 'react';

/**
 * A reply → the prose blocks to draw for it.
 *
 * `message.sections` is the forward contract kept from the previous build:
 * `{title, body, work, figs}`. Without it the reply is split on blank lines,
 * which is what the prototype draws — one bordered block per paragraph, because
 * each one sits on the patterned ground and needs a real edge or the motif reads
 * through it as noise.
 */
export function blocksOf(message) {
  const sections = Array.isArray(message?.sections) ? message.sections : null;
  if (sections && sections.length) {
    return sections
      .map((s, i) => ({
        key: `sec${i}`,
        title: String(s?.title ?? '').trim(),
        body: String(s?.body ?? s?.text ?? '').trim(),
        work: Array.isArray(s?.work) ? s.work : null,
        figs: Array.isArray(s?.figs) ? s.figs : null,
      }))
      .filter(b => b.body || b.title || b.work?.length || b.figs?.length);
  }

  return String(message?.content ?? '')
    .split(/\n[ \t]*\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map((body, i) => ({ key: `b${i}`, title: '', body, work: null, figs: null }));
}

/**
 * The model that answered and what the org was charged for it — both facts the
 * server already returns and neither of which was ever shown. `credits_charged`
 * especially: hub_chat.py charges `channel/chatbot_message` per answer, and a
 * customer who cannot see that a reply cost them anything finds out from the
 * wallet a week later.
 *
 * 29 §8: never print a figure the server did not return. Nothing is estimated
 * here — an absent field produces an absent segment, not a zero.
 */
export function costLine(message) {
  const bits = [];
  const model = String(message?.model ?? '').trim();
  if (model) bits.push(model);
  const credits = Number(message?.credits);
  if (Number.isFinite(credits) && credits > 0) {
    bits.push(`${credits} credit${credits === 1 ? '' : 's'}`);
  }
  const n = (message?.sources || []).length;
  if (n) bits.push(`${n} record${n === 1 ? '' : 's'} read`);
  return bits.join(' · ');
}

/**
 * `[1]` as a control rather than as punctuation.
 *
 * The prototype styles the marker as `.sh__p cite`, so the element is a real
 * `<cite>`. A `<cite>` is not focusable and takes no click semantics on its own,
 * and the whole point of the marker is that clicking it opens the record — so it
 * carries the ARIA button pattern in full: role, tabindex, and Enter/Space, not
 * just an onClick that a keyboard cannot reach.
 */
function citeEl(n, { onCite, hot, title }) {
  const go = () => onCite(n);
  return (
    <cite
      key={`c${n}`}
      className={n === hot ? 'on' : undefined}
      role="button"
      tabIndex={0}
      title={title || undefined}
      aria-label={`Source ${n}`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      }}
    >
      {n}
    </cite>
  );
}

/**
 * Inline grammar. Deliberately NOT the shared `Markdown` in `sahayak/_shared`:
 * that component also renders generated marketing copy on the Content and
 * Generate tabs, where `[1]` is literal text in a blog post, and turning it into
 * a control there would be a defect in two tabs to fix a feature in one.
 */
function inline(text, ctx) {
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
      // and a control that opens a panel with nothing highlighted is worse than
      // the bracket it replaced.
      if (ctx.citable.has(n)) {
        // The document or route the marker points at, so hovering a cite says
        // where it goes before it is clicked.
        out.push(citeEl(n, { ...ctx, title: ctx.titleFor?.get(n) }));
      }
      else out.push(tok);
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The block grammar, shared with `sr-md` so a reply reads like the rest of the
 *  product's generated text. The wrapper is `.sh__p`, which carries the size,
 *  the leading, the edge and the lift. */
function lines(text, ctx) {
  return String(text).split('\n').map((line, i) => {
    if (line.startsWith('### ')) return <h4 className="sr-md__h4" key={i}>{inline(line.slice(4), ctx)}</h4>;
    if (line.startsWith('## ')) return <h3 className="sr-md__h3" key={i}>{inline(line.slice(3), ctx)}</h3>;
    if (line.startsWith('# ')) return <h2 className="sr-md__h2" key={i}>{inline(line.slice(2), ctx)}</h2>;
    if (line.startsWith('---')) return <hr className="sr-md__hr" key={i} />;
    if (/^[-*]\s/.test(line)) {
      return (
        <div className="sr-md__li" key={i}>
          <span className="sr-md__b" aria-hidden="true">&bull;</span>
          <span>{inline(line.slice(2), ctx)}</span>
        </div>
      );
    }
    const num = line.match(/^(\d+)\.\s/);
    if (num) {
      return (
        <div className="sr-md__li" key={i}>
          <span className="sr-md__b sr-md__b--n">{num[1]}.</span>
          <span>{inline(line.replace(/^\d+\.\s/, ''), ctx)}</span>
        </div>
      );
    }
    if (!line.trim()) return null;
    return <p className="sr-md__p" key={i}>{inline(line, ctx)}</p>;
  }).filter(Boolean);
}

/** The named work steps. 29 §2 rule 4: a spinner over a data question tells the
 *  reader nothing about what is being read on their behalf. Renders only from a
 *  list the server sent. */
function Work({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="sh__work">
      {rows.map((r, i) => (
        <div className={`sh__work-r ${r?.state === 'done' || r?.state === 'now' || r?.state === 'wait' ? r.state : 'done'}`} key={i}>
          <i aria-hidden="true" />
          {String(r?.label ?? '')}
          {r?.fn ? <code>{String(r.fn)}</code> : null}
        </div>
      ))}
    </div>
  );
}

/** A figure the assistant states must be attributable and copyable — 29 §3.
 *  `title` carries the route it came from; a figure with no `src` is dropped
 *  rather than shown, because a number with no provenance is the one thing
 *  worse than not answering. */
function Figs({ figs }) {
  const usable = (figs || []).filter(f => f && f.value != null && f.src);
  if (!usable.length) return null;
  return (
    <div className="sh__figs">
      {usable.map((f, i) => (
        <div className="sh__fig" key={i} title={String(f.src)}>
          <span className="sh__fig-l">{String(f.label ?? '')}</span>
          <span className="sh__fig-v">{String(f.value)}</span>
          {f.sub ? <span className="sh__fig-s">{String(f.sub)}</span> : null}
        </div>
      ))}
    </div>
  );
}

export default function AnswerBody({ message, onCite, hot }) {
  const sources = message?.sources || [];
  // Only a numbered knowledge-base source can be cited inline — a web page was
  // never numbered into the prompt, so no `[n]` points at one. See sources.js.
  const citable = new Set(sources.filter(s => s.ref != null).map(s => s.ref));
  const titleFor = new Map(sources.filter(s => s.ref != null).map(s => [s.ref, s.title]));
  const ctx = { citable, titleFor, hot, onCite };

  const blocks = blocksOf(message);
  const cost = costLine(message);
  const refusal = String(message?.refusal ?? '').trim();

  return (
    <>
      <Work rows={message?.work} />
      {blocks.map((b) => (
        <React.Fragment key={b.key}>
          <Work rows={b.work} />
          <Figs figs={b.figs} />
          {(b.title || b.body) && (
            <div className="sh__p">
              {b.title ? <h4 className="sr-md__h4">{b.title}</h4> : null}
              {lines(b.body, ctx)}
            </div>
          )}
        </React.Fragment>
      ))}
      <Figs figs={message?.figs} />

      {refusal ? (
        <div className="sh-none">
          <b>What it would not tell you</b>
          <p>{refusal}</p>
        </div>
      ) : sources.length === 0 ? (
        /* Not a refusal — a statement of fact about this reply, and the only
           part of 29 §2 rule 2 the current response schema can support. */
        <div className="sh-none">
          <b>Nothing was cited for this answer</b>
          <p>
            Sahayak attached no record to this reply, so there is nothing here to
            open and check. Read it as the model&rsquo;s own words rather than as
            something taken out of your books.
          </p>
        </div>
      ) : null}

      {cost ? <span className="sh__cost">{cost}</span> : null}
    </>
  );
}
