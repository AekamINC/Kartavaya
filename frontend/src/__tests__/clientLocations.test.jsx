/**
 * ClientLocations — Phase 8.3, pinned against the rows that are actually in the
 * database rather than against the DDL.
 *
 * Every fixture below is a live row, copied from a read-only probe of
 * `staging.graha_clients` run on 2026-08-27, not a shape somebody imagined:
 *
 *   Navrang Polymers   Unicode Group. 43 keys — "0".."41" spell
 *                      `{"city": "Mumbai", "state": "Maharashtra"}` one
 *                      character per key, plus a 43rd genuine `city` of "Navi
 *                      Mumbai" that contradicts the exploded copy.
 *   INC UK             Unicode Group. `pincode: "NW1 245"`, `city: "Uganda"`,
 *                      `state: "New York"`. Incoherent in every field.
 *   `{}`               five Unicode companies. The column is `jsonb NOT NULL`,
 *                      so an `if (!address)` guard passes on EVERY row in the
 *                      table and measures nothing at all. This is the trap the
 *                      whole suite is built around, and it is asserted rather
 *                      than assumed.
 *   state_code only    all 30 populated E2E companies carry `state_code` and
 *                      never `state`. Printing the code raw groups companies
 *                      under "24" and "27".
 *
 * The point of the component is that it cannot overstate its coverage, so the
 * assertions are mostly about the DENOMINATOR and about what is reported as
 * missing. A test that only checked the placed companies would have passed on
 * a component that silently dropped the other seven.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ClientLocations, { placeOf } from '../components/ClientLocations';

/** The two Unicode specimens, exactly as stored. */
const NAVRANG_ADDRESS = JSON.parse(
  '{"0":"{","1":"\\"","2":"c","3":"i","4":"t","5":"y","6":"\\"","7":":","8":" ",'
  + '"9":"\\"","10":"M","11":"u","12":"m","13":"b","14":"a","15":"i","16":"\\"",'
  + '"17":",","18":" ","19":"\\"","20":"s","21":"t","22":"a","23":"t","24":"e",'
  + '"25":"\\"","26":":","27":" ","28":"\\"","29":"M","30":"a","31":"h","32":"a",'
  + '"33":"r","34":"a","35":"s","36":"h","37":"t","38":"r","39":"a","40":"\\"",'
  + '"41":"}","city":"Navi Mumbai"}',
);

const INC_UK_ADDRESS = {
  city: 'Uganda', line1: 'London', line2: 'Bopal Circle',
  state: 'New York', pincode: 'NW1 245',
};

const text = () => document.body.textContent;

describe('placeOf · reads the keys we know, and never reassembles anything', () => {
  it('reads Navrang Polymers by NAME — the real city, not the 42 characters', () => {
    const p = placeOf(NAVRANG_ADDRESS);
    // The genuine key wins. The exploded copy says "Mumbai"; the real key says
    // "Navi Mumbai" and it is the one that is read.
    expect(p.city).toBe('Navi Mumbai');
    expect(p.pin).toBe('');
    expect(p.hasText).toBe(true);
    // Nothing anywhere reconstructs the character keys into a string.
    expect(p.state).toBe('');
  });

  it('an empty object is EMPTY — the test a null check cannot make', () => {
    // `address` is `jsonb NOT NULL`: `!address` is false for every row in the
    // table, including this one, which is the whole reason this assertion is
    // here rather than a `toBeNull`.
    expect({} == null).toBe(false);
    const p = placeOf({});
    expect(p.hasText).toBe(false);
    expect(p.pin).toBe('');
    expect(p.city).toBe('');
  });

  it('keeps a non-Indian pincode as stored, and refuses to call it a pin', () => {
    const p = placeOf(INC_UK_ADDRESS);
    expect(p.pin).toBe('');
    expect(p.pinRaw).toBe('NW1 245');
  });

  it('resolves a GST state_code to the state NAME, never the digits', () => {
    // The E2E shape: line1 + city + state_code, no `state`, no `pincode`.
    const p = placeOf({ line1: 'Unit 4', city: 'Ahmedabad', state_code: '24' });
    expect(p.state).toBe('Gujarat');
    expect(p.state).not.toBe('24');
  });

  it('decodes an address stored as a JSON string', () => {
    const p = placeOf('{"city":"Surat","state":"Gujarat","pincode":"395002"}');
    expect(p.pin).toBe('395002');
    expect(p.city).toBe('Surat');
  });

  it('a five-digit or seven-digit value is not a pincode', () => {
    expect(placeOf({ pincode: '38005' }).pin).toBe('');
    expect(placeOf({ pincode: '3800581' }).pin).toBe('');
    expect(placeOf({ pincode: '380058' }).pin).toBe('380058');
  });
});

