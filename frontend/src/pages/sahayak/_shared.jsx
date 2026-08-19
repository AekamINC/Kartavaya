// Constants and helpers shared across the Sahayak (org) tabs.
//
// `OrgSahayakPage.jsx` was 1,291 lines carrying 241 inline styles and all six
// tabs. Split per 13-module-pages.md before styling, for the same reason as
// every other module: a restyle of a single-file module touches every tab, form
// and table at once and the diff is unreviewable.
//
// The failure rule is the same one the Hub directory is built on and is repeated
// here because this module is where it was worst: `DataRunsTab` did
// `.catch(() => pushToast(...))` and then rendered "No data runs yet. Go to Data
// Catalog to start one." — an instruction to spend credits re-running work that
// may have already succeeded. Same shape in `ContentTab`, `SkillsTab` and
// `DataCatalogTab`.
import React from 'react';

export const AGENT_LABELS = {
  social_media: 'Social Media', blog: 'Blog', ad_copy: 'Ad Copy',
  email: 'Email', whatsapp: 'WhatsApp', lead_magnet: 'Lead Magnet',
  campaign: 'Campaign Strategy', seo: 'SEO Content',
};

/** Scraper run status → token. Was raw hex tinted with a `${c}18` suffix. */
export const RUN_TONE = {
  pending: 'var(--warn)',
  running: 'var(--st-in-progress)',
  succeeded: 'var(--ok)',
  failed: 'var(--danger)',
};

export const SCRAPER_CATEGORIES = {
  social: 'Social Media', leads: 'Lead Generation', seo: 'SEO & Search',
  linkedin: 'LinkedIn', google_ads: 'Google Ads', meta_ads: 'Meta Ads',
  ecommerce: 'E-commerce', govindia: 'GovIndia (MCA / GST)', whatsapp: 'WhatsApp',
  enrichment: 'Contact Enrichment',
};

export const TONES = ['Professional', 'Casual', 'Festive', 'Formal', 'Friendly', 'Urgent'];
export const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['gu', 'Gujarati'],
  ['mr', 'Marathi'], ['ta', 'Tamil'], ['hinglish', 'Hinglish'],
];

/**
 * Everything about a destination — its cap, its guidance and its markup —
 * lives in `./platformText`, and is re-exported here for the callers that
 * already read these two names.
 *
 * The list and the hints used to be declared in this file while the shaping
 * (`toPlain`, `toWhatsApp`) sat further down it, which is two halves of one
 * fact in two places: WhatsApp's character cap was stated here and its
 * `*bold*` markup was encoded there, and nothing made them agree about what a
 * platform even is. The Generate tab reads the same row the preview formats
 * from now.
 */
export {
  PLATFORMS, PLATFORM_HINTS, PLATFORM_RENDERING, platformKey,
  toPlain, toWhatsApp, toUnicode, formatFor, variantsFor,
} from './platformText';

/**
 * The quick-generate presets.
 *
 * `credits` is deliberately absent. It was hard-coded here (`credits: 3`) while
 * the server owns `CREDIT_COSTS` and serves it on `/v1/hub/org/credits` — two
 * copies of a cost list, with the stale one telling people what a run would
 * spend. The Generate tab reads the served table and shows nothing rather than
 * a wrong number when it has not loaded.
 */
