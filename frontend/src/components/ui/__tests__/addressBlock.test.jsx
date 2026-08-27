/**
 * AddressBlock — PHASE-8 §8.0's acceptance, and the live rows it was written
 * against.
 *
 * §8.0 asks for exactly two assertions: the href is built FROM THE RECORD, and
 * a record with no address renders NOTHING AT ALL rather than a link to
 * `?query=`. Everything else here exists because a live sweep on 2026-08-27
 * measured the six address columns and found the obvious implementations of
 * both would pass a hand-written fixture and fail the database:
 *
 *   · "no address" is almost never NULL. In E2E Test & Associates all 235
 *     contacts, all 83 employees and all 322 orders have a NOT NULL address
 *     column holding `{}`.
 *   · "has an address" is not `Object.keys(...).length` either. Navrang
 *     Polymers has 43 keys and one of them is real.
 *
 * The two malformed records are reproduced here at full fidelity, keys and
 * values as measured, because a paraphrase of a corrupt row is a clean row.
 *
 * Rendered with react-dom directly — the same reason `columnResizer.test.jsx`
 * gives: @testing-library/react is installed and its @testing-library/dom peer
 * is not reliably resolvable in this suite.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import AddressBlock, { addressLines, coordinate, mapsHref } from '../AddressBlock';

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props) {
  act(() => root.render(<AddressBlock {...props} />));
  return {
    block: container.querySelector('.k-addr'),
    link: container.querySelector('.k-addr__link'),
    text: container.querySelector('.k-addr__text'),
  };
}

/* ── The live specimens, as measured 2026-08-27 ────────────────────────────── */

/**
 * Unicode Group · `Navrang Polymers`, `graha_clients.address`.
 *
 * Keys "0".."41" spell `{"city": "Mumbai", "state": "Maharashtra"}` one
 * character each — a JSON string somebody spread with `{...address}` and saved
 * back. The 43rd key is a GENUINE `city` and it says something DIFFERENT from
 * the exploded copy: "Navi Mumbai", not "Mumbai". Built from the real string so
 * the fixture cannot drift from the shape it is imitating.
 */
const EXPLODED = '{"city": "Mumbai", "state": "Maharashtra"}';
const NAVRANG = { ...Object.fromEntries([...EXPLODED].map((ch, i) => [String(i), ch])), city: 'Navi Mumbai' };

/** Unicode Group · `INC UK`. Incoherent in every field, not only the pincode. */
const INC_UK = {
  city: 'Uganda',
  line1: 'London',
  line2: 'Bopal Circle',
  state: 'New York',
  pincode: 'NW1 245',
};

/** The shape E2E Test & Associates' 61 clients carry: no `state`, no pincode. */
const E2E_CLIENT = { line1: '4th Floor, Iscon Emporio', city: 'Ahmedabad', state_code: '24' };

/* ── §8.0, clause 1 · the href is built from the record ────────────────────── */

describe('the href is built from the record', () => {
  it('joins the seven keys in the invoice order and encodes them once', () => {
    const address = {
      line1: '301, Rajhans Complex', line2: 'Ring Road',
      city: 'Surat', state: 'Gujarat', pincode: '395002', country: 'India',
    };
    const { link } = render({ address });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query='
      + encodeURIComponent('301, Rajhans Complex, Ring Road, Surat, Gujarat, 395002, India'),
    );
  });

  it('opens in a new tab and sends no referrer', () => {
    // Our URLs carry record ids. `rel="noreferrer"` is what keeps a customer's
    // premises from reaching Google alongside a join key for it.
    const { link } = render({ address: E2E_CLIENT });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('prefers a coordinate over the address text, at full precision', () => {
    // §8.0: far more accurate than an Indian address string. The DISPLAY still
    // reads the words, because a decimal pair tells a human nothing.
    const { link, text } = render({
      address: { line1: '301, Rajhans Complex', city: 'Surat' },
      lat: 21.1959234,
      lng: 72.8302341,
    });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('21.1959234,72.8302341'),
    );
    expect(text.textContent).toContain('301, Rajhans Complex');
  });

  it('renders a punch, which is a coordinate and nothing else', () => {
    // The Pahchan consumer. 699 of 700 live punches carry both halves.
    const { text, link } = render({ lat: '19.0759837', lng: '72.8776559', inline: true });
    expect(text.textContent).toBe('19.0760, 72.8777');            // unchanged from Register
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('19.0759837,72.8776559'),
    );
  });
});

/* ── §8.0, clause 2 · no address renders NOTHING AT ALL ────────────────────── */

