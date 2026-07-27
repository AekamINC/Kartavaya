/**
 * TemplatePicker.jsx — what the composer becomes when the 24-hour window closes.
 *
 * Only `approved` templates are offered. A draft or a rejected one cannot be
 * delivered by Meta, so listing it is an affordance that always fails.
 *
 * ── A failed fetch is not an empty template library ─────────────────────────
 *
 * This is the ONLY way to reach a customer once the window has closed, so the
 * empty state here is not a shrug — it says the org has nothing approved and
 * sends the reader off to the Templates tab to author one. A `.catch` that fell
 * back to `[]` put those words in front of an operator whose request had 500'd
 * or who had no connection, on the one screen where being wrong about it costs
 * a reply to a customer. Three states, and the failed one offers a retry rather
 * than an errand.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { ErrorState, errorKind, Select } from '../../../components/ui';
import { SvIcons } from '../icons';

export default function TemplatePicker({ onSend, disabled }) {
  const [templates, setTemplates] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reloadAt, setReloadAt] = useState(0);

  const retry = useCallback(() => setReloadAt(n => n + 1), []);

  useEffect(() => {
    let dead = false;
    setError(null);
    api.get('/v1/whatsapp/templates')
      .then(r => {
        if (dead) return;
        const ok = (Array.isArray(r.data) ? r.data : []).filter(t => t.status === 'approved');
        setTemplates(ok);
        if (ok.length) setPick(String(ok[0].id));
      })
      .catch(e => { if (!dead) { setTemplates([]); setError(e); } });
    return () => { dead = true; };
  }, [reloadAt]);

  const chosen = useMemo(
    () => templates.find(t => String(t.id) === String(pick)) || null,
    [templates, pick]
  );

  if (error) {
    return (
      <ErrorState
        kind={errorKind(error)}
        detail={errorKind(error) === 'offline'
          ? 'Your approved templates need a connection to load. The window has closed, so a free-form reply would be rejected by Meta either way — reconnect and try again.'
          : 'The approved template list did not load, so there is nothing to choose from yet. This is a read failure, not an empty library.'}
        onRetry={retry}
      />
    );
  }

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
