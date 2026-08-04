/**
 * Phase 11 — Sanvaad, after the Slack-parity work. Against the deployed app.
 *
 * ── Why this file exists even though 2,213 backend tests pass ───────────────
 * Every defect that mattered in this feature survived a fully green build.
 * `npm run check`, 875 vitest tests and `npm run build` all passed while
 * pinning had no entry point anywhere in the product, the typing indicator
 * never rendered, and the mention badge was unreachable — because eight agents
 * rewrote the components at both ends of a chain and nobody touched the one in
 * the middle. React drops an unknown prop silently and hands `undefined` for a
 * missing one, so the failure mode is a feature that tests clean and does
 * nothing.
 *
 * The unit tests now pin those prop chains. This file pins the thing they
 * still cannot see: that the deployed server and the deployed client agree.
 * It asserts through TWO different sessions, because the whole point of a
 * mention is that it reaches somebody who is not you — a single-session test
 * would have passed on the old code, where mentions notified nobody.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * No `@channel` and no `@here`. Both fan out to every member of the channel,
 * and the E2E org's channels contain real user rows — a broadcast would put a
 * notification and a push on people who did not ask to be in a test. The
 * broadcast path is covered by `tests/test_samvaad_mentions.py`, where the
 * recipient set can be asserted without paging anyone.
 */
import { test, expect, Page } from '@playwright/test';
import { OWNER_STATE, APPROVER_STATE } from './real.config';
import { api, apiOk, settle, RUN } from './_helpers';

test.describe.configure({ mode: 'serial' });

/** Set by the owner's tests, read by the approver's. */
const state: {
  channelId?: string;
  messageId?: string;
  approverName?: string;
  approverId?: string;
  marker?: string;
} = {};

const MARKER = `parity${RUN}`;


// ══ AS THE OWNER — write ═════════════════════════════════════════════════════

test.describe('owner', () => {
  test.use({ storageState: OWNER_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/sanvaad');
    await settle(page);
  });

  test('the directory names somebody other than me to mention', async ({ page }) => {
    // The mention is resolved SERVER-side out of the message text, by matching
    // the recipient's full display name longest-first. So the test has to send
    // the name the server will match, not a name it invented — asking the
    // product who is in the org is the only way to get that right, and it is
    // also what the composer's autocomplete does.
    const me = await apiOk(page, 'get', '/api/v1/messaging/me');
    const dir = await apiOk(page, 'get', '/api/v1/messaging/directory');
    const rows = (dir.data ?? dir) as any[];
    expect(Array.isArray(rows) ? rows.length : 0,
      'the org directory is empty — nobody to mention').toBeGreaterThan(0);

    const myId = String(me.user_id ?? me.data?.user_id ?? '');
    const other = rows.find((u: any) => String(u.user_id) !== myId
      && String(u.full_name || u.name || '').trim().length > 2);
    expect(other, 'the directory has nobody but me').toBeTruthy();

    state.approverId = String(other.user_id);
    state.approverName = String(other.full_name || other.name).trim();
  });

  test('a channel we are both in', async ({ page }) => {
    const r = await apiOk(page, 'get', '/api/v1/messaging/channels');
    const rows = (r.data ?? r) as any[];
    const usable = rows.filter((c: any) => !c.is_archived && c.type !== 'dm');
    expect(usable.length, 'no live channel to post in').toBeGreaterThan(0);

    // Prefer one the mention target is already a member of: a mention only
    // notifies a member, which is the rule that keeps a private channel's text
    // out of a stranger's inbox.
    for (const c of usable) {
      const m = await api(page, 'get', `/api/v1/messaging/channels/${c.id}/members`);
      if (m.status() !== 200) continue;
      const members = ((await m.json()).data ?? []) as any[];
      if (members.some((x: any) => String(x.user_id) === state.approverId)) {
        state.channelId = String(c.id);
        break;
      }
    }
    if (!state.channelId) state.channelId = String(usable[0].id);
    expect(state.channelId).toBeTruthy();
  });

  test('the new columns answer — /live, pins and search are not 500ing',
    async ({ page }) => {
      // Migration 093 is applied by hand and `_parity_ready` probes for it, so
      // this is the check that the schema and the deployed code actually met.
      // Before 093 these degrade rather than fail, which means a green
      // response here is the only proof the migration landed.
      const live = await apiOk(page, 'get',
        `/api/v1/messaging/live?channel_id=${state.channelId}`);
      expect(live.channels, '/live returned no channel map').toBeTruthy();
      expect(Array.isArray(live.typing), '/live returned no typing list').toBe(true);
      expect(live.presence, '/live returned no presence map').toBeTruthy();

      const pins = await api(page, 'get',
        `/api/v1/messaging/channels/${state.channelId}/pins`);
      expect(pins.status(), `pins is unreadable: ${await pins.text()}`).toBe(200);

      const search = await api(page, 'get', '/api/v1/messaging/search?q=the');
      expect(search.status(), `search is unreadable: ${await search.text()}`).toBe(200);
    });

  test('posting a message that names somebody records a mention', async ({ page }) => {
    const body = `Hi @${state.approverName} — ${MARKER} please confirm.`;
    const sent = await api(page, 'post',
      `/api/v1/messaging/channels/${state.channelId}/messages`, { content: body });
    expect(sent.status(), await sent.text()).toBeLessThan(400);
    const row = await sent.json();
    state.messageId = String(row.id ?? row.data?.id);
    expect(state.messageId, 'the message was not created').toBeTruthy();

    const back = await apiOk(page, 'get',
      `/api/v1/messaging/channels/${state.channelId}/messages?limit=20`);
    expect(JSON.stringify(back.data ?? back),
      'the message is not in the channel').toContain(MARKER);
  });

  test('search finds what was just said', async ({ page }) => {
    // Three characters minimum matters: `%ab%` contains no complete trigram, so
    // a two-character query cannot use the index. MARKER is longer.
    const r = await apiOk(page, 'get',
      `/api/v1/messaging/search?q=${encodeURIComponent(MARKER)}`);
    // `{results, more}`, not `{data}` — search is the one endpoint in this
    // module that does not use the list envelope, because it has to report
    // whether there is another page. Reading `.data` here silently yielded
    // "0 hits" and accused the product of not finding a message it had.
    const hits = (r.results ?? []) as any[];
    expect(Array.isArray(hits) ? hits.length : 0,
      `search cannot find "${MARKER}", which was posted seconds ago`).toBeGreaterThan(0);
    expect(hits.some((h: any) => String(h.id) === state.messageId),
      'search returned results but not the message we posted').toBe(true);
  });

  test('a message pins, lists and unpins', async ({ page }) => {
    const pin = await api(page, 'post',
      `/api/v1/messaging/messages/${state.messageId}/pin`);
    expect(pin.status(), `pinning failed: ${await pin.text()}`).toBeLessThan(400);

    const list = await apiOk(page, 'get',
      `/api/v1/messaging/channels/${state.channelId}/pins`);
    const pins = (list.data ?? list) as any[];
    expect(pins.some((p: any) => String(p.id) === state.messageId),
      'the message was pinned but is not in the channel\'s pins').toBe(true);

    const un = await api(page, 'delete',
      `/api/v1/messaging/messages/${state.messageId}/pin`);
    expect(un.status(), `unpinning failed: ${await un.text()}`).toBeLessThan(400);

    const after = await apiOk(page, 'get',
      `/api/v1/messaging/channels/${state.channelId}/pins`);
    expect(((after.data ?? after) as any[]).some((p: any) => String(p.id) === state.messageId),
      'the pin survived being removed').toBe(false);
  });

  test('muting a channel does not hand me its whole history as unread',
    async ({ page }) => {
      // The defect this pins: the mute INSERT created a membership row with
      // `last_read_at` NULL, which every unread counter reads as '-infinity'.
      // Muting a channel you had never opened therefore lit the rail with its
      // entire history — the opposite of what the button says it does.
      const r = await api(page, 'put',
        `/api/v1/messaging/channels/${state.channelId}/mute`, { muted: true });
      expect(r.status(), `mute failed: ${await r.text()}`).toBeLessThan(400);

      const live = await apiOk(page, 'get', '/api/v1/messaging/live');
      const mine = live.channels?.[String(state.channelId)];
      expect(mine, '/live does not know about the channel we just muted').toBeTruthy();
      expect(mine.muted, 'the channel does not read as muted').toBe(true);
      expect(Number(mine.unread), 'muting produced a phantom unread backlog')
        .toBeLessThan(50);

      const off = await api(page, 'put',
        `/api/v1/messaging/channels/${state.channelId}/mute`, { muted: false });
      expect(off.status(), await off.text()).toBeLessThan(400);
    });
});


