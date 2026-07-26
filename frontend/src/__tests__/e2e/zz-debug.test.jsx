import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import Protected from '../../components/layout/Protected';
import { LoginPage } from '../../pages/LoginPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
  makeHost, landingRoutes, users, clearSession,
} from './_harness';

let host;
beforeEach(() => { clearSession(); installNetworkKillSwitch(); host = makeHost(); });
afterEach(() => { host.unmount(); restoreNetwork(); vi.restoreAllMocks(); clearSession(); });

describe('debug', () => {
  it('login page html', async () => {
    installMockApi({ 'POST /auth/login': { token: 't', user: users.staff() } });
    await host.mount(null, { path: '/login', routes: [
      ...landingRoutes(),
      <Route key="l" path="/login" element={<LoginPage />} />,
    ] });
    console.log('LOGIN HTML >>>', host.html().slice(0, 3000));
    console.log('INPUT IDS >>>', host.$$('input').map(i => i.id + '|' + i.type + '|' + i.name));
  });

  it('protected with no token', async () => {
    installMockApi({ 'GET /auth/me': users.staff() });
    await host.mount(null, { path: '/dashboard', routes: [
      ...landingRoutes(),
      <Route key="g" path="/dashboard" element={<Protected><div data-landed="guarded-page">G</div></Protected>} />,
    ] });
    console.log('PROTECTED PATH >>>', host.path());
    console.log('PROTECTED HTML >>>', host.html().slice(0, 1500));
  });
});
