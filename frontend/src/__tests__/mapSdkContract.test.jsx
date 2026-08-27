/**
 * How every map component must CALL the Mappls SDK. Phase 7.5 / 8.1.
 *
 * ── The bug this exists to stop coming back ─────────────────────────────────
 *
 * `mappls.Map()` takes the container's **id, as a string**. Both components
 * passed the DOM element instead, and `center` as `[lat, lng]` where the SDK
 * wants `{lat, lng}`. On staging that produced, in Mappls' own console:
 *
 *     Error: Map conatainer not defined!!            (their typo, not ours)
 *     Error: Please pass map object for polygon or use under load event
 *
 * And on screen: an **empty box**. Not a blank page, not an exception, not a
 * failed request — the SDK loaded, "Powered by Mappls" rendered, "1 of 1
 * pincode drawn" rendered, the GODL credit rendered, and the map itself was
 * simply absent. Every signal a person or a test would look at said the feature
 * worked.
 *
 * Nothing we had could catch it. The unit tests mock the SDK away and never
 * look at HOW it is called; the gates read CSS and imports; the live probes
 * proved the credential and the domain, which were by then correct. The defect
 * lived in the two arguments between a working SDK and a working map.
 *
 * So this file asserts the CONTRACT rather than the outcome: the id is a string,
 * an element with that id is really in the document, and the centre is a
 * `{lat, lng}` object. A test that mocked the SDK and checked nothing about the
 * call is what let this reach a browser.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();
const mapCtor = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...a) => get(...a) },
  rows: (r) => (Array.isArray(r?.data) ? r.data : r?.data?.data ?? []),
  body: (r) => r?.data ?? {},
}));

/** A stand-in SDK that records how it was called and nothing else. */
const fitCall = vi.fn();

function fakeMappls() {
  class Map {
    constructor(container, opts) {
      mapCtor(container, opts);
      this.container = container;
      this.opts = opts;
    }
    addListener(evt, fn) { if (evt === 'load') fn(); }
    fitBounds(...a) { fitCall(...a); }
    remove() {}
  }
  const noop = function () { return {}; };
  return { Map, Polygon: noop, Marker: noop, Circle: noop };
}

vi.mock('../lib/mapplsSdk', () => ({
  MAP_OFF: 'not_configured',
  MAP_DOWN: 'unavailable',
  loadMappls: () => Promise.resolve({
    mappls: fakeMappls(),
    attribution: 'Powered by Mappls',
    attributionHref: 'https://www.mappls.com/',
  }),
}));

const { default: TerritoryMap } = await import('../components/TerritoryMap');
const { default: PointRadiusMap } = await import('../components/PointRadiusMap');
const { default: PinAreaPopover } = await import('../components/PinAreaPopover');

const FEATURE = {
  type: 'Feature',
  properties: { pincode: '395002' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[72.8, 21.1], [72.9, 21.1], [72.9, 21.2], [72.8, 21.2], [72.8, 21.1]]],
  },
};

let host, root;

