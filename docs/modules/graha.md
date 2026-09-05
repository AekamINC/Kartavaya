# Graha ग्रह — CRM

**Module code** `graha` · registered in `backend/middleware/role_tiers.py`

Contacts, clients, deals and the pipeline. The largest module by route count, and the one every other revenue module reads from — an invoice, an order and a signature request all resolve back to a `graha_clients` row.

## Flow

A deal moves through stages held in `graha_deals`; each stage change writes `graha_activities` and may fire a rule in `graha_automations`. Approval-gated stages raise a `graha_approval_requests` row rather than moving directly.

## Backend

- `backend/routers/graha.py`
- `backend/routers/lead_sources.py`


**99 routes** — 42 GET, 31 POST, 10 PATCH, 14 DELETE, 2 PUT

<details><summary>All routes</summary>

- `GET /clients`
- `POST /clients`
- `GET /clients/{client_id}`
- `PATCH /clients/{client_id}`
- `DELETE /clients/{client_id}`
- `GET /contacts`
- `POST /contacts`
- `GET /contacts/duplicates`
- `GET /contacts/merges`
- `POST /contacts/merges/{merge_id}/undo`
- `GET /contacts/{contact_id}/duplicates`
- `POST /contacts/{contact_id}/merge`
- `GET /contacts/{contact_id}`
- `PATCH /contacts/{contact_id}`
- `DELETE /contacts/{contact_id}`
- `PUT /clients/{client_id}/coordinate`
- `DELETE /clients/{client_id}/coordinate`
- `PUT /contacts/{contact_id}/coordinate`
- `DELETE /contacts/{contact_id}/coordinate`
- `GET /obligation-keys`
- `GET /clients/{client_id}/obligations`
- `POST /clients/{client_id}/obligations`
- `PATCH /clients/{client_id}/obligations/{obligation_id}`
- `DELETE /clients/{client_id}/obligations/{obligation_id}`
- `GET /pipelines`
- `POST /pipelines`
- `GET /deals`
- `POST /deals`
- `GET /deals/kanban`
- `GET /deals/{deal_id}`
- `PATCH /deals/{deal_id}`
- `DELETE /deals/{deal_id}`
- `POST /deals/{deal_id}/archive`
- `POST /deals/{deal_id}/unarchive`
- `GET /pipeline-summary`
- `POST /activities`
- `GET /activities`
- `PATCH /activities/{activity_id}/complete`
- `GET /follow-ups`
- `POST /follow-ups`
- `PATCH /follow-ups/{follow_up_id}/complete`
- `DELETE /follow-ups/{follow_up_id}`
- `GET /labels`
- `POST /labels`
- `DELETE /labels/{label_id}`
- `POST /contacts/{contact_id}/labels/{label_id}`
- `DELETE /contacts/{contact_id}/labels/{label_id}`
- `POST /contacts/{contact_id}/convert`
- `GET /today`
- `GET /contacts/{contact_id}/timeline`
- `GET /contacts/{contact_id}/projects`
- `POST /inbound-leads`
- `GET /inbound-emails`
- `GET /inbound-emails/{email_id}`
- `POST /contacts/{contact_id}/rescore`
- `POST /contacts/rescore-all`
- `POST /contacts/route-all`
- `GET /scoring-signals`
- `POST /scoring-rules`
- `GET /scoring-rules`
- `PATCH /scoring-rules/{rule_id}`
- `GET /reports/pipeline-velocity`
- `GET /reports/conversion`
- `GET /reports/rep-performance`
- `GET /reports/forecast`
- `GET /reports/source-analysis`
- `GET /reports/download`
- `GET /territories`
- `POST /territories`
- `PATCH /territories/{territory_id}`
- `DELETE /territories/{territory_id}`
- `POST /territories/{territory_id}/assign-next`
- `GET /territories/{territory_id}/geometry`
- `GET /custom-fields`
- `POST /custom-fields`
- `DELETE /custom-fields/{field_id}`
- `GET /web-forms`
- `POST /web-forms`
- `DELETE /web-forms/{form_id}`
- `GET /web-forms/{form_id}/submissions`
- `GET /f/{slug}`
- `POST /f/{slug}`
- `GET /approval-rules`
- `POST /approval-rules`
- `PATCH /approval-rules/{rule_id}`
- `DELETE /approval-rules/{rule_id}`
- `GET /approval-requests`
- `POST /approval-requests/{req_id}/approve`
- `POST /approval-requests/{req_id}/reject`
- `GET /documents`
- `POST /documents/upload`
- `POST /documents`
- `GET /documents/folders`
- `GET /documents/{doc_id}`
- `PATCH /documents/{doc_id}`
- `DELETE /documents/{doc_id}`
- `POST /pull/indiamart`
- `POST /justdial/{webhook_key}`
- `GET /justdial/url`

