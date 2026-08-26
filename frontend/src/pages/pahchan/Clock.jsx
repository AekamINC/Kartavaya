import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonCard } from '../../components/ui/Skeleton';
import Note from '../../components/module/Note';
import { AttendanceNotice } from './Notice';
import { PAHCHAN_NOTICE_VERSION } from '../../lib/pahchanNotice';
import {
  captureGeoFix, compressCapture, newClientPunchId, nextDirection,
} from '../../lib/pahchanClock';

/**
 * Clock — clocking in and out from a browser.
 *
 * WHY THIS EXISTS. `POST /v1/pahchan/punch` has been complete for months —
 * geofence, altitude, accuracy flags, idempotency, photo. It had exactly one
 * caller: `mobile/src/screens/pahchan/ClockScreen.tsx`. There is no iOS build of
 * that app, so an employee on an iPhone could not clock in at all, while the web
 * app carried every reviewer screen and no way to punch. This is the missing
 * caller, not a second implementation: no new endpoint, no new table, no
 * migration.
 *
 * ── THE SELFIE IS MANDATORY HERE, AND §2 STILL HOLDS ───────────────────────
 *
 * The owner asked for a mandatory selfie. This screen will not submit without
 * one: there is no skip control and the send button does not exist until a frame
 * has been captured. That is the mandate, and it is enforced where a mandate
 * belongs — in front of the person, before the punch is made.
 *
 * What it deliberately does NOT do is refuse a punch server-side. §2 of
 * `07-pahchan.md` is that NOTHING BLOCKS A PUNCH, and `ClockScreen.tsx` records
 * what happened the one time a client tried: it hid the shutter after three
 * camera errors, and "three camera errors in a dark doorway locked someone out
 * of clocking in entirely". `retry_count` exists because of that.
 *
 * So: mandatory while the camera works, which is essentially always, and after
 * repeated failures the screen offers to record the punch flagged rather than
 * take the shift away. "A blocked punch at a client site becomes a payroll
 * dispute a week later, and the employee is right."
 *
 * ── THE PHOTO IS COMPRESSED BEFORE IT LEAVES ───────────────────────────────
 *
 * `MAX_PHOTO_BYTES` is 768 KB and a front-camera JPEG is 2–4 MB, so an
 * uncompressed capture is refused outright. `compressCapture` walks a quality
 * ladder down to a 600 KB budget. Without it the mandatory selfie would be the
 * thing that loses the punch.
 *
 * ── ORDER OF OPERATIONS ────────────────────────────────────────────────────
 *
 * Photo first, then punch — the opposite of the mobile client, and for a reason
 * that is specific to the web. Mobile owns an offline queue: it enqueues the
 * punch immediately, uploads the photo whenever a network appears, and calls
 * `attachPhotoKey` later. This screen has no queue, so a punch recorded before a
 * failed upload would be a punch permanently without its photo, which is exactly
 * what the mandate is against. Uploading first means the punch carries its key
 * or the employee is told why it does not.
 *
 * `captured_at` is still the moment the shutter fired, never the moment the
 * upload finished. The server's `received_at` records the latter on its own, and
 * 07 §4 is explicit that the two are not interchangeable: "the gap between them
 * is also the only honest place to spot a device clock that has been moved".
 */

/** How many camera failures before the screen offers a punch without a photo. */
const RETRIES_BEFORE_ESCAPE = 3;

const DIRECTION_LABEL = { in: 'Clock in', out: 'Clock out' };
const DIRECTION_HI = { in: 'उपस्थिति', out: 'प्रस्थान' };

/** Flags the employee can act on, in words rather than tokens. */
const FLAG_WORDS = {
  geo: 'Location was unavailable, so this punch is flagged for review.',
  accuracy: 'Your location was not precise enough, so this punch is flagged.',
  noref: 'You have no approved reference photos yet, so this punch is flagged.',
  mock: 'This device reported a simulated location, so this punch is flagged.',
  offline: 'Recorded offline and synced later.',
  overtime: 'This punch falls outside your shift, so it is flagged as overtime.',
  late: 'This punch is after your shift start, so it is flagged as late.',
  retries: 'The camera failed more than once before this capture.',
  reuse: 'This photo was reused from an earlier capture.',
};

function flagSentences(flags) {
  return (Array.isArray(flags) ? flags : [])
    .map((f) => FLAG_WORDS[f])
    .filter(Boolean);
}

