/**
 * Two tabs, two organisations — and neither may move the other.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `orgContext` kept the active org in `localStorage`, which every tab of an
 * origin shares. `setActiveOrg` reloads the document so nothing from the old
 * org survives — a real guarantee, for the ONE tab doing the switching. The
 * other tab got no reload and no event:
 *
 *     tab A  open on org X, showing X's invoices
 *     tab B  switch to org Y   ->  localStorage = Y, tab B reloads (correct)
 *     tab A  next request      ->  X-Org-Id: Y, under a screen that says X
 *
 * Nothing throws. The server is asked a legitimate question about an org the
 * caller does belong to, and answers it truthfully — so tab A draws the other
 * company's rows beneath X's heading, filters and totals, and a write from that
 * screen lands in Y. This is the failure mode the module's own docstring calls
 * "one stale render away from billing the wrong company", left open in the tab
 * the operator was not looking at.
 *
 * It became reachable the moment every destination in the shell became a real
 * link: the product now invites the second tab that triggers it.
 *
 * ── HOW A TAB IS SIMULATED ──────────────────────────────────────────────────
 *
 * A tab is exactly a distinct `sessionStorage` over a shared `localStorage`,
 * which is what the two web storages already are. So the fake below IS the
 * mechanism under test rather than a stand-in for it: `openTab()` hands out a
 * fresh session store, `openTabFromLink()` clones the opener's the way a
 * browser does for `target=_blank`, and the module is re-imported per tab so
 * nothing carries over in module scope.
 *
 * These tests fail on the previous implementation — every one of them, because
 * `localStorage` alone cannot express "this tab" at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A storage that behaves like the real one: values are strings, absent is null. */
function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map),
  };
}

/** A storage that throws on every access — private-mode Safari. */
function makeHostileStore() {
  const boom = () => { throw new DOMException('denied', 'SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const KEY = 'Kartavaya_active_org';

/** The one store every tab shares. */
let shared;

/**
 * Open a tab: install its storages globally and hand back a fresh copy of the
 * module reading them.
 */
async function openTab(sessionStore = makeStore()) {
  vi.stubGlobal('sessionStorage', sessionStore);
  vi.stubGlobal('localStorage', shared);
  vi.resetModules();
  const mod = await import('../lib/orgContext.js');
  return { ...mod, session: sessionStore };
}

/** A tab opened from a link in the app — the browser clones sessionStorage. */
function openTabFromLink(parent) {
  return makeStore(parent.session._dump());
}

/** Re-enter an already-open tab, so its stores are the live ones again. */
async function inTab(tab) {
  return openTab(tab.session);
}

beforeEach(() => {
  shared = makeStore();
  // `setActiveOrg` navigates, and jsdom cannot. The navigation is asserted
  // separately below rather than being silently swallowed.
  vi.stubGlobal('location', { assign: vi.fn() });
});

describe('the anti-vacuity floor', () => {
  it('reads a selection at all', async () => {
    shared.setItem(KEY, 'org-alpha');
    const tab = await openTab();
    // If this returned null the whole file would pass over a module that had
    // simply stopped working, since most claims below are about ABSENCE of
    // change.
    expect(tab.getActiveOrg()).toBe('org-alpha');
  });

  it('a switch really does write, and really does navigate', async () => {
    const tab = await openTab();
    tab.setActiveOrg('org-beta');
    expect(tab.getActiveOrg()).toBe('org-beta');
    expect(shared.getItem(KEY)).toBe('org-beta');
    expect(location.assign).toHaveBeenCalledWith('/today');
  });
});

describe('a switch in one tab does not move another', () => {
  it('THE DEFECT: tab A keeps its org when tab B switches', async () => {
    shared.setItem(KEY, 'org-X');

    const tabA = await openTab();
    expect(tabA.getActiveOrg()).toBe('org-X');   // A pins X on first read

    const tabB = await openTab();
    tabB.setActiveOrg('org-Y');
    expect(tabB.getActiveOrg()).toBe('org-Y');

    const a = await inTab(tabA);
    expect(a.getActiveOrg()).toBe('org-X');
  });

  it('and keeps it however many times the other tab switches', async () => {
    shared.setItem(KEY, 'org-X');
    const tabA = await openTab();
    tabA.getActiveOrg();

    for (const org of ['org-Y', 'org-Z', 'org-W']) {
      const other = await openTab();
      other.setActiveOrg(org);
    }

    const a = await inTab(tabA);
    expect(a.getActiveOrg()).toBe('org-X');
  });

  it('a tab pinned to the SERVER DEFAULT stays there too', async () => {
    // The '' sentinel: absent means "not yet pinned", empty means "pinned to
    // no selection". Collapsing the two would let this tab drift to org-Y.
    const tabA = await openTab();
    expect(tabA.getActiveOrg()).toBeNull();

    const tabB = await openTab();
    tabB.setActiveOrg('org-Y');

    const a = await inTab(tabA);
    expect(a.getActiveOrg()).toBeNull();
  });
});

describe('where a new tab starts', () => {
  it('opened from a link: the SAME org as the tab it came from', async () => {
    shared.setItem(KEY, 'org-X');
    const tabA = await openTab();
    tabA.getActiveOrg();

    const tabB = await openTab();
    tabB.setActiveOrg('org-Y');          // the shared default is now Y

    // "Open this invoice in a new tab" from A must show A's org, not Y.
    const child = await openTab(openTabFromLink(tabA));
    expect(child.getActiveOrg()).toBe('org-X');
  });

  it('opened cold: the org last chosen', async () => {
    shared.setItem(KEY, 'org-X');
    const tabB = await openTab();
    tabB.setActiveOrg('org-Y');

    const cold = await openTab();        // typed, restored, a second window
    expect(cold.getActiveOrg()).toBe('org-Y');
  });
});

describe('sign-out', () => {
  it('leaves nothing for the next PERSON in this tab', async () => {
    shared.setItem(KEY, 'org-X');
    const tab = await openTab();
    tab.getActiveOrg();

    // THE PRECONDITION, asserted rather than assumed. Without it this test is
    // satisfied by its own shape: an implementation that never writes to
    // sessionStorage at all passes "it is null afterwards" vacuously, and this
    // one did — the check below stayed green against the very defect the file
    // exists to catch until this line was added.
    expect(tab.session.getItem(KEY)).toBe('org-X');

    tab.clearActiveOrg();

    // Both stores, and the session one is the one that matters: it outlives a
    // sign-out inside the same tab, which is exactly where the next user is.
    expect(tab.session.getItem(KEY)).toBeNull();
    expect(shared.getItem(KEY)).toBeNull();

    const next = await inTab(tab);
    expect(next.getActiveOrg()).toBeNull();
  });
});

describe('storage that refuses', () => {
  it('falls back to the shared default rather than throwing', async () => {
    shared.setItem(KEY, 'org-X');
    const tab = await openTab(makeHostileStore());
    // Private-mode Safari: no per-tab pin is possible, so the behaviour is the
    // one that shipped before — shared, but working. A switcher that threw
    // would take the whole shell down with it.
    expect(() => tab.getActiveOrg()).not.toThrow();
    expect(tab.getActiveOrg()).toBe('org-X');
  });

  it('a switch still navigates when neither store can be written', async () => {
    vi.stubGlobal('localStorage', makeHostileStore());
    vi.resetModules();
    const mod = await import('../lib/orgContext.js');
    expect(() => mod.setActiveOrg('org-Y')).not.toThrow();
    expect(location.assign).toHaveBeenCalledWith('/today');
  });
});
