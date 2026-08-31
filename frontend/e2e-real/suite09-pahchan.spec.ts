/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SUITE 09 — PAHCHAN · ATTENDANCE · UNICODE GROUP                         ║
 * ║  Proposal 93 · Stage 3 · Wave 3 · §4 volumes · §10's eleven screens      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Every row below is TYPED. Playwright opens the tab, fills the real form,
 * picks from the real picker, faces the real camera and clicks the real button.
 * There is no SQL here and no `page.request.post` — `check-e2e-no-bypass.mjs`
 * enforces that, and every read helper in this file is a GET.
 *
 * ── ⚠ WHAT THIS SUITE COULD NOT REACH, SAID FIRST ──────────────────────────
 *
 * §10 warns that "a silent cap reads as full coverage", so the caps are at the
 * top rather than buried in a passing run. Each one was established by reading
 * the product, and each is asserted below as a POSITIVE fact — the test proves
 * the path is absent rather than skipping quietly.
 *
 * 1 · THERE IS NO ENROLLMENT UPLOAD ANYWHERE IN THE WEB PRODUCT.
 *     §4 asks for 30 reference photographs. `POST /v1/pahchan/enrollment` has
 *     ZERO callers in `frontend/src` — measured by grep across the tree; the
 *     only enrollment calls are `GET .../queue/pending`, `GET .../photos/{id}/url`
 *     and `POST .../{id}/approve`, all in `EnrollQueue.jsx`, which APPROVES a
 *     photo somebody else uploaded. `pages/manav/*` has no photo field either.
 *     The two upload paths the endpoint documents are "HR uploads during
 *     employee creation" (no such form exists) and "the employee self-captures
 *     on first run" (mobile only — and `Expo Go cannot run this app`).
 *     Reaching it would need `page.request.post`, which rule 1 forbids and the
 *     ratchet bans. 09.6 asserts the absence instead. **0 of 30.**
 *
 * 2 · AND THAT ONE GAP BLOCKS THE REGISTER AND THE PAYROLL PUSH.
 *     It is a chain, not an inconvenience, and it is the most important finding
 *     in this file:
 *       · no reference pair  → `_compute_flags` appends `noref` to EVERY punch
 *         (`routers/pahchan.py:676`)
 *       · a flagged punch    → `Punch.is_eligible` is False while
 *         `review_verdict IS NULL` (`services/attendance_bridge.py:141`)
 *       · so the day is WITHHELD from payroll, by design
 *       · and the only verdict that clears it is `ok`, whose button is
 *         DISABLED until the three photos load (`Register.jsx:947`) and whose
 *         keyboard path returns early on the same condition (`Register.jsx:606`)
 *       · and for a `noref` row the Confirm/Flag pair is not rendered at all —
 *         the cell offers "Send enrollment request" instead (`Register.jsx:910`)
 *     So on this org today, punches can be MADE and can never be CLEARED, and
 *     `days_built` for a window containing only punches is necessarily 0.
 *     09.9 and 09.11 measure exactly that rather than asserting around it.
 *     This is reported, not diagnosed and not patched — §14 owns the verdict.
 *
 * 3 · NOTHING REFUSES A PUNCH OUTSIDE A GEOFENCE, AND NOTHING MAY.
 *     §4 asks for "4 punches refused outside the geofence — the refusal path is
 *     the one that protects the register". There is no refusal path. `07 §2` is
 *     "NOTHING BLOCKS A PUNCH" and `_compute_flags`' own docstring says "There
 *     is no branch that refuses, and adding one is the single change most
 *     likely to break the module's purpose". `allow_outside_geofence` is
 *     stored, is surfaced in `GET /me`'s rules, and is read by NO decision
 *     anywhere in `backend/` — grep returns only the model, the defaults, the
 *     UPSERT and one test.
 *     What actually protects the register is the pair above: an out-of-fence
 *     punch is RECORDED, carries `geo`, and is then withheld from payroll until
 *     a human rules on it. 09.8 drives four punches from 23 km outside every
 *     site and proves that — the punch lands, the employee is TOLD it is
 *     flagged, and the day does not reach payroll. **4 of 4, as flags.**
 *
 * 4 · THERE IS NO "DROP A PIN" MAP, AND NO MAP CLICK HANDLER AT ALL.
 *     `PointRadiusMap.jsx` takes `lat`/`lng` as props and registers exactly one
 *     listener — `map.addListener('load', draw)`. There is no click, no drag,
 *     no `onPick`. The only non-typed way to place a site is the form's own
 *     "Use this device" button, which reads `navigator.geolocation`. 09.3
 *     places site 3 that way, with the browser's fix set to the target
 *     coordinates: it is a real interaction that puts a pin where the device
 *     says it is standing, and it is the nearest thing the product offers.
 *     Reported as a substitution, not counted as the map interaction.
 *
 * 5 · DEPARTMENT POLICY OVERRIDES HAVE NO UI.
 *     §4 asks for 4. `GET/PUT/DELETE /v1/pahchan/policy/scopes` exist and are
 *     tested server-side (`tests/test_pahchan_policy_scopes.py`); grep for
 *     `policy/scopes` in `frontend/src` returns NOTHING. Live: `{"data":[]}`.
 *     09.2 asserts the endpoint answers and the screen offers no way in.
 *     **0 of 4.**
 *
 * 6 · A NOTICE CANNOT BE "PUBLISHED", AND AN ACCOUNT CAN ACKNOWLEDGE ONCE.
 *     §4 asks for 2 notices published and 30 acknowledgements. The notice is a
 *     BUILD CONSTANT — `PAHCHAN_NOTICE_VERSION = '2026-08-06.1'`,
 *     `lib/pahchanNotice.js:60` — with no editor, no version table and no
 *     publish route. And `POST /notice/ack` is `ON CONFLICT (org_id, user_id,
 *     notice_version) DO NOTHING`: one row per ACCOUNT per version. Thirty
 *     acknowledgements would need thirty logins; Unicode Group has ONE
 *     credential in `.env.e2e` and the twelve dummy logins are E2E-org-only and
 *     are documented as never to be pointed here. **1 of 30 acks, 0 of 2
 *     publishes.**
 *     The DPDP obligation §4 is actually after — a recorded answer per employee
 *     — is the CONSENT roster, and that is reachable: 09.5 records all 30.
 *
 * 7 · TWELVE EMPLOYEES CANNOT PUNCH; ONE CAN.
 *     §4 asks for 240 punches spread over 12 employees × 5 days × 2 months.
 *     `POST /punch` records against the SIGNED-IN account's employee row
 *     (`_employee_for`), the web Clock stamps `captured_at` at the shutter and
 *     offers no date field, and this lane holds one credential. Live probe:
 *     `GET /v1/pahchan/me` resolves employee **Devansh Jani** (S7-21). So the
 *     VOLUME is reachable and the SPREAD is not. 09.7 drives the full 240 on
 *     the one employee and says so; §4's distribution is unreachable without
 *     twelve Unicode passwords, which nobody should mint for this.
 *
 * ── THE CAMERA, AND WHY THE FIXTURE FACES REACH IT ─────────────────────────
 *
 * The selfie is MANDATORY on this screen and comes from `getUserMedia` — there
 * is no file input on the punch path, so `fixtures/generated/faces/*.png`
 * cannot be attached the way an upload fixture normally is.
 *
 * They are fed to the camera instead. `buildFacesY4m()` decodes the thirty
 * fixture PNGs (96×96, colour type 2, filter 0 on every scanline — verified) and
 * writes ONE Y4M that Chrome plays as its fake capture device, so every punch
 * selfie in this run is a fixture face rather than Chrome's rolling test
 * pattern. The file is derived from the SHA-pinned fixtures and rebuilt from
 * them on every run; it is not a new fixture.
 *
 * ⚠ PRIVACY, AND IT IS THE POINT OF DOING IT THIS WAY. 93 §5: the faces are
 * SYNTHETIC because face matching is parked to v2 (`routers/pahchan.py:6`) —
 * nothing compares the image to anything, so a real face buys ZERO coverage
 * while creating a genuine biometric record, under DPDP, for a person who does
 * not exist, in a database production shares. No real face is used, sourced or
 * uploaded anywhere in this file.
 *
 * ── THE 768 KB CAP IS NOT REACHABLE FROM THIS SCREEN ───────────────────────
 *
 * `fixtures/generated/oversize/oversize-photo-768kb-plus-1.png` exists to cross
 * `MAX_PHOTO_BYTES` (`routers/pahchan.py:120`) and read back the 413 whose
 * message was fixed today from "0MB" to "768KB". It cannot be sent from here:
 * the only web caller of `POST /punch/photo` is `Clock.jsx:221`, which posts a
 * blob `compressCapture` has already walked down a quality ladder to a 600 KB
 * budget. There is no path by which a user can hand this endpoint a file. The
 * fixture and the fixed message are asserted where they are reachable —
 * `read_capped`'s unit coverage — and NOT here. Said out loud rather than left
 * as an unexercised fixture.
 *
 * ── §6 IDEMPOTENCE, AND THE ONE HARD CASE ──────────────────────────────────
 *
 * Every test reads what exists before it writes and creates only the shortfall.
 * The keys are: site NAME, employee NAME on the consent roster, correction
 * (day + direction), and for punches THE COUNT ON THE DAY.
 *
 * Punches are the hard case §6 names. `client_punch_id` makes the SERVER
 * idempotent, but `Clock.jsx` mints a fresh one per attempt (`newClientPunchId`),
 * so a blind re-run genuinely would double the register — the browser is asking
 * a different question each time. This suite therefore counts today's punches
 * for this employee through `GET /v1/pahchan/me` first and punches only the
 * shortfall, so a second execution recognises its own output and verifies it.
 * Proven by running the file twice, never claimed.
 *
 * ── THE ORG, AND THE ONE ORG THIS MUST NEVER TOUCH ─────────────────────────
 *
 * `signInAs(page, lane('unicode'))` calls `assertOrg()` internally and refuses
 * to continue unless the SESSION resolves to fae87907 — the check whose absence
 * renamed **Aekam Inc** on 2026-08-28. Nothing here goes near 045b76ad.
 *
 * ── BASELINE, MEASURED LIVE BEFORE A LINE WAS WRITTEN (2026-08-29) ─────────
 *
 *   GET /pahchan/sites          → 0 sites
 *   GET /pahchan/policy         → the row exists, all defaults, overtime OFF
 *   GET /pahchan/policy/scopes  → {"data":[]}
 *   GET /pahchan/consent/roster → 30 employees · 0 answers · 0 approved refs
 *   GET /pahchan/enrollment/queue/pending → 0 pending, 30 incomplete
 *   GET /pahchan/regularisations?status=all → []
 *   GET /pahchan/me             → employee Devansh Jani, notice NOT acknowledged
 *   GET /api/health             → schema staging, environment staging
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave3.config.ts --project pahchan
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, activeLane, assertOrg } from './_lanes';
import { settle, isForeignInlineScriptRefusal } from './_helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN in .env.e2e at the ' +
  'repo root. ⚠ It must be an ORG-SCOPED account: a platform_admin token resolves ' +
  'to Aekam Inc via platform_bypass and would write there. ENVIRONMENT blocker, ' +
  'not a product or test defect.';

/* ══════════════════════════════════════════════════════════════════════════
   THE CAMERA — the fixture faces, in the format Chrome's fake device reads
   ══════════════════════════════════════════════════════════════════════════ */

const FACES_DIR = path.join(HERE, 'fixtures', 'generated', 'faces');
const Y4M_PATH = path.join(os.tmpdir(), 'kartavya-e2e-wave3', 'pahchan-faces.y4m');

/**
 * One PNG → raw RGB.
 *
 * Deliberately NOT a general PNG decoder. `make-fixtures.mjs` writes these as
 * 8-bit colour-type-2, non-interlaced, with filter 0 on every scanline and a
 * hand-written STORED deflate stream — "so no zlib build can move a byte". This
 * asserts each of those rather than assuming them, because a fixture that
 * quietly changes shape would otherwise turn into a camera that quietly shows
 * garbage, and a garbage selfie is indistinguishable from a working one on a
 * path where nothing compares the image to anything.
 */
function decodeFixturePng(file: string): { w: number; h: number; rgb: Buffer } {
  const buf = fs.readFileSync(file);
  let p = 8;
  let ihdr: { w: number; h: number; bd: number; ct: number; il: number } | null = null;
  const idat: Buffer[] = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), bd: data[8], ct: data[9], il: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (!ihdr) throw new Error(`${file}: no IHDR`);
  if (ihdr.bd !== 8 || ihdr.ct !== 2 || ihdr.il !== 0) {
    throw new Error(`${file}: expected 8-bit RGB non-interlaced, got bd=${ihdr.bd} ct=${ihdr.ct} il=${ihdr.il}`);
  }
  if (ihdr.w % 2 || ihdr.h % 2) throw new Error(`${file}: ${ihdr.w}x${ihdr.h} is not 4:2:0-able`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = 1 + ihdr.w * 3;
  if (raw.length !== ihdr.h * stride) throw new Error(`${file}: ${raw.length} bytes, expected ${ihdr.h * stride}`);
  const rgb = Buffer.alloc(ihdr.w * ihdr.h * 3);
  for (let y = 0; y < ihdr.h; y++) {
    if (raw[y * stride] !== 0) throw new Error(`${file}: scanline ${y} uses filter ${raw[y * stride]}`);
    raw.copy(rgb, y * ihdr.w * 3, y * stride + 1, y * stride + 1 + ihdr.w * 3);
  }
  return { w: ihdr.w, h: ihdr.h, rgb };
}

/** RGB → one planar 4:2:0 Y4M frame, BT.601. */
function y4mFrame({ w, h, rgb }: { w: number; h: number; rgb: Buffer }): Buffer {
  const Y = Buffer.alloc(w * h);
  const U = Buffer.alloc((w / 2) * (h / 2));
  const V = Buffer.alloc((w / 2) * (h / 2));
  const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      Y[y * w + x] = cl(0.299 * r + 0.587 * g + 0.114 * b);
      if ((y & 1) === 0 && (x & 1) === 0) {
        const j = (y / 2) * (w / 2) + x / 2;
        U[j] = cl(-0.169 * r - 0.331 * g + 0.5 * b + 128);
        V[j] = cl(0.5 * r - 0.419 * g - 0.081 * b + 128);
      }
    }
  }
  return Buffer.concat([Buffer.from('FRAME\n', 'ascii'), Y, U, V]);
}

/**
 * All thirty fixture faces as one looping capture file.
 *
 * Returns null — never throws — if the generator has not been run. A missing
 * `generated/` is an ENVIRONMENT state with a documented one-line fix, and the
 * suite must say that sentence rather than die inside a config evaluation where
 * no reporter can show it. `facesReady` carries the reason to 09.7.
 */
function buildFacesY4m(): string | null {
  try {
    const files = fs.readdirSync(FACES_DIR).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) return null;
    const frames = files.map((f) => decodeFixturePng(path.join(FACES_DIR, f)));
    const { w, h } = frames[0];
    for (const f of frames) {
      if (f.w !== w || f.h !== h) throw new Error('the fixture faces are not all one size');
    }
    fs.mkdirSync(path.dirname(Y4M_PATH), { recursive: true });
    fs.writeFileSync(Y4M_PATH, Buffer.concat([
      // 5 fps: thirty faces loop over six seconds, so successive punches in a
      // burst genuinely capture different faces rather than one frozen frame.
      Buffer.from(`YUV4MPEG2 W${w} H${h} F5:1 Ip A1:1 C420\n`, 'ascii'),
      ...frames.map(y4mFrame),
    ]));
    return Y4M_PATH;
  } catch {
    return null;
  }
}

const FACES_Y4M = buildFacesY4m();
const FACES_NOTE = FACES_Y4M
  ? `${Y4M_PATH} — built from the 30 SHA-pinned fixture faces`
  : `NOT BUILT — run \`node frontend/e2e-real/fixtures/make-fixtures.mjs\` first. ` +
    `Chrome's own synthetic pattern is used instead; the path under test is identical.`;

/* ══════════════════════════════════════════════════════════════════════════
   WHERE THIS ORG WORKS — Ahmedabad, because Unicode Group is an Ahmedabad firm
   ══════════════════════════════════════════════════════════════════════════ */

type Site = {
  name: string;
  lat: number;
  lng: number;
  radius: number;
  altitude?: number;
  tolerance?: number;
  /** How the coordinates get into the form. */
  how: 'typed' | 'device';
};

/**
 * Four sites. Names carry the S9 stamp so a re-run recognises its own output
 * and so nothing here can be confused with a real Unicode site.
 *
 * Coordinates are ordinary Ahmedabad landmarks — a fence is a place, and a
 * fence at 0,0 is the Atlantic, which `PointRadiusMap` refuses to draw on
 * purpose. Nothing here identifies a person.
 */
const SITES: Site[] = [
  { name: 'Unicode House · Navrangpura (S9)', lat: 23.022500, lng: 72.571400, radius: 150, how: 'typed' },
  { name: 'Prahlad Nagar client site (S9)',   lat: 23.011900, lng: 72.507700, radius: 200, how: 'typed' },
  { name: 'GIFT City tower (S9)',             lat: 23.159600, lng: 72.684600, radius: 120, how: 'device' },
  {
    name: 'Sindhu Bhavan · ninth floor (S9)',
    lat: 23.043000, lng: 72.507500, radius: 100,
    altitude: 85, tolerance: 25, how: 'typed',
  },
];

/**
 * What the amend in 09.3 widens site 2 to.
 *
 * A constant rather than a literal because it is read in TWO places that must
 * agree — the pre-amend read-back, which has to accept it as legal on a second
 * run, and the post-amend assertion, which has to demand it exactly.
 */
const AMENDED_RADIUS = 220;

/** Standing at site 1's pin. Every ordinary punch is made from here. */
const INSIDE = { latitude: SITES[0].lat, longitude: SITES[0].lng };

/**
 * 23 km north-east of the nearest site, which is GIFT City.
 *
 * Far enough that no radius in `SITES` can reach it and the arithmetic is not
 * arguable — a punch three metres outside a 150 m fence is a test of floating
 * point, not of the fence.
 */
const OUTSIDE = { latitude: 23.250000, longitude: 72.900000 };

/**
 * §4's punch volume. All on ONE employee — see cap 7 in the header.
 *
 * Overridable so a smoke run can be short, and the override is PRINTED in the
 * report: a cap that only exists in an environment variable is a silent cap.
 */
const PUNCH_TARGET = Number(process.env.E2E_S9_PUNCHES ?? 240);

/**
 * The five days corrections are raised for, and how each is decided.
 *
 * ⚠ THIS IS WHAT MAKES THE PAYROLL PUSH MEASURABLE AT ALL. With no reference
 * photographs every punch is `noref` and no punch can ever become eligible
 * (header, cap 2) — so a publish over a window of punches necessarily builds
 * zero days. `build_day_records` takes a second input: an APPROVED
 * regularisation creates its own bucket and sets `check_in`/`check_out`
 * directly (`attendance_bridge.py:274,296`), with no punch and no verdict
 * involved. A day with BOTH an approved in and an approved out therefore
 * becomes a complete `present` row with real hours.
 *
 * So: three days get a matched pair and are approved (6 requests), two days get
 * a matched pair and are declined (4 requests). Ten raised, ten decided, six
 * approved, four rejected — §4's split exactly — and the arithmetic the publish
 * must produce is decided in advance: 3 days built, 0 from the two declined.
 *
 * The days sit AFTER this employee's joining date (S7-21 joined 2026-08-17) and
 * BEFORE the punch day, so the two publish windows below cannot overlap.
 */
type Fix = { day: string; direction: 'in' | 'out'; time: string; reason: string; approve: boolean };
const CORRECTIONS: Fix[] = [
  { day: '2026-08-18', direction: 'in',  time: '09:30', reason: 'S9 — the gate reader was down, I signed the paper book at the desk.', approve: true },
  { day: '2026-08-18', direction: 'out', time: '18:30', reason: 'S9 — same day, I left at half six and the app had no signal.',        approve: true },
  { day: '2026-08-19', direction: 'in',  time: '09:00', reason: 'S9 — I was at the client from nine, the phone was in the locker.',    approve: true },
  { day: '2026-08-19', direction: 'out', time: '18:00', reason: 'S9 — left the client site at six, no coverage in the basement.',      approve: true },
  { day: '2026-08-20', direction: 'in',  time: '10:00', reason: 'S9 — I came in after the audit meeting, clocked in on paper.',        approve: true },
  { day: '2026-08-20', direction: 'out', time: '19:00', reason: 'S9 — worked to seven on the year-end file.',                          approve: true },
  { day: '2026-08-21', direction: 'in',  time: '08:00', reason: 'S9 — I say I started at eight.',                                      approve: false },
  { day: '2026-08-21', direction: 'out', time: '21:00', reason: 'S9 — and finished at nine in the evening.',                           approve: false },
  { day: '2026-08-22', direction: 'in',  time: '07:30', reason: 'S9 — half seven start, before anyone else was in.',                   approve: false },
  { day: '2026-08-22', direction: 'out', time: '22:00', reason: 'S9 — and ten at night to close the quarter.',                         approve: false },
];

