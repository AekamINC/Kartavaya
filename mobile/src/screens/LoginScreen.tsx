import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, Animated,
  useWindowDimensions,
  TextInput as RNTextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { a11yButton, a11yInput } from '../components/a11y';
import { BRAND_GRADIENT } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { FAMILY } from '../theme/fonts';
import { useReducedMotion, amplitude, EASE, SHAKE } from '../theme/motion';

/**
 * LoginScreen — the crown, ported from the web sign-in.
 *
 * ── What changed and why ────────────────────────────────────────────────────
 *
 * This was a dark navy card — `#020d1a`, `#040f1e`, `#0b1829`, ten hardcoded
 * hexes — and it opted out of the theme on purpose: "always renders the dark
 * branded gradient regardless of system theme preference". That made it the one
 * screen in either client answering to nothing, and the largest block of literal
 * colour outside `theme/`.
 *
 * The web sign-in was rebuilt as a band of brand gradient carrying क, curved
 * along its lower edge, over paper — so the screen answers the tile that opened
 * it. This is that screen. The two clients are one product to the person
 * holding the phone, and this is the first thing they see in either.
 *
 * It reads the theme now, like every other screen.
 *
 * ── The curve, without SVG ──────────────────────────────────────────────────
 *
 * The web crown is `border-radius: 0 0 46% 46% / 0 0 38px 38px` — an ELLIPTICAL
 * radius, so the sweep keeps its shape from a 360px phone to a 1280px tablet
 * rather than flattening as the band widens. React Native has no elliptical
 * radius and this project has no react-native-svg.
 *
 * So the band is drawn WIDER than the screen, pulled left by half its overhang,
 * with a circular radius of half its own width. The visible middle of a very
 * wide circle is a shallow arc — the same figure the ellipse describes, reached
 * from the other side. Because the overhang scales with the screen, the
 * proportion holds across devices, which is the property the ellipse was chosen
 * for in the first place.
 *
 * ── Sizes track HEIGHT, not width ───────────────────────────────────────────
 *
 * Measured on a booted Pixel during the web pass: a phone in landscape is 427dp
 * tall, and sizing the letter against WIDTH asked for the largest letter on the
 * shortest band — exactly backwards. Band and letter are both clamped against
 * height here for the same reason the web rules are, with a shorter set below
 * 500dp where a landscape phone needs the chrome to give way.
 */

