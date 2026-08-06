/**
 * Composer.jsx — the message box's chrome: its reply bar, its emoji row, its
 * formatting strip and the `.cmp` frame the box and the send button sit in.
 *
 * `06-sanvaad-varta.md` §8: "The composer is an `<input>`, and `onKeyDown`
 * checks `!e.shiftKey` before sending. An `<input>` cannot hold a newline, so
 * Shift+Enter does nothing at all — it neither sends nor breaks the line. Use a
 * `<textarea>` that grows to a max height."
 *
 * The channels composer had already been converted to a `<textarea>` on the
 * branch, so half of this claim is stale; the growth was not implemented, and
 * the WhatsApp composer was still an `<input>` with the same dead guard.
 *
 * The textarea itself, the draft, the send button and the `@` autocomplete now
 * live in `MentionInput.jsx`. They moved together because they are one piece of
 * state: the send button's disabled flag reads the draft, and the mention popup
 * rewrites it. What stayed here is everything that is a SIBLING of `.cmp` and so
 * could never be rendered from inside it — the reply banner, the emoji picker
 * panel and the formatting strip all sit above the composer row, not in it.
 *
 * `WAChat` and `ThreadPanel` import this file. Every prop it had keeps its name
 * and its meaning, and the three new ones (`members`, `onTyping`,
 * `allowBroadcast`) default to exactly today's behaviour: no member list, no
 * typing signal, no `@here`. A WhatsApp composer that has no channel to mention
 * anybody in therefore needs no change at all.
 */
import React, { useRef, useState } from 'react';
import { SvIcons } from './icons';
import EmojiPicker from './EmojiPicker';
import MentionInput from './MentionInput';
import { MARKERS, toggleFence, toggleInline } from './messageUtils';

/**
 * ⌘ on a Mac, Ctrl everywhere else. Read once, at module load: the answer
 * cannot change while the tab is open, and a tooltip is not worth a hook.
 */
const MOD = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
  ? '⌘'
  : 'Ctrl+';

/**
 * The strip.
 *
 * `messageUtils.parseRich` has understood Slack's subset since it was written
 * and NOTHING said so — no toolbar, no hint, no placeholder mentioning it. A
 * formatter nobody can find is a formatter nobody uses, and the two glyphs
 * `icons.jsx` carried for this (`bold`, `code`) had no call site at all, which
 * is how it was noticed.
 *
 * Four buttons, not a ribbon. Bold and italic are the two people reach for and
 * the two that have keyboard shortcuts; the code pair is here because a chat
 * channel in an engineering-adjacent firm is where a stack trace gets pasted,
 * and a fenced block is the one part of the subset whose syntax nobody guesses.
 * Strike, quote and lists are in the parser and deliberately not on the strip —
 * they are typed the way they read (`~x~`, `> `, `- `) and each extra icon
 * makes the four that matter harder to pick out.
 *
 * `run` is a pure function from `messageUtils`, which is where the rules live:
 * it is the parser's own guards, read backwards. See the band there.
 */
const TOOLS = [
  {
    id: 'b',
    icon: SvIcons.bold,
    label: 'Bold',
    hint: `Bold · ${MOD}B`,
    run: (v, s, e) => toggleInline(v, s, e, MARKERS.b),
  },
  {
    id: 'i',
    icon: SvIcons.italic,
    label: 'Italic',
    hint: `Italic · ${MOD}I`,
    run: (v, s, e) => toggleInline(v, s, e, MARKERS.i),
  },
  {
    id: 'code',
    icon: SvIcons.code,
    label: 'Code',
    hint: 'Code',
    run: (v, s, e) => toggleInline(v, s, e, MARKERS.code),
  },
  {
    id: 'pre',
    icon: SvIcons.codeBlock,
    label: 'Code block',
    hint: 'Code block',
    run: toggleFence,
  },
];

/** `b` and `i` again, by the key that reaches them. */
const SHORTCUT = { b: TOOLS[0], i: TOOLS[1] };

/**
 * Write a value into a textarea `MentionInput` controls, so that React hears
 * about it.
 *
 * `el.value = x` does NOT work here and the reason is worth stating, because it
 * looks like it should. React installs its own `value` setter on the NODE to
 * de-duplicate change events, and that setter records the new value in its
 * tracker before passing it on — so React then compares the incoming event
 * against a shadow value that already matches, decides nothing changed, and
 * never calls `onChange`. The draft in `MentionInput`'s state would stay on the
 * old text while the DOM showed the new one, and the next keystroke would throw
 * the formatting away. Going through the PROTOTYPE's setter writes past the
 * instance property, leaves the tracker stale, and the dispatched `input` event
 * is therefore seen as a real edit.
 *
 * The cost, stated rather than discovered: a programmatic write clears the
 * browser's native undo stack for the field, so Ctrl+Z will not take a `*` pair
 * back off. Pressing the same button again is what does — every tool here
 * toggles, and that is the reason they all do.
 */
