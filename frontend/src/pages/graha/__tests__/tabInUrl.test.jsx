/**
 * The open tab lives in the URL.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. `/graha/deals/:dealId` and
 * `/vikray/orders/:orderId` render as CHILDREN of their module page, so the
 * list stays mounted underneath and Back returns the reader to the list they
 * left. That works — but only for a reader who was already there.
 *
 * A COLD arrival — a bookmark, a link in an email, a refresh — mounted the
 * module with no state at all, so the list underneath was the STARRED DEFAULT
 * rather than the one the record belongs to, and Back landed the reader
 * somewhere they had never been. The tab was `useState(null)` and the page's
 * own comment said so: "no URL param, no route state".
 *
 * Rendered with react-dom directly, and wrapped in `ToastProvider`.
 * `@testing-library/react` is installed but its `@testing-library/dom` peer is
 * not, so importing it throws — the same constraint `noFollowUp.test.jsx`,
 * `kanbanTab.test.jsx` and `grahaTabStates.test.jsx` all record. Both pages
 * also register a response interceptor on mount, so a transport without one
 * throws before anything renders.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(async () => ({ data: { data: [], total: 0 } })),
    post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { ToastProvider } from '../../../components/ui/toast';

let container;
let root;

const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

/** Mount a module page at a URL, the way a cold arrival reaches it. */
const mountAt = async (ui, url) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>,
    );
  });
  await settle();
};

const text = () => container.textContent || '';

describe('a cold arrival opens the tab the URL names', () => {
  it('Graha opens Contacts when asked, not its starred default', async () => {
    const { default: GrahaPage } = await import('../../GrahaPage');
    await mountAt(<GrahaPage />, '/graha?tab=contacts');

    // `contacts` is NOT Graha's default — the module opens on `pipeline` — so
    // seeing contact-shaped chrome proves the URL won rather than coinciding
    // with the fallback. Asserted on the tab bar's own active marking rather
    // than on tab content, which needs data this harness does not serve.
    const active = container.querySelector('[aria-selected="true"], .is-active, [data-active="true"]');
    expect(active, 'no tab is marked active').toBeTruthy();
    expect(active.textContent.toLowerCase()).toContain('contact');
  });

  it('Vikray opens Customers when asked', async () => {
    const { default: VikrayPage } = await import('../../VikrayPage');
    await mountAt(<VikrayPage />, '/vikray?tab=customers');

    const active = container.querySelector('[aria-selected="true"], .is-active, [data-active="true"]');
    expect(active, 'no tab is marked active').toBeTruthy();
    expect(active.textContent.toLowerCase()).toMatch(/customer|खरीदार/);
  });

  it('an unknown tab falls back instead of rendering an empty module', async () => {
    // A hand-edited or stale URL must not produce a blank page. This is the
    // failure mode of driving a component off a raw query string.
    const { default: GrahaPage } = await import('../../GrahaPage');
    await mountAt(<GrahaPage />, '/graha?tab=not-a-real-tab');
    expect(text().length).toBeGreaterThan(0);
    const active = container.querySelector('[aria-selected="true"], .is-active, [data-active="true"]');
    expect(active, 'the module rendered no active tab at all').toBeTruthy();
  });
});

describe('the source says so', () => {
  it('neither page holds the tab in local state any more', async () => {
    const fs = await import('fs');
    for (const f of ['src/pages/GrahaPage.jsx', 'src/pages/VikrayPage.jsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, `${f} does not read the URL`).toContain('useSearchParams');
      expect(src, `${f} still keeps the tab in useState`)
        .not.toContain('const [picked, setTab] = useState(null)');
    }
  });

  it('the tab writer preserves the other params', async () => {
    // Both pages carry more than `tab` on the URL. A fresh URLSearchParams
    // would silently drop them, which is the quiet way a filter or an open
    // record disappears when somebody clicks a tab.
    const fs = await import('fs');
    for (const f of ['src/pages/GrahaPage.jsx', 'src/pages/VikrayPage.jsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, `${f} rebuilds the params from scratch`)
        .toContain('new URLSearchParams(prev)');
    }
  });

  it('switching tabs replaces rather than pushes', async () => {
    // Hopping tabs must not fill the history stack, or Back walks backwards
    // through every tab visited instead of leaving the module. Opening a
    // record is a real push and stays one.
    const fs = await import('fs');
    for (const f of ['src/pages/GrahaPage.jsx', 'src/pages/VikrayPage.jsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, `${f} pushes a history entry per tab click`)
        .toContain('replace: true');
    }
  });
});
