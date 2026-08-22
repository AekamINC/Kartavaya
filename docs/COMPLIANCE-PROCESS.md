# Grievance and breach process

Internal runbook. The public pages at `/privacy`, `/security`, `/subprocessors`
and `/dpa` make promises with clocks attached; this is how those clocks get
met. If you only read one thing, read the two tables in §1.

Owner: the Grievance Officer named in
[`frontend/src/pages/legal/legalFacts.js`](../frontend/src/pages/legal/legalFacts.js).
That file is the source of truth for every published fact — change it there,
never in a page.

---

## 1. The clocks

**Breach.** Each of these runs from the moment someone at Aekam *notices*, not
from the moment the incident began, and not from the moment it is confirmed.
Waiting for certainty is the standard way the six-hour window is missed.

| Deadline | To whom | Basis |
|---|---|---|
| **6 hours** | CERT-In | Direction 20(3) of 2022 |
| **48 hours** | The affected customer firm | DPA clause 8 — our own commitment |
| Without undue delay | Data Protection Board of India | DPDP s.8(6) |
| As prescribed | Affected Data Principals | DPDP s.8(6) |

Where we are the Processor and the customer firm is the Fiduciary, **we notify
the firm; the firm notifies the Board and its Data Principals.** We do not
notify a customer's clients on their behalf unless asked in writing.

**Grievance.**

| Deadline | Action |
|---|---|
| 72 hours | Acknowledge receipt |
| 30 days | Substantive answer (DPDP s.13) |

---

## 2. Breach: first hour

Do these in order. Do not skip step 1 to investigate — the clock is already
running and an initial report may be incomplete.

1. **Start the clock.** Write down the UTC time you noticed and who noticed.
   Every later deadline is measured from that timestamp, and reconstructing it
   afterwards from memory is how a six-hour window becomes a seven-hour one.
2. **Contain.** Revoke the credential, rotate the key, disable the account,
   take the endpoint down. Containment beats evidence preservation when the
   two conflict and data is still leaving.
3. **Do not delete anything else.** No log rotation, no "cleaning up" the
   affected rows, no force-push. Logs are the only account of what happened.
4. **Scope it.** Which workspaces, which categories of data, how many Data
   Principals, and did data actually leave. Approximate is fine and expected —
   the notification asks for approximate numbers.
5. **Decide the reporting route.** See §3.
6. **Open an incident file** under `docs/incidents/YYYY-MM-DD-slug.md` and keep
   the timeline in it as you go, not afterwards.

> **The shared-database fact.** Staging and production share one Supabase
> database. A staging incident is therefore a production incident until proven
> otherwise, and the six-hour clock starts on that assumption. This is the most
> likely way a "minor" event becomes a reportable one.

---

## 3. Which reports are owed

Ask three questions.

**Is it a "cyber incident" under CERT-In Annexure I?** Unauthorised access,
data breach or leak, identity theft, malicious code, attacks on servers or
applications — the annexure is broad, and it covers attempts, not only
successes. If yes: **report within 6 hours** to `incident@cert-in.org.in`, via
the CERT-In portal, or by phone. Reporting something that turns out to be
minor costs an email; missing the window is a penalty.

**Did personal data get compromised?** Any unauthorised processing or
accidental disclosure, acquisition, sharing, use, alteration, destruction or
loss of access that affects confidentiality, integrity or availability. If
yes, the DPDP notification duties apply.

**Whose data — ours or a customer's?**

- *Ours* (an account holder's own details): we are Fiduciary. We notify the
  Board and the affected people ourselves.
- *A customer's workspace data*: we are Processor. **Notify the customer within
  48 hours**, give them the DPA clause 8 contents, and support their filing.
  Do not file on their behalf.

Both can be true in one incident. Handle both.

---

## 4. What a customer notification must contain

DPA clause 8 commits us to these five things. Send an initial notice inside 48
hours even if three of them are still "under investigation" — an incomplete
notice on time beats a complete one late.

1. What happened, in plain language.
2. Categories and approximate number of Data Principals and records affected.
3. Likely consequences.
4. Steps taken to contain it and to prevent recurrence.
5. A named contact who will answer follow-up questions.

Then keep them updated as the picture changes, and close it out in writing.

---

## 5. Grievances

Anything arriving at the published grievance address, plus anything that
reaches support and is really a data protection complaint — a request to
delete, a question about who can see something, an objection to a
sub-processor.

1. **Log it** with the date received. The 30-day clock starts at receipt, not
   at triage.
2. **Acknowledge within 72 hours**, even if the answer will take longer.
3. **Establish which role we are in.** Most requests concern data a customer
   firm controls. Then: tell the requester to contact that firm, tell the firm
   promptly, and offer to help — do not answer on the firm's behalf, and do not
   disclose or delete a firm's data on a stranger's say-so.
4. **Verify identity before disclosing anything.** Handing someone else's data
   to whoever asks for it is the exact failure these rights exist to prevent,
   and a well-written request is not evidence of identity.
5. **Answer within 30 days**, in writing, saying what was done. If we decline,
   say why, and tell them they may escalate to the Data Protection Board.
6. **Record the outcome.** A register of grievances and how they were resolved
   is the evidence that this process runs, and it is the first thing an auditor
   or the Board will ask to see.

---

## 6. Adding a sub-processor

The DPA promises **thirty days' notice**, and DPDP s.8(2) makes us answerable
for processors we did not disclose. So, before any customer data reaches a new
vendor:

1. Add it to `SUB_PROCESSORS` in `legalFacts.js` — in the same commit as the
   integration, not afterwards. Record the real region; do not assume it.
2. Ship the page.
3. Email account administrators.
4. Wait thirty days. Handle objections under DPA clause 6.

Removing a vendor needs no notice period, but update the page in the same
commit that removes the call.

---

## 7. Before any of this is published

The pages render a visible draft banner while facts are outstanding, and the
outstanding items are listed by `OUTSTANDING` in `legalFacts.js`. Currently
owed:

- Aekam Inc's CIN and registered office address, as on the MCA record
- The city whose courts have exclusive jurisdiction
- The Grievance Officer's name, and a monitored grievance mailbox
- A monitored security disclosure mailbox
- The Railway deployment region, read off the service
- The R2 bucket location, read off the bucket — the code configures
  `region="auto"`, so this cannot be inferred from the code

Two of these are mailboxes that must exist and be watched before the address is
published. A grievance address that bounces is worse than none: it converts a
complaint into evidence of non-compliance.

**These documents have not been reviewed by counsel.** They are a complete
draft written to the Act, not a substitute for an Indian data protection lawyer
reading them before they go live.

---

## 8. Related

- Public pages: `/privacy`, `/subprocessors`, `/security`, `/dpa`
- Source of truth: `frontend/src/pages/legal/legalFacts.js`
- Proposal and rationale: `docs/proposals/81-compliance-documents.html`
