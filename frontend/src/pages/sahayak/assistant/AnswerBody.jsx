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
 * The verdict itself, the one question a thumbs-down asks and the line that
 * says what the ledger actually holds are all `Verdict.jsx`. They are a sibling
 * file rather than three more functions here because this one already carries
 * the markdown grammar, and a reader looking for why a complaint is stored the
 * way it is should not have to read a table renderer to find it.
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
 *
 * ── The markdown the model actually emits ───────────────────────────────────
 *
 * The grammar below used to stop at headings, bullets, `**bold**` and inline
 * code, so a reply containing a table printed its pipes and a reply containing
 * a fenced block printed its backticks. Tables, fenced code and links are added
 * here rather than by reaching for a markdown library: every rule in this file
 * returns React elements, and a library that returns an HTML STRING would
 * reintroduce `dangerouslySetInnerHTML` on the one surface whose text is
 * written by a model. There is no markdown renderer in the lockfile, and the
 * safe way to add one is not to.
 *
 * Two shapes need a container of their own, and both for the same measured
 * reason: `.sh__p` sits in `.sh__wrap`, which is `width: min(760px, 100%)`, so
 * anything wider than its column widens the THREAD. A fenced block and a table
 * therefore scroll inside their own box and the page stays fluid.
 *
 * The table is `.sh-ev` — the one table this surface draws, already used by the
 * evidence pane. A second table style on the same screen is how a product ends
 * up with three of them.
 */
import React from 'react';
import { isServerAnswer } from './feedback';
import Verdict, { ReasonPanel } from './Verdict';
import { hostOf, safeUrl } from './sources';
// One rule for "this cell is a figure", shared with the evidence table rather
// than copied — two copies of a heuristic drift, and then one table
// right-aligns its numbers and the other does not.
import { isNum } from './SourcesPanel';

/** An opening or closing code fence: ``` or ~~~, optionally tagged with a
 *  language. Three or more, because a model that quotes a fence inside a fence
 *  opens the outer one with four. */
const FENCE = /^\s*(`{3,}|~{3,})\s*[^\s`]*\s*$/;

/**
 * The reply split into paragraphs — except inside a fence, where a blank line
 * is CONTENT.
 *
 * This was a plain `split(/\n\n+/)`, and a fenced block with a blank line in it
 * (a function with two paragraphs of body, the ordinary case) was torn into two
 * blocks: the opening fence in one, the closing fence in another, so neither
 * closed and both printed their backticks. The fence is tracked here for the
 * same reason it is tracked in `lines` — it is the one construct where a blank
 * line does not end anything.
 */
