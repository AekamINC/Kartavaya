# Sahayak सहायक — AI assistant and skills

**Module code** `sahayak` · registered in `backend/middleware/role_tiers.py`

Generation and answers grounded in data the organisation already holds, priced in credits. Runs skills — social posts, ad copy, email campaigns, GST answers — plus a grounded chatbot, a knowledge base and the Apify scraper catalogue.

## Flow

A run debits credits, calls a model through the router in `services/ai_router.py`, records what it touched and what it cost in `hub_ai_logs`, and refunds on failure. Every run states its spend; nothing is silently billed.

## Backend

- `backend/routers/hub.py`
- `backend/routers/hub_chat.py`
- `backend/routers/hub_connectors.py`
- `backend/routers/hub_publish.py`
- `backend/routers/sanvaad_sahayak.py`

**Services**
- `backend/services/sahayak_answer.py`

**92 routes** — 44 GET, 30 POST, 2 PATCH, 6 PUT, 10 DELETE

<details><summary>All routes</summary>

- `GET /org-client`
- `GET /clients`
- `POST /clients`
- `GET /clients/{client_id}`
- `PATCH /clients/{client_id}`
- `GET /clients/{client_id}/brand`
- `PUT /clients/{client_id}/brand`
- `POST /clients/{client_id}/generate`
- `GET /clients/{client_id}/content`
- `GET /clients/{client_id}/content/facets`
- `GET /clients/{client_id}/content/{content_id}`
- `PATCH /clients/{client_id}/content/{content_id}/review`
- `GET /clients/{client_id}/credits`
- `POST /clients/{client_id}/credits/topup`
- `GET /dashboard`
- `GET /skills/templates`
- `GET /skills/capabilities`
- `GET /skills/templates/{template_id}`
- `POST /skills/{template_id}/request`
- `GET /skills/requests`
- `POST /skills/templates`
- `PUT /skills/templates/{template_id}/schedule`
- `DELETE /skills/templates/{template_id}`
- `GET /clients/{client_id}/skills`
- `POST /clients/{client_id}/skills/{template_id}`
- `DELETE /clients/{client_id}/skills/{skill_id}`
- `POST /clients/{client_id}/skills/{skill_id}/run`
- `GET /clients/{client_id}/skills/{skill_id}/runs`
- `GET /clients/{client_id}/content/{content_id}/approvals`
- `GET /analytics/spend`
- `GET /clients/{client_id}/analytics/spend`
- `POST /ai-feedback`
- `GET /ai-feedback`
- `GET /ai-feedback/stats`
- `GET /ai-conversations/{context_type}`
- `PUT /ai-conversations/{context_type}`
- `DELETE /ai-conversations/{context_type}`
- `GET /org/skills`
- `POST /org/skills/{template_id}`
- `DELETE /org/skills/{skill_id}`
- `POST /org/skills/findings/ack`
- `DELETE /org/skills/findings/ack`
- `POST /org/skills/{skill_id}/run`
- `GET /org/skills/{skill_id}/runs`
- `GET /org/credits`
- `POST /org/credits/topup`
- `POST /org/credits/allocate/{target_user_id}`
- `DELETE /org/credits/allocate/{target_user_id}`
- `GET /org/credits/users`
- `POST /org/generate`
- `GET /org/content`
- `GET /org/content/facets`
- `GET /org/brand`
- `PUT /org/brand`
- `POST /org/quick-generate`
- `POST /chat`
- `POST /chat/stream`
- `GET /chat/sessions/{session_id}/messages`
- `POST /skills/feedback`
- `GET /clients/{client_id}/kb`
- `POST /clients/{client_id}/kb`
- `POST /clients/{client_id}/kb/faq`
- `DELETE /clients/{client_id}/kb/{doc_id}`
- `GET /clients/{client_id}/kb/search`
- `GET /clients/{client_id}/chat/sessions`
- `POST /clients/{client_id}/chat/sessions`
- `GET /chat/sessions/{session_id}/messages`
- `POST /chat/sessions/{session_id}/send`
- `DELETE /chat/sessions/{session_id}`
- `GET /guides`
- `GET /guides/{platform}`
- `GET /`
- `GET /social-status`
- `PUT /`
- `DELETE /{platform}`
- `POST /{platform}/test`
- `GET /oauth/{platform}/authorize`
- `GET /oauth/{platform}/callback`
- `GET /oauth/pending/{choice_token}`
- `GET /clients/{client_id}/social-accounts`
- `POST /clients/{client_id}/social-accounts`
- `DELETE /clients/{client_id}/social-accounts/{account_id}`
- `POST /clients/{client_id}/publish/schedule`
- `POST /clients/{client_id}/publish/bulk-schedule`
- `POST /publish/queue/{queue_id}/publish-now`
- `POST /publish/queue/{queue_id}/cancel`
- `GET /clients/{client_id}/publish/queue`
- `GET /clients/{client_id}/calendar`
- `POST /publish/dispatch`
- `GET /clients/{client_id}/platforms`
- `PUT /clients/{client_id}/platforms`
- `POST /channels/{channel_id}/sahayak`

