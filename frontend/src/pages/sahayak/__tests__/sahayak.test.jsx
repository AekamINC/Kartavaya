/**
 * Sahayak — reachability, authorisation, and the structure the prototype draws.
 *
 * The defect the first block guards is not a rendering one. The chatbot was
 * finished, metered, grounded and billed, and NO ORG USER COULD REACH IT:
 * `OrgSahayakPage` had six tabs and none of them was the assistant. A test that
 * only mounted `SahayakTab` would have passed the whole time the product was
 * broken, so the first describe block mounts the PAGE.
 *
 * The rest is about the surface being the one `design-reference/Kartavaya
 * Redesign/sahayak.css` draws, not the one that shipped before it. Those two
 * share a three-letter prefix and agree on almost no class name, so asserting
 * "a reply rendered" would pass on either. The assertions below are on the
 * prototype's own vocabulary — `.sh__turn`, `.sh__you`, `.sh__a-av--mark`,
 * `.sh__p`, `.sh__side`, `.sh--wide`, `.sh__cp-box` — and on the two structural
 * facts that are easy to regress silently: that the panel is PRESENT rather than
 * behind a button, and that `.sh--wide` is what its absence looks like.
 *
 * `createRoot` + `act` rather than @testing-library/react: it is installed but
 * its @testing-library/dom peer is not, so importing it throws. Same shape as
 * `contentTable.test.jsx`, which records the same constraint.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Every URL the component asked for, in order. */
let got = [];
let posted = [];
/** What each route answers with, set per test. */
let handlers = {};

/**
 * Routed most-specific-first, deliberately.
 *
 * A substring map keyed on `/chat/sessions` and `/messages` looks fine and is
 * not: `/v1/hub/chat/sessions/s1/messages` contains BOTH, so whichever key was
 * declared first wins and the thread quietly renders the session list. That is
 * a harness that lies about the component, which is worse than one that fails.
 */
function route(url) {
  const u = String(url);
  if (/\/messages$/.test(u)) return handlers.messages;
  // The ANSWER route. Anchored, so it cannot also catch
  // `/v1/hub/chat/sessions/s1/messages` — the mistake this comment block is
  // about, one endpoint later.
  if (/\/hub\/chat$/.test(u)) return handlers.send;
  if (/\/send$/.test(u)) return handlers.send;
  if (/\/chat\/sessions$/.test(u)) return handlers.sessions;
  if (u.includes('/org-client')) return handlers.orgClient;
  if (u.includes('/org/credits')) return handlers.credits;
  return {};
}

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn((url) => {
      got.push(String(url));
      return Promise.resolve({ data: route(url) ?? {} });
    }),
    post: vi.fn((url, body) => {
      posted.push([String(url), body]);
      return Promise.resolve({ data: route(url) ?? {} });
    }),
    put: vi.fn(() => Promise.resolve({ data: {} })),
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

vi.mock('../../../lib/auth', () => ({
  currentUser: () => ({
    user_id: 'u1',
    org_roles: [{ role_code: 'org_owner', org_name: 'Unicode Group' }],
  }),
}));

const { ToastProvider } = await import('../../../components/ui/toast');
const { default: SahayakTab, toTurns, atLabel } = await import('../SahayakTab');
const { default: OrgSahayakPage } = await import('../../OrgSahayakPage');
const { blocksOf, costLine } = await import('../assistant/AnswerBody');
const { parseSources, sourceFoot, safeUrl } = await import('../assistant/sources');

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  got = [];
  posted = [];
  handlers = {};
  // ADDED 2026-08-06, and it is not housekeeping. The shell now REMEMBERS the
  // rail, the view and the conversation in `kv_sahayak_shell` (assistant/
  // prefs.js), so a test that opens the rail leaves it open for every test that
  // runs after it — which made three assertions in this file pass or fail on
  // their position in the run order rather than on the component. A suite that
  // inherits the previous test's storage is a suite that lies exactly once.
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  window.localStorage.clear();
});

const mount = (el) => act(() => root.render(
  <MemoryRouter><ToastProvider>{el}</ToastProvider></MemoryRouter>,
));

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const all = sel => [...container.querySelectorAll(sel)];
const one = sel => container.querySelector(sel);
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };

/* The shapes the two endpoints really answer with. */
const ORG_CLIENT = { client: { id: 'cl-1', name: 'Unicode Group' }, brand: null };
const session = (id, over = {}) => ({
  id, title: `Chat ${id}`, message_count: 4,
  updated_at: new Date().toISOString(), ...over,
});
/** A knowledge-base source: numbered, because it was numbered into the prompt. */
const kbSource = (ref, title) => ({
  ref, chunk_id: `c${ref}`, title, source_type: 'file', similarity: 0.91,
});
/**
 * A grounded web page, AS THE SERVER WRITES IT.
 *
 * CORRECTED 2026-08-19, and this fixture was the reason a real defect could sit
 * in front of a green suite. It used to be `{ title, url, type: 'web' }` with a
 * docstring reading "no `ref`, because nothing numbered it" — so every
 * assertion about web citations was made against a shape the product does not
 * produce, and `sources.js` nulling `ref` for web sources looked correct
 * because the fixture had no `ref` to null.
 *
 * `routers/hub.py:3942` numbers each Serper result (`r["ref"] = first_web_ref +
 * i`) and writes `{kind, type, ref, title, url}`; 75 of the 77 stored web
 * sources carry one. The number is passed as a STRING here on purpose: the
 * jsonb column read back over a connection whose codec never registered hands
 * back the characters, and a test that only ever sends an int cannot tell the
 * difference between coercing and not.
 */