export const QUICK_SKILLS = [
  { id: 'social_post', label: 'Social post', hi: 'सोशल पोस्ट', hasImage: true, agent: 'social_media',
    desc: 'One post for Instagram, LinkedIn or WhatsApp, with a matching image.' },
  { id: 'email_campaign', label: 'Email campaign', hi: 'ईमेल', hasImage: true, agent: 'email',
    desc: 'Subject line, preview text and body, plus a banner.' },
  { id: 'ad_copy', label: 'Ad copy', hi: 'विज्ञापन', hasImage: true, agent: 'ad_copy',
    desc: 'Headlines, body copy and a creative for any ad platform.' },
  { id: 'blog_post', label: 'Blog post', hi: 'ब्लॉग', hasImage: true, agent: 'blog',
    desc: 'A search-friendly article with a featured image.' },
  { id: 'whatsapp_broadcast', label: 'WhatsApp', hi: 'व्हाट्सएप', hasImage: false, agent: 'whatsapp',
    desc: 'A short broadcast message for WhatsApp Business.' },
  { id: 'proposal', label: 'Proposal', hi: 'प्रस्ताव', hasImage: false, agent: 'lead_magnet',
    desc: 'A sectioned business proposal.' },
  { id: 'festival_campaign', label: 'Festival campaign', hi: 'त्योहार', hasImage: true, agent: 'campaign',
    desc: 'A full festival campaign shaped for the Indian calendar.' },
];

/** `social_media` → `social media`. */
export const words = s => String(s ?? '').replace(/_/g, ' ');

/**
 * `1 credit` / `3 credits`.
 *
 * The served cost table has a single-credit entry in it, so the bare
 * `${n} credits` template printed "1 credits" on the WhatsApp preset every time
 * the Generate tab loaded. Mirrors the helper of the same name in `hub/_shared`.
 *
 * NOT called `credits`: `GenerateTab` and `CreditsTab` both take a prop by that
 * name, and a destructured parameter shadows a module import silently — the
 * helper would become whatever object the parent passed.
 */
export const creditLabel = n => `${n} credit${Math.abs(Number(n)) === 1 ? '' : 's'}`;

/**
 * A scraper's `input_schema` as an array, whatever shape it arrives in.
 *
 * The column is jsonb and comes back EITHER decoded or as a JSON string —
 * `routers/scrapers.py:159` guards for exactly that (`if isinstance(schema,
 * str): schema = json.loads(schema)`) before it iterates. The catalog did not,
 * so `(s.input_schema || []).filter(...)` threw `filter is not a function` the
 * moment such a row was clicked, and because the throw happened during render
 * it unmounted the whole Sahayak page rather than just the dialog.
 *
 * Same contract as `parseSteps` in `hub/skills/_shared` — array, string, or
 * anything else, out comes an array.
 */
