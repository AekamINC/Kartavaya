/**
 * AddressSuggest — Phase 7.6, and the licence terms it has to obey.
 *
 * The interesting assertions here are not about the dropdown working. A
 * dropdown that does not work is a bug somebody reports within an hour. These
 * aim at the failures that are INVISIBLE at runtime, because Mappls' published
 * terms take a **perpetual, worldwide, sub-licensable licence over content
 * submitted to their servers** — so a request that should never have been made
 * costs a customer's data permanently while looking exactly like a request that
 * should have been.
 *
 *   1. **A SAVED ADDRESS SUBMITTED ON MOUNT.** The obvious implementation of a
 *      debounced autosuggest is a `useEffect` on the current text. It fires on
 *      mount, which means opening an existing client's record submits that
 *      client's stored premises to Mappls for being looked at. PHASE-7 §7.6:
 *      "do not fire it for already-saved addresses". This is the first test in
 *      the file and it is the reason the component has no such effect.
 *
 *   2. **A SECOND PARAMETER.** Nothing but the fragment may leave. The
 *      temptation is a `near=` built from the record's saved city, which would
 *      genuinely improve the results and would licence the saved city.
 *
 *   3. **A RESULTS CACHE.** Their terms forbid caching "to avoid paying fees",
 *      so the obvious cost lever against a 200-hit allocation is unavailable.
 *      Asserted by counting calls, not by reading source.
 *
 *   4. **A HARDCODED CREDIT.** "Powered by Mappls" must be "clearly presented"
 *      and may "in no instance" be removed. It is rendered from the server's
 *      response so the content and the obligation arrive together.
 *
 * Everything else — the debounce, the minimum length — is here because it is
 * what makes 200 hits last, and because both numbers are the only cost levers
 * this feature is allowed to have.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/* ── THE TRANSPORT IS THE SDK, NOT OUR BACKEND, AND THAT IS MEASURED ────────
   This suite used to mock `lib/api`, because 7.6 was a server-side proxy.
   It cannot be one: Mappls refuses our server-side calls with "Domain
   validation failed" — their host recognises our token as VALID and then
   denies it on domain grounds, while a garbage token gets `invalid_token`.
   And a browser `fetch` cannot replace it either: `atlas.mappls.com` sends no
   `Access-Control-Allow-Origin`, so every browser blocks the response before
   our code sees it. Both measured in a real browser on the whitelisted origin.

   What DOES work is the SDK's own `search`, which ships its own transport.
   So this mocks `lib/mapplsSdk` and asserts the OPTIONS OBJECT handed to
   `mappls.search` — which is where the licence rule now lives. */
const search = vi.fn();
const loadSearch = vi.fn(() => Promise.resolve({ search: (...a) => search(...a) }));
let loadResult = () => Promise.resolve({
  mappls: { search: (...a) => search(...a) },
  attribution: 'Powered by Mappls',
  attributionHref: 'https://www.mappls.com/',
  loadSearch,
});

vi.mock('../lib/mapplsSdk', () => ({
  MAP_OFF: 'not_configured',
  MAP_DOWN: 'unavailable',
  loadMappls: () => loadResult(),
}));

const { default: AddressSuggest } = await import('../components/ui/AddressSuggest');

/** What `mappls.search` really hands back — enumerated in a browser, not from
 *  the docs: there is NO city, state or pincode, only `placeAddress`. */
const RESULTS = [
  { type: 'POI', placeName: 'Bopal Circle, Ambli Road', eLoc: 'ABC123',
    placeAddress: 'Bopal, Ahmedabad, Gujarat, 380058', orderIndex: 1 },
  { type: 'POI', placeName: 'Bopal Cross Roads', eLoc: 'DEF456',
    placeAddress: 'S P Ring Road, Ahmedabad, Gujarat, 380058', orderIndex: 2 },
];

/** What `shapeSuggestions` makes of RESULTS[n] — line1 and a VALIDATED pincode
 *  only. City and state are deliberately empty: they are not in what Mappls
 *  returns, and `PincodeAutofill` fills them from our own government directory
 *  rather than from a guess at Mappls' comma string. */
const SHAPED = [
  { label: 'Bopal Circle, Ambli Road — Bopal, Ahmedabad, Gujarat, 380058',
    line1: 'Bopal Circle, Ambli Road', pincode: '380058',
    city: '', state: '', district: '' },
  { label: 'Bopal Cross Roads — S P Ring Road, Ahmedabad, Gujarat, 380058',
    line1: 'Bopal Cross Roads', pincode: '380058',
    city: '', state: '', district: '' },
];

/** The debounce, plus a margin. Longer than any number the component may use. */
const PAST_THE_DEBOUNCE = 600;

function type(text) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });
}

/** Advance past the debounce and let the mocked promise settle. */
async function settle(ms = PAST_THE_DEBOUNCE) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset();
  loadSearch.mockClear();
  loadResult = () => Promise.resolve({
    mappls: { search: (...a) => search(...a) },
    attribution: 'Powered by Mappls',
    attributionHref: 'https://www.mappls.com/',
    loadSearch,
  });
  // The SDK is callback-based: second argument, called with the raw list.
  search.mockImplementation((opts, cb) => cb(RESULTS));
});

