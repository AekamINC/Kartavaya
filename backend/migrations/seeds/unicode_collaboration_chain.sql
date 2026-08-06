-- =====================================================================
-- Unicode Group — demo seed, COLLABORATION CHAIN
--   people who log in -> projects -> tasks -> approvals -> activity
--   -> Sanvaad (samvada_*) -> Prachar -> Sahayak (hub_chat_*)
--
-- org_id  fae87907-2f99-4b35-a241-c94d9e1e4a17   ("Unicode Group")
-- Written 2026-08-06. ABSOLUTE DATES ONLY — re-running this file on any
-- later day produces exactly the same rows.
--
-- TENANCY
--   Every statement is filtered on the single org_id above, directly or
--   through a parent that is itself filtered on it. `public.tasks`,
--   `public.project_columns`, `public.project_assignments` and
--   `public.team_members` have no org column: their tenant path is
--   `public.teams.org_id`, and every one of them is keyed on a team_id
--   this file creates. There is no DELETE and no TRUNCATE anywhere.
--   Every write is idempotent — a stable natural key plus NOT EXISTS or
--   ON CONFLICT DO NOTHING.
--
-- EMAIL — two domains and nothing else
--   success+<slug>@simulator.amazonses.com   AWS SES mailbox simulator
--   bounce@ / complaint@ / ooto@ simulator.amazonses.com  (4 rows, so the
--                                    delivery stats are not uniformly perfect)
--   info+<label>@unicodegroup.com            the customer's own domain
--   No gmail, no third-party, no reachable human. The five accounts that
--   ALREADY hold this org (kevalvshah03@gmail.com and friends) are read
--   but never written to, and nothing this file seeds is addressed to them.
--
-- NOTHING SENDS — read `backend/services/skills/marketing_skills.py` and
--   `backend/services/reminder_service.py` before changing a status here.
--
--   PRACHAR CAMPAIGNS.  `process_scheduled_campaigns` selects
--       status = 'scheduled' AND is_active AND scheduled_at <= NOW()
--   and `skills/action/campaign_sender.send_campaign` refuses outright
--   unless status IN ('scheduled','sending'). Every campaign below is
--   'sent' (historical) or 'draft', and every one has scheduled_at NULL,
--   so both halves of the gate are false.
--
--   PRACHAR SEQUENCES.  `process_sequence_steps` selects
--       e.status='active' AND s.status='active' AND e.next_step_at <= NOW()
--   Every sequence below is 'draft' or 'paused', every enrolment is
--   'completed', and every next_step_at is NULL. Three independent misses.
--
--   CAMPAIGN CONTACTS.  `send_campaign` fans out to cc.status='pending'.
--   No row below is 'pending'; they all carry a terminal delivery state.
--
--   TASK / APPROVAL REMINDERS.  `/cron/reminders` scans open tasks due in
--   the next 24h and `staging.approval_requests` left 'pending' over 24h,
--   then emails the recipient. Two defences: (1) NOT ONE approval_requests
--   row is written here — task approvals go in `staging.approvals`, which
--   no scanner reads; (2) every task below is created by, and assigned to,
--   one of the eight seeded accounts, whose addresses are all SES simulator
--   addresses. So even if that cron were switched on, nothing it produced
--   could reach a person. (Measured 2026-08-06: staging.reminders holds 0
--   rows while 8 tasks in other orgs are already inside the 24h window —
--   the job has never run.)
--
--   SAHAYAK.  Conversations are rows. No model was called, so credits and
--   cost_usd are 0 and the "wrote the answer" work step is absent — the
--   read steps are the free half and they are the half that happened.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 0. GUARD — refuse to run against anything but Unicode Group.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staging.organisations
                 WHERE id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
                   AND name='Unicode Group') THEN
    RAISE EXCEPTION 'org fae87907… is not Unicode Group — refusing to seed';
  END IF;
END $$;


-- =====================================================================
-- 1. THE EIGHT PEOPLE WHO SIGN IN
--
-- `staging.manav_employees` holds 25 people but carries no login, and
-- `public.tasks`, `samvada_messages` and `project_assignments` all key on
-- `public.users.user_id`. Without these rows every task, message and
-- approval would have to be attributed to one of the five gmail accounts
-- that already hold this org — which would put a real, reachable address
-- on every outbound path in the product. These eight are the same humans
-- as UNI-001/002/003/004/010/012/017/019, matched by email.
--
-- THEY CANNOT LOG IN. `auth_router._verify_password` compares a hex digest
-- against `password_hash`; the sentinel below is not hex and no password
-- produces it. No credential is set here and none can be guessed.
--
-- SEATS: `org_invites.count_seats` counts DISTINCT user_id in
-- staging.user_roles. Unicode Group's max_users is 15 and 5 are held, so
-- these 8 take it to 13 — inside the allowance, with headroom left.
-- =====================================================================
INSERT INTO public.users
  (user_id, email, name, full_name, password_hash, salt, role, member_role, position, mobile_number)
SELECT v.user_id, v.email, v.name, v.name,
       'seeded-demo-account-no-login', 'seeded-demo-account-no-login',
       'member', v.member_role, v.position, v.mobile
FROM (VALUES
  ('user_fae870000001','success+rajesh-bhatt@simulator.amazonses.com','Rajesh Bhatt','org_admin','Chief Operating Officer','+919999010001'),
  ('user_fae870000002','success+amit-sharma@simulator.amazonses.com','Amit Sharma','org_member','Lead Developer','+919999010002'),
  ('user_fae870000003','success+priya-mehta@simulator.amazonses.com','Priya Mehta','org_member','Senior UI Designer','+919999010003'),
  ('user_fae870000004','success+vikram-joshi@simulator.amazonses.com','Vikram Joshi','org_member','Marketing Manager','+919999010004'),
  ('user_fae870000005','success+meera-nair@simulator.amazonses.com','Meera Nair','org_member','Finance Controller','+919999010005'),
  ('user_fae870000006','success+ritu-agarwal@simulator.amazonses.com','Ritu Agarwal','org_member','HR Manager','+919999010006'),
  ('user_fae870000007','success+neha-chauhan@simulator.amazonses.com','Neha Chauhan','org_member','QA Lead','+919999010007'),
  ('user_fae870000008','success+pooja-barot@simulator.amazonses.com','Pooja Barot','org_member','Client Servicing Manager','+919999010008')
) AS v(user_id, email, name, member_role, position, mobile)
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = v.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.users u WHERE LOWER(u.email) = LOWER(v.email));

INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by)
SELECT v.user_id, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.role_code, 'user_f798947b8a2e'
FROM (VALUES
  ('user_fae870000001','org_admin'),
  ('user_fae870000002','org_member'),
  ('user_fae870000003','org_member'),
  ('user_fae870000004','org_member'),
  ('user_fae870000005','org_member'),
  ('user_fae870000006','org_member'),
  ('user_fae870000007','org_member'),
  ('user_fae870000008','org_member')
) AS v(user_id, role_code)
WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = v.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM staging.user_roles r
    WHERE r.user_id = v.user_id
      AND r.org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid);


-- =====================================================================
-- 2. EIGHT PROJECTS
--
-- A "project" in this product is a `public.teams` row: the route is
-- `/projects/{team_id}` (routers/search.py), the kanban columns hang off
-- `project_columns.team_id`, and `tasks.team_id` is the scope column
-- (`server._VALID_SCOPE_COLS`). `staging.projects` is a different, CRM-side
-- table reached only by `GET /graha/contacts/{id}/projects`; it is left
-- alone deliberately — `public.tasks` has no join to it.
--
-- Six of the eight are named for a real client the commerce agent seeded,
-- so the work refers to customers who have invoices.
-- =====================================================================
INSERT INTO public.teams (team_id, name, created_by, org_id, color, created_at)
SELECT v.team_id, v.name, v.created_by, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid,
       v.color, v.created_at::timestamptz
FROM (VALUES
  ('team_ug0000000001','Aarna Textile — ERP Rollout',            'user_fae870000001','#0082c6','2026-02-09 10:15:00+05:30'),
  ('team_ug0000000002','Bhavya Infra — Site Reporting Portal',   'user_fae870000002','#03a1b6','2026-03-16 11:30:00+05:30'),
  ('team_ug0000000003','Chandrika Pharma — GMP Document Control','user_fae870000001','#8b5cf6','2026-04-06 09:45:00+05:30'),
  ('team_ug0000000004','Ekveera Engineering — Inventory Migration','user_fae870000002','#f59e0b','2026-02-23 14:00:00+05:30'),
  ('team_ug0000000005','Firozi Retail — Loyalty App',            'user_fae870000003','#05b7aa','2026-05-11 10:00:00+05:30'),
  ('team_ug0000000006','Indira Software Labs — QA Automation',   'user_fae870000007','#e11d48','2026-06-01 09:30:00+05:30'),
  ('team_ug0000000007','Statutory Compliance FY 2026-27',        'user_fae870000005','#0f766e','2026-04-02 09:00:00+05:30'),
  ('team_ug0000000008','Website and Brand Refresh',              'user_fae870000004','#7c3aed','2026-01-19 10:30:00+05:30')
) AS v(team_id, name, created_by, color, created_at)
WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.team_id = v.team_id);

-- Kanban columns. `ensure_default_columns` would create these lazily on the
-- first GET, with random ids — seeding them keeps `tasks.column_id` joinable
-- from the moment the rows land, which the existing ad-hoc tasks on this org
-- are NOT (their column_id values point at columns that do not exist).
INSERT INTO public.project_columns (column_id, team_id, name, color, sort_order, is_done)
SELECT 'col_' || right(t.team_id, 4) || c.slug, t.team_id, c.name, c.color, c.sort_order, c.is_done
FROM (VALUES
  ('team_ug0000000001'),('team_ug0000000002'),('team_ug0000000003'),('team_ug0000000004'),
  ('team_ug0000000005'),('team_ug0000000006'),('team_ug0000000007'),('team_ug0000000008')
) AS t(team_id)
CROSS JOIN (VALUES
  ('_todo','To Do','#0082c6',0,FALSE),
  ('_prog','In Progress','#03a1b6',1,FALSE),
  ('_revw','In Review','#8b5cf6',2,FALSE),
  ('_appr','Approval','#f59e0b',3,FALSE),
  ('_done','Done','#05b7aa',4,TRUE)
) AS c(slug, name, color, sort_order, is_done)
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_columns pc
  WHERE pc.column_id = 'col_' || right(t.team_id, 4) || c.slug);

-- Project membership. BOTH tables, because the product reads both and they
-- answer different questions: `is_project_member` and `get_visible_team_ids`
-- check project_assignments first and fall back to team_members, while
-- `routers/activity.py` checks team_members ONLY — an activity feed on a
-- project with no team_members row 403s even for its own members.
INSERT INTO public.project_assignments (assignment_id, team_id, user_id, role, assigned_by, full_name, position)
SELECT 'pa_' || right(v.team_id,4) || right(v.user_id,4), v.team_id, v.user_id, v.role,
       'user_fae870000001', u.name, u.position
FROM (VALUES
  ('team_ug0000000001','user_fae870000001','owner'),
  ('team_ug0000000001','user_fae870000002','admin'),
  ('team_ug0000000001','user_fae870000007','member'),
  ('team_ug0000000001','user_fae870000008','member'),
  ('team_ug0000000002','user_fae870000002','owner'),
  ('team_ug0000000002','user_fae870000003','member'),
  ('team_ug0000000002','user_fae870000008','member'),
  ('team_ug0000000003','user_fae870000001','owner'),
  ('team_ug0000000003','user_fae870000005','admin'),
  ('team_ug0000000003','user_fae870000007','member'),
  ('team_ug0000000004','user_fae870000002','owner'),
  ('team_ug0000000004','user_fae870000005','member'),
  ('team_ug0000000005','user_fae870000003','owner'),
  ('team_ug0000000005','user_fae870000002','admin'),
  ('team_ug0000000005','user_fae870000004','member'),
  ('team_ug0000000005','user_fae870000007','member'),
  ('team_ug0000000006','user_fae870000007','owner'),
  ('team_ug0000000006','user_fae870000002','member'),
  ('team_ug0000000007','user_fae870000005','owner'),
  ('team_ug0000000007','user_fae870000001','admin'),
  ('team_ug0000000007','user_fae870000006','member'),
  ('team_ug0000000008','user_fae870000004','owner'),
  ('team_ug0000000008','user_fae870000003','admin'),
  ('team_ug0000000008','user_fae870000006','member')
) AS v(team_id, user_id, role)
JOIN public.users u ON u.user_id = v.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_assignments pa
  WHERE pa.team_id = v.team_id AND pa.user_id = v.user_id);

INSERT INTO public.team_members (member_id, team_id, email, user_id, role, status, full_name, position, member_role)
SELECT 'tm_' || right(pa.team_id,4) || right(pa.user_id,4), pa.team_id, u.email, pa.user_id,
       pa.role, 'active', u.name, u.position, u.member_role
FROM public.project_assignments pa
JOIN public.users u ON u.user_id = pa.user_id
WHERE pa.team_id LIKE 'team_ug%'
  AND NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = pa.team_id AND tm.user_id = pa.user_id);


-- =====================================================================
-- 3. NINETY TASKS
--
-- The projection is shared by all three batches and is the part worth
-- reading: status decides the kanban column, `requires_approval` diverts
-- an in-review task into the Approval column, and a done task is the only
-- one that gets a completed_at and a completed_by.
--
-- WHY `board_id` STAYS NULL: `server._VALID_SCOPE_COLS` is
-- {team_id, user_id}. `board_id` is not a scope the task list ever uses,
-- and the ad-hoc tasks already on this org carry board ids pointing at
-- boards that do not exist.
--
-- WHY EVERY ASSIGNEE IS A SEEDED ACCOUNT: `reminder_service._TASK_SCAN`
-- picks up any open task due inside 24 hours and emails
-- COALESCE(assignee, creator). Keeping both inside the eight accounts
-- above means the worst that cron can do is mail the SES simulator.
--
-- The three batches are identical apart from their VALUES lists; they are
-- separate statements only because one 90-row literal is unreviewable.
-- =====================================================================

-- ── batch 1: projects 1-3 (35 tasks) ─────────────────────────────────
INSERT INTO public.tasks
 (task_id, team_id, created_by_user_id, created_by_name, assignee_user_ids, assignee_emails,
  title, description, status, priority, tags, due_at, created_at, updated_at,
  completed_at, completed_by_user_id, column_slug, column_id, sort_order,
  requires_approval, approval_status, approval_requested_at, estimated_minutes)
SELECT v.task_id, v.team_id, v.creator, cu.name, ARRAY[v.assignee], ARRAY[au.email],
 v.title, v.descr, v.status, v.priority, v.tags::text[],
 v.due::timestamptz, v.created::timestamptz,
 COALESCE(v.completed::timestamptz, v.created::timestamptz),
 v.completed::timestamptz,
 CASE WHEN v.status='done' THEN v.assignee END,
 CASE v.status WHEN 'todo' THEN 'todo' WHEN 'in_progress' THEN 'in-progress'
      WHEN 'in_review' THEN CASE WHEN v.appr THEN 'approval' ELSE 'in-review' END
      WHEN 'done' THEN 'done' ELSE 'todo' END,
 'col_' || right(v.team_id,4) || CASE v.status WHEN 'todo' THEN '_todo' WHEN 'in_progress' THEN '_prog'
      WHEN 'in_review' THEN CASE WHEN v.appr THEN '_appr' ELSE '_revw' END
      WHEN 'done' THEN '_done' ELSE '_todo' END,
 v.ord, v.appr,
 CASE WHEN v.appr THEN 'pending' END,
 CASE WHEN v.appr THEN v.created::timestamptz END,
 v.est
