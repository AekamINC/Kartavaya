/**
 * SigningPage — the six steps and every way each of them can fail.
 *
 * `/sign/:token` is the most externally visible surface in the product after
 * the landing page: no session, and the person looking at it is a CLIENT'S
 * CLIENT. It had never been driven end to end, because the page builds its own
 * `axios.create({ baseURL })` rather than using `lib/api`, and a mocked
 * `lib/api` therefore reaches none of it.
 *
 * The seam is `axios.defaults.adapter`. `axios.create` merges `axios.defaults`
 * AT CREATION TIME, so the assignment has to happen before the module is
 * imported — hence the top-level `await import` below the assignment, and not a
 * plain static import.
 *
 * Nothing here contacts a server or sends mail: the adapter answers every
 * request from the map a test declares, and each test asserts on the PAYLOAD it
 * would have sent.
 *
 * Rendered with react-dom directly rather than @testing-library/react — its
 * @testing-library/dom peer is not installed, so importing it throws. Same
 * reason and same shape as `ganitErrorStates.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: 'TOKEN' }) }));

let handler = null;
axios.defaults.adapter = (c) => (handler ? handler(c) : Promise.reject(new Error('unstubbed request')));

const { default: SigningPage } = await import('../pages/SigningPage');

const ok = (data) => Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config: {} });
/** An axios rejection carrying a response — a 4xx/5xx from the server. */
const fail = (status, detail) => {
  const e = new Error(detail || `HTTP ${status}`);
  e.response = { status, data: detail === undefined ? {} : { detail }, headers: {}, config: {} };
  e.isAxiosError = true;
  return Promise.reject(e);
};
/** An axios rejection with NO response — the connection never completed. */
const netdown = () => {
  const e = new Error('Network Error');
  e.isAxiosError = true;
  return Promise.reject(e);
};

/* The exact bodies `routers/esign.py` returns, field for field:
   `get_signing_page` (:341), `send_otp` (:390), `submit_signature` (:509). */
const PENDING_OTP = {
  status: 'pending',
  document_title: 'Master Services Agreement',
  document_description: 'FY26 engagement',
  file_url: 'https://r2.example/doc.pdf',
  signer_name: 'Asha Rao',
  signer_email: 'asha@client.example',
  otp_required: true,
};
/* `otp_required` is `not signer["otp_verified"]` (esign.py:348), so a first
   visit is ALWAYS the OTP path. This shape is the resume case: the signer
   verified, closed the tab, and opened the link again. It is the only way to
   land on `sign` directly, and it is reachable in production. */
const PENDING_SIGN = { ...PENDING_OTP, otp_required: false };

let container = null;
let root = null;
const calls = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls.length = 0;
  handler = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function route(map) {
  handler = (config) => {
    const url = `${config.method.toUpperCase()} ${config.url}`;
    calls.push({ url, body: config.data ? JSON.parse(config.data) : null });
    const fn = map[url];
    if (!fn) throw new Error(`unrouted request: ${url}`);
    return fn(config);
  };
}

async function mount() {
  await act(async () => { root.render(<SigningPage />); });
  await act(async () => {});
}

const txt = () => container.textContent;
const btn = (label) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const dlgBtn = (label) => [...container.querySelectorAll('[role=alertdialog] button')]
  .find(b => b.textContent.trim() === label);
const links = () => [...container.querySelectorAll('a')].map(a => a.getAttribute('href'));
const alerts = () => [...container.querySelectorAll('[role=alert]')].map(n => n.textContent);
const err = () => container.querySelector('.k-err');
const posts = (suffix) => calls.filter(c => c.url.startsWith('POST') && c.url.endsWith(suffix));

