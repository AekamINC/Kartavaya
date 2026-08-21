/**
 * Vikray · विक्रय — the contracts this module cannot check any other way.
 *
 * Three kinds of assertion live here and they are worth telling apart:
 *
 *  1. **CLIENT ↔ SERVER.** Every URL this app calls, every status it offers,
 *     and the whole transition map are compared against the CURRENT TEXT of
 *     `backend/routers/vikray.py` and `backend/migrations/020_vikray_vetana.sql`.
 *     `tsc` cannot help with any of it: the server is Python, so each one is a
 *     string on one side and a string on the other. This follows
 *     `api/__tests__/serverContract.test.ts`, which exists because a push-token
 *     regex disagreed with the server for months behind a green suite.
 *
 *  2. **PURE FUNCTIONS**, exercised for real — `orderLines`, `orderParty`,
 *     `nextStatuses`, `flowIndex`, `vikrayWriteError`. No source reading.
 *
 *  3. **THE QUEUEING POLICY**, as a source contract. This is the one that
 *     matters most and the one nothing else can catch: putting the stock
 *     adjustment through `useOfflineMutation` compiles, type-checks, renders and
 *     LOSES UNITS — the queue squashes two PATCHes to one URL last-writer-wins,
 *     so `+5` then `+3` becomes `+3` against a server that adds relatively.
 *     Nothing fails; five units simply stop existing. So the absence of that
 *     import is asserted, by file, with the reason attached.
 *
 * ── What this file CANNOT do ────────────────────────────────────────────────
 *
 * It does not render. Node's type-stripping does not transform JSX, so no
 * `.tsx` in this repo can be imported by `node --test` — not a screen, not a
 * sheet. Whether the status picker is on screen, whether the confirm button is
 * 44pt, and whether `विक्रय` drew in Tiro all need a device.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { srcPath, readCode, readRaw } from '../../../test/source.ts';
import {
  VALID_TRANSITIONS, ORDER_FLOW, ORDER_STATUS_LABEL, ORDER_STATUS_EFFECT,
  nextStatuses, flowIndex, orderLines, orderParty, vikrayWriteError,
  type Order,
} from '../../../api/vikray.ts';

/* ── Locating the server ─────────────────────────────────────────────────── */

/**
 * The `backend/` directory, walked up from `mobile/src`.
 *
 * A miss THROWS rather than skips — the same rule `serverContract.test.ts`
 * states: a contract test that quietly stops comparing is indistinguishable
 * from one that passes, which is the exact failure these exist to end.
 */
function backendDir(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'backend');
    if (existsSync(path.join(candidate, 'server.py'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate backend/ from mobile/src. These are client↔server contract '
    + 'tests; without the server there is nothing to compare against.',
  );
}

const ROUTER = readFileSync(path.join(backendDir(), 'routers', 'vikray.py'), 'utf8');
const MIGRATION = readFileSync(
  path.join(backendDir(), 'migrations', '020_vikray_vetana.sql'), 'utf8',
);

/* ── 1. Every URL the app calls is a route the server registers ──────────── */

/** `METHOD /path` for every `@router.<verb>("...")` in vikray.py. */
function serverRoutes(): Set<string> {
  const out = new Set<string>();
  for (const m of ROUTER.matchAll(/@router\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)) {
    out.add(`${m[1].toUpperCase()} ${normalise(m[2])}`);
  }
  return out;
}

/**
 * `/orders/{order_id}/status` and `` `/orders/${id}/status` `` both become
 * `/orders/{}/status`.
 *
 * Parameter NAMES are deliberately not compared. FastAPI binds by position in
 * the path, not by what the client called its variable, so requiring the names
 * to agree would fail on a rename that changes nothing — and the failure this
 * test is for is a wrong PATH, which survives any naming convention.
 */
function normalise(p: string): string {
  return p.replace(/\$\{[^}]*\}/g, '{}').replace(/\{[^}]*\}/g, '{}');
}

/**
 * Every `/v1/vikray/...` URL this app builds, with the method it uses.
 *
 * Both the API module and the SHEETS are scanned. The sheets matter
 * independently: `ConvertDealSheet` hands `urlBuilder` a URL that is used only
 * when the write is REPLAYED from the offline queue, so a typo there is
 * invisible until a rep loses signal — and then it 404s, and `flushQueue`
 * discards any 4xx permanently and silently.
 */