function paragraphsOf(text) {
  const out = [];
  let buf = [];
  let fence = '';
  const flush = () => {
    const s = buf.join('\n').trim();
    if (s) out.push(s);
    buf = [];
  };
  for (const line of String(text ?? '').split('\n')) {
    if (fence) {
      buf.push(line);
      if (line.trim().startsWith(fence)) fence = '';
      continue;
    }
    const m = line.match(FENCE);
    if (m) { fence = m[1]; buf.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

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

  return paragraphsOf(message?.content)
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
 * `[1]` as a control rather than as punctuation — and, when the source is a
 * page, as a real link to it.
 *
 * The prototype styles the marker as `.sh__p cite`, so the element is a real
 * `<cite>` in both shapes and the chip looks the same either way. What differs
 * is what is inside it, because the two sources are not the same promise:
 *
 *   a KB chunk  — there is nowhere on the web to send anyone. The `<cite>` is
 *                 the control, and it carries the ARIA button pattern in full:
 *                 role, tabindex and Enter/Space, not just an onClick a
 *                 keyboard cannot reach. It highlights the card in the panel.
 *   a web page  — there IS somewhere to go, so the marker is an `<a href>`:
 *                 middle-click, ctrl-click and copy-link-address all work, and
 *                 they are the reason this is an anchor rather than a button
 *                 with a navigation handler. Focus and Enter come from the
 *                 anchor itself, so the button pattern is NOT added on top —
 *                 two overlapping controls in one chip is one tab stop too many
 *                 and a role that contradicts the element.
 *
 * `rel="noopener noreferrer"` and the scheme check in `sources.safeUrl` are not
 * optional here: these URLs come from a search API by way of the model. A ref
 * with no safe URL behind it falls back to the button shape rather than
 * rendering an anchor that goes nowhere.
 */
function citeEl(n, { onCite, hot, title, href }) {
  const go = () => onCite(n);
  const cls = n === hot ? 'on' : undefined;

  if (href) {
    return (
      <cite key={`c${n}`} className={cls}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={title || undefined}
          aria-label={`Source ${n}`}
          // The chip's colour is the chip's, not the browser's default link
          // blue, and the underline would sit under a single digit.
          style={{ color: 'inherit', textDecoration: 'none' }}
          // Opening the page and marking the card it came from are both true of
          // the same click; the panel should not still be pointing somewhere
          // else when the reader comes back.
          onClick={go}
        >
          {n}
        </a>
      </cite>
    );
  }

  return (
    <cite
      key={`c${n}`}
      className={cls}
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
  // `[label](url)` is tried BEFORE `[n]`, so a numeric label that carries a
  // destination — `[1](https://…)`, which is what a model writes when it has
  // been given both a number and a URL — becomes the link it plainly is rather
  // than a marker with a stray `(https://…)` printed after it.
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]\n]+\]\([^()\s]+\)|\[\d+\])/g;
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
    } else if (tok.startsWith('[') && tok.includes('](')) {
      const cut = tok.lastIndexOf('](');
      const label = tok.slice(1, cut);
      const href = safeUrl(tok.slice(cut + 2, -1));
      // A scheme we will not open is not a link and must not look like one.
      // The label still reads, so the sentence survives the refusal.
      if (href) {
        out.push(
          <a className="k-link" key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>,
        );
      } else out.push(label);
    } else if (tok.startsWith('[')) {
      const n = Number(tok.slice(1, -1));
      // A marker with no source behind it stays as text. hub_chat.py strips
      // invalid refs before storing, but only from the message it is storing —
      // every answer written before that guard existed is still in the table,
      // and a control that opens a panel with nothing highlighted is worse than
      // the bracket it replaced.
      if (ctx.citable.has(n)) {
        // The document or route the marker points at, so hovering a cite says
        // where it goes before it is clicked, and the page it opens when the
        // source is one.
        out.push(citeEl(n, {
          ...ctx,
          title: ctx.titleFor?.get(n),
          href: ctx.hrefFor?.get(n),
        }));
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

/**
 * A fenced block, in a box that scrolls instead of one that stretches.
 *
 * `.sh__p` lives in `.sh__wrap`, which is `width: min(760px, 100%)`; a `<pre>`
 * with a 200-column line in it is wider than that and takes the whole thread
 * with it, on a surface whose every page is meant to be fluid. `overflow-x` on
 * the block itself is the containment — the code keeps its line breaks and the
 * column keeps its width.
 *
 * `.hb-code` is the product's existing code skin (mono, `--s-container`, the
 * small radius); only the box geometry a BLOCK needs is set here, since that
 * class was written for an inline span.
 */
function Code({ text }) {
  return (
    <pre
      className="hb-code"
      style={{
        display: 'block',
        margin: 'var(--sp-2) 0',
        padding: 'var(--sp-3)',
        maxWidth: '100%',
        overflowX: 'auto',
        whiteSpace: 'pre',
      }}
    >
      <code>{text}</code>
    </pre>
  );
}

/**
 * A markdown table, drawn as `.sh-ev` — the table the evidence pane already
 * draws, because this surface gets ONE table style.
 *
 * `.sh-ev th` and `.sh-ev td` are `white-space: nowrap`, which is right for
 * figures and is exactly why the same scroll box the code block needs goes
 * around this one too.
 */
function MdTable({ head, rows, ctx }) {
  return (
    <div style={{ margin: 'var(--sp-2) 0', maxWidth: '100%', overflowX: 'auto' }}>
      <table className="sh-ev">
        <thead>
          <tr>{head.map((c, i) => <th key={i} scope="col">{inline(c, ctx)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {head.map((_, ci) => (
                <td key={ci} className={isNum(r[ci]) ? 'num' : undefined}>
                  {inline(r[ci] ?? '', ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `| a | b |` → `['a', 'b']`. The outer pipes are optional in every dialect a
 *  model writes, so they are stripped rather than required. */
function cellsOf(line) {
  return String(line).trim().replace(/^\|/, '').replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());
}

/**
 * The `|---|:--:|` line under a header row, and the only thing that makes the
 * row above it a header rather than a sentence containing a pipe.
 *
 * A table is recognised from this line alone, never from the header — prose
 * with a pipe in it ("read Ganit | Invoices") must not become a one-cell table.
 * `includes('|')` is what keeps a bare `---`, which is the horizontal rule this
 * grammar has always drawn, out of the table branch.
 */
function isRuleRow(line) {
  return typeof line === 'string'
    && line.includes('|')
    && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
}

/** The block grammar, shared with `sr-md` so a reply reads like the rest of the
 *  product's generated text. The wrapper is `.sh__p`, which carries the size,
 *  the leading, the edge and the lift.
 *
 *  A walk rather than a `map`, because two constructs span more than one line:
 *  a fence runs to its closing fence and a table runs to its last row. */
function lines(text, ctx) {
  const src = String(text).split('\n');
  const out = [];
  let i = 0;

  while (i < src.length) {
    const line = src[i];

    const fence = line.match(FENCE);
    if (fence) {
      const mark = fence[1];
      const body = [];
      i += 1;
      while (i < src.length && !src[i].trim().startsWith(mark)) { body.push(src[i]); i += 1; }
      i += 1; // the closing fence — or, while an answer is still arriving, the end
      out.push(<Code key={`f${i}`} text={body.join('\n')} />);
      continue;
    }

    if (line.includes('|') && isRuleRow(src[i + 1])) {
      const head = cellsOf(line);
      const rows = [];
      i += 2;
      while (i < src.length && src[i].includes('|')) { rows.push(cellsOf(src[i])); i += 1; }
      out.push(<MdTable key={`t${i}`} head={head} rows={rows} ctx={ctx} />);
      continue;
    }

    // One to six hashes, not the three sizes the old chain spelled out: `####`
    // matched none of them and printed its own hashes. There are three heading
    // classes, so four and deeper share the smallest — a heading that is too
    // small is a heading; a line reading `#### Totals` is not.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const body = inline(h[2], ctx);
      if (h[1].length === 1) out.push(<h2 className="sr-md__h2" key={i}>{body}</h2>);
      else if (h[1].length === 2) out.push(<h3 className="sr-md__h3" key={i}>{body}</h3>);
      else out.push(<h4 className="sr-md__h4" key={i}>{body}</h4>);
      i += 1;
      continue;
    }

    if (line.startsWith('---')) { out.push(<hr className="sr-md__hr" key={i} />); i += 1; continue; }

    if (/^\s*[-*]\s/.test(line)) {
      out.push(
        <div className="sr-md__li" key={i}>
          <span className="sr-md__b" aria-hidden="true">&bull;</span>
          <span>{inline(line.replace(/^\s*[-*]\s/, ''), ctx)}</span>
        </div>,
      );
      i += 1;
      continue;
    }

    const num = line.match(/^\s*(\d+)\.\s/);
    if (num) {
      out.push(
        <div className="sr-md__li" key={i}>
          <span className="sr-md__b sr-md__b--n">{num[1]}.</span>
          <span>{inline(line.replace(/^\s*\d+\.\s/, ''), ctx)}</span>
        </div>,
      );
      i += 1;
      continue;
    }

    if (line.trim()) out.push(<p className="sr-md__p" key={i}>{inline(line, ctx)}</p>);
    i += 1;
  }

  return out;
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
 * `.sh__acts` — the row under a reply, and the things in it that act.
 *
 * `verdict` is `'up' | 'down' | null` and is the SENT state, not the pressed
 * state: `SahayakTab` only records it once the endpoint answered 201, so a
 * failed post leaves the buttons unpressed rather than lying about what the
 * server holds. `aria-pressed` carries it for a reader who cannot see the fill.
 *
 * The reason panel is a SIBLING of the row, not a child of it. `.sh__acts` is a
 * wrapping flex line of small controls; a block of question, five reasons and a
 * box is not one of those, and putting it in there would have it laid out as
 * one more pill. It is drawn immediately after the row, which is also what puts
 * the first reason one Tab away from the thumb that opened it.
 */
function Acts({
  message, verdict, verdictNote, verdictError, verdictBusy, asking,
  onFeedback, onExplain, onAsk,
  evidenceOpen, onEvidence, hasEvidence,
}) {
  const canRate = !!onFeedback && isServerAnswer(message?.id);
  if (!hasEvidence && !canRate) return null;
  return (
    <>
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
          <Verdict
            verdict={verdict}
            note={verdictNote}
            error={verdictError}
            busy={verdictBusy}
            asking={asking}
            onFeedback={onFeedback}
            onAsk={onAsk}
          />
        )}
      </div>
      {canRate && asking ? (
        <ReasonPanel
          note={verdictNote}
          error={verdictError}
          busy={verdictBusy}
          onExplain={onExplain}
          onCancel={() => onAsk(false)}
        />
      ) : null}
    </>
  );
}

export default function AnswerBody({
  message, onCite, hot,
  verdict = null, verdictNote = '', verdictError = '', verdictBusy = false,
  asking = false, onFeedback = null, onExplain = null, onAsk = null,
  evidenceOpen = false, onEvidence = null, hasEvidence = false,
}) {
  const sources = message?.sources || [];
  // Any source the server NUMBERED can be cited inline, whichever kind it is.
  // This used to read "only a numbered knowledge-base source", and the sentence
  // was the bug: hub.py numbers Serper results too, and web is 77 of the 90
  // citations ever made. See sources.js for the measurement.
  const numbered = sources.filter(s => s.ref != null);
  const citable = new Set(numbered.map(s => s.ref));
  const titleFor = new Map(numbered.map((s) => {
    // Where the marker goes, said before it is clicked. For a page the host is
    // the part that answers "whose claim is this" — unless the title already IS
    // the host, which is what a source with no title of its own falls back to.
    const host = s.url ? hostOf(s.url) : '';
    return [s.ref, host && host !== s.title ? `${s.title} — ${host}` : s.title];
  }));
  // Only a URL `safeUrl` accepted reaches this map, so a marker is a link if
  // and only if there is somewhere safe for it to go.
  const hrefFor = new Map(numbered.filter(s => s.url).map(s => [s.ref, s.url]));
  const ctx = { citable, titleFor, hrefFor, hot, onCite };

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
        verdictNote={verdictNote}
        verdictError={verdictError}
        verdictBusy={verdictBusy}
        asking={asking}
        onFeedback={onFeedback}
        onExplain={onExplain}
        onAsk={onAsk}
        evidenceOpen={evidenceOpen}
        onEvidence={onEvidence}
        hasEvidence={hasEvidence}
      />

      {cost ? <span className="sh__cost">{cost}</span> : null}
    </>
  );
}