describe('ClientLocations · the denominator is never optional', () => {
  /** The Unicode Group shape, in miniature and in the same proportions. */
  const UNICODE = [
    { name: 'Kalpataru Realty', address: { city: 'Ahmedabad', state: 'Gujarat', pincode: '380058' } },
    { name: 'Sanchay Finserv', address: { city: 'Ahmedabad', state: 'Gujarat', pincode: '380058' } },
    { name: 'Aarna Textile Mills Pvt Ltd', address: { city: 'Surat', state: 'Gujarat', pincode: '395002' } },
    { name: 'Navrang Polymers', address: NAVRANG_ADDRESS },
    { name: 'INC UK', address: INC_UK_ADDRESS },
    { name: 'Blank One', address: {} },
    { name: 'Blank Two', address: {} },
  ];

  it('states how many of the total are placed, and how many are not', () => {
    render(<ClientLocations clients={UNICODE} />);
    const lead = screen.getByRole('status');
    // 3 of 7 by pincode, in 2 areas.
    expect(lead.textContent).toMatch(/3\s*of\s*7\s*companies listed here carry a pincode/);
    expect(lead.textContent).toMatch(/2\s*pincode\s*areas/);
    // Navrang has a town only; INC UK and the two blanks are not placed.
    expect(lead.textContent).toMatch(/Another\s*1\s*has a town or a state/);
    expect(lead.textContent).toMatch(/3\s*are not placed at all/);
  });

  it('groups by pincode, biggest first, and names the companies in each', () => {
    render(<ClientLocations clients={UNICODE} />);
    expect(text()).toContain('380058');
    expect(text()).toContain('395002');
    expect(text()).toContain('Kalpataru Realty and Sanchay Finserv');
  });

  it('never renders the exploded key characters as an address', () => {
    render(<ClientLocations clients={UNICODE} />);
    // Navrang is placed by its REAL city and nothing reassembles "0".."41".
    expect(text()).toContain('Navi Mumbai');
    // "Maharashtra" exists ONLY inside the 42 character keys. It can reach the
    // screen by exactly one route — something joined the values back into a
    // string — and no other fixture in this file mentions it, so its presence
    // is proof of a reassembly and not a coincidence.
    expect(text()).not.toContain('Maharashtra');
    expect(text()).not.toContain('"city"');
  });

  it('reports the non-Indian pincode as stored, and does not correct it', () => {
    render(<ClientLocations clients={UNICODE} />);
    expect(text()).toContain('NW1 245');
    expect(text()).toMatch(/not a six-digit Indian pincode/);
    // And it is NOT in the placed set.
    expect(screen.getByRole('status').textContent)
      .not.toMatch(/4\s*of\s*7/);
  });

  it('says out loud that two companies have no address at all', () => {
    render(<ClientLocations clients={UNICODE} />);
    expect(text()).toMatch(/2 companies have no address stored at all: Blank One and Blank Two/);
  });

  it('carries the ~82 km² caveat, so a pincode is never read as an address', () => {
    render(<ClientLocations clients={UNICODE} />);
    expect(text()).toMatch(/82 km/);
    expect(text()).toMatch(/never its building/);
  });

  it('links a PIN AREA, never a named company street address', () => {
    render(<ClientLocations clients={UNICODE} />);
    const links = [...document.querySelectorAll('a.clm__go')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      // §8.0's first acceptance clause: never a link to an empty query, which
      // opens Google Maps on the READER's own location and looks exactly like
      // the product having found the client.
      expect(a.getAttribute('href')).not.toMatch(/query=($|&)/);
      // No street line and no company name may travel to Google.
      expect(a.getAttribute('href')).not.toMatch(/Kalpataru|Bopal|London/i);
      expect(a.getAttribute('rel')).toContain('noreferrer');
    }
    // The unanimous state rides along; a name never does.
    expect(links[0].getAttribute('href')).toContain('380058');
  });
});

describe('ClientLocations · the org where the honest answer is "none"', () => {
  /** E2E Test & Associates: 61 companies, 0 pincodes. Measured 2026-08-27. */
  const E2E = [
    { name: 'Alpha Traders', address: { line1: 'Unit 4', city: 'Ahmedabad', state_code: '24' } },
    { name: 'Beta Mills', address: { line1: 'Plot 9', city: 'Ahmedabad', state_code: '24' } },
    { name: 'Gamma Exports', address: { line1: 'Shed 2' } },
  ];

  it('says none of them can be placed rather than showing a near-empty map', () => {
    render(<ClientLocations clients={E2E} />);
    const lead = screen.getByRole('status');
    expect(lead.textContent)
      .toMatch(/None of the\s*3\s*companies listed here carries a pincode/);
    expect(lead.textContent).toMatch(/Another\s*2\s*have a town or a state/);
    expect(lead.textContent).toMatch(/1\s*is not placed at all/);
  });

  it('groups the town-only companies under the state NAME, not the GST code', () => {
    render(<ClientLocations clients={E2E} />);
    expect(text()).toContain('Ahmedabad, Gujarat');
    expect(text()).not.toContain('Ahmedabad, 24');
  });

  it('separates "a street line and nothing else" from "no address at all"', () => {
    render(<ClientLocations clients={E2E} />);
    // Gamma has line1 only: it is unplaceable, but it is a DIFFERENT problem
    // from an empty column and the two must not be merged into one number.
    expect(text()).toMatch(/1 company has a street line but no town, state or pincode/);
    expect(text()).toContain('Gamma Exports');
    expect(text()).not.toMatch(/no address stored at all/);
  });
});

describe('ClientLocations · the id rule and the empty case', () => {
  it('renders nothing at all when there are no companies', () => {
    const { container } = render(<ClientLocations clients={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('never renders an id, even when the row carries one', () => {
    const id = '64e7bea6-6abe-490c-a2a4-27a60c6be916';
    render(<ClientLocations clients={[{ id, name: 'Kalpataru Realty', address: { pincode: '380058' } }]} />);
    const region = screen.getByLabelText('Where these companies are');
    expect(within(region).queryByText(new RegExp(id, 'i'))).toBeNull();
    expect(document.body.innerHTML).not.toContain(id);
  });
});
