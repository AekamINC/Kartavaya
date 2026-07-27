import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, Animated,
  TextInput as RNTextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { a11yButton, a11yInput } from '../components/a11y';
import { KIcon } from '../components/icons/KIcon';
import { BRAND_GRADIENT } from '../theme/tokens';
import { useReducedMotion, amplitude, EASE, SHAKE } from '../theme/motion';

// LoginScreen does not use ThemeProvider tokens — it always renders the dark
// branded gradient regardless of system theme preference.
const C = {
  dark:    '#020d1a',
  navy:    '#040f1e',
  blue:    '#04837A',
  teal:    '#05b7aa',
  mid:     '#026B64',
  muted:   '#8aa5be',
  card:    '#0b1829',
  border:  'rgba(4,131,122,0.25)',
  borderF: 'rgba(4,131,122,0.7)',
  inputBg: 'rgba(255,255,255,0.05)',
  error:   '#ff6b6b',
};
const GRAD: [string, string, string] = BRAND_GRADIENT;
const BG:    [string,string,string] = [C.dark, C.navy, '#060e1e'];

export default function LoginScreen() {
  const { login }              = useAuth();
  const [email, setEmail]      = useState('');
  const [password, setPassword]= useState('');
  const [loading, setLoading]  = useState(false);
  const [errMsg, setErrMsg]    = useState('');
  const [showPw, setShowPw]    = useState(false);
  const pwRef = useRef<RNTextInput>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  /**
   * The auth error shake.
   *
   * Two things were wrong with it.
   *
   * It ran unguarded. A ±8px horizontal oscillation is the most vestibular-
   * hostile motion in the app, it fires on every failed login — i.e. repeatedly,
   * to someone already having trouble — and it was one of two animations that
   * never consulted `AccessibilityInfo.isReduceMotionEnabled`. Under reduced
   * motion it is now skipped entirely and the value pinned to 0: the error text
   * and the red border still appear, so nothing about the failure goes
   * unreported, it simply is not reported by shoving the card sideways.
   *
   * And it was off-spec in both dimensions. MOTION-SPEC §4 gives the form shake
   * as `420ms cubic-bezier(.36,.07,.19,.97)`, ±4px. This was 5 × 60ms = 300ms at
   * ±8px with RN's default easing — 40% too fast and twice the throw, which is
   * why it read as a judder rather than a nudge. Both numbers now come from
   * SHAKE and the curve from EASE.shake, and the amplitude runs through
   * `amplitude()` so the distance collapses on the same signal as the duration.
   */
  const doShake = () => {
    if (reduced) { shake.setValue(0); return; }
    const a = amplitude(SHAKE.amplitude, reduced);
    // Four traversals plus the settle, sharing the spec's 420ms budget.
    const step = SHAKE.duration / 5;
    const leg = (toValue: number) =>
      Animated.timing(shake, {
        toValue, duration: step, easing: EASE.shake, useNativeDriver: true,
      });
    Animated.sequence([leg(a), leg(-a), leg(a * 0.75), leg(-a * 0.75), leg(0)]).start();
  };

  const submit = async () => {
    setErrMsg('');
    if (!email.trim() || !password) {
      setErrMsg('Enter your email and password.');
      doShake();
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // RootStack re-renders automatically when user changes
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } }; message?: string } | null;
      const detail   = axiosErr?.response?.data?.detail;
      setErrMsg(
        typeof detail === 'string' ? detail
        : typeof axiosErr?.message === 'string' && axiosErr.message.length > 0
          ? axiosErr.message
          : 'Could not sign in. Try again.'
      );
      doShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <LinearGradient colors={BG} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo ── */}
          <View style={s.logoSection}>
            <KIcon size={80} radius={24} />
            <Text style={s.brand}>Kartavaya</Text>
            <Text style={s.brandSub}>BY AEKAM INC</Text>
            <Text style={s.tagline}>Do what must be done.</Text>
          </View>

          {/* ── Card ── */}
          <Animated.View style={[s.card, { transform: [{ translateX: shake }] }]}>
            <Text style={s.cardTitle}>Sign In</Text>

            {/* Error */}
            {/* A sign-in failure was shown but never spoken: the banner had no
                role and no live region, so a screen-reader user pressed SIGN
                IN and got silence. `alert` + assertive is 23 §Defect 3's rule
                applied to the one error the user cannot proceed past. */}
            {!!errMsg && (
              <View
                style={s.errBanner}
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                accessibilityLabel={errMsg}
              >
                <Ionicons name="alert-circle" size={14} color={C.error} accessibilityElementsHidden />
                <Text style={s.errText}>{errMsg}</Text>
              </View>
            )}

            {/* Email */}
            <Text style={s.label}>EMAIL</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(v) => { setEmail(v); setErrMsg(''); }}
              placeholder="you@company.com"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => pwRef.current?.focus()}
              blurOnSubmit={false}
              {...a11yInput('Email')}
            />

            {/* Password */}
            <Text style={[s.label, { marginTop: 14 }]}>PASSWORD</Text>
            <View style={s.pwWrap}>
              <TextInput
                ref={pwRef}
                style={[s.input, { flex: 1, borderWidth: 0, padding: 0 }]}
                value={password}
                onChangeText={(v) => { setPassword(v); setErrMsg(''); }}
                placeholder="••••••••"
                placeholderTextColor={C.muted}
                secureTextEntry={!showPw}
                returnKeyType="go"
                onSubmitEditing={submit}
                autoComplete="password"
                {...a11yInput('Password')}
              />
              <TouchableOpacity
                onPress={() => setShowPw(v => !v)}
                style={s.eyeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                {...a11yButton(showPw ? 'Hide password' : 'Show password')}
              >
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.muted} accessibilityElementsHidden />
              </TouchableOpacity>
            </View>

            {/* Submit */}
            <TouchableOpacity
              onPress={submit}
              disabled={loading}
              activeOpacity={0.85}
              style={{ marginTop: 22 }}
              {...a11yButton('Sign in')}
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              <LinearGradient colors={GRAD} style={s.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnText}>SIGN IN</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <Text style={s.note}>Access is invite-only.{'\n'}Contact your admin to get access.</Text>
          </Animated.View>

          <Text style={s.powered}>Powered by Aekam Inc · v2.0</Text>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll:      { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 56 },
  logoSection: { alignItems: 'center', marginBottom: 40 },
  logoBox:     { marginBottom: 18 },
  brand:       { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: 6, marginBottom: 4 },
  brandSub:    { color: C.teal, fontSize: 10, fontWeight: '700', letterSpacing: 4 },
  tagline:     { color: C.muted, fontSize: 13, marginTop: 14, fontStyle: 'italic' },
  card:        { backgroundColor: C.card, borderRadius: 22, padding: 26, borderWidth: 1, borderColor: C.border },
  cardTitle:   { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 20 },
  errBanner:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,107,107,0.12)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,107,107,0.3)', paddingHorizontal: 12, paddingVertical: 9, marginBottom: 16 },
  errText:     { color: C.error, fontSize: 12, fontWeight: '600', flex: 1 },
  label:       { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  input:       { backgroundColor: C.inputBg, borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 13, color: '#fff', fontSize: 14 },
  pwWrap:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 13 },
  eyeBtn:      { paddingLeft: 8 },
  btn:         { borderRadius: 12, paddingVertical: 15, alignItems: 'center', shadowColor: '#04837A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
  btnText:     { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  note:        { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 20, lineHeight: 18 },
  powered:     { color: 'rgba(255,255,255,0.18)', fontSize: 10, textAlign: 'center', marginTop: 36, letterSpacing: 2 },
});
