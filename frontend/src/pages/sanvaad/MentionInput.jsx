/**
 * MentionInput.jsx — Sanvaad's message box, with an `@` autocomplete over the
 * channel's own membership.
 *
 * `messageUtils.js:230-233` records why this did not exist: the product already
 * has a mention composer in `components/MentionTextarea.jsx`, but that one
 * belongs to `03-task-drawer.md`, hardcodes `className="inp"`, styles itself
 * with inline `style={{}}` and takes no class of its own — so it can never
 * render as `.cmp__ta`, and task-comment mentions depend on every line of it.
 * This is the channel-shaped equivalent, written rather than the other one bent.
 *
 * Four things are deliberately different from that file, and each is a defect
 * there rather than a preference here:
 *
 *  · **The popup is anchored ABOVE the caret.** `MentionTextarea` opens
 *    downwards, which is right in a drawer whose composer sits mid-panel. This
 *    composer is the last row of a full-height flex column, so its caret is
 *    ~40px from the bottom of the viewport and a list opened below it would be
 *    entirely off-screen.
 *  · **No `window.scrollY` / `scrollX` in the caret maths.** `MentionTextarea`
 *    adds the page scroll to a `getBoundingClientRect()` result and then places
 *    the popup `position: fixed`. Fixed coordinates are viewport-relative, so
 *    that offset is a straight error — it is invisible only because the drawer
 *    it lives in never lets the document scroll. Do not copy it back in.
 *  · **The mirror subtracts `el.scrollTop`.** `.cmp__ta` caps at 180px and then
 *    scrolls; without this the popup detaches from the caret the moment a
 *    message runs past six lines.
 *  · **The `@` must start a word.** `MentionTextarea` opens its list on the `@`
 *    inside `user@example.com`. `splitMentions` already refuses to render that
 *    as a mention (`(^|[^\w@])` in its regex) and `services/mentions.py` refuses
 *    to resolve it, so an inserter that offers it is the inserter and the parser
 *    disagreeing — which is the exact class of bug
 *    `src/__tests__/renderMentions.test.jsx` was written about.
 *
 * What is NOT different, and must not be: **insertion writes `@` + the member's
 * full display name + a trailing space.** Never an id, never a `<@u_ab12>`
 * sigil, never the first token. Two separate readers depend on that literal
 * form — `splitMentions()` here, and the server-side resolver that writes
 * `staging.samvada_mentions` and the notification row. A sigil would also make a
 * message that mentions you unfindable by your own name, because `GET /search`
 * runs over `content`.
 *
 * There are no file attachments in this composer and no upload control. That is
 * a scope decision, not an omission.
 */
