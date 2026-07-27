import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../../theme/ThemeProvider';
import { hindi } from '../../theme/fonts';
import { a11yButton, a11yHeading, hitSlopTo } from '../../components/a11y';
import ScreenState, { StaleBar, resolveScreenState } from '../../components/ScreenState';
import { useOnline } from '../../hooks/useOnline';
import { pahchanApi, type Punch } from '../../api/pahchan';
import { getQueuedPunches } from '../../offline/punchQueue';
import { useQueueStatus } from '../../hooks/useQueueStatus';
import {
  buildDays, keyFor, hhmm, duration, leadingBlanks,
  type RegisterPunch, type DayRecord,
} from './register';

/**
 * The employee's own attendance register — `07-pahchan.md §9`, and the
 * `My attendance` tab of `MPahchan` in the rendered reference (`Mobile.jsx:311`).
 *
 * The reference is a segmented pair, not two screens: `Clock | My attendance`.
 * Both mount points below render THIS component, so the register a site worker
 * sees in the attendance-only shell and the one an office user reaches from the
 * clock are the same code reading the same endpoint.
 *
 * ── Why the heat map has fewer categories than the mockup ─────────────────────
 *
 * The rendered reference colours its calendar Present · Late · Leave · Weekly off.
 * Its data is a hardcoded literal — `n === 17 ? 'l' : dow === 5 || dow === 6 ? 'wo'`
 * — so those four cost it nothing.
 *
 * `GET /v1/pahchan/me` returns PUNCHES. It carries no leave ledger and no shift
 * calendar, so neither "leave" nor "weekly off" is derivable here. Painting
 * Saturday as a weekly off because it is a Saturday would be this screen
 * asserting the org's shift policy, and it would be wrong for every six-day week
 * and every rotating roster in the country — on the one screen an employee
 * checks before disputing their pay.
 *
 * So a day with no punches reads "No record", which is the true statement, and
 * the categories that ARE derivable get the colour: present, late, and needs
 * review. `Leave` becomes honest the day `/me` returns a leave ledger, not before.
 *
 * ── Offline ──────────────────────────────────────────────────────────────────
 *
 * Punches queued on this device are merged into the register and marked unsent.
 * An employee who clocked in inside a basement must SEE that punch on their own
 * record — a register that shows only what reached the server tells them their
 * morning did not happen, and they will punch again.
 */

/** The server clamps `days` to 120 (`routers/pahchan.py:486`). Ask for all of it
 *  once and page months client-side: ~4 punches a day is a small payload, and a
 *  refetch per month makes paging feel like loading. */
const WINDOW_DAYS = 120;

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ─────────────────────────────────────────────────────────────────────────────