export default function LoginScreen() {
  const { login }              = useAuth();
  const { t }                  = useTheme();
  const { width, height }      = useWindowDimensions();
  const [email, setEmail]      = useState('');
  const [password, setPassword]= useState('');
  const [loading, setLoading]  = useState(false);
  const [errMsg, setErrMsg]    = useState('');
  const [showPw, setShowPw]    = useState(false);
  const pwRef = useRef<RNTextInput>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  // The band and the letter in it — see the note above on why both clamp
  // against height.
  const short  = height < 500;
  const crownW = width * 1.6;
  const crownH = short ? Math.max(96,  height * 0.24)
                       : Math.max(150, Math.min(height * 0.27, 232));
  const kaSize = short ? Math.max(42, Math.min(height * 0.13, 64))
                       : Math.max(56, Math.min(height * 0.14, 118));
  const wmSize = Math.min(width * 0.62, 340);

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
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {/* The same letter again, ghosted on the paper and bleeding off the
            corner, so the lower two-thirds is a page rather than an empty
            field.
            It is wrapped in a View because it sits over the form's tap targets
            and `pointerEvents` is a View prop, not a Text one — without the
            wrapper the email field under it would be unreachable. */}
        <View
          style={s.watermarkWrap}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[s.watermark, {
            color: t.primary,
            fontSize: wmSize,
            lineHeight: wmSize * 0.78,
          }]}>
            क
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── The crown ── */}
          <View style={[s.crownClip, { height: crownH }]}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={{
                width: crownW,
                marginLeft: -(crownW - width) / 2,
                height: crownH,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomLeftRadius: crownW / 2,
                borderBottomRightRadius: crownW / 2,
              }}
            >
              <Text
                style={[s.crownKa, { fontSize: kaSize, lineHeight: kaSize * 1.18 }]}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              >
                क
              </Text>
            </LinearGradient>
          </View>

          {/* ── The form ── */}
          <Animated.View style={[s.form, { transform: [{ translateX: shake }] }]}>
            <Text style={[s.eyebrow, { color: t.primary }]}>WELCOME BACK</Text>
            <Text style={[s.title, { color: t.ink }]}>
              Sign in to <Text style={{ color: t.primary }}>Kartavaya</Text>
            </Text>
            <Text style={[s.sub, { color: t.ink2 }]}>Pick up where your team left off.</Text>

            {/* Error */}
            {/* A sign-in failure was shown but never spoken: the banner had no
                role and no live region, so a screen-reader user pressed SIGN
                IN and got silence. `alert` + assertive is 23 §Defect 3's rule
                applied to the one error the user cannot proceed past. */}
            {!!errMsg && (
              <View
                style={[s.errBanner, { backgroundColor: t.errorBg, borderColor: t.error }]}
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                accessibilityLabel={errMsg}
              >
                <Ionicons name="alert-circle" size={14} color={t.error} accessibilityElementsHidden />
                <Text style={[s.errText, { color: t.error }]}>{errMsg}</Text>
              </View>
            )}

            {/* Email */}
            <Text style={[s.label, { color: t.ink2 }]}>EMAIL ADDRESS</Text>
            <TextInput
              style={[s.input, {
                backgroundColor: t.surface3, borderColor: t.outlineVar, color: t.ink,
              }]}
              value={email}
              onChangeText={(v) => { setEmail(v); setErrMsg(''); }}
              placeholder="you@company.com"
              placeholderTextColor={t.ink3}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => pwRef.current?.focus()}
              blurOnSubmit={false}
              {...a11yInput('Email')}
            />

            {/* Password */}
            <Text style={[s.label, { color: t.ink2, marginTop: 14 }]}>PASSWORD</Text>
            <View style={[s.pwWrap, { backgroundColor: t.surface3, borderColor: t.outlineVar }]}>
              <TextInput
                ref={pwRef}
                style={[s.input, {
                  flex: 1, borderWidth: 0, padding: 0,
                  backgroundColor: 'transparent', color: t.ink,
                }]}
                value={password}
                onChangeText={(v) => { setPassword(v); setErrMsg(''); }}
                placeholder="••••••••"
                placeholderTextColor={t.ink3}
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
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={t.ink3} accessibilityElementsHidden />
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
              <View style={[s.btn, { backgroundColor: t.primary }]}>
                {loading
                  ? <ActivityIndicator color={t.onPrimary} size="small" />
                  : <Text style={[s.btnText, { color: t.onPrimary }]}>Sign in</Text>}
              </View>
            </TouchableOpacity>

            <Text style={[s.note, { color: t.ink2 }]}>
              Kartavaya is invite-only — there is no public sign-up. Ask your admin for an
              invitation, or talk to us about a demo.
            </Text>

            <View style={[s.footRule, { backgroundColor: t.outlineVar }]} />
            <Text style={[s.powered, { color: t.ink3 }]}>POWERED BY AEKAM INC</Text>
          </Animated.View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll:      { flexGrow: 1, paddingBottom: 40 },
  // The band is clipped to the screen; the gradient inside it is wider than the
  // screen. See the note at the top of the file for why the curve is drawn this
  // way rather than with a path.
  crownClip:   { width: '100%', overflow: 'hidden' },
  crownKa:     { fontFamily: FAMILY.devanagari, color: '#FFFFFF', includeFontPadding: false },
  watermarkWrap: { position: 'absolute', right: -18, bottom: -34, opacity: 0.07 },
  watermark:   { fontFamily: FAMILY.devanagari, includeFontPadding: false },
  form:        { paddingHorizontal: 24, paddingTop: 30, maxWidth: 460, width: '100%', alignSelf: 'center' },
  eyebrow:     { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  // Newsreader, matching the web heading. Devanagari never names this family —
  // it has no coverage, and a Hindi word given it renders as tofu on Android —
  // so the प्रवेश the web sets beside this title is deliberately NOT carried
  // over rather than shipped broken. See theme/fonts.ts.
  title:       { fontFamily: FAMILY.display, fontSize: 27, letterSpacing: -0.4 },
  sub:         { fontSize: 14, marginTop: 8, marginBottom: 22 },
  errBanner:   { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8,
                 borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 16 },
  errText:     { fontSize: 12, fontWeight: '600', flex: 1 },
  label:       { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginBottom: 6 },
  input:       { borderRadius: 11, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14 },
  pwWrap:      { flexDirection: 'row', alignItems: 'center', borderRadius: 11, borderWidth: 1,
                 paddingHorizontal: 14, paddingVertical: 13 },
  eyeBtn:      { paddingLeft: 8 },
  btn:         { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  btnText:     { fontSize: 14, fontWeight: '700' },
  note:        { fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 18 },
  footRule:    { height: 1, marginTop: 22, marginBottom: 14 },
  powered:     { fontSize: 10, textAlign: 'center', letterSpacing: 1.6, fontWeight: '600' },
});
