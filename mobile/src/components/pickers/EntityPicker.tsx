/**
 * EntityPicker — ONE searchable chooser, for every entity a form has to point at.
 *
 * Four forms need this and none of them had it: there is no contact picker, no
 * client picker, no product picker, and the only assignee list in the app is
 * hard-wired inside `NewTaskSheet` against a project's members. Each of those
 * would otherwise have arrived as its own list-and-filter, and each would have
 * had to rediscover the two rules below on its own.
 *
 * ── WHY THE SEARCH IS THE SERVER'S ───────────────────────────────────────────
 *
 * The whole argument is in `entitySource.ts`: `GET /v1/graha/contacts` is capped
 * at `LIMIT 200` and staging holds 292 contacts, so filtering a fetched array
 * silently withholds 92 people and looks exactly like a working search while it
 * does it. The source declares `serverSearch`; this component only obeys it.
 *
 * ── WHY THIS IS A SHEET AND NOT A DROPDOWN ───────────────────────────────────
 *
 * `MentionInput` is the nearest prior art and it anchors a six-row popover above
 * the composer, which is right for `@` in a chat line and wrong here. A picker
 * over 292 contacts needs a search field of its own, a scrollable result list
 * and room for a second line per row; a popover above a form field on a phone
 * has none of those. `Sheet` already owns the scrim, the reduced-motion
 * behaviour and the keyboard avoidance — and on a tablet it becomes a centred
 * form sheet with no call-site change.
 *
 * ── OFFLINE IS A DEGRADED SEARCH, AND IT SAYS SO ─────────────────────────────
 *
 * When the search request fails, the picker falls back to filtering whatever the
 * unsearched first page left in the cache — which the persister has kept across
 * launches. That page was capped by the same LIMIT, so the fallback is genuinely
 * partial, and saying nothing would reproduce the original defect with an
 * excuse. `truncationNotice` writes the sentence.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 *
 * Creating a record. `onCreate` is a PROP: the picker offers the affordance and
 * hands back what was typed, and the form that owns the entity decides what a
 * new one costs — a contact needs a company, a product needs a rate and a GST
 * class, and neither belongs in a chooser. Multi-select is also absent; every
 * one of the four forms picks exactly one, and `NewTaskSheet`'s assignee list
 * stays as it is until somebody asks for the multi-select case out loud.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import Sheet from '../Sheet';
import BiLabel from '../../theme/BiLabel';
import { useTheme } from '../../theme/ThemeProvider';
import { AVATAR_COLORS, userInitials } from '../../theme/tokens';
import { display } from '../../theme/fonts';
import { apiClient } from '../../api/client';
import { a11yButton, a11yInput, MIN_TOUCH } from '../a11y';
import {
  listMeta, localFilter, paramSignature, requestParams, shouldAskServer, toOptions,
  truncationNotice, unwrapRows,
  type EntitySource, type PickerOption, type Row,
} from './entitySource';

/**
 * The debounce sits in FRONT of the query key, not behind it.
 *
 * Same reasoning as `MentionInput`: the key carries the query string, so keying
 * on every keystroke mints one cache entry per character of every name anybody
 * half-typed. 220ms rather than that file's 200 — a picker's list is a bigger
 * visual change than six suggestion rows, so it is worth one more frame of
 * settling, and it is still under the threshold where the list feels behind the
 * finger.
 */
const DEBOUNCE_MS = 220;

/**
 * How many rows are DRAWN. The server sends up to 200; a FlatList will render
 * them all happily, but a chooser that needs scrolling past fifty is a search
 * that has not been narrowed, and the notice already says to narrow it.
 */
const MAX_ROWS = 50;

export interface EntityPickerProps {
  visible: boolean;
  onClose: () => void;
  /** What this picker is pointed at. See `entitySource.ts`. */
  source: EntitySource;
  /**
   * The choice. Both halves are handed back: the option for what to display,
   * the raw row for the fields the form needs (a product's rate, a contact's
   * `client_id`) without a second request.
   */
  onSelect: (option: PickerOption, row: Row) => void;
  /** Currently chosen, so the row can be ticked. An id — never rendered. */
  selectedId?: string | null;
  /** Overrides the source's own kicker, for a form that names the field itself. */
  kicker?: string;
  /** The one-line prompt under the kicker. */
  title?: string;
  /**
   * The inline "create new" affordance — a PROP, not built in. Receives whatever
   * was typed, so the form can pre-fill the name. Absent means no offer.
   */
  onCreate?: (typed: string) => void;
  /** e.g. `Add a new contact`. Falls back to the source's noun. */
  createLabel?: string;
}

