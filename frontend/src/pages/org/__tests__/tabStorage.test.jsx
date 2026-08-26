/**
 * TabStorage — the screen that must not draw an id, on a bucket made of ids.
 *
 * `routers/storage_browser.py` shipped with no caller at all. The reason this
 * suite is mostly about NAMES rather than about listing files is what is
 * actually in the two in-scope orgs' buckets, read live on 2026-08-26:
 *
 *     E2E Test & Associates    6 objects   0 in the new key grammar
 *     Unicode Group           89 objects   0 in the new key grammar
 *
 * and the folders those 95 sit under are `personal/user_…`,
 * `pahchan/{employee uuid}` and `projects/team_…`. So the first click on this
 * tab is the exact shape of the defect `check-rendered-ids.mjs` exists for —
 * `mobile/src/components/TaskCard.tsx` drawing `task_id.slice(0, 8)` — except
 * that here the id is not a decoration, it is the folder. A screen that renders
 * `folders[].name` breaks the owner's rule on arrival, and a screen that
 * FILTERS id-shaped folders out cannot reach any of the 95 objects.
 *
 * So: the server resolves the id to the name of the thing, and these hold the
 * client to rendering that and nothing else.
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern (see `src/__tests__/orgSenders.test.jsx`) and is NOT installed — its
 * @testing-library/dom peer is missing, so importing it throws.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider } from '../../../components/ui/toast';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A member's real user id shape, and an employee's. Neither may be drawn. */
const USER_ID = 'user_a1b2c3d4e5f6';
const EMPLOYEE_ID = '11111111-2222-3333-4444-555555555555';
const ORG_ID = '64e7bea6-6abe-490c-a2a4-27a60c6be916';

const OVERVIEW = {
  org: 'E2E Test & Associates',
  own_account: false,
  bucket: null,
  used_bytes: 20182,
  limit_bytes: 10737418240,
  used_label: '19.7 KB',
  limit_label: '10.0 GB',
  used_pct: 0.0,
  used_note: 'Counted as files are uploaded through the paths that report their size. '
    + 'Documents written by e-sign, attendance, marketing and the scrapers are not '
    + 'added to this figure yet, so the real total is higher.',
  modules: ['esign', 'projects', 'crm', 'srijan', 'personal', 'pahchan', 'procurement'],
};

/** The top level, as the live bucket returns it: two module folders. */
const TOP = {
  prefix: '',
  configured: true,
  folders: [
    { name: 'pahchan', prefix: 'pahchan/', label: 'Attendance photographs', kind: null, is_id: false },
    { name: 'personal', prefix: 'personal/', label: 'Personal uploads', kind: null, is_id: false },
  ],
  files: [],
  next_cursor: null,
  truncated: false,
};

/** One level down: the folder names ARE ids. One resolves, one does not. */
const INSIDE = {
  prefix: 'pahchan/',
  configured: true,
  folders: [
    { name: EMPLOYEE_ID, prefix: `pahchan/${EMPLOYEE_ID}/`, label: 'Ramesh Patel', kind: 'Employee', is_id: true },
    { name: USER_ID, prefix: `personal/${USER_ID}/`, label: null, kind: "A member's own files", is_id: true },
  ],
  files: [
    {
      name: '01M0PD8DD09QVSEPMHQ7M6RN91--clock-in.jpg',
      key: `pahchan/${EMPLOYEE_ID}/2026/08/01M0PD8DD09QVSEPMHQ7M6RN91--clock-in.jpg`,
      label: 'clock-in.jpg',
      is_id: false,
      size_bytes: 20182,
      size_label: '19.7 KB',
      last_modified: '2026-08-20T09:15:00Z',
    },
  ],
  next_cursor: null,
  truncated: false,
};

const RESOLVED = {
  key: `org/${ORG_ID}/pahchan/${EMPLOYEE_ID}/2026/08/01M0--clock-in.jpg`,
  parsed: {
    relative: `pahchan/${EMPLOYEE_ID}/2026/08/01M0--clock-in.jpg`,
    matches_grammar: true,
    module: 'pahchan',
    year: '2026',
    month: '08',
    display: 'Attendance photographs / Ramesh Patel / 2026-08 / clock-in.jpg',
  },
  record: { kind: 'Attendance photograph', table: 'pahchan_punches', label: 'Ramesh Patel' },
  object_present: false,
  size_bytes: null,
  size_label: null,
  summary: 'Attendance photograph: Ramesh Patel — but the object is NOT in the bucket. '
    + 'This record points at a file the storage does not have.',
};

let browsePayload = TOP;
let overviewPayload = OVERVIEW;
const posts = [];

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn((url) => {
      if (url === '/v1/org/storage') {
        return overviewPayload instanceof Error
          ? Promise.reject(overviewPayload)
          : Promise.resolve({ data: overviewPayload });
      }
      return browsePayload instanceof Error
        ? Promise.reject(browsePayload)
        : Promise.resolve({ data: browsePayload });
    }),
    post: vi.fn((url, body) => {
      posts.push({ url, body });
      return Promise.resolve({ data: RESOLVED });
    }),
  },
}));

