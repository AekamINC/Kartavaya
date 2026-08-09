# What next — written 2026-08-09 before a compact

Read `TASKS.md` first (the inbox is filed under "Dropped 2026-08-09"), then this.

## Where we are

The owner dropped a 17-item inbox on 2026-08-09 and asked for it in **batches of
five**, my choice of grouping. **Batch 1 is shipped and pushed to `staging`.**

| Item | Commit |
|---|---|
| Date picker themed + anchored under the icon | `59e285d3` |
| Contact company field dropped (dropdown is the company) | `59e285d3` |
| Pipeline + Kanban stage-colour column grounds | `024bce34` |
| Activities show whose they are; admin sees all | `024bce34` |
| Sidebar solid base + glass, lozenge, button sheen, 13 Windows overrides deleted | `4520090d` `ece21d78` |
| The `.side` regression fix | `779c5e35` |
| Custom fields reach the forms; five entity types | `779c5e35` |
| CRM documents — upload, R2 folders, 10 MB enforced | `e57e4126` |

## Do this next — Batch 2, in this order

1. **Projects: archive and delete.** Archive/soft-delete/restore ALREADY EXIST
   in `server.py`, with a bin and a 30-day window — but all three are gated on
   `_require_admin`, which is a **platform** role, so a customer cannot archive
   or delete their own project at all. That is the real bug. Re-gate to org
   admin + project module-admin (module-admin sees only projects they belong
   to), change 30 days to 7, add the org-owner email naming the person. There
   is NO "disabled" state — the owner corrected that to archived.
2. **Kanban Done/Won/Lost auto-archive** 7 days after entering the status.
3. **Territories** — user dropdown not a user id, MapMyIndia (decided), show
   the territory on deals.
4. **CRM reports download** — approved, but the PLAN IS STILL OWED: what goes
   in, CSV/Excel/PDF, PDF presentable and carrying org details. Also survey
   which other modules should get the same.
5. **Bank statement import** — a dummy statement, CSV column reading, and an
   existing-bank vs new-bank prompt so the column map is matched.

Batch 3 after that: tables sort/filter/pagination everywhere · products
cost/sale/margin · invoice products from deal/sales · CRM↔Sales sync + won
deal→order · no-module standalone behaviour.

## Owed to the owner, unanswered

- **One company record or two?** My recommendation is one: the CRM client is the
  company, Sales references it, add `client_id` to `vikray_orders`, and the
  "tick" becomes `is_sales_customer` on the client row. Sales has NO customer
  table — its Customers tab is a derived view over orders joined to CRM
  contacts. Not yet accepted.
- **The rail waking on approach** — blur lifting while the pointer is inside the
  sidebar. Demoed in `docs/proposals/46-glass-animations.html` §2, deliberately
  NOT shipped, awaiting a yes.
- **Re-check on staging**: sidebar scrolling and dark mode, after `779c5e35`.

## Two migrations written and NOT applied

Staging and production share one database.

- `migration 131` — **blocks a shipped feature**. The
  Custom Fields tab now offers client / activity / follow-up and the API returns
  400 for those three until this runs. Raise this one first.
- `migration 132` — keeps `graha_contacts.company`
  true now the text box is gone; twelve readers across five routers depend on it.

## Traps learned this session

- **Never delete CSS rules by string-matching a selector.** A script that did
  matched the selector inside my own comment and ate the whole `.side` rule —
  the sidebar lost its scroll chain and its background at once. `git diff` the
  removed lines after any scripted multi-file edit.
- **`check-orphan-selectors.mjs` stops parsing at an inline `data:` URI** and
  goes on reporting success. It silently lost 677 selectors. Keep SVG textures
  as files. The blind spot is still unfixed and wants a ratchet.
- **`npm run check` exits 0 on CSS the browser rejects** — run `npm run build`
  before pushing styles.
- Frontend tests sit at **11 pre-existing failures**; that is the baseline, not
  a regression. Run pytest from `backend/`, never the repo root.