const click = async (el) => {
  expect(el, 'element to click was not found').toBeTruthy();
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const fill = async (sel, value) => {
  const el = container.querySelector(sel);
  expect(el, `input ${sel} not found`).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/* jsdom has no 2D context and no toDataURL. These stand in for both, and let
   the tests observe how many times the page repaints the paper and how many
   listeners it attaches — which is the whole of the ref-identity defect. */
function stubCanvas() {
  const fillRects = [];
  const listeners = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '',
    fillRect: (...a) => fillRects.push(a),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  const origGet = HTMLCanvasElement.prototype.getContext;
  const origUrl = HTMLCanvasElement.prototype.toDataURL;
  const origAdd = HTMLCanvasElement.prototype.addEventListener;
  const handlers = {};
  HTMLCanvasElement.prototype.getContext = () => ctx;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,CANVAS';
  HTMLCanvasElement.prototype.addEventListener = function (type, fn, opts) {
    listeners.push(type);
    (handlers[type] ||= []).push(fn);
    return origAdd.call(this, type, fn, opts);
  };
  return {
    fillRects, listeners,
    /** Drive a real stroke through the page's own handlers. */
    draw() {
      const c = container.querySelector('canvas');
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 160 });
      handlers.mousedown.forEach(f => f({ preventDefault() {}, clientX: 10, clientY: 10 }));
      handlers.mousemove.forEach(f => f({ preventDefault() {}, clientX: 60, clientY: 40 }));
      handlers.mouseup.forEach(f => f({ preventDefault() {} }));
    },
    restore() {
      HTMLCanvasElement.prototype.getContext = origGet;
      HTMLCanvasElement.prototype.toDataURL = origUrl;
      HTMLCanvasElement.prototype.addEventListener = origAdd;
    },
  };
}

// ── Step 1 · loading ────────────────────────────────────────────────────────

describe('step: loading', () => {
  it('shows a skeleton, and neither an error nor an empty document', async () => {
    route({ 'GET /v1/esign/verify/TOKEN': () => new Promise(() => {}) });
    await act(async () => { root.render(<SigningPage />); });

    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(err()).toBeNull();
    // Loading must never be mistaken for a document with no title.
    expect(txt()).not.toContain('Sign:');
    expect(txt()).not.toContain('Something broke');
  });
});

// ── Step 2 · the token's own lifecycle ──────────────────────────────────────

describe('token lifecycle — each failure says something true and distinct', () => {
  const cases = [
    ['malformed / unknown token', 404, 'Invalid signing link', 'missing'],
    ['withdrawn document',        410, 'This document has been cancelled or expired', 'request'],
    ['expired link',              410, 'This signing link has expired', 'request'],
    ['spent token',               400, 'Already signed', 'request'],
  ];

  it.each(cases)('%s → kind %s, and the server\'s own sentence', async (_label, status, detail, kind) => {
    route({ 'GET /v1/esign/verify/TOKEN': () => fail(status, detail) });
    await mount();

    expect(err()).toBeTruthy();
    expect(err().dataset.kind).toBe(kind);
    expect(err().textContent).toContain(detail);
  });

  it('never tells a stranger the server broke when the LINK is what is spent', async () => {
    route({ 'GET /v1/esign/verify/TOKEN': () => fail(400, 'Already signed') });
    await mount();

    expect(err().textContent).not.toContain('Something broke on our side');
    // `request` deliberately has no retry: re-sending a request the server just
    // rejected reproduces the rejection.
    expect(container.querySelectorAll('.k-err button')).toHaveLength(0);
  });
});

// ── Step 2b · transport failures on the initial read ────────────────────────

describe('initial verify — network and server failures', () => {
  it('a dropped connection is reported as offline, not as a broken server', async () => {
    route({ 'GET /v1/esign/verify/TOKEN': () => netdown() });
    await mount();

    expect(err().dataset.kind).toBe('offline');
    expect(err().textContent).not.toContain('Something broke on our side');
  });

  it('offline copy does not promise a stranger that anything was saved', async () => {
    route({ 'GET /v1/esign/verify/TOKEN': () => netdown() });
    await mount();

    // The shared copy is "Changes are saved and will sync when you're back."
    // This page holds no draft and syncs nothing; on a signing screen that
    // sentence answers "did my signature go through?" with a falsehood.
    expect(err().textContent).not.toContain('saved');
    expect(err().textContent).toContain('Nothing has been sent');
  });

  it('a 500 gives the signer something to press, and it re-reads the token', async () => {
    let attempt = 0;
    route({
      'GET /v1/esign/verify/TOKEN': () => {
        attempt += 1;
        return attempt === 1 ? fail(500, undefined) : ok(PENDING_OTP);
      },
    });
    await mount();

    expect(err().dataset.kind).toBe('server');
    const retry = btn('Try again');
    expect(retry, 'a 500 left the page with nothing to press at all').toBeTruthy();

    await click(retry);
    await act(async () => {});
    expect(txt()).toContain('Master Services Agreement');
    expect(attempt).toBe(2);
  });
});