export function parseSchema(schema) {
  if (Array.isArray(schema)) return schema;
  if (typeof schema === 'string') {
    try { const v = JSON.parse(schema); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

/**
 * The brief an image was actually made from, wherever the row is carrying it.
 *
 * There is no `image_prompt` column. `hub_content_items` has an existing
 * `metadata` jsonb and both write paths put the built prompt inside it —
 * staging and production share one Supabase database, so the schema is
 * owner-gated and a new column was not on the table. A screen reading
 * `item.image_prompt` therefore read `undefined` on every row ever created and
 * printed "This run did not report the brief it built" for images whose brief
 * was sitting in the response the whole time, which turns the one diagnostic
 * this product has for "less AI slop" into a permanent shrug.
 *
 * Both shapes of the jsonb are handled for the same reason `parseSchema` above
 * handles both: the decoder is registered per connection and `db.py` logs a
 * warning and carries on when PgBouncer refuses the codec, so a decoded object
 * is the normal case and a JSON string is the degraded one, not the impossible
 * one.
 */
export function imageBriefOf(source) {
  if (!source || typeof source !== 'object') return '';
  const direct = source.image_prompt;
  if (typeof direct === 'string' && direct.trim()) return direct;

  let meta = source.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { return ''; }
  }
  const inner = meta && typeof meta === 'object' ? meta.image_prompt : null;
  return typeof inner === 'string' ? inner : '';
}

export function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function shortStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/**
 * Markdown, rendered as React elements.
 *
 * The previous implementation built an HTML string and set it with
 * `dangerouslySetInnerHTML`, escaping by hand in `boldify`. Model output is
 * untrusted text: any gap in that hand-rolled escaper is stored XSS with an AI
 * writing the payload. It also inlined a `<code style="…">` attribute INSIDE the
 * generated HTML, which is a raw CSS property value in markup that no styling
 * sweep can reach.
 *
 * This returns elements. React escapes text content by construction, so there
 * is nothing left to get wrong, and every piece carries a class.
 */
export function Markdown({ text }) {
  if (!text) return null;
  return (
    <div className="sr-md">
      {String(text).split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 className="sr-md__h4" key={i}>{inline(line.slice(4))}</h4>;
        if (line.startsWith('## ')) return <h3 className="sr-md__h3" key={i}>{inline(line.slice(3))}</h3>;
        if (line.startsWith('# ')) return <h2 className="sr-md__h2" key={i}>{inline(line.slice(2))}</h2>;
        if (line.startsWith('---')) return <hr className="sr-md__hr" key={i} />;
        if (/^[-*]\s/.test(line)) {
          return (
            <div className="sr-md__li" key={i}>
              <span className="sr-md__b" aria-hidden="true">&bull;</span>
              <span>{inline(line.slice(2))}</span>
            </div>
          );
        }
        const num = line.match(/^(\d+)\.\s/);
        if (num) {
          return (
            <div className="sr-md__li" key={i}>
              <span className="sr-md__b sr-md__b--n">{num[1]}.</span>
              <span>{inline(line.replace(/^\d+\.\s/, ''))}</span>
            </div>
          );
        }
        if (!line.trim()) return <div className="sr-md__gap" key={i} />;
        return <p className="sr-md__p" key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

/* ── Copying the result out ────────────────────────────────────────────────
 *
 * The one control on the result pane put `result.text` — the RAW MARKDOWN —
 * on the clipboard. Pasted anywhere it was going (WhatsApp, Instagram, a
 * LinkedIn box, Gmail, Word) that is literal `**asterisks**`, `###` and `- `,
 * which the reader then strips by hand. The generated post is the deliverable;
 * handing it over in source form makes the last step manual on every run.
 *
 * Four destinations, four shapes — `./platformText` holds them, because which
 * marks survive is a fact about the platform and not about the clipboard:
 *   · rich      — `text/html` beside `text/plain`, so an editor that accepts
 *                 HTML keeps the bold, headings and lists
 *   · plain     — markdown syntax removed, not pasted
 *   · WhatsApp  — its OWN markup, which is `*bold*` and not `**bold**`
 *   · Unicode   — LinkedIn, which has no markup at all, so emphasis is
 *                 substituted characters
 */

/**
 * Put both flavours on the clipboard at once.
 *
 * `ClipboardItem` carries `text/html` AND `text/plain` together, and the paste
 * target picks: Gmail takes the HTML, a terminal takes the text. Returns which
 * shape it managed, because not every browser allows the two-flavour write and
 * saying "Copied with formatting" when it fell back to plain would be a lie.
 */
export async function copyRich(html, plain) {
  try {
    // `html` may be null on purpose — the WhatsApp copy has no rich flavour,
    // because WhatsApp reads its own markup out of PLAIN text and would show
    // the tags if handed HTML.
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
      return 'rich';
    }
  } catch {
    // Firefox refused `text/html` for years, and a permissions policy can
    // block `write` outright. Neither is worth an error — there is a shape
    // that always works.
  }
  try {
    await navigator.clipboard.writeText(plain);
    return 'plain';
  } catch {
    return 'failed';
  }
}

/**
 * The image itself on the clipboard, not its URL.
 *
 * "Copy link" was the only option, and a signed R2 link expires — pasted into a
 * document it is a dead reference by the next day. Browsers accept `image/png`
 * on the clipboard and the generator returns PNG.
 */
export async function copyImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** `**bold**`, `*italic*` and `` `code` `` as elements, never as HTML. */
function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${m.index}`;
    if (tok.startsWith('**')) out.push(<b key={key}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith('`')) out.push(<code className="hb-code" key={key}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