const { default: TabStorage } = await import('../TabStorage');
const { api } = await import('../../../lib/api');

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { return check(); } catch (err) {
      if (Date.now() > deadline) throw err;
      await settle(15);
    }
  }
};

const mount = async () => {
  await act(async () => {
    root.render(<ToastProvider><TabStorage /></ToastProvider>);
  });
  await settle();
};

const text = () => container.textContent;
const buttons = () => [...container.querySelectorAll('button')];
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };

beforeEach(() => {
  browsePayload = TOP;
  overviewPayload = OVERVIEW;
  posts.length = 0;
  api.get.mockClear();
  api.post.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = '';
});

describe('TabStorage', () => {
  it('calls the three endpoints the router shipped with no caller', async () => {
    await mount();
    await until(() => {
      const urls = api.get.mock.calls.map(c => c[0]);
      expect(urls).toContain('/v1/org/storage');
      expect(urls).toContain('/v1/org/storage/browse');
    });
  });

  it('renders the top level as words, not as module keys', async () => {
    await mount();
    await until(() => {
      expect(text()).toContain('Attendance photographs');
      expect(text()).toContain('Personal uploads');
    });
  });

  it('NEVER draws a folder whose name is an id', async () => {
    browsePayload = INSIDE;
    await mount();
    await until(() => expect(text()).toContain('Ramesh Patel'));

    // The id resolved to a person, so the person is what is on screen.
    expect(text()).not.toContain(EMPLOYEE_ID);
    // The one that resolved to nothing renders as WHAT it is. Not as the id,
    // and not omitted — the object is real and counts against the allowance.
    expect(text()).toContain("A member's own files");
    expect(text()).not.toContain(USER_ID);
  });

  it('still navigates into a folder whose name it refuses to draw', async () => {
    browsePayload = INSIDE;
    await mount();
    await until(() => expect(text()).toContain("A member's own files"));

    const folder = buttons().find(b => /A member's own files/.test(b.textContent));
    expect(folder).toBeTruthy();
    await click(folder);

    // The id travels as an ADDRESS — the prefix the server gave — and the crumb
    // that appears carries the label, never the segment.
    await until(() => {
      const params = api.get.mock.calls.map(c => c[1]?.params?.prefix).filter(Boolean);
      expect(params).toContain(`personal/${USER_ID}/`);
    });
    expect(text()).not.toContain(USER_ID);
  });

  it('asks the resolver about a file and shows the answer as a sentence', async () => {
    browsePayload = INSIDE;
    await mount();
    await until(() => expect(text()).toContain('clock-in.jpg'));

    const ask = buttons().find(b => /what is this/i.test(b.textContent));
    await click(ask);

    await until(() => {
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe('/v1/org/storage/resolve');
      expect(posts[0].body.key).toBe(INSIDE.files[0].key);
    });

    // The sheet is portalled to <body>, so read the document rather than the
    // mount point.
    await until(() => {
      expect(document.body.textContent).toContain('the object is NOT in the bucket');
    });
  });

  it('draws the resolved key as a path of names, never as the key', async () => {
    browsePayload = INSIDE;
    await mount();
    await until(() => expect(text()).toContain('clock-in.jpg'));
    await click(buttons().find(b => /what is this/i.test(b.textContent)));

    await until(() => {
      const shown = document.body.textContent;
      expect(shown).toContain('Attendance photographs / Ramesh Patel / 2026-08 / clock-in.jpg');
      // `key` carries the ORG id and `parsed.relative` carries the EMPLOYEE id.
      // Neither is a spelling this screen may render.
      expect(shown).not.toContain(ORG_ID);
      expect(shown).not.toContain(EMPLOYEE_ID);
    });
  });

  it('says so when the organisation has no storage at all', async () => {
    browsePayload = { prefix: '', configured: false, folders: [], files: [], next_cursor: null };
    await mount();
    await until(() => expect(text()).toContain('No storage is set up'));
  });

  it('does not render an empty browser when the listing fails', async () => {
    browsePayload = new Error('boom');
    await mount();
    await until(() => expect(text()).toContain('could not be listed'));
    expect(text()).not.toContain('Nothing here');
  });

  it('records the backfill nobody has run, rather than looking empty', async () => {
    await mount();
    await until(() => expect(text()).toContain('separate pass'));
  });

  it('never presents the running total as a measurement', async () => {
    // `organisations.storage_used_bytes` read 20,182 bytes on 2026-08-27
    // against a bucket holding 89,591,092 — only two of the upload paths
    // increment it. A tile labelled "Used" over that number, and a meter
    // reading 0%, would both be confident wrong answers.
    await mount();
    await until(() => expect(text()).toContain('Recorded as used'));
    expect(text()).toContain('not added to this figure yet');
    expect(text()).toContain('% recorded');
  });

  it('offers no way to delete a file', async () => {
    browsePayload = INSIDE;
    await mount();
    await until(() => expect(text()).toContain('clock-in.jpg'));
    // A file here is a POINTER held in a column; deleting the object without
    // the row produces exactly the failure this tab exists to diagnose.
    expect(buttons().some(b => /delete|remove/i.test(b.textContent))).toBe(false);
  });
});
