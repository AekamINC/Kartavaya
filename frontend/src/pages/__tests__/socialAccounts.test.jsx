/**
 * Social accounts — one card per network, the app above and the accounts below.
 *
 * ── THE TWO THINGS A BACKEND TEST CANNOT SEE ─────────────────────────────────
 *
 *  1. THE FOUR STATES ARE DRAWN FROM COUNTED ACCOUNTS. The card this replaces
 *     said `NOT SET` / `ON`, and `ON` meant a saved app id and a pasted secret.
 *     Measured live 2026-08-21: Instagram and LinkedIn are both saved and both
 *     active on this database, and `hub_social_accounts` holds zero rows in the
 *     whole product. Two green cards, nothing able to post. `Ready` is the
 *     honest word for that, and it is not green.
 *
 *  2. THE MATRIX DECIDES WHAT IS RENDERED, not what is disabled. A viewer sees
 *     accounts and no buttons; an editor gets no Connect; only an admin gets
 *     Connect and Disconnect; only an org owner/admin gets the app form. F32's
 *     finding is that the product invited the action, accepted the effort and
 *     refused at the last step — so the test here is that the control is ABSENT
 *     and the API's own sentence is present in its place.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
const post = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    put: (...a) => put(...a),
    post: (...a) => post(...a),
    delete: (...a) => del(...a),
  },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
}));

vi.mock('../../components/ui', async (orig) => {
  const real = await orig();
  return { ...real, useToast: () => ({ pushToast: vi.fn() }) };
});

import SocialAccountsPage from '../SocialAccountsPage';
import { STATE_WORD, stateSentence, appSentence } from '../social/stateWords';
import { socialSkills } from '../social/SkillsStrip';
import {
  pendingChoiceToken, cameBackWithNothing,
} from '../social/DestinationPicker';
import { canSeeNavItem, NAV_FULL } from '../../components/layout/navConfig';

const CLIENT = 'c0000000-0000-0000-0000-000000000001';

/** One roll-up entry. Everything not overridden is a `not_set` card. */
function card(platform, label, over = {}) {
  return {
    platform, label, kind: 'oauth', console: '', caution: '',
    app: { configured: false, scope: 'none', saved_but_off: false },
    accounts: { connected: 0, expired: 0, names: [], expired_names: [] },
    state: 'not_set',
    ...over,
  };
}

const ALL_ALLOWED = { connect: true, send: true, edit_app: true };
const NO_DENIALS = { connect: null, send: null, edit_app: null };

function serve({ cards, can = ALL_ALLOWED, denials = NO_DENIALS,
                 accounts = [], templates = [], appCards = [] } = {}) {
  get.mockImplementation((url) => {
    if (url.includes('/connectors/social-status')) {
      return Promise.resolve({ data: {
        data: cards, client_id: CLIENT,
        clients: [{ id: CLIENT, name: 'Aekam Inc', is_internal: true }],
        can, denials, level: 'admin', where_checked: '2026-08-07',
      } });
    }
    if (url === '/v1/hub/connectors') {
      return Promise.resolve({ data: { data: appCards } });
    }
    if (url.includes('/social-accounts')) {
      return Promise.resolve({ data: { data: accounts } });
    }
    if (url.includes('/skills/templates')) {
      return Promise.resolve({ data: { data: templates } });
    }
    return Promise.resolve({ data: { data: [] } });
  });
}

