/**
 * PointRadiusMap must be honest in the states nobody can currently see.
 * Phase 8.1.
 *
 * ── Why the happy path is the least interesting case here ───────────────────
 *
 * The Mappls basemap 401s on every domain today, so "the tiles drew" is the ONE
 * state this component cannot reach in any live environment. Everything a
 * customer can actually hit right now is a degraded state, and every one of
 * them is a sentence that has to be true:
 *
 *   MAP_OFF     this environment holds no Mappls credentials. NOT a fault.
 *   MAP_DOWN    we hold credentials and got no basemap. A fault.
 *   no point    the form has not been filled in yet.
 *   0, 0        a real place in the Atlantic that looks exactly like a blank.
 *   radius 0    a circle nothing can ever be inside.
 *   transposed  a valid coordinate pair in the Arabian Sea.
 *
 * The last three are the ones that cost money. A Pahchan geofence decides
 * whether a punch is flagged, a punch keeps its flags AT CAPTURE, and nobody
 * can fix yesterday — so a fence that is quietly wrong flags honest staff every
 * morning until a human notices. These tests are the noticing.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same shape as
 * `territoryMapBuckets.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* The loader is swapped per test. jsdom cannot run a real map SDK, and it does
   not need to: what is being tested is what this component SAYS about each
   outcome, which is the part a customer reads. */
const { loader } = vi.hoisted(() => ({ loader: { impl: null } }));

vi.mock('../lib/mapplsSdk', () => ({
  MAP_OFF: 'not_configured',
  MAP_DOWN: 'unavailable',
  loadMappls: () => loader.impl(),
}));

const { default: PointRadiusMap } = await import('../components/PointRadiusMap');

const refuse = reason => () =>
  Promise.reject(Object.assign(new Error(reason), { reason }));

/** A stand-in SDK that records what it was asked to draw. */
function fakeSdk(seen) {
  return {
    Map: class {
      constructor(el, opts) { seen.map = opts; }
      addListener(ev, cb) { if (ev === 'load') cb(); }
      remove() {}
    },
    Marker: class {
      constructor(o) { seen.markers.push(o); }
      remove() {}
    },
    Circle: class {
      constructor(o) { seen.circles.push(o); }
      remove() {}
    },
  };
}

let host, root;

