import React, { useState, useRef, useEffect } from "react";

/**
 * MentionTextarea — the comment composer, with an `@` autocomplete.
 *
 * Three things changed here, and each was a real defect rather than a rename:
 *
 *  · **The third token vocabulary.** 03 §"The finding that governs this file"
 *    names this file as one of the last holdouts on `--ink` / `--rule` /
 *    `--k-primary`. Those are legacy aliases in `kartavaya-design.css` that map
 *    onto the real tokens, so nothing was *broken* — but the alias block is
 *    explicitly a migration scaffold ("Add nothing here. Delete a line when its
 *    last reference is gone"), and a file that keeps referencing it is a file
 *    that keeps the scaffold alive. The names are the redesign's now.
 *  · **`--k-primary` was used as a TEXT colour.** It resolves to
 *    `--primary-vivid`, which is a fill. Primary-coloured text is
 *    `--primary-text` (5.2:1) — 00 §12. The mention avatar's initial was the
 *    accent on a 15% tint of itself, which is the self-tinted-chip failure 00
 *    §11 calls out by name: deepening the tint moves the ground *toward* the
 *    text, so it can never reach 4.5:1. It is `--primary-container` with
 *    `--on-primary-container` now, a declared pair.
 *  · **A hardcoded `z-index: 999`.** The ladder in 26 §4 is 200 drawer · 340
 *    picker and menu · 420 modal · 520 toast · 620 sheet. 999 sat above every
 *    one of them, so a mention list opened inside the drawer covered any toast
 *    raised while it was open. This popup is a picker: 340.
 *
 * The popup is `position: fixed` at coordinates measured from the caret, not
 * `position: absolute` inside the composer. That is what keeps it out of the
 * `overflow-y: auto` on `.dr__body` — an absolutely-positioned panel in a
 * scrolling drawer is clipped by the drawer, which is the open bug in
 * `ui/Picker.jsx`. Keep it fixed.
 */

const TRIGGER = "@";

export default function MentionTextarea({ value, onChange, onSubmit, members = [], placeholder = "Add a comment…", rows = 2 }) {
  const [popup, setPopup]   = useState(null);
  const [cursor, setCursor] = useState(0);
  const taRef = useRef(null);

  const filtered = popup
    ? (popup.query
        ? members.filter(m => m.display_name.toLowerCase().includes(popup.query.toLowerCase())).slice(0, 8)
        : members.slice(0, 8))
    : [];

  function getCaretCoords(el, caretPos) {
    const style = window.getComputedStyle(el);
    const mirror = document.createElement("div");
    mirror.style.cssText = [
      "position:absolute", "visibility:hidden", "white-space:pre-wrap",
      "word-wrap:break-word", "overflow-wrap:break-word",
      `width:${el.offsetWidth}px`,
      `font:${style.font}`, `padding:${style.padding}`,
      `border:${style.border}`, `line-height:${style.lineHeight}`,
    ].join(";");
    const pre = document.createTextNode(el.value.slice(0, caretPos));
    const span = document.createElement("span");
    span.textContent = "​"; // zero-width space marks caret
    mirror.appendChild(pre);
    mirror.appendChild(span);
    document.body.appendChild(mirror);
    const mirrorRect = mirror.getBoundingClientRect();
    const spanRect   = span.getBoundingClientRect();
    document.body.removeChild(mirror);
    const elRect = el.getBoundingClientRect();
    const top  = elRect.top  + (spanRect.top  - mirrorRect.top)  + span.offsetHeight + window.scrollY + 4;
    const left = elRect.left + (spanRect.left - mirrorRect.left) + window.scrollX;
    return { top, left };
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(text);
    const pos = e.target.selectionStart;
    const slice = text.slice(0, pos);
    const atIdx = slice.lastIndexOf(TRIGGER);
    if (atIdx !== -1) {
      const query = slice.slice(atIdx + 1);
      if (!query.includes(" ") && query.length <= 30) {
        const coords = getCaretCoords(e.target, atIdx);
        setPopup({ query, anchorTop: coords.top, anchorLeft: coords.left, atIdx });
        setCursor(0);
        return;
      }
    }
    setPopup(null);
  }

  function insertMention(member) {
    if (!popup) return;
    const before = value.slice(0, popup.atIdx);
    const after  = value.slice(popup.atIdx + 1 + popup.query.length);
    onChange(before + `@${member.display_name} ` + after);
    setPopup(null);
    taRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (!popup || filtered.length === 0) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit?.(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filtered[cursor]); }
    // stopPropagation, not just setPopup(null): Escape inside the drawer is also
    // the drawer's own close key, so dismissing the mention list would close the
    // whole panel and lose the half-written comment behind it.
    if (e.key === "Escape") { e.stopPropagation(); setPopup(null); }
  }

  useEffect(() => {
    function down(e) { if (!taRef.current?.contains(e.target)) setPopup(null); }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  return (
    <div style={{ position: "relative", flex: 1 }} ref={taRef}>
      <textarea
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className="inp"
        style={{ resize: "none", lineHeight: "var(--line-height-base)", boxSizing: "border-box" }}
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded={!!(popup && filtered.length > 0)}
      />
      {popup && filtered.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention a team member"
          style={{
            position: "fixed", top: popup.anchorTop, left: popup.anchorLeft,
            background: "var(--s-lowest)", border: "1px solid var(--outline-variant)",
            borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3)",
            zIndex: 340, minWidth: 220, maxWidth: 320, overflow: "hidden",
          }}
        >
          {filtered.map((m, i) => (
            <div
              key={m.user_id || m.display_name}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={e => { e.preventDefault(); insertMention(m); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", cursor: "pointer", fontSize: 13,
                background: i === cursor ? "var(--s-container)" : "transparent",
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: "var(--primary-container)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "var(--on-primary-container)", flexShrink: 0,
              }}>
                {m.display_name[0].toUpperCase()}
              </div>
              <span style={{ fontWeight: 500, color: "var(--on-surface)" }}>{m.display_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