</details>

## Database

32 tables:

- `ai_conversations`
- `ai_feedback`
- `credit_prices`
- `hub_ai_logs`
- `hub_brand_profiles`
- `hub_chat_messages`
- `hub_chat_sessions`
- `hub_client_platforms`
- `hub_client_skills`
- `hub_clients`
- `hub_connector_credentials`
- `hub_content_approvals`
- `hub_content_items`
- `hub_credit_transactions`
- `hub_credit_wallets`
- `hub_kb_chunks`
- `hub_kb_documents`
- `hub_oauth_states`
- `hub_org_skill_runs`
- `hub_org_skills`
- `hub_publish_queue`
- `hub_skill_feedback`
- `hub_skill_requests`
- `hub_skill_runs`
- `hub_skill_templates`
- `hub_social_accounts`
- `keys`
- `organisations`
- `samvada_messages`
- `user_roles`
- `users`
- `v_active_support_sessions`

## Frontend

- `frontend\src\pages\hub\__tests__\sahayakHub.test.jsx`
- `frontend\src\pages\OrgSahayakPage.jsx`
- `frontend\src\pages\sahayak\assistant\AnswerBody.jsx`
- `frontend\src\pages\sahayak\assistant\SourcesPanel.jsx`
- `frontend\src\pages\sahayak\assistant\Verdict.jsx`
- `frontend\src\pages\sahayak\ContentTab.jsx`
- `frontend\src\pages\sahayak\CreditsTab.jsx`
- `frontend\src\pages\sahayak\DataCatalogTab.jsx`
- `frontend\src\pages\sahayak\DataRunsTab.jsx`
- `frontend\src\pages\sahayak\GenerateTab.jsx`
- `frontend\src\pages\sahayak\ImagePanel.jsx`
- `frontend\src\pages\sahayak\PlatformPreview.jsx`
- `frontend\src\pages\sahayak\RichText.jsx`
- `frontend\src\pages\sahayak\SahayakTab.jsx`
- `frontend\src\pages\sahayak\SkillsTab.jsx`
- `frontend\src\pages\sahayak\_shared.jsx`
- `frontend\src\pages\sahayak\__tests__\contentTable.test.jsx`
- `frontend\src\pages\sahayak\__tests__\generateTab.test.jsx`
- `frontend\src\pages\sahayak\__tests__\richContent.test.jsx`
- `frontend\src\pages\sahayak\__tests__\sahayak.test.jsx`
- `frontend\src\pages\sahayak\__tests__\sahayakShell.test.jsx`
- `frontend\src\pages\sahayak\__tests__\sahayakStream.test.jsx`
- `frontend\src\pages\sahayak\__tests__\skillFindings.test.jsx`
- `frontend\src\pages\sahayak\__tests__\skillsTab.test.jsx`
- `frontend\src\pages\sanvaad\SahayakAside.jsx`

**Components**
- `frontend\src\components\sanvaad\SahayakCard.jsx`

## Integrations

- Google Gemini
- WhatsApp Cloud API
- AWS SES
- Cloudflare R2

---
_Routes, tables and paths are generated by `scripts/module-facts.mjs` and
`scripts/gen-module-docs.mjs`. Re-run both after changing the module; do not
edit those sections by hand. Purpose and Flow are hand-written._
