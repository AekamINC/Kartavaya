# Design conformance — Vetana · Vikray · Prachar · Dristi · Srijan · Sanvaad

Branch `staging`, read-only pass, 2026-07-28.
Spec precedence: `design-reference/Kartavaya Redesign/*.jsx|css` first, `design-handover/*.md` second.
Reference files read in full: `Data.jsx` (MODULE_TABS/TAB_HI/TabBar), `ScreensBiz.jsx`, `ScreensMore.jsx`, `ScreensThin.jsx`, `ScreensSanvaad.jsx`, `ScreensVarta.jsx`, `components.css`, `module.css`.

---

## 1 · Full tab trees (deliverable — drives live testing)

Leaf = a distinct rendered surface reachable by a tab/segment/chip control. Drawers, forms and detail views are listed under their leaf as sub-surfaces, not counted as leaves.

### Vetana · वेतन — `pages/VetanaPage.jsx` — **6 leaves**
- **dashboard** · मुख्य
- **structures** · संरचना → list · new-structure form · structure detail *(page replacement)* · inline edit
- **payroll** · वेतन → month picker · `AttendanceSource` card (Pahchan dry-run) · run list · run detail *(page replacement)* · process ConfirmDialog · approve/disburse ConfirmDialog · separated-duty refusal note
- **payslips** · पर्ची → month filter · list · payslip detail *(page replacement)* · PDF download · incomplete-data notice
- **loans** · ऋण → list · new-loan form · edit form · delete ConfirmDialog
- **statutory** · अनुपालन → month picker · 4 StatTiles · compliance calendar (PF/ESI/PT/TDS) · employee-wise register
- 6 ≤ `max`, so no More popover.

### Vikray · विक्रय — `pages/VikrayPage.jsx` — **6 leaves**
- **dashboard** · मुख्य → status counts (jump to Orders) · needs-attention list
- **orders** · आदेश → status filter · `OrderForm` (LineItemEditor · "estimated" totals) · `OrderRows` · **`OrderDetail` DRAWER** → `StatusBar` 5-stage pipe · advance · Generate invoice (Ganit-gated, reason stated) · edit (same LineItemEditor) · cancel + ConfirmDialog
- **stock** · भंडार → low-stock-only filter · threshold inline save state · `AdjustDialog` (qty + reason) · movement history expand · `.is-low` row keyline
- **pipeline** · प्रवाह → stage board (each stage filters the list) · order rows
- **targets** · लक्ष्य → target form · per-owner rows · progress bars · delete ConfirmDialog
- **customers** · ग्राहक → search · customer rows → their orders
- 6 ≤ `max`, no More popover.

### Prachar · प्रचार — `pages/PracharPage.jsx` — **11 leaves** (8 tabs, Ads carries 4 second-level)
- **dashboard** · मुख्य
- **campaigns** · अभियान → **views: month | week | list** · channel chips · unscheduled tray · drag-to-reschedule (PATCH writes through) · campaign form *(page replacement)* · campaign detail *(page replacement)*
- **ads** · विज्ञापन → **overview | campaigns | insights | AI analysis** ← 4 second-level leaves
- **sequences** · क्रम → list · sequence form · sequence detail + steps
- **templates** · साँचा → category filter · template form · duplicate · marketing/utility opt-in chip
- **automations** · स्वचालन → list · automation form *(page replacement)*
- **unsubscribes** · निकास → search · add form
- **events** · घटना → list · event form · event detail · registrations
- 8 > `max` 6 → **More +2** popover holds `unsubscribes`, `events`.

### Dristi · दृष्टि — `pages/DristiPage.jsx` — **8 leaves**
- **overview** · सारांश (withheld-source notes)
- **revenue** · राजस्व
- **pipeline** · प्रवाह
- **hr** · मानव — label forced to `HR`
- **sales** · विक्रय
- **reports** · रिपोर्ट → views: list | create | detail · CSV export
- **dashboards** · पटल → preset chart cards
- **pivot** · सारणी → Build panel (source · rows · columns · measure seg · from/to) · Run · CSV export · exclusion note
- 8 > `max` 6 → **More +2** holds `dashboards`, `pivot`.

