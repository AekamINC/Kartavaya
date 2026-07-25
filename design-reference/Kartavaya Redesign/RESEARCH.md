# Competitor research — findings that change the design

Research pass across the modules in scope. Each finding below is followed by the design decision it drives in Kartavaya.

---

## Graha (CRM) — HubSpot, Pipedrive, Zoho CRM

**Pipeline-first beats contact-first at SMB scale.** <cite index="1-2,1-3">Pipedrive's pipeline-first UI is considered the most intuitive in the category at SMB scale, and the visual deal flow is what most sales reps want to see daily.</cite> <cite index="1-9,1-10">HubSpot's pipeline view does more, and reps looking for the deal-focused workflow sometimes spend time navigating around broader CRM features.</cite>

→ **Decision:** Graha opens on the pipeline, not a contact list. Contacts are a second tab.

**Activity-based selling — every deal needs a next step.** <cite index="3-12,3-13,3-14,3-15">Pipedrive is built around activity-based selling: each deal sits in a stage but progress depends on scheduled actions, and the system highlights deals with no upcoming activity, creating a workflow where every deal must have a next step.</cite> <cite index="8-21,8-22">A "rotting" feature highlights deals that stay in a stage too long, configurable by number of days.</cite>

→ **Decision:** Every deal card shows its next action, or an explicit "No next step" warning state. Stale deals get a rot indicator.

**Stage count and forecasting.** <cite index="9-7">Guidance for teams is to start with 5–7 stages and turn on deal rotting from day one.</cite> <cite index="8-18,8-19,8-20">Stage probability estimates close likelihood, with per-deal probability overriding stage probability when both are enabled.</cite>

→ **Decision:** 6 stages. Column headers carry stage sum + weighted forecast.

**Mobile CRM lessons.** <cite index="6-1,6-2">Pipeline stages and key deal data in one swipeable panel reduces navigation between views and supports decision-making during calls.</cite> <cite index="6-17">User feedback flagged friction in multi-step actions within the deal pipeline.</cite> Notably, <cite index="6-19,6-20">many users preferred dark mode as a standard rather than optional theme.</cite>

→ **Decision:** Mobile Graha = swipeable stage panel, deal actions inline. Dark mode is a first-class theme, not an afterthought — matches the answer to ship both from the start.

---

## Ganit (Finance / GST) — Zoho Books, Tally, ClearTax

**Side-pane module nav is the expected shape.** <cite index="10-1">Zoho Books' interface is described as clean with easy navigation links on the side pane to quickly reach Sales, Purchases, Documents, Reports, Dashboard and Banking.</cite>

→ **Decision:** Ganit gets its own in-module tab rail (Invoices / Bills / Expenses / GST / Banking), not a flat page.

**The dashboard is receivables/payables/cash-flow first.** <cite index="17-3">Zoho Books' default dashboard widgets display total payables, receivables, due amounts, and a cash flow graph.</cite>

→ **Decision:** Ganit stat row = Receivables, Payables, GST liability, Cash position. Not vanity metrics.

**GST compliance is a hard field checklist, and a missing field has real consequences.** <cite index="15-14,15-15">Under GST an invoice is a legal record that determines tax liability and feeds GSTR-1 — a single missing field, wrong GSTIN, or incorrect place of supply fails e-invoicing validation, blocks the customer's ITC claim, or creates a return mismatch.</cite> Required fields: <cite index="15-2">Supplier GSTIN, Recipient GSTIN, HSN/SAC codes, Place of Supply, tax breakup with CGST/SGST/IGST separately, invoice number and date.</cite> Place-of-supply logic matters: <cite index="14-21">the system should automatically distinguish inter-state (IGST) from intra-state (CGST/SGST) based on the customer's GSTIN prefix.</cite>

→ **Decision:** The invoice sheet validates inline and shows a compliance checklist before send — errors surface pre-send, not post-rejection. Tax breakup always displays split, never a single "tax" line. Also worth surfacing: <cite index="16-7">the MSME 45-day payment rule under Section 43B(h)</cite> as an ageing flag on receivables.

**Prevent, detect, correct.** <cite index="14-11,14-12">TallyPrime's GST strength is flagging errors in GST numbers or tax rates before export, reducing the chance of a notice from the tax department.</cite>

→ **Decision:** Validation is a visible, dismissible banner state on the GST screen — not a silent toast.

---

## Manav (HRMS) + Vetana (Payroll) — Keka, greytHR

**The bilingual decision is validated by the market leader.** Keka ships <cite index="21-1">dark mode and multiple theme support, plus access in six languages including Hindi, Telugu, Tamil, Kannada</cite>. This is the strongest external signal that leaning further into Hindi-forward labelling is right, not risky.

→ **Decision:** Hindi-primary module names with English subtitles, as answered.

