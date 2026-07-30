// Srijan → Generate. Pick a shape, describe the thing, get copy and an image.
import React, { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { errText } from '../hub/_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import {
  QUICK_SKILLS, PLATFORMS, TONES, LANGUAGES, PLATFORM_HINTS, Markdown, creditLabel,
  copyRich, copyImage, toPlain, toWhatsApp,
} from './_shared';

const BLANK = { topic: '', platform: 'Instagram', tone: 'Professional', language: 'en', extra: '', with_image: true };

export default function GenerateTab({ credits, costs, onSpent }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'generate content' });
  const { pushToast } = useToast();
  const [picked, setPicked] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // `?? null` rather than `?? 0`: a balance that has not loaded is unknown, not
  // zero, and telling someone they are out of credits when the request simply
  // has not answered stops them doing work they are entitled to do.
  const balance = credits?.user_allocation
    ? credits.user_allocation.allocated - credits.user_allocation.used
    : credits?.org_balance?.balance ?? null;

  const cost = picked && costs ? costs[picked.agent] ?? null : null;
  const hint = PLATFORM_HINTS[form.platform];

  async function submit(e) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const r = await api.post('/v1/hub/org/quick-generate', {
        skill: picked.id, ...form, with_image: picked.hasImage && form.with_image,
      });
      setResult(r.data);
      onSpent?.();
      pushToast({ title: `Generated — ${creditLabel(r.data.credits_used)}`, type: 'success' });
    } catch (err) {
      setError(errText(err, 'Generation failed.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="sr-gen">
      <fieldset className="hb-fs">
        <legend className="hb-field__l">What do you need?</legend>
        <div className="sr-picks">
          {QUICK_SKILLS.map(s => {
            const on = picked?.id === s.id;
            const c = costs?.[s.agent];
            return (
              <button type="button" key={s.id} className={`sr-pick${on ? ' on' : ''}`}
                aria-pressed={on} onClick={() => { setPicked(s); setResult(null); setError(''); }}>
                <span className="sr-pick__t">
                  {s.label}
                  <span className="sr-pick__hi" lang="hi">{s.hi}</span>
                </span>
                <span className="sr-pick__d">{s.desc}</span>
                <span className="sr-pick__c hb-mono">
                  {c != null ? creditLabel(c) : 'cost unavailable'}
                  {s.hasImage && ' · image optional'}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {picked && (
        <form className="hb-card hb-form" onSubmit={submit}>
          <h3 className="hb-card__t">
            {picked.label}
            <span className="hb-card__hi" lang="hi">{picked.hi}</span>
          </h3>

          <label className="hb-field">
            <span className="hb-field__l">What is this about? <span className="hb-req" aria-hidden="true">*</span></span>
            <textarea className="k-input hb-ta" rows={3} required value={form.topic}
              placeholder="e.g. Diwali sale — highlight the festive collection"
              onChange={e => set('topic', e.target.value)} />
          </label>

          <div className="hb-grid hb-grid--3">
            <label className="hb-field">
              <span className="hb-field__l">Platform</span>
              <select className="k-input" value={form.platform} onChange={e => set('platform', e.target.value)}>
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="hb-field">
              <span className="hb-field__l">Tone</span>
              <select className="k-input" value={form.tone} onChange={e => set('tone', e.target.value)}>
                {TONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="hb-field">
              <span className="hb-field__l">Language</span>
              <select className="k-input" value={form.language} onChange={e => set('language', e.target.value)}>
                {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {hint && (
            <p className="note note--info hb-note">
              {hint.hint}
              {hint.charLimit && <> The hard limit is {hint.charLimit.toLocaleString('en-IN')} characters.</>}
            </p>
          )}

          {form.platform === 'Twitter / X' && (
            <label className="hb-field">
              <span className="hb-field__l">Thread length</span>
              <select className="k-input" value={form.thread_count || '1'} onChange={e => set('thread_count', e.target.value)}>
                <option value="1">A single tweet</option>
                <option value="3">A three-tweet thread</option>
                <option value="5">A five-tweet thread</option>
              </select>
            </label>
          )}

          {form.platform === 'Email' && (
            <label className="hb-field">
              <span className="hb-field__l">Subject line</span>
              <input className="k-input" placeholder="Leave blank and one will be written for you"
                value={form.email_subject || ''} onChange={e => set('email_subject', e.target.value)} />
            </label>
          )}

          {form.platform === 'Google Ads' && (
            <div className="hb-grid hb-grid--2">
              <label className="hb-field">
                <span className="hb-field__l">Ad type</span>
                <select className="k-input" value={form.ad_type || 'search'} onChange={e => set('ad_type', e.target.value)}>
                  <option value="search">Search</option>
                  <option value="display">Display</option>
                  <option value="pmax">Performance Max</option>
                </select>
              </label>
              <label className="hb-field">
                <span className="hb-field__l">Target URL</span>
                <input className="k-input" type="url" placeholder="https://…"
                  value={form.target_url || ''} onChange={e => set('target_url', e.target.value)} />
              </label>
            </div>
          )}

          {form.platform === 'LinkedIn' && (
            <label className="hb-field">
              <span className="hb-field__l">Post type</span>
              <select className="k-input" value={form.post_type || 'text'} onChange={e => set('post_type', e.target.value)}>
                <option value="text">Text post</option>
                <option value="article">Article</option>
                <option value="carousel">Carousel document</option>
                <option value="poll">Poll</option>
              </select>
            </label>
          )}

          <label className="hb-field">
            <span className="hb-field__l">Extra instructions</span>
            <input className="k-input" placeholder="e.g. mention the website, keep it under 60 words"
              value={form.extra} onChange={e => set('extra', e.target.value)} />
          </label>

          {picked.hasImage && (
            <label className="sk-check">
              <input type="checkbox" checked={form.with_image} onChange={e => set('with_image', e.target.checked)} />
              <span>Generate a matching image</span>
            </label>
          )}

          <div className="hb-form__foot">
            <span className="hb-cap">
              {balance == null ? 'Credit balance unavailable' : <>Balance <b className="hb-num">{balance}</b></>}
              {cost != null && <> · this run spends <b className="hb-num">{cost}</b></>}
            </span>
            <button type="submit" className="k-btn k-btn--primary" disabled={busy || !form.topic.trim() || !canWrite} title={denial || undefined}>
              {busy ? 'Generating…' : `Generate ${picked.label.toLowerCase()}`}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="note note--warn hb-err" role="status"><b>Generation failed.</b> {error}</div>
      )}

      {result && <Result result={result} />}
    </div>
  );
}

function Result({ result }) {
  const { pushToast } = useToast();
  // The RENDERED node, not the source. What the reader is looking at is what
  // they mean to paste, and lifting its innerHTML is the only way to hand over
  // exactly that.
  const bodyRef = useRef(null);

  async function copyFormatted() {
    const html = bodyRef.current?.innerHTML || '';
    const shape = await copyRich(html, toPlain(result.text));
    if (shape === 'failed') {
      pushToast({ title: 'Could not reach the clipboard', message: 'Select the text and copy it by hand.', type: 'error' });
      return;
    }
    // Named for what landed. Saying "with formatting" after falling back to
    // plain would send someone to paste into a document expecting bold.
    pushToast({
      title: shape === 'rich' ? 'Copied with formatting' : 'Copied as plain text',
      message: shape === 'rich' ? 'Paste into email, Docs or LinkedIn.' : 'This browser would not take the formatted copy.',
      type: 'success',
    });
  }

  async function copyForWhatsApp() {
    const shape = await copyRich(null, toWhatsApp(result.text));
    if (shape === 'failed') { pushToast({ title: 'Could not reach the clipboard', type: 'error' }); return; }
    pushToast({ title: 'Copied for WhatsApp', message: 'Bold and bullets in WhatsApp’s own markup.', type: 'success' });
  }

  async function download(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const obj = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = obj;
      a.download = `srijan-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(obj);
    } catch {
      pushToast({ title: 'Download failed — the image link has probably expired.', type: 'error' });
    }
  }

  return (
    <section className="hb-card hb-card--lit sr-res">
      <div className="hb-card__head sr-res__head">
        <h3 className="hb-card__t hb-card__t--flush">Generated content</h3>
        <span className="sr-res__tools">
          <span className="hb-cap hb-mono">{result.model || 'model not reported'}</span>
          {/* This was one button copying `result.text` — the RAW MARKDOWN.
              Pasted into any of the places this content is written for
              (WhatsApp, Instagram, LinkedIn, Gmail) that is literal
              `**asterisks**`, `###` and `- `, which the reader then strips by
              hand on every run. The post is the deliverable; handing it over in
              source form left the last step manual.

              Three destinations, three shapes — and WhatsApp gets its own,
              because its bold is `*one asterisk*` and markdown's is two. */}
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={copyFormatted}>
            Copy
          </button>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={copyForWhatsApp}>
            Copy for WhatsApp
          </button>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            onClick={() => { navigator.clipboard?.writeText(result.text || ''); pushToast({ title: 'Copied as Markdown', type: 'success' }); }}>
            Markdown
          </button>
        </span>
      </div>

      {result.images?.length > 0 && (
        <div className="sr-res__imgs">
          {result.images.map((img, i) => (
            <figure className="sr-res__fig" key={i}>
              <img className="sr-res__img" src={img.url} alt="Generated visual" />
              <figcaption className="sr-res__cap">
                <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => download(img.url)}>Download</button>
                {/* The image itself, not a reference to it. "Copy link" was the
                    only option and the link is a SIGNED R2 url — pasted into a
                    document it is a dead reference by the next day. */}
                <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                  onClick={async () => {
                    const ok = await copyImage(img.url);
                    pushToast(ok
                      ? { title: 'Image copied', message: 'Paste it straight into the post.', type: 'success' }
                      : { title: 'Could not copy the image', message: 'Download it instead — the link may have expired.', type: 'error' });
                  }}>
                  Copy image
                </button>
                <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                  onClick={() => { navigator.clipboard?.writeText(img.url); pushToast({ title: 'Link copied', message: 'The link is signed and expires.', type: 'success' }); }}>
                  Copy link
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="sr-res__body" ref={bodyRef}><Markdown text={result.text} /></div>

      <div className="sr-res__foot">
        <span className="hb-cap hb-mono">{creditLabel(result.credits_used)} used</span>
        <span className="hb-cap">Saved to the Content tab.</span>
      </div>
    </section>
  );
}
