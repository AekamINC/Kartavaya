/**
 * WhatsAppTab.jsx — conversations · templates · auto-replies · accounts.
 *
 * `06-sanvaad-varta.md` names this surface **WhatsApp**, with **वार्ता / Varta**
 * as subtext: "WhatsApp is what a user is looking for; Varta is the internal
 * module name and rides beneath it."
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, errorKind, SkeletonList,
  StatusChip, Toggle, useToast,
} from '../../../components/ui';
import { relTime } from '../../../lib/utils';
import { currentUser } from '../../../lib/auth';
import useMediaQuery from '../../../hooks/useMediaQuery';
import useModuleWrite from '../../../hooks/useModuleWrite';
import { ChatArt, SvIcons } from '../icons';
import WAChat from './WAChat';
import WAConnectAccount from './WAConnectAccount';
import { Secondary } from '../../../components/Bilingual';

const SUB_TABS = [
  { value: 'conversations', label: 'Conversations' },
  { value: 'templates', label: 'Templates' },
  { value: 'auto-replies', label: 'Auto-replies' },
  { value: 'accounts', label: 'Accounts' },
];

const ENDPOINT = {
  conversations: '/v1/whatsapp/conversations',
  templates: '/v1/whatsapp/templates',
  'auto-replies': '/v1/whatsapp/auto-replies',
  accounts: '/v1/whatsapp/accounts',
};

/**
 * `ui/StatusChip.jsx` maps the TASK vocabulary. Handing it a Varta state got
 * two things wrong and neither was visible from the call site: an unknown value
 * falls through to `{label: status}` and printed the raw lowercase column
 * (`open`, `draft`, `resolved`), and `pending` — which all three Varta tables
 * use — collided with the task map's approval state and rendered a WhatsApp
 * conversation as **"Awaiting Approval"**.
 *
 * `columnName` + `columnColor` is StatusChip's own public escape hatch for
 * exactly this, so the labels and tokens live here rather than in a sixth
 * status-colour map. Colours are declared tokens: 00 §9 retires `#0082c6`, which
 * is the literal `ScreensVarta.jsx` still carries for `open`.
 */
const CONV_STATUS = {
  open: ['Open', 'var(--st-in-progress)'],
  pending: ['Pending', 'var(--warn)'],
  resolved: ['Resolved', 'var(--ok)'],
};
/** `varta_templates.status` — Meta's approval round-trip, four states. */
const TMPL_STATUS = {
  draft: ['Draft', 'var(--on-surface-3)'],
  pending: ['In review at Meta', 'var(--warn)'],
  approved: ['Approved', 'var(--ok)'],
  rejected: ['Rejected', 'var(--danger)'],
};
/**
 * `varta_business_accounts.status` — the connection's four states.
 *
 * The fourth, "not connected", is the ABSENCE of a row and so is not in here;
 * it is the empty state below.
 *
 *   pending    the six values are stored and Meta has not yet completed the
 *              webhook handshake. This is what a freshly connected number is —
 *              the INSERT used to write `active` outright, so a typo in
 *              `phone_number_id` (which is the column the webhook looks
 *              accounts up BY) showed a green Active chip while every inbound
 *              message was silently dropped.
 *   active     Meta verified the subscription against the verify token. The
 *              only state in which this number can send.
 *   failed     connected but unable to send — today, a stored access token that
 *              no longer opens under the current encryption key.
 *   suspended  the same reading as `failed`, because it is where `failed` lands
 *              until `migrations/123_varta_account_failed_status.sql` is
 *              applied. Two labels for one situation would be two support
 *              conversations for one fix.
 */
const ACCT_STATUS = {
  pending: ['Waiting for Meta', 'var(--warn)'],
  active: ['Connected', 'var(--ok)'],
  failed: ['Connection failed', 'var(--danger)'],
  suspended: ['Connection failed', 'var(--danger)'],
};

function VartaChip({ map, status }) {
  const [label, color] = map[status] || [status || '—', 'var(--on-surface-3)'];
  return <StatusChip columnName={label} columnColor={color} />;
}