import React, {
  useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { SvIcons } from './icons';

/** `.cmp__ta` caps at 180px; keep the two numbers in one place. */
const MAX_H = 180;

const TRIGGER = '@';
/** Past this many characters the run after an `@` is prose, not a name. */
const MAX_QUERY = 30;
/** Eight rows is what fits without the list becoming a page of its own. */
const MAX_ROWS = 8;
/**
 * The picker/menu rung of the ladder in `26-motion-z.md` §4 — 200 drawer · 340
 * picker and menu · 420 modal · 520 toast · 620 sheet. `MentionTextarea` shipped
 * with 999 and covered every toast raised while it was open; that has been
 * fixed once already and is not being reintroduced here. It is set inline
 * alongside the measured coordinates because the two are one decision: a popup
 * placed by JS at viewport coordinates has to sit on the right rung or it is
 * placed correctly and painted underneath something.
 */
const POP_Z = 340;
/** Keep the popup off the very edge of the window when the caret is near one. */
const GUTTER = 8;

/**
 * English only, deliberately. `24-bilingual-devanagari.md` closes with an
 * explicit "No" list — "validation messages, error text, empty-state
 * explanations, tooltips, form field labels, table column headers" — and a
 * placeholder is the label of the field it sits in. The rule there is that
 * Devanagari is "a recognition cue on things the user already knows the meaning
 * of"; "Write a message…" is an instruction, not a name the reader already
 * recognises, so the second script buys nothing.
 *
 * The structural half matters more than the editorial half. A placeholder is a
 * plain string attribute, so the Devanagari inside one can never carry `lang`
 * or `--font-indic` — the two things `24` requires of every Indic run. Without
 * `lang` a screen reader speaks Devanagari with the English voice; without
 * `--font-indic` an EN+GU user gets Devanagari where Gujarati was chosen. Every
 * other Indic string in this module (`.sv__hi`, `EmptyState`'s `{en, hi}`
 * title) is a nested element for exactly that reason. A placeholder cannot be,
 * so it does not get one.
 */
const DEFAULT_PLACEHOLDER = 'Write a message…';

/**
 * `@here` and `@channel` are stored in `content` as those two ASCII strings —
 * not as a member, not as an id — because that is what the server's resolver
 * looks for and what `splitMentions` renders. `full_name` is therefore the bare
 * word: the insertion path writes `'@' + full_name + ' '` and must come out as
 * `@here `, not `@@here ` or `@here (everyone online) `.
 *
 * The hint is a `title`/`aria-label`, not a second line of markup, because the
 * popup has one text class (`.cmp__mn-n`) and inventing a second would be a
 * class with no rule — which fails `check-classes.mjs` for all eight agents.
 */
const BROADCAST = [
  {
    user_id: '__here__',
    full_name: 'here',
    broadcast: true,
    hint: 'Notify everyone in this channel who is online right now',
  },
  {
    user_id: '__channel__',
    full_name: 'channel',
    broadcast: true,
    hint: 'Notify every member of this channel',
  },
];

/**
 * Where the caret is, in viewport coordinates, and how tall its line is.
 *
 * A textarea exposes no caret geometry, so the standard trick is a hidden div
 * that reproduces the box's text metrics exactly, holds the text up to the
 * caret, and is measured. Everything that decides where a glyph lands has to be
 * copied — the font shorthand alone is not enough, because a computed `font`
 * comes back empty in several engines when the family and size were set
 * separately, and an empty font silently measures at 16px Times.
 *
 * `box-sizing: border-box` is forced rather than inherited: `editorial.css:7`
 * puts `* { box-sizing: border-box }` on the document, which would apply to this
 * div too, but a caller injecting a reset that does otherwise would move every
 * measurement by the padding. With border-box and `width = el.clientWidth`
 * (which excludes the border and includes the padding) the mirror's content box
 * is the same width as the textarea's, so the text wraps at the same points.
 */
function caretAnchor(el, caretPos) {
  const cs = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.cssText = [
    'position:absolute',
    'visibility:hidden',
    // Parked off-screen at the document origin. `MentionTextarea` leaves it in
    // the body's normal flow, where a long draft briefly lengthens the page and
    // can flash a scrollbar mid-keystroke.
    'top:0',
    'left:-9999px',
    'white-space:pre-wrap',
    'word-wrap:break-word',
    'overflow-wrap:break-word',
    'box-sizing:border-box',
    'border:0',
    `width:${el.clientWidth}px`,
    `padding:${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
    `font-family:${cs.fontFamily}`,
    `font-size:${cs.fontSize}`,
    `font-weight:${cs.fontWeight}`,
    `font-style:${cs.fontStyle}`,
    `letter-spacing:${cs.letterSpacing}`,
    `line-height:${cs.lineHeight}`,
    `text-transform:${cs.textTransform}`,
    `text-indent:${cs.textIndent}`,
    `word-spacing:${cs.wordSpacing}`,
    `tab-size:${cs.tabSize}`,
  ].join(';');

  const span = document.createElement('span');
  // A zero-width space, so the marker has a box to measure but adds no advance
  // width that would push the following text onto a different line.
  span.textContent = '​';
  mirror.appendChild(document.createTextNode(el.value.slice(0, caretPos)));
  mirror.appendChild(span);
  document.body.appendChild(mirror);

  const mRect = mirror.getBoundingClientRect();
  const sRect = span.getBoundingClientRect();
  const lineH = span.offsetHeight || parseFloat(cs.lineHeight) || 0;
  document.body.removeChild(mirror);

  const eRect = el.getBoundingClientRect();
  const bTop = parseFloat(cs.borderTopWidth) || 0;
  const bLeft = parseFloat(cs.borderLeftWidth) || 0;

  // `mRect` is the mirror's border box, and the mirror has no border, so it is
  // also its padding box — which is what `eRect.top + borderTopWidth` is on the
  // textarea. No page scroll is added: the popup is `position: fixed`.
  return {
    top: eRect.top + bTop + (sRect.top - mRect.top) - el.scrollTop,
    left: eRect.left + bLeft + (sRect.left - mRect.left) - el.scrollLeft,
    lineH,
  };
}

export default function MentionInput({
  onSend,
  members = [],
  disabled = false,
  placeholder,
  replyTo = null,
  onCancelReply,
  onTyping,
  label = 'Message',
  allowBroadcast = false,
  /**
   * React 19 passes `ref` as an ordinary prop, so no `forwardRef` — there is not
   * one in this codebase and this file is not the place to introduce the first.
   * The handle exists for exactly one caller: `Composer` keeps the emoji row
   * (the picker panel is a SIBLING of `.cmp`, so it cannot live inside a
   * component rendered within `.cmp`) and needs a way to put the chosen glyph
   * into a draft this component owns.
   */
  ref,
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** `{ query, atIdx, left, bottom }` while the list is up, else null. */
  const [popup, setPopup] = useState(null);
  const [cursor, setCursor] = useState(0);

  const ta = useRef(null);
  const pop = useRef(null);
  const popId = useId();

  /**
   * Where to put the caret after the next render. Insertion has to restore it
   * by hand: `setText` replaces the whole value, and a textarea whose value is
   * replaced puts its caret at the end — so mentioning somebody in the middle of
   * a half-written sentence would throw the cursor to the tail and the rest of
   * the sentence would be typed after it.
   */
  const pendingCaret = useRef(null);

  /**
   * The last boolean handed to `onTyping`. `usePresence` turns this into a flag
   * on the NEXT scheduled `/live` poll rather than a request of its own — the
   * write budget is 120 writes per client IP per minute and four colleagues
   * behind one office NAT would spend two-thirds of it on animated dots — so
   * this side only has to report the edge, never rate-limit it. Reporting the
   * same value twice is still wasted work, hence the ref.
   */
  const typingOn = useRef(false);
  const onTypingRef = useRef(onTyping);
  useEffect(() => { onTypingRef.current = onTyping; }, [onTyping]);

  const signalTyping = useCallback((on) => {
    if (typingOn.current === on) return;
    typingOn.current = on;
    onTypingRef.current?.(on);
  }, []);

  // Leaving the channel with a half-typed draft must not leave your dots
  // animating in it for the eight seconds the server's window allows.
  useEffect(() => () => {
    if (typingOn.current) onTypingRef.current?.(false);
  }, []);

  // Grow to content, then scroll. Reset to `auto` first or the box only ever
  // gets taller — `scrollHeight` never shrinks below the current height.
  const autoGrow = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
  }, []);

  useEffect(autoGrow, [text, autoGrow]);

  useEffect(() => {
    if (pendingCaret.current == null) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(at, at);
  }, [text]);

  // Opening a reply should put the cursor where the reply gets typed.
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);

  /**
   * A member with no `full_name` is not offered.
   *
   * The server resolves a mention from the literal text against
   * `COALESCE(u.full_name, u.name, u.email)`, so inserting anything other than
   * the display name it will compute produces a message that looks like it
   * mentions somebody and notifies nobody — the silent half of the
   * `renderMentions` bug. `GET /channels/:id/members` and `GET /directory` both
   * select `u.full_name`, which is nullable in `public.users`, so this is a real
   * row shape and not a defensive nicety. Such a person is still reachable by
   * typing a bare `@handle`: the resolver's second pass matches email and name.
   */
  const people = useMemo(
    () => members.filter(m => m && typeof m.full_name === 'string' && m.full_name.trim()),
    [members]
  );

  const candidates = useMemo(() => {
    if (!popup) return [];
    const q = popup.query.toLowerCase();
    const matched = people
      .filter(m => !q || m.full_name.toLowerCase().includes(q))
      .slice(0, MAX_ROWS);
    // Broadcasts prefix-match rather than substring-match, and only when they
    // are allowed on this surface. A thread reply passes `allowBroadcast={false}`
    // — a reply three levels down a thread must never page the whole channel.
    const casts = allowBroadcast
      ? BROADCAST.filter(b => !q || b.full_name.startsWith(q))
      : [];
    return [...casts, ...matched];
  }, [popup, people, allowBroadcast]);

  const open = !!popup && candidates.length > 0;
  const active = Math.min(cursor, Math.max(candidates.length - 1, 0));

  /**
   * Clamp into the viewport after the list has a width, and keep the active row
   * visible when the arrows walk past the bottom of a scrolling list.
   *
   * The left edge is corrected on the node rather than through state: the
   * measurement needs the rendered width, and feeding that back into `setPopup`
   * is a render loop waiting for a rounding error. `useLayoutEffect` runs before
   * paint, so the corrected value is the first one drawn.
   */
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el || !popup) return;
    const max = window.innerWidth - GUTTER - el.offsetWidth;
    const left = Math.max(GUTTER, Math.min(popup.left, Math.max(GUTTER, max)));
    if (left !== popup.left) el.style.left = `${left}px`;
    el.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [popup, active, candidates.length]);

  /**
   * Dismiss on a click outside. The listener is bound only while the list is up
   * — a document-level `mousedown` handler that survives the popup is a cost
   * every message in every channel pays.
   *
   * Both the textarea and the popup count as "inside". `MentionTextarea` tests
   * one wrapper element because its popup is a child of it; this popup is a
   * `position: fixed` sibling emitted into `.cmp`, since wrapping the textarea
   * in a div would take `.cmp__ta` out of `.cmp`'s flex row and the box would
   * stop filling the composer.
   */
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      const t = e.target;
      if (ta.current?.contains(t) || pop.current?.contains(t)) return;
      setPopup(null);
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  const handleChange = (e) => {
    const next = e.target.value;
    setText(next);
    signalTyping(!!next.trim());

    const pos = e.target.selectionStart ?? next.length;
    const slice = next.slice(0, pos);
    const atIdx = slice.lastIndexOf(TRIGGER);
    if (atIdx !== -1) {
      const before = atIdx === 0 ? '' : slice[atIdx - 1];
      const query = slice.slice(atIdx + 1);
      // `atIdx === 0 || whitespace before it` is the half `MentionTextarea` is
      // missing, and it is the half that keeps `user@example.com` from opening a
      // member list on its domain. `\s` rather than `' '` so that a newline ends
      // the query too — an `@` left dangling on the previous line should not keep
      // a list open over the one being typed.
      if ((atIdx === 0 || /\s/.test(before)) && !/\s/.test(query) && query.length <= MAX_QUERY) {
        const a = caretAnchor(e.target, atIdx);
        setPopup({
          query,
          atIdx,
          left: a.left,
          // Anchored by its BOTTOM to the top of the caret's line, so the list
          // grows upwards out of a composer that is already at the foot of the
          // window. `innerHeight - top` converts the viewport-relative top into
          // the `bottom` offset `position: fixed` wants.
          bottom: Math.max(GUTTER, window.innerHeight - a.top + 4),
        });
        setCursor(0);
        return;
      }
    }
    setPopup(null);
  };

  const insert = (m) => {
    if (!popup || !m) return;
    const before = text.slice(0, popup.atIdx);
    const after = text.slice(popup.atIdx + 1 + popup.query.length);
    // The full display name and a trailing space. See the header: three
    // independent readers parse this exact form.
    const token = `${TRIGGER}${m.full_name} `;
    pendingCaret.current = before.length + token.length;
    setText(before + token + after);
    setPopup(null);
  };

  /**
   * The box clears BEFORE the request, not after it.
   *
   * `MOTION-SPEC.md` §7.1 pairs the optimistic row in the log with an immediately
   * empty composer — that is one gesture, and splitting it across a round trip is
   * what made a slow send look like a dropped one: the text was still sitting in
   * the box, the send button was disabled, and nothing had appeared in the log.
   *
   * The draft is restored on failure, which is the other half of the same rule
   * ("a failed write restores the old value"). `onSend` rethrows after `ChatPane`
   * has raised the server's own reason, so the reader gets the sentence and their
   * words back together — and the typing flag stays UP in that case, because the
   * draft is back in the box and the reader is about to keep working on it.
   */
  const submit = async () => {
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    setText('');
    setPopup(null);
    try {
      await onSend?.(body);
      signalTyping(false);
    } catch {
      setText(body);
      ta.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    /**
     * An IME candidate window is composing. Enter there commits the candidate;
     * it is not a send. Without this a Hindi or Marathi reader typing through a
     * transliteration IME posts the half-converted romanisation the moment they
     * accept the first suggestion. `keyCode === 229` is the same signal from the
     * engines that do not set `isComposing`.
     */
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;

    // The list's keys are read FIRST and each one returns. Enter with the list
    // open picks a name; Enter with it closed sends the message; the two must
    // never both run, and Escape with the list open must close the list without
    // also cancelling the reply the composer is attached to.
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor(c => Math.min(c + 1, candidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor(c => Math.max(c - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(candidates[active]);
        return;
      }
      if (e.key === 'Escape') {
        // stopPropagation, not just `setPopup(null)`: Escape is also the close
        // key of the thread panel and of the channel settings sheet this
        // composer can sit inside, so dismissing the mention list would take the
        // whole panel with it and lose the half-written message behind it.
        e.stopPropagation();
        e.preventDefault();
        setPopup(null);
        return;
      }
    }

    // Now that this is a textarea the guard means what it says: Enter sends,
    // Shift+Enter breaks the line.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); onCancelReply?.(); }
  };

  useImperativeHandle(ref, () => ({
    /**
     * Insert at the caret rather than appending. The emoji button lives outside
     * this component and clicking it blurs the textarea, but `selectionStart`
     * survives the blur — so an emoji chosen while the cursor sat mid-sentence
     * lands where the writer left it instead of at the end of the message.
     */
    insertText(s) {
      const el = ta.current;
      const at = el && el.selectionStart != null ? el.selectionStart : text.length;
      pendingCaret.current = at + s.length;
      setText(t => t.slice(0, at) + s + t.slice(at));
      signalTyping(true);
    },
    focus() { ta.current?.focus(); },
  }), [text, signalTyping]);

  return (
    <>
      <textarea
        ref={ta}
        className="cmp__ta"
        rows={1}
        aria-label={label}
        placeholder={placeholder || DEFAULT_PLACEHOLDER}
        value={text}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        // The same ARIA set `MentionTextarea` exposes, plus the active row so a
        // screen reader announces the highlighted name as the arrows move —
        // without `aria-activedescendant` the list is announced once and then
        // silently changes selection under the reader.
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-activedescendant={open ? `${popId}-${active}` : undefined}
      />
      <button
        type="button"
        className="cmp__send"
        onClick={submit}
        disabled={busy || disabled || !text.trim()}
        aria-label="Send"
      >
        {SvIcons.send}
      </button>

      {open && (
        /* `position` and the two offsets are inline because they are measured,
           not authored — everything with a fixed value (surface, border, radius,
           shadow, row metrics, max-height) is `.cmp__mn` in sanvaad.css. Fixed
           rather than absolute so the list is not clipped by the composer's own
           row or by any `overflow-y: auto` ancestor. */
        <div
          ref={pop}
          id={popId}
          className="cmp__mn"
          role="listbox"
          aria-label="Mention a channel member"
          style={{ position: 'fixed', left: popup.left, bottom: popup.bottom, zIndex: POP_Z }}
        >
          {candidates.map((m, i) => (
            <div
              key={m.user_id || m.full_name}
              id={`${popId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={m.broadcast ? `@${m.full_name} — ${m.hint}` : m.full_name}
              title={m.broadcast ? m.hint : undefined}
              /* Assembled from an array of whole literals rather than a template
                 with `${}` inside the class string. `check-classes.mjs` records
                 the fragment before an interpolation as a dynamic PREFIX and
                 stops asserting it — so a templated `cmp__mn-r${…}` would have
                 hidden both this row's class and the broadcast modifier from the
                 check, and a missing rule would have shipped unstyled instead of
                 failing the build. Every name here is a quoted literal the
                 checker can see. */
              className={['cmp__mn-r', i === active ? 'on' : '', m.broadcast ? 'cmp__mn-b' : '']
                .filter(Boolean).join(' ')}
              /* onMouseDown with preventDefault, not onClick: a click fires
                 after the mousedown that has already blurred the textarea, and a
                 blurred textarea has no `selectionStart` to insert at. */
              onMouseDown={e => { e.preventDefault(); insert(m); }}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="cmp__mn-e" aria-hidden="true">
                {m.broadcast ? TRIGGER : m.full_name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="cmp__mn-n">
                {m.broadcast ? `${TRIGGER}${m.full_name}` : m.full_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
