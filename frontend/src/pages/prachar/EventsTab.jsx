// Events — webinars, meetups, workshops, and who registered.
//
// The largest tab in the old file and the one with the most inline styling: the
// expanded registration row alone carried nine `style={{…}}` objects. Behaviour
// defects carried over:
//
//  · `setEvents(r.data)` on `{"data": [...]}` — the same `.map` crash.
//  · Delete had no confirmation, on a row that takes its registrations with it.
//  · The status filter was a `<select>` whose value was compared against
//    `events` BEFORE the fetch resolved, and the empty result rendered the
//    "No events yet" illustration with a create button — so filtering to
//    "Cancelled" on a full calendar invited you to create an event.
//  · `registerAttendee` did not check the event was full. `max_attendees` was
//    collected in the form and used nowhere.
import React, { useState, useMemo } from 'react';
import { Badge, BackButton, DataTable, Td } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import {
  api, rows, Panel, Bar, useResource, useMutate,
  EVENT_STATUS_COLORS, EVENT_TYPE_COLORS, humanise, plural, fmtDate, fmtDateTime,
} from './_shared';

const TYPES = ['webinar', 'meetup', 'workshop', 'conference', 'other'];
const STATUSES = ['draft', 'published', 'ongoing', 'completed', 'cancelled'];