const webSource = (ref, url, title = 'CBIC') => ({
  kind: 'web', type: 'web', ref: String(ref), title, url,
});
/** The web pages that genuinely have no number: Gemini's own grounding
 *  (`sahayak_answer.web_sources`) and `hub_chat.py:503`. Nothing numbered
 *  these, so no `[n]` may ever point at one. */
const unnumberedWeb = (url) => ({ title: 'CBIC', url, type: 'web' });

function serve({ sessions = [], messages = [], send = {} } = {}) {
  handlers = {
    orgClient: ORG_CLIENT,
    sessions: { data: sessions },
    messages: { data: messages },
    send,
    credits: { org_balance: { balance: 300, plan_credits: 1000, used: 12 } },
  };
}

/* ── 1 · It is reachable at all ──────────────────────────────────────────── */

describe('Sahayak is reachable from the org page', () => {
  it('puts a Sahayak tab on the strip, and opens on it', async () => {
    serve({ sessions: [] });
    await mount(<OrgSahayakPage />);
    await settle();

    const tabs = all('[role="tab"]').map(t => t.textContent.toLowerCase());
    expect(tabs.some(t => t.includes('sahayak'))).toBe(true);

    const selected = all('[role="tab"]').find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected.textContent.toLowerCase()).toContain('sahayak');
  });

  it('mounts the assistant, not a placeholder — it resolves the org workspace', async () => {
    serve({ sessions: [] });
    await mount(<OrgSahayakPage />);
    await settle();
    expect(got.some(u => u.includes('/v1/hub/org-client'))).toBe(true);
    expect(one('.sh')).not.toBeNull();
    expect(one('.sh__cp-box')).not.toBeNull();
  });

  it('keeps every existing deep link working', async () => {
    serve({ sessions: [] });
    await mount(<OrgSahayakPage />);
    await settle();
    const ids = all('[role="tab"]').map(t => t.id);
    for (const t of ['sahayak', 'skills', 'content', 'generate', 'data catalog', 'data runs', 'credits']) {
      expect(ids).toContain(`mt-tab-${t}`);
    }
  });
});

/* ── 2 · The endpoints an org user is actually authorised to hit ──────────── */

describe('it calls only routes an org member may call', () => {
  it('resolves the org internal client first, then lists that client’s sessions', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    const orgClientAt = got.findIndex(u => u.includes('/v1/hub/org-client'));
    const sessionsAt = got.findIndex(u => u.includes('/v1/hub/clients/cl-1/chat/sessions'));
    expect(orgClientAt).toBeGreaterThanOrEqual(0);
    expect(sessionsAt).toBeGreaterThan(orgClientAt);
  });

  it('never asks for the agency client directory — a client org has none', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();
    // `GET /v1/hub/clients` is the agency's own list of the orgs it works for.
    // Reaching for it here is the shape of the bug this whole surface replaces.
    expect(got.some(u => /\/v1\/hub\/clients(\?|$)/.test(u))).toBe(false);
  });

  it('says so plainly when the server returns no workspace', async () => {
    serve({});
    handlers.orgClient = { client: null };
    await mount(<SahayakTab />);
    await settle();
    expect(text()).toContain('no workspace to answer from yet');
    // And it does NOT go on to ask for `/clients/null/chat/sessions`.
    expect(got.some(u => u.includes('null'))).toBe(false);
  });
});

/* ── 3 · The surface is the prototype's, not the one it replaced ──────────── */

describe('the frame is the prototype’s two-column grid', () => {
  it('has no in-surface chrome bar and no Focus/Workbench toggle', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    // Every one of these is a class from the build this replaces. The prototype
    // puts the module header in the tab shell above `.sh` and has one layout.
    for (const dead of ['.sh__chrome', '.sh__modes', '.sh__mode', '.sh__body', '.sh-ac', '.sh-cite', '.sh-foot']) {
      expect(all(dead)).toHaveLength(0);
    }
    expect(one('.sh__main')).not.toBeNull();
    expect(one('.sh__thread')).not.toBeNull();
  });

  it('draws the empty state as the prototype does — lotus, wordmark, seeds', async () => {
    serve({ sessions: [] });
    await mount(<SahayakTab />);
    await settle();

    // 29 §6: the lotus is the only waiting state, and it is the empty state too.
    expect(one('.sh__hero-mark .bl')).not.toBeNull();
    expect(one('.sh__hero-hi').textContent).toBe('सहायक');
    expect(one('.sh__hero-hi').getAttribute('lang')).toBe('hi');
    expect(all('.sh__seed')).toHaveLength(6);
    // 24-bilingual-devanagari.md: `lang` is what stops a screen reader
    // announcing Hindi with English phonemes.
    const dev = all('.sh__seed--dev b');
    expect(dev).toHaveLength(2);
    expect(dev.every(b => b.getAttribute('lang') === 'hi')).toBe(true);
  });

  it('groups each question with the reply it produced, in one .sh__turn', async () => {
    serve({
      sessions: [session('s-new', { title: 'GST deadlines' })],
      messages: [
        { id: 'm1', role: 'user', content: 'Does Sanchay file monthly?', created_at: '2026-08-06T06:08:00Z' },
        { id: 'm2', role: 'assistant', content: 'Quarterly — Sanchay is on QRMP.', sources: [] },
      ],
    });
    await mount(<SahayakTab />);
    await settle();

    // The list comes back ORDER BY updated_at DESC, so the head is where the
    // person left off.
    expect(got.some(u => u.includes('/chat/sessions/s-new/messages'))).toBe(true);

    const turns = all('.sh__turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].querySelector('.sh__you').textContent).toBe('Does Sanchay file monthly?');
    expect(turns[0].querySelector('.sh__a-b .sh__p').textContent)
      .toContain('Quarterly — Sanchay is on QRMP.');
    // The reply is prose on the canvas, not a provenance-coloured card.
    expect(turns[0].querySelector('.sh-ac')).toBeNull();
    // The lotus sits at rest beside the finished reply — one per answer, and it
    // is BrandLoader rather than a second spinner drawn for this screen.
    expect(turns[0].querySelectorAll('.sh__a-av--mark .bl')).toHaveLength(1);
    // Not the welcome screen — that is the empty state of a CONVERSATION.
    expect(one('.sh__hero')).toBeNull();
  });

  it('stamps the question with the time the server stored it', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm1', role: 'user', content: 'Hi', created_at: '2026-08-06T06:08:00Z' }],
    });
    await mount(<SahayakTab />);
    await settle();
    const at = one('.sh__me-l');
    expect(at).not.toBeNull();
    expect(at.textContent).toBe(atLabel('2026-08-06T06:08:00Z'));
    expect(at.textContent).toMatch(/\d/);
  });

  it('pairs a question with two consecutive replies rather than orphaning one', () => {
    const turns = toTurns([
      { id: 'a', role: 'user' }, { id: 'b', role: 'assistant' }, { id: 'c', role: 'assistant' },
      { id: 'd', role: 'user' },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].answers.map(m => m.id)).toEqual(['b', 'c']);
    expect(turns[1].answers).toEqual([]);
    // A thread whose first stored row is an answer still renders it.
    expect(toTurns([{ id: 'z', role: 'assistant' }])[0].answers.map(m => m.id)).toEqual(['z']);
  });
});

