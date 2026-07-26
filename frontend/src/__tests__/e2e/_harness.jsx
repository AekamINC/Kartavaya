/**
 * _harness.jsx — the end-to-end suite's isolation layer and mounting helpers.
 *
 * Not a `.test.` file, so vitest's `src/**\/__tests__/**\/*.test.*` glob does
 * not collect it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Staging and production share ONE Supabase project. An end-to-end test that
 * signs into a deployed URL is signing into production, and `POST /auth/login`
 * writes — it creates a session row and moves `last_login`. "Read-only against
 * staging" is therefore not a thing that exists here; a login is already a
 * write.
 *
 * So the suite runs in-process against a mocked network, and this file removes
 * the ways out rather than trusting every future test author to remember:
 *
 *   1 · `installMockApi()` replaces the five verbs on the single axios instance
 *       every screen shares (`lib/api.js`) with a route table.
 *   2 · An UNREGISTERED route REJECTS with a named error. It does not fall
 *       through to a real request. Forgetting to stub something fails the test
 *       instead of quietly dialling out, which is the usual way a "mocked"
 *       suite starts talking to a server months after anyone checked.
 *   3 · `installNetworkKillSwitch()` replaces `fetch`, `XMLHttpRequest`,
 *       `WebSocket` and `navigator.sendBeacon` with throwers, so anything that
 *       escapes layer 1 — a raw fetch in a component, the Supabase client, a
 *       push subscription, an analytics beacon — dies loudly.
 *
 * `network-isolation.test.js` asserts all of that. It is the proof, and it
 * should be the first thing read if this suite is ever suspected of touching
 * something real.
 *
 * Nothing here sends mail, WhatsApp, push or a social post either, for the
 * plain reason that no transport exists in the process. The invite flow's POST
 * resolves from the route table; there is no SMTP client to reach.
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi, expect } from 'vitest';
import { api } from '../../lib/api';
import { ToastProvider } from '../../components/ui';

/* ════════════════════════════════════════════════════════════════════════
   1 · The network kill switch
   ════════════════════════════════════════════════════════════════════════ */

let savedTransports = null;

const escape = (name) => (...args) => {
  throw new Error(
    `E2E NETWORK ESCAPE — ${name}(${String(args[0] ?? '')}).\n` +
    `Staging and production share one database, so this suite may not open a ` +
    `socket. Route the call through installMockApi() instead.`,
  );
};

export function installNetworkKillSwitch() {
  if (savedTransports) return; // idempotent — nested installs must not stack
  savedTransports = {
    fetch: globalThis.fetch,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    WebSocket: globalThis.WebSocket,
    sendBeacon: globalThis.navigator ? globalThis.navigator.sendBeacon : undefined,
  };

  globalThis.fetch = escape('fetch');

  // Constructors, not plain functions: code does `new XMLHttpRequest()`, and a
  // thrower that only works when called without `new` protects nothing.
  globalThis.XMLHttpRequest = function XMLHttpRequest(...a) { escape('XMLHttpRequest')(...a); };
  globalThis.WebSocket = function WebSocket(...a) { escape('WebSocket')(...a); };

  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: escape('navigator.sendBeacon'), configurable: true, writable: true,
    });
  }
}

export function restoreNetwork() {
  if (!savedTransports) return;
  globalThis.fetch = savedTransports.fetch;
  globalThis.XMLHttpRequest = savedTransports.XMLHttpRequest;
  globalThis.WebSocket = savedTransports.WebSocket;
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: savedTransports.sendBeacon, configurable: true, writable: true,
    });
  }
  savedTransports = null;
}

/* ════════════════════════════════════════════════════════════════════════
   2 · The mock API
   ════════════════════════════════════════════════════════════════════════ */

const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

/** Marker for a route that should reject with an axios-shaped error. */
export function httpError(status, detail = '') {
  const err = new Error(detail || `HTTP ${status}`);
  err.isAxiosError = true;
  err.response = { status, data: detail ? { detail } : {} };
  return { __reject: err };
}

/** `'/tasks/:id/move'` vs `'/tasks/abc/move'`. Returns params, or null. */
function matchPath(pattern, actual) {
  const p = pattern.split('/').filter(Boolean);
  const a = actual.split('/').filter(Boolean);
  if (p.length !== a.length && p[p.length - 1] !== '*') return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === '*') return params;
    if (p[i].startsWith(':')) { params[p[i].slice(1)] = a[i]; continue; }
    if (p[i] !== a[i]) return null;
  }
  return params;
}

