import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonCard } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';
import { compressCapture } from '../../lib/pahchanClock';

/**
 * Enroll — the two reference photographs every punch is compared against.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `EnrollQueue.jsx` has always reviewed self-captures. Nothing could make one.
 * `POST /v1/pahchan/enrollment` accepts `source='self_capture'` and refuses
 * anybody enrolling a face other than their own — a rule written for a screen
 * that did not exist on the web, and exists on mobile only in an app with no
 * iOS build. The result, read from production:
 *
 *     0 enrollment photos product-wide, and 14 of 14 punches flagged `noref`.
 *
 * Every punch this product has ever taken is unverifiable, not because the
 * comparison is hard but because there is nothing to compare against. This is
 * the screen that ends that, and it is the last piece of phase 0: without it an
 * iPhone punch would arrive flagged exactly like the fourteen before it.
 *
 * ── WHY TWO PHOTOS, AND WHY DIFFERENT ANGLES ───────────────────────────────
 * 07 §0, quoted in `mobile/src/screens/pahchan/EnrollScreen.tsx`: one frontal
 * photo gives a single embedding that fails on anyone who turns their head, and
 * re-enrolling every client's workforce later is the kind of migration that
 * quietly kills a feature. The pair costs one extra tap, once.
 *
 * The second slot's instruction differs from the first for the same reason —
 * two photographs taken thirty seconds apart in the same pose give the reviewer
 * nothing a single one would not, and give v2 nothing either.
 *
 * ── CAMERA ONLY, NO FILE PICKER ────────────────────────────────────────────
 * ⚠ THIS IS THE SECURITY PROPERTY OF THE WHOLE MODULE, not a UI preference.
 * `getUserMedia` is a live stream; there is no `<input type="file">` here and
 * there must never be one. If a reference photo could be chosen from disk, a
 * person could enroll a face that is not theirs, and every later comparison
 * would confirm the substitution rather than catch it. The punch screen refuses
 * the gallery for the same reason and this is the more sensitive of the two:
 * a bad punch photo is one bad day, a bad reference is every day after it.
 *
 * ── AND THESE LAND PENDING ─────────────────────────────────────────────────
 * Saying so on screen is not decoration. An employee who takes two photographs
 * and then watches their punches stay flagged would reasonably conclude it had
 * not worked, and stop.
 */

const SLOTS = [
  {
    slot: 1,
    title: 'Look straight at the camera',
    hi: 'सीधे देखें',
    body: 'Neutral expression, good light, nothing covering your face.',
  },
  {
    slot: 2,
    title: 'Now turn slightly to one side',
    hi: 'थोड़ा बगल में',
    body: 'A quarter turn is enough. This second angle is what makes the check reliable.',
  },
];

