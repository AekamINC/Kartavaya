import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';

/**
 * Enrollment queue — the reference pairs that make the register possible.
 *
 * Two halves, both of which are `noref` seen from a different angle:
 *
 *   Awaiting approval — an employee self-captured, and nobody has vouched for it
 *   yet. Approving is the act of saying this face belongs to this person, and
 *   everything downstream rests on it, so it is a deliberate action rather than a
 *   default.
 *
 *   Incomplete — an active employee with fewer than two approved photos. Every
 *   punch they make is flagged `noref` and cannot be verified at all. This half is
 *   easy to leave out and is the more important one: an empty approval queue looks
 *   like success while twenty people remain unverifiable.
 */
const THUMB_W = 58;
const THUMB_H = 72;

/**
 * The photograph being approved.
 *
 * Approving is the act of vouching that this face belongs to this employee, and
 * every punch that employee ever makes is verified against it. Approving without
 * seeing it is not a weaker version of that check — it is the absence of one, and
 * it was what this screen did: the queue rendered a name, a slot and an Approve
 * button, and never the face.
 *
 * Signed per image on demand and never cached as a URL, the same discipline the
 * register uses. States are distinguished for the same reason: a permanent
 * spinner and a deleted photo must not look alike.
 */
function RefThumb({ photoId, name }) {
  const [s, setS] = useState({ st: 'load' });

  useEffect(() => {
    let alive = true;
    api.get(`/v1/pahchan/enrollment/photos/${photoId}/url`)
      .then(r => { if (alive) setS({ st: 'ok', url: r.data.url }); })
      .catch(err => {
        if (alive) setS({ st: err?.response?.status === 404 ? 'gone' : 'err' });
      });
    return () => { alive = false; };
  }, [photoId]);

  return (
    <div
      style={{
        width: THUMB_W, height: THUMB_H,
        background: s.st === 'ok' ? 'var(--s-low)' : 'var(--s-container)',
        border: '1px solid var(--outline-variant)',
        borderRadius: 'var(--r-sm)',
        overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {s.st === 'ok' ? (
        <img
          src={s.url}
          alt={`Reference photo submitted by ${name}`}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      ) : (
        <span style={{ fontSize: 'var(--t-label-sm)', color: 'var(--on-surface-3)', textAlign: 'center', padding: 2 }}>
          {s.st === 'load' ? '…' : s.st === 'err' ? 'failed' : 'deleted'}
        </span>
      )}
    </div>
  );
}

export default function EnrollQueue() {
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [data, setData] = useState({ pending_approval: [], incomplete: [] });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/enrollment/queue/pending');
      setData(r.data);
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (photoId, name) => {
    setBusy(photoId);
    try {
      await api.post(`/v1/pahchan/enrollment/${photoId}/approve`);
      pushToast({ type: 'success', title: 'Reference photo approved', message: `${name} can now be verified.` });
      load();
    } catch {
      pushToast({ type: 'error', title: 'Could not approve that photo', message: 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  if (state === 'loading') {
    return (
      <SkeletonRegion label="Loading the enrollment queue…">
        {/* Five, matching the real table since the photo column was added. */}
        <SkeletonTable rows={4} columns={5} />
      </SkeletonRegion>
    );
  }

  if (state === 'error') {
    return (
      <ErrorState
        kind={errKind}
        detail={
          errKind === 'offline'
            ? 'The enrollment queue needs a connection to load. Reference photos already submitted are safe.'
            : 'The enrollment queue did not load. Reference photos are safe — this is a read failure.'
        }
        onRetry={load}
      />
    );
  }

  const { pending_approval: pending, incomplete } = data;

  return (
    <>
      <Section title="Awaiting approval" hi="स्वीकृति हेतु">
        {pending.length === 0 ? (
          <EmptyState
            icon="check"
            tone="ok"
            title={{ en: 'Nothing waiting', hi: 'कुछ शेष नहीं' }}
            description="Every reference photo submitted has been approved."
          />
        ) : (
          <DataTable columns={['Photo', 'Employee', 'Slot', 'Taken', 'Action']}>
            {pending.map(p => (
              <tr key={p.id}>
                <Td><RefThumb photoId={p.id} name={p.employee_name} /></Td>
                <Td>
                  <strong style={{ fontSize: 13.5 }}>{p.employee_name}</strong>
                  {p.employee_code && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--on-surface-3)' }}>
                      {p.employee_code}
                    </span>
                  )}
                </Td>
                <Td>{p.slot === 1 ? 'Front' : 'Angle'}</Td>
                <Td mono>{new Date(p.captured_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Td>
                <Td>
                  <button
                    className="btn btn--fill"
                    style={{ fontSize: 12 }}
                    disabled={busy === p.id}
                    onClick={() => approve(p.id, p.employee_name)}
                  >
                    {busy === p.id ? 'Approving…' : 'Approve'}
                  </button>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section title="Not yet verifiable" hi="अपूर्ण">
        <Note variant="warn">
          Every clock-in by these employees is flagged and cannot be checked against
          anything. Two approved photos are needed — a front view and one at an angle.
          They can take both themselves from the mobile app.
        </Note>
        {incomplete.length === 0 ? (
          <EmptyState
            icon="check"
            tone="ok"
            title={{ en: 'Everyone is enrolled', hi: 'सभी पंजीकृत' }}
            description="Every active employee has both reference photos on file."
          />
        ) : (
          <DataTable columns={['Employee', 'On file', 'Status']}>
            {incomplete.map(e => (
              <tr key={e.employee_id}>
                <Td>
                  <strong style={{ fontSize: 13.5 }}>{e.employee_name}</strong>
                  {e.employee_code && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--on-surface-3)' }}>
                      {e.employee_code}
                    </span>
                  )}
                </Td>
                <Td mono>{e.approved_count} of 2</Td>
                <Td>
                  {/* `noref` / `halfref`, not `rejected` / `requested`. The label
                      prop never existed, so these two chips read "Rejected" and
                      "Requested" — an employee nobody has photographed yet was
                      being shown to HR as a rejection. */}
                  <StatusChip status={Number(e.approved_count) === 0 ? 'noref' : 'halfref'} />
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </>
  );
}