/**
 * Install the route table.
 *
 * Keys are `'<VERB> <path>'` — `'GET /auth/me'`, `'PATCH /tasks/:id/move'`.
 * A value may be a literal payload, a function of `{ url, body, params }`, or
 * the marker `httpError()` returns.
 *
 * Returns a handle carrying every call the app made, so a test can assert on
 * what the app TRIED to send. Nothing receives it.
 */
export function installMockApi(routes = {}) {
  const calls = [];
  const table = Object.entries(routes).map(([key, value]) => {
    const sp = key.indexOf(' ');
    return { verb: key.slice(0, sp).toUpperCase(), path: key.slice(sp + 1), value };
  });

  const handle = {
    calls,
    /** Every call, or every call matching a verb and/or a path substring. */
    calledWith(verb, needle) {
      return calls.filter(c =>
        (!verb || c.verb === verb.toUpperCase()) &&
        (!needle || c.path.includes(needle)));
    },
    /** Add or replace routes mid-test (a second page's endpoints, say). */
    route(more) {
      for (const [key, value] of Object.entries(more)) {
        const sp = key.indexOf(' ');
        const verb = key.slice(0, sp).toUpperCase();
        const path = key.slice(sp + 1);
        const at = table.findIndex(r => r.verb === verb && r.path === path);
        if (at >= 0) table[at].value = value; else table.push({ verb, path, value });
      }
      return handle;
    },
  };

  for (const verb of VERBS) {
    const VERB = verb.toUpperCase();
    const carriesBody = VERB === 'POST' || VERB === 'PUT' || VERB === 'PATCH';
    vi.spyOn(api, verb).mockImplementation((url, second) => {
      const path = String(url).split('?')[0];
      const query = String(url).slice(path.length);
      const body = carriesBody ? second : undefined;
      calls.push({ verb: VERB, url: String(url), path, query, body });

      const hit = table.find(r => r.verb === VERB && matchPath(r.path, path));
      if (!hit) {
        return Promise.reject(new Error(
          `MockApi: no route registered for ${VERB} ${path}.\n` +
          `Register it in installMockApi() — an unstubbed call must never ` +
          `reach a server, so it is a failure rather than a passthrough.`,
        ));
      }
      const params = matchPath(hit.path, path) || {};
      const raw = typeof hit.value === 'function'
        ? hit.value({ url: String(url), path, query, body, params })
        : hit.value;

      // `Promise.resolve(raw)` rather than using `raw` directly, so a handler
      // may return a PENDING promise to model a request that has not answered
      // yet. Without this the pending promise was handed straight back as
      // `res.data` and a component reading `res.data.title` got a thenable.
      // Tests of in-flight state — the optimistic write, the disabled control —
      // need that pending window to exist.
      return Promise.resolve(raw).then((value) => {
        if (value && value.__reject) return Promise.reject(value.__reject);
        return { data: value, status: 200, headers: {} };
      });
    });
  }

  return handle;
}

/* ════════════════════════════════════════════════════════════════════════
   3 · Mounting
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Where the router currently is.
 *
 * Every redirect assertion in this suite reads this rather than a component's
 * markup, because "a client is bounced off /dashboard" is a statement about the
 * LOCATION, and asserting it through whatever the destination happens to render
 * couples the test to a screen it is not about.
 */
export function LocationProbe() {
  const loc = useLocation();
  return (
    <div
      data-testid="e2e-location"
      data-path={loc.pathname}
      data-search={loc.search}
      hidden
    />
  );
}

/** Flush effects, lazy chunks and resolved promises until the tree settles. */
export async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

/**
 * A mounted React host.
 *
 * `react-dom/client` directly, not @testing-library/react: the library is in
 * package.json but its @testing-library/dom peer is not installed, so importing
 * it throws. `pageHeader.test.jsx` and `pages/client/__tests__/smoke.test.jsx`
 * carry the same note and the same workaround, and this suite adds no
 * dependency to change that — a Windows-regenerated lockfile breaks the Linux
 * build (esbuild linux-x64 → win32-x64).
 */
