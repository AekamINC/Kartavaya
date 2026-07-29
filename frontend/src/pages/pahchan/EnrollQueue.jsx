import React, { useCallback, useEffect, useState } from 'react';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td, StatusChip } from '../../components/editorial';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';
import useModuleWrite from '../../hooks/useModuleWrite';

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
/* The thumbnail size lives in `.ph__thumb` (styles/pahchan.css) rather than in
   two constants here, so it follows the Corner radius and density settings like
   every other surface. */

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

  const failed = s.st === 'err';
  return (
    <div
      className={`ph__thumb${s.st === 'ok' ? ' ph__thumb--ok' : ''}`}
      /* Labelled only when there is nothing to see. The <img> carries its own
         alt in the resolved case, and a second label on the wrapper would have
         a screen reader announce the same photograph twice. */
      aria-label={s.st === 'ok' ? undefined : `Reference photo from ${name} — ${
        s.st === 'load' ? 'loading' : failed ? 'failed to load' : 'deleted'}`}
    >
      {s.st === 'ok' ? (
        <img src={s.url} alt={`Reference photo submitted by ${name}`} />
      ) : s.st === 'load' ? (
        /* The SHAPE is the loading signal, and it survives the sweep being
           switched off under reduced motion. An ellipsis does not: "…" is a
           glyph that means "nearly there", so a photo that never arrives reads
           as one that is about to — and approving is the act of vouching that
           this face belongs to this employee. */
        <span className="ix-skeleton rv__sk" aria-hidden="true" />
      ) : (
        <span className={`ph__thumb-w${failed ? ' ph__thumb-w--err' : ''}`}>
          {failed ? 'failed' : 'deleted'}
        </span>
      )}
    </div>
  );
}

export default function EnrollQueue() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change attendance' });
  const { pushToast } = useToast();
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [data, setData] = useState({ pending_approval: [], incomplete: [] });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/v1/pahchan/enrollment/queue/pending');
      // This route answers a bespoke object — `{pending_approval, incomplete}`,
      // not an envelope and not a bare array — so `body()` rather than `rows()`.
      // Each half is defaulted because a response missing a key would otherwise
      // reach `pending.length` as undefined and take the whole tab down; an
      // enrollment queue that throws is one nobody can clear, and every punch by
      // an unenrolled employee stays unverifiable until they do.
      const out = body(r);
      setData({
        pending_approval: Array.isArray(out.pending_approval) ? out.pending_approval : [],
        incomplete: Array.isArray(out.incomplete) ? out.incomplete : [],
      });
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
                  <strong className="ph__name">{p.employee_name}</strong>
                  {p.employee_code && (
                    <span className="ph__sub">
                      {p.employee_code}
                    </span>
                  )}
                </Td>
                <Td>{p.slot === 1 ? 'Front' : 'Angle'}</Td>
                <Td mono>{new Date(p.captured_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Td>
                <Td>
                  <button
                    className="btn btn--fill btn--sm"
                    disabled={busy === p.id || !canWrite}
                    onClick={() => approve(p.id, p.employee_name)} title={denial || undefined}>
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
                  <strong className="ph__name">{e.employee_name}</strong>
                  {e.employee_code && (
                    <span className="ph__sub">
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
