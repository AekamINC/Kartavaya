import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';
import PointRadiusMap from '../../components/PointRadiusMap';
import useModuleWrite from '../../hooks/useModuleWrite';

/**
 * Sites — `GET` / `POST` / `PATCH /api/v1/pahchan/sites`.
 *
 * WITHOUT A SITE, THE GEOFENCE DOES NOT EXIST. `_nearest_site` reads
 * `pahchan_sites` and returns `(None, None)` when the table is empty for an org,
 * so `distance_m` stays null, so `_compute_flags`' geofence branch —
 * `if distance_m is not None and site_radius_m is not None` — can never fire.
 * The `geo` flag then only ever means "location was off entirely", never
 * "outside the site".
 *
 * Both endpoints existed and nothing called them, so no org has ever had a site,
 * so no punch in the product has ever been compared against one. The Policy
 * screen meanwhile offers a "Geofence radius — how close to a site a punch has
 * to be", which was a setting for a thing that could not be created.
 *
 * ── AMENDING, WHICH THIS SCREEN REFUSED TO OFFER ────────────────────────────
 *
 * This file used to end its header with "The backend has no update or delete.
 * Adding one is not a UI decision", and then said so on screen: "Once saved, a
 * site cannot be moved from here." Both halves were true and the consequence was
 * not defensible. A radius typed as 15 instead of 150, or a pin dropped on the
 * wrong side of a building, flagged every punch at that site every morning and
 * the only remedy was a second site that the first one kept out-competing in
 * `_nearest_site`.
 *
 * `PATCH /sites/{id}` exists now, and the worry that kept it out is answered by
 * the punch path rather than by the UI: a punch stores `distance_m` and its
 * flags AT CAPTURE. Moving a fence changes what happens next and never what was
 * already decided, so an amend cannot rewrite a reviewed day. That sentence is
 * on the form, because an operator widening a radius needs to know their change
 * does NOT clear yesterday's flags.
 *
 * There is no delete, and there should not be: `pahchan_punches.geofence_id`
 * names a site on every punch ever recorded there. `is_active` retires one
 * without taking the attendance history with it.
 *
 * ── THE VERTICAL PAIR ───────────────────────────────────────────────────────
 *
 * Migration 193 added `altitude_m` / `altitude_tolerance_m` and nothing read or
 * wrote them. Both are OPTIONAL here and blank is the default, because blank is
 * the RIGHT answer for a ground-floor office: consumer GPS altitude is far
 * noisier than the horizontal fix, and a site that checks a floor nobody meant
 * to check flags honest punches every day. Leaving them blank skips the vertical
 * check entirely, and the form says so rather than leaving it to be inferred.
 *
 * The pair rule is enforced here as well as at the server, so that a tolerance
 * typed without an altitude comes back as a sentence instead of a 422 whose
 * `detail` is a Pydantic validation array.
 *
 * ── SEEING THE FENCE · Phase 8.1 ────────────────────────────────────────────
 *
 * The header above says a radius typed as 15 instead of 150, or a pin on the
 * wrong side of a building, flags every punch at that site every morning. That
 * sentence has been in this file since the amend path was added and until now
 * the screen offered no way to notice either mistake: three number inputs and a
 * save button. `components/PointRadiusMap.jsx` is mounted twice below — under
 * the form, following what is being typed, and under a saved row on request —
 * so the figures can be checked BEFORE they start flagging people.
 *
 * It is mounted, not depended on. The Mappls basemap 401s on every domain at
 * the moment, so what it renders today is the figures in words: the
 * hemispheres, what the radius covers on the ground, and whether the two
 * numbers look transposed. Those are the checks that catch the typos this file
 * already knew about, and they need no tiles.
 */

/** Blank means blank. `''` is not `0`, and `Number('') === 0` is how an
 *  optional metre figure silently becomes sea level. */
const blankOr = (v, cast = Number) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : cast(s);
};

/**
 * What the circle MEANS for attendance, in this module's own terms.
 *
 * Passed to the map rather than living inside it: `PointRadiusMap` draws a
 * point and a radius and knows nothing about punches, which is what lets 8.2
 * and 8.4 mount the same component for a PIN area and a dropped pin. The
 * wording matters — a punch outside the fence is FLAGGED, never refused, and an
 * operator who believes it is refused sets the radius far too wide.
 */
const FENCE_NOTE = 'A punch inside this circle is recorded as at the site. '
  + 'Outside it the punch is still recorded and still counts — it carries a '
  + 'flag for a reviewer to look at.';