### Srijan · सृजन — `pages/OrgSrijanPage.jsx` — **7 leaves** (6 tabs, Skills carries 2 panes)
- **skills** · कौशल → **panes: Active | Catalog** ← 2 second-level leaves; skill open · run · assign
- **content** · सामग्री
- **generate** · सृजन → form · result panel
- **data catalog** · सूची → scraper form → run *(`?tab=scrapers` and `data-catalog` aliased)*
- **data runs** · प्रयोग → run list · run detail
- **credits** · श्रेय
- 6 ≤ `max`, no More popover.

### Sanvaad · संवाद — `pages/SanvaadPage.jsx` — **5 leaves** (2 tabs, WhatsApp carries 4)
- **channels** · चैनल *(reference `TAB_HI` says माध्यम)* →
  - `ChannelList`: search · new channel · new DM (`DmPicker`) · All/Active toggle · sections **Channels / Direct messages / Archived**
  - `ChatPane`: header (icon · name · archived tag · description · member count · settings) · archived banner · `ChannelDetails` dialog (rename · describe · archive/unarchive · members add/remove) · `MessageLog` (date dividers · unread divider · consecutive grouping · load-older · reactions with `.mine` · thread link · seen-by · edit/delete + confirm · pending row) · `Composer` (emoji row · reply bar) | `LockedComposer`
  - `ThreadPanel`
- **whatsapp** · वार्ता →
  - **conversations** → status seg **Open | Pending | Done** · `WAChat` (log · 5 tick states · error-code line · `WindowBanner` · `Composer` **or** `TemplatePicker`)
  - **templates**
  - **auto-replies**
  - **accounts**

**Leaf totals — Vetana 6 · Vikray 6 · Prachar 11 · Dristi 8 · Srijan 7 · Sanvaad 5 = 43.**

---

## 2 · HIGH — user-visible or broken