beforeEach(() => {
  get.mockReset();
  mapCtor.mockReset();
  fitCall.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(el) {
  await act(async () => { root.render(el); });
  // Two ticks: the geometry fetch and the SDK load both settle as microtasks,
  // and the draw effect runs only once both have.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** The assertions both components owe, so neither can drift from the other. */
function assertSdkContract(what) {
  expect(mapCtor, `${what} never constructed a map`).toHaveBeenCalled();
  const [container, opts] = mapCtor.mock.calls[0];

  // 1. An ID STRING, not the element. This is the whole bug.
  expect(typeof container,
    `${what} passed a ${typeof container} to mappls.Map — it takes the container's id as a string`)
    .toBe('string');
  expect(container.length).toBeGreaterThan(0);

  // 2. And that id must actually resolve. A string is necessary but not
  //    sufficient: a stale or misspelled id produces the identical empty box.
  expect(document.getElementById(container),
    `${what} passed the id "${container}" but no element in the document has it`)
    .toBeTruthy();

  // 3. `{lat, lng}`, never an array. An array is silently accepted and centres
  //    the map on nothing, which looks like a data problem for a day.
  expect(Array.isArray(opts.center),
    `${what} passed center as an array — the SDK wants {lat, lng}`).toBe(false);
  expect(typeof opts.center.lat).toBe('number');
  expect(typeof opts.center.lng).toBe('number');
  expect(Number.isFinite(opts.center.lat)).toBe(true);
  expect(Number.isFinite(opts.center.lng)).toBe(true);
}

describe('TerritoryMap · calls the Mappls SDK the way the SDK documents', () => {
  it('passes a resolvable id string and a {lat,lng} centre', async () => {
    get.mockResolvedValue({ data: {
      type: 'FeatureCollection', features: [FEATURE], territory_name: 'Gujarat',
      claimed: 1, matched: 1, unmatched: [], unavailable: [], invalid: [],
      vintage: 'datagov-2025-05', attribution: 'Boundaries © Government of India',
    } });

    await render(<TerritoryMap territoryId="t1" />);
    assertSdkContract('TerritoryMap');
  });

  it('fits bounds in [lng, lat] — the one call that is not {lat, lng}', async () => {
    /* THE SEAM WHERE EVERY BUG IN THIS FEATURE HAS LIVED. Two conventions meet
       here and they are opposites: GeoJSON (the government boundary data) is
       [lng, lat]; the Mappls SDK's `center` is {lat, lng}. `fitBounds` is the
       one call in the component that takes [lng, lat] PAIRS, so a swap does not
       look wrong sitting beside the `center` two lines above it.

       And it does not fail loudly. For Surat (21.2 N, 72.9 E) the swapped pair
       reads as lng 21, lat 72 — the Norwegian Sea. The map opened correctly on
       Gujarat and then flew to empty ocean, so a screenshot taken at the wrong
       moment shows a working map. That is what shipped. */
    get.mockResolvedValue({ data: {
      type: 'FeatureCollection', features: [FEATURE], territory_name: 'Gujarat',
      claimed: 1, matched: 1, unmatched: [], unavailable: [], invalid: [],
      vintage: 'datagov-2025-05', attribution: 'Boundaries © Government of India',
    } });

    await render(<TerritoryMap territoryId="t1" />);

    expect(fitCall, 'the map never fitted to its shapes').toHaveBeenCalled();
    const [bounds] = fitCall.mock.calls[0];
    const [[west, south], [east, north]] = bounds;

    // The fixture is Surat: lng ≈ 72.8–72.9, lat ≈ 21.1–21.2.
    expect(west, 'west must be a LONGITUDE (~72 for Surat), not a latitude')
      .toBeCloseTo(72.8, 1);
    expect(east).toBeCloseTo(72.9, 1);
    expect(south, 'south must be a LATITUDE (~21 for Surat), not a longitude')
      .toBeCloseTo(21.1, 1);
    expect(north).toBeCloseTo(21.2, 1);

    // Stated as the invariant too, so the failure reads as "these are swapped"
    // rather than as four unrelated numbers being off.
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(Math.abs(south), 'a latitude cannot exceed 90').toBeLessThanOrEqual(90);
  });

  it('gives each mounted map a DISTINCT id', async () => {
    // The territory list mounts one per open row. Two elements sharing an id
    // would draw both territories into whichever the SDK found first — a bug
    // that only appears with two rows open and is near-impossible to read.
    get.mockResolvedValue({ data: {
      type: 'FeatureCollection', features: [FEATURE], territory_name: 'Gujarat',
      claimed: 1, matched: 1, unmatched: [], unavailable: [], invalid: [],
      vintage: 'datagov-2025-05', attribution: 'Boundaries © Government of India',
    } });

    await render(
      <>
        <TerritoryMap territoryId="t1" />
        <TerritoryMap territoryId="t2" />
      </>,
    );
    const ids = mapCtor.mock.calls.map(([c]) => c);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size, 'two maps shared one container id').toBe(2);
  });
});

describe('PointRadiusMap · the same contract, so the two cannot drift', () => {
  it('passes a resolvable id string and a {lat,lng} centre', async () => {
    await render(
      <PointRadiusMap label="Head office" lat={19.076} lng={72.8777} radiusM={200} />,
    );
    assertSdkContract('PointRadiusMap');
  });
});

describe('PinAreaPopover · the third map, on the same contract', () => {
  /* Phase 8.2. It is the one component here that COPIES `ringsOf` and
     `boundsOf` rather than importing them — they are private to
     `TerritoryMap.jsx` — so it is the one with a live route back to the swapped
     bounds. That is precisely why it is pinned here from the same fixture: a
     copy that drifts fails on the identical four numbers. */
  async function openAt(pin) {
    get.mockImplementation((url) => {
      if (url === '/v1/graha/territories') {
        return Promise.resolve({ data: [{
          id: 't-1', name: 'Surat West', rules: { pincodes: ['395002'] },
        }] });
      }
      return Promise.resolve({ data: {
        type: 'FeatureCollection', features: [FEATURE], territory_name: 'Surat West',
        claimed: 1, matched: 1, unmatched: [], unavailable: [], invalid: [],
        vintage: 'datagov-2025-05', attribution: 'Boundaries © Government of India',
      } });
    });
    await render(<PinAreaPopover pincode={pin} />);
    const trigger = document.querySelector('[aria-haspopup="dialog"]');
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The territory list, the geometry, and the SDK all settle as microtasks.
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
  }

  it('passes a resolvable id string and a {lat,lng} centre', async () => {
    await openAt('395002');
    assertSdkContract('PinAreaPopover');
  });

  it('fits bounds in [lng, lat] — the copied helper must not drift', async () => {
    await openAt('395002');
    expect(fitCall, 'the popover never fitted to the PIN outline').toHaveBeenCalled();
    const [bounds] = fitCall.mock.calls[0];
    const [[west, south], [east, north]] = bounds;
    expect(west, 'west must be a LONGITUDE (~72 for Surat), not a latitude')
      .toBeCloseTo(72.8, 1);
    expect(east).toBeCloseTo(72.9, 1);
    expect(south, 'south must be a LATITUDE (~21 for Surat), not a longitude')
      .toBeCloseTo(21.1, 1);
    expect(north).toBeCloseTo(21.2, 1);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
  });
});
