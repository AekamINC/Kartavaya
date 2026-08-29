// Procurement · settings — Finance → Purchase orders → Settings.
//
// ── THE DECISION THIS SCREEN EXISTS TO HONOUR ────────────────────────────────
//
// Approval is OPTIONAL and CONFIGURABLE, not a fixed step. An org that touches
// nothing here gets a module that numbers documents and never asks anyone for
// permission — so every control below opens in the state that means "off", and
// the approval editor does not even appear until approval is switched on.
//
// ── WHY AN ORDERED LIST AND NOT A CHAIN ──────────────────────────────────────
//
// Every ERP eventually grows multi-level approval chains and every one of them
// becomes impossible for the customer to reason about. A list where the FIRST
// matching rule decides is something a person can read aloud — "anything over
// two lakh in Audit needs both partners" — so the screen renders each rule as
// close to that sentence as markup allows, and says out loud that the first
// match wins.
//
// APPROVERS ARE CHOSEN BY NAME. The id is the key the rule is written with and
// is never drawn: `check-rendered-ids.mjs` is the ratchet, and the owner's rule
// behind it is that a person is identified by their name, everywhere, to
// everyone.
import React, { useCallback, useEffect, useState } from 'react';
import { api, body, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import DateInput from '../../components/ui/DateInput';
import { Secondary } from '../../components/Bilingual';
import { apiErrorText } from '../../lib/apiError';

const BLANK_RULE = {
  name: '', min_amount: 0, department: '', category: '',
  approver_ids: [], approvers_required: 1, sequential: false,
};

const BLANK_BUDGET = {
  department: '', period_start: '', period_end: '', limit: 0, alert_pct: 80,
};

export default function POSettingsPanel({ onClose }) {
  const { pushToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [prefix, setPrefix] = useState('');
  const [people, setPeople] = useState([]);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  // Set only once the SERVER has refused. Who approves spending is an
  // organisational decision, so the route is org_admin / org_owner — and the
  // controls are not hidden on a guess about the caller's role.
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get('/v1/procurement/settings');
      const d = body(r).data || {};
      setSettings(d);
      setPrefix(d.prefix || '');
    } catch (e) { setErr(e); setSettings(null); }
  }, []);

  useEffect(() => {
    load();
    api.get('/v1/procurement/approver-candidates')
      .then(r => setPeople(rows(r)))
      .catch(() => setPeople([]));
  }, [load]);

  function set(key, value) {
    setSettings(s => ({ ...s, [key]: value }));
  }

  function setRule(idx, patch) {
    setSettings(s => {
      const list = [...(s.rules || [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...s, rules: list };
    });
  }

  function toggleApprover(idx, userId) {
    setSettings(s => {
      const list = [...(s.rules || [])];
      const ids = list[idx].approver_ids || [];
      // Order is kept: a sequential rule's order IS the escalation order, and a
      // Set would throw it away.
      const next = ids.includes(userId) ? ids.filter(x => x !== userId) : [...ids, userId];
      list[idx] = {
        ...list[idx],
        approver_ids: next,
        approvers_required: Math.min(list[idx].approvers_required || 1, Math.max(next.length, 1)),
      };
      return { ...s, rules: list };
    });
  }

  function setBudget(idx, patch) {
    setSettings(s => {
      const list = [...(s.budgets || [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...s, budgets: list };
    });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setDenied(false);
    try {
      await api.put('/v1/procurement/settings', { ...settings, prefix });
      pushToast({ title: 'Purchase-order settings saved', type: 'success' });
      await load();
    } catch (e2) {
      if (e2.response?.status === 403) {
        setDenied(true);
        pushToast({
          title: 'You cannot change these settings',
          message: 'Who approves spending is an organisation-level decision, so it is limited to the organisation owner and administrators.',
          type: 'error',
        });
      } else {
        pushToast({
          title: apiErrorText(e2, 'Nothing was saved'),
          type: 'error',
        });
      }
    } finally { setSaving(false); }
  }

  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;
  if (!settings) {
    return (
      <SkeletonRegion label="Loading purchase-order settings">
        <SkeletonList rows={4} showAvatar={false} />
      </SkeletonRegion>
    );
  }

  const nameOf = id => (people.find(p => p.user_id === id) || {}).full_name || 'A member';

  return (
    <form className="gn-form gn-form--accent" onSubmit={save}>
      <div className="gn-form__hd">
        <h4 className="gn-form__h">
          Purchase-order settings
          <Secondary className="gn-form__hi" value="क्रय आदेश सेटिंग्स" />
        </h4>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
      </div>

      {denied && (
        <p className="note note--warn" role="status">
          Only the organisation owner or an administrator can change these.
        </p>
      )}

      {/* ── Numbering ──────────────────────────────────────────── */}
      <div className="gn-form__grid gn-form__grid--2">
        <label className="fld">
          <span className="fld__l">Prefix</span>
          <input
            className="inp" value={prefix} placeholder="PO"
            onChange={e => setPrefix(e.target.value)}
          />
        </label>
      </div>
      <p className="gn-tot__note">
        Two to eight letters, no digits and no hyphens — the series is read back
        as PREFIX-YYYY-NNNN. Changing it starts a new series at 0001; orders
        already issued keep the number they were issued with.
      </p>

      {/* ── Approval ───────────────────────────────────────────── */}
      <h4 className="gn-form__h">Approval</h4>
      <label className="gn-chk">
        <input
          type="checkbox" checked={!!settings.approval_required}
          onChange={e => set('approval_required', e.target.checked)}
        />
        <span>Require approval on purchase orders</span>
      </label>
      {!settings.approval_required && (
        <p className="gn-tot__note">
          Off. Purchase orders are numbered and issued without anyone being
          asked for permission.
        </p>
      )}

      {settings.approval_required && (
        <>
          <p className="gn-tot__note">
            Rules are read in order and the <strong>first match wins</strong>.
            An order that matches no rule needs no approval.
          </p>

          {(settings.rules || []).map((r, i) => (
            <div className="gn-panel" key={i}>
              <div className="gn-panel__head">
                <h3 className="gn-panel__h">Rule {i + 1}</h3>
                <button
                  type="button" className="btn btn--ghost btn--sm"
                  onClick={() => set('rules', settings.rules.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
              <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
                <label className="fld">
                  <span className="fld__l">Name it</span>
                  <input
                    className="inp" value={r.name || ''} placeholder="Anything over two lakh"
                    onChange={e => setRule(i, { name: e.target.value })}
                  />
                </label>
                <label className="fld">
                  <span className="fld__l">Order value at least</span>
                  <input
                    className="inp" type="number" step="any" value={r.min_amount ?? 0}
                    onChange={e => setRule(i, { min_amount: parseFloat(e.target.value) || 0 })}
                  />
                </label>
                <label className="fld">
                  <span className="fld__l">Department</span>
                  <input
                    className="inp" value={r.department || ''} placeholder="Any department"
                    onChange={e => setRule(i, { department: e.target.value })}
                  />
                </label>
                <label className="fld">
                  <span className="fld__l">Category</span>
                  <input
                    className="inp" value={r.category || ''} placeholder="Any category"
                    onChange={e => setRule(i, { category: e.target.value })}
                  />
                </label>
              </div>

              <span className="gn-li__l">Who approves</span>
              <div className="gn-chk__list">
                {people.map(p => (
                  <label className="gn-chk" key={p.user_id}>
                    <input
                      type="checkbox"
                      checked={(r.approver_ids || []).includes(p.user_id)}
                      onChange={() => toggleApprover(i, p.user_id)}
                    />
                    <span>{p.full_name}</span>
                  </label>
                ))}
              </div>
              {(r.approver_ids || []).length > 0 && (
                <p className="gn-tot__note">
                  In order: {(r.approver_ids || []).map(nameOf).join(' → ')}
                </p>
              )}

              <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
                <label className="fld">
                  <span className="fld__l">How many must approve</span>
                  <input
                    className="inp" type="number" min={1}
                    max={Math.max((r.approver_ids || []).length, 1)}
                    value={r.approvers_required ?? 1}
                    onChange={e => setRule(i, { approvers_required: parseInt(e.target.value, 10) || 1 })}
                  />
                </label>
                <label className="gn-chk">
                  <input
                    type="checkbox" checked={!!r.sequential}
                    onChange={e => setRule(i, { sequential: e.target.checked })}
                  />
                  <span>In that order, one after another</span>
                </label>
              </div>
            </div>
          ))}

          <button
            type="button" className="btn btn--ghost btn--sm"
            onClick={() => set('rules', [...(settings.rules || []), { ...BLANK_RULE }])}
          >
            + Add rule
          </button>

          <div className="gn-form__grid gn-form__grid--2">
            <label className="fld">
              <span className="fld__l">Re-approve if the total rises by more than (%)</span>
              <input
                className="inp" type="number" step="any" value={settings.reapproval_pct ?? 10}
                onChange={e => set('reapproval_pct', parseFloat(e.target.value) || 0)}
              />
            </label>
            <label className="fld">
              <span className="fld__l">…or by more than (₹)</span>
              <input
                className="inp" type="number" step="any" value={settings.reapproval_amount ?? 10000}
                onChange={e => set('reapproval_amount', parseFloat(e.target.value) || 0)}
              />
            </label>
          </div>
          <p className="gn-tot__note">
            Either test fires. A percentage alone lets a small rise on a very
            large order through; a flat amount alone catches almost every change
            on a small one. Reducing an order never needs fresh approval.
          </p>

          <label className="gn-chk">
            <input
              type="checkbox" checked={!!settings.self_approval}
              onChange={e => set('self_approval', e.target.checked)}
            />
            <span>Allow someone to approve a purchase order they raised</span>
          </label>
        </>
      )}

      {/* ── Receiving ──────────────────────────────────────────── */}
      <h4 className="gn-form__h">Receiving</h4>
      <div className="gn-form__grid gn-form__grid--2">
        <label className="fld">
          <span className="fld__l">Delivery of more than was ordered</span>
          <select
            className="inp" value={settings.over_receipt || 'refuse'}
            onChange={e => set('over_receipt', e.target.value)}
          >
            <option value="refuse">Refuse it</option>
            <option value="allow">Allow it, within a tolerance</option>
          </select>
        </label>
        {settings.over_receipt === 'allow' && (
          <label className="fld">
            <span className="fld__l">Tolerance (%)</span>
            <input
              className="inp" type="number" step="any"
              value={settings.over_receipt_tolerance_pct ?? 0}
              onChange={e => set('over_receipt_tolerance_pct', parseFloat(e.target.value) || 0)}
            />
          </label>
        )}
      </div>
      <p className="gn-tot__note">
        A delivery larger than the order is more often a data-entry slip than a
        generous supplier, and a slip inflates the goods-received-not-invoiced
        accrual.
      </p>

      {/* ── Close-short reasons ────────────────────────────────── */}
      <h4 className="gn-form__h">Reasons for closing an order short</h4>
      {(settings.close_reasons || []).map((r, i) => (
        <div className="gn-li" style={{ '--gn-li': '1fr 30px' }} key={i}>
          <input
            className="inp" value={r}
            onChange={e => set('close_reasons',
              settings.close_reasons.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button" className="gn-li__x" aria-label={`Remove reason ${i + 1}`}
            onClick={() => set('close_reasons', settings.close_reasons.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button" className="btn btn--ghost btn--sm"
        onClick={() => set('close_reasons', [...(settings.close_reasons || []), ''])}
      >
        + Add reason
      </button>
      <p className="gn-tot__note">
        A reason chosen from a list is something a report can group by. Free
        text is not.
      </p>

      {/* ── Budgets ────────────────────────────────────────────── */}
      <h4 className="gn-form__h">Budgets</h4>
      <label className="gn-chk">
        <input
          type="checkbox" checked={!!settings.budgets_enabled}
          onChange={e => set('budgets_enabled', e.target.checked)}
        />
        <span>Track committed spend against a departmental budget</span>
      </label>
      <p className="gn-tot__note">
        Off by default, and honestly so: a department is free text on the
        employee record and is not governed anywhere, so a budget keyed on one
        stops matching the day the spelling changes. Making this dependable
        needs departments to become real records first.
      </p>

      {settings.budgets_enabled && (
        <>
          {(settings.budgets || []).map((b, i) => (
            <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush" key={i}>
              <label className="fld">
                <span className="fld__l">Department</span>
                <input
                  className="inp" value={b.department || ''}
                  onChange={e => setBudget(i, { department: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Limit (₹)</span>
                <input
                  className="inp" type="number" step="any" value={b.limit ?? 0}
                  onChange={e => setBudget(i, { limit: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">From</span>
                <DateInput
                  className="inp" type="date" value={b.period_start || ''}
                  onChange={e => setBudget(i, { period_start: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">To</span>
                <DateInput
                  className="inp" type="date" value={b.period_end || ''}
                  onChange={e => setBudget(i, { period_end: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Warn at (%)</span>
                <input
                  className="inp" type="number" step="any" value={b.alert_pct ?? 80}
                  onChange={e => setBudget(i, { alert_pct: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <div className="gn-form__acts">
                <button
                  type="button" className="btn btn--ghost btn--sm"
                  onClick={() => set('budgets', settings.budgets.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button" className="btn btn--ghost btn--sm"
            onClick={() => set('budgets', [...(settings.budgets || []), { ...BLANK_BUDGET }])}
          >
            + Add budget
          </button>
        </>
      )}

      <div className="gn-form__acts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
