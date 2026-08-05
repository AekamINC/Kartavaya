/**
 * The `sources` a Sahayak answer arrives with, read rather than invented.
 *
 * `hub_chat_messages.sources` is a jsonb column that has existed since
 * migration 017, and `routers/hub_chat.py` fills it from TWO places with two
 * different shapes. This file is the one place that knows both:
 *
 *   a knowledge-base chunk   { ref, chunk_id, title, source_type, similarity }
 *   a grounded web page      { title, url, type: "web" }
 *
 * The difference that matters is `ref`. A KB chunk was numbered into the prompt,
 * so the model was given a `[n]` to cite it by and the answer can carry an
 * inline marker pointing at it. A web page was not — hub_chat.py says so where
 * it appends them, and inventing a number here would produce a citation marker
 * pointing at text the model never saw. So a web source has no number and is
 * never the target of an inline `[n]`.
 *
 * ── Two shapes of nothing, and one shape that is not a list at all ──────────
 *
 * EVERY message this product sent before today has `sources: []` — grounding
 * was only threaded through the backend this week, and before that the loop in
 * hub_chat.py that appends web sources had never run once. So "no sources" is
 * the ordinary case for the entire history of every conversation, not an error,
 * and it renders as an answer with no Sources button rather than as an empty
 * panel or a gap.
 *
 * And the column does not always arrive decoded. `db.py:82` registers a jsonb
 * codec per connection and WARNS RATHER THAN RAISES when PgBouncer drops the
 * handshake three times — its own comment says "without it asyncpg hands JSONB
 * back as a string". `GET /chat/sessions/{id}/messages` returns the column
 * straight from the row, so on such a connection `sources` is a JSON STRING;
 * `POST .../send` builds its list in Python and is always a real array. The two
 * paths therefore disagree about the type of the same field, which is exactly
 * the defect `parseSchema` in `srijan/_shared` exists for on `input_schema`.
 * Array, string, or anything else — out comes an array.
 */

/** `https://www.cbic.gov.in/notification/14` → `cbic.gov.in`. */
export function hostOf(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    // A bare `cbic.gov.in/x` is not a valid URL and throws; the fallback below
    // keeps it readable rather than dropping the only label the card has.
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function one(s, i) {
  if (!s || typeof s !== 'object') return null;

  // `type: "web"` is what hub_chat.py writes. The `url && !ref` fallback covers
  // a grounded source stored before that key was being set — the same message
  // history this whole file degrades gracefully for.
  const isWeb = s.type === 'web' || (!!s.url && s.ref == null);
  const refNum = Number(s.ref);
  const ref = !isWeb && Number.isFinite(refNum) && refNum > 0 ? refNum : null;

  const title = String(s.title ?? '').trim();
  const url = isWeb ? String(s.url ?? '').trim() : '';

  return {
    // Stable within one message, which is all a React key and a highlight
    // target need. `ref` is NOT unique — a web source has none.
    key: `s${i}`,
    kind: isWeb ? 'web' : 'kb',
    ref,
    // A source with neither a title nor a host would render as a blank card,
    // which reads as a rendering fault rather than as thin metadata.
    title: title || (isWeb ? hostOf(url) : '') || 'Untitled source',
    url,
    sourceType: String(s.source_type ?? '').trim(),
    similarity: typeof s.similarity === 'number' ? s.similarity : null,
  };
}

export function parseSources(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v.map(one).filter(Boolean);
}

/**
 * The footer line under a source card: where it came from, and how sure we are.
 *
 * `similarity` is the re-ranked score the server rounded to three places. Shown
 * as a percentage because it is being read as "how close a match", not as a
 * number to compute with — and omitted entirely when the server did not send
 * one, rather than printed as 0%, which would read as a source that matched
 * nothing.
 */
export function sourceFoot(s) {
  if (!s) return '';
  if (s.kind === 'web') {
    const host = hostOf(s.url);
    return host ? `WEB · ${host}` : 'WEB';
  }
  const parts = ['KB'];
  if (s.sourceType) parts.push(s.sourceType);
  if (s.similarity != null) parts.push(`${Math.round(s.similarity * 100)}% match`);
  return parts.join(' · ');
}

/**
 * What grounded this answer, as one word.
 *
 * Used to colour the single card the model can produce today. A knowledge-base
 * hit wins over a web page because it is the org's OWN material, which is the
 * distinction the card is drawing; with neither, the answer came from the model
 * itself and says so by being neutral rather than by claiming a provenance.
 */
export function provenanceOf(sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (list.some(s => s.kind === 'kb')) return 'files';
  if (list.some(s => s.kind === 'web')) return 'web';
  return 'answer';
}
