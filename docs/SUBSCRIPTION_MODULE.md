# Subscription & Billing Module — Implementation Guide

> **Target**: Q3 2026 (ships with first paid module) | **Dependencies**: Core Platform
> **Stack**: FastAPI, Supabase PostgreSQL, React 19
> **Branch**: `feature/subscription-module`
> **Billing**: Manual — sales/directors handle invoicing and payment collection

---

## 1. Pricing Model

### Base Tiers

| Tier | Price | Max Users | Features |
|------|-------|-----------|----------|
| Free | ₹0 | 5 | Core (tasks, projects, docs) |
| Professional | ₹99/user/mo | Unlimited | Core + add-ons available |
| Business | ₹149/user/mo | Unlimited | Core + priority support + add-ons |
| Enterprise | ₹249/user/mo | Unlimited | Everything + dedicated support + custom integrations |

### Module Add-Ons (Professional+ only)

| Module | Price/user/mo | Requires |
|--------|--------------|----------|
| CRM | ₹49 | — |
| GST Invoicing | ₹29 | CRM |
| HRMS | ₹39 | — |
| Biometric Attendance | ₹19 | HRMS |
| Payroll | ₹59 | HRMS |
| WhatsApp Business | ₹29 | — |
| Analytics Pro | ₹19 | — |

---

## 2. Database Migration

Create `backend/migrations/015_subscription_module.sql`:

