import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Button } from '../ui';
import Seg from './Seg';
import DateInput from '../ui/DateInput';

/**
 * NotifyPrefs — the nine per-event delivery modes and the quiet-hours window.
 *
 * 09 §2 lists `EmailToggles` and `DndSchedule` in the TabNotifications tree and
 * §4 points them at a `user_preferences` table that does not exist. The
 * capability does exist, under a different name and already enforced:
 * `GET/PUT /api/me/notification_prefs` stores a mode per event kind plus
 * `quiet_start` / `quiet_end`, and `services/push_service.py` refuses delivery
 * for a suppressed kind and inside the quiet window. There was no UI for any of
 * it — nine switches and a schedule, live in production, unreachable.
 *
 * So this is wired to the real endpoint rather than to the specced one, and the
 * window is not mirrored into `k_prefs`: a second copy in localStorage is one
 * no sender reads, which would make the schedule appear set and silence
 * nothing.
 *
 * PUT replaces the whole row — prefs, quiet_start and quiet_end together — so
 * every save sends the merged object. Sending only the field that changed would
 * reset the other two to their defaults on every keystroke.
 */

/* Mirrors DEFAULT_PREFS in services/push_service.py — same keys, same
   defaults, same order, so a diff between the two is readable. `fallback`
   exists only for the case where the server returns a key it did not merge; a
   blanket 'always' there would silently promote the three kinds the backend
   deliberately keeps quiet. */
const KINDS = [
  { id: 'mention',          label: 'Mentions',          fallback: 'always',    hint: 'Someone writes @you in a comment or description.' },
  { id: 'assigned',         label: 'Assigned to me',    fallback: 'always',    hint: 'A task is assigned to you.' },
  { id: 'approval_request', label: 'Approval requests', fallback: 'always',    hint: 'Something is waiting on your decision.' },
  { id: 'approved',         label: 'Approved',          fallback: 'always',    hint: 'A request you raised was approved.' },
  { id: 'rejected',         label: 'Rejected',          fallback: 'always',    hint: 'A request you raised was rejected.' },
  { id: 'comment',          label: 'Comments',          fallback: 'mine_only', hint: 'A new comment on a task.' },
  { id: 'status_changed',   label: 'Status changes',    fallback: 'project',   hint: 'A task moves between columns.' },
  { id: 'done',             label: 'Completions',       fallback: 'project',   hint: 'A task is marked done.' },
  { id: 'created',          label: 'New tasks',         fallback: 'off',       hint: 'A task is created in a project you are in.' },
  /* These two were ENFORCED ON DELIVERY AND INVISIBLE HERE. `push_service.py`
     carried both and this list carried neither, so a user could not reach a
     switch that was already gating their notifications. */
  { id: 'reminder',         label: 'Task reminders',    fallback: 'always',    hint: 'A task of yours is coming due.' },
  { id: 'message',          label: 'Messages',          fallback: 'always',    hint: 'Somebody writes in a channel or sends you a direct message.' },
];

/* The backend's four modes. `project` and `mine_only` are not synonyms —
   `mine_only` delivers when the event is yours, `project` delivers for anything
   in a project you belong to. Both are offered because the difference is the
   whole reason comments default to one and status changes to the other. */
const MODES = [
  { label: 'Off',     value: 'off' },
  { label: 'Mine',    value: 'mine_only' },
  { label: 'Project', value: 'project' },
  { label: 'All',     value: 'always' },
];