function draw() {
  return render(
    <MemoryRouter>
      <SocialAccountsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => { get.mockReset(); put.mockReset(); del.mockReset(); post.mockReset(); });

// ── 1 · the four states ─────────────────────────────────────────────────────

describe('the four card states', () => {
  it('says Ready — not Live — for an app that is saved with nobody connected', async () => {
    // THE LIVE CASE. Two rows on this database look exactly like this and the
    // old card called both of them `ON`.
    serve({ cards: [card('linkedin', 'LinkedIn', {
      app: { configured: true, scope: 'org', saved_but_off: false },
      state: 'ready',
    })] });
    draw();
    expect(await screen.findByText('Ready')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText(/nobody has connected an account yet/i)).toBeTruthy();
  });

  it('counts the connected accounts in the green card, rather than saying ON', async () => {
    serve({ cards: [card('instagram', 'Instagram', {
      app: { configured: true, scope: 'org', saved_but_off: false },
      accounts: { connected: 3, expired: 0,
                  names: ['Aekam Inc', 'Unicode Group', 'E2E Test'],
                  expired_names: [] },
      state: 'live',
    })] });
    draw();
    expect(await screen.findByText('Live')).toBeTruthy();
    expect(screen.getByText('3 accounts connected')).toBeTruthy();
  });

  it('names who to reconnect rather than counting the problem', async () => {
    serve({ cards: [card('facebook', 'Facebook Pages', {
      app: { configured: true, scope: 'org', saved_but_off: false },
      accounts: { connected: 2, expired: 1, names: ['Aekam Inc', 'Unicode Group'],
                  expired_names: ['Unicode Group'] },
      state: 'attention',
    })] });
    draw();
    expect(await screen.findByText('Attention')).toBeTruthy();
    expect(screen.getByText(/Unicode Group needs reconnecting/)).toBeTruthy();
  });

  it('says nothing can connect on a card with no app', async () => {
    serve({ cards: [card('youtube', 'YouTube')] });
    draw();
    expect(await screen.findByText('Not set')).toBeTruthy();
    expect(screen.getByText(/No app saved, so nothing can connect/i)).toBeTruthy();
  });

  it('has a word for every state the server can send', () => {
    for (const s of ['not_set', 'ready', 'live', 'attention']) {
      expect(STATE_WORD[s]).toBeTruthy();
    }
  });

  it('speaks a single account in the singular', () => {
    expect(stateSentence(card('x', 'X', {
      state: 'live',
      accounts: { connected: 1, expired: 0, names: ['One'], expired_names: [] },
    }))).toBe('1 account connected');
  });

  it('says whose app answers, which neither of the two screens could', () => {
    expect(appSentence(card('x', 'X', {
      app: { configured: true, scope: 'client' },
    }), 'Unicode Group')).toMatch(/Unicode Group uses its own app/);
    expect(appSentence(card('x', 'X', {
      app: { configured: false, scope: 'none', saved_but_off: true },
    }))).toMatch(/saved but switched off/);
  });
});

// ── 2 · the matrix drives what is rendered ──────────────────────────────────

describe('the access matrix', () => {
  const LIVE = card('instagram', 'Instagram', {
    app: { configured: true, scope: 'org', saved_but_off: false },
    accounts: { connected: 1, expired: 0, names: ['Aekam Inc'], expired_names: [] },
    state: 'live',
  });

  it('shows a viewer the accounts and not one button', async () => {
    serve({
      cards: [LIVE],
      can: { connect: false, send: false, edit_app: false },
      denials: {
        connect: 'Connecting a social account needs admin on Sahayak or Marketing. Yours is viewer.',
        send: 'Scheduling and publishing need editor on Sahayak or Marketing. Yours is viewer.',
        edit_app: 'An app’s id and secret can post as this client, so only an organisation owner or admin can change them.',
      },
    });
    draw();
    // The account is visible — a viewer may see it.
    expect(await screen.findByText('Aekam Inc')).toBeTruthy();
    // And nothing that would 403.
    expect(screen.queryByRole('button', { name: /Connect/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Disconnect/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set up the .* app/i })).toBeNull();
    // The reason, in the API's own words, rather than a greyed control.
    expect(screen.getAllByText(/needs admin on Sahayak or Marketing/i).length)
      .toBeGreaterThan(0);
  });

  it('gives an editor no Connect — sending is a rung below connecting', async () => {
    serve({
      cards: [LIVE],
      can: { connect: false, send: true, edit_app: false },
      denials: {
        connect: 'Connecting a social account needs admin on Sahayak or Marketing. Yours is editor.',
        send: null,
        edit_app: 'Only an organisation owner or admin can change them.',
      },
    });
    draw();
    expect(await screen.findByText('Aekam Inc')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Connect/i })).toBeNull();
    // And is told where the thing they MAY do happens.
    expect(screen.getByText(/schedule and publish/i)).toBeTruthy();
  });

  it('gives an admin Connect and Disconnect', async () => {
    serve({
      cards: [LIVE],
      can: { connect: true, send: true, edit_app: false },
      denials: { connect: null, send: null,
                 edit_app: 'Only an organisation owner or admin can change them.' },
      accounts: [{ id: 'a1', platform: 'instagram', account_name: 'Aekam Inc' }],
    });
    draw();
    expect(await screen.findByRole('button', { name: /Reconnect Instagram/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Disconnect/i })).toBeTruthy();
    // Still not the app form — that is a different authority entirely.
    expect(screen.queryByRole('button', { name: /Edit the Instagram app/i })).toBeNull();
  });

  it('gives an org admin the app form, with the network’s own field labels', async () => {
    serve({
      cards: [LIVE],
      appCards: [{
        platform: 'instagram', label: 'Instagram', redirect_url: '', setup_steps: [],
        org: {
          has_secret: true, secret_hint: '9zQ1', is_active: true,
          last_tested_at: null, last_test_ok: null, last_test_detail: '',
          fields: [{ key: 'app_id', label: 'App ID',
                     where: 'Meta app → Settings → Basic → App ID',
                     secret: false, required: true, placeholder: '', value: '4711',
                     saved: true }],
        },
        client: null,
      }],
    });
    draw();
    const open = await screen.findByRole('button', { name: /Edit the Instagram app/i });
    open.click();
    expect(await screen.findByText('App ID')).toBeTruthy();
    // The sentence the form exists for — where in the console the value lives.
    expect(screen.getByText(/Meta app → Settings → Basic/)).toBeTruthy();
  });

  it('never puts a saved secret into the DOM, not even as a masked value', async () => {
    serve({
      cards: [LIVE],
      appCards: [{
        platform: 'instagram', label: 'Instagram', redirect_url: '', setup_steps: [],
        org: {
          has_secret: true, secret_hint: '9zQ1', is_active: true,
          last_tested_at: null, last_test_ok: null, last_test_detail: '',
          fields: [{ key: 'app_secret', label: 'App secret',
                     where: 'Meta app → Settings → Basic → App secret → Show',
                     secret: true, required: true, placeholder: '',
                     value: '', saved: true }],
        },
        client: null,
      }],
    });
    const { container } = draw();
    (await screen.findByRole('button', { name: /Edit the Instagram app/i })).click();
    await screen.findByText('App secret');
    const box = container.querySelector('input[type="password"]');
    expect(box).toBeTruthy();
    expect(box.value).toBe('');
    expect(box.getAttribute('placeholder')).toMatch(/ends 9zQ1/);
  });
});

