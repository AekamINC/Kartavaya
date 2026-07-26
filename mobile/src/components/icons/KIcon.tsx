/**
 * KIcon — Kartavaya brand mark
 *
 * Renders the Devanagari क on a 135° brand gradient with:
 *   • inner shine overlay (radial highlight)
 *   • bottom-left accent orb
 *
 * Matches the app-icon.jsx design spec exactly.
 * Use on LoginScreen, splash, and anywhere the brand mark is needed.
 *
 * Props:
 *   size      — outer box size in px (default 80)
 *   radius    — corner radius (default 24; 999 for pill)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_GRADIENT } from '../../theme/tokens';
import { FAMILY } from '../../theme/fonts';

interface KIconProps {
  size?:   number;
  radius?: number;
}

export function KIcon({ size = 80, radius = 24 }: KIconProps) {
  const fontSize = size * 0.52;
  const orbSize  = size * 0.30;

  return (
    <LinearGradient
      colors={BRAND_GRADIENT}
      start={{ x: 0.14, y: 0 }}
      end={{   x: 0.86, y: 1 }}
      style={[s.wrap, { width: size, height: size, borderRadius: radius }]}
    >
      {/* Inner shine */}
      <View
        style={[
          s.shine,
          {
            width:        size * 0.7,
            height:       size * 0.5,
            borderRadius: size * 0.35,
            top:          -size * 0.08,
            left:         size * 0.15,
          },
        ]}
        pointerEvents="none"
      />

      {/* Bottom-left accent orb */}
      <View
        style={[
          s.orb,
          {
            width:        orbSize,
            height:       orbSize,
            borderRadius: orbSize / 2,
            bottom:       -orbSize * 0.25,
            left:         -orbSize * 0.15,
          },
        ]}
        pointerEvents="none"
      />

      {/* Devanagari brand glyph */}
      <Text
        style={[s.glyph, { fontSize, lineHeight: size }]}
        accessibilityElementsHidden
      >
        क
      </Text>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
    shadowColor: '#04837A',
    shadowOffset:    { width: 0, height: 8 },
    shadowOpacity:   0.45,
    shadowRadius:    16,
    elevation:       12,
  },
  shine: {
    position:        'absolute',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  orb: {
    position:        'absolute',
    backgroundColor: '#05b7aa',
    opacity:         0.55,
  },
  glyph: {
    color:       '#fff',
    // Was the family name as a bare string literal. FAMILY.devanagari exists so
    // nothing has to spell it: a typo in a `fontFamily` string is silent — RN
    // keeps the style, finds no such registered face and renders the system
    // one — and this particular string is the brand mark, so the failure would
    // be the logo quietly turning into whatever Devanagari face the OS ships.
    fontFamily:  FAMILY.devanagari,
    textAlign:   'center',
    includeFontPadding: false,
  },
});