export default function AttendanceHistory() {
  const { t } = useTheme();
  const online = useOnline();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['pahchan', 'me', WINDOW_DAYS],
    queryFn: () => pahchanApi.me(WINDOW_DAYS),
    retry: false,
  });

  const employeeId = query.data?.employee?.id;

  // The merge below cannot be keyed on `query.data` alone: a punch made while
  // offline never changes it, because the refetch it triggers cannot succeed.
  // The employee would punch in a basement, open their register, not find it,
  // and punch again. `useQueueStatus` subscribes to the MMKV write, so a punch
  // enqueued anywhere — including from the Clock tab beside this one — lands
  // here without this screen polling for it.
  const { punches: queued } = useQueueStatus();
  const queueVersion = queued.count;

  // Server punches plus anything still on this device. Queued punches carry no
  // server id, so the client id stands in — it is already unique and idempotent.
  const merged: RegisterPunch[] = useMemo(() => {
    const fromServer: RegisterPunch[] = (query.data?.punches ?? []).map((p: Punch) => ({
      id:             p.id,
      direction:      p.direction,
      captured_at:    p.captured_at,
      flags:          p.flags ?? [],
      accuracy_m:     p.accuracy_m,
      distance_m:     p.distance_m,
      review_verdict: p.review_verdict,
      pending:        false,
    }));
    const queued: RegisterPunch[] = getQueuedPunches().map(q => ({
      id:             q.client_punch_id,
      direction:      q.direction,
      captured_at:    q.captured_at,
      flags:          ['offline'],
      accuracy_m:     q.accuracy_m ?? null,
      distance_m:     null,
      review_verdict: null,
      pending:        true,
    }));
    return [...fromServer, ...queued];
  }, [query.data, queueVersion]);

  const days = useMemo(() => buildDays(merged), [merged]);

  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first, matching the reference's M T W T F S S row.
  const leading = leadingBlanks(year, month);
  const todayKey = keyFor(now.getFullYear(), now.getMonth(), now.getDate());

  const monthRecords = useMemo(() => {
    const out: DayRecord[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const rec = days.get(keyFor(year, month, d));
      if (rec) out.push(rec);
    }
    return out;
  }, [days, year, month, daysInMonth]);

  const stats = useMemo(() => ({
    present: monthRecords.length,
    late:    monthRecords.filter(r => r.late).length,
    review:  monthRecords.filter(r => r.review).length,
    hours:   monthRecords.reduce((sum, r) => sum + r.workedMs, 0),
  }), [monthRecords]);

  const status = resolveScreenState({
    isLoading: query.isLoading,
    isError:   query.isError,
    error:     query.error,
    online,
    hasData:   !!query.data,
    // Never "empty": an employee with no punches this month still needs the
    // calendar and the retention note. Empty would replace the answer with a
    // placeholder on exactly the month they are trying to check.
    isEmpty:   false,
  });

  if (status !== 'ready') {
    return (
      <ScreenState
        status={status}
        onRetry={() => void query.refetch()}
        title={status === 'forbidden' ? 'Attendance is not set up for you' : undefined}
        body={status === 'forbidden'
          ? 'You are not on the attendance register. If you should be, your HR admin can add you.'
          : undefined}
      />
    );
  }

  // Signed in, but not an employee anyone tracks. Same reasoning as
  // MyBiometrics: this component is reachable from a shared surface.
  if (!employeeId) {
    return (
      <ScreenState
        status="empty"
        icon="calendar-outline"
        title="No attendance record"
        body="You are not on your organisation's attendance register, so there is nothing to show here."
      />
    );
  }

  const stale = !online;
  const sel = selected ? days.get(selected) : undefined;

  const swatch = (rec?: DayRecord) => {
    if (!rec) return { bg: 'transparent', fg: t.ink4, border: t.outlineVar };
    if (rec.review) return { bg: t.errorBg, fg: t.onErrorContainer, border: t.error };
    if (rec.late) return { bg: t.approvalBg, fg: t.onApprovalContainer, border: t.approval };
    return { bg: t.successBg, fg: t.onSuccessContainer, border: t.success };
  };

  return (
    <View style={s.wrap}>
      {stale && <StaleBar label="Offline — this is the register as of the last time this device synced." />}

      {/* ── Month ── */}
      <View style={s.monthRow}>
        <Pressable
          onPress={() => { setMonthOffset(n => n + 1); setSelected(null); }}
          disabled={monthOffset >= 3}
          hitSlop={hitSlopTo(24)}
          {...a11yButton('Previous month')}
        >
          <Ionicons name="chevron-back" size={20} color={monthOffset >= 3 ? t.inkDisabled : t.ink2} />
        </Pressable>
        <Text style={[s.month, { color: t.ink }]} {...a11yHeading(`${MONTHS[month]} ${year}`)}>
          {MONTHS[month]} {year}
        </Text>
        <Pressable
          onPress={() => { setMonthOffset(n => Math.max(0, n - 1)); setSelected(null); }}
          disabled={monthOffset === 0}
          hitSlop={hitSlopTo(24)}
          {...a11yButton('Next month')}
        >
          <Ionicons name="chevron-forward" size={20} color={monthOffset === 0 ? t.inkDisabled : t.ink2} />
        </Pressable>
      </View>

      {/* ── Stats ── */}
      <View style={s.stats}>
        <Stat t={t} value={`${stats.present}`} label="Days present" />
        <Stat t={t} value={`${stats.late}`} label="Late" tone={stats.late ? t.approval : undefined} />
        <Stat t={t} value={`${stats.review}`} label="Needs review" tone={stats.review ? t.error : undefined} />
        <Stat t={t} value={duration(stats.hours)} label="Hours" />
      </View>

      {/* ── Heat map ── */}
      <View style={s.cal}>
        {DOW.map((d, i) => (
          <Text key={i} style={[s.dow, { color: t.ink4 }]}>{d}</Text>
        ))}
        {Array.from({ length: leading }, (_, i) => <View key={`lead${i}`} style={s.cell} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const n = i + 1;
          const key = keyFor(year, month, n);
          const rec = days.get(key);
          const c = swatch(rec);
          const isToday = key === todayKey;
          const isSel = key === selected;
          const future = new Date(year, month, n) > now;
          const label = rec
            ? `${n} ${MONTHS[month]}, ${rec.review ? 'needs review' : rec.late ? 'late' : 'present'}, ${duration(rec.workedMs)}`
            : `${n} ${MONTHS[month]}, no record`;
          return (
            <Pressable
              key={key}
              onPress={() => setSelected(isSel ? null : key)}
              disabled={!rec}
              {...a11yButton(label)}
              accessibilityState={{ selected: isSel, disabled: !rec }}
              style={s.cell}
            >
              <View style={[
                s.day,
                {
                  backgroundColor: c.bg,
                  borderColor: isSel ? t.primary : c.border,
                  borderWidth: isSel ? 2 : rec ? 1 : StyleSheet.hairlineWidth,
                  opacity: future ? 0.4 : 1,
                },
                isToday && { borderColor: t.primary },
              ]}>
                <Text style={[s.dayNum, { color: rec ? c.fg : t.ink4, fontWeight: isToday ? '800' : '600' }]}>
                  {n}
                </Text>
                {rec?.pending && <View style={[s.pendingDot, { backgroundColor: t.primary }]} />}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* ── Legend ── */}
      <View style={s.legend}>
        <LegendKey t={t} bg={t.successBg} border={t.success} label="Present" />
        <LegendKey t={t} bg={t.approvalBg} border={t.approval} label="Late" />
        <LegendKey t={t} bg={t.errorBg} border={t.error} label="Needs review" />
        <LegendKey t={t} bg="transparent" border={t.outlineVar} label="No record" />
      </View>

      <Text style={[s.note, { color: t.ink3 }]}>
        A day with no record means no punch reached us — it does not mean leave or a
        weekly off. Those live in your leave ledger on the web app.
      </Text>

      {/* ── Selected day ── */}
      {sel ? (
        <View style={[s.detail, { backgroundColor: t.surface, borderColor: t.outlineVar }]}>
          <Text style={[s.detailHead, { color: t.ink }]}>
            {new Date(sel.date + 'T00:00:00').getDate()} {MONTHS[month]}
          </Text>
          <Line t={t} k="Clock in" v={hhmm(sel.firstIn?.captured_at)} />
          <Line t={t} k="Clock out" v={hhmm(sel.lastOut?.captured_at)}
            sub={!sel.lastOut && sel.firstIn ? 'No clock-out recorded' : undefined} />
          <Line t={t} k="Total" v={duration(sel.workedMs)}
            sub={sel.workedMs === 0 && sel.firstIn ? 'Needs a clock-out before it counts' : undefined} />
          <Line t={t} k="Punches" v={`${sel.punches.length}`} />
          {sel.firstIn?.distance_m != null && (
            <Line t={t} k="Distance from site" v={`${Math.round(sel.firstIn.distance_m)}m`} />
          )}
          {sel.pending && (
            <Text style={[s.detailNote, { color: t.onApprovalContainer, backgroundColor: t.approvalBg }]}>
              A punch from this day is still on this phone and has not reached the
              server yet. It keeps the time you pressed the button, not the time it sends.
            </Text>
          )}
          {sel.review && (
            <Text style={[s.detailNote, { color: t.ink2, backgroundColor: t.surface2 }]}>
              Flagged for a person at your organisation to look at. A flag is not a
              rejection — it means the punch needs a human, usually because location
              was weak or you were away from a site.
            </Text>
          )}
        </View>
      ) : (
        <Text style={[s.note, { color: t.ink4 }]}>Tap a day to see its punches.</Text>
      )}

      <Text style={[s.note, { color: t.ink4 }]}>
        This device holds the last {WINDOW_DAYS} days. Earlier months are on the web app.
      </Text>
    </View>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stat({ t, value, label, tone }: { t: any; value: string; label: string; tone?: string }) {
  return (
    <View style={[s.stat, { backgroundColor: t.surface, borderColor: t.outlineVar }]}
      accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.statValue, { color: tone ?? t.ink }]} numberOfLines={1}
        adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text style={[s.statLabel, { color: t.ink3 }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function LegendKey({ t, bg, border, label }: { t: any; bg: string; border: string; label: string }) {
  return (
    <View style={s.legendKey}>
      <View style={[s.legendSwatch, { backgroundColor: bg, borderColor: border }]} />
      <Text style={[s.legendText, { color: t.ink3 }]}>{label}</Text>
    </View>
  );
}

function Line({ t, k, v, sub }: { t: any; k: string; v: string; sub?: string }) {
  return (
    <View style={s.line}>
      <Text style={[s.lineK, { color: t.ink2 }]}>{k}</Text>
      <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
        <Text style={[s.lineV, { color: t.ink }]}>{v}</Text>
        {!!sub && <Text style={[s.lineSub, { color: t.ink4 }]}>{sub}</Text>}
      </View>
    </View>
  );
}

/** The `Clock | My attendance` segment the reference draws above both tabs. */
export function AttendanceSegment({ tab, onChange }: {
  tab: 'clock' | 'history';
  onChange: (next: 'clock' | 'history') => void;
}) {
  const { t } = useTheme();
  const items: [('clock' | 'history'), string, string][] = [
    ['clock', 'Clock', 'उपस्थिति'],
    ['history', 'My attendance', 'हाज़िरी'],
  ];
  return (
    <View style={[s.seg, { backgroundColor: t.surface3 }]} accessibilityRole="tablist">
      {items.map(([id, en, hi]) => {
        const on = id === tab;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={en}
            style={[s.segBtn, on && { backgroundColor: t.surface }]}
          >
            <Text style={[s.segText, { color: on ? t.ink : t.ink3 }]}>{en}</Text>
            <Text style={[s.segHi, { color: on ? t.primaryText : t.ink4 }]}>{hi}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, gap: 10, paddingBottom: 12 },

  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  month: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexGrow: 1, flexBasis: '22%', minWidth: 74,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, gap: 3,
  },
  statValue: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 10, lineHeight: 13, fontWeight: '600' },

  cal: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  dow: {
    width: `${100 / 7}%`, textAlign: 'center', fontSize: 10,
    fontWeight: '800', letterSpacing: 0.6, paddingBottom: 6,
  },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2.5 },
  day: {
    flex: 1, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  dayNum: { fontSize: 12.5 },
  pendingDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendKey: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 11, height: 11, borderRadius: 3, borderWidth: 1 },
  legendText: { fontSize: 11, fontWeight: '600' },

  note: { fontSize: 11.5, lineHeight: 16.5, marginTop: 2 },

  detail: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 7, marginTop: 4 },
  detailHead: { fontSize: 13.5, fontWeight: '800', paddingBottom: 2 },
  detailNote: { fontSize: 11.5, lineHeight: 16.5, borderRadius: 8, padding: 9, marginTop: 3 },

  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  lineK: { fontSize: 12.5, flexShrink: 1 },
  lineV: { fontSize: 12.5, fontWeight: '700' },
  lineSub: { fontSize: 10.5, marginTop: 1, textAlign: 'right' },

  seg: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 3 },
  segBtn: { flex: 1, alignItems: 'center', borderRadius: 8, paddingVertical: 7, gap: 1 },
  segText: { fontSize: 12.5, fontWeight: '700' },
  segHi: { fontSize: 10, ...hindi() },
});
