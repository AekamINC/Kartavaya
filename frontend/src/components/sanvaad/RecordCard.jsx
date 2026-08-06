import React from 'react';
import Button from '../ui/Button';

/**
 * RecordCard — the firm's own objects, rendered inside the conversation.
 *
 * `28-messaging-v2.md` §4, `messaging.css:296-319` (`.m2rec*`). This is what
 * makes an SME chat surface worth using rather than a copy of a consumer
 * messenger. People already discuss invoices and approvals in chat; today they
 * do it by pasting a number and switching tabs. Rendering the record itself
 * means the decision and the evidence sit in the same place.
 *
 * ONE COMPONENT, FIVE KINDS — not five components, and not a switch that
 * renders five unrelated trees. Every kind draws the SAME markup: a tinted top
 * strip carrying the module's name and the record's reference, a title line
 * with an optional amount, a wrapped list of label/value fields, an optional
 * progress bar, actions, and an optional "already answered" footer. What
 * changes between kinds is three things and they are all data:
 *
 *   · the accent (`--rc`), so an invoice in chat is recognisably the same
 *     object as an invoice in Ganit;
 *   · the module's name, in both scripts;
 *   · the glyph.
 *
 * `28` says it outright — "a sixth kind is one data entry and no new CSS" — and
 * `KINDS` below is that entry point. Adding `credit_note` is four lines here.
 *
 * ── The tones, and the one that does not exist ──────────────────────────────
 *
 * `28`'s table asks for `--m-ganit`, `--m-kartavya`, `--warn`, `--m-ganit`,
 * `--m-vikray`. MEASURED: `styles/module.css` declares fifteen `--m-*` module
 * tints and `--m-kartavya` is NOT among them. The task module's tint in this
 * build is `--m-boards`, declared in both themes beside the other fourteen, and
 * that is what `task` uses. Renaming the token to match a prose table would be
 * the wrong direction of travel: the token is the thing that reaches every
 * surface, and it is already spent.
 *
 * ── Why the card is not always a button ─────────────────────────────────────
 *
 * `Msg2Chat.jsx` renders `.m2rec` as a `<button>` and puts its actions inside
 * it as `<span className="btn">`. That works in a prototype because those spans
 * are decoration. Here they have to be real controls, and a `<button>` inside a
 * `<button>` is invalid HTML: the inner control is unreachable by keyboard in
 * Firefox and the outer one swallows the click in every engine.
 *
 * So the rule is: THE CARD IS A CONTROL ONLY WHEN IT CONTAINS NONE.
 *   · actions present → `<div>`. The actions are the affordance; the first one
 *     is the "open this record" the whole-card click would have been.
 *   · no actions, `onOpen` given → `<button>`, exactly as drawn.
 *   · neither → `<div>`. The prototype's answered approval is this shape.
 * `.m2rec:hover` fires in all three; on the non-interactive shapes it is a
 * border-colour warm-up under the pointer, not a promise of a click.
 *
 * ── What has no backing yet ─────────────────────────────────────────────────
 *
 * `send_message` refuses every `type` but `text` and `system` with a 400, and
 * `MessageCreate` has no `metadata` field even though the `metadata` column
 * exists on `samvada_messages`. So a record in a message is a WRITE-PATH change
 * before it is a component. This file is the render half and is deliberately
 * pure: it holds no fetch, no id resolution and no assumption about where its
 * props came from, so it works the same against a live payload and against a
 * seeded one.
 */

/** A 14px line glyph, one pen, matching the icon weight used across the log. */
const G = (d, extra) => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {extra}
  </svg>
);

const ICONS = {
  // ₹ — the rupee sign as a stroke, for the two money kinds.
  rupee: G('M6 4h8M6 7.5h8M12.5 4c0 2.3-1.9 3.5-4.2 3.5H6l7 8.5'),
  // A ticked list — a task.
  task: G('M4 6h9M4 10h9M4 14h6', <path d="M15.5 12.5l1.6 1.7 2.4-3" />),
  // A stamp — an approval asked for.
  stamp: G('M4.5 16.5h11M7 13.5h6l.6-4.2a3.6 3.6 0 10-7.2 0z'),
  // A tag — a sales order.
  order: G('M3.5 3.5h6l7 7-6 6-7-7z', <circle cx="6.9" cy="6.9" r="1.1" />),
};

