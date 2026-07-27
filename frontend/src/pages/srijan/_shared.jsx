// Constants and helpers shared across the Srijan (org) tabs.
//
// `OrgSrijanPage.jsx` was 1,291 lines carrying 241 inline styles and all six
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

export const PLATFORMS = ['Instagram', 'LinkedIn', 'WhatsApp', 'Facebook', 'Twitter / X', 'Email', 'Google Ads', 'Website'];
export const TONES = ['Professional', 'Casual', 'Festive', 'Formal', 'Friendly', 'Urgent'];
export const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['gu', 'Gujarati'],
  ['mr', 'Marathi'], ['ta', 'Tamil'], ['hinglish', 'Hinglish'],
];

/**
 * The per-platform guidance shown under the Generate form.
 *
 * `charLimit` is a hard platform constraint, not our advice — Twitter really is
 * 280 — so it is stated as a number. Everything else is prose.
 */
export const PLATFORM_HINTS = {
  Instagram: { hint: 'An image is required. Captions cannot carry a clickable link — use “link in bio”. Five to fifteen hashtags is the useful range.', charLimit: 2200 },
  LinkedIn: { hint: 'A professional register reads best. Tag companies with @. Long-form articles reach further than plain text.', charLimit: 3000 },
  WhatsApp: { hint: 'Short and conversational. A broadcast list holds up to 256 contacts.', charLimit: 1000 },
  Facebook: { hint: 'Images and video lift engagement. Links get an automatic preview, so you rarely need to describe them.', charLimit: 63206 },
  'Twitter / X': { hint: 'One tweet is 280 characters. Use a thread for anything longer; one or two hashtags is plenty.', charLimit: 280 },
  Email: { hint: 'The subject line does most of the work — keep it under about 50 characters. The first line shows as preview text in the inbox.', charLimit: null },
  'Google Ads': { hint: 'Headlines are capped at 30 characters and descriptions at 90. Include the keyword and one clear action.', charLimit: null },
  Website: { hint: 'Write for search as well as for people: a meta description around 155 characters, and real headings for structure.', charLimit: null },
};

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