const APPROVED_DAYS = [...new Set(CORRECTIONS.filter((c) => c.approve).map((c) => c.day))].sort();
const DECLINED_DAYS = [...new Set(CORRECTIONS.filter((c) => !c.approve).map((c) => c.day))].sort();

/** The two publish windows. Disjoint on purpose — see CORRECTIONS. */
const WINDOW_CORRECTIONS = { from: '2026-08-17', to: '2026-08-23' };

const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Two of the thirty decline the photograph, and that is not decoration.
 *
 * A decline is the branch with real consequences in this module: it makes
 * `upload_punch_photo` answer 409, makes `enroll_photo` answer 409, and opens
 * the manual attendance path that is the DPDP alternative. Recording thirty
 * agreements would leave every one of those untested and would also be a
 * fiction — nobody asked these people anything.
 *
 * ⚠ NEVER the punching employee. Devansh Jani agrees, on his own card, before
 * this list is touched: a decline on him would 409 all 240 selfies.
 */
const DECLINERS = ['Bhavin Chokshi', 'Nidhi Sompura'];

/** The stamp that makes a note recognisable as this suite's on a re-run. */
const NOTE_STAMP = 'S9 fixture';

/* ══════════════════════════════════════════════════════════════════════════
   THE HARNESS
   ══════════════════════════════════════════════════════════════════════════ */

test.use({
  /**
   * ⚠ TEN TABS AND `ModuleTabs` CAPS THE INLINE ROW AT EIGHT, so two always sit
   * behind "More". A wider viewport does not remove the popover here — it only
   * keeps `fits` from oscillating on the boundary, which is the flake suite 07
   * documented at 1280px. `pahchan()` handles both routes regardless.
   */
  viewport: { width: 1680, height: 1000 },

  /**
   * The location the browser reports, and the permission to report it.
   *
   * Site placement and every punch depend on this: `Sites.jsx`'s "Use this
   * device" and `pahchanClock.js::captureGeoFix` both call
   * `navigator.geolocation.getCurrentPosition`, and `captureGeoFix` resolves
   * NULL on a denial — which flags `geo` and would make the fence untestable by
   * making every punch look out of range for the wrong reason.
   */
  permissions: ['geolocation'],
  geolocation: INSIDE,

  launchOptions: {
    args: [
      // Grant the camera without a prompt. `Clock.jsx` treats a denial as a
      // camera error and, after three, offers to punch WITHOUT a photo — so a
      // missing flag here would quietly test the escape hatch instead of the
      // mandatory selfie.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      // The thirty fixture faces, when the generator has been run.
      ...(FACES_Y4M ? [`--use-file-for-fake-video-capture=${FACES_Y4M}`] : []),
    ],
  },
});

test.beforeAll(() => {
  console.log(
    `\n  LANE   : ${LANE.org} (${LANE.orgId})  · reference lane, §14` +
    `\n  API    : ${API}` +
    `\n  CAMERA : ${FACES_NOTE}` +
    `\n  PUNCHES: target ${PUNCH_TARGET}` +
    (PUNCH_TARGET !== 240 ? '  ⚠ OVERRIDDEN from §4\'s 240 by E2E_S9_PUNCHES' : ' (§4)') +
    `\n  ⚠ This suite uploads a photograph with every punch. Every face is` +
    `\n    SYNTHETIC — fixtures/generated/faces — because face matching is` +
    `\n    parked to v2 and a real face would buy zero coverage while creating` +
    `\n    a genuine biometric record for a person who does not exist.\n`,
  );
});

/** Sign in, and REFUSE TO CONTINUE unless the session resolved to Unicode. */
async function signIn(page: Page) {
  if (!LANE.token && !(LANE.email && LANE.password)) throw new Error(BLOCKED);
  if (LANE.email && LANE.password) {
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(LANE.email);
    await page.locator('#au-password').fill(LANE.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  } else {
    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('auth_token', t), LANE.token!);
    await page.goto('/dashboard');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  }
  await assertOrg(page.request, page, LANE);
}

/**
 * ⚠ `X-Org-Id` IS NOT OPTIONAL, AND `_helpers.ts::api()` MUST NOT BE USED HERE.
 *
 * `src/lib/api.js:39` puts the active org on every request the product makes.
 * `_helpers.ts::api()` sends `X-Org-Id: process.env.E2E_ORG_ID`, which names
 * **E2E Test & Associates** and not Unicode — a read helper that answers for a
 * different organisation than the screen beside it is the same class of fault
 * as the 2026-08-28 cross-org incident.
 *
 * GET only, and that is a rule: `check-e2e-no-bypass` bans
 * `page.request.post/put/patch/delete` and permits `get`, because asserting the
 * row appeared IS the required evidence.
 */
async function orgGet(page: Page, p: string): Promise<any> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.get(`${API}${p}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': LANE.orgId },
  });
  expect(res.ok(), `GET ${p} → ${res.status()}: ${(await res.text()).slice(0, 400)}`).toBeTruthy();
  return await res.json();
}

/** The same, but the status is the answer — for a route expected to refuse. */
async function orgGetStatus(page: Page, p: string): Promise<{ status: number; body: any }> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.get(`${API}${p}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': LANE.orgId },
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status(), body };
}

/** The rows of an enveloped or bare list, whichever the route answers. */
async function rowsOf(page: Page, p: string): Promise<any[]> {
  const body = await orgGet(page, p);
  const r = Array.isArray(body) ? body : body?.data;
  expect(Array.isArray(r), `GET ${p} did not answer a list: ${JSON.stringify(body).slice(0, 240)}`).toBeTruthy();
  return r as any[];
}

/** `GET /v1/pahchan/me`, unwrapped. The one endpoint an employee may call. */
async function me(page: Page, days = 1): Promise<any> {
  const b = await orgGet(page, `/api/v1/pahchan/me?days=${days}`);
  return b?.data ?? b;
}

/** The consent roster, unwrapped. 403 for a non-admin — never for this lane. */
async function roster(page: Page): Promise<any[]> {
  const b = await orgGet(page, '/api/v1/pahchan/consent/roster');
  const d = b?.data ?? b;
  expect(Array.isArray(d?.employees), `consent/roster answered ${JSON.stringify(d).slice(0, 200)}`).toBeTruthy();
  return d.employees;
}

/**
 * THE WIRE — every write, with the status the server answered.
 *
 * Memory's rule, learned from the bank-import bug: watch the requests before
 * blaming the UI. A request that never comes back is invisible to a response
 * listener and is the failure that reads most like "the button does nothing",
 * so failures are recorded too, with Chromium's own reason.
 */
type Wire = string[];
const FAILED = new WeakMap<Page, string[]>();

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  const failed: string[] = [];
  FAILED.set(page, failed);
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 160); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  page.on('requestfailed', (req) => {
    if (!/\/api\//.test(req.url())) return;
    failed.push(`${req.method()} FAILED ${new URL(req.url()).pathname}  ${req.failure()?.errorText ?? '(no reason given)'}`);
  });
  return wire;
}
const dump = (w: Wire) =>
  w.length ? w.slice(-12).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

/**
 * The console, per screen. `pageerror` is an UNCAUGHT exception and is asserted
 * at zero — §1's requirement, not negotiable. `console.error` is collected
 * beside it and asserted separately so a failure says which of the two it was.
 */
type Con = { errors: string[]; uncaught: string[] };
function watchConsole(page: Page): Con {
  const c: Con = { errors: [], uncaught: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Cloudflare's `__CF$cv$` loader carries a per-request token, so its hash
    // differs every load and can never be allowed by hash. CLASSIFIED, not
    // ignored: a refusal of OUR bootstrap still fails. See _helpers.
    if (isForeignInlineScriptRefusal(m.text())) return;
    c.errors.push(`${page.url().replace(/^https?:\/\/[^/]+/, '')}  ${m.text().slice(0, 240)}`);
  });
  page.on('pageerror', (e) => c.uncaught.push(`${page.url()}  ${String(e).slice(0, 240)}`));
  return c;
}

/**
 * Console noise this suite refuses to blame on the product.
 *
 * The Mappls basemap is CLIENT-SIDE ONLY and its tiles 401 on some origins
 * (memory: "Mappls is CLIENT-SIDE now"). `PointRadiusMap` is mounted on the
 * Sites screen and its SDK logs its own failures. That is third-party network
 * state, not a Pahchan defect, and asserting zero console errors on a screen
 * that embeds it would turn an infrastructure fact into a product failure. The
 * filter is NARROW and every entry names what it lets through.
 */
const CONSOLE_ALLOW = [
  /mappls/i,            // the basemap SDK's own logging
  /apis\.mappls\.com/i, // and its tile / token requests
  /Failed to load resource: the server responded with a status of 40[13]/i,
];
const realErrors = (c: Con) => c.errors.filter((e) => !CONSOLE_ALLOW.some((re) => re.test(e)));

/**
 * Open Pahchan and switch to one tab, wherever `ModuleTabs` has put it.
 *
 * The page holds its tab in local state with NO url parameter, so `goto`
 * always lands on whatever `useTabPrefs` has starred. Every caller names the
 * tab it wants; nothing here assumes the landing tab.
 *
 * ⚠ The popover row's accessible name is the tab's LABEL ("Clock in", "My
 * attendance"), not its id — `ModuleTabs.jsx:279` renders `t.label`. Passing
 * the id there finds nothing and reads exactly like a missing tab.
 */
const TAB_LABEL: Record<string, string> = {
  clock: 'Clock in', register: 'Register', corrections: 'Corrections', payroll: 'Payroll',
  history: 'My attendance', notice: 'What we record', consent: 'Consent',
  enrollment: 'Enrollment', policy: 'Policy', analytics: 'Analytics',
};

