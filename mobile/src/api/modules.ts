import { apiClient } from './client';

/**
 * The seven light module surfaces (17-mobile-app.md §Screens).
 *
 * Every endpoint here is a real one, verified against the routers in
 * `backend/routers/`. Two conventions run through all of them and both bite if
 * you assume otherwise:
 *
 * 1. **Envelope.** The module routers return `{"data": [...]}` for lists and a
 *    bare object for summaries. `graha.list_deals`, `ganit.list_invoices`,
 *    `manav.list_leaves` and `vetana.list_payslips` are all enveloped;
 *    `ganit.invoice_stats`, `manav.hrms_stats`, `dristi.overview`,
 *    `prachar.dashboard` and `hub.hub_dashboard` are not. Mixing the two up
 *    produces `undefined.map` at render time rather than a type error, because
 *    axios hands back `any`.
 *
 * 2. **403 is an answer, not a failure.** Every module router mounts
 *    `require_module(code)`, which raises 403 when the org lacks the module OR
 *    when this user holds no grant for it. Screens must render that as the
 *    boundary it is — see `ScreenState`'s `forbidden`.
 *
 * Numeric columns arrive as strings from asyncpg's NUMERIC mapping in some
 * paths and as numbers in others, so every money and count field is typed
 * `number | string` and read through `num()` rather than trusted. A silent
 * `"248000" + "590000" = "248000590000"` is the failure this prevents.
 */

/** Coerce a NUMERIC-or-number field to a number. */
export function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

/**
 * Indian-format currency. Lakh/crore grouping, no decimals.
 *
 * `en-IN` grouping is the whole point — ₹28,90,000 is the readable form and
 * ₹2,890,000 is not, to the people using this.
 */
export function inr(v: number | string | null | undefined): string {
  return '₹' + Math.round(num(v)).toLocaleString('en-IN');
}