export default function Enroll() {
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [me, setMe] = useState(null);
  const [enrollment, setEnrollment] = useState(null);

  // ready → framing → review → sending
  const [phase, setPhase] = useState('ready');
  const [camErr, setCamErr] = useState(null);
  const [shot, setShot] = useState(null);      // { blob, url }
  const [target, setTarget] = useState(null);  // the SLOT being filled

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = body(await api.get('/v1/pahchan/me', { params: { days: 1 } }));
      setMe(r);
      const id = r?.employee?.id;
      if (id) {
        setEnrollment(body(await api.get(`/v1/pahchan/enrollment/${id}`)));
      }
    } catch (e) {
      setLoadErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Stop the camera. A live front camera left running is a light on a face. */
  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already gone */ } });
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    const url = shot?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [shot]);

  const startCamera = async (slot) => {
    setCamErr(null);
    setTarget(slot);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamErr('This browser cannot open the camera.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('framing');
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => { /* autoplay policy; poster shows */ });
        }
      });
    } catch {
      setCamErr('The camera could not be opened. Allow camera access and try again.');
      setPhase('ready');
    }
  };

  const shoot = async () => {
    const video = videoRef.current;
    if (!video) return;
    const blob = await compressCapture(video, video.videoWidth, video.videoHeight);
    stopCamera();
    if (!blob) {
      setCamErr('That frame could not be saved. Try once more.');
      setPhase('ready');
      return;
    }
    setShot({ blob, url: URL.createObjectURL(blob) });
    setPhase('review');
  };

  /**
   * Upload, then attach.
   *
   * Two calls because they fail independently and only the second is a claim
   * about identity. `punch/photo` returns an object KEY and never a URL — 07 §4,
   * so a key in a log or a cache is not an exposure.
   *
   * ⚠ NO PARTIAL SUCCESS IS REPORTED AS SUCCESS. If the attach fails, the bytes
   * are in the bucket and the slot is still empty, and the person is told the
   * slot is still empty. The opposite — a cheerful toast over a half-finished
   * enrollment — is how somebody ends up believing they are enrolled while every
   * punch stays flagged.
   */
  const saveSlot = async () => {
    if (!shot?.blob || !target || !me?.employee?.id) return;
    setPhase('sending');
    try {
      const fd = new FormData();
      fd.append('file', shot.blob, `reference-${target.slot}.jpg`);
      fd.append('kind', 'enroll');
      const key = body(await api.post('/v1/pahchan/punch/photo', fd)).photo_key;
      if (!key) throw new Error('no key');

      await api.post('/v1/pahchan/enrollment', {
        employee_id: me.employee.id,
        slot: target.slot,
        object_key: key,
        source: 'self_capture',
      });

      pushToast({
        type: 'success',
        title: `Photo ${target.slot} of 2 saved`,
        message: 'HR has to approve it before it counts as a reference.',
      });
      setShot(null);
      setTarget(null);
      setPhase('ready');
      load();
    } catch (e) {
      setPhase('review');
      const detail = e?.response?.data?.detail;
      pushToast({
        type: 'error',
        title: 'That photo was not saved',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    }
  };

  if (loading) return <SkeletonCard />;
  if (loadErr) {
    return (
      <ErrorState
        kind={errorKind(loadErr)}
        onRetry={load}
        title="Could not load your reference photos"
      />
    );
  }

  // Same sentence the clock screen gives, for the same reason: `_employee_for`
  // returns None for an account with no personnel row, and the endpoint would
  // answer 404 to a button that always fails.
  if (!me?.employee) {
    return (
      <Section title="Your reference photos" hi="पंजीकरण">
        <Note variant="warn">
          Your account is not linked to an employee record yet, so there is
          nothing to attach a photo to. Ask HR to link it — then this screen
          works with no further setup.
        </Note>
      </Section>
    );
  }

  const live = enrollment?.photos || [];
  const filled = new Set(live.map((p) => p.slot));
  // Only ever fills gaps. Replacing a live slot is HR's job: swapping a
  // reference to match a different face is the obvious attack, and the server
  // records a replacement as such rather than overwriting.
  const next = SLOTS.find((s) => !filled.has(s.slot));
  const pending = enrollment?.pending_approval || 0;

  return (
    <Section title="Your reference photos" hi="पंजीकरण">
      <p className="ph__clocklede">
        Two photographs, taken once. Every clock-in selfie is compared against
        them by a person — that is the whole of the check, so these two are worth
        a moment.
      </p>

      {/* What the server actually thinks, in the server's own terms. */}
      <p className="ph__clocklede">
        {enrollment?.complete
          ? 'Both photographs are approved. Your punches will not be flagged for a missing reference.'
          : `${live.length} of 2 taken${pending ? `, ${pending} waiting for HR to approve` : ''}.`}
      </p>

      {!enrollment?.complete && pending > 0 && (
        <Note variant="warn">
          A photograph counts as a reference only once HR has approved it. Until
          two are approved your punches stay flagged — that is expected, and it
          is not something you can clear from this screen.
        </Note>
      )}

      {phase === 'ready' && next ? (
        <div className="ph__clockready">
          <p className="ph__clocklede">
            <strong>{next.title}</strong> · {next.hi}
          </p>
          <p className="ph__clocklede">{next.body}</p>
          {camErr && <Note variant="warn">{camErr}</Note>}
          <div className="ph__clockacts">
            <button
              type="button"
              className="btn btn--fill btn--lg"
              onClick={() => startCamera(next)}
            >
              Take photo {next.slot} of 2
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'ready' && !next ? (
        <div className="ph__clockready">
          <p className="ph__clocklede">
            Both slots are filled. To change one, ask HR — a reference photo can
            be replaced, but not by the person it is of.
          </p>
        </div>
      ) : null}

      {phase === 'framing' ? (
        <div className="ph__clockcam">
          {/* Muted and playsInline or iOS Safari opens the system player over
              the page instead of showing the preview inline. */}
          <video
            ref={videoRef}
            className="ph__clockvideo"
            muted
            playsInline
            aria-label="Camera preview"
          />
          <div className="ph__clockacts">
            <button type="button" className="btn btn--fill btn--lg" onClick={shoot}>
              Take the photo
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => { stopCamera(); setPhase('ready'); setTarget(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'review' || phase === 'sending' ? (
        <div className="ph__clockcam">
          {shot?.url && (
            <img
              className="ph__clockshot"
              src={shot.url}
              alt={`Reference photograph ${target?.slot} about to be saved`}
            />
          )}
          <div className="ph__clockacts">
            <button
              type="button"
              className="btn btn--fill btn--lg"
              disabled={phase === 'sending'}
              onClick={saveSlot}
            >
              {phase === 'sending' ? 'Saving…' : `Use this as photo ${target?.slot}`}
            </button>
            <button
              type="button"
              className="btn"
              disabled={phase === 'sending'}
              onClick={() => { setShot(null); startCamera(target); }}
            >
              Retake
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
