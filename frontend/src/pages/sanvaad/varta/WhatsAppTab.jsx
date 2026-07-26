/**
 * WhatsAppTab.jsx — conversations · templates · auto-replies · accounts.
 *
 * `06-sanvaad-varta.md` names this surface **WhatsApp**, with **वार्ता / Varta**
 * as subtext: "WhatsApp is what a user is looking for; Varta is the internal
 * module name and rides beneath it."
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { Avatar, Chip, ChipRow, EmptyState, SkeletonList, StatusChip, Toggle } from '../../../components/ui';
import { relTime } from '../../../lib/utils';
import { ChatArt, SvIcons } from '../icons';
import WAChat from './WAChat';

const SUB_TABS = [
  { value: 'conversations', label: 'Conversations' },
  { value: 'templates', label: 'Templates' },
  { value: 'auto-replies', label: 'Auto-replies' },
  { value: 'accounts', label: 'Accounts' },
];

const ENDPOINT = {
  conversations: '/whatsapp/conversations',
  templates: '/whatsapp/templates',
  'auto-replies': '/whatsapp/auto-replies',
  accounts: '/whatsapp/accounts',
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
/** `varta_business_accounts.status`. */
const ACCT_STATUS = {
  pending: ['Pending verification', 'var(--warn)'],
  active: ['Active', 'var(--ok)'],
  suspended: ['Suspended', 'var(--danger)'],
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

export default function WhatsAppTab() {
  const [sub, setSub] = useState('conversations');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [pane, setPane] = useState('list');
  // `06` §2's tree gives the conversation list a "status filter". The endpoint
  // has taken `?status=` since day one and nothing was passing it, so the rail
  // showed resolved threads mixed in with the ones still waiting on somebody.
  const [status, setStatus] = useState('open');

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setRows([]);
    const params = sub === 'conversations' && status ? { params: { status } } : undefined;
    api.get(ENDPOINT[sub], params)
      .then(r => { if (!dead) setRows(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!dead) setRows([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [sub, status]);

  // The selected conversation must survive a filter change only while it is
  // still in the list; resolving a thread should not leave a chat pane open on
  // a row that is no longer there.
  const stillListed = useMemo(
    () => !selected || rows.some(r => String(r.id) === String(selected.id)),
    [rows, selected]
  );

  return (
    <div>
      {/* 06's opening rule: the surface is labelled WhatsApp with वार्ता / Varta
          beneath it "everywhere it appears". The tab said so; the pane did not. */}
      <div className="wahdr">
        <span className="wahdr__ic" aria-hidden="true">{SvIcons.wa}</span>
        <span className="wahdr__t">
          <span className="wahdr__n">WhatsApp <span className="sv__hi" lang="hi">वार्ता</span></span>
          <span className="wahdr__d">Business · Meta Cloud API · one shared inbox for the team</span>
        </span>
      </div>

      <ChipRow>
        {SUB_TABS.map(t => (
          <Chip
            key={t.value}
            on={sub === t.value}
            onClick={() => { setSub(t.value); setSelected(null); setPane('list'); }}
          >
            {t.label}
          </Chip>
        ))}
      </ChipRow>

      {sub === 'conversations' && (
        <div className="sv" data-pane={pane} style={{ marginTop: 'var(--sp-4)' }}>
          <div className="sv__list">
            <div className="wa__filter">
              <div className="seg" role="group" aria-label="Filter conversations by status">
                {CONV_FILTERS.map(f => (
                  <button
                    key={f.value}
                    type="button"
                    className={`seg__b${status === f.value ? ' on' : ''}`}
                    aria-pressed={status === f.value}
                    onClick={() => { setStatus(f.value); setSelected(null); setPane('list'); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sv__scroll">
              {loading && <SkeletonList rows={6} showAvatar />}
              {!loading && rows.length === 0 && (
                <p className="sv__none">
                  {status === 'open'
                    ? 'No open conversations. They appear here when a customer messages your WhatsApp number.'
                    : `No ${status} conversations.`}
                </p>
              )}
              {!loading && rows.map(c => {
                const name = c.contact_name || c.phone_number;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`ch${String(selected?.id) === String(c.id) ? ' on' : ''}`}
                    onClick={() => { setSelected(c); setPane('chat'); }}
                    aria-current={String(selected?.id) === String(c.id) ? 'true' : undefined}
                  >
                    {/* A face, not a generic bubble: every row in this rail is a
                        person, and `ScreensVarta.jsx` opens each with `<Av s={34}>`.
                        The 17px chat glyph made four customers look alike. */}
                    <Avatar name={name} size={28} />
                    <span className="ch__txt">
                      <span className="ch__n">{name}</span>
                      <span className="ch__last">
                        {c.last_message ? c.last_message.slice(0, 70) : c.phone_number}
                      </span>
                      {/* The shared inbox is the point of Varta — a row that does
                          not say whose it is gets answered twice. */}
                      <span className={`wa__asg${c.assigned_to ? '' : ' wa__asg--none'}`}>
                        {c.assigned_to ? `Assigned · ${c.assigned_to}` : 'Unassigned'}
                      </span>
                    </span>
                    <VartaChip map={CONV_STATUS} status={c.status} />
                  </button>
                );
              })}
            </div>
          </div>

          {selected && stillListed ? (
            <div className="sv__chat">
              <WAChat key={selected.id} conversation={selected} onBack={() => setPane('list')} />
            </div>
          ) : (
            /* 06 §5: one centred wrapper cannot hold both the empty state and
               the live chat — under `align-items: center` the chat's `height:
               100%` resolves against a stretched-then-centred box and the pane
               does not fill its column. Two containers. */
            <div className="sv__blank">
              <EmptyState
                icon={ChatArt}
                title={{ en: 'Select a conversation', hi: 'बातचीत चुनें' }}
                description="Pick a customer on the left to read the thread and reply."
              />
            </div>
          )}
        </div>
      )}

      {sub === 'templates' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
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
        <div style={{ marginTop: 'var(--sp-4)' }}>
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
        <div style={{ marginTop: 'var(--sp-4)' }}>
          {loading && <SkeletonList rows={2} showAvatar={false} />}
          {!loading && rows.length === 0 && (
            <EmptyState
              icon={ChatArt}
              title={{ en: 'No WhatsApp Business account connected', hi: 'कोई खाता जुड़ा नहीं' }}
              description="Connect your Meta Business Account to send and receive on your own number."
            />
          )}
          {!loading && rows.map(a => (
            <div key={a.id} className="wa__row">
              <div className="wa__row-m">
                <div className="wa__row-t">{a.display_name}</div>
                <div className="wa__row-s">
                  {a.phone_number} · WABA {a.waba_id}
                  {a.created_at ? ` · added ${relTime(a.created_at)}` : ''}
                </div>
              </div>
              <VartaChip map={ACCT_STATUS} status={a.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