export default function EntityPicker({
  visible, onClose, source, onSelect, selectedId = null,
  kicker, title, onCreate, createLabel,
}: EntityPickerProps) {
  const { t } = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // Reset on open. A picker that reopens holding the last search would show the
  // previous form's answer, which reads as the field having been pre-filled.
  useEffect(() => {
    if (visible) { setQuery(''); setDebounced(''); }
  }, [visible]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const sig = useMemo(() => paramSignature(source), [source]);

  /**
   * The UNSEARCHED page.
   *
   * Two jobs, which is why it is a separate query from the search below:
   *
   *  · It is what the picker shows before anything is typed, and the whole list
   *    for a source the server cannot search.
   *  · It is the OFFLINE corpus. Its key carries no query string, so it is one
   *    stable entry that `offline/queryClient`'s persister writes to MMKV and
   *    restores on a cold start — the picker works on a plane because of this
   *    query specifically.
   *
   * The key is prefixed with the source's own — `['graha','contacts', …]` — so a
   * delta sync invalidating `['graha','contacts']` reaches it by prefix without
   * `sessionSync` knowing pickers exist.
   */
  const base = useQuery({
    queryKey: [...source.queryKey, 'picker', sig],
    queryFn: ({ signal }) =>
      apiClient.get(source.url, { params: requestParams(source, ''), signal })
        .then(r => r.data as unknown),
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const askServer = shouldAskServer(source, debounced);

  /**
   * The search.
   *
   * `gcTime: 0` is load-bearing and not a micro-optimisation. The key carries
   * the debounced string, and `offline/queryClient`'s `EPHEMERAL` exclusion only
   * covers keys beginning `['messaging', …]` — so without this, every distinct
   * query anybody ever typed would be serialised into the single `rq_cache` MMKV
   * string and held for the full two-hour `maxAge`. At zero, the entry dies with
   * its observer, so at most ONE search result is ever on disk: the one on
   * screen. The proper fix is a source-agnostic rule in `queryClient.ts`, which
   * is not this agent's file — reported, not touched.
   *
   * `signal` is forwarded to axios, so a query that is superseded mid-flight is
   * genuinely aborted rather than merely ignored. The debounce prevents most of
   * these; the abort handles the one that got away on a slow connection.
   */
  const search = useQuery({
    queryKey: [...source.queryKey, 'picker', sig, 'q', debounced],
    queryFn: ({ signal }) =>
      apiClient.get(source.url, { params: requestParams(source, debounced), signal })
        .then(r => r.data as unknown),
    enabled: visible && askServer,
    gcTime: 0,
    retry: 1,
  });

  /**
   * The server was asked and could not answer. NOT `!search.data` — a query in
   * flight has no data either, and calling that offline would flash the warning
   * on every keystroke ahead of the rows it stands in for. The same distinction
   * `MentionInput` draws with `isSuccess`.
   */
  const offline = askServer && search.isError;

  const { rows, meta } = useMemo(() => {
    // Annotated on the way out of the query rather than inferred: with
    // `moduleResolution: "node"` react-query's `TData` leaks unbound, so
    // `.data` is `any` here and a mistyped field would compile. ChatScreen and
    // MentionInput both state this at length over their own queries.
    const searchBody: unknown = search.data;
    const baseBody: unknown = base.data;

    // The searched page when there is one; otherwise the unsearched page,
    // filtered here. That second branch is BOTH the offline path and the normal
    // path for a source the server cannot search — they need identical
    // treatment, and giving them one branch is what stops the two drifting.
    if (askServer && !offline && searchBody !== undefined) {
      return { rows: unwrapRows(searchBody), meta: listMeta(searchBody) };
    }
    const all = unwrapRows(baseBody);
    return { rows: localFilter(all, source, query), meta: listMeta(baseBody) };
  }, [search.data, base.data, askServer, offline, source, query]);

  const { options, unnamed } = useMemo(() => toOptions(rows, source), [rows, source]);
  const shown = useMemo(() => options.slice(0, MAX_ROWS), [options]);

  // The raw row behind each option, so `onSelect` can hand the form the fields
  // it needs without a second request. Keyed by the id, which is the one thing
  // guaranteed unique and the one thing never drawn.
  const rowById = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) {
      const v = source.value(r);
      if (typeof v === 'string' && v) m.set(v, r);
    }
    return m;
  }, [rows, source]);

  const notice = useMemo(() => truncationNotice({
    meta,
    shown: shown.length,
    query,
    offline,
    noun: source.noun,
  }), [meta, shown.length, query, offline, source.noun]);

  const loading = base.isLoading || (askServer && search.isFetching && !search.data);
  const failedEntirely = base.isError && !base.data;

  const choose = useCallback((opt: PickerOption) => {
    const row = rowById.get(opt.id);
    if (!row) return;
    onSelect(opt, row);
    onClose();
  }, [rowById, onSelect, onClose]);

  const s = styles(t);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={`Close ${source.noun.one} picker`}
      panelStyle={s.sheet}
      avoidKeyboard
    >
      <View style={s.handle} />

      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <BiLabel
            latinStyle={s.kicker}
            hindiStyle={{ color: t.primaryText }}
            hindiSize={11}
            style={{ marginBottom: 2 }}
          >
            {kicker ?? source.kicker}
          </BiLabel>
          <Text style={s.title}>{title ?? `Choose a ${source.noun.one}`}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} {...a11yButton('Close')}>
          <Ionicons name="close" size={22} color={t.ink3} accessibilityElementsHidden />
        </Pressable>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color={t.ink3} accessibilityElementsHidden />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={source.placeholder}
          placeholderTextColor={t.ink4}
          style={s.searchInput}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          {...a11yInput(
            source.placeholder,
            source.serverSearch
              ? 'Results come from the server as you type'
              : 'Filters the list below',
          )}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} {...a11yButton('Clear search')}>
            <Ionicons name="close-circle" size={16} color={t.ink3} accessibilityElementsHidden />
          </Pressable>
        )}
        {/* Sits INSIDE the field rather than replacing the list. Swapping the
            rows for a spinner on every keystroke makes a search feel like it is
            reloading a page; the previous answer staying put while the next one
            arrives is what makes it feel like typing. */}
        {askServer && search.isFetching && (
          <ActivityIndicator size="small" color={t.primary} />
        )}
      </View>

      {notice.text && (
        <Text
          style={[s.notice, { color: notice.tone === 'warn' ? t.error : t.ink3 }]}
          accessibilityLiveRegion="polite"
        >
          {notice.text}
        </Text>
      )}

      {/* Said, not swallowed. A row dropped for having no renderable name is a
          record the reader cannot reach from here, and a picker that quietly
          omits it is how somebody concludes it does not exist and creates it
          again — the same failure as the LIMIT, arrived at from the other side. */}
      {unnamed > 0 && (
        <Text style={[s.notice, { color: t.ink3 }]}>
          {unnamed === 1
            ? `1 ${source.noun.one} has no name and is not listed.`
            : `${unnamed} ${source.noun.many} have no name and are not listed.`}
        </Text>
      )}

      {loading && shown.length === 0 ? (
        <View style={s.state}>
          <ActivityIndicator color={t.primary} />
        </View>
      ) : failedEntirely ? (
        <View style={s.state}>
          <Text style={[s.stateText, { color: t.ink3 }]}>
            {`Can't load ${source.noun.many}. Check your connection and try again.`}
          </Text>
        </View>
      ) : shown.length === 0 ? (
        <View style={s.state}>
          <Text style={[s.stateText, { color: t.ink3 }]}>
            {query.trim()
              ? `No ${source.noun.many} match “${query.trim()}”.`
              : `No ${source.noun.many} yet.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={o => o.id}
          keyboardShouldPersistTaps="handled"
          style={s.list}
          renderItem={({ item, index }) => {
            const picked = selectedId != null && selectedId === item.id;
            return (
              <Pressable
                onPress={() => choose(item)}
                style={({ pressed }) => [
                  s.row,
                  pressed && { backgroundColor: t.surface3 },
                  picked && { backgroundColor: t.primary + '12' },
                ]}
                accessibilityRole="button"
                /* The label is the NAME and, where there is one, the second
                   line — a screen reader user distinguishing two people called
                   Sharma needs the company read out too, and it is already on
                   screen for everyone else. */
                accessibilityLabel={item.sublabel ? `${item.label}, ${item.sublabel}` : item.label}
                accessibilityState={{ selected: picked }}
              >
                <View
                  style={[s.avatar, { backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }]}
                  accessibilityElementsHidden
                >
                  <Text style={s.avatarText}>{userInitials(item.label)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.rowLabel, { color: t.ink }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {!!item.sublabel && (
                    <Text style={[s.rowSub, { color: t.ink3 }]} numberOfLines={1}>
                      {item.sublabel}
                    </Text>
                  )}
                </View>
                {picked && (
                  <Ionicons
                    name="checkmark-circle" size={18} color={t.primary}
                    accessibilityElementsHidden
                  />
                )}
              </Pressable>
            );
          }}
        />
      )}

      {/* The create affordance, when the caller offered one. At the FOOT and not
          at the head of the list: it is the answer to "it is not here", which is
          a conclusion reached after reading, and putting it first makes the
          commonest action on the screen the one that adds a duplicate. */}
      {onCreate && (
        <Pressable
          onPress={() => { onCreate(query.trim()); onClose(); }}
          style={({ pressed }) => [s.create, pressed && { backgroundColor: t.surface3 }]}
          {...a11yButton(
            createLabel ?? (query.trim()
              ? `Add “${query.trim()}” as a new ${source.noun.one}`
              : `Add a new ${source.noun.one}`),
          )}
        >
          <Ionicons name="add-circle-outline" size={18} color={t.primary} accessibilityElementsHidden />
          <Text style={[s.createText, { color: t.primary }]} numberOfLines={1}>
            {createLabel ?? (query.trim()
              ? `Add “${query.trim()}” as a new ${source.noun.one}`
              : `Add a new ${source.noun.one}`)}
          </Text>
        </Pressable>
      )}
    </Sheet>
  );
}

/**
 * The FIELD that opens it — the form-facing half.
 *
 * Without this each of the four forms writes its own pressable-that-shows-the-
 * chosen-name, and the one rule that matters gets re-decided four times: an
 * EMPTY field shows the placeholder, never the id, and a field holding a choice
 * shows the NAME the picker displayed. A form holding only an id from a previous
 * save has no name to show, so it says so rather than printing the uuid it has.
 */
export interface EntityFieldProps {
  /** What was chosen, as the picker displayed it. `null` when nothing is. */
  selected: PickerOption | null;
  /**
   * True when the form holds an id whose name it has not resolved — a loaded
   * draft, usually. Draws "Loading…" rather than the id.
   */
  resolving?: boolean;
  onPress: () => void;
  onClear?: () => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

export function EntityField({
  selected, resolving = false, onPress, onClear, label, placeholder = 'Choose…', disabled = false,
}: EntityFieldProps) {
  const { t } = useTheme();
  const s = styles(t);

  const text = selected?.label ?? (resolving ? 'Loading…' : placeholder);
  const empty = !selected;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.field,
        { borderColor: t.outline, backgroundColor: t.bg },
        pressed && !disabled && { backgroundColor: t.surface3 },
        disabled && { opacity: 0.5 },
      ]}
      {...a11yButton(selected ? `${label}: ${selected.label}` : `${label}, none chosen`)}
      accessibilityState={{ disabled }}
    >
      <Text
        style={[s.fieldText, { color: empty ? t.ink4 : t.ink }]}
        numberOfLines={1}
      >
        {text}
      </Text>
      {selected && onClear ? (
        <Pressable onPress={onClear} hitSlop={10} {...a11yButton(`Clear ${label}`)}>
          <Ionicons name="close-circle" size={16} color={t.ink3} accessibilityElementsHidden />
        </Pressable>
      ) : (
        <Ionicons name="chevron-down" size={16} color={t.ink3} accessibilityElementsHidden />
      )}
    </Pressable>
  );
}

const styles = (t: ReturnType<typeof useTheme>['t']) => StyleSheet.create({
  // The scrim, the bottom anchoring and the tablet form-sheet width all belong
  // to `Sheet`. This is the panel's own skin and nothing else.
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 20,
    // Taller than NewTaskSheet's 92% would be wrong the other way: this panel is
    // a list, and a list that fills the screen leaves nothing of the form behind
    // it to say what is being chosen FOR.
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: t.outline, alignSelf: 'center',
    marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
  },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: t.primary },
  title: { fontSize: 20, color: t.ink, ...display(400) },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, paddingHorizontal: 12,
    borderWidth: 1, borderColor: t.outline, borderRadius: 12,
    backgroundColor: t.bg,
    minHeight: MIN_TOUCH,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, color: t.ink, paddingVertical: 10 },

  notice: { paddingHorizontal: 20, paddingTop: 8, fontSize: 12, lineHeight: 17 },

  list: { marginTop: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 8,
    minHeight: MIN_TOUCH,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12, marginTop: 1 },

  state: { paddingHorizontal: 20, paddingVertical: 32, alignItems: 'center' },
  stateText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },

  create: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, minHeight: MIN_TOUCH,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.outline,
    marginTop: 4,
  },
  createText: { flex: 1, fontSize: 14, fontWeight: '600' },

  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1, borderRadius: 12,
    minHeight: MIN_TOUCH,
  },
  fieldText: { flex: 1, minWidth: 0, fontSize: 15 },
});