**One dashboard for the whole year plan.** Keka manages <cite index="21-1">the entire year plan via a single dashboard — holidays, leave applications, leave balances, compensatory offs, work from home and on-duty</cite>, and for managers, <cite index="21-1">who is on leave, birthdays and work anniversaries, and approving leave/attendance requests from a unified Inbox interface</cite>.

→ **Decision:** Manav = one screen with a year strip, balances, and team-on-leave today. Approvals route to the existing Approvals module rather than a separate HR inbox.

**Attendance is analytics, split by tab.** <cite index="20-6,20-7">Keka's attendance dashboard gives a complete view of attendance and leave trends, divided into four tabs.</cite> <cite index="20-9,20-12,20-13">Summary shows a snapshot plus historical data, a leave tab highlights leave data, and stats filter by department or location.</cite>

→ **Decision:** Manav tabs = Today / Attendance / Leave / Directory. Department + location filters in the toolbar.

**Field capture reality in India.** <cite index="18-7">Remote clock-in with GPS-tagged attendance and selfie verification.</cite> <cite index="22-1">Leave and attendance integrate directly with payroll so users don't switch systems to run monthly payroll.</cite>

→ **Decision:** Vetana reads from Manav's attendance — one continuous flow, with a visible "source: attendance" link on the payroll run.

---

## Prachar (Marketing) — Buffer, Hootsuite, Later

**The calendar is the product, and drag-to-reschedule is table stakes.** <cite index="28-1,28-2">Buffer's calendar allows rescheduling content via drag-and-drop, with colour-coded tags to organise content.</cite> <cite index="31-1">A strong calendar lets you drag-and-drop posts, colour-code campaigns, and see every channel at a glance.</cite>

**Week vs month views carry different information.** <cite index="27-11,27-12,27-13,27-14">Buffer shows channel-specific posts in both week and month views; Hootsuite shows post details in week view but in month view shows only status and counts, not which platforms.</cite>

→ **Decision:** Prachar month view shows channel dots per post; week view shows full post previews. Colour-coded campaign tags, drag to reschedule.

**Filtering is where these tools disappoint.** <cite index="28-11,28-12">Buffer's filtering is described as lacklustre, covering only drafts, scheduled and sent, compensated for by custom colour-coded tags.</cite> <cite index="28-13">The ability to leave calendar notes was called out as missing.</cite>

→ **Decision:** Filter by channel, campaign, status, and owner. Calendar notes included — a cheap win competitors skip.

---

## Sanvaad (Messaging) — Slack, Teams

**Threads belong in a right-hand pane, not inline.** <cite index="42-1,42-2">Slack's threads live in a "flexpane" that opens on the right side, started from a button next to a message.</cite> <cite index="41-5,41-6">A message with a thread shows a "4 replies" label, and clicking it opens the thread in the right sidebar without losing position in the main channel.</cite>

→ **Decision:** Sanvaad = channel list / message log / thread flexpane. Reply count is the affordance.

**Sidebar sections and unread weighting.** <cite index="35-6,35-7,35-8">Slack's sidebar is customisable — channels organise into labelled sections, drag to reorder, with per-conversation notification preferences and muting.</cite> <cite index="34-4">Channel names brighten on unread, and show a red count when you're mentioned.</cite>

→ **Decision:** Two unread weights — bold for unread, accent badge for direct mention. Sections are user-labelled.

**Threads vs announcements are different layouts.** <cite index="36-2">Microsoft positions a threaded layout for back-and-forth conversation and a posts layout for announcements.</cite>

→ **Decision:** Channels get a type: `discussion` (threaded) or `announce` (flat, no inline replies).

---

## Srijan (AI Hub) + the chatbot ask

The chatbot lands inside Sanvaad rather than as a separate module — the same message-log and composer primitives, with an assistant participant. This mirrors where the market is heading: <cite index="53-7">conversational agents that connect to business systems through prebuilt actions, driven by natural language</cite>, and <cite index="55-6">plain-language queries like "what's the status of the offer letter" returning instant answers.</cite>

→ **Decision:** Srijan chat is a channel in Sanvaad's sidebar (`# सहायक · Assistant`) with a distinct AI message treatment, suggested-prompt chips, and actions it can run against other modules.

---

## Dristi (Reports) — Metabase, Looker Studio

**Two genuinely different authoring models.** <cite index="50-13,50-14,50-15,50-16">Looker Studio is a reporting tool that presents data; Metabase is an analytics platform that lets people explore it.</cite> <cite index="50-17,50-18">Looker Studio's canvas editor feels like Google Slides — drag a chart, pick a data source, choose dimensions and metrics.</cite> <cite index="50-21,50-22,50-23">Metabase instead has you ask questions through a visual query builder: pick a table, filter, summarise, choose a visualisation.</cite>

**Users want chart creation inside the dashboard.** A standing Metabase request is <cite index="45-1,45-2">to create charts directly inside dashboard edit mode — choose a chart type then select dimensions and metrics — so users don't go back and forth between question and dashboard consoles.</cite>

