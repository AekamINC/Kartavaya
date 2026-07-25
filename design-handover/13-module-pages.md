# 13 · Module pages

Prereq: `00-tokens.md`, `01-navigation.md`, `02-common-components.md`, `04-boards-table-views.md`. Access gating in `RBAC-SPEC.md`.

Design source: `ScreensBiz.jsx`, `ScreensMore.jsx`, `ScreensThin.jsx`, `ScreensWork.jsx`.

**Scope note, stated plainly:** I did not read `GrahaPage.jsx`, `GanitPage.jsx` or `ManavPage.jsx` in full — they are 150 KB, 125 KB and 133 KB respectively, and reading three files of that size would have consumed the budget for the rest of the handover. So this file specifies the **shared chrome** every module page uses, the file-structure change they all need, and the per-module screens from the design. It does **not** carry line-level before/after for those three. Whoever implements Graha should expect surprises inside it that this document does not predict.

---

## The finding: the module pages are unmaintainable

| Page | Bytes | Roughly |
|---|---|---|
| `GrahaPage.jsx` | 150,309 | ~4,000 lines |
| `ManavPage.jsx` | 132,618 | ~3,500 lines |
| `GanitPage.jsx` | 124,938 | ~3,300 lines |
| `HubDashboardPage.jsx` | 71,661 | ~1,900 lines |
| `HubClientDetailPage.jsx` | 67,627 | |
| `OrgSrijanPage.jsx` | 66,710 | |
| `PracharPage.jsx` | 51,723 | |
| `ReportsPage.jsx` | 36,722 | |
| `DristiPage.jsx` | 29,042 | |
| `HubSkillsPage.jsx` | 28,043 | |
| `EsignPage.jsx` | 17,914 | |

Nothing in this handover can be applied safely to a 150 KB single-file component. A restyle touches every tab, every table, every form in that file at once; the diff is unreviewable and the blast radius is the entire module.

**The codebase already contains the pattern for fixing this.** `ClientBoardPage.jsx` is 138 bytes, `ClientPortal.jsx` is 125, `ClientProjectsPage.jsx` is 137 — thin route files that re-export from `ClientPagesImpl.jsx`. Extend that idea one step further: a route file, and a directory of tab components.

```
pages/GrahaPage.jsx                 route + tab shell, ~120 lines
pages/graha/ContactsTab.jsx
pages/graha/CompaniesTab.jsx
pages/graha/DealsTab.jsx
pages/graha/ActivityTab.jsx
pages/graha/ContactDrawer.jsx
pages/graha/useGraha.js             data hooks, shared
```

Do this split **before** applying any styling. It is the prerequisite, not a nice-to-have.

---

## 1 · Shared chrome — exact CSS

Every module page is the same five parts: header, tabs, KPI strip, content, empty state. One stylesheet, fifteen pages.

### Module header

```css
.mh{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-bottom:15px;border-bottom:1px solid var(--outline-variant);margin-bottom:18px}
.mh__ic{width:38px;height:38px;border-radius:var(--r-sm);display:grid;place-items:center;background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--c);flex-shrink:0}
.mh__t{display:flex;align-items:baseline;gap:9px}
.mh__en{font-family:var(--font-display);font-size:25px;font-weight:400;letter-spacing:-.024em}
.mh__hi{font-family:var(--font-indic);font-size:15px;color:var(--primary)}
.mh__sub{font-size:12.5px;color:var(--on-surface-3);margin-top:3px}
.mh__act{margin-left:auto;display:flex;gap:8px;align-items:center}
```

`--c` is the module's accent, set per page from `moduleColors.js` (`01-navigation.md`). English at 25px display, Hindi at 15px beside it — the same weighting rule as the sidebar (`01-navigation.md`): English carries the hierarchy, Hindi accompanies.

### Tabs

```css
.mt{display:flex;gap:2px;overflow-x:auto;border-bottom:1px solid var(--outline-variant);margin-bottom:18px;scrollbar-width:none}
.mt::-webkit-scrollbar{display:none}
.mt__b{position:relative;padding:9px 15px;font-size:13px;font-weight:500;color:var(--on-surface-3);white-space:nowrap;flex-shrink:0;transition:color var(--dur-fast)}
.mt__b:hover{color:var(--on-surface)}
.mt__b.on{color:var(--on-surface);font-weight:600}
.mt__b.on::after{content:'';position:absolute;left:12px;right:12px;bottom:-1px;height:2px;border-radius:1px 1px 0 0;background:var(--primary)}
.mt__n{margin-left:6px;font-family:var(--font-mono);font-size:10.5px;color:var(--on-surface-faint)}
```