| # | Spec | Implementation | Spec says | Code does | Sev |
|---|---|---|---|---|---|
| H1 | `ScreensVarta.jsx:141-146` | `pages/sanvaad/varta/WAChat.jsx:180-182` | Outbound is blocked entirely for a contact with no recorded consent — *"has not opted in. WhatsApp policy blocks all outbound messages, **including templates**, until consent is recorded"* + `Send opt-in link` | Only the 24-hour window is checked (`windowState`). `opted_in` is never read. `varta_contacts.opted_in` / `opted_in_at` exist since `058_sanvaad_messaging.sql:110-111`; `list_conversations` (`routers/whatsapp.py:121-131`) does not select them. An operator can template a non-consenting number. | **HIGH** |
| H2 | `ScreensVarta.jsx:167-181` (`wa__side`) | `WAChat.jsx` — absent | Contact panel: Opt-in status + since-date · Assigned to · Service window · **Open in ग्रह Graha** link · Labels · Internal note | No side panel at all. `graha_contact_id` is returned by `list_conversations` and unused, so the CRM link the design draws has data and no UI. | **HIGH** |
| H3 | `ScreensVarta.jsx:134-135` | `WAChat.jsx:116-124` header | `Assign` and `Resolve`/`Reopen` buttons on the conversation header | Header is back-button + name + phone. No assign, no resolve. A shared inbox with a status filter and no way to change status. | **HIGH** |
| H4 | `ScreensVarta.jsx:255-274` | `varta/WhatsAppTab.jsx:255-279` | Templates is a table (Name · Category · Lang · **Status** · **Meta ID** · Last used) opening a sheet: rejection reason verbatim, pending lock, header/body/footer/buttons editor, live `TmplPreview`, `Submit to Meta` / `Fix and resubmit` | Read-only cards: name, `language · category`, body, status chip. No Meta ID, no reason, no editor, no create, no submit. `13-module-pages.md:139` names this as Prachar's *notable constraint* — "Real Meta approval states including rejected, with Meta's reason verbatim". | **HIGH** |
| H5 | — | `varta/WhatsAppTab.jsx:255`, `:282`, `:311` | Three states, error outranks empty (the rule this repo applied everywhere else) | `error` is checked **only** in the conversations pane (`:184`, `:193`). Templates / auto-replies / accounts render `{!loading && rows.length === 0 && <EmptyState …>}`. A 500 on templates prints *"No templates yet"* — a false claim on the surface that gates every send after the 24-hour window. | **HIGH** |
| H6 | `ScreensSanvaad.jsx:135-141` + `:280` | `pages/sanvaad/Composer.jsx`, `Message.jsx` | Composer has a clip/attach control; a message renders an attachment card — icon, filename, `248 KB · spreadsheet`, `Download` | Zero attachment support: no UI, and `backend/routers/messaging.py` has no attachment route at all — while `staging.samvada_message_attachments` exists (`058:49`). Grep for `attach` in `pages/sanvaad/**` returns nothing. | **HIGH** |
| H7 | `ScreensBiz.jsx:196-204` ("Send via", *"WhatsApp first — how Indian SMEs actually transact"*) | `pages/vikray/**` — absent | A quote/order can be sent by **WhatsApp · Email · SMS link · Copy link** | Vikray has no send affordance of any kind. `OrderDetail.jsx:261` prints `contact_email · contact_phone` as inert text. `pages/ganit/_shared.jsx:42-77` already exports `waLink()` + `waInvoiceText()` and Vikray does not import them. | **HIGH** |
| H8 | `ScreensThin.jsx:157`, `:179-184`; `13-module-pages.md:136` — *"'challan paid, return pending' is a distinct state"* | `pages/vetana/StatutoryTab.jsx:22-26`, `:118-123` | Each statutory row carries `Challan` + `Mark filed`, and a filed row carries `Receipt`. Status map is `{due, overdue, filed}` | `STATUS = { overdue, due, 'no-date' }` — **no `filed`** — and the row footer is a `Tag` + a bar, with **no action of any kind**. Overdue tinting (`vt-cal__i--late`) did land. The tab named in the handover as Vetana's judged screen cannot record a filing. | **HIGH** |
| H9 | `13-module-pages.md:47` — *"Every module page is the same five parts: header, tabs, KPI strip, content, empty state"* | `pages/SanvaadPage.jsx:52-62` | `ModuleHeader` + `ModuleTabs` + `KpiStrip`, `.mh` chrome | Sanvaad alone uses `PageHeader` + `ui/Tabs` and has no KPI strip. Different heading type ramp, different tab class (`.tabs__b` not `.mt__b`), no module accent `--c`, no More-popover behaviour. It is the one page in the six that does not look like the others. | **HIGH** |

---

## 3 · MED — off-system, looks close