→ **Decision:** Dristi uses the canvas model (drag chart onto a grid) **with** in-place chart configuration — deliberately avoiding the back-and-forth Metabase users complain about. Query builder is a panel inside the chart, not a separate screen.

---

## Hub (Client Portal) + eSign — DocuSign, Copilot.com

**Signing should never leave the product.** <cite index="52-1">Embedded signing puts the flow directly in your own web or mobile app so signers never have to leave your experience.</cite>

→ **Decision:** Kartavaya's signing route renders inside the Hub portal shell — no hand-off screen.

**Verify before send; summarise for the signer.** <cite index="54-1">Pre-send verification confirms recipient details before the agreement goes out.</cite> <cite index="54-2">AI-generated summaries and built-in Q&A give signers clarity so they can sign with confidence.</cite>

→ **Decision:** eSign send flow = recipient verification step, then an auto-summary block shown to the signer above the document. Audit trail is a timeline, not a table.

---

## What this changes versus the brief

Three places where research overrode my initial plan:

1. **Graha opens on pipeline, not contacts** — contact-centric would have been the wrong default at SMB scale.
2. **Ganit needs an in-module tab rail** — treating a finance module as one page can't hold invoices, bills, GST, and banking.
3. **Dristi merges the two BI models** rather than picking one, specifically to avoid the console-switching complaint that's the top request against Metabase.

One place it confirmed a user answer: **Hindi-forward labelling and standard dark mode** are both validated by what Keka and Pipedrive users actually ask for.

---
---

# Part 2 — What users actually complain about

Vendor marketing says what a product does well. Support forums and review sites say where the design fails. This section is sourced from Zoho's own community, G2/Capterra/Techjockey review bodies, and community guides.

## The single biggest finding: keyboard-first is non-negotiable for Indian finance

Indian accounting runs on Tally, and Tally is a keyboard application. <cite index="98-5,98-6">In TallyPrime there are shortcuts for almost all functions, meaning the software can be used without touching the mouse — for faster data entry, navigation, report viewing, printing, and import/export.</cite> <cite index="91-2,91-3">Relying only on the mouse to navigate makes work noticeably slower, which is the problem shortcut keys solve.</cite> One practitioner guide puts the saving at <cite index="96-6">30–40% of daily working time for accountants, CA firms, business owners and Tally operators.</cite>

Two specific interaction patterns Tally-trained users expect: <cite index="96-1">Esc used frequently to move back step-by-step without the mouse</cite>, and <cite index="96-2">Alt+C to instantly create a ledger that doesn't exist without leaving the voucher screen.</cite> The reason it matters: <cite index="97-12,97-13,97-14">real accounting work means thousands of vouchers, bills, report checks and GST adjustments, and using the mouse each time wastes time.</cite>

→ **Decision (changes the design):** Ganit gets a full keyboard layer, not a courtesy shortcut or two.
- Single-key hot keys when no field is focused, mirroring Tally's muscle memory rather than web convention.
- `Esc` walks back one level — out of a field, then out of the sheet, then out of the module. Never "closes everything."
- **Create-inline without leaving the screen:** typing an unknown customer/ledger name in the invoice sheet offers `⌥C Create` in place. This is the Alt+C pattern and it is the single highest-value borrow in this whole research pass.
- Every toolbar action shows its key on hover. The invoice sheet is fully completable without a mouse.

This also justifies a visible keyboard-shortcut sheet (`?`) — the repo already has `KeyboardShortcuts.jsx`, so the hook exists.

## Zoho tells us the failure categories in its own words

Zoho ran a usability survey asking users to report issues in named categories: <cite index="58-2">accessibility (features buried deep into modules), navigation (unable to reach a screen or module quickly), too many clicks, and complex screens.</cite> That is a vendor publishing its own four failure modes — a ready-made checklist to design against.

**Field overload is the specific mechanism.** A Zoho Books user's request: <cite index="61-2,61-3,61-4">unlike Zoho CRM, Zoho Books has no option to create sections or group fields, which results in a confusing UI with potentially overwhelming modules.</cite> The fix they ask for is conditional layout: <cite index="61-7,61-8,61-9">rules where selecting one dropdown value shows only fields A, B, C — so users see only relevant fields at any given time.</cite>

→ **Decision:** The Ganit invoice sheet is **progressively disclosed**, not one long form. Place-of-supply selection decides whether IGST or CGST/SGST fields even render. Optional blocks (PO number, project code, bank details) are collapsed sections, not always-on fields.

**And a warning about redesigns.** A thread title in Zoho's own community reads <cite index="62-1">"I hate the latest interface change - can I have the old one back"</cite>.

→ **Decision:** Ship the redesign behind the Appearance panel with the density/radius/translucency controls set so existing users can dial it *back* toward what they know. A redesign users can't tune is a redesign they'll resent.

