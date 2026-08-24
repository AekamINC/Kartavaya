/**
 * Document numbering — the prefix this firm's invoices carry.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * The prefix was hardcoded in `routers/ganit.py`, so every firm on the platform
 * numbered its invoices INV-YYYY-NNNN whether that matched its books or not. A
 * practice that has issued AEK-2024-0001 for years had no way to say so.
 *
 * THE ONE THING THIS SCREEN MUST BE HONEST ABOUT
 * ----------------------------------------------
 * Changing a prefix STARTS A NEW SERIES AT 0001. `utils.next_doc_number` reads
 * the last number for the org and increments it, and a number in the old shape
 * cannot be continued in the new one. Under Rule 46(b) a GST invoice serial has
 * to be consecutive within a series — starting a second series is allowed,
 * silently renumbering an issued document is not, and nothing here does that.
 *
 * A user who is not told this would reasonably expect their next invoice to
 * carry on from the last one. So it is said above the fields, not in a tooltip.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import useModuleWrite from '../../hooks/useModuleWrite';

const LABELS = {
  tax_invoice: 'Tax invoice',
  proforma: 'Proforma',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  quotation: 'Quotation',
};

/** Letters only, upper-cased, capped — the same rule the API enforces.
 *  Applied as you type so the box cannot hold something that will be refused
 *  on save; the server validates again because a screen is not a guarantee. */
const clean = (v) => (v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);

export default function TabDocNumbers() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change document numbering' });
  const { pushToast } = useToast();

  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get('/v1/org/profile/doc-prefixes');
      const data = r?.data?.data || [];
      setRows(data);
      setDraft(Object.fromEntries(data.map((d) => [d.invoice_type, d.prefix || ''])));
    } catch (e) {
      setErr(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Only what the user actually changed. An untouched type is omitted, which
   *  the API reads as "leave alone" — different from an empty string, which
   *  CLEARS the override and returns that type to its built-in. */
  const changed = rows
    ? rows.filter((r) => clean(draft[r.invoice_type]) !== (r.prefix || ''))
    : [];

  async function save() {
    if (!changed.length) return;
    setSaving(true);
    try {
      const prefixes = Object.fromEntries(
        changed.map((r) => [r.invoice_type, clean(draft[r.invoice_type])]),
      );
      await api.put('/v1/org/profile/doc-prefixes', { prefixes });
      pushToast({
        kind: 'ok',
        message: `Saved. The next ${changed.length === 1
          ? LABELS[changed[0].invoice_type].toLowerCase()
          : 'document'} of each changed type starts a new series at 0001.`,
      });
      await load();
    } catch (e) {
      pushToast({ kind: 'err', message: e?.response?.data?.detail || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;
  if (!rows) return <SkeletonList rows={5} />;
  if (!rows.length) {
    return <EmptyState title="No document types" body="Nothing to number." />;
  }

  return (
    <div>
      <p className="of__h of__h--lede">
        The letters in front of every document number. Leave a box empty to use
        the built-in.
      </p>

      {/* Said before the fields, not after, and not in a tooltip. */}
      <div className="note note--warn" role="note">
        <strong>Changing a prefix starts a new series at 0001.</strong>{' '}
        Documents already issued keep the numbers they were issued with — a GST
        serial is never renumbered after the fact. The old series simply ends.
      </div>

      <div className="of" style={{ maxWidth: 520 }}>
        {rows.map((r) => {
          const value = draft[r.invoice_type] ?? '';
          const effective = clean(value) || r.default;
          const isChanged = clean(value) !== (r.prefix || '');
          return (
            <label className="of__f" key={r.invoice_type}>
              <span className="of__l">{LABELS[r.invoice_type] || r.invoice_type}</span>
              <input
                className="of__i of__i--mono"
                type="text"
                value={value}
                disabled={!canWrite || saving}
                title={denial || undefined}
                placeholder={r.default}
                onChange={(e) => setDraft((d) => ({
                  ...d, [r.invoice_type]: clean(e.target.value),
                }))}
              />
              <span className="of__h">
                {/* The example is the point: a prefix is abstract until it is
                    shown as the number somebody will actually read. */}
                Next: <code>{effective}-{new Date().getFullYear()}-0001</code>
                {!r.prefix && ' · using the built-in'}
                {isChanged && ' · not saved yet'}
              </span>
            </label>
          );
        })}
      </div>

      <div className="of__f of__f--act">
        <button
          type="button"
          className="btn btn--fill btn--sm"
          disabled={!canWrite || saving || !changed.length}
          title={denial || undefined}
          onClick={save}
        >
          {saving ? 'Saving…' : changed.length
            ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}`
            : 'Nothing to save'}
        </button>
      </div>
    </div>
  );
}
