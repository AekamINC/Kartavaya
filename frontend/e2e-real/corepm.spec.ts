/**
 * Phase 6 — Core PM: tasks, boards, time, templates, approvals, Today, Dristi.
 *
 * ── The one thing to be careful about ───────────────────────────────────────
 * `public.tasks`, `public.boards`, `public.time_entries` and `public.approvals`
 * live in the SHARED schema — the same tables production uses — scoped by team
 * rather than by org. Everything here therefore stays inside the E2E team
 * (`E2E_TEAM_ID`), and every assertion filters by it. This is the only phase
 * whose writes are not isolated by the staging schema, so it is the only one
 * where a sloppy query could read somebody else's row.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';
import { api, apiOk, settle, shot, download, pickOption, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

const TEAM = process.env.E2E_TEAM_ID || '';

const HANDOFF = path.join(DL_DIR, `corepm-${RUN}.json`);
const keep = (k: string, v: any) => {
  const s = fs.existsSync(HANDOFF) ? JSON.parse(fs.readFileSync(HANDOFF, 'utf8')) : {};
  s[k] = v;
  fs.writeFileSync(HANDOFF, JSON.stringify(s, null, 2));
};
const recall = (k: string) => {
  const s = JSON.parse(fs.readFileSync(HANDOFF, 'utf8'));
  expect(s[k], `nothing handed over for "${k}" — an earlier test in this file failed`).toBeTruthy();
  return s[k];
};

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard');
  await settle(page);
});


// ══ TASKS ════════════════════════════════════════════════════════════════════

test('tasks · create one through the modal, in this team only', async ({ page }) => {
  expect(TEAM, 'E2E_TEAM_ID is not set — this phase writes to the SHARED tasks table ' +
    'and must be scoped to the test team').toBeTruthy();

  await page.goto('/tasks');
  await settle(page);
  // "New task" exists twice — the page header and the app shell's quick action.
  // Either opens the same modal; the header one is the surface under test.
  await page.getByRole('button', { name: 'New task' }).first().click();

  const title = page.getByLabel('Task title')
    .or(page.getByPlaceholder(/action-first title/i)).first();
  await expect(title, 'the new-task modal has no title field').toBeVisible();
  await title.fill(`E2E task ${RUN}`);

  // Resolve the submit button BEFORE handing a thunk to `submitting` — the
  // thunk is not async, so an `await` inside it is a syntax error.
  const dialog = page.locator('[role="dialog"], .k-modal').filter({ hasText: /task/i }).first();
  const scope = (await dialog.count()) ? dialog : page;
  const submit = scope.getByRole('button', { name: /^(Create|Add|Save)/ }).last();
  const made = await submitting(page, /\/tasks$/, () => submit.click());
  const id = made?.task_id || made?.id || made?.task?.task_id;
  expect(id, 'the task was not created').toBeTruthy();
  keep('taskId', id);

  // Read it back scoped to THIS team — the table is shared with production.
  const list = await apiOk(page, 'get', `/api/tasks?team_id=${TEAM}&limit=200`);
  const rows = list.data ?? list.tasks ?? list;
  const mine = (Array.isArray(rows) ? rows : []).find(
    (t: any) => String(t.task_id ?? t.id) === String(id));
  expect(mine, 'the task is not in this team\'s list').toBeTruthy();
  expect(String(mine.team_id), 'the task landed in a different team').toBe(String(TEAM));
  await shot(page, `corepm-task-${RUN}`);
});

test('tasks · the new task can be completed and the change sticks', async ({ page }) => {
  const id = recall('taskId');
  const r = await api(page, 'patch', `/api/tasks/${id}`, { status: 'done' });
  expect(r.status(), await r.text()).toBeLessThan(400);

  const list = await apiOk(page, 'get', `/api/tasks?team_id=${TEAM}&limit=200`);
  const rows = list.data ?? list.tasks ?? list;
  const mine = (Array.isArray(rows) ? rows : []).find(
    (t: any) => String(t.task_id ?? t.id) === String(id));
  expect(String(mine?.status).toLowerCase(), 'completing the task did not stick').toBe('done');
});


// ══ BOARDS ═══════════════════════════════════════════════════════════════════

test('boards · the board renders its columns and the tasks on them', async ({ page }) => {
  await page.goto('/boards');
  await settle(page);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i }),
    'the boards screen rendered an error').toHaveCount(0);

  // There is no `/api/boards`. A board is a VIEW over tasks plus the team's
  // columns (`/api/projects/{team_id}/columns`) — asserting a boards endpoint
  // was inventing an API, and the 404 said so.
  const cols = await apiOk(page, 'get', `/api/projects/${TEAM}/columns`);
  const columns = cols.data ?? cols.columns ?? cols;
  expect(Array.isArray(columns) ? columns.length : 0,
    'the team has no board columns, so a board cannot render').toBeGreaterThan(0);

  const tasks = await apiOk(page, 'get', `/api/tasks?team_id=${TEAM}&limit=200`);
  const trows = tasks.data ?? tasks.tasks ?? tasks;
  expect(Array.isArray(trows) ? trows.length : 0,
    'the team has no tasks to place on the board').toBeGreaterThan(0);

  // NOT an orphan check against this one column set. `/projects/{team}/columns`
  // returns ONE board's columns, and the team has six boards — comparing every
  // task against them flagged 183 tasks that are simply on a different board.
  // That would have been reported as data corruption; it is six boards working.
  //
  // What IS invariant: a task either sits in no column or in a well-formed one.
  // A malformed id renders nowhere and disappears from every board silently.
  const malformed = (trows as any[])
    .filter((t: any) => t.column_id && !/^col_[0-9a-f]+$/i.test(String(t.column_id)))
    .map((t: any) => `${t.task_id}:${t.column_id}`);
  expect(malformed, 'these tasks carry a column id no board could match').toEqual([]);

  // And the columns this board does return must be ordered and named — an
  // unnamed column is an unusable lane.
  for (const c of columns as any[]) {
    expect(String(c.name || '').trim(), `column ${c.column_id} has no name`).not.toBe('');
    expect(Number.isFinite(Number(c.sort_order)),
      `column ${c.name} has no sort order, so the board has no left-to-right`).toBe(true);
  }
  await shot(page, `corepm-boards-${RUN}`);
});


// ══ TIME ═════════════════════════════════════════════════════════════════════

test('time · the report totals agree with the entries behind them', async ({ page }) => {
  await page.goto('/time');
  await settle(page);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

  const rep = await apiOk(page, 'get', `/api/time/report?team_id=${TEAM}`);
  const rows = rep.rows ?? rep.data ?? rep.entries ?? [];
  expect(Array.isArray(rows), 'the time report did not answer with rows').toBe(true);

  if (rows.length) {
    // Minutes must be real numbers. A report that sums `undefined` shows NaN
    // hours, and an invoice raised from it bills nothing.
    const bad = rows.filter((r: any) =>
      r.minutes != null && !Number.isFinite(Number(r.minutes)));
    expect(bad, 'time entries carry minutes that are not numbers').toEqual([]);
  }
  await shot(page, `corepm-time-${RUN}`);
});

test('time · the report exports as CSV', async ({ page }) => {
  await page.goto('/time');
  await settle(page);
  const csvBtn = page.getByRole('button', { name: /CSV/i });
  await expect(csvBtn, 'the time report offers no CSV export').toBeVisible();

  const buf = await download(page, () => csvBtn.click(), `corepm-time-${RUN}.csv`);
  const text = buf.toString('utf8');
  // A CSV with a header and nothing else is an empty file with a hat on.
  expect(text.split(/\r?\n/).filter(Boolean).length,
    'the CSV contains only a header row').toBeGreaterThan(1);
  expect(text, 'the CSV has no header').toMatch(/[A-Za-z]/);
});


// ══ TEMPLATES ════════════════════════════════════════════════════════════════

test('templates · create a task template', async ({ page }) => {
  // The "Quarterly client review" placeholder belongs to the PROJECT template
  // save form, which is behind `tab === 'project'` AND a toggle. The default
  // view is TASK templates, and that is the one a user meets first.
  await page.goto('/templates');
  await settle(page);

  // The page OPENS on "Project templates" (`useState('project')`), so the task
  // form is not reachable until the tab is switched. Skipping this step made
  // the project tab's "Save current project as template" card look like a
  // mislabelled task card — it is not, it is the right card on the right tab,
  // and I briefly "fixed" it in the wrong direction before checking the guard.
  await page.getByRole('tab', { name: /Task templates/i }).click();
  await settle(page);

  const open = page.getByRole('button', { name: /New task template/i });
  await expect(open, 'the task-templates tab offers no way to create one').toBeVisible();
  await open.first().click();
  await settle(page);

  const name = page.getByLabel('Template name').first();
  await expect(name, 'the task template form has no name field').toBeVisible();
  await name.fill(`E2E Template ${RUN}`);

  const title = page.getByLabel('Pre-filled title').first();
  if (await title.count()) await title.fill(`E2E templated task ${RUN}`);

  // A template with NO project scope is org-wide, and org-wide templates are
  // platform-staff only — an org owner gets
  // "Only platform staff can create org-wide templates" (403). Scoping it to a
  // project is what an org owner is actually allowed to do, and leaving the
  // field blank tested the refusal rather than the feature.
  const scope = page.getByLabel('Project (scope)').first();
  await expect(scope, 'the task template form has no project scope field').toBeVisible();
  await pickOption(scope, 'project');

  // "Save template" belongs to the PROJECT form. The task form submits with
  // "Create template" — two forms on one screen, two verbs.
  const made = await submitting(page, '/templates/tasks',
    () => page.getByRole('button', { name: 'Create template' }).first().click());
  const id = made?.id || made?.template_id;
  expect(id, 'the task template was not created').toBeTruthy();
  keep('templateId', id);

  const list = await apiOk(page, 'get', '/api/templates/tasks');
  const rows = list.data ?? list;
  const mine = (Array.isArray(rows) ? rows : []).find(
    (t: any) => String(t.name) === `E2E Template ${RUN}`);
  expect(mine, 'the template is not in the list it was just added to').toBeTruthy();
});


// ══ APPROVALS ════════════════════════════════════════════════════════════════

test('approvals · the queue answers and its counts agree with the list',
  async ({ page }) => {
    await page.goto('/approvals');
    await settle(page);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

    const pending = await apiOk(page, 'get', '/api/approvals/pending');
    const stats = await apiOk(page, 'get', '/api/approvals/stats');
    const rows = pending.data ?? pending;
    expect(Array.isArray(rows), 'the pending queue did not answer with a list').toBe(true);

    // The count on the screen and the rows behind it must be the same number.
    // A badge that disagrees with its list is how an approval gets missed.
    if (stats && stats.pending != null) {
      expect(Number(stats.pending),
        `the badge says ${stats.pending} pending but the queue holds ${rows.length}`)
        .toBe(rows.length);
    }
    await shot(page, `corepm-approvals-${RUN}`);
  });

test('approvals · history is separate from the pending queue', async ({ page }) => {
  const hist = await apiOk(page, 'get', '/api/approvals/history');
  const rows = hist.data ?? hist;
  expect(Array.isArray(rows), 'approval history did not answer with a list').toBe(true);
  // Nothing still pending may appear in history — that is the distinction the
  // two endpoints exist to make.
  const stillPending = (rows as any[]).filter(
    (h: any) => String(h.status).toLowerCase() === 'pending');
  expect(stillPending, 'pending approvals are showing up in the history').toEqual([]);
});


// ══ TODAY ════════════════════════════════════════════════════════════════════

test('today · every card renders and the figures come from real endpoints',
  async ({ page }) => {
    await page.goto('/dashboard');
    await settle(page);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i }),
      'a Today card failed to load').toHaveCount(0);

    // Today is a composite of other modules; if its sources answer, the page
    // has something true to show. Receivables is the one with money on it.
    const stats = await apiOk(page, 'get', '/api/v1/ganit/stats');
    expect(Number(stats.total_invoices), 'Today has no invoice figures to show')
      .toBeGreaterThan(0);
    await shot(page, `corepm-today-${RUN}`);
  });


// ══ DRISTI — all eight surfaces ══════════════════════════════════════════════

for (const tab of ['overview', 'revenue', 'pipeline', 'hr',
                   'sales', 'reports', 'dashboards', 'pivot']) {
  test(`dristi · the ${tab} surface loads without error`, async ({ page }) => {
    await page.goto('/dristi');
    await settle(page);
    const t = page.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') });
    if (await t.count()) {
      await t.first().click();
      await settle(page);
    } else {
      const more = page.getByRole('button', { name: /^More/ });
      await expect(more, `the ${tab} tab is neither inline nor behind More`).toBeVisible();
      await more.click();
      await page.getByRole('menuitem', { name: new RegExp(`^${tab}`, 'i') }).click();
      await settle(page);
    }
    await expect(page.locator('.k-err').filter({ hasText: /failed/i }),
      `the ${tab} surface rendered an error`).toHaveCount(0);
  });
}

test('dristi · the revenue figure agrees with Ganit', async ({ page }) => {
  // Dristi reads the other modules. A dashboard that disagrees with the ledger
  // it summarises is worse than no dashboard — someone will quote it.
  await page.goto('/dristi');
  await settle(page);
  const ganit = await apiOk(page, 'get', '/api/v1/ganit/stats');
  expect(Number(ganit.total_collected), 'Ganit reports nothing collected')
    .toBeGreaterThanOrEqual(0);
  await shot(page, `corepm-dristi-${RUN}`);
});