function clientCalls(): { call: string; where: string }[] {
  const files = [
    'api/vikray.ts',
    'screens/vikray/ConvertDealSheet.tsx',
    'screens/vikray/OrderDetailSheet.tsx',
    'screens/vikray/StockAdjustSheet.tsx',
    'screens/modules/VikrayScreen.tsx',
  ];
  const out: { call: string; where: string }[] = [];

  for (const file of files) {
    const code = readCode(file);

    // `apiClient.get<...>('/v1/vikray/...')` and its template-literal form.
    //
    // Everything between the method name and the opening paren is skipped with
    // `[^(]*` rather than matched as a generic. A `<[^>]*>` cannot read
    // `get<Listed<Order>>`: it stops at the first `>` and then finds another one
    // where it wants the paren. That silently dropped three of the nine calls —
    // a scrape that finds less than it should is the failure mode these route
    // tests exist to avoid, which is why the count below is asserted too.
    for (const m of code.matchAll(
      /apiClient\.(get|post|patch|put|delete)[^(]*\(\s*[`'"]([^`'"]*\/v1\/vikray\/[^`'"]*)[`'"]/g,
    )) {
      out.push({ call: `${m[1].toUpperCase()} ${strip(m[2])}`, where: file });
    }

    // The queue's replay URL, which never passes through apiClient at write
    // time and so is not covered by the pattern above.
    for (const m of code.matchAll(/urlBuilder:\s*[^=]*=>\s*[`'"]([^`'"]+)[`'"]/g)) {
      const url = m[1];
      if (!url.includes('/v1/vikray/')) continue;
      const method = /method:\s*'(GET|POST|PATCH|PUT|DELETE)'/.exec(
        code.slice(Math.max(0, m.index! - 300), m.index!),
      )?.[1];
      assert.ok(method, `${file}: a vikray urlBuilder with no method above it`);
      out.push({ call: `${method} ${strip(url)}`, where: `${file} (offline replay)` });
    }
  }
  return out;
}

/** `/v1/vikray/orders/{}` → `/orders/{}`; the router's own prefix comes off. */
function strip(url: string): string {
  return normalise(url).replace(/^\/v1\/vikray/, '');
}

test('every vikray URL this app builds is a route the server registers', () => {
  const routes = serverRoutes();
  assert.ok(routes.size >= 15, `the route scrape found ${routes.size} — the regex has rotted`);

  const calls = clientCalls();
  assert.ok(
    calls.length >= 9,
    `the client scrape found ${calls.length} vikray calls — it should find at least nine`,
  );

  const dangling = calls
    .filter(c => !routes.has(c.call))
    .map(c => `${c.call}  [${c.where}]`);

  assert.deepEqual(
    dangling, [],
    'these call routes vikray.py does not register. A wrong URL is a 404 the '
    + 'offline queue discards permanently and silently:\n  ' + dangling.join('\n  '),
  );
});

test('the offline queue only ever replays the ONE vikray write that may be replayed', () => {
  // `from-deal` is idempotent on the server — it returns the existing order
  // rather than writing a second. Nothing else in this module is.
  const replayed = clientCalls()
    .filter(c => c.where.includes('offline replay'))
    .map(c => c.call);
  assert.deepEqual(replayed, ['POST /orders/from-deal/{}']);
});

/* ── 2. The transition map is the server's ───────────────────────────────── */

/** `_VALID_TRANSITIONS` in vikray.py, parsed. */
function serverTransitions(): Record<string, string[]> {
  const block = /_VALID_TRANSITIONS\s*=\s*\{([\s\S]*?)\n\}/.exec(ROUTER);
  assert.ok(block, '_VALID_TRANSITIONS was not found in vikray.py — it was renamed');
  const out: Record<string, string[]> = {};
  for (const m of block![1].matchAll(/"(\w+)":\s*\{([^}]*)\}/g)) {
    out[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map(x => x[1]).sort();
  }
  return out;
}

test('VALID_TRANSITIONS is exactly the server map, both directions', () => {
  const server = serverTransitions();
  const mine = Object.fromEntries(
    Object.entries(VALID_TRANSITIONS).map(([k, v]) => [k, [...v].sort()]),
  );

  // Both directions on purpose. A missing key hides a move the product supports
  // and sends somebody to a laptop; an EXTRA key offers a button that 400s, and
  // the server's refusal is the only thing that would catch it.
  assert.deepEqual(
    mine, server,
    'the phone’s transition map has drifted from _VALID_TRANSITIONS in vikray.py',
  );
});

test('the pipeline line is the server’s five stages, in the server’s order', () => {
  const m = /_PIPELINE_STAGES\s*=\s*\[([^\]]*)\]/.exec(ROUTER);
  assert.ok(m, '_PIPELINE_STAGES was not found in vikray.py');
  const server = [...m![1].matchAll(/"(\w+)"/g)].map(x => x[1]);
  assert.deepEqual([...ORDER_FLOW], server);
  // Order is the point — the progress bar reads left to right and a reordered
  // array would light the wrong segment without changing any count.
  assert.equal(ORDER_FLOW[0], 'draft');
  assert.equal(ORDER_FLOW[ORDER_FLOW.length - 1], 'closed');
  assert.ok(!ORDER_FLOW.includes('cancelled' as never),
    'cancelled is terminal and off the line — it is not money sitting anywhere');
});

test('every status the phone can render is one the table allows', () => {
  // The CHECK constraint on `staging.vikray_orders.status`, migration 020.
  const m = /status\s+TEXT\s+DEFAULT\s+'draft'\s*\n\s*CHECK\s*\(status\s+IN\s*\(([^)]*)\)/.exec(MIGRATION);
  assert.ok(m, 'the status CHECK constraint was not found in migration 020');
  const allowed = new Set([...m![1].matchAll(/'(\w+)'/g)].map(x => x[1]));

  for (const status of Object.keys(ORDER_STATUS_LABEL)) {
    assert.ok(allowed.has(status), `${status} is labelled but the table forbids it`);
  }
  for (const status of allowed) {
    assert.ok(
      ORDER_STATUS_LABEL[status],
      `${status} exists in the database and the phone has no word for it — it would `
      + 'render as the raw column value',
    );
  }
});

test('every move the phone offers says what it DOES, not just what it is called', () => {
  // A status picker that presents five equivalent words is how stock gets
  // deducted by somebody who was only tidying a list. Every reachable target
  // needs a consequence line.
  const targets = new Set(Object.values(VALID_TRANSITIONS).flat());
  for (const target of targets) {
    assert.ok(
      ORDER_STATUS_EFFECT[target]?.trim(),
      `moving to "${target}" is offered with no explanation of its side effect`,
    );
  }
  // And the two that move inventory say so in as many words, because that is
  // the effect the user cannot see and cannot undo from a phone.
  assert.match(ORDER_STATUS_EFFECT.confirmed, /stock/i);
  assert.match(ORDER_STATUS_EFFECT.cancelled, /stock|back/i);
});

/* ── 3. The pure functions ───────────────────────────────────────────────── */

test('nextStatuses stops at both terminals and tolerates junk', () => {
  assert.deepEqual([...nextStatuses('draft')], ['confirmed', 'cancelled']);
  assert.deepEqual([...nextStatuses('dispatched')], ['delivered']);
  // Terminal: nothing to offer, and the sheet renders a sentence instead of an
  // empty picker.
  assert.deepEqual([...nextStatuses('closed')], []);
  assert.deepEqual([...nextStatuses('cancelled')], []);
  // Case, null and a column value nobody has seen yet — none of them may throw
  // inside a render.
  assert.deepEqual([...nextStatuses('DRAFT')], ['confirmed', 'cancelled']);
  assert.deepEqual([...nextStatuses(null)], []);
  assert.deepEqual([...nextStatuses(undefined)], []);
  assert.deepEqual([...nextStatuses('invented')], []);
});

test('flowIndex puts cancelled OFF the line rather than at the start', () => {
  assert.equal(flowIndex('draft'), 0);
  assert.equal(flowIndex('closed'), ORDER_FLOW.length - 1);
  // -1, not 0. Returning 0 would light the first segment and read as "this
  // order is a draft", which is the opposite of what happened to it.
  assert.equal(flowIndex('cancelled'), -1);
  assert.equal(flowIndex(null), -1);
});

test('orderLines survives every shape asyncpg hands jsonb back as', () => {
  const line = { description: 'A thing', quantity: 2 };
  // Parsed array — the common path.
  assert.deepEqual(orderLines({ line_items: [line] }), [line]);
  // A STRING, which some paths return. `_apply_stock_moves` re-parses it
  // defensively for exactly this reason, and a screen calling .map on it
  // directly crashes on those rows.
  assert.deepEqual(orderLines({ line_items: JSON.stringify([line]) }), [line]);
  // Empty, null, absent, malformed, and valid JSON that is not an array. None
  // may throw: this runs inside a render.
  assert.deepEqual(orderLines({ line_items: null }), []);
  assert.deepEqual(orderLines(undefined), []);
  assert.deepEqual(orderLines({ line_items: 'not json at all' }), []);
  assert.deepEqual(orderLines({ line_items: '{"a":1}' }), []);
});

test('orderParty names the COMPANY first and never falls back to an id', () => {
  const base = { contact_company: null, contact_name: null } as
    Pick<Order, 'contact_company' | 'contact_name'>;

  // A CRM client is the company — the customer. Contacts come and go.
  assert.equal(
    orderParty({ contact_company: 'Unicode Group', contact_name: 'R Patel' }),
    'Unicode Group',
  );
  assert.equal(orderParty({ contact_company: null, contact_name: 'R Patel' }), 'R Patel');
  // Whitespace-only is not a name. Without the trim this renders as a blank row
  // that looks like a rendering bug rather than missing data.
  assert.equal(orderParty({ contact_company: '   ', contact_name: 'R Patel' }), 'R Patel');
  // Ten of the 378 live orders name nobody. null is the honest answer and the
  // row says so; a uuid must never appear in its place.
  assert.equal(orderParty(base), null);
});

test('a 409 is explained as the collision it is, not as a duplicate', () => {
  // The interceptor in api/client.ts turns every 409 into "This already exists
  // — try a different name or email." On this endpoint nothing was duplicated:
  // the server's `AND status=$4` matched nothing because somebody else moved
  // the order first, and the fix is to reload rather than to rename anything.
  const msg = vikrayWriteError({ response: { status: 409 } });
  assert.match(msg, /moved this order|reload/i);
  assert.doesNotMatch(msg, /already exists/i);
});

test('a 403 names the SECOND grant, because that is the one likely missing', () => {
  // `POST /orders/{id}/invoice` stacks require_module("ganit") on top of
  // require_module("vikray"). A member holding Sales but not the books gets a
  // 403 on that one action while the rest of the screen works.
  assert.match(vikrayWriteError({ response: { status: 403 } }), /Invoicing/);
});

test('a request that never reached the server says nothing was changed', () => {
  const msg = vikrayWriteError(new Error('Network Error'));
  assert.match(msg, /Nothing was changed/i);
});

/* ── 4. The queueing policy, as a source contract ────────────────────────── */

test('the status write and the stock write NEVER go through the offline queue', () => {
  // THE FAILURE THIS EXISTS FOR, and it is silent in both directions:
  //
  //   · the queue squashes consecutive PATCHes to one URL last-writer-wins, and
  //     `quantity_delta` is RELATIVE — +5 then +3 becomes +3, and five units
  //     stop existing with no error anywhere;
  //   · a queued status change is stale by construction, so the server's
  //     `AND status=$4` guard 409s it, and `flushQueue` discards any 4xx
  //     permanently without telling the user the move never landed.
  //
  // Neither compiles differently, renders differently, or fails a type check.
  for (const file of [
    'screens/vikray/OrderDetailSheet.tsx',
    'screens/vikray/StockAdjustSheet.tsx',
  ]) {
    const code = readCode(file);
    assert.doesNotMatch(
      code, /useOfflineMutation/,
      `${file} queues a write that moves stock or mints a document number. `
      + 'See the notes on setOrderStatus and adjustStock in api/vikray.ts.',
    );
    // And the button must be dead rather than armed-and-doomed when there is no
    // connection, which is the honest half of the same decision.
    assert.match(
      code, /useOnline/,
      `${file} must read the connection so its action is disabled offline`,
    );
  }
});

test('the deal conversion — the one idempotent write — IS queued', () => {
  const code = readCode('screens/vikray/ConvertDealSheet.tsx');
  assert.match(code, /useOfflineMutation/,
    'from-deal is the only write here the server makes idempotent; a rep in a '
    + 'basement should not lose it');
  // A dedup key, so a double-tap offline replaces the queued entry instead of
  // queueing the same conversion twice.
  assert.match(code, /optimisticId/);
});

test('api/vikray.ts marks every unqueueable write ONLINE ONLY, in the file that defines it', () => {
  // Prose, and deliberately asserted: this is the file somebody reads at the
  // moment they add a fourth write, and a rule that lives only in a test is a
  // rule they will not see.
  const raw = readRaw('api/vikray.ts');
  for (const fn of ['setOrderStatus', 'adjustStock', 'generateInvoice']) {
    const at = raw.indexOf(`${fn}:`);
    assert.ok(at > 0, `${fn} is gone from api/vikray.ts`);
    const doc = raw.slice(Math.max(0, at - 2600), at);
    assert.match(
      doc, /ONLINE ONLY/,
      `${fn} lost the ONLINE ONLY note that says why it must not be queued`,
    );
  }
});
