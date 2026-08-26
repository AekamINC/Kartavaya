/**
 * Mint Playwright storage state from a TOKEN, for accounts that have no password.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `auth.setup.ts` signs both test users in through the real login form, which
 * needs `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD`. `.env.e2e` carries
 * `E2E_ADMIN_TOKEN` and no password, because — as `onefile.config.ts:4` already
 * records — **the owner is a token-only account**. It signs in with Google;
 * there is no password to type into the form, and there never will be.
 *
 * The consequence was that the whole real-user suite could not run its setup
 * project, and the workaround on record was `onefile.config.ts`: cut the setup
 * project out and run two specs against auth state "minted out-of-band". This
 * file IS that out-of-band step, written down instead of done by hand.
 *
 * A long-standing note claimed the suite was blocked on `E2E_GODMODE_TOKEN`.
 * It is not: that variable is read by NO code in this repository — only
 * mentioned in `docs/HANDOVER-2026-08-07-EVENING.md`. Verified by grep across
 * every .ts/.js/.mjs/.py file. The real gap was always the missing password.
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 * Playwright storage state carrying `localStorage.auth_token` for the app
 * origin. That is the Bearer fallback `frontend/src/lib/api.js:25` reads on
 * every request, so a context restored from this state is authenticated for
 * every API call the specs make.
 *
 * It does NOT reproduce the httpOnly API cookie, which only the backend can
 * set. Anything that depends on the cookie specifically — rather than on the
 * Authorization header — will still need a real login. Nothing in the current
 * specs does; they all go through the axios client.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     node e2e-real/mint-state.mjs
 *     npx playwright test --config e2e-real/real.config.ts --grep-invert @setup
 *
 * Re-run it when the token expires. A JWT here is 7 days
 * (`sessions_valid_from` invalidates earlier on a password change or logout).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same loader real.config.ts uses, so there is one source of truth for where
// the file lives and how it is parsed.
const envFile = path.resolve(__dirname, '..', '..', '.env.e2e');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} else {
  console.error(`No .env.e2e at ${envFile}`);
  process.exit(1);
}

const BASE = process.env.E2E_BASE_URL || 'https://staging.kartavaya.com';
const STATE_DIR = path.join(os.tmpdir(), 'kartavya-e2e-auth');
fs.mkdirSync(STATE_DIR, { recursive: true });

/** Both roles, so a single run unblocks every spec rather than half of them. */
const ACCOUNTS = [
  { token: process.env.E2E_ADMIN_TOKEN, file: 'owner.json', label: 'owner' },
  { token: process.env.E2E_APPROVER_TOKEN, file: 'approver.json', label: 'approver' },
  // The god-mode account, which is the only one that can reach MORE THAN ONE
  // organisation. `.env.e2e` has been a hybrid before — E2E_ORG_ID naming one
  // org while E2E_ADMIN_TOKEN belonged to an admin of another, who is not a
  // member of the first — and the symptom was a write landing in the wrong
  // org while `api()`'s X-Org-Id header 403'd. A suite that must CHOOSE its
  // target org needs an account that can switch; this is it.
  { token: process.env.E2E_GODMODE_TOKEN, file: 'godmode.json', label: 'godmode' },
];

/** A JWT's exp, read without verifying — this is a convenience check, not a
 *  security boundary. An expired token is the single most likely reason a
 *  suite run fails, and finding that out from a wall of Playwright timeouts
 *  costs half an hour. */
function expiry(token) {
  try {
    const [, payload] = token.split('.');
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return json.exp ? new Date(json.exp * 1000) : null;
  } catch { return null; }
}

let wrote = 0;
for (const { token, file, label } of ACCOUNTS) {
  if (!token) {
    console.log(`· ${label}: no token in .env.e2e — skipped`);
    continue;
  }

  const exp = expiry(token);
  if (exp && exp.getTime() < Date.now()) {
    console.error(`✗ ${label}: token EXPIRED ${exp.toISOString()} — mint a new one`);
    console.error(`  Sign in at ${BASE} and run in the browser console:`);
    console.error(`    copy(localStorage.getItem('auth_token'))`);
    continue;
  }

  const state = {
    cookies: [],
    origins: [{
      origin: BASE,
      localStorage: [{ name: 'auth_token', value: token }],
    }],
  };
  const out = path.join(STATE_DIR, file);
  fs.writeFileSync(out, JSON.stringify(state, null, 2));
  wrote++;
  console.log(`✓ ${label}: ${out}${exp ? `  (expires ${exp.toISOString()})` : ''}`);
}

if (!wrote) {
  console.error('\nNothing written. The suite will not authenticate.');
  process.exit(1);
}
console.log(`\n${wrote} state file(s) written to ${STATE_DIR}`);