afterEach(() => {
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
//  1 · THE LICENCE. What we send, we give away.
// ══════════════════════════════════════════════════════════════════════════════

describe('nothing is submitted that the user did not just type', () => {
  it('does not call Mappls when a saved address is loaded into the field', async () => {
    // THE TEST THIS FILE EXISTS FOR.
    //
    // Every form that edits an existing client mounts this with the stored
    // address already in `value`. If the component searched for what it holds
    // rather than for what was typed, merely OPENING a client record would
    // submit that client's premises to a third party and license them in
    // perpetuity — silently, on every open, for every client in the book.
    render(<AddressSuggest value="Bopal Circle, Ambli Road, Ahmedabad 380058" />);
    await settle();

    expect(search).not.toHaveBeenCalled();
  });

  it('does not call Mappls when the saved value is replaced by a prop change', async () => {
    // The same rule under a re-render. A parent that swaps to another client
    // pushes a second stored address in through `value`; an effect watching
    // that prop would submit this one too. The component must react to input
    // events and to nothing else.
    const { rerender } = render(<AddressSuggest value="First stored address" />);
    rerender(<AddressSuggest value="A different client's stored address" />);
    await settle();

    expect(search).not.toHaveBeenCalled();
  });

  it('sends the fragment and nothing else', async () => {
    // Positively AND negatively. The way this rule breaks is not somebody
    // sending the record instead of the fragment — it is somebody sending the
    // record AS WELL, in a `near=` or a `client_id=` added to sharpen results.
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();

    expect(search).toHaveBeenCalledTimes(1);
    const [opts] = search.mock.calls[0];
    // EXACTLY one key. `mappls.search` accepts `location`, `bounds`, `filter`
    // and more, and every one of them would be built from the record being
    // edited — which is the realistic breakage: not sending the stored address
    // INSTEAD of the fragment, but sending it AS WELL, to sharpen results.
    expect(Object.keys(opts)).toEqual(['query']);
    expect(opts.query).toBe('Bopal Circle');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2 · THE TWO COST LEVERS, WHICH ARE THE ONLY ONES ALLOWED
// ══════════════════════════════════════════════════════════════════════════════

describe('a keystroke is not a request', () => {
  it('collapses a typed word into ONE call', async () => {
    // Without a debounce, "Bopal Circle" is twelve calls: twelve billable hits
    // against an allocation of 200, and twelve submissions under the licence.
    render(<AddressSuggest value="" />);
    for (const t of ['Bop', 'Bopa', 'Bopal', 'Bopal ', 'Bopal C', 'Bopal Ci',
                     'Bopal Cir', 'Bopal Circ', 'Bopal Circl', 'Bopal Circle']) {
      type(t);
      await act(async () => { vi.advanceTimersByTime(80); });
    }
    await settle();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].query).toBe('Bopal Circle');
  });

  it('sends nothing below the minimum length', async () => {
    // Two characters of an Indian address is a prefix of half the gazetteer. A
    // call would spend a hit and a perpetual licence to say so.
    render(<AddressSuggest value="" />);
    for (const t of ['B', 'Bo', '  ', ' a ']) {
      type(t);
      await settle();
    }

    expect(search).not.toHaveBeenCalled();
  });

  it('does not cache: the same fragment twice is two calls', async () => {
    // Mappls' terms forbid caching "to avoid paying fees", so the obvious
    // optimisation is not available to us. Counted rather than grepped for, so
    // a memo anywhere in the path fails this however it is spelled.
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();
    type('Bop');
    await settle();
    type('Bopal Circle');
    await settle();

    expect(search.mock.calls.filter(c => c[0].query === 'Bopal Circle')).toHaveLength(2);
  });

  it('makes no request after the field unmounts', async () => {
    // A pending timer that fires after the drawer closes spends a hit and a
    // licence on a screen nobody is looking at.
    const { unmount } = render(<AddressSuggest value="" />);
    type('Bopal Circle');
    unmount();
    await settle();

    expect(search).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3 · THE CREDIT
// ══════════════════════════════════════════════════════════════════════════════

describe('attribution', () => {
  it('renders the credit the server sent, on the class the gate guards', async () => {
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();

    const credit = document.querySelector('.terr__mapbrand');
    expect(credit).not.toBeNull();
    expect(credit.textContent).toBe('Powered by Mappls');
    expect(credit.getAttribute('href')).toBe('https://www.mappls.com/');
  });

  it('takes the words from the response rather than a literal in the component', async () => {
    // If the credit were hardcoded it would still read "Powered by Mappls"
    // here and the test would pass while proving nothing. Changing what the
    // server sends is the only way to tell the two apart.
    loadResult = () => Promise.resolve({
      mappls: { search: (...a) => search(...a) },
      attribution: 'Powered by Mappls (renamed)',
      attributionHref: 'https://example.invalid/',
      loadSearch,
    });
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();

    expect(document.querySelector('.terr__mapbrand').textContent)
      .toBe('Powered by Mappls (renamed)');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  4 · FOUR OUTCOMES, FOUR SENTENCES
// ══════════════════════════════════════════════════════════════════════════════

describe('the states are never merged', () => {
  it('offers what Mappls returned', async () => {
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();

    expect(screen.getAllByRole('option')).toHaveLength(2);
    // `getAllByText`: the label appears in the option AND in the live region
    // that announces the highlighted row to a screen reader. Two nodes is
    // correct here; `getByText` would fail on the a11y wiring, not on the data.
    expect(screen.getAllByText(/Bopal Circle, Ambli Road/).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText(/Bopal Cross Roads/).length).toBeGreaterThan(0);
    expect(screen.getByText('Bopal Circle, Ambli Road')).toBeTruthy();
  });

  it('says the environment has no key WITHOUT calling it a failure', async () => {
    // A local checkout and every preview deploy are in this state. Telling the
    // user the address service is down sends them to file a fault against
    // working software.
    // The loader throws `MapUnavailable` with `.reason`; it no longer arrives
    // as a field on a 200 body, because there is no proxy in the path.
    loadResult = () => Promise.reject(
      Object.assign(new Error('off'), { reason: 'not_configured' }));
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();

    expect(screen.getByText(/not switched on/i)).toBeTruthy();
    expect(screen.queryByText(/could not reach/i)).toBeNull();
  });

  it('says the service could not be reached when it could not', async () => {
    loadResult = () => Promise.reject(
      Object.assign(new Error('down'), { reason: 'unavailable' }));
    render(<AddressSuggest value="" />);
    type('Bopal Circle');
    await settle();

    expect(screen.getByText(/could not reach/i)).toBeTruthy();
    expect(screen.queryByText(/not switched on/i)).toBeNull();
  });

  it('says "no matches" only when Mappls actually looked and found none', async () => {
    // An Indian PIN averages ~82 km² and plenty of real premises are in no
    // gazetteer. "We looked and found nothing" is a legitimate answer and must
    // read differently from "we could not look".
    search.mockImplementation((opts, cb) => cb([]));
    render(<AddressSuggest value="" />);
    type('Nowhere In Particular');
    await settle();

    expect(screen.getByText(/no matches/i)).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  5 · CHOOSING, AND NEVER CONSTRAINING
// ══════════════════════════════════════════════════════════════════════════════

describe('a suggestion is an offer, not a constraint', () => {
  it('hands the parent the whole shaped suggestion', async () => {
    // The parent owns the form and decides which fields to fill. This component
    // owns one input and must not reach into a form it cannot see.
    const onSelect = vi.fn();
    const onChange = vi.fn();
    render(<AddressSuggest value="" onSelect={onSelect} onChange={onChange} />);
    type('Bopal Circle');
    await settle();
    fireEvent.mouseDown(screen.getAllByRole('option')[0]);

    expect(onSelect).toHaveBeenCalledWith(SHAPED[0]);
    // `eLoc` — Mappls' own primary key for a place — must NOT reach the parent.
    // Stored in a customer's row it becomes a hard dependency the first thing
    // that joins on it cannot undo.
    expect(Object.keys(onSelect.mock.calls[0][0])).not.toContain('eLoc');
    expect(onChange).toHaveBeenLastCalledWith('Bopal Circle, Ambli Road');
  });

  it('keeps the typed text when the list is dismissed', async () => {
    // Unicode Group's `INC UK` has a PIN of `NW1 245` and no suggestion will
    // ever match it. Escape must leave what the user wrote exactly as written —
    // the standing rule is that this validates nothing and blocks nothing.
    const onChange = vi.fn();
    render(<AddressSuggest value="" onChange={onChange} />);
    type('NW1 245, London');
    await settle();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('NW1 245, London');
  });

  it('arrows through the list and picks the highlighted row with Enter', async () => {
    const onSelect = vi.fn();
    render(<AddressSuggest value="" onSelect={onSelect} />);
    type('Bopal Circle');
    await settle();
    const box = screen.getByRole('combobox');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(SHAPED[1]);
  });

  it('lets a bare Enter through when no row is highlighted', async () => {
    // Swallowing Enter would stop the form being submitted from the keyboard,
    // which is a worse defect than the one it prevents.
    const onSelect = vi.fn();
    render(<AddressSuggest value="" onSelect={onSelect} />);
    type('Bopal Circle');
    await settle();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    screen.getByRole('combobox').dispatchEvent(event);

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  6 · THE EXPECTATION TO RESET
// ══════════════════════════════════════════════════════════════════════════════

it('states what a PIN can and cannot fill, before anyone types', () => {
  // PHASE-7 §7.6 asks for this line by name. The owner asked for the UK "type a
  // postcode, get your address" flow and it does not transfer: an Indian PIN
  // averages ~82 km² against a UK postcode's ~17 addresses. Without the lede
  // the control reads as broken software rather than as a country's geography.
  render(<AddressSuggest value="" />);

  expect(screen.getByText(/does not complete one/i)).toBeTruthy();
});
