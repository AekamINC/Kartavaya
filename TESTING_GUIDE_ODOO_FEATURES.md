# What's New — Testing Guide

**For:** Feature testing session, 2026-07-22
**Covers:** 5 new features shipped 2026-07-21 (staging branch)
**Where:** All features are live in the app — no separate test environment

---

## Before you start

- Log in as an **admin** (some actions like approving claims/leaves are admin-only).
- You'll need at least 1-2 employees already in **Manav** and at least 1 product in **Ganit → Products** for the stock test.
- Test in order — feature 1 and 2 (loans/expenses) only fully show their effect after you run payroll in Vetana, so save that step for after you've set up test data.

---

## 1. Employee Loans & Salary Advances
**Where:** Vetana → **Loans** tab

1. Click **+ New Loan** → pick an employee → enter Principal (e.g. ₹10,000) and Monthly EMI (e.g. ₹2,000) → Save.
2. Confirm the loan shows up in the list with status **Active** and balance = principal.
3. Go to Vetana → **Payroll** → process payroll for the current month for that employee.
4. Open the resulting payslip → check for a **"Loan Repayment"** line in Deductions, matching the EMI amount (or less, if balance was lower).
5. Approve the payroll run.
6. Go back to **Loans** tab → confirm the balance dropped by the EMI amount. Run payroll enough times (or check math) to confirm it auto-closes at ₹0.
7. Try **Write Off** on an active loan → confirm status changes to "written off" and it's no longer deducted in future payroll runs.

**What to watch for:** deduction shouldn't exceed the remaining balance (e.g. if balance is ₹500 and EMI is ₹2,000, only ₹500 should be deducted, and loan should close).

---

## 2. Employee Expense Claims & Reimbursement
**Where:** Manav → **Expenses** tab

1. Log in as a regular employee (or the admin acting as self) → click **+ Submit Claim** → fill category, date, amount, description → optionally paste a receipt URL → Submit.
2. Confirm it appears with status **Pending**.
3. Switch to admin view → find the claim → click **Approve** (or **Reject** with a reason — confirm the rejection reason shows on the card).
4. Go to Vetana → process payroll for that employee's month.
5. Open the payslip → confirm a green **"+ Expense Reimbursement"** line appears above Net Pay, adding to (not subtracting from) the total.
6. Confirm the claim's status is still "Approved" until you **Approve the payroll run** — after that it should flip to **Paid** (check back in the Expenses tab).

**What to watch for:** a claim shouldn't be payable twice — once it's tied to a payslip it shouldn't show up again in a future payroll run.

---

## 3. Vendor Bills & Accounts Payable
**Where:** Ganit → **Payables** tab

1. Click **+ Vendor** → add a test vendor (name required, GSTIN/email/phone optional) → Save.
2. Click **+ Vendor Bill** → select the vendor → add 1-2 line items (description, qty, rate, GST%) → set a due date → Save.
3. Confirm the bill appears in the list as **Unpaid** with the correct GST-inclusive total.
4. Check the **stat tiles at the top** (Outstanding, Overdue, Open Bills) reflect this new bill.
5. Open the bill → record a **partial payment** (less than the total) → confirm status changes to **Partially Paid** and balance updates.
6. Record a second payment for the remaining balance → confirm status flips to **Paid**.
7. Create a bill with a due date in the past → confirm it shows under "Overdue" in the summary tiles.

**What to watch for:** GST math (CGST+SGST or IGST depending on the checkbox) should match what you'd expect for the line items entered.

---

## 4. Product Stock Ledger
**Where:** Vikray → **Stock** tab (new products need a threshold set once to show up meaningfully)

1. Go to **Stock** tab → find a product → set a **Low Stock Threshold** (e.g. 5) by typing in the box and clicking away.
2. Use the **+1 / -1** buttons to manually adjust quantity → confirm the "On Hand" number updates immediately.
3. Go to Vikray → **Orders** → create a new order that includes that product with some quantity → confirm the order.
4. Go back to **Stock** tab → confirm quantity on hand **decreased** by the ordered quantity.
5. Cancel a **confirmed** order (not draft) → confirm stock is **added back**.
6. Adjust a product's quantity down below its threshold → confirm it shows a red **"Low Stock"** badge, and shows up when you check "Low stock only".

**What to watch for:** stock should only move when an order transitions to Confirmed (not when it's still Draft), and should reverse correctly on cancellation.

---

## 5. Recruitment / Applicant Tracking
**Where:** Manav → **Recruitment** tab

1. Click **+ Job Opening** → give it a title (e.g. "Sales Executive") → Create.
2. With that opening selected, click **+ Candidate** → add a test candidate (name required; email/phone/resume link optional) → Add.
3. Confirm the candidate card appears in the **Applied** column.
4. Use the small stage buttons on the card to move it through **Screening → Interview → Offer**.
5. From the **Offer** column, click **Hire** on the candidate.
6. Go to Manav → **Employees** tab → confirm a new employee record was created with that candidate's name/email/phone.
7. Go back to Recruitment → confirm the candidate card now shows stage **Hired** and the Hire button is gone.
8. Try rejecting a candidate from any stage → confirm it moves to **Rejected**.

**What to watch for:** hiring the same candidate twice should be blocked (button disappears after hire).

---

## Reporting issues

For each bug found, note: **which feature**, **exact steps to reproduce**, **what you expected vs what happened**, and a **screenshot** if the numbers look wrong (especially payroll/GST amounts — those are the highest-risk areas since they involve money math).
