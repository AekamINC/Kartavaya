/**
 * gen-module-docs — one document per module, generated from the code.
 *
 * Replaces the scattered, hand-written module docs in `docs/`. Those went stale
 * the moment they were written, described modules by their marketing name
 * rather than their code, and covered seven of the twelve modules while
 * inventing structure for the rest.
 *
 * The route lists, table lists and file paths here come from
 * `scripts/module-facts.mjs`, which reads the source. Re-run both after any
 * change and the docs follow the code instead of drifting from it.
 *
 * The PURPOSE and FLOW text below is the only hand-written part, because no
 * scanner can infer why a module exists. It is kept short deliberately: what
 * the module is for, and the path a request takes through it. Everything else
 * is generated, so there is nothing to keep in sync by hand.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const facts = JSON.parse(readFileSync(join(ROOT, 'module-facts.json'), 'utf8'));

/** name · Devanagari · what it is for · how a request flows through it. */
const PROSE = {
  graha: ['Graha', 'ग्रह', 'CRM',
    'Contacts, clients, deals and the pipeline. The largest module by route count, and the one every other revenue module reads from — an invoice, an order and a signature request all resolve back to a `graha_clients` row.',
    'A deal moves through stages held in `graha_deals`; each stage change writes `graha_activities` and may fire a rule in `graha_automations`. Approval-gated stages raise a `graha_approval_requests` row rather than moving directly.'],
  vikray: ['Vikray', 'विक्रय', 'Sales orders',
    'Quotes and sales orders. Sits between a won deal in Graha and an invoice in Ganit — it is where line items, discounts and delivery terms are agreed before money is asked for.',
    'An order is drafted against a Graha client, priced line by line, then converted. Conversion writes a Ganit invoice and links the two, so an order always knows what it was billed as.'],
  ganit: ['Ganit', 'गणित', 'Finance and invoicing',
    'GST-correct invoicing, payments and the ledger. Holds the tax logic: GSTIN state codes decide CGST/SGST against IGST, and place of supply follows s.12(2)(a) of the IGST Act.',
    'An invoice is raised against a Graha client, its place of supply derived from the two GSTINs, then issued. Payments post against it and the balance falls; e-way bills and TDS hang off the same record.'],
  manav: ['Manav', 'मानव', 'HR / HRMS',
    'Employees, leave, documents and the joiner-to-leaver lifecycle. Sensitive: it holds identity documents and is excluded from platform_staff by the role tiers.',
    'An employee record anchors everything — leave requests, documents, appraisals and the exit interview all reference it. Leave approval is a two-step: a request row, then an approval row, so a granted leave always records who granted it.'],
  vetana: ['Vetana', 'वेतन', 'Payroll',
    'Monthly payroll runs with statutory Indian deductions — PF, ESI, PT and TDS — computed per employee. Separated duty: the role that runs payroll cannot approve it.',
    'A run is created for a month, pulls employees from Manav, computes gross then each deduction to reach net, and lands in `processed`. Approval is a second, separate action; payslips are only issued after it.'],
  pahchan: ['Pahchan', 'पहचान', 'Attendance',
    'Biometric clock-in and clock-out with face matching and geofencing. Offline-first: a punch made without signal is queued on the device and reconciled later, inside a 72-hour buffer.',
    'An employee enrols a face template once, then punches against it. Each punch records a photo, a location and a device, and is matched to a shift policy to decide lateness. Attendance rolls up into Vetana for the days-worked figure.'],
  dristi: ['Dristi', 'दृष्टि', 'Analytics and reports',
    'Read-only. Computes across every other module — revenue, pipeline, HR and sales — plus saved dashboards, a pivot builder and scheduled exports.',
    'Nothing writes business data here. A request fans out over the other modules\' tables, aggregates, and returns. Scheduled reports run the same queries on a timer and deliver by email.'],
  prachar: ['Prachar', 'प्रचार', 'Marketing',
    'Campaigns, templates, audiences and paid ads. The outbound counterpart to Sanvaad\'s inbound conversations.',
    'A campaign selects an audience from Graha contacts, renders a template, and sends through WhatsApp or email. Delivery and engagement post back per recipient so a campaign can be measured rather than assumed.'],
  // RENAMED, not a second module. `srijan` (सृजन, "creation") became `sahayak`
  // (सहायक, "the assistant") in `migrations/108_srijan_to_sahayak.sql`, applied
  // 2026-08-06, and the alias was deliberately deleted — सृजन fitted a content
  // generator and stopped fitting once it grew a chatbot, a knowledge base,
  // skills and scrapers. Keying this on the retired code left `sahayak` with no
  // prose and `docs/modules/srijan.md` orphaned.
  sahayak: ['Sahayak', 'सहायक', 'AI assistant and skills',
    'Generation and answers grounded in data the organisation already holds, priced in credits. Runs skills — social posts, ad copy, email campaigns, GST answers — plus a grounded chatbot, a knowledge base and the Apify scraper catalogue.',
    'A run debits credits, calls a model through the router in `services/ai_router.py`, records what it touched and what it cost in `hub_ai_logs`, and refunds on failure. Every run states its spend; nothing is silently billed.'],
  kray: ['Kray', 'क्रय', 'Procurement',
    'Purchase orders, receipts and vendor bills — the money going out, mirroring Vikray. It owns no tables of its own: vendors, orders and bills all live in Ganit (`ganit_vendors`, `ganit_purchase_orders`, `ganit_vendor_bills`), and Kray is the discipline over them.',
    'An order is drafted against a vendor and approved against thresholds the org sets; amending it past them requires approving again. Issuing assigns a PO number and stamps `issued_at` — a state change, not a transmission: no PO document is rendered or sent. Receipts record what arrived, and the three-way match compares order, receipt and bill, flagging discrepancies and approving nothing.'],
  sanvaad: ['Sanvaad', 'संवाद', 'Messaging',
    'Internal conversations — threads, mentions and attachments — between people inside the org. Distinct from Varta, which talks to the outside world.',
    'A thread belongs to a channel or a record; messages append to it and mentions raise notifications. Read state is per person, so an unread count means unread by you.'],
  varta: ['Varta', 'वार्ता', 'WhatsApp',
    'Outbound and inbound WhatsApp through the Cloud API. Template-gated: business-initiated messages must use an approved template, which is why templates are first-class here.',
    'A send resolves a template, posts to the Cloud API and stores the message id. Delivery receipts and replies arrive on a webhook and are matched back by that id, so a conversation stays one thread.'],
  esign: ['E-Sign', 'प्रमाण', 'Electronic signatures',
    'In-house signing — deliberately not Aadhaar. A document is prepared, sent to a signer, and returns an audit trail: who signed, from where, and when.',
    'A signature request stores the document in R2 and issues a tokenised link. The signer opens it without an account, signs, and the signed artefact plus its trail are written back against the originating record.'],
};

