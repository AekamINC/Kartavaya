/**
 * Sahayak → Generate: what a run costs, and what the screen may promise about it.
 *
 * Two defects of the same shape, and this file is the ratchet for both.
 *
 * PRICE. `/org/quick-generate` charges twice when it makes a picture — the copy
 * against the skill's agent type, then `image` again — and returns the sum as
 * `credits_used`. The screen quoted only the first, on a form whose image
 * checkbox defaults to ON, so the default state of the page named a price it
 * would not charge. That is the defect the route's own comment records as fixed
 * on the server ("social_post reported 3, charged 2"), re-entered on the client.
 *
 * PROMISE. The image panel's regenerate control offered a textarea headed
 * "Describe the image you want instead" over a button that spends credits, and
 * `QuickGenerate` declares no such field — Pydantic dropped it in transit and
 * the route rebuilt the brief from the topic. The customer paid for a text
 * generation, a brief expansion and an image, and got a re-roll of the brief
 * they already had. Images are 79% of this product's AI spend.
 *
 * Rendered with react-dom directly: @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws. Same constraint as
 * contentTable.test.jsx.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../hooks/useModuleWrite', () => ({
  default: () => ({ canWrite: true, reason: '' }),
}));

vi.mock('../../../components/CustomizePanel', () => ({
  useLanguage: () => 'en',
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import GenerateTab from '../GenerateTab';

let container = null;
let root = null;

/** The served price table. `image` is a kind of its own — see `_PRICED_AGENT_TYPES`. */
const COSTS = { social_media: 2, image: 3, blog: 5, whatsapp: 1 };
const CREDITS = { org_balance: { balance: 400 } };

beforeEach(() => {
  vi.clearAllMocks();
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

const mount = el => act(() => root.render(<ToastProvider>{el}</ToastProvider>));
const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const click = async el => { await act(async () => { el.click(); }); await settle(); };
const byText = (sel, label) =>
  [...container.querySelectorAll(sel)].find(n => n.textContent.trim().startsWith(label));

/** Through the native setter — React skips a change event it did not cause. */
async function type(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const foot = () => container.querySelector('.hb-form__foot .hb-cap').textContent;

/** Pick the social post preset, which is the one that makes a picture. */
async function pickSocial() {
  mount(<GenerateTab credits={CREDITS} costs={COSTS} />);
  await settle();
  await click(byText('.sr-pick', 'Social post'));
}

/* ── The price on the button ───────────────────────────────────────────────── */

describe('what the Generate form says a run will spend', () => {
  it('quotes the copy AND the picture while the image box is ticked', async () => {
    await pickSocial();
    expect(foot()).toContain('5');
  });

  it('quotes the copy alone once the image box is cleared', async () => {
    await pickSocial();
    await click(container.querySelector('.sk-check input'));
    expect(foot()).toContain('2');
    expect(foot()).not.toContain('5');
  });

  it('quotes the copy alone for a preset that makes no picture', async () => {
    mount(<GenerateTab credits={CREDITS} costs={COSTS} />);
    await settle();
    await click(byText('.sr-pick', 'WhatsApp'));
    expect(foot()).toContain('1');
  });

  /**
   * Half a price printed as a whole one is the same lie in miniature. The
   * caption already knows how to say nothing.
   */
  it('says nothing rather than half a price when the image cost has not loaded', async () => {
    mount(<GenerateTab credits={CREDITS} costs={{ social_media: 2 }} />);
    await settle();
    await click(byText('.sr-pick', 'Social post'));
    expect(foot()).not.toContain('spends');
  });
});

/* ── The promise on the regenerate control ─────────────────────────────────── */

const RESULT = over => ({
  data: {
    content_id: 'c1',
    text: 'A **firm** offer.',
    images: [{ url: 'https://r2.example/signed/a.png', mime: 'image/png' }],
    credits_used: 5,
    model: 'flux-schnell',
    ...over,
  },
});

async function generate(response) {
  api.post.mockResolvedValue(response);
  await pickSocial();
  await type(container.querySelector('.hb-ta'), 'Diwali sale');
  await act(async () => {
    container.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

describe('regenerating the picture', () => {
  it('charges the copy and the picture, and says so before the click', async () => {
    await generate(RESULT());
    // The handler forces `with_image`, so this run is never text-only.
    expect(container.querySelector('.sr-ip__refoot').textContent).toContain('5 credits');
  });

  it('asks for no description on a run whose brief the route never reported', async () => {
    await generate(RESULT());
    expect(container.querySelector('.sr-ip__prompt').textContent).toContain('did not report');
    expect(container.querySelector('.sr-ip__re textarea')).toBeNull();
    expect(byText('button', 'Generate another image')).toBeTruthy();
  });

  it('asks for one as soon as the route reports the brief it built', async () => {
    await generate(RESULT({ image_prompt: 'A sweet counter at dusk, warm lamplight, 35mm' }));
    expect(container.querySelector('.sr-ip__prompt').textContent).toContain('sweet counter');
    expect(container.querySelector('.sr-ip__re textarea').value)
      .toBe('A sweet counter at dusk, warm lamplight, 35mm');
  });

  it('sends the typed description as image_prompt, on a run that will read it', async () => {
    await generate(RESULT({ image_prompt: 'A sweet counter at dusk' }));
    await type(container.querySelector('.sr-ip__re textarea'), 'no text in the frame');
    await click(byText('button', 'Generate a new image'));

    const [, payload] = api.post.mock.calls[api.post.mock.calls.length - 1];
    expect(payload.image_prompt).toBe('no text in the frame');
    expect(payload.with_image).toBe(true);
  });
});
