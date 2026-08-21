import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { useOnline } from '../../hooks/useOnline';
import { useOfflineMutation } from '../../hooks/useOfflineMutation';
import Sheet from '../../components/Sheet';
import { a11yButton } from '../../components/a11y';
import { clientSource, type PickerOption } from '../../components/pickers';
import { grahaWriteApi, writeErrorMessage, type ContactDetail } from '../../api/graha';
import {
  FieldLabel, ChipSelect, Field, PickerField, ErrorNote, InfoNote,
  SheetBody, panelStyle,
} from './sheetKit';
import {
  EMPTY_CONTACT, CONTACT_TYPES, DEFAULT_CONTACT_TYPE, contactCreateBody, contactPatch,
  contactError, isEmptyPatch, type ContactForm, type ContactType,
} from './draftRules';

/**
 * A person — created, edited, and turned into a customer.
 *
 * One sheet for both verbs rather than two, because the FIELDS are identical and
 * the only differences are which endpoint the button calls and whether the sheet
 * has something to load first. Two files would be two copies of the same seven
 * fields, and the second copy is where the client picker gets left off.
 *
 * ── The three endpoints ──────────────────────────────────────────────────────
 *
 *   POST  /v1/graha/contacts            graha.py:438   ONLINE ONLY
 *   PATCH /v1/graha/contacts/{id}       graha.py:697   queueable
 *   POST  /v1/graha/contacts/{id}/convert  graha.py:1633   ONLINE ONLY
 *
 * ── `contact_type` is always sent, and it is not 'lead' ──────────────────────
 *
 * `ContactCreate.contact_type` defaults to `'lead'`, which is right for a web
 * form fed by an inbound-lead inbox and wrong for a rep standing in a customer's
 * office. A lead that is really a customer does not derive into the sales
 * customer list and does not show up where the practice counts its clients. So
 * the chip row opens on `customer` and the value is stated explicitly in the
 * body every time — never inherited from the server's default.
 *
 * ── Converting is not a PATCH ────────────────────────────────────────────────
 *
 * `contact_type` is deliberately absent from the edit form's PATCH even though
 * `ContactUpdate` would accept it. `convert_lead` also stamps `converted_at` and
 * emits `lead.converted` inside the same transaction; setting the column by hand
 * would change the row and fire no rule, so every automation an org has built on
 * "a lead became a customer" would stay silent. The button is the only path.
 *
 * ── A company, never a free-text employer ────────────────────────────────────
 *
 * There is no `company` box. The server's own note on `get_contact` records that
 * the free-text field is gone from both web forms and the employer is the joined
 * `graha_clients` row alone; a phone that kept writing the text column would put
 * the two back out of step.
 */

const TYPE_LABELS: Record<ContactType, string> = {
  customer: 'Customer',
  lead:     'Lead',
  vendor:   'Vendor',
  partner:  'Partner',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Present means EDIT. Absent means create. */
  contactId?: string | null;
  /** The name the row that opened this already had, so the header is not blank. */
  contactName?: string | null;
  /** A company to start from — the deal sheet knows one, the CRM screen does not. */
  initialClient?: PickerOption | null;
  onCreated?: (contactId: string, name: string) => void;
}