/* ── 4 · The panel is permanent, and .sh--wide is its absence ─────────────── */

describe('the sources panel is a column, not a disclosure', () => {
  it('is absent and the frame goes wide when the answer cited nothing', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: 'An ungrounded answer.', sources: [] }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh__side')).toBeNull();
    expect(one('.sh').className).toContain('sh--wide');
    // 29 §2 rule 1 — an answer that cannot point at where it came from says so.
    expect(one('.sh-none')).not.toBeNull();
    expect(text()).toContain('Nothing was cited for this answer');
  });

  it('is present, with no button to reveal it, when the answer cited records', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'On the 22nd [1], not the 20th [2].',
        sources: [kbSource(1, 'client-notes-sanchay.pdf'), webSource(2, 'https://www.cbic.gov.in/n/14')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh').className).not.toContain('sh--wide');
    expect(one('.sh__side')).not.toBeNull();
    expect(all('.sh-src')).toHaveLength(2);
    /* The panel is a COLUMN here: it arrived with the answer, nothing was
       clicked to reveal it, and `.sh--sheet` — the class that would present it
       as the mobile bottom sheet — is not on the surface.
       AMENDED 2026-08-06. This used to assert `.sh__side-x` is null, on the
       reasoning that a panel which never closes needs no close control. That is
       still true at this width and the control is `display: none` above 767px,
       but it is now in the MARKUP at every width, because below 768px the same
       panel is a sheet and a sheet must be dismissible. Asserting on its absence
       from the DOM was asserting on the implementation of a viewport rule. */
    expect(one('.sh').className).not.toContain('sh--sheet');
    expect(all('.sh-src.on')).toHaveLength(0);
    // A grounded answer is not accused of citing nothing.
    expect(one('.sh-none')).toBeNull();
  });

  it('reads a sources column that arrived as a JSON string', async () => {
    // db.py:82 warns rather than raises when PgBouncer drops the codec
    // handshake, and then asyncpg hands jsonb back as text. `GET …/messages`
    // returns the column straight from the row, so this is a real shape.
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'Quarterly [1].',
        sources: JSON.stringify([kbSource(1, 'client-notes-sanchay.pdf')]),
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh-src')).toHaveLength(1);
    expect(one('.sh-src').textContent).toContain('client-notes-sanchay.pdf');
  });

  it('highlights the card an inline cite names, and the cite is a real control', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'On the 22nd [1], not the 20th [2].',
        sources: [kbSource(1, 'sanchay.pdf'), kbSource(2, 'circular.pdf')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    const cites = all('.sh__p cite');
    expect(cites).toHaveLength(2);
    // A `<cite>` is neither focusable nor clickable on its own, and the whole
    // point of the marker is that it opens the record.
    expect(cites[1].getAttribute('role')).toBe('button');
    expect(cites[1].getAttribute('tabindex')).toBe('0');
    expect(cites[1].getAttribute('aria-label')).toBe('Source 2');
    expect(cites[1].getAttribute('title')).toBe('circular.pdf');

    await click(cites[1]);
    const hot = all('.sh-src.on');
    expect(hot).toHaveLength(1);
    expect(hot[0].textContent).toContain('circular.pdf');
    expect(cites[1].className).toBe('on');
  });

  it('leaves a [9] with nothing behind it as text, not as a dead control', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'See [9] for more.',
        sources: [kbSource(1, 'notes.pdf')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(all('.sh__p cite')).toHaveLength(0);
    expect(text()).toContain('See [9] for more.');
  });

  /**
   * REWRITTEN 2026-08-19. This test was called "never gives a web source a
   * citation number it was not cited by" and asserted `parsed[1].ref` is null
   * for a web source — and it passed for the wrong reason: the fixture it was
   * handed had no `ref` in the first place, so it proved nothing about the
   * `!isWeb &&` clause in sources.js that discarded the number when there WAS
   * one. That clause turned 77 of the 90 citations this product has ever made
   * into dead text.
   *
   * The rule the old title was reaching for is still true and still asserted:
   * a number is never INVENTED. What moved is where the number comes from —
   * it is read off the source, so a web page the server numbered keeps its
   * number and a web page nothing numbered still has none.
   */
  it('reads a citation number off any source that has one, and invents none', () => {
    const parsed = parseSources([
      kbSource(1, 'a.pdf'),
      webSource(2, 'https://cbic.gov.in/x'),
      unnumberedWeb('https://gemini.example/g'),
    ]);
    expect(parsed[0].ref).toBe(1);
    // The number arrives as the characters `2` off the jsonb column, and is a
    // number by the time anything compares it to a marker.
    expect(parsed[1].ref).toBe(2);
    expect(parsed[1].kind).toBe('web');
    // Nothing numbered this one, and nothing here numbers it either.
    expect(parsed[2].ref).toBeNull();
    expect(parsed[2].kind).toBe('web');

    expect(sourceFoot(parsed[1])).toBe('WEB · cbic.gov.in');
    expect(sourceFoot(parsed[0])).toBe('KB · file · 91% match');
  });

  /**
   * The whole point of fixing the number: the marker becomes the page.
   *
   * MEASURED 2026-08-17 — `[1]` rendered as dead text for every web source,
   * with the URL sitting in the panel two hundred pixels away and nothing
   * joining them.
   */
  it('renders a web citation as a real link to the page it cites', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'The date moved [1].',
        sources: [webSource(1, 'https://www.cbic.gov.in/n/14', 'Notification 2026/14')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    const cite = one('.sh__p cite');
    expect(cite, 'the web marker did not render as a cite chip').not.toBeNull();
    const a = cite.querySelector('a');
    expect(a, 'the web marker rendered as text, not as a link').not.toBeNull();
    expect(a.getAttribute('href')).toBe('https://www.cbic.gov.in/n/14');
    expect(a.getAttribute('target')).toBe('_blank');
    // These URLs come from a search API by way of the model. window.opener and
    // the referrer are not theirs to have.
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('aria-label')).toBe('Source 1');
    // Where it goes, said before it is clicked.
    expect(a.getAttribute('title')).toBe('Notification 2026/14 — cbic.gov.in');
    // An anchor is already focusable and already answers Enter, so the ARIA
    // button pattern is NOT stacked on top of it: that would be two controls in
    // one chip and a role that contradicts the element.
    expect(cite.getAttribute('role')).toBeNull();
    expect(a.getAttribute('role')).toBeNull();
  });

  /**
   * The scheme is the injection surface, and it is not ours to assume.
   *
   * A stored source is a string a search provider chose; `javascript:` in an
   * href is script execution on click, in the customer's session, on a page
   * that is already showing them their own books.
   */
  it('refuses a citation URL that is not http(s), and links nothing', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'See [1].',
        // eslint-disable-next-line no-script-url
        sources: [webSource(1, 'javascript:alert(document.cookie)')],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    // Not a link, so it falls back to the control that highlights the card —
    // the marker still means something, it just does not navigate.
    const cite = one('.sh__p cite');
    expect(cite.querySelector('a')).toBeNull();
    expect(cite.getAttribute('role')).toBe('button');
    // And the card in the panel is a block, not a dead anchor.
    expect(one('a.sh-src')).toBeNull();
    expect(one('.sh-src')).not.toBeNull();
  });

  it('refuses the same schemes at the parse boundary, whatever asks', () => {
    // Whitelist, not blacklist: everything that is not an absolute http(s) URL
    // comes back empty, including the shapes a blacklist forgets.
    for (const bad of [
      'javascript:alert(1)', 'data:text/html,<script>x</script>',
      'vbscript:msgbox(1)', '//evil.example/x', '/relative/path', 'cbic.gov.in/x',
    ]) {
      expect(safeUrl(bad), `${bad} was accepted as a link`).toBe('');
    }
    expect(safeUrl('https://cbic.gov.in/x')).toBe('https://cbic.gov.in/x');
    expect(safeUrl('HTTP://cbic.gov.in/x')).toBe('http://cbic.gov.in/x');
    // The card still says where it CLAIMED to come from, even when the URL is
    // one we will not open — refusing to navigate is not refusing to label.
    const [s] = parseSources([webSource(1, 'javascript:alert(1)', '')]);
    expect(s.url).toBe('');
    expect(s.ref).toBe(1);
  });

  it('survives every shape of nothing', () => {
    expect(parseSources(null)).toEqual([]);
    expect(parseSources('')).toEqual([]);
    expect(parseSources('not json')).toEqual([]);
    expect(parseSources('{}')).toEqual([]);
    expect(parseSources([null, 3, 'x'])).toEqual([]);
  });
});