```sql
-- ============================================================
-- Migration 015: Subscription & Billing Module
-- Billing: Manual (no payment gateway)
-- ============================================================

-- 1. Plans
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE CHECK (code IN ('free', 'professional', 'business', 'enterprise')),
    price_monthly DECIMAL(10,2) NOT NULL,
    price_annual DECIMAL(10,2) NOT NULL,    -- per user, annual billing (e.g., 99*10 months)
    max_users INTEGER,                       -- NULL = unlimited
    features JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add-On Modules
CREATE TABLE add_on_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    price_per_user_monthly DECIMAL(8,2) NOT NULL,
    requires_module TEXT[] DEFAULT '{}',      -- dependency: ['hrms'] for payroll
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Subscriptions (one per org)
CREATE TABLE subscriptions (
    org_id UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    billing_cycle TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_cycle IN ('monthly', 'annual')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'paused')),
    
    trial_ends_at TIMESTAMPTZ,
    current_period_start DATE,
    current_period_end DATE,
    next_billing_date DATE,
    
    -- Manual billing
    activated_by UUID REFERENCES users(id),  -- sales/director who activated
    notes TEXT,                               -- internal notes
    
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Module Subscriptions (feature gating)
CREATE TABLE module_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL,           -- matches add_on_modules.code
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    
    UNIQUE(org_id, module_code)
);

CREATE INDEX idx_mod_sub_org ON module_subscriptions(org_id);
CREATE INDEX idx_mod_sub_active ON module_subscriptions(org_id, is_active) WHERE is_active = TRUE;

-- 5. Subscription Invoices (manually created by admin)
CREATE TABLE subscription_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    line_items JSONB NOT NULL DEFAULT '[]',
    -- [{description, qty, unit_price, amount}]
    
    subtotal DECIMAL(12,2) NOT NULL,
    gst DECIMAL(12,2) NOT NULL,          -- 18% GST on SaaS
    total DECIMAL(12,2) NOT NULL,
    
    -- Manual payment tracking
    payment_status TEXT DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_method TEXT DEFAULT 'bank_transfer'
        CHECK (payment_method IN ('bank_transfer', 'upi', 'cheque', 'cash', 'other')),
    payment_reference TEXT,              -- UTR / cheque number / UPI ref
    collected_by UUID REFERENCES users(id),   -- who collected payment
    approved_by UUID REFERENCES users(id),    -- who approved the invoice
    due_date DATE,
    paid_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    pdf_url TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_inv_org ON subscription_invoices(org_id);
CREATE INDEX idx_inv_overdue ON subscription_invoices(due_date, payment_status)
    WHERE payment_status = 'pending';

-- 6. Usage Tracking
CREATE TABLE usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,                -- active_users, storage_gb, whatsapp_messages, api_calls
    value DECIMAL(12,2) NOT NULL,
    recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
    
    UNIQUE(org_id, metric, recorded_at)
);

CREATE INDEX idx_usage_org ON usage_tracking(org_id, metric);

-- 7. Subscription Events (audit log)
CREATE TABLE subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    -- created, upgraded, downgraded, module_added, module_removed,
    -- invoice_created, payment_recorded, cancelled, trial_expired
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_events_org ON subscription_events(org_id);
CREATE INDEX idx_sub_events_type ON subscription_events(event_type, created_at);

-- 8. RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sub_org ON subscriptions USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY mod_sub_org ON module_subscriptions USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY inv_org ON subscription_invoices USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY usage_org ON usage_tracking USING (org_id = current_setting('app.current_org_id')::uuid);
CREATE POLICY events_org ON subscription_events USING (org_id = current_setting('app.current_org_id')::uuid);

-- 9. Seed Plans
INSERT INTO plans (name, code, price_monthly, price_annual, max_users, features) VALUES
('Free', 'free', 0, 0, 5, '{"tasks": true, "projects": true, "docs": true, "kanban": true}'),
('Professional', 'professional', 99, 990, NULL, '{"tasks": true, "projects": true, "docs": true, "kanban": true, "addons": true, "api_access": true}'),
('Business', 'business', 149, 1490, NULL, '{"tasks": true, "projects": true, "docs": true, "kanban": true, "addons": true, "api_access": true, "priority_support": true, "custom_branding": true}'),
('Enterprise', 'enterprise', 249, 2490, NULL, '{"tasks": true, "projects": true, "docs": true, "kanban": true, "addons": true, "api_access": true, "priority_support": true, "custom_branding": true, "dedicated_support": true, "custom_integrations": true, "sla": true}');

-- 10. Seed Add-On Modules
INSERT INTO add_on_modules (name, code, price_per_user_monthly, requires_module, description) VALUES
('CRM', 'crm', 49, '{}', 'Lead management, deal pipeline, GST quotations & invoices'),
('GST Invoicing', 'gst_invoicing', 29, '{crm}', 'CGST/SGST/IGST compliant invoicing with HSN codes'),
('HRMS', 'hrms', 39, '{}', 'Employee directory, attendance, leave management'),
('Biometric Attendance', 'biometric', 19, '{hrms}', 'Facial recognition, fingerprint, geo-fenced attendance'),
('Payroll', 'payroll', 59, '{hrms}', 'Salary computation, PF/ESI/TDS, payslips, Form 130'),
('WhatsApp Business', 'whatsapp', 29, '{}', 'WhatsApp Business API integration, templates, broadcasts'),
('Analytics Pro', 'analytics_pro', 19, '{}', 'Custom dashboards, scheduled reports, data export');

-- 11. Default subscription for existing orgs (Free plan)
-- Run after migration:
-- INSERT INTO subscriptions (org_id, plan_id, status, trial_ends_at)
-- SELECT o.id, (SELECT id FROM plans WHERE code = 'free'), 'active', NULL
-- FROM organisations o
-- WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.org_id = o.id);
```

---

## 3. Backend — FastAPI Router

Create `backend/routers/subscription.py`:

