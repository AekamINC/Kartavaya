import React, { useCallback, useEffect, useState } from 'react';
import { api, body } from '../../lib/api';
import { Card } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonCard } from '../../components/ui/Skeleton';
import {
  NOTICE_TITLE, NOTICE_LEDE, NOTICE_ACK, NOTICE_LEGAL,
  PAHCHAN_NOTICE_VERSION, noticeLines,
} from '../../lib/pahchanNotice';

/**
 * The DPDP notice, on the web.
 *
 * The prototype's `PhNotice` (`PahchanClock.jsx:174-206`), which existed nowhere
 * in the product. Two of its six lines were already stated in the build's own
 * words — `History.jsx`'s retention `Note` and `MyBiometrics.tsx`'s retention
 * block — and four of them (What is captured, Why, Face recognition, Your
 * rights) had never been written anywhere on either platform. Notably absent
 * before this: the string "Data Protection Board", in `frontend/src`,
 * `mobile/src` and `backend/` alike.
 *
 * ── WEB IS READ-AND-ACKNOWLEDGE, NOT A GATE ───────────────────────────────────
 *
 * A notice is served BEFORE the processing it describes. On the phone that
 * processing is a punch, so the notice is a gate there — it sits above the
 * camera-permission screen, because you tell somebody why you want their camera
 * before you ask for it. On the web there is no capture path at all (the browser
 * pages only VIEW photographs; `backend/routers/pahchan.py:95` says so), so
 * there is nothing here to gate. This tab is where an employee reads it again
 * afterwards, and where somebody who has never installed the app can acknowledge
 * it.
 *
 * The acknowledgement is keyed on the ACCOUNT, not the device and not the
 * employee record, so acknowledging here means the mobile gate never fires, and
 * vice versa. Migration 113 records the measurement behind that choice: 81
 * employee rows, 0 of them carrying a `user_id`, so `_employee_for` resolves
 * nobody and an employee-keyed row could not accept one acknowledgement from one
 * person. Which is why this tab offers the button to anyone signed in, and does
 * not check `data.employee` first.
 *
 * ── IT IS NEVER HIDDEN AFTER ACKNOWLEDGEMENT ─────────────────────────────────
 *
 * 07 §9: "someone whose face is photographed twice a day should be able to see
 * what is held and for how long without asking". Once acknowledged the button is
 * replaced by the date — not by nothing, and not by a live button that would
 * re-post — and the six lines stay exactly where they were.
 */

function ackDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The card body. Split out from the tab so that the words render identically
 * whether or not there is a request in flight around them, and so the test can
 * mount it without a network.
 *
 * `acknowledgedAt` null and `onAcknowledge` present  → the button.
 * `acknowledgedAt` set                               → the date.
 * `onAcknowledge` absent                             → neither (reference only).
 */
export function AttendanceNotice({ retention, acknowledgedAt, onAcknowledge, saving, saveNote }) {
  const [open, setOpen] = useState(null);
  const lines = noticeLines(retention);

  return (
    <Card title={NOTICE_TITLE.en} sanskrit={NOTICE_TITLE.hi}>
      <div className="phn">
        <p className="phn__lede">{NOTICE_LEDE}</p>

        {lines.map((line, i) => (
          <div className="phn__row" key={line.key}>
            <button
              type="button"
              className="phn__q"
              /* One open at a time, as the prototype does — `open === i ? null : i`.
                 Six paragraphs open at once is the policy page this exists to
                 not be. */
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              aria-controls={`phn-a-${i}`}
            >
              <span className="phn__k">{line.key}</span>
              {/* Rotates 90° on open, per the prototype. `aria-hidden` because
                  `aria-expanded` on the button already carries the state — the
                  chevron is the same fact drawn. */}
              <svg className="phn__chev" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* Always in the DOM and hidden when closed, so the text is findable
                by the browser's own find-in-page and by a screen reader following
                aria-controls. A notice that only exists once you have clicked the
                right row is a notice you can be argued out of having read. */}
            <p className="phn__a" id={`phn-a-${i}`} hidden={open !== i}>
              {line.text}
            </p>
          </div>
        ))}

        <div className="phn__foot">
          {acknowledgedAt ? (
            <p className="phn__read">
              You read this on {ackDate(acknowledgedAt) || 'a date this browser could not read'}.
            </p>
          ) : onAcknowledge ? (
            <button
              type="button"
              className="btn btn--fill phn__ack"
              onClick={onAcknowledge}
              disabled={saving}
            >
              {saving ? 'Saving…' : NOTICE_ACK}
            </button>
          ) : null}

          {saveNote && <p className="phn__note">{saveNote}</p>}

          <p className="phn__legal">{NOTICE_LEGAL}</p>
        </div>
      </div>
    </Card>
  );
}