/* ── 5 · The answer body renders only what the server sent ────────────────── */

describe('the answer body', () => {
  it('splits the reply into one bordered block per paragraph', () => {
    const blocks = blocksOf({ content: 'First para.\n\nSecond para.\n\n\nThird.' });
    expect(blocks.map(b => b.body)).toEqual(['First para.', 'Second para.', 'Third.']);
  });

  it('takes sections the day the schema returns them, with no rewrite', () => {
    const blocks = blocksOf({
      content: 'ignored once sections exist',
      sections: [
        { title: 'Quarterly', body: 'GSTR-3B falls on the 22nd.' },
        { body: 'The date moved in notification 2026/14.' },
      ],
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].title).toBe('Quarterly');
    expect(blocks[1].title).toBe('');
  });

  it('prints no figure the server did not return', () => {
    // 29 §8 and §3: never render a number with no provenance. Both of these
    // are dropped — one has no value, one has no route behind it.
    expect(costLine({ model: '', credits: null, sources: [] })).toBe('');
    expect(costLine({ model: 'gemini-2.5-flash', credits: 2, sources: [{}] }))
      .toBe('gemini-2.5-flash · 2 credits · 1 record read');
    expect(costLine({ model: 'x', credits: 0, sources: [] })).toBe('x');
  });

  it('draws no work steps and no figures, because the send route returns none', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: 'An answer.', sources: [], model_used: 'gemini-2.5-flash' }],
    });
    await mount(<SahayakTab />);
    await settle();
    // The markup and the CSS are here; the fields are not, so nothing is drawn.
    // Inventing a step list or a figure would be the one thing 29 §3 forbids.
    expect(all('.sh__work')).toHaveLength(0);
    expect(all('.sh__fig')).toHaveLength(0);
    // What the answer cost IS returned, and was never shown before.
    expect(one('.sh__cost').textContent).toContain('gemini-2.5-flash');
  });

  it('draws the steps and figures it is given, when it is given them', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'Six customers are past 45 days.', sources: [],
        work: [{ state: 'done', label: 'Read overdue invoices', fn: 'find_overdue_invoices · free' }],
        figs: [
          { label: 'Past 45 days', value: '₹18.4 L', sub: 'across 6 customers', src: 'GET /v1/ganit/invoices?overdue_gt=45' },
          { label: 'No route', value: '3' },
        ],
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(all('.sh__work-r')).toHaveLength(1);
    expect(one('.sh__work-r code').textContent).toBe('find_overdue_invoices · free');
    // A figure with no route behind it is dropped, not shown without one.
    expect(all('.sh__fig')).toHaveLength(1);
    expect(one('.sh__fig').getAttribute('title')).toBe('GET /v1/ganit/invoices?overdue_gt=45');
    expect(one('.sh__fig-v').textContent).toBe('₹18.4 L');
  });

  /**
   * The silent degradation, on the screen side.
   *
   * Backend 2026-08-07: a question about the org's own records that the planner
   * did not recognise used to read nothing and let the model answer ungrounded —
   * "I don't currently have access to your task records", which is false. It now
   * comes back with `refusal_detail.kind === 'unrecognised'`. The block must not
   * be titled "what it would not tell you": nothing was withheld, and telling
   * the reader something was is the second false impression in a row.
   */
  it('titles the none-block by what actually happened, not with one fixed string', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'Broadly, paperwork backlogs…',
        sources: [],
        refusal: 'Nothing from your own records was read for this answer.',
        refusal_detail: { kind: 'unrecognised', can_read: [] },
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh-none b').textContent).toBe('Nothing of yours was read for this');
    expect(one('.sh-none').textContent).not.toContain('would not tell you');
  });

  it('keeps the prototype’s own title for a partial answer', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', content: 'Six customers are past 45 days.',
        sources: [],
        refusal: 'Not everything this question needed could be read.',
        refusal_detail: { kind: 'partial' },
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh-none b').textContent).toBe('What it would not tell you');
  });

  it('renders model output as elements, never as HTML', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{ id: 'm2', role: 'assistant', content: '<img src=x onerror=alert(1)>', sources: [] }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__p img')).toBeNull();
    expect(one('.sh__p').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  /* ── The markdown the model actually emits ──────────────────────────────
   *
   * MEASURED 2026-08-17: a reply came back as one grey block. The grammar knew
   * headings, bullets, bold and inline code and nothing else, so a table
   * printed its pipes, a fenced block printed its backticks and a link printed
   * its brackets — on a surface whose whole job is to answer questions about a
   * company's books, which is where tables and figures live.
   */

  it('draws a markdown table as a table, on the one table style this surface has', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', sources: [],
        content: [
          '| Invoice | Customer | Days |',
          '| --- | --- | ---: |',
          '| INV-2101 | Sanchay Textiles | 62 |',
          '| INV-2107 | Rupa Traders | 48 |',
        ].join('\n'),
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    const table = one('.sh__p table.sh-ev');
    expect(table, 'the table printed as pipes').not.toBeNull();
    expect(all('.sh__p .sh-ev th').map(t => t.textContent))
      .toEqual(['Invoice', 'Customer', 'Days']);
    expect(all('.sh__p .sh-ev tbody tr')).toHaveLength(2);
    // Same rule as the evidence table: a bare number right-aligns onto the
    // tabular figures, an invoice number does not.
    const cells = all('.sh__p .sh-ev tbody tr:first-child td');
    expect(cells[2].className).toContain('num');
    expect(cells[0].className).not.toContain('num');
    // `.sh__wrap` is `width: min(760px, 100%)`, so a table wider than the
    // column has to scroll inside its own box or it widens the whole thread.
    expect(table.parentElement.style.overflowX).toBe('auto');
  });

  it('leaves a sentence with a pipe in it as a sentence', async () => {
    // The `|---|` rule line is what makes a table, never the row above it.
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', sources: [],
        content: 'Read it under Ganit | Invoices, then Ganit | Payments.',
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__p table')).toBeNull();
    expect(one('.sh__p').textContent).toContain('Ganit | Invoices');
  });

  it('draws a fenced block as code that scrolls instead of widening the thread', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', sources: [],
        content: [
          'Run this:',
          '',
          '```sql',
          'SELECT invoice_no, total_amount',
          '',
          'FROM staging.ganit_invoices WHERE status = 0;',
          '```',
        ].join('\n'),
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    const pre = one('.sh__p pre');
    expect(pre, 'the fence printed its backticks').not.toBeNull();
    expect(pre.textContent).toContain('SELECT invoice_no, total_amount');
    // The blank line INSIDE the fence is content. The paragraph splitter used
    // to cut here, which orphaned the opening fence from the closing one and
    // printed both.
    expect(pre.textContent).toContain('FROM staging.ganit_invoices');
    expect(container.textContent).not.toContain('```');
    expect(pre.style.overflowX).toBe('auto');
    // The language tag is not content.
    expect(pre.textContent).not.toContain('sql');
  });

  it('renders a markdown link, and refuses one whose scheme is not http(s)', async () => {
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', sources: [],
        content: 'See [the notification](https://cbic.gov.in/n/14) and '
          // eslint-disable-next-line no-script-url
          + '[this one](javascript:alert(1)).',
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    const links = all('.sh__p a');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('the notification');
    expect(links[0].getAttribute('href')).toBe('https://cbic.gov.in/n/14');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    // The refused one keeps its words and loses its link — a sentence with a
    // hole in it would be a worse answer than a sentence with a plain phrase.
    expect(one('.sh__p').textContent).toContain('this one');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('renders headings the model actually writes, including four hashes', async () => {
    // `####` matched none of the three `startsWith` cases the chain used to
    // spell out, so it printed its own hashes as prose.
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', sources: [],
        content: '## Receivables\n#### Past 45 days\nSix customers.',
      }],
    });
    await mount(<SahayakTab />);
    await settle();
    expect(one('.sh__p h3').textContent).toBe('Receivables');
    expect(one('.sh__p h4').textContent).toBe('Past 45 days');
    expect(container.textContent).not.toContain('####');
  });

  it('renders markup inside a table cell and inside a fence as text', async () => {
    // The two new containers are two new places a model could be talked into
    // writing a tag. Neither of them is an HTML sink.
    serve({
      sessions: [session('s1')],
      messages: [{
        id: 'm2', role: 'assistant', sources: [],
        content: [
          '| Item |',
          '| --- |',
          '| <img src=x onerror=alert(1)> |',
          '',
          '```',
          '<script>alert(2)</script>',
          '```',
        ].join('\n'),
      }],
    });
    await mount(<SahayakTab />);
    await settle();

    expect(container.querySelector('.sh__p img')).toBeNull();
    expect(container.querySelector('.sh__p script')).toBeNull();
    expect(one('.sh__p .sh-ev tbody td').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(one('.sh__p pre').textContent).toBe('<script>alert(2)</script>');
  });
});