| # | Spec | Implementation | Spec says | Code does | Sev |
|---|---|---|---|---|---|
| M1 | `27-vikray.md:143` — `.k-btn.k-btn--primary` → `.btn.btn--fill`; `components.css:11-42` | `VetanaPage.jsx:146`, `PracharPage.jsx:121`, `DristiPage.jsx:127` | The design-system button | `className="k-btn k-btn--primary vt-hdr__go"` / `"k-btn k-btn--primary k-btn--sm"`. `VikrayPage.jsx:120` gets it right (`btn btn--fill btn--sm`) — so three module headers and one module header render two different primary buttons. | MED |
| M2 | `components.css:11-42`, `:45-73` | six modules | one `btn`/`fld`/`inp` system | Legacy `k-*` still live: **`k-btn` ×101**, `k-btn--ghost` ×59, `k-btn--primary` ×42, **`k-formpanel__input` ×53**, `k-formpanel__label` ×42, `k-input` ×17, `k-stats` ×14. By module: Prachar 173, Vetana 59, Dristi 49, Srijan 49, Vikray 4, Sanvaad 0. | MED |
| M3 | `components.css:101` — `.card{…border-radius:var(--r-lg);box-shadow:var(--shadow-1)}` | `srijan.css:39` `.hb-card`, `module.css:934` `.dcard`, `editorial.css:1345` `.k-card` | one card | Four card treatments in six modules. `.hb-card` re-declares surface/border/radius and **drops the shadow**; `.dcard` uses `--r-md` and **drops the shadow**; `.k-card` borders on legacy `--rule`. Usage: `className="card"` ×26, `hb-card` ×24, `dcard` ×15. Dristi's cards are visibly a different radius and elevation from Vikray's. | MED |
| M4 | `ScreensMore.jsx:127` / `:17` / `:239` — stats sit **above** `TabBar` on Vetana, Vikray, Srijan; Prachar and Dristi have **no** stats row | `PracharPage.jsx:129-131`, `DristiPage.jsx:138-142` | — | Prachar and Dristi render `ModuleTabs` *then* `KpiStrip`; Vetana/Vikray/Srijan render `KpiStrip` *then* `ModuleTabs`. Two chrome orders across five pages that share one header component. | MED |
| M5 | `27-vikray.md:129` — *"Everywhere else in the product, opening a record opens a **drawer** over the list… Two navigation models for 'open this row' is a learned inconsistency"* | `dr__` only in `vikray/OrderDetail.jsx` | drawer ≥1024px, full-screen push below | Vikray was converted; the other five now carry the defect it was fixed for. `BackButton` page-replacement detail views in `vetana/PayrollTab.jsx:380,391`, `vetana/PayslipsTab.jsx:194,216`, `vetana/StructuresTab.jsx:287,299`, `prachar/CampaignsTab.jsx:447,562`, `prachar/AutomationsTab.jsx:88`, `prachar/EventsTab.jsx`, `prachar/SequencesTab.jsx`, `dristi/ReportsTab.jsx`. | MED |
| M6 | `ScreensSanvaad.jsx:198` (`Starred · तारांकित` section), `:252` (star toggle), `:171`/`:253` (muted bell + tag) | `sanvaad/ChannelList.jsx:135-176`, `ChatPane.jsx:76-105` | Starred section, per-channel star, mute with bell-off glyph and a muted tag on the header | Neither exists. `samvada_channel_members.muted` is in the schema (`058:30`) and has no reader; there is no `starred` column, so starring needs a migration. Sections are `Channels / Direct messages / Archived` only. | MED |
| M7 | `ScreensSanvaad.jsx:275` — typing row; `:313` — `Also send to channel` checkbox in the thread footer | `pages/sanvaad/**` — absent | both | Neither implemented. Grep for `typing` and `Also send to channel` across `pages/sanvaad/**` returns nothing. | MED |
| M8 | `ScreensVarta.jsx:279-306` | `varta/WhatsAppTab.jsx:282-310` | Four numbered rules in evaluation order with *"the first match wins"*, per-rule `Edit`, a live `sw` toggle, the trigger config and the reply body | Unnumbered rows, `trigger_type: value`, a **disabled** `Toggle` and a truncated reply. No order, no edit, no note. (Read-only is documented — no PATCH exists — but the ordering semantics are lost too.) | MED |
| M9 | `ScreensVarta.jsx:308-364` | `varta/WhatsAppTab.jsx:311-334` | Business-account card (Provider · Display name · Number · **Quality rating** · **Messaging limit** · Verification · webhook heartbeat), pending second number, **Opt-in sources** with counts and validity, **This month** (Sent/Delivered/Read/Failed) | Two lines per account: display name, `phone · WABA id · added N ago`, status chip. None of the three cards. | MED |
| M10 | `ScreensVarta.jsx:64-81` (`Bubble`) | `WAChat.jsx:142-154` | A template message renders `wab__tag` (`template · payment_reminder_v3`), header, footer and the button row the customer sees | Only `m.content` and the meta row. The bubble cannot be told from a free-text reply, and `WAChat.jsx:110` records that `template_name`/`template_params` are lost on send because `POST /conversations/:id/template` (`06` §4) was never added. | MED |
| M11 | `ScreensThin.jsx:60-61` | `dristi/PivotTab.jsx:291-294` | `Save as report` **and** `Export to Excel` in the Build panel | Only `Export to CSV`. A pivot a user has just built cannot be kept — they must re-author it under Reports. | MED |
| M12 | `ScreensThin.jsx:286` (`Buy top-up`), `:311-329` (`By skill` with per-skill meters + cheapest/most-expensive/average) | `srijan/CreditsTab.jsx` | both | Neither. The tab has org/you figures, one meter, a flat cost table and a transaction list. No per-skill breakdown, no top-up path. | MED |
| M13 | `components/ui/ErrorState.jsx` (used by Vikray, Vetana, Sanvaad) | `prachar/_shared.jsx:191-207`, `dristi/_shared.jsx:102-119` | one error presentation | Two hand-rolled ones: `<div className="note note--warn">` + `k-btn k-btn--ghost` Retry, with no offline/server `kind` distinction. Dristi's also carries `role="status"` where Prachar correctly uses `role="alert"` (`dristi/_shared.jsx:105`, and again at `PivotTab.jsx:121`, `:155`). | MED |
| M14 | `routers/whatsapp.py:108` — `limit: int = Query(50, le=100)`, `offset: int = 0` | `varta/WhatsAppTab.jsx:120-129` | — | The shared inbox fetches page one and never passes `offset`. Conversation 51 is unreachable and nothing on screen says the list is truncated. Same for `/templates`, `/auto-replies`, `/accounts`. | MED |
| M15 | `components.css:477-497` (`.empty`), `components/ui/EmptyState.jsx` | six modules | one empty state, with icon/title/bilingual/CTA | 28 uses of `<Empty>`/`<EmptyState>` against ~50 bare styled paragraphs standing in for one: `pr__step-when` ×27 (e.g. `TemplatesTab.jsx:142`, `CampaignsTab.jsx:376`, `UnsubscribesTab.jsx:123`), `sv__none` ×14, `dnone` ×9, `hb-none` ×4, `wa__none` ×2. | MED |
| M16 | `ScreensSanvaad.jsx:27` — the first channel is `assistant · सहायक`, an AI chat over live workspace data with suggestion chips and action buttons | `pages/sanvaad/**` | in the channel rail | Not in Sanvaad. The equivalent lives in `pages/hub/ChatTab.jsx`. **Moved, not missing** — but the reference's headline Sanvaad row is not where a user is told to look. | MED |
| M17 | `srijan.css:113` | — | `--primary` is a fill; `--primary-text` is the text variant | `.hb-linkbtn:hover { color: var(--primary); }` — the only `color: var(--primary)` in all six module stylesheets. Everything else is correct. | MED |
| M18 | `ScreensSanvaad.jsx:260` — archived banner carries `Unarchive` | `sanvaad/ChatPane.jsx:109-114` | inline unarchive | The banner is text only; unarchive is two clicks away inside `ChannelDetails`. | MED |