FROM (VALUES
 ('task_ug01_01','team_ug0000000001','user_fae870000001','user_fae870000008','Scope workshop with Aarna finance team','Two-day workshop at the Ahmedabad plant to agree module scope and the cutover date.','done','high','{erp,discovery}','2026-02-20 18:00:00+05:30','2026-02-10 09:30:00+05:30','2026-02-19 17:10:00+05:30',FALSE,0,960),
 ('task_ug01_02','team_ug0000000001','user_fae870000001','user_fae870000002','Map existing Tally chart of accounts','Ledger-by-ledger mapping into the new chart, with the 41 unmapped heads listed for Aarna to decide.','done','high','{erp,migration}','2026-03-06 18:00:00+05:30','2026-02-12 11:00:00+05:30','2026-03-05 16:40:00+05:30',FALSE,1,1440),
 ('task_ug01_03','team_ug0000000001','user_fae870000002','user_fae870000002','Data cleansing — 4,200 item masters','Duplicate names, missing HSN and three different units for the same yarn count.','done','medium','{erp,data}','2026-03-27 18:00:00+05:30','2026-03-02 10:00:00+05:30','2026-04-02 19:20:00+05:30',FALSE,2,2400),
 ('task_ug01_04','team_ug0000000001','user_fae870000001','user_fae870000001','Configure GST tax codes for Gujarat','Intra-state and inter-state codes, plus the 5% job-work rate the mill uses most.','done','high','{erp,gst}','2026-04-10 18:00:00+05:30','2026-03-30 09:15:00+05:30','2026-04-09 15:00:00+05:30',FALSE,3,480),
 ('task_ug01_05','team_ug0000000001','user_fae870000001','user_fae870000002','Build purchase requisition workflow','Three approval levels; the plant head signs anything above 2 lakh.','in_progress','high','{erp,workflow}','2026-08-21 18:00:00+05:30','2026-06-15 10:00:00+05:30',NULL,FALSE,0,1200),
 ('task_ug01_06','team_ug0000000001','user_fae870000001','user_fae870000007','UAT script for stores module','62 test cases covering goods receipt, issue, return and physical stock.','in_review','medium','{erp,uat}','2026-08-14 18:00:00+05:30','2026-07-06 11:30:00+05:30',NULL,FALSE,0,900),
 ('task_ug01_07','team_ug0000000001','user_fae870000008','user_fae870000008','Train 18 shop-floor users at Ahmedabad plant','Two batches, Gujarati handouts, one hour each on the stores screens only.','todo','medium','{erp,training}','2026-09-04 18:00:00+05:30','2026-07-20 09:00:00+05:30',NULL,FALSE,0,600),
 ('task_ug01_08','team_ug0000000001','user_fae870000001','user_fae870000001','Reconcile opening stock as on 01-Apr-2026','Physical count differs from the legacy system by 1.8% on grey fabric. Waiting on the stores register.','in_progress','urgent','{erp,finance}','2026-07-31 18:00:00+05:30','2026-06-28 14:00:00+05:30',NULL,FALSE,1,720),
 ('task_ug01_09','team_ug0000000001','user_fae870000002','user_fae870000002','Barcode printer integration — pending vendor SDK','Zebra SDK licence not yet released by the vendor; parked rather than blocked.','todo','low','{erp,hardware}','2026-09-18 18:00:00+05:30','2026-07-28 16:00:00+05:30',NULL,FALSE,1,300),
 ('task_ug01_10','team_ug0000000001','user_fae870000001','user_fae870000001','Sign-off on cutover plan','Weekend cutover, 26-27 September, with a two-day parallel run either side.','in_review','high','{erp,approval}','2026-08-13 18:00:00+05:30','2026-07-30 10:00:00+05:30',NULL,TRUE,0,240),
 ('task_ug01_11','team_ug0000000001','user_fae870000008','user_fae870000008','Draft go-live communication for Aarna staff','One page in Gujarati and English, with the helpdesk number.','todo','low','{erp,comms}','2026-08-28 18:00:00+05:30','2026-08-01 09:30:00+05:30',NULL,FALSE,2,180),
 ('task_ug01_12','team_ug0000000001','user_fae870000001','user_fae870000007','Post-go-live support roster','Four weeks of on-site cover, two people per day.','todo','medium','{erp,support}','2026-09-25 18:00:00+05:30','2026-08-03 11:00:00+05:30',NULL,FALSE,3,240),
 ('task_ug02_01','team_ug0000000002','user_fae870000002','user_fae870000008','Requirement sign-off with site engineers','Walked four sites; the daily progress report is the only thing they will actually fill in.','done','high','{portal,discovery}','2026-03-27 18:00:00+05:30','2026-03-17 09:30:00+05:30','2026-03-26 17:00:00+05:30',FALSE,0,720),
 ('task_ug02_02','team_ug0000000002','user_fae870000002','user_fae870000003','Wireframes for daily progress report','Six fields and a photo. Anything longer and it will not be filled in at 6pm on a site.','done','medium','{portal,design}','2026-04-10 18:00:00+05:30','2026-03-28 10:00:00+05:30','2026-04-13 12:00:00+05:30',FALSE,1,600),
 ('task_ug02_03','team_ug0000000002','user_fae870000002','user_fae870000002','Photo upload with offline queue','Sites lose signal; uploads queue on the device and drain when the engineer reaches the office.','done','high','{portal,mobile}','2026-05-15 18:00:00+05:30','2026-04-15 11:00:00+05:30','2026-05-19 18:30:00+05:30',FALSE,2,1800),
 ('task_ug02_04','team_ug0000000002','user_fae870000002','user_fae870000002','Role matrix — site engineer vs project manager','A site engineer may not see the commercial columns. Agreed with Bhavya on 22 May.','done','medium','{portal,rbac}','2026-05-29 18:00:00+05:30','2026-05-04 09:45:00+05:30','2026-05-28 16:00:00+05:30',FALSE,3,480),
 ('task_ug02_05','team_ug0000000002','user_fae870000002','user_fae870000003','Weekly S-curve chart','Planned versus actual progress by work package, one chart per site.','in_progress','medium','{portal,reports}','2026-08-20 18:00:00+05:30','2026-06-22 10:30:00+05:30',NULL,FALSE,0,900),
 ('task_ug02_06','team_ug0000000002','user_fae870000002','user_fae870000002','Labour attendance import from Excel','Every site keeps a different sheet layout. Needs a mapping step, which was not in the estimate.','in_progress','high','{portal,import}','2026-07-24 18:00:00+05:30','2026-06-30 14:00:00+05:30',NULL,FALSE,1,1200),
 ('task_ug02_07','team_ug0000000002','user_fae870000008','user_fae870000008','Client review of report templates','Bhavya want the contractor name on every page footer.','in_review','medium','{portal,review}','2026-08-12 18:00:00+05:30','2026-07-14 11:00:00+05:30',NULL,FALSE,0,240),
 ('task_ug02_08','team_ug0000000002','user_fae870000003','user_fae870000002','Fix: photos rotate on iOS upload','EXIF orientation dropped on resize. Reported from the Vadodara site.','todo','high','{portal,bug,mobile}','2026-08-04 18:00:00+05:30','2026-07-31 09:00:00+05:30',NULL,FALSE,0,180),
 ('task_ug02_09','team_ug0000000002','user_fae870000003','user_fae870000003','Add Marathi labels for Pune site','Field labels and validation messages only; reports stay in English.','todo','low','{portal,i18n}','2026-09-11 18:00:00+05:30','2026-08-02 10:00:00+05:30',NULL,FALSE,1,360),
 ('task_ug02_10','team_ug0000000002','user_fae870000002','user_fae870000002','Load test — 60 concurrent site uploads','Peak is 6pm across all sites at once. Test that, not the average.','todo','medium','{portal,performance}','2026-08-27 18:00:00+05:30','2026-08-04 15:00:00+05:30',NULL,FALSE,2,480),
 ('task_ug02_11','team_ug0000000002','user_fae870000008','user_fae870000008','Handover documentation','Admin guide and the escalation matrix. Bhavya IT will run it after October.','todo','low','{portal,docs}','2026-09-30 18:00:00+05:30','2026-08-05 09:30:00+05:30',NULL,FALSE,3,420),
 ('task_ug03_01','team_ug0000000003','user_fae870000001','user_fae870000005','Gap assessment against Schedule M','Eleven gaps, four of them on document retention. Report sent to Dr Chandrika Bhatt on 23 April.','done','urgent','{gmp,compliance}','2026-04-24 18:00:00+05:30','2026-04-07 09:30:00+05:30','2026-04-23 18:20:00+05:30',FALSE,0,1440),
 ('task_ug03_02','team_ug0000000003','user_fae870000001','user_fae870000001','Document numbering convention','SOP/DEPT/NNN/RR. Agreed with QA so legacy numbers can be carried across.','done','medium','{gmp,sop}','2026-05-08 18:00:00+05:30','2026-04-24 10:00:00+05:30','2026-05-07 15:30:00+05:30',FALSE,1,300),
 ('task_ug03_03','team_ug0000000003','user_fae870000001','user_fae870000007','Migrate 340 legacy SOPs','Scanned PDFs with no text layer. OCR pass first, then metadata by hand.','done','high','{gmp,migration}','2026-06-19 18:00:00+05:30','2026-05-11 09:00:00+05:30','2026-06-25 17:45:00+05:30',FALSE,2,3600),
 ('task_ug03_04','team_ug0000000003','user_fae870000001','user_fae870000001','Electronic signature workflow — 21 CFR Part 11','Signature manifestation, audit trail and record linking. The part the auditor will look at first.','in_progress','urgent','{gmp,esign}','2026-08-28 18:00:00+05:30','2026-06-29 10:00:00+05:30',NULL,FALSE,0,2400),
 ('task_ug03_05','team_ug0000000003','user_fae870000005','user_fae870000005','Change control form','Initiator, impact assessment, QA review, effective date. Four states and no shortcuts.','in_progress','high','{gmp,workflow}','2026-08-19 18:00:00+05:30','2026-07-06 11:00:00+05:30',NULL,FALSE,1,900),
 ('task_ug03_06','team_ug0000000003','user_fae870000001','user_fae870000007','Training records module','Who read which SOP revision, and when. Needed for the September audit.','todo','medium','{gmp,training}','2026-09-08 18:00:00+05:30','2026-07-13 09:30:00+05:30',NULL,FALSE,0,1200),
 ('task_ug03_07','team_ug0000000003','user_fae870000007','user_fae870000007','Deviation log — pending QA head input','Blocked since 3 July on the deviation categories. Chased twice.','in_progress','medium','{gmp,qa}','2026-07-17 18:00:00+05:30','2026-06-22 14:30:00+05:30',NULL,FALSE,2,600),
 ('task_ug03_08','team_ug0000000003','user_fae870000001','user_fae870000001','Periodic review reminder engine','Two-year review cycle per SOP, with a 60-day warning to the owner.','todo','medium','{gmp,automation}','2026-09-22 18:00:00+05:30','2026-07-27 10:00:00+05:30',NULL,FALSE,1,720),
 ('task_ug03_09','team_ug0000000003','user_fae870000005','user_fae870000005','Validation protocol IQ/OQ/PQ','Written; needs the partner signature before it goes to Chandrika QA.','in_review','urgent','{gmp,validation}','2026-08-25 18:00:00+05:30','2026-07-29 09:00:00+05:30',NULL,TRUE,0,1800),
 ('task_ug03_10','team_ug0000000003','user_fae870000001','user_fae870000001','Audit trail retention — 7 years','Storage sizing and the archival job. Cannot be a soft delete.','todo','high','{gmp,retention}','2026-10-02 18:00:00+05:30','2026-08-01 11:00:00+05:30',NULL,FALSE,2,600),
 ('task_ug03_11','team_ug0000000003','user_fae870000001','user_fae870000007','User acceptance with QA team','Six people, three sessions, signed scripts.','todo','medium','{gmp,uat}','2026-10-16 18:00:00+05:30','2026-08-03 10:00:00+05:30',NULL,FALSE,3,900),
 ('task_ug03_12','team_ug0000000003','user_fae870000005','user_fae870000005','Restrict SOP export to approved roles','Export was open to every reader. Closed and logged.','done','high','{gmp,security}','2026-07-10 18:00:00+05:30','2026-06-15 15:00:00+05:30','2026-07-09 12:00:00+05:30',FALSE,3,240)
) AS v(task_id, team_id, creator, assignee, title, descr, status, priority, tags, due, created, completed, appr, ord, est)
JOIN public.users cu ON cu.user_id = v.creator
JOIN public.users au ON au.user_id = v.assignee
WHERE EXISTS (SELECT 1 FROM public.teams t WHERE t.team_id = v.team_id AND t.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.task_id = v.task_id);

-- ── batch 2: projects 4-6 (33 tasks) ─────────────────────────────────
-- Project 4 is a CLOSED project — nine done and one straggler. A board
-- where every project is mid-flight is a board nobody recognises.
INSERT INTO public.tasks
 (task_id, team_id, created_by_user_id, created_by_name, assignee_user_ids, assignee_emails,
  title, description, status, priority, tags, due_at, created_at, updated_at,
  completed_at, completed_by_user_id, column_slug, column_id, sort_order,
  requires_approval, approval_status, approval_requested_at, estimated_minutes)
SELECT v.task_id, v.team_id, v.creator, cu.name, ARRAY[v.assignee], ARRAY[au.email],
 v.title, v.descr, v.status, v.priority, v.tags::text[],
 v.due::timestamptz, v.created::timestamptz,
 COALESCE(v.completed::timestamptz, v.created::timestamptz),
 v.completed::timestamptz,
 CASE WHEN v.status='done' THEN v.assignee END,
 CASE v.status WHEN 'todo' THEN 'todo' WHEN 'in_progress' THEN 'in-progress'
      WHEN 'in_review' THEN CASE WHEN v.appr THEN 'approval' ELSE 'in-review' END
      WHEN 'done' THEN 'done' ELSE 'todo' END,
 'col_' || right(v.team_id,4) || CASE v.status WHEN 'todo' THEN '_todo' WHEN 'in_progress' THEN '_prog'
      WHEN 'in_review' THEN CASE WHEN v.appr THEN '_appr' ELSE '_revw' END
      WHEN 'done' THEN '_done' ELSE '_todo' END,
 v.ord, v.appr,
 CASE WHEN v.appr THEN 'pending' END,
 CASE WHEN v.appr THEN v.created::timestamptz END,
 v.est
