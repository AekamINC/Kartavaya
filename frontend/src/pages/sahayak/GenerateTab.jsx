// Sahayak → Generate. Pick a shape, describe the thing, get copy and an image.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { errText } from '../hub/_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useLanguage } from '../../components/CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../../components/Bilingual';
import RichText from './RichText';
import PlatformPreview from './PlatformPreview';
import ImagePanel from './ImagePanel';
import {
  QUICK_SKILLS, PLATFORMS, TONES, LANGUAGES, PLATFORM_HINTS, creditLabel, imageBriefOf,
} from './_shared';

const BLANK = { topic: '', platform: 'Instagram', tone: 'Professional', language: 'en', extra: '', with_image: true };

/** The Devanagari half of the picked skill's heading, decided by the layer. */
function PickedIn({ hi, lang }) {
  const { secondary, script } = secondaryOf(hi, lang);
  return secondary ? <Secondary className="hb-card__hi" value={secondary} script={script} /> : null;
}

export default function GenerateTab({ credits, costs, onSpent }) {
  // ONE LABEL SHAPE — neither `.sr-pick__hi` nor `.hb-card__hi` is in
  // `[data-language="en"]`'s six-name list. Read once: the skills are mapped.
  const lang = useLanguage();
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

  /**
   * What a run will actually charge.
   *
   * `costs[picked.agent]` is the price of the COPY. `/org/quick-generate` spends
   * that and then spends `costs.image` again whenever it makes a picture — two
   * receipts, and the reply's `credits_used` is their sum. Quoting only the
   * first is the defect that route's own comment records as fixed on the server
   * ("social_post reported 3, charged 2"); it re-entered here, on a screen whose
   * image checkbox defaults to ON, so the default state of the form quoted a
   * price it would not charge.
   *
   * `null` rather than the text price when the image price has not loaded: an
   * incomplete number printed as a complete one is the same lie in miniature,
   * and the caption already knows how to say nothing.
   */
  const textCost = picked && costs ? costs[picked.agent] ?? null : null;
  const imageCost = costs?.image ?? null;
  const runCost = withImage => {
    if (textCost == null) return null;
    if (!withImage) return textCost;
    return imageCost == null ? null : textCost + imageCost;
  };

  const cost = runCost(Boolean(picked?.hasImage && form.with_image));
  const hint = PLATFORM_HINTS[form.platform];

  /**
   * One run of the brief.
   *
   * `imagePrompt` is the reader's own description of the picture they wanted,
   * arriving from the result pane's image panel. It is passed straight through
   * as `image_prompt`: there is no image-only route on the server, so asking
   * for a different picture necessarily re-runs the whole brief and rewrites
   * the copy with it — which is why the panel says so before the click rather
   * than surprising somebody who liked the words they already had.
   *
   * A server that does not read `image_prompt` DROPS it — `QuickGenerate`
   * declares its own fields and Pydantic discards the rest — which is free on
   * the wire and expensive on the screen: the panel was charging for a run
   * whose typed description went nowhere. So the box that collects it is not
   * offered on a run the route did not prove it can direct; `canDirect` below
   * is that proof, and the day the route accepts the field nothing here has to
   * change.
   */
  async function run(imagePrompt) {
    if (!picked) return;
    const again = imagePrompt !== undefined;
    setBusy(true);
    // Only a fresh brief clears the pane. Blanking a result the reader is still
    // looking at, to replace it with a spinner, loses the version they were
    // comparing against — and the old one is what tells them whether the new
    // image is any better.
    if (!again) setResult(null);
    setError('');
    try {
      const payload = {
        skill: picked.id, ...form, with_image: picked.hasImage && form.with_image,
      };
      if (again) {
        payload.with_image = true;
        if (imagePrompt) payload.image_prompt = imagePrompt;
      }
      const r = await api.post('/v1/hub/org/quick-generate', payload);
      setResult(r.data);
      onSpent?.();
      pushToast({ title: `Generated — ${creditLabel(r.data.credits_used)}`, type: 'success' });
    } catch (err) {
      setError(errText(err, 'Generation failed.'));
    } finally { setBusy(false); }
  }

  function submit(e) {
    e.preventDefault();
    run();
  }

  return (
    <div className="sr-gen">
      <fieldset className="hb-fs">
        <legend className="hb-field__l">What do you need?</legend>
        <div className="sr-picks">
          {QUICK_SKILLS.map(s => {
            const on = picked?.id === s.id;
            const c = costs?.[s.agent];
            const pickIn = secondaryOf(s.hi, lang);
            return (
              <button type="button" key={s.id} className={`sr-pick${on ? ' on' : ''}`}
                aria-pressed={on} onClick={() => { setPicked(s); setResult(null); setError(''); }}>
                <span className="sr-pick__t">
                  {s.label}
                  {pickIn.secondary && <Secondary className="sr-pick__hi" value={pickIn.secondary} script={pickIn.script} />}
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
            <PickedIn hi={picked.hi} lang={lang} />
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

      {result && (
        <Result result={result} platform={form.platform} regenCost={runCost(true)} busy={busy}
          onRegenerate={canWrite ? run : null} />
      )}
    </div>
  );
}

/**
 * One run's output: the picture, the copy, and the copy as each platform prints it.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 *
 * Three copy buttons in the header — "Copy", "Copy for WhatsApp", "Markdown" —
 * over a body rendered with the chat transcript's markdown component, and an
 * image at `max-height: 380px` under a row of link buttons.
 *
 * The three buttons were the right idea aimed at the wrong list. WhatsApp is
 * one of eight destinations and the only one that had its own control; the
 * plain "Copy" was silently correct for Instagram, Facebook, X and Google Ads
 * and silently WRONG for LinkedIn, which renders no markup at all and needs
 * substituted Unicode characters to carry bold. Which shape a destination takes
 * is a fact about the destination, so the control is per-destination now and
 * lives in `./PlatformPreview` beside the preview it copies.
 *
 * The header keeps exactly one button: the markdown source, for a CMS or a
 * ticket, which is the one shape no platform preview can offer.
 */
function Result({ result, platform, regenCost, busy, onRegenerate }) {
  const { pushToast } = useToast();
  const images = result.images || [];
  // The brief this run built, from wherever the reply carries it. The route
  // stores it on the content row's `metadata` jsonb and, when it reports it
  // back, at the top level; `imageBriefOf` reads both so neither surface has to
  // know which. A run that reports nothing gets the panel's "did not report"
  // line — and, per `canDirect`, no box asking for a description it would then
  // discard.
  const brief = imageBriefOf(result);

  return (
    <section className="hb-card hb-card--lit sr-res">
      <div className="hb-card__head sr-res__head">
        <h3 className="hb-card__t hb-card__t--flush">Generated content</h3>
        <span className="sr-res__tools">
          <span className="hb-cap hb-mono">{result.model || 'model not reported'}</span>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            aria-label="Copy the markdown source"
            onClick={() => {
              navigator.clipboard?.writeText(result.text || '');
              pushToast({ title: 'Copied as Markdown', message: 'The source, for a CMS or a ticket.', type: 'success' });
            }}>
            Markdown source
          </button>
        </span>
      </div>

      {/* The image sits BESIDE the copy it belongs to, not stacked above it
          behind its own scroll. They are one deliverable and they are judged
          together — a caption that promises a festive counter and a picture of
          an empty office is a mismatch nobody spots when the two are a screen
          apart. The column collapses under 900px. */}
      <div className={`sr-res__split${images.length > 0 ? ' sr-res__split--img' : ''}`}>
        {images.length > 0 && (
          <div className="sr-res__imgs">
            {images.map((img, i) => (
              <ImagePanel key={img.url || i} image={img}
                prompt={img.prompt || brief}
                alt={`The generated visual for this ${platform} post`}
                onRegenerate={onRegenerate}
                // A route that will not tell you what it asked the model for is
                // not one to trust with what you ask it for. The brief coming
                // back is the only evidence this screen has that the request
                // model has an image brief in it at all, and until that is true
                // a description box would just be spending credits on a field
                // Pydantic drops.
                canDirect={Boolean(img.prompt || brief)}
                busy={busy} cost={regenCost} />
            ))}
          </div>
        )}
        <div className="sr-res__body">
          <RichText text={result.text} />
        </div>
      </div>

      <div className="sr-res__pv">
        <PlatformPreview markdown={result.text} platform={platform}
          served={result.formatted} tags={result.hashtags} />
      </div>

      <div className="sr-res__foot">
        <span className="hb-cap hb-mono">{creditLabel(result.credits_used)} used</span>
        <span className="hb-cap">Saved to the Content tab.</span>
      </div>
    </section>
  );
}