```python
"""
Subscription & Billing Router
Plan management, manual billing by sales/directors, module activation
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from uuid import UUID
from datetime import date, datetime, timedelta
from decimal import Decimal
from pydantic import BaseModel
from ..dependencies import get_current_user, get_db, require_role

router = APIRouter(prefix="/api/v1/subscription", tags=["Subscription"])


# ── Pydantic Models ──────────────────────────────────────────

class ModuleActivate(BaseModel):
    module_code: str

class PlanChange(BaseModel):
    org_id: UUID
    plan_code: str
    billing_cycle: str = "monthly"
    notes: str = ""

class InvoiceCreate(BaseModel):
    org_id: UUID
    period_start: date
    period_end: date
    due_date: date
    line_items: list[dict]    # [{description, qty, unit_price, amount}]
    notes: str = ""

class RecordPayment(BaseModel):
    payment_method: str       # bank_transfer, upi, cheque, cash, other
    payment_reference: str    # UTR / cheque no / UPI ref
    paid_at: datetime = None


# ── Public Endpoints ─────────────────────────────────────────

@router.get("/plans")
async def list_plans(db=Depends(get_db)):
    """List all plans and add-on modules. Public endpoint."""
    plans = db.table("plans").select("*").eq("is_active", True).order("price_monthly").execute()
    modules = db.table("add_on_modules").select("*").eq("is_active", True).order("price_per_user_monthly").execute()
    return {"plans": plans.data, "modules": modules.data}


# ── Current Subscription ────────────────────────────────────

@router.get("/current")
async def get_current(user=Depends(get_current_user), db=Depends(get_db)):
    """Get org's current subscription + active modules."""
    sub = db.table("subscriptions").select("*, plans(*)").eq("org_id", str(user.org_id)).single().execute()
    modules = db.table("module_subscriptions").select("*").eq("org_id", str(user.org_id)).eq("is_active", True).execute()
    user_count = db.table("users").select("id", count="exact").eq("org_id", str(user.org_id)).execute()
    
    return {
        "subscription": sub.data,
        "active_modules": [m["module_code"] for m in modules.data],
        "user_count": user_count.count
    }


# ── Admin: Plan Management (sales/directors only) ───────────

@router.post("/admin/set-plan")
async def admin_set_plan(body: PlanChange, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    """
    Admin: Set an org's plan. Used by sales/directors to onboard or change plans.
    """
    plan = db.table("plans").select("*").eq("code", body.plan_code).single().execute()
    if not plan.data:
        raise HTTPException(400, "Invalid plan")
    
    # Get current plan for audit
    current = db.table("subscriptions").select("*, plans(code)").eq("org_id", str(body.org_id)).execute()
    old_code = current.data[0]["plans"]["code"] if current.data else "none"
    
    tier_order = {"none": -1, "free": 0, "professional": 1, "business": 2, "enterprise": 3}
    direction = "upgraded" if tier_order.get(body.plan_code, 0) > tier_order.get(old_code, 0) else "downgraded"
    
    sub_data = {
        "org_id": str(body.org_id),
        "plan_id": plan.data["id"],
        "billing_cycle": body.billing_cycle,
        "status": "active",
        "activated_by": str(user.id),
        "notes": body.notes,
        "current_period_start": date.today().isoformat(),
        "current_period_end": (date.today() + timedelta(days=30 if body.billing_cycle == "monthly" else 365)).isoformat(),
        "next_billing_date": (date.today() + timedelta(days=30 if body.billing_cycle == "monthly" else 365)).isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    db.table("subscriptions").upsert(sub_data).execute()
    
    # If downgrading to free, deactivate all modules
    if body.plan_code == "free":
        db.table("module_subscriptions").update({
            "is_active": False,
            "deactivated_at": datetime.utcnow().isoformat()
        }).eq("org_id", str(body.org_id)).execute()
    
    _log_event(db, body.org_id, direction, {
        "from": old_code, "to": body.plan_code,
        "set_by": str(user.id), "notes": body.notes
    })
    
    return {"status": direction, "plan": body.plan_code}


# ── Admin: Invoice Management ───────────────────────────────

@router.post("/admin/invoices")
async def create_invoice(body: InvoiceCreate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    """
    Admin: Create a manual invoice for an org.
    Calculates GST (18%) automatically.
    """
    subtotal = sum(item.get("amount", 0) for item in body.line_items)
    gst = round(subtotal * 0.18, 2)
    total = subtotal + gst
    
    # Generate invoice number: KSUB-YYYYMM-NNNN
    month_str = datetime.utcnow().strftime("%Y%m")
    existing = db.table("subscription_invoices").select("id", count="exact").execute()
    seq = (existing.count or 0) + 1
    invoice_number = f"KSUB-{month_str}-{seq:04d}"
    
    invoice = db.table("subscription_invoices").insert({
        "org_id": str(body.org_id),
        "invoice_number": invoice_number,
        "period_start": body.period_start.isoformat(),
        "period_end": body.period_end.isoformat(),
        "line_items": body.line_items,
        "subtotal": subtotal,
        "gst": gst,
        "total": total,
        "due_date": body.due_date.isoformat(),
        "payment_status": "pending",
        "approved_by": str(user.id)
    }).execute()
    
    _log_event(db, body.org_id, "invoice_created", {
        "invoice_number": invoice_number, "total": total, "created_by": str(user.id)
    })
    
    return invoice.data[0]


@router.patch("/admin/invoices/{invoice_id}/record-payment")
async def record_payment(invoice_id: UUID, body: RecordPayment, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    """
    Admin: Record a payment against an invoice.
    """
    invoice = db.table("subscription_invoices").select("*").eq("id", str(invoice_id)).single().execute()
    if not invoice.data:
        raise HTTPException(404, "Invoice not found")
    
    db.table("subscription_invoices").update({
        "payment_status": "paid",
        "payment_method": body.payment_method,
        "payment_reference": body.payment_reference,
        "paid_at": (body.paid_at or datetime.utcnow()).isoformat(),
        "collected_by": str(user.id)
    }).eq("id", str(invoice_id)).execute()
    
    _log_event(db, invoice.data["org_id"], "payment_recorded", {
        "invoice": invoice.data["invoice_number"],
        "amount": invoice.data["total"],
        "method": body.payment_method,
        "reference": body.payment_reference,
        "collected_by": str(user.id)
    })
    
    return {"status": "paid", "invoice_number": invoice.data["invoice_number"]}


@router.get("/admin/invoices/overdue")
async def list_overdue(user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    """Admin: List all overdue invoices across all orgs."""
    overdue = (db.table("subscription_invoices")
        .select("*, organisations(name)")
        .eq("payment_status", "pending")
        .lt("due_date", date.today().isoformat())
        .order("due_date")
        .execute())
    return {"data": overdue.data}


# ── Module Activation ────────────────────────────────────────

@router.post("/modules/activate")
async def activate_module(body: ModuleActivate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    """Activate an add-on module. Checks plan tier and dependencies."""
    sub = db.table("subscriptions").select("*, plans(code)").eq("org_id", str(user.org_id)).single().execute()
    if sub.data["plans"]["code"] == "free":
        raise HTTPException(403, "Add-on modules require Professional plan or higher")
    
    module = db.table("add_on_modules").select("*").eq("code", body.module_code).single().execute()
    if not module.data:
        raise HTTPException(400, "Invalid module code")
    
    # Check dependencies
    for dep in module.data.get("requires_module", []):
        dep_active = db.table("module_subscriptions").select("id").eq("org_id", str(user.org_id)).eq("module_code", dep).eq("is_active", True).execute()
        if not dep_active.data:
            raise HTTPException(400, f"Module '{body.module_code}' requires '{dep}' to be active first")
    
    db.table("module_subscriptions").upsert({
        "org_id": str(user.org_id),
        "module_code": body.module_code,
        "is_active": True,
        "activated_at": datetime.utcnow().isoformat(),
        "deactivated_at": None
    }).execute()
    
    _log_event(db, user.org_id, "module_added", {"module": body.module_code, "by": str(user.id)})
    return {"status": "activated", "module": body.module_code}


@router.post("/modules/deactivate")
async def deactivate_module(body: ModuleActivate, user=Depends(require_role("admin", "director")), db=Depends(get_db)):
    """Deactivate a module. Checks reverse dependencies first."""
    all_modules = db.table("add_on_modules").select("code, requires_module").execute()
    active_modules = db.table("module_subscriptions").select("module_code").eq("org_id", str(user.org_id)).eq("is_active", True).execute()
    active_codes = {m["module_code"] for m in active_modules.data}
    
    for mod in all_modules.data:
        if mod["code"] in active_codes and body.module_code in (mod.get("requires_module") or []):
            raise HTTPException(400, f"Cannot deactivate '{body.module_code}': module '{mod['code']}' depends on it. Deactivate '{mod['code']}' first.")
    
    db.table("module_subscriptions").update({
        "is_active": False,
        "deactivated_at": datetime.utcnow().isoformat()
    }).eq("org_id", str(user.org_id)).eq("module_code", body.module_code).execute()
    
    _log_event(db, user.org_id, "module_removed", {"module": body.module_code, "by": str(user.id)})
    return {"status": "deactivated", "module": body.module_code}


# ── Billing History ──────────────────────────────────────────

@router.get("/invoices")
async def list_invoices(user=Depends(get_current_user), db=Depends(get_db)):
    return {"data": db.table("subscription_invoices").select("*").eq("org_id", str(user.org_id)).order("created_at", desc=True).execute().data}


# ── Usage ────────────────────────────────────────────────────

@router.get("/usage")
async def get_usage(user=Depends(get_current_user), db=Depends(get_db)):
    """Current usage metrics."""
    usage = db.table("usage_tracking").select("*").eq("org_id", str(user.org_id)).eq("recorded_at", date.today().isoformat()).execute()
    sub = db.table("subscriptions").select("plans(max_users)").eq("org_id", str(user.org_id)).single().execute()
    user_count = db.table("users").select("id", count="exact").eq("org_id", str(user.org_id)).execute()
    
    return {
        "metrics": {u["metric"]: u["value"] for u in usage.data},
        "user_count": user_count.count,
        "max_users": sub.data["plans"]["max_users"]
    }


# ── Helpers ──────────────────────────────────────────────────

def _log_event(db, org_id, event_type, metadata):
    db.table("subscription_events").insert({
        "org_id": str(org_id),
        "event_type": event_type,
        "metadata": metadata
    }).execute()
```

