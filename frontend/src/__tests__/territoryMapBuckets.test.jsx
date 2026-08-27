/**
 * TerritoryMap must keep the Phase 7.3 buckets apart. Phase 7.5.
 *
 * ── The defect these tests exist to stop ────────────────────────────────────
 *
 * `GET /territories/{id}/geometry` splits every claimed pincode into four
 * places, and two of them look identical on screen if you are careless:
 *
 *     unmatched    the government published no boundary for that PIN. This is
 *                  ORDINARY — 58 PINs in their own directory are like this —
 *                  and it is a COMPLETE, CORRECT answer.
 *     unavailable  R2 did not answer. We do not know whether a boundary
 *                  exists. This is OUR OUTAGE.
 *
 * Both render as "nothing drawn". Collapsing them tells a customer "there is
 * no shape for 110001" while the truth is that our object store is down — and
 * an admin who believes that goes and edits a territory that was never wrong,
 * changing the routing that decides who gets paid for a lead. The backend went
 * to considerable lengths to keep the two apart (it reads R2 itself rather than
 * using `storage.download_file`, precisely because that helper cannot tell a
 * missing key from an outage). A frontend that merges them again throws all of
 * that away, silently.
 *
 * The old component could not have failed these tests, because it never drew
 * anything and never called the endpoint at all. It centred a map on India and
 * stopped, while claiming it needed a key that did not exist.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same shape as
 * `ganitErrorStates.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...a) => get(...a) },
  rows: (r) => (Array.isArray(r?.data) ? r.data : r?.data?.data ?? []),
  body: (r) => r?.data ?? {},
}));

// The SDK loader is mocked to REFUSE, in the `not_configured` shape. Every test
// below is about the four buckets, which are words rather than pixels, and they
// must be legible with no basemap at all — that is the point of fetching the
// shapes and the basemap independently. jsdom cannot run a real map SDK anyway.
vi.mock('../lib/mapplsSdk', () => ({
  MAP_OFF: 'not_configured',
  MAP_DOWN: 'unavailable',
  loadMappls: () => Promise.reject(Object.assign(new Error('off'), { reason: 'not_configured' })),
}));

const { default: TerritoryMap } = await import('../components/TerritoryMap');

/** A geometry response with the four buckets defaulted to empty. */
function cover(over = {}) {
  return {
    type: 'FeatureCollection',
    features: [],
    territory_name: 'Surat West',
    claimed: 0,
    matched: 0,
    unmatched: [],
    unavailable: [],
    invalid: [],
    vintage: 'datagov-2025-05',
    attribution: 'Boundaries © Government of India (data.gov.in) — GODL-India',
    ...over,
  };
}

/** One feature, shaped exactly as `pin_boundaries.geometry_for_pins` emits it. */
function feature(pincode) {
  return {
    type: 'Feature',
    properties: { pincode },
    geometry: {
      type: 'Polygon',
      coordinates: [[[72.8, 21.1], [72.9, 21.1], [72.9, 21.2], [72.8, 21.2], [72.8, 21.1]]],
    },
  };
}

let host, root;

