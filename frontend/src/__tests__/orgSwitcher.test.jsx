/**
 * OrgSwitcher — the surface that shipped as a mechanism without a screen.
 *
 * `165b2fd0` fixed the resolver's oldest-membership fallback; the control it
 * needed was a native `<select>` in the sidebar footer, and
 * `grep -rn "orgsw" frontend/src` returned zero hits. These tests pin the
 * behaviour of the replacement, not its appearance:
 *
 *   · the popover opens and traps focus
 *   · rows are `menuitemradio` and the active one is `aria-checked`
 *   · an org at its seat limit says so, in `--warn`
 *   · an org with NO cap renders the role alone — never an invented number
 *   · the support section is ABSENT with no sessions, and absent SILENTLY when
 *     the endpoint 404s, which is the state the live product is in today
 *     (the table does not exist — `to_regclass` returns NULL on the live database)
 *   · a support row carries its violet, its request id and its countdown
 *   · switching clears `kv_teams_cache`, which the reload alone does not
 *
 * The last one — "the trigger name does not clip" — cannot be observed in
 * jsdom, which computes no layout: every element measures 0×0, so an assertion
 * about ellipsis would pass against any stylesheet at all. It is pinned against
 * the CSS instead, as the two declarations that together make the flex contract
 * hold: `.orgsw__t-n { flex: 0 0 auto }` and `.crumb__cur { min-width: 0 }`.
 * Leave either out and the row overflows or the name clips to "Aekam I…".
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern and is NOT installed.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let payload;              // what /v1/org/memberships answers, or an Error
const switched = [];      // every setActiveOrg call

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(() => (payload instanceof Error
      ? Promise.reject(payload)
      : Promise.resolve({ data: payload }))),
  },
}));

vi.mock('../lib/orgContext', () => ({
  getActiveOrg: vi.fn(() => globalThis.__activeOrg ?? null),
  // The real one calls `window.location.assign`, which jsdom cannot do.
  setActiveOrg: vi.fn((id) => { switched.push(id); }),
  clearActiveOrg: vi.fn(),
}));

let ME = { user_id: 'u1', org_roles: [{ role_code: 'org_owner', org_name: 'Aekam Inc' }] };
vi.mock('../lib/auth', () => ({
  currentUser: () => ME,
}));

const { default: OrgSwitcher } = await import('../components/layout/OrgSwitcher');
const { seatPhrase, sessionClock, swInitials } = await import('../components/layout/OrgSwitcher');

// `import.meta.url` is an http:// URL under Vitest's browser-shaped transform,
// so it cannot be handed to readFileSync. `process.cwd()` is the frontend root.
const CSS = readFileSync(resolve(process.cwd(), 'src/styles/editorial.css'), 'utf8');

const org = (id, name, role, over = {}) => ({
  id, name, role, logo_url: null,
  seats_used: null, seats_limit: null, seats_full: false,
  ...over,
});

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

let container;
let root;

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

const mount = async (path = '/today') => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <OrgSwitcher />
      </MemoryRouter>,
    );
  });
  await settle();
};

const trigger = () => container.querySelector('.orgsw__t');
const panel = () => container.querySelector('.orgsw__pop');
const rows = () => [...container.querySelectorAll('.orgsw__row')];
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  switched.length = 0;
  globalThis.__activeOrg = null;
  localStorage.clear();
  ME = { user_id: 'u1', org_roles: [{ role_code: 'org_owner', org_name: 'Aekam Inc' }] };
  payload = {
    data: [
      org('o1', 'Aekam Inc', 'org_owner'),
      org('o2', 'Mehta Associates', 'org_admin', { seats_used: 7, seats_limit: 10 }),
    ],
    support: [],
    default_id: 'o1',
  };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// ── Opening ────────────────────────────────────────────────────────────────

describe('the popover', () => {
  it('is closed until the trigger is pressed, and says so', async () => {
    await mount();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();

    await click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(panel()).not.toBeNull();
    expect(panel().getAttribute('role')).toBe('menu');
  });

  it('traps focus inside itself', async () => {
    await mount();
    trigger().focus();
    await click(trigger());

    // The panel is INSIDE a FocusTrap — its parent is the trap's
    // `display: contents` wrapper, which is where the Tab handler is bound.
    expect(panel().parentElement.getAttribute('style')).toContain('display: contents');

    // Where FocusTrap puts focus on OPEN is not measurable here and is
    // deliberately not asserted: jsdom computes no layout, so FocusTrap's
    // `offsetParent !== null` visibility filter matches nothing, it falls back
    // to focusing its own wrapper, and focusing a div with no tabindex is a
    // no-op. An assertion either way would be about jsdom, not the component.
    // What IS measurable is that Tab cannot leave.
    const items = [...panel().querySelectorAll('button')];
    items[items.length - 1].focus();
    await act(async () => {
      panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(panel().contains(document.activeElement)).toBe(true);

    items[0].focus();
    await act(async () => {
      panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    await mount();
    trigger().focus();
    await click(trigger());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel()).toBeNull();
    // A keyboard user who opens the menu and changes their mind is put back
    // where they were, not dropped at <body>.
    expect(document.activeElement).toBe(trigger());
  });
});

// ── The rows ───────────────────────────────────────────────────────────────

describe('the organisation rows', () => {
  it('are menuitemradio, with aria-checked on the active one only', async () => {
    globalThis.__activeOrg = 'o2';
    await mount();
    await click(trigger());

    const orgRows = rows().filter((r) => r.getAttribute('role') === 'menuitemradio');
    expect(orgRows).toHaveLength(2);
    expect(orgRows.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    // Picking an org is a single CHOICE. `menuitem` would announce two
    // independent commands and never say which one is in force.
    expect(orgRows[1].className).toContain('on');
  });

  it('falls back to the server default when nothing has been chosen', async () => {
    await mount();
    await click(trigger());
    const orgRows = rows().filter((r) => r.getAttribute('role') === 'menuitemradio');
    expect(orgRows[0].getAttribute('aria-checked')).toBe('true');
  });

  it('names the role in words, not as a role_code', async () => {
    await mount();
    await click(trigger());
    expect(rows()[0].textContent).toContain('Owner');
    expect(rows()[0].textContent).not.toContain('org_owner');
  });
});

// ── Seats ──────────────────────────────────────────────────────────────────

describe('seat counts', () => {
  it('renders the --warn line at the cap', async () => {
    payload.data = [
      org('o1', 'Aekam Inc', 'org_owner'),
      org('o3', 'Sundar Textiles', 'org_member', { seats_used: 45, seats_limit: 45, seats_full: true }),
    ];
    await mount();
    await click(trigger());

    const sub = rows()[1].querySelector('.orgsw__m');
    expect(sub.className).toContain('orgsw__m--full');
    expect(sub.textContent).toBe('Member · at seat limit — 45 of 45');
  });

  it('renders "n of m seats" below the cap, without the warn class', async () => {
    await mount();
    await click(trigger());
    const sub = rows()[1].querySelector('.orgsw__m');
    expect(sub.textContent).toBe('Admin · 7 of 10 seats');
    expect(sub.className).not.toContain('orgsw__m--full');
  });

  it('renders the ROLE ALONE when the org has no cap', async () => {
    // Measured on the live database: two of three orgs have no cap at all and
    // six of seven rows in staging.plans have max_users NULL. A denominator
    // that does not exist must never be invented — "9 of 0 seats" is what
    // collapsing NULL to zero prints.
    payload.data = [
      org('o1', 'Aekam Inc', 'org_owner', { seats_used: 9, seats_limit: null }),
      org('o2', 'Mehta Associates', 'org_admin'),
    ];
    await mount();
    await click(trigger());
    const sub = rows()[0].querySelector('.orgsw__m');
    expect(sub.textContent).toBe('Owner');
    expect(sub.textContent).not.toMatch(/seat/i);
  });

  it('seatPhrase returns null rather than a number it did not receive', () => {
    expect(seatPhrase({ seats_used: 9, seats_limit: null })).toBeNull();
    expect(seatPhrase({ seats_used: null, seats_limit: 25 })).toBeNull();
    expect(seatPhrase({ seats_used: 18, seats_limit: 25 })).toEqual({ text: '18 of 25 seats', full: false });
    expect(seatPhrase({ seats_used: 45, seats_limit: 45 })).toEqual({ text: 'at seat limit — 45 of 45', full: true });
  });
});

// ── Support access ─────────────────────────────────────────────────────────

describe('the support section', () => {
  it('is ABSENT when there are no sessions — never an empty state', async () => {
    await mount();
    await click(trigger());
    expect(container.querySelector('.orgsw__head--sup')).toBeNull();
    expect(container.querySelector('.orgsw__row--sup')).toBeNull();
    expect(container.querySelector('.orgsw__note')).toBeNull();
    // "You have no access to other companies" is the default condition and
    // does not need saying.
    expect(panel().textContent).not.toMatch(/support/i);
  });

  it('degrades silently when the endpoint has no such key', async () => {
    // `to_regclass('staging.platform_support_sessions')` returns NULL on the
    // live database, so this is the state the product ships in for weeks.
    payload = { data: payload.data, default_id: 'o1' };   // no `support` at all
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    await click(trigger());
    expect(container.querySelector('.orgsw__head--sup')).toBeNull();
    expect(rows().filter((r) => r.getAttribute('role') === 'menuitemradio')).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    errors.mockRestore();
    warns.mockRestore();
  });

  it('degrades silently when the whole request 404s', async () => {
    payload = Object.assign(new Error('Not Found'), { response: { status: 404 } });
    ME = { user_id: 'u1', platform_roles: ['platform_admin'], org_roles: [] };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount();
    // The console row survives — it does not come from this endpoint — and
    // nothing else is claimed.
    await click(trigger());
    expect(container.querySelector('.orgsw__head--sup')).toBeNull();
    expect(container.querySelector('.orgsw__row--plat')).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('renders its violet, its request id and its countdown', async () => {
    payload.support = [{
      id: 's1', org_id: 'o9', name: 'Vardhman Traders',
      ref: 'SR-2418', approved_by: 'R. Iyer', expires_at: inHours(2.25),
    }];
    await mount();
    await click(trigger());

    const head = container.querySelector('.orgsw__head--sup');
    expect(head.textContent).toBe('Support access · approved');

    const row = container.querySelector('.orgsw__row--sup');
    expect(row).not.toBeNull();                    // the inset 2px violet rule
    expect(row.textContent).toContain('SR-2418');
    expect(row.textContent).toContain('approved by R. Iyer');
    expect(row.textContent).toMatch(/ends in 2h 1[45]m/);

    // The sentence is not reassurance for the operator; it is the rule that
    // support access is never silent, where they read it as they use it.
    expect(container.querySelector('.orgsw__note').textContent)
      .toMatch(/Not a membership\..*audit log.*owner was emailed/s);
  });

  it('tags the trigger while the session is the active org', async () => {
    globalThis.__activeOrg = 'o9';
    payload.support = [{
      id: 's1', org_id: 'o9', name: 'Vardhman Traders',
      ref: 'SR-2418', approved_by: 'R. Iyer', expires_at: inHours(2.25),
    }];
    await mount();
    // An operator with two tabs open is never unsure which one they are typing
    // into.
    expect(trigger().className).toContain('orgsw__t--sup');
    expect(container.querySelector('.orgsw__t-tag').textContent).toMatch(/support · 2h 1[45]m/);
    expect(container.querySelector('.orgsw__t-n').textContent).toBe('Vardhman Traders');
  });

  it('drops an expired session rather than letting it keep working', async () => {
    payload.support = [{
      id: 's1', org_id: 'o9', name: 'Vardhman Traders',
      ref: 'SR-2418', approved_by: 'R. Iyer', expires_at: inHours(-0.1),
    }];
    await mount();
    await click(trigger());
    expect(container.querySelector('.orgsw__row--sup')).toBeNull();
    expect(container.querySelector('.orgsw__head--sup')).toBeNull();
  });

  it('keeps an open-ended session, which is not the same as an absent one', async () => {
    // `granted_ttl_hours = 0` is "until revoked" and is the only value that
    // leaves an approved row with a NULL expiry. A bare `remaining` check would
    // drop exactly the sessions most worth showing.
    payload.support = [{
      id: 's1', org_id: 'o9', name: 'Vardhman Traders',
      ref: 'SR-2418', approved_by: 'R. Iyer', expires_at: null,
    }];
    await mount();
    await click(trigger());
    const row = container.querySelector('.orgsw__row--sup');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('SR-2418 · approved by R. Iyer · until revoked');
  });

  it('sessionClock separates "no clock" from "run out"', () => {
    const t0 = Date.UTC(2026, 7, 6, 12, 0, 0);
    expect(sessionClock(new Date(t0 + 8_040_000).toISOString(), t0)).toEqual({ live: true, remaining: '2h 14m' });
    expect(sessionClock(new Date(t0 + 1_080_000).toISOString(), t0)).toEqual({ live: true, remaining: '18m' });
    expect(sessionClock(new Date(t0 - 1).toISOString(), t0)).toEqual({ live: false, remaining: null });
    // Null expiry is LIVE with no countdown, not expired.
    expect(sessionClock(null, t0)).toEqual({ live: true, remaining: null });
  });
});

// ── The platform console row ───────────────────────────────────────────────

describe('the platform console row', () => {
  it('is absent for someone who cannot open the console', async () => {
    await mount();
    await click(trigger());
    expect(container.querySelector('.orgsw__row--plat')).toBeNull();
  });

  it('is a menuitem, not a menuitemradio — it is a command, not a choice', async () => {
    ME = { user_id: 'u1', platform_roles: ['platform_admin'], org_roles: [] };
    await mount();
    await click(trigger());
    const plat = container.querySelector('.orgsw__row--plat');
    expect(plat.getAttribute('role')).toBe('menuitem');
    expect(plat.hasAttribute('aria-checked')).toBe(false);
    expect(container.querySelector('.orgsw__sep')).not.toBeNull();
  });

  it('shows the console as the current surface while under /admin', async () => {
    ME = { user_id: 'u1', platform_roles: ['platform_admin'], org_roles: [] };
    await mount('/admin/orgs');
    expect(trigger().className).toContain('orgsw__t--plat');
    expect(container.querySelector('.orgsw__t-n').textContent).toBe('Aekam platform');
    await click(trigger());
    expect(container.querySelector('.orgsw__row--plat').className).toContain('on');
    // No membership reads as active while the operator is on the platform
    // surface: "whose data am I in" and "am I an operator" are different
    // questions and the control must be able to show both.
    expect(rows().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
  });
});

// ── Switching ──────────────────────────────────────────────────────────────

describe('switching', () => {
  it('clears the cached teams before it reloads', async () => {
    // `AppShell.jsx:258` reads kv_teams_cache synchronously and renders it
    // before its own fetch returns, and setActiveOrg never removed it — so the
    // first paint after a switch listed the PREVIOUS org's projects.
    localStorage.setItem('kv_teams_cache', JSON.stringify([{ id: 't1' }]));
    await mount();
    await click(trigger());
    await click(rows()[1]);

    expect(localStorage.getItem('kv_teams_cache')).toBeNull();
    expect(switched).toEqual(['o2']);
  });

  it('does not reload when the chosen org is already the active one', async () => {
    globalThis.__activeOrg = 'o1';
    await mount();
    await click(trigger());
    await click(rows()[0]);
    expect(switched).toEqual([]);
    expect(panel()).toBeNull();
  });
});

// ── No choice to make ──────────────────────────────────────────────────────

describe('with one organisation and nothing else', () => {
  it('renders the name and no control at all', async () => {
    payload = { data: [org('o1', 'Aekam Inc', 'org_owner')], support: [], default_id: 'o1' };
    await mount();
    // A picker with a single entry is furniture that implies a decision exists.
    expect(trigger()).toBeNull();
    // But the name stays: it is the breadcrumb's first segment and the only
    // place in the product that says whose data this is.
    expect(container.querySelector('.orgsw__t-n').textContent).toBe('Aekam Inc');
  });

  it('falls back to the name /auth/me already carries when the fetch fails', async () => {
    payload = new Error('network');
    await mount();
    expect(container.querySelector('.orgsw__t-n').textContent).toBe('Aekam Inc');
  });

  it('renders nothing when there is no organisation at all', async () => {
    ME = { user_id: 'u1', org_roles: [] };
    payload = { data: [], support: [], default_id: null };
    await mount();
    expect(container.querySelector('.orgsw')).toBeNull();
  });
});

// ── The breadcrumb separator ───────────────────────────────────────────────

describe('the leading separator', () => {
  const withSep = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/today']}>
          <OrgSwitcher withSeparator />
        </MemoryRouter>,
      );
    });
    await settle();
  };

  it('comes with the switcher when the switcher renders', async () => {
    await withSep();
    expect(container.querySelector('.crumb__sep')).not.toBeNull();
  });

  it('and is absent with it, so the trail never begins with a slash', async () => {
    // A client-portal user: no membership, no session, no console. The bar
    // cannot know that — only this component can — which is why it owns the
    // separator rather than rendering one beside it unconditionally.
    ME = { user_id: 'u1', org_roles: [] };
    payload = { data: [], support: [], default_id: null };
    await withSep();
    expect(container.querySelector('.crumb__sep')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('is not rendered in the mobile sheet, where there is no trail', async () => {
    await mount();   // no withSeparator
    expect(container.querySelector('.crumb__sep')).toBeNull();
  });
});

// ── The flex contract (measured against CSS, not against jsdom layout) ─────

describe('the trigger name does not clip', () => {
  it('is flex: 0 0 auto, so its width is never a pre-webfont max-content guess', () => {
    const rule = CSS.match(/\.orgsw__t-n\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/flex:\s*0 0 auto/);
    expect(rule).toMatch(/max-width:\s*170px/);
  });

  it('and .crumb__cur takes the min-width: 0 that lets the row ellipse instead', () => {
    // Without this the org name is unshrinkable AND the module name refuses to
    // go below its content, so the breadcrumb overflows rather than truncating.
    const rule = CSS.match(/\.crumb__cur\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('strips non-Latin before taking initials, so a matra never stands alone', () => {
    expect(swInitials('Aekam Inc')).toBe('AI');
    expect(swInitials('Mehta Associates')).toBe('MA');
    expect(swInitials('मेहता एंड असोसिएट्स')).toBe('•');
    expect(swInitials('Sundar Textiles Private Limited')).toBe('ST');
  });
});
