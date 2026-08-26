/**
 * AttendancePage.jsx — self-service clock in / clock out.
 *
 * Built for a phone held one-handed: one large primary action, today's state
 * above it, recent shifts below. Works identically in iOS Safari, the
 * installed home-screen PWA, and on desktop — no native app involved.
 *
 * Location is captured in the click handler (Safari only prompts on a user
 * gesture) and is best-effort: a denied permission still records the punch.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { captureGeoFix, formatLocation } from '../lib/geo';
import { PageHeader, Card } from '../components/editorial';
import { useToast } from '../components/ui/toast';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(mins) {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(value) {
  if (!value) return '—';
  // work_date is a plain YYYY-MM-DD; parse as local so it never shifts a day.
  const [y, mo, d] = String(value).split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString([], {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/** Live elapsed time since clock-in, ticking once a minute. */
function useElapsed(since) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
}

function LocationLine({ label, location }) {
  const text = formatLocation(location);
  return (
    <div style={{ fontSize: 12, color: 'var(--k-muted, #6b7280)', marginTop: 2 }}>
      {label}: {text || 'not recorded'}
    </div>
  );
}

export default function AttendancePage() {
  const { pushToast } = useToast();
  const [today,   setToday]   = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([
        api.get('/attendance/me/today'),
        api.get('/attendance/me'),
      ]);
      setToday(t.data);
      setHistory(h.data.entries || []);
    } catch (e) {
      pushToast({ type: 'error', title: 'Could not load attendance' });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => { load(); }, [load]);

  const punch = async (action) => {
    setBusy(true);
    try {
      // Captured inside the gesture so iOS Safari shows the permission prompt.
      const geo = await captureGeoFix();
      await api.post(`/attendance/${action}`, geo || {});
      if (!geo) {
        pushToast({
          type: 'info',
          title: action === 'clock-in' ? 'Clocked in ✓' : 'Clocked out ✓',
          message: 'Location was unavailable and was not recorded.',
        });
      } else {
        pushToast({
          type: 'success',
          title: action === 'clock-in' ? 'Clocked in ✓' : 'Clocked out ✓',
        });
      }
      await load();
    } catch (e) {
      pushToast({
        type: 'error',
        title: 'Could not record attendance',
        message: e?.response?.data?.detail || 'Try again',
      });
    } finally {
      setBusy(false);
    }
  };

  const state   = today?.state ?? 'out';
  const entry   = today?.entry ?? null;
  const elapsed = useElapsed(state === 'in' ? entry?.clock_in_at : null);

  return (
    <>
      <PageHeader
        kicker="Attendance"
        title="Attendance"
        sanskrit="उपस्थिति"
        lede="Clock in and out from any browser. Your location is recorded with each punch."
      />

      <Card title="Today" sanskrit="अद्य">
        {loading ? (
          <p style={{ color: 'var(--k-muted, #6b7280)' }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--k-muted, #6b7280)' }}>
                  Clocked in
                </div>
                <div style={{ fontSize: 24, fontWeight: 600 }}>{fmtTime(entry?.clock_in_at)}</div>
                {entry?.clock_in_at && (
                  <LocationLine label="Location" location={entry.clock_in_location} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--k-muted, #6b7280)' }}>
                  Clocked out
                </div>
                <div style={{ fontSize: 24, fontWeight: 600 }}>{fmtTime(entry?.clock_out_at)}</div>
                {entry?.clock_out_at && (
                  <LocationLine label="Location" location={entry.clock_out_location} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--k-muted, #6b7280)' }}>
                  {state === 'in' ? 'Elapsed' : 'Total'}
                </div>
                <div style={{ fontSize: 24, fontWeight: 600 }}>
                  {state === 'in' ? fmtDuration(elapsed) : fmtDuration(entry?.minutes)}
                </div>
              </div>
            </div>

            {state === 'done' ? (
              <p style={{ margin: 0, color: 'var(--k-muted, #6b7280)' }}>
                Today’s shift is complete.
              </p>
            ) : (
              <button
                type="button"
                className="k-btn k-btn--primary"
                disabled={busy}
                onClick={() => punch(state === 'in' ? 'clock-out' : 'clock-in')}
                style={{ alignSelf: 'flex-start', minWidth: 200, minHeight: 52, fontSize: 17 }}
              >
                {busy
                  ? 'Recording…'
                  : state === 'in' ? 'Clock Out' : 'Clock In'}
              </button>
            )}
          </div>
        )}
      </Card>

      <Card title="Recent shifts" sanskrit="इतिहास" noPad>
        {history.length === 0 ? (
          <p style={{ padding: 20, margin: 0, color: 'var(--k-muted, #6b7280)' }}>
            No attendance recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead>
                <tr>
                  {['Date', 'In', 'Out', 'Hours', 'Clock-in location'].map(h => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left', padding: '10px 16px', fontSize: 12,
                        textTransform: 'uppercase', letterSpacing: '.06em',
                        color: 'var(--k-muted, #6b7280)', whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(e => (
                  <tr key={e.entry_id} style={{ borderTop: '1px solid var(--k-border, #e5e7eb)' }}>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{fmtDate(e.work_date)}</td>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{fmtTime(e.clock_in_at)}</td>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{fmtTime(e.clock_out_at)}</td>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{fmtDuration(e.minutes)}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--k-muted, #6b7280)' }}>
                      {formatLocation(e.clock_in_location) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