---

## 4. Feature Gating Middleware

Create `backend/middleware/subscription.py`:

```python
"""
Feature Gating Middleware
Use as a FastAPI dependency to restrict endpoints by module subscription.

Usage:
    @router.get("/api/v1/crm/leads", dependencies=[Depends(require_module("crm"))])
"""
from fastapi import Depends, HTTPException
from datetime import datetime, timedelta
from ..dependencies import get_current_user, get_db

# In-memory cache (5 min TTL)
_module_cache = {}


def require_module(module_code: str):
    """Returns a FastAPI dependency that checks if the org has the module active."""
    
    async def _check(user=Depends(get_current_user), db=Depends(get_db)):
        cache_key = f"{user.org_id}:{module_code}"
        
        # Check cache
        if cache_key in _module_cache:
            cached_at, is_active = _module_cache[cache_key]
            if datetime.utcnow() - cached_at < timedelta(minutes=5):
                if not is_active:
                    raise HTTPException(
                        403,
                        f"Module '{module_code}' is not active. "
                        f"Contact your administrator to activate it."
                    )
                return
        
        # Check subscription status
        sub = db.table("subscriptions").select("status").eq("org_id", str(user.org_id)).execute()
        if not sub.data or sub.data[0]["status"] in ("cancelled", "paused"):
            _module_cache[cache_key] = (datetime.utcnow(), False)
            raise HTTPException(403, "Subscription is not active")
        
        # Check module
        mod = (db.table("module_subscriptions")
            .select("is_active")
            .eq("org_id", str(user.org_id))
            .eq("module_code", module_code)
            .eq("is_active", True)
            .execute())
        
        is_active = bool(mod.data)
        _module_cache[cache_key] = (datetime.utcnow(), is_active)
        
        if not is_active:
            raise HTTPException(
                403,
                f"Module '{module_code}' is not active. "
                f"Contact your administrator to activate it."
            )
    
    return _check


def clear_module_cache(org_id: str = None):
    """Clear cache when subscription changes."""
    if org_id:
        keys = [k for k in _module_cache if k.startswith(f"{org_id}:")]
        for k in keys:
            del _module_cache[k]
    else:
        _module_cache.clear()
```