function writeDraft(el, next) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (setter) setter.call(el, next); else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function Composer({
  onSend, disabled, placeholder, replyTo, onCancelReply, emoji = false, label = 'Message',
  members = [], onTyping, allowBroadcast = false, formatting = false,
  /** `.m2cp__ai` — see the button in `foot` below. Absent on Varta. */
  onAsk,
}) {
  /**
   * The smiley button's own DOM node while the picker is open, else null.
   *
   * It was a boolean and a five-button row rendered above the composer.
   * `EmojiPicker` is a `position: fixed` panel that places itself against
   * whatever opened it, so what it needs is the element and not the fact — and
   * `e.currentTarget` in the handler is exactly that, with no ref to keep in
   * step with a conditional render.
   */
  const [picker, setPicker] = useState(null);
  /**
   * The draft belongs to `MentionInput`, so the emoji row reaches it through a
   * handle rather than through state lifted up here. Lifting it would mean the
   * whole composer re-rendering on every keystroke to keep one button's
   * `disabled` flag honest, and would put the caret bookkeeping that mention
   * insertion depends on in a different component from the textarea it applies
   * to.
   */
  const input = useRef(null);

  /**
   * The composer ROW, so the strip can find the textarea inside it.
   *
   * A formatting tool needs the selection, and a selection is `selectionStart`
   * and `selectionEnd` on the element — `MentionInput`'s handle exposes
   * `insertText`, which writes at the caret and cannot replace a highlighted
   * run. The right home for this is a `wrap()` method on that handle beside
   * `insertText`; that file belongs to another owner on this branch, so the
   * node is reached through the row instead, and it is reached rather than
   * remembered because `MentionInput` may re-render it at any time.
   */
  const row = useRef(null);
  const box = () => row.current?.querySelector('textarea.cmp__ta') || null;

  /**
   * Apply one tool to whatever is selected.
   *
   * `focus()` comes BEFORE the write and the selection is restored after it:
   * the strip sits outside `.cmp` and a button press must leave the caret where
   * the writer left it, not at the end of the message. `onMouseDown` below
   * keeps the textarea focused in the first place, which is also what keeps the
   * selection visible while the strip is being clicked.
   */
  const apply = (tool) => {
    const el = box();
    if (!el || disabled || el.disabled) return;
    const at = el.selectionStart ?? el.value.length;
    const to = el.selectionEnd ?? at;
    const next = tool.run(el.value, at, to);
    el.focus();
    // An unchanged draft is `toggleInline` reporting that there was nothing
    // here to mark — a selection of pure whitespace. Writing it back would
    // still cost the field its undo stack for no edit.
    if (next.value !== el.value) writeDraft(el, next.value);
    el.setSelectionRange(next.start, next.end);
  };

  /**
   * ⌘/Ctrl + B and I, caught on the ROW rather than on the textarea.
   *
   * The textarea's own `onKeyDown` lives in `MentionInput` and is not this
   * file's to edit; a keydown bubbles, so listening one level up gets the same
   * events after that handler has had them. Nothing here looks at Enter,
   * Escape, Tab or the arrows, which are the four keys the mention popup owns —
   * so a list that is open stays open and stays in control of them.
   *
   * `preventDefault` is not cosmetic: Ctrl+B opens the bookmarks sidebar in
   * Firefox and Ctrl+I opens Page Info, and both would fire over a half-written
   * message.
   */
  const onKeyDown = (e) => {
    // Mid-composition in an IME. `MentionInput` guards its own handler the same
    // way and for the same reason: these are candidate-window keys, not ours.
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const tool = SHORTCUT[String(e.key).toLowerCase()];
    if (!tool || disabled) return;
    e.preventDefault();
    apply(tool);
  };

  /**
   * The leading half of `.m2cp__foot` — everything before the spacer.
   *
   * `Msg2Chat.jsx:319-325` puts attach, emoji and "Draft with Sahayak" here.
   * The build has no attach yet; the formatting group is the build's own and
   * takes the slot the prototype gives attach, which is the same kind of
   * control doing the same kind of job.
   */
  const foot = (
    <>
      {formatting && (
        /* OPT-IN, because this component is shared with Varta. WhatsApp renders
           `*bold*`, `_italic_` and a triple-backtick block, but NOT single-
           backtick inline code — so on that surface the code button would write
           syntax the recipient sees literally, in a conversation with a client.
           A strip that is right for Sanvaad and wrong for WhatsApp has to be
           asked for rather than inherited.

           It USED TO BE A BAR ABOVE THE COMPOSER (`.cmp__fmt`, with
           `.cmp__fmt + .cmp { border-top: 0 }` welding the two together). It
           could not be anywhere else: `.cmp` was a flex row the textarea
           stretched inside, so anything added to it took width off the box. The
           prototype's box has a foot row for exactly these controls, so the
           strip moves into it and the welding rule is no longer load-bearing —
           the group keeps its class for its own `role="group"` and its buttons,
           and `.m2cp__foot .cmp__fmt` drops the bar geometry it no longer has. */
        <div className="cmp__fmt" role="group" aria-label="Formatting">
          {TOOLS.map(t => (
            <button
              key={t.id}
              type="button"
              className="cmp__fmtb"
              // The same `disabled` the send button reads — one gate, spent
              // twice. Where the reader may not post at all there is no
              // composer: `ChatPane` renders `LockedComposer` instead, so the
              // RBAC half never reaches this file.
              disabled={disabled}
              title={t.hint}
              aria-label={t.label}
              // preventDefault on mousedown, exactly as the mention popup does:
              // a click fires after the mousedown that would have blurred the
              // textarea, and a blurred textarea has lost the selection this is
              // about to wrap.
              onMouseDown={e => e.preventDefault()}
              onClick={() => apply(t)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      )}

      {emoji && (
        <button
          type="button"
          className="svbtn"
          onClick={e => { const el = e.currentTarget; setPicker(p => (p ? null : el)); }}
          aria-label="Insert emoji"
          aria-expanded={!!picker}
          aria-haspopup="dialog"
        >
          {SvIcons.smile}
        </button>
      )}

      {/* `.m2cp__ai` — `28-messaging-v2.md` §7, the third of Sahayak's three
          entry points into a conversation.

          IT OPENS THE PANEL AND DOES NOT WRITE A DRAFT, and that is the
          prototype's own behaviour, not a reduction of it:
          `Messaging v2.html:107` passes `onAsk={() => setAside(true)}` and the
          composer button calls it directly. The word on it is the prototype's.

          Rendered only when a caller supplies `onAsk`, so Varta's WhatsApp
          composer — which has no Sahayak panel beside it — gets no button for
          one. */}
      {onAsk && (
        <button
          type="button"
          className="m2cp__ai"
          onClick={onAsk}
          disabled={disabled}
          aria-label="Open Sahayak for this conversation"
        >
          {SvIcons.spark} Draft with Sahayak
        </button>
      )}
    </>
  );

  return (
    /* `.m2cp` — the composer's own padded frame, which the build did not have:
       `.cmp` was the row AND the outer spacing, so the box sat hard against the
       column's edges. This is the wrapper `messaging.css` gives it.

       AND `.m2cp__box` IS NOW RENDERED, which closes a cascade collision rather
       than merely adopting a name. Before this, `.m2cp` wrapped the legacy
       `.cmp` bar, and `.m2cp textarea` (0,1,1) — the V2 rule written FOR a box
       that was never built — outranked `.cmp__ta` (0,1,0) and stripped
       `border: 1px solid var(--outline-variant)` and `background: var(--s-lowest)`
       off the field. What shipped was a borderless transparent textarea on a
       full-width bar: neither the prototype's box nor the build's previous one.
       The border, the fill and the focus ring come from `.m2cp__box` now, which
       is where both stylesheets always drew them.

       The reply bar moved INSIDE the box with it. `messaging.css:212` is
       `.m2cp__reply { … border-bottom: 1px solid var(--outline-variant) }` — a
       divider between two rows of one block, which only reads as one if it is
       inside the block. */
    <div className="m2cp">
      {/* The picker is rendered here, as a SIBLING of the box.
          It is `position: fixed`, so where it sits in the tree decides nothing
          about where it paints — but it does decide one thing: inside
          `MentionInput` it could not reach `insertText`, which is the handle
          this file holds and that component owns.
          It replaces a strip of five glyphs that was the entire "emoji picker".
          The five are still first in the panel, above the search box. */}
      {picker && (
        <EmojiPicker
          anchor={picker}
          label="Insert emoji"
          /* `insertText` puts the glyph at the caret and refocuses the box, so
             choosing an emoji mid-sentence no longer sends the cursor to the end
             of the message. The panel stays OPEN — unlike a reaction, which is
             one act, inserting emoji into a sentence is usually more than one,
             and closing after each would make "🎉🎉🎉" three round trips through
             the button. Escape and a click outside both close it. */
          onPick={e => input.current?.insertText(e)}
          onClose={() => setPicker(null)}
        />
      )}

      <div className="m2cp__box" ref={row} onKeyDown={onKeyDown}>
        {replyTo && (
          <div className="m2cp__reply">
            <span className="ch__ic" aria-hidden="true">{SvIcons.reply}</span>
            <span className="cmp__reply-t">
              Replying in <b>{replyTo.sender_name || 'Unknown'}</b>’s thread
              {replyTo.content ? ` — ${replyTo.content.slice(0, 70)}` : ''}
            </span>
            <button type="button" className="svbtn" onClick={onCancelReply} aria-label="Cancel reply">
              {SvIcons.close}
            </button>
          </div>
        )}

        {/* Emits the `.cmp__ta` textarea and, beneath it, the `.m2cp__foot` row
            the `foot` above fills. The mention popup it also emits is
            `position: fixed`, so it is out of flow and costs this box nothing. */}
        <MentionInput
          ref={input}
          onSend={onSend}
          members={members}
          disabled={disabled}
          placeholder={placeholder}
          replyTo={replyTo}
          onCancelReply={onCancelReply}
          onTyping={onTyping}
          label={label}
          allowBroadcast={allowBroadcast}
          foot={foot}
        />
      </div>
    </div>
  );
}