const lines = [];
const dir = join(ROOT, 'docs', 'modules');
mkdirSync(dir, { recursive: true });

for (const [code, f] of Object.entries(facts).sort()) {
  const [name, hi, kind, purpose, flow] = PROSE[code] || [code, '', '', '_Not yet documented._', ''];
  const byMethod = {};
  for (const r of f.routes) {
    const [m] = r.split(' ');
    byMethod[m] = (byMethod[m] || 0) + 1;
  }

  const md = `# ${name} ${hi} — ${kind}

**Module code** \`${code}\` · registered in \`backend/middleware/role_tiers.py\`

${purpose}

## Flow

${flow}

## Backend

${f.routers.length ? f.routers.map(r => `- \`${r}\``).join('\n') : '_No router._'}

${f.services.length ? '**Services**\n' + f.services.map(s => `- \`${s}\``).join('\n') + '\n' : ''}
**${f.routes.length} routes** — ${Object.entries(byMethod).map(([m, n]) => `${n} ${m}`).join(', ')}

<details><summary>All routes</summary>

${f.routes.map(r => `- \`${r}\``).join('\n') || '_none_'}

</details>

## Database

${f.tables.length ? `${f.tables.length} tables:\n\n` + f.tables.map(t => `- \`${t}\``).join('\n')
  : '_This module writes no tables of its own — it reads from others._'}

## Frontend

${f.pages.length ? f.pages.map(p => `- \`${p}\``).join('\n') : '_No page._'}
${f.components.length ? '\n**Components**\n' + f.components.map(c => `- \`${c}\``).join('\n') : ''}

## Integrations

${f.externals.length ? f.externals.map(e => `- ${e}`).join('\n') : '_None beyond the database._'}

---
_Routes, tables and paths are generated by \`scripts/module-facts.mjs\` and
\`scripts/gen-module-docs.mjs\`. Re-run both after changing the module; do not
edit those sections by hand. Purpose and Flow are hand-written._
`;

  writeFileSync(join(dir, `${code}.md`), md, 'utf8');
  lines.push(`| [${name} ${hi}](modules/${code}.md) | \`${code}\` | ${kind} | ${f.routes.length} | ${f.tables.length} | ${f.pages.length} |`);
}

const index = `# Modules

${Object.keys(facts).length} modules, registered in \`backend/middleware/role_tiers.py\`. That file
is the only registry — a module missing from it cannot be granted, whatever else
exists in the codebase.

This line read "Twelve" until 2026-09-05, hardcoded while the registry moved
underneath it: \`srijan\` was renamed \`sahayak\` by
\`migrations/108_srijan_to_sahayak.sql\` (applied 2026-08-06) and \`kray\` was
never listed at all. It is counted now rather than stated.

| Module | Code | Purpose | Routes | Tables | Pages |
|---|---|---|---|---|---|
${lines.join('\n')}

Each document states what the module is for, how a request flows through it, and
its exact backend, database, frontend and integration surface. Everything except
Purpose and Flow is generated from the source.

**Regenerate:**

\`\`\`bash
node scripts/module-facts.mjs > module-facts.json
node scripts/gen-module-docs.mjs
\`\`\`
`;

writeFileSync(join(ROOT, 'docs', 'MODULES.md'), index, 'utf8');
console.log(`wrote ${Object.keys(facts).length} module docs + docs/MODULES.md`);