---

## 5. Frontend — React Components

```
src/
  pages/
    BillingPage.jsx             # Subscription overview (read-only for regular users)
    AdminBillingPage.jsx        # Admin panel for sales/directors
  components/
    subscription/
      PricingTable.jsx          # Plan comparison cards (public-facing too)
      ModuleMarketplace.jsx     # Add-on cards (admin: activate/deactivate toggle)
      AdminInvoicePanel.jsx     # Create invoices, record payments
      AdminPlanManager.jsx      # Set plan for any org
      BillingHistory.jsx        # Invoice list with PDF download
      OverdueInvoices.jsx       # Dashboard of unpaid invoices
      UsageMeter.jsx            # Usage bars (users, storage, messages)
      SubscriptionBadge.jsx     # Small badge showing current plan in sidebar
  hooks/
    useSubscription.js          # React Query hooks
```

### `AdminInvoicePanel.jsx`

```jsx
import { useState } from 'react';
import { useCreateInvoice, useRecordPayment, useOverdueInvoices } from '../../hooks/useSubscription';

export default function AdminInvoicePanel({ orgId }) {
  const createInvoice = useCreateInvoice();
  const recordPayment = useRecordPayment();
  const { data: overdue } = useOverdueInvoices();
  const [lineItems, setLineItems] = useState([{ description: '', qty: 1, unit_price: 0, amount: 0 }]);

  const addLineItem = () => setLineItems([...lineItems, { description: '', qty: 1, unit_price: 0, amount: 0 }]);

  const updateItem = (idx, field, value) => {
    const items = [...lineItems];
    items[idx][field] = value;
    if (field === 'qty' || field === 'unit_price') {
      items[idx].amount = items[idx].qty * items[idx].unit_price;
    }
    setLineItems(items);
  };

  const subtotal = lineItems.reduce((sum, i) => sum + i.amount, 0);
  const gst = Math.round(subtotal * 0.18 * 100) / 100;
  const total = subtotal + gst;

  const handleCreate = () => {
    createInvoice.mutate({
      org_id: orgId,
      period_start: document.getElementById('period_start').value,
      period_end: document.getElementById('period_end').value,
      due_date: document.getElementById('due_date').value,
      line_items: lineItems
    });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Create Invoice</h2>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label className="text-sm text-gray-600">Period Start</label>
          <input id="period_start" type="date" className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="text-sm text-gray-600">Period End</label>
          <input id="period_end" type="date" className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="text-sm text-gray-600">Due Date</label>
          <input id="due_date" type="date" className="w-full border rounded px-3 py-2" />
        </div>
      </div>

      {/* Line items */}
      {lineItems.map((item, idx) => (
        <div key={idx} className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Description" value={item.description}
            onChange={e => updateItem(idx, 'description', e.target.value)}
            className="border rounded px-2 py-1 col-span-1" />
          <input type="number" placeholder="Qty" value={item.qty}
            onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 0)}
            className="border rounded px-2 py-1" />
          <input type="number" placeholder="Unit Price" value={item.unit_price}
            onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
            className="border rounded px-2 py-1" />
          <span className="py-1 text-right font-mono">₹{item.amount.toLocaleString()}</span>
        </div>
      ))}
      <button onClick={addLineItem} className="text-blue-600 text-sm mb-4">+ Add line item</button>

      <div className="border-t pt-3 text-right space-y-1">
        <p>Subtotal: ₹{subtotal.toLocaleString()}</p>
        <p>GST (18%): ₹{gst.toLocaleString()}</p>
        <p className="font-bold text-lg">Total: ₹{total.toLocaleString()}</p>
      </div>

      <button onClick={handleCreate} disabled={createInvoice.isLoading}
        className="mt-4 w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700">
        Create Invoice
      </button>

      {/* Overdue invoices */}
      {overdue?.data?.length > 0 && (
        <div className="mt-8">
          <h3 className="text-md font-semibold text-red-600 mb-2">
            Overdue Invoices ({overdue.data.length})
          </h3>
          {overdue.data.map(inv => (
            <div key={inv.id} className="flex justify-between items-center border-b py-2">
              <div>
                <span className="font-mono text-sm">{inv.invoice_number}</span>
                <span className="text-gray-500 ml-2">{inv.organisations?.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold">₹{inv.total.toLocaleString()}</span>
                <button onClick={() => {
                  const ref = prompt('Payment reference (UTR/cheque/UPI):');
                  if (ref) recordPayment.mutate({ invoice_id: inv.id, payment_method: 'bank_transfer', payment_reference: ref });
                }} className="text-sm bg-green-600 text-white px-3 py-1 rounded">
                  Mark Paid
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### `ModuleMarketplace.jsx`

```jsx
import { useSubscription, useActivateModule, useDeactivateModule } from '../../hooks/useSubscription';