## Monday.com / ClickUp — customisation is the thing that creates the clutter

This is the most consistent complaint in the whole set, and it's a design trap Kartavaya is directly exposed to as an all-in-one.

<cite index="86-3,86-8,86-9">"Easy to learn, but easily gets cluttered" — it's super easy to customise, but that's also where the main downside comes from: it's very easy to clutter things.</cite> On visual density specifically: <cite index="88-10,88-11">the UI, while attractive, is very cluttered — too many buttons, gears, dropdowns, and several of them tend to duplicate each other.</cite> A Capterra reviewer on findability under pressure: <cite index="87-7">the interface is very cluttered with too many active boards, and it gets difficult to find an item during a busy period or when you're under pressure.</cite>

Two more that matter: <cite index="87-3">notifications tend to be overwhelming in quantity and hard to curate properly, and search isn't as targeted as users want.</cite> And on the cost of unlimited flexibility: <cite index="89-2">a very lengthy onboarding process due to the endless options for customization.</cite> Even ClickUp's own comparison concedes <cite index="83-9">its clean-slate approach and vast range of options can overwhelm new users and small teams.</cite>

→ **Decisions:**
- **No duplicated affordances.** One way to do each thing per screen. The gear/dots/dropdown pile-up is an explicit anti-pattern for this design — if an action exists in the toolbar it does not also get a row-hover button and a context menu entry.
- **Opinionated defaults over configurability.** Kartavaya ships each module with one correct default view. Customisation is available but not required to be productive on day one — this is the answer to the onboarding complaint.
- **Notifications get curation, not just delivery** — grouped by module with per-module mute, since "overwhelming in quantity and hard to curate" is the actual failure, not volume alone.
- **Search must be scoped.** Global search offers module scoping chips (`in: ग्रह`, `in: गणित`) rather than one undifferentiated result list.

## Keka — where the market's best-designed Indian HRMS still hurts

Keka is the UI benchmark for this audience, so its complaints are the most instructive.

<cite index="70-14,70-15">Navigation is called out as occasionally complex: modules like attendance corrections and leave approvals require multiple clicks and feel time-consuming.</cite> <cite index="70-16">The mobile app sometimes lags or fails to sync instantly, which frustrates field employees who rely on it.</cite> New users report <cite index="69-12">that it may initially seem overwhelming, and getting familiar with the features took time.</cite> One review is blunt that <cite index="72-11">the interface doesn't look like a modern UI.</cite>

A competitor's reviews surface a hit-target bug worth stealing the lesson from: <cite index="68-8">icons between two modules sit too close to each other</cite>, alongside <cite index="68-3">having to switch between two modules to find reporting that only exists in one of them.</cite>

→ **Decisions:**
- **Attendance correction and leave approval are one-click from where you see the problem** — inline on the row, not a detail-page round trip. These are the two flows Keka users name.
- **48px minimum touch targets and 8px minimum gap between adjacent icon buttons**, mobile and desktop alike. The "icons too close" complaint is a spacing spec, and it's now in the token layer.
- **Offline-tolerant mobile clock-in:** optimistic local state with a visible "syncing" chip rather than a spinner that blocks, because the sync lag is the named frustration.
- **Manav and Vetana share one report surface** so nobody hunts across two modules for one number.

## Slack — sidebar noise is two different problems

Directly relevant, because Kartavaya's sidebar carries 15 modules and Sanvaad adds channels underneath.

<cite index="76-5,76-6,76-7,76-8">Most teams hit a wall around 50–100 channels: the sidebar becomes a wall of noise, people stop reading channels they should read, and new hires have no idea where to ask what.</cite> The often-cited stat: <cite index="76-10,76-11">employees spend around 9 hours a week in Slack yet 43% frequently struggle to find information they know exists — friction that is almost always a structure problem, not a search problem.</cite>

The important distinction: <cite index="76-13,76-14">sidebar clutter is a per-user problem needing tools to manage what you see, while channel sprawl is a team problem of inconsistent naming where nobody knows which channels are active versus abandoned.</cite> And <cite index="76-16">individual tricks like starring and muting only treat the symptom.</cite>

The power-user fix is a default worth adopting: <cite index="79-8,79-9">showing only "my unread, along with everything I've starred" removes all channels with no activity from the sidebar</cite>, which <cite index="79-13">turns the sidebar into a draft of a to-do list.</cite>

→ **Decisions:**
- Sanvaad's channel list defaults to **unread + starred**, with "show all" as a deliberate act. This is the single best design borrow for the chat module.
- **Archived channels are visually distinct**, addressing "which are active versus abandoned."
- The **module** sidebar stays fixed and grouped (Workspace / Revenue / People / Growth / Clients) — it must never grow into a user-managed list, or Kartavaya inherits the 50-channel wall at the navigation level.