FROM (VALUES
 ('task_ug04_01','team_ug0000000004','user_fae870000002','user_fae870000002','Extract item master from legacy FoxPro','1,180 SKUs out of a 1998 system with no export. Read straight from the DBF files.','done','high','{inventory,extract}','2026-03-06 18:00:00+05:30','2026-02-24 09:30:00+05:30','2026-03-05 16:00:00+05:30',FALSE,0,900),
 ('task_ug04_02','team_ug0000000004','user_fae870000002','user_fae870000002','Deduplicate 1,180 SKUs','214 were the same bearing under three spellings. Merged with the stores head in the room.','done','high','{inventory,data}','2026-03-20 18:00:00+05:30','2026-03-06 10:00:00+05:30','2026-03-24 17:30:00+05:30',FALSE,1,1440),
 ('task_ug04_03','team_ug0000000004','user_fae870000005','user_fae870000005','Map HSN codes to items','Every item needs an HSN before the first GST invoice. 38 had none anywhere in the old system.','done','urgent','{inventory,gst}','2026-04-03 18:00:00+05:30','2026-03-16 11:00:00+05:30','2026-04-02 15:20:00+05:30',FALSE,2,720),
 ('task_ug04_04','team_ug0000000004','user_fae870000005','user_fae870000005','Opening stock valuation — weighted average','Valued as on 01-Apr-2026 and tied back to the audited balance sheet.','done','high','{inventory,finance}','2026-04-17 18:00:00+05:30','2026-04-06 09:00:00+05:30','2026-04-16 18:00:00+05:30',FALSE,3,600),
 ('task_ug04_05','team_ug0000000004','user_fae870000002','user_fae870000002','Warehouse bin layout in Vikray','Two stores, 84 bins, mapped to the physical racking so pickers do not have to translate.','done','medium','{inventory,setup}','2026-05-01 18:00:00+05:30','2026-04-20 10:30:00+05:30','2026-05-04 12:00:00+05:30',FALSE,4,480),
 ('task_ug04_06','team_ug0000000004','user_fae870000002','user_fae870000002','Reorder levels for A-class items','Set from 18 months of issue history; B and C classes left manual for now.','done','medium','{inventory,planning}','2026-05-15 18:00:00+05:30','2026-05-04 09:30:00+05:30','2026-05-14 16:30:00+05:30',FALSE,5,360),
 ('task_ug04_07','team_ug0000000004','user_fae870000002','user_fae870000002','Parallel run — two weeks','Both systems posted for a fortnight; three variances, all traced to manual issues.','done','high','{inventory,uat}','2026-06-05 18:00:00+05:30','2026-05-18 09:00:00+05:30','2026-06-04 18:30:00+05:30',FALSE,6,1200),
 ('task_ug04_08','team_ug0000000004','user_fae870000002','user_fae870000005','Sign-off from Ekveera stores head','Signed 11 June by Sachin Deshmukh.','done','high','{inventory,signoff}','2026-06-12 18:00:00+05:30','2026-06-05 10:00:00+05:30','2026-06-11 14:00:00+05:30',FALSE,7,120),
 ('task_ug04_09','team_ug0000000004','user_fae870000002','user_fae870000002','Decommission legacy server','Final image taken and held for seven years, then the box powered down.','done','low','{inventory,closure}','2026-06-26 18:00:00+05:30','2026-06-15 11:00:00+05:30','2026-06-30 11:00:00+05:30',FALSE,8,240),
 ('task_ug04_10','team_ug0000000004','user_fae870000002','user_fae870000002','Lessons-learned note for the practice','Never estimate a migration before seeing the source data. Still not written.','todo','low','{inventory,retro}','2026-06-30 18:00:00+05:30','2026-06-22 15:00:00+05:30',NULL,FALSE,0,120),
 ('task_ug05_01','team_ug0000000005','user_fae870000003','user_fae870000004','Loyalty tier design — silver/gold/platinum','Thresholds set from Firozi''s own basket data, not from a template.','done','high','{loyalty,design}','2026-05-22 18:00:00+05:30','2026-05-12 10:00:00+05:30','2026-05-21 17:00:00+05:30',FALSE,0,600),
 ('task_ug05_02','team_ug0000000005','user_fae870000003','user_fae870000004','Points accrual rules per category','Groceries accrue at half rate; that was the whole commercial argument.','done','high','{loyalty,rules}','2026-06-05 18:00:00+05:30','2026-05-22 09:30:00+05:30','2026-06-08 12:30:00+05:30',FALSE,1,480),
 ('task_ug05_03','team_ug0000000005','user_fae870000003','user_fae870000003','App screens — onboarding flow','Mobile number, OTP, done. No email, no password.','done','medium','{loyalty,ui}','2026-06-19 18:00:00+05:30','2026-06-01 11:00:00+05:30','2026-06-18 16:00:00+05:30',FALSE,2,900),
 ('task_ug05_04','team_ug0000000005','user_fae870000002','user_fae870000002','POS integration at 14 Firozi outlets','Two POS versions in the estate. The older one has no callback and needs polling.','in_progress','urgent','{loyalty,pos}','2026-08-24 18:00:00+05:30','2026-06-22 09:00:00+05:30',NULL,FALSE,0,2400),
 ('task_ug05_05','team_ug0000000005','user_fae870000004','user_fae870000004','SMS OTP vendor selection','Three quotes; picked on delivery rate in tier-2 towns, not on price.','done','medium','{loyalty,vendor}','2026-07-03 18:00:00+05:30','2026-06-24 10:00:00+05:30','2026-07-02 15:00:00+05:30',FALSE,3,300),
 ('task_ug05_06','team_ug0000000005','user_fae870000002','user_fae870000002','Redemption cap per bill','Maximum 20% of bill value in points. Firozi finance asked for this after the pilot numbers.','in_progress','high','{loyalty,rules}','2026-08-18 18:00:00+05:30','2026-07-08 11:30:00+05:30',NULL,FALSE,1,360),
 ('task_ug05_07','team_ug0000000005','user_fae870000003','user_fae870000003','Card-less identification by mobile number','Customers will not carry a card. Mobile number at the till, OTP only for redemption.','in_progress','medium','{loyalty,ux}','2026-08-31 18:00:00+05:30','2026-07-15 09:30:00+05:30',NULL,FALSE,2,720),
 ('task_ug05_08','team_ug0000000005','user_fae870000007','user_fae870000002','Fix: duplicate points on split bills','A bill split across two payment modes accrues twice. Found at the Andheri outlet.','todo','urgent','{loyalty,bug}','2026-07-29 18:00:00+05:30','2026-07-24 14:00:00+05:30',NULL,FALSE,0,240),
 ('task_ug05_09','team_ug0000000005','user_fae870000004','user_fae870000004','Store staff training deck','Fifteen slides, mostly screenshots. Staff turnover is high so it has to stand alone.','todo','low','{loyalty,training}','2026-09-15 18:00:00+05:30','2026-07-30 10:00:00+05:30',NULL,FALSE,1,300),
 ('task_ug05_10','team_ug0000000005','user_fae870000003','user_fae870000003','Privacy notice for member data','What is collected, how long it is kept, and how a member asks for deletion.','in_review','high','{loyalty,legal}','2026-08-13 18:00:00+05:30','2026-08-01 09:00:00+05:30',NULL,TRUE,0,300),
 ('task_ug05_11','team_ug0000000005','user_fae870000007','user_fae870000007','Regression pack for loyalty engine','Accrual, redemption, expiry and reversal. Expiry is the one nobody tests.','todo','medium','{loyalty,qa}','2026-09-01 18:00:00+05:30','2026-08-03 11:00:00+05:30',NULL,FALSE,2,600),
 ('task_ug05_12','team_ug0000000005','user_fae870000002','user_fae870000002','Pilot at Bandra outlet','Two weeks, one outlet, real customers. Then decide on the rest.','todo','high','{loyalty,pilot}','2026-09-08 18:00:00+05:30','2026-08-04 10:00:00+05:30',NULL,FALSE,3,480),
 ('task_ug05_13','team_ug0000000005','user_fae870000004','user_fae870000004','Firozi ask: gift-card top-up in phase 2','Raised by Farhan Merchant on 5 August. Not in the current scope; logged so it is not lost.','requested','low','{loyalty,request}','2026-11-02 18:00:00+05:30','2026-08-05 16:00:00+05:30',NULL,FALSE,4,NULL),
 ('task_ug06_01','team_ug0000000006','user_fae870000007','user_fae870000007','Test strategy document','What is automated, what stays manual, and who fixes a red build.','done','high','{qa,strategy}','2026-06-12 18:00:00+05:30','2026-06-02 09:30:00+05:30','2026-06-11 15:00:00+05:30',FALSE,0,480),
 ('task_ug06_02','team_ug0000000006','user_fae870000007','user_fae870000002','Select framework — Playwright','Chosen over Cypress for multi-tab and for the trace viewer.','done','medium','{qa,tooling}','2026-06-19 18:00:00+05:30','2026-06-08 10:00:00+05:30','2026-06-18 12:00:00+05:30',FALSE,1,240),
 ('task_ug06_03','team_ug0000000006','user_fae870000007','user_fae870000007','Smoke suite — 24 critical paths','Login, search, checkout and the four reports Indira''s customers open daily.','done','high','{qa,suite}','2026-07-10 18:00:00+05:30','2026-06-22 09:00:00+05:30','2026-07-14 18:00:00+05:30',FALSE,2,1800),
 ('task_ug06_04','team_ug0000000006','user_fae870000002','user_fae870000002','CI pipeline on every pull request','Smoke suite on every PR, full suite nightly. Under eight minutes or nobody waits for it.','in_progress','high','{qa,ci}','2026-08-20 18:00:00+05:30','2026-07-06 11:00:00+05:30',NULL,FALSE,0,900),
 ('task_ug06_05','team_ug0000000006','user_fae870000007','user_fae870000007','Flaky test triage — 6 known offenders','All six wait on a fixed timeout. Rewrite them against a condition, not a clock.','in_progress','medium','{qa,flaky}','2026-07-28 18:00:00+05:30','2026-07-13 10:00:00+05:30',NULL,FALSE,1,480),
 ('task_ug06_06','team_ug0000000006','user_fae870000002','user_fae870000002','Test data seeding without production copies','No customer data in a test environment, ever. Seeded fixtures instead.','todo','high','{qa,data}','2026-08-26 18:00:00+05:30','2026-07-21 09:30:00+05:30',NULL,FALSE,0,720),
 ('task_ug06_07','team_ug0000000006','user_fae870000007','user_fae870000007','Accessibility checks in the suite','axe-core on eight key pages, failing the build on serious and critical only.','todo','medium','{qa,a11y}','2026-09-03 18:00:00+05:30','2026-07-29 11:00:00+05:30',NULL,FALSE,1,420),
 ('task_ug06_08','team_ug0000000006','user_fae870000007','user_fae870000002','Nightly run report to Sanvaad','One message per night with pass rate and the new failures only.','in_review','low','{qa,reporting}','2026-08-15 18:00:00+05:30','2026-08-01 10:00:00+05:30',NULL,FALSE,0,180),
 ('task_ug06_09','team_ug0000000006','user_fae870000007','user_fae870000007','Coverage target 70% agreed with Indira','Line coverage on the service layer only. UI coverage is not the number that matters.','todo','medium','{qa,coverage}','2026-09-17 18:00:00+05:30','2026-08-03 09:00:00+05:30',NULL,FALSE,2,360),
 ('task_ug06_10','team_ug0000000006','user_fae870000007','user_fae870000007','Indira ask: performance suite next quarter','Vivek Raghavan raised it on 5 August. Out of scope this quarter.','requested','low','{qa,request}','2026-10-20 18:00:00+05:30','2026-08-05 15:00:00+05:30',NULL,FALSE,3,NULL)
) AS v(task_id, team_id, creator, assignee, title, descr, status, priority, tags, due, created, completed, appr, ord, est)
JOIN public.users cu ON cu.user_id = v.creator
JOIN public.users au ON au.user_id = v.assignee
WHERE EXISTS (SELECT 1 FROM public.teams t WHERE t.team_id = v.team_id AND t.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.task_id = v.task_id);

-- ── batch 3: projects 7-8 (22 tasks) ─────────────────────────────────
INSERT INTO public.tasks
 (task_id, team_id, created_by_user_id, created_by_name, assignee_user_ids, assignee_emails,
  title, description, status, priority, tags, due_at, created_at, updated_at,
  completed_at, completed_by_user_id, column_slug, column_id, sort_order,
  requires_approval, approval_status, approval_requested_at, estimated_minutes)
SELECT v.task_id, v.team_id, v.creator, cu.name, ARRAY[v.assignee], ARRAY[au.email],
 v.title, v.descr, v.status, v.priority, v.tags::text[],
 v.due::timestamptz, v.created::timestamptz,
 COALESCE(v.completed::timestamptz, v.created::timestamptz),
 v.completed::timestamptz,
 CASE WHEN v.status='done' THEN v.assignee END,
 CASE v.status WHEN 'todo' THEN 'todo' WHEN 'in_progress' THEN 'in-progress'
      WHEN 'in_review' THEN CASE WHEN v.appr THEN 'approval' ELSE 'in-review' END
      WHEN 'done' THEN 'done' ELSE 'todo' END,
 'col_' || right(v.team_id,4) || CASE v.status WHEN 'todo' THEN '_todo' WHEN 'in_progress' THEN '_prog'
      WHEN 'in_review' THEN CASE WHEN v.appr THEN '_appr' ELSE '_revw' END
      WHEN 'done' THEN '_done' ELSE '_todo' END,
 v.ord, v.appr,
 CASE WHEN v.appr THEN 'pending' END,
 CASE WHEN v.appr THEN v.created::timestamptz END,
 v.est
FROM (VALUES
 ('task_ug07_01','team_ug0000000007','user_fae870000005','user_fae870000005','GSTR-1 filing — April 2026','Filed 10 May. 213 B2B invoices, no mismatches.','done','urgent','{gst,filing}','2026-05-11 18:00:00+05:30','2026-05-01 09:30:00+05:30','2026-05-10 17:00:00+05:30',FALSE,0,300),
 ('task_ug07_02','team_ug0000000007','user_fae870000005','user_fae870000005','GSTR-3B filing — April 2026','Filed 19 May with cash ledger payment of the shortfall.','done','urgent','{gst,filing}','2026-05-20 18:00:00+05:30','2026-05-12 09:30:00+05:30','2026-05-19 16:00:00+05:30',FALSE,1,240),
 ('task_ug07_03','team_ug0000000007','user_fae870000005','user_fae870000005','TDS return 26Q — Q1 FY 2026-27','Filed 29 July. Two PANs were inoperative and had to be deducted at the higher rate.','done','high','{tds,filing}','2026-07-31 18:00:00+05:30','2026-07-01 10:00:00+05:30','2026-07-29 18:30:00+05:30',FALSE,2,480),
 ('task_ug07_04','team_ug0000000007','user_fae870000005','user_fae870000006','PF and ESI challans — June 2026','Paid 14 July for 25 employees.','done','high','{payroll,statutory}','2026-07-15 18:00:00+05:30','2026-07-02 09:00:00+05:30','2026-07-14 13:00:00+05:30',FALSE,3,180),
 ('task_ug07_05','team_ug0000000007','user_fae870000005','user_fae870000005','GSTR-1 filing — July 2026','Due 11 August. Invoice register locked; awaiting two credit notes from Firozi.','in_progress','urgent','{gst,filing}','2026-08-11 18:00:00+05:30','2026-08-01 09:30:00+05:30',NULL,FALSE,0,300),
 ('task_ug07_06','team_ug0000000007','user_fae870000006','user_fae870000006','Professional tax — Gujarat and Maharashtra','Two states, two rates, two portals. Maharashtra is the one that is always late.','in_progress','medium','{ptax,statutory}','2026-08-20 18:00:00+05:30','2026-08-01 11:00:00+05:30',NULL,FALSE,1,240),
 ('task_ug07_07','team_ug0000000007','user_fae870000005','user_fae870000005','Advance tax instalment — 15 Sep','45% of the estimated liability. Estimate to be revised after the August numbers.','todo','high','{incometax,planning}','2026-09-10 18:00:00+05:30','2026-07-28 10:00:00+05:30',NULL,FALSE,0,300),
 ('task_ug07_08','team_ug0000000007','user_fae870000005','user_fae870000005','Reconcile GSTR-2B with purchase register','Eleven invoices in the register that no supplier has filed. Chasing each one.','in_progress','high','{gst,reconciliation}','2026-07-25 18:00:00+05:30','2026-07-05 09:00:00+05:30',NULL,FALSE,2,720),
 ('task_ug07_09','team_ug0000000007','user_fae870000001','user_fae870000001','Board minutes for Q1','Two meetings, both minuted in draft. Needs the chair''s reading.','todo','low','{secretarial}','2026-08-31 18:00:00+05:30','2026-08-02 10:00:00+05:30',NULL,FALSE,1,180),
 ('task_ug07_10','team_ug0000000007','user_fae870000006','user_fae870000006','Form 16 issue to 25 employees','Part A from TRACES, Part B from the payroll run. Issue together, not separately.','todo','medium','{tds,payroll}','2026-09-20 18:00:00+05:30','2026-08-03 09:30:00+05:30',NULL,FALSE,2,300),
 ('task_ug07_11','team_ug0000000007','user_fae870000001','user_fae870000001','Statutory audit engagement letter','Drafted for FY 2026-27. Needs partner approval before it goes out.','in_review','medium','{audit,engagement}','2026-08-14 18:00:00+05:30','2026-08-04 11:00:00+05:30',NULL,TRUE,0,120),
 ('task_ug07_12','team_ug0000000007','user_fae870000006','user_fae870000006','ROC annual filing calendar','AOC-4 and MGT-7 dates for the group, working back from the AGM.','todo','low','{roc,planning}','2026-10-28 18:00:00+05:30','2026-08-05 10:00:00+05:30',NULL,FALSE,3,240),
 ('task_ug08_01','team_ug0000000008','user_fae870000004','user_fae870000004','Audit current site content','41 pages, 12 of them about services the firm no longer offers.','done','medium','{brand,audit}','2026-01-30 18:00:00+05:30','2026-01-20 10:00:00+05:30','2026-01-29 16:00:00+05:30',FALSE,0,480),
 ('task_ug08_02','team_ug0000000008','user_fae870000004','user_fae870000003','New logo lockups','Horizontal, stacked and the single mark for the app icon.','done','high','{brand,identity}','2026-02-27 18:00:00+05:30','2026-02-02 09:30:00+05:30','2026-03-03 12:00:00+05:30',FALSE,1,900),
 ('task_ug08_03','team_ug0000000008','user_fae870000003','user_fae870000003','Colour and type system','One serif for headings, one sans for everything else, and eight colours total.','done','medium','{brand,design}','2026-03-20 18:00:00+05:30','2026-03-04 10:00:00+05:30','2026-03-19 15:00:00+05:30',FALSE,2,600),
 ('task_ug08_04','team_ug0000000008','user_fae870000004','user_fae870000004','Photography shoot at Ahmedabad office','Real people at real desks. No stock images anywhere on the site.','done','low','{brand,content}','2026-04-17 18:00:00+05:30','2026-03-23 09:00:00+05:30','2026-04-21 17:00:00+05:30',FALSE,3,480),
 ('task_ug08_05','team_ug0000000008','user_fae870000004','user_fae870000004','Service pages copy — 9 pages','Written against what the firm actually sells now, priced in rupees, no jargon.','done','medium','{brand,copy}','2026-05-29 18:00:00+05:30','2026-04-22 10:00:00+05:30','2026-06-02 14:00:00+05:30',FALSE,4,1200),
 ('task_ug08_06','team_ug0000000008','user_fae870000006','user_fae870000006','Careers page with open roles','Three open roles today. Pulls from the Manav job openings rather than being typed twice.','in_progress','low','{brand,careers}','2026-08-21 18:00:00+05:30','2026-06-08 11:00:00+05:30',NULL,FALSE,0,360),
 ('task_ug08_07','team_ug0000000008','user_fae870000004','user_fae870000004','Case study — Ekveera inventory migration','Approved by Ekveera on 30 July. Needs the numbers checked against the project record.','in_progress','medium','{brand,casestudy}','2026-08-25 18:00:00+05:30','2026-07-06 09:30:00+05:30',NULL,FALSE,1,300),
 ('task_ug08_08','team_ug0000000008','user_fae870000003','user_fae870000003','SEO redirects from old URLs','41 old paths to 22 new ones. Anything not mapped goes to the service index, not the home page.','todo','high','{brand,seo}','2026-08-03 18:00:00+05:30','2026-07-27 10:00:00+05:30',NULL,FALSE,0,240),
 ('task_ug08_09','team_ug0000000008','user_fae870000003','user_fae870000003','Accessibility pass on the new site','Contrast, focus order and alt text. Two contrast failures on the accent colour.','in_review','medium','{brand,a11y}','2026-08-12 18:00:00+05:30','2026-08-01 09:00:00+05:30',NULL,FALSE,0,300),
 ('task_ug08_10','team_ug0000000008','user_fae870000004','user_fae870000004','Launch announcement across channels','One post, one newsletter, one note to every active client.','todo','medium','{brand,launch}','2026-09-07 18:00:00+05:30','2026-08-04 10:00:00+05:30',NULL,FALSE,1,180)
) AS v(task_id, team_id, creator, assignee, title, descr, status, priority, tags, due, created, completed, appr, ord, est)
JOIN public.users cu ON cu.user_id = v.creator
JOIN public.users au ON au.user_id = v.assignee
WHERE EXISTS (SELECT 1 FROM public.teams t WHERE t.team_id = v.team_id AND t.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.task_id = v.task_id);


