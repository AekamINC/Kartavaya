import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ICONS = {
  nav: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 3l5 5-5 5"/></svg>,
  action: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 3v10M3 8h10"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>,
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Today', hi: 'आज', section: 'Navigate', route: '/dashboard', keywords: 'dashboard home today' },
  { id: 'tasks', label: 'Tasks', hi: 'कर्तव्य', section: 'Navigate', route: '/tasks', keywords: 'tasks todo' },
  { id: 'boards', label: 'Boards', hi: 'फ़लक', section: 'Navigate', route: '/boards', keywords: 'boards kanban' },
  { id: 'projects', label: 'Projects', hi: 'योजना', section: 'Navigate', route: '/projects', keywords: 'projects' },
  { id: 'approvals', label: 'Approvals', hi: 'सम्मति', section: 'Navigate', route: '/approvals', keywords: 'approvals pending' },
  { id: 'activity', label: 'Activity', hi: 'क्रिया', section: 'Navigate', route: '/activity', keywords: 'activity feed log' },
  { id: 'automations', label: 'Automations', hi: 'स्वचालन', section: 'Navigate', route: '/automations', keywords: 'automations rules' },
  { id: 'time', label: 'Time Report', hi: 'काल', section: 'Navigate', route: '/time', keywords: 'time tracking report hours' },
  { id: 'reports', label: 'Reports', hi: 'प्रतिवेदन', section: 'Navigate', route: '/reports', keywords: 'reports analytics' },
  { id: 'templates', label: 'Templates', hi: 'साँचा', section: 'Navigate', route: '/templates', keywords: 'templates' },
  { id: 'teams', label: 'Team', hi: 'सहयोगी', section: 'Navigate', route: '/teams', keywords: 'team members people' },
  { id: 'inbox', label: 'Inbox', hi: 'सन्देश', section: 'Navigate', route: '/inbox', keywords: 'inbox messages chat' },
  { id: 'graha', label: 'CRM', hi: 'ग्राहक', section: 'Navigate', route: '/graha', keywords: 'crm contacts leads graha' },
  { id: 'ganit', label: 'Invoicing', hi: 'गणित', section: 'Navigate', route: '/ganit', keywords: 'invoicing billing ganit invoices' },
  { id: 'manav', label: 'HRMS', hi: 'मानव', section: 'Navigate', route: '/manav', keywords: 'hrms hr employees manav' },
  { id: 'vikray', label: 'Sales', hi: 'विक्रय', section: 'Navigate', route: '/vikray', keywords: 'sales pipeline vikray deals' },
  { id: 'vetana', label: 'Payroll', hi: 'वेतन', section: 'Navigate', route: '/vetana', keywords: 'payroll salary vetana' },
  { id: 'dristi', label: 'Analytics', hi: 'दृष्टि', section: 'Navigate', route: '/dristi', keywords: 'analytics dashboard dristi charts' },
  { id: 'prachar', label: 'Marketing', hi: 'प्रचार', section: 'Navigate', route: '/prachar', keywords: 'marketing campaigns prachar' },
  { id: 'esign', label: 'E-Sign', hi: 'प्रमाण', section: 'Navigate', route: '/esign', keywords: 'esign documents signatures' },
  { id: 'srijan', label: 'Srijan', hi: 'सृजन', section: 'Navigate', route: '/hub/org', keywords: 'srijan content ai generate' },
  // Was also '/hub/org', identical to Srijan above — picking "Data Tools" and
  // landing on Srijan is the kind of thing that stops a user trusting the
  // palette. Data Tools live as tabs inside Srijan, so it deep-links there.
  { id: 'scrapers', label: 'Data Tools', hi: 'डेटा टूल्स', section: 'Navigate', route: '/hub/org?tab=scrapers', keywords: 'scrapers data tools leads' },
  { id: 'categories', label: 'Categories', hi: 'वर्ग', section: 'Navigate', route: '/settings/categories', keywords: 'settings categories tags' },
  { id: 'notifications', label: 'Notifications', hi: 'सूचना', section: 'Navigate', route: '/settings/customize?tab=notifications', keywords: 'settings notifications' },
  { id: 'customize', label: 'Customize', hi: 'सजावट', section: 'Navigate', route: '/settings/customize', keywords: 'settings customize theme' },
  { id: 'billing', label: 'Billing', hi: 'बिलिंग', section: 'Navigate', route: '/billing', keywords: 'billing subscription plan' },
];