const CONV_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Done' },
];

/**
 * Whose row is this — without printing a database identifier at somebody.
 *
 * `varta_conversations.assigned_to` is `TEXT` holding a user id, and
 * `list_conversations` is `SELECT c.*` with no join to a name
 * (`058_sanvaad_messaging.sql:120`, `routers/whatsapp.py:121-131`), so the id is
 * the only thing the row carries. It was being rendered verbatim —
 * `Assigned · 7f3c…` beside a customer's name in the shared inbox, which tells
 * an operator nothing except that the row is not blank.
 *
 * Two readings are available without a backend change and both are worth more
 * than the id: whether it is MINE, which decides whether I open it, and whether
 * it is claimed at all, which decides whether anyone should. A name needs either
 * a join in `list_conversations` or a directory fetch this surface does not
 * otherwise make — noted, not smuggled in here.
 */
function assignedLabel(assignedTo, meId) {
  if (!assignedTo) return 'Unassigned';
  if (meId && String(assignedTo) === String(meId)) return 'Assigned to you';
  return 'Assigned to a teammate';
}

export default function WhatsAppTab() {
  const [sub, setSub] = useState('conversations');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Three states, not two. A failed fetch used to `setRows([])`, which put the
  // reader in front of "No open conversations. They appear here when a customer
  // messages your WhatsApp number." — a confident statement about the customers
  // that is false, and unfalsifiable from the screen. A shared inbox that
  // reports a 500 as silence is one nobody checks twice.
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pane, setPane] = useState('list');
  // `06` §2's tree gives the conversation list a "status filter". The endpoint
  // has taken `?status=` since day one and nothing was passing it, so the rail
  // showed resolved threads mixed in with the ones still waiting on somebody.
  const [status, setStatus] = useState('open');
  const [connecting, setConnecting] = useState(false);
  // ConfirmDialog's `state` is the object it renders, so null is "closed".
  const [confirm, setConfirm] = useState(null);
  const { pushToast } = useToast();
  // The same phone band the Messages tab uses, and for the same reason: one
  // grid track means one of the two columns must not be rendered.
  const phone = useMediaQuery('(max-width: 767px)');

  // F32 — the module is read from the route, never named here. Connecting an
  // account writes an encrypted credential, so it is gated like every other
  // write in the product rather than being open to a viewer.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'connect a WhatsApp account' });

  const meId = currentUser()?.user_id ?? null;

  const [reloadAt, setReloadAt] = useState(0);
  const retry = useCallback(() => setReloadAt(n => n + 1), []);

  /**
   * Disconnect — which DESTROYS the stored credential, and says so.
   *
   * `DELETE /whatsapp/accounts/:id` removes the row, access token included.
   * There is deliberately no "disconnected but kept" state: an org that
   * believes it has revoked our access must not still have a live System User
   * token sitting in our database.
   *
   * Behind `ConfirmDialog` with `confirmText`, which is the component's typed
   * confirmation. Reconnecting is not a matter of clicking undo — it needs the
   * six values from Meta Business Suite again, and a fresh permanent token,
   * which the person disconnecting may not be the person who has.
   *
   * The conversation history survives: `varta_conversations`, `varta_contacts`
   * and `varta_messages` key on `org_id` and hold no reference to this table.
   */
  const disconnect = useCallback((account) => {
    setConfirm({
      title: 'Disconnect this WhatsApp number?',
      message:
        `${account.display_name || account.phone_number} will stop sending and receiving `
        + 'immediately, and the stored access token is deleted — reconnecting needs a '
        + 'fresh one from Meta Business Suite. Past conversations and messages are kept.',
      intent: 'danger',
      confirmLabel: 'Disconnect',
      confirmText: 'DISCONNECT',
      onConfirm: async () => {
        try {
          await api.delete(`/v1/whatsapp/accounts/${account.id}`);
          pushToast({ title: 'WhatsApp number disconnected', type: 'success' });
          retry();
        } catch (e) {
          pushToast({
            type: 'error',
            title: e?.response?.data?.detail || 'Could not disconnect the number.',
          });
        }
      },
    });
  }, [pushToast, retry]);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setRows([]);
    setError(null);
    const params = sub === 'conversations' && status ? { params: { status } } : undefined;
    api.get(ENDPOINT[sub], params)
      .then(r => { if (!dead) setRows(Array.isArray(r.data) ? r.data : []); })
      .catch(e => { if (!dead) { setRows([]); setError(e); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [sub, status, reloadAt]);

  // The selected conversation must survive a filter change only while it is
  // still in the list; resolving a thread should not leave a chat pane open on
  // a row that is no longer there.
  const stillListed = useMemo(
    () => !selected || rows.some(r => String(r.id) === String(selected.id)),
    [rows, selected]
  );

  /**
   * ONE GRID, FOUR SUB-SURFACES.
   *
   * The rail is this tab's navigation and the second column is its content, so
   * the four sub-tabs live in the rail as `.m2seg` chips rather than in a
   * `ChipRow` above the grid. The old layout had three stacked strips — a
   * `.wahdr` identity block, a `ChipRow` of sub-tabs and then the module's own
   * grid — and the first two are now the module tab strip's job: `.m2tabs`
   * carries the WhatsApp mark, the Devanagari and the connected business number.
   * Repeating "WhatsApp · वार्ता" one row below it said the same thing twice.
   *
   * `.m2--rail` is on the grid for every sub-tab, including the three that have
   * no conversation list: the rail is where the chips are, so it is always the
   * first track.
   */
  const showRail = !phone || pane === 'list' || sub !== 'conversations';
  const showBody = !phone || pane === 'chat' || sub !== 'conversations';

  return (
    <div
      className={`m2 m2--rail${phone ? ' m2--mob' : ''}`}
      id="m2panel-wa"
      role="tabpanel"
      aria-labelledby="m2tab-wa"
    >
      {showRail && (
        <div className="m2__col m2r">
          <div className="m2r__hd">
            <span className="m2r__t">
              Inbox<Secondary className="m2r__t-hi" value="वार्ता" />
            </span>
          </div>

          {/* The four sub-surfaces. `.m2seg` rather than `ui/Chip`, so the
              sub-tabs and the status filter below them read as one control
              vocabulary instead of two chip designs eight pixels apart. */}
          <div className="m2r__segs" role="group" aria-label="WhatsApp sections">
            {SUB_TABS.map(t => (
              <button
                key={t.value}
                type="button"
                className={`m2seg${sub === t.value ? ' on' : ''}`}
                aria-pressed={sub === t.value}
                onClick={() => { setSub(t.value); setSelected(null); setPane('list'); }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {sub === 'conversations' && (
            <>
            {/* FOUR CHIPS HERE, THREE ON THE MESSAGES RAIL, and they are not the
                same four. `Msg2.jsx:126-127` splits them deliberately: an
                internal conversation is filtered by whether it wants YOUR
                attention (unread, mentions), and a customer thread is filtered
                by whether you are still ALLOWED to answer it. Both of the
                WhatsApp-only ones — "Window open" and "Closed" — are stated in
                `messaging.css` as `.m2win--open` / `--shut` and are the row's
                most important fact.

                THEY ARE NOT RENDERED, and the reason is that there is nothing to
                render them from. `list_conversations` is
                `SELECT c.*, phone_number, name, graha_contact_id, last_message`
                over a table (058:116-124) whose six columns are id, org_id,
                varta_contact_id, assigned_to, status and started_at. The
                window's state is the newest INBOUND message plus 24 hours, and
                no inbound timestamp reaches this list at any point — `WAChat`
                derives it per conversation from a message page this rail never
                fetches. A "Window open" chip computed from nothing would filter
                every row into the same bucket. The three status chips the
                endpoint DOES support are kept, in the shape the new rail has for
                them. */}
            <div className="m2r__segs" role="group" aria-label="Filter conversations by status">
              {CONV_FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  className={`m2seg${status === f.value ? ' on' : ''}`}
                  aria-pressed={status === f.value}
                  onClick={() => { setStatus(f.value); setSelected(null); setPane('list'); }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="m2r__scroll">
              {loading && <SkeletonList rows={6} showAvatar />}
              {!loading && error && (
                <ErrorState
                  kind={errorKind(error)}
                  detail={errorKind(error) === 'offline'
                    ? 'The inbox needs a connection to load. Nothing was lost — incoming messages keep arriving and appear when you reconnect.'
                    : 'The conversation list did not load. This is a read failure — no message was missed or deleted.'}
                  onRetry={retry}
                />
              )}
              {!loading && !error && rows.length === 0 && (
                <p className="sv__none">
                  {status === 'open'
                    ? 'No open conversations. They appear here when a customer messages your WhatsApp number.'
                    : /* The reader picked a chip labelled "Done"; echoing the raw
                         column value back at them as "No resolved conversations"
                         names a state they were never shown. */
                      `No ${(CONV_FILTERS.find(f => f.value === status)?.label || status).toLowerCase()} conversations.`}
                </p>
              )}
              {!loading && !error && rows.map(c => {
                const name = c.contact_name || c.phone_number;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`m2row${String(selected?.id) === String(c.id) ? ' on' : ''}`}
                    onClick={() => { setSelected(c); setPane('chat'); }}
                    aria-current={String(selected?.id) === String(c.id) ? 'true' : undefined}
                  >
                    {/* THE BRAND TILE, not a face, and this is the whole safety
                        boundary made visible. `.m2row__av--wa` is a square green
                        tile with the WhatsApp mark on it; a channel is a
                        `--r-sm` tile with a `#`, a colleague is a circle with
                        their initials. A customer thread must not be able to be
                        mistaken for either at a glance, because the thing you are
                        allowed to send differs and the meter differs.

                        The customer's own name is still the row's title, so
                        nothing about who this is has been lost. */}
                    <span className="m2row__av m2row__av--wa" aria-hidden="true">
                      {SvIcons.wa}
                    </span>
                    <span className="m2row__txt">
                      <span className="m2row__n"><b>{name}</b></span>
                      <span className="m2row__last">
                        {c.last_message ? c.last_message.slice(0, 70) : c.phone_number}
                      </span>
                      {/* The shared inbox is the point of Varta — a row that does
                          not say whose it is gets answered twice. */}
                      <span className={`wa__asg${c.assigned_to ? '' : ' wa__asg--none'}`}>
                        {assignedLabel(c.assigned_to, meId)}
                      </span>
                    </span>
                    <span className="m2row__meta">
                      <VartaChip map={CONV_STATUS} status={c.status} />
                    </span>
                  </button>
                );
              })}
            </div>
            </>
          )}
        </div>
      )}

      {showBody && sub === 'conversations' && (selected && stillListed ? (
        <WAChat
          key={selected.id}
          conversation={selected}
          onBack={phone ? () => setPane('list') : undefined}
        />
      ) : (
        /* 06 §5: one centred wrapper cannot hold both the empty state and
           the live chat — under `align-items: center` the chat's `height:
           100%` resolves against a stretched-then-centred box and the pane
           does not fill its column. Two containers. */
        <div className="m2__col sv__blank">
          <EmptyState
            icon={ChatArt}
            title={{ en: 'Select a conversation', hi: 'बातचीत चुनें' }}
            description="Pick a customer on the left to read the thread and reply."
          />
        </div>
      ))}

      {sub === 'templates' && (
        <div className="m2__col m2r__scroll">
          {loading && <SkeletonList rows={4} showAvatar={false} />}
          {!loading && rows.length === 0 && (
            <EmptyState
              icon={ChatArt}
              title={{ en: 'No templates yet', hi: 'अभी कोई टेम्पलेट नहीं' }}
              description="Meta must approve a template before it can be sent outside the 24-hour window."
            />
          )}
          <div className="wa__grid">
            {!loading && rows.map(t => (
              <div key={t.id} className="card">
                <div className="card__body">
                  <div className="wa__row-t">{t.name}</div>
                  <div className="wa__row-s">{t.language} · {t.category}</div>
                  <p className="wa__tpl-prev" style={{ marginTop: 'var(--sp-3)' }}>{t.body}</p>
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    <VartaChip map={TMPL_STATUS} status={t.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub === 'auto-replies' && (
        <div className="m2__col m2r__scroll">
          {loading && <SkeletonList rows={4} showAvatar={false} />}
          {!loading && rows.length === 0 && (
            <EmptyState
              icon={ChatArt}
              title={{ en: 'No auto-reply rules', hi: 'कोई स्वतः-उत्तर नियम नहीं' }}
              description="Rules answer common questions without anyone being at a keyboard."
            />
          )}
          {!loading && rows.map(r => (
            <div key={r.id} className="wa__row">
              <div className="wa__row-m">
                <div className="wa__row-t">{r.trigger_type}: {r.trigger_value || '(any)'}</div>
                <div className="wa__row-s">→ {String(r.response_content || '').slice(0, 120)}</div>
              </div>
              {/* Read-only: there is no PATCH for a rule, so a Toggle the user
                  can move but nothing saves would be worse than a static one.
                  The state is also written out — a switch position is a shape,
                  and 26 §8 does not let one carry meaning alone. */}
              <span className="wa__row-s" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
                <Toggle checked={!!r.is_active} disabled label={r.is_active ? 'Active' : 'Inactive'} />
                {r.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      )}

      {sub === 'accounts' && (
        <div className="m2__col m2r__scroll">
          {loading && <SkeletonList rows={2} showAvatar={false} />}
          {!loading && rows.length === 0 && (
            /* The description used to say "Connect your Meta Business Account…"
               with no control anywhere that could. `POST /whatsapp/accounts`
               existed the whole time; the empty state was an instruction the
               product could not carry out, which is why this table held zero
               rows in every org including Aekam's own. */
            <EmptyState
              icon={ChatArt}
              title={{ en: 'No WhatsApp Business account connected', hi: 'कोई खाता जुड़ा नहीं' }}
              description="Connect your Meta Business Account to send and receive on your own number."
              action={canWrite ? 'Connect an account' : undefined}
              onAction={() => setConnecting(true)}
            />
          )}
          {!loading && rows.length > 0 && (
            <div className="wa__acthdr">
              <Button variant="out" size="sm" disabled={!canWrite} title={denial || undefined}
                onClick={() => setConnecting(true)}>
                Connect another account
              </Button>
            </div>
          )}
          {!loading && rows.map(a => (
            <div key={a.id} className="wa__row">
              <div className="wa__row-m">
                <div className="wa__row-t">{a.display_name}</div>
                <div className="wa__row-s">
                  {a.phone_number} · WABA {a.waba_id}
                  {a.created_at ? ` · added ${relTime(a.created_at)}` : ''}
                </div>
                {/* WHAT THE STATE MEANS, not just what it is called. A chip
                    reading "Waiting for Meta" tells an admin the state and
                    nothing about whether they are supposed to do something —
                    and for two of these four they are. Same inline-flex
                    treatment the auto-replies row above uses; no new class,
                    because `sanvaad.css` is not this module's to add one to. */}
                {a.status !== 'active' && (
                  <div className="wa__row-s">
                    {a.status === 'pending'
                      ? 'Paste the webhook verify token into Meta Business Suite → '
                        + 'WhatsApp → Configuration. This turns Connected once Meta '
                        + 'calls back.'
                      : 'This number cannot send. Disconnect it and connect it again '
                        + 'with a fresh permanent access token.'}
                  </div>
                )}
              </div>
              <span
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: 'var(--sp-2)', flexShrink: 0,
                }}
              >
                <VartaChip map={ACCT_STATUS} status={a.status} />
                <Button
                  variant="danger" size="sm"
                  disabled={!canWrite} title={denial || undefined}
                  onClick={() => disconnect(a)}
                >
                  Disconnect
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {connecting && (
        <WAConnectAccount
          open
          onClose={() => setConnecting(false)}
          onConnected={retry}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