export default function ModuleMarketplace() {
  const { data } = useSubscription();
  const activate = useActivateModule();
  const deactivate = useDeactivateModule();
  
  const modules = [
    { code: 'crm', name: 'CRM', price: 49, icon: '📊', requires: [] },
    { code: 'gst_invoicing', name: 'GST Invoicing', price: 29, icon: '🧾', requires: ['crm'] },
    { code: 'hrms', name: 'HRMS', price: 39, icon: '👥', requires: [] },
    { code: 'biometric', name: 'Biometric', price: 19, icon: '🔐', requires: ['hrms'] },
    { code: 'payroll', name: 'Payroll', price: 59, icon: '💰', requires: ['hrms'] },
    { code: 'whatsapp', name: 'WhatsApp', price: 29, icon: '💬', requires: [] },
    { code: 'analytics_pro', name: 'Analytics Pro', price: 19, icon: '📈', requires: [] },
  ];
  
  const activeModules = data?.active_modules || [];
  const isAdmin = data?.subscription?.activated_by; // simplified admin check
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {modules.map(mod => {
        const isActive = activeModules.includes(mod.code);
        const depsMet = mod.requires.every(r => activeModules.includes(r));
        
        return (
          <div key={mod.code} className="border rounded-xl p-4">
            <div className="text-2xl mb-2">{mod.icon}</div>
            <h3 className="font-semibold">{mod.name}</h3>
            <p className="text-sm text-gray-500">₹{mod.price}/user/mo</p>
            {mod.requires.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">Requires: {mod.requires.join(', ')}</p>
            )}
            {isAdmin ? (
              <button
                onClick={() => isActive ? deactivate.mutate({ module_code: mod.code }) : activate.mutate({ module_code: mod.code })}
                disabled={!isActive && !depsMet}
                className={`mt-3 w-full py-2 rounded-lg text-sm font-medium
                  ${isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' :
                    depsMet ? 'bg-blue-600 text-white hover:bg-blue-700' :
                    'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                {isActive ? 'Deactivate' : depsMet ? 'Activate' : 'Requires ' + mod.requires.join(', ')}
              </button>
            ) : (
              <div className={`mt-3 w-full py-2 rounded-lg text-sm text-center
                ${isActive ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                {isActive ? 'Active' : 'Contact admin to activate'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

### `useSubscription.js`

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../utils/api';

export const useSubscription = () =>
  useQuery(['subscription'], () => api.get('/api/v1/subscription/current'));

export const usePlans = () =>
  useQuery(['plans'], () => api.get('/api/v1/subscription/plans'));

export const useActivateModule = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/subscription/modules/activate', data), {
    onSuccess: () => qc.invalidateQueries(['subscription']),
  });
};

export const useDeactivateModule = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/subscription/modules/deactivate', data), {
    onSuccess: () => qc.invalidateQueries(['subscription']),
  });
};

// Admin hooks
export const useSetPlan = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/subscription/admin/set-plan', data), {
    onSuccess: () => qc.invalidateQueries(['subscription']),
  });
};

