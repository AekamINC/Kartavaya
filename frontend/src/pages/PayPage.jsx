/**
 * PayPage — what a customer sees at `pay.kartavaya.com/i/{token}`.
 *
 * P3. Reads `GET /api/v1/pay/{token}` (routers/pay.py) and nothing else. No
 * session, no org header, no other endpoint: a stranger with a link is the only
 * visitor this page ever has.
 *
 * ── The doorstep, and why it is not the invoice ─────────────────────────────
 *
 * The link gets FORWARDED — into a group chat, onto a phone left on a desk. So
 * the first screen carries only what WhatsApp already put in its own preview
 * card: who sent it, the number, the due date, the amount, who it is billed to.
 * Line items, HSN codes, GSTINs, addresses and terms stay behind a deliberate
 * tap, so a forwarded thread does not spill a client's order book to whoever
 * scrolls past. Approved in `docs/proposals/37-final-flow.html`.
 *
 * ── There is no payment gateway, and there will not be one ─────────────────
 *
 * The customer pays the firm's own UPI address directly. Kartavaya never holds
 * the money and takes on no PCI scope. The price of that is real and is stated
 * ON THE PAGE rather than hidden: there is no callback, so nothing here may
 * promise a receipt. `settlement.instant_confirmation` comes from the API as
 * `false` and the wording below is bound to it — if a gateway ever does appear,
 * the copy changes because the data changed, not because someone remembered.
 *
 * ── Why the platform branch exists ─────────────────────────────────────────
 *
 *   Android   `intent://` with `browser_fallback_url` — the only form that opens
 *             a specific UPI app AND survives that app being absent. A bare
 *             `upi://` on Android with no handler is a dead tap with no error.
 *   iOS       a scheme with a timer: iOS gives no signal that a scheme failed,
 *             so the page waits and then reveals the manual details itself. A
 *             visible fallback after a beat beats a screen that did nothing.
 *   Desktop   QR only. A scheme cannot work on a Mac — there is no UPI app to
 *             receive it — and rendering a dead button there is the single
 *             easiest way to make this page look broken.
 *
 * The QR encodes a standard `upi://pay` string so ANY bank scanner reads it.
 * A `phonepe://` code is not a valid UPI QR and other apps reject it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { inr } from '../lib/inr';
import '../styles/pay.css';

const BACKEND = import.meta.env.VITE_BACKEND_URL;

/* Platform detection is done ONCE, from the UA, and only to choose which
   payment affordance to render. It never gates what the page shows about the
   invoice — a wrong guess must cost a button shape, never information. */
function platform() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
  return 'desktop';
}

/** The one standard UPI string. Every branded button is built from this. */
function upiUri({ vpa, payee_name }, amount, note) {
  const p = new URLSearchParams({
    pa: vpa,
    pn: payee_name || '',
    am: Number(amount || 0).toFixed(2),
    cu: 'INR',
  });
  if (note) p.set('tn', note);
  return `upi://pay?${p.toString()}`;
}

/* The Android package each platform's intent targets. A missing entry opens the
   chooser, which is the correct behaviour for "Other UPI app" and the wrong one
   for a button that names PhonePe.

   THIS IS NOT THE BUTTON LIST. Since P3b the buttons come from
   `payable.accounts` — the addresses this org actually holds — because each
   platform is a SEPARATE ACCOUNT of theirs, not a different route to one
   account. A fixed list here would offer a PhonePe button to a firm that has no
   PhonePe account and send the money to whichever address we guessed. */
const PKG = {
  gpay:      'com.google.android.apps.nbu.paisa.user',
  phonepe:   'com.phonepe.app',
  paytm:     'net.one97.paytm',
  bhim:      'in.org.npci.upiapp',
  amazonpay: 'in.amazon.mShop.android.shopping',
};

/* Written out rather than interpolated as `pay__st--${status}`.
   `check-orphan-selectors` reads the source for class names and cannot see a
   template literal, so an interpolated modifier reports as CSS that shipped
   without its page — and, more usefully, a status the API invents later falls
   back to the base class here instead of silently producing a class that does
   not exist. Only the two publicly reachable states have a colour; `paid` and
   `cancelled` never reach this page. */
const STATUS_CLASS = {
  unpaid:  'pay__st pay__st--unpaid',
  partial: 'pay__st pay__st--partial',
};

