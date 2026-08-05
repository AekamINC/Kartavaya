# docs/proposals/

Design proposals, written to be **looked at** rather than read. Open the `.html`
files in a browser — they are self-contained, need no server, and follow the
light/dark theme of whatever you open them in.

These are proposals and records of decisions, not documentation of what is
built. Where a proposal has since shipped, it says so below.

| File | What it covers | State |
|---|---|---|
| `01-org-lifecycle-four-screens.html` | Create org → account page → top up → what they spend it on. The two-bucket balance and member ceilings as ceilings rather than wallets. | **Built.** Migration 095, commit `1779a019`. |
| `02-org-control-and-marketplace.html` | One org control page for everything assignable, an AI marketplace the client's own admin can browse and request from, and the request → approve → enable flow. | Proposed. 61 catalog items already exist in the database; the shop front and the request workflow do not. |
| `03-billing-lines.html` | The five things a client is billed for, how each is entered, and what an invoice becomes once billing is a query over lines. | **Built.** Migrations 096 and 097. |
| `04-email-plan.html` | One verified domain, six purpose addresses, replies, which provider, and clients who only have a Gmail address. | Proposed. |

## Why HTML and not Markdown

The owner directs from screenshots and mockups. A table of field names in
Markdown does not answer "what does this screen look like"; a rendered page
does. Each file is a single self-contained document — no build step, no assets,
no CDN — so it still opens correctly in five years.

## Adding one

Write it here, not in a temp directory: a proposal that only exists in
`%TEMP%` is lost the moment the machine is cleaned, and these are the record of
why the product is shaped the way it is. Number it, add a row above, and say
plainly whether it is proposed or built.