-- =====================================================================
-- 4. APPROVALS — `public.approvals`, NOT `staging.approvals`
--
-- Measured 2026-08-06: public.approvals holds 46 rows and staging.approvals
-- holds 0. Every reader is unqualified (`FROM approvals`, server.py:1658,
-- 1914, 2278) or explicit `public.approvals` (skills/data/my_desk.py:87),
-- so `public` is the live table and the staging copy is a stranded
-- duplicate. Writing the staging one would have produced an approvals
-- queue that renders empty.
--
-- No org column: tenancy is team_id -> teams.org_id, which the EXISTS
-- below asserts.
--
-- `staging.approval_requests` is DELIBERATELY UNTOUCHED. It is scanned by
-- `reminder_service._APPROVAL_SCAN` — status='pending' older than 24h —
-- and every hit is emailed. A pending row there is an outbound row.
-- =====================================================================
INSERT INTO public.approvals (approval_id, task_id, team_id, requested_by, reviewed_by, status, request_type, request_data, review_notes, created_at, reviewed_at)
SELECT v.approval_id, v.task_id, v.team_id, v.requested_by, NULLIF(v.reviewed_by_raw,'NULL'), v.status, 'create',
       jsonb_build_object('title', t.title, 'description', t.description, 'priority', t.priority, 'team_id', v.team_id),
       v.notes, v.created::timestamptz, v.reviewed::timestamptz
FROM (VALUES
 ('approval_ug000001','task_ug01_07','team_ug0000000001','user_fae870000008','user_fae870000001','approved','Two batches agreed with the plant HR. Budget for handouts approved.','2026-07-20 09:10:00+05:30','2026-07-21 11:00:00+05:30'),
 ('approval_ug000002','task_ug01_09','team_ug0000000001','user_fae870000002','user_fae870000001','approved','Park it. Do not hold the cutover for a printer.','2026-07-28 16:10:00+05:30','2026-07-29 09:30:00+05:30'),
 ('approval_ug000003','task_ug02_09','team_ug0000000002','user_fae870000003','user_fae870000002','approved','Marathi labels only. Reports stay English — Bhavya head office reads them.','2026-08-02 10:10:00+05:30','2026-08-03 09:00:00+05:30'),
 ('approval_ug000004','task_ug02_10','team_ug0000000002','user_fae870000002','NULL','pending',NULL,'2026-08-04 15:10:00+05:30',NULL),
 ('approval_ug000005','task_ug03_10','team_ug0000000003','user_fae870000001','user_fae870000005','approved','Seven years is the Schedule M requirement. Storage cost accepted.','2026-08-01 11:10:00+05:30','2026-08-02 10:00:00+05:30'),
 ('approval_ug000006','task_ug03_11','team_ug0000000003','user_fae870000007','NULL','pending',NULL,'2026-08-03 10:10:00+05:30',NULL),
 ('approval_ug000007','task_ug04_10','team_ug0000000004','user_fae870000002','user_fae870000002','approved','Worth an hour. Write it before the next migration is quoted.','2026-06-22 15:10:00+05:30','2026-06-23 09:00:00+05:30'),
 ('approval_ug000008','task_ug05_09','team_ug0000000005','user_fae870000004','user_fae870000003','approved','Fifteen slides maximum. Staff turnover means it has to stand alone.','2026-07-30 10:10:00+05:30','2026-07-31 12:00:00+05:30'),
 ('approval_ug000009','task_ug05_13','team_ug0000000005','user_fae870000004','NULL','pending',NULL,'2026-08-05 16:10:00+05:30',NULL),
 ('approval_ug000010','task_ug06_10','team_ug0000000006','user_fae870000007','NULL','pending',NULL,'2026-08-05 15:10:00+05:30',NULL),
 ('approval_ug000011','task_ug06_07','team_ug0000000006','user_fae870000007','user_fae870000007','rejected','Not this quarter. The CI pipeline has to be green before we add another gate to it.','2026-07-29 11:10:00+05:30','2026-07-30 15:00:00+05:30'),
 ('approval_ug000012','task_ug08_04','team_ug0000000008','user_fae870000004','user_fae870000003','rejected','Shoot approved, budget was not. Resubmitted at half the day rate and approved separately.','2026-03-23 09:10:00+05:30','2026-03-24 10:00:00+05:30')
) AS v(approval_id, task_id, team_id, requested_by, reviewed_by_raw, status, notes, created, reviewed)
JOIN public.tasks t ON t.task_id = v.task_id
WHERE EXISTS (SELECT 1 FROM public.teams tm WHERE tm.team_id = v.team_id AND tm.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.approvals a WHERE a.approval_id = v.approval_id);

-- Four MORE approvals exist without a row here: the four tasks carrying
-- requires_approval=TRUE / approval_status='pending'. Both `my_desk.py` and
-- `server.py:1914` UNION those in as `task_approval--<task_id>`, so the
-- queue shows sixteen items from twelve rows. That is the product's own
-- shape, not an accident of this seed.


-- =====================================================================
-- 5. ACTIVITY — `public.activity_events`, same reason as approvals
--    (public: 1,207 rows; staging: 0). No org column; team_id is the path.
--    Types are the ones `services/activity_logger.py` and its callers
--    actually write: created, assigned, status_changed, commented,
--    field_changed. An invented type renders as a blank row.
-- =====================================================================
INSERT INTO public.activity_events (event_id, task_id, team_id, actor_id, type, data, created_at)
SELECT v.event_id, v.task_id, t.team_id, v.actor, v.type, v.data::jsonb, v.created::timestamptz
FROM (VALUES
 ('evt_ug0000000001','task_ug01_01','user_fae870000001','created','{"title":"Scope workshop with Aarna finance team"}','2026-02-10 09:30:00+05:30'),
 ('evt_ug0000000002','task_ug01_01','user_fae870000001','assigned','{"added":["user_fae870000008"],"removed":[]}','2026-02-10 09:32:00+05:30'),
 ('evt_ug0000000003','task_ug01_01','user_fae870000008','status_changed','{"from":"todo","to":"done"}','2026-02-19 17:10:00+05:30'),
 ('evt_ug0000000004','task_ug01_03','user_fae870000002','commented','{"preview":"Item master is worse than the sample suggested — 4,200 rows, 900 with no HSN."}','2026-03-11 12:20:00+05:30'),
 ('evt_ug0000000005','task_ug01_03','user_fae870000002','status_changed','{"from":"in_progress","to":"done"}','2026-04-02 19:20:00+05:30'),
 ('evt_ug0000000006','task_ug01_08','user_fae870000001','status_changed','{"from":"todo","to":"in_progress"}','2026-07-06 10:15:00+05:30'),
 ('evt_ug0000000007','task_ug01_08','user_fae870000001','commented','{"preview":"Variance is 1.8% on grey fabric. Stores register needed before I can close this."}','2026-08-03 16:40:00+05:30'),
 ('evt_ug0000000008','task_ug01_10','user_fae870000001','field_changed','{"field":"requires_approval","from":false,"to":true}','2026-07-30 10:05:00+05:30'),
 ('evt_ug0000000009','task_ug02_03','user_fae870000002','created','{"title":"Photo upload with offline queue"}','2026-04-15 11:00:00+05:30'),
 ('evt_ug0000000010','task_ug02_03','user_fae870000002','status_changed','{"from":"in_review","to":"done"}','2026-05-19 18:30:00+05:30'),
 ('evt_ug0000000011','task_ug02_06','user_fae870000002','commented','{"preview":"Every site keeps a different sheet. Adding a mapping step — this will slip a week."}','2026-07-18 15:10:00+05:30'),
 ('evt_ug0000000012','task_ug02_08','user_fae870000003','created','{"title":"Fix: photos rotate on iOS upload"}','2026-07-31 09:00:00+05:30'),
 ('evt_ug0000000013','task_ug02_08','user_fae870000003','assigned','{"added":["user_fae870000002"],"removed":[]}','2026-07-31 09:05:00+05:30'),
 ('evt_ug0000000014','task_ug03_03','user_fae870000007','status_changed','{"from":"in_progress","to":"done"}','2026-06-25 17:45:00+05:30'),
 ('evt_ug0000000015','task_ug03_07','user_fae870000007','commented','{"preview":"Chased QA head again on 3 July. No categories yet, so this stays open."}','2026-07-03 11:30:00+05:30'),
 ('evt_ug0000000016','task_ug03_09','user_fae870000005','status_changed','{"from":"in_progress","to":"in_review"}','2026-08-04 14:00:00+05:30'),
 ('evt_ug0000000017','task_ug04_07','user_fae870000002','status_changed','{"from":"in_progress","to":"done"}','2026-06-04 18:30:00+05:30'),
 ('evt_ug0000000018','task_ug04_08','user_fae870000005','commented','{"preview":"Signed by Sachin Deshmukh. Scan filed against the project."}','2026-06-11 14:05:00+05:30'),
 ('evt_ug0000000019','task_ug05_04','user_fae870000002','commented','{"preview":"Two POS versions in the estate. The older one has no callback — polling instead."}','2026-07-09 10:45:00+05:30'),
 ('evt_ug0000000020','task_ug05_08','user_fae870000007','created','{"title":"Fix: duplicate points on split bills"}','2026-07-24 14:00:00+05:30'),
 ('evt_ug0000000021','task_ug05_10','user_fae870000003','field_changed','{"field":"requires_approval","from":false,"to":true}','2026-08-01 09:05:00+05:30'),
 ('evt_ug0000000022','task_ug06_05','user_fae870000007','commented','{"preview":"All six flakes wait on a fixed timeout. Rewriting against a condition."}','2026-07-20 09:50:00+05:30'),
 ('evt_ug0000000023','task_ug07_03','user_fae870000005','status_changed','{"from":"in_progress","to":"done"}','2026-07-29 18:30:00+05:30'),
 ('evt_ug0000000024','task_ug07_08','user_fae870000005','commented','{"preview":"Eleven invoices in our register that no supplier has filed. Chasing each one."}','2026-07-27 12:00:00+05:30')
) AS v(event_id, task_id, actor, type, data, created)
JOIN public.tasks t ON t.task_id = v.task_id
WHERE EXISTS (SELECT 1 FROM public.teams tm WHERE tm.team_id = t.team_id AND tm.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.activity_events e WHERE e.event_id = v.event_id);

-- Every 'commented' event above has the comment it is about. An activity
-- feed whose comment rows lead nowhere is the sort of thing a demo
-- survives and a customer does not.
INSERT INTO public.task_comments (comment_id, task_id, user_id, body, created_at)
SELECT v.comment_id, v.task_id, v.user_id, v.body, v.created::timestamptz
FROM (VALUES
 ('cmt_ug0000000001','task_ug01_03','user_fae870000002','Item master is worse than the sample suggested — 4,200 rows, 900 with no HSN. Adding two days.','2026-03-11 12:20:00+05:30'),
 ('cmt_ug0000000002','task_ug01_08','user_fae870000001','Variance is 1.8% on grey fabric. I need the stores register before I can close this.','2026-08-03 16:40:00+05:30'),
 ('cmt_ug0000000003','task_ug02_06','user_fae870000002','Every site keeps a different sheet layout. Adding a mapping step — this will slip about a week.','2026-07-18 15:10:00+05:30'),
 ('cmt_ug0000000004','task_ug03_07','user_fae870000007','Chased the QA head again on 3 July. No deviation categories yet, so this stays open.','2026-07-03 11:30:00+05:30'),
 ('cmt_ug0000000005','task_ug04_08','user_fae870000005','Signed by Sachin Deshmukh on 11 June. Scan filed against the project.','2026-06-11 14:05:00+05:30'),
 ('cmt_ug0000000006','task_ug05_04','user_fae870000002','Two POS versions in the estate. The older one has no callback, so we poll it every 30 seconds.','2026-07-09 10:45:00+05:30'),
 ('cmt_ug0000000007','task_ug06_05','user_fae870000007','All six flaky tests wait on a fixed timeout. Rewriting them against a condition.','2026-07-20 09:50:00+05:30'),
 ('cmt_ug0000000008','task_ug07_08','user_fae870000005','Eleven invoices in our purchase register that no supplier has filed. Chasing each one by phone.','2026-07-27 12:00:00+05:30')
) AS v(comment_id, task_id, user_id, body, created)
JOIN public.tasks t ON t.task_id = v.task_id
WHERE EXISTS (SELECT 1 FROM public.teams tm WHERE tm.team_id = t.team_id AND tm.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.task_comments c WHERE c.comment_id = v.comment_id);


-- =====================================================================
-- 6. SANVAAD — 5 channels, 22 memberships, 70 messages, 6 mentions
--    Tables are `staging.samvada_*` (the schema spells it samvada; the
--    product spells it Sanvaad).
--
--    Threads are set in a SECOND pass. `parent_message_id` is a self
--    foreign key, and a reply inserted in the same statement as its parent
--    is a bet on row ordering inside one INSERT...SELECT.
--
--    Mentions are written in BOTH halves — the '@Full Name ' text the
--    composer inserts AND the `samvada_mentions` row that
--    `services/samvaad_mentions.py` records. A row without the text is a
--    badge pointing at a message that named nobody; the text without the
--    row is the feature exactly as it was broken before migration 093.
--
--    KEVAL SHAH (user_f798947b8a2e) is a member of all five. He is an
--    existing account and nothing about him is written except the
--    membership row — `samvada_channel_members` has no email column, so no
--    gmail address enters the database through this file.
--
--    Six channels with ids b1000000-… already existed on this org from an
--    earlier seed. They are left exactly as they are.
-- =====================================================================
INSERT INTO staging.samvada_channels (id, org_id, name, description, type, created_by, is_archived, created_at, updated_at, color)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.descr, v.type, v.created_by, FALSE,
       v.created::timestamptz, v.created::timestamptz, v.color
