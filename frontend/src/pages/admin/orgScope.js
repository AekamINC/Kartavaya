/**
 * orgScope.js — the fix for 11-platform-admin.md's headline finding.
 *
 * ── The finding, confirmed line by line ──────────────────────────────────────
 *
 * 11 §The finding: "/admin/billing is not a platform page. Every call it makes
 * is org-scoped… No `org_id` anywhere." Verified against the branch:
 *
 *   backend/routers/subscription.py:129   set_plan(…, org_id = Depends(get_org_id))
 *   backend/routers/subscription.py:287   create_invoice(…, org_id = Depends(get_org_id))
 *
 * and `/admin/invoices/overdue` (line 360) takes no org at all while returning
 * `inv.org_name` across every org. So the overdue list was cross-org and every
 * action beside it was single-tenant.
 *
 * ── One part of 11's finding does NOT hold, checked line by line ─────────────
 *
 * 11: "the 'Record Payment' button next to another org's overdue invoice posts
 * to an endpoint with no org context."  True of the signature, wrong about the
 * consequence. `record_payment` (subscription.py:325) takes no `get_org_id`
 * because it does not need one — it loads
 * `staging.subscription_invoices WHERE id = :invoice_id` and updates that row.
 * The invoice id IS the scope, so the payment cannot land on the operator's own
 * org no matter what header is sent.
 *
 * What was genuinely wrong is narrower and still worth fixing: the operator
 * could not SEE whose invoice they were marking paid, because the surrounding
 * page named a different org. `set-plan`, `create-invoice` and the module
 * toggles are the calls that really did resolve from the caller, and those are
 * the ones the header fixes.
 *
 * ── What 11 did not know ─────────────────────────────────────────────────────
 *
 * 11 concludes "Every platform endpoint needs an explicit org: /v1/admin/orgs/
 * :orgId/…. Until then the console cannot do the job its navigation promises."
 * That is one route to the fix, and it is a backend change.
 *
 * There is already another. `middleware/org_resolver.py:20` reads an
 * `X-Org-Id` header first, and lines 30-39 explicitly allow platform staff to
 * resolve to ANY org through it — the org switcher uses it. So the org context
 * these endpoints were missing is not missing from the server; it was missing
 * from the caller. Sending the header makes every one of them genuinely
 * cross-org with no backend change and no new endpoint.
 *
 * The header is still validated server-side (403 for a non-member without a
 * platform role, 404 for an inactive org), so this widens nothing: it supplies
 * a scope the server was always willing to accept and the console never sent.
 *
 * ── The one thing that must not happen ───────────────────────────────────────
 *
 * An invisible tenant scope on a page that raises invoices is worse than no
 * scope. `scoped()` is deliberately explicit at every call site rather than an
 * axios interceptor: an interceptor would attach the header to requests that
 * are not billing, and a page reading it out of module state would be one stale
 * render away from billing the wrong company. Pass the org, or do not send.
 */

/**
 * Per-request config carrying the org. Returns `undefined` when there is no
 * org, so `api.get(url, scoped(null))` is a plain unscoped call rather than a
 * call with an empty header.
 *
 *   api.get('/v1/subscription/invoices', scoped(orgId))
 *   api.post('/v1/subscription/admin/invoices', body, scoped(orgId))
 */
export function scoped(orgId, extra) {
  if (!orgId) return extra;
  const { headers, ...rest } = extra || {};
  return { ...rest, headers: { ...headers, 'X-Org-Id': orgId } };
}

/** localStorage key for the last org an operator was acting on. */
const KEY = 'kv_admin_scope_org';

export function readScope() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function writeScope(orgId) {
  try {
    if (orgId) localStorage.setItem(KEY, orgId);
    else localStorage.removeItem(KEY);
  } catch { /* private mode — the scope just does not persist */ }
}