// ── Step 3 · otp_send ───────────────────────────────────────────────────────

describe('step: otp_send', () => {
  const withSend = (send) => route({
    'GET /v1/esign/verify/TOKEN': () => ok(PENDING_OTP),
    'POST /v1/esign/verify/TOKEN/otp/send': send,
  });

  it('names the signer, the document, and links the PDF', async () => {
    withSend(() => ok({ sent: true, email: 'a***a@client.example' }));
    await mount();

    expect(txt()).toContain('Master Services Agreement');
    expect(txt()).toContain('Asha Rao');
    expect(links()).toContain('https://r2.example/doc.pdf');
    expect(btn('Send verification code')).toBeTruthy();
    expect(btn('Decline')).toBeTruthy();
  });

  it('carries the masked address the server returned onto the next step', async () => {
    withSend(() => ok({ sent: true, email: 'a***a@client.example' }));
    await mount();
    await click(btn('Send verification code'));

    // `send_otp` returns {"sent", "email"} — esign.py:390.
    expect(txt()).toContain('a***a@client.example');
    expect(container.querySelector('#sgn-otp')).toBeTruthy();
  });

  it('a rejected send keeps the signer here with the server\'s reason', async () => {
    withSend(() => fail(400, 'Already signed'));
    await mount();
    await click(btn('Send verification code'));

    expect(alerts()).toContain('Already signed');
    expect(container.querySelector('#sgn-otp'), 'must not advance on a failure').toBeNull();
  });

  it('a dropped connection on send says so, and does not blame the signer', async () => {
    withSend(() => netdown());
    await mount();
    await click(btn('Send verification code'));

    expect(alerts().join(' ')).toContain('offline');
  });
});

// ── Step 4 · otp_verify ─────────────────────────────────────────────────────

describe('step: otp_verify', () => {
  const withVerify = (verify) => route({
    'GET /v1/esign/verify/TOKEN': () => ok(PENDING_OTP),
    'POST /v1/esign/verify/TOKEN/otp/send': () => ok({ sent: true, email: 'a***a@client.example' }),
    'POST /v1/esign/verify/TOKEN/otp/verify': verify,
  });
  const reach = async () => { await mount(); await click(btn('Send verification code')); };

  it('the document stays readable on the step where the signer is waiting', async () => {
    withVerify(() => ok({ verified: true }));
    await reach();

    expect(links()).toContain('https://r2.example/doc.pdf');
  });

  it('a short code is caught locally — no request is sent', async () => {
    withVerify(() => ok({ verified: true }));
    await reach();
    await fill('#sgn-otp', '123');
    await click(btn('Verify'));

    expect(posts('/otp/verify')).toHaveLength(0);
    expect(alerts()).toContain('Enter the 6-digit code');
  });

  it('a wrong code shows the server\'s rejection and stays put', async () => {
    withVerify(() => fail(400, 'Invalid OTP'));
    await reach();
    await fill('#sgn-otp', '111111');
    await click(btn('Verify'));

    expect(alerts()).toContain('Invalid OTP');
    expect(btn('Verify')).toBeTruthy();
  });

  it('a rate limit is passed through verbatim, not flattened to "Invalid OTP"', async () => {
    withVerify(() => fail(429, 'Too many attempts. Request a new OTP.'));
    await reach();
    await fill('#sgn-otp', '111111');
    await click(btn('Verify'));

    expect(alerts()).toContain('Too many attempts. Request a new OTP.');
  });

  it('a 500 must NOT be reported as an invalid code', async () => {
    // The signer typed the right code. Telling them it was wrong sends them
    // round a loop that cannot succeed, and blames them for our fault.
    withVerify(() => fail(500, undefined));
    await reach();
    await fill('#sgn-otp', '123456');
    await click(btn('Verify'));

    expect(alerts().join(' ')).not.toContain('Invalid');
    expect(alerts().join(' ')).toContain('our side');
  });

  it('a dropped connection must NOT be reported as an invalid code', async () => {
    withVerify(() => netdown());
    await reach();
    await fill('#sgn-otp', '123456');
    await click(btn('Verify'));

    expect(alerts().join(' ')).not.toContain('Invalid');
    expect(alerts().join(' ')).toContain('offline');
  });

  it('a correct code reaches a signable state with no stale error left behind', async () => {
    withVerify(() => ok({ verified: true }));
    await reach();
    await fill('#sgn-otp', '123456');
    await click(btn('Verify'));

    expect(btn('Sign document')).toBeTruthy();
    expect(alerts()).toHaveLength(0);
  });
});