// ══ AS THE PERSON WHO WAS NAMED — the half that used to be silent ═══════════

test.describe('the mentioned person', () => {
  test.use({ storageState: APPROVER_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/sanvaad');
    await settle(page);
  });

  test('being named produces a mention they can find', async ({ page }) => {
    // THIS is the test the old code failed. `@Name` used to be highlighted text
    // and nothing else — no row, no notification, no badge. A single-session
    // test cannot tell the difference; only asking the OTHER person can.
    const r = await apiOk(page, 'get', '/api/v1/messaging/mentions?limit=50');
    const rows = (r.data ?? r) as any[];
    expect(Array.isArray(rows), 'the mentions feed did not answer with a list').toBe(true);

    const mine = rows.find((m: any) => String(m.message_id) === state.messageId);
    expect(mine,
      `no mention was recorded for "${state.approverName}" — being named in a `
      + 'channel produced the same silence as not being named').toBeTruthy();
    expect(String(mine.kind), 'a named mention was recorded as a broadcast')
      .toBe('user');
    expect(String(mine.content || ''), 'the mention does not carry the message')
      .toContain(MARKER);
  });

  test('the unread mention shows on the channel badge', async ({ page }) => {
    const live = await apiOk(page, 'get', '/api/v1/messaging/live');
    const ch = live.channels?.[String(state.channelId)];
    expect(ch, '/live does not list the channel the mention was in').toBeTruthy();
    expect(Number(ch.mentions),
      'the channel shows no unread mention, so the rail would show no @ badge')
      .toBeGreaterThan(0);
    expect(Number(live.mention_unread),
      'the org-wide unread mention count is zero').toBeGreaterThan(0);
  });

  test('marking them read clears the badge and does not come back',
    async ({ page }) => {
      const r = await api(page, 'post', '/api/v1/messaging/mentions/read',
        { mark_all: true });
      expect(r.status(), `marking mentions read failed: ${await r.text()}`)
        .toBeLessThan(400);

      const live = await apiOk(page, 'get', '/api/v1/messaging/live');
      expect(Number(live.mention_unread),
        'the mention count survived being marked read').toBe(0);

      // Read, not deleted — Slack keeps the history and so does this.
      const feed = await apiOk(page, 'get', '/api/v1/messaging/mentions?limit=50');
      const still = ((feed.data ?? feed) as any[])
        .find((m: any) => String(m.message_id) === state.messageId);
      expect(still, 'marking a mention read destroyed it').toBeTruthy();
      expect(still.read_at, 'the mention is not marked read').toBeTruthy();
    });
});
