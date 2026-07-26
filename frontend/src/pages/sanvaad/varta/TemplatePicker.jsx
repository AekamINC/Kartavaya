/**
 * TemplatePicker.jsx — what the composer becomes when the 24-hour window closes.
 *
 * Only `approved` templates are offered. A draft or a rejected one cannot be
 * delivered by Meta, so listing it is an affordance that always fails.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { Select } from '../../../components/ui';
import { SvIcons } from '../icons';

export default function TemplatePicker({ onSend, disabled }) {
  const [templates, setTemplates] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    api.get('/whatsapp/templates')
      .then(r => {
        if (dead) return;
        const ok = (Array.isArray(r.data) ? r.data : []).filter(t => t.status === 'approved');
        setTemplates(ok);
        if (ok.length) setPick(String(ok[0].id));
      })
      .catch(() => { if (!dead) setTemplates([]); });
    return () => { dead = true; };
  }, []);

  const chosen = useMemo(
    () => templates.find(t => String(t.id) === String(pick)) || null,
    [templates, pick]
  );

  if (templates.length === 0) {
    return (
      <p className="wa__none">
        No approved templates yet. Meta must approve a template before it can be sent outside the
        24-hour window — add one under Templates.
      </p>
    );
  }

  const send = async () => {
    if (!chosen || busy || disabled) return;
    setBusy(true);
    try { await onSend(chosen); } finally { setBusy(false); }
  };

  return (
    <div className="wa__tpl">
      <span className="wa__tpl-l">Approved template</span>
      {chosen?.body && <div className="wa__tpl-prev">{chosen.body}</div>}
      <div className="wa__tpl-row">
        <Select value={pick} onChange={e => setPick(e.target.value)} aria-label="Template">
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name} · {t.language}</option>
          ))}
        </Select>
        <button
          type="button"
          className="cmp__send"
          onClick={send}
          disabled={busy || disabled || !chosen}
          aria-label="Send template"
        >
          {SvIcons.send}
        </button>
      </div>
    </div>
  );
}