// ── 3 · the id that is never drawn ──────────────────────────────────────────

it('draws account names and never an account id', async () => {
  serve({
    cards: [card('instagram', 'Instagram', {
      app: { configured: true, scope: 'org', saved_but_off: false },
      accounts: { connected: 1, expired: 0, names: ['Aekam Inc'], expired_names: [] },
      state: 'live',
    })],
    accounts: [{ id: 'a1b2c3d4-0000-0000-0000-000000000009',
                 platform: 'instagram', account_name: 'Aekam Inc',
                 account_id: '17841400000000000' }],
  });
  const { container } = draw();
  await screen.findByText('Aekam Inc');
  expect(container.textContent).not.toContain('a1b2c3d4');
  expect(container.textContent).not.toContain('17841400000000000');
});

// ── 4 · a failed fetch is never an empty state ──────────────────────────────

it('reports a failed roll-up rather than drawing a page of empty cards', async () => {
  get.mockImplementation(() => Promise.reject({
    response: { status: 500, data: { detail: 'The server failed on this request.' } },
  }));
  const { container } = draw();
  // The shared ErrorState, with its retry — and NOT a grid of eleven cards
  // reading `Not set`, which is a false statement about every network the firm
  // has ever configured.
  expect(await screen.findByRole('button', { name: /Try again/i })).toBeTruthy();
  expect(container.querySelectorAll('.sa__card')).toHaveLength(0);
});

