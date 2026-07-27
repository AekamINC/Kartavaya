import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';

/**
 * Sites — `GET` / `POST /api/v1/pahchan/sites`.
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
 * The backend has no update or delete. Adding one is not a UI decision — a site
 * whose coordinates move retroactively changes whether past punches were inside
 * it, and the register has already been reviewed against the old ones. So this
 * lists and adds, and says that plainly rather than offering an edit that would
 * quietly rewrite history.
 */

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
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [sites, setSites] = useState([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [form, setForm] = useState({ name: '', lat: '', lng: '', radius_m: 150 });
  const [fix, setFix] = useState(null);

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

  /**
   * The browser's own fix, offered because typing coordinates from memory is how
   * a fence ends up two streets away. The accuracy comes back with it and is
   * shown, because a ±2km desktop fix trilaterated from wi-fi looks exactly like
   * a ±8m one until you read the number — and this fix decides whether staff are
   * flagged every morning.
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

  const save = async () => {
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const radius = Number(form.radius_m);
    if (!form.name.trim()) {
      pushToast({ type: 'warning', title: 'The site needs a name', message: 'It is what the reviewer sees on the row.' });
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      pushToast({ type: 'warning', title: 'Those coordinates are not valid', message: 'Latitude is −90 to 90, longitude −180 to 180.' });
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      pushToast({ type: 'warning', title: 'The radius has to be a positive number of metres' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/v1/pahchan/sites', { name: form.name.trim(), lat, lng, radius_m: radius });
      pushToast({
        type: 'success',
        title: `${form.name.trim()} added`,
        message: 'Punches from now on are measured against it. Punches already recorded are not re-measured.',
      });
      setForm({ name: '', lat: '', lng: '', radius_m: 150 });
      setFix(null);
      setAdding(false);
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not add that site',
        message: err.response?.data?.detail || 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Sites"
      hi="स्थान"
      right={!adding && state === 'ready' && (
        <button className="btn btn--fill btn--sm" onClick={() => setAdding(true)}>
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
        <SkeletonRegion label="Loading sites…"><SkeletonTable rows={3} columns={4} /></SkeletonRegion>
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

      {adding && (
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
            </p>
          )}

          <p className="fld__hint ph__hint-wide">
            150m is the default because a gate 60m from the pin is still at work. Once
            saved, a site cannot be moved from here — moving it would change whether
            punches already reviewed were inside it.
          </p>

          <div className="ph__acts">
            <button className="btn btn--fill btn--sm" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Add site'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => { setAdding(false); setFix(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state === 'ready' && sites.length === 0 && !adding && (
        <EmptyState
          icon="generic"
          title={{ en: 'No sites yet', hi: 'कोई स्थान नहीं' }}
          description="Every punch is recorded, and none of them is measured against anything. Add the places your team works from."
          action="Add a site"
          onAction={() => setAdding(true)}
        />
      )}

      {state === 'ready' && sites.length > 0 && (
        <DataTable columns={['Site', 'Coordinates', 'Radius', 'Status']}>
          {sites.map(s => (
            <tr key={s.id}>
              <Td><strong className="ph__name">{s.name}</strong></Td>
              <Td mono>{Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}</Td>
              <Td mono>{s.radius_m} m</Td>
              <Td>
                <StatusChip status={s.is_active === false ? 'rejected' : 'done'} />
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </Section>
  );
}
