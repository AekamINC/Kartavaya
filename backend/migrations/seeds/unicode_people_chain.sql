-- =====================================================================
-- Unicode Group — demo seed, PEOPLE CHAIN
--   Manav (HR)  ->  Vetana (payroll)  ->  Pahchan (attendance)
--
-- org_id  fae87907-2f99-4b35-a241-c94d9e1e4a17   ("Unicode Group")
-- Written 2026-08-06. ABSOLUTE DATES ONLY — re-running this file on any
-- later day produces exactly the same rows.
--
-- TENANCY
--   Every statement below is filtered on the single org_id above, either
--   directly or through a parent row that is itself filtered on it.
--   There is no DELETE and no TRUNCATE anywhere in this file. Every write
--   is idempotent: keyed on a stable natural key, ON CONFLICT / NOT EXISTS.
--
-- EMAIL
--   Every address written here is either
--     success+<slug>@simulator.amazonses.com   (AWS SES mailbox simulator,
--                                               accepts and discards)
--   or info+<label>@unicodegroup.com           (the customer's own domain).
--   No third-party, no real, no reachable human address.
--
-- NOTHING SENDS
--   Nothing in this chain is picked up by a cron. The only outbound path in
--   Vetana is inside POST /payroll/process (routers/vetana.py:750+), which
--   emails payslips at the moment a run is processed — it is not a scanner,
--   so rows written directly here are never mailed. scheduler.py has one
--   Pahchan job, `pahchan-retention`, which redacts data older than the org
--   retention window (3 years) and sends nothing. Leave requests left
--   `pending` are read only by the on-demand leave_conflict_checker skill.
-- =====================================================================

\set org '''fae87907-2f99-4b35-a241-c94d9e1e4a17'''

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
-- 1. DEPARTMENTS
-- =====================================================================
INSERT INTO staging.manav_departments (org_id, name)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, d
FROM (VALUES ('Engineering'), ('Design'), ('Marketing')) AS t(d)
WHERE NOT EXISTS (
  SELECT 1 FROM staging.manav_departments x
  WHERE x.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND x.name = t.d
);

-- Three departments named "E2E Legal / E2E QA / E2E Research" were left on
-- this org by an earlier ad-hoc test. They are Unicode Group's own rows, so
-- they are retired rather than deleted.
UPDATE staging.manav_departments
   SET is_active = FALSE
 WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND name LIKE 'E2E %' AND is_active IS DISTINCT FROM FALSE;

-- "Operations" was already on the org but flagged inactive, while three
-- employees sit in it. Every department the roster below actually uses has
-- to be live or the department roster renders those people as orphans.
UPDATE staging.manav_departments
   SET is_active = TRUE
 WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND name IN ('Operations','Client Relations','Finance & Accounts',
                'Human Resources','QA & Testing','Engineering','Design','Marketing')
   AND is_active IS DISTINCT FROM TRUE;


-- =====================================================================
-- 2. EMPLOYEES — the roster of 25
--
--    Nine employee rows already existed on this org from ad-hoc testing
--    (three of them with no employee code and no joining date). They are
--    adopted into the roster and repaired rather than duplicated, so the
--    566 attendance punches and the payslips that already point at them
--    keep pointing at real people. 2a assigns each of them its code; 2b
--    then upserts all 25 rows on that code.
-- =====================================================================

-- 2a. adopt the pre-existing rows into the UNI-nnn series
UPDATE staging.manav_employees e SET employee_code = v.code
  FROM (VALUES
    ('Amit Sharma','UNI-002'), ('Priya Mehta','UNI-003'),
    ('Vikram Joshi','UNI-004'), ('Kavya Raval','UNI-005'),
    ('Rohit Menon','UNI-006'), ('Sanya Kulkarni','UNI-007'),
    ('Aarav Trivedi','UNI-008'), ('Nikhil Desai','UNI-009')
  ) AS v(nm, code)
 WHERE e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND e.name = v.nm
   AND e.employee_code IS DISTINCT FROM v.code;

-- 2b. the roster
WITH roster(code, nm, dept, desig, doj, dob, gender, emp_type, status, active,
            pan, uan, esi_no, bank, branch, acct, ifsc, city, pin, ec_nm, ec_rel) AS (VALUES
 ('UNI-001','Rajesh Bhatt','Operations','Chief Operating Officer','2019-04-01','1978-11-12','male','full_time','active',TRUE,
    'AKQPB4821L','101234000001',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX4821','HDFC0001234','Ahmedabad','380015','Nita Bhatt','spouse'),
 ('UNI-002','Amit Sharma','Engineering','Lead Developer','2025-01-15','1990-06-21','male','full_time','active',TRUE,
    'ABCPS1234A','101234000002',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX1234','HDFC0001234','Ahmedabad','380054','Sunita Sharma','mother'),
 ('UNI-003','Priya Mehta','Design','Senior UI Designer','2025-03-01','1993-02-17','female','full_time','active',TRUE,
    'DEFPM5678B','101234000003',NULL,'ICICI Bank','Satellite, Ahmedabad','XXXXXXXX5678','ICIC0004567','Ahmedabad','380015','Rakesh Mehta','father'),
 ('UNI-004','Vikram Joshi','Marketing','Marketing Manager','2026-01-10','1988-09-05','male','contract','active',TRUE,
    'GHIPJ9012C','101234000004',NULL,'Axis Bank','CG Road, Ahmedabad','XXXXXXXX9012','UTIB0000123','Ahmedabad','380009','Meghna Joshi','spouse'),
 ('UNI-005','Kavya Raval','Marketing','Social Media Executive','2024-02-05','1998-04-30','female','full_time','active',TRUE,
    'BNZPR3391K','101234000005',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX3391','HDFC0001234','Ahmedabad','380052','Jayesh Raval','father'),
 ('UNI-006','Rohit Menon','Engineering','Senior Software Engineer','2023-08-16','1992-12-03','male','full_time','active',TRUE,
    'CQWPM7742H','101234000006',NULL,'SBI','Navrangpura, Ahmedabad','XXXXXXXX7742','SBIN0000456','Ahmedabad','380009','Lakshmi Menon','mother'),
 ('UNI-007','Sanya Kulkarni','Design','UI Designer','2025-07-01','1997-08-19','female','contract','active',TRUE,
    'DLMPK2286J','101234000007',NULL,'ICICI Bank','Satellite, Ahmedabad','XXXXXXXX2286','ICIC0004567','Ahmedabad','380015','Anil Kulkarni','father'),
 ('UNI-008','Aarav Trivedi','Marketing','Marketing Intern','2026-02-02','2003-01-25','male','intern','active',TRUE,
    'ERTPT5518G','101234000008','31001234560000008','Bank of Baroda','Paldi, Ahmedabad','XXXXXXXX5518','BARB0PALDIX','Ahmedabad','380007','Hetal Trivedi','mother'),
 ('UNI-009','Nikhil Desai','Finance & Accounts','Audit Associate','2024-06-03','1995-03-14','male','full_time','resigned',FALSE,
    'FGHPD1109M','101234000009',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX1109','HDFC0001234','Ahmedabad','380006','Bhavna Desai','mother'),
 ('UNI-010','Meera Nair','Finance & Accounts','Finance Controller','2021-06-01','1985-07-08','female','full_time','active',TRUE,
    'HJKPN6634N','101234000010',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX6634','HDFC0001234','Ahmedabad','380015','Suresh Nair','spouse'),
 ('UNI-011','Harshad Patel','Finance & Accounts','Senior Accountant','2022-09-12','1989-10-02','male','full_time','active',TRUE,
    'AAQPP8827R','101234000011',NULL,'Axis Bank','CG Road, Ahmedabad','XXXXXXXX8827','UTIB0000123','Gandhinagar','382010','Rekha Patel','spouse'),
 ('UNI-012','Ritu Agarwal','Human Resources','HR Manager','2022-01-03','1987-05-23','female','full_time','active',TRUE,
    'BKLPA4415T','101234000012',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX4415','HDFC0001234','Ahmedabad','380054','Manoj Agarwal','spouse'),
 ('UNI-013','Sameer Qureshi','Human Resources','HR Executive','2024-11-11','1996-11-29','male','full_time','active',TRUE,
    'CMNPQ9903W','101234000013',NULL,'SBI','Navrangpura, Ahmedabad','XXXXXXXX9903','SBIN0000456','Ahmedabad','380013','Nasreen Qureshi','mother'),
 ('UNI-014','Deepak Rane','Engineering','Backend Engineer','2023-02-20','1994-01-09','male','full_time','active',TRUE,
    'DPQPR2278Y','101234000014',NULL,'ICICI Bank','Satellite, Ahmedabad','XXXXXXXX2278','ICIC0004567','Ahmedabad','380058','Vaishali Rane','spouse'),
 ('UNI-015','Ananya Iyer','Engineering','Frontend Engineer','2024-07-15','1996-06-11','female','full_time','active',TRUE,
    'EWEPI6650Z','101234000015',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX6650','HDFC0001234','Ahmedabad','380015','Ganesh Iyer','father'),
 ('UNI-016','Farhan Shaikh','Engineering','DevOps Engineer','2023-11-06','1991-04-18','male','full_time','active',TRUE,
    'FRTPS3324B','101234000016',NULL,'Axis Bank','CG Road, Ahmedabad','XXXXXXXX3324','UTIB0000123','Ahmedabad','380004','Saira Shaikh','spouse'),
 ('UNI-017','Neha Chauhan','QA & Testing','QA Lead','2022-05-16','1990-09-27','female','full_time','active',TRUE,
    'GYUPC7796D','101234000017',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX7796','HDFC0001234','Gandhinagar','382421','Dinesh Chauhan','spouse'),
 ('UNI-018','Tarun Solanki','QA & Testing','QA Engineer','2025-09-01','1999-03-06','male','full_time','active',TRUE,
    'HIOPS1142F','101234000018',NULL,'SBI','Navrangpura, Ahmedabad','XXXXXXXX1142','SBIN0000456','Ahmedabad','380061','Kiran Solanki','father'),
 ('UNI-019','Pooja Barot','Client Relations','Client Servicing Manager','2021-11-15','1988-12-15','female','full_time','active',TRUE,
    'JPAPB5568H','101234000019',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX5568','HDFC0001234','Ahmedabad','380015','Chirag Barot','spouse'),
 ('UNI-020','Kunal Vyas','Client Relations','Account Executive','2024-03-04','1995-08-21','male','full_time','active',TRUE,
    'KSDPV9914J','101234000020',NULL,'ICICI Bank','Satellite, Ahmedabad','XXXXXXXX9914','ICIC0004567','Rajkot','360005','Bhavesh Vyas','father'),
 ('UNI-021','Snehal Thakkar','Operations','Operations Executive','2023-06-19','1997-02-08','female','full_time','active',TRUE,
    'LFGPT4460L','101234000021',NULL,'Bank of Baroda','Paldi, Ahmedabad','XXXXXXXX4460','BARB0PALDIX','Ahmedabad','380007','Mitesh Thakkar','spouse'),
 ('UNI-022','Imran Momin','Operations','Facilities Supervisor','2020-08-24','1984-06-30','male','full_time','active',TRUE,
    'MHJPM8836N','101234000022','31001234560000022','Bank of Baroda','Paldi, Ahmedabad','XXXXXXXX8836','BARB0PALDIX','Ahmedabad','380022','Ruksana Momin','spouse'),
 ('UNI-023','Divya Pandya','Finance & Accounts','Accounts Assistant','2025-04-07','2000-10-12','female','full_time','active',TRUE,
    'NKLPP2282P','101234000023','31001234560000023','SBI','Navrangpura, Ahmedabad','XXXXXXXX2282','SBIN0000456','Ahmedabad','380013','Harsha Pandya','mother'),
 ('UNI-024','Aditya Rathod','Engineering','Software Engineer','2026-06-01','1998-07-04','male','full_time','active',TRUE,
    'PZXPR6608R','101234000024',NULL,'HDFC Bank','Vastrapur, Ahmedabad','XXXXXXXX6608','HDFC0001234','Ahmedabad','380059','Jagdish Rathod','father'),
 ('UNI-025','Shreya Bhavsar','Design','Graphic Designer','2025-12-01','2001-05-19','female','full_time','active',TRUE,
    'QCVPB1054T','101234000025',NULL,'ICICI Bank','Satellite, Ahmedabad','XXXXXXXX1054','ICIC0004567','Ahmedabad','380051','Pinal Bhavsar','father')
)
INSERT INTO staging.manav_employees
  (org_id, employee_code, name, email, phone, department, designation,
   date_of_joining, date_of_birth, gender, blood_group, emergency_contact,
   address, bank_details, pan, uan, esi_number, employment_type, status,
   shift, created_by, is_active, updated_at)
SELECT
  'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid,
  code, nm,
  -- AWS SES mailbox simulator. Accepts, never delivers to a person.
  'success+' || replace(lower(nm), ' ', '-') || '@simulator.amazonses.com',
  -- Indian reserved test range; cannot ring a real handset.
  '+91 99999 ' || lpad(substr(code, 5, 3), 5, '1'),
  dept, desig, doj::date, dob::date, gender,
  (ARRAY['A+','B+','O+','AB+','O-','B-'])[1 + (('x'||substr(md5(code),1,8))::bit(32)::int & 5)],
  jsonb_build_object('name', ec_nm, 'relation', ec_rel,
                     'phone', '+91 99999 2' || lpad(substr(code,5,3),4,'0')),
  jsonb_build_object('line1', desig || ' residence', 'city', city,
                     'state', 'Gujarat', 'pincode', pin, 'country', 'India'),
  jsonb_build_object('bank_name', bank, 'branch', branch,
                     'account_number', acct, 'ifsc', ifsc),
  pan, uan, esi_no, emp_type, status,
  'general', 'user_21457956f010', active,
  TIMESTAMPTZ '2026-08-06 09:00:00+05:30'
FROM roster
ON CONFLICT (org_id, employee_code) WHERE employee_code IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone,
  department = EXCLUDED.department, designation = EXCLUDED.designation,
  date_of_joining = EXCLUDED.date_of_joining,
  date_of_birth = EXCLUDED.date_of_birth, gender = EXCLUDED.gender,
  blood_group = EXCLUDED.blood_group,
  emergency_contact = EXCLUDED.emergency_contact,
  address = EXCLUDED.address, bank_details = EXCLUDED.bank_details,
  pan = EXCLUDED.pan, uan = EXCLUDED.uan, esi_number = EXCLUDED.esi_number,
  employment_type = EXCLUDED.employment_type, status = EXCLUDED.status,
  is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at;

-- department heads
UPDATE staging.manav_departments d SET head_employee_id = e.id
  FROM (VALUES
    ('Operations','UNI-001'), ('Engineering','UNI-002'), ('Design','UNI-003'),
    ('Marketing','UNI-004'), ('Finance & Accounts','UNI-010'),
    ('Human Resources','UNI-012'), ('QA & Testing','UNI-017'),
    ('Client Relations','UNI-019')
  ) AS v(dept, code)
  JOIN staging.manav_employees e
    ON e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND e.employee_code = v.code
 WHERE d.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND d.name = v.dept
   AND d.head_employee_id IS DISTINCT FROM e.id;


-- =====================================================================
-- 3. LEAVE TYPES + BALANCES
--
--    All four existing types are `is_paid = TRUE`, so the org had no way to
--    represent loss of pay at all — and Vetana's own proration keys off
--    `is_paid = FALSE` (routers/vetana.py:573). A Loss of Pay type is added.
-- =====================================================================
INSERT INTO staging.manav_leave_types (org_id, name, code, annual_quota, is_paid, carry_forward, max_carry_forward)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, 'Loss of Pay', 'LOP', 0, FALSE, FALSE, 0
WHERE NOT EXISTS (SELECT 1 FROM staging.manav_leave_types
                  WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND code='LOP');

UPDATE staging.manav_leave_types
   SET carry_forward = TRUE, max_carry_forward = 15
 WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND code='EL'
   AND carry_forward IS DISTINCT FROM TRUE;

-- 2026 balances: every employee against every paid type.
INSERT INTO staging.manav_leave_balances (org_id, employee_id, leave_type_id, year, allocated, used, carried_forward)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, e.id, t.id, 2026,
       t.annual_quota,
       -- used: deterministic per (employee, type), 0..6, never above quota
       LEAST(t.annual_quota, (('x'||substr(md5(e.employee_code||t.code),1,8))::bit(32)::int & 7)),
       CASE WHEN t.code='EL'
            THEN (('x'||substr(md5(e.employee_code),1,8))::bit(32)::int & 3)
            ELSE 0 END
  FROM staging.manav_employees e
  CROSS JOIN staging.manav_leave_types t
 WHERE e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND e.employee_code LIKE 'UNI-%'
   AND t.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND t.is_paid = TRUE
ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;


-- =====================================================================
-- 4. LEAVE REQUESTS — 25
--    The LOP rows here are the same absences that the April–July payslips
--    prorate for, and the four single-day absences in July/August are the
--    same days on which the Pahchan roster shows no punch.
-- =====================================================================
INSERT INTO staging.manav_leave_requests
  (org_id, employee_id, leave_type_id, start_date, end_date, days, reason,
   status, approved_by, approved_at, rejection_reason, created_at, updated_at)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, e.id, t.id,
       v.sd::date, v.ed::date, v.dys, v.reason, v.status,
       CASE WHEN v.status IN ('approved','rejected') THEN 'user_21457956f010' END,
       CASE WHEN v.status IN ('approved','rejected')
            THEN (v.sd::date - 3)::timestamptz + INTERVAL '11 hours' END,
       CASE WHEN v.status='rejected' THEN v.reject END,
       (v.sd::date - 7)::timestamptz + INTERVAL '10 hours',
       (v.sd::date - 3)::timestamptz + INTERVAL '11 hours'
  FROM (VALUES
    ('UNI-001','EL' ,'2026-04-20','2026-04-24',5,'Family holiday — Kerala','approved',NULL),
    ('UNI-003','CAS','2026-04-09','2026-04-10',2,'Personal work','approved',NULL),
    ('UNI-021','LOP','2026-04-14','2026-04-14',1,'Casual balance exhausted','approved',NULL),
    ('UNI-005','LOP','2026-05-11','2026-05-12',2,'Extended personal leave, no balance','approved',NULL),
    ('UNI-011','SCK','2026-05-06','2026-05-06',1,'Fever','approved',NULL),
    ('UNI-018','SCK','2026-05-19','2026-05-19',1,'Viral fever','approved',NULL),
    ('UNI-009','EL' ,'2026-06-25','2026-06-26',2,'Notice period — handover buffer','approved',NULL),
    ('UNI-010','EL' ,'2026-06-22','2026-06-22',1,'Personal','approved',NULL),
    ('UNI-013','LOP','2026-06-15','2026-06-17',3,'Family emergency, balance exhausted','approved',NULL),
    ('UNI-021','CAS','2026-06-11','2026-06-11',1,'Personal work','approved',NULL),
    ('UNI-025','CAS','2026-06-05','2026-06-05',1,'Personal','rejected','Client review scheduled the same day'),
    ('UNI-024','CAS','2026-07-06','2026-07-06',1,'Relocation paperwork','cancelled',NULL),
    ('UNI-007','SCK','2026-07-13','2026-07-13',1,'Unwell','rejected','No medical certificate attached'),
    ('UNI-020','LOP','2026-07-17','2026-07-17',1,'Personal, no balance','approved',NULL),
    ('UNI-022','LOP','2026-07-09','2026-07-10',2,'Village visit, balance exhausted','approved',NULL),
    ('UNI-016','CAS','2026-07-24','2026-07-24',1,'Personal work','approved',NULL),
    ('UNI-023','SCK','2026-07-30','2026-07-30',1,'Migraine','approved',NULL),
    ('UNI-021','CAS','2026-08-03','2026-08-03',1,'Personal work','approved',NULL),
    ('UNI-012','CAS','2026-08-12','2026-08-12',1,'Personal','pending',NULL),
    ('UNI-002','EL' ,'2026-08-17','2026-08-21',5,'Annual leave','pending',NULL),
    ('UNI-006','EL' ,'2026-08-24','2026-08-28',5,'Annual leave — Kerala','pending',NULL),
    ('UNI-014','EL' ,'2026-09-14','2026-09-18',5,'Wedding in the family','pending',NULL),
    ('UNI-015','SCK','2026-02-16','2026-02-17',2,'Dengue — two days','approved',NULL),
    ('UNI-017','EL' ,'2026-03-09','2026-03-13',5,'Annual leave','approved',NULL),
    ('UNI-019','CAS','2026-01-26','2026-01-26',1,'Personal work','approved',NULL)
  ) AS v(code, ltype, sd, ed, dys, reason, status, reject)
  JOIN staging.manav_employees e
    ON e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND e.employee_code = v.code
  JOIN staging.manav_leave_types t
    ON t.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND t.code = v.ltype
 WHERE NOT EXISTS (
   SELECT 1 FROM staging.manav_leave_requests r
    WHERE r.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
      AND r.employee_id = e.id AND r.leave_type_id = t.id
      AND r.start_date = v.sd::date);


-- =====================================================================
-- 5. SHIFT ASSIGNMENTS — the current week's non-general roster
--    (eight shift definitions already exist on this org and are reused)
-- =====================================================================
INSERT INTO staging.manav_schedules (org_id, employee_id, shift_id, date, status, notes, created_by)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, e.id, s.id, v.d::date, 'scheduled', v.note, 'user_21457956f010'
  FROM (VALUES
    ('UNI-022','Morning Shift'   ,'2026-08-05','Opens the Vastrapur office'),
    ('UNI-022','Morning Shift'   ,'2026-08-06','Opens the Vastrapur office'),
    ('UNI-021','General Shift'   ,'2026-08-05',NULL),
    ('UNI-021','General Shift'   ,'2026-08-06',NULL),
    ('UNI-016','Night Shift'     ,'2026-08-05','Release window — deployment cover'),
    ('UNI-016','Night Shift'     ,'2026-08-06','Release window — deployment cover'),
    ('UNI-014','Flexi Shift'     ,'2026-08-05',NULL),
    ('UNI-014','Flexi Shift'     ,'2026-08-06',NULL),
    ('UNI-023','General Shift'   ,'2026-08-05',NULL),
    ('UNI-023','General Shift'   ,'2026-08-06',NULL),
    ('UNI-020','Rotational Shift','2026-08-05','Rajkot client site'),
    ('UNI-020','Rotational Shift','2026-08-06','Rajkot client site')
  ) AS v(code, shift, d, note)
  JOIN staging.manav_employees e
    ON e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND e.employee_code = v.code
  JOIN staging.manav_shift_definitions s
    ON s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND s.name = v.shift
ON CONFLICT (employee_id, date) DO NOTHING;


-- =====================================================================
-- 6. SALARY STRUCTURES
--
--    Component split, monthly:
--      basic   40% of gross      hra  40% of basic (Ahmedabad, non-metro)
--      conveyance 1,600          medical 1,250
--      special = the remainder
--    ctc_annual = (gross + employer PF + employer ESI) x 12.
--
--    THREE revisions, deliberately, so the payroll-variance screen has a
--    trend and not one comparison:
--      · UNI-006 / UNI-014 / UNI-017 revised effective 01-Jun-2026, but the
--        June run had already closed when the letters were signed — so June
--        was paid at the old rate and July carries one month of ARREARS.
--      · UNI-002 / UNI-015 / UNI-019 revised effective 01-Jul-2026, clean.
--    Vetana picks the latest `effective_from <= month_end` among active
--    rows (routers/vetana.py:521-527), so both baseline and revision stay
--    active and the employee's salary history is readable.
-- =====================================================================

-- One pre-existing structure for UNI-004 dated 2026-06-01 held a 15,000
-- flat basic with no other component. Left active it would silently become
-- Vikram Joshi's June-onward salary. Retired, not deleted.
UPDATE staging.vetana_salary_structures s
   SET is_active = FALSE,
       notes = 'Superseded — provisional structure, replaced by the FY 2026-27 letter',
       updated_at = TIMESTAMPTZ '2026-08-06 09:00:00+05:30'
  FROM staging.manav_employees e
 WHERE s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND e.id = s.employee_id AND e.employee_code = 'UNI-004'
   AND s.effective_from = DATE '2026-06-01'
   AND s.is_active IS DISTINCT FROM FALSE;

-- UNI-002's FY 2025-26 structure predates this seed and stays as history;
-- its ctc_annual did not agree with its own components.
UPDATE staging.vetana_salary_structures s
   SET ctc_annual = 550200, updated_at = TIMESTAMPTZ '2026-08-06 09:00:00+05:30'
  FROM staging.manav_employees e
 WHERE s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND e.id = s.employee_id AND e.employee_code = 'UNI-002'
   AND s.effective_from = DATE '2025-04-01'
   AND s.ctc_annual IS DISTINCT FROM 550200;

WITH pay(code, eff, gross, pf, esi, pt, regime, note) AS (VALUES
  -- baseline, FY 2026-27, effective 01-Apr-2026
  ('UNI-001','2026-04-01',150000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-002','2026-04-01', 50000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-003','2026-04-01', 52000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-004','2026-04-01', 62000,FALSE,FALSE,TRUE ,'new','Contract — no PF'),
  ('UNI-005','2026-04-01', 32000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-006','2026-04-01', 68000,TRUE ,FALSE,TRUE ,'old','FY 2026-27 structure'),
  ('UNI-007','2026-04-01', 42000,FALSE,FALSE,TRUE ,'new','Contract — no PF'),
  ('UNI-008','2026-04-01', 18000,FALSE,TRUE ,TRUE ,'new','Intern stipend — ESI applicable, no PF'),
  ('UNI-009','2026-04-01', 38000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-010','2026-04-01',118000,TRUE ,FALSE,TRUE ,'old','FY 2026-27 structure'),
  ('UNI-011','2026-04-01', 55000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-012','2026-04-01', 72000,TRUE ,FALSE,TRUE ,'old','FY 2026-27 structure'),
  ('UNI-013','2026-04-01', 34000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-014','2026-04-01', 74000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-015','2026-04-01', 61000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-016','2026-04-01', 79000,TRUE ,FALSE,TRUE ,'old','FY 2026-27 structure'),
  ('UNI-017','2026-04-01', 66000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-018','2026-04-01', 36000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-019','2026-04-01', 70000,TRUE ,FALSE,TRUE ,'old','FY 2026-27 structure'),
  ('UNI-020','2026-04-01', 44000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-021','2026-04-01', 30000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  ('UNI-022','2026-04-01', 20000,TRUE ,TRUE ,TRUE ,'new','ESI applicable'),
  ('UNI-023','2026-04-01', 21000,TRUE ,TRUE ,TRUE ,'new','ESI applicable'),
  ('UNI-025','2026-04-01', 28000,TRUE ,FALSE,TRUE ,'new','FY 2026-27 structure'),
  -- mid-quarter joiner
  ('UNI-024','2026-06-01', 48000,TRUE ,FALSE,TRUE ,'new','On joining, 01-Jun-2026'),
  -- revisions effective 01-Jun-2026, signed after the June run closed
  ('UNI-006','2026-06-01', 78000,TRUE ,FALSE,TRUE ,'old','Appraisal 2026 — arrears for June paid with July'),
  ('UNI-014','2026-06-01', 85000,TRUE ,FALSE,TRUE ,'new','Appraisal 2026 — arrears for June paid with July'),
  ('UNI-017','2026-06-01', 75000,TRUE ,FALSE,TRUE ,'new','Appraisal 2026 — arrears for June paid with July'),
  -- revisions effective 01-Jul-2026
  ('UNI-002','2026-07-01', 57500,TRUE ,FALSE,TRUE ,'new','Appraisal 2026'),
  ('UNI-015','2026-07-01', 69000,TRUE ,FALSE,TRUE ,'new','Appraisal 2026'),
  ('UNI-019','2026-07-01', 79000,TRUE ,FALSE,TRUE ,'old','Appraisal 2026')
), calc AS (
  SELECT p.*, e.id AS emp_id,
         round(gross * 0.40)                                   AS basic,
         round(round(gross * 0.40) * 0.40)                     AS hra,
         1600::numeric AS conv, 1250::numeric AS med,
         gross - round(gross*0.40) - round(round(gross*0.40)*0.40) - 1600 - 1250 AS spec,
         CASE WHEN pf  THEN LEAST(round(gross*0.40)*0.12, 1800) ELSE 0 END       AS pf_emr,
         CASE WHEN esi AND gross <= 21000 THEN round(gross*0.0325,2) ELSE 0 END  AS esi_emr
    FROM pay p
    JOIN staging.manav_employees e
      ON e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND e.employee_code = p.code
)
INSERT INTO staging.vetana_salary_structures
  (org_id, employee_id, effective_from, ctc_annual, basic, hra, da,
   special_allowance, conveyance, medical, other_allowances,
   pf_enabled, esi_enabled, pt_applicable, tds_regime, notes,
   is_active, created_by, created_at, updated_at)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, emp_id, eff::date,
       round((gross + pf_emr + esi_emr) * 12, 2),
       basic, hra, 0, spec, conv, med, '[]'::jsonb,
       pf, esi, pt, regime, note, TRUE, 'user_21457956f010',
       -- The three 01-Jun revisions were RECORDED on 20-Jul, after the June
       -- run had closed. That gap is the whole reason July carries arrears,
       -- so the row has to say when it was written, not just when it bites.
       CASE WHEN code IN ('UNI-006','UNI-014','UNI-017') AND eff = '2026-06-01'
            THEN TIMESTAMPTZ '2026-07-20 11:00:00+05:30'
            ELSE (eff::date - 5)::timestamptz + INTERVAL '11 hours' END,
       CASE WHEN code IN ('UNI-006','UNI-014','UNI-017') AND eff = '2026-06-01'
            THEN TIMESTAMPTZ '2026-07-20 11:00:00+05:30'
            ELSE (eff::date - 5)::timestamptz + INTERVAL '11 hours' END
  FROM calc
ON CONFLICT (org_id, employee_id, effective_from) DO UPDATE SET
  ctc_annual = EXCLUDED.ctc_annual, basic = EXCLUDED.basic, hra = EXCLUDED.hra,
  da = EXCLUDED.da, special_allowance = EXCLUDED.special_allowance,
  conveyance = EXCLUDED.conveyance, medical = EXCLUDED.medical,
  pf_enabled = EXCLUDED.pf_enabled, esi_enabled = EXCLUDED.esi_enabled,
  pt_applicable = EXCLUDED.pt_applicable, tds_regime = EXCLUDED.tds_regime,
  notes = EXCLUDED.notes, is_active = TRUE, updated_at = EXCLUDED.updated_at;


-- =====================================================================
-- 7. PAYROLL — four months, April to July 2026
--
--    Thirty-seven payslips already sat on this org, including runs for
--    2026-08 and 2026-09 (months that have not happened) and six payslips
--    whose net pay was 0.00. They are deactivated, not deleted: Vetana
--    reads `is_active = TRUE` everywhere, including the payroll-variance
--    handler, so `is_active = FALSE` is this product's own soft delete.
--    The three 2026-01..03 payslips are arithmetically sound and are kept —
--    they are Unicode Group's pre-Vetana period, one employee on a
--    spreadsheet, before the whole company came onto the product in April.
--
--    working_days = calendar days minus Sundays, which is Vetana's own
--    definition (routers/vetana.py:568-570): Apr 26, May 26, Jun 26, Jul 27.
--    Every figure below is computed with the same arithmetic the product
--    uses — _compute_statutory at routers/vetana.py:419-462.
-- =====================================================================

UPDATE staging.vetana_payslips p
   SET is_active = FALSE
  FROM staging.vetana_payroll_runs r
 WHERE p.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND r.id = p.run_id
   AND p.month >= '2026-04'
   AND p.payslip_number < 'PS-2026-0044'   -- the pre-existing series only
   AND p.is_active IS DISTINCT FROM FALSE;

-- run headers for months that carry no payslips
UPDATE staging.vetana_payroll_runs
   SET status='draft', total_gross=0, total_deductions=0, total_net=0,
       total_pf=0, total_esi=0, total_pt=0, total_tds=0, employee_count=0,
       processed_at=NULL, approved_by=NULL, approved_at=NULL
 WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND month IN ('2026-08','2026-09');

-- ── the payslips ────────────────────────────────────────────────────────
WITH months(mth, wd, mend, proc_at, pay_status) AS (VALUES
  ('2026-04',26,DATE '2026-04-30',TIMESTAMPTZ '2026-05-01 11:00:00+05:30','disbursed'),
  ('2026-05',26,DATE '2026-05-31',TIMESTAMPTZ '2026-06-01 11:00:00+05:30','disbursed'),
  ('2026-06',26,DATE '2026-06-30',TIMESTAMPTZ '2026-07-01 11:00:00+05:30','disbursed'),
  ('2026-07',27,DATE '2026-07-31',TIMESTAMPTZ '2026-08-01 11:00:00+05:30','approved')
),
-- who is on the register in each month
elig AS (
  SELECT e.id AS emp_id, e.employee_code AS code, m.*
    FROM staging.manav_employees e
    CROSS JOIN months m
   WHERE e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
     AND e.employee_code LIKE 'UNI-%'
     AND e.date_of_joining <= m.mend
     -- UNI-009 resigned with effect from 30-Jun-2026: paid to June, not July
     AND NOT (e.employee_code='UNI-009' AND m.mth='2026-07')
),
-- the month's exceptions: paid leave, loss of pay, overtime, arrears, claims
ex(code, mth, lv_paid, lv_unpaid, ot_hours, arrears, reimb) AS (VALUES
  ('UNI-001','2026-04',5,0,0,0,0),
  ('UNI-003','2026-04',2,0,0,0,0),
  ('UNI-021','2026-04',0,1,0,0,0),
  ('UNI-005','2026-05',0,2,0,0,0),
  ('UNI-011','2026-05',1,0,0,0,0),
  ('UNI-018','2026-05',1,0,0,0,0),
  ('UNI-019','2026-05',0,0,0,0,4500),
  ('UNI-009','2026-06',2,0,0,0,0),
  ('UNI-010','2026-06',1,0,0,0,0),
  ('UNI-013','2026-06',0,3,0,0,0),
  ('UNI-021','2026-06',1,0,0,0,0),
  ('UNI-022','2026-06',0,0,12,0,0),
  ('UNI-006','2026-07',0,0,0,10000,0),
  ('UNI-014','2026-07',0,0,0,11000,0),
  ('UNI-016','2026-07',1,0,0,0,0),
  ('UNI-017','2026-07',0,0,0, 9000,0),
  ('UNI-020','2026-07',0,1,0,0,3200),
  ('UNI-022','2026-07',0,2,9,0,0),
  ('UNI-023','2026-07',1,0,0,0,0)
),
-- the structure in force on the last day of the month, exactly as Vetana picks it
struct AS (
  SELECT DISTINCT ON (el.emp_id, el.mth)
         el.emp_id, el.code, el.mth, el.wd, el.mend, el.proc_at, el.pay_status,
         s.basic, s.hra, s.special_allowance, s.conveyance, s.medical,
         s.pf_enabled, s.esi_enabled, s.pt_applicable, s.tds_regime
    FROM elig el
    JOIN staging.vetana_salary_structures s
      ON s.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
     AND s.employee_id = el.emp_id
     AND s.is_active = TRUE
     AND s.effective_from <= el.mend
     -- The June revision for these three was signed after the June run had
     -- been processed, so June was PAID at the April rate and July carries
     -- the difference as arrears. Without this the employee is paid the
     -- rise in June and then paid it again in July as arrears.
     AND NOT (el.mth = '2026-06'
              AND el.code IN ('UNI-006','UNI-014','UNI-017')
              AND s.effective_from = DATE '2026-06-01')
   ORDER BY el.emp_id, el.mth, s.effective_from DESC
),
base AS (
  SELECT st.*,
         COALESCE(x.lv_paid,0)   AS lv_paid,
         COALESCE(x.lv_unpaid,0) AS lv_unpaid,
         COALESCE(x.ot_hours,0)  AS ot_h,
         COALESCE(x.arrears,0)   AS arrears,
         COALESCE(x.reimb,0)     AS reimb,
         (st.wd - COALESCE(x.lv_unpaid,0))::numeric / st.wd AS ratio
    FROM struct st
    LEFT JOIN ex x ON x.code = st.code AND x.mth = st.mth
),
amt AS (
  SELECT b.*,
         round(b.basic             * b.ratio, 2) AS basic_p,
         round(COALESCE(b.hra,0)   * b.ratio, 2) AS hra_p,
         round(COALESCE(b.special_allowance,0) * b.ratio, 2) AS spec_p,
         round(COALESCE(b.conveyance,0) * b.ratio, 2) AS conv_p,
         round(COALESCE(b.medical,0)    * b.ratio, 2) AS med_p,
         round(b.ot_h * (b.basic / (b.wd * 8)) * 2, 2)      AS ot_pay
    FROM base b
),
gr AS (
  SELECT a.*,
         round(a.basic_p + a.hra_p + a.spec_p + a.conv_p + a.med_p
               + a.ot_pay + a.arrears, 2) AS gross
    FROM amt a
),
stat AS (
  SELECT g.*,
         CASE WHEN g.pf_enabled THEN round(LEAST(g.basic_p * 0.12, 1800), 2) ELSE 0 END AS pf_e,
         CASE WHEN g.pf_enabled THEN round(LEAST(g.basic_p * 0.12, 1800), 2) ELSE 0 END AS pf_r,
         CASE WHEN g.esi_enabled AND g.gross <= 21000 THEN round(g.gross*0.0075,2) ELSE 0 END AS esi_e,
         CASE WHEN g.esi_enabled AND g.gross <= 21000 THEN round(g.gross*0.0325,2) ELSE 0 END AS esi_r,
         CASE WHEN g.pt_applicable AND g.gross > 15000 THEN 200 ELSE 0 END AS pt,
         round(
           CASE WHEN g.tds_regime = 'new' THEN
             CASE
               WHEN GREATEST(g.gross*12-50000,0) <=  300000 THEN 0
               WHEN GREATEST(g.gross*12-50000,0) <=  700000 THEN (GREATEST(g.gross*12-50000,0)- 300000)*0.05
               WHEN GREATEST(g.gross*12-50000,0) <= 1000000 THEN  20000 + (GREATEST(g.gross*12-50000,0)- 700000)*0.10
               WHEN GREATEST(g.gross*12-50000,0) <= 1200000 THEN  50000 + (GREATEST(g.gross*12-50000,0)-1000000)*0.15
               WHEN GREATEST(g.gross*12-50000,0) <= 1500000 THEN  80000 + (GREATEST(g.gross*12-50000,0)-1200000)*0.20
               ELSE                                              140000 + (GREATEST(g.gross*12-50000,0)-1500000)*0.30
             END
           ELSE
             CASE
               WHEN GREATEST(g.gross*12-50000,0) <=  250000 THEN 0
               WHEN GREATEST(g.gross*12-50000,0) <=  500000 THEN (GREATEST(g.gross*12-50000,0)- 250000)*0.05
               WHEN GREATEST(g.gross*12-50000,0) <= 1000000 THEN  12500 + (GREATEST(g.gross*12-50000,0)- 500000)*0.20
               ELSE                                              112500 + (GREATEST(g.gross*12-50000,0)-1000000)*0.30
             END
           END / 12, 2) AS tds
    FROM gr g
),
fin AS (
  SELECT s.*,
         (s.pf_e + s.esi_e + s.pt + s.tds) AS total_ded,
         row_number() OVER (ORDER BY s.mth, s.code) AS seq
    FROM stat s
)
INSERT INTO staging.vetana_payslips
  (org_id, run_id, employee_id, payslip_number, month,
   working_days, present_days, leaves_paid, leaves_unpaid, overtime_hours,
   basic, hra, da, special_allowance, conveyance, medical, other_earnings,
   overtime_pay, gross, pf_employee, pf_employer, esi_employee, esi_employer,
   professional_tax, tds, other_deductions, loan_deduction, loan_deductions,
   reimbursements, total_deductions, net_pay, status, disbursed_at,
   is_active, created_at)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, r.id, f.emp_id,
       'PS-2026-' || lpad((43 + f.seq)::text, 4, '0'), f.mth,
       f.wd, f.wd - f.lv_paid - f.lv_unpaid, f.lv_paid, f.lv_unpaid, f.ot_h,
       f.basic_p, f.hra_p, 0, f.spec_p, f.conv_p, f.med_p,
       CASE WHEN f.arrears > 0
            THEN jsonb_build_array(jsonb_build_object(
                   'label','Arrears — revision effective 01-Jun-2026',
                   'amount', f.arrears))
            ELSE '[]'::jsonb END,
       f.ot_pay, f.gross, f.pf_e, f.pf_r, f.esi_e, f.esi_r, f.pt, f.tds,
       '[]'::jsonb, 0, '[]'::jsonb, f.reimb,
       f.total_ded,
       GREATEST(round(f.gross - f.total_ded + f.reimb, 2), 0),
       f.pay_status,
       CASE WHEN f.pay_status='disbursed' THEN f.proc_at + INTERVAL '4 hours' END,
       TRUE,
       f.proc_at + (f.seq * INTERVAL '1 second')
  FROM fin f
  JOIN staging.vetana_payroll_runs r
    ON r.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND r.month = f.mth
 WHERE NOT EXISTS (
   SELECT 1 FROM staging.vetana_payslips p
    WHERE p.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
      AND p.run_id = r.id AND p.employee_id = f.emp_id AND p.is_active = TRUE);

-- ── run headers, recomputed from the payslips they own ──────────────────
UPDATE staging.vetana_payroll_runs r SET
  status = CASE WHEN r.month = '2026-07' THEN 'approved' ELSE 'disbursed' END,
  total_gross      = t.g,   total_deductions = t.d,   total_net = t.n,
  total_pf         = t.pf,  total_esi        = t.esi,
  total_pt         = t.pt,  total_tds        = t.tds,
  employee_count   = t.c,
  processed_at     = (r.month || '-01')::date + INTERVAL '1 month' + INTERVAL '11 hours',
  approved_by      = 'user_21457956f010',
  approved_at      = (r.month || '-01')::date + INTERVAL '1 month' + INTERVAL '14 hours'
FROM (
  SELECT run_id,
         round(sum(gross),2) g, round(sum(total_deductions),2) d,
         round(sum(net_pay),2) n,
         round(sum(pf_employee+pf_employer),2) pf,
         round(sum(esi_employee+esi_employer),2) esi,
         round(sum(professional_tax),2) pt, round(sum(tds),2) tds,
         count(*) c
    FROM staging.vetana_payslips
   WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND is_active = TRUE
   GROUP BY run_id
) t
WHERE r.id = t.run_id AND r.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17';


-- =====================================================================
-- 8. PAHCHAN — biometric attendance, TWELVE of the twenty-five
--
--    Unicode Group is part way through rolling attendance out. Seven people
--    were already punching (566 rows, 08-Jun to 04-Aug); five more are
--    added here over the same fourteen working days, 16-Jul to 04-Aug 2026,
--    which is the window `pahchan_org_usage` bills on (distinct employees
--    who punched in the last 30 days). Thirteen of the twenty-five are NOT
--    enrolled — that gap is the seat model, and hiding it behind full
--    coverage would hide the thing a buyer is actually paying per head for.
-- =====================================================================

-- reference photographs — two approved slots make an employee "enrolled"
-- (routers/pahchan.py:858-861 counts exactly this).
INSERT INTO staging.pahchan_enrollment_photos
  (org_id, employee_id, slot, object_key, source, uploaded_by,
   captured_at, approved_by, approved_at, created_at)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, e.id, sl,
       'pahchan/fae87907-2f99-4b35-a241-c94d9e1e4a17/reference/' || e.id || '-s' || sl || '.jpg',
       'hr_upload', 'user_21457956f010',
       TIMESTAMPTZ '2026-06-05 10:30:00+05:30' + (sl * INTERVAL '3 minutes'),
       'user_21457956f010',
       TIMESTAMPTZ '2026-06-05 10:30:00+05:30' + (sl * INTERVAL '3 minutes'),
       TIMESTAMPTZ '2026-06-05 10:30:00+05:30' + (sl * INTERVAL '3 minutes')
  FROM staging.manav_employees e
  CROSS JOIN (VALUES (1),(2)) AS s(sl)
 WHERE e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
   AND e.employee_code IN ('UNI-002','UNI-003','UNI-004','UNI-005','UNI-006',
                           'UNI-007','UNI-008','UNI-014','UNI-016','UNI-021',
                           'UNI-022','UNI-023')
   AND NOT EXISTS (
     SELECT 1 FROM staging.pahchan_enrollment_photos r
      WHERE r.employee_id = e.id AND r.slot = s.sl AND r.replaced_at IS NULL);

-- punches for the five newly-enrolled, 14 working days.
-- `client_punch_id` follows the convention already in this table, and is the
-- idempotency key: UNIQUE (org_id, client_punch_id).
WITH days(d) AS (VALUES
  (DATE '2026-07-16'),(DATE '2026-07-17'),(DATE '2026-07-20'),(DATE '2026-07-21'),
  (DATE '2026-07-22'),(DATE '2026-07-23'),(DATE '2026-07-24'),(DATE '2026-07-27'),
  (DATE '2026-07-28'),(DATE '2026-07-29'),(DATE '2026-07-30'),(DATE '2026-07-31'),
  (DATE '2026-08-03'),(DATE '2026-08-04')
),
people(code, idx, in_t, out_t) AS (VALUES
  ('UNI-014',1,TIME '09:44',TIME '19:05'),   -- Deepak Rane, two days at Gandhinagar
  ('UNI-016',2,TIME '09:52',TIME '19:33'),   -- Farhan Shaikh, one offline day, one weak fix
  ('UNI-021',3,TIME '09:21',TIME '18:47'),   -- Snehal Thakkar, one late mark
  ('UNI-022',4,TIME '06:04',TIME '15:12'),   -- Imran Momin, opens the office
  ('UNI-023',5,TIME '09:33',TIME '18:36')    -- Divya Pandya
),
grid AS (
  SELECT p.code, p.idx, d.d,
         row_number() OVER (PARTITION BY p.code ORDER BY d.d) AS dn,
         p.in_t, p.out_t
    FROM people p CROSS JOIN days d
),
shaped AS (
  SELECT g.*,
         -- deterministic ±5 minute jitter; a perfect grid reads as fake
         ((g.dn * 7 + g.idx * 3) % 11 - 5) AS jit,
         CASE
           WHEN g.code='UNI-014' AND g.d IN (DATE '2026-07-22', DATE '2026-07-29')
             THEN 'd1000000-0000-4000-8000-000000000002'   -- Gandhinagar branch
           WHEN g.code='UNI-022' AND g.d = DATE '2026-08-04'
             THEN 'd1000000-0000-4000-8000-000000000003'   -- Rajkot client site
           ELSE 'd1000000-0000-4000-8000-000000000001'     -- Vastrapur head office
         END::uuid AS site
    FROM grid g
),
punch AS (
  SELECT s.*, dir
    FROM shaped s CROSS JOIN (VALUES ('in'),('out')) AS x(dir)
   WHERE
     -- approved leave: no punch on the day (see §4)
     NOT (s.code='UNI-016' AND s.d = DATE '2026-07-24')
     AND NOT (s.code='UNI-021' AND s.d = DATE '2026-08-03')
     AND NOT (s.code='UNI-023' AND s.d = DATE '2026-07-30')
     -- forgot to punch out; the regularisation queue is what this is for
     AND NOT (s.code='UNI-023' AND s.d = DATE '2026-07-23' AND dir='out')
)
INSERT INTO staging.pahchan_punches
  (org_id, employee_id, direction, captured_at, received_at, synced_at,
   photo_key, lat, lng, accuracy_m, distance_m, geofence_id, source,
   mock_location, flags, reviewed_by, reviewed_at, review_verdict,
   client_punch_id, created_at)
SELECT 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, e.id, pn.dir,
       ts.captured, ts.captured + INTERVAL '3 seconds',
       ts.captured + INTERVAL '3 seconds',
       NULL,
       st.lat + (pn.jit::numeric / 100000), st.lng - (pn.jit::numeric / 100000),
       acc.accuracy, dist.distance, pn.site,
       CASE WHEN pn.code='UNI-016' AND pn.d = DATE '2026-07-28' THEN 'offline' ELSE 'live' END,
       FALSE,
       CASE
         WHEN pn.code='UNI-016' AND pn.d = DATE '2026-07-28' THEN ARRAY['offline']
         WHEN pn.code='UNI-016' AND pn.d = DATE '2026-08-04' THEN ARRAY['accuracy']
         WHEN pn.code='UNI-022' AND pn.d = DATE '2026-08-04' THEN ARRAY['geo']
         ELSE ARRAY[]::text[]
       END,
       CASE WHEN pn.code='UNI-022' AND pn.d = DATE '2026-08-04' THEN 'user_21457956f010' END,
       CASE WHEN pn.code='UNI-022' AND pn.d = DATE '2026-08-04'
            THEN TIMESTAMPTZ '2026-08-05 10:15:00+05:30' END,
       CASE WHEN pn.code='UNI-022' AND pn.d = DATE '2026-08-04' THEN 'ok' END,
       'seed-' || left(e.id::text, 8) || '-' || to_char(pn.d,'YYYYMMDD') || '-' || pn.dir,
       ts.captured + INTERVAL '3 seconds'
  FROM punch pn
  JOIN staging.manav_employees e
    ON e.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17' AND e.employee_code = pn.code
  JOIN staging.pahchan_sites st
    ON st.id = pn.site AND st.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
  CROSS JOIN LATERAL (SELECT
      ((pn.d + CASE WHEN pn.dir='in' THEN pn.in_t ELSE pn.out_t END)
        AT TIME ZONE 'Asia/Kolkata')
      + (pn.jit * INTERVAL '1 minute')
      -- Snehal was 45 minutes late on the 21st. Lateness is derived from the
      -- shift window, not flagged on the punch.
      + CASE WHEN pn.code='UNI-021' AND pn.d = DATE '2026-07-21' AND pn.dir='in'
             THEN INTERVAL '50 minutes' ELSE INTERVAL '0' END AS captured) ts
  CROSS JOIN LATERAL (SELECT CASE
      WHEN pn.code='UNI-016' AND pn.d = DATE '2026-08-04' THEN 180.00
      ELSE 12.00 + ((pn.dn * 13 + pn.idx * 5) % 60) END AS accuracy) acc
  CROSS JOIN LATERAL (SELECT CASE
      WHEN pn.code='UNI-022' AND pn.d = DATE '2026-08-04' THEN 240.00   -- outside the 150 m fence
      ELSE 4.00 + ((pn.dn * 11 + pn.idx * 7) % 55) END AS distance) dist
ON CONFLICT (org_id, client_punch_id) DO NOTHING;

COMMIT;

-- =====================================================================
-- VERIFICATION — every one of these must return only the Unicode org_id.
-- =====================================================================
-- SELECT DISTINCT org_id FROM staging.manav_employees      WHERE employee_code LIKE 'UNI-%';
-- SELECT DISTINCT org_id FROM staging.vetana_payslips      WHERE payslip_number >= 'PS-2026-0044';
-- SELECT DISTINCT org_id FROM staging.pahchan_punches      WHERE client_punch_id LIKE 'seed-%';
-- SELECT DISTINCT split_part(email,'@',2) FROM staging.manav_employees
--   WHERE org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17';