export default function Notice() {
  const [state, setState] = useState('loading');
  const [errKind, setErrKind] = useState('server');
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState(null);
  /** Set the instant the button is pressed, so the surface settles even if the
   *  write is refused. See `acknowledge` below. */
  const [localAck, setLocalAck] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      // `days: 1` — this tab wants `retention` and `notice`, not the register.
      const r = await api.get('/v1/pahchan/me', { params: { days: 1 } });
      setData(body(r));
      setState('ready');
    } catch (err) {
      setErrKind(errorKind(err));
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Acknowledge — and settle the surface whatever the server says.
   *
   * `POST /notice/ack` answers 200 with `stored: false` when the table from
   * migration 113 is not there yet, because that migration is UNAPPLIED and a
   * notice that cannot be acknowledged until a DBA runs a file is a worse
   * product than the gap it fills. A transport failure is treated the same way
   * on this surface for the same reason — but it says so, rather than showing a
   * date it did not earn.
   */
  const acknowledge = useCallback(async () => {
    setSaving(true);
    setSaveNote(null);
    try {
      const r = await api.post('/v1/pahchan/notice/ack', {
        version: PAHCHAN_NOTICE_VERSION,
        // 113's two clocks. On the web they are the same moment — there is no
        // offline gate here — but the column is NOT NULL and the server must not
        // be the one inventing when somebody read something.
        acknowledged_at: new Date().toISOString(),
        source: 'web',
        was_offline: false,
      });
      const out = body(r) || {};
      setLocalAck(out.acknowledged_at || new Date().toISOString());
      if (out.stored === false) {
        setSaveNote('Recorded on this device. Your organisation’s record of it is not switched on yet.');
      }
    } catch {
      setLocalAck(new Date().toISOString());
      setSaveNote('Recorded on this device. It could not be saved to your organisation’s record just now.');
    } finally {
      setSaving(false);
    }
  }, []);

  if (state === 'loading') {
    return (
      <SkeletonRegion label="Loading the attendance notice…">
        <SkeletonCard lines={8} />
      </SkeletonRegion>
    );
  }

  if (state === 'error') {
    // The words are not behind the request — only the org's retention figures
    // and the acknowledgement are. So the notice still renders, on the defaults,
    // and the retry sits under it. Refusing to show a legal notice because a
    // GET failed is the one outcome this file must never produce.
    return (
      <>
        <AttendanceNotice retention={null} acknowledgedAt={localAck} />
        <ErrorState
          kind={errKind}
          detail={
            errKind === 'offline'
              ? 'The figures above are the standard ones. Your organisation’s own retention windows need a connection to load.'
              : 'The figures above are the standard ones. Your organisation’s own retention windows did not load.'
          }
          onRetry={load}
        />
      </>
    );
  }

  return (
    <AttendanceNotice
      retention={data?.retention}
      acknowledgedAt={localAck || data?.notice?.acknowledged_at || null}
      // Offered to anyone signed in. The row is keyed on the account, so an
      // employee record is not needed to write one — and today nobody has one
      // that resolves (113: 0 of 81 rows carry a user_id).
      onAcknowledge={acknowledge}
      saving={saving}
      saveNote={saveNote}
    />
  );
}
