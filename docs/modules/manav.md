# Manav मानव — HR / HRMS

**Module code** `manav` · registered in `backend/middleware/role_tiers.py`

Employees, leave, documents and the joiner-to-leaver lifecycle. Sensitive: it holds identity documents and is excluded from platform_staff by the role tiers.

## Flow

An employee record anchors everything — leave requests, documents, appraisals and the exit interview all reference it. Leave approval is a two-step: a request row, then an approval row, so a granted leave always records who granted it.

## Backend

- `backend/routers/manav.py`


**85 routes** — 36 GET, 29 POST, 7 DELETE, 12 PATCH, 1 PUT

<details><summary>All routes</summary>

- `GET /employees`
- `POST /employees`
- `GET /employees/link-candidates`
- `GET /employees/awaiting-link`
- `GET /employees/link-options`
- `POST /employees/{employee_id}/link`
- `DELETE /employees/{employee_id}/link`
- `GET /employees/{employee_id}`
- `GET /employees/{employee_id}/sensitive`
- `PATCH /employees/{employee_id}`
- `DELETE /employees/{employee_id}`
- `GET /offboarding`
- `POST /offboarding`
- `PATCH /offboarding/{offboarding_id}`
- `POST /offboarding/{offboarding_id}/complete`
- `GET /exit-interviews`
- `GET /exit-interviews/reasons`
- `POST /exit-interviews`
- `GET /departments`
- `POST /departments`
- `PATCH /departments/{dept_id}`
- `DELETE /departments/{dept_id}`
- `GET /attendance`
- `POST /attendance`
- `GET /attendance/summary`
- `GET /leave-types`
- `POST /leave-types`
- `GET /leaves`
- `POST /leaves`
- `PATCH /leaves/{leave_id}/action`
- `GET /holidays`
- `POST /holidays`
- `DELETE /holidays/{holiday_id}`
- `GET /stats`
- `GET /announcements`
- `POST /announcements`
- `PATCH /announcements/{announcement_id}`
- `DELETE /announcements/{announcement_id}`
- `GET /leaves/check-conflicts`
- `GET /performance/summary`
- `GET /shifts`
- `POST /shifts`
- `PATCH /shifts/{shift_id}`
- `GET /schedules`
- `POST /schedules`
- `POST /schedules/bulk`
- `GET /schedules/coverage`
- `GET /availability`
- `POST /availability`
- `GET /shift-bids`
- `POST /shift-bids`
- `GET /shift-bids/{bid_id}/responses`
- `POST /shift-bids/{bid_id}/apply`
- `POST /shift-bids/{bid_id}/accept/{employee_id}`
- `POST /swaps`
- `GET /swaps`
- `PATCH /swaps/{swap_id}`
- `GET /expense-claims`
- `GET /expense-claims/pending-count`
- `POST /expense-claims`
- `PATCH /expense-claims/{claim_id}/approve`
- `PATCH /expense-claims/{claim_id}/reject`
- `GET /job-openings`
- `POST /job-openings`
- `PATCH /job-openings/{opening_id}`
- `GET /candidates`
- `POST /candidates`
- `PATCH /candidates/{candidate_id}/stage`
- `POST /candidates/{candidate_id}/hire`
- `GET /assets`
- `POST /assets`
- `GET /assets/{asset_id}`
- `PATCH /assets/{asset_id}`
- `DELETE /assets/{asset_id}`
- `POST /assets/{asset_id}/assign`
- `POST /assets/{asset_id}/return`
- `GET /employees/{employee_id}/assets`
- `GET /employees/{employee_id}/documents`
- `POST /employees/{employee_id}/documents`
- `DELETE /employees/{employee_id}/documents/{document_id}`
- `GET /employees/{employee_id}/commission-schemes`
- `POST /commission-schemes`
- `PUT /employees/{employee_id}/bonus-eligibility`
- `GET /bonus-awards`
- `POST /bonus-awards`

</details>

## Database

28 tables:

- `manav_announcements`
- `manav_assets`
- `manav_attendance`
- `manav_availability`
- `manav_bonus_awards`
- `manav_candidates`
- `manav_commission_bands`
- `manav_commission_schemes`
- `manav_departments`
- `manav_employee_documents`
- `manav_employees`
- `manav_exit_interviews`
- `manav_expense_claims`
- `manav_holidays`
- `manav_job_openings`
- `manav_leave_balances`
- `manav_leave_requests`
- `manav_leave_types`
- `manav_offboarding`
- `manav_schedules`
- `manav_shift_bid_responses`
- `manav_shift_bids`
- `manav_shift_definitions`
- `manav_swap_requests`
- `org_member_modules`
- `pay_professional_tax`
- `user_roles`
- `users`

## Frontend

- `frontend\src\pages\manav\AnnouncementsTab.jsx`
- `frontend\src\pages\manav\AssetsTab.jsx`
- `frontend\src\pages\manav\AttendanceTab.jsx`
- `frontend\src\pages\manav\BonusTab.jsx`
- `frontend\src\pages\manav\CommissionTab.jsx`
- `frontend\src\pages\manav\CustodyTab.jsx`
- `frontend\src\pages\manav\DepartmentsTab.jsx`
- `frontend\src\pages\manav\DocumentsTab.jsx`
- `frontend\src\pages\manav\DscTab.jsx`
- `frontend\src\pages\manav\EmployeesTab.jsx`
- `frontend\src\pages\manav\ExitsTab.jsx`
- `frontend\src\pages\manav\ExpensesTab.jsx`
- `frontend\src\pages\manav\HolidaysTab.jsx`
- `frontend\src\pages\manav\LeavesTab.jsx`
- `frontend\src\pages\manav\LinkAccountsTab.jsx`
- `frontend\src\pages\manav\NoticesTab.jsx`
- `frontend\src\pages\manav\PerformanceTab.jsx`
- `frontend\src\pages\manav\RecruitmentTab.jsx`
- `frontend\src\pages\manav\ScheduleGrid.jsx`
- `frontend\src\pages\manav\ShiftBids.jsx`
- `frontend\src\pages\manav\ShiftDefinitions.jsx`
- `frontend\src\pages\manav\ShiftsTab.jsx`
- `frontend\src\pages\manav\SwapRequests.jsx`
- `frontend\src\pages\manav\UdinTab.jsx`
- `frontend\src\pages\manav\_shared.jsx`
- `frontend\src\pages\manav\__tests__\bonusAwards.test.jsx`
- `frontend\src\pages\manav\__tests__\commissionBands.test.jsx`
- `frontend\src\pages\manav\__tests__\custodyWrites.test.jsx`
- `frontend\src\pages\manav\__tests__\employeeAccountLink.test.jsx`
- `frontend\src\pages\manav\__tests__\employeeLoginCheckbox.test.jsx`
- `frontend\src\pages\manav\__tests__\employeeLoginLink.test.jsx`
- `frontend\src\pages\manav\__tests__\manavTabs.test.jsx`
- `frontend\src\pages\manav\__tests__\shiftBidAward.test.jsx`
- `frontend\src\pages\manav\__tests__\statutoryEntry.test.jsx`
- `frontend\src\pages\ManavPage.jsx`


## Integrations

- AWS SES
- Cloudflare R2

---
_Routes, tables and paths are generated by `scripts/module-facts.mjs` and
`scripts/gen-module-docs.mjs`. Re-run both after changing the module; do not
edit those sections by hand. Purpose and Flow are hand-written._
