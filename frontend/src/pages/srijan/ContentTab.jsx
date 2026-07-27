// Srijan → Content. Everything the org has generated, with its images.
import React, { useState } from 'react';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Resource, StatusPill, useList } from '../hub/_shared';
import { AGENT_LABELS, shortStamp, words } from './_shared';

export default function ContentTab() {
  const [filter, setFilter] = useState('');
  const list = useList(
    `/v1/hub/org/content${filter ? `?agent_type=${encodeURIComponent(filter)}` : ''}`,
    [filter],
  );

  return (
    <div>
      <div className="hb-filters" role="group" aria-label="Filter by agent type">
        <button type="button" className={`hb-chip${filter === '' ? ' on' : ''}`}
          aria-pressed={filter === ''} onClick={() => setFilter('')}>All</button>
        {Object.entries(AGENT_LABELS).map(([k, l]) => (
          <button type="button" key={k} className={`hb-chip${filter === k ? ' on' : ''}`}
            aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <Resource
        state={list}
        what="Your content library"
        empty={filter ? (
          /* Filtered to nothing is not an empty library. The way out is the
             filter, not the Generate tab. */
          <p className="hb-none">
            Nothing generated with that agent yet.{' '}
            <button type="button" className="hb-linkbtn" onClick={() => setFilter('')}>Show everything</button>
          </p>
        ) : (
          <Empty
            icon="generic"
            title="Nothing generated yet"
            sub="Anything made on the Generate tab, or by a skill pack, is kept here."
          />
        )}
      >
        <div className="hb-cards">
          {list.items?.map(item => <ContentCard key={item.id} item={item} />)}
        </div>
      </Resource>
    </div>
  );
}

function ContentCard({ item }) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [imgBad, setImgBad] = useState(false);
  const [nonce, setNonce] = useState(0);

  const long = (item.body || '').length > 220;

  async function download(e) {
    e.stopPropagation();
    try {
      const res = await fetch(item.image_url);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(item.title || 'image').replace(/[^a-zA-Z0-9]+/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Generated images are served from signed URLs that expire. Saying which
      // is the difference between "try again" and "regenerate it".
      pushToast({ title: 'Download failed — the image link has probably expired.', type: 'error' });
    }
  }

  function copyUrl(e) {
    e.stopPropagation();
    navigator.clipboard?.writeText(item.image_url);
    pushToast({ title: 'Image link copied', type: 'success' });
  }

  return (
    <>
      <article className="hb-card sr-cc">
        {item.image_url && !imgBad && (
          <button type="button" className="sr-cc__shot" onClick={() => setLightbox(true)}
            aria-label={`View ${item.title || 'the generated image'} full size`}>
            <img className="sr-cc__img" src={`${item.image_url}${nonce ? `#${nonce}` : ''}`}
              alt={item.title || 'Generated visual'} onError={() => setImgBad(true)} loading="lazy" />
          </button>
        )}
        {item.image_url && imgBad && (
          <div className="sr-cc__gone">
            <span className="hb-cap">This image link has expired.</span>
            <button type="button" className="hb-linkbtn"
              onClick={() => { setImgBad(false); setNonce(n => n + 1); }}>Try loading it again</button>
          </div>
        )}

        <div className="sr-cc__b">
          <div className="sr-cc__head">
            <span>
              <b className="sr-cc__t">{item.title || 'Untitled'}</b>
              <span className="hb-cap">
                <span className="hb-tag">{AGENT_LABELS[item.agent_type] || words(item.agent_type)}</span>
                {item.platform && <span className="hb-tag">{item.platform}</span>}
              </span>
            </span>
            <StatusPill status={item.status} />
          </div>

          <p className={`sr-cc__x${open ? ' is-open' : ''}`}>{item.body}</p>
          {long && (
            <button type="button" className="hb-linkbtn" onClick={() => setOpen(o => !o)}>
              {open ? 'Show less' : 'Show more'}
            </button>
          )}

          {item.hashtags?.length > 0 && (
            <div className="hb-tags">
              {item.hashtags.slice(0, 8).map((t, i) => <span className="hb-tag" key={i}>{t}</span>)}
            </div>
          )}

          <div className="sr-cc__foot">
            <span className="hb-cap hb-mono">{shortStamp(item.created_at)}</span>
            <span className="hb-cap hb-mono">
              {item.credits_used != null ? `${item.credits_used} credits` : ''}
            </span>
          </div>
        </div>
      </article>

      {lightbox && item.image_url && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div className="sr-lb" role="dialog" aria-modal="true" aria-label={item.title || 'Generated image'}
          onClick={() => setLightbox(false)}
          onKeyDown={e => { if (e.key === 'Escape') setLightbox(false); }}>
          <div className="sr-lb__in" onClick={e => e.stopPropagation()}>
            <img className="sr-lb__img" src={item.image_url} alt={item.title || 'Generated visual, full size'} />
            <div className="sr-lb__act">
              <button type="button" className="k-btn k-btn--primary" onClick={download}>Download</button>
              <button type="button" className="k-btn k-btn--ghost" onClick={copyUrl}>Copy link</button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setLightbox(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
