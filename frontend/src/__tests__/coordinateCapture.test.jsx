/**
 * The pin-drop affordance. Phase 8.4.
 *
 * ── What these tests defend ─────────────────────────────────────────────────
 *
 * 1. NOTHING IS CAPTURED AS A SIDE EFFECT. 8.4 is last in its phase because it
 *    is the only step that creates an obligation, and the obligation begins the
 *    moment a coordinate is stored. A component that geocoded on mount would
 *    write one for every record anybody opened — metered, and sending a
 *    client's premises to a vendor on every read. So: no request on mount, and
 *    none on a prop change either.
 *
 * 2. EVERY WRITE CARRIES ITS PROVENANCE. Migration 237's `*_geo_complete_ck`
 *    makes a bare pair unrepresentable, so `geo_source` is not optional — and
 *    it is chosen by the action the user took, never guessed.
 *
 * 3. `geo_fetched_at` IS NEVER SENT. It is stamped `NOW()` by the database. A
 *    caller-supplied timestamp would let a 30-day retention rule be reset by
 *    the thing it constrains, so the field must not appear in a request body.
 *
 * 4. THE DIGIPIN IS THE SERVER'S. It is pure arithmetic and could be computed
 *    here, which is the trap: two ten-level grid traversals drift at the last
 *    symbol while agreeing at level 6, so the divergence looks like two systems
 *    naming neighbouring 4 m cells rather than like a bug.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const put = vi.fn();
const del = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    put: (...a) => put(...a),
    delete: (...a) => del(...a),
    get: () => Promise.reject(new Error('this component must not GET')),
  },
  rows: (r) => (Array.isArray(r?.data) ? r.data : r?.data?.data ?? []),
  body: (r) => r?.data ?? {},
}));

/* The permission answer, controllable per test.
   `check-write-gates.mjs` requires the component that owns a control to CALL
   `useModuleWrite` itself rather than take a `canWrite` prop — a control gated
   on a `canWrite` its own scope does not declare is a ReferenceError at render,
   and the screen white-screens the first time somebody opens it. So the hook is
   mocked here rather than a prop passed. */
let writeAnswer = { canWrite: true, reason: '' };
vi.mock('../hooks/useModuleWrite', () => ({
  default: () => writeAnswer,
}));

// The map is words-first and needs no basemap; refused in the `not_configured`
// shape, which is the state the product is in wherever no key is set.
vi.mock('../lib/mapplsSdk', () => ({
  MAP_OFF: 'not_configured',
  MAP_DOWN: 'unavailable',
  loadMappls: () => Promise.reject(
    Object.assign(new Error('off'), { reason: 'not_configured' })),
}));

const { default: CoordinateCapture } =
  await import('../components/CoordinateCapture');

const ID = '11111111-2222-3333-4444-555555555555';