## Pipedrive — what users actually love, worth copying

One G2 quote captures why the activity model works: <cite index="100-4">"It's like having an assistant, telling me what to do every day."</cite> <cite index="101-3,101-4">The intuitive interface makes it easy to monitor deal progress and set reminders, keeping teams organised so opportunities don't slip through.</cite> Small touches land too — <cite index="101-6">deal win animations add a fun element</cite>, though those users <cite index="101-6">sometimes seek more robust analytics.</cite>

A caution for mobile: <cite index="103-4">the mobile app isn't as powerful as the desktop version</cite> — a common and avoidable failure.

→ **Decisions:** Graha's "no next step" warning state is the assistant voice made visible. A restrained win moment on stage-to-Won (a single spring transition, no confetti — wrong register for a firm handling money). And mobile Graha gets the same actions as desktop, not a cut-down viewer.

---

# The design rules this research produces

Everything above collapses into eight rules the redesign is held to:

1. **Keyboard-complete finance.** Ganit is operable end-to-end without a mouse, including inline record creation. *(Tally)*
2. **One affordance per action per screen.** No gear + dots + dropdown stacks. *(Monday/ClickUp)*
3. **Progressive disclosure over long forms.** Conditional fields; collapsed optional blocks. *(Zoho Books)*
4. **Opinionated default view per module.** Configurable, but productive before configuration. *(ClickUp onboarding)*
5. **Unread + starred by default** in any user-growable list. *(Slack)*
6. **48px targets, 8px minimum gap** between adjacent controls. *(Info-Tech icon spacing)*
7. **One-click correction from the row where the problem is visible.** *(Keka)*
8. **The redesign must be dial-back-able** via Appearance. *(the "give me the old one back" thread)*

---
---

# Part 3 — The SME tier: who Kartavaya actually competes with

The giants set patterns, but they are not who a small Indian firm chooses between. The real shortlist is Vyapar, myBillBook, Khatabook, OkCredit, Refrens, Munim, Zoho Bigin and Kylas. This tier taught me more than Parts 1 and 2 combined, because its constraints are Kartavaya's constraints.

## Radical simplicity is the winning strategy, not a compromise

Bigin's positioning is explicit: <cite index="119-2,119-3">the core philosophy is radical simplicity — it strips away the extraneous features that overwhelm small teams and focuses intensely on the essentials.</cite> The reason this matters commercially is the sharpest line in the entire research pass: <cite index="118-1">this simplicity helps ensure the CRM actually gets used, instead of becoming another system that's updated sporadically or avoided altogether.</cite>

Users arrive at this tier *fleeing* the giants. One review notes loving <cite index="116-9,116-10">the simplicity and intuitive design, having previously used HubSpot which was very complicated.</cite> Another: <cite index="119-10">many traditional CRMs are built for large enterprises, featuring a bewildering array of functions that are overkill for a solopreneur or small team.</cite> The bar for time-to-value: <cite index="116-18">reps get productive within a day without extensive onboarding.</cite> And the balance to hit: <cite index="117-5">exactly the right balance of features without being overwhelming.</cite>

→ **Decision — this is the biggest one in the document.** Kartavaya is a 15-module all-in-one, which puts it structurally on the wrong side of this finding. The design must therefore **hide scale by default**:
- **Modules are opt-in per organisation.** A CA firm that bought GST + tasks sees 4 sidebar items, not 15. The nav renders only purchased-and-enabled modules. This is now the single most important structural decision in the redesign.
- **Each module has one default view** and no configuration required before first use.
- The Appearance panel's density control lets a power user go dense — but the *default* is calm.

An all-in-one that looks like an all-in-one loses to Bigin. An all-in-one that looks like a focused tool wins on breadth later.

## Offline-first is a switching reason, not a feature

This is a hard requirement I would have missed entirely. A Techjockey reviewer states their switch plainly: <cite index="106-5,106-6">the offline version of myBillBook was missing and that's why I switched to Vyapar — it's more convenient to have billing software that can be used without an internet connection.</cite> Vyapar markets on exactly this axis: <cite index="107-11">local language support, cloud and offline-first reliability, and solutions designed around how SME owners actually do business.</cite> The sync expectation is bidirectional and casual: <cite index="107-14,107-15">check stock on the app while travelling; reach the shop and the desktop billing system is synced.</cite>

And the fear that drives it is concrete. One case study: a hardware shop billing on an old desktop with no backup lost its hard drive, <cite index="110-3,110-4,110-5,110-6">losing three days of invoices — the CA charged ₹6,400 to reconstruct GSTR-1 from supplier records, and two customers refused to pay because duplicate bills couldn't be produced</cite>, <cite index="110-7">costing about ₹38,000 over one weekend.</cite>