`flex-shrink: 0` on the tab and `overflow-x: auto` on the strip — a module with seven tabs must scroll, never compress to unreadable slivers. And per the rule in `MOTION-SPEC.md`: a scrolling tab strip needs a visible edge fade so it is discoverable, because a hidden scrollbar plus no fade is a nav that looks complete but isn't.

### KPI strip

```css
.mk{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px;margin-bottom:18px}
.mk__c{padding:13px 15px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--outline-variant)}
.mk__l{font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-3);font-weight:700}
.mk__v{font-family:var(--font-display);font-size:25px;font-weight:400;letter-spacing:-.028em;margin-top:6px;font-variant-numeric:tabular-nums}
.mk__d{font-size:11px;margin-top:3px;display:flex;align-items:center;gap:4px}
.mk__d--up{color:var(--ok)}.mk__d--dn{color:var(--danger)}
```

Every rupee figure gets `tabular-nums` and `toLocaleString('en-IN')` — Indian grouping is 2,2,3 (`₹5,01,500`), not 3,3,3. Getting this wrong is immediately visible to every user of this product.

### Data table

Reuses `.tb` from `04-boards-table-views.md` verbatim. Module tables get two additions:

```css
.mtbl__num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--font-mono);font-size:12.5px}
.mtbl__tot{font-weight:700;background:var(--s-low)}
```

Numeric columns right-align. A left-aligned column of rupee amounts cannot be scanned for magnitude, which is the only reason anyone looks at a column of rupee amounts.

### Empty and restricted states

```css
.mempty{padding:44px 24px;text-align:center;max-width:44ch;margin:0 auto}
.mempty__t{font-family:var(--font-display);font-size:19px;font-weight:400;margin:0 0 7px}
.mempty__p{font-size:13.5px;line-height:1.6;color:var(--on-surface-3);margin:0 0 17px;text-wrap:pretty}
.mrestrict{display:flex;gap:12px;padding:16px 18px;border-radius:var(--r-md);background:var(--s-container);max-width:64ch}
.mrestrict__ic{color:var(--on-surface-3);flex-shrink:0}
```

Restricted is **not** an error and must not be styled as one — no red, no warning triangle. A member without a Ganit grant seeing a red alert learns that something is broken; the correct message is neutral, names who can grant access, and offers the request action (`RBAC-SPEC.md`).

### Note blocks

Used throughout the module screens to state a constraint honestly:

```css
.note{padding:11px 13px;border-radius:var(--r-sm);font-size:12px;line-height:1.55;background:var(--s-container);color:var(--on-surface-2)}
.note--info{background:color-mix(in srgb,var(--primary) 8%,transparent);color:var(--on-surface-2)}
.note--warn{background:var(--warn-container);color:var(--warn)}
.note--danger{background:var(--danger-container);color:var(--danger)}
.note b{font-weight:600}
```

---

## 2 · The fifteen modules

Second screens are designed for all seven thin modules; the four heavy modules have their primary surfaces designed.

| Module | Hindi | Screens designed | Notable constraint stated in the design |
|---|---|---|---|
| Graha | ग्रह | Contacts, companies, deals pipeline | Deal stages are org-configurable, not fixed |
| Ganit | गणित | Invoices, outstanding, payment reminder | GST resolved from billing state: inter-state IGST, intra-state CGST+SGST |
| Manav | मानव | Directory, **leaves** | A leave crossing the payroll cut-off moves an unpaid day into that run — stated at approval time |
| Vetana | वेतन | Payslips, **statutory** | PF ECR, ESI, PT (Maharashtra), TDS 24Q; overdue tinted; "challan paid, return pending" is a distinct state |
| Dristi | दृष्टि | Reports, **pivot** | Row/column totals, and it says when rows are excluded because Ganit is own-records for your role |
| Srijan | सृजन | Generate, **credits** | Credits and rupees only — never provider cost or margin (that is platform-only, `11-platform-admin.md`) |
| Prachar | प्रचार | Campaigns, **templates** | Real Meta approval states including rejected, with Meta's reason verbatim |
| Hub | हब | Clients, **publish** | Task board and time entries off by default; the never-shared list is enforced server-side |
| eSign | हस्ताक्षर | Documents, **create** | OTP signing is valid under s.10A IT Act but is not a DSC — stated on the screen |
| Sanvaad | संवाद | see `06-sanvaad-varta.md` | |
| Varta | वार्ता | see `06-sanvaad-varta.md` | |
| Pahchan | पहचान | see `07-pahchan.md` | Does not exist in the codebase |
| Boards | पटल | see `04-boards-table-views.md` | |
| Approvals | अनुमोदन | request → pending → approve/decline, client forward | Decline is gated on a reason |
| Reports | प्रतिवेदन | Dristi is the module; Reports is its surface | |

