/**
 * The PIN preview popover. Phase 8.2.
 *
 * ── What these tests are actually defending ─────────────────────────────────
 *
 * 1. THE THREE BUCKETS, AGAIN. `unmatched` ("the government published no
 *    boundary") and `unavailable` ("R2 did not answer") both render as "no
 *    shape on screen", and merging them tells a customer their pincode has no
 *    area while the truth is an outage of ours. The backend reads R2 itself
 *    rather than using `storage.download_file` precisely to keep the two apart;
 *    a frontend that merges them throws that away silently.
 *
 * 2. THE LIMIT IS SAID, NOT HIDDEN. The geometry endpoint is per-TERRITORY.
 *    A pincode no territory claims cannot be drawn, and the popover has to say
 *    that in a way that cannot be read as "this pincode has no area".
 *
 * 3. NO VENDOR CALL. §8.2's acceptance is "zero calls to any vendor endpoint in
 *    the network tab". Asserted here as: every URL this component requests is
 *    one of ours, and there are exactly two of them.
 *
 * 4. THE CAPTION IS LOAD-BEARING. "an Indian PIN averages ~82 km²" is the
 *    expectation reset that stops a polygon reading as a building.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same shape as
 * `territoryMapBuckets.test.jsx`.
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

// Refused, in the `not_configured` shape. Every assertion below is about words,
// and the words must be legible with no basemap — which is the state the
// product is actually in while the Mappls console is being sorted out.
vi.mock('../lib/mapplsSdk', () => ({
  MAP_OFF: 'not_configured',
  MAP_DOWN: 'unavailable',
  loadMappls: () => Promise.reject(Object.assign(new Error('off'), { reason: 'not_configured' })),
}));

const { default: PinAreaPopover, normalisePin, pincodeOf } =
  await import('../components/PinAreaPopover');

const SURAT = {
  type: 'Feature',
  properties: { pincode: '395002' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[72.80, 21.10], [72.90, 21.10], [72.90, 21.20], [72.80, 21.20], [72.80, 21.10]]],
  },
};

/** A geometry response with the four buckets defaulted to empty. */
function cover(over = {}) {
  return {
    type: 'FeatureCollection',
    features: [],
    territory_name: 'Surat West',
    claimed: 1,
    matched: 0,
    unmatched: [],
    unavailable: [],
    invalid: [],
    vintage: 'datagov-2025-05',
    attribution: 'Boundaries © Government of India (data.gov.in) — GODL-India',
    ...over,
  };
}

/** The territory list, in the shape `GET /v1/graha/territories` answers. */
function territories(pincodes, name = 'Surat West') {
  return [{
    id: '11111111-2222-3333-4444-555555555555',
    name,
    rules: { pincodes },
    assigned_users: [],
    assigned: [],
  }];
}

/**
 * Wire the two calls this component makes, in order, and record every URL.
 * Anything it asks for that is not one of these two fails loudly rather than
 * resolving to undefined and producing a confusing render.
 */