const EMPTY_FORM = {
  name: '', lat: '', lng: '', radius_m: 150,
  altitude_m: '', altitude_tolerance_m: '',
};

/** A site row as form strings. `null` becomes `''`, never `'0'` or `'null'`. */
const formOf = site => ({
  name: site.name ?? '',
  lat: site.lat == null ? '' : String(site.lat),
  lng: site.lng == null ? '' : String(site.lng),
  radius_m: site.radius_m == null ? '' : String(site.radius_m),
  altitude_m: site.altitude_m == null ? '' : String(site.altitude_m),
  altitude_tolerance_m:
    site.altitude_tolerance_m == null ? '' : String(site.altitude_tolerance_m),
});

function CoordField({ label, value, onChange, placeholder }) {
  return (
    <label className="fld ph__fld ph__fld--coord">
      <span className="fld__l">{label}</span>
      <input
        className="inp"
        type="number"
        step="0.000001"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}

export default function Sites() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change attendance' });
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [sites, setSites] = useState([]);
  const [adding, setAdding] = useState(false);
  /** The site being amended, as it was LOADED — not as it is being typed. It is
   *  kept whole because `clear_altitude` can only be decided by comparing what
   *  the site has against what the form now says. */
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fix, setFix] = useState(null);
  const [fixAlt, setFixAlt] = useState(null);
  /** Which site is mid-deactivate, so only its own button says "Saving…". */
  const [toggling, setToggling] = useState(null);
  /** Which saved site is showing its fence. One at a time — two maps on one
   *  screen is two SDK map instances, and the comparison they invite is better
   *  served by the coordinates already on every row. */
  const [showing, setShowing] = useState(null);

  const open = adding || editing != null;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/sites');
      // `rows()`, not `r.data.data`. This route answers `{"data": [...]}` today
      // (pahchan.py `list_sites`), but 28 of the 127 GET routes in this codebase
      // answer a bare array instead and there is no rule about which. Reading
      // the envelope by hand is how a list endpoint that changes shape renders
      // as EMPTY rather than failing — and an empty site list is what silently
      // turns the geofence off for a whole org.
      setSites(rows(r));
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => {
    setAdding(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFix(null);
    setFixAlt(null);
  };

  const startAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFix(null); setFixAlt(null); setAdding(true); };
  const startEdit = site => { setAdding(false); setFix(null); setFixAlt(null); setForm(formOf(site)); setEditing(site); };

  /**
   * The browser's own fix, offered because typing coordinates from memory is how
   * a fence ends up two streets away. The accuracy comes back with it and is
   * shown, because a ±2km desktop fix trilaterated from wi-fi looks exactly like
   * a ±8m one until you read the number — and this fix decides whether staff are
   * flagged every morning.
   *
   * The altitude is READ but never written into the form. `coords.altitude` is
   * null on most desktops and, where it exists, is the noisiest number the
   * geolocation API returns — a WGS84 ellipsoid height that can differ from the
   * height anybody would call "the third floor" by tens of metres. Filling the
   * altitude field from it would look authoritative and set a fence nobody
   * measured. It is offered as an observation, with its own accuracy beside it,
   * for the operator to accept by typing it.
   */
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      pushToast({ type: 'warning', title: 'This browser cannot report a location' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({
          ...f,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setFix(Math.round(pos.coords.accuracy));
        // null stays null. `?? undefined` and not `|| 0`: a device that reports
        // no altitude is ordinary, and 0 would offer sea level as a reading.
        setFixAlt(
          pos.coords.altitude == null
            ? null
            : {
              m: Math.round(pos.coords.altitude),
              acc: pos.coords.altitudeAccuracy == null
                ? null : Math.round(pos.coords.altitudeAccuracy),
            },
        );
        setLocating(false);
      },
      () => {
        setLocating(false);
        pushToast({
          type: 'warning',
          title: 'Could not read this device’s location',
          message: 'Enter the coordinates instead, or allow location for this site in your browser.',
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  /**
   * Everything the server would refuse, said as a sentence first.
   *
   * Returns a toast payload or null. The pair rule is the one that matters:
   * `pahchan_sites_altitude_pair_ck` refuses a tolerance with no altitude, and
   * reaching it produces a 422 carrying a Pydantic error array — which the toast
   * would render as `[object Object]` beside the words "Could not add that site".
   */
  const problem = (name, lat, lng, radius, altitude, tolerance) => {
    if (!name) {
      return { title: 'The site needs a name', message: 'It is what the reviewer sees on the row.' };
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { title: 'Those coordinates are not valid', message: 'Latitude is −90 to 90, longitude −180 to 180.' };
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      return { title: 'The radius has to be a positive number of metres' };
    }
    if (altitude != null && (!Number.isFinite(altitude) || altitude <= -500 || altitude >= 9000)) {
      return {
        title: 'That altitude is not a height on this planet',
        message: 'It is metres above sea level, between −500 and 9000. Leave it blank to skip the vertical check.',
      };
    }
    if (tolerance != null && (!Number.isFinite(tolerance) || tolerance <= 0)) {
      return { title: 'The vertical tolerance has to be a positive number of metres' };
    }
    // The pair rule, in the server's own words.
    if (tolerance != null && altitude == null) {
      return {
        title: 'A vertical tolerance needs an altitude to be a tolerance of',
        message: 'Set the site’s altitude too, or leave both blank to skip the vertical check.',
      };
    }
    return null;
  };

  const save = async () => {
    const name = form.name.trim();
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const radius = Number(form.radius_m);
    const altitude = blankOr(form.altitude_m);
    const tolerance = blankOr(form.altitude_tolerance_m);

    const bad = problem(name, lat, lng, radius, altitude, tolerance);
    if (bad) { pushToast({ type: 'warning', ...bad }); return; }

    setSaving(true);
    try {
      if (editing) {
        // Every field, always — this is an amend of a form the operator has just
        // read in full, so "what the form says" IS the intended state. Sending
        // only the diff would mean a value they retyped identically after a
        // concurrent change quietly kept the other change.
        const payload = { name, lat, lng, radius_m: radius };
        if (altitude != null) payload.altitude_m = altitude;
        if (tolerance != null) payload.altitude_tolerance_m = tolerance;
        // Blanking a field cannot be said by omission: the server treats an
        // absent key as "leave it alone", which is what every other field here
        // means. `clear_altitude` is the only way to turn the vertical check
        // off again, and it clears BOTH columns because a tolerance with no
        // altitude is what the CHECK constraint refuses.
        if (altitude == null && editing.altitude_m != null) payload.clear_altitude = true;

        await api.patch(`/v1/pahchan/sites/${editing.id}`, payload);
        pushToast({
          type: 'success',
          title: `${name} updated`,
          message: 'Punches from now on are measured against the new figures. Punches already recorded keep the distance and flags they were given at capture.',
        });
      } else {
        const payload = { name, lat, lng, radius_m: radius };
        if (altitude != null) payload.altitude_m = altitude;
        if (tolerance != null) payload.altitude_tolerance_m = tolerance;
        await api.post('/v1/pahchan/sites', payload);
        pushToast({
          type: 'success',
          title: `${name} added`,
          message: 'Punches from now on are measured against it. Punches already recorded are not re-measured.',
        });
      }
      close();
      load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      pushToast({
        type: 'error',
        title: editing ? 'Could not update that site' : 'Could not add that site',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Retire a site, or bring it back. Never a delete.
   *
   * `pahchan_punches.geofence_id` names a site on every punch recorded there, so
   * deleting one would either orphan the register or take the attendance history
   * with it. A deactivated site stops being offered to the phone and stops being
   * matched by `_nearest_site`; every punch that already named it still reads
   * correctly on the reviewer's day.
   */
  const setActive = async (site, next) => {
    setToggling(site.id);
    try {
      await api.patch(`/v1/pahchan/sites/${site.id}`, { is_active: next });
      pushToast({
        type: 'success',
        title: next ? `${site.name} is in use again` : `${site.name} retired`,
        message: next
          ? 'Punches near it are measured against it again.'
          : 'Punches near it are no longer measured against it. Every punch already recorded there keeps its site and its flags.',
      });
      load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      pushToast({
        type: 'error',
        title: 'Could not change that site',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    } finally {
      setToggling(null);
    }
  };

  return (
    <Section
      title="Sites"
      hi="स्थान"
      right={!open && state === 'ready' && (
        <button className="btn btn--fill btn--sm" onClick={startAdd}
          disabled={!canWrite} title={denial || undefined}>
          Add a site
        </button>
      )}
    >
      <Note>
        A punch is measured against the nearest site. With no site there is nothing to
        measure against, so nothing is ever &ldquo;outside&rdquo; — the geofence radius
        under Geofence and flags has no effect until at least one exists.
      </Note>

      {state === 'loading' && (
        <SkeletonRegion label="Loading sites…"><SkeletonTable rows={3} columns={5} /></SkeletonRegion>
      )}

      {state === 'error' && (
        <ErrorState
          kind={errKind}
          detail={
            errKind === 'offline'
              ? 'Sites need a connection to load.'
              : 'The sites did not load. This is a read failure — nothing was changed.'
          }
          onRetry={load}
        />
      )}

      {open && (
        <div className="ph__form">
          <label className="fld ph__f ph__fld--name">
            <span className="fld__l">Name</span>
            <input
              className="inp"
              value={form.name}
              placeholder="Fort office"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <span className="fld__hint">What a reviewer sees beside a punch. Use the name the team uses.</span>
          </label>

          <div className="ph__form-row">
            <CoordField label="Latitude" value={form.lat} placeholder="18.933300" onChange={v => setForm(f => ({ ...f, lat: v }))} />
            <CoordField label="Longitude" value={form.lng} placeholder="72.833600" onChange={v => setForm(f => ({ ...f, lng: v }))} />
            <label className="fld ph__fld ph__fld--radius">
              <span className="fld__l">Radius</span>
              <span className="ph__inline">
                <input
                  className="inp" type="number" min={10}
                  value={form.radius_m}
                  onChange={e => setForm(f => ({ ...f, radius_m: e.target.value }))}
                />
                <span className="ph__unit">metres</span>
              </span>
            </label>
            <button className="btn btn--ghost btn--sm" disabled={locating} onClick={useMyLocation}>
              {locating ? 'Reading…' : 'Use this device'}
            </button>
          </div>

          {fix != null && (
            <p className="fld__hint ph__hint-top">
              This device reports ±{fix}m. {fix > 60
                ? 'That is loose for a fence centre — a desktop fix is often trilaterated from wi-fi and can be streets out. Check the coordinates before saving.'
                : 'Good enough for a fence centre if you are standing at the site.'}
              {' '}{fixAlt
                ? `It also reports an altitude of about ${fixAlt.m}m${fixAlt.acc != null ? ` (±${fixAlt.acc}m)` : ''} — not filled in for you, because that is a satellite height and rarely the number you would call this floor.`
                : 'It reports no altitude at all, which is ordinary on a desktop.'}
            </p>
          )}

          {/* ── The fence, as it is being typed ─────────────────────────────
              Directly under the three fields it reads, so a transposed pair or
              a missing digit is visible in the same glance as the input that
              caused it. `form.name` is a name the operator typed, never an id.
              Phase 8.1 keeps the altitude pair OFF this picture deliberately: a
              circle is horizontal, and drawing a vertical window would claim a
              precision consumer GNSS does not have. */}
          <PointRadiusMap
            subject="site"
            label={form.name.trim() || undefined}
            lat={form.lat}
            lng={form.lng}
            radiusM={form.radius_m}
            radiusNote={FENCE_NOTE}
            height={220}
          />

          {/* ── The vertical pair ───────────────────────────────────────────
              Its own row and its own explanation, because it is the one part of
              this form where leaving the fields BLANK is the recommendation
              rather than an omission. */}
          <div className="ph__form-row ph__vert">
            <label className="fld ph__fld ph__fld--num">
              <span className="fld__l">Altitude <span className="ph__opt">optional</span></span>
              <span className="ph__inline">
                <input
                  className="inp" type="number" step="1"
                  placeholder="—"
                  value={form.altitude_m}
                  onChange={e => setForm(f => ({ ...f, altitude_m: e.target.value }))}
                />
                <span className="ph__unit">m above sea level</span>
              </span>
            </label>
            <label className="fld ph__fld ph__fld--num">
              <span className="fld__l">Allowed difference <span className="ph__opt">optional</span></span>
              <span className="ph__inline">
                <input
                  className="inp" type="number" min={1}
                  placeholder="—"
                  value={form.altitude_tolerance_m}
                  onChange={e => setForm(f => ({ ...f, altitude_tolerance_m: e.target.value }))}
                />
                <span className="ph__unit">metres</span>
              </span>
            </label>
          </div>

          <p className="fld__hint ph__hint-wide">
            <b>Leave both blank unless you need them.</b> Blank means the vertical check
            is skipped — the punch is judged on distance alone, and that is the right
            setting for a ground-floor office. A phone’s altitude is far noisier than
            its position, so a site that checks a floor will flag honest punches on a
            bad signal day. Set the pair only where the floor genuinely matters, and
            allow more metres than you think: three storeys is about 10m, and ±25m is a
            realistic window for a device that is doing its best.
          </p>
          {form.altitude_m.trim() !== '' && form.altitude_tolerance_m.trim() === '' && (
            <p className="fld__hint ph__hint-top">
              With no allowed difference the altitude is <b>recorded but not checked</b>.
              Nothing is flagged for it. That is a fine way to collect real readings
              before deciding on a window.
            </p>
          )}
          {editing && editing.altitude_m != null
            && form.altitude_m.trim() === '' && form.altitude_tolerance_m.trim() === '' && (
            <p className="fld__hint ph__hint-top">
              Saving now <b>turns the vertical check off</b> for this site. Punches are
              judged on distance alone from then on.
            </p>
          )}

          <p className="fld__hint ph__hint-wide">
            150m is the default radius because a gate 60m from the pin is still at work.
            {editing
              ? ' Changing a site changes what happens next and never what was already decided: a punch keeps the distance and the flags it was given at capture, so widening a radius does not clear yesterday’s flags and tightening one does not create them.'
              : ' A site can be corrected later — coordinates, radius and the vertical pair — and doing so never re-measures punches that have already been recorded.'}
          </p>

          <div className="ph__acts">
            <button className="btn btn--fill btn--sm" disabled={saving || !canWrite} onClick={save} title={denial || undefined}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add site'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state === 'ready' && sites.length === 0 && !open && (
        <EmptyState
          icon="generic"
          title={{ en: 'No sites yet', hi: 'कोई स्थान नहीं' }}
          description="Every punch is recorded, and none of them is measured against anything. Add the places your team works from."
          action={canWrite ? 'Add a site' : undefined}
          onAction={canWrite ? startAdd : undefined}
        />
      )}

      {state === 'ready' && sites.length > 0 && (
        <DataTable arrange="pahchan.sites" columns={['Site', 'Coordinates', 'Radius', 'Vertical check', 'Status', '']}>
          {sites.map(s => {
            const checksAltitude = s.altitude_m != null && s.altitude_tolerance_m != null;
            const active = s.is_active !== false;
            const mapOpen = showing === s.id;
            return (
              <React.Fragment key={s.id}>
              <tr>
                <Td><strong className="ph__name">{s.name}</strong></Td>
                <Td mono>{Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}</Td>
                <Td mono>{s.radius_m} m</Td>
                <Td>
                  {/* Three states, not two. "Recorded, not checked" is a real
                      setting — an altitude with no tolerance — and reading it
                      as "off" would hide the half-finished pair from the only
                      person who could finish it. */}
                  {checksAltitude ? (
                    <span className="ph__mono">{Math.round(s.altitude_m)} m ±{s.altitude_tolerance_m} m</span>
                  ) : s.altitude_m != null ? (
                    <span className="ph__sub">{Math.round(s.altitude_m)} m recorded, not checked</span>
                  ) : (
                    <span className="ph__sub">Off — distance only</span>
                  )}
                </Td>
                <Td>
                  <StatusChip status={active ? 'done' : 'rejected'} />
                </Td>
                <Td>
                  <span className="ph__rowacts">
                    {/* Available to a reader with no write access. Checking
                        where a fence is, is not a change to it, and the person
                        who spots that a fence is in the wrong place is usually
                        the reviewer looking at the flags it produced — who may
                        not be allowed to edit anything. */}
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setShowing(mapOpen ? null : s.id)}
                      aria-expanded={mapOpen}
                      title={mapOpen
                        ? undefined
                        : 'See where this site is and how far its fence reaches.'}
                    >
                      {mapOpen ? 'Hide fence' : 'Show fence'}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => startEdit(s)}
                      disabled={!canWrite}
                      title={denial || undefined}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setActive(s, !active)}
                      disabled={!canWrite || toggling === s.id}
                      title={denial || (active
                        ? 'Stop measuring punches against this site. Nothing already recorded changes.'
                        : 'Measure punches against this site again.')}
                    >
                      {toggling === s.id ? 'Saving…' : active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </span>
                </Td>
              </tr>

              {/* The saved fence. Six cells wide — the same count as the header
                  above, which is what keeps the row on the `--row-h` contract
                  the rest of the table sits on. */}
              {mapOpen && (
                <tr className="ph__expand">
                  <td colSpan={6}>
                    <PointRadiusMap
                      subject="site"
                      label={s.name}
                      lat={s.lat}
                      lng={s.lng}
                      radiusM={s.radius_m}
                      radiusNote={FENCE_NOTE}
                      height={240}
                    />
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </DataTable>
      )}
    </Section>
  );
}