export default function Clock() {
  const { pushToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [me, setMe] = useState(null);
  const [localAck, setLocalAck] = useState(null);
  const [ackSaving, setAckSaving] = useState(false);

  // ready → framing → review → sending → done
  const [phase, setPhase] = useState('ready');
  const [camErr, setCamErr] = useState(null);
  const [retries, setRetries] = useState(0);
  const [shot, setShot] = useState(null);       // { blob, url, capturedAt }
  const [result, setResult] = useState(null);   // last punch, for the done panel

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  // The id is minted once per punch attempt and survives retries of that punch,
  // which is what makes the server's idempotency check do anything.
  const punchIdRef = useRef(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await api.get('/v1/pahchan/me', {
        params: { days: 2, notice_version: PAHCHAN_NOTICE_VERSION },
      });
      setMe(body(r));
    } catch (e) {
      setLoadErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Stop the camera. Called on unmount, after a capture, and on every error —
   *  a live front camera left running is a light on somebody's face. */
  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already gone */ } });
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // Release the object URL for a discarded capture rather than leaking it for
  // the life of the tab.
  useEffect(() => {
    const url = shot?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [shot]);

  const startCamera = async () => {
    setCamErr(null);
    if (!punchIdRef.current) punchIdRef.current = newClientPunchId();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamErr('This browser cannot open the camera.');
      setRetries((n) => n + 1);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('framing');
      // The <video> only exists once phase is 'framing', so attach on the next
      // frame rather than to a ref that is still null.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => { /* autoplay policy; the poster still shows */ });
        }
      });
    } catch {
      // Denied, in use by another app, or no camera. All the same to the person
      // holding the phone: the shutter is not going to open.
      setCamErr('The camera could not be opened. Allow camera access and try again.');
      setRetries((n) => n + 1);
      setPhase('ready');
    }
  };

  const shoot = async () => {
    const video = videoRef.current;
    if (!video) return;
    const capturedAt = new Date().toISOString();
    const blob = await compressCapture(video, video.videoWidth, video.videoHeight);
    stopCamera();
    if (!blob) {
      setCamErr('That frame could not be saved. Try once more.');
      setRetries((n) => n + 1);
      setPhase('ready');
      return;
    }
    setShot({ blob, url: URL.createObjectURL(blob), capturedAt });
    setPhase('review');
  };

  const retake = () => {
    setShot(null);
    setRetries((n) => n + 1);
    startCamera();
  };

  /**
   * Send the punch.
   *
   * @param {Blob|null} blob        the selfie, or null on the escape path
   * @param {string}    capturedAt  when the shutter fired, not when this ran
   */
  const send = async (blob, capturedAt) => {
    setPhase('sending');
    const direction = nextDirection(me?.punches);
    if (!punchIdRef.current) punchIdRef.current = newClientPunchId();

    let photoKey = null;
    let photoNote = null;
    if (blob) {
      try {
        const fd = new FormData();
        fd.append('file', blob, 'selfie.jpg');
        fd.append('kind', 'punch');
        photoKey = body(await api.post('/v1/pahchan/punch/photo', fd)).photo_key || null;
      } catch (e) {
        // The punch still goes. Losing the photo is bad; losing the shift is
        // worse, and the server flags a photo-less punch on its own.
        photoNote = errorKind(e) === 'offline'
          ? 'The photo could not be sent on this connection, so the punch was recorded without it.'
          : 'The photo could not be stored, so the punch was recorded without it.';
      }
    }

    // After the photo, so a slow upload does not age the fix. §2: a null fix is
    // a flag, never a refusal.
    const geo = await captureGeoFix();

    try {
      const r = await api.post('/v1/pahchan/punch', {
        direction,
        captured_at: capturedAt,
        client_punch_id: punchIdRef.current,
        source: 'live',
        retry_count: Math.min(retries, 99),
        photo_key: photoKey,
        ...(geo || {}),
      });
      const out = body(r);
      const punch = out.punch || out;
      setResult({
        direction: punch.direction || direction,
        flags: punch.flags || [],
        duplicate: !!out.duplicate,
        photoNote,
      });
      setPhase('done');
      setShot(null);
      punchIdRef.current = null;
      setRetries(0);
      pushToast({
        type: 'success',
        title: direction === 'in' ? 'Clocked in ✓' : 'Clocked out ✓',
      });
      load();
    } catch (e) {
      setPhase(blob ? 'review' : 'ready');
      const detail = e?.response?.data?.detail;
      pushToast({
        type: 'error',
        title: 'The punch was not recorded',
        message: typeof detail === 'string' ? detail : 'Try again.',
      });
    }
  };

  if (loading) return <SkeletonCard />;
  if (loadErr) {
    return <ErrorState kind={errorKind(loadErr)} onRetry={load} title="Could not load your attendance" />;
  }

  const acknowledgedAt = localAck || me?.notice?.acknowledged_at || null;

  // The notice comes before the camera, not after. 07 §9: somebody whose face is
  // photographed twice a day reads what is held and for how long BEFORE the
  // first capture, not once it is already stored.
  if (!acknowledgedAt) {
    return (
      <Section title="Before your first clock-in" hi="सूचना">
        <AttendanceNotice
          retention={me?.retention}
          acknowledgedAt={null}
          saving={ackSaving}
          onAcknowledge={async () => {
            setAckSaving(true);
            try {
              const out = body(await api.post('/v1/pahchan/notice/ack', {
                version: PAHCHAN_NOTICE_VERSION,
              }));
              setLocalAck(out.acknowledged_at || new Date().toISOString());
            } catch {
              pushToast({ type: 'error', title: 'Could not record that you read this' });
            } finally {
              setAckSaving(false);
            }
          }}
        />
      </Section>
    );
  }

  // `_employee_for` returns None for accounts with no personnel row, and
  // `create_punch` answers 409. Saying so here beats a button that always fails.
  if (!me?.employee) {
    return (
      <Section title="Clock in" hi="उपस्थिति">
        <Note variant="warn">
          Your account is not linked to an employee record yet, so a punch has
          nothing to attach to. Ask HR to link it — then this screen works with
          no further setup.
        </Note>
      </Section>
    );
  }

  const direction = nextDirection(me?.punches);
  const canEscape = retries >= RETRIES_BEFORE_ESCAPE;

  return (
    <Section title={DIRECTION_LABEL[direction]} hi={DIRECTION_HI[direction]}>
      {phase === 'done' && result ? (
        <div className="ph__clockdone">
          <p className="ph__clocklede">
            {result.duplicate
              ? 'This punch was already recorded — you are not clocked twice.'
              : result.direction === 'in' ? 'You are clocked in.' : 'You are clocked out.'}
          </p>
          {result.photoNote && <Note variant="warn">{result.photoNote}</Note>}
          {flagSentences(result.flags).map((sentence) => (
            <Note key={sentence} variant="warn">{sentence}</Note>
          ))}
          <div className="ph__clockacts">
            <button type="button" className="btn" onClick={() => { setResult(null); setPhase('ready'); }}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'ready' ? (
        <div className="ph__clockready">
          <p className="ph__clocklede">
            A selfie is recorded with every punch, and your location if it is
            available. Nothing here works without the camera.
          </p>
          {camErr && <Note variant="warn">{camErr}</Note>}
          <div className="ph__clockacts">
            <button type="button" className="btn btn--fill btn--lg" onClick={startCamera}>
              {DIRECTION_LABEL[direction]}
            </button>
            {canEscape && (
              <button
                type="button"
                className="btn"
                onClick={() => send(null, new Date().toISOString())}
              >
                Record without a photo
              </button>
            )}
          </div>
          {canEscape && (
            <Note variant="warn">
              The camera has failed {retries} times. You can record this punch
              without a photo — it will be flagged for review rather than lost.
            </Note>
          )}
        </div>
      ) : null}

      {phase === 'framing' ? (
        <div className="ph__clockcam">
          {/* Muted and playsInline or iOS Safari refuses to play it inline and
              opens the system player over the page instead. */}
          <video ref={videoRef} className="ph__clockvideo" muted playsInline aria-label="Camera preview" />
          <div className="ph__clockacts">
            <button type="button" className="btn btn--fill btn--lg" onClick={shoot}>
              Take the photo
            </button>
            <button type="button" className="btn" onClick={() => { stopCamera(); setPhase('ready'); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'review' || phase === 'sending' ? (
        <div className="ph__clockcam">
          {shot?.url && <img className="ph__clockshot" src={shot.url} alt="The selfie about to be sent" />}
          <div className="ph__clockacts">
            <button
              type="button"
              className="btn btn--fill btn--lg"
              disabled={phase === 'sending'}
              onClick={() => send(shot?.blob, shot?.capturedAt)}
            >
              {phase === 'sending' ? 'Sending…' : DIRECTION_LABEL[direction]}
            </button>
            <button type="button" className="btn" disabled={phase === 'sending'} onClick={retake}>
              Retake
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