export function makeHost() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const host = {
    container,
    root,

    async render(node) {
      await act(async () => { root.render(node); });
      await settle();
      return host;
    },

    /**
     * Mount `element` inside a router at `path`.
     *
     * `routes` is an array of `<Route>` elements when the test needs a real
     * route table (redirect destinations have to exist, or the redirect throws
     * rather than landing). Otherwise `element` is rendered bare.
     */
    async mount(element, { path = '/', routes = null } = {}) {
      return host.render(
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            {routes ? <Routes>{routes}</Routes> : element}
            <LocationProbe />
          </MemoryRouter>
        </ToastProvider>,
      );
    },

    unmount() {
      act(() => root.unmount());
      container.remove();
    },

    /** Current router pathname — see LocationProbe. */
    path: () => container.querySelector('[data-testid="e2e-location"]')?.dataset.path ?? null,
    search: () => container.querySelector('[data-testid="e2e-location"]')?.dataset.search ?? null,

    text: () => container.textContent,
    html: () => container.innerHTML,
    $: (sel) => container.querySelector(sel),
    $$: (sel) => [...container.querySelectorAll(sel)],

    /** First control whose visible label or aria-label equals `label`. */
    control: (label) => [...container.querySelectorAll('button, a, summary, [role="button"]')]
      .find(n => n.textContent.trim() === label || n.getAttribute('aria-label') === label) ?? null,

    async click(nodeOrLabel) {
      const node = typeof nodeOrLabel === 'string' ? host.control(nodeOrLabel) : nodeOrLabel;
      if (!node) throw new Error(`click: no control matching ${String(nodeOrLabel)}`);
      await act(async () => { node.click(); });
      await settle();
      return host;
    },

    /** Set a controlled input/textarea the way React will actually notice. */
    async fill(sel, value) {
      const node = typeof sel === 'string' ? container.querySelector(sel) : sel;
      if (!node) throw new Error(`fill: no field matching ${String(sel)}`);
      const proto = node.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      await act(async () => {
        setter.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
      return host;
    },

    async submit(formSel = 'form') {
      const form = container.querySelector(formSel);
      if (!form) throw new Error(`submit: no form matching ${formSel}`);
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await settle();
      return host;
    },
  };

  return host;
}

/**
 * A route table: the caller's real routes, plus stub landings for every
 * redirect destination they did not claim.
 *
 * The stubs have to exist — a `<Navigate to="/login">` with no `/login` route
 * lands on nothing and the assertion reads as "no redirect happened" rather
 * than "redirected somewhere undeclared". And they must NOT shadow a real route
 * the test supplied, so anything the caller declares wins and its stub is
 * dropped. Getting that backwards renders the placeholder and the test silently
 * measures the harness instead of the app.
 */
const LANDINGS = {
  '/login': 'login',
  '/dashboard': 'dashboard',
  '/client': 'client-portal',
  '/onboarding': 'onboarding',
};

export function routesWith(...extra) {
  const claimed = new Set(extra.flat().map(r => r.props.path));
  const stubs = Object.entries(LANDINGS)
    .filter(([p]) => !claimed.has(p))
    .map(([p, name]) => (
      <Route key={`stub${p}`} path={p} element={<div data-landed={name}>{name}</div>} />
    ));
  return [...stubs, ...extra.flat()];
}

/* ════════════════════════════════════════════════════════════════════════
   4 · Session state and user fixtures
   ════════════════════════════════════════════════════════════════════════ */

export const TOKEN_KEY = 'auth_token';
export const USER_KEY = 'Kartavaya_user';

/** Put a session in localStorage the way `lib/auth.js` does. */
export function signIn(user, token = 'e2e-token-not-a-real-credential') {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function clearSession() {
  localStorage.clear();
}

/**
 * The four shapes `navContext()` discriminates on.
 *
 * `role` is the legacy flat column; `org_roles` and `platform_roles` are what
 * the RBAC work made authoritative. Both are set deliberately on every fixture,
 * because most of the interesting bugs live in the disagreement between them.
 */
export const users = {
  staff: (o = {}) => ({
    user_id: 'u_staff', email: 'aanya@firm.in', full_name: 'Aanya Mehta',
    role: 'member', platform_roles: [], org_roles: [{ role_code: 'org_member', org_id: 'org_1' }],
    ...o,
  }),
  orgOwner: (o = {}) => ({
    user_id: 'u_owner', email: 'owner@firm.in', full_name: 'Sunita Rao',
    role: 'owner', platform_roles: [], org_roles: [{ role_code: 'org_owner', org_id: 'org_1' }],
    ...o,
  }),
  orgAdmin: (o = {}) => ({
    user_id: 'u_orgadmin', email: 'admin@firm.in', full_name: 'Vikram Desai',
    role: 'member', platform_roles: [], org_roles: [{ role_code: 'org_admin', org_id: 'org_1' }],
    ...o,
  }),
  platform: (o = {}) => ({
    user_id: 'u_platform', email: 'ops@aekaminc.com', full_name: 'Platform Operator',
    role: 'admin', platform_roles: [{ role_code: 'platform_admin' }], org_roles: [],
    ...o,
  }),
  /** A portal client: `role: 'client'` AND no org membership. Both matter. */
  client: (o = {}) => ({
    user_id: 'u_client', email: 'riya@acme.in', full_name: 'Riya Patel',
    role: 'client', platform_roles: [], org_roles: [],
    ...o,
  }),
  /**
   * Flagged client who ALSO holds an org role — staff who happens to be marked.
   * `navContext` must NOT confine them to the portal, or a colleague is locked
   * out of their own workspace.
   */
  clientWithOrgRole: (o = {}) => ({
    user_id: 'u_both', email: 'dual@firm.in', full_name: 'Dual Role',
    role: 'client', platform_roles: [], org_roles: [{ role_code: 'org_member', org_id: 'org_1' }],
    ...o,
  }),
};

/* ════════════════════════════════════════════════════════════════════════
   5 · Reading the stylesheets
   ════════════════════════════════════════════════════════════════════════
   jsdom does not apply author stylesheets, so anything about CSS is asserted
   against the CSS ITSELF. `pages/client/__tests__/smoke.test.jsx` established
   the pattern and the two traps:

     · not `import '...css?raw'` — Vite's CSS plugin claims the request before
       the raw loader sees it and hands back an empty string, so the assertions
       pass against nothing;
     · not `new URL(..., import.meta.url)` — `environmentOptions.jsdom.url`
       makes `import.meta.url` an http:// URL that `fileURLToPath` rejects.

   Resolved from the run directory instead, which works from `frontend/` and
   from the repo root.
*/

// eslint-disable-next-line import/no-extraneous-dependencies
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export const STYLE_DIR = ['src/styles', 'frontend/src/styles']
  .map(p => path.resolve(process.cwd(), p))
  .find(existsSync);

export const SRC_DIR = ['src', 'frontend/src']
  .map(p => path.resolve(process.cwd(), p))
  .find(existsSync);

if (!STYLE_DIR) throw new Error('e2e harness: src/styles not found from ' + process.cwd());

/** Comments stripped — the stylesheets' prose is not a rule. */
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

export function styleFiles() {
  return readdirSync(STYLE_DIR).filter(f => f.endsWith('.css')).sort();
}

export function readStyle(name) {
  return readFileSync(path.join(STYLE_DIR, name), 'utf8');
}

export function readSource(rel) {
  return readFileSync(path.join(SRC_DIR, rel), 'utf8');
}

/**
 * Every declaration block in a stylesheet, as `{ file, selector, body, media }`.
 *
 * Deliberately a small hand-rolled scanner rather than a parser dependency: the
 * assertions built on it are about at-rule CONTEXT (is this rule inside
 * `prefers-reduced-motion`?) and about which selector owns a declaration, and
 * both survive a scanner this simple. Nested at-rules are tracked by depth so a
 * rule inside `@media … { @supports … { } }` still reports both.
 */
export function cssRules(file) {
  const css = stripComments(readStyle(file));
  const out = [];
  const stack = [];
  let i = 0;
  let buf = '';

  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const head = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (head.startsWith('@')) {
        stack.push(head);
        i += 1;
        continue;
      }
      // A declaration block: read to its matching close.
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      out.push({
        file,
        selector: head,
        selectors: head.split(',').map(s => s.trim()).filter(Boolean),
        body: css.slice(i + 1, j - 1),
        media: [...stack],
      });
      i = j;
      continue;
    }
    if (ch === '}') { stack.pop(); buf = ''; i += 1; continue; }
    buf += ch;
    i += 1;
  }
  return out;
}

/** Every declaration block across every stylesheet. */
export function allCssRules() {
  return styleFiles().flatMap(cssRules);
}

/** True when this rule sits inside `@media (prefers-reduced-motion: reduce)`. */
export const underReducedMotion = (rule) =>
  rule.media.some(m => /prefers-reduced-motion\s*:\s*reduce/.test(m));

export { expect };