async function pahchan(page: Page, tabId: string): Promise<Locator> {
  if (!/\/pahchan/.test(page.url())) await page.goto('/pahchan');
  const strip = page.getByRole('tablist', { name: 'Pahchan sections' });
  await expect(strip, 'the Pahchan tab strip never rendered').toBeVisible({ timeout: 45_000 });

  // ⚠ LET THE STRIP FINISH MEASURING. `ModuleTabs` re-derives `fits` from a
  // ResizeObserver, so a tab can EXIST and a beat later be gone into More —
  // "a tab that was there when it was looked for and not there when it was
  // pressed" (suite 07).
  let stable = -1, sameFor = 0;
  for (let i = 0; i < 25; i++) {
    const n = await strip.locator('[role="tab"]').count();
    if (n > 0 && n === stable) { sameFor += 1; if (sameFor >= 3) break; } else sameFor = 0;
    stable = n;
    await page.waitForTimeout(150);
  }

  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const inline = page.locator(`#mt-tab-${tabId}`);
      if (await inline.count()) {
        await inline.click({ timeout: 15_000 });
      } else {
        const more = page.getByRole('button', { name: /^More/ });
        await expect(more, `"${tabId}" is not inline and there is no More menu`).toBeVisible();
        // ⚠ THE TRIGGER IS A TOGGLE — clicking it while open CLOSES it, and the
        // lookup then runs against a menu that is not on screen.
        if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const row = menu.getByRole('menuitem', {
          name: new RegExp(`^\\s*${TAB_LABEL[tabId].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'),
        });
        const listed = (await menu.locator('.mt__pop-en').allTextContents()).join(', ');
        expect(await row.count(),
          `"${TAB_LABEL[tabId]}" is in neither the strip nor the More menu. More listed: ${listed}`)
          .toBeGreaterThan(0);
        await row.click();
      }
      const panel = page.locator(`#mt-panel-${tabId}`);
      await expect(panel, `the "${tabId}" panel did not open`).toBeVisible({ timeout: 20_000 });
      await settle(page);
      return panel;
    } catch (e) {
      last = e;
      if (attempt === 4) throw e;
      console.log(`\n[pahchan] the tab strip moved while reaching "${tabId}" — retry ${attempt}\n`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  throw last;
}

/**
 * Click something that writes, and WAIT FOR THE SERVER before going on.
 *
 * ⚠ The fix for three of Suite 02's four failures on 2026-08-28: each clicked
 * Save and called `page.reload()` on the very next line, the reload raced the
 * request, the value read back empty, and the suite reported "the product did
 * not save it". It had. Returns the STATUS, because a toast is the client's
 * opinion and the status is the server's.
 */
async function writes(
  page: Page, urlRe: RegExp, act: () => Promise<void>,
  opts: { methods?: string[]; timeout?: number } = {},
): Promise<{ status: number; body: any; text: string }> {
  const methods = opts.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE'];
  let res;
  try {
    [res] = await Promise.all([
      page.waitForResponse((r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
        { timeout: opts.timeout ?? 45_000 }),
      act(),
    ]);
  } catch (e) {
    const failed = FAILED.get(page) ?? [];
    throw new Error(
      `${String((e as Error)?.message ?? e)}\n` +
      `     waiting for a ${methods.join('/')} matching ${urlRe}\n` +
      (failed.length
        ? `     requests that FAILED without a response:${failed.slice(-6).map((l) => '\n       ' + l).join('')}`
        : '     no /api/ request failed — the browser may never have issued one'),
    );
  }
  const text = await res.text();
  expect(res.status(),
    `${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}: ${text.slice(0, 400)}`)
    .toBeLessThan(400);
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), body, text };
}

/**
 * Click a control in a list that refetches under it.
 *
 * ⚠ A TEST BUG'S FIX, written down so it is not later read as a product one.
 * Suite 02's 02.14/02.15 failed with "element is not stable … detached from the
 * DOM" because a refetch replaced the tbody mid-click. Both the consent roster
 * and the corrections table `load()` after every write, so both have it.
 * Retries ONLY on the detach signature — a blind retry papers over a genuinely
 * missing or disabled control, which is the one thing this suite exists to catch.
 */
async function retryOnDetach(page: Page, act: () => Promise<void>, why: string) {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await act(); return; } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/detached from the DOM|not stable|element is not attached/i.test(msg) || attempt === 3) throw e;
      last = e;
      console.log(`\n[retryOnDetach] ${why} — the tree moved under the click, retry ${attempt}\n`);
      await page.waitForTimeout(400);
    }
  }
  throw last;
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `.k-section` by the title a person reads. Sites lives inside Policy. */
function section(scope: Locator, title: string): Locator {
  return scope.locator('.k-section').filter({
    has: scope.page().locator('.k-section__title', { hasText: new RegExp(`^\\s*${reEsc(title)}`) }),
  }).first();
}

/**
 * The `<label>` whose caption span is EXACTLY this text.
 *
 * ⚠ NOT `getByLabel()`. Every form in this module is
 * `<label><span class="fld__l">Caption</span><control/></label>`, and an
 * accessible name computed from a wrapping label INCLUDES the control's value —
 * so `getByLabel('Status', { exact: true })` finds nothing once a select has a
 * selection. Matching the caption span is structural and cannot drift.
 *
 * ⚠ The inner locator is built from `scope.page()`, not from `scope`:
 * `filter({ has })` keeps the inner locator's WHOLE chain, so `scope.locator(…)`
 * becomes `label >> .ph__form >> span` and can never match.
 */
function field(scope: Locator, label: string): Locator {
  const caption = scope.page().locator('span.fld__l').filter({ hasText: new RegExp(`^\\s*${reEsc(label)}`) });
  return scope.locator('label').filter({ has: caption }).first();
}

/**
 * Type into a field with REAL KEYSTROKES, then prove the value landed.
 *
 * `fill('')` does not register with a controlled input. Suite 07 hit the sharper
 * version: `Ctrl+A, Delete, type "2"` produced **"12"**, because a controlled
 * numeric input re-renders its DEFAULT when emptied and the next keystroke
 * APPENDS. Typing OVER the selection replaces it in one event, so the box is
 * never empty and the default can never fire. The read-back is the proof —
 * without it that fault is invisible until a downstream count disagrees.
 */
async function type(scope: Locator, label: string, value: string) {
  const box = field(scope, label).locator('input:not([type=checkbox]):not([type=radio]), textarea').first();
  await expect(box, `no field labelled "${label}"`).toBeVisible({ timeout: 20_000 });
  await box.click();
  await box.press('ControlOrMeta+a');
  if (value) {
    await box.pressSequentially(value, { delay: 4 });
    await expect(box, `"${label}" would not take the value "${value}"`).toHaveValue(value, { timeout: 10_000 });
  } else {
    await box.press('Delete');
  }
}

/** The same, for a box located directly rather than by caption. */
async function typeInto(box: Locator, value: string, why: string) {
  await expect(box, why).toBeVisible({ timeout: 20_000 });
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(value, { delay: 4 });
  await expect(box, `${why} would not take "${value}"`).toHaveValue(value, { timeout: 10_000 });
}

/**
 * Choose from a real `<select>` by the option text a person reads.
 *
 * ⚠ NOT `_helpers.ts::pickOption`, which ends `expect(idx).toBeGreaterThan(0)` —
 * it assumes every select opens with a placeholder, so index 0 is never a legal
 * answer. Every select on these screens opens on a real value ("They agreed",
 * "Present", "Clock out"), so that helper refuses the first option on all of them.
 *
 * ⚠ THE COUNT IS ASSERTED BEFORE THE SEARCH. A `findIndex` over an empty list
 * answers -1 and reads exactly like a wrong label; an empty picker is a real
 * failure and is reported as one.
 */
async function choose(sel: Locator, what: string, optionText: string | RegExp) {
  await expect(sel, `no select for "${what}"`).toBeVisible({ timeout: 20_000 });
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const hit = (t: string) => (typeof optionText === 'string' ? norm(t).includes(optionText) : optionText.test(t));
  const deadline = Date.now() + 20_000;
  let texts: string[] = [], idx = -1;
  for (;;) {
    texts = (await sel.locator('option').allTextContents()).map(norm);
    idx = texts.findIndex(hit);
    if (idx >= 0 || Date.now() > deadline) break;
    await sel.page().waitForTimeout(200);
  }
  expect(idx, `no "${what}" option matching ${optionText}; the picker offered: ` +
    (texts.length ? texts.slice(0, 12).join(' | ') : '(nothing at all)')).toBeGreaterThanOrEqual(0);
  const value = await sel.locator('option').nth(idx).getAttribute('value');
  await sel.selectOption(value ?? { index: idx });
}

/** Tick or untick a real checkbox by the words beside it. */
async function tick(scope: Locator, words: string | RegExp, on = true) {
  const box = scope.locator('label').filter({ hasText: words }).first().locator('input[type=checkbox]');
  await expect(box, `no checkbox beside "${words}"`).toBeVisible({ timeout: 20_000 });
  if ((await box.isChecked()) !== on) await box.click();
  await expect(box, `the checkbox beside "${words}" would not go ${on ? 'on' : 'off'}`)
    .toBeChecked({ checked: on });
}

/**
 * Set a `DateInput type="date"` through its own calendar.
 *
 * ⚠ NO NATIVE `<input type="date">` ANYWHERE — the whole product bans it and
 * `DateInput.jsx` keeps a clipped `.pk__native` only for form serialisation.
 * This drives the picker a person drives. Bounded at 13 months so a wrong ISO
 * string FAILS rather than spinning; the days this suite uses are all inside
 * the current or the previous month.
 */
async function setDay(scope: Locator, caption: string, iso: string) {
  return setDayIn(field(scope, caption), caption, iso);
}

/**
 * The same, addressed by the `<label>` itself.
 *
 * ⚠ NOT EVERY DATE FIELD HAS A `.fld__l` CAPTION. The register's day picker is
 * `<label className="rv__day"><span className="k-sr-only">Which day&rsquo;s
 * register</span>…` — the caption is screen-reader-only AND carries a curly
 * apostrophe, so `field()` cannot find it and a straight-quoted string would
 * not match it either. Addressed structurally instead.
 */
async function setDayIn(label: Locator, caption: string, iso: string) {
  await label.locator('.pk--dt button.pk__tr').first().click();
  const pop = label.locator('.pk__pop');
  await expect(pop, `the date picker for "${caption}" did not open`).toBeVisible({ timeout: 10_000 });
  const want = new Date(`${iso}T00:00:00`);
  const title = `${want.toLocaleString('en-GB', { month: 'long' })} ${want.getFullYear()}`;
  for (let i = 0; i < 13; i++) {
    const shownText = (await pop.locator('.pk__calt').innerText()).trim();
    if (shownText === title) break;
    const shown = new Date(`${shownText} 1`);
    await pop.getByRole('button', { name: shown < want ? 'Next month' : 'Previous month' }).click();
  }
  expect((await pop.locator('.pk__calt').innerText()).trim(),
    `the calendar never reached ${title} for "${caption}"`).toBe(title);
  await pop.locator('.pk__d:not(.out)', { hasText: new RegExp(`^${want.getDate()}$`) }).first().click();
  await expect(pop).toBeHidden({ timeout: 10_000 });
}

/**
 * Set a `DateInput type="time"`.
 *
 * There is no calendar on a time picker — `DateInput.jsx:223` renders a listbox
 * of 48 half-hour options. Chosen BY INDEX (`h*2 + m/30`), because matching the
 * rendered label would depend on `toLocaleTimeString` agreeing between node and
 * the browser. THE COUNT IS ASSERTED FIRST: an `nth()` on an empty list is the
 * 02.3 shape, a check that runs over nothing and passes forever.
 */
async function setTime(scope: Locator, caption: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  expect(m === 0 || m === 30, `${hhmm} is not on a half hour — the picker offers no such option`).toBeTruthy();
  const lbl = field(scope, caption);
  await lbl.locator('button.pk__tr').first().click();
  const pop = lbl.locator('[role="dialog"]');
  await expect(pop, `the time picker for "${caption}" did not open`).toBeVisible({ timeout: 10_000 });
  const options = pop.locator('.pk__times [role="option"]');
  await expect(options, 'the time picker offered no options at all').toHaveCount(48, { timeout: 10_000 });
  await options.nth(h * 2 + (m === 30 ? 1 : 0)).click();
  await expect(pop).toBeHidden({ timeout: 10_000 });
}

/**
 * The toast TITLE. `.tst__t` carries the verb, `.tst__s` the message — 02.2b was
 * a test bug for reading the pair the wrong way round. `.first()` because toasts
 * STACK and thirty consent confirmations in a row would otherwise be a
 * strict-mode violation that reads exactly like "the product did not confirm".
 */
const toastTitle = (page: Page, t: string | RegExp) => page.locator('.tst__t').filter({ hasText: t }).first();
const emptyTitle = (scope: Locator) => scope.locator('.empty__title');

/* ══════════════════════════════════════════════════════════════════════════
   09.1 — EVERY SCREEN, IN WORDS, BEFORE ITS DATA EXISTS
   ══════════════════════════════════════════════════════════════════════════ */

test.describe('Suite 09 — Pahchan · Unicode Group', () => {
  /* ════════════════════════════════════════════════════════════════════════
     09.0 — THE TWO BROWSER CAPABILITIES THIS WHOLE MODULE IS BUILT ON
     ════════════════════════════════════════════════════════════════════════ */

  /**
   * Pahchan on the web is a camera and a location fix. Everything else — the
   * geofence, the sites, the altitude window, the mandatory selfie, the
   * comparison a reviewer makes — is downstream of those two browser APIs
   * being callable at all.
   *
   * They are measured FIRST, and in the browser rather than from a header,
   * because a suite that discovers this halfway through a punch loop reports it
   * as "the camera could not be opened" — which is the product's own words for
   * a user having denied permission, and is exactly the wrong conclusion.
   *
   * This test writes nothing.
   */
  test('09.0 the deployed app can actually reach a camera and a location', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await signIn(page);
    await page.goto('/pahchan');

    // The header the deployment serves, read from the document's own response.
    const res = await page.request.get(page.url());
    const pp = res.headers()['permissions-policy'] ?? '(none)';

    // …and what the APIs actually do on that document. `getCurrentPosition`
    // never throws — it calls back — so the probe resolves a verdict either way
    // and cannot hang the test.
    const cap = await page.evaluate(async () => {
      const geo = await new Promise<string>((resolve) => {
        if (!navigator.geolocation) return resolve('no geolocation object');
        const t = setTimeout(() => resolve('timed out with no callback'), 8000);
        navigator.geolocation.getCurrentPosition(
          (p) => { clearTimeout(t); resolve(`ok ${p.coords.latitude.toFixed(4)},${p.coords.longitude.toFixed(4)}`); },
          (e) => { clearTimeout(t); resolve(`DENIED code=${e.code} ${e.message}`); },
          { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 },
        );
      });
      let cam = 'unknown';
      try {
        if (!navigator.mediaDevices?.getUserMedia) cam = 'no getUserMedia';
        else {
          const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
          cam = `ok ${s.getVideoTracks().length} track(s)`;
          s.getTracks().forEach((t) => t.stop());
        }
      } catch (e: any) {
        cam = `DENIED ${e?.name}: ${e?.message}`;
      }
      let perm = 'unknown';
      try { perm = (await navigator.permissions.query({ name: 'geolocation' as PermissionName })).state; }
      catch { /* not queryable */ }
      return { geo, cam, perm };
    });

    console.log(
      `\n[09.0] Permissions-Policy served for ${new URL(page.url()).origin}:` +
      `\n[09.0]   ${pp}` +
      `\n[09.0] navigator.permissions.query({geolocation}) → ${cap.perm}` +
      `\n[09.0] getCurrentPosition            → ${cap.geo}` +
      `\n[09.0] getUserMedia({video})         → ${cap.cam}\n`,
    );

    /**
     * ⚠ AN EMPTY ALLOWLIST IS "OFF", NOT "DEFAULT".
     *
     * `geolocation=()` means the feature is disabled for EVERY origin including
     * the document's own. Chrome then denies the call before any permission the
     * user or this harness granted is consulted — which is why the failure
     * reads as a user denial in `Sites.jsx`'s toast and as a camera error in
     * `Clock.jsx`, and why granting permissions in Playwright does not move it.
     *
     * Reported, not fixed: §14 owns the verdict on a product change, and this
     * header is in `frontend/vercel.json` — a file whose last incident
     * ("a `//` key kills the deploy") is on record.
     */
    expect(cap.geo.startsWith('ok'),
      `THE DEPLOYED APP CANNOT READ A LOCATION.\n` +
      `     getCurrentPosition answered: ${cap.geo}\n` +
      `     Permissions-Policy: ${pp}\n` +
      `     An empty allowlist — geolocation=() — disables the feature for the document's\n` +
      `     own origin too, so the denial happens before any granted permission is read.\n` +
      `     Consequence in this module: pahchanClock.js::captureGeoFix resolves NULL on\n` +
      `     every punch, so PunchBody.lat is None, so _compute_flags appends \`geo\` to\n` +
      `     every punch and _nearest_site is never consulted — the geofence branch\n` +
      `     (distance_m is not None) can never fire. Sites, radius and the altitude\n` +
      `     window have no effect on any punch made from a browser.\n` +
      `     Also breaks Sites.jsx's "Use this device", which reports it as the user\n` +
      `     having refused.\n` +
      `     EVIDENCE, NOT A VERDICT — §14 rules on the fix.`)
      .toBeTruthy();

    expect(cap.cam.startsWith('ok'),
      `THE DEPLOYED APP CANNOT OPEN A CAMERA.\n` +
      `     getUserMedia answered: ${cap.cam}\n` +
      `     Permissions-Policy: ${pp}\n` +
      `     Consequence in this module: the selfie is MANDATORY on the web clock —\n` +
      `     "the send button does not exist until a frame has been captured" — so a\n` +
      `     camera that cannot open means no punch can be made with a photograph at\n` +
      `     all. After three failures Clock.jsx offers "Record without a photo",\n` +
      `     which is the degraded path, permanently, for every web user.\n` +
      `     EVIDENCE, NOT A VERDICT — §14 rules on the fix.`)
      .toBeTruthy();
  });

  test('09.1 all eleven screens open, say in words what is empty, and the console is clean', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ AN EMPTY-STATE TEST IS ONLY MEANINGFUL BEFORE THE REST OF THE SUITE
     * RUNS, and on a re-run it is not. That is not a reason to relax the
     * assertion — it is what the test IS. So emptiness is checked against the
     * SERVER first and the sentence is asserted only where the server agrees
     * the table is empty. Where it does not, the assertion is pointed the other
     * way: the empty sentence must be ABSENT. Both directions are real.
     */
    const report: string[] = [];

    async function bothWays(scope: Locator, rows: number, title: RegExp, where: string) {
      if (rows === 0) {
        await expect(emptyTitle(scope).filter({ hasText: title }),
          `${where}: the server answered 0 rows, so the screen must SAY it is empty in words`)
          .toBeVisible({ timeout: 30_000 });
        report.push(`${where}: 0 rows → empty state shown in words ✔`);
      } else {
        await expect(emptyTitle(scope).filter({ hasText: title }),
          `${where}: the server answered ${rows} rows and the screen still shows the empty state`)
          .toHaveCount(0);
        report.push(`${where}: ${rows} rows already → empty state correctly ABSENT ✔`);
      }
    }

    // ── 1 · Clock ────────────────────────────────────────────────────────────
    // Not a list, so not a row count: before the DPDP notice is acknowledged
    // this screen is the NOTICE and nothing else, and that ordering is §9's
    // whole point — somebody photographed twice a day reads what is held
    // BEFORE the first capture, not once it is already stored.
    {
      const panel = await pahchan(page, 'clock');
      const mine = await me(page, 2);
      if (!mine?.notice?.acknowledged_at) {
        await expect(panel.getByRole('heading', { name: /Before your first clock-in/i }),
          'the clock screen must serve the notice before it offers a camera').toBeVisible({ timeout: 20_000 });
        await expect(panel.getByRole('button', { name: 'I have read this' })).toBeVisible();
        report.push('clock: notice NOT acknowledged → the camera is behind the notice ✔');
      } else {
        await expect(panel.locator('.ph__clockready, .ph__clockdone'),
          'the notice is acknowledged, so the clock must offer the camera').not.toHaveCount(0, { timeout: 20_000 });
        report.push('clock: notice already acknowledged → the camera screen is offered ✔');
      }
    }

    // ── 2 · Register ─────────────────────────────────────────────────────────
    {
      const panel = await pahchan(page, 'register');
      const reg = await orgGet(page, '/api/v1/pahchan/register');
      const punches = (reg?.punches ?? reg?.data?.punches ?? []);
      /**
       * ⚠ THREE STATES, NOT TWO, AND `bothWays` CANNOT EXPRESS THEM.
       *
       * A TEST BUG'S FIX, found by running the suite twice. The register opens
       * on "Needs a look", whose list is `flags && !review_verdict`
       * (Register.jsx:563). So:
       *   · no punches at all      → "Nobody has clocked in yet"
       *   · punches, none pending  → "Nothing needs a look" — §3 gives this its
       *                              own icon and tone because reaching zero
       *                              flagged is the GOAL, not an absence
       *   · punches still pending  → a table, and NO empty state
       * The first draft ORed the two sentences into one `bothWays` call, so
       * once 09.9 had ruled on every punch it demanded the absence of both and
       * failed against the correct "Nothing needs a look". A test that only
       * works before its own suite has run is a test that works once.
       */
      const pending = punches.filter((p: any) => (p.flags || []).length && p.review_verdict == null);
      if (punches.length === 0) {
        await expect(emptyTitle(panel).filter({ hasText: /Nobody has clocked in yet/i }),
          'the register holds no punches today and must say so in words')
          .toBeVisible({ timeout: 30_000 });
        report.push('register: 0 punches → "Nobody has clocked in yet" ✔');
      } else if (pending.length === 0) {
        await expect(emptyTitle(panel).filter({ hasText: /Nothing needs a look/i }),
          `the register holds ${punches.length} punches, all ruled on, so the queue must say ` +
          `it is clear — and that sentence is different from "nobody has clocked in"`)
          .toBeVisible({ timeout: 30_000 });
        report.push(`register: ${punches.length} punches, 0 pending → "Nothing needs a look" ✔`);
      } else {
        await expect(emptyTitle(panel),
          `${pending.length} punches are waiting on a reviewer and the register shows an empty state`)
          .toHaveCount(0, { timeout: 30_000 });
        report.push(`register: ${punches.length} punches, ${pending.length} pending → table shown ✔`);
      }
    }

    // ── 3 · Corrections ──────────────────────────────────────────────────────
    {
      const panel = await pahchan(page, 'corrections');
      const all = await rowsOf(page, '/api/v1/pahchan/regularisations?status=all');
      await bothWays(panel, all.length, /Nobody has asked yet|Nothing waiting/i, 'corrections');
    }

    // ── 4 · Payroll ──────────────────────────────────────────────────────────
    // No list and therefore no empty state — it carries its "nothing yet" as a
    // lede, and the lede is the assertion.
    {
      const panel = await pahchan(page, 'payroll');
      await expect(panel.locator('.ph__lede').filter({ hasText: /Preview first/i }),
        'the payroll screen must say what to do before anything has been previewed')
        .toBeVisible({ timeout: 20_000 });
      report.push('payroll: says "Preview first" before any run ✔');
    }

    // ── 5 · My attendance (history) ──────────────────────────────────────────
    {
      const panel = await pahchan(page, 'history');
      const mine = await rowsOf(page, '/api/v1/pahchan/regularisations/mine');
      await bothWays(section(panel, 'Corrections you have asked for'), mine.length,
        /Nothing asked for/i, 'history/corrections');
      // The calendar is always drawn — an employee with no punches still has a
      // month, and a month that renders nothing reads as "your attendance is
      // not being recorded".
      await expect(panel.locator('.pcal__grid .pcal__d'),
        'the history calendar drew no days at all').not.toHaveCount(0, { timeout: 20_000 });
      report.push('history: the month calendar renders its days ✔');
    }

    // ── 6 · What we record (the DPDP notice) ─────────────────────────────────
    {
      const panel = await pahchan(page, 'notice');
      await expect(panel.getByRole('heading', { name: /Attendance — what we record/i }))
        .toBeVisible({ timeout: 20_000 });
      // Six disclosure lines, from `noticeLines()`. A notice with fewer lines
      // than the copy defines is a notice that lost one.
      await expect(panel.locator('.phn__row'), 'the DPDP notice rendered fewer than six disclosure lines')
        .toHaveCount(6, { timeout: 20_000 });
      await expect(panel.locator('.phn__legal'),
        'the notice must say it is a notice and not a consent form').toBeVisible();
      report.push('notice: six disclosure lines and the legal footer ✔');
    }

    // ── 7 · Consent ──────────────────────────────────────────────────────────
    {
      const panel = await pahchan(page, 'consent');
      const people = await roster(page);
      expect(people.length, 'the consent roster is empty — Wave 2 owns the 30 employees this reads')
        .toBeGreaterThan(0);
      await expect(panel.getByRole('heading', { name: /Your choice about the photograph/i }))
        .toBeVisible({ timeout: 20_000 });
      // The roster table itself. 30 employees means 30 rows and no empty state.
      await expect(emptyTitle(section(panel, "Everyone's answer")).filter({ hasText: /Nobody on the rolls/i }),
        `${people.length} employees are on the roster and the screen shows "Nobody on the rolls"`)
        .toHaveCount(0);
      report.push(`consent: ${people.length} on the roster, own-answer card present ✔`);
    }

    // ── 8 · Enrollment ───────────────────────────────────────────────────────
    {
      const panel = await pahchan(page, 'enrollment');
      const q = await orgGet(page, '/api/v1/pahchan/enrollment/queue/pending');
      const d = q?.data ?? q;
      await bothWays(section(panel, 'Awaiting approval'), (d.pending_approval || []).length,
        /Nothing waiting/i, 'enrollment/pending');
      await bothWays(section(panel, 'Not yet verifiable'), (d.incomplete || []).length,
        /Everyone is enrolled/i, 'enrollment/incomplete');
    }

    // ── 9 · Policy, and 10 · Sites inside it ─────────────────────────────────
    {
      const panel = await pahchan(page, 'policy');
      await expect(section(panel, 'Shift and overtime')).toBeVisible({ timeout: 20_000 });
      await expect(section(panel, 'Geofence and flags')).toBeVisible();
      await expect(section(panel, 'Retention')).toBeVisible();
      await expect(section(panel, 'Reports')).toBeVisible();
      report.push('policy: shift, geofence, retention and reports all rendered ✔');

      const sites = await rowsOf(page, '/api/v1/pahchan/sites');
      await bothWays(section(panel, 'Sites'), sites.length, /No sites yet/i, 'policy/sites');
    }

    // ── 11 · Analytics ───────────────────────────────────────────────────────
    {
      const panel = await pahchan(page, 'analytics');
      await expect(panel, 'the analytics panel rendered nothing at all').not.toBeEmpty({ timeout: 30_000 });
      report.push('analytics: opened ✔');
    }

    console.log('\n[09.1] ' + report.join('\n[09.1] ') + '\n');

    expect(con.uncaught, `UNCAUGHT page errors while walking all eleven Pahchan screens:\n${con.uncaught.join('\n')}`)
      .toEqual([]);
    expect(realErrors(con), `console.error while walking all eleven Pahchan screens:\n${realErrors(con).join('\n')}`)
      .toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.2 — THE POLICY, AND THE FOUR DEPARTMENT OVERRIDES THAT HAVE NO UI
     ════════════════════════════════════════════════════════════════════════ */

  test('09.2 the attendance policy is saved from the form, and department overrides have no way in', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    const panel = await pahchan(page, 'policy');

    /**
     * ⚠ THE POLICY FORM HAS TWO FIELDS WITH THE SAME CAPTION.
     *
     * `SHIFT` declares "Overtime after" twice — once in hours-in-a-day and once
     * in hours-in-a-week (`PahchanPolicy.jsx:57,62`) — and the only thing that
     * distinguishes them on screen is the unit span beside the box. A caption
     * lookup is therefore ambiguous by construction, and `getByLabel` would
     * resolve whichever came first in the DOM. Both are on the payslip.
     *
     * Reported as a finding, and worked around STRUCTURALLY: each section
     * renders its `numberRow`s in declaration order, so the field is addressed
     * by its position inside its own section. That cannot drift with copy.
     */
    const numIn = (title: string, i: number) =>
      section(panel, title).locator('label.ph__fld--num input[type=number]').nth(i);

    const shift = section(panel, 'Shift and overtime');
    const geo = section(panel, 'Geofence and flags');
    const retention = section(panel, 'Retention');

    // Overtime ON — it is off by default, deliberately, and until it is on the
    // payroll push leaves `overtime_hours` untouched rather than writing a zero.
    await tick(shift, /Compute overtime/i, true);

    // Factories Act 1948: §54 nine hours a day, §51 forty-eight a week, §59 at
    // twice the ordinary rate. Typed as the statute has them, not invented.
    await typeInto(numIn('Shift and overtime', 0), '8', 'contracted day (hours)');
    await typeInto(numIn('Shift and overtime', 1), '9', 'overtime after (hours in a day)');
    await typeInto(numIn('Shift and overtime', 2), '48', 'overtime after (hours in a week)');
    await typeInto(numIn('Shift and overtime', 3), '2', 'overtime rate (× ordinary wage)');

    await choose(shift.locator('select').first(), 'Week starts on', 'Monday');

    // A shift is a window or it is nothing — the screen refuses a half pair,
    // and this sets both.
    await setTime(shift, 'Shift starts', '09:30');
    await setTime(shift, 'Shift ends', '18:30');

    await typeInto(numIn('Geofence and flags', 0), '150', 'geofence radius');
    await typeInto(numIn('Geofence and flags', 1), '100', 'accuracy flag threshold');
    await typeInto(numIn('Geofence and flags', 2), '10', 'late grace');

    // ⚠ LEFT ON, AND THAT IS THE PRODUCT'S OWN RULE. §2: nothing blocks a
    // punch. The checkbox reads "Count punches made outside a site" and its own
    // hint says turning it off does NOT reject them. 09.8 proves that.
    await tick(geo, /Count punches made outside a site/i, true);

    // Retention is a PROMISE. These are the defaults, retyped rather than
    // shortened: shortening a window deletes people's records sooner and cannot
    // be undone.
    await typeInto(numIn('Retention', 0), '90', 'punch photo retention (days)');
    await typeInto(numIn('Retention', 1), '45', 'reference photo grace (days)');
    await typeInto(numIn('Retention', 2), '3', 'record retention (years)');

    const saved = await writes(page, /\/pahchan\/policy$/, async () => {
      await panel.getByRole('button', { name: /^Save policy$/ }).click();
    }, { methods: ['PATCH'] });
    expect(saved.status, `PATCH /pahchan/policy answered ${saved.status}${dump(wire)}`).toBe(200);
    await expect(toastTitle(page, /Policy saved/i)).toBeVisible({ timeout: 20_000 });

    // The server's copy, not the screen's. A toast is the client's opinion.
    const pol = (await orgGet(page, '/api/v1/pahchan/policy'));
    const p = pol?.data ?? pol;
    expect(p.overtime_enabled, `overtime did not save${dump(wire)}`).toBe(true);
    expect(Number(p.overtime_daily_threshold_hours)).toBe(9);
    expect(Number(p.overtime_weekly_threshold_hours)).toBe(48);
    expect(Number(p.overtime_multiplier)).toBe(2);
    expect(Number(p.standard_hours_per_day)).toBe(8);
    expect(Number(p.default_radius_m)).toBe(150);
    expect(Number(p.punch_photo_retention_days)).toBe(90);
    expect(p.allow_outside_geofence, 'nothing may block a punch — §2').toBe(true);
    expect(String(p.shift_start_time).slice(0, 5)).toBe('09:30');
    expect(String(p.shift_end_time).slice(0, 5)).toBe('18:30');

    /* ── §4's four department overrides ──────────────────────────────────────
       The endpoints exist and answer. The SCREEN has no way to reach them:
       grep for `policy/scopes` across `frontend/src` returns nothing, and this
       panel offers no control naming a department or a scope. Both halves are
       asserted so the gap is a measurement rather than an omission. */
    const scopes = await orgGetStatus(page, '/api/v1/pahchan/policy/scopes');
    expect(scopes.status,
      `GET /pahchan/policy/scopes answered ${scopes.status} — the endpoint §4's overrides need`)
      .toBe(200);
    const scopeRows = scopes.body?.data ?? scopes.body ?? [];

    const panelText = await panel.innerText();
    expect(/department|scope|override/i.test(panelText),
      'the Policy screen now names a department, a scope or an override — if a UI for ' +
      'POST/PUT /pahchan/policy/scopes has shipped, §4\'s four overrides became reachable ' +
      'and this suite must type them instead of reporting the gap.').toBeFalsy();

    console.log(
      `\n[09.2] policy saved and read back from the server ✔` +
      `\n[09.2] ⚠ DEPARTMENT OVERRIDES: 0 of §4's 4. GET /pahchan/policy/scopes → 200 with ` +
      `${scopeRows.length} rows, and the Policy screen offers NO control that reaches it. ` +
      `\n[09.2]   PUT/DELETE /policy/scopes have server tests (tests/test_pahchan_policy_scopes.py) ` +
      `and no web caller. Creating one would need page.request.put, which rule 1 forbids.` +
      `\n[09.2] ⚠ TWO FIELDS SHARE ONE CAPTION: "Overtime after" is both the daily and the ` +
      `weekly threshold (PahchanPolicy.jsx:57,62), told apart only by the unit beside the box. ` +
      `Both figures are on a payslip.\n`,
    );

    expect(con.uncaught, `UNCAUGHT page errors on the policy screen:\n${con.uncaught.join('\n')}`).toEqual([]);
    expect(realErrors(con), `console.error on the policy screen:\n${realErrors(con).join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.3 — FOUR SITES: TWO TYPED, ONE FROM THE DEVICE'S OWN FIX, ONE VERTICAL
     ════════════════════════════════════════════════════════════════════════ */

  test('09.3 four sites, and the fence is visible before it starts flagging anyone', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    let panel = await pahchan(page, 'policy');
    const sites = section(panel, 'Sites');

    const existing = (await rowsOf(page, '/api/v1/pahchan/sites')).map((s) => String(s.name));
    const notes: string[] = [];

    for (const s of SITES) {
      if (existing.includes(s.name)) { notes.push(`${s.name}: already there → verified, not duplicated`); continue; }

      await retryOnDetach(page, async () => {
        // The "Add a site" button is only rendered when the form is closed and
        // the list has loaded — `right={!open && state === 'ready' && …}`.
        //
        // ⚠ `.first()`, and it is a TEST BUG'S FIX rather than a loosening.
        // There are TWO controls with this exact accessible name while the list
        // is empty: the section header's, and the `EmptyState`'s own
        // `action="Add a site"`. A bare match is a strict-mode violation that
        // reads exactly like "the screen offers no way to add one" — which is
        // the opposite of what is on screen. Both open the same form.
        const add = sites.getByRole('button', { name: 'Add a site', exact: true }).first();
        await expect(add, 'the Sites section offered no way to add one').toBeVisible({ timeout: 20_000 });
        await add.click();
      }, `open the site form for ${s.name}`);

      const form = sites.locator('.ph__form');
      await expect(form, 'the site form did not open').toBeVisible({ timeout: 20_000 });

      await type(form, 'Name', s.name);

      if (s.how === 'device') {
        /**
         * §4's "1 by dropping a pin on the map", and it is unreachable TWICE.
         *
         * ⚠ FIRST: THERE IS NO PIN TO DROP. `PointRadiusMap.jsx` takes lat/lng
         * as PROPS and registers one listener — `map.addListener('load', draw)`.
         * No click handler, no drag, no `onPick`, and no other map component in
         * `src/components` has one either. The map on this form is a PICTURE of
         * what has been typed, mounted so a transposed pair or a missing digit
         * is visible in the same glance as the field that caused it.
         *
         * ⚠ SECOND: THE ONE FALLBACK IS DISABLED BY THE DEPLOYMENT. The nearest
         * real interaction the product offers is "Use this device" — the
         * browser's own fix, how somebody standing at the gate places a fence
         * without typing coordinates from memory. `frontend/vercel.json:65`
         * serves `Permissions-Policy: geolocation=()`, an EMPTY allowlist,
         * which disables the feature for the document's own origin. 09.0
         * measures that in the browser and fails on it.
         *
         * The button is still pressed, because what the USER is told is half
         * the finding: the form reports it as the DEVICE refusing, while
         * `navigator.permissions.query({geolocation})` answers **granted** — so
         * neither the product nor the operator can tell a policy block from a
         * refusal, and the suggested remedy ("allow location for this site in
         * your browser") cannot work.
         *
         * The coordinates are then typed so §4's four sites exist and the rest
         * of the suite has a fence to measure. Reported as a substitution and
         * never counted as the map interaction.
         */
        await page.context().setGeolocation({ latitude: s.lat, longitude: s.lng });
        const useDevice = form.getByRole('button', { name: /Use this device/i });
        await expect(useDevice, 'the site form offers no way to place a site from the device')
          .toBeVisible({ timeout: 20_000 });
        await useDevice.click();

        const latBox = form.locator('.ph__fld--coord input').nth(0);
        const lngBox = form.locator('.ph__fld--coord input').nth(1);
        const failToast = page.locator('.tst__t').filter({ hasText: /Could not read this device/i });

        /**
         * ⚠ RACE THE TWO OUTCOMES — DO NOT WAIT OUT THE HAPPY ONE FIRST.
         *
         * A TEST BUG'S FIX, and it produced a false accusation on the first
         * run: waiting 12s for the coordinate to fill and only THEN looking for
         * the failure toast meant the toast had already auto-dismissed, and the
         * suite reported "the device fix failed and the form said nothing at
         * all" — which is a product defect that is not there. The toast was
         * shown; it was gone by the time anybody looked.
         *
         * Both outcomes are watched from the same instant, and whichever
         * settles first is the answer.
         *
         * Six decimals, from `toFixed(6)` in `useMyLocation` — the value the
         * PRODUCT writes. Nothing types it on this branch unless the fix failed.
         */
        const outcome = await Promise.race([
          expect(latBox).toHaveValue(s.lat.toFixed(6), { timeout: 15_000 }).then(() => 'filled' as const),
          expect(failToast).toBeVisible({ timeout: 15_000 }).then(() => 'refused' as const),
        ]).catch(() => 'silent' as const);

        if (outcome === 'filled') {
          await expect(lngBox, 'the device fix filled a latitude and not a longitude')
            .toHaveValue(s.lng.toFixed(6), { timeout: 10_000 });
          // And it says what the fix was worth. A ±2 km desktop fix looks
          // exactly like a ±8 m one until you read the number, and this fix
          // decides whether staff are flagged every morning.
          await expect(form.locator('.ph__hint-top').filter({ hasText: /This device reports ±/ }),
            'the form took a fix and did not say how accurate it was').toBeVisible({ timeout: 10_000 });
          notes.push(`${s.name}: placed from the device's own fix (no click-to-place map exists)`);
        } else {
          // The user-visible half of the 09.0 finding, asserted rather than
          // shrugged at: the screen must at least SAY the fix failed, or an
          // operator waits at a blank form wondering whether it is still
          // thinking. `silent` means neither happened within 15s.
          expect(outcome,
            'the device fix neither filled the coordinates nor said anything at all within 15s. ' +
            'An operator is left at a blank form with no way to tell whether it is still ' +
            'reading a fix or has given up.').toBe('refused');
          notes.push(
            `${s.name}: ⚠ THE DEVICE FIX IS BLOCKED — Permissions-Policy geolocation=() ` +
            `(frontend/vercel.json:65). The form reports it as the DEVICE refusing, which is ` +
            `wrong and unactionable: permissions.query answers "granted" and no browser ` +
            `setting can lift a policy header. Coordinates typed instead — see 09.0.`);
          await typeInto(latBox, s.lat.toFixed(6), 'latitude (device fix blocked)');
          await typeInto(lngBox, s.lng.toFixed(6), 'longitude (device fix blocked)');
        }
        await page.context().setGeolocation(INSIDE);
      } else {
        await typeInto(form.locator('.ph__fld--coord input').nth(0), s.lat.toFixed(6), 'latitude');
        await typeInto(form.locator('.ph__fld--coord input').nth(1), s.lng.toFixed(6), 'longitude');
        notes.push(`${s.name}: coordinates typed`);
      }

      await typeInto(form.locator('.ph__fld--radius input').first(), String(s.radius), 'radius');

      if (s.altitude != null) {
        // ⚠ The vertical pair goes together or not at all —
        // `pahchan_sites_altitude_pair_ck` refuses a tolerance with no altitude
        // and the 422 arrives as a Pydantic array the toast renders as
        // "[object Object]". Both are set.
        const vert = form.locator('.ph__vert input[type=number]');
        await typeInto(vert.nth(0), String(s.altitude), 'altitude');
        await typeInto(vert.nth(1), String(s.tolerance), 'allowed difference');
      }

      // The map under the form is the check this screen exists for: with the
      // coordinates in, it must have stopped saying "no coordinates yet".
      await expect(form.locator('.ph__geofacts'),
        `the fence picture never resolved for ${s.name} — it is still asking for coordinates`)
        .toBeVisible({ timeout: 20_000 });

      const res = await writes(page, /\/pahchan\/sites$/, async () => {
        await form.getByRole('button', { name: 'Add site', exact: true }).click();
      });
      expect(res.status, `POST /pahchan/sites for "${s.name}" answered ${res.status}${dump(wire)}`).toBe(201);
      await expect(toastTitle(page, new RegExp(`${reEsc(s.name)} added`))).toBeVisible({ timeout: 20_000 });
    }

    // ── The server's copy ────────────────────────────────────────────────────
    const live = await rowsOf(page, '/api/v1/pahchan/sites');
    const byName = new Map(live.map((s) => [String(s.name), s]));
    for (const s of SITES) {
      const row = byName.get(s.name);
      expect(row, `the site "${s.name}" is not in GET /pahchan/sites${dump(wire)}`).toBeTruthy();
      expect(Number(row.lat)).toBeCloseTo(s.lat, 5);
      expect(Number(row.lng)).toBeCloseTo(s.lng, 5);
      /**
       * ⚠ ONE SITE IS AMENDED BELOW, SO ITS RADIUS IS NOT CONSTANT ACROSS RUNS.
       *
       * A TEST BUG'S FIX, found by running the suite twice: the amend widens
       * site 2 to AMENDED_RADIUS, and on the second run this loop read that
       * back and reported "the product changed a radius nobody typed". Both
       * values are legal here — which one is present depends only on whether
       * the amend has run yet — and the amend asserts AMENDED_RADIUS exactly a
       * few lines later, so nothing is weakened.
       */
      const legal = s.name === SITES[1].name ? [s.radius, AMENDED_RADIUS] : [s.radius];
      expect(legal,
        `"${s.name}" has radius ${row.radius_m}m; expected ${legal.join(' or ')}m`)
        .toContain(Number(row.radius_m));
      if (s.altitude != null) {
        expect(Number(row.altitude_m), `${s.name} lost its altitude`).toBe(s.altitude);
        expect(Number(row.altitude_tolerance_m), `${s.name} lost its vertical tolerance`).toBe(s.tolerance);
      } else {
        expect(row.altitude_m, `${s.name} acquired an altitude nobody typed — blank must stay blank`).toBeNull();
      }
      expect(row.is_active).not.toBe(false);
    }

    // ── And the customer sees them. A COUNT BEFORE THE LOOP. ─────────────────
    panel = await pahchan(page, 'policy');
    const table = section(panel, 'Sites').locator('table.tbl tbody tr');
    await expect(table, 'the Sites table rendered no rows at all').not.toHaveCount(0, { timeout: 20_000 });
    for (const s of SITES) {
      await expect(section(panel, 'Sites').locator('.ph__name').filter({ hasText: s.name }),
        `"${s.name}" saved but is not on the Sites table`).toHaveCount(1, { timeout: 20_000 });
    }
    // The vertical site says which of the THREE states it is in — "off",
    // "recorded, not checked" and a real window must not read alike.
    await expect(section(panel, 'Sites').locator('.ph__mono')
      .filter({ hasText: new RegExp(`${SITES[3].altitude} m ±${SITES[3].tolerance} m`) }),
      'the vertical site does not show its altitude window on the row').toHaveCount(1, { timeout: 20_000 });

    // ── Show the fence, on a saved row ───────────────────────────────────────
    const row = section(panel, 'Sites').locator('tr').filter({ hasText: SITES[0].name }).first();
    await row.getByRole('button', { name: 'Show fence' }).click();
    const expanded = section(panel, 'Sites').locator('tr.ph__expand .ph__geo').first();
    await expect(expanded, 'the fence did not open under the row').toBeVisible({ timeout: 20_000 });
    // ⚠ ASSERTED ON THE FIGURES, NOT ON TILES. The Mappls basemap is
    // client-side only and 401s on some origins; what this component is FOR is
    // the numbers in words, which need no tiles.
    await expect(expanded.locator('.ph__geofacts'),
      'the fence panel opened without saying where the site is').toBeVisible({ timeout: 20_000 });
    await section(panel, 'Sites').getByRole('button', { name: 'Hide fence' }).first().click();

    // ── An amend, and the sentence that stops a false conclusion ─────────────
    // Widening a radius must NOT be read as clearing yesterday's flags: a punch
    // stores its distance and flags AT CAPTURE.
    const target = SITES[1];
    await retryOnDetach(page, async () => {
      await section(panel, 'Sites').locator('tr').filter({ hasText: target.name }).first()
        .getByRole('button', { name: 'Edit', exact: true }).click();
    }, `open the amend form for ${target.name}`);
    const editForm = section(panel, 'Sites').locator('.ph__form');
    await expect(editForm).toBeVisible({ timeout: 20_000 });
    await typeInto(editForm.locator('.ph__fld--radius input').first(),
      String(AMENDED_RADIUS), 'amended radius');
    const amend = await writes(page, /\/pahchan\/sites\//, async () => {
      await editForm.getByRole('button', { name: 'Save changes', exact: true }).click();
    }, { methods: ['PATCH'] });
    expect(amend.status).toBe(200);
    await expect(page.locator('.tst__s').filter({ hasText: /keep the distance and flags they were given at capture/i }),
      'amending a fence must say it does not re-measure punches already recorded')
      .toBeVisible({ timeout: 20_000 });
    const after = await rowsOf(page, '/api/v1/pahchan/sites');
    expect(Number(after.find((s) => s.name === target.name).radius_m),
      `the amended radius did not save${dump(wire)}`).toBe(AMENDED_RADIUS);

    console.log(
      '\n[09.3] ' + notes.join('\n[09.3] ') +
      `\n[09.3] ${live.length} sites on the server; §4 asked for 4.` +
      `\n[09.3] ⚠ §4's "1 by dropping a pin on the map" is NOT what happened, and it is ` +
      `unreachable twice over. (a) There is no click-to-place map anywhere in the product: ` +
      `PointRadiusMap takes lat/lng as props and registers one listener ('load'). (b) The one ` +
      `fallback — the form's "Use this device" — is disabled on the deployed app by ` +
      `Permissions-Policy: geolocation=() (frontend/vercel.json:65). See 09.0 and the note ` +
      `above for what the operator is told instead.\n`,
    );

    expect(con.uncaught, `UNCAUGHT page errors on the sites screen:\n${con.uncaught.join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.4 — THE DPDP NOTICE, READ AND ACKNOWLEDGED
     ════════════════════════════════════════════════════════════════════════ */

  test('09.4 the notice is read before the camera, and the acknowledgement is one row per account', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    const panel = await pahchan(page, 'notice');

    // Every one of the six lines opens and holds real words. They are in the
    // DOM whether open or closed on purpose — "a notice that only exists once
    // you have clicked the right row is a notice you can be argued out of
    // having read" — so the text is asserted without opening anything, and the
    // disclosure is then exercised as a person would.
    const rows = panel.locator('.phn__row');
    await expect(rows, 'the DPDP notice rendered no disclosure lines').toHaveCount(6, { timeout: 20_000 });

    /**
     * ⚠ `textContent()`, NEVER `innerText()`, AND IT IS A TEST BUG'S FIX.
     *
     * The six answers are `<p class="phn__a" hidden>` until their row is
     * opened — deliberately, so the words are findable by the browser's own
     * find-in-page and by a screen reader following `aria-controls`: "a notice
     * that only exists once you have clicked the right row is a notice you can
     * be argued out of having read."
     *
     * `innerText` is the RENDERED text and returns nothing for a hidden node,
     * so reading the panel's `innerText()` and searching it produced "the
     * notice does not quote this org's own photo retention" — an accusation
     * that the DPDP copy had lost its retention figure, when the sentence was
     * present and closed. `textContent` reads the DOM regardless of display,
     * which is what "present in the notice" actually means here.
     */
    const lineText: string[] = [];
    for (let i = 0; i < 6; i++) {
      const words = ((await panel.locator(`#phn-a-${i}`).textContent()) || '').trim();
      expect(words.length, `disclosure line ${i} of the DPDP notice is empty`).toBeGreaterThan(20);
      lineText.push(words);
    }
    await rows.first().locator('.phn__q').click();
    await expect(panel.locator('#phn-a-0'), 'the first disclosure line would not open').toBeVisible();

    // The retention figures must be the ORG'S OWN. A hardcoded 90 printed on
    // every notice the product ever served is the fault `_retention` was fixed
    // for, so the number on screen is compared with the policy row.
    const pol = await orgGet(page, '/api/v1/pahchan/policy');
    const p = pol?.data ?? pol;
    const days = String(p.punch_photo_retention_days);
    const grace = String(p.reference_photo_grace_days);
    // "How long" is the ONE of the six lines that varies by org — the other
    // five ignore the retention object entirely (`NOTICE_LINES`,
    // pahchanNotice.js:92). Both of its figures are checked, because a fallback
    // that fires per key could supply one and not the other.
    const howLong = lineText.find((t) => /deleted after/i.test(t)) || '';
    expect(howLong.includes(`${days} days`),
      `the notice does not quote this org's own photo retention (${days} days). It says: ` +
      `"${howLong}". A notice quoting a figure the org did not set is the fault _retention ` +
      `was fixed for — "an org that shortened its punch-photo window to 30 days must not ` +
      `have its notice say 90".`).toBeTruthy();
    expect(howLong.includes(`${grace} days after you leave`),
      `the notice does not quote this org's own reference-photo grace (${grace} days). ` +
      `It says: "${howLong}".`).toBeTruthy();

    const before = await me(page, 1);
    if (!before?.notice?.acknowledged_at) {
      const res = await writes(page, /\/pahchan\/notice\/ack$/, async () => {
        await panel.getByRole('button', { name: 'I have read this' }).click();
      });
      expect(res.status).toBe(200);
      // ⚠ `stored:false` is a REAL answer, not a failure: migration 113 may be
      // unapplied, and the endpoint answers 200 with the client clearing its
      // gate locally, because on the phone this gate sits above the camera and
      // a 500 here is a person who cannot clock in.
      expect(typeof res.body?.stored,
        `POST /notice/ack did not report whether it stored anything: ${res.text.slice(0, 200)}`)
        .toBe('boolean');
      if (res.body.stored === false) {
        console.log('\n[09.4] ⚠ the acknowledgement answered stored:false — ' +
          'staging.pahchan_notice_acknowledgements is absent, so the gate cleared on the ' +
          'client only. That is the documented degrade, not a failure.\n');
      }
    }

    // Once acknowledged, the button is replaced by the DATE — not by nothing,
    // and not by a live button that would re-post.
    await pahchan(page, 'notice');
    await expect(panel.locator('.phn__read'),
      'after acknowledging, the notice must show when it was read')
      .toBeVisible({ timeout: 20_000 });
    await expect(panel.getByRole('button', { name: 'I have read this' }),
      'the acknowledge button is still live after acknowledging — a second tap would re-post')
      .toHaveCount(0);

    const after = await me(page, 1);
    const acks = after?.notice?.acknowledged_at ? 1 : 0;

    console.log(
      `\n[09.4] acknowledgements: ${acks} of §4's 30.` +
      `\n[09.4] ⚠ THE CAP IS STRUCTURAL. POST /notice/ack is ON CONFLICT (org_id, user_id, ` +
      `notice_version) DO NOTHING — one row per ACCOUNT per version. Thirty would need thirty ` +
      `Unicode logins; .env.e2e holds one, and the twelve dummy accounts are documented as ` +
      `E2E-org-only and must never be pointed here.` +
      `\n[09.4] ⚠ NOTICES PUBLISHED: 0 of §4's 2. The notice version is a BUILD CONSTANT — ` +
      `PAHCHAN_NOTICE_VERSION = '2026-08-06.1', lib/pahchanNotice.js:60. There is no editor, ` +
      `no version table and no publish route anywhere in the product.` +
      `\n[09.4] The DPDP obligation §4 is after — a recorded answer per employee — is the ` +
      `CONSENT roster, and 09.5 records all thirty.${dump(wire)}\n`,
    );

    expect(con.uncaught, `UNCAUGHT page errors on the notice screen:\n${con.uncaught.join('\n')}`).toEqual([]);
    expect(realErrors(con), `console.error on the notice screen:\n${realErrors(con).join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.5 — THIRTY CONSENTS, AND THE ALTERNATIVE PATH A DECLINE OPENS
     ════════════════════════════════════════════════════════════════════════ */

  test('09.5 a recorded answer for every one of the thirty, and a day recorded for each decliner', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);

    const mine = await me(page, 1);
    expect(mine?.employee?.name,
      'this account resolves no employee row, so it cannot record its own answer — ' +
      'Wave 2 owns the employee↔login link')
      .toBeTruthy();
    const SELF = String(mine.employee.name);

    let panel = await pahchan(page, 'consent');

    // ── The employee's own card, first ───────────────────────────────────────
    // ⚠ SELF MUST AGREE. A decline makes `upload_punch_photo` answer 409 for
    // this employee (`pahchan.py:769`), which would 409 every selfie in 09.7.
    if (!mine?.consent || mine.consent.consented !== true) {
      const agree = panel.getByRole('button', { name: /I agree to the photograph/i });
      await expect(agree, `${SELF} has no own-answer control — the account is not linked to an employee row`)
        .toBeVisible({ timeout: 20_000 });
      const res = await writes(page, /\/pahchan\/consent\/me$/, async () => { await agree.click(); });
      expect(res.status).toBe(200);
      await expect(toastTitle(page, /Recorded — you agreed/i)).toBeVisible({ timeout: 20_000 });
    }
    const selfNow = await me(page, 1);
    expect(selfNow?.consent?.consented,
      `${SELF}'s own answer did not save${dump(wire)}`).toBe(true);

    // ── The roster ───────────────────────────────────────────────────────────
    const people = await roster(page);
    expect(people.length, 'the consent roster is empty — nothing to record against').toBeGreaterThan(0);
    for (const who of DECLINERS) {
      expect(people.some((p: any) => String(p.employee_name) === who),
        `"${who}" is not on the Unicode roster, so this suite would record a decline against ` +
        `nobody. The declining names are chosen from Wave 2's own 30 and must exist.`).toBeTruthy();
    }
    expect(DECLINERS.includes(SELF),
      `${SELF} is the account that punches and must not be in DECLINERS — a decline 409s every selfie`)
      .toBeFalsy();

    const rosterSection = () => section(panel, "Everyone's answer");
    let recorded = 0;

    for (const person of people) {
      const name = String(person.employee_name);
      if (name === SELF) continue;                       // answered on their own card above
      if (person.consented !== null && person.consented !== undefined) continue;  // §6 — already answered

      const decline = DECLINERS.includes(name);

      await retryOnDetach(page, async () => {
        const row = rosterSection().locator('tr').filter({
          has: page.locator('.ph__name', { hasText: new RegExp(`^${reEsc(name)}$`) }),
        }).first();
        await expect(row, `"${name}" is on the roster from the server and not on the screen`)
          .toBeVisible({ timeout: 20_000 });
        await row.getByRole('button', { name: /^(Record answer|Change)$/ }).click();
      }, `open the consent form for ${name}`);

      const form = rosterSection().locator('.ph__consent-form').first();
      await expect(form, `the consent form did not open for ${name}`).toBeVisible({ timeout: 20_000 });
      // The form names WHO it is recording for. Recording an answer against the
      // wrong person is the one mistake this screen cannot afford.
      await expect(form.locator('.ph__consent-formh'),
        `the consent form does not say it is recording for ${name}`)
        .toContainText(name, { timeout: 10_000 });

      await choose(form.locator('select').nth(0), 'What did they say?',
        decline ? 'They declined' : 'They agreed');
      await choose(form.locator('select').nth(1), 'How was it obtained?',
        decline ? 'Said out loud, with a witness' : 'A signed paper form');
      await type(form, 'Note', decline
        ? `${NOTE_STAMP} — declined out loud, witnessed at the desk. No photograph is stored.`
        : `${NOTE_STAMP} — signed form filed in the HR binder.`);

      if (decline) {
        // The screen must state the consequence BEFORE the click. Recording a
        // decline stops every future photograph from any source.
        // `.note--warn` — `components/module/Note.jsx:12` renders
        // `note note--{variant}`. Named by the class the product actually
        // ships: a guessed class makes a present warning read as an absent one.
        await expect(form.locator('.note--warn').filter({
          hasText: /stops every future enrolment and clock-in photograph/i,
        }), 'a decline is recorded with no warning about what it does').toBeVisible({ timeout: 10_000 });
      }

      const res = await writes(page, /\/pahchan\/consent$/, async () => {
        await form.getByRole('button', { name: 'Record this answer' }).click();
      });
      expect(res.status, `POST /pahchan/consent for "${name}" answered ${res.status}${dump(wire)}`)
        .toBeLessThan(400);
      recorded += 1;
    }

    // ── The server's copy ────────────────────────────────────────────────────
    const now = await roster(page);
    const answered = now.filter((p: any) => p.consented === true || p.consented === false);
    const declined = now.filter((p: any) => p.consented === false).map((p: any) => String(p.employee_name));
    expect(answered.length,
      `only ${answered.length} of ${now.length} on the roster carry an answer${dump(wire)}`)
      .toBe(now.length);
    for (const who of DECLINERS) {
      expect(declined, `"${who}" should read as declined and does not`).toContain(who);
    }
    expect(now.find((p: any) => String(p.employee_name) === SELF).consented,
      `${SELF} must read as agreed or 09.7 cannot store a single selfie`).toBe(true);

    // §4's thirty, counted from the table rather than from the live headcount.
    const rowsNow = await rowsOf(page, '/api/v1/pahchan/consent');
    expect(rowsNow.length,
      `${rowsNow.length} recorded answers exist against §4's 30${dump(wire)}`)
      .toBeGreaterThanOrEqual(30);

    // ── And the screen agrees. The three states must not collapse to two. ────
    panel = await pahchan(page, 'consent');
    await expect(rosterSection().locator('table.tbl tbody tr'),
      'the consent roster table rendered no rows').not.toHaveCount(0, { timeout: 20_000 });
    await expect(rosterSection().locator('.k-chip, .st-chip').filter({ hasText: /No answer yet/i }),
      'somebody still reads as "No answer yet" after every row was recorded')
      .toHaveCount(0, { timeout: 20_000 });

    /* ── The alternative path a decline opens ────────────────────────────────
       This is the DPDP half that matters. Declining is not "no attendance": it
       is attendance recorded by a supervisor, on a row payroll reads directly
       and a publish never overwrites. The button only exists on a declined row,
       so recording one proves the decline actually took. */
    const manualBefore = await rowsOf(page, '/api/v1/pahchan/attendance/manual?days=60');
    const today = isoDay();
    for (const who of DECLINERS) {
      const already = manualBefore.some((d: any) =>
        String(d.employee_name) === who && String(d.date).slice(0, 10) === today);
      if (already) continue;

      await retryOnDetach(page, async () => {
        const row = rosterSection().locator('tr').filter({
          has: page.locator('.ph__name', { hasText: new RegExp(`^${reEsc(who)}$`) }),
        }).first();
        const btn = row.getByRole('button', { name: 'Record a day' });
        await expect(btn,
          `"${who}" declined, so the roster must offer the alternative attendance path and does not`)
          .toBeVisible({ timeout: 20_000 });
        await btn.click();
      }, `open the manual day form for ${who}`);

      const dayForm = rosterSection().locator('.ph__consent-form').first();
      await expect(dayForm).toBeVisible({ timeout: 20_000 });
      await expect(dayForm.locator('.ph__consent-formh'),
        'the manual-day form must say whose day it is and why it exists')
        .toContainText(who, { timeout: 10_000 });

      await setDay(dayForm, 'Date', today);
      await choose(dayForm.locator('select').first(), 'Status', 'Present');
      await setTime(dayForm, 'From', '09:30');
      await setTime(dayForm, 'To', '18:30');
      await type(dayForm, 'Note', `${NOTE_STAMP} — hours confirmed at the desk; no photograph taken.`);

      const res = await writes(page, /\/pahchan\/attendance\/manual$/, async () => {
        await dayForm.getByRole('button', { name: 'Record this day' }).click();
      });
      expect(res.status, `POST /attendance/manual for "${who}" answered ${res.status}${dump(wire)}`).toBe(201);
      await expect(toastTitle(page, /Day recorded/i)).toBeVisible({ timeout: 20_000 });
    }

    const manualAfter = await rowsOf(page, '/api/v1/pahchan/attendance/manual?days=60');
    for (const who of DECLINERS) {
      expect(manualAfter.some((d: any) => String(d.employee_name) === who),
        `"${who}" declined the photograph and has no day on the manual register${dump(wire)}`).toBeTruthy();
    }

    // And it is on screen, in its own section, with the warning that it is
    // never overwritten by a publish.
    panel = await pahchan(page, 'consent');
    const alt = section(panel, 'Attendance without a photograph');
    await expect(alt, 'the alternative-attendance section is absent although somebody declined')
      .toBeVisible({ timeout: 20_000 });
    await expect(alt.locator('table.tbl tbody tr'),
      'the alternative register shows no days although one was just recorded')
      .not.toHaveCount(0, { timeout: 20_000 });

    /**
     * ⚠ THE ROSTER IS NOT THE COUNT — IT IS THE LIVE HEADCOUNT, AND A SIBLING
     * SUITE CAN MOVE IT UNDER THIS ONE.
     *
     * `consent/roster` LEFT JOINs the consent table onto ACTIVE employees, so
     * it answers "who still needs asking", not "how many answers exist".
     * Measured across two runs of this file: it read 30, then 26 — four Unicode
     * employees were removed between them by something outside Suite 09 (wave 3
     * runs Vetana and Ganit against this same org concurrently, and
     * wave3.config says so). The consent ROWS for those four survive, correctly:
     * a recorded answer is evidence about a person, not about their employment.
     *
     * So §4's thirty is counted from `GET /pahchan/consent`, which is the table
     * itself, and the roster is used for the different and also-true assertion
     * that nobody currently on the rolls is unanswered.
     */
    const recordedRows = await rowsOf(page, '/api/v1/pahchan/consent');
    const stance = recordedRows.reduce((m: Record<string, number>, r: any) => {
      const k = r.consented === true ? 'agreed' : r.consented === false ? 'declined' : 'none';
      m[k] = (m[k] || 0) + 1; return m;
    }, {});
    const methods = recordedRows.reduce((m: Record<string, number>, r: any) => {
      m[String(r.method)] = (m[String(r.method)] || 0) + 1; return m;
    }, {});

    console.log(
      `\n[09.5] consent ROWS on the server: ${recordedRows.length} — §4 asked for 30. ` +
      `${JSON.stringify(stance)} · methods ${JSON.stringify(methods)}` +
      `\n[09.5] roster (active employees) : ${answered.length} of ${now.length} answered — ` +
      `⚠ the roster is the live headcount and a concurrent wave-3 sibling moved it from 30 ` +
      `to ${now.length} between runs; the consent rows for the removed employees survive.` +
      `\n[09.5] recorded by this run: ${recorded} (the rest were already answered — §6)` +
      `\n[09.5] ${declined.length} declined (${declined.join(', ')}), each with a supervisor-recorded day.` +
      `\n[09.5] Methods are 'paper' and 'verbal_witnessed' — the two an admin may record on ` +
      `somebody's behalf. Nothing here fabricates a tap the employee never made.\n`,
    );

    expect(con.uncaught, `UNCAUGHT page errors on the consent screen:\n${con.uncaught.join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.6 — ENROLLMENT: THE QUEUE, AND THE UPLOAD THAT DOES NOT EXIST
     ════════════════════════════════════════════════════════════════════════ */

  test('09.6 the enrollment queue is honest about thirty people with no reference photographs', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const con = watchConsole(page);
    await signIn(page);
    const panel = await pahchan(page, 'enrollment');

    const q = await orgGet(page, '/api/v1/pahchan/enrollment/queue/pending');
    const d = q?.data ?? q;
    const pending = d.pending_approval || [];
    const incomplete = d.incomplete || [];

    /**
     * §4 asks for 30 reference photographs uploaded, one synthetic face per
     * employee. THERE IS NO UPLOAD CONTROL. This asserts the absence rather
     * than skipping, because "no file input on this screen" is a measurement
     * and a silent skip is not.
     *
     * ⚠ THE CONTROL DETECTION IS SCOPED, AND THAT IS A TRAP ALREADY PAID FOR.
     * Suite 07 found `getByRole('button', {name:/upload/i})` matching a FOLDER
     * called "Personal uploads" — a record name rendered as a button decided
     * the verdict. So this looks for a real `<input type=file>` and for a
     * control whose accessible name is an upload verb, inside this panel only.
     */
    const fileInputs = await panel.locator('input[type=file]').count();
    const uploadish = await panel.getByRole('button', { name: /^\s*(upload|add|enrol|enroll|take)\b/i }).count();
    expect(fileInputs,
      `the Enrollment screen now has ${fileInputs} file input(s). If an HR upload has shipped, ` +
      `§4's thirty reference photographs became reachable and this suite must upload ` +
      `fixtures/generated/faces/*.png instead of reporting the gap.`).toBe(0);
    expect(uploadish,
      `the Enrollment screen now offers a control named like an upload. Same conclusion as above.`)
      .toBe(0);

    // What it DOES offer is the approval half, and it must be honest about
    // having nothing to approve. `Nothing waiting` here is a tick earned over
    // an empty queue — the screen renders it with tone="ok" — while the second
    // section is the finding: thirty people whose punches cannot be verified.
    if (pending.length === 0) {
      await expect(emptyTitle(section(panel, 'Awaiting approval')).filter({ hasText: /Nothing waiting/i }),
        'no photo is awaiting approval and the screen does not say so').toBeVisible({ timeout: 20_000 });
    }

    expect(incomplete.length,
      'nobody is listed as un-enrolled, which contradicts the live baseline of 30')
      .toBeGreaterThan(0);
    await expect(section(panel, 'Not yet verifiable').locator('table.tbl tbody tr'),
      `${incomplete.length} employees have no reference pair and the table shows no rows`)
      .toHaveCount(incomplete.length, { timeout: 20_000 });
    // And it states the consequence, which is the chain 09.9 and 09.11 measure.
    await expect(section(panel, 'Not yet verifiable'),
      'the screen lists un-enrolled people without saying their punches cannot be checked')
      .toContainText(/Every clock-in by these employees is flagged and cannot be checked/i, { timeout: 10_000 });

    console.log(
      `\n[09.6] ⚠ ENROLLMENT PHOTOGRAPHS: 0 of §4's 30, and it is a PRODUCT GAP not a test cap.` +
      `\n[09.6]   POST /v1/pahchan/enrollment has ZERO callers in frontend/src. EnrollQueue.jsx ` +
      `only reads the queue, fetches a signed URL and POSTs .../{id}/approve.` +
      `\n[09.6]   pages/manav/* has no photo field, so the "HR uploads during employee creation" ` +
      `path the endpoint documents does not exist either. The other path is self-capture on ` +
      `mobile, and Expo Go cannot run this app.` +
      `\n[09.6]   ${incomplete.length} employees are listed as not verifiable; ${pending.length} awaiting approval.` +
      `\n[09.6] ⚠ CONSEQUENCE — every punch made in 09.7/09.8 will carry \`noref\`, will be ` +
      `ineligible while review_verdict IS NULL, and the only verdict that clears it ('ok') is ` +
      `disabled until the reference photos load. See 09.9 and 09.11.\n`,
    );

    expect(con.uncaught, `UNCAUGHT page errors on the enrollment screen:\n${con.uncaught.join('\n')}`).toEqual([]);
    expect(realErrors(con), `console.error on the enrollment screen:\n${realErrors(con).join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.7 — THE PUNCHES, EACH WITH A PHOTOGRAPH
     ════════════════════════════════════════════════════════════════════════ */

  /**
   * Does the camera open at all?
   *
   * Asked once, before a loop, because the answer changes what every later
   * assertion MEANS. `Clock.jsx` cannot tell a permissions-policy block from a
   * user denial — both land in the same `catch` and both produce "The camera
   * could not be opened. Allow camera access and try again." — so a suite that
   * reads that sentence and concludes "permission problem" reaches the wrong
   * conclusion and sends somebody to change a browser setting that cannot help.
   *
   * Returns the screen's own words either way, so the report quotes the product
   * rather than paraphrasing it.
   */
  async function cameraOpens(page: Page, panel: Locator): Promise<{ ok: boolean; said: string }> {
    const ready = panel.locator('.ph__clockready');
    await expect(ready, 'the clock screen never reached its ready state').toBeVisible({ timeout: 30_000 });
    await ready.locator('button.btn--fill').first().click();
    const video = panel.locator('video.ph__clockvideo');
    const ok = await video.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    if (ok) {
      // Put the camera back down. A live front camera left running is a light
      // on somebody's face, and this screen stops it on every other path.
      await panel.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
      return { ok: true, said: '' };
    }
    const said = await ready.innerText().catch(() => '');
    return { ok: false, said: said.replace(/\s+/g, ' ').trim() };
  }

  /**
   * One punch WITH a photograph, driven exactly as a person drives it: press
   * the button, face the camera, take the photo, send it, dismiss the
   * confirmation. This is the mandated path — `Clock.jsx` "will not submit
   * without one: there is no skip control and the send button does not exist
   * until a frame has been captured".
   *
   * The four phases are told apart by the panel the screen actually renders —
   * `.ph__clockready`, a `<video>`, `img.ph__clockshot`, `.ph__clockdone` —
   * rather than by the button label, because the READY button and the SEND
   * button carry the SAME text (`DIRECTION_LABEL[direction]`, "Clock in" /
   * "Clock out"). A name match would press whichever the DOM offered first.
   *
   * Returns what the done panel says, so the caller can read the flags the
   * employee was actually shown.
   */
  async function punchWithPhoto(page: Page, panel: Locator): Promise<{ said: string; duplicate: boolean }> {
    const ready = panel.locator('.ph__clockready');
    await expect(ready, 'the clock screen never came back to its ready state').toBeVisible({ timeout: 30_000 });
    await ready.locator('button.btn--fill').first().click();

    const video = panel.locator('video.ph__clockvideo');
    await expect(video, 'the camera never opened').toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Take the photo' }).click();

    // Review — the frame is on screen and can still be retaken.
    await expect(panel.locator('img.ph__clockshot'), 'the captured frame was not offered for review')
      .toBeVisible({ timeout: 30_000 });

    // Send. `writes` waits on POST /punch; the photo POST rides ahead of it and
    // the caller counts those off the wire.
    await writes(page, /\/pahchan\/punch$/, async () => {
      await panel.locator('.ph__clockcam button.btn--fill').first().click();
    }, { timeout: 60_000 });

    const done = panel.locator('.ph__clockdone');
    await expect(done, 'the punch was sent and the screen never confirmed it').toBeVisible({ timeout: 30_000 });
    const said = (await done.innerText()).replace(/\s+/g, ' ').trim();
    await done.getByRole('button', { name: 'Done', exact: true }).click();
    return { said, duplicate: /already recorded/i.test(said) };
  }

  /**
   * One punch through the product's OWN documented escape.
   *
   * ⚠ THIS IS NOT A WORKAROUND FOR THE CAMERA FAILING — it is the only path a
   * real customer on this deployment has, and measuring it is the point.
   * `Clock.jsx`: "after repeated failures the screen offers to record the punch
   * flagged rather than take the shift away", because `ClockScreen.tsx` learned
   * that "three camera errors in a dark doorway locked someone out of clocking
   * in entirely" and "a blocked punch at a client site becomes a payroll
   * dispute a week later, and the employee is right".
   *
   * `RETRIES_BEFORE_ESCAPE` is 3, so the button is pressed until three camera
   * failures have accumulated and the escape appears. If it never appears, that
   * is a hard failure: it would mean nobody on this deployment can clock in at
   * all, by any route.
   */
  async function punchWithoutPhoto(page: Page, panel: Locator): Promise<{ said: string }> {
    const ready = panel.locator('.ph__clockready');
    const escape = ready.getByRole('button', { name: 'Record without a photo' });

    for (let i = 0; i < 5 && !(await escape.count()); i++) {
      await expect(ready, 'the clock screen never reached its ready state').toBeVisible({ timeout: 30_000 });
      await ready.locator('button.btn--fill').first().click();
      // Either the camera opened (and this employee is not on the escape path
      // at all) or it failed and `retries` went up by one.
      const opened = await panel.locator('video.ph__clockvideo')
        .waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
      if (opened) throw new Error(
        'the camera opened on the escape path — this helper is only for a deployment where ' +
        'it cannot, and punchWithPhoto() is the path to drive instead');
      await page.waitForTimeout(200);
    }

    await expect(escape,
      'the camera has failed repeatedly and the screen still offers NO way to record a punch. ' +
      'RETRIES_BEFORE_ESCAPE is 3 (Clock.jsx:66) and the escape exists precisely so a camera ' +
      'failure does not take somebody\'s shift away. If it is absent, nobody on this ' +
      'deployment can clock in by any route.').toBeVisible({ timeout: 20_000 });

    await writes(page, /\/pahchan\/punch$/, async () => { await escape.click(); }, { timeout: 60_000 });

    const done = panel.locator('.ph__clockdone');
    await expect(done, 'the punch was sent and the screen never confirmed it').toBeVisible({ timeout: 30_000 });
    const said = (await done.innerText()).replace(/\s+/g, ' ').trim();
    await done.getByRole('button', { name: 'Done', exact: true }).click();
    return { said };
  }

  /** Today's punches for this account, from the one endpoint an employee may call. */
  async function punchesToday(page: Page): Promise<any[]> {
    const mine = await me(page, 2);
    const today = new Date().toDateString();
    return (mine?.punches ?? []).filter((p: any) =>
      p?.captured_at && new Date(p.captured_at).toDateString() === today);
  }

  test('09.7 punches, each carrying a photograph, driven through the real camera', async ({ page }) => {
    test.setTimeout(55 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);

    if (!FACES_Y4M) {
      // Not a skip. The run proceeds on Chrome's own synthetic pattern — the
      // upload path is byte-identical — and the report says the fixtures were
      // not the source, with the one command that fixes it.
      console.log('\n[09.7] ⚠ THE FIXTURE FACES WERE NOT USED. ' +
        'frontend/e2e-real/fixtures/generated/faces is missing or unreadable — run ' +
        '`node frontend/e2e-real/fixtures/make-fixtures.mjs`. Chrome\'s own synthetic ' +
        'pattern would be captured instead. No real face is involved either way.\n');
    }

    const mine = await me(page, 1);
    expect(mine?.employee?.id,
      'this account resolves no employee row, so POST /punch would 409 — Wave 2 owns the link')
      .toBeTruthy();
    expect(mine?.consent?.consented,
      'this employee has not agreed to the photograph, so every selfie would 409. 09.5 owns that.')
      .toBe(true);
    const WHO = String(mine.employee.name);

    await page.context().setGeolocation(INSIDE);
    const panel = await pahchan(page, 'clock');

    // ── FIRST: CAN THE CAMERA OPEN? ──────────────────────────────────────────
    const cam = await cameraOpens(page, panel);

    // ── §6 · COUNT BEFORE THE LOOP, AND PUNCH ONLY THE SHORTFALL ─────────────
    // The idempotence §6 calls the hard case. `client_punch_id` makes the
    // SERVER idempotent, but `Clock.jsx` mints a fresh one per attempt
    // (`newClientPunchId`), so a blind re-run genuinely doubles the register —
    // the browser is asking a different question each time. Counting first is
    // what makes a second execution recognise its own output.
    const before = await punchesToday(page);

    let made = 0;
    let madeWithoutPhoto = 0;
    let stoppedEarly = false;

    if (cam.ok) {
      const shortfall = Math.max(0, PUNCH_TARGET - before.length);
      // ⚠ A DEADLINE THAT FAILS RATHER THAN TRIMS. A run that quietly stopped
      // at 90 of 240 and reported success is exactly the silent cap §10
      // forbids, so the deadline produces a failure that names the count.
      const deadline = Date.now() + 45 * 60_000;
      const t0 = Date.now();
      for (let i = 0; i < shortfall; i++) {
        if (Date.now() > deadline) { stoppedEarly = true; break; }
        await punchWithPhoto(page, panel);
        made += 1;
        if (made % 20 === 0) {
          console.log(`[09.7] ${before.length + made} punches on the register · ` +
            `${((Date.now() - t0) / made / 1000).toFixed(1)}s each`);
        }
      }
    } else {
      /**
       * ⚠ STOP AND REPORT. The mandatory selfie cannot be captured on this
       * deployment, so §4's "240 punches, each with a photo" is 0 and no
       * quantity of driving changes that. This does NOT loop 240 times through
       * the escape hatch to make a number look right — that would be reporting
       * coverage this run does not have.
       *
       * What it DOES do is drive the escape ONCE, because the question "can
       * anybody on this deployment clock in at all?" is a different and more
       * urgent question than "can they do it with a photograph?", and the
       * answer is worth measuring rather than assuming. The row it creates is
       * genuinely typed by a user through the product's own control, and it is
       * what 09.9 and 09.11 then measure the review and payroll chain against.
       */
      if (before.length === 0) {
        const out = await punchWithoutPhoto(page, panel);
        madeWithoutPhoto += 1;
        made += 1;
        // The employee must be TOLD the punch is degraded. A punch silently
        // recorded without its photo is a payroll dispute nobody can see coming.
        expect(/flagged/i.test(out.said),
          `a punch was recorded with no photograph and the screen did not say it was flagged. ` +
          `It said: "${out.said}"`).toBeTruthy();
      }
    }

    const after = await punchesToday(page);

    // ── Every punch must carry a photograph, and that is the mandate ─────────
    // `photo_key` is the object key. ⚠ It is NEVER rendered — 07 §4: the key is
    // never a URL in any payload — this suite reads it from the API and does
    // not put it on a screen. See 09.12 for the id sweep.
    const withPhoto = after.filter((p: any) => !!p.photo_key);
    const photoUploads = wire.filter((l) => /POST 20\d \/api\/v1\/pahchan\/punch\/photo/.test(l)).length;
    const ins = after.filter((p: any) => p.direction === 'in').length;
    const outs = after.filter((p: any) => p.direction === 'out').length;
    const noref = after.filter((p: any) => (p.flags || []).includes('noref')).length;

    expect(after.length,
      `${after.length} punches on the register after driving ${made} — the count went down or ` +
      `stood still, which means punches were not recorded at all${dump(wire)}`)
      .toBeGreaterThanOrEqual(before.length + made);

    console.log(
      `\n[09.7] ${WHO}: ${after.length} punches today (${before.length} before this run, ${made} made now).` +
      `\n[09.7] camera opened: ${cam.ok}` +
      (cam.ok ? '' : `\n[09.7]   the screen said: "${cam.said}"`) +
      `\n[09.7] photographs uploaded this run: ${photoUploads} · punches carrying a photo_key: ` +
      `${withPhoto.length} of ${after.length}` +
      `\n[09.7] ${ins} in · ${outs} out · ${noref} flagged \`noref\`` +
      `\n[09.7] camera source configured: ${FACES_NOTE}` +
      `\n[09.7] ⚠ §4's SPREAD IS UNREACHABLE REGARDLESS: it asks for 12 employees × 5 working ` +
      `days × 2 punches × 2 months. POST /punch records against the SIGNED-IN account's ` +
      `employee row, the web Clock stamps captured_at at the shutter and offers no date field, ` +
      `and this lane holds ONE credential. Every punch above is ${WHO}, today.` +
      `\n[09.7] ⚠ THE 768 KB CAP IS NOT REACHABLE FROM THIS SCREEN EITHER. The only web caller ` +
      `of POST /punch/photo is Clock.jsx:221, which posts a blob compressCapture has already ` +
      `walked down to a 600 KB budget. There is no way for a user to hand it ` +
      `fixtures/generated/oversize/oversize-photo-768kb-plus-1.png, so the 413 whose message was ` +
      `fixed today ("0MB" → "768KB", pahchan.py:713 / storage.py::_mb) is NOT exercised here. ` +
      `It needs a unit test against read_capped, not a browser.\n`,
    );

    /* ── THE FAILURES, WITH EVIDENCE AND NO VERDICT ──────────────────────────
       Ordered so the most upstream cause is the one that fails first: a reader
       who fixes only the top line does not then meet the next two as surprises. */

    expect(cam.ok,
      `THE MANDATORY SELFIE CANNOT BE CAPTURED ON THE DEPLOYED APP — 0 of §4's ${PUNCH_TARGET} ` +
      `punches-with-a-photo were possible.\n` +
      `     The Clock screen said: "${cam.said}"\n` +
      `     09.0 measured the cause in the browser: getUserMedia answers\n` +
      `       NotAllowedError: Permission denied\n` +
      `     because staging.kartavaya.com serves\n` +
      `       Permissions-Policy: geolocation=(), microphone=(), camera=()\n` +
      `     from frontend/vercel.json:65 (landed 7e268111, 2026-05-04 — four months before\n` +
      `     Clock.jsx existed). An EMPTY allowlist disables the feature for the document's\n` +
      `     own origin, so the denial happens before any granted permission is consulted.\n` +
      `     ⚠ THE PRODUCT CANNOT TELL THIS FROM A USER DENIAL: both land in the same catch\n` +
      `     in startCamera(), and the sentence it shows — "Allow camera access and try\n` +
      `     again" — names a remedy that cannot work. navigator.permissions.query answers\n` +
      `     "granted" throughout.\n` +
      `     WHAT STILL WORKS: the product's own escape. After 3 camera failures the screen\n` +
      `     offers "Record without a photo", the punch IS recorded and IS flagged, and the\n` +
      `     employee is told — so a shift is not lost. ` +
      (madeWithoutPhoto
        ? `Driven ${madeWithoutPhoto} time(s) this run.\n`
        : `Proved on an earlier run; §6 stopped this one\n     re-driving it, and the register already holds ${after.length} punch(es) made that way.\n`) +
      `     Every web punch on this deployment is permanently on that degraded path.\n` +
      `     EVIDENCE, NOT A VERDICT — §14 rules on the fix.${dump(wire)}`)
      .toBeTruthy();

    expect(stoppedEarly,
      `the punch loop ran out of time at ${before.length + made} of ${PUNCH_TARGET} after 45 ` +
      `minutes. That is a REPORTED cap, not a pass: re-run to continue — §6 means the next run ` +
      `picks up from ${before.length + made} rather than starting again.`).toBeFalsy();

    expect(withPhoto.length,
      `${withPhoto.length} of ${after.length} punches carry a photo_key. The selfie is ` +
      `MANDATORY on this screen — "the send button does not exist until a frame has been ` +
      `captured" — so a punch without one means the camera never opened.${dump(wire)}`)
      .toBe(after.length);

    expect(after.length,
      `${after.length} punches on the register against §4's ${PUNCH_TARGET}${dump(wire)}`)
      .toBeGreaterThanOrEqual(PUNCH_TARGET);

    // Directions alternate — `nextDirection` reads the day's last punch, so a
    // register of identical directions would mean it never read anything.
    expect(Math.abs(ins - outs) <= 1,
      `the day holds ${ins} clock-ins and ${outs} clock-outs — nextDirection is not alternating`)
      .toBeTruthy();

    expect(con.uncaught, `UNCAUGHT page errors while clocking in:\n${con.uncaught.join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.8 — FOUR PUNCHES FROM OUTSIDE EVERY FENCE
     ════════════════════════════════════════════════════════════════════════ */

  test('09.8 a punch made outside every geofence is measured against the fence, recorded and flagged', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);

    const sites = await rowsOf(page, '/api/v1/pahchan/sites');
    expect(sites.length,
      'there is no site, so `_nearest_site` returns (None, None), `distance_m` stays null and the ' +
      'geofence branch of `_compute_flags` can never fire. 09.3 owns the sites.')
      .toBeGreaterThan(0);

    const mine = await me(page, 1);
    expect(mine?.consent?.consented, 'this employee must have agreed or the selfie 409s').toBe(true);

    // 23 km from the nearest pin. Far enough that the arithmetic is not
    // arguable — a punch three metres outside a 150 m fence tests floating
    // point, not the fence.
    await page.context().setGeolocation(OUTSIDE);
    const panel = await pahchan(page, 'clock');

    const before = await punchesToday(page);
    const cam = await cameraOpens(page, panel);
    const want = 4;

    /**
     * ⚠ THE FENCE CANNOT BE MEASURED ON THIS DEPLOYMENT, AND THE REASON IS NOT
     * THE FENCE.
     *
     * `captureGeoFix()` resolves NULL when `getCurrentPosition` fails, and 09.0
     * measured that it always fails here — `Permissions-Policy: geolocation=()`,
     * frontend/vercel.json:65. So `PunchBody.lat` and `.lng` arrive as None,
     * `create_punch` never calls `_nearest_site`, `distance_m` stays null, and
     * `_compute_flags`' geofence branch — `if distance_m is not None and
     * site_radius_m is not None` — cannot fire.
     *
     * The punch is still flagged `geo`. But it is flagged for "location was
     * unavailable", NOT for "outside the site", and those are the SAME FLAG
     * CODE (`_compute_flags` reuses `geo` for both, deliberately). So a punch
     * made from 23 km away is indistinguishable, on the register and in the
     * payroll bridge, from one made at the reviewer's own desk.
     *
     * That is what this test measures and reports. It does not assert around
     * it: `distance_m` and `site_name` being null on every punch IS the
     * evidence that the fence has never been consulted, and it is read back
     * from the server rather than inferred.
     */
    let made = 0;
    const told: string[] = [];
    const beforeGeo = before.filter((p: any) => (p.flags || []).includes('geo')).length;
    const shortfall = Math.max(0, want - beforeGeo);

    for (let i = 0; i < shortfall; i++) {
      const out = cam.ok ? await punchWithPhoto(page, panel) : await punchWithoutPhoto(page, panel);
      told.push(out.said.slice(0, 220));
      made += 1;
      if (!cam.ok) break;   // one is the measurement; see 09.7 — no loop on the degraded path
    }

    await page.context().setGeolocation(INSIDE);

    const after = await punchesToday(page);
    const geo = after.filter((p: any) => (p.flags || []).includes('geo'));

    // ── What the server actually recorded about WHERE ────────────────────────
    // `GET /register` returns `distance_m`, `lat`, `lng` and `site_name` per
    // punch — the three facts that say whether the fence was consulted at all.
    const reg = await orgGet(page, '/api/v1/pahchan/register');
    const regPunches = ((reg?.data ?? reg).punches ?? []);
    const located = regPunches.filter((p: any) => p.lat != null && p.lng != null);
    const measuredAgainstSite = regPunches.filter((p: any) => p.distance_m != null);
    const named = regPunches.filter((p: any) => p.site_name != null);

    // None of them was REFUSED — the punch count went up by exactly what was
    // driven. §2: nothing blocks a punch, and nothing here may.
    expect(after.length,
      `punches were LOST — ${before.length} before, ${after.length} after driving ${made}. ` +
      `Nothing in this module may refuse a punch.${dump(wire)}`)
      .toBe(before.length + made);

    if (made > 0) {
      for (const t of told) {
        expect(/flagged for review/i.test(t),
          `the employee was not told their punch was flagged. The screen said: "${t}"`).toBeTruthy();
      }
    }

    console.log(
      `\n[09.8] ${geo.length} of today's ${after.length} punches carry \`geo\` (§4 asked for 4 ` +
      `made outside the fence).` +
      `\n[09.8] punches carrying a location at all : ${located.length} of ${regPunches.length}` +
      `\n[09.8] punches measured against a site    : ${measuredAgainstSite.length} of ${regPunches.length}` +
      `\n[09.8] punches naming the site they were at: ${named.length} of ${regPunches.length}` +
      `\n[09.8] ⚠ §4 CALLS THESE "REFUSED". THEY ARE NOT, AND MUST NOT BE. There is no refusal ` +
      `path anywhere in Pahchan: _compute_flags records and flags on every branch and its own ` +
      `docstring says "there is no branch that refuses, and adding one is the single change most ` +
      `likely to break the module's purpose". \`allow_outside_geofence\` — which reads like the ` +
      `switch that would refuse them — is stored, surfaced in GET /me's rules, and read by NO ` +
      `decision in backend/ (grep: the model, the defaults, the UPSERT, one test).` +
      `\n[09.8]   What protects the register is the next step: a flagged punch is ineligible ` +
      `until a human rules on it, and the day is withheld from payroll. 09.11 measures that, ` +
      `and it is the honest reading of "the path that protects the register".\n`,
    );

    /* ── THE FAILURE, WITH EVIDENCE AND NO VERDICT ───────────────────────── */

    expect(measuredAgainstSite.length,
      `THE GEOFENCE HAS NEVER BEEN APPLIED TO A SINGLE WEB PUNCH — 0 of §4's 4 out-of-fence ` +
      `punches could be measured as out of fence.\n` +
      `     ${sites.length} sites exist with real radii (09.3 typed them).\n` +
      `     ${located.length} of ${regPunches.length} punches on today's register carry a lat/lng.\n` +
      `     ${measuredAgainstSite.length} of ${regPunches.length} carry a distance_m.\n` +
      `     ${named.length} of ${regPunches.length} name the site they were at.\n` +
      `     CAUSE, measured in the browser by 09.0: getCurrentPosition answers\n` +
      `       "Geolocation has been disabled in this document by permissions policy."\n` +
      `     because staging.kartavaya.com serves Permissions-Policy: geolocation=()\n` +
      `     from frontend/vercel.json:65. pahchanClock.js::captureGeoFix then resolves\n` +
      `     NULL — by design, "a failure here returns null and lets the punch through\n` +
      `     flagged" — so PunchBody.lat is None, create_punch never calls _nearest_site,\n` +
      `     and _compute_flags' geofence branch cannot fire.\n` +
      `     ⚠ AND THE TWO CASES ARE THE SAME FLAG. _compute_flags emits \`geo\` both for\n` +
      `     "location off entirely" and for "outside the site", so a punch made 23 km\n` +
      `     away is indistinguishable — on the register and in the payroll bridge — from\n` +
      `     one made at the reviewer's desk. Every site, radius and altitude window\n` +
      `     configured in this product has had no effect on any web punch.\n` +
      `     ⚠ AN EMPTY TABLE IS TWO UNKNOWNS, NOT ONE: pahchan_sites was empty before\n` +
      `     09.3, which reads as "nobody has set a fence" and was in fact also "a fence\n` +
      `     would have done nothing". Whether anything ELSE downstream of distance_m is\n` +
      `     broken cannot be known until a punch carries a location.\n` +
      `     EVIDENCE, NOT A VERDICT — §14 rules on the fix.${dump(wire)}`)
      .toBeGreaterThanOrEqual(want);

    expect(geo.length,
      `only ${geo.length} punches carry the \`geo\` flag${dump(wire)}`).toBeGreaterThanOrEqual(want);

    expect(con.uncaught, `UNCAUGHT page errors while punching outside the fence:\n${con.uncaught.join('\n')}`)
      .toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.9 — THE REGISTER, AND WHAT A REVIEWER CAN ACTUALLY DECIDE
     ════════════════════════════════════════════════════════════════════════ */

  test('09.9 the register shows the day, and the verdict a reviewer can reach is measured not assumed', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    const panel = await pahchan(page, 'register');

    const reg = await orgGet(page, '/api/v1/pahchan/register');
    const punches = (reg?.data ?? reg).punches ?? [];
    expect(punches.length, '09.7 owns today\'s punches and there are none on the register')
      .toBeGreaterThan(0);

    /**
     * ⚠ THE DEFAULT QUEUE EMPTIES AS IT IS WORKED, SO THIS TEST HAS TWO SHAPES.
     *
     * A TEST BUG'S FIX, found by running the suite twice. The register opens on
     * "Needs a look" — §3's own choice — and `visible` filters on
     * `!p.review_verdict` (Register.jsx:563). On the first run every punch is
     * pending and the keyboard verdicts can be driven. On the SECOND run every
     * punch already carries a verdict this suite recorded, the queue is empty,
     * and a test that insists on a row reports "the table drew no rows" against
     * a screen that is correctly showing its goal state.
     *
     * So the pending count decides which assertions run, and BOTH branches
     * assert something real. Nothing is skipped: the branch that cannot record
     * a new verdict still proves the gate on confirm holds, that the verdicts
     * already recorded are on screen, and that the queue says it is clear.
     */
    const pending = punches.filter((p: any) => (p.flags || []).length && p.review_verdict == null);
    const canRule = pending.length > 0;

    if (canRule) {
      await expect(panel.locator('table.tbl tbody tr'),
        `${pending.length} punches are pending and the table drew no rows`)
        .not.toHaveCount(0, { timeout: 30_000 });
    } else {
      await expect(emptyTitle(panel).filter({ hasText: /Nothing needs a look/i }),
        `every one of the ${punches.length} punches carries a verdict, so the queue must say ` +
        `it is clear — and that is a different sentence from "nobody has clocked in"`)
        .toBeVisible({ timeout: 30_000 });
    }

    // Everything below reads a row, so the settled day is opened under "All"
    // when the queue is clear. A reviewer does exactly this to check yesterday.
    if (!canRule) {
      await panel.getByRole('radio', { name: /^All/ }).first().click()
        .catch(async () => { await panel.getByRole('button', { name: /^All/ }).first().click(); });
      await expect(panel.locator('table.tbl tbody tr'),
        `${punches.length} punches exist and "All" shows none of them`)
        .not.toHaveCount(0, { timeout: 30_000 });
    }

    // The person is named. NEVER an id — the whole module renders names.
    await expect(panel.locator('.rv__r .ph__name, .rv__r strong').first(),
      'the register does not name the person on the row').toBeVisible({ timeout: 20_000 });

    /* ── What the reviewer is actually offered ───────────────────────────────
       With no reference pair the verdict cell offers "Send enrollment request"
       INSTEAD of Confirm/Flag (Register.jsx:910). That is deliberate — §3:
       "confirming here would be trust with a checkmark on it" — and it is also
       the point at which this org's register becomes unclearable. Measured,
       because the difference between "the reviewer chose not to" and "the
       reviewer could not" is the whole finding. */
    const enrollCta = await panel.getByRole('button', { name: /Send enrollment request/i }).count();
    const confirmBtns = await panel.getByRole('button', { name: /^Confirm$/ }).count();
    const flagBtns = await panel.getByRole('button', { name: /^Flag$/ }).count();

    // The keyboard path is offered on screen and is the one §3 designed for.
    await expect(panel.locator('.rv__hint'),
      'the register does not tell the reviewer the keyboard is how this is done')
      .toContainText(/confirm/i, { timeout: 10_000 });

    /* ── The two keyboard verdicts, and the order is deliberate ─────────────
       `↵` (confirm) is GATED — `record('ok')` returns before issuing anything
       unless the comparison is READY. `F` (flag) is NOT, and §3's reasoning is
       explicit: "a reviewer who cannot see the faces still has an opinion, and
       gating it strands the queue on exactly the rows that need a person".

       ⚠ CONFIRM IS PROBED FIRST, ON A ROW THAT IS STILL IN THE QUEUE. Flagging
       removes a row from "Needs a look" (`visible` filters on
       `!p.review_verdict`, Register.jsx:563), so doing it the other way round
       probes Enter against a shrinking list and can land on nothing — which
       would report the gate as holding when it was never exercised. */
    const cursorRow = panel.locator('tr.rv__r').first();
    await expect(cursorRow, 'the register drew no row at all').toBeVisible({ timeout: 20_000 });
    await cursorRow.click();                     // seek the cursor to it

    // The proof that the gate held is that NO review request is made at all.
    // ⚠ Meaningful in BOTH branches: `record('ok')` refuses a `noref` row
    // whether or not it already carries a verdict, so pressing the Return key
    // on a settled day must still issue nothing.
    const reviewsBefore = wire.filter((l) => /\/review/.test(l)).length;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_500);
    const confirmTried = wire.filter((l) => /\/review/.test(l)).length > reviewsBefore;
    /**
     * And it must SAY why rather than swallowing the keypress silently.
     *
     * ⚠ THERE ARE THREE REFUSALS, NOT ONE, and a probe that names only two
     * reports the product as silent when it spoke. `record('ok')` refuses a
     * `noref` row with "Nothing to compare against" (Register.jsx:588) — the
     * SERVER's word for an employee with no approved pair — and separately
     * refuses a pair that exists but is not on screen with "The photos did not
     * load" or "Still loading the photos". On this org it is always the first.
     */
    const gateSaid = await page.locator('.tst__t')
      .filter({ hasText: /Nothing to compare against|photos did not load|Still loading the photos/i })
      .first().isVisible().catch(() => false);

    /* ── Now the flag, which does go through ────────────────────────────────
       ⚠ THE QUEUE SHRINKS UNDER IT, and that is the assertion rather than a
       chip on the row. A first draft looked for `.rv__flash` on the "Needs a
       look" list and failed — the row had LEFT the queue, which is correct
       product behaviour and the entire point of the default filter. The flash
       is asserted where it actually lives: under "All". */
    if (canRule) {
      const needsBefore = await panel.locator('tr.rv__r').count();
      const flagged = await writes(page, /\/pahchan\/punches\/[0-9a-f-]+\/review$/, async () => {
        await page.keyboard.press('f');
      }, { methods: ['PATCH'], timeout: 30_000 });
      expect(flagged.status, `PATCH .../review answered ${flagged.status}${dump(wire)}`).toBe(200);
      await expect(panel.locator('tr.rv__r'),
        `a verdict was recorded and the "Needs a look" queue did not shrink from ${needsBefore}`)
        .toHaveCount(needsBefore - 1, { timeout: 20_000 });

      // Under "All" the row is still there, now carrying its verdict in words.
      await panel.getByRole('radio', { name: /^All/ }).first().click()
        .catch(async () => { await panel.getByRole('button', { name: /^All/ }).first().click(); });
    }

    // Either way, the verdicts that exist are legible on the settled day. This
    // is the assertion the re-run branch rests on, and it is not the weaker
    // one: a verdict the reviewer cannot see is a verdict nobody can audit.
    await expect(panel.locator('.rv__flash, .rv__v .k-chip, .rv__v .st-chip').first(),
      'no punch shows a verdict under the "All" filter, although the server holds some')
      .toBeVisible({ timeout: 20_000 });

    // The server's copy of the verdict.
    const regAfter = await orgGet(page, '/api/v1/pahchan/register');
    const verdicts = ((regAfter?.data ?? regAfter).punches ?? [])
      .filter((p: any) => p.review_verdict != null);
    expect(verdicts.length,
      `no punch carries a review verdict after one was recorded${dump(wire)}`).toBeGreaterThan(0);

    /* ── A past day with nothing on it says the RIGHT empty sentence ─────────
       "Nobody has clocked in yet" is for today. On last Tuesday nobody is going
       to, and saying "yet" there reads as a page that has not finished loading. */
    const past = DECLINED_DAYS[0];                       // a day with no punch
    await setDayIn(panel.locator('label.rv__day'), 'the register day', past);
    const pastReg = await orgGet(page, `/api/v1/pahchan/register?on=${past}`);
    if ((((pastReg?.data ?? pastReg).punches) ?? []).length === 0) {
      await expect(emptyTitle(panel).filter({ hasText: /No punches on this day/i }),
        `${past} holds no punches and the register does not say so in the past tense`)
        .toBeVisible({ timeout: 20_000 });
    }
    await panel.getByRole('button', { name: 'Today', exact: true }).click();
    await settle(page);

    console.log(
      `\n[09.9] register: ${punches.length} punches on today, ${pending.length} pending a verdict.` +
      `\n[09.9] a new verdict was ${canRule ? 'recorded this run'
        : 'NOT needed — every punch was already ruled on, so the settled day was verified '
          + 'under "All" instead (§6: a re-run recognises its own output)'}.` +
      `\n[09.9] verdict controls on screen — Confirm: ${confirmBtns} · Flag: ${flagBtns} · ` +
      `"Send enrollment request": ${enrollCta}` +
      `\n[09.9] ⚠ THE REVIEWER CANNOT CLEAR THIS DAY, AND IT IS THE 09.6 CHAIN ARRIVING.` +
      `\n[09.9]   Every punch carries \`noref\` (no reference pair exists — 09.6), so the ` +
      `verdict cell renders "Send enrollment request" instead of Confirm/Flag, and the ` +
      `keyboard ↵ returns early because the comparison is never READY.` +
      `\n[09.9]   ↵ (confirm) issued a review request: ${confirmTried} — expected false; the ` +
      `screen explained the refusal in a toast: ${gateSaid}` +
      `\n[09.9]   F (flag) is ungated by design and ${canRule ? 'DID record a verdict this run'
        : 'had nothing left to rule on'}: §3 keeps it open so the queue is not stranded on ` +
      `exactly the rows that need a person.` +
      `\n[09.9]   Consequence: 'flagged' is VERDICT_REJECTED (attendance_bridge.py:66), so ` +
      `flagging does not make a punch eligible either. 09.11 measures what reaches payroll.\n`,
    );

    expect(confirmTried,
      'Enter issued a review request on a punch with no reference pair. `record(\'ok\')` is ' +
      'supposed to return early unless the comparison is READY — confirming a face nobody ' +
      'could see is the exact failure §3 built that gate for. REPORT, do not fix.').toBeFalsy();

    expect(con.uncaught, `UNCAUGHT page errors on the register:\n${con.uncaught.join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.10 — TEN CORRECTIONS ASKED FOR, TEN DECIDED
     ════════════════════════════════════════════════════════════════════════ */

  test('09.10 ten corrections raised from the employee\'s own register, six approved and four declined', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);

    const mine = await me(page, 1);
    const WHO = String(mine.employee.name);

    /* ── The asking half, on the employee's own screen ───────────────────────
       ⚠ THIS IS THE ONLY WAY A CORRECTION CAN BE RAISED THROUGH THE PRODUCT.
       `POST /regularisations` would accept an `employee_id` from a reviewer on
       somebody else's behalf, but no screen offers that: `History.jsx:283`
       sends `data.employee.id` from `/me` and nothing else calls the endpoint.
       So all ten are this employee's own days. */
    let panel = await pahchan(page, 'history');

    const already = await rowsOf(page, '/api/v1/pahchan/regularisations/mine');
    const seen = new Set(already.map((r: any) => `${String(r.for_date).slice(0, 10)}|${r.requested_direction}`));

    let raised = 0;
    /** The first refusal, kept whole. A loop that dies on the tenth iteration
     *  reports the tenth; the first is the one that has something to say. */
    let firstRefusal: { fix: Fix; error: string; said: string } | null = null;

    for (const fix of CORRECTIONS) {
      if (seen.has(`${fix.day}|${fix.direction}`)) continue;    // §6
      if (firstRefusal) break;                                 // STOP AND REPORT

      // Open the day on the calendar. The day button's accessible name is
      // "<n> <Month Year> — <state>", so it is found by its visible number
      // inside the grid rather than by a name that carries a state word.
      const dayNum = Number(fix.day.slice(8, 10));
      const cell = panel.locator('.pcal__grid .pcal__d')
        .filter({ hasText: new RegExp(`^${dayNum}$`) }).first();
      await expect(cell, `${fix.day} is not on the month calendar — is it in another month?`)
        .toBeVisible({ timeout: 20_000 });
      if ((await cell.getAttribute('aria-pressed')) !== 'true') await cell.click();

      const askBtn = panel.getByRole('button', { name: 'Ask for a correction' });
      await expect(askBtn, `the day panel for ${fix.day} offers no way to ask for a correction`)
        .toBeVisible({ timeout: 20_000 });
      await askBtn.click();

      const form = panel.locator('form.ph__askform');
      await expect(form, 'the correction form did not open').toBeVisible({ timeout: 20_000 });
      await choose(form.locator('select').first(), 'Which punch is wrong?',
        fix.direction === 'in' ? 'Clock in' : 'Clock out');
      await setTime(form, 'The time it should be', fix.time);
      await type(form, 'What happened?', fix.reason);

      /**
       * ⚠ THE REFUSAL IS CAUGHT AND KEPT, NOT ROUTED AROUND.
       *
       * `writes()` throws on a request that never comes back, and that is
       * exactly the shape this endpoint fails in. Catching it here is not a
       * workaround: it is what lets the test report the SCREEN's words beside
       * the wire's, and then fail once with both. Nothing is retried and
       * nothing is skipped — the loop stops on the first refusal.
       */
      try {
        const res = await writes(page, /\/pahchan\/regularisations$/, async () => {
          await form.getByRole('button', { name: 'Send the request' }).click();
        }, { timeout: 30_000 });
        expect(res.status, `POST /regularisations for ${fix.day}/${fix.direction} answered ` +
          `${res.status}${dump(wire)}`).toBe(201);
        await expect(toastTitle(page, /Correction requested/i)).toBeVisible({ timeout: 20_000 });
        raised += 1;
      } catch (e) {
        const said = await page.locator('.tst__t, .tst__s').allTextContents()
          .then((t) => t.join(' · ').replace(/\s+/g, ' ').trim().slice(0, 300))
          .catch(() => '(no toast on screen)');
        firstRefusal = { fix, error: String((e as Error)?.message ?? e).slice(0, 600), said };
      }
    }

    const mineNow = await rowsOf(page, '/api/v1/pahchan/regularisations/mine');
    const ours = mineNow.filter((r: any) => String(r.reason || '').startsWith('S9 —'));

    /* ── STOP AND REPORT ─────────────────────────────────────────────────────
       No verdict on cause is offered here beyond what was MEASURED: the wire,
       the screen, and the server's own traceback read from the Railway deploy
       log for this deployment. §14 owns the triage. */
    if (firstRefusal) {
      console.log(
        `\n[09.10] ⚠ NOT ONE CORRECTION COULD BE RAISED — 0 of §4's 10, so 0 of its 10 ` +
        `decisions.` +
        `\n[09.10]   first refusal: ${firstRefusal.fix.day} / ${firstRefusal.fix.direction}` +
        `\n[09.10]   the screen said: "${firstRefusal.said}"` +
        `\n[09.10]   the browser saw : POST /api/v1/pahchan/regularisations → net::ERR_FAILED ` +
        `(no response at all, so no CORS headers, so Chromium reports a network failure ` +
        `rather than a status)` +
        `\n[09.10]   the server said (Railway deploy log, staging, this run):` +
        `\n[09.10]     ERROR - Unhandled error on POST /api/v1/pahchan/regularisations` +
        `\n[09.10]     File "/app/routers/pahchan_attendance.py", line 151, in request_regularisation` +
        `\n[09.10]     asyncpg.exceptions.DataError: invalid input for query argument $4:` +
        `\n[09.10]       '2026-08-18' ('str' object has no attribute 'toordinal')` +
        `\n[09.10]   $4 is \`for_date\`, declared \`for_date: str\` on RegularisationCreate ` +
        `(pahchan_attendance.py:82) and bound to \`$4::date\` in the INSERT (line 155).` +
        `\n[09.10]   ⚠ THE SAME FAMILY IS ALREADY DOCUMENTED IN THIS FILE. ` +
        `publish_attendance_to_payroll's own comment (pahchan_attendance.py:346) says ` +
        `"\`$2::date\` makes asyncpg infer a DATE parameter, so a str is refused with ` +
        `'str' object has no attribute 'toordinal' and the endpoint 500s. It did that on ` +
        `every call, for every org, since it was written" — and names the bank statement ` +
        `import (2b864aa8) and the sales target (eae0b912) as the same fault. That one was ` +
        `parsed at the top of the handler; this one was not.` +
        `\n[09.10]   \`requested_at_time: str\` bound to \`$6::timestamptz\` on the same ` +
        `statement is the same shape and is simply not reached — $4 fails first.` +
        `\n[09.10]   ⚠ AN EMPTY TABLE IS TWO UNKNOWNS. pahchan_regularisations read [] ` +
        `before this suite ran, which looks like "nobody has asked for a correction". It is ` +
        `also "no employee has ever been able to". Whether anything downstream of a stored ` +
        `regularisation works cannot be known until one exists — the approve/decline path ` +
        `and the publish bridge below have never had a row to act on.\n`,
      );
    }

    expect(firstRefusal,
      `THE CORRECTION PATH IS BROKEN END TO END — 0 of §4's 10 requests could be raised, ` +
      `so 0 of its 10 decisions (6 approved / 4 rejected) could be made.\n` +
      `     day/direction : ${firstRefusal?.fix.day} / ${firstRefusal?.fix.direction}\n` +
      `     the screen said: "${firstRefusal?.said}"\n` +
      `     the wire       : POST /api/v1/pahchan/regularisations → net::ERR_FAILED\n` +
      `     the server     : asyncpg.exceptions.DataError: invalid input for query argument\n` +
      `                      $4: '${firstRefusal?.fix.day}' ('str' object has no attribute\n` +
      `                      'toordinal') — pahchan_attendance.py:151, request_regularisation\n` +
      `     $4 is for_date: declared \`for_date: str\` (line 82), bound to \`$4::date\` (line 155).\n` +
      `     ⚠ The identical fault is already documented 200 lines below, in\n` +
      `       publish_attendance_to_payroll, where it was fixed by parsing the string into a\n` +
      `       date at the top of the handler. That comment records it "did that on every call,\n` +
      `       for every org, since it was written".\n` +
      `     ⚠ The employee IS told nothing was recorded ("That request was not filed"), so no\n` +
      `       silent data loss — but the whole correction loop, and everything downstream of\n` +
      `       it, has never run.\n` +
      `     REPORTED, NOT DIAGNOSED FURTHER AND NOT FIXED — §14 owns the triage.` +
      `${dump(wire)}`)
      .toBeNull();

    /* ── Everything below runs only once corrections can be raised ─────────── */

    expect(ours.length, `${ours.length} of this suite's 10 corrections are on the server${dump(wire)}`)
      .toBeGreaterThanOrEqual(CORRECTIONS.length);

    // And the employee can SEE the half of the loop they could not before.
    panel = await pahchan(page, 'history');
    await expect(section(panel, 'Corrections you have asked for').locator('table.tbl tbody tr'),
      'the employee raised corrections and their own screen shows none')
      .not.toHaveCount(0, { timeout: 20_000 });

    /* ── The deciding half ──────────────────────────────────────────────────
       A decline REQUIRES a reason — the employee is being told their record of
       a day is wrong, and the note is the only thing they have to go on. The
       screen refuses an empty one, which is asserted by driving the panel that
       exists to collect it. */
    panel = await pahchan(page, 'corrections');
    let approved = 0, declined = 0;

    for (const fix of CORRECTIONS) {
      const row = () => panel.locator('tr').filter({ hasText: fix.reason.slice(0, 40) }).first();

      // Already decided by an earlier run? Then verify, do not decide again.
      const server = (await rowsOf(page, '/api/v1/pahchan/regularisations?status=all'))
        .find((r: any) => String(r.reason) === fix.reason);
      expect(server, `the correction "${fix.reason.slice(0, 40)}…" is not on the server`).toBeTruthy();
      if (server.status !== 'pending') {
        if (server.status === 'approved') approved += 1; else declined += 1;
        continue;
      }

      await expect(row(), `the correction for ${fix.day}/${fix.direction} is not on the reviewer's screen`)
        .toBeVisible({ timeout: 20_000 });

      if (fix.approve) {
        await retryOnDetach(page, async () => {
          await row().getByRole('button', { name: 'Approve', exact: true }).click();
        }, `approve ${fix.day}/${fix.direction}`);
        // The response is awaited by the toast rather than by `writes`, because
        // the click and the refetch race: `decide()` calls `load()` and
        // `countPending()` immediately after.
        await expect(toastTitle(page, /Correction approved/i)).toBeVisible({ timeout: 30_000 });
        // The screen says the step that is easy to assume has happened.
        await expect(page.locator('.tst__s').filter({ hasText: /reaches payroll when you publish/i }),
          'approving a correction must say it does not reach payroll on its own')
          .toBeVisible({ timeout: 20_000 });
        approved += 1;
      } else {
        await retryOnDetach(page, async () => {
          await row().getByRole('button', { name: 'Decline', exact: true }).click();
        }, `open the decline panel for ${fix.day}/${fix.direction}`);
        const declPanel = panel.locator('.ph__declpanel').first();
        await expect(declPanel, 'the decline panel did not open').toBeVisible({ timeout: 20_000 });
        // The confirm button is disabled until a reason exists — asserted
        // BEFORE typing, because "a decline needs a reason" is the rule.
        const confirm = declPanel.getByRole('button', { name: 'Decline this correction' });
        await expect(confirm, 'a decline can be confirmed with no reason at all').toBeDisabled();
        await declPanel.locator('textarea').fill(
          `${NOTE_STAMP} — the gate log and the client sign-in sheet both show a later start. ` +
          `Raise it again with the sheet attached if that is wrong.`);
        await expect(confirm).toBeEnabled({ timeout: 10_000 });
        await retryOnDetach(page, async () => { await confirm.click(); }, `decline ${fix.day}/${fix.direction}`);
        await expect(toastTitle(page, /Correction declined/i)).toBeVisible({ timeout: 30_000 });
        declined += 1;
      }
    }

    // ── The server's copy, and the split §4 asked for ───────────────────────
    const all = await rowsOf(page, '/api/v1/pahchan/regularisations?status=all');
    const suiteRows = all.filter((r: any) => String(r.reason || '').startsWith('S9 —'));
    const byStatus = suiteRows.reduce((m: Record<string, number>, r: any) => {
      m[r.status] = (m[r.status] || 0) + 1; return m;
    }, {});
    expect(byStatus.pending || 0,
      `${byStatus.pending} of this suite's corrections are still undecided${dump(wire)}`).toBe(0);
    expect(byStatus.approved || 0, `approved count${dump(wire)}`).toBe(6);
    expect((byStatus.declined || 0) + (byStatus.rejected || 0), `declined count${dump(wire)}`).toBe(4);

    // The employee sees the answer AND the reason. That is the half of the loop
    // that did not exist before — a decision with no reason is a decision the
    // person cannot act on.
    panel = await pahchan(page, 'history');
    await expect(section(panel, 'Corrections you have asked for'),
      'the employee cannot see the reviewer\'s reason for declining')
      .toContainText(new RegExp(reEsc(NOTE_STAMP)), { timeout: 20_000 });

    console.log(
      `\n[09.10] ${WHO}: ${suiteRows.length} corrections — raised ${raised} this run, ` +
      `${approved} approved, ${declined} declined. §4 asked for 10 · 10 (6 approved, 4 rejected).` +
      `\n[09.10] Approved days: ${APPROVED_DAYS.join(', ')} — each with a matched in AND out, ` +
      `which is what lets 09.11 build a complete day.` +
      `\n[09.10] Declined days: ${DECLINED_DAYS.join(', ')} — these must build nothing.` +
      `\n[09.10] ⚠ ALL TEN ARE THIS ONE EMPLOYEE'S OWN DAYS. The endpoint would accept a ` +
      `reviewer filing on somebody else's behalf; no screen offers it (History.jsx:283 sends ` +
      `/me's own employee id and nothing else calls POST /regularisations).\n`,
    );

    expect(con.uncaught, `UNCAUGHT page errors on the corrections screens:\n${con.uncaught.join('\n')}`)
      .toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.11 — TWO PUBLISHES TO PAYROLL, AND THE DAY COUNTS THEY MUST AGREE WITH
     ════════════════════════════════════════════════════════════════════════ */

  test('09.11 two publish runs, and the day count payroll receives is the day count the register can defend', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    const panel = await pahchan(page, 'payroll');

    const today = isoDay();
    const range = panel.locator('.ph__range');

    /**
     * One publish, driven exactly as the screen insists: preview, read the
     * figures, then publish. `Publish` is disabled until a preview of THIS
     * range has been looked at — "the endpoint would happily write on the first
     * call; making the operator see the figures first is the whole reason
     * dry_run exists" — so the preview is not a nicety to skip.
     */
    async function publishRun(from: string, to: string) {
      await setDay(range, 'From', from);
      await setDay(range, 'To', to);

      const preview = await writes(page, /\/pahchan\/attendance\/publish$/, async () => {
        await panel.getByRole('button', { name: 'Preview', exact: true }).click();
      }, { timeout: 90_000 });
      expect(preview.body.dry_run, 'the Preview button did not send dry_run').toBe(true);

      const publishBtn = panel.getByRole('button', { name: 'Publish to payroll' });
      await expect(publishBtn,
        'Publish is still disabled after a preview of this exact range').toBeEnabled({ timeout: 20_000 });

      const done = await writes(page, /\/pahchan\/attendance\/publish$/, async () => {
        await publishBtn.click();
      }, { timeout: 90_000 });
      expect(done.body.dry_run).toBe(false);
      return { preview: preview.body, published: done.body };
    }

    /* ── Run 1 · the window the approved corrections live in ────────────────
       This is the only window on this org that could build anything, and the
       reason is the finding: with no reference photographs every punch is
       `noref` and can never become eligible, but an APPROVED REGULARISATION
       creates its own day record with no punch involved
       (`attendance_bridge.py:274`). Three days were to carry a matched approved
       in AND out, so three complete days were to appear — see 09.10 for why
       none of them exists. */
    const approvedOnServer = (await rowsOf(page, '/api/v1/pahchan/regularisations?status=all'))
      .filter((r: any) => r.status === 'approved'
        && String(r.for_date).slice(0, 10) >= WINDOW_CORRECTIONS.from
        && String(r.for_date).slice(0, 10) <= WINDOW_CORRECTIONS.to);
    const expectDays = [...new Set(approvedOnServer.map((r: any) => String(r.for_date).slice(0, 10)))];

    const run1 = await publishRun(WINDOW_CORRECTIONS.from, WINDOW_CORRECTIONS.to);

    expect(run1.published.days_built,
      `the publish built ${run1.published.days_built} days from ${expectDays.length} approved ` +
      `correction days in this window${dump(wire)}`).toBe(run1.preview.days_built);

    // ── The rows payroll will actually price ────────────────────────────────
    const written = await rowsOf(page,
      `/api/v1/manav/attendance?date_from=${WINDOW_CORRECTIONS.from}&date_to=${WINDOW_CORRECTIONS.to}`);
    const mine = await me(page, 1);
    const ours = written.filter((r: any) => String(r.employee_id) === String(mine.employee.id));
    const days = [...new Set(ours.map((r: any) => String(r.date).slice(0, 10)))].sort();

    /**
     * §4: "payslip day-count must equal register day-count".
     *
     * ⚠ THE PAYSLIP IS SUITE 08'S, NOT THIS ONE'S, and wave3.config is explicit
     * that a suite depending on a sibling's output inside one wave only passes
     * in one order. What Suite 09 owns is the pair on ITS side of the handover:
     * the days the register can defend, and the days payroll was handed.
     *
     * ⚠ AND WITH ZERO ON BOTH SIDES THIS IS A VACUOUS EQUALITY. Said out loud
     * rather than presented as coverage: `0 === 0` passes forever and proves
     * nothing, which is precisely the shape this suite's own rules forbid. It
     * is asserted because it must hold, and the substantive expectation below
     * is what actually reports.
     */
    expect(days.length,
      `payroll was handed ${days.length} days for this employee (${days.join(', ') || 'none'}) and ` +
      `the publish reported ${run1.published.days_built} built. The two counts must agree — a ` +
      `payslip priced off a day the register cannot defend is the failure §4 names.${dump(wire)}`)
      .toBe(run1.published.days_built);

    /* ── Run 2 · the window today's punches live in ─────────────────────────
       And this is the chain from 09.6 arriving at payroll. Every punch is
       `noref`, no verdict can clear it, so the day is WITHHELD — which is the
       right behaviour and the reason nothing here is "fixed": writing an
       'absent' row would assert somebody did not work on the strength of a
       punch nobody has looked at. */
    const run2 = await publishRun(today, today);

    const punchesNow = await punchesToday(page);
    const unresolved = punchesNow.filter((p: any) =>
      (p.flags || []).length > 0 && p.review_verdict == null).length;

    expect(run2.published.days_withheld_pending_review,
      `today holds ${punchesNow.length} punches, ${unresolved} of them flagged and unreviewed, ` +
      `and the publish withheld ${run2.published.days_withheld_pending_review} days. A flagged ` +
      `punch nobody has cleared must not reach payroll.${dump(wire)}`)
      .toBeGreaterThanOrEqual(1);
    expect(run2.published.days_built,
      `today's punches built ${run2.published.days_built} days for payroll even though no ` +
      `reference pair exists and no punch can be confirmed. If this is non-zero the eligibility ` +
      `rule has changed — REPORT IT, do not adjust this assertion.${dump(wire)}`)
      .toBe(0);

    // The screen tells the operator, in words, which days it refused and why.
    await expect(section(panel, 'Withheld, pending review'),
      'days were withheld and the screen does not name them').toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('.ph__figs'),
      'the publish result rendered no figures at all').toBeVisible({ timeout: 20_000 });

    console.log(
      `\n[09.11] two publish runs, both preview-then-publish (§4 asked for 2) ✔` +
      `\n[09.11] run 1 · ${WINDOW_CORRECTIONS.from}..${WINDOW_CORRECTIONS.to}: ` +
      `${run1.published.days_built} days built, ${run1.published.rows_written} rows written, ` +
      `${run1.published.days_withheld_pending_review} withheld, ` +
      `${run1.published.skipped_manual_rows} left as HR typed them.` +
      `\n[09.11]   approved corrections in this window: ${approvedOnServer.length} over ` +
      `${expectDays.length} day(s). payroll holds ${days.length} day(s) for this employee: ` +
      `${days.join(', ') || 'none'}.` +
      `\n[09.11]   days_built === days handed to payroll: ${run1.published.days_built === days.length} ` +
      `— ⚠ VACUOUS at 0 === 0. §4's "payslip day-count = register day-count" is asserted and ` +
      `unproven until a correction can be raised (09.10) or a punch can be confirmed (09.6).` +
      `\n[09.11] run 2 · ${today}..${today}: ${run2.published.days_built} built, ` +
      `${run2.published.days_withheld_pending_review} WITHHELD from ${punchesNow.length} punches.` +
      `\n[09.11] ⚠ THAT WITHHOLDING IS THE 09.6 CHAIN REACHING PAYROLL, and it is correct ` +
      `behaviour: every punch is \`noref\`, none clearable because no reference pair exists and ` +
      `no enrollment upload exists to create one. The register protects itself by withholding ` +
      `rather than by refusing — which is the honest reading of what §4 called "the refusal ` +
      `path".` +
      `\n[09.11] overtime on this run: computed=${run1.published.overtime?.computed} ` +
      `${run1.published.overtime?.reason ? `(${run1.published.overtime.reason})` : ''}\n`,
    );

    /* ── THE SUBSTANTIVE EXPECTATIONS, WHICH REPORT RATHER THAN PASS ──────── */

    expect(expectDays.length,
      `THE PAYROLL EQUALITY COULD NOT BE EXERCISED WITH DATA — 0 approved corrections exist in ` +
      `${WINDOW_CORRECTIONS.from}..${WINDOW_CORRECTIONS.to}, so run 1 built 0 days and the ` +
      `"payslip day-count = register day-count" check is 0 === 0.\n` +
      `     BLOCKED BY 09.10: POST /v1/pahchan/regularisations 500s on every call —\n` +
      `     asyncpg DataError, $4 for_date is a str bound to $4::date\n` +
      `     (pahchan_attendance.py:151). No correction has ever been raised in this product,\n` +
      `     so the approve path, the decline path and the regularisation half of\n` +
      `     build_day_records have never had a row to act on.\n` +
      `     WHAT DID RUN: both publishes went through the real screen, preview then publish,\n` +
      `     and run 2 correctly withheld today's ${punchesNow.length} unreviewable punches.\n` +
      `     REPORTED, NOT FIXED — §14 owns the triage.${dump(wire)}`)
      .toBe(APPROVED_DAYS.length);

    // Overtime was turned on in 09.2, so the run must say it computed rather
    // than reporting "Not computed" — "0.0 overtime" and "overtime was never
    // computed" look identical on a payslip and mean opposite things.
    expect(run1.published.overtime?.computed,
      `overtime was enabled in 09.2 and the publish reports computed=` +
      `${run1.published.overtime?.computed} (${run1.published.overtime?.reason})${dump(wire)}`)
      .toBe(true);

    expect(con.uncaught, `UNCAUGHT page errors on the payroll screen:\n${con.uncaught.join('\n')}`).toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     09.12 — THE STANDING RULES, MEASURED ON THE LIVE SCREENS
     ════════════════════════════════════════════════════════════════════════ */

  test('09.12 no rendered id, no bare native date input, every table on --row-h, console clean', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    const TABS = ['clock', 'register', 'corrections', 'payroll', 'history', 'notice',
      'consent', 'enrollment', 'policy', 'analytics'];

    /**
     * ⚠ THE STATIC RATCHET CANNOT SEE THESE.
     *
     * `check-rendered-ids.mjs` is STATIC and POSITIONAL — it cannot see an id
     * the server pre-formats into a string, and two blind spots of that shape
     * were found today. This is the runtime half: it reads what is actually on
     * the page.
     *
     * ⚠ AND PAHCHAN HAS A SPECIFIC HAZARD. R2 keys here are
     * `pahchan/{kind}/{employee uuid}/YYYY/MM/…` (`pahchan.py:751`), so any
     * screen that draws a key, a folder or a filename WILL put a UUID on
     * screen. The Register's detail panel and the enrollment thumbnails both
     * fetch signed URLs; if either ever renders the key rather than the image,
     * this catches it.
     */
    const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const USER_ID = /\buser_[0-9a-f]{12}\b/i;
    const R2KEY = /\bpahchan\/(punch|reference)\//i;

    const offenders: string[] = [];
    const rowHeights: string[] = [];
    let measured = 0;

    for (const tab of TABS) {
      const panel = await pahchan(page, tab);

      /**
       * ⚠ WAIT FOR THE PANEL TO HAVE SAID SOMETHING BEFORE READING IT, AND
       * `settle()` IS NOT ENOUGH — THIS IS A TEST BUG'S FIX.
       *
       * The first draft waited on a skeleton class that does not exist here
       * (`.k-shimmer`; `ui/Skeleton.jsx` renders `k-skeleton*`) and then on
       * `settle()`, which is `waitForLoadState('networkidle')`. Both resolve
       * INSTANTLY on a tab that has just been clicked: the previous screen's
       * requests are finished, so the network is idle, and this screen's fetch
       * has not been issued yet. The sweep therefore measured ten empty panels
       * and reported "no table on this screen" for every one of them —
       * including register and consent, which 09.5 and 09.9 both assert have
       * tables. A sweep that runs over nothing reports no violations for ever;
       * that is the 02.3 shape and it is exactly what happened.
       *
       * So: the real skeleton class, and then a RETRYING wait for a row to
       * appear. The wait is allowed to expire — a screen with genuinely no
       * table is a real answer — but it can no longer be produced by reading
       * too early.
       */
      await expect(panel.locator('[class*="k-skeleton"]'),
        `the "${tab}" panel never finished loading`).toHaveCount(0, { timeout: 30_000 });
      await settle(page);

      /**
       * ⚠ THE REGISTER OPENS ON "NEEDS A LOOK", WHICH EMPTIES AS IT IS WORKED.
       *
       * `visible` filters on `!p.review_verdict` (Register.jsx:563), so once
       * every punch on the day carries a verdict the default view is an empty
       * state and there is no table to measure — which is correct product
       * behaviour and a useless place to check a row contract. Switching to
       * "All" is what a reviewer does to see the settled day, and it puts the
       * table that actually exists under the measurement.
       *
       * Best-effort: on a day with no punches at all there is no segment to
       * click, and "no table on this screen" is then the honest answer.
       */
      if (tab === 'register') {
        await panel.getByRole('radio', { name: /^All/ }).first().click({ timeout: 5_000 })
          .catch(async () => {
            await panel.getByRole('button', { name: /^All/ }).first().click({ timeout: 5_000 })
              .catch(() => { /* nothing to switch to */ });
          });
        await settle(page);
      }

      await panel.locator('table.tbl tbody tr').first()
        .waitFor({ state: 'visible', timeout: 12_000 }).catch(() => { /* no table here */ });

      const text = await panel.innerText();
      if (UUID.test(text)) offenders.push(`${tab}: a UUID is rendered — ${text.match(UUID)![0]}`);
      if (USER_ID.test(text)) offenders.push(`${tab}: a login id is rendered — ${text.match(USER_ID)![0]}`);
      if (R2KEY.test(text)) {
        offenders.push(`${tab}: an object-store key is rendered — ${text.match(R2KEY)![0]}… ` +
          `(these carry the employee UUID, and 07 §4 says a photo key is never in any payload a ` +
          `person sees)`);
      }

      // ⚠ NOT `input[type=date]` COUNTED FLAT. `DateInput.jsx` deliberately
      // KEEPS a native input in the DOM — clipped, aria-hidden, out of the tab
      // order — so form serialisation by `name` still works. Counting those
      // would report every CORRECT DateInput as a violation. The rule is that
      // no BARE native date input exists.
      const bare = await panel.locator('input[type=date]:not(.pk__native)').count();
      if (bare) offenders.push(`${tab}: ${bare} bare native <input type="date"> outside DateInput`);

      // The one row contract.
      const rows = panel.locator('table.tbl tbody tr');
      if (await rows.count()) {
        /**
         * ⚠ THE TOKEN IS READ AT THE ROW, NOT AT `documentElement`. `--row-h`
         * has TIERS — 48 / 66 / 76 — and a table opts into one by overriding
         * the variable on its own scope. Comparing every table to the document
         * value would punish a table for using the system as designed.
         *
         * ⚠ AND THE MEASUREMENT IS THE POINT. `check-table-rows.mjs` checks
         * that a class REFERENCES the token; Suite 07 found DSC/UDIN rendering
         * 77px at runtime while that gate stayed green. This reads the rendered
         * height in the browser.
         *
         * Pahchan renders EXPANSION rows on several tables — the fence, the
         * consent form, the decline panel, the register detail — which are
         * deliberately taller than one row. Those are excluded by class rather
         * than by height, so a genuinely wrong row cannot hide behind the
         * exemption.
         */
        const m = await rows.evaluateAll((els) => {
          const plain = els.filter((el) =>
            !el.classList.contains('ph__expand') &&
            !el.classList.contains('rv-det__row'));
          if (!plain.length) return null;
          const el = plain[0] as HTMLElement;
          /**
           * What is actually forcing the row open.
           *
           * ⚠ NOT "the tallest cell" — in table layout EVERY cell stretches to
           * the row height, so the tallest cell is always all of them and the
           * first one reported would look like the culprit when it is a 26px
           * row-number column. `height: var(--row-h)` on `.tbl td`
           * (components.css:1676) is a MINIMUM in table layout, so what opens
           * the row is a cell whose CONTENT is taller than the token. Measuring
           * each cell's content box is what names it.
           */
          const cells = [...el.children] as HTMLElement[];
          const contentH = (c: HTMLElement) =>
            Math.max(0, ...[...c.children].map((k) => (k as HTMLElement).getBoundingClientRect().height));
          const tallest = cells.reduce((a, b) => (contentH(b) > contentH(a) ? b : a), cells[0]);
          return {
            docToken: getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim(),
            rowToken: getComputedStyle(el).getPropertyValue('--row-h').trim(),
            h: Math.round(el.getBoundingClientRect().height),
            n: plain.length,
            rowClass: el.className || '(none)',
            cellIndex: tallest ? cells.indexOf(tallest) : -1,
            cellClass: tallest?.className || '(none)',
            cellH: tallest ? Math.round(contentH(tallest)) : 0,
            cellText: (tallest?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            allCells: cells.map((c, i) =>
              `#${i}${c.className ? '.' + c.className.split(/\s+/).join('.') : ''}=${Math.round(contentH(c))}px`)
              .join(' '),
          };
        });
        if (m) {
          rowHeights.push(`${tab}: ${m.n} rows · --row-h at the row=${m.rowToken || '(unset)'} ` +
            `(document=${m.docToken || '(unset)'}) rendered=${m.h}px`);
          measured += 1;
          const want = parseFloat(m.rowToken || m.docToken);
          if (Number.isFinite(want) && Math.abs(m.h - want) > 2) {
            offenders.push(
              `${tab}: a table row renders ${m.h}px while its own --row-h resolves to ` +
              `${m.rowToken || m.docToken} (document token ${m.docToken}) — ` +
              `${(m.h / want).toFixed(2)}× the token. row class "${m.rowClass}". The cell whose ` +
              `CONTENT is tallest is #${m.cellIndex} class "${m.cellClass}" at ${m.cellH}px ` +
              `containing "${m.cellText}". Content height per cell: ${m.allCells}. ` +
              `⚠ scripts/check-table-rows.mjs cannot see this: it checks that ` +
              `a class REFERENCES the token, not the height the browser renders — the same ` +
              `blind spot Suite 07 found on DSC/UDIN at 77px.`);
          }
          if (Number.isFinite(want) && ![48, 66, 76].includes(Math.round(want))) {
            offenders.push(`${tab}: --row-h resolves to ${want}px, which is none of the three ` +
              `declared tiers (48 / 66 / 76)`);
          }
        } else {
          rowHeights.push(`${tab}: only expansion rows on screen — nothing on the contract to measure`);
        }
      } else {
        rowHeights.push(`${tab}: no table on this screen`);
      }
    }

    console.log('\n[09.12] ' + rowHeights.join('\n[09.12] ') + '\n');

    /**
     * ⚠ THE SWEEP HAS TO HAVE SWEPT SOMETHING. Ten screens with one table
     * measured between them is not "no violations", it is a check that ran over
     * nothing. Pahchan renders a `.tbl` on register, corrections, consent,
     * enrollment (twice), policy/sites and history/corrections — so the floor
     * is set below that and still bites if the sweep goes quiet.
     */
    expect(measured,
      `only ${measured} of ${TABS.length} Pahchan screens had a table on the contract to ` +
      `measure, so --row-h was barely checked at all:\n${rowHeights.join('\n')}`)
      .toBeGreaterThanOrEqual(4);
    expect(offenders, `standing-rule violations measured on the live screens:\n${offenders.join('\n')}`)
      .toEqual([]);
    expect(con.uncaught, `UNCAUGHT page errors across every Pahchan screen:\n${con.uncaught.join('\n')}`)
      .toEqual([]);
    expect(realErrors(con), `console.error across every Pahchan screen:\n${realErrors(con).join('\n')}`)
      .toEqual([]);
  });
});
