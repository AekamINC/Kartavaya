import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import FocusTrap from './FocusTrap';

export function CommandPalette({ open, onOpenChange, commands = [], onSelect }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = commands.filter(cmd => {
    const q = query.toLowerCase();
    return cmd.label.toLowerCase().includes(q)
      || cmd.section?.toLowerCase().includes(q)
      || cmd.keywords?.some(k => k.toLowerCase().includes(q));
  });

  const grouped = filtered.reduce((acc, cmd) => {
    const section = cmd.section || 'Actions';
    if (!acc[section]) acc[section] = [];
    acc[section].push(cmd);
    return acc;
  }, {});

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      e.preventDefault();
      onSelect?.(filtered[selectedIdx]);
      onOpenChange(false);
    } else if (e.key === 'Escape') {
      onOpenChange(false);
    }
  }, [filtered, selectedIdx, onSelect, onOpenChange]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx];
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIdx]);

  if (!open) return null;

  let flatIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
      role="presentation"
    >
      {/* Trap wraps the panel, not the scrim. Without it Tab walked straight out
          of the open palette into the page behind, and closing dropped focus at
          <body> instead of returning it to the search trigger. */}
      <FocusTrap active>
      <div
        className="w-full max-w-lg rounded-2xl border border-borderDefault/60 bg-bgDefault shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-borderDefault/60">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-textMuted flex-shrink-0">
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-textDefault outline-none placeholder:text-textSubtle"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-textMuted bg-bgMuted/60 border border-borderDefault/40">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-textMuted">
              No results found
            </div>
          ) : (
            Object.entries(grouped).map(([section, items]) => (
              <div key={section}>
                <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-textSubtle">
                  {section}
                </div>
                {items.map(cmd => {
                  flatIdx++;
                  const idx = flatIdx;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={() => { onSelect?.(cmd); onOpenChange(false); }}
                      className={cn(
                        'flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm transition-colors',
                        idx === selectedIdx
                          ? 'bg-accent/10 text-accent'
                          : 'text-textDefault hover:bg-bgMuted/40',
                      )}
                    >
                      {cmd.icon && <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-textMuted">{cmd.icon}</span>}
                      <span className="flex-1 font-medium">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="text-[10px] font-medium text-textSubtle bg-bgMuted/40 px-1.5 py-0.5 rounded border border-borderDefault/30">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-borderDefault/60 text-[10px] text-textSubtle">
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-bgMuted/60 rounded font-medium border border-borderDefault/40">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-bgMuted/60 rounded font-medium border border-borderDefault/40">↵</kbd> Select</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-bgMuted/60 rounded font-medium border border-borderDefault/40">esc</kbd> Close</span>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