export default function ContactSheet({
  visible, onClose, contactId = null, contactName = null, initialClient = null, onCreated,
}: Props) {
  const { t } = useTheme();
  const online = useOnline();
  const qc = useQueryClient();

  const editing = !!contactId;

  const [before, setBefore] = useState<ContactForm | null>(null);
  const [form, setForm]     = useState<ContactForm>(EMPTY_CONTACT);
  const [client, setClient] = useState<PickerOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const clients = useMemo(() => clientSource(), []);

  /** The row to seed the edit form from. Not fetched at all when creating. */
  const detail = useQuery({
    queryKey: ['graha', 'contact', contactId],
    queryFn:  () => grahaWriteApi.contact(contactId as string),
    enabled:  visible && editing,
  });

  // Annotated, not inferred — `useQuery(...).data` is `any` on this toolchain.
  const loaded: ContactDetail | undefined = detail.data;

  // Reset on OPEN. Clearing on close shows a user their typing vanish mid-animation.
  useEffect(() => {
    if (!visible) return;
    setSaving(false); setConverting(false); setError(null);
    if (!editing) {
      setBefore(null);
      setForm({ ...EMPTY_CONTACT, clientId: initialClient?.id ?? null });
      setClient(initialClient);
    }
  }, [visible, editing]);

  // Seed from the server once it lands. `client_name` comes off the join, so the
  // company picker shows a NAME here — unlike the deal sheet, whose route has no
  // such join.
  useEffect(() => {
    if (!visible || !editing || !loaded) return;
    const seeded: ContactForm = {
      name:        loaded.name ?? '',
      email:       loaded.email ?? '',
      phone:       loaded.phone ?? '',
      designation: loaded.designation ?? '',
      clientId:    loaded.client_id,
      notes:       loaded.notes ?? '',
      contactType: (CONTACT_TYPES as readonly string[]).includes(loaded.contact_type ?? '')
        ? (loaded.contact_type as ContactType)
        : DEFAULT_CONTACT_TYPE,
    };
    setBefore(seeded);
    setForm(seeded);
    setClient(loaded.client_id && loaded.client_name
      ? { id: loaded.client_id, label: loaded.client_name }
      : null);
  }, [visible, editing, loaded?.id]);

  const set = <K extends keyof ContactForm>(key: K, v: ContactForm[K]) =>
    setForm(f => ({ ...f, [key]: v }));

  const patch = useMemo(
    () => (before ? contactPatch(before, form) : {}),
    [before, form],
  );
  const problem = contactError(form);
  const dirty = !editing || !isEmptyPatch(patch);

  /** The edit. Queueable — a PATCH applied twice is the same PATCH. */
  const save = useOfflineMutation<{ contactId: string; patch: Record<string, unknown> }>({
    method: 'PATCH',
    urlBuilder: v => `/v1/graha/contacts/${v.contactId}`,
    bodyBuilder: v => v.patch,
    mutationFn:  v => grahaWriteApi.updateContact(v.contactId, v.patch),
    entity_type: 'graha_contact',
    entityId:    v => v.contactId,
    // No `optimisticId`, so successive edits MERGE in the queue's PATCH squash
    // rather than the later one replacing the earlier one's fields wholesale.
    snapshotKey: v => ['graha', 'contact', v.contactId],
    optimisticUpdate: (v, client_) => {
      client_.setQueryData<ContactDetail | undefined>(['graha', 'contact', v.contactId],
        prev => (prev ? { ...prev, ...v.patch } : prev));
    },
    rollback: (v, snapshot, client_) => {
      if (snapshot) client_.setQueryData(['graha', 'contact', v.contactId], snapshot);
    },
    onlineOptions: {
      onError: (err: unknown) => setError(writeErrorMessage(err, { noun: 'contact' })),
      onSuccess: () => {
        setError(null);
        void qc.invalidateQueries({ queryKey: ['graha', 'contact', contactId] });
        // The pickers read this prefix, and so does anything showing a name
        // beside a deal.
        void qc.invalidateQueries({ queryKey: ['graha', 'contacts'] });
        void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
        onClose();
      },
    },
  });

  const submit = async () => {
    if (problem) { setError(problem); return; }
    if (editing) {
      if (!dirty) { onClose(); return; }
      setError(null);
      await save.mutateAsync({ contactId: contactId as string, patch });
      // The queued path never reaches `onSuccess`, so it closes the sheet
      // itself. `isQueued` and not `online`: the hook re-checks NetInfo at call
      // time, and the render-time flag can be a second stale.
      if (save.isQueued) onClose();
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await grahaWriteApi.createContact(contactCreateBody(form));
      void qc.invalidateQueries({ queryKey: ['graha', 'contacts'] });
      void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
      onClose();
      onCreated?.(created.id, created.name);
    } catch (err) {
      setError(writeErrorMessage(err, { creating: true, noun: 'contact' }));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Lead → customer.
   *
   * Online only. It creates no row, so a replay cannot duplicate anything — but
   * the second arrival is refused with a 400 ("Contact is already a customer"),
   * which the queue treats as permanent and reports as a failure minutes after
   * the conversion in fact succeeded. Better to say the connection is needed.
   */
  const convert = async () => {
    if (!contactId || converting) return;
    setConverting(true);
    setError(null);
    try {
      await grahaWriteApi.convertLead(contactId);
      void qc.invalidateQueries({ queryKey: ['graha', 'contact', contactId] });
      void qc.invalidateQueries({ queryKey: ['graha', 'contacts'] });
      void qc.invalidateQueries({ queryKey: ['graha', 'today'] });
      setForm(f => ({ ...f, contactType: 'customer' }));
      setBefore(b => (b ? { ...b, contactType: 'customer' } : b));
    } catch (err) {
      // The server's own 400 detail is passed through — "already a customer"
      // tells a rep somebody else got there first, which a generic sentence does not.
      setError(writeErrorMessage(err, { noun: 'contact' }));
    } finally {
      setConverting(false);
    }
  };

  const isLead = editing && form.contactType === 'lead';
  const loading = editing && detail.isLoading;
  const failedToLoad = editing && detail.isError;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={editing ? 'Close the edit contact sheet' : 'Close the new contact sheet'}
      panelStyle={panelStyle(t)}
      avoidKeyboard
    >
      <SheetBody
        kickerLatin={editing ? 'EDIT CONTACT' : 'NEW CONTACT'}
        kickerHindi="संपर्क"
        title={form.name || contactName || 'Who did you meet?'}
        onClose={onClose}
        submitLabel={
          editing
            ? (!dirty ? 'Nothing changed' : online ? 'Save changes' : 'Save when back online')
            : (online ? 'Add contact' : 'Needs a connection')
        }
        onSubmit={submit}
        submitting={saving || save.isPending}
        canSubmit={
          !problem && dirty && !loading && !failedToLoad && (editing || online)
        }
      >
        {loading && (
          <ActivityIndicator color={t.primary} style={{ alignSelf: 'flex-start', marginTop: 16 }} />
        )}
        {failedToLoad && (
          <ErrorNote text="This contact did not load, so there is nothing safe to edit. Close and try again." />
        )}

        {!online && !editing && (
          <InfoNote
            icon="cloud-offline-outline"
            text="Adding a contact needs a connection. It is not queued on purpose — a queued create that loses its reply on the way back would be sent twice, and the duplicate cannot be deleted from this phone."
          />
        )}
        {!online && editing && (
          <InfoNote
            icon="cloud-offline-outline"
            text="No connection. An edit is safe to hold on the phone and send later — applying the same change twice is one change."
          />
        )}

        <FieldLabel latin="NAME" hindi="नाम" />
        <Field
          value={form.name}
          onChangeText={v => { set('name', v); if (v.trim()) setError(null); }}
          placeholder="Priya Nair"
          label="Name"
          invalid={!form.name.trim() && !!error}
          autoFocus={!editing}
        />

        <FieldLabel latin="COMPANY" hindi="कंपनी" />
        <PickerField
          source={clients}
          selected={client}
          title="Where do they work?"
          label="Company"
          placeholder="Choose a company…"
          onSelect={(option) => { setClient(option); set('clientId', option.id); }}
          // Clearing IS possible here, unlike on a deal: `update_contact` writes
          // `client_id=NULLIF($n,'')::uuid`, so an empty string detaches them.
          onClear={() => { setClient(null); set('clientId', null); }}
        />

        <FieldLabel latin="ROLE" hindi="पद" />
        <Field
          value={form.designation}
          onChangeText={v => set('designation', v)}
          placeholder="Finance head"
          label="Role"
        />

        <FieldLabel latin="EMAIL" hindi="ईमेल" />
        <Field
          value={form.email}
          onChangeText={v => set('email', v)}
          placeholder="priya@example.com"
          label="Email"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <FieldLabel latin="PHONE" hindi="फ़ोन" />
        <Field
          value={form.phone}
          onChangeText={v => set('phone', v)}
          placeholder="98xxxxxxxx"
          label="Phone"
          keyboardType="phone-pad"
        />

        {/* Only on CREATE. Changing what somebody already is has one legitimate
            path — the convert button below — and a chip row here would offer a
            second one that skips the event. */}
        {!editing && (
          <>
            <FieldLabel latin="THEY ARE A" hindi="प्रकार" />
            <ChipSelect
              options={CONTACT_TYPES.map(k => ({ key: k, label: TYPE_LABELS[k] }))}
              value={form.contactType}
              onChange={k => set('contactType', k as ContactType)}
            />
          </>
        )}

        <FieldLabel latin="NOTES" hindi="टिप्पणी" />
        <Field
          value={form.notes}
          onChangeText={v => set('notes', v)}
          placeholder="How you met, and what they need…"
          label="Notes"
          multiline
        />

        {/* ── Lead → customer ─────────────────────────────────────────────── */}
        {isLead && (
          <View style={s.convertBox}>
            <Text style={[s.convertWhy, { color: t.ink3 }]}>
              This person is still recorded as a lead. Converting stamps the date and lets any
              rule built on "a lead became a customer" fire.
            </Text>
            <TouchableOpacity
              onPress={convert}
              disabled={!online || converting}
              style={[
                s.convertBtn,
                { borderColor: t.success },
                (!online || converting) && s.disabled,
              ]}
              {...a11yButton(
                online ? 'Convert to customer' : 'Convert to customer, needs a connection',
              )}
              accessibilityState={{ disabled: !online || converting, busy: converting }}
            >
              {converting
                ? <ActivityIndicator color={t.success} size="small" />
                : (
                  <>
                    <Ionicons name="checkmark-done-outline" size={16} color={t.success} accessibilityElementsHidden />
                    <Text style={[s.convertText, { color: t.success }]}>
                      {online ? 'Convert to customer' : 'Converting needs a connection'}
                    </Text>
                  </>
                )}
            </TouchableOpacity>
          </View>
        )}

        {error && <ErrorNote text={error} />}
      </SheetBody>
    </Sheet>
  );
}

const s = StyleSheet.create({
  convertBox: { marginTop: 22 },
  convertWhy: { fontSize: 11.5, lineHeight: 16, marginBottom: 8 },
  convertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1.5, borderRadius: 10, paddingVertical: 11, minHeight: 44,
  },
  convertText: { fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
