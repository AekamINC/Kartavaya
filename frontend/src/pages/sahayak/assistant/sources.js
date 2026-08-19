/**
 * The `sources` a Sahayak answer arrives with, read rather than invented.
 *
 * `hub_chat_messages.sources` is a jsonb column that has existed since
 * migration 017, and THREE call sites fill it with two shapes. This file is the
 * one place that knows both:
 *
 *   a knowledge-base chunk   { ref, chunk_id, title, source_type, similarity }
 *   a grounded web page      { ref?, title, url, type: "web" }
 *
 * ── `ref` is not a knowledge-base fact, and reading it as one killed the web ─
 *
 * This file used to null `ref` for every web source, on the stated reasoning
 * that a web page "was not numbered into the prompt". That is true of ONE of
 * the three writers and false of the one that does the work.
 * `routers/hub.py:3942` numbers every Serper result — `r["ref"] = first_web_ref
 * + i` — adds each number to `citable`, and renders them into the prompt
 * precisely so the model can cite them; `strip_invalid_refs` then KEEPS those
 * markers instead of deleting them, and its own comment says why. Nulling the
 * number here broke the join at the last step: the marker printed, the panel
 * held the page, and nothing connected the two.
 *
 * MEASURED 2026-08-17: 75 of the 77 stored web sources carry a `ref`, and web
 * is 77 of the 90 citations this product has ever made. So that one clause
 * rendered nearly every citation in the assistant's history as dead text.
 *
 * The two writers that genuinely have no number are `sahayak_answer.
 * web_sources` (Gemini's own grounding, never numbered) and `hub_chat.py:503`.
 * They still come out with `ref: null` and no `[n]` ever points at them — the
 * number is now READ rather than assigned, so absent stays absent.
 *
 * `ref` is coerced rather than trusted to be an int. `POST /v1/hub/chat` builds
 * the list in Python and the value arrives as a number; the jsonb column read
 * back over a connection whose codec never registered (below) hands back the
 * CHARACTERS `1`. Both are the same citation.
 *
 * ── A URL from a search API is the least trusted string on this screen ──────
 *
 * `url` comes from Serper by way of the model, so the scheme is not ours to
 * assume. `safeUrl` refuses anything that is not an absolute http(s) URL —
 * `javascript:`, `data:` and a scheme-relative `//host` all come out empty —
 * and a source with no safe URL is drawn as a plain block rather than as a
 * link, which is what a KB chunk already does. Nothing here REPAIRS a URL:
 * `hostOf`'s fallback exists to LABEL a card whose value will not parse, never
 * to navigate to it.
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
 * the defect `parseSchema` in `sahayak/_shared` exists for on `input_schema`.
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

/**
 * The one string on this screen that becomes an `href`, and the only scheme
 * check standing between a search result and `javascript:alert(document.cookie)`
 * in a customer's browser.
 *
 * An absolute http(s) URL comes back normalised; everything else — a relative
 * path, a scheme-relative `//host`, `javascript:`, `data:`, `vbscript:`, a
 * value with a newline smuggled into the scheme — comes back empty, and every
 * caller draws the unlinked shape for an empty one. Whitelist rather than
 * blacklist: a list of bad schemes is a list of the ones we thought of.
 */
export function safeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

function one(s, i) {
  if (!s || typeof s !== 'object') return null;

  // `type: "web"` is what all three writers set. The `url && !ref` fallback
  // covers a grounded source stored before that key was being set — the same
  // message history this whole file degrades gracefully for.
  const raw = String(s.url ?? '').trim();
  const isWeb = s.type === 'web' || (!!raw && s.ref == null);
  // Read for BOTH kinds. hub.py numbers Serper results into the prompt, so a
  // web page is cited by `[n]` exactly as a KB chunk is; only the writers that
  // never numbered anything produce a source with no number here.
  const refNum = Number(s.ref);
  const ref = Number.isFinite(refNum) && refNum > 0 ? refNum : null;

  const title = String(s.title ?? '').trim();
  const url = isWeb ? safeUrl(raw) : '';

  return {
    // Stable within one message, which is all a React key and a highlight
    // target need. `ref` is NOT unique — an ungrounded web source has none.
    key: `s${i}`,
    kind: isWeb ? 'web' : 'kb',
    ref,
    // A source with neither a title nor a host would render as a blank card,
    // which reads as a rendering fault rather than as thin metadata. `raw`
    // rather than `url`: a card whose URL we refuse to open still says where it
    // claimed to come from.
    title: title || (isWeb ? hostOf(raw) : '') || 'Untitled source',
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

/* `provenanceOf` lived here and coloured the `.sh-ac` answer card by what
   grounded the reply. The prototype has no provenance-coloured card — the
   provenance is the sources panel — so the card family and this helper went
   together rather than leaving a tone nothing paints. */
