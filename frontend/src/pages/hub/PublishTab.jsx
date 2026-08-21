// Hub → Publish. Schedule the posts, watch the queue, read the calendar.
//
// ── The merge ────────────────────────────────────────────────────────────────
//
// There were two of these. `HubDashboardPage` had the newer one — a content
// calendar, a platform enable/disable panel, thirteen platforms, manual-token
// fields for Telegram / Reddit / Pinterest and an EXPIRED marker on a stale
// OAuth token. `HubClientDetailPage` had a copy with none of that, against the
// same endpoints. This file is the newer behaviour, rendered by both routes.
//
// ── The split, which is the same lesson a second time ────────────────────────
//
// CONNECTING IS NOT HERE ANY MORE. The Connect / Reconnect / Disconnect
// buttons, the manual-token form and the "no credentials saved" banner all
// moved to the Social accounts page (`pages/SocialAccountsPage.jsx` +
// `pages/social/*`), which was built to hold a network's APP and its ACCOUNTS
// on one card — the question neither of the old screens could answer on its
// own was "does this network actually work?", and it needs both halves.
//
// They lived in both places for a while, and two copies of a connect flow is
// strictly worse than one in the wrong place: this file's cards decided what
// was connectable from `/clients/{id}/platforms` while the new page decided it
// from `connectors/social-status`, so the two screens could disagree about
// whether a firm could post to Instagram and neither was obviously wrong.
// The components they used are untouched and still exported — other things
// reach them — this file simply stopped being a second door.
//
// WHAT STAYED, and why. Everything downstream of a connected account: the
// queue, the calendar, scheduling a post and publishing one now. Those are
// Sahayak work done against content that lives here, and they are gated on
// `editor` — SENDING — while connecting is gated on `admin`. Two rungs, two
// screens, and now the screens match the rungs.
//
// THE PLATFORM ALLOW-LIST IS THE ONE EXCEPTION and is still below. It has no
// home on the Social accounts page yet — `connectors/social-status` does not
// read `hub_client_platforms` at all — and deleting the only screen for a live
// endpoint is not moving it. It belongs on that page, on the same per-network
// card, and moving it is owed.
//
// ── Why the queue's empty state is dangerous ─────────────────────────────────
//
// "No posts in queue" over a failed fetch tells someone their scheduled posts
// are not going out when they may be about to. The accounts request, the queue
// request and the allow-list request are therefore reported separately: two of
// them were once a `Promise.all` in one try/catch, so a queue failure blanked
// the other half as well and the person could not tell which had broken.
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, rows as unwrapRows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  PLATFORMS, QUEUE_TONE, StatusPill, ErrorNote, Shim,
  errText, stamp, thisMonth, words, platformOf,
} from './_shared';
import DateInput from '../../components/ui/DateInput';