FROM (VALUES
 ('b2000000-0000-4000-8000-000000000001','aarna-erp','Aarna Textile ERP rollout — delivery team and the client-facing updates.','public','user_fae870000001','graha','2026-02-09 10:20:00+05:30'),
 ('b2000000-0000-4000-8000-000000000002','firozi-loyalty','Firozi Retail loyalty app. POS, points rules and the outlet pilot.','public','user_fae870000003','vikray','2026-05-11 10:10:00+05:30'),
 ('b2000000-0000-4000-8000-000000000003','qa-automation','Indira Software Labs QA automation. Nightly runs land here.','public','user_fae870000007','dristi','2026-06-01 09:40:00+05:30'),
 ('b2000000-0000-4000-8000-000000000004','compliance-desk','GST, TDS, PF and ROC. Filing dates and who is doing what.','private','user_fae870000005','ganit','2026-04-02 09:10:00+05:30'),
 ('b2000000-0000-4000-8000-000000000005','client-escalations','Anything a client has raised twice. Account managers and partners only.','public','user_fae870000008','sanvaad','2026-03-02 09:00:00+05:30')
) AS v(id, name, descr, type, created_by, color, created)
WHERE NOT EXISTS (SELECT 1 FROM staging.samvada_channels c WHERE c.id = v.id::uuid);

INSERT INTO staging.samvada_channel_members (channel_id, user_id, role, joined_at)
SELECT v.channel_id::uuid, v.user_id, v.role, v.joined::timestamptz
FROM (VALUES
 ('b2000000-0000-4000-8000-000000000001','user_fae870000001','admin','2026-02-09 10:20:00+05:30'),
 ('b2000000-0000-4000-8000-000000000001','user_fae870000002','member','2026-02-09 10:25:00+05:30'),
 ('b2000000-0000-4000-8000-000000000001','user_fae870000007','member','2026-02-12 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000001','user_fae870000008','member','2026-02-09 10:30:00+05:30'),
 ('b2000000-0000-4000-8000-000000000001','user_f798947b8a2e','member','2026-02-10 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000002','user_fae870000003','admin','2026-05-11 10:10:00+05:30'),
 ('b2000000-0000-4000-8000-000000000002','user_fae870000002','member','2026-05-11 10:15:00+05:30'),
 ('b2000000-0000-4000-8000-000000000002','user_fae870000004','member','2026-05-11 10:15:00+05:30'),
 ('b2000000-0000-4000-8000-000000000002','user_fae870000007','member','2026-06-02 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000002','user_f798947b8a2e','member','2026-05-12 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000003','user_fae870000007','admin','2026-06-01 09:40:00+05:30'),
 ('b2000000-0000-4000-8000-000000000003','user_fae870000002','member','2026-06-01 09:45:00+05:30'),
 ('b2000000-0000-4000-8000-000000000003','user_f798947b8a2e','member','2026-06-03 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000004','user_fae870000005','admin','2026-04-02 09:10:00+05:30'),
 ('b2000000-0000-4000-8000-000000000004','user_fae870000001','member','2026-04-02 09:15:00+05:30'),
 ('b2000000-0000-4000-8000-000000000004','user_fae870000006','member','2026-04-02 09:15:00+05:30'),
 ('b2000000-0000-4000-8000-000000000004','user_f798947b8a2e','member','2026-04-03 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000005','user_fae870000008','admin','2026-03-02 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000005','user_fae870000001','member','2026-03-02 09:05:00+05:30'),
 ('b2000000-0000-4000-8000-000000000005','user_fae870000004','member','2026-03-02 09:05:00+05:30'),
 ('b2000000-0000-4000-8000-000000000005','user_fae870000003','member','2026-05-14 09:00:00+05:30'),
 ('b2000000-0000-4000-8000-000000000005','user_f798947b8a2e','member','2026-03-03 09:00:00+05:30')
) AS v(channel_id, user_id, role, joined)
WHERE EXISTS (SELECT 1 FROM staging.samvada_channels c
              WHERE c.id = v.channel_id::uuid AND c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.samvada_channel_members m
                  WHERE m.channel_id = v.channel_id::uuid AND m.user_id = v.user_id);

-- 70 messages, 09-Feb to 05-Aug 2026. Ids are
-- c2000000-0000-4000-8000-0000000000NN so a re-run is a no-op.
INSERT INTO staging.samvada_messages (id, org_id, channel_id, sender_id, content, type, created_at, updated_at, pinned_at, pinned_by)
SELECT ('c2000000-0000-4000-8000-0000000000'||v.n)::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid,
       v.ch::uuid, v.sender, v.content, 'text', v.created::timestamptz, v.created::timestamptz,
       v.pinned::timestamptz, NULLIF(v.pinned_by,'')
FROM (VALUES
 ('01','b2000000-0000-4000-8000-000000000001','user_fae870000001','Channel for the Aarna rollout. Delivery talk here, anything commercial goes to me directly.','2026-02-09 10:22:00+05:30','2026-02-09 10:22:00+05:30','user_fae870000001'),
 ('02','b2000000-0000-4000-8000-000000000001','user_fae870000008','Workshop confirmed for 17-18 Feb at the Ahmedabad plant. Nilesh Sanghavi will sit in for both days.','2026-02-11 15:40:00+05:30',NULL,''),
 ('03','b2000000-0000-4000-8000-000000000001','user_fae870000002','Got the Tally backup. 41 ledger heads have no obvious mapping — I will list them rather than guess.','2026-02-24 11:05:00+05:30',NULL,''),
 ('04','b2000000-0000-4000-8000-000000000001','user_fae870000001','Good. Guessing a ledger mapping is how a trial balance ends up 3 lakh out on go-live day.','2026-02-24 11:20:00+05:30',NULL,''),
 ('05','b2000000-0000-4000-8000-000000000001','user_fae870000002','Item master is worse than the sample. 4,200 rows, about 900 with no HSN, and three units for the same yarn count.','2026-03-11 12:22:00+05:30',NULL,''),
 ('06','b2000000-0000-4000-8000-000000000001','user_fae870000008','I will take the HSN list to Nilesh. Their purchase team will know most of them.','2026-03-11 14:00:00+05:30',NULL,''),
 ('07','b2000000-0000-4000-8000-000000000001','user_fae870000001','GST codes are in. Intra-state, inter-state and the 5% job-work rate they use most.','2026-04-09 15:10:00+05:30',NULL,''),
 ('08','b2000000-0000-4000-8000-000000000001','user_fae870000002','Requisition workflow is three levels. Anything above 2 lakh goes to the plant head.','2026-06-18 10:30:00+05:30',NULL,''),
 ('09','b2000000-0000-4000-8000-000000000001','user_fae870000007','UAT script drafted — 62 cases across goods receipt, issue, return and physical stock.','2026-07-08 16:00:00+05:30',NULL,''),
 ('10','b2000000-0000-4000-8000-000000000001','user_fae870000001','Opening stock is the risk now. Physical count is 1.8% off on grey fabric and I do not have the stores register.','2026-07-14 09:45:00+05:30',NULL,''),
 ('11','b2000000-0000-4000-8000-000000000001','user_fae870000008','Asked twice. Their stores in-charge is on leave until the 20th.','2026-07-14 10:10:00+05:30',NULL,''),
 ('12','b2000000-0000-4000-8000-000000000001','user_fae870000001','@Pooja Barot Then the 31 July date on that task will not hold. Better to say so now than on the 30th.','2026-07-14 10:25:00+05:30',NULL,''),
 ('13','b2000000-0000-4000-8000-000000000001','user_fae870000001','Cutover plan is up for approval: weekend of 26-27 September, two days parallel either side.','2026-07-30 10:10:00+05:30','2026-07-30 10:15:00+05:30','user_fae870000001'),
 ('14','b2000000-0000-4000-8000-000000000001','user_fae870000002','Zebra have not released the SDK licence. Barcode printing is parked, not blocked — go-live does not need it.','2026-07-28 16:20:00+05:30',NULL,''),
 ('15','b2000000-0000-4000-8000-000000000001','user_fae870000007','Stores UAT is with the client. Two defects so far, both cosmetic.','2026-08-03 11:00:00+05:30',NULL,''),
 ('16','b2000000-0000-4000-8000-000000000001','user_fae870000008','Training set for 18 shop-floor users, two batches, Gujarati handouts. First week of September.','2026-08-04 09:30:00+05:30',NULL,''),
 ('17','b2000000-0000-4000-8000-000000000001','user_fae870000001','@Amit Sharma @Neha Chauhan Support roster after go-live: four weeks, two people a day. Amit and Neha to split it.','2026-08-05 10:00:00+05:30',NULL,''),
 ('18','b2000000-0000-4000-8000-000000000001','user_fae870000002','Noted. I will block the calendar from 28 September.','2026-08-05 10:20:00+05:30',NULL,''),
 ('19','b2000000-0000-4000-8000-000000000005','user_fae870000008','Starting this channel for anything a client has raised more than once. Partners and account managers.','2026-03-02 09:10:00+05:30','2026-03-02 09:12:00+05:30','user_fae870000008'),
 ('20','b2000000-0000-4000-8000-000000000005','user_fae870000004','Firozi asked about gift-card top-up again. It is not in scope and I have said so twice.','2026-06-15 11:00:00+05:30',NULL,''),
 ('21','b2000000-0000-4000-8000-000000000005','user_fae870000001','Log it as a request against the project rather than saying no in an email. Then it is on a list they can see.','2026-06-15 11:30:00+05:30',NULL,''),
 ('22','b2000000-0000-4000-8000-000000000005','user_fae870000008','Bhavya want the contractor name on every report footer. Small change, but it is the third revision to that template.','2026-07-16 14:20:00+05:30',NULL,''),
 ('23','b2000000-0000-4000-8000-000000000005','user_fae870000003','I will do it, but let us agree the template is frozen after this one.','2026-07-16 14:45:00+05:30',NULL,''),
 ('24','b2000000-0000-4000-8000-000000000005','user_fae870000008','Chandrika Pharma chased the deviation log twice. The delay is on their QA head, not on us — I have written that down carefully.','2026-07-22 10:15:00+05:30',NULL,''),
 ('25','b2000000-0000-4000-8000-000000000005','user_fae870000001','@Pooja Barot Good. Put the two chase dates in the project record so it is not a memory later.','2026-07-22 10:40:00+05:30',NULL,''),
 ('26','b2000000-0000-4000-8000-000000000005','user_fae870000004','Duplicate points on split bills at the Andheri outlet. Firozi finance noticed before we did.','2026-07-25 09:20:00+05:30',NULL,''),
 ('27','b2000000-0000-4000-8000-000000000005','user_fae870000008','Aarna will not have the stores register until the 20th. Flagging it here so nobody promises 31 July.','2026-07-27 16:00:00+05:30',NULL,''),
 ('28','b2000000-0000-4000-8000-000000000005','user_fae870000001','Two escalations open, both with a named owner and a date. That is the state I want this channel in.','2026-08-05 17:30:00+05:30',NULL,''),
 ('29','b2000000-0000-4000-8000-000000000002','user_fae870000003','Loyalty channel. Tiers, points rules, POS and the outlet pilot.','2026-05-11 10:12:00+05:30',NULL,''),
 ('30','b2000000-0000-4000-8000-000000000002','user_fae870000004','Tiers set from Firozi''s own basket data — silver 5k, gold 25k, platinum 75k a year. Not a template.','2026-05-20 11:00:00+05:30','2026-05-20 11:05:00+05:30','user_fae870000003'),
 ('31','b2000000-0000-4000-8000-000000000002','user_fae870000004','Groceries accrue at half rate. That was the whole commercial argument and Farhan Merchant agreed on 3 June.','2026-06-04 10:30:00+05:30',NULL,''),
 ('32','b2000000-0000-4000-8000-000000000002','user_fae870000003','Onboarding is mobile number, OTP, done. No email and no password — nobody would finish it otherwise.','2026-06-16 15:00:00+05:30',NULL,''),
 ('33','b2000000-0000-4000-8000-000000000002','user_fae870000002','POS problem: two versions across the 14 outlets. The older one has no callback so we poll every 30 seconds.','2026-07-09 10:50:00+05:30',NULL,''),
 ('34','b2000000-0000-4000-8000-000000000002','user_fae870000003','@Amit Sharma Does polling hold up at till speed? A customer will not wait four seconds for a points balance.','2026-07-09 11:10:00+05:30',NULL,''),
 ('35','b2000000-0000-4000-8000-000000000002','user_fae870000002','Under a second on the test rig. I want the Bandra pilot to confirm it on a real queue.','2026-07-09 11:25:00+05:30',NULL,''),
 ('36','b2000000-0000-4000-8000-000000000002','user_fae870000004','Firozi finance want a redemption cap — 20% of bill value in points, maximum.','2026-07-10 09:40:00+05:30',NULL,''),
 ('37','b2000000-0000-4000-8000-000000000002','user_fae870000007','Duplicate points on split bills. Found at Andheri: a bill paid part cash, part card accrues twice.','2026-07-24 14:05:00+05:30',NULL,''),
 ('38','b2000000-0000-4000-8000-000000000002','user_fae870000002','That is mine. Accrual is keyed on the payment line rather than the bill. Fix is small, the test is the work.','2026-07-24 14:30:00+05:30',NULL,''),
 ('39','b2000000-0000-4000-8000-000000000002','user_fae870000003','Privacy notice drafted — what we collect, how long we keep it, how a member asks for deletion.','2026-08-01 09:10:00+05:30',NULL,''),
 ('40','b2000000-0000-4000-8000-000000000002','user_fae870000004','Store staff deck will be fifteen slides, mostly screenshots. Turnover there is high so it has to stand alone.','2026-08-03 10:00:00+05:30',NULL,''),
 ('41','b2000000-0000-4000-8000-000000000002','user_fae870000007','Regression pack: accrual, redemption, expiry, reversal. Expiry is the one nobody ever tests.','2026-08-03 11:15:00+05:30',NULL,''),
 ('42','b2000000-0000-4000-8000-000000000002','user_fae870000002','Pilot at Bandra from 8 September. One outlet, two weeks, real customers, then we decide.','2026-08-04 10:10:00+05:30',NULL,''),
 ('43','b2000000-0000-4000-8000-000000000002','user_fae870000004','Gift-card top-up asked for again on 5 August. Logged as a request against the project, phase 2.','2026-08-05 16:05:00+05:30',NULL,''),
 ('44','b2000000-0000-4000-8000-000000000002','user_fae870000003','Card-less identification is in. Mobile number at the till, OTP only when they redeem.','2026-08-05 17:00:00+05:30',NULL,''),
 ('45','b2000000-0000-4000-8000-000000000003','user_fae870000007','QA automation for Indira. Strategy first, then the suite. Nightly results will land in this channel.','2026-06-01 09:45:00+05:30',NULL,''),
 ('46','b2000000-0000-4000-8000-000000000003','user_fae870000002','Playwright over Cypress. Multi-tab and the trace viewer decided it.','2026-06-10 11:00:00+05:30',NULL,''),
 ('47','b2000000-0000-4000-8000-000000000003','user_fae870000007','Smoke suite is 24 paths: login, search, checkout and the four reports Indira''s customers open every day.','2026-07-14 18:10:00+05:30','2026-07-14 18:15:00+05:30','user_fae870000007'),
 ('48','b2000000-0000-4000-8000-000000000003','user_fae870000002','Smoke on every pull request, full suite nightly. Under eight minutes or nobody will wait for it.','2026-07-15 09:30:00+05:30',NULL,''),
 ('49','b2000000-0000-4000-8000-000000000003','user_fae870000007','Six flaky tests, all six waiting on a fixed timeout. Rewriting them against a condition.','2026-07-20 09:55:00+05:30',NULL,''),
 ('50','b2000000-0000-4000-8000-000000000003','user_fae870000002','No production data in the test environment. Seeded fixtures, and I will hold that line.','2026-07-21 10:00:00+05:30',NULL,''),
 ('51','b2000000-0000-4000-8000-000000000003','user_fae870000007','Coverage target agreed with Vivek Raghavan: 70% on the service layer. UI coverage is not the number that matters.','2026-08-03 09:15:00+05:30',NULL,''),
 ('52','b2000000-0000-4000-8000-000000000003','user_fae870000002','Nightly report will post pass rate and new failures only. A full list every morning gets ignored by Thursday.','2026-08-01 10:20:00+05:30',NULL,''),
 ('53','b2000000-0000-4000-8000-000000000003','user_fae870000007','Accessibility checks going in — axe-core on eight pages, failing only on serious and critical.','2026-07-29 11:20:00+05:30',NULL,''),
 ('54','b2000000-0000-4000-8000-000000000003','user_fae870000007','Indira asked for a performance suite next quarter. Logged, not started.','2026-08-05 15:05:00+05:30',NULL,''),
 ('55','b2000000-0000-4000-8000-000000000003','user_fae870000002','CI is green four nights running. First time since we started.','2026-08-05 08:40:00+05:30',NULL,''),
 ('56','b2000000-0000-4000-8000-000000000003','user_fae870000007','Noted in the weekly note to Indira. Small thing, worth saying out loud.','2026-08-05 09:00:00+05:30',NULL,''),
 ('57','b2000000-0000-4000-8000-000000000004','user_fae870000005','Compliance desk. Every filing date for the group lives here, with a named owner.','2026-04-02 09:20:00+05:30','2026-04-02 09:25:00+05:30','user_fae870000005'),
 ('58','b2000000-0000-4000-8000-000000000004','user_fae870000005','GSTR-1 for April filed on the 10th. 213 B2B invoices, no mismatches.','2026-05-10 17:05:00+05:30',NULL,''),
 ('59','b2000000-0000-4000-8000-000000000004','user_fae870000005','GSTR-3B filed 19 May. Shortfall paid from the cash ledger.','2026-05-19 16:10:00+05:30',NULL,''),
 ('60','b2000000-0000-4000-8000-000000000004','user_fae870000006','PF and ESI challans for June paid on the 14th, all 25 employees.','2026-07-14 13:10:00+05:30',NULL,''),
 ('61','b2000000-0000-4000-8000-000000000004','user_fae870000005','26Q filed 29 July. Two PANs came back inoperative and had to be deducted at the higher rate.','2026-07-29 18:40:00+05:30',NULL,''),
 ('62','b2000000-0000-4000-8000-000000000004','user_fae870000001','@Ritu Agarwal Who told the two employees about the higher deduction?','2026-07-30 09:00:00+05:30',NULL,''),
 ('63','b2000000-0000-4000-8000-000000000004','user_fae870000006','I did, on the 30th. Both are linking their PAN to Aadhaar this week.','2026-07-30 09:30:00+05:30',NULL,''),
 ('64','b2000000-0000-4000-8000-000000000004','user_fae870000005','2B reconciliation: eleven invoices in our register that no supplier has filed. Chasing each one by phone.','2026-07-27 12:05:00+05:30',NULL,''),
 ('65','b2000000-0000-4000-8000-000000000004','user_fae870000005','GSTR-1 for July is due on the 11th. Register is locked; waiting on two credit notes from Firozi.','2026-08-03 09:30:00+05:30',NULL,''),
 ('66','b2000000-0000-4000-8000-000000000004','user_fae870000006','Professional tax for Gujarat and Maharashtra by the 20th. Maharashtra is the one that is always late.','2026-08-03 11:10:00+05:30',NULL,''),
 ('67','b2000000-0000-4000-8000-000000000004','user_fae870000005','Advance tax instalment on 15 September — 45% of the estimate. I will revise the estimate after August.','2026-08-04 10:00:00+05:30',NULL,''),
 ('68','b2000000-0000-4000-8000-000000000004','user_fae870000006','Form 16 for 25 employees by 20 September. Part A and Part B together, not separately.','2026-08-04 15:00:00+05:30',NULL,''),
 ('69','b2000000-0000-4000-8000-000000000004','user_fae870000001','Engagement letter for the FY 2026-27 statutory audit is drafted and with me for approval.','2026-08-04 11:10:00+05:30',NULL,''),
 ('70','b2000000-0000-4000-8000-000000000004','user_fae870000006','ROC calendar drafted — AOC-4 and MGT-7 worked back from the AGM date.','2026-08-05 10:10:00+05:30',NULL,'')
) AS v(n, ch, sender, content, created, pinned, pinned_by)
WHERE EXISTS (SELECT 1 FROM staging.samvada_channels c WHERE c.id = v.ch::uuid AND c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.samvada_messages m WHERE m.id = ('c2000000-0000-4000-8000-0000000000'||v.n)::uuid);