beforeEach(() => {
  loader.impl = refuse('not_configured');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(props) {
  await act(async () => { root.render(<PointRadiusMap {...props} />); });
  // The loader settles as a microtask and the component paints after it.
  await act(async () => { await Promise.resolve(); });
  return host.textContent;
}

/** A site in Mumbai, as `Sites.jsx` would hand it over: form strings. */
const FORT = { subject: 'site', lat: '18.933300', lng: '72.833600', radiusM: '150' };

describe('PointRadiusMap · a missing basemap is not one thing', () => {
  it('MAP_OFF is stated as a fact about the environment, not as a fault', async () => {
    // An environment with no Mappls credentials is not broken. Calling it
    // broken sends an operator hunting a bug that does not exist, which is the
    // failure `lib/mapplsSdk.js` split the two reasons apart to prevent.
    const text = await render(FORT);

    expect(text).toMatch(/no map is configured in this environment/i);
    expect(text).not.toMatch(/could not be loaded/i);
    // And the figures are still offered as the thing being saved.
    expect(text).toMatch(/figures above are the ones that will be saved/i);
  });

  it('MAP_DOWN is stated as a fault, and never as "no map here"', async () => {
    // We hold credentials and got no basemap. Somebody has to go and fix that,
    // and dressing it up as "this environment has no map" means nobody will.
    loader.impl = refuse('unavailable');

    const text = await render(FORT);

    expect(text).toMatch(/the map could not be loaded/i);
    expect(text).not.toMatch(/no map is configured/i);
    expect(text).toMatch(/check them before saving/i);
  });

  it('an unknown rejection reason is treated as a fault, not as "off"', async () => {
    // A loader that throws something unexpected must fail towards the state
    // that gets looked at. Defaulting to MAP_OFF would silence a real outage.
    loader.impl = () => Promise.reject(new Error('something else entirely'));

    const text = await render(FORT);

    expect(text).toMatch(/the map could not be loaded/i);
    expect(text).not.toMatch(/no map is configured/i);
  });

  it('the figures are readable with no basemap at all', async () => {
    // The whole design premise: the numbers do not depend on the tiles. If this
    // ever fails, the component has become useless in every live environment.
    const text = await render(FORT);

    expect(text).toMatch(/18\.933300° N/);
    expect(text).toMatch(/72\.833600° E/);
    expect(text).toMatch(/150 m/);
  });
});

describe('PointRadiusMap · a fence that has not been placed', () => {
  it('says nothing has been typed yet, rather than drawing a default', async () => {
    const text = await render({ subject: 'site', lat: '', lng: '', radiusM: '150' });

    expect(text).toMatch(/no coordinates yet/i);
    // Not an error, and not a centre.
    expect(text).not.toMatch(/° N|° S/);
  });

  it('0, 0 is named as a real place in the Atlantic, not treated as blank', async () => {
    // `Number('') === 0`, so a pair of zeroes is what an empty form looks like
    // after one careless cast — and it is also a coordinate that passes every
    // range check in the product. Drawing it silently is the bug.
    const text = await render({ subject: 'site', lat: '0', lng: '0', radiusM: '150' });

    expect(text).toMatch(/atlantic/i);
    expect(text).toMatch(/not a blank/i);
    expect(text).not.toMatch(/0\.000000° N/);
  });

  it('one coordinate without the other is a half-filled form, not a point', async () => {
    const text = await render({ subject: 'site', lat: '18.9333', lng: '', radiusM: '150' });

    expect(text).toMatch(/only one of the two coordinates/i);
  });

  it('coordinates off the earth are named as such', async () => {
    // 191 is not a longitude. The server refuses it; this says why first.
    const text = await render({ subject: 'site', lat: '18.9333', lng: '191', radiusM: '150' });

    expect(text).toMatch(/off the earth/i);
  });
});

describe('PointRadiusMap · the typos this screen exists to catch', () => {
  it('a radius of 0 is called a circle nothing can be inside', async () => {
    // Distinct from having no radius at all. A zero radius means every punch at
    // that site is flagged, for ever, and the row would otherwise read "0 m"
    // as calmly as it reads "150 m".
    const text = await render({ ...FORT, radiusM: '0' });

    expect(text).toMatch(/nothing can be inside/i);
    expect(text).toMatch(/would fall outside it/i);
  });

  it('a radius of 15 is challenged as a possible missing digit', async () => {
    // The exact typo `Sites.jsx`'s own header names: 15 instead of 150.
    const text = await render({ ...FORT, radiusM: '15' });

    expect(text).toMatch(/missing digit/i);
  });

  it('a radius of 150 is not challenged', async () => {
    // A warning that fires on the default value is a warning nobody reads.
    const text = await render(FORT);

    expect(text).not.toMatch(/missing digit/i);
    expect(text).toMatch(/300 m/); // the diameter, stated across the ground
  });

  it('a transposed pair is named as transposed', async () => {
    // 72.83, 18.93 is a valid coordinate pair in the Arabian Sea. Nothing in
    // the product rejects it, and on a bare number input it is invisible.
    const text = await render({ ...FORT, lat: '72.833600', lng: '18.933300' });

    expect(text).toMatch(/outside india/i);
    expect(text).toMatch(/wrong way round/i);
  });

  it('a lost minus sign shows as the other hemisphere', async () => {
    const text = await render({ ...FORT, lat: '-18.933300' });

    expect(text).toMatch(/18\.933300° S/);
    expect(text).toMatch(/outside india/i);
  });

  it('a genuinely foreign site is flagged but never called wrong', async () => {
    // London. Kartavya has a UK org on its books, so "outside India" must be an
    // observation and not an accusation — and the transposition sentence must
    // NOT appear, because swapping these two lands in the Indian Ocean.
    const text = await render({ ...FORT, lat: '51.5074', lng: '-0.1278' });

    expect(text).toMatch(/outside india/i);
    expect(text).toMatch(/nothing is blocked/i);
    expect(text).not.toMatch(/wrong way round/i);
  });
});

describe('PointRadiusMap · when a basemap does arrive', () => {
  it('draws the circle at the radius that was typed, and credits Mappls from the response', async () => {
    const seen = { map: null, markers: [], circles: [] };
    loader.impl = () => Promise.resolve({
      mappls: fakeSdk(seen),
      // Deliberately not the live wording: if the component hardcoded the
      // credit this assertion could not pass, which is the same rule
      // `check-mappls-attribution.mjs` enforces from the outside.
      attribution: 'CREDIT FROM THE TOKEN RESPONSE',
      attributionHref: 'https://example.invalid/terms',
    });

    const text = await render(FORT);

    expect(seen.map.center).toEqual([18.9333, 72.8336]);
    expect(seen.circles).toHaveLength(1);
    expect(seen.circles[0].radius).toBe(150);
    expect(seen.circles[0].center).toEqual({ lat: 18.9333, lng: 72.8336 });
    expect(seen.markers).toHaveLength(1);
    expect(text).toMatch(/CREDIT FROM THE TOKEN RESPONSE/);

    // The credit must be present and reachable, not merely in the DOM.
    const brand = host.querySelector('.terr__mapbrand');
    expect(brand).not.toBeNull();
    expect(brand.getAttribute('href')).toBe('https://example.invalid/terms');
  });

  it('draws no circle when there is no radius, rather than inventing one', async () => {
    const seen = { map: null, markers: [], circles: [] };
    loader.impl = () => Promise.resolve({
      mappls: fakeSdk(seen), attribution: 'x', attributionHref: 'https://example.invalid/',
    });

    await render({ subject: 'point', lat: '18.9333', lng: '72.8336' });

    expect(seen.markers).toHaveLength(1);
    expect(seen.circles).toHaveLength(0);
  });

  it('a zero radius draws no circle either — a 0 m ring would read as a pin', async () => {
    const seen = { map: null, markers: [], circles: [] };
    loader.impl = () => Promise.resolve({
      mappls: fakeSdk(seen), attribution: 'x', attributionHref: 'https://example.invalid/',
    });

    const text = await render({ ...FORT, radiusM: '0' });

    expect(seen.circles).toHaveLength(0);
    // And the words still say what the zero means, with tiles present.
    expect(text).toMatch(/nothing can be inside/i);
  });

  it('an SDK that throws is reported, never silently drawn as an empty map', async () => {
    // A blank map box and a correct fence look identical. This is the failure
    // mode the Phase 7.5 rewrite was written against, and it applies here too.
    loader.impl = () => Promise.resolve({
      mappls: { Map: class { constructor() { throw new Error('no style'); } } },
      attribution: 'x',
      attributionHref: 'https://example.invalid/',
    });

    const text = await render(FORT);

    expect(text).toMatch(/could not be drawn/i);
    // The figures survive the drawing failure, because they never needed it.
    expect(text).toMatch(/18\.933300° N/);
  });
});

describe('PointRadiusMap · it is reusable, and it holds no identifiers', () => {
  it('takes no id and renders none — the label is a name', async () => {
    // `check-rendered-ids.mjs` is positional and cannot see through props, so
    // the guarantee is structural: this component has no id prop to render.
    const text = await render({ ...FORT, label: 'Fort office' });

    expect(text).toMatch(/Fort office/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('the subject noun comes from the caller, so 8.2 and 8.4 can mount it', async () => {
    const text = await render({ subject: 'address', lat: '', lng: '' });

    expect(text).toMatch(/the address is drawn here/i);
    expect(text).not.toMatch(/\bsite\b/i);
  });

  it('the module-specific consequence is the caller’s sentence, not this component’s', async () => {
    const text = await render({ ...FORT, radiusNote: 'A punch inside counts as at the site.' });

    expect(text).toMatch(/A punch inside counts as at the site/);
  });
});
