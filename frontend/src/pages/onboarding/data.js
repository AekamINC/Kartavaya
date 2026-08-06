/**
 * Onboarding data — 12-auth-onboarding.md §2, AUTH-SPEC "Onboarding wizard".
 *
 * Module ids and their Devanagari names come from `lib/moduleColors.js`, which
 * is the one registry; nothing here restates a label that file already owns.
 * What lives here is the part the registry has no opinion about: which modules
 * an industry starts with, which ones hold money or personal data, and what a
 * board template seeds.
 */

/** Modules offered at setup, in the order the design shows them. */
export const OB_MODULES = [
  { code: 'boards', d: 'Projects, boards, tasks, time' },
  { code: 'graha', d: 'CRM, contacts, deals, follow-ups' },
  { code: 'vikray', d: 'Orders, stock, targets' },
  { code: 'ganit', d: 'GST invoices, expenses, e-way bills', sensitive: true },
  { code: 'manav', d: 'Employees, leave, documents', sensitive: true },
  { code: 'vetana', d: 'Payroll, payslips, PF and TDS', sensitive: true },
  { code: 'pahchan', d: 'Face attendance, shifts, geo-fence' },
  { code: 'sanvaad', d: 'Team channels and WhatsApp inbox' },
  { code: 'prachar', d: 'Campaigns, sequences, ads' },
  { code: 'sahayak', d: 'AI assistant across your data' },
  { code: 'dristi', d: 'Reports, dashboards, pivots' },
  { code: 'esign', d: 'Send, sign, store agreements' },
];

export const INDUSTRIES = [
  'CA / Legal practice', 'IT Services', 'Manufacturing',
  'Retail & Trading', 'Agency', 'Consulting', 'Other',
];

/**
 * Preselection follows the industry, not a house default — AUTH-SPEC. The ids
 * are `moduleColors.js` ids; the spec writes the first one as `kartavya`, which
 * is the product name rather than a module id. Boards is the module that
 * carries projects and tasks in this codebase.
 */
export const OB_PRESETS = {
  'CA / Legal practice': ['boards', 'ganit', 'graha', 'esign'],
  'IT Services': ['boards', 'graha', 'sanvaad', 'dristi'],
  'Manufacturing': ['boards', 'ganit', 'vikray', 'manav', 'pahchan'],
  'Retail & Trading': ['ganit', 'vikray', 'graha', 'pahchan'],
  'Agency': ['boards', 'graha', 'prachar', 'sahayak', 'sanvaad'],
  'Consulting': ['boards', 'graha', 'ganit', 'dristi'],
  'Other': ['boards', 'graha', 'ganit'],
};

export const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];

/** A template only seeds columns and labels. Nothing it creates is locked. */
export const OB_TEMPLATES = [
  { id: 'blank', name: 'Blank', hi: 'नया', d: 'Three columns and nothing else. Build it your way.', cols: ['To Do', 'In Progress', 'Done'] },
  { id: 'software', name: 'Software delivery', hi: 'विकास', d: 'Sprints, review and release columns.', cols: ['Backlog', 'In Progress', 'In Review', 'QA', 'Released'] },
  { id: 'marketing', name: 'Marketing campaign', hi: 'अभियान', d: 'Brief through publish, with an approval gate before anything goes live.', cols: ['Brief', 'Draft', 'Approval', 'Scheduled', 'Live'] },
  { id: 'client', name: 'Client project', hi: 'ग्राहक', d: 'Client-visible board with internal items hidden by default.', cols: ['Scoping', 'In Progress', 'Client Review', 'Signed Off'] },
  { id: 'gst', name: 'GST filing cycle', hi: 'कर', d: 'A month of returns — 2B reconciliation, working notes, filing.', cols: ['Collect', 'Reconcile', 'Review', 'Filed'] },
  { id: 'hr', name: 'HR onboarding', hi: 'भर्ती', d: 'Offer to day one, with document collection built in.', cols: ['Offer', 'Documents', 'Setup', 'Day One'] },
];

export const OB_TIPS = [
  ['Press ⌘K anywhere', 'One search for records, actions and navigation. Learn this and skip the sidebar entirely.'],
  ['Esc walks back', 'Never a dead end — Esc closes the drawer, then the panel, then clears focus.'],
  ['Add it to your phone', 'Kartavaya is a PWA. Attendance and approvals work offline for 72 hours.'],
];

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
