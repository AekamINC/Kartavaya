/**
 * Sahayak → Content: the table, and the three ways a paged list lies.
 *
 * The tab was a card grid with the whole post body in every card, no sort, no
 * paging, and a server-side ceiling of 100 rows. What replaced it can go wrong
 * in ways a green build does not notice — every serious defect this project has
 * found so far compiled, typechecked and bundled cleanly, so the assertions
 * below are about BEHAVIOUR reaching the server, not about markup existing.
 *
 * The three lies, each with a test:
 *
 *   1. A filter that changes what is listed while the pager stays on page 3 —
 *      an empty table over "51–75 of 4".
 *   2. A group header counting the rows of that group ON THIS PAGE while
 *      claiming to count the group.
 *   3. Filter chips counting the page rather than the library, so every chip
 *      shows the same number on every page.
 *
 * Rendered with react-dom directly: @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws. Same shape as
 * sahayakHub.test.jsx, which records the same constraint.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import ContentTab from '../ContentTab';

let container = null;
let root = null;

const item = (i, over = {}) => ({
  id: `c${i}`,
  title: `Item ${i}`,
  body: `The body of item ${i}, which used to be printed in full on the list.`,
  agent_type: i % 2 ? 'blog' : 'social_media',
  platform: i % 3 ? 'instagram' : null,
  status: i % 2 ? 'approved' : 'draft',
  credits_used: i,
  created_at: `2026-0${(i % 8) + 1}-1${i % 9}T10:00:00Z`,
  hashtags: ['#one', '#two'],
  ...over,
});

/** The page the API would return for a given query string. */
const page = (items, total, limit = 25, offset = 0) => ({
  data: { data: items, total, limit, offset, truncated: offset + items.length < total },
});

const FACETS = {
  data: {
    facets: {
      agent_type: { blog: 40, social_media: 59 },
      status: { approved: 50, draft: 49 },
      platform: { instagram: 66 },
    },
    total: 99,
  },
};

/** Records every /org/content URL the component asked for. */
let asked = [];

