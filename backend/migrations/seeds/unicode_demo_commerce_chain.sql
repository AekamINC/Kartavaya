-- =====================================================================
-- unicode_demo_commerce_chain.sql
--
-- Demo seed for ONE organisation: Unicode Group (fae87907-2f99-4b35-a241-c94d9e1e4a17).
-- Chain: Graha (CRM) -> Vikray (sales) -> Ganit (finance) -> e-sign.
--
-- RE-RUNNABLE. Every id is derived from a stable key (uuid5, or md5(text)::uuid
-- where the row is derived from another table) and every statement ends in
-- ON CONFLICT DO NOTHING. Running this file twice inserts nothing the second
-- time. There is no DELETE, UPDATE or TRUNCATE anywhere in it.
--
-- TENANCY. Every INSERT names org_id = fae87907-2f99-4b35-a241-c94d9e1e4a17
-- literally, and every join back into an existing table is itself filtered on
-- that org_id. No statement can read or write another organisation's rows.
-- Two other real organisations share this schema (Aekam Inc and E2E Test &
-- Associates) and production writes here too, which is why there is no
-- unqualified UPDATE or DELETE below.
--
-- EMAIL. Every address is either the AWS SES mailbox simulator
-- (success+<slug>@simulator.amazonses.com), which accepts mail and delivers to
-- nobody, or the org's own info+<label>@unicodegroup.com. No reachable
-- third-party address is written anywhere.
--
-- DOCUMENT NUMBERS. backend/utils.py::next_doc_number allocates PREFIX-YYYY-NNNN
-- by reading the row with the newest created_at and adding one. The created_at
-- values below therefore ascend with the number and start after the newest
-- pre-existing row of each series, so the live allocator continues from the last
-- number this file writes rather than colliding with it:
--     ganit_invoices      INV-2026-0049 .. INV-2026-0085   (pre-existing max 0048)
--     vikray_orders       SO-2026-0036  .. SO-2026-0057    (pre-existing max 0035)
--     ganit_vendor_bills  VB-2026-0007  .. VB-2026-0020    (pre-existing max 0006)
--
-- MONEY is in rupees, not paise — that is what the existing ganit_* rows use.
-- GSTINs carry a real check digit (backend/services/gstin.py agrees) and the
-- state code matches the address state, so place-of-supply is CGST+SGST for
-- Gujarat (the supplier's own state, 24) and IGST everywhere else.
--
-- Absolute dates only. Today is 2026-08-06.
-- =====================================================================

BEGIN;

-- ── GRAHA — 16 companies ────────────────────────────────────────────────
INSERT INTO staging.graha_clients
      (id, org_id, name, ref_no, gstin, address, website, notes, tags, created_by, is_active, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.ref_no, v.gstin,
       jsonb_build_object('line1',v.line1,'city',v.city,'state',v.state,
                          'state_code',v.sc,'pincode',v.pin,'country','India'),
       'https://www.example.com', 'Seeded demo account — '||v.city||', '||v.state||'.',
       ARRAY[v.tag,'seed-demo'], 'user_91601f25f601', TRUE,
       '2026-01-05 10:00:00+05:30'::timestamptz, '2026-08-05 10:00:00+05:30'::timestamptz
FROM (VALUES
('121f2eab-c2ce-52f1-8738-ee737f69ef0c','UG-C-101','Aarna Textile Mills Pvt Ltd','24AABCA7412K1ZW','Plot 44, Pandesara GIDC','Surat','Gujarat','24','395002','customer'),
('e12f36fe-bc7e-51ad-997f-c8a5dac3f596','UG-C-102','Bhavya Infra Projects Pvt Ltd','24AACCB3391L1ZM','602, Shivalik Shilp, Iscon Cross Road','Ahmedabad','Gujarat','24','380054','customer'),
('99a0d3d5-089b-5d28-a255-33a77af52e07','UG-C-103','Chandrika Pharma Labs Pvt Ltd','24AADCC8256M1ZC','B-17, Makarpura Industrial Estate','Vadodara','Gujarat','24','390010','customer'),
('63e1e408-c770-575a-ac2f-ab4109c3bfc1','UG-C-104','Dhruv Agro Exports LLP','24AAEFD5178P1ZZ','Survey 212, Gondal Road','Rajkot','Gujarat','24','360004','customer'),
('ed0fa418-286a-5618-a311-724d2ede7712','UG-C-105','Ekveera Engineering Works Pvt Ltd','27AAFCE6634Q1Z0','J-88, MIDC Bhosari','Pune','Maharashtra','27','411019','customer'),
('cfc6d1d8-7fa2-5995-9dbb-2ecdaa735ed9','UG-C-106','Firozi Retail Ventures Pvt Ltd','27AAGCF2907R1Z4','1204, Andheri Business Park, Chakala','Mumbai','Maharashtra','27','400069','customer'),
('7b49d79b-becf-58fa-948c-5ac201766902','UG-C-107','Gokul Dairy Foods Pvt Ltd','27AAHCG4483S1ZP','Gat 210, Satpur MIDC','Nashik','Maharashtra','27','422010','customer'),
('d03268b1-935e-58f5-bcec-6b04bfc17f6c','UG-C-108','Harshad Electricals Pvt Ltd','29AAJCH9051T1ZI','No. 27, Peenya 2nd Stage','Bengaluru','Karnataka','29','560058','customer'),
('0ddbbf2c-16cc-5ef1-9c1d-70055a84fe17','UG-C-109','Indira Software Labs Pvt Ltd','29AAKCI1720U1ZU','8th Floor, Prestige Tech Park, Marathahalli','Bengaluru','Karnataka','29','560103','customer'),
('bdbc3b47-dadf-52d4-b9a3-a9300520a770','UG-C-110','Jaywant Logistics Pvt Ltd','07AALCJ6395V1Z7','Plot 19, Okhla Industrial Area Phase II','New Delhi','Delhi','07','110020','customer'),
('91312d5f-e624-57df-8afa-0d98c38df687','UG-C-111','Kaveri Chemicals Pvt Ltd','33AAMCK3068W1ZK','54, Ambattur Industrial Estate','Chennai','Tamil Nadu','33','600058','customer'),
('e2d20ee4-b471-50b3-a693-98e1a0c2e677','UG-C-112','Lakshya Media Networks LLP','36AANFL8842X1ZW','Level 4, Cyber Gateway, HITEC City','Hyderabad','Telangana','36','500081','customer'),
('42a9d7a0-de1a-5ace-8e04-df2fb514b486','UG-C-113','Mahaveer Gems and Jewels Pvt Ltd','08AAPCM5519Y1Z4','31, Johari Bazaar','Jaipur','Rajasthan','08','302001','prospect'),
('f9f03cc5-6011-571f-a2c9-dad07d98aec7','UG-C-114','Nandini Packaging Pvt Ltd','19AAQCN2274Z1ZZ','9B, Taratala Road','Kolkata','West Bengal','19','700088','prospect'),
('86f3d8d2-85fb-5eec-a47c-694eda7a70cf','UG-C-115','Omkar Auto Components Pvt Ltd','06AARCO7736A1ZA','Plot 61, Udyog Vihar Phase IV','Gurugram','Haryana','06','122016','prospect'),
('94f23f0b-4cdc-541d-a7b8-e294e6427a3c','UG-C-116','Pratham Solar Solutions Pvt Ltd','23AASCP4160B1ZM','Shed 12, Pologround Industrial Area','Indore','Madhya Pradesh','23','452015','prospect')
) AS v(id, ref_no, name, gstin, line1, city, state, sc, pin, tag)
ON CONFLICT (id) DO NOTHING;

-- ── GRAHA — 42 contacts (address inherited from the company row above) ──
INSERT INTO staging.graha_contacts
      (id, org_id, name, email, phone, company, designation, gstin, pan, billing_address,
       shipping_address, tags, notes, contact_type, source, created_by, is_active,
       created_at, updated_at, lead_score, assigned_to, last_contacted_at, converted_at, client_id)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name,
       'success+'||v.slug||'@simulator.amazonses.com', v.phone,
       COALESCE(c.name, v.company), v.desig, v.gstin, '',
       COALESCE(c.address,'{}'::jsonb), COALESCE(c.address,'{}'::jsonb),
       ARRAY['seed-demo'], 'Seeded demo contact.', v.ctype, v.src,
       'user_91601f25f601', TRUE,
       '2026-01-06 11:00:00+05:30'::timestamptz, '2026-08-05 11:00:00+05:30'::timestamptz,
       v.score::int, v.owner, (v.touched||' 12:00:00+05:30')::timestamptz,
       CASE WHEN v.ctype='customer' THEN '2026-02-10 12:00:00+05:30'::timestamptz END,
       c.id
FROM (VALUES
('65bd5f37-d10d-5c0b-8518-84d7b7b66466','Nilesh Sanghavi','nilesh-sanghavi','+91 99999 10001','UG-C-101','','Managing Director','24AABCA7412K1ZW','customer','referral',40,'user_21457956f010','2026-07-20'),
('0e8061f9-ed20-50a6-a6a1-47fa0a4b3863','Rupal Sanghavi','rupal-sanghavi','+91 99999 10002','UG-C-101','','Finance Controller','','customer','website',47,'user_91601f25f601','2026-07-21'),
('c353a76d-9f58-578a-96bf-677d6dd0df5b','Ketan Vasa','ketan-vasa','+91 99999 10003','UG-C-101','','Purchase Head','','customer','event',54,'user_76cd525348e1','2026-07-22'),
('9852b14d-0f18-50a8-ab26-cfe0a201da63','Bhavesh Trivedi','bhavesh-trivedi','+91 99999 10004','UG-C-102','','Director','24AACCB3391L1ZM','customer','referral',61,'user_f798947b8a2e','2026-07-23'),
('ec5052c5-241a-5913-baa0-0d699bfee759','Aditi Trivedi','aditi-trivedi','+91 99999 10005','UG-C-102','','Company Secretary','','customer','website',68,'user_fc914df642c3','2026-07-24'),
('e9c1ee46-7c9a-50f8-898e-8f940b3d1d2e','Dr Chandrika Bhatt','dr-chandrika-bhatt','+91 99999 10006','UG-C-103','','Managing Director','24AADCC8256M1ZC','customer','event',75,'user_21457956f010','2026-07-25'),
('4675915a-8043-56fe-9d26-0b5f6e798390','Samir Pandya','samir-pandya','+91 99999 10007','UG-C-103','','Head of Quality','','customer','referral',82,'user_91601f25f601','2026-07-26'),
('37f30217-182d-5c5b-85a6-78e4951a1897','Falguni Desai','falguni-desai','+91 99999 10008','UG-C-103','','Accounts Manager','','customer','website',89,'user_76cd525348e1','2026-07-27'),
('a83da0ac-c46b-5d44-bc69-df236c0dbcd6','Dhruv Kanabar','dhruv-kanabar','+91 99999 10009','UG-C-104','','Partner','24AAEFD5178P1ZZ','customer','event',41,'user_f798947b8a2e','2026-07-28'),
('4d8731d2-3f2e-5bbd-b254-2f3eb730f2ea','Jignesh Kanabar','jignesh-kanabar','+91 99999 10010','UG-C-104','','Export Manager','','customer','referral',48,'user_fc914df642c3','2026-07-29'),
('317254e8-2d0a-519f-8231-885e830fff3c','Sachin Deshmukh','sachin-deshmukh','+91 99999 10011','UG-C-105','','Director Operations','27AAFCE6634Q1Z0','customer','website',55,'user_21457956f010','2026-07-20'),
('40a5942a-56ed-5025-9492-6485d73ebb66','Pallavi Kulkarni','pallavi-kulkarni','+91 99999 10012','UG-C-105','','Finance Manager','','customer','event',62,'user_91601f25f601','2026-07-21'),
('1e9cfa61-597d-59a9-a34d-ab1d38d7f53a','Farhan Merchant','farhan-merchant','+91 99999 10013','UG-C-106','','Chief Executive','27AAGCF2907R1Z4','customer','referral',69,'user_76cd525348e1','2026-07-22'),
('3f16138f-2978-5e59-9c7f-272d50546bae','Zoya Merchant','zoya-merchant','+91 99999 10014','UG-C-106','','Head of Retail','','customer','website',76,'user_f798947b8a2e','2026-07-23'),
('313b2c96-d0e8-52c6-ae0b-08641de57582','Nikhil Rane','nikhil-rane','+91 99999 10015','UG-C-106','','Financial Controller','','customer','event',83,'user_fc914df642c3','2026-07-24'),
('f99552fc-c544-5924-8d19-1277b9b1e73e','Ganesh Pawar','ganesh-pawar','+91 99999 10016','UG-C-107','','Managing Director','27AAHCG4483S1ZP','customer','referral',90,'user_21457956f010','2026-07-25'),
('c643272c-2774-5330-b947-e0734aefed8f','Swati Jadhav','swati-jadhav','+91 99999 10017','UG-C-107','','Plant Accountant','','customer','website',42,'user_91601f25f601','2026-07-26'),
('38502fe3-96da-571c-82d8-650240196af8','Harshad Kamath','harshad-kamath','+91 99999 10018','UG-C-108','','Proprietor Director','29AAJCH9051T1ZI','customer','event',49,'user_76cd525348e1','2026-07-27'),
('c3122a8c-aa0b-5460-9e37-dcd889bcf3f6','Deepa Shenoy','deepa-shenoy','+91 99999 10019','UG-C-108','','Accounts Head','','customer','referral',56,'user_f798947b8a2e','2026-07-28'),
('9d4861ad-4654-51cf-a922-50e50b8f9c5e','Vivek Raghavan','vivek-raghavan','+91 99999 10020','UG-C-109','','Chief Financial Officer','29AAKCI1720U1ZU','customer','website',63,'user_fc914df642c3','2026-07-29'),
('73674382-5ed1-5691-a08b-bc046a5f0678','Ananya Iyer','ananya-iyer','+91 99999 10021','UG-C-109','','Financial Reporting Lead','','customer','event',70,'user_21457956f010','2026-07-20'),
('f1d5230b-c8b1-528b-8583-ef05ec5a86cb','Karthik Subramanian','karthik-subramanian','+91 99999 10022','UG-C-109','','VP Engineering','','customer','referral',77,'user_91601f25f601','2026-07-21'),
('8bfad819-500c-5491-9220-e047f4272a32','Jaywant Chauhan','jaywant-chauhan','+91 99999 10023','UG-C-110','','Managing Director','07AALCJ6395V1Z7','customer','website',84,'user_76cd525348e1','2026-07-22'),
('ec0dbedd-2507-5e7d-a95d-d68fc9e3a137','Ritu Malhotra','ritu-malhotra','+91 99999 10024','UG-C-110','','Compliance Manager','','customer','event',91,'user_f798947b8a2e','2026-07-23'),
('b3e589b3-94d8-58ba-a465-0e519489f5a2','Lalitha Krishnan','lalitha-krishnan','+91 99999 10025','UG-C-111','','Director Finance','33AAMCK3068W1ZK','customer','referral',43,'user_fc914df642c3','2026-07-24'),
('75b9b905-e2b1-5873-970a-9eb473bb7a09','Suresh Balan','suresh-balan','+91 99999 10026','UG-C-111','','Plant Head','','customer','website',50,'user_21457956f010','2026-07-25'),
('0c03d0ed-086c-5063-9f01-c026ff3d8072','Sanjay Reddy','sanjay-reddy','+91 99999 10027','UG-C-112','','Managing Partner','36AANFL8842X1ZW','customer','event',57,'user_91601f25f601','2026-07-26'),
('84116e86-b566-52e2-a119-1dfef00ba0e6','Padmini Rao','padmini-rao','+91 99999 10028','UG-C-112','','Head of Accounts','','customer','referral',64,'user_76cd525348e1','2026-07-27'),
('dbcbdae1-b898-5c6a-a3c7-72673421f6d1','Arjun Kondapalli','arjun-kondapalli','+91 99999 10029','UG-C-112','','Business Head','','customer','website',71,'user_f798947b8a2e','2026-07-28'),
('cc9ff30b-c3ef-5772-8994-5b19468cd960','Mahaveer Jain','mahaveer-jain','+91 99999 10030','UG-C-113','','Managing Director','08AAPCM5519Y1Z4','lead','event',78,'user_fc914df642c3','2026-07-29'),
('bde07a04-899a-5d1c-abe5-e8c1be8f8611','Nidhi Jain','nidhi-jain','+91 99999 10031','UG-C-113','','Head of Exports','','lead','referral',85,'user_21457956f010','2026-07-20'),
('aa7214e8-eb7b-524a-b848-9b30a3fb4b9c','Nandini Bose','nandini-bose','+91 99999 10032','UG-C-114','','Director','19AAQCN2274Z1ZZ','lead','website',92,'user_91601f25f601','2026-07-21'),
('66f75919-c24f-5384-9a11-6a6bf83100ec','Sourav Chatterjee','sourav-chatterjee','+91 99999 10033','UG-C-114','','Plant Manager','','lead','event',44,'user_76cd525348e1','2026-07-22'),
('80dbda84-23e7-5cd4-a5db-d1a45550289c','Omkar Yadav','omkar-yadav','+91 99999 10034','UG-C-115','','Chief Executive','06AARCO7736A1ZA','lead','referral',51,'user_f798947b8a2e','2026-07-23'),
('19d30cad-c0cf-5fb9-9800-2a5bbbebe131','Preeti Sehgal','preeti-sehgal','+91 99999 10035','UG-C-115','','Finance Lead','','lead','website',58,'user_fc914df642c3','2026-07-24'),
('f5b04951-5020-5d43-92e5-71f4cc1bb8dd','Vikram Ahluwalia','vikram-ahluwalia','+91 99999 10036','UG-C-115','','Sourcing Head','','lead','event',65,'user_21457956f010','2026-07-25'),
('71b7736a-598c-5f23-853b-9ccead6987d4','Pratham Agrawal','pratham-agrawal','+91 99999 10037','UG-C-116','','Founder Director','23AASCP4160B1ZM','lead','referral',72,'user_91601f25f601','2026-07-26'),
('bdbe0315-6325-5d28-b2d3-74f580448e54','Shruti Agrawal','shruti-agrawal','+91 99999 10038','UG-C-116','','Projects Head','','lead','website',79,'user_76cd525348e1','2026-07-27'),
('11b7359a-b3c0-5772-b39b-c64683cfb675','Rajeev Menon','rajeev-menon','+91 99999 10039','','Menon and Co','Partner, Menon and Co (referral partner)','','partner','event',86,'user_f798947b8a2e','2026-07-28'),
('5fd5ba10-ee0e-5737-9c7d-f02cd656d01c','Kiran Bhagat','kiran-bhagat','+91 99999 10040','','Bhagat Legal','Proprietor, Bhagat Legal (empanelled counsel)','','partner','referral',93,'user_fc914df642c3','2026-07-29'),
('1393f8b9-e8c8-59a0-9054-02946ba9f77c','Alpesh Chauhan','alpesh-chauhan','+91 99999 10041','','Sattva Facility Services','Director, Sattva Facility Services','','vendor','website',45,'user_21457956f010','2026-07-20'),
('97f2433b-78b5-5c4f-bf37-60d5a6895adc','Yogesh Trivedi','yogesh-trivedi','+91 99999 10042','','Rachana Print Solutions','Partner, Rachana Print Solutions','','vendor','event',52,'user_91601f25f601','2026-07-21')
) AS v(id, name, slug, phone, ref_no, company, desig, gstin, ctype, src, score, owner, touched)
LEFT JOIN staging.graha_clients c ON c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND c.ref_no = NULLIF(v.ref_no,'')
ON CONFLICT (id) DO NOTHING;

-- ── GRAHA — 21 deals across all six pipeline stages ─────────────────────
-- contact_id is the company's billing contact: within this seed that is the one
-- contact per company that carries the company's GSTIN.
INSERT INTO staging.graha_deals
      (id, org_id, pipeline_id, contact_id, title, value, currency, stage, probability,
       expected_close_date, assigned_to, notes, tags, won_at, lost_at, lost_reason,
       created_by, is_active, created_at, updated_at, client_id)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, '20b0afd4-5ffb-4181-a017-721833e4de5a'::uuid, pc.id, v.title, v.value::numeric, 'INR',
       v.stage, v.prob::int, v.close::date, v.owner, 'Seeded demo opportunity.',
       ARRAY['seed-demo'], NULLIF(v.won,'')::timestamptz, NULLIF(v.lost,'')::timestamptz, NULLIF(v.lreason,''),
       'user_91601f25f601', TRUE,
       '2026-01-12 09:30:00+05:30'::timestamptz, '2026-08-05 09:30:00+05:30'::timestamptz, c.id
FROM (VALUES
('9b4627e3-128e-5b59-820f-560b2992f2e4','FY 2026-27 statutory audit — Aarna Textile Mills','UG-C-101',145000,'Won',100,'2026-03-20','2026-03-18 16:00:00+05:30','','','user_21457956f010'),
('4f84f791-649f-5732-8f7a-97de2192c975','Virtual CFO retainer — Bhavya Infra','UG-C-102',900000,'Won',100,'2026-02-14','2026-02-12 15:30:00+05:30','','','user_91601f25f601'),
('d6b71a52-8c29-5c1d-bd30-7493cb2d4b10','Transfer pricing study FY 2025-26 — Chandrika Pharma','UG-C-103',185000,'Won',100,'2026-04-30','2026-04-28 11:15:00+05:30','','','user_76cd525348e1'),
('6ba72d26-adf6-51a9-902d-90f6fbabf831','Export incentive advisory — Dhruv Agro','UG-C-104',95000,'Won',100,'2026-05-22','2026-05-20 17:45:00+05:30','','','user_f798947b8a2e'),
('2634acde-a521-5a81-8a58-fd7414cb8e93','ERP implementation support — Indira Software Labs','UG-C-109',450000,'Won',100,'2026-06-26','2026-06-24 13:00:00+05:30','','','user_fc914df642c3'),
('52105fc2-6cf1-5c2e-bd23-15fa07d765f7','Group internal audit mandate — Firozi Retail','UG-C-106',380000,'Negotiation',70,'2026-09-15','','','','user_21457956f010'),
('7f79df4b-1121-5067-8695-bf2eafcdaa43','Business valuation for ESOP — Lakshya Media','UG-C-112',260000,'Negotiation',65,'2026-09-30','','','','user_91601f25f601'),
('37a81ddd-9f23-5def-8251-3bdb003318a3','Payroll outsourcing — 340 heads — Gokul Dairy','UG-C-107',216000,'Negotiation',60,'2026-10-10','','','','user_76cd525348e1'),
('16dec2cb-ec0b-5780-af0f-9b723ec7d3d2','Due diligence — Kaveri Chemicals acquisition target','UG-C-111',420000,'Proposal',45,'2026-10-25','','','','user_f798947b8a2e'),
('f3264d57-eece-56e4-b523-c38011b28971','FEMA advisory on FDI tranche — Jaywant Logistics','UG-C-110',175000,'Proposal',40,'2026-09-25','','','','user_fc914df642c3'),
('32aade36-32ab-57c6-b527-e31c2cd118c0','Annual compliance retainer — Harshad Electricals','UG-C-108',240000,'Proposal',40,'2026-11-05','','','','user_21457956f010'),
('b2215596-6b33-56e8-a710-54a2c23aedd9','Trademark portfolio — 9 marks — Mahaveer Gems','UG-C-113',126000,'Proposal',35,'2026-11-20','','','','user_91601f25f601'),
('5b6eba71-e339-5adb-b8ca-3813e6be01e3','Incorporation of manufacturing SPV — Omkar Auto','UG-C-115',88000,'Qualified',25,'2026-10-05','','','','user_76cd525348e1'),
('3160bf8a-959c-5279-aaba-529209cd9c4c','GST refund advisory — Nandini Packaging','UG-C-114',145000,'Qualified',25,'2026-11-15','','','','user_f798947b8a2e'),
('aafb3479-5927-5ea5-aeed-701873b54a7f','Cost audit readiness — Ekveera Engineering','UG-C-105',165000,'Qualified',20,'2026-12-05','','','','user_fc914df642c3'),
('ced3bf4b-59cb-5941-bd6e-cb6fe82072e6','Subsidy claim support — Pratham Solar','UG-C-116',210000,'Qualified',20,'2026-12-18','','','','user_21457956f010'),
('3e16f333-6ba7-58cb-9d6e-70da6590f5c0','Statutory registers digitisation — Aarna Textile Mills','UG-C-101',60000,'New',10,'2027-01-10','','','','user_91601f25f601'),
('5fec03ed-38b2-5d11-b6af-15e55ca31a94','Internal financial controls review — Bhavya Infra','UG-C-102',320000,'New',10,'2027-01-20','','','','user_76cd525348e1'),
('5571ffa1-543e-5ae9-96b0-2675b4420073','Secretarial audit — Gokul Dairy Foods','UG-C-107',95000,'New',10,'2027-02-05','','','','user_f798947b8a2e'),
('1518f777-e5f5-5462-a0c2-b2e46adab984','Ind AS transition support — Firozi Retail','UG-C-106',540000,'Lost',0,'2026-06-30','','2026-06-28 18:00:00+05:30','Awarded to the incumbent Big 4 auditor on price.','user_fc914df642c3'),
('6c002dfe-fbd6-52b1-a7de-d5535f6ffdfc','SAP add-on rollout — Jaywant Logistics','UG-C-110',380000,'Lost',0,'2026-05-29','','2026-05-27 12:30:00+05:30','Client deferred the capex to FY 2027-28.','user_21457956f010')
) AS v(id, title, ref_no, value, stage, prob, close, won, lost, lreason, owner)
JOIN staging.graha_clients c ON c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND c.ref_no = v.ref_no
JOIN staging.graha_contacts pc ON pc.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND pc.client_id = c.id AND pc.gstin <> ''
ON CONFLICT (id) DO NOTHING;

-- ── GRAHA — 21 activities ───────────────────────────────────────────────
INSERT INTO staging.graha_activities
      (id, org_id, deal_id, contact_id, activity_type, title, description,
       scheduled_at, completed_at, is_completed, created_by, created_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, d.id, d.contact_id, v.atype, v.title, 'Seeded demo activity.',
       v.when::timestamptz,
       CASE WHEN v.done THEN v.when::timestamptz END, v.done::boolean, v.owner,
       '2026-01-15 09:00:00+05:30'::timestamptz
FROM (VALUES
('1dca0265-079e-5eab-b89c-14b05c27ea73','9b4627e3-128e-5b59-820f-560b2992f2e4','call','Kick-off call — audit scope and timelines','2026-02-11 10:00:00+05:30',TRUE,'user_21457956f010'),
('0e8c0163-522e-56e5-b17a-39a8b3f374fc','9b4627e3-128e-5b59-820f-560b2992f2e4','meeting','Audit planning meeting at Pandesara plant','2026-02-25 11:30:00+05:30',TRUE,'user_91601f25f601'),
('257bb04d-dccf-5ba7-801c-4b8468528df6','4f84f791-649f-5732-8f7a-97de2192c975','email','Sent engagement letter for signature','2026-02-02 09:15:00+05:30',TRUE,'user_76cd525348e1'),
('db7b29e4-f167-546c-bb11-10a133854e86','4f84f791-649f-5732-8f7a-97de2192c975','meeting','Virtual CFO scope walkthrough','2026-02-09 15:00:00+05:30',TRUE,'user_f798947b8a2e'),
('62bcfcee-04e1-55c7-b461-068ac7c05ed1','d6b71a52-8c29-5c1d-bd30-7493cb2d4b10','call','Discussed benchmarking set for TP study','2026-04-08 16:30:00+05:30',TRUE,'user_fc914df642c3'),
('f6d43518-6651-5c8f-bd12-c0a31a70f116','d6b71a52-8c29-5c1d-bd30-7493cb2d4b10','note','Client shared FY25-26 related-party ledger','2026-04-15 12:00:00+05:30',TRUE,'user_21457956f010'),
('e8312c6e-1f5c-5168-ad17-e4bc4bee126a','6ba72d26-adf6-51a9-902d-90f6fbabf831','meeting','Export incentive workshop — Rajkot','2026-05-06 10:30:00+05:30',TRUE,'user_91601f25f601'),
('ea593e4d-84cd-544f-bb9c-af2eb73861dd','2634acde-a521-5a81-8a58-fd7414cb8e93','call','ERP cutover readiness review','2026-06-15 17:00:00+05:30',TRUE,'user_76cd525348e1'),
('8a28b385-1897-518a-a0bc-81034eb61690','2634acde-a521-5a81-8a58-fd7414cb8e93','email','Circulated ERP support SOW v3','2026-06-19 11:00:00+05:30',TRUE,'user_f798947b8a2e'),
('221f8dcd-faa6-5701-969b-e80c609cb26e','52105fc2-6cf1-5c2e-bd23-15fa07d765f7','meeting','Internal audit mandate — commercials','2026-08-04 14:00:00+05:30',TRUE,'user_fc914df642c3'),
('0f0fae39-4f31-546d-8640-d63a234d0986','52105fc2-6cf1-5c2e-bd23-15fa07d765f7','task','Prepare revised fee proposal for Firozi','2026-08-12 10:00:00+05:30',FALSE,'user_21457956f010'),
('705f84ba-1a26-5194-bc81-b79d32b7dc95','7f79df4b-1121-5067-8695-bf2eafcdaa43','call','ESOP valuation basis discussion','2026-08-03 16:00:00+05:30',TRUE,'user_91601f25f601'),
('89685156-f6ee-59bf-97c3-12954131724b','7f79df4b-1121-5067-8695-bf2eafcdaa43','task','Send valuation data request to Lakshya','2026-08-11 09:30:00+05:30',FALSE,'user_76cd525348e1'),
('c134aa7b-f112-5ef7-8c5f-73ceff7d1254','37a81ddd-9f23-5def-8251-3bdb003318a3','meeting','Payroll transition plan — 340 employees','2026-07-30 11:00:00+05:30',TRUE,'user_f798947b8a2e'),
('1be20609-fcf7-5d19-972b-9da9fa89eed4','37a81ddd-9f23-5def-8251-3bdb003318a3','task','Follow up on payroll SLA comments','2026-08-13 15:00:00+05:30',FALSE,'user_fc914df642c3'),
('a0b9606c-5a1b-504c-97f4-37e90661c94a','16dec2cb-ec0b-5780-af0f-9b723ec7d3d2','email','Due diligence proposal sent to Kaveri','2026-07-27 18:20:00+05:30',TRUE,'user_21457956f010'),
('5f6208b9-7583-5c9a-8b74-324daeb7d319','f3264d57-eece-56e4-b523-c38011b28971','call','FEMA tranche timelines — Jaywant','2026-07-21 12:15:00+05:30',TRUE,'user_91601f25f601'),
('9a8eaf99-e5ad-5f24-9985-6dd7a5086f9a','32aade36-32ab-57c6-b527-e31c2cd118c0','task','Draft compliance retainer for Harshad','2026-08-14 10:00:00+05:30',FALSE,'user_76cd525348e1'),
('c5312294-a0cf-5a16-9a56-bba3d58f848f','b2215596-6b33-56e8-a710-54a2c23aedd9','email','Trademark search report shared','2026-07-16 13:40:00+05:30',TRUE,'user_f798947b8a2e'),
('bef03753-1fe4-51c2-b35d-c965f2ee5176','5b6eba71-e339-5adb-b8ca-3813e6be01e3','note','Omkar deferred SPV decision to Q3 board','2026-07-09 17:30:00+05:30',TRUE,'user_fc914df642c3'),
('243a38d4-662c-581d-a91e-6d975982a51e','3160bf8a-959c-5279-aaba-529209cd9c4c','task','Schedule GST refund scoping call','2026-08-18 11:00:00+05:30',FALSE,'user_21457956f010')
) AS v(id, deal_id, atype, title, "when", done, owner)
JOIN staging.graha_deals d ON d.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND d.id = v.deal_id::uuid
ON CONFLICT (id) DO NOTHING;

-- ── GANIT / VIKRAY — 14 items on the price list ─────────────────────────
INSERT INTO staging.ganit_products
      (id, org_id, name, hsn_code, sac_code, unit, price, gst_rate, description,
       is_service, is_active, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.hsn, v.sac, v.unit, v.price::numeric, v.rate::numeric,
       'Seeded demo item.', v.svc::boolean, TRUE,
       '2026-01-02 09:00:00+05:30'::timestamptz, '2026-01-02 09:00:00+05:30'::timestamptz
FROM (VALUES
('e6ed943e-1046-54a3-a923-86ededf6e73d','Payroll Processing — monthly','','998222','NOS',18000,18,TRUE),
('dacecbe8-4e28-5263-89b1-4d30d52752f8','Internal Audit — quarterly','','998221','NOS',65000,18,TRUE),
('2f2eb9f4-4ada-52be-b49a-eeb3a45e52e2','Company Incorporation','','998231','NOS',22000,18,TRUE),
('144705fb-6f58-51e2-a75f-1a05c68b6fa6','Trademark Registration','','998591','NOS',14000,18,TRUE),
('8c718c21-380c-504c-bf0d-23165beeb6c5','Transfer Pricing Study','','998221','NOS',85000,18,TRUE),
('e909d44f-5aee-590f-9151-e6754244dc21','Financial Due Diligence Report','','998221','NOS',120000,18,TRUE),
('dda3d931-8931-5ccd-8e67-8f5acbb8589d','Virtual CFO Retainer — monthly','','998311','NOS',75000,18,TRUE),
('e3b1be80-fc63-5e12-90a6-9118f0b79ccb','FEMA and RBI Compliance','','998231','NOS',35000,18,TRUE),
('161a0662-6ec0-51da-8251-6a0982c6399c','Income Tax Return — Corporate','','998231','NOS',28000,18,TRUE),
('83f5dcab-6048-5f5e-8104-d12fca8eea04','Business Valuation Report','','998221','NOS',95000,18,TRUE),
('41e66284-0fa2-5a25-976e-9d5def8d9d7f','ERP Implementation Support','','998313','NOS',150000,18,TRUE),
('a0dd7e62-9fdf-5ca0-9111-d77db935f804','Accounting Software Licence — annual','','998434','NOS',48000,18,TRUE),
('4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7','Digital Signature Token — Class 3','84713090','','NOS',1500,18,FALSE),
('42bcaef5-227b-5b4e-a27f-72c991bfed16','Printed Statutory Registers — set','48201090','','SET',2400,12,FALSE)
) AS v(id, name, hsn, sac, unit, price, rate, svc)
ON CONFLICT (id) DO NOTHING;

-- ── GANIT — 37 tax invoices, INV-2026-0049 .. INV-2026-0085 ─────────────
-- Tax is derived, not typed: the supplier is registered in Gujarat (state code
-- 24), so a Gujarat place of supply splits CGST+SGST and every other state is IGST.
WITH items(doc, ord, pid, qty) AS (VALUES
('INV-2026-0049',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('INV-2026-0050',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0050',1,'4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7',2),
('INV-2026-0051',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('INV-2026-0052',0,'161a0662-6ec0-51da-8251-6a0982c6399c',1),
('INV-2026-0052',1,'42bcaef5-227b-5b4e-a27f-72c991bfed16',3),
('INV-2026-0053',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('INV-2026-0054',0,'8c718c21-380c-504c-bf0d-23165beeb6c5',1),
('INV-2026-0055',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0056',0,'e3b1be80-fc63-5e12-90a6-9118f0b79ccb',1),
('INV-2026-0057',0,'2f2eb9f4-4ada-52be-b49a-eeb3a45e52e2',1),
('INV-2026-0057',1,'4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7',1),
('INV-2026-0058',0,'161a0662-6ec0-51da-8251-6a0982c6399c',1),
('INV-2026-0059',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('INV-2026-0060',0,'83f5dcab-6048-5f5e-8104-d12fca8eea04',1),
('INV-2026-0061',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0062',0,'144705fb-6f58-51e2-a75f-1a05c68b6fa6',2),
('INV-2026-0063',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('INV-2026-0064',0,'41e66284-0fa2-5a25-976e-9d5def8d9d7f',1),
('INV-2026-0065',0,'e909d44f-5aee-590f-9151-e6754244dc21',1),
('INV-2026-0066',0,'a0dd7e62-9fdf-5ca0-9111-d77db935f804',1),
('INV-2026-0066',1,'42bcaef5-227b-5b4e-a27f-72c991bfed16',5),
('INV-2026-0067',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('INV-2026-0068',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0069',0,'83f5dcab-6048-5f5e-8104-d12fca8eea04',1),
('INV-2026-0070',0,'e3b1be80-fc63-5e12-90a6-9118f0b79ccb',1),
('INV-2026-0070',1,'4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7',1),
('INV-2026-0071',0,'144705fb-6f58-51e2-a75f-1a05c68b6fa6',1),
('INV-2026-0072',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('INV-2026-0073',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0074',0,'161a0662-6ec0-51da-8251-6a0982c6399c',1),
('INV-2026-0075',0,'8c718c21-380c-504c-bf0d-23165beeb6c5',1),
('INV-2026-0076',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('INV-2026-0077',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('INV-2026-0078',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0078',1,'42bcaef5-227b-5b4e-a27f-72c991bfed16',2),
('INV-2026-0079',0,'a0dd7e62-9fdf-5ca0-9111-d77db935f804',1),
('INV-2026-0080',0,'2f2eb9f4-4ada-52be-b49a-eeb3a45e52e2',1),
('INV-2026-0080',1,'4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7',3),
('INV-2026-0081',0,'e909d44f-5aee-590f-9151-e6754244dc21',1),
('INV-2026-0082',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',1),
('INV-2026-0083',0,'41e66284-0fa2-5a25-976e-9d5def8d9d7f',1),
('INV-2026-0084',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('INV-2026-0085',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('INV-2026-0085',1,'42bcaef5-227b-5b4e-a27f-72c991bfed16',4)
),
li AS (
  SELECT i.doc,
         jsonb_agg(jsonb_build_object(
           'product_id', p.id::text, 'description', p.name, 'hsn_code', p.hsn_code,
           'sac_code', p.sac_code, 'unit', p.unit, 'quantity', i.qty,
           'rate', p.price, 'discount_pct', 0, 'gst_rate', p.gst_rate,
           'line_total', round(p.price * i.qty, 2),
           'gst_amount', round(p.price * i.qty * p.gst_rate / 100, 2)
         ) ORDER BY i.ord) AS line_items,
         sum(round(p.price * i.qty, 2))                        AS subtotal,
         sum(round(p.price * i.qty * p.gst_rate / 100, 2))     AS gst,
         string_agg(p.name, '; ' ORDER BY i.ord)               AS scope
  FROM items i
  JOIN staging.ganit_products p ON p.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND p.id = i.pid::uuid
  GROUP BY i.doc
)
INSERT INTO staging.ganit_invoices
      (id, org_id, contact_id, client_id, invoice_number, invoice_type, invoice_date, due_date,
       place_of_supply, is_igst, line_items, subtotal, cgst, sgst, igst, cess, discount, total,
       amount_paid, balance_due, payment_status, notes, terms, created_by, is_active,
       created_at, updated_at, doc_status, sent_at, currency, exchange_rate, is_export,
       supply_nature, prepared_by, scope_summary)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, pc.id, c.id, v.num, 'tax_invoice', v.idate::date,
       (v.idate::date + v.credit::int), c.address->>'state',
       (c.address->>'state_code') <> '24', li.line_items, li.subtotal,
       CASE WHEN (c.address->>'state_code')='24' THEN round(li.gst/2,2) ELSE 0 END,
       CASE WHEN (c.address->>'state_code')='24' THEN li.gst - round(li.gst/2,2) ELSE 0 END,
       CASE WHEN (c.address->>'state_code')='24' THEN 0 ELSE li.gst END,
       0, 0, li.subtotal + li.gst,
       CASE v.status WHEN 'paid'    THEN li.subtotal + li.gst
                     WHEN 'partial' THEN round((li.subtotal + li.gst) * 0.4, 2)
                     ELSE 0 END,
       CASE v.status WHEN 'paid'    THEN 0
                     WHEN 'partial' THEN (li.subtotal + li.gst) - round((li.subtotal + li.gst) * 0.4, 2)
                     ELSE li.subtotal + li.gst END,
       CASE v.status WHEN 'paid' THEN 'paid' WHEN 'partial' THEN 'partial' ELSE 'unpaid' END,
       'Seeded demo invoice.',
       'Payment due within '||v.credit||' days. Interest at 18% p.a. on overdue amounts.',
       v.owner, TRUE, v.created::timestamptz, v.created::timestamptz, 'final',
       (v.idate||' 18:00:00+05:30')::timestamptz, 'INR', 1.0000, FALSE, 'taxable', v.owner, li.scope
FROM (VALUES
('bee84676-6672-5eee-a696-584444ed1b46','INV-2026-0049','UG-C-101','2026-01-08',30,'paid','user_21457956f010','2026-08-05 09:00:00+05:30'),
('6d6ebb27-f4ae-522f-849e-f1f577b89c28','INV-2026-0050','UG-C-105','2026-01-14',30,'paid','user_91601f25f601','2026-08-05 09:01:00+05:30'),
('4f9ff86e-2103-567a-9a17-9942e0cc4f5a','INV-2026-0051','UG-C-109','2026-01-21',15,'paid','user_76cd525348e1','2026-08-05 09:02:00+05:30'),
('c6461e1e-521b-52b9-9c00-2bc77f543298','INV-2026-0052','UG-C-111','2026-01-28',45,'paid','user_f798947b8a2e','2026-08-05 09:03:00+05:30'),
('0fb50fce-69f3-57ba-906e-76c2393780db','INV-2026-0053','UG-C-102','2026-02-05',15,'paid','user_fc914df642c3','2026-08-05 09:04:00+05:30'),
('42139351-7ab0-5fcc-aba6-1f6b79928d58','INV-2026-0054','UG-C-106','2026-02-11',30,'paid','user_21457956f010','2026-08-05 09:05:00+05:30'),
('78a42ac7-9557-59f2-876f-2b5181d41ead','INV-2026-0055','UG-C-103','2026-02-17',30,'paid','user_91601f25f601','2026-08-05 09:06:00+05:30'),
('2aab9890-36ac-5976-b28b-421af2650f2d','INV-2026-0056','UG-C-112','2026-02-23',30,'paid','user_76cd525348e1','2026-08-05 09:07:00+05:30'),
('54cc823c-ce82-575a-810a-88ed85b499e6','INV-2026-0057','UG-C-107','2026-02-27',30,'paid','user_f798947b8a2e','2026-08-05 09:08:00+05:30'),
('f4976a4d-c927-5855-9c37-b05c89e3b2da','INV-2026-0058','UG-C-104','2026-03-04',30,'paid','user_fc914df642c3','2026-08-05 09:09:00+05:30'),
('2b5b1d43-7358-5e4f-86a5-4734b9b0be63','INV-2026-0059','UG-C-110','2026-03-10',45,'paid','user_21457956f010','2026-08-05 09:10:00+05:30'),
('338a7512-3827-5904-859e-f1b3064446f0','INV-2026-0060','UG-C-108','2026-03-16',30,'paid','user_91601f25f601','2026-08-05 09:11:00+05:30'),
('5f44cf0d-5b28-5db6-a274-eca65a92e751','INV-2026-0061','UG-C-101','2026-03-24',30,'paid','user_76cd525348e1','2026-08-05 09:12:00+05:30'),
('754ee89c-bdaf-51b2-9324-3b135d52f154','INV-2026-0062','UG-C-105','2026-03-30',15,'unpaid','user_f798947b8a2e','2026-08-05 09:13:00+05:30'),
('5173d13f-9ea2-5947-8c51-4d4c77167660','INV-2026-0063','UG-C-102','2026-04-06',15,'paid','user_fc914df642c3','2026-08-05 09:14:00+05:30'),
('1b8aebe2-2442-561e-8093-db1792490242','INV-2026-0064','UG-C-109','2026-04-13',45,'paid','user_21457956f010','2026-08-05 09:15:00+05:30'),
('35385869-392d-58d8-bc4a-89af6d6e49f9','INV-2026-0065','UG-C-106','2026-04-20',30,'partial','user_91601f25f601','2026-08-05 09:16:00+05:30'),
('fd82ca37-f6bd-5317-956e-0c04041e1b46','INV-2026-0066','UG-C-111','2026-04-24',26,'unpaid','user_76cd525348e1','2026-08-05 09:17:00+05:30'),
('61e3c89b-98d1-5a7d-ab57-346e62eca16b','INV-2026-0067','UG-C-103','2026-04-29',30,'paid','user_f798947b8a2e','2026-08-05 09:18:00+05:30'),
('2ae75a71-c08b-5e85-9c67-0773761f37ae','INV-2026-0068','UG-C-107','2026-05-07',30,'paid','user_fc914df642c3','2026-08-05 09:19:00+05:30'),
('c1f3eeeb-6b38-5230-998d-9c7f8e1fc36d','INV-2026-0069','UG-C-112','2026-05-12',30,'partial','user_21457956f010','2026-08-05 09:20:00+05:30'),
('3325df1c-1a9e-54f3-abbc-259b8990c7ea','INV-2026-0070','UG-C-104','2026-05-18',30,'paid','user_91601f25f601','2026-08-05 09:21:00+05:30'),
('c23952e9-c57b-5568-8a57-95e517a0422b','INV-2026-0071','UG-C-110','2026-05-21',15,'unpaid','user_76cd525348e1','2026-08-05 09:22:00+05:30'),
('f97d29a3-b13d-5157-817a-467a70838ef6','INV-2026-0072','UG-C-101','2026-05-26',15,'paid','user_f798947b8a2e','2026-08-05 09:23:00+05:30'),
('c8a93ce4-8981-5b1e-a55f-163606b5d7e2','INV-2026-0073','UG-C-108','2026-06-03',30,'paid','user_fc914df642c3','2026-08-05 09:24:00+05:30'),
('eef3b23c-317a-5cbd-b09c-aced7b4f8718','INV-2026-0074','UG-C-105','2026-06-09',30,'partial','user_21457956f010','2026-08-05 09:25:00+05:30'),
('c52599d9-23a1-512f-966b-cfb4bdd88179','INV-2026-0075','UG-C-102','2026-06-15',30,'paid','user_91601f25f601','2026-08-05 09:26:00+05:30'),
('6634df79-9525-5439-bb2f-398f59e0e8e4','INV-2026-0076','UG-C-109','2026-06-22',15,'paid','user_76cd525348e1','2026-08-05 09:27:00+05:30'),
('42623d0a-734e-5db3-b21e-6945c0539af8','INV-2026-0077','UG-C-111','2026-06-27',10,'unpaid','user_f798947b8a2e','2026-08-05 09:28:00+05:30'),
('3146873c-70a7-5540-a742-f7fcf0a650af','INV-2026-0078','UG-C-106','2026-07-02',30,'paid','user_fc914df642c3','2026-08-05 09:29:00+05:30'),
('4194f333-5129-5616-a0a9-99dd172568b6','INV-2026-0079','UG-C-103','2026-07-07',30,'partial','user_21457956f010','2026-08-05 09:30:00+05:30'),
('0c6503a7-3924-56e3-994c-f5829cd58544','INV-2026-0080','UG-C-112','2026-07-13',30,'paid','user_91601f25f601','2026-08-05 09:31:00+05:30'),
('cb849a54-5aa2-5193-80b6-72b0689063e9','INV-2026-0081','UG-C-110','2026-07-18',15,'unpaid','user_76cd525348e1','2026-08-05 09:32:00+05:30'),
('f6a670f8-8bcd-5c83-8f04-1b4355f7086d','INV-2026-0082','UG-C-104','2026-07-23',8,'unpaid','user_f798947b8a2e','2026-08-05 09:33:00+05:30'),
('2448f53b-9c7e-5502-9620-ced117b15eb1','INV-2026-0083','UG-C-107','2026-07-29',30,'partial','user_fc914df642c3','2026-08-05 09:34:00+05:30'),
('eaad0d8b-538b-54e3-911c-929eff7e9919','INV-2026-0084','UG-C-108','2026-08-03',22,'unpaid','user_21457956f010','2026-08-05 09:35:00+05:30'),
('1a7528c1-465d-559d-8765-f1b3a72883fe','INV-2026-0085','UG-C-101','2026-08-04',30,'unpaid','user_91601f25f601','2026-08-05 09:36:00+05:30')
) AS v(id, num, ref_no, idate, credit, status, owner, created)
JOIN li ON li.doc = v.num
JOIN staging.graha_clients c ON c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND c.ref_no = v.ref_no
JOIN staging.graha_contacts pc ON pc.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND pc.client_id = c.id AND pc.gstin <> ''
ON CONFLICT (org_id, invoice_number) DO NOTHING;

-- ── GANIT — one receipt per settled invoice (derived from the invoices above) 
-- An invoice marked paid with no receipt behind it makes the payments screen
-- contradict the ageing screen, so the receipts are generated from the invoices
-- rather than typed: every invoice in this seed with amount_paid > 0 gets one.
-- The id is md5('payment:'||invoice_number)::uuid, so a re-run is a no-op.
INSERT INTO staging.ganit_payments
      (id, org_id, invoice_id, amount, payment_date, payment_method, reference, notes,
       recorded_by, created_at)
SELECT md5('payment:'||i.invoice_number)::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, i.id, i.amount_paid,
       LEAST(CASE WHEN i.balance_due = 0 THEN i.due_date - 3
                  ELSE i.invoice_date + 12 END, DATE '2026-08-05'),
       (ARRAY['bank_transfer','upi','cheque','bank_transfer','bank_transfer'])
         [1 + (right(i.invoice_number,4)::int % 5)],
       'UTR'||(760000000000 + right(i.invoice_number,4)::int * 137)::text,
       CASE WHEN i.balance_due = 0 THEN 'Full settlement of '||i.invoice_number||'.'
            ELSE 'Part payment against '||i.invoice_number||'.' END,
       'user_76cd525348e1',
       (LEAST(CASE WHEN i.balance_due = 0 THEN i.due_date - 3
                   ELSE i.invoice_date + 12 END, DATE '2026-08-05')||' 12:00:00+05:30')::timestamptz
FROM staging.ganit_invoices i
WHERE i.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
  AND i.invoice_number >= 'INV-2026-0049' AND i.invoice_number <= 'INV-2026-0085'
  AND i.amount_paid > 0
ON CONFLICT (id) DO NOTHING;

-- ── GANIT — 20 expenses ─────────────────────────────────────────────────
INSERT INTO staging.ganit_expenses
      (id, org_id, title, category, amount, tax_amount, total, expense_date, vendor,
       reference, notes, is_billable, created_by, is_active, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.title, v.cat, v.amt::numeric, v.tax::numeric,
       (v.amt::numeric + v.tax::numeric), v.edate::date, v.vendor, v.ref,
       'Seeded demo expense.', FALSE, 'user_76cd525348e1', TRUE,
       (v.edate||' 17:00:00+05:30')::timestamptz, (v.edate||' 17:00:00+05:30')::timestamptz
FROM (VALUES
('59441c3e-092f-5689-9546-20a22deed046','Office rent — Ratnaakar Nine Square (January)','Rent',185000,0,'2026-01-05','Shreeji Estate Holdings','EXP-2026-0001'),
('d234e691-9155-5630-9275-d7dd58f10579','Broadband and leased line — Q4 FY26','Communication',28500,5130,'2026-01-18','Nimbus Cloud Hosting Pvt Ltd','EXP-2026-0002'),
('5ed547e0-fd37-5165-99ee-398d2e809f9a','Staff welfare — annual day','Meals',64200,0,'2026-01-24','Vayu Travels Pvt Ltd','EXP-2026-0003'),
('fda89b2a-6bc1-5a6a-b464-673bcfedcf92','Office rent — Ratnaakar Nine Square (February)','Rent',185000,0,'2026-02-05','Shreeji Estate Holdings','EXP-2026-0004'),
('146f0fac-8196-545f-bc0e-41b8f8b2e5e4','Audit software subscription — annual','Software',142000,25560,'2026-02-12','Nimbus Cloud Hosting Pvt Ltd','EXP-2026-0005'),
('2b998567-94fa-54ae-a16e-42d3191e33b8','Printing — statutory registers stock','Office Supplies',18400,2208,'2026-02-20','Rachana Print Solutions','EXP-2026-0006'),
('9f25ad65-c607-59a7-97e1-28c7fd1938c5','Office rent — Ratnaakar Nine Square (March)','Rent',185000,0,'2026-03-05','Shreeji Estate Holdings','EXP-2026-0007'),
('58d397f6-d1e3-5d54-9383-790732845f8a','Travel — Mumbai client visits (3 trips)','Travel',47800,2390,'2026-03-14','Vayu Travels Pvt Ltd','EXP-2026-0008'),
('83fa7461-2258-51bc-926b-08143a43702f','Electricity — Torrent Power (Feb billing)','Utilities',36900,0,'2026-03-22','Torrent Power Ltd','EXP-2026-0009'),
('39df1e59-4be7-5d24-bfde-7911c8557df3','Office rent — Ratnaakar Nine Square (April)','Rent',185000,0,'2026-04-06','Shreeji Estate Holdings','EXP-2026-0010'),
('8f440651-36dd-56cc-adc0-f1134ef38291','Legal opinion — related party disclosures','Professional Fees',75000,13500,'2026-04-17','Prayas Legal Advisors LLP','EXP-2026-0011'),
('5c45c2b0-2885-5d0e-938c-e6da59324a63','Housekeeping and facility — Q1 FY27','Utilities',58500,10530,'2026-04-28','Sattva Facility Services Pvt Ltd','EXP-2026-0012'),
('858dcc17-a140-5995-8163-c2a63df145ee','Office rent — Ratnaakar Nine Square (May)','Rent',185000,0,'2026-05-05','Shreeji Estate Holdings','EXP-2026-0013'),
('141cf892-f0ea-548e-9389-33138aa623d0','LinkedIn and Google campaigns — May','Marketing',92000,16560,'2026-05-19','Lakshya Media Networks LLP','EXP-2026-0014'),
('c06afcbd-fef7-59ef-83c7-e8113bf0a71f','Laptop refresh — 4 units','Office Supplies',268000,48240,'2026-05-27','Meridian IT Services','EXP-2026-0015'),
('16013ecb-1613-5e9d-a9b7-8332acd02d08','Office rent — Ratnaakar Nine Square (June)','Rent',185000,0,'2026-06-05','Shreeji Estate Holdings','EXP-2026-0016'),
('4037a399-0853-55d2-9828-623ab961f938','Travel — Bengaluru ERP go-live','Travel',63400,3170,'2026-06-18','Vayu Travels Pvt Ltd','EXP-2026-0017'),
('6b3926d9-694e-55a9-b9da-533f2d816878','Office rent — Ratnaakar Nine Square (July)','Rent',185000,0,'2026-07-06','Shreeji Estate Holdings','EXP-2026-0018'),
('f5153aea-a175-5f57-b83f-65960272e080','Conference room refurbishment','Miscellaneous',124000,22320,'2026-07-21','Tejas Office Interiors Pvt Ltd','EXP-2026-0019'),
('b0c18582-540b-52cf-ad2b-0f1fd97118d5','Office rent — Ratnaakar Nine Square (August)','Rent',185000,0,'2026-08-05','Shreeji Estate Holdings','EXP-2026-0020')
) AS v(id, title, cat, amt, tax, edate, vendor, ref)
ON CONFLICT (id) DO NOTHING;

-- ── GANIT — 6 vendors, so every bill below has a payee ──────────────────
INSERT INTO staging.ganit_vendors
      (id, org_id, name, gstin, email, phone, address, is_active, created_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.gstin,
       'success+'||v.slug||'@simulator.amazonses.com', v.phone,
       jsonb_build_object('line1','Seeded demo address','city',v.city,'state',v.state,
                          'state_code',v.sc,'pincode',v.pin,'country','India'),
       TRUE, '2026-01-03 10:00:00+05:30'::timestamptz
FROM (VALUES
('c1acf531-f656-5a23-96a6-9b789ffd4855','Rachana Print Solutions','24AAUFR3325C1ZB','rachana-print-solutions','+91 99999 2100','Ahmedabad','Gujarat','24','380009'),
('e015d5db-f38b-5073-b731-6872521df6d9','Sattva Facility Services Pvt Ltd','24AAVCS6641D1Z4','sattva-facility-services-pvt-ltd','+91 99999 2101','Ahmedabad','Gujarat','24','380015'),
('2ebed24d-7c72-5d70-9113-8ef9c905ab17','Nimbus Cloud Hosting Pvt Ltd','29AAWCN9107E1ZX','nimbus-cloud-hosting-pvt-ltd','+91 99999 2102','Bengaluru','Karnataka','29','560066'),
('fe3af757-5629-55c8-8ac6-4bc34a780904','Prayas Legal Advisors LLP','27AAXFP4472F1ZO','prayas-legal-advisors-llp','+91 99999 2103','Mumbai','Maharashtra','27','400021'),
('6d6ce1ed-543b-5278-a6b8-c17228944d8c','Vayu Travels Pvt Ltd','24AAYCV1858G1ZR','vayu-travels-pvt-ltd','+91 99999 2104','Ahmedabad','Gujarat','24','380006'),
('79619af2-1c8b-52d8-81f8-1a5e1706929b','Tejas Office Interiors Pvt Ltd','24AAZCT7284H1ZI','tejas-office-interiors-pvt-ltd','+91 99999 2105','Gandhinagar','Gujarat','24','382010')
) AS v(id, name, gstin, slug, phone, city, state, sc, pin)
ON CONFLICT (id) DO NOTHING;

-- ── GANIT — 14 purchase invoices, VB-2026-0007 .. VB-2026-0020 ──────────
-- Input tax follows the VENDOR's state: a Gujarat vendor bills CGST+SGST, an
-- out-of-state vendor bills IGST. That is what makes the ITC side of GSTR-3B
-- have two columns to show.
INSERT INTO staging.ganit_vendor_bills
      (id, org_id, vendor_id, bill_number, internal_ref, bill_date, due_date, line_items,
       subtotal, cgst, sgst, igst, cess, total, amount_paid, status, notes, created_by,
       is_active, created_at, currency, exchange_rate, is_reverse_charge)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, ven.id, v.bnum, v.ref, v.bdate::date, v.bdate::date + 30,
       jsonb_build_array(jsonb_build_object(
         'description', v.descr, 'quantity', 1, 'rate', v.base::numeric,
         'gst_rate', v.rate::numeric, 'line_total', v.base::numeric,
         'gst_amount', round(v.base::numeric * v.rate::numeric / 100, 2))),
       v.base::numeric,
       CASE WHEN (ven.address->>'state_code')='24' THEN round(round(v.base::numeric*v.rate::numeric/100,2)/2,2) ELSE 0 END,
       CASE WHEN (ven.address->>'state_code')='24' THEN round(v.base::numeric*v.rate::numeric/100,2) - round(round(v.base::numeric*v.rate::numeric/100,2)/2,2) ELSE 0 END,
       CASE WHEN (ven.address->>'state_code')='24' THEN 0 ELSE round(v.base::numeric*v.rate::numeric/100,2) END,
       0,
       v.base::numeric + round(v.base::numeric*v.rate::numeric/100,2),
       CASE v.status
         WHEN 'paid'           THEN v.base::numeric + round(v.base::numeric*v.rate::numeric/100,2)
         WHEN 'partially_paid' THEN round((v.base::numeric + round(v.base::numeric*v.rate::numeric/100,2))*0.5,2)
         ELSE 0 END,
       v.status, 'Seeded demo purchase invoice.', 'user_76cd525348e1', TRUE,
       v.created::timestamptz, 'INR', 1.0000, FALSE
FROM (VALUES
('b6b938b9-c2a7-5c23-a22c-89631fa03929','VB-2026-0007','c1acf531-f656-5a23-96a6-9b789ffd4855','RPS/26-27/0141','2026-01-16',42000,18,'paid','Client report printing and binding','2026-08-05 14:00:00+05:30'),
('fe91c0cd-dbab-5a6f-8c62-397edffdf081','VB-2026-0008','e015d5db-f38b-5073-b731-6872521df6d9','SFS/2026/0088','2026-02-02',58500,18,'paid','Housekeeping — Q4 FY26','2026-08-05 14:01:00+05:30'),
('86cd0aa8-1b9d-5707-b04e-1ead01437231','VB-2026-0009','2ebed24d-7c72-5d70-9113-8ef9c905ab17','NCH-2026-0312','2026-02-19',118000,18,'paid','Private cloud and backup — annual','2026-08-05 14:02:00+05:30'),
('0a511e70-1a0e-556d-b695-4a93c6d5283c','VB-2026-0010','fe3af757-5629-55c8-8ac6-4bc34a780904','PLA/26/0074','2026-03-11',90000,18,'paid','Retainer — corporate advisory','2026-08-05 14:03:00+05:30'),
('c4f85241-66f6-5d02-ad5c-5b79532c2b10','VB-2026-0011','6d6ce1ed-543b-5278-a6b8-c17228944d8c','VTP/2026/1177','2026-03-27',64500,5,'paid','Air travel — March','2026-08-05 14:04:00+05:30'),
('c10c2c07-801c-5ce1-89a2-32c90be506a9','VB-2026-0012','79619af2-1c8b-52d8-81f8-1a5e1706929b','TOI/26-27/0019','2026-04-14',215000,18,'partially_paid','Conference room fit-out — phase 1','2026-08-05 14:05:00+05:30'),
('18159c13-d175-5273-918d-a9c09fb17711','VB-2026-0013','c1acf531-f656-5a23-96a6-9b789ffd4855','RPS/26-27/0208','2026-04-29',26800,12,'paid','Statutory register sets','2026-08-05 14:06:00+05:30'),
('c68b7c54-d430-53a9-b505-5ba372ecae33','VB-2026-0014','e015d5db-f38b-5073-b731-6872521df6d9','SFS/2026/0131','2026-05-06',58500,18,'paid','Housekeeping — Q1 FY27','2026-08-05 14:07:00+05:30'),
('6eb7dde8-fd02-57eb-85be-8cd12ea87fe6','VB-2026-0015','2ebed24d-7c72-5d70-9113-8ef9c905ab17','NCH-2026-0455','2026-05-23',46000,18,'unpaid','Additional storage and egress','2026-08-05 14:08:00+05:30'),
('84501eb8-cc7b-53a1-8787-6b189ef33c6d','VB-2026-0016','fe3af757-5629-55c8-8ac6-4bc34a780904','PLA/26/0119','2026-06-09',135000,18,'partially_paid','Opinion — cross-border royalty','2026-08-05 14:09:00+05:30'),
('707c2033-2f25-54d8-b108-c3a1bf3fcfda','VB-2026-0017','6d6ce1ed-543b-5278-a6b8-c17228944d8c','VTP/2026/1364','2026-06-24',51200,5,'paid','Air travel — June','2026-08-05 14:10:00+05:30'),
('253f4dff-73ba-5fc9-a20e-981f65c020c6','VB-2026-0018','79619af2-1c8b-52d8-81f8-1a5e1706929b','TOI/26-27/0061','2026-07-08',148000,18,'unpaid','Conference room fit-out — phase 2','2026-08-05 14:11:00+05:30'),
('355b2a7d-48d0-5037-bf25-fa09b90d330d','VB-2026-0019','e015d5db-f38b-5073-b731-6872521df6d9','SFS/2026/0176','2026-07-27',58500,18,'unpaid','Housekeeping — Q2 FY27','2026-08-05 14:12:00+05:30'),
('695a9fac-dfd6-554c-b0aa-80664b540752','VB-2026-0020','2ebed24d-7c72-5d70-9113-8ef9c905ab17','NCH-2026-0603','2026-08-04',39000,18,'unpaid','Disaster-recovery region add-on','2026-08-05 14:13:00+05:30')
) AS v(id, ref, vendor_id, bnum, bdate, base, rate, status, descr, created)
JOIN staging.ganit_vendors ven ON ven.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND ven.id = v.vendor_id::uuid
ON CONFLICT (id) DO NOTHING;

-- ── VIKRAY — 22 sales orders, SO-2026-0036 .. SO-2026-0057 ──────────────
WITH items(doc, ord, pid, qty) AS (VALUES
('SO-2026-0036',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('SO-2026-0037',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',3),
('SO-2026-0038',0,'41e66284-0fa2-5a25-976e-9d5def8d9d7f',1),
('SO-2026-0039',0,'161a0662-6ec0-51da-8251-6a0982c6399c',1),
('SO-2026-0039',1,'42bcaef5-227b-5b4e-a27f-72c991bfed16',5),
('SO-2026-0040',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',3),
('SO-2026-0041',0,'8c718c21-380c-504c-bf0d-23165beeb6c5',1),
('SO-2026-0042',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',6),
('SO-2026-0043',0,'e3b1be80-fc63-5e12-90a6-9118f0b79ccb',1),
('SO-2026-0044',0,'2f2eb9f4-4ada-52be-b49a-eeb3a45e52e2',1),
('SO-2026-0044',1,'4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7',2),
('SO-2026-0045',0,'161a0662-6ec0-51da-8251-6a0982c6399c',1),
('SO-2026-0046',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('SO-2026-0047',0,'83f5dcab-6048-5f5e-8104-d12fca8eea04',1),
('SO-2026-0048',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',3),
('SO-2026-0049',0,'144705fb-6f58-51e2-a75f-1a05c68b6fa6',2),
('SO-2026-0050',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',3),
('SO-2026-0051',0,'a0dd7e62-9fdf-5ca0-9111-d77db935f804',1),
('SO-2026-0052',0,'e909d44f-5aee-590f-9151-e6754244dc21',1),
('SO-2026-0053',0,'a0dd7e62-9fdf-5ca0-9111-d77db935f804',1),
('SO-2026-0053',1,'42bcaef5-227b-5b4e-a27f-72c991bfed16',10),
('SO-2026-0054',0,'dacecbe8-4e28-5263-89b1-4d30d52752f8',1),
('SO-2026-0055',0,'e6ed943e-1046-54a3-a923-86ededf6e73d',3),
('SO-2026-0056',0,'83f5dcab-6048-5f5e-8104-d12fca8eea04',1),
('SO-2026-0057',0,'dda3d931-8931-5ccd-8e67-8f5acbb8589d',1),
('SO-2026-0057',1,'4bbfa450-5fb1-5c7e-a181-5a2d1bc4aeb7',4)
),
li AS (
  SELECT i.doc,
         jsonb_agg(jsonb_build_object(
           'product_id', p.id::text, 'description', p.name, 'hsn_code', p.hsn_code,
           'sac_code', p.sac_code, 'unit', p.unit, 'quantity', i.qty,
           'rate', p.price, 'discount_pct', 0, 'gst_rate', p.gst_rate,
           'line_total', round(p.price * i.qty, 2),
           'gst_amount', round(p.price * i.qty * p.gst_rate / 100, 2)
         ) ORDER BY i.ord) AS line_items,
         sum(round(p.price * i.qty, 2))                        AS subtotal,
         sum(round(p.price * i.qty * p.gst_rate / 100, 2))     AS gst,
         string_agg(p.name, '; ' ORDER BY i.ord)               AS scope
  FROM items i
  JOIN staging.ganit_products p ON p.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND p.id = i.pid::uuid
  GROUP BY i.doc
)
INSERT INTO staging.vikray_orders
      (id, org_id, contact_id, order_number, order_date, expected_delivery, line_items,
       subtotal, cgst, sgst, igst, discount, total, is_igst, status, shipping_address,
       notes, created_by, is_active, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, pc.id, v.num, v.odate::date, v.odate::date + 21, li.line_items,
       li.subtotal,
       CASE WHEN (c.address->>'state_code')='24' THEN round(li.gst/2,2) ELSE 0 END,
       CASE WHEN (c.address->>'state_code')='24' THEN li.gst - round(li.gst/2,2) ELSE 0 END,
       CASE WHEN (c.address->>'state_code')='24' THEN 0 ELSE li.gst END,
       0, li.subtotal + li.gst, (c.address->>'state_code') <> '24', v.status, c.address,
       'Seeded demo order.', v.owner, TRUE, v.created::timestamptz, v.created::timestamptz
FROM (VALUES
('f0409111-acac-57fd-92a6-554a4a7c7adf','SO-2026-0036','UG-C-101','2026-02-07','closed','user_21457956f010','2026-08-31 09:00:00+05:30'),
('754e81e1-af8f-5757-b20f-8afb72b3764f','SO-2026-0037','UG-C-105','2026-02-13','closed','user_91601f25f601','2026-08-31 09:01:00+05:30'),
('f5514ec6-f9b9-5bf5-b263-6a645456eb00','SO-2026-0038','UG-C-109','2026-02-20','closed','user_76cd525348e1','2026-08-31 09:02:00+05:30'),
('45a0b4e0-c7a5-598b-81be-d1170755b7d0','SO-2026-0039','UG-C-111','2026-02-26','closed','user_f798947b8a2e','2026-08-31 09:03:00+05:30'),
('3de299b4-cf19-533b-8b78-6ba47d917e56','SO-2026-0040','UG-C-102','2026-03-05','closed','user_fc914df642c3','2026-08-31 09:04:00+05:30'),
('ddb7a816-b896-5244-9faa-0a4504b5866b','SO-2026-0041','UG-C-106','2026-03-12','closed','user_21457956f010','2026-08-31 09:05:00+05:30'),
('f65e4abf-5421-5587-a46a-26061a9f8156','SO-2026-0042','UG-C-103','2026-03-19','closed','user_91601f25f601','2026-08-31 09:06:00+05:30'),
('f7941011-73ea-5be3-b064-8debfaceee64','SO-2026-0043','UG-C-112','2026-03-27','delivered','user_76cd525348e1','2026-08-31 09:07:00+05:30'),
('30070746-4286-5c7a-9865-66c2ccbbe180','SO-2026-0044','UG-C-107','2026-04-03','delivered','user_f798947b8a2e','2026-08-31 09:08:00+05:30'),
('b21b81e3-3f20-5385-8eea-b3658456aace','SO-2026-0045','UG-C-104','2026-04-11','delivered','user_fc914df642c3','2026-08-31 09:09:00+05:30'),
('4fc68c32-a6b6-57b6-9335-5dbd685c3d6a','SO-2026-0046','UG-C-110','2026-04-18','delivered','user_21457956f010','2026-08-31 09:10:00+05:30'),
('fe94ae6a-e411-5b51-88c8-1b67d5f026a2','SO-2026-0047','UG-C-108','2026-04-25','delivered','user_91601f25f601','2026-08-31 09:11:00+05:30'),
('a1a4233f-234a-5e77-96d8-6bee84e2e36c','SO-2026-0048','UG-C-101','2026-05-06','closed','user_76cd525348e1','2026-08-31 09:12:00+05:30'),
('9198a6e5-62ed-5726-a8f3-eed696353107','SO-2026-0049','UG-C-105','2026-05-14','cancelled','user_f798947b8a2e','2026-08-31 09:13:00+05:30'),
('9d00de0c-3ffa-57fb-8de2-b501bd2e3059','SO-2026-0050','UG-C-102','2026-05-21','closed','user_fc914df642c3','2026-08-31 09:14:00+05:30'),
('8e1bc777-746a-55ab-b086-8cfc65265ff4','SO-2026-0051','UG-C-109','2026-05-29','delivered','user_21457956f010','2026-08-31 09:15:00+05:30'),
('d011572a-7e6b-50b6-a3bc-b207ffa91385','SO-2026-0052','UG-C-106','2026-06-10','dispatched','user_91601f25f601','2026-08-31 09:16:00+05:30'),
('c095f1a1-ce50-5558-a673-57baf04f33dc','SO-2026-0053','UG-C-111','2026-06-19','dispatched','user_76cd525348e1','2026-08-31 09:17:00+05:30'),
('3aa00e9d-d340-5b96-9e00-ec8521abf03c','SO-2026-0054','UG-C-103','2026-07-02','confirmed','user_f798947b8a2e','2026-08-31 09:18:00+05:30'),
('f949ab71-7677-581b-b20d-21df09a3ad82','SO-2026-0055','UG-C-107','2026-07-15','confirmed','user_fc914df642c3','2026-08-31 09:19:00+05:30'),
('d77cbbe5-6316-51ed-bd50-213e3c530fc8','SO-2026-0056','UG-C-112','2026-07-28','confirmed','user_21457956f010','2026-08-31 09:20:00+05:30'),
('1bbea62e-9b5b-548b-955a-6751b027e91f','SO-2026-0057','UG-C-108','2026-08-04','draft','user_91601f25f601','2026-08-31 09:21:00+05:30')
) AS v(id, num, ref_no, odate, status, owner, created)
JOIN li ON li.doc = v.num
JOIN staging.graha_clients c ON c.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND c.ref_no = v.ref_no
JOIN staging.graha_contacts pc ON pc.org_id='fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid AND pc.client_id = c.id AND pc.gstin <> ''
ON CONFLICT (id) DO NOTHING;

-- ── VIKRAY — 8 sales targets ────────────────────────────────────────────
INSERT INTO staging.vikray_targets
      (id, org_id, salesperson_id, period_start, period_end, target_amount, target_deals,
       notes, created_by, created_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.sp, v.ps::date, v.pe::date, v.amt::numeric, v.deals::int,
       'Seeded demo target.', 'user_f798947b8a2e', (v.ps||' 09:00:00+05:30')::timestamptz
FROM (VALUES
('de6c26b6-71a9-5e57-8637-236ed34f8319','user_76cd525348e1','2026-01-01','2026-03-31',1200000,8),
('742f0a3f-467f-511b-999e-5422f08a356c','user_f798947b8a2e','2026-01-01','2026-03-31',2000000,12),
('c4186877-d20d-5a42-a9e3-5a089def0dae','user_21457956f010','2026-01-01','2026-03-31',800000,6),
('da9e0c45-efec-5052-af0e-e01cbd5d93c5','user_91601f25f601','2026-01-01','2026-03-31',1600000,10),
('831f84d6-aa90-5b85-a30a-cc34db09b8fb','user_76cd525348e1','2026-04-01','2026-06-30',1350000,9),
('7ec9abf4-2f91-580f-91bc-7294485f2acb','user_76cd525348e1','2026-07-01','2026-09-30',1450000,9),
('70f97978-3b27-5ae6-abab-a298f4d4b125','user_21457956f010','2026-10-01','2026-12-31',1000000,7),
('427a3aaf-ed07-5810-897c-866374923668','user_91601f25f601','2026-10-01','2026-12-31',2100000,14)
) AS v(id, sp, ps, pe, amt, deals)
ON CONFLICT (org_id, salesperson_id, period_start) DO NOTHING;

-- ── E-SIGN — 5 documents and their 9 signers ────────────────────────────
-- The three file_* columns point at an original that already exists in this
-- org's own R2 prefix. No new PDF was uploaded by this seed, so opening any of
-- these five shows that same stored document rather than one written per title.
INSERT INTO staging.sign_documents
      (id, org_id, title, description, file_key, file_url, file_hash, status, signers_total,
       signers_completed, completed_at, source_module, otp_required, created_by, created_at, updated_at)
SELECT v.id::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.title, v.descr,
       'esign/originals/3ff1ede5f1274441b4e88eb8b4cb66d1.pdf', 'https://7a0e9e97b86e887f17cf923f345059fd.r2.cloudflarestorage.com/kartavya-storage/esign/originals/3ff1ede5f1274441b4e88eb8b4cb66d1.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=46ec55c6e00d7efb131c540b20dd1b10%2F20260728%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260728T214929Z&X-Amz-Expires=32400&X-Amz-SignedHeaders=host&X-Amz-Signature=40063eeeb70ae9479aea2366c5ef3c1c499aebf5484653be898a52e7c7586ad6', '63f0a3dd8c6789b11e3567e5a822180734468ab4986021893c133ebe454edfff', v.status,
       v.total::int, v.done::int, NULLIF(v.completed,'')::timestamptz, 'seed_demo', TRUE,
       'user_76cd525348e1', v.created::timestamptz, v.created::timestamptz
FROM (VALUES
('23151bfc-a7ad-5aac-8bc3-fae1c43dc434','Engagement Letter — FY 2026-27 Statutory Audit — Aarna Textile Mills','Scope, fees and timelines for the FY 2026-27 statutory audit.','completed','2026-02-16 11:20:00+05:30','2026-02-12 10:00:00+05:30',2,2),
('d0cd9d4c-f2bc-5f82-9a9a-0cbabff40638','Virtual CFO Services Agreement — Bhavya Infra Projects','Twelve-month virtual CFO retainer, renewable.','completed','2026-02-13 16:40:00+05:30','2026-02-09 10:00:00+05:30',2,2),
('a3a0c617-9d6f-5bd4-a958-1a4d5acf1202','Non-Disclosure Agreement — Kaveri Chemicals due diligence','Mutual NDA covering the target''s financial and commercial data.','partially_signed','','2026-07-26 10:00:00+05:30',2,1),
('5ad5ff03-1018-509b-b69f-1d5c98228b30','ERP Support Statement of Work — Indira Software Labs','Statement of work for the ERP cutover support engagement.','completed','2026-06-25 18:15:00+05:30','2026-06-20 10:00:00+05:30',2,2),
('29b00195-cdc6-5471-8bf5-16b0f90d6ccb','Payroll Outsourcing Agreement — Gokul Dairy Foods (draft)','Draft agreement pending the client''s SLA comments. Not yet circulated.','draft','','2026-08-01 10:00:00+05:30',1,0)
) AS v(id, title, descr, status, completed, created, total, done)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staging.sign_signers
      (id, document_id, org_id, name, email, phone, sign_order, status, token, otp_verified,
       signature_data, signature_type, signed_at, created_at, updated_at)
SELECT v.id::uuid, v.doc::uuid, 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid, v.name, v.email, v.phone, v.ord::int, v.status, v.token,
       v.status = 'signed',
       CASE WHEN v.status='signed' THEN v.name END,
       CASE WHEN v.status='signed' THEN 'type' END,
       NULLIF(v.signed_at,'')::timestamptz, v.created::timestamptz, v.created::timestamptz
FROM (VALUES
('c797d334-4502-5605-aa4c-b191ceed3cd2','23151bfc-a7ad-5aac-8bc3-fae1c43dc434','Nilesh Sanghavi','success+nilesh-sanghavi@simulator.amazonses.com','+91 99999 30001',1,'signed','953e332210dc582883c5478fe85ff1a9f104f05365e65578a9cb4cffcdb48806','2026-02-16 11:20:00+05:30','2026-02-12 10:00:00+05:30'),
('0d7ab1a2-f32f-5840-b64b-23ef88cb2713','23151bfc-a7ad-5aac-8bc3-fae1c43dc434','Keval Shah','info+signatory@unicodegroup.com','+91 99999 30101',2,'signed','5ccd293f682e51faaec6913462b49b7744dca64adf625ba6ad907330a7258d5e','2026-02-16 10:05:00+05:30','2026-02-12 10:00:00+05:30'),
('1d177594-92ed-557d-b158-1c36c9851592','d0cd9d4c-f2bc-5f82-9a9a-0cbabff40638','Bhavesh Trivedi','success+bhavesh-trivedi@simulator.amazonses.com','+91 99999 31001',1,'signed','e3d95d68f0af52b3829aed37d870c169b9e1db4150a25d59aa729287e46fb7c5','2026-02-13 16:40:00+05:30','2026-02-09 10:00:00+05:30'),
('75fb4005-4746-565b-a282-b2feacfdcb14','d0cd9d4c-f2bc-5f82-9a9a-0cbabff40638','Keval Shah','info+signatory@unicodegroup.com','+91 99999 31101',2,'signed','a5d9a61a7a4c5f9f9523a5e111cd77088722854a7e815c0da7c9815d7467ec77','2026-02-13 15:10:00+05:30','2026-02-09 10:00:00+05:30'),
('b83ccfc7-1e21-56f4-bc8a-04640e3f40c3','a3a0c617-9d6f-5bd4-a958-1a4d5acf1202','Keval Shah','info+signatory@unicodegroup.com','+91 99999 32001',1,'signed','a4877acc16e05d9582ee28ec941efb4d497b70a6213759e49233fbf43e5dc843','2026-07-28 12:00:00+05:30','2026-07-26 10:00:00+05:30'),
('b0d76832-3bad-5146-b49e-d222271739b5','a3a0c617-9d6f-5bd4-a958-1a4d5acf1202','Lalitha Krishnan','success+lalitha-krishnan@simulator.amazonses.com','+91 99999 32101',2,'sent','5f54e4bc37b650fba6a0cd942d979347db9bb42d127e56dc85f932f0ccdb6b76','','2026-07-26 10:00:00+05:30'),
('34cba36d-b8a1-50b0-9061-fc0ce3368660','5ad5ff03-1018-509b-b69f-1d5c98228b30','Vivek Raghavan','success+vivek-raghavan@simulator.amazonses.com','+91 99999 33001',1,'signed','b33f1eb42ab959538277c254db8f3fe74fe59442cefd51c083b0d0979a81ff70','2026-06-25 18:15:00+05:30','2026-06-20 10:00:00+05:30'),
('d79eadb7-fe7f-5ea7-9c1d-76c9c285c9cd','5ad5ff03-1018-509b-b69f-1d5c98228b30','Keval Shah','info+signatory@unicodegroup.com','+91 99999 33101',2,'signed','c7f395067431542198b0111b4a2d5ffd0cfde233449f5726915a8504220abef6','2026-06-25 17:30:00+05:30','2026-06-20 10:00:00+05:30'),
('2cf32607-7bd4-5021-a2cc-7b17c65c3408','29b00195-cdc6-5471-8bf5-16b0f90d6ccb','Ganesh Pawar','success+ganesh-pawar@simulator.amazonses.com','+91 99999 34001',1,'pending','fc211fe02e775a50b83cf19ff2f7c3ef34f76c0617515a6ea58ad030f6ce89b4','','2026-08-01 10:00:00+05:30')
) AS v(id, doc, name, email, phone, ord, status, token, signed_at, created)
ON CONFLICT (id) DO NOTHING;

COMMIT;