const ACTION_ITEMS = [
  { id: 'new-task', label: 'New Task', hi: 'नया कार्य', section: 'Actions', action: 'newTask', keywords: 'create new task add' },
  { id: 'new-invoice', label: 'New Invoice', hi: 'नया चालान', section: 'Actions', route: '/ganit', keywords: 'create new invoice bill' },
  { id: 'new-contact', label: 'New Contact', hi: 'नया संपर्क', section: 'Actions', route: '/graha', keywords: 'create new contact lead crm' },
  { id: 'new-project', label: 'New Project', hi: 'नई योजना', section: 'Actions', route: '/projects', keywords: 'create new project' },
];

const ALL_ITEMS = [...ACTION_ITEMS, ...NAV_ITEMS];

/**
 * Score by WHERE the match lands and HOW early — never rank a subsequence hit
 * above a substring hit.
 *
 * The previous version ran one subsequence test over a 40-character
 * concatenation of label + hi + keywords, so almost any three-letter query
 * matched almost everything: type "ate" and most of the 30 items scored 1, then
 * sorted in source order because the comparator had nothing to break ties with.
 * The list barely changed as you typed, which reads as "search is broken".
 */
export function fuzzyMatch(query, item) {
  const q = query.trim().toLowerCase();
  if (!q) return 100;

  const label = (item.label || '').toLowerCase();
  const hi = (item.hi || '').toLowerCase();
  const keywords = (item.keywords || '').toLowerCase();

  if (label.startsWith(q)) return 90 - Math.min(label.length - q.length, 20);
  if (hi.startsWith(q)) return 88;

  const at = label.indexOf(q);
  if (at > -1) {
    // Word-boundary hits beat mid-word ones: "inv" should find "New Invoice"
    // before it finds anything merely containing "inv".
    const boundary = at === 0 || label[at - 1] === ' ';
    return (boundary ? 75 : 60) - Math.min(at, 15);
  }
  if (hi.includes(q)) return 55;
  if (keywords.includes(q)) return 40;

  // Subsequence, last resort, and only over the label — running it across the
  // keyword blob is what made everything match.
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : 0;
}

export default function CommandPalette({ open, onClose, onNewTask }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();

  const results = useMemo(() => {
    if (!query.trim()) return ALL_ITEMS;
    return ALL_ITEMS
      .map(item => ({ item, score: fuzzyMatch(query, item) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.item);
  }, [query]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const execute = useCallback((item) => {
    onClose();
    if (item.action === 'newTask') {
      onNewTask?.();
    } else if (item.route) {
      navigate(item.route);
    }
  }, [navigate, onClose, onNewTask]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIdx]) {
      e.preventDefault();
      execute(results[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [results, activeIdx, execute, onClose]);

  // scrollIntoView — even with block:'nearest' — can scroll ANCESTOR containers,
  // which is the same call that made Sanvaad's scrollback unreadable. The list
  // is a known height with known rows, so scroll it directly and touch nothing
  // outside it.
  useEffect(() => {
    const el = listRef.current;
    const row = el?.children[activeIdx];
    if (!el || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [activeIdx]);

  if (!open) return null;

  const grouped = {};
  results.forEach(item => {
    if (!grouped[item.section]) grouped[item.section] = [];
    grouped[item.section].push(item);
  });

  let flatIdx = 0;

  return (
    <div className="k-cmdk-overlay" onClick={onClose}>
      <div className="k-cmdk" onClick={e => e.stopPropagation()}>
        <div className="k-cmdk__input-wrap">
          {ICONS.search}
          <input
            ref={inputRef}
            className="k-cmdk__input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search…"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="k-kbd" style={{ fontSize: 11, padding: '2px 6px' }}>ESC</kbd>
        </div>
        <div className="k-cmdk__list" ref={listRef}>
          {results.length === 0 && (
            <div className="k-cmdk__empty">No results found</div>
          )}
          {Object.entries(grouped).map(([section, items]) => (
            <React.Fragment key={section}>
              <div className="k-cmdk__section">{section}</div>
              {items.map(item => {
                const idx = flatIdx++;
                return (
                  <button
                    key={item.id}
                    className={`k-cmdk__item ${idx === activeIdx ? 'k-cmdk__item--active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => execute(item)}
                    data-active={idx === activeIdx}
                  >
                    <span className="k-cmdk__icon">
                      {item.section === 'Actions' ? ICONS.action : ICONS.nav}
                    </span>
                    <span className="k-cmdk__label">{item.label}</span>
                    <span className="k-cmdk__hi">{item.hi}</span>
                    {idx === activeIdx && (
                      <span className="k-cmdk__hint">
                        <kbd className="k-kbd" style={{ fontSize: 10, padding: '1px 5px' }}>↵</kbd>
                      </span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
