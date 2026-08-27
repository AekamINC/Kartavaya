import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';
import '../../styles/address-suggest.css';

/**
 * AddressSuggest — an address line that offers Mappls suggestions as you type.
 *
 * Phase 7.6. The input half of the address block; `AddressBlock.jsx` is the
 * read half. This one is deliberately generic: Graha clients are the first
 * consumer, but Manav employees, Kray vendors, Vikray shipping addresses and a
 * Pahchan site all take an address, and none of them should have to reach into
 * the CRM for one.
 *
 * ── EVERY KEYSTROKE HAS TWO PRICES, AND THE SECOND ONE IS THE HIGH ONE ──────
 *
 * A call costs a hit against a Mappls allocation the console currently shows as
 * **200**. That is the price everyone thinks about.
 *
 * The other one: Mappls' published terms take a **perpetual, worldwide,
 * sub-licensable licence over content submitted to their servers**, and an
 * autosuggest call carrying a client's premises IS a submission (proposal 92
 * §6.3). Every request this component makes gives that fragment away for ever,
 * on our customer's behalf, and it cannot be taken back. Nothing about that is
 * visible at runtime — the dropdown works beautifully either way — so the
 * discipline has to be structural.
 *
 * Three structural rules, in the order they matter:
 *
 *   1. **THE SEARCH FIRES ONLY FROM A REAL INPUT EVENT.** There is no
 *      `useEffect` on `value`, and that absence is the design. The obvious
 *      implementation — debounce an effect on the current text — would fire on
 *      MOUNT, which means every form that opens an existing client would submit
 *      that client's stored address to Mappls just for being looked at. PHASE-7
 *      §7.6 names this: "do not fire it for already-saved addresses". An effect
 *      cannot tell a typed character from a loaded record; `onInput` can only
 *      ever be the former.
 *
 *   2. **NOTHING BUT THE FRAGMENT LEAVES.** The component takes no record, no
 *      id and no context prop. `GET /api/v1/maps/address/suggest?q=` carries
 *      one string. Do not add a `near=` from the client's saved city to improve
 *      the results: it would work, and it would license the saved city.
 *
 *   3. **THE RESULTS ARE NOT CACHED.** Their terms forbid caching "to avoid
 *      paying fees", so the usual per-query memo is not available to us as a
 *      cost lever. Results are dropped when the list closes. If volume bites,
 *      the levers are `DEBOUNCE_MS` and `MIN_CHARS` below — fewer calls, not
 *      remembered ones.
 *
 * ── NOT FOR THE PUBLIC INBOUND FORM ─────────────────────────────────────────
 *
 * The endpoint is behind `require_user`, so mounting this on the public lead
 * form would produce 401s rather than a leak — but the reason it must not be
 * mounted there is not that it would fail. It is that an anonymous person's own
 * address would be submitted to a third party, and licensed to them, by us,
 * without their knowledge. PHASE-7 §7.6.
 *
 * ── WHAT A PIN CAN AND CANNOT FILL ──────────────────────────────────────────
 *
 * The lede under the box is not decoration; PHASE-7 §7.6 asks for it by name.
 * The request was for the UK "type a postcode, get your address" flow and **it
 * does not transfer**: an Indian PIN averages ~82 km² against a UK postcode's
 * ~17 addresses, 1,229 of 18,839 PINs span more than one district, and 51 do
 * not resolve to a single state. A control that silently under-delivers on that
 * expectation reads as broken software rather than as a country's geography.
 *
 * ── THE CREDIT COMES FROM THE SERVER ────────────────────────────────────────
 *
 * "Powered by Mappls" must be "clearly presented" and may "in no instance" be
 * removed or hidden. It is rendered from the `attribution` field of the same
 * response that carried the suggestions — never as a string in this file — so
 * the content and the obligation it creates arrive together. The class is
 * `.terr__mapbrand`, the one `scripts/check-mappls-attribution.mjs` already
 * guards against being hidden by any stylesheet.
 *
 * ── NOTHING HERE VALIDATES ANYTHING ─────────────────────────────────────────
 *
 * Per the standing rule: a suggestion is an offer, never a constraint. The
 * typed text is always what the parent receives, whether or not it matches
 * anything Mappls knows. Unicode Group's `INC UK` has a PIN of `NW1 245`; it
 * must keep loading, editing and saving.
 */

/**
 * Below this we do not call at all.
 *
 * Two characters of an Indian address is a prefix of half the gazetteer — it
 * would spend a hit and a perpetual licence to say so. The backend enforces the
 * same number so that a caller bypassing this component cannot spend the
 * allocation two characters at a time; this copy exists so that the wasted
 * request is never made in the first place.
 */
const MIN_CHARS = 3;

/**
 * 350 ms, and the number is chosen against the licence, not against the feel.
 *
 * `ServerPicker` uses 250 ms for a LOCAL contact search, where a request costs
 * a database round trip and nothing else. Here every request is billable and
 * permanent, so the trade moves: 350 ms is comfortably longer than the ~120 ms
 * gap between characters of ordinary typing, which collapses a whole typed word
 * into one call, and it is still under the ~400 ms at which a suggestion list
 * starts to feel like it is lagging the cursor.
 *
 * Measured against the practical case: typing "Bopal Circle, Ahmedabad" costs
 * 3-6 calls with a pause or two, against ~23 with no debounce. That is the
 * difference between an allocation of 200 lasting a working week and lasting
 * forty addresses.
 *
 * **THIS IS THE COST LEVER.** A cache is not one — see rule (3) above. If
 * volume bites, raise this and `MIN_CHARS`.
 */
const DEBOUNCE_MS = 350;