</details>

## Database

25 tables:

- `client_obligations`
- `ganit_invoices`
- `graha_activities`
- `graha_approval_requests`
- `graha_approval_rules`
- `graha_clients`
- `graha_contact_labels`
- `graha_contact_merges`
- `graha_contacts`
- `graha_custom_fields`
- `graha_deals`
- `graha_documents`
- `graha_follow_ups`
- `graha_inbound_emails`
- `graha_labels`
- `graha_pipelines`
- `graha_scoring_rules`
- `graha_territories`
- `graha_web_form_submissions`
- `graha_web_forms`
- `hub_connector_credentials`
- `organisations`
- `projects`
- `user_roles`
- `users`

## Frontend

- `frontend\src\pages\graha\ActivitiesTab.jsx`
- `frontend\src\pages\graha\ApprovalsTab.jsx`
- `frontend\src\pages\graha\ClientsTab.jsx`
- `frontend\src\pages\graha\ContactsTab.jsx`
- `frontend\src\pages\graha\ContactTimeline.jsx`
- `frontend\src\pages\graha\CustomFieldInputs.jsx`
- `frontend\src\pages\graha\CustomFieldsTab.jsx`
- `frontend\src\pages\graha\DealRoute.jsx`
- `frontend\src\pages\graha\DealsTab.jsx`
- `frontend\src\pages\graha\DedupeTab.jsx`
- `frontend\src\pages\graha\DocumentsTab.jsx`
- `frontend\src\pages\graha\FollowUpsTab.jsx`
- `frontend\src\pages\graha\GrahaModule.jsx`
- `frontend\src\pages\graha\KanbanTab.jsx`
- `frontend\src\pages\graha\LabelsTab.jsx`
- `frontend\src\pages\graha\ObligationsSection.jsx`
- `frontend\src\pages\graha\PipelineTab.jsx`
- `frontend\src\pages\graha\ReportsTab.jsx`
- `frontend\src\pages\graha\ScoringTab.jsx`
- `frontend\src\pages\graha\TerritoriesTab.jsx`
- `frontend\src\pages\graha\TodayItem.jsx`
- `frontend\src\pages\graha\TodayTab.jsx`
- `frontend\src\pages\graha\WebFormsTab.jsx`
- `frontend\src\pages\graha\_shared.jsx`
- `frontend\src\pages\graha\__tests__\addressAndTerritoryCapture.test.jsx`
- `frontend\src\pages\graha\__tests__\dealLostReason.test.jsx`
- `frontend\src\pages\graha\__tests__\dealRoute.test.jsx`
- `frontend\src\pages\graha\__tests__\dedupeMergedRows.test.jsx`
- `frontend\src\pages\graha\__tests__\grahaTabStates.test.jsx`
- `frontend\src\pages\graha\__tests__\kanbanTab.test.jsx`
- `frontend\src\pages\graha\__tests__\noFollowUp.test.jsx`
- `frontend\src\pages\graha\__tests__\pipelineCanBeCreated.test.jsx`
- `frontend\src\pages\graha\__tests__\tabInUrl.test.jsx`
- `frontend\src\pages\graha\__tests__\territoryPriority.test.jsx`
- `frontend\src\pages\GrahaPage.jsx`


## Integrations

- AWS SES
- Cloudflare R2
- Supabase

---
_Routes, tables and paths are generated by `scripts/module-facts.mjs` and
`scripts/gen-module-docs.mjs`. Re-run both after changing the module; do not
edit those sections by hand. Purpose and Flow are hand-written._
