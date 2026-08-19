// The generated image, big enough to judge and possible to diagnose.
//
// ── What was wrong with looking at it ───────────────────────────────────────
//
// The result pane showed the image at `max-height: 380px, object-fit: contain`
// with three copy controls under it, and the Content tab showed it at 46vh
// inside a dialog. Neither could be enlarged. An image is the one output of
// this product that is judged by eye — "less AI slop" is a verdict somebody
// reaches by LOOKING — and 380px of a 1024px render is not enough pixels to
// see the mangled text, the sixth finger or the mushy logo that make it slop.
//
// ── Why the brief is on screen ──────────────────────────────────────────────
//
// The prompt the model was actually given is not the prompt anybody typed. It
// is assembled server-side, and until this week it was assembled BADLY: the
// whole brief was truncated to 200 characters and pasted behind a fixed
// "Create a professional image for: " — so subject, composition, lighting and
// palette never reached the model at all, and no screen in the product would
// have shown you that. An image nobody can diagnose is an image nobody can
// improve, so when the run reports its brief, it is shown; when it does not,
// this says so rather than implying the field was empty.
import React, { useState } from 'react';
import { useToast } from '../../components/ui/toast';
import { copyImage, creditLabel } from './_shared';

/**
 * The file extension for a set of bytes, which is not always `png`.
 *
 * Mirrors `ai_router._EXT_BY_MIME`, which exists because Recraft V4 answers
 * `image/webp` and Gemini answers `image/jpeg` — and Recraft leads the ladder
 * for both typographic presets, so a festival greeting is the COMMON case, not
 * the edge one. The router keys the R2 object's name and content type off the
 * real type for exactly this reason; a hardcoded `.png` on the way out
 * re-creates the same mismatch one layer later, in a file the customer keeps.
 */
const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
};

export default function ImagePanel({ image, prompt, alt, onRegenerate, canDirect, busy, cost }) {
  const { pushToast } = useToast();
  const [big, setBig] = useState(false);
  const [gone, setGone] = useState(false);
  // Bumping a fragment re-requests the same URL. A signed R2 link that has
  // expired and one that failed on a flaky connection look identical from here,
  // so the way out is to try again rather than to declare it dead.
  const [nonce, setNonce] = useState(0);
  const [brief, setBrief] = useState(prompt || '');

  if (!image?.url) return null;

  async function download() {
    try {
      const res = await fetch(image.url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      // The BLOB's type first and the run's reported one second. R2 serves the
      // content type the router stored, which came from the bytes; the `mime`
      // travelling in the response is whatever the route said, and
      // `quick_generate` says `image/png` unconditionally regardless of which
      // rung of the ladder answered. Between a claim and the thing itself, take
      // the thing itself.
      const ext = EXT_BY_MIME[String(blob.type || image.mime || '').toLowerCase()] || 'png';
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = `sahayak-${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(obj);
    } catch {
      pushToast({ title: 'Download failed — the image link has probably expired.', type: 'error' });
    }
  }

  return (
    <figure className="sr-ip">
      {gone ? (
        <div className="sr-cc__gone">
          <span className="hb-cap">This image link has expired.</span>
          <button type="button" className="hb-linkbtn"
            onClick={() => { setGone(false); setNonce(n => n + 1); }}>
            Try loading it again
          </button>
        </div>
      ) : (
        /* A toggle, not a link to a lightbox. The Content tab opens this inside
           a modal, and a second fixed overlay would land under that dialog's
           panel — the sizes are a class change instead, which works the same in
           both places and needs no z-index to be right. */
        <button type="button" className="sr-ip__shot" aria-pressed={big}
          onClick={() => setBig(v => !v)}
          aria-label={big ? 'Shrink the generated image to fit' : 'Enlarge the generated image'}>
          <img className={`sr-ip__img${big ? ' sr-ip__img--big' : ''}`}
            src={`${image.url}${nonce ? `#${nonce}` : ''}`}
            alt={alt || 'The generated visual for this post'}
            onError={() => setGone(true)} />
        </button>
      )}

      <figcaption className="sr-ip__cap">
        <div className="sr-ip__acts">
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            onClick={() => setBig(v => !v)}>
            {big ? 'Fit to width' : 'View larger'}
          </button>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={download}>
            Download
          </button>
          {/* The image itself, not a reference to it — a signed R2 link pasted
              into a document is a dead reference by the next day. */}
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            onClick={async () => {
              const ok = await copyImage(image.url);
              pushToast(ok
                ? { title: 'Image copied', message: 'Paste it straight into the post.', type: 'success' }
                : { title: 'Could not copy the image', message: 'Download it instead — the link may have expired.', type: 'error' });
            }}>
            Copy image
          </button>
        </div>

        {/* A disclosure, not an open panel, and deliberately so on both counts:
            the brief is long enough to push the picture off screen, and the
            control inside it spends credits — one considered click away is the
            right distance for that, as long as the label names the action
            rather than hiding it behind a shrug. */}
        <details className="sr-ip__why">
          <summary className="sr-ip__sum">
            {onRegenerate && canDirect
              ? 'What the image model was asked — and ask it for something else'
              : 'What the image model was asked'}
          </summary>
          {prompt ? (
            <p className="sr-ip__prompt hb-mono">{prompt}</p>
          ) : (
            <p className="sr-ip__prompt">
              This run did not report the brief it built. Without it there is no way
              to tell a weak result from a weak instruction.
            </p>
          )}

          {/* ── Why the description box is not always here ──────────────────
              A textarea headed "Describe the image you want instead", over a
              button that spends credits, is a promise. `POST /org/quick-generate`
              could not keep it: `QuickGenerate` declares skill/topic/platform/
              tone/language/with_image/extra and Pydantic drops everything else,
              so the typed description was discarded in transit and the route
              rebuilt the brief from the topic — the customer paid for a text
              generation, a brief expansion and an image, and got a re-roll of
              the brief they already had. Images are 79% of this product's AI
              spend and "the picture is wrong" is the retry people repeat, so
              that is the expensive click to get wrong.
              `canDirect` is the caller's statement that the route will read a
              description. Without it the control is still offered — a re-roll
              genuinely produces a different picture — but it is named for what
              it does. */}
          {onRegenerate && (
            <div className="sr-ip__re">
              {canDirect && (
                <label className="hb-field">
                  <span className="hb-field__l">Describe the image you want instead</span>
                  <textarea className="k-input hb-ta" rows={3} value={brief}
                    placeholder="e.g. a Gujarati sweet shop counter at dusk, warm lamplight, shallow depth of field, no text in the frame"
                    onChange={e => setBrief(e.target.value)} />
                </label>
              )}
              <div className="sr-ip__refoot">
                <span className="hb-cap">
                  {/* Said before the click, not after it. There is no
                      image-only route on the server, so this re-runs the whole
                      brief and the copy is rewritten with it — and the price is
                      BOTH halves. Quoting the text price alone on a control
                      that forces `with_image` is the defect this route's own
                      history records: "social_post reported 3, charged 2". */}
                  {canDirect
                    ? 'Runs the brief again and rewrites the copy too'
                    : 'A fresh attempt at the same brief — this run cannot be redirected, and it rewrites the copy too'}
                  {cost != null && ` · spends ${creditLabel(cost)}`}
                </span>
                <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                  disabled={busy} onClick={() => onRegenerate(canDirect ? brief.trim() : '')}>
                  {busy ? 'Generating…' : (canDirect ? 'Generate a new image' : 'Generate another image')}
                </button>
              </div>
            </div>
          )}
        </details>
      </figcaption>
    </figure>
  );
}
