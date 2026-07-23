import React, { useState, useRef, useEffect } from "react";

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
    if (e.key === "Escape") setPopup(null);
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
        className="k-input"
        style={{ width: "100%", resize: "none", lineHeight: 1.5, boxSizing: "border-box" }}
      />
      {popup && filtered.length > 0 && (
        <div style={{
          position: "fixed", top: popup.anchorTop, left: popup.anchorLeft,
          background: "var(--surface)", border: "1px solid var(--rule)",
          borderRadius: "var(--r-md)", boxShadow: "var(--shadow-md)",
          zIndex: 999, minWidth: 220, maxWidth: 320, overflow: "hidden",
        }}>
          {filtered.map((m, i) => (
            <div
              key={m.user_id || m.display_name}
              onMouseDown={e => { e.preventDefault(); insertMention(m); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", cursor: "pointer", fontSize: 13,
                background: i === cursor ? "var(--bg-soft)" : "transparent",
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: "color-mix(in srgb, var(--k-primary) 15%, transparent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "var(--k-primary)", flexShrink: 0,
              }}>
                {m.display_name[0].toUpperCase()}
              </div>
              <span style={{ fontWeight: 500, color: "var(--ink)" }}>{m.display_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
