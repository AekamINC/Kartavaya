// The post as the destination will print it, and the copy button that hands
// over exactly that.
//
// ── Why a preview that shows markdown is worse than none ────────────────────
//
// The result pane rendered the model's markdown with headings and bold on the
// screen where somebody decides whether a post is ready. Four of the eight
// destinations render none of it: an Instagram caption prints `**Diwali**` with
// both pairs of asterisks, and so do Facebook, X and the Google Ads editor.
// LinkedIn strips markdown and has no formatting of its own. WhatsApp has
// markup and it is not markdown — its bold is one asterisk.
//
// So the screen showed bold, the platform showed asterisks, and the reader
// found out after publishing. Everything about what survives where is in
// `./platformText`; this is the surface for it.
//
// ── The copy button is the product ──────────────────────────────────────────
//
// This content is not published from here — there is a Publish tab, and most
// firms paste into the app on their phone anyway. The control people use twenty
// times a day is Copy, and it has to put the SHAPED text on the clipboard, not
// the source. One generic Copy could only ever be right for one destination.
//
// ── …and the Publish tab does not send this ─────────────────────────────────
//
// Which makes the heading above a claim this screen cannot yet honour, and it
// says so. No route in the product emits a `formatted` key — `served` is
// undefined at both call sites — so every variant here is computed in the
// browser, while `social_publisher.publish_content` posts `item["body"]` raw
// with the stored hashtags appended. The two differ in emphasis (the platform
// gets the asterisks) and in tags (the sender adds a block, hash-doubled). The
// Content tab renders this component directly above Approve/Reject, so the gap
// is not a curiosity: it is the difference between what a reviewer approved and
// what the customer's audience read. Both halves are on screen now — the tag
// block in the stage, the sender's behaviour in the provenance line — because
// the only thing worse than a preview that is wrong is one that is wrong
// quietly.
import React, { useMemo, useRef, useState } from 'react';
import { useToast } from '../../components/ui/toast';
import RichText from './RichText';
import { copyRich } from './_shared';
import { variantsFor, platformKey, countText, PLATFORMS } from './platformText';

const count = n => n.toLocaleString('en-IN');

export default function PlatformPreview({ markdown, platform, served, tags }) {
  const { pushToast } = useToast();
  const richRef = useRef(null);
  // The platform the copy was WRITTEN for opens first. Anything else makes the
  // reader re-find their own choice before they can check it.
  const [sel, setSel] = useState(() => platformKey(platform) || PLATFORMS[0]);

  const variants = useMemo(() => variantsFor(markdown, served, tags), [markdown, served, tags]);
  const current = variants.find(v => v.platform === sel) || variants[0];

  // A row whose body never landed is a row with nothing to preview. Eight chips
  // over an empty stage reads as the preview being broken.
  if (!current || !String(markdown ?? '').trim()) return null;

  const rich = current.shape === 'rich';
  // Not `.text.length`. That is UTF-16 code units, and every substituted bold
  // character LinkedIn forces is a surrogate pair — a 2,900-character post with
  // 150 bolded characters counted 3,050 and went red over a cap nothing would
  // have enforced. `countText` counts code points, and X's own weighting where
  // the destination is X.
  const length = countText(current.text, current.measure);
  const over = current.charLimit != null && length > current.charLimit;

  async function copy() {
    const html = rich ? richRef.current?.innerHTML || '' : null;
    const shape = await copyRich(html, current.text);
    if (shape === 'failed') {
      pushToast({
        title: 'Could not reach the clipboard',
        message: 'Select the text and copy it by hand.',
        type: 'error',
      });
      return;
    }
    // Named for what LANDED. Promising formatting after falling back to plain
    // sends somebody to paste into an email expecting bold.
    pushToast({
      title: `Copied for ${current.platform}`,
      message: shape === 'rich'
        ? 'Headings, bold and links come across into the email body.'
        : current.note,
      type: 'success',
    });
  }

  return (
    <section className="sr-pv">
      <div className="sr-pv__head">
        <h4 className="hb-cap sr-pv__t">As each platform will print it</h4>
        <div className="hb-filters sr-pv__chips" role="group"
          aria-label="Choose which platform to preview">
          {variants.map(v => (
            <button type="button" key={v.platform}
              className={`hb-chip${v.platform === sel ? ' on' : ''}`}
              aria-pressed={v.platform === sel}
              onClick={() => setSel(v.platform)}>
              {v.platform}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-pv__note">
        {current.note}
        {/* The tags are part of the post that goes out, so they are part of the
            post being judged and part of what counts against the cap. They read
            as duplicated because they ARE: the stored list was extracted from
            the body with `re.findall(r'#\w+', text)`, hash included, and the
            sender adds another one on the way out. See `tagBlock`. */}
        {current.source !== 'server' && !rich && tags?.length > 0 && (
          <> Publishing appends the tags below to the post, exactly as shown.</>
        )}
      </p>

      {/* A region rather than a live region: switching platform replaces a
          whole post, and announcing all of it on every chip press buries the
          chip's own name. The label changes with the selection, so a screen
          reader entering the region is told which platform it is looking at. */}
      <div className="sr-pv__stage" role="region"
        aria-label={`The post as ${current.platform} will print it`}>
        {rich
          ? <div ref={richRef}><RichText text={markdown} /></div>
          : <div className="sr-pv__text">{current.text}</div>}
      </div>

      <div className="sr-pv__foot">
        {/* What the SENDER will do, not how confident this shaping is. The line
            here used to call a local shape "Kartavya's reading of the platform's
            rules", which frames the gap as interpretation — two readings of one
            rule, differing at the edges. It is not that. No route serves a
            `formatted` key today, so `services/social_publisher.publish_content`
            posts `item["body"]` — the raw Markdown, asterisks and hashes intact —
            with the stored tags appended. This preview sits directly above an
            Approve button, and an approver is entitled to know that the text
            they are approving is not the text that goes out. */}
        <span className="hb-cap sr-pv__src">
          {current.source === 'server'
            ? 'Formatted by the server — this is the text that will be sent.'
            : (
              <>
                <b>Publishing does not send this yet.</b>{' '}
                Shaped here in your browser: no route formats a post server-side,
                so the publish queue posts the Markdown source unchanged — every{' '}
                <code className="hb-code">**</code> and <code className="hb-code">##</code>
                {' '}printed literally — with the tags appended after it. Copy from
                here and paste, and the platform gets what you see.
              </>
            )}
        </span>
        <span className="sr-pv__acts">
          <span className={`hb-cap hb-mono sr-pv__n${over ? ' sr-pv__n--over' : ''}`}>
            {current.charLimit != null
              ? `${count(length)} / ${count(current.charLimit)} characters`
              : `${count(length)} characters`}
            {over && ` · ${count(length - current.charLimit)} over`}
          </span>
          <button type="button" className="k-btn k-btn--primary hb-btn--sm"
            onClick={copy} aria-label={`Copy this post formatted for ${current.platform}`}>
            Copy for {current.platform}
          </button>
        </span>
      </div>
    </section>
  );
}