/** The environment was never given a Mappls key. Not a fault. */
const NOT_CONFIGURED = 'not_configured';

export default function AddressSuggest({
  label = 'Address',
  value = '',
  placeholder = 'Start typing an address…',
  disabled = false,
  onChange,
  onSelect,
}) {
  // `useId` rather than a caller-supplied id: the label/input/listbox wiring is
  // this component's business, and two of these on one form must not collide.
  const uid = useId();
  const listId = `${uid}-list`;

  const [items, setItems] = useState([]);
  const [reason, setReason] = useState(null);
  const [credit, setCredit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const timer = useRef(null);
  const inflight = useRef(null);
  // Monotonic, so a slow answer to an old fragment can never overwrite a fast
  // answer to a newer one. Aborting the previous request is not sufficient on
  // its own: an abort that lands after the response has already been parsed
  // still leaves the stale `setItems` queued.
  const seq = useRef(0);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    if (inflight.current) inflight.current.abort();
    inflight.current = null;
  }, []);

  // Only on unmount. A pending timer that fires after the form closes would
  // spend a hit and a licence on a screen nobody is looking at.
  useEffect(() => cancel, [cancel]);

  const close = useCallback(() => {
    cancel();
    setOpen(false);
    setActive(-1);
    // The results are DROPPED, not kept for the next time the box is focused.
    // Keeping them would be a cache of Mappls content by another name, and the
    // terms forbid one. It also means a reopened box never shows answers to a
    // question the user has since edited.
    setItems([]);
    setBusy(false);
  }, [cancel]);

  /**
   * Ask the server. Reached ONLY from the input's change handler — see rule (1)
   * in the docblock. If you find yourself calling this from an effect, stop.
   */
  const search = useCallback(async (fragment) => {
    const mine = ++seq.current;
    const controller = new AbortController();
    inflight.current = controller;
    setBusy(true);
    try {
      const { data } = await api.get('/v1/maps/address/suggest', {
        params: { q: fragment },
        signal: controller.signal,
      });
      if (mine !== seq.current) return;
      setItems(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setReason(data?.reason ?? null);
      setCredit(data?.attribution
        ? { text: data.attribution, href: data.attribution_href }
        : null);
      setActive(-1);
      setOpen(true);
    } catch (err) {
      if (mine !== seq.current) return;
      // An abort is not a failure — it is us, cancelling a request the user
      // made obsolete. Reporting it as one would flash "we could not reach the
      // address service" on every fast typist's screen.
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      setItems([]);
      setReason('unavailable');
      setOpen(true);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, []);

  /**
   * The one door in. A character typed, pasted or dictated — and nothing else,
   * which is what guarantees a stored address is never submitted.
   */
  const handleInput = (event) => {
    const text = event.target.value;
    onChange?.(text);

    cancel();
    if (text.trim().length < MIN_CHARS) {
      // Not a call and not an error: nothing failed, we simply declined to
      // spend a hit on two characters. The list closes rather than showing an
      // empty state, because "no matches" would be a lie about a search that
      // never happened.
      setItems([]);
      setReason(null);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => search(text.trim()), DEBOUNCE_MS);
  };

  const choose = (item) => {
    // The parent receives the whole shaped suggestion — line1, city, state,
    // district, pincode — and decides which of its fields to fill. This
    // component owns one input and must not reach into a form it cannot see.
    onSelect?.(item);
    onChange?.(item.line1 || item.label);
    close();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Escape closes the list and leaves the typed text exactly as it is. It
      // never reverts: the user's own words outrank a suggestion.
      close();
      return;
    }
    if (!open || items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      // Only with a row actually highlighted. Swallowing a bare Enter would
      // stop the form being submitted from the keyboard, which is a worse bug
      // than the one it prevents.
      event.preventDefault();
      choose(items[active]);
    }
  };

  const status = busy ? 'Searching…'
    : reason === NOT_CONFIGURED ? 'Address lookup is not switched on in this environment.'
      : reason === 'unavailable' ? 'Could not reach the address service. Type the address as usual.'
        : items.length === 0 ? 'No matches. Type the address as usual.'
          : null;

  return (
    <div className="k-asug">
      <label className="k-label" htmlFor={uid}>{label}</label>
      <input
        id={uid}
        className="k-input k-asug__input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        // Blur is deferred one tick so a click on a suggestion lands before the
        // list unmounts underneath the pointer.
        onBlur={() => setTimeout(close, 120)}
      />
      {/* PHASE-7 §7.6 asks for this line by name. See the docblock. */}
      <p className="k-asug__lede">
        A PIN code covers ~82 km² on average and can span more than one district,
        so it narrows an address — it does not complete one.
      </p>
      {open && (
        <ul className="k-asug__list" id={listId} role="listbox" aria-label={label}>
          {status && <li className="k-asug__status" role="presentation">{status}</li>}
          {items.map((item, i) => (
            <li
              key={`${item.label}-${i}`}
              id={`${uid}-opt-${i}`}
              className="k-asug__opt"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              // `onMouseDown` rather than `onClick`: the input's blur fires
              // first on a click and would close the list before the click
              // resolved. This is the standard combobox ordering bug.
              onMouseDown={(e) => { e.preventDefault(); choose(item); }}
            >
              <span className="k-asug__optname">{item.label}</span>
              {item.line1 && <span className="k-asug__optaddr">{item.line1}</span>}
            </li>
          ))}
          {credit && (
            <li className="k-asug__foot" role="presentation">
              {/* The words come from the server response, never from a literal
                  here — see the docblock. */}
              <a className="terr__mapbrand" href={credit.href}
                 target="_blank" rel="noreferrer noopener">{credit.text}</a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
