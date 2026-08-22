/**
 * legalFacts — the single source of truth for every checkable claim the legal
 * pages make.
 *
 * WHY ONE FILE. A privacy policy, a DPA and a sub-processor list that disagree
 * with each other are worse than none: the audience is accounting firms, who
 * are trained to cross-check documents for a living. The retention period in
 * the DPA and the retention period in the policy are the same constant here,
 * so they cannot drift.
 *
 * THE `TKTK` CONVENTION. Facts only the owner can supply are `TKTK(...)`,
 * which renders as a visible amber marker rather than plausible-looking text.
 * A placeholder that reads like a real registered address is a false statement
 * on a legal page; one that shouts is merely unfinished. `LEGAL_READY` is
 * false while any remain, and the pages refuse to present themselves as
 * published until it flips — see LegalPage.jsx.
 *
 * SUB_PROCESSORS is derived from what the code actually calls, not from what
 * we remember signing up for. It was built by grepping outbound hosts in
 * backend services/ and routers/. When you add a vendor, add it here in the
 * same commit — DPDP s.8(2) makes us answerable for processors we did not
 * disclose, and a customer's own DPO will diff this page between visits.
 */

/** A fact the owner still owes. Rendered visibly; blocks publication. */
export const TKTK = (what) => ({ __tktk: what });
export const isTKTK = (v) => !!(v && typeof v === 'object' && v.__tktk);

export const ENTITY = {
  /* India-only posture, decided 2026-08-22. Aekam Inc is the contracting
     entity for every customer; there is no UK or EU establishment, so this
     document set answers to the DPDP Act and the IT Act, and treats UK/EU
     visitors under a transfers section rather than as a second regime. */
  name:         'Aekam Inc',
  product:      'Kartavaya',
  domain:       'kartavaya.com',
  cin:          TKTK('Corporate Identity Number (CIN), exactly as on the MCA certificate'),
  regAddress:   TKTK('registered office address, exactly as on the MCA record'),
  jurisdiction: 'India',
  courts:       TKTK('city whose courts have exclusive jurisdiction — normally where the registered office sits'),
};

/**
 * DPDP s.13 requires a Data Fiduciary to publish the contact of a person who
 * answers grievances. A role alias is lawful and survives a hiring change; a
 * personal inbox on a public page is scraped within a week. Both the name and
 * the address are owed before publication.
 */
export const GRIEVANCE = {
  name:  TKTK('name of the person who will actually answer grievances'),
  email: TKTK('published grievance address, e.g. grievance@kartavaya.com — must exist and be monitored'),
  responseDays: 30,
};

export const SECURITY_CONTACT = {
  email: TKTK('security disclosure address, e.g. security@kartavaya.com'),
  ackHours: 72,
};

/** CERT-In Direction 20(3)/2022 — reportable within six hours of noticing. */
export const CERT_IN = { reportHours: 6, logRetentionDays: 180 };

export const RETENTION = {
  /* Deletion windows. These are commitments, so each one names the mechanism
     that actually performs it rather than an aspiration. */
  afterTerminationDays: 90,
  backupRollOffDays:    35,
  auditLogYears:        8,   // Companies Act s.128 keeps books eight years.
  logDays:              CERT_IN.logRetentionDays,
};

export const HOSTING = {
  dbRegion: 'Singapore',
  dbVendor: 'Supabase',
  /* Stated plainly because the landing page's Trust section already refuses to
     claim Indian residency the infrastructure does not have. Repeating an
     honest answer is cheaper than being caught in a comfortable one. */
  residencyNote:
    'Kartavaya does not claim Indian data residency. The primary database is ' +
    'hosted in Singapore. Indian law does not currently require general ' +
    'personal data to remain in India, and the Central Government has not ' +
    'notified any restricted country under s.16 of the DPDP Act.',
};

/**
 * TIERS — every sub-processor is one of these. The distinction is the whole
 * point of the page: a firm evaluating us needs to know which vendors touch
 * their data no matter what they do, and which only appear because they
 * switched a module on.
 */
export const TIERS = {
  core:     'Always — required to run the product',
  optional: 'Only if your firm enables the feature',
  yours:    'Only with credentials your firm connects itself',
};

