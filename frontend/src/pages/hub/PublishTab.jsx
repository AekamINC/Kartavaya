// Hub → Publish. Connect the accounts, schedule the posts, watch the queue.
//
// ── The merge ────────────────────────────────────────────────────────────────
//
// There were two of these. `HubDashboardPage` had the newer one — a content
// calendar, a platform enable/disable panel, thirteen platforms, manual-token
// fields for Telegram / Reddit / Pinterest and an EXPIRED marker on a stale
// OAuth token. `HubClientDetailPage` had a copy with none of that, against the
// same endpoints. This file is the newer behaviour, rendered by both routes.
//
// ── Why the queue's empty state is dangerous ─────────────────────────────────
//
// "No posts in queue" over a failed fetch tells someone their scheduled posts
// are not going out when they may be about to. Both the accounts request and the
// queue request are therefore reported separately: they were `Promise.all` in
// one try/catch, so a queue failure blanked the platform cards as well and the
// person could not even tell which half had broken.
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows as unwrapRows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import {
  PLATFORMS, MANUAL_PAGE_FIELD, QUEUE_TONE, StatusPill, ErrorNote, Shim,
  errText, stamp, thisMonth, words, platformOf,
} from './_shared';

const QUEUE_FILTERS = [['', 'All'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed'], ['cancelled', 'Cancelled']];
const BLANK_MANUAL = { account_name: '', account_id: '', page_id: '', access_token: '' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PublishTab({ clientId }) {
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
  const [connecting, setConnecting] = useState(null);
  const [manualFor, setManualFor] = useState(null);
  const [manual, setManual] = useState(BLANK_MANUAL);
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

  // OAuth return leg. The provider sends the browser back with ?oauth=success.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('oauth') !== 'success') return;
    pushToast({ title: `${p.get('platform') || 'Account'} connected`, type: 'success' });
    const url = new URL(window.location.href);
    url.searchParams.delete('oauth');
    url.searchParams.delete('platform');
    window.history.replaceState({}, '', url.toString());
    loadAccounts();
    // Runs once on mount; loadAccounts is stable per clientId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function connectOAuth(key) {
    setConnecting(key);
    try {
      const r = await api.get(`/v1/hub/oauth/${key}/authorize`, { params: { client_id: clientId } });
      window.location.href = r.data.auth_url;
    } catch (err) {
      pushToast({ title: errText(err, 'OAuth is not configured for this platform.'), type: 'error' });
      setConnecting(null);
    }
  }

  async function connectManual(e, key) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/social-accounts`, { platform: key, ...manual });
      pushToast({ title: 'Account connected', type: 'success' });
      setManualFor(null);
      setManual(BLANK_MANUAL);
      loadAccounts();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not connect the account.'), type: 'error' });
    } finally { setBusy(false); }
  }

  async function disconnect(id) {
    try {
      await api.delete(`/v1/hub/clients/${clientId}/social-accounts/${id}`);
      pushToast({ title: 'Account disconnected', type: 'success' });
      loadAccounts();
    } catch (err) {
      pushToast({ title: errText(err, 'Could not disconnect it.'), type: 'error' });
    }
  }

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
  // Only ever derived from a list we actually received. There is deliberately no
  // `: PLATFORMS` fallback — see the card block below.
  const visible = enabled.keys ? PLATFORMS.filter(p => enabled.keys.includes(p.key)) : [];
  const shownQueue = queue.list
    ? (queueFilter ? queue.list.filter(q => q.status === queueFilter) : queue.list)
    : null;

  return (
    <div className="hb-pub">
      {/* ── Platform allow-list ───────────────────────────────────────── */}
      <section className="hb-sec">
        <div className="hb-sec__head">
          <h3 className="hb-sec__t">
            Platform integrations
            <span className="hb-card__hi" lang="hi">माध्यम</span>
          </h3>
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
            onClick={() => { setShowMgmt(v => !v); setPending([...(enabled.keys || [])]); }}>
            {showMgmt ? 'Close' : 'Manage platforms'}
          </button>
        </div>

        {enabled.error && (
          <ErrorNote what="The platform allow-list" error={enabled.error} onRetry={loadEnabled} />
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
              <button type="button" className="k-btn k-btn--primary" disabled={busy} onClick={saveEnabled}>
                {busy ? 'Saving…' : `Enable ${pending.length} platform${pending.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Platform cards ─────────────────────────────────────────────
          Order matters, and the third branch is the one that used to be a bug.

          The original wrote `catch { setEnabledPlatforms(ALL_KEYS) }` — a failed
          allow-list request SILENTLY enabled every platform. A 403 on that route
          therefore rendered thirteen connectable platforms for a client entitled
          to none, with no indication anything had gone wrong. Not knowing which
          platforms are permitted is not the same as all of them being permitted,
          so nothing is drawn: the ErrorNote above says the list did not load. */}
      {accounts.loading || enabled.loading ? <Shim count={3} /> : accounts.error ? (
        <ErrorNote what="Connected accounts" error={accounts.error} onRetry={loadAccounts} />
      ) : enabled.error ? null : enabled.keys?.length === 0 ? (
        <p className="hb-none">
          No platforms are enabled for this client. Use &ldquo;Manage platforms&rdquo; above to turn some on.
        </p>
      ) : (
        <div className="hb-cards">
          {visible.map(p => {
            const mine = accList?.filter(a => a.platform === p.key) || [];
            const live = mine.length > 0;
            return (
              <article className={`hb-card hb-plat${live ? ' on' : ''}`} key={p.key} style={{ '--pc': p.color }}>
                <div className="hb-plat__head">
                  <span className={`hb-pmark hb-pmark--lg${p.ink ? ' hb-pmark--ink' : ''}`}>{p.icon}</span>
                  <span className="hb-plat__id">
                    <b className="hb-plat__t">{p.label}</b>
                    <span className="hb-cap">{p.desc}</span>
                  </span>
                </div>

                <div className="hb-plat__sec">
                  <div className="hb-plat__l">Prerequisites</div>
                  <ul className="hb-reqs">
                    {p.prereqs.map(r => <li className={`hb-reqs__i${live ? ' ok' : ''}`} key={r}>{r}</li>)}
                  </ul>
                </div>

                <div className="hb-plat__sec">
                  <div className="hb-plat__l">Supports</div>
                  <div className="hb-tags">
                    {p.supports.map(s => <span className="hb-tag" key={s}>{s}</span>)}
                  </div>
                </div>

                {mine.map(a => {
                  const exp = a.token_expires_at ? new Date(a.token_expires_at) : null;
                  const dead = exp && exp < new Date();
                  return (
                    <div className="hb-acct" key={a.id}>
                      <span className="hb-acct__id">
                        <b>{a.account_name || 'Connected'}</b>
                        {exp && (
                          <span className={`hb-cap${dead ? ' hb-cap--bad' : ''}`}>
                            {dead ? 'Token expired — reconnect to keep publishing' : `Token valid to ${exp.toLocaleDateString('en-IN')}`}
                          </span>
                        )}
                      </span>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                        onClick={() => disconnect(a.id)}>Disconnect</button>
                    </div>
                  );
                })}

                <div className="hb-plat__act">
                  {!p.manualOnly && (
                    <button type="button" className="k-btn k-btn--primary hb-btn--sm hb-plat__go"
                      disabled={connecting === p.key} onClick={() => connectOAuth(p.key)}>
                      {connecting === p.key ? 'Redirecting…' : live ? 'Reconnect' : `Connect ${p.label}`}
                    </button>
                  )}
                  <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                    onClick={() => { setManualFor(manualFor === p.key ? null : p.key); setManual(BLANK_MANUAL); }}>
                    {p.manualOnly ? 'Connect with a token' : 'Manual'}
                  </button>
                </div>

                {manualFor === p.key && (
                  <form className="hb-manual" onSubmit={e => connectManual(e, p.key)}>
                    <input className="k-input hb-manual__in" placeholder="Account display name"
                      value={manual.account_name} onChange={e => setManual({ ...manual, account_name: e.target.value })} />
                    <input className="k-input hb-manual__in" placeholder="Account / user ID" required
                      value={manual.account_id} onChange={e => setManual({ ...manual, account_id: e.target.value })} />
                    {MANUAL_PAGE_FIELD[p.key] && (
                      <input className="k-input hb-manual__in" placeholder={MANUAL_PAGE_FIELD[p.key]}
                        value={manual.page_id} onChange={e => setManual({ ...manual, page_id: e.target.value })} />
                    )}
                    <input className="k-input hb-manual__in" type="password" required
                      placeholder="Access token" autoComplete="off"
                      value={manual.access_token} onChange={e => setManual({ ...manual, access_token: e.target.value })} />
                    <div className="hb-form__foot hb-form__foot--end">
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={() => setManualFor(null)}>Cancel</button>
                      <button type="submit" className="k-btn k-btn--primary hb-btn--sm" disabled={busy}>
                        {busy ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
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
            disabled={!accList?.length}
            onClick={() => { setShowSchedule(true); loadContent(); }}>
            Schedule a post
          </button>
        </div>

        {accList?.length === 0 && (
          <p className="hb-cap">Connect at least one account above before scheduling.</p>
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
                <input className="k-input" type="datetime-local" required value={scheduleForm.scheduled_for}
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
              <button type="submit" className="k-btn k-btn--primary" disabled={busy || targets.length === 0}>
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
                                onClick={() => queueAction(q.id, 'publish-now', 'Publishing now')}>Publish now</button>
                              <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                                onClick={() => queueAction(q.id, 'cancel', 'Post cancelled')}>Cancel</button>
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
