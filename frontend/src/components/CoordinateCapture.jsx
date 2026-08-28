/**
 * CoordinateCapture — the "drop a pin" affordance. Phase 8.4.
 *
 * ── DELIBERATELY LAST, BECAUSE IT IS THE ONLY STEP THAT CREATES AN OBLIGATION ─
 *
 * 8.0 through 8.3 are reversible: they read what is already stored and draw it.
 * This one WRITES a coordinate, and a stored coordinate is a commitment — to a
 * retention rule, to a vendor's terms, and to a DPDP answer about a place.
 * `docs/plans/PHASE-8-maps-across-modules.md` §8.4 puts it last for that reason
 * and this component is built to match:
 *
 *   · nothing is captured as a SIDE EFFECT of opening a record. There is no
 *     view-time geocode and no `useEffect` that resolves an address to a point.
 *     A coordinate appears because a person pressed a button, and the button
 *     says what it will do.
 *   · every write carries its PROVENANCE. `geo_source` is chosen by the action
 *     the user took — dropping a pin is `user_pin`, the device's own
 *     Geolocation API is `device_gps`, typed decimals are `manual_entry` — and
 *     is never guessed. Migration 237's `*_geo_complete_ck` makes the bare pair
 *     unrepresentable, so a screen that forgot to send one gets a 400 rather
 *     than a row nobody can later account for.
 *   · `geo_fetched_at` is NOT sent. It is stamped `NOW()` by the database, and
 *     `CoordinateWrite` has no field for it, because a caller-supplied
 *     timestamp would let a 30-day retention rule be reset by the thing it
 *     constrains.
 *
 * ── THE DIGIPIN COMES FROM THE SERVER, AND THAT IS THE WHOLE POINT ──────────
 *
 * DIGIPIN is India Post's ~4 m grid code and it is pure arithmetic — no vendor,
 * no API call, no key. So it COULD be computed here, and that is exactly the
 * trap: two implementations of a ten-level grid traversal drift at the last
 * symbol or two while agreeing perfectly at level 6, so the divergence appears
 * as two systems naming neighbouring 4 m cells rather than as anything that
 * looks like a bug. `backend/services/digipin.py` is checked symbol-for-symbol
 * against India Post's own reference implementation over 20,000 coordinates;
 * serving the result keeps that the only implementation in the product, and
 * `test_client_coordinates.py` fails if a `digipin` module appears under
 * `frontend/src`.
 *
 * `null` is a real answer: the grid covers lat 2.5–38.5, lng 63.5–99.5, and a
 * coordinate outside it has no DIGIPIN at all.
 *
 * ── PERSONAL DATA ───────────────────────────────────────────────────────────
 *
 * A coordinate beside a named person or company is personal data under the
 * DPDP Act. So: nothing is logged, ever — not `console.log`, not behind a debug
 * guard, because a coordinate written to a console is a coordinate in somebody's
 * session recording. No coordinate goes in a query string; the write is a body
 * on a PUT. The record id travels in the URL and is never rendered
 * (`check-rendered-ids.mjs`) — what labels the point on screen is its NAME.
 *
 * ── IT WORKS WITH NO BASEMAP ────────────────────────────────────────────────
 *
 * `PointRadiusMap` already reads a coordinate back in words — hemispheres
 * spelled out, because `18.93` and `-18.93` are one keystroke apart and land
 * 4,200 km apart; whether the point is in India; and whether SWAPPING the two
 * numbers would put it there, which is the specific typo no validator in this
 * product rejects. All of that is true with no tiles, so this component reuses
 * it rather than growing a second opinion about what a coordinate means.
 */
import React, { useCallback, useState } from 'react';
import { api, body } from '../lib/api';
import PointRadiusMap from './PointRadiusMap';
import useModuleWrite from '../hooks/useModuleWrite';

/** The five `geo_source` values migration 237's CHECK allows.
 *
 * Only three are offered here, and the omissions are deliberate:
 * `google_places` carries a 30-day cache limit under Google's terms and this
 * product has no Google geocode path to produce one; `import` describes a bulk
 * load, not something a person does on a detail screen. Offering either would
 * let a user label a coordinate with a provenance the action did not have.
 *
 * ⚠ THERE IS NO MAPPLS VALUE AND NONE MAY BE ADDED. Mappls forbids caching a
 * geocode result, so a Mappls-derived coordinate has no lawful home in this
 * database — the database refuses it, and this list is the same rule stated
 * where a person can read it.
 */
const SOURCES = [
  { value: 'user_pin', label: 'I placed it on the map' },
  { value: 'device_gps', label: "This device's location" },
  { value: 'manual_entry', label: 'Typed from a survey or deed' },
];

/** A decimal-degree string a person typed, or null. Never `Number('')` — which
 *  is 0, and 0,0 is Null Island in the Gulf of Guinea. */