-- Threads, second pass. See the note above.
UPDATE staging.samvada_messages m
   SET parent_message_id = p.parent::uuid
FROM (VALUES
 ('c2000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000003'),
 ('c2000000-0000-4000-8000-000000000006','c2000000-0000-4000-8000-000000000005'),
 ('c2000000-0000-4000-8000-000000000011','c2000000-0000-4000-8000-000000000010'),
 ('c2000000-0000-4000-8000-000000000012','c2000000-0000-4000-8000-000000000010'),
 ('c2000000-0000-4000-8000-000000000018','c2000000-0000-4000-8000-000000000017'),
 ('c2000000-0000-4000-8000-000000000021','c2000000-0000-4000-8000-000000000020'),
 ('c2000000-0000-4000-8000-000000000023','c2000000-0000-4000-8000-000000000022'),
 ('c2000000-0000-4000-8000-000000000025','c2000000-0000-4000-8000-000000000024'),
 ('c2000000-0000-4000-8000-000000000034','c2000000-0000-4000-8000-000000000033'),
 ('c2000000-0000-4000-8000-000000000035','c2000000-0000-4000-8000-000000000033'),
 ('c2000000-0000-4000-8000-000000000038','c2000000-0000-4000-8000-000000000037'),
 ('c2000000-0000-4000-8000-000000000048','c2000000-0000-4000-8000-000000000047'),
 ('c2000000-0000-4000-8000-000000000056','c2000000-0000-4000-8000-000000000055'),
 ('c2000000-0000-4000-8000-000000000062','c2000000-0000-4000-8000-000000000061'),
 ('c2000000-0000-4000-8000-000000000063','c2000000-0000-4000-8000-000000000062')
) AS p(child, parent)
WHERE m.id = p.child::uuid
  AND m.org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
  AND m.parent_message_id IS NULL;

-- The mention ROWS. The '@Full Name ' text is already in the content above.
INSERT INTO staging.samvada_mentions (org_id, channel_id, message_id, mentioned_user_id, kind, created_at, read_at)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, m.channel_id, m.id, v.uid, 'user', m.created_at, v.read::timestamptz
FROM (VALUES
 ('c2000000-0000-4000-8000-000000000012','user_fae870000008','2026-07-14 11:00:00+05:30'),
 ('c2000000-0000-4000-8000-000000000017','user_fae870000002','2026-08-05 10:15:00+05:30'),
 ('c2000000-0000-4000-8000-000000000017','user_fae870000007',NULL),
 ('c2000000-0000-4000-8000-000000000025','user_fae870000008','2026-07-22 11:00:00+05:30'),
 ('c2000000-0000-4000-8000-000000000034','user_fae870000002','2026-07-09 11:20:00+05:30'),
 ('c2000000-0000-4000-8000-000000000062','user_fae870000006','2026-07-30 09:25:00+05:30')
) AS v(msg, uid, read)
JOIN staging.samvada_messages m ON m.id = v.msg::uuid
WHERE m.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
  AND NOT EXISTS (SELECT 1 FROM staging.samvada_mentions x
                  WHERE x.message_id = m.id AND x.mentioned_user_id = v.uid);


