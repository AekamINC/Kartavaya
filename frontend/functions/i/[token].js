/**
 * /i/:token on Cloudflare Pages — W4 of docs/CLOUDFLARE-MIGRATION.md.
 *
 * The Pages counterpart of frontend/api/og.js (which stays until E3 —
 * decommission only a week after cutover). INERT ON VERCEL: Vercel's function
 * directory is api/, not functions/, so this file does nothing until a Pages
 * project builds from frontend/.
 *
 * One structural difference from the Vercel arrangement, and it is forced:
 * vercel.json routes crawlers here BY HEADER at the edge, but _redirects
 * cannot match on User-Agent — so on Pages the function owns the path for
 * EVERYONE (functions outrank _redirects) and does the split itself. A human
 * gets the SPA shell via the ASSETS binding; a crawler gets the card. A wrong
 * guess costs a crawler a generic card, never a person a broken page.
 *
 * Everything else is carried over verbatim from api/og.js, most importantly
 * THE RULE THAT MUST SURVIVE ANY REWRITE: draft, cancelled, settled and
 * unknown tokens all render the byte-identical generic card. The public route
 * (routers/pay.py) is written so a real token cannot be told from a guess;
 * a card that said "this one is settled" would give that distinction away in
 * a meta tag.
 */

const CRAWLER_RE =
  /(whatsapp|facebookexternalhit|facebookcatalog|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|skypeuripreview|embedly|bitlybot|googlebot)/i;

const GENERIC = {
  title: 'Invoice — Kartavaya',
  description: 'Open the link to view this invoice and pay by UPI.',
};

function attr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inr(n) {
  const v = Number(n || 0);
  try {
    return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  } catch {
    return '₹' + Math.round(v);
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;

  // Humans get the SPA shell exactly as _redirects would have served it.
  const ua = request.headers.get('user-agent') || '';
  if (!CRAWLER_RE.test(ua)) {
    return env.ASSETS.fetch(new URL('/index.html', request.url));
  }

  const BACKEND = env.VITE_BACKEND_URL || env.BACKEND_URL || '';
  const token = String(params.token || '').trim();

  let card = GENERIC;
  // Same shape check the API runs before it queries, so a scan of junk paths
  // costs a string comparison here too.
  if (BACKEND && /^[A-Za-z0-9_-]{16}$/.test(token)) {
    try {
      const r = await fetch(
        `${BACKEND}/api/v1/pay/${encodeURIComponent(token)}`,
        { headers: { accept: 'application/json' } },
      );
      if (r.ok) {
        const d = await r.json();
        const due = d?.totals?.amount_due;
        const payee = d?.payee?.name || '';
        const number = d?.invoice?.number || '';
        card = {
          // Who it is from and how much — never the line items. A forwarded
          // chat must not spill a client's order book to whoever scrolls past.
          title: `${inr(due)} due to ${payee}`.trim(),
          description: [
            number && `Invoice ${number}`,
            d?.invoice?.due_date && `payable by ${d.invoice.due_date}`,
          ].filter(Boolean).join(' · ') + '. View and pay by UPI.',
        };
      }
    } catch {
      // A backend hiccup must not 500 a link somebody just shared. The
      // generic card is a worse preview, not a broken one.
    }
  }

  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${attr(card.title)}</title>
<meta name="description" content="${attr(card.description)}" />
<meta property="og:title" content="${attr(card.title)}" />
<meta property="og:description" content="${attr(card.description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Kartavaya" />
<meta name="twitter:card" content="summary" />
<meta name="robots" content="noindex, nofollow" />
</head>
<body>
<p>${attr(card.title)}</p>
<p>${attr(card.description)}</p>
</body>
</html>`, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short and PRIVATE — a shared CDN cache holding one customer's invoice
      // preview is not a trade worth making for a few kilobytes.
      'cache-control': 'private, max-age=300',
    },
  });
}
