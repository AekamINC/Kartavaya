import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import Sheet from '../../components/Sheet';
import { grahaWriteApi, writeErrorMessage } from '../../api/graha';
import {
  FieldLabel, Field, ErrorNote, InfoNote, SheetBody, panelStyle,
} from './sheetKit';
import { EMPTY_CLIENT, clientCreateBody, clientError, type ClientForm } from './draftRules';

/**
 * A new company — `POST /api/v1/graha/clients`.
 *
 * ── The client is the CUSTOMER, not a person ─────────────────────────────────
 *
 * This is the record everything else hangs off: contacts come and go, the
 * customer stays, and both `graha_contacts.client_id` and `graha_deals.client_id`
 * point here. It is also where the sales customer list is derived from. A rep who
 * can add a contact but not the firm they work at ends up with a contact
 * attached to nothing, which is exactly the row that later has to be merged by
 * hand.
 *
 * ── GSTIN BLOCKS NOTHING ─────────────────────────────────────────────────────
 *
 * Offered, never required, never validated, and the form submits happily
 * without it. This is a standing product rule that has drifted back more than
 * once — GSTIN, PAN and TAN are non-mandatory everywhere in this product. It is
 * on the form at all because it is the one field a rep can read off a board in
 * a reception area and nobody can reconstruct later.
 *
 * ── ONLINE ONLY ──────────────────────────────────────────────────────────────
 *
 * The rule from `api/graha.ts`. A duplicated company is the worst of the four
 * creates to undo: contacts and deals attach to whichever copy was on screen at
 * the time, so the two halves of one customer's history end up under two rows.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Handed the new company so a form that opened this can point itself at it. */
  onCreated?: (clientId: string, name: string) => void;
  /** What was typed in the picker that offered "add a new company". */
  initialName?: string;
}

export default function NewClientSheet({ visible, onClose, onCreated, initialName = '' }: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const [form, setForm]   = useState<ClientForm>(EMPTY_CLIENT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on OPEN, not on close — see the other sheets.
  useEffect(() => {
    if (!visible) return;
    setForm({ ...EMPTY_CLIENT, name: initialName });
    setSaving(false);
    setError(null);
  }, [visible, initialName]);

  const set = <K extends keyof ClientForm>(key: K, v: ClientForm[K]) =>
    setForm(f => ({ ...f, [key]: v }));

  const problem = clientError(form);

  const submit = async () => {
    if (problem) { setError(problem); return; }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await grahaWriteApi.createClient(clientCreateBody(form));
      // Every company picker in the app reads this prefix.
      void qc.invalidateQueries({ queryKey: ['graha', 'clients'] });
      onClose();
      onCreated?.(created.id, created.name);
    } catch (err) {
      setError(writeErrorMessage(err, { creating: true, noun: 'company' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close the new company sheet"
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetBody
        kickerLatin="NEW COMPANY" kickerHindi="नई कंपनी"
        title={form.name || 'Who is the customer?'}
        onClose={onClose}
        submitLabel={online ? 'Add company' : 'Needs a connection'}
        onSubmit={submit}
        submitting={saving}
        canSubmit={online && !problem}
      >
        {!online && (
          <InfoNote
            icon="cloud-offline-outline"
            text="Adding a company needs a connection. It is not queued on purpose — a queued create that loses its reply would be sent twice, and contacts and deals would then attach to two halves of the same customer."
          />
        )}

        <FieldLabel latin="COMPANY" hindi="कंपनी" />
        <Field
          value={form.name}
          onChangeText={v => { set('name', v); if (v.trim()) setError(null); }}
          placeholder="Nair Textiles Pvt Ltd"
          label="Company name"
          invalid={!form.name.trim() && !!error}
          autoFocus
        />

        {/* Two firms genuinely do share a name; the reference is how a practice
            tells them apart, and it is what the company picker draws underneath. */}
        <FieldLabel latin="REFERENCE" hindi="संदर्भ" />
        <Field
          value={form.refNo}
          onChangeText={v => set('refNo', v)}
          placeholder="NT-2026"
          label="Reference number"
          autoCapitalize="characters"
        />

        {/* Optional. Blocks nothing. */}
        <FieldLabel latin="GSTIN" hindi="जीएसटीआईएन" />
        <Field
          value={form.gstin}
          onChangeText={v => set('gstin', v)}
          placeholder="Optional"
          label="GSTIN, optional"
          autoCapitalize="characters"
        />

        <FieldLabel latin="WEBSITE" hindi="वेबसाइट" />
        <Field
          value={form.website}
          onChangeText={v => set('website', v)}
          placeholder="nairtextiles.com"
          label="Website"
          keyboardType="url"
          autoCapitalize="none"
        />

        <FieldLabel latin="NOTES" hindi="टिप्पणी" />
        <Field
          value={form.notes}
          onChangeText={v => set('notes', v)}
          placeholder="What they do, and who introduced them…"
          label="Notes"
          multiline
        />

        {error && <ErrorNote text={error} />}
      </SheetBody>
    </Sheet>
  );
}