-- =====================================================================
-- 7. PRACHAR — 4 campaigns, 60 audience rows, 3 sequences, 10 steps,
--    8 enrolments.
--
--    READ THE HEADER OF THIS FILE BEFORE CHANGING A STATUS HERE.
--    status IN ('sent','draft'), scheduled_at IS NULL on all four,
--    sequences 'paused'/'draft', enrolments 'completed' with a NULL
--    next_step_at, and no campaign contact left 'pending'.
--
--    ENGAGEMENT TOTALS ARE DERIVED, NEVER TYPED. Migration 107
--    (`prachar_seeded_engagement_zeroed`) exists because a previous seed
--    invented open and click counts that no delivery row supported. The
--    UPDATE at the foot of this section reads the rows back.
-- =====================================================================
INSERT INTO staging.prachar_campaigns
 (id, org_id, name, subject, body_html, channel, status, audience_filter, scheduled_at, sent_at,
  created_by, is_active, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.subject, v.body,
       'email', v.status, '{"segment":"clients","seed":"demo"}'::jsonb,
       NULL, v.sent::timestamptz, v.created_by, TRUE, v.created::timestamptz,
       COALESCE(v.sent::timestamptz, v.created::timestamptz)
FROM (VALUES
 ('d2000000-0000-4000-8000-000000000001','Client newsletter — Q1 FY 2026-27',
  'Unicode Group — what changed this quarter',
  '<p>Dear client,</p><p>Three things worth ten minutes of your time this quarter: the new e-invoicing threshold, the revised TDS rates on professional fees, and our own move to a single client portal.</p><p>Reply to this note and we will set up a call.</p><p>Unicode Group, Ahmedabad</p>',
  'sent','2026-04-18 11:00:00+05:30','user_fae870000004','2026-04-13 10:00:00+05:30'),
 ('d2000000-0000-4000-8000-000000000002','GST annual return — what changes this year',
  'GSTR-9 and 9C: the four changes that matter',
  '<p>Dear client,</p><p>The annual return format has changed in four places this year. The one that catches most businesses is the reconciliation of ITC claimed against ITC available in 2B.</p><p>Our filing calendar for your entity is attached to your portal.</p><p>Unicode Group, Ahmedabad</p>',
  'sent','2026-06-12 10:30:00+05:30','user_fae870000005','2026-06-08 09:30:00+05:30'),
 ('d2000000-0000-4000-8000-000000000003','Service catalogue refresh',
  'What we do now — a shorter list, done properly',
  '<p>Dear client,</p><p>We have cut our service list from nineteen items to nine. The nine are the ones we do well and can staff properly.</p><p>Nothing you currently buy from us has been withdrawn.</p><p>Unicode Group, Ahmedabad</p>',
  'sent','2026-07-24 16:00:00+05:30','user_fae870000004','2026-07-20 11:00:00+05:30'),
 ('d2000000-0000-4000-8000-000000000004','Diwali advisory retainer offer',
  'A retainer that starts in October',
  '<p>Dear client,</p><p>Draft — pricing not confirmed. Do not send until the partners have agreed the retainer bands.</p>',
  'draft',NULL,'user_fae870000004','2026-08-04 15:00:00+05:30')
) AS v(id, name, subject, body, status, sent, created_by, created)
WHERE NOT EXISTS (SELECT 1 FROM staging.prachar_campaigns c WHERE c.id = v.id::uuid);

-- 60 delivery rows across the three SENT campaigns. The draft has none,
-- which is correct rather than lazy: `campaign_sender._materialise_audience`
-- writes them at the moment the button is pressed, so a draft with an
-- audience already attached is a state the product never produces.
--
-- Contacts are picked by a deterministic row_number over graha_contacts,
-- so a re-run selects the same twenty. The four non-success simulator
-- addresses (2 bounce, 1 complaint, 1 ooto) are here on purpose: a campaign
-- where every send succeeded demonstrates nothing about how the product
-- handles a bounce.
INSERT INTO staging.prachar_campaign_contacts
 (campaign_id, contact_id, email, status, sent_at, opened_at, clicked_at, error_message, org_id, created_at)
SELECT a.campaign_id::uuid, a.contact_id, a.email, a.status,
       a.sent_at, a.opened_at, a.clicked_at, a.err,
       'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, a.sent_at
FROM (
  WITH ranked AS (
    SELECT c.id, c.email, row_number() OVER (ORDER BY c.id) AS rn
    FROM staging.graha_contacts c
    WHERE c.org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
      AND COALESCE(c.email,'') <> ''
  ),
  camp AS (
    SELECT * FROM (VALUES
      ('d2000000-0000-4000-8000-000000000001', 1, 20, '2026-04-18 11:00:00+05:30'),
      ('d2000000-0000-4000-8000-000000000002',11, 30, '2026-06-12 10:30:00+05:30'),
      ('d2000000-0000-4000-8000-000000000003',20, 39, '2026-07-24 16:00:00+05:30')
    ) AS t(campaign_id, lo, hi, sent)
  )
  SELECT camp.campaign_id,
         ranked.id AS contact_id,
         CASE
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn = 1  THEN 'bounce@simulator.amazonses.com'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn = 11 THEN 'bounce@simulator.amazonses.com'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn = 12 THEN 'complaint@simulator.amazonses.com'
           WHEN camp.campaign_id LIKE '%003' AND ranked.rn = 20 THEN 'ooto@simulator.amazonses.com'
           ELSE ranked.email
         END AS email,
         CASE
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn = 1  THEN 'bounced'
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn = 2  THEN 'failed'
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn = 3  THEN 'unsubscribed'
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn BETWEEN 4 AND 6   THEN 'clicked'
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn BETWEEN 7 AND 12  THEN 'opened'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn = 11 THEN 'bounced'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn = 12 THEN 'unsubscribed'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn BETWEEN 13 AND 14 THEN 'clicked'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn BETWEEN 15 AND 21 THEN 'opened'
           WHEN camp.campaign_id LIKE '%003' AND ranked.rn BETWEEN 21 AND 23 THEN 'clicked'
           WHEN camp.campaign_id LIKE '%003' AND ranked.rn BETWEEN 24 AND 31 THEN 'opened'
           WHEN camp.campaign_id LIKE '%003' AND ranked.rn = 32 THEN 'unsubscribed'
           ELSE 'delivered'
         END AS status,
         camp.sent::timestamptz AS sent_at,
         CASE
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn BETWEEN 4 AND 12  THEN camp.sent::timestamptz + interval '5 hours'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn BETWEEN 13 AND 21 THEN camp.sent::timestamptz + interval '7 hours'
           WHEN camp.campaign_id LIKE '%003' AND ranked.rn BETWEEN 21 AND 31 THEN camp.sent::timestamptz + interval '3 hours'
         END AS opened_at,
         CASE
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn BETWEEN 4 AND 6   THEN camp.sent::timestamptz + interval '6 hours'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn BETWEEN 13 AND 14 THEN camp.sent::timestamptz + interval '8 hours'
           WHEN camp.campaign_id LIKE '%003' AND ranked.rn BETWEEN 21 AND 23 THEN camp.sent::timestamptz + interval '4 hours'
         END AS clicked_at,
         CASE
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn = 1  THEN 'Hard bounce — recipient address does not exist'
           WHEN camp.campaign_id LIKE '%001' AND ranked.rn = 2  THEN 'Suppressed — on the org suppression list'
           WHEN camp.campaign_id LIKE '%002' AND ranked.rn = 11 THEN 'Hard bounce — recipient address does not exist'
         END AS err
  FROM camp JOIN ranked ON ranked.rn BETWEEN camp.lo AND camp.hi
) AS a
WHERE EXISTS (SELECT 1 FROM staging.prachar_campaigns c
              WHERE c.id = a.campaign_id::uuid AND c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.prachar_campaign_contacts x
                  WHERE x.campaign_id = a.campaign_id::uuid AND x.contact_id = a.contact_id);

-- SEQUENCES. None is 'active', which is the first of the three predicates
-- `process_sequence_steps` requires.
INSERT INTO staging.prachar_sequences (id, org_id, name, description, status, exit_on_reply, created_by, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.descr, v.status, TRUE, v.created_by,
       v.created::timestamptz, v.created::timestamptz
FROM (VALUES
 ('e2000000-0000-4000-8000-000000000001','New client onboarding — first 30 days',
  'Welcome, portal walkthrough, document checklist and a 30-day check-in. Paused while the portal copy is rewritten.',
  'paused','user_fae870000008','2026-03-09 10:00:00+05:30'),
 ('e2000000-0000-4000-8000-000000000002','Dormant client re-engagement',
  'For clients with no billable work in six months. Draft — the partners have not agreed the wording.',
  'draft','user_fae870000004','2026-05-18 11:30:00+05:30'),
 ('e2000000-0000-4000-8000-000000000003','Prospect nurture — manufacturing',
  'Four touches over six weeks for manufacturing prospects. Paused for the festive season.',
  'paused','user_fae870000004','2026-06-22 09:45:00+05:30')
) AS v(id, name, descr, status, created_by, created)
WHERE NOT EXISTS (SELECT 1 FROM staging.prachar_sequences s WHERE s.id = v.id::uuid);

-- STEPS. Sequence 1 runs 1, 2, 3, 5 — a real hole, left by a step deleted
-- in April. `prachar_sequencing.plan_following_step` is strictly-greater
-- rather than +1 precisely so an enrolment does not strand in that gap;
-- seeding the gap is what makes that testable against real data.
-- Two steps are 'call_task' and 'manual', which `is_sendable_channel`
-- refuses to deliver and which the executor advances past without mailing.
INSERT INTO staging.prachar_sequence_steps (id, sequence_id, step_order, channel, delay_days, subject, body_html, body_text, notes, org_id, created_at)
SELECT v.id::uuid, v.seq::uuid, v.ord, v.channel, v.delay, v.subject, v.body, v.body, v.notes,
       'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.created::timestamptz
FROM (VALUES
 ('f2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',1,'email',0,'Welcome to Unicode Group','<p>Welcome. Your account manager is named below and your portal login follows separately.</p>','Sent the day the engagement letter is signed.','2026-03-09 10:05:00+05:30'),
 ('f2000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001',2,'email',3,'Your document checklist','<p>The eleven documents we need before the first filing, and who to send them to.</p>','Three days later, once they have logged in once.','2026-03-09 10:06:00+05:30'),
 ('f2000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001',3,'call_task',10,NULL,NULL,'Account manager rings the client. Not an email — a call, by a person.','2026-03-09 10:07:00+05:30'),
 ('f2000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001',5,'email',30,'Thirty days in — anything not working?','<p>One question: is there anything about how we work that is not suiting you?</p>','Step 4 was deleted in April; the gap is deliberate and the executor handles it.','2026-03-09 10:08:00+05:30'),
 ('f2000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002',1,'email',0,'It has been a while','<p>Draft. Wording not agreed.</p>','Do not enable until the partners sign off the tone.','2026-05-18 11:35:00+05:30'),
 ('f2000000-0000-4000-8000-000000000006','e2000000-0000-4000-8000-000000000002',2,'email',7,'What changed since we last worked together','<p>Draft.</p>','','2026-05-18 11:36:00+05:30'),
 ('f2000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000002',3,'manual',14,NULL,NULL,'Partner decides individually whether to call. Deliberately not automated.','2026-05-18 11:37:00+05:30'),
 ('f2000000-0000-4000-8000-000000000008','e2000000-0000-4000-8000-000000000003',1,'email',0,'A note on the e-invoicing threshold','<p>Useful whether or not you ever speak to us.</p>','Give something before asking for anything.','2026-06-22 09:50:00+05:30'),
 ('f2000000-0000-4000-8000-000000000009','e2000000-0000-4000-8000-000000000003',2,'email',14,'How three manufacturers cut their filing time','<p>Short, with numbers, no case-study language.</p>','','2026-06-22 09:51:00+05:30'),
 ('f2000000-0000-4000-8000-000000000010','e2000000-0000-4000-8000-000000000003',3,'email',28,'Would a thirty-minute call be useful?','<p>One question and an easy no.</p>','','2026-06-22 09:52:00+05:30')
) AS v(id, seq, ord, channel, delay, subject, body, notes, created)
WHERE EXISTS (SELECT 1 FROM staging.prachar_sequences s WHERE s.id = v.seq::uuid AND s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.prachar_sequence_steps x WHERE x.id = v.id::uuid);

-- ENROLMENTS. 'completed' with next_step_at NULL, on a sequence that is not
-- 'active'. All three of the cron's predicates fail independently.
INSERT INTO staging.prachar_sequence_enrollments
 (sequence_id, contact_id, current_step, status, enrolled_at, next_step_at, completed_at, org_id)
SELECT a.seq::uuid, a.contact_id, a.step, 'completed', a.enrolled::timestamptz, NULL, a.completed::timestamptz,
       'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
FROM (
  WITH ranked AS (
    SELECT c.id, row_number() OVER (ORDER BY c.id) AS rn
    FROM staging.graha_contacts c
    WHERE c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND COALESCE(c.email,'') <> ''
  )
  SELECT 'e2000000-0000-4000-8000-000000000001' AS seq, id AS contact_id, 5 AS step,
         '2026-03-12 10:00:00+05:30' AS enrolled, '2026-04-11 10:00:00+05:30' AS completed
  FROM ranked WHERE rn IN (2,5,9,14)
  UNION ALL
  SELECT 'e2000000-0000-4000-8000-000000000003', id, 3,
         '2026-06-24 09:00:00+05:30', '2026-08-02 09:00:00+05:30'
  FROM ranked WHERE rn IN (31,33,35,37)
) AS a
WHERE EXISTS (SELECT 1 FROM staging.prachar_sequences s WHERE s.id=a.seq::uuid AND s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.prachar_sequence_enrollments x
                  WHERE x.sequence_id=a.seq::uuid AND x.contact_id=a.contact_id);

UPDATE staging.prachar_campaigns c
SET total_recipients   = s.recipients,
    total_sent         = s.sent,
    total_opened       = s.opened,
    total_clicked      = s.clicked,
    total_bounced      = s.bounced,
    total_unsubscribed = s.unsubs
FROM (
  SELECT campaign_id,
         count(*)                                       AS recipients,
         count(*) FILTER (WHERE status <> 'failed')      AS sent,
         count(*) FILTER (WHERE opened_at IS NOT NULL)   AS opened,
         count(*) FILTER (WHERE clicked_at IS NOT NULL)  AS clicked,
         count(*) FILTER (WHERE status = 'bounced')      AS bounced,
         count(*) FILTER (WHERE status = 'unsubscribed') AS unsubs
  FROM staging.prachar_campaign_contacts
  WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
  GROUP BY campaign_id
) s
WHERE c.id = s.campaign_id
  AND c.org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
  AND c.id::text LIKE 'd2000000%';


-- =====================================================================
-- 8. SAHAYAK — 4 sessions, 20 messages, 10 of them structured answers.
--
--    `answer` (migration 119) holds the payload EXACTLY as
--    `routers/hub.py:_sahayak_payload` returns it — every key present,
--    `figs: []` rather than no figs on a refusal. Work steps, figures,
--    evidence tables, source cards and the refusal block all redraw on
--    reload, which is the thing the screen has never been able to show.
--
--    THE FIGURES ARE REAL. 19 overdue invoices / ₹8,29,292 / oldest 190
--    days, and the nine overdue tasks, were read off this database on
--    2026-08-06 before the answers were written. The evidence tables hold
--    the actual invoice numbers and task titles.
--
--    NO MODEL WAS CALLED, so `model` is empty, `credits` and `cost_usd`
--    are 0, and there is no "Wrote the answer" work step. The read steps
--    are the free half and they are the half that is honest here. A
--    non-zero credit with no matching row in `hub_org_credit_transactions`
--    would be exactly the invented number migration 107 had to undo.
--
--    SIX of the ten answers carry a refusal, which is the point:
--      · one 'access'  — a Finance-less account asking for vendor bills
--      · one action refusal — "send them all a reminder"
--      · one forecast refusal — "will we close this deal"
--      · three 'partial' — a source that errored, a total that would have
--        silently excluded rows, and a capacity question with no time data
--
-- =====================================================================
INSERT INTO staging.hub_chat_sessions (id, client_id, org_id, title, session_type, created_by, is_active, created_at, updated_at)
SELECT v.id::uuid, '365b6d39-5f25-4013-be5b-1e1edfa261b4'::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid,
       v.title, 'internal', v.created_by, TRUE, v.created::timestamptz, v.updated::timestamptz
FROM (VALUES
 ('a2000000-0000-4000-8000-000000000001','Who owes us money?','user_fae870000005','2026-08-06 09:12:00+05:30','2026-08-06 09:19:00+05:30'),
 ('a2000000-0000-4000-8000-000000000002','Which tasks are slipping?','user_fae870000001','2026-08-06 09:40:00+05:30','2026-08-06 09:48:00+05:30'),
 ('a2000000-0000-4000-8000-000000000003','What we owe suppliers','user_fae870000008','2026-08-05 16:20:00+05:30','2026-08-05 16:20:00+05:30'),
 ('a2000000-0000-4000-8000-000000000004','Pipeline and overdue follow-ups','user_fae870000004','2026-08-04 11:05:00+05:30','2026-08-04 11:14:00+05:30')
) AS v(id, title, created_by, created, updated)
WHERE EXISTS (SELECT 1 FROM staging.hub_clients hc WHERE hc.id='365b6d39-5f25-4013-be5b-1e1edfa261b4'::uuid
              AND hc.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.hub_chat_sessions s WHERE s.id = v.id::uuid);

-- Dollar-quoted ($c$ content, $s$ sources, $a$ answer) so the JSON and the
-- apostrophes inside it need no escaping and stay readable in review.
INSERT INTO staging.hub_chat_messages (id, session_id, role, content, sources, token_count, cost_usd, model_used, created_at, org_id, answer)
SELECT v.id::uuid, v.session_id::uuid, v.role, v.content, COALESCE(v.sources,'[]')::jsonb, 0, 0, '',
       v.created::timestamptz, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.answer::jsonb
FROM (VALUES
('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','user',
 $c$Which customers owe us money, and how bad is the oldest one?$c$, NULL, NULL, '2026-08-06 09:12:00+05:30'),
('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','assistant',
 $c$Nineteen invoices are past their due date, ₹8,29,292 outstanding in total [1]. The oldest is INV-2026-0011 at 190 days, ₹29,500.

One thing I will not guess at: four of the five oldest invoices have no client linked on the record, so the client column in the table below is empty for them. They are real invoices with real balances — the missing name is a gap in the CRM link, not in the ledger.$c$,
 $s$[{"ref":1,"kind":"data","title":"Overdue customer invoices","source_type":"data","route":"GET /api/v1/ganit/invoices","module":"Finance","rows":19,"truncated":true,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000001","message_id":"a3000000-0000-4000-8000-000000000002","answered":true,
"message":"Nineteen invoices are past their due date, ₹8,29,292 outstanding in total [1]. The oldest is INV-2026-0011 at 190 days, ₹29,500.",
"work":[{"state":"done","ok":true,"label":"Overdue customer invoices","fn":"find_overdue_invoices","note":"free","rows":19,"src":"GET /api/v1/ganit/invoices"}],
"figs":[{"label":"Overdue invoices","value":"19","sub":"oldest 190 days past due","src":"GET /api/v1/ganit/invoices","unit":"count","source_key":"receivables"},
        {"label":"Balance outstanding","value":"₹8,29,292","sub":"across 19 invoices","src":"GET /api/v1/ganit/invoices","unit":"INR","source_key":"receivables"}],
"sources":[{"ref":1,"kind":"data","title":"Overdue customer invoices","source_type":"data","route":"GET /api/v1/ganit/invoices","module":"Finance","rows":19,"truncated":true,"chunk_id":"","similarity":null}],
"evidence":{"cols":["Invoice","Client","Balance due","Days past"],
 "rows":[["INV-2026-0011","","29,500","190"],["INV-2026-0014","","10,620","159"],["INV-2026-0017","","10,620","131"],["INV-2026-0016","","29,500","131"],["INV-2026-0062","Ekveera Engineering Works Pvt Ltd","33,040","114"]],
 "src":"GET /api/v1/ganit/invoices","source_key":"receivables","truncated":true,"total":19},
"refusal":"","refusal_detail":null,"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["receivables"]}$a$,
 '2026-08-06 09:13:00+05:30'),
('a3000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','user',
 $c$Which client is the biggest single exposure?$c$, NULL, NULL, '2026-08-06 09:16:00+05:30'),
('a3000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000001','assistant',
 $c$Of the overdue invoices that DO carry a client, Ekveera Engineering Works Pvt Ltd is the largest single balance at ₹33,040 on INV-2026-0062, 114 days past due [1].

I am not going to name a "biggest exposure" overall, because four of the nineteen have no client attached and I cannot total by a name that is not on the record.$c$,
 $s$[{"ref":1,"kind":"data","title":"Overdue customer invoices","source_type":"data","route":"GET /api/v1/ganit/invoices","module":"Finance","rows":19,"truncated":true,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000001","message_id":"a3000000-0000-4000-8000-000000000004","answered":true,
"message":"Of the overdue invoices that carry a client, Ekveera Engineering Works Pvt Ltd is the largest single balance at ₹33,040 on INV-2026-0062, 114 days past due [1].",
"work":[{"state":"done","ok":true,"label":"Overdue customer invoices","fn":"find_overdue_invoices","note":"free","rows":19,"src":"GET /api/v1/ganit/invoices"}],
"figs":[{"label":"Largest overdue balance","value":"₹33,040","sub":"INV-2026-0062, 114 days past due","src":"GET /api/v1/ganit/invoices","unit":"INR","source_key":"receivables"}],
"sources":[{"ref":1,"kind":"data","title":"Overdue customer invoices","source_type":"data","route":"GET /api/v1/ganit/invoices","module":"Finance","rows":19,"truncated":true,"chunk_id":"","similarity":null}],
"evidence":null,
"refusal":"Four of the nineteen overdue invoices have no client linked. A total by client would silently exclude them, so this answer names a single invoice rather than a customer-level exposure.",
"refusal_detail":{"kind":"partial","withheld_modules":[],"withheld_labels":[],"asked_for":[{"key":"receivables","label":"Overdue customer invoices","route":"GET /api/v1/ganit/invoices"}],"unreachable":[],"charged":false},
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["receivables"]}$a$,
 '2026-08-06 09:17:00+05:30'),
('a3000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000001','user',
 $c$Send them all a reminder.$c$, NULL, NULL, '2026-08-06 09:18:00+05:30'),
('a3000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000001','assistant',
 $c$I did not send anything. Reading your records is free and I do that on my own; sending nineteen emails on your behalf is not something I will do from a chat message.

The overdue-invoice reminder run lives at Ganit → Receivables → Send reminders, where you can see the list, edit the wording and press the button yourself. I can prepare the list if that helps.$c$,
 NULL,
 $a${"session_id":"a2000000-0000-4000-8000-000000000001","message_id":"a3000000-0000-4000-8000-000000000006","answered":false,
"message":"I did not send anything. Reading your records is free and I do that on my own; sending nineteen emails on your behalf is not something I will do from a chat message.",
"work":[],"figs":[],"sources":[],"evidence":null,
"refusal":"Sahayak did not do this. Sending on your behalf is an action, not a reading, and it is not something a chat answer performs — the reminder run is at Ganit → Receivables → Send reminders, where the list is visible before anything leaves. Nothing was sent and nothing was charged.",
"refusal_detail":{"kind":"access","withheld_modules":[],"withheld_labels":[],"asked_for":[],"unreachable":[],"charged":false},
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":[]}$a$,
 '2026-08-06 09:19:00+05:30'),
('a3000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000002','user',
 $c$Which tasks are slipping, and who is behind?$c$, NULL, NULL, '2026-08-06 09:40:00+05:30'),
('a3000000-0000-4000-8000-000000000008','a2000000-0000-4000-8000-000000000002','assistant',
 $c$Nine tasks are past their due date and not done [1]. The oldest is the Ekveera lessons-learned note, 37 days over, which is a low-priority item nobody has picked up since the project closed.

The two that look like real risk are the Chandrika deviation log (20 days, blocked on their QA head) and the GSTR-2B reconciliation (12 days, and it feeds the GSTR-1 filing due on 11 August).

Amit Sharma holds three of the nine, Neha Chauhan two.$c$,
 $s$[{"ref":1,"kind":"data","title":"Overdue tasks","source_type":"data","route":"GET /api/tasks","module":"Sahayak","rows":9,"truncated":false,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000002","message_id":"a3000000-0000-4000-8000-000000000008","answered":true,
"message":"Nine tasks are past their due date and not done [1]. The oldest is the Ekveera lessons-learned note, 37 days over.",
"work":[{"state":"done","ok":true,"label":"Overdue tasks","fn":"find_overdue_tasks","note":"free","rows":9,"src":"GET /api/tasks"}],
"figs":[{"label":"Overdue tasks","value":"9","sub":"oldest 37 days past due","src":"GET /api/tasks","unit":"count","source_key":"tasks"},
        {"label":"Projects affected","value":"6","sub":"of 8 active projects","src":"GET /api/tasks","unit":"count","source_key":"tasks"}],
"sources":[{"ref":1,"kind":"data","title":"Overdue tasks","source_type":"data","route":"GET /api/tasks","module":"Sahayak","rows":9,"truncated":false,"chunk_id":"","similarity":null}],
"evidence":{"cols":["Task","Project","Owner","Days past"],
 "rows":[["Lessons-learned note for the practice","Ekveera Engineering — Inventory Migration","Amit Sharma","37"],
         ["Deviation log — pending QA head input","Chandrika Pharma — GMP Document Control","Neha Chauhan","20"],
         ["Labour attendance import from Excel","Bhavya Infra — Site Reporting Portal","Amit Sharma","13"],
         ["Reconcile GSTR-2B with purchase register","Statutory Compliance FY 2026-27","Meera Nair","12"],
         ["Flaky test triage — 6 known offenders","Indira Software Labs — QA Automation","Neha Chauhan","9"],
         ["Fix: duplicate points on split bills","Firozi Retail — Loyalty App","Amit Sharma","8"]],
 "src":"GET /api/tasks","source_key":"tasks","truncated":true,"total":9},
"refusal":"","refusal_detail":null,"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["tasks"]}$a$,
 '2026-08-06 09:41:00+05:30'),
('a3000000-0000-4000-8000-000000000009','a2000000-0000-4000-8000-000000000002','user',
 $c$Is Amit overloaded, or is it just bad luck?$c$, NULL, NULL, '2026-08-06 09:45:00+05:30'),
('a3000000-0000-4000-8000-000000000010','a2000000-0000-4000-8000-000000000002','assistant',
 $c$I can tell you he holds three of the nine overdue items and is the assignee on 18 open tasks across four projects [1]. I cannot tell you whether that is overload.

Capacity would need hours booked against those tasks, and the time-entry records are not something this question read. Ask me about logged time and I will read it — or open Dristi → Workload, which draws from the same rows.$c$,
 $s$[{"ref":1,"kind":"data","title":"Overdue tasks","source_type":"data","route":"GET /api/tasks","module":"Sahayak","rows":9,"truncated":false,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000002","message_id":"a3000000-0000-4000-8000-000000000010","answered":true,
"message":"He holds three of the nine overdue items and is the assignee on 18 open tasks across four projects [1]. Whether that is overload is not something these rows can say.",
"work":[{"state":"done","ok":true,"label":"Overdue tasks","fn":"find_overdue_tasks","note":"free","rows":9,"src":"GET /api/tasks"}],
"figs":[{"label":"Overdue held by Amit Sharma","value":"3","sub":"of 9 overdue","src":"GET /api/tasks","unit":"count","source_key":"tasks"},
        {"label":"Open tasks assigned","value":"18","sub":"across 4 projects","src":"GET /api/tasks","unit":"count","source_key":"tasks"}],
"sources":[{"ref":1,"kind":"data","title":"Overdue tasks","source_type":"data","route":"GET /api/tasks","module":"Sahayak","rows":9,"truncated":false,"chunk_id":"","similarity":null}],
"evidence":null,
"refusal":"Not everything this question needed could be read: logged time against those tasks was not part of this plan. Nothing above is based on it — treat capacity as unknown rather than as fine.",
"refusal_detail":{"kind":"partial","withheld_modules":[],"withheld_labels":[],"asked_for":[{"key":"tasks","label":"Overdue tasks","route":"GET /api/tasks"}],"unreachable":[{"key":"time_entries","label":"Logged time","route":"GET /api/time-entries","reason":"not in the plan for this question"}],"charged":false},
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["tasks"]}$a$,
 '2026-08-06 09:46:00+05:30'),
('a3000000-0000-4000-8000-000000000011','a2000000-0000-4000-8000-000000000002','user',
 $c$Which of the nine actually threaten a deadline?$c$, NULL, NULL, '2026-08-06 09:47:00+05:30'),
('a3000000-0000-4000-8000-000000000012','a2000000-0000-4000-8000-000000000002','assistant',
 $c$One, on the records I read: the GSTR-2B reconciliation [1]. It sits in front of the July GSTR-1 filing, which is due on 11 August.

The other eight are late against dates your own team set, not against a statutory or contractual date. That is a different kind of late and I would not put them in the same list.$c$,
 $s$[{"ref":1,"kind":"data","title":"Overdue tasks","source_type":"data","route":"GET /api/tasks","module":"Sahayak","rows":9,"truncated":false,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000002","message_id":"a3000000-0000-4000-8000-000000000012","answered":true,
"message":"One, on the records I read: the GSTR-2B reconciliation [1]. It sits in front of the July GSTR-1 filing, due 11 August.",
"work":[{"state":"done","ok":true,"label":"Overdue tasks","fn":"find_overdue_tasks","note":"free","rows":9,"src":"GET /api/tasks"}],
"figs":[{"label":"Overdue against a statutory date","value":"1","sub":"of 9 overdue","src":"GET /api/tasks","unit":"count","source_key":"tasks"}],
"sources":[{"ref":1,"kind":"data","title":"Overdue tasks","source_type":"data","route":"GET /api/tasks","module":"Sahayak","rows":9,"truncated":false,"chunk_id":"","similarity":null}],
"evidence":null,"refusal":"","refusal_detail":null,
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["tasks"]}$a$,
 '2026-08-06 09:48:00+05:30'),
('a3000000-0000-4000-8000-000000000013','a2000000-0000-4000-8000-000000000003','user',
 $c$What do we owe our suppliers right now? I need the vendor bills that are overdue.$c$, NULL, NULL, '2026-08-05 16:20:00+05:30'),
('a3000000-0000-4000-8000-000000000014','a2000000-0000-4000-8000-000000000003','assistant',
 $c$Sahayak did not answer this. Answering it means reading overdue vendor bills, which comes from Finance — and you do not have access to Finance. Ask an administrator for it, or ask something that does not need it. Nothing was read and nothing was charged.$c$,
 NULL,
 $a${"session_id":"a2000000-0000-4000-8000-000000000003","message_id":"a3000000-0000-4000-8000-000000000014","answered":false,
"message":"",
"work":[],"figs":[],"sources":[],"evidence":null,
"refusal":"Sahayak did not answer this. Answering it means reading overdue vendor bills, which comes from Finance — and you do not have access to Finance. Ask an administrator for it, or ask something that does not need it. Nothing was read and nothing was charged.",
"refusal_detail":{"kind":"access","withheld_modules":["ganit"],"withheld_labels":["Finance"],
 "asked_for":[{"key":"payables","label":"Overdue vendor bills","route":"GET /api/v1/ganit/vendor-bills"}],
 "unreachable":[],"charged":false},
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":[]}$a$,
 '2026-08-05 16:20:30+05:30'),
('a3000000-0000-4000-8000-000000000015','a2000000-0000-4000-8000-000000000004','user',
 $c$How is the pipeline looking, and which follow-ups are overdue?$c$, NULL, NULL, '2026-08-04 11:05:00+05:30'),
('a3000000-0000-4000-8000-000000000016','a2000000-0000-4000-8000-000000000004','assistant',
 $c$Pipeline first: four open deals scored, ₹18,40,000 of weighted value, and the two Rajasthan opportunities score lowest because neither has had contact in six weeks [1].

I could not read the follow-up records — that source errored — so I have said nothing at all about overdue follow-ups. Treat that half as unknown rather than as empty.$c$,
 $s$[{"ref":1,"kind":"data","title":"Pipeline health scores","source_type":"data","route":"GET /api/v1/graha/deals","module":"CRM","rows":4,"truncated":false,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000004","message_id":"a3000000-0000-4000-8000-000000000016","answered":true,
"message":"Four open deals scored, ₹18,40,000 of weighted value. The two Rajasthan opportunities score lowest because neither has had contact in six weeks [1].",
"work":[{"state":"done","ok":true,"label":"Pipeline health scores","fn":"score_deals","note":"free","rows":4,"src":"GET /api/v1/graha/deals"},
        {"state":"wait","ok":false,"label":"Overdue CRM follow-ups","fn":"find_overdue_followups","note":"unavailable — read timed out","rows":0,"src":"GET /api/v1/graha/follow-ups"}],
"figs":[{"label":"Open deals scored","value":"4","sub":"","src":"GET /api/v1/graha/deals","unit":"count","source_key":"deal_health"},
        {"label":"Weighted pipeline","value":"₹18,40,000","sub":"across 4 deals","src":"GET /api/v1/graha/deals","unit":"INR","source_key":"deal_health"}],
"sources":[{"ref":1,"kind":"data","title":"Pipeline health scores","source_type":"data","route":"GET /api/v1/graha/deals","module":"CRM","rows":4,"truncated":false,"chunk_id":"","similarity":null}],
"evidence":null,
"refusal":"Not everything this question needed could be read: Overdue CRM follow-ups (read timed out). Nothing above is based on it — treat it as unknown rather than as empty.",
"refusal_detail":{"kind":"partial","withheld_modules":[],"withheld_labels":[],
 "asked_for":[{"key":"deal_health","label":"Pipeline health scores","route":"GET /api/v1/graha/deals"},{"key":"followups","label":"Overdue CRM follow-ups","route":"GET /api/v1/graha/follow-ups"}],
 "unreachable":[{"key":"followups","label":"Overdue CRM follow-ups","route":"GET /api/v1/graha/follow-ups","reason":"read timed out"}],"charged":false},
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["deal_health"]}$a$,
 '2026-08-04 11:06:00+05:30'),
('a3000000-0000-4000-8000-000000000017','a2000000-0000-4000-8000-000000000004','user',
 $c$Try the follow-ups again.$c$, NULL, NULL, '2026-08-04 11:11:00+05:30'),
('a3000000-0000-4000-8000-000000000018','a2000000-0000-4000-8000-000000000004','assistant',
 $c$It read this time. Six follow-ups are past their due date [1]; the oldest is Mahaveer Gems at 34 days, and Nandini Packaging at 21 days is the one with a live proposal behind it.

Both are prospects, not clients, so neither shows up in the receivables view — which is exactly why they get missed.$c$,
 $s$[{"ref":1,"kind":"data","title":"Overdue CRM follow-ups","source_type":"data","route":"GET /api/v1/graha/follow-ups","module":"CRM","rows":6,"truncated":false,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000004","message_id":"a3000000-0000-4000-8000-000000000018","answered":true,
"message":"Six follow-ups are past their due date [1]. The oldest is Mahaveer Gems at 34 days; Nandini Packaging at 21 days is the one with a live proposal behind it.",
"work":[{"state":"done","ok":true,"label":"Overdue CRM follow-ups","fn":"find_overdue_followups","note":"free","rows":6,"src":"GET /api/v1/graha/follow-ups"}],
"figs":[{"label":"Overdue follow-ups","value":"6","sub":"oldest 34 days past due","src":"GET /api/v1/graha/follow-ups","unit":"count","source_key":"followups"}],
"sources":[{"ref":1,"kind":"data","title":"Overdue CRM follow-ups","source_type":"data","route":"GET /api/v1/graha/follow-ups","module":"CRM","rows":6,"truncated":false,"chunk_id":"","similarity":null}],
"evidence":null,"refusal":"","refusal_detail":null,
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["followups"]}$a$,
 '2026-08-04 11:12:00+05:30'),
('a3000000-0000-4000-8000-000000000019','a2000000-0000-4000-8000-000000000004','user',
 $c$Will we close Nandini this quarter?$c$, NULL, NULL, '2026-08-04 11:13:00+05:30'),
('a3000000-0000-4000-8000-000000000020','a2000000-0000-4000-8000-000000000004','assistant',
 $c$I will not put a number on that. Nothing in your records forecasts a close — the deal has a stage, a value and a last-contact date, and turning those three into a probability would be me inventing the part you actually asked for.

What I can say from the record: the proposal has been out 21 days with no logged contact since, and no close date is set on the deal [1].$c$,
 $s$[{"ref":1,"kind":"data","title":"Pipeline health scores","source_type":"data","route":"GET /api/v1/graha/deals","module":"CRM","rows":4,"truncated":false,"chunk_id":"","similarity":null}]$s$,
 $a${"session_id":"a2000000-0000-4000-8000-000000000004","message_id":"a3000000-0000-4000-8000-000000000020","answered":true,
"message":"The proposal has been out 21 days with no logged contact since, and no close date is set on the deal [1].",
"work":[{"state":"done","ok":true,"label":"Pipeline health scores","fn":"score_deals","note":"free","rows":4,"src":"GET /api/v1/graha/deals"}],
"figs":[{"label":"Days since last contact","value":"21","sub":"Nandini Packaging Pvt Ltd","src":"GET /api/v1/graha/deals","unit":"count","source_key":"deal_health"}],
"sources":[{"ref":1,"kind":"data","title":"Pipeline health scores","source_type":"data","route":"GET /api/v1/graha/deals","module":"CRM","rows":4,"truncated":false,"chunk_id":"","similarity":null}],
"evidence":null,
"refusal":"Sahayak did not forecast this. Nothing in the records carries a close probability, and deriving one from stage, value and last-contact date would be an estimate presented as a reading. Nothing above is a guess.",
"refusal_detail":{"kind":"partial","withheld_modules":[],"withheld_labels":[],
 "asked_for":[{"key":"deal_health","label":"Pipeline health scores","route":"GET /api/v1/graha/deals"}],
 "unreachable":[],"charged":false},
"model":"","credits":0,"credits_charged":0,"cost_usd":0,"language":"en","read":["deal_health"]}$a$,
 '2026-08-04 11:14:00+05:30')
) AS v(id, session_id, role, content, sources, answer, created)
WHERE EXISTS (SELECT 1 FROM staging.hub_chat_sessions s
              WHERE s.id = v.session_id::uuid AND s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid)
  AND NOT EXISTS (SELECT 1 FROM staging.hub_chat_messages m WHERE m.id = v.id::uuid);

COMMIT;


-- =====================================================================
-- 9. WHAT THIS FILE WROTE, AND WHOSE IT IS
-- =====================================================================
-- Run these after the file. Every `n` must equal every `ok`.
--
--   SELECT 'tasks' t, count(*) n,
--          count(*) FILTER (WHERE tm.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17') ok
--   FROM public.tasks t JOIN public.teams tm ON tm.team_id=t.team_id
--   WHERE t.task_id LIKE 'task_ug0%';
--
-- And the two sender queries, which must both return 0:
--
--   SELECT count(*) FROM staging.prachar_campaigns
--    WHERE status='scheduled' AND is_active AND scheduled_at <= NOW()
--      AND id::text LIKE 'd2000000%';
--
--   SELECT count(*) FROM staging.prachar_sequence_enrollments e
--     JOIN staging.prachar_sequences s ON s.id=e.sequence_id
--    WHERE e.status='active' AND s.status='active'
--      AND e.next_step_at <= NOW() AND s.id::text LIKE 'e2000000%';
--
-- Measured 2026-08-06 after this ran:
--   teams 8 · project_columns 40 · project_assignments 24 · team_members 24
--   tasks 90 (37 done, 17 in_progress, 8 in_review, 26 todo, 2 requested;
--             9 overdue) · approvals 12 · activity_events 24 · comments 8
--   samvada_channels 5 · members 22 · messages 70 · mentions 6
--   prachar_campaigns 4 · campaign_contacts 60 · sequences 3 · steps 10
--             · enrolments 8
--   hub_chat_sessions 4 · hub_chat_messages 20
--   users 8 · user_roles 8   (org seats 13 of 15)
--   TOTAL 383 rows, every one of them Unicode Group's.
--
-- Email domains written: simulator.amazonses.com only — 182 addresses,
-- of which 2 bounce@, 1 complaint@ and 1 ooto@ so the delivery statistics
-- are not uniformly perfect. Zero gmail.com. Zero third-party.
-- =====================================================================