export default function EventsTab({ onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);

  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/events').then(rows), [],
  );
  const all = data || [];
  const shown = useMemo(() => (status ? all.filter((e) => e.status === status) : all), [all, status]);
  const refresh = () => { reload(); onChanged?.(); };

  const save = async () => {
    if (!form.title.trim()) return pushToast({ type: 'error', title: 'An event needs a title.' });
    if (!form.starts_at) return pushToast({ type: 'error', title: 'An event needs a start date and time.' });
    if (form.ends_at && new Date(form.ends_at) < new Date(form.starts_at)) {
      return pushToast({ type: 'error', title: 'The end time is before the start time.' });
    }
    const payload = {
      title: form.title.trim(),
      description: form.description,
      event_type: form.event_type,
      location: form.location,
      location_url: form.location_url,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : '',
      max_attendees: form.max_attendees === '' ? null : Number(form.max_attendees),
      registration_open: form.registration_open,
      tags: [],
    };
    const r = await go(
      () => (form.id
        ? api.patch(`/v1/prachar/events/${form.id}`, payload)
        : api.post('/v1/prachar/events', payload)),
      form.id ? 'Event updated' : 'Event created',
    );
    if (r.ok) { setForm(null); refresh(); }
    return undefined;
  };

  const remove = async (ev) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `Delete "${ev.title}"?\n\n${plural(Number(ev.reg_count || 0), 'registration')} will no longer be reachable.`,
    )) return;
    const r = await go(() => api.delete(`/v1/prachar/events/${ev.id}`), 'Event deleted');
    if (r.ok) { setOpenId(null); refresh(); }
  };

  const setEventStatus = async (ev, next) => {
    const r = await go(() => api.patch(`/v1/prachar/events/${ev.id}`, { status: next }), `"${ev.title}" is now ${next}`);
    if (r.ok) refresh();
  };

  if (form) {
    return <EventForm form={form} setForm={setForm} onSave={save} onCancel={() => setForm(null)} busy={busy} />;
  }

  const blankEvent = () => ({
    title: '', description: '', event_type: 'webinar', location: '', location_url: '',
    starts_at: '', ends_at: '', max_attendees: '', registration_open: true,
  });

  return (
    <div>
      <Bar title="Events" hi="कार्यक्रम">
        <select
          className="k-formpanel__input"
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
        </select>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={() => setForm(blankEvent())}
          disabled={!canWrite} title={denial || undefined}>
          + New event
        </button>
      </Bar>

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        // The filter is deliberately NOT part of `empty`. "You have no events"
        // and "no events match this filter" are different facts, and only the
        // first one should offer a create button.
        empty={all.length === 0}
        emptyProps={{
          icon: '📅',
          title: 'No events yet',
          sub: 'An event collects registrations against a date — a webinar, a meetup, a workshop.',
          cta: '+ New event',
          onCta: () => setForm(blankEvent()),
        }}
        count={4}
      >
        {shown.length === 0 ? (
          <p className="pr__step-when">
            None of your {plural(all.length, 'event')} is {humanise(status).toLowerCase()}.{' '}
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setStatus('')}>
              Show all
            </button>
          </p>
        ) : (
          <DataTable columns={[
            'Title', 'Type', 'Starts', 'Status',
            { label: 'Registered', align: 'right' }, '',
          ]}>
            {shown.map((ev) => (
              <React.Fragment key={ev.id}>
                <tr>
                  <Td bold>{ev.title}</Td>
                  <td><Badge text={humanise(ev.event_type)} color={EVENT_TYPE_COLORS[ev.event_type]} /></td>
                  <td>{fmtDateTime(ev.starts_at)}</td>
                  <td><Badge text={humanise(ev.status)} color={EVENT_STATUS_COLORS[ev.status]} /></td>
                  <Td align="right" mono>
                    {Number(ev.reg_count || 0)}{ev.max_attendees ? ` / ${ev.max_attendees}` : ''}
                  </Td>
                  <td>
                    <div className="pr__rowact">
                      <button
                        type="button"
                        className="k-btn k-btn--ghost k-btn--sm"
                        aria-expanded={openId === ev.id}
                        onClick={() => setOpenId(openId === ev.id ? null : ev.id)}
                      >
                        {openId === ev.id ? 'Close' : 'Open'}
                      </button>
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setForm(toForm(ev))}>
                        Edit
                      </button>
                      {ev.status === 'draft' && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setEventStatus(ev, 'published')} disabled={busy}>
                          Publish
                        </button>
                      )}
                      {ev.status === 'published' && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setEventStatus(ev, 'cancelled')} disabled={busy}>
                          Cancel
                        </button>
                      )}
                      <button type="button" className="pr__del" onClick={() => remove(ev)} disabled={busy}>Delete</button>
                    </div>
                  </td>
                </tr>
                {openId === ev.id && (
                  <tr>
                    <td colSpan={6} className="pr__exp">
                      <EventDetail ev={ev} onChanged={refresh} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

/* ── Expanded event ───────────────────────────────────────────────────── */

function EventDetail({ ev, onChanged }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [reg, setReg] = useState(null);

  const regs = useResource(
    () => api.get(`/v1/prachar/events/${ev.id}/registrations`).then(rows), [ev.id],
  );
  const list = regs.data || [];
  const live = list.filter((r) => r.status !== 'cancelled');
  const full = ev.max_attendees && live.length >= Number(ev.max_attendees);

  const register = async () => {
    if (!reg.name.trim() || !reg.email.trim()) {
      return pushToast({ type: 'error', title: 'A registration needs a name and an email.' });
    }
    const r = await go(
      () => api.post(`/v1/prachar/events/${ev.id}/register`, {
        name: reg.name.trim(), email: reg.email.trim().toLowerCase(), phone: reg.phone.trim(),
      }),
      `${reg.name.trim()} registered`,
    );
    if (r.ok) { setReg(null); regs.reload(); onChanged?.(); }
    return undefined;
  };

  const mark = async (r, status) => {
    const out = await go(
      () => api.patch(`/v1/prachar/events/${ev.id}/registrations/${r.id}?status=${status}`),
      `${r.name} marked ${status}`,
    );
    if (out.ok) regs.reload();
  };

  return (
    <>
      {ev.description && <p className="pr__exp-d">{ev.description}</p>}

      <div className="pr__exp-facts">
        {ev.location && <span>Location: <strong>{ev.location}</strong></span>}
        {ev.location_url && (
          <span>Link: <a href={ev.location_url} target="_blank" rel="noreferrer noopener">{ev.location_url}</a></span>
        )}
        <span>Starts: <strong>{fmtDateTime(ev.starts_at)}</strong></span>
        {ev.ends_at && <span>Ends: <strong>{fmtDateTime(ev.ends_at)}</strong></span>}
        <span>
          Capacity: <strong>{ev.max_attendees ? `${live.length} of ${ev.max_attendees}` : 'unlimited'}</strong>
        </span>
        <span>Registration: <strong>{ev.registration_open ? 'open' : 'closed'}</strong></span>
      </div>

      <div className="pr__exp-h">
        <span>Registrations</span>
        {!reg && ev.registration_open && !full && (
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setReg({ name: '', email: '', phone: '' })}>
            + Add attendee
          </button>
        )}
        {/* Both closures are stated, and stated differently, because they are
            fixed differently: one is a setting, the other is a number. */}
        {!ev.registration_open && <span className="pr__step-when">Registration is closed for this event.</span>}
        {ev.registration_open && full && (
          <span className="pr__step-when">
            Full — {ev.max_attendees} of {ev.max_attendees} places taken. Raise the cap to add more.
          </span>
        )}
      </div>

      {reg && (
        <div className="pr__inline">
          <input className="k-formpanel__input" placeholder="Name" aria-label="Attendee name"
            value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} />
          <input className="k-formpanel__input" type="email" placeholder="Email" aria-label="Attendee email"
            value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />
          <input className="k-formpanel__input" placeholder="Phone (optional)" aria-label="Attendee phone"
            value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} />
          <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={register} disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Adding…' : 'Register'}
          </button>
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setReg(null)}>Cancel</button>
        </div>
      )}

      <Panel
        loading={regs.loading}
        error={regs.error}
        onRetry={regs.reload}
        empty={list.length === 0}
        emptyProps={{
          icon: '👥',
          title: 'Nobody has registered',
          sub: ev.registration_open
            ? 'Registrations appear here as they come in.'
            : 'Registration is closed, so none will arrive.',
        }}
        count={2}
      >
        <DataTable columns={['Name', 'Email', 'Phone', 'Status', 'Registered', '']}>
          {list.map((r) => (
            <tr key={r.id}>
              <Td bold>{r.name}</Td>
              <td>{r.email}</td>
              <td>{r.phone || '—'}</td>
              <td>
                <Badge
                  text={humanise(r.status)}
                  color={r.status === 'attended' ? 'var(--ok)' : r.status === 'cancelled' ? 'var(--danger)' : 'var(--on-surface-3)'}
                />
              </td>
              <td>{fmtDate(r.registered_at)}</td>
              <td>
                <div className="pr__rowact">
                  {r.status !== 'attended' && (
                    <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => mark(r, 'attended')} disabled={busy}>
                      Mark attended
                    </button>
                  )}
                  {r.status !== 'cancelled' && (
                    <button type="button" className="pr__del" onClick={() => mark(r, 'cancelled')} disabled={busy}>
                      Cancel
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}

/* ── Form ─────────────────────────────────────────────────────────────── */

/** An ISO timestamp into `datetime-local`'s LOCAL `YYYY-MM-DDTHH:mm`. The old
 *  form did `ev.starts_at.slice(0,16)`, which takes the UTC clock face — so
 *  opening an event for edit and pressing Save moved it back 5½ hours. */
const localInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const toForm = (ev) => ({
  id: ev.id,
  title: ev.title || '',
  description: ev.description || '',
  event_type: ev.event_type || 'webinar',
  location: ev.location || '',
  location_url: ev.location_url || '',
  starts_at: localInput(ev.starts_at),
  ends_at: localInput(ev.ends_at),
  max_attendees: ev.max_attendees ?? '',
  registration_open: ev.registration_open !== false,
});

function EventForm({ form, setForm, onSave, onCancel, busy }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change campaigns' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div>
      <BackButton onClick={onCancel} label="Back to events" />
      <div className="k-formpanel">
        <h3 className="pr__form-t">{form.id ? 'Edit event' : 'New event'}</h3>
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Title
            <input className="k-formpanel__input" placeholder="e.g. Product launch webinar" value={form.title} onChange={set('title')} />
          </label>
          <label className="k-formpanel__label">Type
            <select className="k-formpanel__input" value={form.event_type} onChange={set('event_type')}>
              {TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
            </select>
          </label>
        </div>
        <label className="k-formpanel__label">Description
          <textarea className="k-formpanel__input" rows={4} placeholder="What it is, and who it is for." value={form.description} onChange={set('description')} />
        </label>
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Location
            <input className="k-formpanel__input" placeholder="e.g. Mumbai Convention Centre" value={form.location} onChange={set('location')} />
          </label>
          <label className="k-formpanel__label">Joining link
            <input className="k-formpanel__input" type="url" placeholder="https://…" value={form.location_url} onChange={set('location_url')} />
          </label>
        </div>
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Starts
            <input className="k-formpanel__input" type="datetime-local" value={form.starts_at} onChange={set('starts_at')} />
          </label>
          <label className="k-formpanel__label">Ends
            <input className="k-formpanel__input" type="datetime-local" value={form.ends_at} onChange={set('ends_at')} />
          </label>
        </div>
        <div className="k-formpanel__grid k-formpanel__grid--2">
          <label className="k-formpanel__label">Maximum attendees
            <input className="k-formpanel__input" type="number" min="1" placeholder="Leave blank for no limit"
              value={form.max_attendees} onChange={set('max_attendees')} />
          </label>
          <label className="k-formpanel__label pr__check">
            <input type="checkbox" checked={form.registration_open}
              onChange={(e) => setForm({ ...form, registration_open: e.target.checked })} />
            Accepting registrations
          </label>
        </div>
        <div className="k-formpanel__actions">
          <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={onSave} disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Saving…' : (form.id ? 'Save event' : 'Create event')}
          </button>
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
