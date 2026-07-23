"""employee_email.py — Employee notification emails for Manav (HRMS) & Vetana (Payroll)
Fire-and-forget notifications using the shared email_service helpers.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from email_service import send_email, _base, _body_text, _info_card, _cta_row, _safe_subject, FRONTEND_URL, _INK3


def _skip(email):
    return not email or not str(email).strip()


# ── 1. Leave Decision ──────────────────────────────────────────

def send_leave_decision_email(employee_email, employee_name, leave_type, start_date, end_date, decision, reviewer_name, org_name=""):
    if _skip(employee_email):
        return
    ok = decision == "approved"
    emoji = "✅" if ok else "❌"
    card = _info_card([
        ("Leave Type", str(leave_type)),
        ("Dates", f"{start_date} → {end_date}"),
        ("Decision", f"{emoji} {decision.title()}"),
        ("Reviewed By", str(reviewer_name)),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=leaves", "View Leaves")
    html = _base(
        preheader=f"Your leave request has been {decision}",
        kicker=f"LEAVE · अवकाश",
        headline=f"Leave {decision.title()}",
        sanskrit="अवकाश निर्णय",
        lede=f"Hi {employee_name}, your {leave_type} leave request from {start_date} to {end_date} has been <b>{decision}</b> by {reviewer_name}.",
        body_rows=card + cta,
    )
    send_email(employee_email, _safe_subject(f"Leave {decision.title()} — {leave_type}"), html)


# ── 2. Expense Decision ────────────────────────────────────────

def send_expense_decision_email(employee_email, employee_name, claim_title, amount, decision, reviewer_name, org_name=""):
    if _skip(employee_email):
        return
    ok = decision == "approved"
    emoji = "✅" if ok else "❌"
    card = _info_card([
        ("Expense", str(claim_title)),
        ("Amount", f"₹{amount:,.2f}" if isinstance(amount, (int, float)) else f"₹{amount}"),
        ("Decision", f"{emoji} {decision.title()}"),
        ("Reviewed By", str(reviewer_name)),
    ])
    html = _base(
        preheader=f"Your expense claim has been {decision}",
        kicker="EXPENSE · व्यय",
        headline=f"Expense {decision.title()}",
        sanskrit="व्यय निर्णय",
        lede=f"Hi {employee_name}, your expense claim for {claim_title} has been <b>{decision}</b> by {reviewer_name}.",
        body_rows=card,
    )
    send_email(employee_email, _safe_subject(f"Expense {decision.title()} — {claim_title}"), html)


# ── 3. Announcement ────────────────────────────────────────────

def send_announcement_email(employee_email, employee_name, title, body_content, org_name=""):
    if _skip(employee_email):
        return
    body = _body_text(str(body_content) if body_content else "")
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=announcements", "View Announcements")
    html = _base(
        preheader=f"New announcement: {title}",
        kicker="ANNOUNCEMENT · घोषणा",
        headline=str(title),
        sanskrit="घोषणा",
        lede=f"Hi {employee_name}, a new announcement has been posted.",
        body_rows=body + cta,
    )
    send_email(employee_email, _safe_subject(f"Announcement — {title}"), html)


# ── 4. Shift Schedule Assigned ──────────────────────────────────

def send_shift_schedule_email(employee_email, employee_name, shift_name, date, start_time, end_time, org_name=""):
    if _skip(employee_email):
        return
    card = _info_card([
        ("Shift", str(shift_name)),
        ("Date", str(date)),
        ("Time", f"{start_time} – {end_time}"),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=shifts", "View Schedule")
    html = _base(
        preheader=f"Shift assigned: {shift_name} on {date}",
        kicker="SHIFT · पारी",
        headline="Shift Assigned",
        sanskrit="पारी निर्धारण",
        lede=f"Hi {employee_name}, you have been assigned a shift.",
        body_rows=card + cta,
    )
    send_email(employee_email, _safe_subject(f"Shift Assigned — {shift_name} on {date}"), html)


# ── 5. Asset Assignment ────────────────────────────────────────

def send_asset_email(employee_email, employee_name, asset_name, asset_type, action, org_name=""):
    if _skip(employee_email):
        return
    verb = "Assigned" if action == "assigned" else "Returned"
    card = _info_card([
        ("Asset", str(asset_name)),
        ("Type", str(asset_type) if asset_type else "—"),
        ("Action", verb),
    ])
    html = _base(
        preheader=f"Asset {verb.lower()}: {asset_name}",
        kicker="ASSET · संपत्ति",
        headline=f"Asset {verb}",
        sanskrit="संपत्ति सूचना",
        lede=f"Hi {employee_name}, the asset <b>{asset_name}</b> has been {verb.lower()} {'to' if action == 'assigned' else 'from'} you.",
        body_rows=card,
    )
    send_email(employee_email, _safe_subject(f"Asset {verb} — {asset_name}"), html)


# ── 6. Loan Update ─────────────────────────────────────────────

def send_loan_email(employee_email, employee_name, loan_type, amount, emi, action, org_name=""):
    if _skip(employee_email):
        return
    action_label = action.title()
    card = _info_card([
        ("Loan", str(loan_type) if loan_type else "Employee Loan"),
        ("Principal", f"₹{amount:,.2f}" if isinstance(amount, (int, float)) else f"₹{amount}"),
        ("EMI", f"₹{emi:,.2f}" if isinstance(emi, (int, float)) else f"₹{emi}"),
        ("Status", action_label),
    ])
    html = _base(
        preheader=f"Loan {action_label}",
        kicker="LOAN · ऋण",
        headline=f"Loan {action_label}",
        sanskrit="ऋण सूचना",
        lede=f"Hi {employee_name}, your loan has been {action}.",
        body_rows=card,
    )
    send_email(employee_email, _safe_subject(f"Loan {action_label}"), html)


# ── 7. Payslip Ready ───────────────────────────────────────────

def send_payslip_email(employee_email, employee_name, month, gross, net, payslip_number, org_name=""):
    if _skip(employee_email):
        return
    card = _info_card([
        ("Month", str(month)),
        ("Payslip #", str(payslip_number)),
        ("Gross Pay", f"₹{gross:,.2f}" if isinstance(gross, (int, float)) else f"₹{gross}"),
        ("Net Pay", f"₹{net:,.2f}" if isinstance(net, (int, float)) else f"₹{net}"),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/vetana", "View Payslip")
    html = _base(
        preheader=f"Payslip ready for {month}",
        kicker="PAYSLIP · वेतन पर्ची",
        headline="Payslip Ready",
        sanskrit="वेतन पर्ची",
        lede=f"Hi {employee_name}, your payslip for {month} is now available.",
        body_rows=card + cta,
    )
    send_email(employee_email, _safe_subject(f"Payslip Ready — {month} ({payslip_number})"), html)


# ── 8. Performance Review ──────────────────────────────────────

def send_performance_email(employee_email, employee_name, review_period, reviewer_name, org_name=""):
    if _skip(employee_email):
        return
    card = _info_card([
        ("Review Period", str(review_period)),
        ("Reviewer", str(reviewer_name)),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=performance", "View Review")
    html = _base(
        preheader=f"Performance review for {review_period}",
        kicker="PERFORMANCE · प्रदर्शन",
        headline="Performance Review",
        sanskrit="प्रदर्शन समीक्षा",
        lede=f"Hi {employee_name}, a performance review for {review_period} has been submitted by {reviewer_name}.",
        body_rows=card + cta,
    )
    send_email(employee_email, _safe_subject(f"Performance Review — {review_period}"), html)