describe('a record with no address renders nothing at all', () => {
  // `{}` is the important one and it is the majority of live rows. A component
  // guarding on `!address` would render a link to the user's own location for
  // every contact in E2E Test & Associates.
  const nothings = [
    ['null', null],
    ['undefined', undefined],
    ['{} — 235 contacts, 83 employees, 322 orders in E2E', {}],
    ['an object of blanks', { line1: '', line2: '   ', city: '', pincode: null }],
    ['a JSON string of {}', '{}'],
    ['an empty string', ''],
    ['an array', ['line1', 'city']],
    ['a number', 42],
  ];

  for (const [name, address] of nothings) {
    it(`renders no element and no link for ${name}`, () => {
      const { block, link } = render({ address });
      expect(block).toBe(null);
      expect(link).toBe(null);
      expect(container.innerHTML).toBe('');
      expect(mapsHref({ address })).toBe(null);
    });
  }

  it('never emits a link whose query is empty', () => {
    // The failure this clause exists to prevent: `?query=` opens Google Maps on
    // the reader's own location, which looks exactly like having found the
    // client's premises.
    for (const [, address] of nothings) {
      expect(String(mapsHref({ address }))).not.toContain('query=');
    }
    for (const [, address] of nothings) {
      render({ address });
      expect(container.querySelector('a')).toBe(null);
    }
  });

  it('renders nothing when half a coordinate is present', () => {
    // A latitude without a longitude is not a location, and `Number(null)` is 0.
    expect(coordinate(19.0759, null)).toBe(null);
    expect(coordinate('', '')).toBe(null);
    expect(coordinate(true, false)).toBe(null);
    expect(coordinate('north', 'east')).toBe(null);
    expect(coordinate(91, 10)).toBe(null);            // out of range
    expect(render({ lat: 19.0759, lng: null }).block).toBe(null);
  });
});

/* ── The two malformed records, both named in §8.0's Watch ─────────────────── */

describe('Navrang Polymers — 43 keys, 42 of them one character', () => {
  it('reads the real city by name and ignores the exploded copy', () => {
    // Rendering every key, or joining the values in key order, yields
    // `{"city": "Mumbai", "state": "Maharashtra"}` as a line of punctuation.
    expect(Object.keys(NAVRANG)).toHaveLength(43);
    expect(addressLines(NAVRANG)).toEqual(['Navi Mumbai']);

    const { text, link } = render({ address: NAVRANG });
    expect(text.textContent).toBe('Navi Mumbai');
    expect(text.textContent).not.toContain('{');
    expect(text.textContent).not.toContain('"');
    // The exploded copy says Mumbai; the genuine key says Navi Mumbai. The
    // genuine key is the one that reaches the map.
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Navi Mumbai'),
    );
  });

  it('does not throw, and never reassembles the character keys', () => {
    expect(() => render({ address: NAVRANG })).not.toThrow();
    // "Maharashtra" is only present spelled out across keys "26".."37". If it
    // ever appears in the output, something has started guessing.
    expect(container.textContent).not.toContain('Maharashtra');
  });
});

describe('INC UK — a UK postcode in an Indian-PIN column', () => {
  it('renders every field as stored, without validating any of it', () => {
    const { text, link } = render({ address: INC_UK });
    expect(text.textContent).toContain('London, Bopal Circle');
    expect(text.textContent).toContain('Uganda, New York, NW1 245');
    expect(link.getAttribute('href')).toContain(encodeURIComponent('NW1 245'));
  });

  it('does not throw', () => {
    expect(() => render({ address: INC_UK })).not.toThrow();
  });
});

/* ── The seven-key vocabulary ──────────────────────────────────────────────── */

describe('state_code is resolved to a name and never printed', () => {
  it('resolves the GST code the way the employee record does', () => {
    // All 61 populated E2E clients look like this: a code and no state name.
    // "Ahmedabad, 24" reads as a house number.
    expect(addressLines(E2E_CLIENT)).toEqual(['4th Floor, Iscon Emporio', 'Ahmedabad, Gujarat']);
    const { text } = render({ address: E2E_CLIENT });
    expect(text.textContent).not.toContain('24');
  });

  it('prefers the typed state name when both are present', () => {
    expect(addressLines({ city: 'Surat', state: 'Gujarat', state_code: '27' }))
      .toEqual(['Surat, Gujarat']);
  });

  it('drops a code it cannot resolve rather than printing the digits', () => {
    expect(addressLines({ city: 'Surat', state_code: '88' })).toEqual(['Surat']);
    // 28 is pre-bifurcation Andhra Pradesh and is deliberately absent from the
    // statutory table — see the comment on GST_STATES.
    expect(addressLines({ city: 'Vijayawada', state_code: '28' })).toEqual(['Vijayawada']);
  });

  it('zero-pads a single-digit code', () => {
    expect(addressLines({ city: 'Chandigarh', state_code: '4' })).toEqual(['Chandigarh, Chandigarh']);
  });
});

