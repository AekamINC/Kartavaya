// API URL is read from environment at build time.
// Development  → EXPO_PUBLIC_API_URL in mobile/.env
// APK builds   → eas.json `development` / `preview` profiles, both staging
// Store builds → eas.json `production` profile, which sets production explicitly
// Future       → switch to https://api.kartavaya.aekaminc.com by updating the env var only
//
// The FALLBACK IS STAGING, deliberately. This value is only reached when
// EXPO_PUBLIC_API_URL is unset — a bare `expo start`, a misconfigured profile, a
// build env that failed to inject. Every one of those is an unverified
// configuration, and staging and production share a Supabase database, so an
// unverified client defaulting to production writes real rows against real
// customer data. Production is reached only by naming it.
export const BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://kartavya-staging.up.railway.app';

export const API_URL = `${BACKEND_URL}/api`;