---

## 4 · LOW

| # | Where | Finding |
|---|---|---|
| L1 | `Data.jsx:142` vs `SanvaadPage.jsx:42` | Reference `TAB_HI.channels` is `माध्यम`; build renders `चैनल` (a transliteration). `whatsapp → वार्ता` is correct per `06` §naming and beats `व्हाट्सएप`. |
| L2 | `sanvaad/ChannelList.jsx:224`, `:249` | `Channels` and `Direct messages` section heads have no Devanagari; `Archived · संग्रहित` (`:274`) does. Inconsistent bilingual within one rail. |
| L3 | `vetana.css:250` | `.vt-cal__hi` sets `--font-indic` and size but no explicit `font-weight: 400`. Every other Hindi rule in these five stylesheets pins it (`prachar.css:55`, `srijan.css:65`, `module.css:213`, `vetana.css:109`). Tiro ships 400 only. |
| L4 | `vetana.css` | 0 `:hover` and 0 `:focus-visible` rules across 271 lines, on a stylesheet that defines `.vt-cal__i`, `.vt-field__in` and the bars. The global `components.css:530` ring covers focus; hover affordance on Vetana's own surfaces is absent. `prachar.css` has 1 hover in 592 lines. |
| L5 | `srijan.css` | 9 `:hover` rules, 0 `:focus-visible`. Covered by the global ring, so not a defect — noted because the ratio is the outlier. |
| L6 | `dristi/PivotTab.jsx:274`, `:291` | The Build panel is otherwise pure design system (`.fld`, `.inp`, `.seg`) and then ends on two `k-btn`s. |