/* ── 6 · Asking ───────────────────────────────────────────────────────────── */

describe('the composer', () => {
  /**
   * REPLACED 2026-08-06, and the old premise was false rather than merely stale.
   *
   * It read: "creates the conversation on the first send, so nobody presses New
   * chat first", and asserted a client-side `POST /clients/{id}/chat/sessions`
   * before the send. The USER-VISIBLE requirement in that sentence — a first
   * question works with no session open — is unchanged and is still asserted
   * below. What was wrong was the claim that the FRONTEND has to be the one to
   * create the row.
   *
   * It has to not be. This surface sits under `/api/v1/hub/`, one of the four
   * prefixes where a platform role may name another organisation on the
   * X-Org-Id header. Creating the session from the client put an
   * `hub_chat_sessions` row into whatever org the request resolved to, stamped
   * with the caller's user id, BEFORE anybody asked whether that caller could
   * have the answer — a write into a tenant the server was about to refuse.
   * `POST /v1/hub/chat` opens the conversation itself, after the refusal check.
   *
   * So this asserts everything the old test did AND three things it could not:
   * that no session is created client-side, that the answer route is the one
   * called, and that the id the server returns is adopted for the next question.
   */
  it('asks the answer route, and lets the SERVER open the conversation', async () => {
    serve({
      sessions: [],
      send: {
        session_id: 's-fresh', message_id: 'm-1', answered: true,
        message: 'Because it is on QRMP.', sources: [], work: [], figs: [],
        evidence: null, refusal: '', refusal_detail: null,
        model: 'gemini', credits: 2, credits_charged: 2, read: [],
      },
    });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__seed'));

    // Nothing was created from here. The row is the server's to write.
    expect(posted.find(([u]) => /\/clients\/cl-1\/chat\/sessions$/.test(u)))
      .toBeUndefined();

    const sent = posted.find(([u]) => /\/hub\/chat$/.test(u));
    expect(sent, 'the composer never called POST /v1/hub/chat').toBeTruthy();
    expect(sent[1].message).toBe("What's due this month?");
    // No session yet, so the workspace is named instead — the route scopes the
    // knowledge base to the client it verifies.
    expect(sent[1].session_id).toBeUndefined();
    expect(sent[1].client_id).toBe('cl-1');

    expect(one('.sh__p').textContent).toContain('Because it is on QRMP.');
    expect(one('.sh__you').textContent).toBe("What's due this month?");
  });

  it('sends the SECOND question into the conversation the server opened', async () => {
    serve({
      sessions: [],
      send: {
        session_id: 's-fresh', answered: true, message: 'Because it is on QRMP.',
        sources: [], work: [], figs: [], evidence: null, refusal: '',
        model: 'gemini', credits: 2, read: [],
      },
    });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__seed'));
    await settle();

    const box = one('.sh__cp textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      ).set.call(box, 'and the one after that?');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();

    const asks = posted.filter(([u]) => /\/hub\/chat$/.test(u));
    expect(asks.length).toBe(2);
    expect(asks[1][1].session_id).toBe('s-fresh');
  });

  it('does not swallow the question when the conversation itself cannot be started', async () => {
    // The composer clears the input before it does anything, so a failure
    // BEFORE the optimistic bubble exists has nowhere to land: the question
    // disappears, no error is shown, and the person retypes it. This is the
    // ordering, asserted.
    serve({ sessions: [] });
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 500, data: { detail: 'The workspace is unavailable.' } },
    }));
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__seed'));
    expect(one('.sh__you').textContent).toBe("What's due this month?");
    expect(one('.sh__you').className).toContain('sh__you--failed');
    expect(one('.sh__fail').textContent).toContain('The workspace is unavailable.');
  });

  it('reports a refused send in the thread, where the person is looking', async () => {
    serve({ sessions: [session('s1')], messages: [] });
    const { api } = await import('../../../lib/api');
    api.post.mockImplementationOnce(() => Promise.reject({
      response: { status: 402, data: { detail: 'This answer costs 2 credits; the org has 0.' } },
    }));
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__seed'));
    expect(one('.sh__fail').textContent).toContain('This answer costs 2 credits; the org has 0.');
  });
});