Each thin module's second screen is the tab it is actually judged on — not a second list view. That was the point of choosing leaves for Manav and statutory for Vetana rather than another table of people.

---

## 3 · New files

```
frontend/src/styles/module.css                  the shared chrome above
frontend/src/lib/moduleColors.js                accent per module (01-navigation.md)
frontend/src/components/module/ModuleHeader.jsx
frontend/src/components/module/ModuleTabs.jsx
frontend/src/components/module/KpiStrip.jsx
frontend/src/components/module/RestrictedNote.jsx
frontend/src/components/module/Note.jsx
frontend/src/lib/inr.js                          en-IN grouping + tabular formatting
frontend/src/lib/gst.js                          IGST vs CGST+SGST from billing state
```

`lib/inr.js` and `lib/gst.js` exist as shared modules because both rules are currently reimplemented per page, and both are the kind of thing that is wrong in one place and right in four.

---

## 4 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `GrahaPage.jsx` | 150,309 | **Split first.** Then shared chrome, `.tb` tables, `lib/inr.js` |
| `ManavPage.jsx` | 132,618 | Split. Add the leaves tab with the payroll cut-off warning |
| `GanitPage.jsx` | 124,938 | Split. `lib/gst.js`; outstanding + reminder flow |
| `HubDashboardPage.jsx` | 71,661 | Split. Publish controls with the never-shared list |
| `HubClientDetailPage.jsx` | 67,627 | Split |
| `OrgSrijanPage.jsx` | 66,710 | Split. Credits against the real plan allowance (200/500/1000/2000) — **not** provider cost |
| `PracharPage.jsx` | 51,723 | Split. Real Meta template states |
| `ReportsPage.jsx` | 36,722 | Split. Pivot with totals + the exclusion note |
| `DristiPage.jsx` | 29,042 | Shared chrome; pivot |
| `HubSkillsPage.jsx` | 28,043 | Shared chrome |
| `AutomationsPage.jsx` | 22,911 | Shared chrome |
| `ScrapersPage.jsx` | 20,804 | Shared chrome. Scraper cost is platform-only |
| `ApprovalsPage.jsx` | 19,827 | See `08-rbac-screens.md` |
| `ProjectsPage.jsx` | 19,521 | Shared chrome |
| `ProjectBoardPage.jsx` | 19,708 | See `04-boards-table-views.md` |
| `EsignPage.jsx` | 17,914 | Shared chrome; create flow with the s.10A note |
| `SigningPage.jsx` | 13,152 | Public signer view — unauthenticated, needs its own minimal chrome |
| `ApprovePage.jsx` | 12,561 | Public approver view — same |
| `ClientPagesImpl.jsx` | 36,808 | Client portal — see `08-rbac-screens.md` |
| `InboxPage.jsx` | 6,486 | Shared chrome |
| `CategoriesPage.jsx` | 4,287 | Shared chrome |
| `ActivityFeedPage.jsx` | 7,174 | Shared chrome |

Six files in `pages/` were not enumerated (the listing capped at 40 of 46) — Vetana, Teams, Time and Varta pages are expected among them and should be checked before scoping.

---

## 5 · Endpoints

No new endpoints for the shared chrome. Per-module endpoints already exist under `/v1/<module>/…`; the two additions the designed screens need:

| Endpoint | For |
|---|---|
| `GET /v1/dristi/pivot?rows=&cols=&measure=` | the pivot, with an `excluded_count` field so the screen can say what it left out and why |
| `GET /v1/srijan/credits` | `{used, allowance, period_end}` — credits only, no cost fields |

The `excluded_count` field is the mechanism behind an honesty rule: a report that silently omits rows the viewer cannot see is a wrong number presented as a right one. The API has to tell the UI that it filtered, so the UI can say so.