describe('the double-encoded row', () => {
  it('decodes a jsonb column holding a JSON string of the object', () => {
    // backend/db.py:_json_encoder — ~120 call sites dumped before binding and a
    // codec dumped again. Navrang is what happens when a client then spreads it.
    const raw = JSON.stringify({ line1: 'A-12, Sector 5', city: 'Gandhinagar', state: 'Gujarat' });
    expect(addressLines(raw)).toEqual(['A-12, Sector 5', 'Gandhinagar, Gujarat']);
  });

  it('drops a string that opens like JSON and is not', () => {
    // Corruption, not an address somebody typed. Rendering it would print
    // literal braces into the map query.
    expect(addressLines('{"line1": "A-12", ')).toEqual([]);
    expect(mapsHref({ address: '{"line1": "A-12", ' })).toBe(null);
  });

  it('takes a plain text address as a single line', () => {
    // None of the six swept columns is `text`, so this is only reached by a
    // caller passing a column that has not been swept.
    expect(addressLines('Opp. Rajhans Cinema, Ring Road, Surat')).toEqual([
      'Opp. Rajhans Cinema, Ring Road, Surat',
    ]);
  });
});

/* ── The two layouts ───────────────────────────────────────────────────────── */

describe('layouts', () => {
  it('block carries its own label and splits street from locality', () => {
    const { block } = render({ address: INC_UK });
    expect(block.querySelector('.k-addr__lbl').textContent).toBe('Address');
    const lines = [...block.querySelectorAll('.k-addr__line')].map(n => n.textContent);
    expect(lines).toEqual(['London, Bopal Circle', 'Uganda, New York, NW1 245']);
  });

  it('block suppresses the label when the caller already has a heading', () => {
    // The Vikray "Ship to" section, which prints its own bilingual heading.
    const { block } = render({ address: INC_UK, label: '' });
    expect(block.querySelector('.k-addr__lbl')).toBe(null);
  });

  it('inline is one line of spans, for a cell or a key/value row', () => {
    // `rv-meta__v` in Pahchan and `mn-fact__v` in Manav are both inline
    // contexts; a <div> inside a <span> is invalid and sizes wrong.
    const { block, text } = render({ address: INC_UK, inline: true });
    expect(block.tagName).toBe('SPAN');
    expect(text.tagName).toBe('SPAN');
    expect(block.querySelector('div')).toBe(null);
    expect(text.textContent).toBe('London, Bopal Circle, Uganda, New York, NW1 245');
  });

  it('takes a caller-supplied link label', () => {
    const { link } = render({ address: E2E_CLIENT, linkLabel: 'Open in Maps ↗' });
    expect(link.textContent).toBe('Open in Maps ↗');
  });
});

describe('renderPincode · §8.2, without dragging a fetcher into six pages', () => {
  /* A RENDER PROP AND NOT AN IMPORT, and this block is what keeps it that way.
     `AddressBlock` is a `ui/` component on six pages that fetches nothing.
     Importing `PinAreaPopover` here would put a component that makes a network
     call into all six, so a screen could acquire a request it never asked for
     by rendering an address. */

  it('is byte-for-byte unchanged when no caller passes one', () => {
    // The whole safety of the refactor: `addressLines` now derives from
    // `addressParts`, and every existing call site must be untouched by that.
    const { text } = render({ address: INC_UK });
    expect(text.textContent).toBe('London, Bopal CircleUganda, New York, NW1 245');
  });

  it('replaces ONLY the pincode part, keeping the separators', () => {
    const { text } = render({
      address: { city: 'Surat', state: 'Gujarat', pincode: '395002' },
      renderPincode: pin => <b data-pin={pin}>{pin}</b>,
    });
    expect(text.textContent).toBe('Surat, Gujarat, 395002');
    const marked = text.querySelector('b');
    expect(marked, 'the pincode was not handed to renderPincode').toBeTruthy();
    expect(marked.getAttribute('data-pin')).toBe('395002');
    // And nothing else was: a city is not a pincode.
    expect(text.querySelectorAll('b').length).toBe(1);
  });

  it('does not split a city that contains a comma', () => {
    /* THE REASON THE PARTS ARE RENDERED AND NOT THE JOINED STRING. Splitting
       "Navi Mumbai, Thane, Maharashtra, 400706" back on ', ' puts the pincode
       in the right place by luck and the city in two — and gets it wrong
       invisibly, because the text still reads correctly. */
    const { text } = render({
      address: { city: 'Navi Mumbai, Thane', state: 'Maharashtra', pincode: '400706' },
      renderPincode: pin => <b>{pin}</b>,
    });
    expect(text.textContent).toBe('Navi Mumbai, Thane, Maharashtra, 400706');
    expect(text.querySelector('b').textContent).toBe('400706');
  });

  it('is BLOCK layout only — an inline cell grows no popover trigger', () => {
    // `inline` goes into table cells and `rv-meta__v` rows, where a trigger in
    // a dense grid is a click target nobody aimed at.
    const { text } = render({
      address: INC_UK, inline: true, renderPincode: () => <b>x</b>,
    });
    expect(text.querySelector('b')).toBe(null);
    expect(text.textContent).toBe('London, Bopal Circle, Uganda, New York, NW1 245');
  });

  it('renders the stored text when renderPincode declines the value', () => {
    // `PinAreaPopover` returns plain inert text for a non-PIN, but a caller may
    // return null outright. The address must not lose a field either way.
    const { text } = render({ address: INC_UK, renderPincode: () => null });
    expect(text.textContent).toContain('NW1 245');
  });
});