→ **Decisions:**
- **Every write is optimistic with a visible sync state.** A persistent, quiet sync chip in the toolbar: `Synced · 2m ago` / `3 changes pending` / `Offline — saved locally`. Never a blocking spinner, never silent failure.
- **Invoice creation must complete offline** and queue. This is the one flow that cannot depend on connectivity.
- **Backup status is surfaced, not buried in settings** — a line in the Ganit header. The anxiety is real and addressing it visibly is a trust feature.

## Vernacular is the norm at this tier — which fully vindicates going Hindi-forward

Khatabook operates <cite index="137-1">with 50M+ downloads and 13 languages</cite>, and at the app level <cite index="135-10">both Khatabook and OkCredit work in Hindi and most regional languages.</cite>

This settles the earlier question decisively. Hindi-forward labelling isn't a brand flourish — it is table stakes in this segment, and the market leader ships 13 languages.

→ **Decision:** The bilingual pairing stays primary as answered, and the token layer treats Devanagari as a first-class script (`--font-hindi` with its own sizing, since Devanagari needs more vertical room than Latin at the same optical size). Language is a per-user setting alongside theme, and the existing `data-language` hook in `kartavaya-design.css` already supports `en` / `hi` / both — the redesign keeps and extends it rather than replacing it.

## Staff roles exist so juniors can't see the money

The 4-tier RBAC in the brief has a specific, concrete purpose at this tier. Khatabook layers on <cite index="135-2">staff accounts so a shop helper can log entries without seeing financials.</cite> Vyapar frames it as <cite index="107-17,107-18">sales staff creating bills on their own logins, with the owner relaxed because role-based access was given.</cite> Refrens extends it to the accountant: <cite index="123-17,123-18">invite your accountant, CA, or team with role-based permissions — control access, track changes with audit trails, and collaborate without messy spreadsheets or email threads.</cite>

→ **Decisions:**
- **Role is visible in the shell, always.** The sidebar footer shows role explicitly, because "what can this person see" is the owner's live question.
- **Financial figures are the gated thing**, specifically. A `member` sees tasks and their own entries; totals, margins and payroll are masked with an explicit lock affordance rather than hidden entirely — the owner needs to *see* that gating is working.
- **The CA is a first-class invited role**, not a generic guest — with GSTR export and audit-trail read. This is a differentiator the giants don't frame this way.

## Price sensitivity shapes the interface

myBillBook's entry plan is <cite index="110-27">₹33/month for Android-only basic billing, with web and iOS access starting at ₹2,599/year.</cite> Bigin's Express plan runs <cite index="114-12">around ₹400/month per user.</cite> Kylas competes by removing seat maths entirely: <cite index="114-6">unlimited user access at a fixed price, an excellent choice for growing teams with budget constraints.</cite> And the pain is stated directly: <cite index="115-19">cost for one seat is too much for a small business not yet doing regular deals.</cite>

→ **Decisions:**
- **Never let a locked feature be a dead end.** Gated features render in place with an inline upgrade affordance showing what it does — not a modal wall.
- **Mobile cannot be the cheap tier.** At ₹33/month for Android-only, mobile is where price-sensitive users live. Mobile Kartavaya gets full write capability, per the Pipedrive lesson in Part 2.

## WhatsApp is the real communication layer

Not a nice-to-have. OkShop was built so merchants can <cite index="130-1">set up online stores, create product catalogues and share inventories and offerings on WhatsApp</cite>, and <cite index="130-7">get an instant store with WhatsApp integration.</cite> Khatabook ships <cite index="135-2">built-in WhatsApp</cite> alongside staff accounts and reports. Even the buying decision travels that way — the shortlist names <cite index="110-11">keep surfacing in WhatsApp shopkeeper groups and CA recommendations.</cite>

→ **Decision:** Send actions default to WhatsApp, with email secondary — inverting the Western default. Invoice send, payment reminder, approval request, and eSign delivery all offer WhatsApp first. This matches the DocuSign multi-channel finding in Part 1 and the market reality here.

## Migration from Tally is the on-ramp

Vyapar sells on it: <cite index="107-6">import and export Tally data easily, allowing seamless transfer from Tally so businesses can switch without losing records.</cite> Munim frames its whole value as being for <cite index="121-14">businesses seeking to reduce reliance on legacy software like Tally and gain real-time financial visibility.</cite> One analysis describes Khatabook as <cite index="136-2">removing the blandness and technical know-how that Tally mandates, replacing it with an easy-to-use interface.</cite>

But note the trap in the same tier: Munim's own reviewers warn that <cite index="121-4">businesses with complex inventory may find the initial system configuration time-consuming.</cite>

→ **Decisions:** A Tally import step in first-run onboarding, and a permanent Tally export in Ganit. Onboarding is **three screens maximum** with everything else deferred to in-context prompts, because configuration burden is the named killer.

## Two smaller borrows worth taking

