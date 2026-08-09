/**
 * TerritoryMap — a Mappls (MapMyIndia) preview of the pincodes a territory covers.
 *
 * MapMyIndia rather than Google: the owner's decision of 2026-08-09. It bills in
 * INR and its pincode and district data for India is the better of the two,
 * which is the whole reason a territory has a map at all.
 *
 * ── IT NEEDS A KEY, AND IT SAYS SO ──────────────────────────────────────────
 *
 * `VITE_MAPPLS_KEY` is not set in any environment yet. Rather than render an
 * empty grey box — which reads as "the map is broken" — this states what is
 * missing. A component that fails silently on a missing credential is how a
 * feature ships looking finished and is discovered to be dead months later.
 *
 * The SDK is loaded on demand, once, and only when a key exists: it is a
 * third-party script and no page should pay for it until something asks for a
 * map.
 */
import React, { useEffect, useRef, useState } from 'react';

const KEY = import.meta.env.VITE_MAPPLS_KEY;
const SDK = 'https://apis.mappls.com/advancedmaps/api';

let sdkPromise = null;

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.mappls) { resolve(window.mappls); return; }
    const s = document.createElement('script');
    s.src = `${SDK}/${KEY}/map_sdk?layer=vector&v=3.0`;
    s.async = true;
    s.onload = () => resolve(window.mappls);
    s.onerror = () => reject(new Error('Mappls SDK failed to load'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export default function TerritoryMap({ pincodes = [], height = 220 }) {
  const holder = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!KEY || !holder.current) return undefined;
    let map = null;
    let cancelled = false;
    loadSdk()
      .then((mappls) => {
        if (cancelled || !holder.current) return;
        map = new mappls.Map(holder.current, {
          center: [22.9734, 78.6569],  // the centroid of India, for an empty territory
          zoom: pincodes.length ? 6 : 4,
        });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (map && typeof map.remove === 'function') map.remove();
    };
  }, [pincodes.length]);

  if (!KEY) {
    return (
      <div className="note note--warn" role="status">
        The territory map needs a MapMyIndia key. Set <code>VITE_MAPPLS_KEY</code>{' '}
        and the map appears here — the pincodes below are saved either way.
      </div>
    );
  }
  if (failed) {
    return (
      <div className="note note--warn" role="status">
        The map could not be loaded. The territory and its pincodes are saved.
      </div>
    );
  }
  return <div ref={holder} className="terr__map" style={{ '--h': `${height}px` }} />;
}