function serve({ list, geometry }) {
  const seen = [];
  get.mockImplementation((url) => {
    seen.push(url);
    if (url === '/v1/graha/territories') return Promise.resolve({ data: list });
    if (/\/geometry$/.test(url)) return Promise.resolve({ data: geometry });
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  return seen;
}

let host, root;

beforeEach(() => {
  // Without this React logs "The current testing environment is not configured
  // to support act(...)" on every state update and the warnings drown the run.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
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
  await settle();
}

/** Two ticks: the territory list and the geometry resolve one after the other. */
async function settle() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** The popover portals to document.body, so read the whole document. */
const seen = () => document.body.textContent;

async function open() {
  const trigger = document.querySelector('[aria-haspopup="dialog"]');
  expect(trigger, 'the pincode did not render a popover trigger').toBeTruthy();
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

describe('normalisePin · mirrors the server, exactly', () => {
  // `services/territory_routing.normalise_pin` is `^[1-9][0-9]{5}$` after a
  // trim, and it is the product's ONLY definition of "is this a PIN". A
  // frontend that were laxer would offer to preview a value the server refuses
  // to look up; one that were stricter would hide a PIN that routes.
  it('accepts six digits not starting zero, and nothing else', () => {
    expect(normalisePin('395002')).toBe('395002');
    expect(normalisePin('  395002  ')).toBe('395002');
    expect(normalisePin(395002)).toBe('395002');
    expect(normalisePin('395 002')).toBe('');   // a space is not a PIN
    expect(normalisePin('095002')).toBe('');    // PINs never start zero
    expect(normalisePin('39500')).toBe('');
    expect(normalisePin('3950021')).toBe('');
    expect(normalisePin('NW1 245')).toBe('');   // live, on Unicode's `INC UK`
    expect(normalisePin('395002\n')).toBe('395002');
    expect(normalisePin(null)).toBe('');
  });
});

describe('pincodeOf · reads the stored column the way AddressBlock does', () => {
  it('reads the pincode key by NAME and reassembles nothing', () => {
    expect(pincodeOf({ city: 'Surat', pincode: '395002' })).toBe('395002');
    expect(pincodeOf(JSON.stringify({ pincode: '395002' }))).toBe('395002');
    expect(pincodeOf({})).toBe('');
    expect(pincodeOf(null)).toBe('');
    // Navrang Polymers: 43 keys, "0".."41" spelling a JSON string one character
    // each. There is no pincode in it and nothing here invents one.
    const exploded = Object.fromEntries(
      [...'{"city": "Mumbai"}'].map((ch, i) => [String(i), ch]));
    expect(pincodeOf({ ...exploded, city: 'Navi Mumbai' })).toBe('');
    // `INC UK` really holds this. It is not a PIN and it is not corrected.
    expect(pincodeOf({ pincode: 'NW1 245' })).toBe('');
  });
});

describe('PinAreaPopover · what it renders before anything is clicked', () => {
  it('renders NOTHING for an absent pincode — never an empty trigger', async () => {
    await render(<PinAreaPopover pincode={null} />);
    expect(host.textContent).toBe('');
    expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull();
    expect(get, 'nothing may be fetched before the popover is opened')
      .not.toHaveBeenCalled();
  });

  it('renders a non-PIN as inert text, exactly as stored', async () => {
    // Blanking it would take a real (if incoherent) value off the screen to
    // enforce a rule nobody asked for; offering a button that can only
    // apologise is worse than offering none.
    await render(<PinAreaPopover pincode="NW1 245" />);
    expect(host.textContent).toContain('NW1 245');
    expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull();
  });

  it('fetches nothing until the popover is opened', async () => {
    serve({ list: territories(['395002']), geometry: cover() });
    await render(<PinAreaPopover pincode="395002" />);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('PinAreaPopover · the four outcomes, kept apart', () => {
  it('draws the area, names the territory, and calls no vendor', async () => {
    const urls = serve({
      list: territories(['395002']),
      geometry: cover({ features: [SURAT], matched: 1 }),
    });
    await render(<PinAreaPopover pincode="395002" />);
    await open();

    const text = seen();
    // The area, computed locally from the same coordinates a map would draw.
    // The fixture is 0.1° x 0.1° at 21° N ≈ 11.13 km x 10.39 km ≈ 116 km².
    expect(text).toMatch(/covers about/);
    expect(text).toMatch(/11[0-9] km²/);
    expect(text).toContain('Surat West');
    // The caption is the expectation reset and it is not optional.
    expect(text).toContain('an Indian PIN averages ~82 km²');
    expect(text).toContain('not the building');
    // The GODL credit for the boundary data, from the response that supplied it.
    expect(text).toContain('GODL-India');

    // §8.2: "zero calls to any vendor endpoint". Exactly two requests, both ours.
    expect(urls.length).toBe(2);
    expect(urls[0]).toBe('/v1/graha/territories');
    expect(urls[1]).toMatch(/^\/v1\/graha\/territories\/[^/]+\/geometry$/);
    urls.forEach(u => expect(u.startsWith('/v1/')).toBe(true));
  });

  it('says "no boundary published" for an unmatched PIN — and does NOT call it an outage', async () => {
    serve({
      list: territories(['400097']),
      geometry: cover({ unmatched: ['400097'] }),
    });
    await render(<PinAreaPopover pincode="400097" />);
    await open();

    const text = seen();
    expect(text).toContain('No boundary published for 400097');
    // The ordinary-answer framing, and NOT the outage one.
    expect(text).not.toMatch(/could not be read/i);
    expect(document.querySelector('[role="alert"]'),
      'an unmatched PIN is a correct answer, not an alert').toBeNull();
  });

  it('says we do not know for an unavailable PIN — and never "it has no area"', async () => {
    serve({
      list: territories(['110001']),
      geometry: cover({ unavailable: ['110001'] }),
    });
    await render(<PinAreaPopover pincode="110001" />);
    await open();

    const text = seen();
    expect(text).toMatch(/could not be read just now/i);
    expect(text).toContain('does not mean the pincode has none');
    // THE MERGE THIS FILE EXISTS TO PREVENT. During an R2 outage the popover
    // must not print the unmatched sentence, which reads as a fact about the
    // pincode rather than about us.
    expect(text).not.toContain('No boundary published');
    expect(document.querySelector('[role="alert"]'),
      'an outage is a fault and must be announced as one').toBeTruthy();
  });

  it('explains the per-territory limit when no territory claims the PIN', async () => {
    const urls = serve({ list: territories(['395002']), geometry: cover() });
    await render(<PinAreaPopover pincode="560001" />);
    await open();

    const text = seen();
    expect(text).toContain('No territory covers this pincode');
    expect(text).toMatch(/one territory at a time/);
    // It must not be dressed as a property of the pincode.
    expect(text).not.toContain('No boundary published');
    // And it must not ask the server for a geometry it cannot use.
    expect(urls.length, 'the geometry endpoint was called with no claimant').toBe(1);
  });

  it('reports a PIN that falls out of every bucket rather than guessing', async () => {
    // Unreachable if the endpoint holds `matched + unmatched + unavailable ===
    // claimed`. Rendered anyway: a silently lost PIN is exactly what that
    // arithmetic exists to catch, and calling it "no boundary" hides it.
    serve({ list: territories(['395002']), geometry: cover() });
    await render(<PinAreaPopover pincode="395002" />);
    await open();
    expect(seen()).toMatch(/none of the boundary buckets/);
  });

  it('offers a retry when our own lookup fails', async () => {
    get.mockRejectedValue(new Error('network'));
    await render(<PinAreaPopover pincode="395002" />);
    await open();
    expect(seen()).toMatch(/could not be looked up/i);
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });
});

describe('PinAreaPopover · the basemap is an enhancement, never a gate', () => {
  it('says the map is off without dressing it as a fault', async () => {
    // MAP_OFF is a fact about the environment; MAP_DOWN is a fault somebody must
    // go and fix. The loader is mocked to the first, so the words must be the
    // calm ones — and the area, the territory and the caption must all survive.
    serve({
      list: territories(['395002']),
      geometry: cover({ features: [SURAT], matched: 1 }),
    });
    await render(<PinAreaPopover pincode="395002" />);
    await open();

    const text = seen();
    expect(text).toContain('No map is configured in this environment');
    expect(text).not.toMatch(/could not be loaded/i);
    expect(text).toMatch(/covers about/);
    expect(text).toContain('an Indian PIN averages ~82 km²');
  });
});