export const useCreateInvoice = () => {
  const qc = useQueryClient();
  return useMutation(data => api.post('/api/v1/subscription/admin/invoices', data), {
    onSuccess: () => qc.invalidateQueries(['invoices']),
  });
};

export const useRecordPayment = () => {
  const qc = useQueryClient();
  return useMutation(({ invoice_id, ...data }) =>
    api.patch(`/api/v1/subscription/admin/invoices/${invoice_id}/record-payment`, data), {
    onSuccess: () => qc.invalidateQueries(['invoices']),
  });
};

export const useOverdueInvoices = () =>
  useQuery(['invoices', 'overdue'], () => api.get('/api/v1/subscription/admin/invoices/overdue'));

export const useInvoices = () =>
  useQuery(['invoices'], () => api.get('/api/v1/subscription/invoices'));

export const useUsage = () =>
  useQuery(['usage'], () => api.get('/api/v1/subscription/usage'));
```

---

## 6. Manual Billing Flow

```
1. Sales/Director decides to onboard a client or upgrade their plan
   ↓
2. Admin opens AdminBillingPage → AdminPlanManager
   Selects org, chooses plan + billing cycle → POST /admin/set-plan
   ↓
3. Admin activates required modules → POST /modules/activate
   ↓
4. Admin creates invoice → AdminInvoicePanel → POST /admin/invoices
   System auto-calculates 18% GST, generates invoice number (KSUB-YYYYMM-NNNN)
   ↓
