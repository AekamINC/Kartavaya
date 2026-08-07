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
 * `.sh__acts` IS WIRED NOW, and the rule above still holds: a suggested-action
 * button that cannot act is worse than no button. Nothing in it suggests an
 * action. It carries the two controls that answer for something the server
 * already has — the evidence pane's own switch (the rows this answer was
 * computed from, which `POST /v1/hub/chat` returns) and the verdict buttons,
 * which post to `POST /v1/hub/skills/feedback` (`routers/hub.py:3865`). Each is
 * drawn only when the thing behind it exists: no evidence, no switch; no server
 * message id, no verdict. See `feedback.js` for why the id is checked first.
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
import { isServerAnswer } from './feedback';

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
 * The heading over `.sh-none`, which is the prototype's `none.t` — a title that
 * belongs to the turn rather than a fixed string.
 *
 * "What it would not tell you" is right for `partial` and for the three hard
 * refusals — `access`, `unavailable`, `generation_failed` — where the block
 * genuinely names something withheld, and those keep it. Their titles are
 * pinned by tests written against the prototype and are not re-litigated here.
 *
 * It is WRONG for `unrecognised`, added 2026-08-07: there the answer is complete
 * and the block's job is to say the prose above is general rather than a reading
 * of their books. Titling that "what it would not tell you" invites the reader
 * to think something was hidden from them — the second false impression in a row
 * on the exact reply this whole change exists to fix.
 *
 * Every other kind, including one this build has never heard of, falls back to
 * the original title. A new server-side kind must not be able to blank the
 * heading.
 */
export function noneTitle(message) {
  return String(message?.refusalDetail?.kind ?? '') === 'unrecognised'
    ? 'Nothing of yours was read for this'
    : 'What it would not tell you';
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

/**
 * The two thumbs, drawn to the same 16-unit geometry as `layout/navIcons.jsx`.
 *
 * One path, mirrored, rather than two hand-drawn glyphs — a down thumb that is
 * not the exact reflection of the up thumb reads as two different controls.
 * `scale(1,-1)` about the centre is the mirror; the transform is on the <g> so
 * the stroke geometry is identical in both.
 */
function Thumb({ down }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <g transform={down ? 'translate(0,16) scale(1,-1)' : undefined}>
        <path d="M4.5 14V7h1.9l2.2-4.6A1.4 1.4 0 0 1 11.2 3l-.5 3.1h2.6a1.2 1.2 0 0 1 1.2 1.4l-.8 4.6A1.9 1.9 0 0 1 11.8 14H4.5z" />
        <path d="M4.5 7H1.8v7h2.7" />
      </g>
    </svg>
  );
}

/**
 * `.sh__acts` — the row under a reply, and the two things in it that act.
 *
 * `verdict` is `'up' | 'down' | null` and is the SENT state, not the pressed
 * state: `SahayakTab` only records it once the endpoint answered 201, so a
 * failed post leaves the buttons unpressed rather than lying about what the
 * server holds. `aria-pressed` carries it for a reader who cannot see the fill.
 */
function Acts({ message, verdict, onFeedback, evidenceOpen, onEvidence, hasEvidence }) {
  const canRate = !!onFeedback && isServerAnswer(message?.id);
  if (!hasEvidence && !canRate) return null;
  return (
    <div className="sh__acts">
      {hasEvidence && (
        <button
          type="button"
          className="sh__act"
          aria-expanded={!!evidenceOpen}
          onClick={onEvidence}
        >
          {evidenceOpen ? 'Hide the rows behind it' : 'Show the rows behind it'}
        </button>
      )}
      {canRate && (
        <span className="sh__fb">
          <button
            type="button"
            className={verdict === 'up' ? 'on' : undefined}
            aria-pressed={verdict === 'up'}
            aria-label="This answer was right"
            title="This answer was right"
            onClick={() => onFeedback('up')}
          >
            <Thumb />
          </button>
          <button
            type="button"
            className={verdict === 'down' ? 'on' : undefined}
            aria-pressed={verdict === 'down'}
            aria-label="This answer was wrong"
            title="This answer was wrong"
            onClick={() => onFeedback('down')}
          >
            <Thumb down />
          </button>
        </span>
      )}
    </div>
  );
}

export default function AnswerBody({
  message, onCite, hot,
  verdict = null, onFeedback = null,
  evidenceOpen = false, onEvidence = null, hasEvidence = false,
}) {
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
          <b>{noneTitle(message)}</b>
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

      <Acts
        message={message}
        verdict={verdict}
        onFeedback={onFeedback}
        evidenceOpen={evidenceOpen}
        onEvidence={onEvidence}
        hasEvidence={hasEvidence}
      />

      {cost ? <span className="sh__cost">{cost}</span> : null}
    </>
  );
}