let host, root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  writeAnswer = { canWrite: true, reason: '' };
  put.mockReset();
  del.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(props) {
  await act(async () => {
    root.render(<CoordinateCapture kind="clients" recordId={ID}
      name="Kalpataru Textiles" {...props} />);
  });
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

const text = () => host.textContent;
const buttonSaying = (s) => [...host.querySelectorAll('button')]
  .find(b => b.textContent.toLowerCase().includes(s.toLowerCase()));

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('nothing is captured as a side effect of opening a record', () => {
  it('makes NO request on mount, with or without a coordinate', async () => {
    await render({ lat: null, lng: null });
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('makes no request when a saved coordinate is loaded in', async () => {
    // The shape a detail screen actually renders. If this ever fires a
    // request, every record anybody opens starts writing.
    await render({ lat: 21.1702, lng: 72.8311, geoSource: 'user_pin',
      digipin: '3LKPCM5PPT' });
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('says why a pin is worth dropping, in the units that make it true', async () => {
    await render({ lat: null, lng: null });
    // The same expectation reset 8.2 carries: an address names a postal AREA.
    expect(text()).toMatch(/82 km²/);
    expect(text()).toMatch(/No exact location saved/i);
  });
});

describe('every write carries its provenance', () => {
  it('sends lat, lng and geo_source — and NOTHING else', async () => {
    put.mockResolvedValue({ data: {
      status: 'updated', lat: 21.1702, lng: 72.8311,
      geo_source: 'user_pin', geo_fetched_at: '2026-08-28T00:00:00Z',
      digipin: '3LKPCM5PPT',
    } });
    const changed = vi.fn();
    await render({ lat: null, lng: null, onChange: changed });

    await click(buttonSaying('Drop a pin'));
    const [latIn, lngIn] = host.querySelectorAll('input');
    await type(latIn, '21.1702');
    await type(lngIn, '72.8311');
    await click(buttonSaying('Save this location'));

    expect(put).toHaveBeenCalledTimes(1);
    const [url, payload] = put.mock.calls[0];
    expect(url).toBe(`/v1/graha/clients/${ID}/coordinate`);
    expect(payload).toEqual({ lat: 21.1702, lng: 72.8311, geo_source: 'user_pin' });

    // THE FIELD THAT MUST NOT BE THERE. A caller-supplied timestamp would let
    // a 30-day retention rule be reset by the thing it constrains.
    expect(Object.keys(payload).sort())
      .toEqual(['geo_source', 'lat', 'lng']);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      lat: 21.1702, digipin: '3LKPCM5PPT',
    }));
  });

  it('refuses a half-coordinate before the server has to', async () => {
    await render({ lat: null, lng: null });
    await click(buttonSaying('Drop a pin'));
    const [latIn] = host.querySelectorAll('input');
    await type(latIn, '21.1702');
    await click(buttonSaying('Save this location'));

    expect(put, 'a half-coordinate was sent').not.toHaveBeenCalled();
    expect(text()).toMatch(/half-coordinate is not a location/i);
  });

  it('never sends a blank as zero — 0,0 is a real place', async () => {
    /* Null Island, in the Gulf of Guinea, is what `Number('')` produces and
       what a failed geocode, an uninitialised form and a dropped decimal all
       produce. The server refuses it too; this stops it being SENT. */
    await render({ lat: null, lng: null });
    await click(buttonSaying('Drop a pin'));
    await click(buttonSaying('Save this location'));
    expect(put).not.toHaveBeenCalled();
  });

  it('offers no Mappls source, because there is no lawful Mappls row', async () => {
    // Mappls forbids caching a geocode result, so migration 237's CHECK has no
    // Mappls value and this list is the same rule where a person can read it.
    await render({ lat: null, lng: null });
    await click(buttonSaying('Drop a pin'));
    const options = [...host.querySelectorAll('option')].map(o => o.value);
    expect(options).toEqual(['user_pin', 'device_gps', 'manual_entry']);
    expect(options.join(' ')).not.toMatch(/mappls/i);
    // And no google_places: this product has no Google geocode path to produce
    // one, and it carries a 30-day clock that nothing here would honour.
    expect(options).not.toContain('google_places');
  });
});

describe('what it shows once a coordinate exists', () => {
  it('shows the DIGIPIN it was given and computes none of its own', async () => {
    await render({ lat: 21.1702, lng: 72.8311, geoSource: 'user_pin',
      digipin: '3LKPCM5PPT' });
    expect(text()).toContain('3LKPCM5PPT');
    // Ten characters, no punctuation — India Post changed the canonical form
    // on 2026-05-04 and the hyphenated spelling is superseded.
    expect(text()).not.toContain('3LK-PCM-5PPT');
  });

  it('says a coordinate outside the grid has NO code, rather than nothing', async () => {
    // The grid covers lat 2.5-38.5, lng 63.5-99.5. An absent code must not
    // read as a failure to compute one.
    await render({ lat: 51.5074, lng: -0.1278, geoSource: 'manual_entry',
      digipin: null });
    expect(text()).toMatch(/no code/i);
  });

  it('shows the provenance wherever it shows the pair', async () => {
    // It is the reason the pair is allowed to exist at all.
    await render({ lat: 21.1702, lng: 72.8311, geoSource: 'device_gps',
      digipin: '3LKPCM5PPT' });
    expect(text()).toMatch(/This device's location/i);
  });

  it('clears through the endpoint that nulls all four together', async () => {
    del.mockResolvedValue({ data: { status: 'cleared' } });
    const changed = vi.fn();
    await render({ lat: 21.1702, lng: 72.8311, geoSource: 'user_pin',
      digipin: '3LKPCM5PPT', onChange: changed });

    await click(buttonSaying('Remove'));
    expect(del).toHaveBeenCalledWith(`/v1/graha/clients/${ID}/coordinate`);
    expect(changed).toHaveBeenCalledWith({
      lat: null, lng: null, geo_source: null, geo_fetched_at: null, digipin: null,
    });
  });
});

describe('permission and identity', () => {
  it('disables both controls without write permission', async () => {
    writeAnswer = { canWrite: false, reason: 'You cannot change CRM settings' };
    await render({ lat: 21.1702, lng: 72.8311, digipin: '3LKPCM5PPT' });
    expect(buttonSaying('Move the pin').disabled).toBe(true);
    expect(buttonSaying('Remove').disabled).toBe(true);
  });

  it('never renders the record id — the label is the NAME', async () => {
    // `check-rendered-ids.mjs`, and the rule behind it. The id goes in the URL
    // and nowhere a person can see.
    await render({ lat: 21.1702, lng: 72.8311, digipin: '3LKPCM5PPT' });
    expect(text()).not.toContain(ID);
    expect(text()).toContain('Kalpataru Textiles');
  });

  it('surfaces the server\'s own sentence, not a generic one', async () => {
    // The route distinguishes "not one of these five sources", "must be a
    // finite number", a range, and Null Island — and each tells the person
    // something different to do.
    put.mockRejectedValue({ response: { data: {
      detail: '(0, 0) is in the Gulf of Guinea, not at this address' } } });
    await render({ lat: null, lng: null });
    await click(buttonSaying('Drop a pin'));
    const [latIn, lngIn] = host.querySelectorAll('input');
    await type(latIn, '0');
    await type(lngIn, '0');
    await click(buttonSaying('Save this location'));
    expect(text()).toContain('Gulf of Guinea');
  });
});
