/**
 * The pincode directory hint. Phase 7.6, the half that needs no vendor.
 *
 * ── What this defends ───────────────────────────────────────────────────────
 *
 * 1. A DISTRICT IS NOT A CITY. `395002` is in SURAT district and the city may
 *    well be Surat — but `400706` is in THANE district and the city is Navi
 *    Mumbai, which the live `Navrang Polymers` row says in as many words.
 *    Writing a district into a `city` box puts a confident wrong answer into a
 *    customer's record, so the district is SHOWN and never written.
 *
 * 2. A PIN IS NOT ONE PLACE. 1,229 PINs span two or more districts and 51 span
 *    two or more STATES. When the directory returns more than one row, nothing
 *    is filled and every candidate is named — picking the first would answer a
 *    two-answer question with one, for ever, invisibly.
 *
 * 3. NOTHING IS WRITTEN WITHOUT A PRESS. The fill is a button, not an effect.
 *    A form that rewrote a state while somebody was typing would be the same
 *    failure as a suggestion that blanks a field, and worse, because it looks
 *    right.
 *
 * 4. IT BLOCKS NOTHING. A pincode the directory does not list is ordinary —
 *    531 PINs with a published boundary are absent from this release — and it
 *    must never read as "no such pincode" or stop a save. Same owner rule that
 *    makes GSTIN/PAN/TAN non-mandatory.
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

const { default: PincodeAutofill, isPin } =
  await import('../components/ui/PincodeAutofill');

const SURAT = { state: 'GUJARAT', district: 'SURAT' };

function answer(directory) {
  return { data: { pincode: '395002', valid: true, directory,
    boundary: null, boundary_status: 'unmatched',
    vintage: 'datagov-2025-05', attribution: 'GODL-India' } };
}

let host, root;

beforeEach(() => {
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

async function render(props) {
  await act(async () => { root.render(<PincodeAutofill {...props} />); });
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

const text = () => host.textContent;
const button = () => host.querySelector('button');

describe('isPin · one definition, the server\'s', () => {
  it('is `^[1-9][0-9]{5}$` after a trim and nothing else', () => {
    expect(isPin('395002')).toBe(true);
    expect(isPin('  395002 ')).toBe(true);
    expect(isPin('095002')).toBe(false);   // a PIN never starts zero
    expect(isPin('39500')).toBe(false);
    expect(isPin('395 002')).toBe(false);
    expect(isPin('NW1 245')).toBe(false);  // live, on Unicode's `INC UK`
    expect(isPin('')).toBe(false);
  });
});

describe('it asks nobody until there is a pincode to ask about', () => {
  it('renders nothing and fetches nothing for a non-PIN', async () => {
    await render({ pincode: 'NW1 245' });
    expect(host.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('renders nothing and fetches nothing for a blank', async () => {
    await render({ pincode: '' });
    expect(host.textContent).toBe('');
    expect(get).not.toHaveBeenCalled();
  });

  it('asks OUR endpoint, and no vendor', async () => {
    get.mockResolvedValue(answer([SURAT]));
    await render({ pincode: '395002' });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/v1/pincodes/395002');
  });
});

describe('a district is NOT a city', () => {
  it('names the district but fills only the STATE', async () => {
    get.mockResolvedValue(answer([{ state: 'MAHARASHTRA', district: 'THANE' }]));
    const onFill = vi.fn();
    await render({ pincode: '400706', state: '', onFill });

    expect(text()).toContain('THANE');
    await act(async () => {
      button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // THE ASSERTION THIS COMPONENT EXISTS FOR. 400706 is THANE district and
    // the city is Navi Mumbai — the live Navrang Polymers row. A `city` key
    // here would write a confident wrong answer into a customer's record.
    expect(onFill).toHaveBeenCalledWith({ state: 'MAHARASHTRA' });
    expect(Object.keys(onFill.mock.calls[0][0])).toEqual(['state']);
  });
});

describe('a PIN is not one place', () => {
  it('fills NOTHING and names both when a PIN spans two districts', async () => {
    // `110020` is genuinely both SOUTH DELHI and SOUTH EAST DELHI.
    get.mockResolvedValue(answer([
      { state: 'DELHI', district: 'SOUTH' },
      { state: 'DELHI', district: 'SOUTH EAST' },
    ]));
    await render({ pincode: '110020', state: '' });

    expect(text()).toContain('SOUTH, DELHI');
    expect(text()).toContain('SOUTH EAST, DELHI');
    expect(text()).toMatch(/spans 2 districts/);
    expect(button(), 'a fill was offered for an ambiguous pincode').toBeNull();
  });
});

describe('nothing is written without a press', () => {
  it('does not call onFill merely by looking a pincode up', async () => {
    get.mockResolvedValue(answer([SURAT]));
    const onFill = vi.fn();
    await render({ pincode: '395002', state: '', onFill });
    expect(onFill).not.toHaveBeenCalled();
  });

  it('offers nothing when the state already agrees', async () => {
    get.mockResolvedValue(answer([SURAT]));
    await render({ pincode: '395002', state: 'Gujarat' });
    expect(text()).toMatch(/already set/i);
    expect(button()).toBeNull();
  });
});

describe('it blocks nothing, and says so', () => {
  it('treats an unlisted pincode as ordinary', async () => {
    get.mockResolvedValue(answer([]));
    await render({ pincode: '999999' });
    expect(text()).toMatch(/does not list a district/i);
    expect(text()).toMatch(/saves either way/i);
    // Never "no such pincode".
    expect(text()).not.toMatch(/no such|invalid|not a valid/i);
  });

  it('says we could not read it, without blaming the pincode', async () => {
    get.mockRejectedValue(new Error('network'));
    await render({ pincode: '395002' });
    expect(text()).toMatch(/could not be read just now/i);
    expect(text()).toMatch(/does not stop you/i);
  });
});

describe('the credit rides along', () => {
  it('names the source, like every other data response in this product', async () => {
    get.mockResolvedValue(answer([SURAT]));
    await render({ pincode: '395002', state: '' });
    expect(text()).toMatch(/Government of India/);
  });
});
