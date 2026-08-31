/**
 * PublicLeadForm.jsx — the hosted page for a Graha web form.
 * Route: `/f/:slug` — NO <Protected> wrapper, NO session, NO org header.
 *
 * ── WHY THIS PAGE HAD TO EXIST ─────────────────────────────────────────────
 * `POST /api/v1/graha/f/{slug}` has always worked: it de-duplicates against
 * existing contacts, raises a lead, counts the submission and fires the
 * automation event. What there was no way to do was SUBMIT to it. `App.jsx`
 * declared public routes for /login, /accept-invite, /approve, /sign/:token
 * and /i/:token and none for a lead form, and the Web Forms tab offered no
 * link, no preview, no copyable embed and no hosted page — only this sentence:
 *
 *     "Embed code: POST your form data as JSON to /api/v1/graha/f/<slug> —
 *      fields: name, email, phone, company, message. No auth required."
 *
 * So a customer had to write and host the JavaScript themselves before a
 * single lead could arrive. Suite 04.14 named it: "a web form can be published
 * and nobody can fill it in", with 0 of 12 public submissions made.
 *
 * ── THE VISITOR ────────────────────────────────────────────────────────────
 * A stranger. They have no account, they are usually on a phone, and they
 * arrived from a link on the firm's own website. Everything here has to stand
 * up with nothing in localStorage and nothing in context. `/f/` is in
 * `PUBLIC_PATHS`, so a 404 does not end a session or redirect to /login.
 *
 * ── WHAT IT ASKS FOR, AND WHY THAT LIST ────────────────────────────────────
 * `submit_web_form` reads exactly five keys — name, email, phone, company,
 * message — and ignores the form's stored `fields` when writing. Rendering
 * anything else would draw a box whose contents the server discards, which is
 * the orphaned-capability fault pointing the other way. Only `name` is
 * required, because that is the only value the server needs to create a
 * contact at all.
 *
 * The three states are three states, not one string: an unknown slug, a
 * refused rate, and a dead network are different things to be told, and only
 * the first is the visitor's problem to stop about.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { KLogo, KWordmark } from '../lib/brand';
import { Card, CardBody } from '../components/ui/Card';
import { SkeletonText } from '../components/ui/Skeleton';
import '../styles/public.css';

const BACKEND = import.meta.env.VITE_BACKEND_URL;

const FIELDS = [
  { key: 'name', label: 'Your name', required: true, autoComplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { key: 'company', label: 'Company', autoComplete: 'organization' },
  { key: 'message', label: 'How can we help?', long: true },
];

const BLANK = { name: '', email: '', phone: '', company: '', message: '' };

export default function PublicLeadForm() {
  const { slug } = useParams();
  const [state, setState] = useState('loading');   // loading | ready | gone | offline
  const [form, setForm] = useState(null);
  const [values, setValues] = useState(BLANK);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let dead = false;
    // Plain `fetch`, like PayPage: this page must not carry the app's
    // interceptors, its auth header or its org header to a public endpoint.
    fetch(`${BACKEND}/api/v1/graha/f/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (dead) return;
        if (r.status === 404) { setState('gone'); return; }
        if (!r.ok) { setState('offline'); return; }
        setForm(await r.json());
        setState('ready');
      })
      .catch(() => { if (!dead) setState('offline'); });
    return () => { dead = true; };
  }, [slug]);

  async function submit(e) {
    e.preventDefault();
    if (!values.name.trim()) return;
    setSending(true);
    setFailure('');
    try {
      const r = await fetch(`${BACKEND}/api/v1/graha/f/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (r.ok) { setSent(true); return; }
      // ⚠ THREE FAILURES, THREE SENTENCES. Collapsing them into one string is
      // the defect ApprovePage's header records at length: a visitor told
      // their link is dead stops trying, and on a train that is a lie.
      if (r.status === 429) {
        setFailure('That was sent a moment ago. Give it a minute and try again.');
      } else if (r.status === 404) {
        setState('gone');
      } else {
        setFailure('We could not send that just now. Please try again in a moment.');
      }
    } catch {
      setFailure('That did not reach us — check your connection and try again.');
    } finally { setSending(false); }
  }

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="pub">
      <header className="pub__brand">
        <KLogo size={56} />
        <div>
          <KWordmark />
          {/* The FORM's name, which is the firm's own words, never the slug —
              a slug is an identifier and this page shows a person nothing they
              would have to decode. */}
          <p className="pub__kick">{form?.name || 'Get in touch'}</p>
        </div>
      </header>

      <div className="pub__body">
        {state === 'loading' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad pub__stack" aria-busy="true" aria-label="Opening this form">
                <SkeletonText width="45%" height={11} />
                <SkeletonText width="80%" height={22} />
                <SkeletonText width="100%" height={12} />
                <SkeletonText width="100%" height={12} />
              </div>
            </CardBody>
          </Card>
        )}

        {state === 'gone' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad">
                <h1 className="pub__title">This form is not accepting replies</h1>
                <p className="pub__lede">
                  The link may be out of date, or the form may have been retired.
                  If somebody sent you here, it is worth asking them for a current one.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {state === 'offline' && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad">
                <h1 className="pub__title">We could not open this form</h1>
                <p className="pub__lede">
                  That is our side, not yours, and the link is probably fine.
                  Reload the page in a moment.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {state === 'ready' && sent && (
          <Card className="pub__card">
            <CardBody>
              <div className="pub__pad">
                <h1 className="pub__title">Thank you — that has reached them</h1>
                <p className="pub__lede">
                  Somebody will be in touch. You can close this page.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {state === 'ready' && !sent && (
          <Card className="pub__card">
            <CardBody>
              <form className="pub__pad pub__stack" onSubmit={submit}>
                <h1 className="pub__title">{form?.name || 'Get in touch'}</h1>
                <p className="pub__lede">
                  Leave your details and somebody will come back to you.
                  Only your name is needed.
                </p>
                {FIELDS.map((f) => (
                  <label key={f.key} className="k-formpanel__label">
                    <span>{f.label}{f.required ? ' *' : ''}</span>
                    {f.long ? (
                      <textarea
                        className="k-formpanel__input" name={f.key} rows={3}
                        value={values[f.key]} onChange={set(f.key)}
                      />
                    ) : (
                      <input
                        className="k-formpanel__input" name={f.key}
                        type={f.type || 'text'} required={f.required}
                        autoComplete={f.autoComplete}
                        value={values[f.key]} onChange={set(f.key)}
                      />
                    )}
                  </label>
                ))}
                {failure && (
                  <p className="note note--warn" role="status">{failure}</p>
                )}
                <div className="k-formpanel__actions">
                  <button
                    type="submit" className="k-btn k-btn--primary"
                    disabled={sending || !values.name.trim()}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