export const SUB_PROCESSORS = [
  { name: 'Supabase', tier: 'core',
    purpose: 'Primary PostgreSQL database. Holds all workspace data.',
    region:  'Singapore',
    data:    'All customer data' },
  { name: 'Railway', tier: 'core',
    purpose: 'Application servers that run the Kartavaya backend.',
    region:  TKTK('Railway deployment region — read it off the service, do not assume'),
    data:    'All customer data, in transit through the application' },
  { name: 'Vercel', tier: 'core',
    purpose: 'Hosting and DNS for the web application and marketing site.',
    region:  'Global edge network',
    data:    'Request metadata and IP addresses. No workspace records at rest.' },
  { name: 'Cloudflare (R2)', tier: 'core',
    purpose: 'Object storage for uploaded files — attachments, invoices, signed documents.',
    region:  TKTK('R2 bucket location hint — the code configures region "auto", so this must be read off the bucket'),
    data:    'Every file your firm or your clients upload' },
  { name: 'Resend', tier: 'core',
    purpose: 'Transactional email: invitations, password resets, notifications, invoices.',
    region:  'Tokyo',
    data:    'Recipient name and email address, and the message body' },
  { name: 'Sentry', tier: 'core',
    purpose: 'Error monitoring. Payloads are scrubbed before transmission, but a stack trace can carry fragments of a request.',
    region:  'United States',
    data:    'Error context and a user identifier, scrubbed of field values' },
  { name: 'Expo', tier: 'optional',
    purpose: 'Push notification delivery to the Android application.',
    region:  'United States',
    data:    'Device push token, and the notification title and body' },

  { name: 'Google (Gemini)', tier: 'optional',
    purpose: 'The Sahayak assistant and other AI features.',
    region:  'Global',
    data:    'The text of the question asked, and the records the assistant reads to answer it' },
  { name: 'Serper', tier: 'optional',
    purpose: 'Web search behind the assistant.',
    region:  'United States',
    data:    'The search query only' },
  { name: 'Apify', tier: 'optional',
    purpose: 'Public-web data collection for lead research.',
    region:  'United States',
    data:    'The search terms your firm supplies' },

  { name: 'Meta — WhatsApp Cloud API, Facebook, Instagram, Threads', tier: 'yours',
    purpose: 'Client messaging and social publishing.',
    region:  'Global',
    data:    'Message content and recipient numbers you send through it' },
  { name: 'LinkedIn, X, Pinterest, Reddit, TikTok, Telegram, YouTube', tier: 'yours',
    purpose: 'Social publishing from the Prachar module.',
    region:  'Global',
    data:    'The posts your firm publishes' },
  { name: 'Google Business Profile', tier: 'yours',
    purpose: 'Publishing updates and reading reviews.',
    region:  'Global',
    data:    'The listing content your firm publishes' },
  { name: 'IndiaMART, JustDial', tier: 'yours',
    purpose: 'Inbound lead capture.',
    region:  'India',
    data:    'The lead records those platforms send you' },
];

/**
 * SENSITIVE — categories that need naming explicitly because a reader will
 * look for them, and because a policy that buries them is the one that gets
 * quoted back during an incident.
 */
export const SENSITIVE = [
  { what: 'Aadhaar numbers',
    note: 'Stored only where your firm enters one on an employee record. Encrypted ' +
          'at rest under a key held separately from the database.' },
  { what: 'Biometric attendance (Pahchan)',
    note: 'Face-match data is processed to mark attendance. It is reachable only by ' +
          'your firm and by platform administrators, never by another customer.' },
  { what: 'Bank account details',
    note: 'Held for invoicing and reconciliation. Kartavaya operates no payment ' +
          'gateway and never initiates a transfer; an invoice is only ever marked ' +
          'paid after your firm reconciles it against a bank statement.' },
  { what: 'Payroll and salary',
    note: 'Treated as a sensitive module — access is granted person by person, not ' +
          'inherited from a role.' },
];

/** RIGHTS — DPDP ss.11–14, phrased as what the product can actually do. */
export const RIGHTS = [
  ['Access',     'Ask for a copy of the personal data held about you, and a list of who it was shared with.'],
  ['Correction', 'Have inaccurate or incomplete data corrected, completed or updated.'],
  ['Erasure',    'Have your personal data deleted where it is no longer needed and no law requires it be kept.'],
  ['Grievance',  `Complain to the Grievance Officer named below. We answer within ${GRIEVANCE.responseDays} days.`],
  ['Nomination', 'Nominate another person to exercise these rights for you if you die or become incapacitated.'],
  ['The Board',  'If we do not resolve your grievance, escalate it to the Data Protection Board of India.'],
];

/* ── Publication gate ───────────────────────────────────────────────────── */

const hasTKTK = (v) => {
  if (isTKTK(v)) return true;
  if (Array.isArray(v)) return v.some(hasTKTK);
  if (v && typeof v === 'object') return Object.values(v).some(hasTKTK);
  return false;
};

const SCOPE = { ENTITY, GRIEVANCE, SECURITY_CONTACT, SUB_PROCESSORS };

/** Every outstanding owner-supplied fact, for the readiness banner. */
export const OUTSTANDING = (() => {
  const out = [];
  const dig = (v, path) => {
    if (isTKTK(v)) { out.push({ path, what: v.__tktk }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => dig(x, `${path}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      Object.entries(v).forEach(([k, x]) => dig(x, path ? `${path}.${k}` : k));
    }
  };
  dig(SCOPE, '');
  return out;
})();

/** False while any TKTK remains. The pages check this before claiming to be live. */
export const LEGAL_READY = !hasTKTK(SCOPE);

/** Bump when the substance changes — DPDP expects notice of a material change. */
export const EFFECTIVE = '2026-08-22';
