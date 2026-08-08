/**
 * P4 — the preview card for a shared invoice link.
 *
 * WhatsApp's crawler does not run JavaScript. `/i/{token}` is a React route, so
 * to a crawler the page is an empty `<div id="root">` and the card it renders is
 * the app's generic "Kartavaya — practice management…" description. Most of the
 * value of sending a link in a chat is that card: without it the recipient sees
 * a bare URL from a business number, which is the thing people have been taught
 * not to tap.
 *
 * ── Only crawlers reach this ────────────────────────────────────────────────
 *
 * `vercel.json` rewrites `/i/:token` here ONLY when the User-Agent matches a
 * known crawler; every human still gets the SPA. The rule sits above the
 * catch-all `/((?!api/).*) -> /index.html`, matched case-insensitively, and its
 * UA list is the bots that actually render a card where this link is sent.
 *
 * THE REASONING LIVES HERE AND NOT BESIDE THE RULE because vercel.json takes
 * no comments — not `//` line comments and not a `"//"` KEY, which is what I
 * tried first. An unknown property in a rewrite object fails schema validation,
 * and the deployment then errors BEFORE the build, so there are no build logs
 * to read and nothing on the site changes. Three deployments died that way on
 * 2026-08-08 while the API half of a breaking change was already live.
 *
 * UA sniffing is a poor
 * foundation in general, and it is the right one here: the alternative is
 * serving this shell to everybody and having it hand off to the app, which
 * means reproducing Vite's hashed asset names in a file that is not built by
 * Vite. A wrong guess costs a crawler a generic card, never a broken page.
 *
 * ── It re-fetches, and it re-refuses ────────────────────────────────────────
 *
 * The data comes from the same public route the page uses, so an invoice that
 * is a draft, cancelled or already settled produces the SAME generic card as an
 * unknown token. A card that said "this invoice is settled" would confirm a
 * real token to anyone holding a guess, which is precisely the distinction
 * `routers/pay.py` is written to avoid — it would be careless to give it away
 * in a meta tag.
 *
 * ── No og:image, deliberately ───────────────────────────────────────────────
 *
 * The same reasoning `index.html` already records: pointing at an image that
 * does not exist yields a BLANK preview, which is worse than a compact one.
 * There is no per-invoice card image and no image stack in the backend to make
 * one with (`segno` was chosen over Pillow precisely to avoid it). A generated
 * 1200x630 carrying the payee and the amount is a real improvement and is a
 * separate piece of work; the text card is most of the benefit and it is honest.
 */

const BACKEND =
  process.env.VITE_BACKEND_URL || process.env.BACKEND_URL || '';

/** Escape for an HTML attribute. These strings are an org's own name and an
 *  invoice number, but they arrive from a database and land inside quotes in
 *  markup — the one place a stray `"` becomes markup rather than text. */
function attr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const GENERIC = {
  title: 'Invoice — Kartavaya',
  description: 'Open the link to view this invoice and pay by UPI.',
};

function inr(n) {
  const v = Number(n || 0);
  // Indian grouping, because the recipient is Indian by construction. Node's
  // ICU has en-IN; if a runtime ever ships without it the fallback is a plain
  // number, not a crash on a payment link.
  try {
    return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  } catch {
    return '₹' + Math.round(v);
  }
}

export default async function handler(req, res) {
  const token = String(req.query?.token || '').trim();

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
          // What the recipient needs to decide whether this is real: who it is
          // from, and how much. Not the line items — those stay behind the tap
          // on the page itself, and a forwarded chat must not spill a client's
          // order book to whoever scrolls past.
          title: `${inr(due)} due to ${payee}`.trim(),
          description: [
            number && `Invoice ${number}`,
            d?.invoice?.due_date && `payable by ${d.invoice.due_date}`,
          ].filter(Boolean).join(' · ') + '. View and pay by UPI.',
        };
      }
    } catch {
      // A backend hiccup must not 500 a link somebody just shared. The generic
      // card is a worse preview, not a broken one.
    }
  }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  // Short and PRIVATE. The card carries an amount and a payee; a shared CDN
  // cache holding one customer's invoice preview is not a trade worth making
  // for a few kilobytes.
  res.setHeader('cache-control', 'private, max-age=300');
  res.status(200).send(`<!doctype html>
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
</html>`);
}