/** Compact form for stat tiles, where the full number does not fit at 393px. */
export function inrCompact(v: number | string | null | undefined): string {
  const n = Math.round(num(v));
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return '₹' + (n / 1_00_00_000).toFixed(abs >= 10_00_00_000 ? 0 : 1) + ' Cr';
  if (abs >= 1_00_000)    return '₹' + (n / 1_00_000).toFixed(abs >= 10_00_000 ? 0 : 1) + ' L';
  if (abs >= 1_000)       return '₹' + (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + 'k';
  return '₹' + n.toLocaleString('en-IN');
}

interface Envelope<T> { data: T[] }

// ── Graha · CRM ──────────────────────────────────────────────────────────────

export interface Deal {
  id:                   string;
  title:                string;
  value:                number | string | null;
  stage:                string | null;
  probability:          number | null;
  expected_close_date:  string | null;
  contact_name:         string | null;
  contact_company:      string | null;
  client_name:          string | null;
  created_at:           string;
}

export interface PipelineStage {
  stage:       string | null;
  count:       number | string;
  total_value: number | string;
}

export const grahaApi = {
  /** GET /api/v1/graha/pipeline-summary — grouped by stage. */
  pipelineSummary: () =>
    apiClient.get<Envelope<PipelineStage>>('/v1/graha/pipeline-summary').then(r => r.data.data ?? []),

  /** GET /api/v1/graha/deals — newest 200. */
  deals: () =>
    apiClient.get<Envelope<Deal>>('/v1/graha/deals').then(r => r.data.data ?? []),
};

// ── Ganit · Invoicing ────────────────────────────────────────────────────────

export interface InvoiceStats {
  unpaid_count:      number | string;
  total_outstanding: number | string;
  total_collected:   number | string;
  overdue_count:     number | string;
  total_invoices:    number | string;
}

export interface Invoice {
  id:              string;
  invoice_number:  string;
  invoice_date:    string | null;
  due_date:        string | null;
  total:           number | string;
  amount_paid:     number | string;
  balance_due:     number | string;
  payment_status:  string | null;
  contact_name:    string | null;
  contact_company: string | null;
}

export const ganitApi = {
  /** GET /api/v1/ganit/stats — tax invoices only, server-side. */
  stats: () =>
    apiClient.get<InvoiceStats>('/v1/ganit/stats').then(r => r.data),

  /** GET /api/v1/ganit/invoices */
  invoices: () =>
    apiClient.get<Envelope<Invoice>>('/v1/ganit/invoices', { params: { invoice_type: 'tax_invoice' } })
      .then(r => r.data.data ?? []),
};

// ── Manav · HR ───────────────────────────────────────────────────────────────

export interface HrStats {
  total_employees:      number | string;
  departments:          number | string;
  pending_leaves:       number | string;
  today_present:        number | string;
  pending_leaves_today: number | string;
  clocked_in_count:     number | string;
  on_leave_today:       number | string;
}

export interface LeaveRequest {
  id:                string;
  start_date:        string | null;
  end_date:          string | null;
  days:              number | string | null;
  reason:            string | null;
  status:            string;
  employee_name:     string | null;
  employee_code:     string | null;
  leave_type_name:   string | null;
  created_at:        string;
}

export interface Holiday {
  id:        string;
  name:      string;
  date:      string;
  is_optional?: boolean;
}

export const manavApi = {
  /** GET /api/v1/manav/stats */
  stats: () =>
    apiClient.get<HrStats>('/v1/manav/stats').then(r => r.data),

  /** GET /api/v1/manav/leaves?status=pending */
  pendingLeaves: () =>
    apiClient.get<Envelope<LeaveRequest>>('/v1/manav/leaves', { params: { status: 'pending' } })
      .then(r => r.data.data ?? []),

  /** GET /api/v1/manav/holidays — current calendar year, ordered by date. */
  holidays: () =>
    apiClient.get<Envelope<Holiday>>('/v1/manav/holidays').then(r => r.data.data ?? []),

  /**
   * PATCH /api/v1/manav/leaves/{id}/action
   *
   * The one write on a light module surface, and it is here because the
   * reference design is explicit that approving leave from a phone is real work
   * rather than a convenience: "Approving here posts to the same leave ledger as
   * desktop. Rejecting asks for a reason first."
   *
   * Three server behaviours the caller has to respect:
   *   · `status` must be exactly 'approved' or 'rejected' — anything else 400s.
   *   · A request that is not still `pending` 400s with "already {status}",
   *     which is the correct answer when two managers act at once.
   *   · Approving also debits the employee's leave balance and emails them.
   *     That makes it a poor candidate for the offline queue — a decision
   *     replayed hours later mails a stale answer — so this deliberately does
   *     NOT go through useOfflineMutation, matching ApprovalsScreen.
   */
  actionLeave: (leaveId: string, status: 'approved' | 'rejected', rejectionReason?: string) =>
    apiClient.patch<{ status: string }>(`/v1/manav/leaves/${leaveId}/action`, {
      status,
      rejection_reason: rejectionReason ?? '',
    }).then(r => r.data),
};

// ── Vetana · Payroll ─────────────────────────────────────────────────────────

/**
 * Column names are the table's, not the payslip's vocabulary: `gross` rather
 * than gross_earnings, `disbursed_at` rather than paid_on, and `status` is the
 * three-value CHECK from migration 020 — generated / approved / disbursed.
 * `list_payslips` does `SELECT p.*`, so what comes back is exactly the table.
 */
export interface Payslip {
  id:               string;
  payslip_number:   string | null;
  month:            string;
  gross:            number | string | null;
  total_deductions: number | string | null;
  net_pay:          number | string | null;
  status:           'generated' | 'approved' | 'disbursed' | string | null;
  disbursed_at:     string | null;
  employee_name:    string | null;
}

export const vetanaApi = {
  /**
   * GET /api/v1/vetana/payslips
   *
   * Self-scoped by the SERVER, not by a query param: `list_payslips` overrides
   * `employee_id` with the caller's own employee row unless they are a payroll
   * admin, and 403s if they ask for someone else's. The mobile screen therefore
   * passes nothing — asking for "mine" is the default, and building the param
   * client-side would be a check the server has already made better.
   */
  payslips: () =>
    apiClient.get<Envelope<Payslip>>('/v1/vetana/payslips').then(r => r.data.data ?? []),
};

// ── Dristi · Analytics ───────────────────────────────────────────────────────

export interface DristiOverview {
  tasks:   { total_tasks?: number | string; done_tasks?: number | string; active_tasks?: number | string; overdue_tasks?: number | string };
  crm:     { total_contacts?: number | string; leads?: number | string; customers?: number | string };
  deals:   { total_deals?: number | string; pipeline_value?: number | string; won_deals?: number | string; won_value?: number | string; lost_deals?: number | string };
  revenue: { total_invoiced?: number | string; total_collected?: number | string; outstanding?: number | string };
  hr:      { headcount?: number | string };
  orders:  { total_orders?: number | string; order_value?: number | string; fulfilled?: number | string };
  payroll: { ytd_payroll?: number | string; ytd_statutory?: number | string };
}

export interface RevenuePoint {
  month:     string;
  invoiced:  number;
  collected: number;
  expenses:  number;
  profit:    number;
}

export const dristiApi = {
  /** GET /api/v1/dristi/overview — one call, seven blocks. */
  overview: () =>
    apiClient.get<DristiOverview>('/v1/dristi/overview').then(r => r.data),

  /**
   * GET /api/v1/dristi/revenue?months=6
   *
   * The one endpoint in this file that is neither enveloped in `data` nor bare:
   * `revenue_trends` returns `{"trend": [...], "labels": [...]}`, and the server
   * caps `months` at 12. Every point is pre-filled for every month in the range,
   * so the array is dense and safe to index — a month with no invoices comes
   * back as zeroes rather than being absent.
   */
  revenue: (months = 6) =>
    apiClient.get<{ trend: RevenuePoint[]; labels: string[] }>('/v1/dristi/revenue', { params: { months } })
      .then(r => r.data.trend ?? []),
};

// ── Srijan · AI content hub ──────────────────────────────────────────────────

export interface HubDashboard {
  stats: {
    total_clients?:  number | string;
    total_credits?:  number | string;
    total_content?:  number | string;
    pending_review?: number | string;
  };
  recent_content: {
    id:          string;
    title:       string | null;
    agent_type:  string | null;
    status:      string | null;
    created_at:  string;
    client_name: string | null;
  }[];
}

export const srijanApi = {
  /**
   * GET /api/v1/hub/dashboard — gated by `require_module("srijan")`.
   *
   * The org-level dashboard, not a per-client one. `hub_chat`'s session
   * endpoints are all `/clients/{client_id}/…`, so an assistant surface would
   * first have to make the user pick a client — and then spend model credits
   * per question from a phone. The checking view is the right mobile shape and
   * needs no client selection.
   */
  dashboard: () =>
    apiClient.get<HubDashboard>('/v1/hub/dashboard').then(r => r.data),
};

// ── Prachar · Marketing ──────────────────────────────────────────────────────

export interface PracharDashboard {
  campaigns: { total?: number | string; sent?: number | string; sending?: number | string; drafts?: number | string; scheduled?: number | string };
  delivery:  { total_sent?: number | string; total_opened?: number | string; total_clicked?: number | string; total_bounced?: number | string };
  templates_count:    number | string;
  automations_count:  number | string;
  unsubscribes_count: number | string;
  recent_campaigns: {
    id:               string;
    name:             string | null;
    status:           string | null;
    total_recipients: number | string | null;
    total_opened:     number | string | null;
    total_clicked:    number | string | null;
    sent_at:          string | null;
  }[];
}

export const pracharApi = {
  /** GET /api/v1/prachar/dashboard */
  dashboard: () =>
    apiClient.get<PracharDashboard>('/v1/prachar/dashboard').then(r => r.data),
};