// ── Step 5 · sign ───────────────────────────────────────────────────────────

describe('step: sign — the no-OTP (resume) path', () => {
  const withSign = (sign) => route({
    'GET /v1/esign/verify/TOKEN': () => ok(PENDING_SIGN),
    'POST /v1/esign/verify/TOKEN/sign': sign,
  });

  it('is complete without an OTP: the document is linked and the page is signable', async () => {
    withSign(() => ok({ signed: true, document_status: 'completed', signers_completed: 1, signers_total: 1 }));
    await mount();

    // The regression this guards: the PDF link once existed only in the
    // `otp_send` branch, so with otp_required false the signer reached the IT
    // Act, 2000 notice with no way to open what they were agreeing to.
    expect(links()).toContain('https://r2.example/doc.pdf');
    expect(btn('Sign document')).toBeTruthy();
    expect(txt()).toContain('IT Act, 2000');
  });

  it('an empty typed name is caught locally — no request is sent', async () => {
    withSign(() => ok({}));
    await mount();
    await click(btn('Sign document'));

    expect(posts('/sign')).toHaveLength(0);
    expect(alerts()).toContain('Type your name to sign');
  });

  it('a typed signature sends the trimmed name and reports the real tally', async () => {
    withSign(() => ok({ signed: true, document_status: 'partially_signed', signers_completed: 1, signers_total: 3 }));
    await mount();
    await fill('#sgn-name', '  Asha Rao  ');
    await click(btn('Sign document'));

    expect(posts('/sign')[0].body).toEqual({ signature_data: 'Asha Rao', signature_type: 'type' });
    expect(txt()).toContain('1/3 signers have signed');
    expect(txt()).not.toContain('All signatures collected');
  });

  it('announces completion only when the server says every signer is in', async () => {
    withSign(() => ok({ signed: true, document_status: 'completed', signers_completed: 2, signers_total: 2 }));
    await mount();
    await fill('#sgn-name', 'Asha Rao');
    await click(btn('Sign document'));

    expect(txt()).toContain('2/2 signers have signed');
    expect(txt()).toContain('All signatures collected');
  });

  it('a 403 is shown as the server phrased it, and nothing is claimed signed', async () => {
    withSign(() => fail(403, 'OTP verification required before signing'));
    await mount();
    await fill('#sgn-name', 'Asha Rao');
    await click(btn('Sign document'));

    expect(alerts()).toContain('OTP verification required before signing');
    expect(txt()).not.toContain('Document signed');
  });

  it('a 500 says nothing was signed, rather than nothing at all', async () => {
    withSign(() => fail(500, undefined));
    await mount();
    await fill('#sgn-name', 'Asha Rao');
    await click(btn('Sign document'));

    expect(alerts().join(' ')).toContain('our side');
    expect(txt()).not.toContain('Document signed');
    expect(btn('Sign document'), 'the signer must be able to try again').toBeTruthy();
  });

  it('a dropped connection leaves the signer able to retry', async () => {
    withSign(() => netdown());
    await mount();
    await fill('#sgn-name', 'Asha Rao');
    await click(btn('Sign document'));

    expect(alerts().join(' ')).toContain('offline');
    expect(txt()).not.toContain('Document signed');
    expect(btn('Sign document').disabled).toBe(false);
  });
});

// ── Idempotency and double-submit ───────────────────────────────────────────