function androidIntent(uri, pkg) {
  // `browser_fallback_url` is the whole point: without it, a device with no
  // such app shows a blank chrome error instead of coming back here.
  const body = uri.replace(/^upi:\/\//, '');
  const pkgPart = pkg ? `package=${pkg};` : '';
  return `intent://${body}#Intent;scheme=upi;${pkgPart}` +
         `S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`;
}

/** QR without a dependency — the API has no CSP allowance for a CDN, and a
 *  payment page is the last place to add a third-party script.
 *
 *  It takes the TOKEN, not a UPI string. `?data=<anything>` would be an open
 *  redirect in QR form: anyone could hand out a kartavaya.com link rendering a
 *  code that pays THEIR account, with our domain lending it credibility. The
 *  payee is never an input — the server reads it from the same row. */
function QR({ token, platform }) {
  const q = `token=${encodeURIComponent(token)}` +
            (platform ? `&platform=${encodeURIComponent(platform)}` : '');
  return (
    <img
      className="pay__qr"
      alt="Scan with any UPI app to pay"
      src={`${BACKEND}/api/v1/pay/qr/svg?${q}`}
      width={200}
      height={200}
    />
  );
}

/* P6 — tell the sender the link was opened.
 *
 * WITHOUT THIS THE FIRM CANNOT TELL two situations apart: an invoice nobody
 * looked at, and one whose link a customer opened four times yesterday. The
 * second is someone who meant to pay and was stopped, and with no gateway
 * anywhere in this flow it is the most useful signal the product can produce.
 *
 * `keepalive` because the most interesting report — "a pay button was pressed"
 * — happens as the page is being replaced by a UPI app. A normal fetch is
 * cancelled on navigation, so exactly the event worth recording is the one that
 * would go missing.
 *
 * Every failure is swallowed and nothing is awaited: a payment screen must
 * never be slower, or broken, because a log line could not be written. The
 * endpoint answers the same `{ok:true}` for an unknown token as for a real one,
 * so this cannot be used to test whether a token exists either.
 */
function report(token, outcome, platform) {
  try {
    const q = new URLSearchParams({ outcome });
    if (platform) q.set('platform', platform);
    fetch(`${BACKEND}/api/v1/pay/${encodeURIComponent(token)}/scan?${q}`,
          { method: 'POST', keepalive: true }).catch(() => {});
  } catch { /* never let this reach the payer */ }
}

export default function PayPage() {
  const { token } = useParams();
  const [data,   setData]   = useState(null);
  const [error,  setError]  = useState(null);
  const [open,   setOpen]   = useState(false);   // has the doorstep been opened
  const [waiting, setWaiting] = useState(false); // iOS: scheme fired, no signal
  // Which account's QR is on screen. Index 0 is the org's default, and the
  // customer only ever sees this control when there is more than one.
  const [shown, setShown] = useState(0);
  const plat = useMemo(platform, []);

  useEffect(() => {
    let live = true;
    // Plain fetch, NOT `lib/api`: that instance attaches the Authorization
    // header and the active-org header from localStorage. On a shared or
    // borrowed device that would send a stranger's session to a public route.
    fetch(`${BACKEND}/api/v1/pay/${encodeURIComponent(token)}`)
      .then(async r => {
        if (!live) return;
        if (r.ok) {
          setData(await r.json());
          // Only for an invoice that really is payable — the endpoint refuses
          // anything else anyway, and reporting a view of a 404 is noise.
          report(token, 'view');
        } else setError(r.status);
      })
      .catch(() => live && setError(0));
    return () => { live = false; };
  }, [token]);

  if (error !== null) {
    return (
      <main className="pay pay--msg">
        <h1 className="pay__msgt">This link is not available</h1>
        <p className="pay__msgp">
          {error === 0
            ? 'We could not reach the server. Check your connection and try again.'
            : 'It may have been paid already, cancelled, or the link may be incomplete. ' +
              'Ask the sender for a fresh link.'}
        </p>
      </main>
    );
  }

  if (!data) return <main className="pay pay--msg"><p className="pay__msgp">Loading…</p></main>;

  const { invoice, payee, billed_to, lines, totals, status, settlement, payable } = data;
  const due = totals.amount_due;
  // The API orders these with the org's default first, so `accounts[0]` is the
  // one to show when the customer has expressed no preference. The ordering IS
  // the contract — a separate "which is default" field beside the list would be
  // a second thing to believe and a way for the two to disagree.
  const accounts = payable?.accounts || [];

  const pay = (account) => {
    // Before navigating: on Android the next line replaces this page.
    report(token, 'app', account.platform);
    const uri = upiUri(account, due, `${payee.name} ${invoice.number}`);
    if (plat === 'android') {
      window.location.href = androidIntent(uri, PKG[account.platform]);
      return;
    }
    // iOS gives no failure signal for an unhandled scheme, so the page reveals
    // the manual details itself after a beat rather than sitting there.
    setWaiting(true);
    window.location.href = uri;
    setTimeout(() => setWaiting(true), 1500);
  };

  return (
    <main className="pay">
      {/* ── Doorstep ──────────────────────────────────────────────────────── */}
      <section className="pay__card">
        {/* WHO IS ASKING, first and unmistakably.
            A payment link arrives from a number the recipient may not have
            saved. Before the amount means anything they have to believe the
            sender is who the message claimed — so the firm's own logo and name
            lead, in the brand colour, rather than a grey caption above a
            number. `logo_url` is signed by the API from `logo_key`; it is null
            for every organisation today because none has uploaded one, so this
            degrades to the name alone by design and not by accident. */}
        <header className="pay__id">
          {payee.logo_url && (
            <img
              className="pay__logo"
              src={payee.logo_url}
              alt=""
              /* alt="" — decorative. The name is beside it in text, and a
                 screen reader announcing "Aekam Inc logo, Aekam Inc" is worse
                 than one that reads the name once. */
            />
          )}
          <p className="pay__from">{payee.name}</p>
        </header>
        <h1 className="pay__amt">{inr(due, { decimals: 2 })}</h1>
        <dl className="pay__facts">
          <div><dt>Invoice</dt><dd className="pay__mono">{invoice.number}</dd></div>
          {invoice.due_date && <div><dt>Due</dt><dd>{invoice.due_date}</dd></div>}
          {/* `billed_to` comes back EMPTY when the invoice has no linked client
              — true of the first live invoice probed — so the row is omitted
              rather than printed as a blank label. */}
          {billed_to.name && <div><dt>Billed to</dt><dd>{billed_to.name}</dd></div>}
          <div><dt>Status</dt><dd className={STATUS_CLASS[status] || 'pay__st'}>{status}</dd></div>
        </dl>

        {accounts.length ? (
          <div className="pay__acts">
            {plat === 'desktop' ? (
              <>
                <QR token={token} platform={accounts[shown].platform} />
                {/* Only when there is a genuine choice. One account and this is
                    a row of one button pretending to be a decision. */}
                {accounts.length > 1 && (
                  <div className="pay__picks" role="tablist" aria-label="Choose where to pay">
                    {accounts.map((a, i) => (
                      <button
                        key={a.platform}
                        role="tab"
                        aria-selected={i === shown}
                        className={i === shown ? 'pay__pick pay__pick--on' : 'pay__pick'}
                        onClick={() => setShown(i)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
                <p className="pay__hint">
                  Scan with any UPI app on your phone — the code is a standard UPI
                  code, so it works from whichever app you use.
                </p>
              </>
            ) : (
              accounts.map(a => (
                <button key={a.platform} className="pay__btn" onClick={() => pay(a)}>
                  Pay with {a.label}
                </button>
              ))
            )}
            <p className="pay__vpa">
              Or pay this UPI ID directly:{' '}
              <span className="pay__mono">{accounts[plat === 'desktop' ? shown : 0].vpa}</span>
            </p>
          </div>
        ) : (
          /* Zero organisations had a VPA when this was written. A missing one is
             a normal state, not an error, and must not render a dead button or
             an unscannable code. */
          <p className="pay__hint">
            This sender has not published a UPI address. Use the bank details on
            the invoice, or ask them for one.
          </p>
        )}

        {waiting && (
          <p className="pay__hint">
            If your UPI app did not open, use the UPI ID above in any payment app.
          </p>
        )}

        {/* Bound to the API's own flag, so this cannot drift from the truth. */}
        {settlement && !settlement.instant_confirmation && (
          <p className="pay__settle">{settlement.note}</p>
        )}
      </section>

      {/* ── Behind a tap, deliberately ─────────────────────────────────────── */}
      <button
        className="pay__toggle"
        onClick={() => { if (!open) report(token, 'invoice'); setOpen(o => !o); }}
        aria-expanded={open}
      >
        {open ? 'Hide invoice' : 'View invoice'}
      </button>

      {open && (
        <section className="pay__inv">
          <div className="pay__invhd">
            <span>{payee.name}</span>
            {payee.gstin && <span className="pay__mono">GSTIN {payee.gstin}</span>}
          </div>
          <div className="pay__tblwrap">
            <table className="pay__tbl">
              <thead>
                <tr>
                  <th>Description</th><th>HSN/SAC</th>
                  <th className="pay__num">Qty</th><th className="pay__num">Rate</th>
                  <th className="pay__num">GST</th><th className="pay__num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td className="pay__mono">{l.hsn_code || '—'}</td>
                    <td className="pay__num">{l.quantity}</td>
                    <td className="pay__num">{inr(l.rate, { decimals: 2 })}</td>
                    <td className="pay__num">{l.gst_rate}%</td>
                    <td className="pay__num">{inr(l.amount, { decimals: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="pay__tot">
            <div><dt>Subtotal</dt><dd>{inr(totals.subtotal, { decimals: 2 })}</dd></div>
            {totals.cgst > 0 && <div><dt>CGST</dt><dd>{inr(totals.cgst, { decimals: 2 })}</dd></div>}
            {totals.sgst > 0 && <div><dt>SGST</dt><dd>{inr(totals.sgst, { decimals: 2 })}</dd></div>}
            {totals.igst > 0 && <div><dt>IGST</dt><dd>{inr(totals.igst, { decimals: 2 })}</dd></div>}
            <div className="pay__totrow"><dt>Total</dt><dd>{inr(totals.total, { decimals: 2 })}</dd></div>
            <div className="pay__totrow"><dt>Amount due</dt><dd>{inr(due, { decimals: 2 })}</dd></div>
          </dl>
          {invoice.terms && <p className="pay__terms">{invoice.terms}</p>}
        </section>
      )}

      <footer className="pay__foot">
        कर्तव्य · Kartavaya <span>by Aekam Inc</span>
      </footer>
    </main>
  );
}