**OCR capture instead of typing.** Vyapar users <cite index="107-4">scan and convert purchase invoices into digital entries instantly with an OCR scanner, saving time and reducing manual data-entry errors.</cite> Refrens ships <cite index="127-5">an AI accounting assistant with OCR for data capture and GST reconciliation.</cite>
→ Bill entry in Ganit leads with **Scan / Upload**, with manual entry as the secondary path.

**Auto-detect GST rather than asking.** Refrens <cite index="123-14">auto-detects GST types, generates e-invoices and e-way bills, reconciles GSTR-2B and tracks ITC from the dashboard</cite>, and lets users <cite index="123-15">export filing-ready GSTR-1, 2B and 3B in one click or share them directly with their CA.</cite>
→ Kartavaya derives IGST vs CGST/SGST from the GSTIN prefix silently and shows the result as a confirmable chip — never a dropdown the user has to reason about. **Share with CA** is a primary button on the GST screen.

---

# Revised rule set — all three parts

The eight rules from Part 2, plus five that only the SME tier revealed:

9. **Hide scale by default.** Only enabled modules render. An all-in-one must feel like a focused tool. *(Bigin)*
10. **Offline-capable writes with a visible sync state.** Invoicing works with no connection. *(Vyapar)*
11. **WhatsApp-first delivery** for every outbound action. *(Khatabook / OkShop)*
12. **Gated features show their value in place** — no dead ends, no modal walls. *(seat-cost sensitivity)*
13. **Derive, don't ask.** GST type, place of supply, tax split are computed and shown as confirmable, not selected. *(Refrens)*

And rule 1 gets stronger: Ganit must satisfy **both** the Tally-trained keyboard operator *and* the shopkeeper who wants Khatabook's simplicity. Those are two different users on one screen — resolved by the density setting plus a keyboard layer that is invisible until used.

---
---

# Part 4 — Global small vendors selling all-in-one to small businesses

This is the closest competitive mirror Kartavaya has: small companies, not giants, selling *breadth* to small businesses. Flowlu, SuiteDash, Agiled, Bonsai and HoneyBook are structurally the same bet Kartavaya is making. Their reviews are therefore the most direct warning available.

## Flowlu is the cautionary tale, and it is Kartavaya's exact shape

Flowlu is an all-in-one covering <cite index="138-1">task and project management, client and lead tracking, invoicing, team collaboration and knowledge sharing in one workspace</cite> — sold to small businesses by a small vendor. Precisely Kartavaya's proposition.

The criticism is unambiguous and it is about the interface: <cite index="140-2,140-3">Flowlu packs a lot into the screen, and users consistently describe the UI as cluttered and overwhelming — if interface quality matters to your team's productivity, this is a real issue.</cite> On the project module specifically: <cite index="141-10">too overpacked and overwhelming, with so many project types, features and automations that the whole thing ends up confusing and requiring a lot of time to set up properly.</cite>

And the onboarding number is genuinely alarming: <cite index="141-3,141-4,141-5">Flowlu's onboarding has as many as 52 steps to complete right after sign-up — one of the most extensive seen — saved only by each step being explained or linked to a help article.</cite>

A paying customer names the fix themselves: <cite index="143-6,143-7">Flowlu could improve — the customization options can be overwhelming and confusing, so industry-specific templates would be helpful.</cite>

→ **Decisions:**
- **Industry presets replace configuration.** First-run offers *CA firm · Legal practice · Agency · Trading / retail · Consultancy*. Choosing one enables the right modules, sets task categories, invoice fields, and approval chains. This is the single most actionable idea in Part 4 — the user asked for it of a competitor and the competitor didn't ship it.
- **Onboarding is hard-capped at three screens.** Anything else becomes a contextual prompt at the moment of need. 52 steps is the anti-pattern; 3 is the spec.
- **"High-signal, low-noise" is the stated design target.** Agiled positions directly against Flowlu on <cite index="140-5">clean spatial zoning with a high-signal, low-noise design</cite> versus <cite index="140-6">a dense layout users describe as cluttered and overwhelming.</cite> That phrase is now the review criterion for every Kartavaya screen: if a screen can't be described as high-signal and low-noise, it isn't done.

SuiteDash lands the same way even when liked: <cite index="144-1,144-2">at first it seems a bit overwhelming to get your head around the solution with the multiple tools — there are training videos, but it asks time to invest in knowledge acquisition.</cite> Needing training videos to survive first contact is a design failure, not a support strategy.

## Multi-entity data isolation is a trust requirement, not a permissions detail

A Flowlu reviewer's concern is specific and serious: <cite index="143-8,143-9">a lack of data isolation between different organisations managed in Flowlu — assigned admins can see all CRM contacts and financial data — with a preference for each company to be connected separately.</cite>

This is directly relevant: Kartavaya is multi-tenant with a Hub for client organisations, and the repo already has `AdminOrgsPage` and a 4-tier RBAC.

