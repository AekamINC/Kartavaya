/**
 * A CRM can have more than one pipeline. Until this file, nobody could make one.
 *
 * ── THE SHAPE OF THE DEFECT ────────────────────────────────────────────────
 * `POST /v1/graha/pipelines` has existed since the module shipped, alongside
 * `GET /pipelines` and a `deals_kanban` that already takes `?pipeline_id=`.
 * `DealCreate.pipeline_id` is accepted and proved against the caller's org by
 * `resolve_deal_pipeline`; `_DEAL_COLS` carries `pipeline_id` so a deal can be
 * moved. Every part of it worked.
 *
 * A grep for `pipelines` across `frontend/src` returned ONE hit — the word
 * inside a module-catalogue blurb. Nothing called any of it.
 *
 * What happened instead: `create_deal` silently INSERTs a pipeline called
 * "Default Pipeline" the first time a deal is raised without one. So every org
 * has exactly one pipeline that nobody typed, `/deals/kanban` serves that one
 * board, and Suite 04.18's "a second pipeline can be created by a person"
 * could not be reached at all. Live at the time: one pipeline, named
 * "Default Pipeline".
 *
 * ⚠ AND THE EMPTY STATE POINTED SOMEWHERE THAT HAD NOTHING EITHER.
 * `PipelineTab`'s own words were "Create one from the Deals tab and your board
 * appears here". The Deals tab has never carried such a control — 04.18
 * enumerated every button on both screens to establish it. An empty state that
 * names a place with nothing in it costs the reader the trip and teaches them
 * the product is lying.
 *
 * ── WHY THE CREATE CONTROL ALONE WOULD NOT HAVE BEEN A FIX ─────────────────
 * `create_deal` puts every new deal on the org's DEFAULT pipeline, and no form
 * sent a `pipeline_id`. So a second pipeline would have been a board that
 * could never hold anything — a control that reports success and changes
 * nothing a person can see, which is the failure mode this programme keeps
 * finding. The picker on the create form and the move on the record are part
 * of the same repair, and are pinned here for that reason.
 *
 * Rendered with react-dom directly — `@testing-library/react` is installed and
 * its `@testing-library/dom` peer is not, so importing it throws.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    api: {
      get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
      interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
    },
  };
});

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import PipelineTab from '../PipelineTab';

const DEFAULT_PIPE = { id: 'pl-1', name: 'Default Pipeline', is_default: true };
const SECOND_PIPE = { id: 'pl-2', name: 'Retainers', is_default: false };

let pipelines = [DEFAULT_PIPE];
let kanban = { stages: [], columns: {} };
const kanbanCalls = [];

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  pipelines = [DEFAULT_PIPE];
  kanban = { stages: [], columns: {} };
  kanbanCalls.length = 0;
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u.startsWith('/v1/graha/pipelines')) return Promise.resolve({ data: { data: pipelines } });
    if (u.startsWith('/v1/graha/deals/kanban')) { kanbanCalls.push(u); return Promise.resolve({ data: kanban }); }
    if (u.startsWith('/v1/graha/follow-ups')) return Promise.resolve({ data: { data: [], truncated: false } });
    if (u.startsWith('/v1/graha/reports/forecast')) return Promise.resolve({ data: { stages: [] } });
    return Promise.resolve({ data: { data: [] } });
  });
  api.post.mockResolvedValue({ data: { status: 'created', id: 'pl-2', name: 'Retainers' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastProvider><PipelineTab /></ToastProvider>
      </MemoryRouter>,
    );
  });
  await settle();
};

const all = (sel) => Array.from(container.querySelectorAll(sel));
const nameBox = () => all('input.k-input').find((i) => /new pipeline/i.test(
  i.closest('label')?.textContent || ''));
const createBtn = () => all('button').find((b) => /^Create$/.test(b.textContent || ''));
const picker = () => all('select.k-input').find((sel) => /pipeline/i.test(
  sel.closest('label')?.textContent || ''));

const type = async (el, value) => {
  const proto = el instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const { set } = Object.getOwnPropertyDescriptor(proto, 'value');
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  await settle();
};

describe('Graha — a pipeline can be created by a person', () => {
  it('offers a name box and a Create control on the empty board', async () => {
    /**
     * ⚠ REACHABLE, NOT MERELY PRESENT.
     *
     * The first revision asserted only that the two nodes existed, and stayed
     * GREEN under a mutation that left them in the DOM with `hidden` and
     * `display: none` — a control nobody can use passes an existence check
     * exactly as well as one they can. That is this programme's dominant
     * finding, reproduced in the test written to catch it, so the check is
     * now for the two states jsdom can actually see: not hidden, and the box
     * itself not disabled. (`Create` IS disabled here, deliberately — an
     * empty name has nothing to send, which the third test pins.)
     */
    await mount();
    const box = nameBox();
    const btn = createBtn();
    expect(
      box,
      'THE DEFECT: no control anywhere in the product creates a pipeline, and '
      + '`POST /v1/graha/pipelines` has been reachable the whole time',
    ).toBeTruthy();
    expect(btn).toBeTruthy();
    for (const [what, el] of [['name box', box], ['Create button', btn]]) {
      expect(el.hidden, `the ${what} is in the DOM and hidden`).toBe(false);
      expect(
        el.closest('[hidden], [style*="display: none"], [style*="display:none"]'),
        `the ${what} sits inside a hidden container, so nobody can reach it`,
      ).toBeNull();
    }
    expect(box.disabled, 'the name box is disabled').toBe(false);
  });

  it('no longer sends the reader to a Deals tab that has no such control', async () => {
    await mount();
    const text = container.textContent || '';
    expect(
      /Create one from the Deals tab/i.test(text),
      'the empty state still names the Deals tab, which has never carried a '
      + 'control that makes a pipeline',
    ).toBe(false);
    expect(text).toMatch(/No pipeline set up yet/i);
  });

  it('posts the typed name, and the button stays refused until there is one', async () => {
    await mount();
    expect(createBtn().disabled, 'Create is live with an empty name box').toBe(true);

    await type(nameBox(), 'Retainers');
    expect(createBtn().disabled).toBe(false);
    await act(async () => {
      createBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/graha/pipelines');
    expect(payload.name).toBe('Retainers');
  });

  it('shows the board it just made, rather than reporting success and staying put', async () => {
    pipelines = [DEFAULT_PIPE, SECOND_PIPE];
    await mount();
    await type(nameBox(), 'Retainers');
    await act(async () => {
      createBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
    expect(
      kanbanCalls.some((u) => u.includes('pipeline_id=pl-2')),
      'the pipeline was created and the board never went to look at it — a '
      + 'control that reports success and changes nothing on screen',
    ).toBe(true);
  });

  it('offers a picker once there is a second board, and not before', async () => {
    await mount();
    expect(
      picker(),
      'a picker is drawn over a single pipeline: a select with one option '
      + 'nobody can get wrong',
    ).toBeFalsy();

    pipelines = [DEFAULT_PIPE, SECOND_PIPE];
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await mount();
    expect(
      picker(),
      'two pipelines exist and only one of them can ever be looked at',
    ).toBeTruthy();
    expect((picker().textContent || '')).toContain('Retainers');
  });

  it('loads the board the picker names', async () => {
    pipelines = [DEFAULT_PIPE, SECOND_PIPE];
    await mount();
    kanbanCalls.length = 0;
    await type(picker(), 'pl-2');
    expect(
      kanbanCalls.some((u) => u.includes('pipeline_id=pl-2')),
      'the picker changes and the board does not follow it',
    ).toBe(true);
  });

  it('leaves the default board unqualified when nothing is picked', async () => {
    await mount();
    expect(
      kanbanCalls[0],
      'an unset selection must send no pipeline_id at all — `deals_kanban` '
      + 'falls back to the org default, which is the behaviour this tab has '
      + 'always had',
    ).toBe('/v1/graha/deals/kanban');
  });
});
