/**
 * Thumbs up / thumbs down on an answer — the wire contract, in one place.
 *
 * ── The endpoint already exists. This does NOT build one ────────────────────
 *
 * `POST /v1/hub/skills/feedback` is `routers/hub.py:3865`
 * (`record_skill_feedback`). Its body model is `SkillFeedback`:
 *
 *     accepted     bool                      REQUIRED
 *     template_id  str | null
 *     skill_id     str | null
 *     message_id   str | null
 *     run_id       str | null
 *     variables    dict   (hashed into input_hash)
 *     predicted    dict | null
 *     corrected    dict | null
 *     note         str
 *
 * It 400s unless one of `template_id`, `skill_id` or `message_id` is present,
 * and 201s with `{status, id, template_id, input_hash, will_correct_future_runs}`.
 * A Sahayak answer has no template and no skill, so `message_id` is the id — and
 * the endpoint verifies it THROUGH ITS SESSION (`hub_chat_messages` joined to
 * `hub_chat_sessions WHERE org_id`), which is why sending another tenant's id
 * 404s rather than storing a cross-tenant pointer.
 *
 * ── Why the id is checked before anything is sent ───────────────────────────
 *
 * `message_id` is cast `$1::uuid` in the ownership check, so a non-UUID is not a
 * 404 — it is a driver-level cast failure, i.e. a 500. And this screen mints two
 * kinds of id that are not UUIDs: `local-…` for the optimistic question bubble
 * and `reply-…` for a reply whose `message_id` the server did not return
 * (`SahayakTab.shape`). Neither can be the subject of feedback, so the control
 * is NOT DRAWN for them rather than drawn and guaranteed to fail. `GET
 * …/messages` and `POST /v1/hub/chat` both return real ids, which is every
 * answer a reader can actually see on a settled screen.
 *
 * ── What is deliberately not sent ───────────────────────────────────────────
 *
 * No `variables`, no `predicted`, no `corrected`. A thumb is a verdict, not a
 * correction: `record_skill_feedback` returns `will_correct_future_runs` false
 * for it, correctly, because `_get_feedback_corrections` reads corrections and
 * an empty one would be a row the loop can never use. Inventing a `variables`
 * dict here would also hash to something no skill run can ever match, which is
 * the exact failure that endpoint's own docstring warns about.
 */

export const FEEDBACK_PATH = '/v1/hub/skills/feedback';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this an id Postgres stored, or one this screen made up a second ago? */
export function isServerAnswer(id) {
  return UUID.test(String(id ?? ''));
}

/** `up` / `down` → the body the endpoint declares. Nothing is guessed. */
export function feedbackBody(messageId, verdict) {
  return { accepted: verdict === 'up', message_id: String(messageId) };
}
