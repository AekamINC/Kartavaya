import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { pahchanApi } from '../../api/pahchan';
import AttendanceHistory from './AttendanceHistory';

/**
 * The register, as a section of the Me tab — `07-pahchan.md §9`.
 *
 * §9 asks Me for three things: the reference pair, the retention promise, and
 * the employee's own register. `MyBiometrics` carries the first two. This is the
 * third, and it is the same component the Clock screen's `My attendance` tab
 * renders — one register, two ways in.
 *
 * Renders NOTHING for anyone who is not a Pahchan employee, for the same reason
 * `MyBiometrics` does: a settings surface must not grow an error card because a
 * module the user has nothing to do with returned no rows. The guard lives here
 * rather than inside `AttendanceHistory` because that component is also mounted
 * as a full screen, where "you have no attendance record" IS the right answer to
 * show — the same emptiness means different things in the two places.
 */
export default function MyRegister({ t }: { t: any }) {
  const { data } = useQuery({
    // `days` belongs in the key. Two call sites asking for different windows
    // under one key get whichever landed first, which is a cache that lies.
    queryKey: ['pahchan', 'me', 1],
    queryFn: () => pahchanApi.me(1),
    retry: false,
  });

  if (!data?.employee?.id) return null;

  return (
    <View style={s.wrap}>
      <View style={s.labelRow}>
        <Text style={[s.label, { color: t.primary }]}>Your attendance record</Text>
        <Text style={[s.hi, { color: t.ink3 }]}>हाज़िरी</Text>
      </View>
      <View style={[s.card, { backgroundColor: t.surfaceLow }]}>
        <AttendanceHistory />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:     { paddingBottom: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 22, paddingBottom: 8 },
  label:    { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  hi:       { fontSize: 12, fontFamily: 'TiroDevanagariHindi' },
  card:     { marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', paddingVertical: 10 },
});
