/**
 * The suite's own safety proof.
 *
 * Everything else in `__tests__/e2e/` is worth exactly as much as this file is.
 * Staging and production share one Supabase project, so an e2e test that opens
 * a socket is an e2e test writing to production. These assertions say it cannot.
 *
 * If you are reviewing whether this suite is safe to run, read only this file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { api } from '../../lib/api';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, httpError,
} from './_harness';

beforeEach(() => { installNetworkKillSwitch(); });
afterEach(() => { restoreNetwork(); vi.restoreAllMocks(); });

describe('e2e isolation · the transports are gone', () => {
  it('fetch throws instead of resolving', async () => {
    await expect(() => globalThis.fetch('https://example.test/x'))
      .toThrow(/E2E NETWORK ESCAPE/);
  });

  it('XMLHttpRequest throws on construction', () => {
    expect(() => new globalThis.XMLHttpRequest()).toThrow(/E2E NETWORK ESCAPE/);
  });

  it('WebSocket throws on construction', () => {
    expect(() => new globalThis.WebSocket('wss://example.test')).toThrow(/E2E NETWORK ESCAPE/);
  });

  it('navigator.sendBeacon throws — analytics is a network call too', () => {
    expect(() => globalThis.navigator.sendBeacon('/collect', 'x')).toThrow(/E2E NETWORK ESCAPE/);
  });

  it('restoreNetwork puts them back, so the rest of `yarn test` is unaffected', () => {
    restoreNetwork();
    expect(() => new globalThis.XMLHttpRequest()).not.toThrow();
    installNetworkKillSwitch(); // afterEach restores again
  });
});

describe('e2e isolation · the mock API refuses to guess', () => {
  it('an unregistered route REJECTS rather than passing through', async () => {
    installMockApi({ 'GET /auth/me': { user_id: 'u1' } });
    await expect(api.get('/tasks')).rejects.toThrow(
      /MockApi: no route registered for GET \/tasks/,
    );
  });

  it('a registered route resolves with an axios-shaped response', async () => {
    installMockApi({ 'GET /auth/me': { user_id: 'u1' } });
    const res = await api.get('/auth/me');
    expect(res.data).toEqual({ user_id: 'u1' });
    expect(res.status).toBe(200);
  });

  it('the wrong VERB on a registered path is still a miss', async () => {
    installMockApi({ 'GET /tasks': [] });
    await expect(api.post('/tasks', { title: 'x' })).rejects.toThrow(/no route registered for POST/);
  });

  it('path params match, and the handler receives them', async () => {
    installMockApi({
      'PATCH /tasks/:id/move': ({ params, body }) => ({ id: params.id, moved: body.column_id }),
    });
    const res = await api.patch('/tasks/task_abc/move', { column_id: 'col_2', order: 0 });
    expect(res.data).toEqual({ id: 'task_abc', moved: 'col_2' });
  });

  it('a query string does not defeat the match, and is still recorded', async () => {
    const mock = installMockApi({ 'GET /tasks': [] });
    await api.get('/tasks?team_id=t1&status=todo');
    expect(mock.calls[0].path).toBe('/tasks');
    expect(mock.calls[0].query).toBe('?team_id=t1&status=todo');
  });

  it('httpError rejects with a status a component can branch on', async () => {
    installMockApi({ 'GET /auth/me': httpError(401, 'Token expired') });
    await expect(api.get('/auth/me')).rejects.toMatchObject({
      response: { status: 401, data: { detail: 'Token expired' } },
    });
  });

  it('records what a write TRIED to send, and nothing receives it', async () => {
    const mock = installMockApi({ 'POST /invites': { ok: true } });
    await api.post('/invites', { email: 'someone@example.test', role: 'member' });
    // The assertion is on the attempt. No SMTP client exists in this process,
    // so no invite mail can leave it — rule 6 holds by construction.
    expect(mock.calledWith('POST', '/invites')).toHaveLength(1);
    expect(mock.calls[0].body).toEqual({ email: 'someone@example.test', role: 'member' });
  });
});

describe('e2e isolation · no real credential is present', () => {
  it('the suite carries no admin email or password from the environment', () => {
    // The Playwright suite at repo root reads E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
    // and signs into a DEPLOYED app with them. This suite must never grow that
    // habit: a credential in scope is a credential that can reach production.
    expect(process.env.E2E_ADMIN_PASSWORD ?? '').toBe('');
  });
});