function degrees(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function CoordinateCapture({
  kind,                 // 'clients' | 'contacts' — the route segment
  recordId,
  name,                 // what labels the point. NEVER the id.
  lat = null,
  lng = null,
  geoSource = null,
  digipin = null,
  onChange = () => {},
}) {
  /* THE PERMISSION IS THIS COMPONENT'S, NOT ITS CALLER'S.
     `canWrite` began life as a prop threaded down from `ClientsTab`, and
     `check-write-gates.mjs` refused it — correctly. That gate exists because a
     control gated on a `canWrite` its own scope does not declare is a
     ReferenceError at RENDER: the screen white-screens the first time somebody
     opens it, and nothing at build time says so. Asking here means the answer
     cannot drift from the control it guards, and a second caller (contacts,
     and later Manav or Kray) cannot mount this with the gate left off. */
  const { canWrite, reason: denial } = useModuleWrite({
    label: 'change CRM settings',
  });
  const [open, setOpen] = useState(false);
  const [latText, setLatText] = useState(lat == null ? '' : String(lat));
  const [lngText, setLngText] = useState(lng == null ? '' : String(lng));
  const [source, setSource] = useState('user_pin');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const has = lat != null && lng != null;

  const save = useCallback(async () => {
    const la = degrees(latText);
    const ln = degrees(lngText);
    if (la === null || ln === null) {
      setErr('Both a latitude and a longitude are needed — a half-coordinate '
        + 'is not a location.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      // `geo_source` travels with the pair, always. The server refuses a bare
      // pair and so does the database; sending it here is not belt-and-braces,
      // it is the only shape the write has.
      const r = body(await api.put(`/v1/graha/${kind}/${recordId}/coordinate`, {
        lat: la, lng: ln, geo_source: source,
      }));
      onChange({
        lat: r.lat, lng: r.lng, geo_source: r.geo_source,
        geo_fetched_at: r.geo_fetched_at, digipin: r.digipin,
      });
      setOpen(false);
    } catch (e) {
      // The server's sentence, not ours: it distinguishes "not one of these
      // five sources", "must be a finite number", a range, and Null Island,
      // and each of those tells the person something different to do.
      setErr(e?.response?.data?.detail || 'The coordinate could not be saved.');
    } finally {
      setBusy(false);
    }
  }, [kind, recordId, latText, lngText, source, onChange]);

  const clear = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      // All four columns null together — the route does that in one statement
      // because `*_geo_complete_ck` refuses a half-cleared row, so a
      // coordinate can never outlive the provenance that accounted for it.
      await api.delete(`/v1/graha/${kind}/${recordId}/coordinate`);
      onChange({ lat: null, lng: null, geo_source: null,
        geo_fetched_at: null, digipin: null });
      setLatText('');
      setLngText('');
      setOpen(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'The coordinate could not be removed.');
    } finally {
      setBusy(false);
    }
  }, [kind, recordId, onChange]);

  /** The device's own Geolocation API — the user's hardware, not a vendor's
   *  database, so nothing is submitted anywhere and no licence attaches. */
  const useDevice = useCallback(() => {
    if (!navigator.geolocation) {
      setErr('This browser cannot report a location.');
      return;
    }
    setErr('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatText(String(pos.coords.latitude));
        setLngText(String(pos.coords.longitude));
        setSource('device_gps');
      },
      // The browser's own refusal, said plainly. A denied permission is a
      // choice the person made, not a fault to report as one.
      () => setErr('This device did not share a location.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  return (
    <div className="k-coord">
      {has && (
        <>
          <PointRadiusMap label={name} lat={lat} lng={lng} />
          <div className="k-coord__meta">
            {/* The provenance, in words. It is the reason the pair is allowed
                to exist at all, so it is shown wherever the pair is shown. */}
            {geoSource && (
              <span className="k-coord__src">
                {SOURCES.find(s => s.value === geoSource)?.label || geoSource}
              </span>
            )}
            {/* ~4 m, from India Post's grid. No vendor produced it. */}
            {digipin && (
              <span className="k-coord__pin" title="India Post DIGIPIN — a ~4 m grid code">
                DIGIPIN <strong>{digipin}</strong>
              </span>
            )}
            {!digipin && (
              // The grid is not the world. Said rather than left blank, so an
              // absent code does not read as a failure to compute one.
              <span className="k-coord__pin k-coord__pin--none">
                Outside India Post&apos;s DIGIPIN grid, so it has no code.
              </span>
            )}
          </div>
        </>
      )}

      {!has && !open && (
        <div className="k-coord__none">
          No exact location saved. An address names a postal area — an Indian
          pincode averages ~82 km² — so a pin is the only way to say where the
          premises actually are.
        </div>
      )}

      {!open && (
        <div className="k-coord__actions">
          <button type="button" className="k-btn k-btn--ghost k-btn--sm"
            onClick={() => setOpen(true)} disabled={!canWrite}
            title={denial || undefined}>
            {has ? 'Move the pin' : 'Drop a pin'}
          </button>
          {has && (
            <button type="button" className="k-btn k-btn--ghost k-btn--sm"
              onClick={clear} disabled={!canWrite || busy}
              title={denial || undefined}>
              Remove
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="k-coord__edit">
          <label className="k-coord__f">
            <span>Latitude</span>
            <input className="k-input" inputMode="decimal" value={latText}
              onChange={e => setLatText(e.target.value)} placeholder="21.1702" />
          </label>
          <label className="k-coord__f">
            <span>Longitude</span>
            <input className="k-input" inputMode="decimal" value={lngText}
              onChange={e => setLngText(e.target.value)} placeholder="72.8311" />
          </label>
          <label className="k-coord__f">
            <span>Where this came from</span>
            <select className="k-input" value={source}
              onChange={e => setSource(e.target.value)}>
              {SOURCES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          {/* Drawn from the numbers as they are typed, so a swapped pair is
              visible BEFORE it is saved rather than after. PointRadiusMap says
              in words whether the point is in India and whether swapping the
              two would put it there. */}
          {degrees(latText) !== null && degrees(lngText) !== null && (
            <PointRadiusMap label={name} lat={degrees(latText)}
              lng={degrees(lngText)} />
          )}

          {err && <div className="k-coord__err" role="alert">{err}</div>}

          <div className="k-coord__actions">
            <button type="button" className="k-btn k-btn--sm" onClick={save}
              disabled={busy || !canWrite} title={denial || undefined}>
              {busy ? 'Saving…' : 'Save this location'}
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm"
              onClick={useDevice} disabled={busy}>
              Use this device
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm"
              onClick={() => { setOpen(false); setErr(''); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