---

## 5 · NOT A GAP — checked, do not re-file

| Claim | Verdict |
|---|---|
| "Prachar/Dristi have no error states" | **False.** Centralised in `prachar/_shared.jsx` `Panel` and `dristi/_shared.jsx` `TabState`. Only the *presentation* diverges (M13). |
| "No focus rings in the module stylesheets" | **False.** `components.css:530` `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }` is global, plus `a11y.css` forced-colors. |
| Vetana's missing **Registrations** card (`ScreensThin.jsx:202-208`) | **Deliberate and documented** (`StatutoryTab.jsx:7-13`): `staging.organisations` has no PF/ESIC/PT/TAN columns; `PROPOSED_080_statutory_document_identifiers.sql` is unapplied. Rendering it would invent four identifiers on a compliance screen. |
| Srijan's missing `+ New skill` header action (`ScreensMore.jsx:232`) | **Correct.** `POST /v1/hub/skills/templates` is `require_platform_role(*OPERATIONS_CONSOLE_ROLES)` (`routers/hub.py:687-689`). An org page must not offer it. |
| Prachar Templates lacks Meta approval states | **Correct reading.** `prachar_templates` are email templates; Meta states belong to Varta (see H4, which is where the real gap is). |
| WhatsApp read tick hardcoded `#4FC3F7` per `06` §1 | **Improved on.** Tokenised both ways — `kartavaya-design.css:503-504` `--tick-read: #1E88C7` light / `#4FC3F7` dark, consumed at `sanvaad.css:922`, with the light-mode contrast measurement recorded. |
| `13-module-pages.md:56` says `.mh__hi{color:var(--primary)}` | **Handover is wrong, code is right.** `module.css:82` uses `--primary-text`. Reference wins; `--primary` is a fill. |
| `More +N` renders the Latin `+2` in `--font-hindi` | Matches `Data.jsx:171` (`<span className="tabs__hi">+{tail.length}</span>`) exactly. Not a divergence from the reference. |
| Vikray "Stalled" card (`ScreensBiz.jsx:205-214`) | **Present under another name** — `attention()` in `vikray/_shared.jsx:108-122`, rendered by `DashboardTab`, with the reasons re-derived from columns the build actually has. |
| Vikray `TargetsTab` "does not exist and is rendered" (`27-vikray.md:23-33`) | **Fixed.** `pages/vikray/TargetsTab.jsx`, 16 KB, with form, progress bars and a delete confirm. |
| `27-vikray.md` §4 two line-item editors, §5 unlabelled client totals, §8 stock defects | **All fixed.** One `components/LineItemEditor.jsx` imported by both `OrderForm.jsx:9` and `OrderDetail.jsx:21`; `previewTotals` documented as a preview (`_shared.jsx:84-89`); `AdjustDialog` with quantity + reason, threshold inline save state, `.is-low` row keyline (`module.css:756`). |
| `06` §0 `addToast` ship-blocker | **Was already stale** — recorded at `SanvaadPage.jsx:11-13`. No `addToast` anywhere in `frontend/src`. |
| Tailwind in new work | **None.** Zero matches across all six module directories. |
| Raw hex / ad-hoc px in JSX | **Clean.** Zero colour literals in `vetana/vikray/prachar/srijan/sanvaad.css`; the only hex in `module.css` is the `--m-*` accent table (`:24-55`), declared for light **and** `[data-theme="dark"]`. |
| Inline style objects | **Low and mostly justified**: Prachar 10, Sanvaad 7, Vetana 3, Vikray 3, Dristi 3, Srijan 1 — computed widths, `--c` custom properties, drag offsets. |
| Glass / `backdrop-filter` | Not used by any of the six. |
| Bilingual pairing (`--font-hindi` weight 400, never tracked, never uppercased) | **Held.** Every Hindi rule that sits under a tracked/uppercased parent explicitly resets — `module.css:76`, `:213`, `:251`; `prachar.css:55`; `srijan.css:872`; `vetana.css:109`. One omission only (L3). |