beforeEach(() => {
  get.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(props) {
  await act(async () => { root.render(<TerritoryMap {...props} />); });
  // One extra tick: the geometry fetch and the (rejected) SDK load both resolve
  // as microtasks and the component paints after both.
  await act(async () => { await Promise.resolve(); });
  return host.textContent;
}

describe('TerritoryMap · the four buckets are never merged', () => {
  it('an outage says so, and never says the pincodes have no shape', async () => {
    get.mockResolvedValue({ data: cover({ claimed: 2, unavailable: ['395002', '395003'] }) });

    const text = await render({ territoryId: 't1' });

    // The words that make it an outage rather than an answer.
    expect(text).toMatch(/unreachable|could not be looked up/i);
    expect(text).toMatch(/395002/);
    // And the sentence that would send someone to edit a correct territory
    // must NOT appear. This is the whole test.
    expect(text).not.toMatch(/no boundary has been published/i);
  });

  it('unmatched pincodes are reported as an ordinary, complete answer', async () => {
    get.mockResolvedValue({ data: cover({ claimed: 2, unmatched: ['110009', '110010'] }) });

    const text = await render({ territoryId: 't1' });

    expect(text).toMatch(/no boundary has been published/i);
    expect(text).toMatch(/110009/);
    // Not an outage: nothing here is retryable and nothing is our fault.
    expect(text).not.toMatch(/unreachable|could not be looked up/i);
    // And the reassurance that this changes nothing about routing.
    expect(text).toMatch(/still route/i);
  });

  it('an outage and a genuine gap in the same response stay distinguishable', async () => {
    // The case that a single "some pincodes could not be drawn" message would
    // destroy: one PIN has no published boundary, another could not be read.
    get.mockResolvedValue({ data: cover({
      claimed: 3,
      matched: 1,
      features: [feature('395002')],
      unmatched: ['110009'],
      unavailable: ['400001'],
    }) });

    const text = await render({ territoryId: 't1' });

    expect(text).toMatch(/no boundary has been published[\s\S]*110009/i);
    expect(text).toMatch(/could not be looked up[\s\S]*400001/i);
    expect(text).not.toMatch(/no boundary has been published[\s\S]*400001/);
  });

  it('reports entries that are not pincodes at all, rather than dropping them', async () => {
    get.mockResolvedValue({ data: cover({ claimed: 1, matched: 1, features: [feature('395002')],
                                          invalid: ['ahmedabad', 'NW1 245'] }) });

    const text = await render({ territoryId: 't1' });

    expect(text).toMatch(/ahmedabad/);
    expect(text).toMatch(/NW1 245/);
    // Named as ignored by ROUTING too — otherwise a reader assumes the map is
    // fussier than the thing that assigns leads, and ignores the warning.
    expect(text).toMatch(/routing/i);
  });
});

describe('TerritoryMap · the arithmetic is asserted, not assumed', () => {
  it('says nothing when the buckets account for every claimed pincode', async () => {
    get.mockResolvedValue({ data: cover({
      claimed: 3, matched: 1, features: [feature('395002')],
      unmatched: ['110009'], unavailable: ['400001'],
    }) });

    const text = await render({ territoryId: 't1' });
    expect(text).not.toMatch(/unaccounted for/i);
  });

  it('surfaces a shortfall — a silently dropped pincode stops routing', async () => {
    // matched 1 + unmatched 0 + unavailable 0 = 1, against 4 claimed. Three
    // pincodes have gone missing between the database and this screen, and the
    // reader must be told rather than shown a confident map of a quarter of
    // their territory.
    get.mockResolvedValue({ data: cover({
      claimed: 4, matched: 1, features: [feature('395002')],
    }) });

    const text = await render({ territoryId: 't1' });
    expect(text).toMatch(/1 of 4 pincodes are accounted for/i);
    expect(text).toMatch(/report this/i);
  });
});

describe('TerritoryMap · credits and honesty about what it is showing', () => {
  it('renders the GODL credit from the response, never a hardcoded string', async () => {
    // A deliberately different string from the live one: if the component
    // hardcoded the credit this assertion could not pass.
    get.mockResolvedValue({ data: cover({
      claimed: 1, matched: 1, features: [feature('395002')],
      attribution: 'Boundaries © SOME OTHER SOURCE — checked from the response',
    }) });

    const text = await render({ territoryId: 't1' });
    expect(text).toMatch(/SOME OTHER SOURCE/);
  });

  it('a missing map is stated as a fact, not as a fault', async () => {
    // The mocked loader rejects with `not_configured`. An environment without
    // Mappls credentials is not broken, and saying "the map could not be
    // loaded" there sends someone hunting a fault that does not exist.
    get.mockResolvedValue({ data: cover({ claimed: 1, matched: 1, features: [feature('395002')] }) });

    const text = await render({ territoryId: 't1' });
    expect(text).toMatch(/no map is configured/i);
    expect(text).toMatch(/still accurate/i);
    expect(text).not.toMatch(/could not be loaded/i);
  });

  it('an unsaved territory says the shapes come after saving', async () => {
    // No id: there is no saved row to ask about, and the old component's answer
    // — an empty map centred on India — reads as breakage.
    const text = await render({ pincodes: ['395002', '395003'] });
    expect(text).toMatch(/2 pincodes/i);
    expect(text).toMatch(/once this territory is saved/i);
    expect(get).not.toHaveBeenCalled();
  });

  it('warns that it is showing SAVED coverage while pincodes are being edited', async () => {
    // Three typed, one saved. Without this the reader adds a pincode, sees the
    // map not change, and concludes the map is broken.
    get.mockResolvedValue({ data: cover({ claimed: 1, matched: 1, features: [feature('395002')] }) });

    const text = await render({ territoryId: 't1', pincodes: ['395002', '395003', '395004'] });
    expect(text).toMatch(/saved coverage/i);
  });

  it('does not warn when the typed list matches what was saved', async () => {
    get.mockResolvedValue({ data: cover({ claimed: 1, matched: 1, features: [feature('395002')] }) });

    const text = await render({ territoryId: 't1', pincodes: ['395002'] });
    expect(text).not.toMatch(/saved coverage/i);
  });

  it('a failed geometry fetch is an error state, not an empty territory', async () => {
    // The `ganitErrorStates` lesson, applied here: a territory that reads as
    // covering nothing is a false statement about the business, and it is
    // indistinguishable from a territory that genuinely covers nothing.
    get.mockRejectedValue(new Error('boom'));

    const text = await render({ territoryId: 't1' });
    expect(text).toMatch(/could not be loaded/i);
    expect(text).toMatch(/try again/i);
  });
});
