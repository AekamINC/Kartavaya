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
 *
 * ── The reason, and the column it lands in ──────────────────────────────────
 *
 * A bare thumbs-down teaches nothing. It says an answer was wrong and not what
 * was wrong with it, so nobody downstream can turn it into a test — and the
 * table has held ZERO rows since it was created, so every row that does arrive
 * has to carry its weight. `note` is where the reason goes: it is the only free
 * field on `SkillFeedback`, and `record_skill_feedback` writes it straight to
 * `staging.hub_skill_feedback.note`.
 *
 * That column is one of migration 119's four, and 119 says NOT APPLIED at the
 * top of its own file — which is why `record_skill_feedback` catches
 * `asyncpg.UndefinedColumnError` and falls back to an INSERT that silently
 * drops `note`, `message_id`, `run_id` and `created_by`. A reason posted into
 * that fallback would be answered 201 and stored nowhere, which is the exact
 * shape of a control that lies.
 *
 * So the live catalogue was read rather than the ledger believed. On 2026-08-19,
 * SELECT-only against staging: `hub_skill_feedback` carries `run_id`,
 * `message_id`, `note` and `created_by`, and `hub_chat_messages` carries
 * `answer`. Migration 119 IS applied on the shared database whatever its header
 * says. The primary INSERT is the one that runs, the note lands, and the row it
 * lands in can be traced back to the answer it was about.
 *
 * ── Why the reason is a second row, not an edit of the first ────────────────
 *
 * There is no PATCH. `hub_skill_feedback` is append-only and the endpoint's own
 * docstring treats it that way, so a reason arrives as a second row carrying
 * the same `message_id` and the same `accepted:false` plus the note. The thumb
 * is posted the moment it is pressed — capture beats completeness on a ledger
 * whose problem is emptiness, and a reader who presses the thumb and walks away
 * must not be a reader whose complaint was never recorded. Anything counting
 * complaints therefore counts DISTINCT `message_id`, and anything reading the
 * reason takes the NEWEST row per `message_id`. Both are stated here because
 * this file is where a reader of that table will come looking.
 */

export const FEEDBACK_PATH = '/v1/hub/skills/feedback';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The five ways an answer is wrong here, in the product's own words.
 *
 * Concrete and few, because a reason list that offers "unsatisfactory" collects
 * nothing anybody can act on. Each of these names a defect somebody could go and
 * reproduce: a figure that disagrees with the ledger, a filing the answer left
 * out, a claim with no record behind it, an answer nobody waited for, a question
 * that was read as a different question. `id` is what the code matches on;
 * `label` is what is stored, because the note is read by a person and
 * `wrong-number` is not a sentence.
 *
 * They are TOGGLES, not a single choice. A wrong answer is routinely wrong in
 * two ways at once, and forcing one of them to be picked throws the other away.
 */
export const REASONS = [
  { id: 'wrong-number', label: 'Wrong number' },
  { id: 'missed', label: 'Missed something' },
  { id: 'made-up', label: 'Made it up' },
  { id: 'slow', label: 'Too slow' },
  { id: 'misunderstood', label: 'Misunderstood the question' },
];

/**
 * How much free text the box takes.
 *
 * `record_skill_feedback` writes `body.note[:2000]` — a silent truncation, which
 * on this control would mean somebody's last sentence disappearing into a row
 * that still reported "recorded". Five labels are 71 characters with their
 * separators, so 500 here puts the longest note this screen can compose at 574
 * and the server's slice can never fire.
 */
export const NOTE_MAX = 500;

/** Is this an id Postgres stored, or one this screen made up a second ago? */
export function isServerAnswer(id) {
  return UUID.test(String(id ?? ''));
}

/**
 * The chosen reasons and the typed words, as the one line stored in `note`.
 *
 * Labels in the listed order rather than the clicked order, so two readers who
 * chose the same two things write the same note and the table can be grouped by
 * it. Empty in, empty out: nothing chosen and nothing typed is not a reason, and
 * `feedbackBody` drops the key entirely rather than sending `note: ''`.
 */
export function noteFrom(reasonIds, text) {
  const chosen = new Set(reasonIds || []);
  const labels = REASONS.filter(r => chosen.has(r.id)).map(r => r.label);
  const words = String(text ?? '').trim();
  if (!labels.length) return words;
  return words ? `${labels.join(' · ')} — ${words}` : labels.join(' · ');
}

/**
 * `up` / `down` → the body the endpoint declares. Nothing is guessed.
 *
 * `note` is omitted when there is none rather than sent empty: the field
 * defaults to `""` server-side, so an empty one adds a key that says nothing,
 * and the body for a bare thumb stays exactly the two fields it has always been.
 */
export function feedbackBody(messageId, verdict, note = '') {
  const body = { accepted: verdict === 'up', message_id: String(messageId) };
  const trimmed = String(note ?? '').trim();
  if (trimmed) body.note = trimmed;
  return body;
}
