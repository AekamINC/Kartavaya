# Branch archive — every ref deleted on 2026-07-27

All 341 branches below were deleted after each was proven, by CONTENT rather
than by merge status, to hold nothing staging lacks. Two files existed only on
a branch and were recovered first: `_TENANCY-RLS-AUDIT.md` and
`agent-documents-print.md`.

To restore any one of them while the objects still exist:

```bash
git branch <name> <sha>
```

| SHA | Last commit | Branch | Subject |
|---|---|---|---|
| `a3bd82a70` | 2026-07-27 | `exports-tally-gstr1` | feat(ganit): Tally voucher XML and GSTR-1 outward-supply JSON exports |
| `e5f8a80aa` | 2026-07-27 | `fidelity/signingpage-esign` | fix(sign): the brand mark was 3.23:1 in dark for a stranger |
| `4f923fa6a` | 2026-07-27 | `audit/signingpage-security-a11y` | fix(sign): stop leaking the signing token, and close two gates on the  |
| `e938facb3` | 2026-07-27 | `audit/signingpage-behaviour` | fix(sign): a drawn signature no longer vanishes, and a blank one is re |
| `19035222f` | 2026-07-27 | `audit/colormix-contrast` | fix(a11y): the contrast gate could not see twelve color-mix rules |
| `dcae0fed6` | 2026-07-27 | `fix/pdf-font-contract-cost-report` | fix(documents): the cost report joins the font contract, so its Devana |
| `fee03498e` | 2026-07-27 | `mobile-test-coverage` | test(mobile): close the gap the A/B pass found, and report |
| `d2f170489` | 2026-07-27 | `agent-remaining-gaps` | fix: close the NOT VERIFIED list â€” Sanvaad's dead SQL, two admin con |
| `657da221c` | 2026-07-27 | `audit/responsive-a11y` | fix(a11y,responsive): reach the controls a phone and a keyboard could  |
| `fde66281b` | 2026-07-27 | `audit/contrast-dark-mode` | fix(a11y): the sidebar's faint text, three gradient fills and two focu |
| `fc40623eb` | 2026-07-27 | `wire-documents-gst` | feat(documents,ganit): make the six built documents reachable, and bui |
| `7b5a59b46` | 2026-07-27 | `audit/bilingual-devanagari` | fix(bilingual): repair a corrupted Devanagari string in the weekly dig |
| `8f79afa54` | 2026-07-27 | `audit/failure-states` | fix(states): a failed read stops rendering as an empty state |
| `b302172ce` | 2026-07-27 | `audit/payload-agreement` | fix(api): the two payload disagreements a static both-sides read found |
| `6d419223b` | 2026-07-27 | `audit/permission-gates` | fix(security): close a cross-org read in the dashboard deadlines widge |
| `95acbf7b3` | 2026-07-27 | `audit/reference-completeness` | docs(audit): six approved documents are built and unreachable |
| `d3ed7bdb7` | 2026-07-27 | `feat/vikray-pipeline-customers` | feat(vikray): restore the pipeline and customers tabs from the approve |
| `54b2d75cf` | 2026-07-27 | `verify-srijan-hub-workflow` | fix(srijan,workflow): six defects found by actually running the pages |
| `54fdfca71` | 2026-07-27 | `feat/doc-pagination-285mm` | feat(docs): break every generated document at a 285mm content budget |
| `96f77d053` | 2026-07-27 | `verify/pahchan-sanvaad-org` | fix(sanvaad): a failed load is not an empty one, on four surfaces |
| `39dded47e` | 2026-07-27 | `verify/graha-ganit-manav` | verify(graha/ganit/manav): first browser-verified pass, plus the Manav |
| `29f74a799` | 2026-07-27 | `verify/public-auth-surfaces` | fix(public): dark-mode accent, missing document link, and the Graha la |
| `c2744f961` | 2026-07-27 | `verify/vetana-vikray-dristi-prachar` | docs(verify): first rendered verification of Vetana, Vikray, Dristi, P |
| `ddafc52a3` | 2026-07-27 | `verify/emails` | docs(swarm): email verification â€” 38 templates, per-template verdict |
| `3ee82703d` | 2026-07-27 | `verify/mobile-design-pass` | fix(mobile): a failed fetch no longer reads as "nothing to do" |
| `62b195c39` | 2026-07-27 | `agent/documents-compliance` | feat(documents): GSTR-3B Table 4 onto the notified form; one brand lay |
| `ad1300923` | 2026-07-27 | `design/toplevel-pages-ae34f0` | design(top-level): convert the core workflow pages to tokens |
| `c82e52d13` | 2026-07-27 | `design/pahchan-org-marketing-a581fa` | design(pahchan/org/marketing): convert to tokens |
| `a8f2df26b` | 2026-07-27 | `design/documents-a1fbe9` | feat(documents): build six of the seven missing print documents |
| `6069961a0` | 2026-07-27 | `worktree-agent-a581fa5478505f2f2` | docs(gap): conversion round landed â€” 3,215 inline to 613 |
| `77e5ce3d0` | 2026-07-27 | `design-toplevel-pages` | merge(ganit): finance tab bodies converted, invoice is a drawer, PDF m |
| `b9f157c42` | 2026-07-27 | `design/ganit-tabs-aa46eb` | docs(swarm): Ganit tab conversion â€” 548 inline styles to 7, three li |
| `d85e7a205` | 2026-07-27 | `worktree-agent-a230b756b34f6b73c` | feat(graha): convert the CRM tab bodies to the design system |
| `50a156bc1` | 2026-07-27 | `design/srijan-hub-aa8dcf` | design(srijan/hub): split and convert the largest remaining cluster |
| `6adeb1763` | 2026-07-27 | `design/manav-tabs-a7c402` | docs(swarm): Manav tab conversion â€” 609 inline styles to 14, and fou |
| `b6f6c31a1` | 2026-07-27 | `worktree-agent-a1fbe9feb34c7f9db` | docs: gap register â€” the approved design vs what exists, against 15  |
| `cfdf4a40a` | 2026-07-27 | `worktree-agent-aa8dcfcbeb2a880de` | docs(coverage): close out the TaskDrawer item with what it actually wa |
| `52df19b49` | 2026-07-27 | `agent/vikray-split-restyle` | docs(vikray): the tab-spacing fix was superseded on the merge |
| `52df19b49` | 2026-07-27 | `origin/agent/vikray-split-restyle` | docs(vikray): the tab-spacing fix was superseded on the merge |
| `8da4b4ed7` | 2026-07-27 | `worktree-agent-a7cb25a131d57f34b` | docs(coverage): prachar done â€” 108 inline to 8, and what the metric  |
| `8da4b4ed7` | 2026-07-27 | `origin/worktree-agent-a7cb25a131d57f34b` | docs(coverage): prachar done â€” 108 inline to 8, and what the metric  |
| `76815ca29` | 2026-07-27 | `design/dristi-split` | Merge remote-tracking branch 'origin/staging' into design/dristi-split |
| `76815ca29` | 2026-07-27 | `origin/design/dristi-split` | Merge remote-tracking branch 'origin/staging' into design/dristi-split |
| `3a72f7c56` | 2026-07-27 | `worktree-agent-a615966120e8a31c5` | docs(swarm): Vetana report â€” what was built, and what was deliberate |
| `3a72f7c56` | 2026-07-27 | `origin/worktree-agent-a615966120e8a31c5` | docs(swarm): Vetana report â€” what was built, and what was deliberate |
| `b24848d17` | 2026-07-27 | `worktree-agent-a440a0149afb67e0d` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a440 |
| `b24848d17` | 2026-07-27 | `origin/worktree-agent-a440a0149afb67e0d` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a440 |
| `66419a5d3` | 2026-07-27 | `worktree-agent-a50b57c3e71a02207` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a50b |
| `66419a5d3` | 2026-07-27 | `origin/worktree-agent-a50b57c3e71a02207` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a50b |
| `0be2c1093` | 2026-07-27 | `worktree-agent-a77c8523c69cfc7ce` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a77c |
| `0be2c1093` | 2026-07-27 | `origin/worktree-agent-a77c8523c69cfc7ce` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a77c |
| `2afa672b2` | 2026-07-27 | `worktree-agent-aad819798d276041b` | fix(motion): one name for one state â€” the mobile drawer joins the ot |
| `2afa672b2` | 2026-07-27 | `origin/motion-overlay-exits` | fix(motion): one name for one state â€” the mobile drawer joins the ot |
| `63d63584b` | 2026-07-27 | `agent/biz-structure-a414c546` | test(invite): the accept-invite screen says Finance now, not Invoicing |
| `63d63584b` | 2026-07-27 | `origin/agent/biz-structure-a414c546` | test(invite): the accept-invite screen says Finance now, not Invoicing |
| `42869a683` | 2026-07-27 | `worktree-agent-a3900f1046ad06dab` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a390 |
| `42869a683` | 2026-07-27 | `origin/worktree-agent-a3900f1046ad06dab` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a390 |
| `119cbee9b` | 2026-07-27 | `design/boards-pixel-type` | docs(swarm): gates are green at the merge point â€” record what closed |
| `119cbee9b` | 2026-07-27 | `origin/design/boards-pixel-type` | docs(swarm): gates are green at the merge point â€” record what closed |
| `c0164c15c` | 2026-07-27 | `worktree-agent-aeceb4ef65b970747` | Merge branch 'staging' of https://github.com/kevalvshah/Kartavya into  |
| `c0164c15c` | 2026-07-27 | `origin/worktree-agent-aeceb4ef65b970747` | Merge branch 'staging' of https://github.com/kevalvshah/Kartavya into  |
| `23a60e85e` | 2026-07-27 | `worktree-agent-a7503caa41d7bdbbd` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a750 |
| `23a60e85e` | 2026-07-27 | `origin/worktree-agent-a7503caa41d7bdbbd` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a750 |
| `6d809b67d` | 2026-07-27 | `agent/biz-motion-ac57395f` | docs(motion): --ease-emph was retuned under me â€” re-measured on the  |
| `dd28a2d48` | 2026-07-27 | `origin/agent/biz-motion-ac57395f` | docs(motion): --ease-emph was retuned under me â€” re-measured on the  |
| `5080b77a2` | 2026-07-27 | `worktree-agent-af7bd37373528e6c3` | Merge remote-tracking branch 'origin/staging' into worktree-agent-af7b |
| `5080b77a2` | 2026-07-27 | `origin/worktree-agent-af7bd37373528e6c3` | Merge remote-tracking branch 'origin/staging' into worktree-agent-af7b |
| `16f1cd866` | 2026-07-27 | `worktree-agent-ae427fc5a788c7505` | test(tokens): the palette snapshot still holds the --outline that fail |
| `16f1cd866` | 2026-07-27 | `origin/worktree-agent-ae427fc5a788c7505` | test(tokens): the palette snapshot still holds the --outline that fail |
| `b8c59477b` | 2026-07-27 | `worktree-agent-a20600caf1f77d160` | docs(mobile): my Sheet lost to a better one, and the report says so |
| `b8c59477b` | 2026-07-27 | `origin/worktree-agent-a20600caf1f77d160` | docs(mobile): my Sheet lost to a better one, and the report says so |
| `75d07531c` | 2026-07-27 | `worktree-agent-acaf6b38c2219c9e3` | docs(components): the pixel and type lens, rendered and measured |
| `9c783b632` | 2026-07-27 | `design/boards-structure` | docs(boards): record what the gates cover and what a browser still has |
| `9c783b632` | 2026-07-27 | `origin/design/boards-structure` | docs(boards): record what the gates cover and what a browser still has |
| `8d06aa536` | 2026-07-27 | `worktree-agent-a242df4d81238a079` | fix(seg): the segmented control declared a transition nothing could tr |
| `4b64d6f39` | 2026-07-27 | `worktree-agent-a223d7419e17d715c` | fix(pahchan): the register's flag pills said "Requested" for a punch o |
| `5079b385a` | 2026-07-27 | `origin/worktree-agent-a242df4d81238a079` | test(ganit): cover the cash-position endpoint, and finish the report |
| `d5515b298` | 2026-07-27 | `agent/sanvaad-motion` | Merge remote-tracking branch 'origin/staging' into agent/sanvaad-motio |
| `d5515b298` | 2026-07-27 | `origin/agent/sanvaad-motion` | Merge remote-tracking branch 'origin/staging' into agent/sanvaad-motio |
| `d7664ec8c` | 2026-07-27 | `design/dashboard-tasks-pixel-type` | Merge remote-tracking branch 'origin/staging' into design/dashboard-ta |
| `d7664ec8c` | 2026-07-27 | `origin/design/dashboard-tasks-pixel-type` | Merge remote-tracking branch 'origin/staging' into design/dashboard-ta |
| `9f0834be5` | 2026-07-27 | `worktree-agent-a3fc117ebb0c9cc4e` | Merge remote-tracking branch 'origin/staging' into worktree-agent-a3fc |
| `87ffe8fdd` | 2026-07-27 | `worktree-agent-a3ad6dabc93081ccc` | docs(swarm): rebase onto staging â€” one finding went stale under me,  |
| `87ffe8fdd` | 2026-07-27 | `origin/worktree-agent-a3ad6dabc93081ccc` | docs(swarm): rebase onto staging â€” one finding went stale under me,  |
| `107fe490a` | 2026-07-27 | `design/mobile-pixel-type` | Merge remote-tracking branch 'origin/staging' into design/mobile-pixel |
| `314d624de` | 2026-07-27 | `worktree-agent-a6ba4eadde995acab` | fix(onboarding): eleven type values that only the rendered wizard coul |
| `8c35b1222` | 2026-07-27 | `worktree-agent-a7598cd25b39ffba4` | docs(swarm): re-measured after the rebase rather than trusting the con |
| `8c35b1222` | 2026-07-27 | `origin/worktree-agent-a7598cd25b39ffba4` | docs(swarm): re-measured after the rebase rather than trusting the con |
| `17d899829` | 2026-07-27 | `worktree-agent-aca8510438f14f616` | fix(sanvaad): the Devanagari apposition fell under the 11px floor its  |
| `46985518a` | 2026-07-27 | `origin/design/mobile-pixel-type` | Merge remote-tracking branch 'origin/staging' into design/mobile-pixel |
| `54f5ee6ad` | 2026-07-27 | `worktree-agent-a124b468e0049b3a9` | docs(design): the shell, element by element, with both sides on screen |
| `54f5ee6ad` | 2026-07-27 | `origin/worktree-agent-a124b468e0049b3a9` | docs(design): the shell, element by element, with both sides on screen |
| `4688f0e37` | 2026-07-27 | `worktree-agent-a449bcf61d1c3778e` | fix(motion): the .ix-* helpers disagreed with the components they repl |
| `11870b7ae` | 2026-07-27 | `design/settings-org-customize-pixel-type` | docs(design): measured settings/org/customization against the rendered |
| `11870b7ae` | 2026-07-27 | `origin/design/settings-org-customize-pixel-type` | docs(design): measured settings/org/customization against the rendered |
| `5f783530d` | 2026-07-27 | `fix/motion-boards-drawer` | fix(motion): the drawer's exit was a literal copy of a token that move |
| `5f783530d` | 2026-07-27 | `origin/fix/motion-boards-drawer` | fix(motion): the drawer's exit was a literal copy of a token that move |
| `ceda10104` | 2026-07-27 | `worktree-agent-a1ce58fa7bfe79d35` | docs(components): cross-check the table against check-component-parity |
| `ceda10104` | 2026-07-27 | `origin/worktree-agent-a1ce58fa7bfe79d35` | docs(components): cross-check the table against check-component-parity |
| `8ad289016` | 2026-07-27 | `worktree-agent-a6287eefd3f2c886c` | fix(build): staging did not compile â€” a JSX comment sat where an exp |
| `e9134b2a7` | 2026-07-27 | `worktree-agent-aa3c4d948f3001f3e` | docs(design): the mockups RUN, and nobody ran them |
| `e01a85a33` | 2026-07-27 | `merge/separated-duty` | chore(vetana): PROPOSED_071 is applied â€” the merge precondition is m |
| `d013aa6fb` | 2026-07-26 | `rescue/af3eb3c98064d2a74` | test(e2e): reconcile with 140 sibling commits; entitlement gate is now |
| `d013aa6fb` | 2026-07-26 | `origin/worktree-agent-af3eb3c98064d2a74` | test(e2e): reconcile with 140 sibling commits; entitlement gate is now |
| `fbd5f67e0` | 2026-07-26 | `worktree-agent-af9bec7a9ad900774` | docs(swarm): full report â€” search 404, motion fidelity, landing meas |
| `fbd5f67e0` | 2026-07-26 | `origin/worktree-agent-af9bec7a9ad900774` | docs(swarm): full report â€” search 404, motion fidelity, landing meas |
| `8ba28a983` | 2026-07-26 | `rescue/a0e4d12c53e200673` | docs(swarm): correct S3 â€” the sibling's narrowing is right and mine  |
| `8ba28a983` | 2026-07-26 | `origin/rescue/a0e4d12c53e200673` | docs(swarm): correct S3 â€” the sibling's narrowing is right and mine  |
| `d7c50c20d` | 2026-07-26 | `rescue/a8f4f5f6f463bae98` | docs(swarm): record the department_id evidence conflict honestly |
| `d7c50c20d` | 2026-07-26 | `origin/agent/documents-print-output` | docs(swarm): record the department_id evidence conflict honestly |
| `bee9623c1` | 2026-07-26 | `rescue/a86bcdb8cd2d942ba` | docs(swarm): the API contract table, rebuilt against current staging |
| `4871b5245` | 2026-07-26 | `origin/swarm/api-contract-a86bcdb8cd2d942ba` | docs(swarm): the API contract table, rebuilt against current staging |
| `05f99659d` | 2026-07-26 | `agent/backend-tests-verified` | docs(swarm): supersede the separated-duty finding â€” it is closed |
| `05f99659d` | 2026-07-26 | `origin/agent/backend-tests-suite` | docs(swarm): supersede the separated-duty finding â€” it is closed |
| `60806cd64` | 2026-07-26 | `rescue/afce9b7ec86ef03a3` | docs(pahchan): final report â€” biometric lifecycle traced end to end |
| `4ef64db51` | 2026-07-26 | `agent/mobile-theming` | feat(mobile): map --on-ok, the token the generator caught on the rebas |
| `4ef64db51` | 2026-07-26 | `origin/agent/mobile-theming-final` | feat(mobile): map --on-ok, the token the generator caught on the rebas |
| `d2bbdfaa2` | 2026-07-26 | `agent/backend-admin-invites-subs` | docs(swarm): correct the report's test counts after the merge |
| `d2bbdfaa2` | 2026-07-26 | `origin/agent/backend-admin-invites-subs` | docs(swarm): correct the report's test counts after the merge |
| `52119acef` | 2026-07-26 | `origin/agent/mobile-theming-r3` | feat(mobile): map --on-ok, the token the generator caught on the rebas |
| `7eace3292` | 2026-07-26 | `origin/pahchan/biometric-lifecycle-rebased` | docs(pahchan): final report â€” biometric lifecycle traced end to end |
| `cdd614905` | 2026-07-26 | `origin/pahchan/biometric-lifecycle` | docs(pahchan): final report â€” biometric lifecycle traced end to end |
| `a7457d4d1` | 2026-07-26 | `origin/agent/mobile-theming-r2` | fix(mobile): touch targets, the icon generator's retired blue, and the |
| `4ab95e803` | 2026-07-26 | `a11y-responsive-audit` | docs(a11y): re-verify every citation against staging at +70 commits |
| `4ab95e803` | 2026-07-26 | `origin/a11y-responsive-audit` | docs(a11y): re-verify every citation against staging at +70 commits |
| `c1b0c65d6` | 2026-07-26 | `verify/hr-payroll-self-scope` | docs(swarm): final state - what merged, what is held, and the mid-reba |
| `993eefe71` | 2026-07-26 | `agent/inbox-notifications` | docs(swarm): owner decisions â€” the ladder wins, and pricing leaves t |
| `aa8512232` | 2026-07-26 | `origin/verify/hr-payroll-report-final` | docs(swarm): final state - what merged, what is held, and the mid-reba |
| `4f427e5d5` | 2026-07-26 | `verify/hr-payroll-separated-duty` | fix(vetana): admin cannot approve a payroll run - DO NOT MERGE BEFORE  |
| `4f427e5d5` | 2026-07-26 | `origin/verify/hr-payroll-separated-duty` | fix(vetana): admin cannot approve a payroll run - DO NOT MERGE BEFORE  |
| `e4197a108` | 2026-07-26 | `origin/agent/inbox-notifications-v3` | docs(swarm): final gate numbers, and a warning about the shared refs/s |
| `a01bac065` | 2026-07-26 | `agent/mobile-app-screens` | docs(swarm): mobile report â€” full screen inventory, endpoints, findi |
| `a01bac065` | 2026-07-26 | `origin/agent/mobile-app-screens` | docs(swarm): mobile report â€” full screen inventory, endpoints, findi |
| `8e671e77c` | 2026-07-26 | `audit/tenancy-org-id-cutover` | docs(audit): renumber proposals 076-081; add insert-ordering and set_c |
| `8e671e77c` | 2026-07-26 | `origin/audit/tenancy-org-id-cutover-final` | docs(audit): renumber proposals 076-081; add insert-ordering and set_c |
| `2ec5d7410` | 2026-07-26 | `origin/audit/tenancy-org-id-cutover-r2` | docs(audit): renumber proposals 076-081; add insert-ordering and set_c |
| `26150b5c5` | 2026-07-26 | `rescue/adc88842edc7bd7c9` | docs(email): complete the findings ledger â€” 16 findings, 2 sibling i |
| `26150b5c5` | 2026-07-26 | `origin/worktree-agent-adc88842edc7bd7c9` | docs(email): complete the findings ledger â€” 16 findings, 2 sibling i |
| `4eb5fe71b` | 2026-07-26 | `origin/agent/inbox-notifications-v2` | docs(swarm): reconcile the report with the coordinator's rulings and t |
| `83bd024ef` | 2026-07-26 | `rescue/a91ffbcdbce0c3ac0` | docs(audit) + fix(ganit): full finance/ops report; invoice signature b |
| `83bd024ef` | 2026-07-26 | `origin/rescue/a91ffbcdbce0c3ac0` | docs(audit) + fix(ganit): full finance/ops report; invoice signature b |
| `dd33df8c2` | 2026-07-26 | `rescue/aeb38363c99b7d384` | docs(roles): is_platform_staff docstring named 2 of the 8 codes it adm |
| `d88d2c3ce` | 2026-07-26 | `origin/verify/hr-payroll-self-scope-r3` | refactor(manav): use the sibling's ORG_MANAGEMENT_ROLES, drop my dupli |
| `ac5cb9b0b` | 2026-07-26 | `origin/rescue/aeb38363c99b7d384` | docs(roles): is_platform_staff docstring named 2 of the 8 codes it adm |
| `342536955` | 2026-07-26 | `verify/org-endpoints` | @ fix(migrations): resolve the 056 collision â€” rename the proposal t |
| `e9eeba42a` | 2026-07-26 | `origin/agent/routing-shell-nav-r2` | docs(roles): is_platform_staff docstring named 2 of the 8 codes it adm |
| `46eaf845d` | 2026-07-26 | `origin/rescue/ae8d474b5248856ed-verified` | fix(vetana): hold the money-moving rung at admin behind one named cons |
| `24108ff62` | 2026-07-26 | `auth-onboarding-clean` | docs(swarm): auth surface report â€” measurements, four fixes, one ret |
| `a649cf484` | 2026-07-26 | `origin/auth-onboarding-clean` | docs(swarm): auth surface report â€” measurements, four fixes, one ret |
| `b5c708b47` | 2026-07-26 | `rescue/a54bd25b975919175` | fix(migrations): the sanvaad fix is half landed â€” correct the record |
| `b5c708b47` | 2026-07-26 | `origin/rescue/a54bd25b975919175` | fix(migrations): the sanvaad fix is half landed â€” correct the record |
| `54748d615` | 2026-07-26 | `origin/rescue/afb8fe96142ed61c2-final` | @ fix(migrations): resolve the 056 collision â€” rename the proposal t |
| `777914540` | 2026-07-26 | `agent-srijan-graha-security` | docs(security): reconcile report against _COORDINATION.md |
| `777914540` | 2026-07-26 | `origin/agent-srijan-graha-security-v2` | docs(security): reconcile report against _COORDINATION.md |
| `da8ad8288` | 2026-07-26 | `origin/audit/tenancy-org-id-cutover` | docs(audit): full multi-tenancy audit â€” RLS posture, join paths, 15  |
| `17e4d4fa5` | 2026-07-26 | `rescue/a8d83f1b28b6e5edd` | docs(client-portal): unpiped gate results, and the attachment leak re- |
| `6c969f0b6` | 2026-07-26 | `origin/rescue/afb8fe96142ed61c2-finished` | @ feat(rbac): name the Tier-2 role sets, and audit the module activati |
| `c6771ed18` | 2026-07-26 | `origin/rescue/a8d83f1b28b6e5edd-final` | docs(client-portal): unpiped gate results, and the attachment leak re- |
| `0be094722` | 2026-07-26 | `rescue/af9bec7a9ad900774` | docs(swarm): landing page measured â€” script bug is stale, tracking g |
| `5cae16ce7` | 2026-07-26 | `origin/worktree-agent-a0e4d12c53e200673` | fix(security): the board list handed out private attachments with live |
| `b84275d66` | 2026-07-26 | `origin/rescue/afce9b7ec86ef03a3` | rescue(afce9b7ec86ef03a3): work in flight when the monthly spend limit |
| `c96204a86` | 2026-07-26 | `origin/rescue/afb8fe96142ed61c2` | rescue(afb8fe96142ed61c2): work in flight when the monthly spend limit |
| `b3f07b4bb` | 2026-07-26 | `origin/rescue/af3eb3c98064d2a74` | rescue(af3eb3c98064d2a74): work in flight when the monthly spend limit |
| `11d7ec661` | 2026-07-26 | `origin/rescue/ae8d474b5248856ed` | rescue(ae8d474b5248856ed): work in flight when the monthly spend limit |
| `b1c305d62` | 2026-07-26 | `origin/rescue/ae3a66e5b741fcb53` | rescue(ae3a66e5b741fcb53): work in flight when the monthly spend limit |
| `00964605b` | 2026-07-26 | `backup/adc88842-prerebase` | rescue(adc88842edc7bd7c9): work in flight when the monthly spend limit |
| `00964605b` | 2026-07-26 | `origin/rescue/adc88842edc7bd7c9` | rescue(adc88842edc7bd7c9): work in flight when the monthly spend limit |
| `97d4dafe0` | 2026-07-26 | `origin/rescue/a8f4f5f6f463bae98` | rescue(a8f4f5f6f463bae98): work in flight when the monthly spend limit |
| `cb2cc5f7f` | 2026-07-26 | `origin/rescue/a674b371d7e9ee944` | rescue(a674b371d7e9ee944): work in flight when the monthly spend limit |
| `26abcd89d` | 2026-07-26 | `backup/a2c335d7-prerebase` | rescue(a2c335d7df9bad5be): work in flight when the monthly spend limit |
| `97ed26a71` | 2026-07-26 | `origin/rescue/a285f820523dde384` | rescue(a285f820523dde384): work in flight when the monthly spend limit |
| `bf0adcca5` | 2026-07-26 | `origin/rescue/a08476018e9a93078` | rescue(a08476018e9a93078): work in flight when the monthly spend limit |
| `a1cefd4b4` | 2026-07-26 | `origin/agent/mobile-theming` | rescue(a00459c7516671c50): work in flight when the monthly spend limit |
| `fb2603cab` | 2026-07-26 | `worktree-agent-a86bcdb8cd2d942ba` | docs(swarm): response-shape mismatches â€” client shape landed, 3 cons |
| `fb2603cab` | 2026-07-26 | `origin/rescue/a86bcdb8cd2d942ba` | docs(swarm): response-shape mismatches â€” client shape landed, 3 cons |
| `fb2603cab` | 2026-07-26 | `origin/worktree-agent-a86bcdb8cd2d942ba` | docs(swarm): response-shape mismatches â€” client shape landed, 3 cons |
| `d66c4b10d` | 2026-07-26 | `worktree-agent-a8d83f1b28b6e5edd` | docs(client-portal): record the concurrent fix on /client/tasks/reques |
| `d66c4b10d` | 2026-07-26 | `origin/rescue/a8d83f1b28b6e5edd` | docs(client-portal): record the concurrent fix on /client/tasks/reques |
| `6ddce4017` | 2026-07-26 | `origin/rescue/af9bec7a9ad900774` | docs(swarm): landing page measured â€” script bug is stale, tracking g |
| `924c3c36e` | 2026-07-26 | `backup/inbox-notifications-prerebase2` | docs(swarm): full inbox/notification findings â€” types, quiet hours,  |
| `579112bf9` | 2026-07-26 | `worktree-agent-a54bd25b975919175` | docs(migrations): record the worktree base correction |
| `579112bf9` | 2026-07-26 | `origin/worktree-agent-a54bd25b975919175-rebased` | docs(migrations): record the worktree base correction |
| `7884fa532` | 2026-07-26 | `origin/verify/hr-payroll-self-scope-final` | docs(swarm): record the level_satisfies claim as stale, and the rebase |
| `32bb43694` | 2026-07-26 | `worktree-agent-a0e4d12c53e200673` | fix(security): the board list handed out private attachments with live |
| `5fd52420a` | 2026-07-26 | `rescue/a07d018d5639fb583` | docs(swarm): the full verification report for this branch |
| `5fd52420a` | 2026-07-26 | `worktree-agent-a07d018d5639fb583` | docs(swarm): the full verification report for this branch |
| `5fd52420a` | 2026-07-26 | `origin/rescue/a07d018d5639fb583` | docs(swarm): the full verification report for this branch |
| `5fd52420a` | 2026-07-26 | `origin/worktree-agent-a07d018d5639fb583` | docs(swarm): the full verification report for this branch |
| `de63857b4` | 2026-07-26 | `worktree-agent-a91ffbcdbce0c3ac0` | fix(dristi): analytics no longer reads modules the caller was never gr |
| `a8d59ff37` | 2026-07-26 | `worktree-agent-afce9b7ec86ef03a3` | fix(pahchan): scope punch idempotency to the employee, not just the or |
| `a8d59ff37` | 2026-07-26 | `origin/worktree-agent-afce9b7ec86ef03a3` | fix(pahchan): scope punch idempotency to the employee, not just the or |
| `9e5e869f8` | 2026-07-26 | `worktree-agent-a8f4f5f6f463bae98` | feat(docs): refuse to generate a legally incomplete statutory document |
| `9e5e869f8` | 2026-07-26 | `origin/worktree-agent-a8f4f5f6f463bae98` | feat(docs): refuse to generate a legally incomplete statutory document |
| `0980294a1` | 2026-07-26 | `agent/routing-shell-nav-r2` | fix(nav): messaging key back to sanvaad â€” the other reconciliation w |
| `0980294a1` | 2026-07-26 | `worktree-agent-aeb38363c99b7d384` | fix(nav): messaging key back to sanvaad â€” the other reconciliation w |
| `8704dd18c` | 2026-07-26 | `origin/client-portal-shape-a8d83f1b3` | docs(client-portal): complete the ledger â€” shapes, fidelity, spec de |
| `b9c13191d` | 2026-07-26 | `origin/worktree-agent-a91ffbcdbce0c3ac0` | fix(dristi): analytics no longer reads modules the caller was never gr |
| `9ec40571c` | 2026-07-26 | `backup/agent-a54bd25b975919175-premain` | docs(migrations): full inventory, drift list and PROPOSED_075 |
| `aa1a7e24e` | 2026-07-26 | `review/me-account-self-service` | docs(swarm): review findings â€” seven defects, three of them live |
| `a52893798` | 2026-07-26 | `origin/verify/hr-payroll-self-scope-rebased` | feat(vetana): supply the fields the payslip specification actually ask |
| `481f2e255` | 2026-07-26 | `origin/agent/routing-shell-nav` | fix(admin): stabilise the console role memo |
| `ea3b0cbf9` | 2026-07-26 | `origin/review/me-account-self-service-r2` | docs(swarm): review findings â€” seven defects, three of them live |
| `9a6b803a5` | 2026-07-26 | `verify/attachment-cost-leaks-signingpage` | docs(swarm): the full verification report for this branch |
| `a560aca7e` | 2026-07-26 | `origin/client-portal-shape-a8d83f1b2` | docs(client-portal): complete the ledger â€” shapes, fidelity, spec de |
| `76d2fb4c2` | 2026-07-26 | `origin/agent/inbox-notifications` | test(inbox): pin the type map, the paging cursor and the rollback |
| `b39cd37c4` | 2026-07-26 | `origin/verify/org-endpoints-final` | @ docs(swarm): final report sections â€” numbering recheck, DB verific |
| `f65145f7a` | 2026-07-26 | `origin/verify/attachment-cost-leaks-signingpage` | docs(swarm): the full verification report for this branch |
| `c3942fc8b` | 2026-07-26 | `worktree-agent-af3eb3c98064d2a74` | test(e2e): harness + the suite's own safety proof |
| `af9d8ed3e` | 2026-07-26 | `worktree-agent-a71bb3f32e9a4491f` | docs(swarm): credit the better fix for the thread access hole |
| `af9d8ed3e` | 2026-07-26 | `origin/worktree-agent-a71bb3f32e9a4491f` | docs(swarm): credit the better fix for the thread access hole |
| `d89d18516` | 2026-07-26 | `boards-surface` | fix(drawer): the desktop drawer eases on --ease-emph, not the bottom s |
| `d89d18516` | 2026-07-26 | `origin/boards-surface` | fix(drawer): the desktop drawer eases on --ease-emph, not the bottom s |
| `9945738cc` | 2026-07-26 | `origin/client-portal-shape-a8d83f1b` | docs(client-portal): complete the ledger â€” shapes, fidelity, spec de |
| `9952bed73` | 2026-07-26 | `worktree-agent-ab5735a3876bb7112` | docs(swarm): complete report â€” claims held/stale, call sites, spec d |
| `e46264bae` | 2026-07-26 | `origin/worktree-agent-a8d83f1b28b6e5edd` | docs(client-portal): complete the ledger â€” shapes, fidelity, spec de |
| `2eed46080` | 2026-07-26 | `worktree-agent-adc88842edc7bd7c9` | feat(email): resolve design tokens to literal hex at build time |
| `9fce55c9f` | 2026-07-26 | `origin/verify/org-endpoints-rebased` | @ docs(design): correct two salvaged guesses the design reference sett |
| `2de0573ac` | 2026-07-26 | `origin/worktree-agent-ab5735a3876bb7112-rebased-final` | docs(swarm): complete report â€” claims held/stale, call sites, spec d |
| `5df13ef09` | 2026-07-26 | `worktree-agent-a422b6e2513904575` | docs(swarm): full findings report for the module-pages agent |
| `5df13ef09` | 2026-07-26 | `origin/worktree-agent-a422b6e2513904575` | docs(swarm): full findings report for the module-pages agent |
| `607aba797` | 2026-07-26 | `origin/worktree-agent-ab5735a3876bb7112-rebased` | docs(swarm): complete report â€” claims held/stale, call sites, spec d |
| `5d4a7d503` | 2026-07-26 | `origin/worktree-agent-a54bd25b975919175` | docs(migrations): checkpoint 1 â€” both schema defects verified agains |
| `aa1a04823` | 2026-07-26 | `verify/dark-tokens-strobe` | docs(design): four new motion spec defects â€” the strobe is mandated  |
| `aa1a04823` | 2026-07-26 | `origin/verify/dark-tokens-strobe-final` | docs(design): four new motion spec defects â€” the strobe is mandated  |
| `5b397f758` | 2026-07-26 | `origin/verify/dark-tokens-strobe-r2` | docs(design): four new motion spec defects â€” the strobe is mandated  |
| `765d92d65` | 2026-07-26 | `worktree-agent-af995b4dcc3e7854f` | docs(audit): multi-tenancy audit â€” RLS posture confirmed against liv |
| `765d92d65` | 2026-07-26 | `origin/worktree-agent-af995b4dcc3e7854f` | docs(audit): multi-tenancy audit â€” RLS posture confirmed against liv |
| `746122020` | 2026-07-26 | `agent-approvals-activity-messaging` | docs(swarm): complete the approvals/activity/messaging report |
| `746122020` | 2026-07-26 | `origin/agent-approvals-activity-messaging-r2` | docs(swarm): complete the approvals/activity/messaging report |
| `37be7a6c6` | 2026-07-26 | `origin/verify/hr-payroll-self-scope` | test(rbac): port the HR and payroll suites to the Tier-4 level model |
| `bc17ab132` | 2026-07-26 | `agent/routing-shell-nav` | fix(rbac): the nav finally hides what the API refuses |
| `b60aa582d` | 2026-07-26 | `origin/agent-approvals-activity-messaging` | fix(rbac): approvals, activity and messaging guards read from role_tie |
| `7866b815d` | 2026-07-26 | `origin/verify/dark-tokens-strobe` | docs(swarm): measured strobe before/after - 0.8ms/1.5ms/2ms confirmed |
| `63ee47bf6` | 2026-07-26 | `origin/worktree-agent-ab5735a3876bb7112` | fix(ui): converge the three button vocabularies onto one .k-btn |
| `cd482ae96` | 2026-07-26 | `origin/agent/backend-tests-verified` | fix(tests): give the mocked connection fetchval/fetchrow, repairing a  |
| `4fb3745fa` | 2026-07-26 | `origin/agent-srijan-graha-security` | fix(security): close two cross-org OAuth token holes in Srijan |
| `c0f4450ae` | 2026-07-26 | `origin/verify/org-endpoints` | @ fix(server): register org_modules and org_security â€” they were dea |
| `9ca610aac` | 2026-07-26 | `origin/worktree-agent-aeb38363c99b7d384` | docs(routing): swarm report â€” verification of six inherited routing  |
| `edea1b715` | 2026-07-26 | `origin/review/me-account-self-service` | fix(me): register the router that was never mounted, and stop tests se |
| `5f7e3cfce` | 2026-07-26 | `salvage/backend-tests` | salvage(tests): five backend test files â€” recovered from a killed ag |
| `5e073b138` | 2026-07-26 | `salvage/boards-toolbar` | salvage(boards): NewTaskModal, ViewToolbar, boards.css â€” recovered f |
| `cba34d272` | 2026-07-26 | `salvage/dark-tokens-strobe` | salvage(tokens): dark mode tokens and the reduced-motion strobe â€” re |
| `5f7e3cfce` | 2026-07-26 | `origin/salvage/backend-tests` | salvage(tests): five backend test files â€” recovered from a killed ag |
| `5e073b138` | 2026-07-26 | `origin/salvage/boards-toolbar` | salvage(boards): NewTaskModal, ViewToolbar, boards.css â€” recovered f |
| `cba34d272` | 2026-07-26 | `origin/salvage/dark-tokens-strobe` | salvage(tokens): dark mode tokens and the reduced-motion strobe â€” re |
| `611e9829b` | 2026-07-26 | `fix/attachment-cost-leaks-signingpage` | salvage(security): attachment leak, cost basis, SigningPage â€” recove |
| `181912733` | 2026-07-26 | `salvage/hr-payroll-self-scope` | salvage(rbac): manav and vetana self-scoping â€” recovered from a kill |
| `43167f2c6` | 2026-07-26 | `salvage/org-endpoints` | salvage(org): profile, security, modules routers + 3 proposed migratio |
| `611e9829b` | 2026-07-26 | `origin/fix/attachment-cost-leaks-signingpage` | salvage(security): attachment leak, cost basis, SigningPage â€” recove |
| `181912733` | 2026-07-26 | `origin/salvage/hr-payroll-self-scope` | salvage(rbac): manav and vetana self-scoping â€” recovered from a kill |
| `43167f2c6` | 2026-07-26 | `origin/salvage/org-endpoints` | salvage(org): profile, security, modules routers + 3 proposed migratio |
| `4f1548565` | 2026-07-26 | `feat/me-account-self-service` | feat(me): account self-service, and the session claim we cannot make |
| `4f1548565` | 2026-07-26 | `origin/feat/me-account-self-service` | feat(me): account self-service, and the session claim we cannot make |
| `2a2a27bb4` | 2026-07-26 | `audit/ganit-vikray-rbac` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `audit/rbac-approvals-activity-msg` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `migrations/tier4-schema-fixes` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `mobile-parity-audit` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a0d1821050d98c6f1` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a0fe1da9fd1393fe0` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a12e35f6a554d4398` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a192d96440d0b0580` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a335f14a15155008b` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a3bdf36a5a01efad4` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a3f89d5eca9e92384` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a69b752342fc031ab` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a811eebd37e36fbf2` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a862717c7ea15079f` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-a9a71f868742b0ded` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-aadf67bb7533e4240` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-aae69ed8a488eb105` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-ab9c978aea67f9054` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `2a2a27bb4` | 2026-07-26 | `worktree-agent-ae21a44443065bff1` | feat: 20-agent design revamp â€” snapshot with all gates green |
| `b18322bbb` | 2026-07-26 | `origin/claude/staging-branch-connection-myuc57` | refactor(teams): reference migration onto the design system |
| `a3db8847d` | 2026-07-24 | `origin/claude/karatavya-ai-evals-multiagent-nd0cl1` | Add skill catalog tab to Srijan org page so users can discover and ass |
| `1aa49855a` | 2026-07-24 | `claude/quirky-wiles-2af4ca` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a00459c7516671c50` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a07de128ce3e13f43` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a08476018e9a93078` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a09e724a8d8f7b908` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a0b7505e540af8e15` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a0ff71ffc10147992` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a23299608b57894cf` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a285f820523dde384` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a2a8bc568c5230eb5` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a2c335d7df9bad5be` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a33d9d1917405d3df` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a349fbeebcd783762` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a375821d406ecb0f5` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a3c7cd7c266c5c4b2` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a412ae7ceba83e36e` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a414c546899fc74f6` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a425bcb40fe06744b` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a5285d235b4042487` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a533b2e195de03b95` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a5dcaf6bbbe870141` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a5e8a60fd199ec295` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a66766f4906c3a659` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a66e055306328fef0` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a674b371d7e9ee944` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a6bc76b1b8fc3c2b3` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a6e87073fa7af224e` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a79076d64c1e192ad` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a7a99d7bdbeea6aeb` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a7c402a9f3d330984` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a855d5a7d222ba113` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a866d4844edf084e7` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a8bfaf571486ae131` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a915730b87b6d4462` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a9a6364d9f82145ca` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-a9ddb55a575cdafd3` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-aa162ce584e0a9a42` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-aa46eb469ec60a01b` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ab0d2d1c5a80f1e0a` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ab31e9c65a5bd3240` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-abe48fc708a6f44f3` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-abe9ccd201e7a6821` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ac0bde89dc0938bf0` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ac27fcbba86b9f73e` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ac57395f1be27bd2e` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ac62b18cebb5a6c03` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-acd06e0a524ba7b79` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-acd44ba7845daea75` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ad32fa8d6fd538aeb` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ad6d0b722ada48cf7` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae0a57b5285cf877e` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae135d8dc02c28f43` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae1b39d439ad4e68d` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae34f07646159fb28` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae3a66e5b741fcb53` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae500b721dae0a7a6` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-ae8d474b5248856ed` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-aec549e41e3ba94cb` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-afa65e2c263e01c34` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-afa75797aea8cccf7` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-afad63f827893196d` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-afb8fe96142ed61c2` | feat: add admin endpoint to recover corrupted R2 attachments |
| `1aa49855a` | 2026-07-24 | `worktree-agent-afc9794a5dd0e78e0` | feat: add admin endpoint to recover corrupted R2 attachments |
| `294e9e2d2` | 2026-07-10 | `worktree-agent-a051ded4f8111fae9` | fix: resolve pj NameError in migration endpoint, remove admin requirem |
| `294e9e2d2` | 2026-07-10 | `worktree-agent-a2e2e17e80478bdc0` | fix: resolve pj NameError in migration endpoint, remove admin requirem |
| `294e9e2d2` | 2026-07-10 | `worktree-agent-aefdfce3118ba8861` | fix: resolve pj NameError in migration endpoint, remove admin requirem |
| `34fde534e` | 2026-06-19 | `origin/feat/templates` | feat: rich task templates â€” editor, mobile picker, security hardenin |