5. Sales collects payment offline (bank transfer / UPI / cheque / cash)
   ↓
6. Admin records payment → PATCH /admin/invoices/{id}/record-payment
   Logs payment method, reference number, collector
   ↓
7. Monthly: Admin creates next month's invoice
   Overdue dashboard highlights unpaid invoices
   ↓
8. If client cancels or downgrades:
   Admin changes plan via /admin/set-plan
   If downgrade to Free → all modules auto-deactivated
```

---

## 7. Implementation Steps

1. `git checkout -b feature/subscription-module staging`
2. Run `015_subscription_module.sql` — creates tables + seeds plans/modules
3. Build `subscription.py` router + `subscription.py` middleware
4. Add `require_module()` dependency to CRM, HRMS, Payroll, WhatsApp, Analytics routers
5. Add `require_role()` dependency for admin endpoints
6. Build `AdminBillingPage.jsx` → `AdminPlanManager` → `AdminInvoicePanel`
7. Build `BillingPage.jsx` → `ModuleMarketplace` (read-only for non-admins)
8. Add `SubscriptionBadge` to sidebar/navbar
9. Tests

---

## 8. Test Cases

```python
# tests/test_subscription.py

async def test_admin_set_plan():
    """POST /admin/set-plan with admin role → plan updated."""

async def test_non_admin_set_plan_rejected():
    """POST /admin/set-plan with regular user → 403."""

async def test_create_invoice_calculates_gst():
    """POST /admin/invoices → subtotal + 18% GST correct."""

async def test_record_payment():
    """PATCH /admin/invoices/{id}/record-payment → status=paid, reference stored."""

async def test_overdue_invoices():
    """Invoice with past due_date and status=pending appears in overdue list."""

async def test_module_activate_on_free_plan():
    """Activate CRM on Free plan → 403."""

async def test_module_activate_with_dependency():
    """Activate payroll without HRMS → 400 'requires hrms'."""

async def test_module_activate_with_dependency_met():
    """Activate HRMS → then Payroll → success."""

async def test_module_deactivate_with_reverse_dep():
    """Deactivate HRMS while Payroll active → 400 'payroll depends on it'."""

async def test_module_deactivate_no_deps():
    """Deactivate CRM (nothing depends on it) → success."""

async def test_downgrade_to_free_deactivates_modules():
    """Downgrade to Free → all modules deactivated."""

async def test_usage_tracking():
    """Record usage metric → retrieve it."""

async def test_feature_gate_middleware():
    """Call CRM endpoint without CRM module → 403. Activate → 200."""
```
