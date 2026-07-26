/**
 * WhatsAppTab.jsx — conversations · templates · auto-replies · accounts.
 *
 * `06-sanvaad-varta.md` names this surface **WhatsApp**, with **वार्ता / Varta**
 * as subtext: "WhatsApp is what a user is looking for; Varta is the internal
 * module name and rides beneath it."
 */
import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Chip, ChipRow, EmptyState, SkeletonList, StatusChip, Toggle } from '../../../components/ui';
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

export default function WhatsAppTab() {
  const [sub, setSub] = useState('conversations');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [pane, setPane] = useState('list');

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setRows([]);
    api.get(ENDPOINT[sub])
      .then(r => { if (!dead) setRows(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!dead) setRows([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [sub]);

  return (
    <div>
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
            <div className="sv__scroll">
              {loading && <SkeletonList rows={6} showAvatar={false} />}
              {!loading && rows.length === 0 && (
                <p className="sv__none">
                  No conversations yet. They appear when a customer messages your WhatsApp number.
                </p>
              )}
              {!loading && rows.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`ch${String(selected?.id) === String(c.id) ? ' on' : ''}`}
                  onClick={() => { setSelected(c); setPane('chat'); }}
                  aria-current={String(selected?.id) === String(c.id) ? 'true' : undefined}
                >
                  <span className="ch__ic" aria-hidden="true">{SvIcons.chat}</span>
                  <span className="ch__txt">
                    <span className="ch__n">{c.contact_name || c.phone_number}</span>
                    <span className="ch__last">
                      {c.last_message ? c.last_message.slice(0, 70) : c.phone_number}
                    </span>
                    <StatusChip status={c.status} />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
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
                  <div style={{ marginTop: 'var(--sp-2)' }}><StatusChip status={t.status} /></div>
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
              <StatusChip status={a.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
