/**
 * F32 — a write control must render from the caller's LEVEL, not the page shell.
 *
 * Measured live on staging before the fix: a `ganit: viewer` was handed the
 * full Create Invoice form, composed a complete ₹88,500 invoice, and learned
 * only on submit that the level does not permit it; a member with NO grant was
 * offered `Run payroll` and walked through a month picker and a confirmation
 * modal to `Process and email`. The API refused every one — the gate is sound.
 * What was wrong is that the product invited the action and refused it last.
 *
 * `b9174f0` fixed the ONE control per page that passes through `ModuleHeader`.
 * These guard the other fifteen on Ganit alone, and the machinery that lets a
 * TAB — which is handed no module code — ask the question at all.
 *
 * The three states in `moduleAccess.js` are what actually needs defending, and
 * two of them mean "allow". A regression that greys out an org_admin's whole
 * product is worse than the bug, so `no opinion` and `no provider` are asserted
 * as loudly as the denial is.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: ModuleAccess } = await import('../components/module/ModuleAccess');
const { default: WriteGate } = await import('../components/module/WriteGate');
const { default: useModuleWrite } = await import('../hooks/useModuleWrite');
const { default: ProductsTab } = await import('../pages/ganit/ProductsTab');

let container = null;
let root = null;

/** `currentUser()` reads this key, so a level is set by writing the user. */
const signIn = (moduleLevels) => {
  const user = { user_id: 'user_fc914df642c3', name: 'QA Member', email: 'qa@example.com' };
  if (moduleLevels !== undefined) user.module_levels = moduleLevels;
  localStorage.setItem('Kartavaya_user', JSON.stringify(user));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  get.mockReset();
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/** Renders the hook's answer, so the three states can be asserted directly. */
function Probe({ module, label }) {
  const { canWrite, reason, module: resolved } = useModuleWrite({ module, label });
  return (
    <div
      data-testid="probe"
      data-can-write={String(canWrite)}
      data-module={String(resolved)}
    >
      {reason || ''}
    </div>
  );
}

const mount = (ui) => act(() => { root.render(ui); });
const probe = () => container.querySelector('[data-testid="probe"]');

describe('useModuleWrite — the three states', () => {
  it('DENIES a viewer, and says which level they hold', async () => {
    signIn({ ganit: 'viewer' });
    await mount(<ModuleAccess module="ganit"><Probe label="create invoices" /></ModuleAccess>);

    expect(probe().dataset.canWrite).toBe('false');
    // The API's own two sentences, not a paraphrase — the user reads the same
    // reason whether they hover the button or press it.
    expect(probe().textContent).toContain('Viewer');
    expect(probe().textContent).toContain('create invoices');
    expect(probe().textContent).toContain('Editor');
  });

  it('ALLOWS an editor', async () => {
    signIn({ ganit: 'editor' });
    await mount(<ModuleAccess module="ganit"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('true');
  });

  it('ALLOWS when the server expressed NO OPINION — an org_admin keeps every button', async () => {
    // `module_levels` absent entirely. This is the state that must not regress:
    // treating it as "no levels" disables the whole product for its owner.
    signIn(undefined);
    await mount(<ModuleAccess module="ganit"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('true');
  });

  it('DENIES on an EMPTY map — "granted nothing" is a real answer, not a missing one', async () => {
    signIn({});
    await mount(<ModuleAccess module="ganit"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('false');
    expect(probe().textContent).toContain("don't have access");
  });

  it('DENIES a level the ladder does not know, rather than failing upward', async () => {
    // `require_module` fails in this direction too. Advertising a write the API
    // then refuses is the whole bug.
    signIn({ ganit: 'wizard' });
    await mount(<ModuleAccess module="ganit"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('false');
  });

  it('gates NOTHING with no ModuleAccess above it — a forgotten provider fails OPEN', async () => {
    signIn({ ganit: 'viewer' });
    await mount(<Probe />);
    expect(probe().dataset.canWrite).toBe('true');
    expect(probe().dataset.module).toBe('null');
  });

  it('gates nothing on a route that is not a module — Today and Settings are untouched', async () => {
    signIn({ ganit: 'viewer' });
    await mount(<ModuleAccess module={undefined}><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('true');
  });

  it('reads the module from context, and lets an explicit prop win', async () => {
    signIn({ ganit: 'viewer', graha: 'admin' });
    await mount(<ModuleAccess module="ganit"><Probe /></ModuleAccess>);
    expect(probe().dataset.module).toBe('ganit');
    expect(probe().dataset.canWrite).toBe('false');

    await mount(<ModuleAccess module="ganit"><Probe module="graha" /></ModuleAccess>);
    expect(probe().dataset.module).toBe('graha');
    expect(probe().dataset.canWrite).toBe('true');
  });

  it('answers per module — a viewer on one is not a viewer on all', async () => {
    signIn({ ganit: 'viewer', vetana: 'editor' });
    await mount(<ModuleAccess module="vetana"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('true');
  });
});

describe('surface id vs grant code — `hub` is not a module anyone can hold', () => {
  it('reads a `hub` page against the SRIJAN grant', async () => {
    // `moduleColors` carries two entries for Srijan because it is two surfaces:
    // `hub` is the agency console at /hub, `srijan` the org's own at /hub/org.
    // `org_member_modules` knows only `srijan`. `ModuleHeader` spends its one
    // `module` prop on both the colour and the gate, and the three Hub pages
    // pass "hub" — so this asked about a code no grant row can contain and
    // greyed out the page's primary action for the user entitled to it.
    signIn({ srijan: 'editor' });
    await mount(<ModuleAccess module="hub"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('true');
  });

  it('still DENIES a srijan viewer reached through the `hub` id', async () => {
    // The translation must not become a way to slip past the gate.
    signIn({ srijan: 'viewer' });
    await mount(<ModuleAccess module="hub"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('false');
  });

  it('names the GRANT code in the denial — nobody can grant "hub"', async () => {
    signIn({});
    await mount(<ModuleAccess module="hub"><Probe /></ModuleAccess>);
    expect(probe().textContent).toContain('srijan');
    expect(probe().textContent).not.toContain('hub');
  });

  it('leaves the nine plain modules alone', async () => {
    signIn({ ganit: 'editor' });
    await mount(<ModuleAccess module="ganit"><Probe /></ModuleAccess>);
    expect(probe().dataset.canWrite).toBe('true');
  });
});

describe('WriteGate', () => {
  it('renders NO wrapper of its own when the caller may write', async () => {
    signIn({ ganit: 'editor' });
    await mount(
      <ModuleAccess module="ganit">
        <div data-testid="host"><WriteGate><button type="button">+ Invoice</button></WriteGate></div>
      </ModuleAccess>,
    );
    const host = container.querySelector('[data-testid="host"]');
    // The load-bearing assertion: for every org_admin this component must be
    // indistinguishable from not being there. A neutral-styled wrapper still
    // lands in a flex row and still breaks `:first-child`; no node cannot.
    expect(host.firstElementChild.tagName).toBe('BUTTON');
    expect(host.querySelector('.wg')).toBeNull();
  });

  it('makes the control inert and carries the reason when the caller may not', async () => {
    signIn({ ganit: 'viewer' });
    await mount(
      <ModuleAccess module="ganit">
        <WriteGate label="create invoices"><button type="button">+ Invoice</button></WriteGate>
      </ModuleAccess>,
    );
    const gate = container.querySelector('.wg');
    expect(gate).toBeTruthy();
    expect(gate.getAttribute('title')).toContain('Editor');

    // `inert={true}`, never `inert=""` — React 19 treats it as a BOOLEAN prop,
    // so an empty string is falsy and the attribute is dropped entirely. That
    // shipped once: the control rendered greyed and stayed clickable.
    const inner = gate.querySelector('.wg__in');
    expect(inner.hasAttribute('inert')).toBe(true);

    // Disabled, NOT hidden — the button is still on screen, and still readable.
    expect(gate.textContent).toContain('+ Invoice');
  });
});

describe('ProductsTab — the catalogue a viewer may read but not change', () => {
  const PRODUCT = {
    id: 'p-1', name: 'Office fit-out', hsn_code: '995461', unit: 'NOS',
    price: 325000, gst_rate: 18, is_service: false,
  };

  const render = async () => {
    get.mockImplementation(() => Promise.resolve({ data: { data: [PRODUCT] } }));
    await act(async () => {
      root.render(
        <ToastProvider>
          <ModuleAccess module="ganit"><ProductsTab /></ModuleAccess>
        </ToastProvider>,
      );
    });
    await act(async () => {});
  };

  const byText = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === t);

  it('offers every control to an editor', async () => {
    signIn({ ganit: 'editor' });
    await render();
    expect(byText('+ Add product or service').disabled).toBe(false);
    expect(byText('Edit').disabled).toBe(false);
    expect(byText('Delete').disabled).toBe(false);
  });

  it('disables create, edit and delete for a viewer, each carrying the reason', async () => {
    signIn({ ganit: 'viewer' });
    await render();

    for (const label of ['+ Add product or service', 'Edit', 'Delete']) {
      const btn = byText(label);
      expect(btn, `${label} should still be on screen — disabled, not hidden`).toBeTruthy();
      expect(btn.disabled, `${label} should be disabled`).toBe(true);
      expect(btn.getAttribute('title')).toContain('Editor');
    }
  });

  it('does not render the product name as a control when there is no editor to open', async () => {
    signIn({ ganit: 'viewer' });
    await render();
    expect(byText('Office fit-out')).toBeUndefined();
    expect(container.textContent).toContain('Office fit-out');
  });

  it('leaves the catalogue itself readable — this is viewer, not blocked', async () => {
    signIn({ ganit: 'viewer' });
    await render();
    expect(container.textContent).toContain('995461');
    expect(container.textContent).toContain('Office fit-out');
  });
});