const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export default function NotifyPrefs() {
  const [prefs, setPrefs]   = useState(null);
  const [from,  setFrom]    = useState('22:00');
  const [to,    setTo]      = useState('07:00');
  const [state, setState]   = useState('loading'); // loading | ready | error | saving | saved

  // What the server is KNOWN to hold. Two jobs:
  //
  //  · a blur that changed nothing writes nothing. Clicking "Save window" blurs
  //    the field first, so without this the one deliberate save is two PUTs.
  //  · it is the rollback target. `setMode` paints the new mode before the PUT
  //    resolves, which is right — a segmented control that lags a round-trip
  //    feels broken — but it means a REJECTED write used to leave the switch
  //    showing a value the server never accepted. The only feedback was the
  //    status span inside the quiet-hours block, several rows above the control
  //    that was just clicked, so the realistic outcome was a user who believes
  //    they turned "New tasks" off and keeps being notified. A control that
  //    reports a setting the server does not have is worse than no control.
  const saved = useRef({ from: '22:00', to: '07:00', prefs: {} });

  useEffect(() => {
    let live = true;
    api.get('/me/notification_prefs')
      .then(({ data }) => {
        if (!live) return;
        const loaded = data.prefs || {};
        setPrefs(loaded);
        setFrom(data.quiet_start || '22:00');
        setTo(data.quiet_end || '07:00');
        saved.current = {
          from:  data.quiet_start || '22:00',
          to:    data.quiet_end   || '07:00',
          prefs: loaded,
        };
        setState('ready');
      })
      .catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, []);

  // Resolves to whether the write landed, so the caller can roll its optimistic
  // paint back. Only a SUCCESSFUL put updates `saved.current` — on failure it
  // still describes the server, which is what makes it a safe rollback target.
  const save = async (nextPrefs, nextFrom, nextTo) => {
    setState('saving');
    try {
      await api.put('/me/notification_prefs', {
        prefs: nextPrefs, quiet_start: nextFrom, quiet_end: nextTo,
      });
      saved.current = { from: nextFrom, to: nextTo, prefs: nextPrefs };
      setState('saved');
      return true;
    } catch {
      setState('error');
      return false;
    }
  };

  const setMode = async (kind, mode) => {
    const next = { ...prefs, [kind]: mode };
    setPrefs(next);
    // The window is sent with it because PUT replaces the whole row, but the
    // rollback is prefs-only: a failed mode change must not also discard a
    // quiet-hours edit the user is part-way through typing.
    if (!await save(next, from, to)) setPrefs(saved.current.prefs);
  };

  // The two time fields commit on blur, not on change: a partially-typed "0"
  // is a valid keystroke and an invalid window, and writing it would hand the
  // server a value whose HH:MM parser splits it into nothing.
  const commitWindow = () => {
    if (!isHHMM(from) || !isHHMM(to)) return;
    if (saved.current.from === from && saved.current.to === to) return;
    save(prefs, from, to);
  };

  if (state === 'loading') {
    return <div className="sr__d">Loading your notification preferences…</div>;
  }
  if (state === 'error' && !prefs) {
    return (
      <div className="sr__d" role="alert">
        Couldn’t load your notification preferences. They are unchanged — reload to try again.
      </div>
    );
  }

  const windowValid = isHHMM(from) && isHHMM(to);

  return (
    <>
      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Quiet hours</div>
          <div className="sr__d">
            Push notifications are held inside this window. It wraps midnight, so
            22:00 to 07:00 is overnight. Evaluated in IST on the server, which is
            where delivery is decided — not on this device.
          </div>
        </div>
        <div className="nqh">
          <label className="fldx nqh__f">
            <span className="fldx__lbl"><span>From</span></span>
            <DateInput
              className="fldx__in" type="time" value={from}
              onChange={e => setFrom(e.target.value)} onBlur={commitWindow}
            />
          </label>
          <label className="fldx nqh__f">
            <span className="fldx__lbl"><span>To</span></span>
            <DateInput
              className="fldx__in" type="time" value={to}
              onChange={e => setTo(e.target.value)} onBlur={commitWindow}
            />
          </label>
          <Button variant="out" size="sm" onClick={commitWindow} disabled={!windowValid}>
            Save window
          </Button>
          <span className="nqh__s" role="status">
            {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : ''}
          </span>
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">What to notify me about</div>
          <div className="sr__d">
            <strong>Mine</strong> sends only when the event is yours;{' '}
            <strong>Project</strong> sends for anything in a project you belong to.
            These govern push to your devices — the in-app bell always records
            everything.
          </div>
          {/* The failure has to be reported HERE, beside the switches, not only
              in the quiet-hours status span. `role="alert"` because it appears
              in response to the user's own click and they are looking at the
              control, not at this line. The switch has already rolled back to
              the server's value by the time this renders, so the sentence and
              the control agree. */}
          {state === 'error' && (
            <div className="sr__d" role="alert" style={{ color: 'var(--danger)' }}>
              That didn’t save — the setting has been put back to what the server
              has. Check your connection and try again.
            </div>
          )}
        </div>
        <div className="nkind">
          {KINDS.map(k => (
            <div className="nkind__r" key={k.id}>
              <div className="sr__l">
                <div className="sr__t">{k.label}</div>
                <div className="sr__d">{k.hint}</div>
              </div>
              <Seg
                label={k.label}
                value={prefs?.[k.id] || k.fallback}
                onChange={m => setMode(k.id, m)}
                options={MODES}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