describe('double-submit', () => {
  const hang = () => {
    let settle;
    const p = new Promise(r => {
      settle = () => r({ data: { signed: true, document_status: 'completed', signers_completed: 1, signers_total: 1 }, status: 200, headers: {}, config: {} });
    });
    p.settle = () => settle();
    return p;
  };

  it('a second click while the first is in flight sends nothing', async () => {
    const inflight = hang();
    route({
      'GET /v1/esign/verify/TOKEN': () => ok(PENDING_SIGN),
      'POST /v1/esign/verify/TOKEN/sign': () => inflight,
    });
    await mount();
    await fill('#sgn-name', 'Asha Rao');
    const b = btn('Sign document');
    await click(b);
    await click(b);

    expect(posts('/sign')).toHaveLength(1);
    await act(async () => { inflight.settle(); });
  });

  it('two dispatches inside ONE task still send only one signature', async () => {
    // `busy` alone cannot cover this: it disables the button on the next
    // render, and both handlers have already run by then. Measured before the
    // fix: 2 POSTs. The endpoint is not idempotent — esign.py:486 reads
    // `signers_completed` and writes `+1` — so a duplicate can mark a
    // multi-signer document complete off one signer.
    const inflight = hang();
    route({
      'GET /v1/esign/verify/TOKEN': () => ok(PENDING_SIGN),
      'POST /v1/esign/verify/TOKEN/sign': () => inflight,
    });
    await mount();
    await fill('#sgn-name', 'Asha Rao');
    const b = btn('Sign document');
    await act(async () => {
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(posts('/sign')).toHaveLength(1);
    await act(async () => { inflight.settle(); });
  });

  it('reopening the link after signing lands on the terminal state, not a signable one', async () => {
    route({ 'GET /v1/esign/verify/TOKEN': () => ok({ status: 'already_signed', signed_at: '2026-07-20T10:00:00Z' }) });
    await mount();

    expect(txt()).toContain('You have already signed this document');
    // Not "20/7/2026" — the sibling public page dates the same way.
    expect(txt()).toContain('20 Jul 2026');
    expect(btn('Sign document')).toBeFalsy();
    expect(btn('Decline')).toBeFalsy();
  });

  it('a signed record with no timestamp still reads as a sentence', async () => {
    route({ 'GET /v1/esign/verify/TOKEN': () => ok({ status: 'already_signed', signed_at: null }) });
    await mount();

    expect(txt()).toContain('You have already signed this document.');
    expect(txt()).not.toContain('Invalid Date');
  });
});

// ── The drawn signature ─────────────────────────────────────────────────────

describe('drawn signature', () => {
  let cv;
  const reachDraw = async (sign) => {
    route({
      'GET /v1/esign/verify/TOKEN': () => ok(PENDING_SIGN),
      'POST /v1/esign/verify/TOKEN/sign': sign,
      'POST /v1/esign/verify/TOKEN/decline': () => ok({ declined: true }),
    });
    await mount();
    await click(btn('Draw signature'));
  };

  beforeEach(() => { cv = stubCanvas(); });
  afterEach(() => cv.restore());

  it('an untouched canvas is not a signature', async () => {
    // `toDataURL` on blank paper is a perfectly valid PNG. Submitting it put a
    // legally binding "Document signed" screen in front of a signer who had
    // drawn nothing.
    await reachDraw(() => ok({ signed: true, document_status: 'completed', signers_completed: 1, signers_total: 1 }));
    await click(btn('Sign document'));

    expect(posts('/sign')).toHaveLength(0);
    expect(alerts().join(' ')).toContain('Draw your signature');
    expect(txt()).not.toContain('Document signed');
  });

  it('a drawn stroke is accepted and sent as an image', async () => {
    await reachDraw(() => ok({ signed: true, document_status: 'completed', signers_completed: 1, signers_total: 1 }));
    cv.draw();
    await click(btn('Sign document'));

    expect(posts('/sign')[0].body.signature_type).toBe('draw');
    expect(posts('/sign')[0].body.signature_data).toMatch(/^data:image\/png/);
  });

  it('Clear puts the canvas back to "nothing drawn"', async () => {
    await reachDraw(() => ok({}));
    cv.draw();
    await click(btn('Clear'));
    await click(btn('Sign document'));

    expect(posts('/sign')).toHaveLength(0);
    expect(alerts().join(' ')).toContain('Draw your signature');
  });

  it('an unrelated re-render neither repaints the paper nor re-binds the canvas', async () => {
    // The ref callback used to be a new inline arrow every render, so React
    // detached and reattached it on each one: `fillRect` went 1 → 2 → 3 and the
    // listener count 7 → 14 → 21 just from opening and cancelling a dialog.
    // Each of those repaints erased a signature already on the paper.
    await reachDraw(() => ok({}));
    const paints = cv.fillRects.length;
    const bound = cv.listeners.length;

    await click(btn('Decline'));
    await click(dlgBtn('Cancel'));

    expect(cv.fillRects.length).toBe(paints);
    expect(cv.listeners.length).toBe(bound);
  });

  it('a failed attempt does not lose the signature and does not resubmit a blank one', async () => {
    // The chain this closes: draw → Sign → server error → the three re-renders
    // (busy on, error, busy off) wipe the canvas → Sign again → a blank PNG is
    // sent and accepted.
    let attempt = 0;
    await reachDraw(() => {
      attempt += 1;
      return attempt === 1
        ? fail(500, undefined)
        : ok({ signed: true, document_status: 'completed', signers_completed: 1, signers_total: 1 });
    });
    cv.draw();
    await click(btn('Sign document'));
    expect(txt()).not.toContain('Document signed');

    await click(btn('Sign document'));
    expect(posts('/sign')).toHaveLength(2);
    expect(posts('/sign')[1].body.signature_data).toMatch(/^data:image\/png/);
    expect(txt()).toContain('Document signed');
  });
});

// ── Step 6 · decline ────────────────────────────────────────────────────────

describe('step: declined', () => {
  const withDecline = (decline) => route({
    'GET /v1/esign/verify/TOKEN': () => ok(PENDING_SIGN),
    'POST /v1/esign/verify/TOKEN/decline': decline,
  });

  it('asks first — the one irreversible action is behind a real dialog', async () => {
    withDecline(() => ok({ declined: true }));
    await mount();
    await click(btn('Decline'));

    const dlg = container.querySelector('[role=alertdialog]');
    expect(dlg).toBeTruthy();
    expect(dlg.textContent).toContain('Decline to sign?');
    expect(posts('/decline'), 'opening the dialog must not send anything').toHaveLength(0);
  });

  it('confirming sends the reason and reaches the terminal state', async () => {
    withDecline(() => ok({ declined: true }));
    await mount();
    await click(btn('Decline'));
    await click(dlgBtn('Decline'));

    expect(posts('/decline')[0].body).toEqual({ reason: 'Declined by signer' });
    expect(txt()).toContain('You have declined to sign this document.');
  });

  it('a rejected decline says so instead of failing silently', async () => {
    withDecline(() => fail(400, 'Already signed'));
    await mount();
    await click(btn('Decline'));
    await click(dlgBtn('Decline'));

    expect(alerts()).toContain('Already signed');
    expect(txt()).not.toContain('You have declined');
  });

  it('a dropped connection on decline states that nothing changed', async () => {
    withDecline(() => netdown());
    await mount();
    await click(btn('Decline'));
    await click(dlgBtn('Decline'));

    expect(alerts().join(' ')).toContain('offline');
    expect(txt()).not.toContain('You have declined');
  });
});

// ── Loading / empty / error are three states, on every branch ───────────────

describe('every read has a rejection handler', () => {
  it('no failure anywhere leaves a blank card behind', async () => {
    // The TaskDrawer defect: a read with no `.catch` leaves its section empty
    // and indistinguishable from "there is nothing here". Every terminal state
    // on this page must carry words.
    for (const rejection of [() => fail(404, 'Invalid signing link'), () => fail(500, undefined), () => netdown()]) {
      const c = document.createElement('div');
      document.body.appendChild(c);
      const r = createRoot(c);
      route({ 'GET /v1/esign/verify/TOKEN': rejection });
      await act(async () => { r.render(<SigningPage />); });
      await act(async () => {});

      expect(c.querySelector('.k-err'), 'a failed read painted no error at all').toBeTruthy();
      expect(c.querySelector('.k-err').textContent.trim().length).toBeGreaterThan(20);
      expect(c.querySelector('[aria-busy="true"]'), 'still claiming to be loading').toBeNull();

      await act(async () => r.unmount());
      c.remove();
    }
  });
});