const QUEUE_FILTERS = [['', 'All'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed'], ['cancelled', 'Cancelled']];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Where connecting lives now. Named once so every sentence below agrees. */
const SOCIAL_ACCOUNTS = '/settings/social-accounts';

export default function PublishTab({ clientId }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Sahayak content' });
  const { pushToast } = useToast();

  const [accounts, setAccounts] = useState({ loading: true, error: '', list: null });
  const [queue, setQueue] = useState({ loading: true, error: '', list: null });
  const [enabled, setEnabled] = useState({ loading: true, error: '', keys: null });

  const [view, setView] = useState('queue');
  const [queueFilter, setQueueFilter] = useState('');
  const [calMonth, setCalMonth] = useState(thisMonth);
  const [calendar, setCalendar] = useState({ loading: false, error: '', list: null });

  const [showMgmt, setShowMgmt] = useState(false);
  const [pending, setPending] = useState([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ content_id: '', scheduled_for: '' });
  const [targets, setTargets] = useState([]);
  const [content, setContent] = useState({ loading: false, error: '', list: null });
  const [busy, setBusy] = useState(false);

  /* ── Loaders. One request, one state, one failure. ───────────────────── */

  const loadAccounts = useCallback(async () => {
    if (!clientId) return;
    setAccounts(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/social-accounts`);
      setAccounts({ loading: false, error: '', list: unwrapRows(r) });
    } catch (err) {
      setAccounts({ loading: false, error: errText(err), list: null });
    }
  }, [clientId]);

  const loadQueue = useCallback(async () => {
    if (!clientId) return;
    setQueue(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/publish/queue`);
      setQueue({ loading: false, error: '', list: unwrapRows(r) });
    } catch (err) {
      setQueue({ loading: false, error: errText(err), list: null });
    }
  }, [clientId]);

  const loadEnabled = useCallback(async () => {
    if (!clientId) return;
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/platforms`);
      setEnabled({ loading: false, error: '', keys: r.data?.enabled || [] });
    } catch (err) {
      // A failed allow-list must NOT silently fall back to "everything is
      // enabled" — the previous code did exactly that, so a 403 on this route
      // rendered every platform as available to a client that had none.
      setEnabled({ loading: false, error: errText(err), keys: null });
    }
  }, [clientId]);

  useEffect(() => { loadAccounts(); loadQueue(); loadEnabled(); }, [loadAccounts, loadQueue, loadEnabled]);

  useEffect(() => {
    if (view !== 'calendar' || !clientId) return;
    let live = true;
    (async () => {
      setCalendar({ loading: true, error: '', list: null });
      try {
        const r = await api.get(`/v1/hub/clients/${clientId}/calendar`, { params: { month: calMonth } });
        if (live) setCalendar({ loading: false, error: '', list: unwrapRows(r) });
      } catch (err) {
        if (live) setCalendar({ loading: false, error: errText(err), list: null });
      }
    })();
    return () => { live = false; };
  }, [view, calMonth, clientId]);

  // THE OAUTH RETURN LEG IS NOT HERE. It used to be — an effect watching for
  // `?oauth=success` on this tab — and it was already dead: the callback in
  // `routers/hub_publish.oauth_callback` redirects to `/settings/social-accounts`
  // with `oauth=choose` or `oauth=nodestination`, and deliberately never sends
  // `success`, because nothing is connected until a human picks a destination.
  // A toast here saying "connected" was the same lie the old first-Page guess
  // told. `pages/social/DestinationPicker.jsx` reads those parameters now.

  /* ── Actions ─────────────────────────────────────────────────────────── */

  async function saveEnabled() {
    setBusy(true);
    try {
      await api.put(`/v1/hub/clients/${clientId}/platforms`, { platforms: pending });
      setEnabled({ loading: false, error: '', keys: pending });
      setShowMgmt(false);
      pushToast({ title: 'Platforms updated', type: 'success' });
    } catch (err) {
      pushToast({ title: errText(err, 'Could not update the platform list.'), type: 'error' });
    } finally { setBusy(false); }
  }

  // `connectOAuth`, `connectManual` and `disconnect` were here. All three now
  // live on the Social accounts page, where the app credentials they depend on
  // are visible on the same card — `pages/social/AccountsPanel.jsx` and
  // `pages/social/NetworkCard.jsx`.

  async function loadContent() {
    setContent({ loading: true, error: '', list: null });
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/content`);
      setContent({ loading: false, error: '', list: unwrapRows(r) });
    } catch (err) {
      setContent({ loading: false, error: errText(err), list: null });
    }
  }

  async function schedule(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (targets.length > 1) {
        await api.post(`/v1/hub/clients/${clientId}/publish/bulk-schedule`, {
          content_id: scheduleForm.content_id, account_ids: targets, scheduled_for: scheduleForm.scheduled_for,
        });
        pushToast({ title: `Scheduled to ${targets.length} accounts`, type: 'success' });
      } else {
        await api.post(`/v1/hub/clients/${clientId}/publish/schedule`, {
          ...scheduleForm, social_account_id: targets[0],
        });
        pushToast({ title: 'Post scheduled', type: 'success' });
      }
      setShowSchedule(false);
      setScheduleForm({ content_id: '', scheduled_for: '' });
      setTargets([]);
      loadQueue();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not schedule the post.'), type: 'error' });
    } finally { setBusy(false); }
  }

  async function queueAction(id, action, label) {
    try {
      await api.post(`/v1/hub/publish/queue/${id}/${action}`);
      pushToast({ title: label, type: 'success' });
      loadQueue();
    } catch (err) {
      pushToast({ title: errText(err, `Could not ${action.replace('-', ' ')}.`), type: 'error' });
    }
  }

  /* ── Derived ─────────────────────────────────────────────────────────── */

  const accList = accounts.list;
  // Only ever derived from a list we actually received. There is deliberately
  // no `: PLATFORMS` fallback — see the allow-list block below.
  const allowed = enabled.keys ? PLATFORMS.filter(p => enabled.keys.includes(p.key)) : [];
  const shownQueue = queue.list
    ? (queueFilter ? queue.list.filter(q => q.status === queueFilter) : queue.list)
    : null;

  return (
    <div className="hb-pub">
      {/* ── Platform allow-list ─────────────────────────────────────────
          THE LAST PIECE OF CONFIGURATION LEFT ON THIS TAB, and it is here
          because it has nowhere better to be yet, not because it belongs.
          `connectors/social-status` — the roll-up the Social accounts page is
          built on — does not read `hub_client_platforms` at all, so that page
          draws every publishing network whatever this list says. Deleting the
          only screen for a live endpoint would not be moving it; moving it to
          the per-network card on that page is owed. */}
      <section className="hb-sec">
        <div className="hb-sec__head">
          <h3 className="hb-sec__t">
            Platform integrations
            <Secondary className="hb-card__hi" value="माध्यम" />
          </h3>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            onClick={() => { setShowMgmt(v => !v); setPending([...(enabled.keys || [])]); }}>
            {showMgmt ? 'Close' : 'Manage platforms'}
          </button>
        </div>

        {/* Three states, never collapsed, and the third one used to be a bug.
            The original wrote `catch { setEnabledPlatforms(ALL_KEYS) }` — a
            failed allow-list request SILENTLY enabled every platform, so a 403
            on that route listed thirteen platforms for a client entitled to
            none with no indication anything had gone wrong. Not knowing which
            platforms are permitted is not the same as all of them being
            permitted, so on a failure NOTHING is listed and the note says so. */}
        {enabled.loading ? <Shim count={1} />
          : enabled.error ? (
            <ErrorNote what="The platform allow-list" error={enabled.error} onRetry={loadEnabled} />
          ) : enabled.keys?.length === 0 ? (
            <p className="hb-none">
              No platforms are enabled for this client. Use &ldquo;Manage platforms&rdquo; above to turn some on.
            </p>
          ) : (
            <div className="hb-tags">
              {allowed.map(p => (
                <span className="hb-tag" key={p.key} style={{ '--pc': p.color }}>{p.label}</span>
              ))}
            </div>
          )}

        {showMgmt && (
          <div className="hb-card hb-mgmt">
            <p className="hb-cap">Choose which platforms this client may publish to.</p>
            <div className="hb-plats">
              {PLATFORMS.map(p => {
                const on = pending.includes(p.key);
                return (
                  <button type="button" key={p.key}
                    className={`hb-ptoggle${on ? ' on' : ''}`}
                    aria-pressed={on}
                    style={{ '--pc': p.color }}
                    onClick={() => setPending(prev => on ? prev.filter(x => x !== p.key) : [...prev, p.key])}>
                    <span className={`hb-pmark${p.ink ? ' hb-pmark--ink' : ''}`}>{p.icon}</span>
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="hb-form__foot hb-form__foot--end">
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowMgmt(false)}>Cancel</button>
              <button type="button" className="k-btn k-btn--primary" disabled={busy || !canWrite} onClick={saveEnabled} title={denial || undefined}>
                {busy ? 'Saving…' : `Enable ${pending.length} platform${pending.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Where connecting happened, and where it happens now ──────────
          This is what is left of thirteen platform cards with Connect,
          Reconnect, Disconnect and a pasted-token form on each. All of it is
          on the Social accounts page, which shows the network's APP beside its
          ACCOUNTS — the pair that decides whether a Connect can work at all,
          and which this tab never knew anything about.

          The accounts request still runs, because scheduling needs to know
          what it can post to; a failure of it is still reported on its own,
          because "nothing is connected" over a 500 is a false statement about
          the firm's accounts and it is the one somebody acts on. */}
      {accounts.loading ? <Shim count={1} /> : accounts.error ? (
        <ErrorNote what="Connected accounts" error={accounts.error} onRetry={loadAccounts} />
      ) : (
        <p className="hb-cap">
          {accList?.length
            ? `${accList.length} account${accList.length === 1 ? '' : 's'} connected. `
            : 'No accounts are connected yet. '}
          <Link to={SOCIAL_ACCOUNTS} className="hb-link">
            Connect and disconnect accounts on the Social accounts page
          </Link>
          {' — '}it shows each network&rsquo;s app and its accounts together, which
          is what decides whether a network can publish at all.
        </p>
      )}

      {/* ── Queue / calendar ──────────────────────────────────────────── */}
      <section className="hb-sec">
        <div className="hb-sec__head">
          <div className="hb-seg" role="group" aria-label="Publishing view">
            {[['queue', 'Publish queue'], ['calendar', 'Content calendar']].map(([v, l]) => (
              <button type="button" key={v} className={`hb-seg__b${view === v ? ' on' : ''}`}
                aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>
            ))}
          </div>
          <button type="button" className="k-btn k-btn--primary hb-btn--sm"
            disabled={!accList?.length || !canWrite}
            onClick={() => { setShowSchedule(true); loadContent(); }} title={denial || undefined}>
            Schedule a post
          </button>
        </div>

        {/* The `needsCreds` banner was here — "No credentials are saved for
            Facebook", with a link to the Connectors page. It belonged to
            `connectOAuth`, which is gone, and the sentence is better said
            where the app and the account sit on one card. */}

        {accList?.length === 0 && (
          <p className="hb-cap">
            Nothing can be scheduled until an account is connected.{' '}
            <Link to={SOCIAL_ACCOUNTS} className="hb-link">Connect one</Link>.
          </p>
        )}

        {showSchedule && (
          <form className="hb-card hb-form" onSubmit={schedule}>
            <h4 className="hb-card__t">Schedule a post</h4>
            <div className="hb-grid hb-grid--2">
              <label className="hb-field">
                <span className="hb-field__l">Content <span className="hb-req" aria-hidden="true">*</span></span>
                <select className="k-input" required value={scheduleForm.content_id}
                  onChange={e => setScheduleForm({ ...scheduleForm, content_id: e.target.value })}>
                  <option value="">Select content…</option>
                  {content.list?.filter(c => ['draft', 'approved'].includes(c.status)).map(c => (
                    <option key={c.id} value={c.id}>{c.title} ({words(c.status)})</option>
                  ))}
                </select>
                {content.loading && <span className="hb-cap">Loading your content…</span>}
                {content.error && <span className="hb-cap hb-cap--bad">Content did not load — {content.error}</span>}
                {content.list?.length === 0 && <span className="hb-cap">Nothing approved or drafted yet.</span>}
              </label>
              <label className="hb-field">
                <span className="hb-field__l">Publish at <span className="hb-req" aria-hidden="true">*</span></span>
                <DateInput className="k-input" type="datetime-local" required value={scheduleForm.scheduled_for}
                  onChange={e => setScheduleForm({ ...scheduleForm, scheduled_for: e.target.value })} />
              </label>
            </div>

            <fieldset className="hb-fs">
              <legend className="hb-field__l">Publish to <span className="hb-req" aria-hidden="true">*</span></legend>
              <div className="hb-plats">
                {accList?.map(a => {
                  const pl = platformOf(a.platform);
                  const on = targets.includes(a.id);
                  return (
                    <button type="button" key={a.id} className={`hb-ptoggle${on ? ' on' : ''}`}
                      aria-pressed={on} style={{ '--pc': pl?.color || 'var(--primary)' }}
                      onClick={() => setTargets(t => on ? t.filter(x => x !== a.id) : [...t, a.id])}>
                      <span className="hb-pdot" />
                      {a.account_name || a.platform}
                      <span className="hb-cap">{words(a.platform)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="hb-form__foot hb-form__foot--end">
              <button type="button" className="k-btn k-btn--ghost" onClick={() => { setShowSchedule(false); setTargets([]); }}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary" disabled={busy || targets.length === 0 || !canWrite} title={denial || undefined}>
                {busy ? 'Scheduling…' : targets.length > 1 ? `Schedule to ${targets.length} accounts` : 'Schedule post'}
              </button>
            </div>
          </form>
        )}

        {view === 'queue' && (
          <>
            <div className="hb-filters" role="group" aria-label="Filter the queue by status">
              {QUEUE_FILTERS.map(([v, l]) => (
                <button type="button" key={v || 'all'} className={`hb-chip${queueFilter === v ? ' on' : ''}`}
                  aria-pressed={queueFilter === v} onClick={() => setQueueFilter(v)}>
                  {l}
                  {queue.list && v && <span className="hb-chip__n">{queue.list.filter(q => q.status === v).length}</span>}
                </button>
              ))}
            </div>

            {queue.loading ? <Shim count={3} />
              : queue.error ? <ErrorNote what="The publish queue" error={queue.error} onRetry={loadQueue} />
              : queue.list.length === 0 ? (
                <p className="hb-none">Nothing is scheduled. Approved content can be queued with the button above.</p>
              ) : shownQueue.length === 0 ? (
                <p className="hb-none">
                  Nothing in the queue with that status.{' '}
                  <button type="button" className="hb-linkbtn" onClick={() => setQueueFilter('')}>Show all {queue.list.length}</button>
                </p>
              ) : (
                <div className="hb-list">
                  {shownQueue.map(q => {
                    const pl = platformOf(q.platform);
                    return (
                      <article className="hb-card hb-q" key={q.id} style={{ '--pc': pl?.color || 'var(--on-surface-3)' }}>
                        <div className="hb-q__head">
                          <span className="hb-q__id">
                            <span className="hb-pdot" />
                            <b className="hb-q__t">{q.content_title || 'Untitled'}</b>
                            <span className="hb-cap">to {q.account_name || words(q.platform)}</span>
                          </span>
                          <StatusPill status={q.status} tone={QUEUE_TONE[q.status]} />
                        </div>
                        <div className="hb-cap hb-q__when">
                          {q.scheduled_for && <>Scheduled {stamp(q.scheduled_for)}</>}
                          {q.published_at && <> · published {stamp(q.published_at)}</>}
                        </div>
                        {q.error_message && (
                          <div className="note note--warn hb-q__err" role="status">
                            <b>This post did not go out.</b> {q.error_message}
                          </div>
                        )}
                        <div className="hb-q__act">
                          {q.status === 'scheduled' && (
                            <>
                              <button type="button" className="k-btn k-btn--primary hb-btn--sm"
                                onClick={() => queueAction(q.id, 'publish-now', 'Publishing now')}
          disabled={!canWrite} title={denial || undefined}>Publish now</button>
                              <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                                onClick={() => queueAction(q.id, 'cancel', 'Post cancelled')}
          disabled={!canWrite} title={denial || undefined}>Cancel</button>
                            </>
                          )}
                          {q.platform_url && (
                            <a className="hb-link" href={q.platform_url} target="_blank" rel="noopener noreferrer">
                              View the published post
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
          </>
        )}

        {view === 'calendar' && (
          <Calendar
            month={calMonth} onMonth={setCalMonth}
            state={calendar} onRetry={() => setCalMonth(m => m)}
          />
        )}
      </section>
    </div>
  );
}

/**
 * The month grid.
 *
 * Pulled out of the 50-line IIFE it used to be inside the render. The header
 * previously rendered the raw `YYYY-MM` through `new Date(calMonth + '-01')`,
 * which Safari parses as an invalid date — the month name read "Invalid Date"
 * on the one browser nobody in the team uses.
 */
function Calendar({ month, onMonth, state, onRetry }) {
  const [y, m] = month.split('-').map(Number);
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const firstDow = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const byDay = {};
  for (const item of state.list || []) {
    const d = new Date(item.scheduled_for);
    if (Number.isNaN(d.getTime())) continue;
    (byDay[d.getDate()] ||= []).push(item);
  }

  const title = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="hb-cal">
      <div className="hb-cal__bar">
        <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => shift(-1)} aria-label="Previous month">&larr;</button>
        <b className="hb-cal__m">{title}</b>
        <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => shift(1)} aria-label="Next month">&rarr;</button>
      </div>

      {state.loading && <Shim count={2} />}
      {state.error && <ErrorNote what="The content calendar" error={state.error} onRetry={onRetry} />}

      {!state.loading && !state.error && (
        <>
          {state.list?.length === 0 && (
            <p className="hb-cap">Nothing scheduled in {title}.</p>
          )}
          <div className="hb-cal__dow" aria-hidden="true">
            {DOW.map(d => <span className="hb-cal__dw" key={d}>{d}</span>)}
          </div>
          <div className="hb-cal__grid">
            {cells.map((d, i) => (
              <div className={`hb-cal__c${d ? '' : ' hb-cal__c--pad'}`} key={i}>
                {d && (
                  <>
                    <span className="hb-cal__n">{d}</span>
                    {(byDay[d] || []).map((it, j) => {
                      const pl = platformOf(it.platform);
                      return (
                        <span className="hb-cal__e" key={j} style={{ '--pc': pl?.color || 'var(--on-surface-3)' }}
                          title={`${it.title || 'Post'} · ${words(it.platform)}`}>
                          {it.title || 'Post'}
                        </span>
                      );
                    })}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