---

## 6 · The three decisions, verified in source

### 6.1 Sanvaad defaults to **editor** — ✅ LANDED

`backend/middleware/role_tiers.py:363-366`:
```python
NEW_GRANT_LEVEL_BY_MODULE: dict[str, str] = {
    "sanvaad": EDITOR,
}
```
Reached through `default_level_for()` (`:372-380`) and called on every grant path: `routers/org_members.py:43`, `:46`, `:226` and `routers/org_invites.py:151`. `DEFAULT_GRANT_LEVEL` stays `VIEWER` for every other module, which is the narrower change. The client half is `useSanvaadAccess.js` → `GET /v1/messaging/me` (`routers/messaging.py:170-195`), which fails **closed on 403** and **open on anything else** — so a dropped connection does not silently lock an editor out.

### 6.2 Vikray quotes are real, downloadable and WhatsApp-able — ⚠️ **PARTIAL — and not in Vikray**

- **Real:** yes, but as `ganit_invoices.invoice_type = 'quotation'` (`routers/ganit.py:411-426`), not as a Vikray object. `vikray/PipelineTab.jsx:8-11` and `backend/routers/vikray.py:598-601` both state the position outright: *"there is no quote entity in `staging.vikray_orders` and none is invented here."*
- **Downloadable:** yes — `GET /v1/documents/quotations/{invoice_id}/pdf` (`routers/documents.py:169-254`) rendered by `services/quotation_pdf.py` against its own spec (validity date, payment schedule, acceptance block), wired at `pages/ganit/InvoiceDetail.jsx:224-232`.
- **WhatsApp-able:** yes — `waLink()` + `waInvoiceText()` (`pages/ganit/_shared.jsx:42-77`) build a `wa.me` deep link with no WABA required; button at `InvoiceDetail.jsx:245`.
- **Not in Vikray:** the module the reference draws the quote-to-cash flow on has none of it. See **H7**. Both helpers are already exported and unimported by Vikray.

### 6.3 The Ganit dead link — ✅ NO DEAD LINK, but also **no live one**

Every cross-module link out of these six was enumerated (`navigate(` / `<Link` / `href=` / `to=`): there are exactly **two**, and neither is dead.
- `pages/sanvaad/Message.jsx:107` — `<Link className="msg__sysa" to={meta.action_href}>` guarded on `meta.action_label && meta.action_href`; `/ganit` is a live route (`App.jsx:243`) and the contract is asserted in `__tests__/sanvaadChatPane.test.jsx:146,182`. No producer writes `metadata` yet and the row degrades to a plain note without it.
- `pages/prachar/EventsTab.jsx:233` — an external `location_url`, not cross-module.

Vikray reaches Ganit only through `POST /v1/vikray/orders/{id}/invoice`, correctly gated by `useGanitAccess()` (`_shared.jsx:141-162`) with the reason stated in English at `OrderDetail.jsx:243-251`. **But** after a successful mint, `OrderDetail.jsx:97` fires a toast — *"Invoice INV-… created in Finance"* — and there is no link, no `Invoiced` chip link (`:183`), no route to the record just created. A missing link rather than a broken one. Flag as a MED follow-up.

Separately: `swarm-reports/file-signingpage-security-a11y.md:72` records a genuinely dead Ganit link — `esign_service.py:104` mails `{FRONTEND_URL}/sign/{tok}` for `ganit_contract_signers` tokens while `/sign/:token` resolves against `sign_signers`. That is **eSign**, outside these six modules, and is still open as a product decision.