→ **Decision:** The **active organisation is always visible in the shell**, not buried in a settings menu — an org chip in the toolbar beside the breadcrumb. Cross-org data never appears in one list without an explicit, labelled "All organisations" mode. For a firm handling several clients' books, ambiguity about whose data is on screen is a liability.

## What the well-reviewed ones do right: restraint plus fast time-to-value

Bonsai earns the opposite verdict from Flowlu. Users report <cite index="146-1">visual clarity and easy navigation when managing contracts, invoices and proposals</cite>, and <cite index="146-15">a clean interface, customisable templates, and onboarding that takes minimal effort.</cite> One comparison frames the philosophy plainly: <cite index="149-19">it's basic — not overstuffed with features, but solid at the basics.</cite>

Time-to-value is measured in minutes at this tier: <cite index="147-1">onboarding for both Bonsai and HoneyBook takes about 30 minutes to set up templates, payment methods, and a first workflow or contract.</cite>

The client portal pattern is also settled — and it matches what Kartavaya's Hub should be: <cite index="153-11">a branded client portal where clients view communications, contracts, files, invoices and upcoming payments in a single place</cite>, giving <cite index="153-10">self-service access to files and billing without back-and-forth emails.</cite> Bonsai adds <cite index="153-9">real-time project visibility including progress updates, time tracking and billing information.</cite>

There's also a neat automation idea worth borrowing: <cite index="146-4">once a client pays, their account and portal are created automatically and onboarding starts right away</cite>, and <cite index="151-10">linking proposal to contract to invoice so a client reviews scope, signs, and pays a deposit in sequence.</cite>

→ **Decisions:**
- **Hub is one page**, not a module with tabs: status, documents, invoices, approvals, next payment. Client-side surfaces get *less* chrome than internal ones.
- **Quote → eSign → Invoice is one continuous flow** with shared state, not three modules the user stitches together. This connects Vikray, eSign and Ganit through a single object and is the most valuable cross-module flow in the product.
- **Paid approval auto-provisions the client's Hub access.** A small automation that removes a manual step at the exact moment of goodwill.

## One more caution: breadth is only credible if the basics are solid

Two failure reports worth heeding. On SuiteDash: <cite index="144-6,144-7">"After trying to use it for months, I've abandoned this software. WAY too buggy and frustrating; settings disappearing, clients not able to complete payment."</cite> On Bonsai: <cite index="146-16">the problems show up in payment processing delays, slow customer support, and limited accounting depth.</cite> And on Flowlu's support: <cite index="142-5">bugs reported and questions going unanswered for long periods while "waiting for a response from development team".</cite>

→ **Design implication:** the UI must **never lie about state**. Every async action gets an explicit outcome — saved, queued, failed with a retry. "Settings disappearing" and payments silently not completing are what destroy trust in an all-in-one, and both are surfaceable in the interface. This reinforces the sync-state chip from Part 3: it isn't decoration, it's the antidote to the top complaint against this whole category.

---
---

# Final rule set — the eighteen rules

**Clarity and density**
1. High-signal, low-noise per screen. If it can't be described that way, it isn't finished. *(Agiled vs Flowlu)*
2. One affordance per action per screen — no gear + dots + dropdown stacks. *(Monday/ClickUp)*
3. Progressive disclosure over long forms; conditional fields, collapsed optional blocks. *(Zoho Books)*
4. 48px targets, 8px minimum gap between adjacent controls. *(Info-Tech)*

**Scale and onboarding**
5. Hide scale by default — only enabled modules render. *(Bigin)*
6. Industry presets instead of configuration. *(the Flowlu reviewer's own request)*
7. Onboarding capped at three screens; everything else contextual. *(Flowlu's 52 steps)*
8. One opinionated default view per module, productive before configuration. *(ClickUp)*

**Speed and input**
9. Keyboard-complete finance, including inline record creation. *(Tally)*
10. Derive, don't ask — GST type, place of supply, tax split computed and confirmable. *(Refrens)*
11. Scan/OCR before manual entry on bill capture. *(Vyapar)*
12. One-click correction from the row where the problem is visible. *(Keka)*

**Trust and state**
13. Offline-capable writes with a visible sync state; invoicing never blocks on connectivity. *(Vyapar)*
14. Never lie about state — every async action resolves to saved, queued, or failed-with-retry. *(SuiteDash)*
15. Active organisation always visible; no unlabelled cross-org lists. *(Flowlu isolation)*
16. Role visible in the shell; financial figures are the gated thing. *(Khatabook staff accounts)*

**Reach**
17. WhatsApp-first delivery for every outbound action. *(Khatabook / OkShop)*
18. Mobile has full write capability — it is not the cheap tier. *(Pipedrive + myBillBook pricing)*

Plus two standing constraints from the answers: **both themes from the start**, and **the redesign must be dial-back-able** through the Appearance panel.