it('keeps the accounts half when only the app forms fail', async () => {
  get.mockImplementation((url) => {
    if (url.includes('/connectors/social-status')) {
      return Promise.resolve({ data: {
        data: [card('instagram', 'Instagram', {
          app: { configured: true, scope: 'org', saved_but_off: false },
          accounts: { connected: 1, expired: 0, names: ['Aekam Inc'], expired_names: [] },
          state: 'live',
        })],
        client_id: CLIENT,
        clients: [{ id: CLIENT, name: 'Aekam Inc', is_internal: true }],
        can: ALL_ALLOWED, denials: NO_DENIALS, level: 'admin',
      } });
    }
    if (url === '/v1/hub/connectors') {
      return Promise.reject({ response: { status: 500, data: { detail: 'boom' } } });
    }
    return Promise.resolve({ data: { data: [] } });
  });
  draw();
  expect(await screen.findByText('Live')).toBeTruthy();
  expect(await screen.findByText(/The app forms did not load/)).toBeTruthy();
  // The half that DID load is still drawn. The two requests are reported
  // separately for exactly this reason.
  expect(screen.getByText('1 account connected')).toBeTruthy();
});

// ── 5 · the skills, read live rather than named ─────────────────────────────

describe('the content packs', () => {
  const PACKS = [
    { id: '1', name: 'Weekly Social Media Pack', module: 'srijan', skill_type: 'content' },
    { id: '2', name: 'Festival Calendar', module: 'srijan', skill_type: 'content' },
    { id: '3', name: 'GST Health Check', module: 'ganit', skill_type: 'check' },
    { id: '4', name: 'Sahayak Brief', module: 'sahayak', skill_type: 'brief' },
  ];

  it('takes the social content packs by tag, not by name', () => {
    expect(socialSkills(PACKS).map(p => p.name)).toEqual([
      'Weekly Social Media Pack', 'Festival Calendar',
    ]);
  });

  it('follows a retag rather than a deploy', () => {
    // MEASURED 2026-08-21: six rows carry module=srijan, skill_type=content —
    // two more than this work was briefed with. A hard-coded list of four would
    // have hidden two packs the org already owns.
    const retagged = [{ id: '9', name: 'Reel Scripts', module: 'sahayak', skill_type: 'content' }];
    expect(socialSkills(retagged)).toHaveLength(1);
    expect(socialSkills([{ id: '9', module: 'srijan', skill_type: 'pack' }])).toHaveLength(0);
  });

  it('offers them beside the accounts they publish to', async () => {
    serve({ cards: [card('instagram', 'Instagram')], templates: PACKS });
    draw();
    expect(await screen.findByText('Weekly Social Media Pack')).toBeTruthy();
    expect(screen.getByText('Festival Calendar')).toBeTruthy();
    expect(screen.queryByText('GST Health Check')).toBeNull();
  });

  it('draws no shelf at all when the catalogue is refused', async () => {
    get.mockImplementation((url) => {
      if (url.includes('/skills/templates')) {
        return Promise.reject({ response: { status: 403, data: { detail: 'no sahayak' } } });
      }
      if (url.includes('/connectors/social-status')) {
        return Promise.resolve({ data: {
          data: [card('instagram', 'Instagram')], client_id: CLIENT,
          clients: [{ id: CLIENT, name: 'Aekam Inc', is_internal: true }],
          can: { connect: true, send: true, edit_app: false },
          denials: { ...NO_DENIALS, edit_app: 'Ask an org admin.' }, level: 'admin',
        } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    draw();
    await screen.findByText('Not set');
    // A Marketing holder has no Sahayak reach. They are not missing a shelf.
    await waitFor(() => expect(screen.queryByText('Write the posts')).toBeNull());
  });
});

// ── 6 · the nav row admits both audiences ───────────────────────────────────

describe('the sidebar row', () => {
  const item = NAV_FULL
    .flatMap(s => s.items)
    .find(i => i.key === 'socialAccounts');

  it('exists, and is not org-admin only', () => {
    expect(item).toBeTruthy();
    expect(item.to).toBe('/settings/social-accounts');
    expect(item.orgAdminOnly).toBeUndefined();
  });

  it('is shown to a Marketing holder who has no Sahayak grant', () => {
    expect(canSeeNavItem(item, { moduleGrants: ['prachar'] })).toBe(true);
  });

  it('is shown to a Sahayak holder who has no Marketing grant', () => {
    expect(canSeeNavItem(item, { moduleGrants: ['sahayak'] })).toBe(true);
  });

  it('is shown to an org admin, whose reach is the subscription', () => {
    // `moduleGrants: null` is the server expressing NO OPINION, and treating it
    // as "granted nothing" is how the whole modules group once vanished for
    // administrators.
    expect(canSeeNavItem(item, { moduleGrants: null, isOrgAdmin: true })).toBe(true);
  });

  it('is hidden from a member granted neither', () => {
    expect(canSeeNavItem(item, { moduleGrants: ['ganit'] })).toBe(false);
    expect(canSeeNavItem(item, { moduleGrants: [] })).toBe(false);
  });
});

// ── 7 · "Post as…?" — the destination picker ────────────────────────────────

/**
 * THE DEFECT IT CLOSES. The OAuth callback used to take the FIRST thing the
 * network returned — the first Facebook Page, the first Google location, and
 * for LinkedIn the personal feed of whoever clicked Connect — file it under the
 * client and redirect saying "connected". A firm administering three Pages got
 * one of them and was never asked which.
 *
 * THE OWNER'S RULE, 2026-08-21: "any connectors can do both. depends on org —
 * someone org is sole business owner who is its own page", and "also option to
 * have multiple for all connectors ... as a company can have multiple account
 * across social media."
 *
 * So the browser is handed the LIST and the person chooses, possibly several.
 * The two things only a browser test can see are that the choice is genuinely
 * multiple, and that nothing is stored until it is made.
 */
describe('the destination picker', () => {
  const LIVE_LINKEDIN = card('linkedin', 'LinkedIn', {
    app: { configured: true, scope: 'org', saved_but_off: false },
    state: 'ready',
  });

  const PENDING = {
    platform: 'linkedin',
    client_id: CLIENT,
    client_name: 'Aekam Inc',
    note: '',
    destinations: [
      { key: 'd0', name: 'Keval Shah', kind: 'person',
        what: 'your personal profile' },
      { key: 'd1', name: 'Aekam Inc', kind: 'linkedin_organization',
        what: 'Company Page' },
      { key: 'd2', name: 'Unicode Group', kind: 'linkedin_organization',
        what: 'Company Page' },
    ],
  };

  function returnLeg(search) {
    window.history.replaceState({}, '', search);
  }

  function servePicker({ can = ALL_ALLOWED, pending = PENDING, note = '' } = {}) {
    get.mockImplementation((url) => {
      if (url.includes('/oauth/pending/')) {
        return Promise.resolve({ data: { ...pending, note } });
      }
      if (url.includes('/connectors/social-status')) {
        return Promise.resolve({ data: {
          data: [LIVE_LINKEDIN], client_id: CLIENT,
          clients: [{ id: CLIENT, name: 'Aekam Inc', is_internal: true }],
          can, denials: NO_DENIALS, level: 'admin',
        } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
  }

  afterEach(() => { window.history.replaceState({}, '', '/'); });

  it('asks "Post as…?" and says what each destination IS', async () => {
    returnLeg('/?oauth=choose&choose=tok123&platform=linkedin');
    servePicker();
    draw();

    expect(await screen.findByText('Post as…?')).toBeTruthy();
    // A name alone cannot say whether this is a personal timeline or a company
    // page, and those are different audiences.
    expect(screen.getByText('Keval Shah')).toBeTruthy();
    expect(screen.getByText('your personal profile')).toBeTruthy();
    expect(screen.getAllByText('Company Page')).toHaveLength(2);
    // BOTH shapes are offered. That is the owner's whole point — a sole trader
    // picks themselves, a firm picks its page.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('stores nothing until somebody chooses', async () => {
    returnLeg('/?oauth=choose&choose=tok123&platform=linkedin');
    servePicker();
    draw();

    const connect = await screen.findByRole('button', { name: /^Connect$/ });
    expect(connect.disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
    // Said out loud, because a half-finished consent looks identical to a
    // finished one from the outside.
    expect(screen.getByText(/Nothing is connected until you press Connect/i))
      .toBeTruthy();
  });

  it('lets one person pick several, and says each becomes its own account',
    async () => {
      returnLeg('/?oauth=choose&choose=tok123&platform=linkedin');
      servePicker();
      post.mockResolvedValue({ data: {
        status: 'connected', connected: 2,
        accounts: [
          { platform: 'linkedin', account_name: 'Aekam Inc', what: 'Company Page' },
          { platform: 'linkedin', account_name: 'Unicode Group', what: 'Company Page' },
        ],
      } });
      draw();

      await screen.findByText('Post as…?');
      const boxes = screen.getAllByRole('checkbox');
      fireEvent.click(boxes[1]);
      fireEvent.click(boxes[2]);

      const submit = await screen.findByRole('button', { name: /Connect these 2/ });
      fireEvent.click(submit);

      await waitFor(() => expect(post).toHaveBeenCalled());
      const [url, body] = post.mock.calls[0];
      // Posted to the client the CONSENT was for, not whichever client the page
      // fell back to after the full page load through the provider.
      expect(url).toContain(CLIENT);
      expect(body).toEqual({ choice_token: 'tok123', destinations: ['d1', 'd2'] });

      expect(await screen.findByText(/separate connected account/i)).toBeTruthy();
    });

  it('tells the truth about the Company Pages LinkedIn will not hand over',
    async () => {
      returnLeg('/?oauth=choose&choose=tok123&platform=linkedin');
      servePicker({
        pending: { ...PENDING, destinations: [PENDING.destinations[0]] },
        note: 'Company Pages are not listed. LinkedIn only shows the Pages '
            + 'somebody administers to an app holding its Community Management '
            + 'API grant, which is an approval LinkedIn gives to the app.',
      });
      draw();

      expect(await screen.findByText(/Community Management/)).toBeTruthy();
      // And the personal profile still works, which is the half we DO hold.
      expect(screen.getByText('your personal profile')).toBeTruthy();
    });

  it('draws no picker for somebody who may not connect', async () => {
    returnLeg('/?oauth=choose&choose=tok123&platform=linkedin');
    servePicker({ can: { connect: false, send: true, edit_app: false } });
    draw();

    await screen.findByText('Ready');
    await waitFor(() => expect(screen.queryByText('Post as…?')).toBeNull());
    // And it never even asked for the list.
    expect(get.mock.calls.some(c => String(c[0]).includes('/oauth/pending/')))
      .toBe(false);
  });

  it('says so when the network came back with nowhere to post', async () => {
    returnLeg('/?oauth=nodestination&platform=linkedin');
    servePicker();
    draw();

    expect(await screen.findByText(/came back with nothing this product can post to/i))
      .toBeTruthy();
    expect(screen.queryByText('Post as…?')).toBeNull();
  });

  it('recognises the return leg for its own network and no other', () => {
    const q = '?oauth=choose&choose=tok123&platform=linkedin';
    expect(pendingChoiceToken('linkedin', q)).toBe('tok123');
    expect(pendingChoiceToken('instagram', q)).toBe('');
    expect(pendingChoiceToken('linkedin', '?platform=linkedin')).toBe('');
    expect(cameBackWithNothing('linkedin', '?oauth=nodestination&platform=linkedin'))
      .toBe(true);
    expect(cameBackWithNothing('facebook', '?oauth=nodestination&platform=linkedin'))
      .toBe(false);
  });
});

// ── 8 · several accounts on one network are legible ─────────────────────────

it('says which connected account is the Page and which is the person', async () => {
  // THE POINT OF THE WHOLE CHANGE, on the list rather than in the picker. Three
  // names on one card cannot be told apart; three names with what they ARE can.
  serve({
    cards: [card('linkedin', 'LinkedIn', {
      app: { configured: true, scope: 'org', saved_but_off: false },
      accounts: { connected: 2, expired: 0,
                  names: ['Keval Shah', 'Aekam Inc'], expired_names: [] },
      state: 'live',
    })],
    accounts: [
      { id: 'a1', platform: 'linkedin', account_name: 'Keval Shah',
        what: 'your personal profile' },
      { id: 'a2', platform: 'linkedin', account_name: 'Aekam Inc',
        what: 'Company Page' },
    ],
  });
  draw();
  // `findBy`, not `getBy`: the roll-up supplies the NAMES immediately and the
  // account rows arrive on a second request, so a synchronous assertion here
  // races the fetch that carries what each one IS.
  expect(await screen.findByText('your personal profile')).toBeTruthy();
  expect(screen.getByText('Keval Shah')).toBeTruthy();
  expect(screen.getByText('Company Page')).toBeTruthy();
});