function serve(listResponse) {
  api.get.mockImplementation((url) => {
    if (String(url).includes('/facets')) return Promise.resolve(FACETS);
    asked.push(String(url));
    return Promise.resolve(listResponse(String(url)));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asked = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (el) => act(() => root.render(<ToastProvider>{el}</ToastProvider>));
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };
const lastUrl = () => asked[asked.length - 1];
const q = (url, key) => new URL(`http://x${url}`).searchParams.get(key);

const byText = (sel, label) =>
  [...container.querySelectorAll(sel)].find(n => n.textContent.trim().startsWith(label));

/* ── It asks the server, rather than slicing in the browser ───────────────── */

describe('Sahayak content — paging and sorting reach the API', () => {
  it('requests a bounded page, not the whole library', async () => {
    serve(() => page(Array.from({ length: 25 }, (_, i) => item(i)), 99));
    mount(<ContentTab />);
    await settle();

    expect(q(lastUrl(), 'limit')).toBe('25');
    expect(q(lastUrl(), 'offset')).toBe('0');
    // The old tab fetched everything and rendered everything. If a change ever
    // drops the page size, this is the line that notices.
    expect(container.querySelectorAll('tbody tr').length).toBeLessThanOrEqual(25);
  });

  it('shows the range and the total, so the size of the library is knowable', async () => {
    serve(() => page(Array.from({ length: 25 }, (_, i) => item(i)), 99));
    mount(<ContentTab />);
    await settle();
    expect(text()).toContain('1–25 of 99');
  });

  it('Next asks the server for the next offset', async () => {
    serve(url => page(
      Array.from({ length: 25 }, (_, i) => item(i + Number(q(url, 'offset') || 0))),
      99, 25, Number(q(url, 'offset') || 0),
    ));
    mount(<ContentTab />);
    await settle();

    await click(byText('button', 'Next'));
    expect(q(lastUrl(), 'offset')).toBe('25');
    expect(text()).toContain('26–50 of 99');
  });

  it('Previous is disabled on page one and Next on the last page', async () => {
    serve(() => page([item(1)], 1));
    mount(<ContentTab />);
    await settle();
    expect(byText('button', 'Previous').disabled).toBe(true);
    expect(byText('button', 'Next').disabled).toBe(true);
  });

  it('sorting is done by the server, and clicking the same column flips it', async () => {
    serve(() => page([item(1), item(2)], 2));
    mount(<ContentTab />);
    await settle();
    expect(q(lastUrl(), 'sort')).toBe('created_at');
    expect(q(lastUrl(), 'order')).toBe('desc');

    const title = byText('.sr-ct__sort', 'Title');
    await click(title);
    expect(q(lastUrl(), 'sort')).toBe('title');
    // A name column opens A–Z; a date column opens newest first.
    expect(q(lastUrl(), 'order')).toBe('asc');

    await click(byText('.sr-ct__sort', 'Title'));
    expect(q(lastUrl(), 'order')).toBe('desc');
  });

  it('marks the sorted column for assistive tech, not just with an arrow', async () => {
    serve(() => page([item(1)], 1));
    mount(<ContentTab />);
    await settle();
    const sorted = [...container.querySelectorAll('th')]
      .filter(th => th.getAttribute('aria-sort') !== 'none');
    expect(sorted).toHaveLength(1);
    expect(sorted[0].textContent).toContain('Created');
    expect(sorted[0].getAttribute('aria-sort')).toBe('descending');
  });
});

/* ── Lie 1: the pager surviving a filter change ───────────────────────────── */

describe('Sahayak content — changing what is listed returns to page one', () => {
  it('a new sort resets the offset', async () => {
    serve(url => page([item(1)], 99, 25, Number(q(url, 'offset') || 0)));
    mount(<ContentTab />);
    await settle();

    await click(byText('button', 'Next'));
    expect(q(lastUrl(), 'offset')).toBe('25');

    await click(byText('.sr-ct__sort', 'Title'));
    expect(q(lastUrl(), 'offset')).toBe('0');
  });

  it('a new agent filter resets the offset', async () => {
    serve(url => page([item(1)], 99, 25, Number(q(url, 'offset') || 0)));
    mount(<ContentTab />);
    await settle();

    await click(byText('button', 'Next'));
    expect(q(lastUrl(), 'offset')).toBe('25');

    await click(byText('.hb-chip', 'Blog'));
    expect(q(lastUrl(), 'offset')).toBe('0');
    expect(q(lastUrl(), 'agent_type')).toBe('blog');
  });
});

/* ── Lie 2: a group that is only this page's slice ────────────────────────── */

describe('Sahayak content — grouping', () => {
  it('grouping by a column also sorts by it, or a group is only a page slice', async () => {
    serve(() => page([item(1), item(2)], 2));
    mount(<ContentTab />);
    await settle();

    const select = [...container.querySelectorAll('select')]
      .find(s => [...s.options].some(o => o.value === 'agent_type'));
    await act(async () => {
      select.value = 'agent_type';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    expect(q(lastUrl(), 'sort')).toBe('agent_type');
    expect(q(lastUrl(), 'offset')).toBe('0');
  });

  it('renders one header per contiguous group, not one per row', async () => {
    // Two blogs then two socials, already ordered the way the server would.
    const items = [
      item(1, { agent_type: 'blog' }), item(3, { agent_type: 'blog' }),
      item(2, { agent_type: 'social_media' }), item(4, { agent_type: 'social_media' }),
    ];
    serve(() => page(items, 4));
    mount(<ContentTab />);
    await settle();

    const select = [...container.querySelectorAll('select')]
      .find(s => [...s.options].some(o => o.value === 'agent_type'));
    await act(async () => {
      select.value = 'agent_type';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    const heads = container.querySelectorAll('.sr-ct__grp');
    expect(heads).toHaveLength(2);
    expect(heads[0].textContent).toContain('Blog');
    expect(heads[0].textContent).toContain('2');
  });
});

/* ── Lie 3: chips counting the page ───────────────────────────────────────── */

describe('Sahayak content — the chip counts describe the library', () => {
  it('counts come from the facets endpoint, not from the rows on screen', async () => {
    // One row on screen; the library holds 99. A chip that read the page would
    // say 1.
    serve(() => page([item(1, { agent_type: 'blog' })], 99));
    mount(<ContentTab />);
    await settle();

    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/org/content/facets'));
    const blog = byText('.hb-chip', 'Blog');
    expect(blog.textContent).toContain('40');
    expect(byText('.hb-chip', 'All').textContent).toContain('99');
  });
});

/* ── The body is behind a click ───────────────────────────────────────────── */

describe('Sahayak content — the prose is not in the list', () => {
  it('the row shows a clamped peek, and the full body only after opening it', async () => {
    const long = 'x'.repeat(400);
    serve(() => page([item(1, { body: long })], 1));
    mount(<ContentTab />);
    await settle();

    // The whole point of the change: 400 characters must not be in the table.
    const peek = container.querySelector('.sr-ct__peek');
    expect(peek.textContent.length).toBeLessThanOrEqual(90);
    expect(container.querySelector('.sr-cd__body')).toBeNull();

    await click(container.querySelector('.sr-ct__open'));
    const body = document.querySelector('.sr-cd__body');
    expect(body).toBeTruthy();
    expect(body.textContent).toHaveLength(400);
  });

  it('opening a row does not refetch the list', async () => {
    serve(() => page([item(1)], 1));
    mount(<ContentTab />);
    await settle();
    const before = asked.length;

    await click(container.querySelector('.sr-ct__open'));
    expect(asked.length).toBe(before);
  });
});

/* ── The rule the whole cluster is built on ───────────────────────────────── */

describe('Sahayak content — a failed load is not an empty library', () => {
  it('reports the failure and never says nothing has been generated', async () => {
    api.get.mockRejectedValue({ response: { status: 500, data: { detail: 'upstream is down' } } });
    mount(<ContentTab />);
    await settle();

    expect(text()).toContain('did not load');
    expect(text()).not.toContain('Nothing generated yet');
  });

  it('filtered to nothing is not the empty state', async () => {
    serve(url => (q(url, 'agent_type') ? page([], 0) : page([item(1)], 99)));
    mount(<ContentTab />);
    await settle();

    await click(byText('.hb-chip', 'Blog'));
    expect(text()).toContain('Nothing matches that filter');
    expect(text()).not.toContain('Nothing generated yet');
  });
});