/**
 * The five kinds. `tone` is a token reference, never a literal — the card reads
 * it through `--rc`, so a correction in `module.css` reaches every record in
 * every conversation without this file changing.
 */
export const KINDS = {
  invoice: { mod: 'Ganit', hi: 'गणित', tone: 'var(--m-ganit)', icon: 'rupee' },
  payment: { mod: 'Ganit', hi: 'गणित', tone: 'var(--m-ganit)', icon: 'rupee' },
  task: { mod: 'Kartavya', hi: 'कर्तव्य', tone: 'var(--m-boards)', icon: 'task' },
  order: { mod: 'Vikray', hi: 'विक्रय', tone: 'var(--m-vikray)', icon: 'order' },
  /* `ask` is the one kind whose top strip is NOT its module tint: `.m2rec--ask`
     repaints it `--warn-container` and its glyph and label `--warn`, because a
     decision being asked of you is a state, not a filing category. `--rc` is
     still set so the hover border and the progress bar agree with it. */
  ask: { mod: 'Approval', hi: 'स्वीकरण', tone: 'var(--warn)', icon: 'stamp' },
};

const KIND_IDS = Object.keys(KINDS);

export default function RecordCard({
  kind,
  reference,
  title,
  amount,
  fields = [],
  percent = null,
  actions = [],
  done = null,
  onOpen,
  module: moduleOverride,
  moduleHi,
  className = '',
  ...rest
}) {
  /* An unknown kind renders nothing rather than an untinted card with a blank
     strip. A record whose type the client does not understand is a payload the
     client cannot vouch for, and half-drawing it invites someone to act on it. */
  const spec = KINDS[kind];
  if (!spec) return null;

  const mod = moduleOverride ?? spec.mod;
  const hi = moduleHi ?? spec.hi;
  const hasActions = actions.length > 0;
  const clickable = !hasActions && typeof onOpen === 'function';

  const Tag = clickable ? 'button' : 'div';
  const tagProps = clickable
    ? { type: 'button', onClick: onOpen }
    : {};

  const cls = ['m2rec', kind === 'ask' ? 'm2rec--ask' : '', className]
    .filter(Boolean).join(' ');

  return (
    <Tag className={cls} style={{ '--rc': spec.tone }} {...tagProps} {...rest}>
      <span className="m2rec__top">
        <span className="m2rec__ic">{ICONS[spec.icon]}</span>
        {/* The module's name in both scripts, the Devanagari one step down and
            lighter — 24-bilingual-devanagari.md's apposition, and the reason
            `.m2rec__mod span` carries --font-indic rather than the strip. */}
        <span className="m2rec__mod">{mod}<span lang="hi">{hi}</span></span>
        {reference && <span className="m2rec__ref">{reference}</span>}
      </span>

      <span className="m2rec__body">
        <span className="m2rec__ln">
          <span className="m2rec__t" title={title}>{title}</span>
          {amount ? <span className="m2rec__amt">{amount}</span> : null}
        </span>

        {fields.length > 0 && (
          <span className="m2rec__meta">
            {fields.map(([label, value]) => (
              <span className="m2rec__f" key={label}>
                <span className="m2rec__f-l">{label}</span>
                <span className="m2rec__f-v">{value}</span>
              </span>
            ))}
          </span>
        )}

        {/* Progress, for a task shared into chat. `role="progressbar"` and the
            three aria-value attributes, because a 5px bar with no label is a
            colour and 23-accessibility.md §4 does not accept a colour as the
            sole carrier of a value. Clamped: a subtask count that has drifted
            past its total must not paint a bar wider than its track. */}
        {percent != null && (
          <span className="m2rec__bar" role="progressbar"
            aria-valuenow={Math.round(Math.min(100, Math.max(0, percent)))}
            aria-valuemin={0} aria-valuemax={100}
            aria-label={`${title} progress`}>
            <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </span>
        )}
      </span>

      {hasActions && (
        <span className="m2rec__act">
          {actions.map((a, i) => (
            <Button key={a.label} variant={i === 0 ? 'fill' : 'out'} size="sm"
              onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </Button>
          ))}
        </span>
      )}

      {done && (
        <span className="m2rec__done">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 10.5l3.6 3.6L15.5 6" />
          </svg>
          {done}
        </span>
      )}
    </Tag>
  );
}

export { KIND_IDS };