/* ── 7 · The rail, which is the one thing here the prototype does not have ─── */

describe('the conversation rail survives, closed', () => {
  it('is closed on first paint, so the default surface is the prototype', async () => {
    serve({ sessions: [session('s1', { title: 'GST deadlines' })] });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh__rail')).toBeNull();
    expect(one('.sh__scrim')).toBeNull();
    // It takes the slot the prototype gives `.sh__scope`, which narrates the
    // RBAC filter — 29 §2 rule 3 says not to.
    expect(one('.sh__scope')).toBeNull();
    expect(one('.sh__hist')).not.toBeNull();
    expect(one('.sh__hist').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the composer control and still reaches every past conversation', async () => {
    serve({ sessions: [session('s1', { title: 'GST deadlines' }), session('s2')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    expect(one('.sh__rail')).not.toBeNull();
    expect(all('.sh-si')).toHaveLength(2);
    expect(text()).toContain('GST deadlines');
    // The session the thread is on is the marked row.
    expect(all('.sh__row.on')).toHaveLength(1);
  });

  /**
   * The rail is a leading GRID TRACK now, not a drawer floating over the
   * thread, and the track only exists while it is open. `.sh--rail` is the
   * whole mechanism: without it on `.sh` the stylesheet has two columns and the
   * rail lands wherever auto-placement puts it. Asserted here because it is a
   * class the component composes at runtime, which is exactly the kind
   * check-classes.mjs cannot see.
   */
  it('adds the third track while it is open and takes it away again', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    expect(one('.sh').className).not.toContain('sh--rail');
    await click(one('.sh__hist'));
    expect(one('.sh').className).toContain('sh--rail');
    // The prototype's own two modifiers are untouched by it: this answer cited
    // nothing, so the surface is still wide.
    expect(one('.sh').className).toContain('sh--wide');

    await click(one('.sh__hist'));
    expect(one('.sh').className).not.toContain('sh--rail');
    expect(one('.sh__rail')).toBeNull();
  });

  it('closes on its own control, which is the only way out where there is no scrim', async () => {
    // Above 1280px the rail is a track and `.sh__scrim` never paints, so the
    // header control and Escape are the two ways to close it. The scrim is
    // aria-hidden and tabIndex -1, so it was never one for a keyboard.
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    expect(one('.sh__rail-x')).not.toBeNull();
    await click(one('.sh__rail-x'));
    expect(one('.sh__rail')).toBeNull();
    expect(one('.sh__hist').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    expect(one('.sh__rail')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(one('.sh__rail')).toBeNull();
  });

  it('opens the conversation it was pointed at, and shuts on the way', async () => {
    // The one behaviour a restyle is most likely to break silently: the row is
    // a button, it loads that session's messages, and the rail gets out of the
    // way afterwards.
    serve({
      sessions: [session('s1', { title: 'GST deadlines' }), session('s2', { title: 'Payroll' })],
      messages: [{ id: 'm1', role: 'user', content: 'Anything on payroll?' }],
    });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    const rows = all('.sh-si');
    await click(rows[1]);
    expect(got.some(u => u.includes('/chat/sessions/s2/messages'))).toBe(true);
    expect(one('.sh__rail')).toBeNull();
    expect(one('.sh').className).not.toContain('sh--rail');
  });

  it('still asks before destroying the answers as well as the questions', async () => {
    serve({ sessions: [session('s1')] });
    await mount(<SahayakTab />);
    await settle();

    await click(one('.sh__hist'));
    await click(one('.sh-si__x'));
    expect(text()).toContain('Delete this conversation permanently?');

    const { api } = await import('../../../lib/api');
    const del = all('.sh__confirm-act .btn').find(b => b.textContent === 'Delete');
    await click(del);
    expect(api.delete).toHaveBeenCalledWith('/v1/hub/chat/sessions/s1');
  });
});

/* ── 9 · The answer contract, on the screen ───────────────────────────────── */
//
// ADDED 2026-08-06. `POST /v1/hub/chat` shipped with a refusal block, work
// steps, figures and an evidence table — and ZERO call sites. A grep for the
// route across `src/` returned nothing; the composer still posted to the old
// `sessions/{id}/send` route, which returns `{message, sources, model,
// cost_usd, credits_charged}` and none of them. So every one of those blocks
// was proven by a pytest fixture against the router and rendered on no screen,
// and `.sh-ev` was an ORPHAN SELECTOR in the very baseline that wave shipped.
//
// Each test here drives the payload the route really returns through the real
// composer and asserts on the prototype's own class names. A test that stubbed
// the message object and rendered `AnswerBody` directly would have passed the
// whole time the endpoint was unreachable — which is the failure being closed.

describe('the answer contract reaches the screen', () => {
  const ask = async (send) => {
    serve({ sessions: [], send });
    await mount(<SahayakTab />);
    await settle();
    await click(one('.sh__seed'));
    await settle();
  };

  it('renders a REFUSAL as the refusal block, not as prose', async () => {
    const refusal = 'This needs Finance, which you do not have access to.';
    await ask({
      session_id: null, message_id: null, answered: false,
      message: refusal, work: [], figs: [], sources: [], evidence: null,
      refusal, refusal_detail: { kind: 'access', withheld_modules: ['ganit'] },
      model: '', credits: 0, credits_charged: 0, read: ['receivables'],
    });

    const none = one('.sh-none');
    expect(none, 'a refused answer drew no .sh-none block').not.toBeNull();
    expect(none.textContent).toContain('What it would not tell you');
    expect(none.textContent).toContain(refusal);
    // And NOT the generic ungrounded-answer fallback, which is what rendered
    // before the contract was wired and says something quite different.
    expect(none.textContent).not.toContain('Nothing was cited for this answer');
  });

  it('does not re-fetch the wallet for a refusal, which cost nothing', async () => {
    const onSpent = vi.fn();
    serve({
      sessions: [],
      send: {
        answered: false, message: 'No.', refusal: 'No.', sources: [],
        work: [], figs: [], evidence: null, credits: 0, read: [],
      },
    });
    await mount(<SahayakTab onSpent={onSpent} />);
    await settle();
    await click(one('.sh__seed'));
    await settle();

    expect(onSpent).not.toHaveBeenCalled();
  });

  it('re-fetches the wallet when the answer actually spent credits', async () => {
    const onSpent = vi.fn();
    serve({
      sessions: [],
      send: {
        answered: true, message: 'Six customers are past 45 days.', refusal: '',
        sources: [], work: [], figs: [], evidence: null, credits: 2, read: [],
      },
    });
    await mount(<SahayakTab onSpent={onSpent} />);
    await settle();
    await click(one('.sh__seed'));
    await settle();

    expect(onSpent).toHaveBeenCalled();
  });

  it('draws the named work steps the server sent', async () => {
    await ask({
      answered: true, message: 'Six are past 45 days.', refusal: '',
      sources: [], evidence: null, credits: 2, read: ['receivables'],
      figs: [],
      work: [
        { state: 'done', ok: true, label: 'Overdue customer invoices',
          fn: 'find_overdue', note: 'free', rows: 6, src: '/ganit/invoices' },
        { state: 'done', ok: true, label: 'Wrote the answer',
          fn: 'agent_type: chatbot', note: '2 credits', rows: 0, src: '' },
      ],
    });

    const rows = all('.sh__work-r');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Overdue customer invoices');
    expect(rows[0].className).toContain('done');
    expect(rows[1].textContent).toContain('Wrote the answer');
  });

  it('draws only figures that carry their own provenance', async () => {
    await ask({
      answered: true, message: 'Revenue held.', refusal: '', sources: [],
      evidence: null, credits: 2, read: ['kpis'], work: [],
      figs: [
        { label: 'Revenue', value: '4,20,000', sub: 'last 30 days', src: '/ganit' },
        // No `src`. A number with no provenance is the one thing worse than not
        // answering, so it must not reach the screen.
        { label: 'Guessed', value: '99', sub: '', src: '' },
      ],
    });

    const figs = all('.sh__fig');
    expect(figs.length).toBe(1);
    expect(figs[0].textContent).toContain('4,20,000');
    expect(text()).not.toContain('Guessed');
  });

  it('draws the evidence table — the .sh-ev orphan, now consumed', async () => {
    await ask({
      answered: true, message: 'Six are past 45 days.', refusal: '',
      sources: [], credits: 2, read: ['receivables'], work: [], figs: [],
      evidence: {
        cols: ['Item', 'Owner', 'Days past due'],
        rows: [['INV-2101', 'Priya', '96'], ['INV-2102', 'Anil', '73']],
        src: '/ganit/invoices', source_key: 'receivables',
        truncated: false, total: 2,
      },
    });

    const table = one('table.sh-ev');
    expect(table, 'the evidence table did not render').not.toBeNull();
    expect(all('.sh-ev th').map(t => t.textContent))
      .toEqual(['Item', 'Owner', 'Days past due']);
    expect(all('.sh-ev tbody tr').length).toBe(2);
    expect(one('.sh-ev tbody td').textContent).toBe('INV-2101');
    // Numbers right-align onto the tabular figures; text does not.
    const cells = all('.sh-ev tbody tr:first-child td');
    expect(cells[2].className).toContain('num');
    expect(cells[1].className).not.toContain('num');
  });

  it('opens the side column for evidence even with nothing cited', async () => {
    // `.sh--wide` is the answer-first layout — the panel's absence. An answer
    // built out of the ledger has evidence and no markers, and requiring a
    // marker would leave the column shut on exactly those questions.
    await ask({
      answered: true, message: 'Six are past 45 days.', refusal: '',
      sources: [], credits: 2, read: ['receivables'], work: [], figs: [],
      evidence: {
        cols: ['Item'], rows: [['INV-2101']], src: '/ganit/invoices',
        source_key: 'receivables', truncated: false, total: 1,
      },
    });

    expect(one('.sh__side')).not.toBeNull();
    expect(one('.sh').className).not.toContain('sh--wide');
  });

  it('says how many rows it is showing when the query returned more', async () => {
    await ask({
      answered: true, message: 'Twelve of forty.', refusal: '', sources: [],
      credits: 2, read: ['receivables'], work: [], figs: [],
      evidence: {
        cols: ['Item'], rows: [['INV-2101']], src: '/ganit/invoices',
        source_key: 'receivables', truncated: true, total: 40,
      },
    });

    expect(one('.sh__side').textContent).toContain('The first 1 of 40 rows');
  });

  it('renders evidence cells as text, never as markup', async () => {
    // The rows come out of the customer's own records, which are user input.
    await ask({
      answered: true, message: 'One row.', refusal: '', sources: [],
      credits: 2, read: ['receivables'], work: [], figs: [],
      evidence: {
        cols: ['Item'], rows: [['<img src=x onerror=alert(1)>']],
        src: '/ganit/invoices', source_key: 'receivables',
        truncated: false, total: 1,
      },
    });

    expect(one('.sh-ev img')).toBeNull();
    expect(one('.sh-ev tbody td').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
