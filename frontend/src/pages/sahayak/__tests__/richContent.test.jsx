/**
 * Generated content, rendered richly — and rendered as the platform will print
 * it, which is not the same thing.
 *
 * Three defects, each with a section:
 *
 *   1. The Content tab printed a whole post inside one pre-wrapped paragraph,
 *      so `##`, `**` and `- ` were on screen as characters. The reader could
 *      not judge the structure they were about to publish.
 *   2. The result pane rendered markdown as formatted text on the screen where
 *      somebody decides whether a post is ready — for four of the eight
 *      destinations that is a promise the platform then breaks.
 *   3. The image was capped at 380px with no way to enlarge it and no record of
 *      what the model was asked, so a bad one could be seen and never diagnosed.
 *
 * And one rule that is not a defect yet and must never become one: the model's
 * output is UNTRUSTED. It is rendered as elements, never as markup, and the one
 * attribute that takes a model-supplied value — `href` — is filtered.
 *
 * Rendered with react-dom directly: @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws. Same constraint as
 * contentTable.test.jsx.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ToastProvider } from '../../../components/ui/toast';
import RichText, { safeHref } from '../RichText';
import PlatformPreview from '../PlatformPreview';
import ImagePanel from '../ImagePanel';

let container = null;
let root = null;
let written = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  written = [];
  // jsdom has no clipboard. `copyRich` falls back to `writeText` when
  // `ClipboardItem` is missing, which is the branch every browser that refuses
  // a two-flavour write also takes.
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(t => { written.push(t); return Promise.resolve(); }) },
  });
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
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const click = async el => { await act(async () => { el.click(); }); await settle(); };
const byText = (sel, label) =>
  [...container.querySelectorAll(sel)].find(n => n.textContent.trim().startsWith(label));

/* ── 1 · The post reads as a document ─────────────────────────────────────── */

describe('rich rendering — the structure is on screen, not the punctuation', () => {
  it('turns headings into headings', async () => {
    mount(<RichText text={'# Diwali offer\n\n## What you get'} />);
    await settle();
    expect(container.querySelector('h2').textContent).toBe('Diwali offer');
    expect(container.querySelector('h3').textContent).toBe('What you get');
    expect(container.textContent).not.toContain('#');
  });

  it('turns a run of bullets into ONE list with real items', async () => {
    // Not three sibling divs with a bullet glyph in them: a screen reader
    // announces those as prose, and the rich clipboard flavour pastes them into
    // an email as prose too.
    mount(<RichText text={'- GST filing\n- Books closed\n- TDS returns'} />);
    await settle();
    expect(container.querySelectorAll('ul')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('nests an indented bullet inside its parent item', async () => {
    mount(<RichText text={'- Filing\n  - GST\n  - TDS\n- Books'} />);
    await settle();
    expect(container.querySelectorAll('ul').length).toBeGreaterThan(1);
    expect(container.querySelector('li ul')).toBeTruthy();
  });

  it('numbers an ordered list with an ol', async () => {
    mount(<RichText text={'1. Call us\n2. Share your books'} />);
    await settle();
    expect(container.querySelector('ol')).toBeTruthy();
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders bold, italic and struck text as elements', async () => {
    mount(<RichText text={'A **firm** and *soft* and ~~gone~~ line'} />);
    await settle();
    expect(container.querySelector('strong').textContent).toBe('firm');
    expect(container.querySelector('em').textContent).toBe('soft');
    expect(container.querySelector('del').textContent).toBe('gone');
    expect(container.textContent).not.toContain('**');
  });

  it('renders a quote as a blockquote', async () => {
    mount(<RichText text={'> Books closed by the 20th'} />);
    await settle();
    expect(container.querySelector('blockquote').textContent).toContain('Books closed');
  });

  it('keeps emoji, which are the cheapest richness in the post', async () => {
    mount(<RichText text={'Diwali is here 🪔 book now 🎉'} />);
    await settle();
    expect(container.textContent).toContain('🪔');
    expect(container.textContent).toContain('🎉');
  });

  it('makes a hashtag legible without changing it', async () => {
    mount(<RichText text={'Book now #diwali_sale_2026'} />);
    await settle();
    expect(container.querySelector('.sr-rt__tag').textContent).toBe('#diwali_sale_2026');
  });
});

/* ── 2 · The model writes the content, so the model is an attacker ───────── */

describe('untrusted output — elements, never markup', () => {
  it('renders a link the model wrote as a real, safe anchor', async () => {
    mount(<RichText text={'Read [our site](https://kartavaya.com) today'} />);
    await settle();
    const a = container.querySelector('a');
    expect(a.getAttribute('href')).toBe('https://kartavaya.com');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('refuses a javascript: href and keeps the words', async () => {
    mount(<RichText text={'Click [here](javascript:alert(1)) now'} />);
    await settle();
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.textContent).toContain('here');
  });

  it('refuses a data: href', async () => {
    mount(<RichText text={'[x](data:text/html,<script>alert(1)</script>)'} />);
    await settle();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('never builds a remote image out of a model-supplied URL', async () => {
    // `![alt](url)` is a fetch nobody asked for and a tracking pixel if the
    // model was led somewhere. The generated image arrives on its own field.
    mount(<RichText text={'![a logo](https://elsewhere.example/pixel.png)'} />);
    await settle();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('a logo');
  });

  it('prints raw HTML from the model as text, not as markup', async () => {
    const payload = '<img src=x onerror="alert(1)"> and <b>not bold</b>';
    mount(<RichText text={payload} />);
    await settle();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('safeHref admits web and mail addresses and nothing else', () => {
    expect(safeHref('https://kartavaya.com/x')).toBe('https://kartavaya.com/x');
    expect(safeHref('mailto:hello@kartavaya.com')).toBe('mailto:hello@kartavaya.com');
    expect(safeHref('www.kartavaya.com')).toBe('https://www.kartavaya.com');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    // A newline is stripped by the browser before the scheme is parsed, so the
    // guard has to reject it rather than the scheme that survives it.
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
    expect(safeHref('//evil.example/x')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});

/* ── 3 · As the platform will print it ────────────────────────────────────── */

const POST = 'A **firm** offer.\n\n- GST filing\n- Books closed';

describe('the platform preview', () => {
  it('opens on the platform the copy was written for', async () => {
    mount(<PlatformPreview markdown={POST} platform="LinkedIn" />);
    await settle();
    expect(byText('.hb-chip', 'LinkedIn').getAttribute('aria-pressed')).toBe('true');
  });

  it('matches a platform stored in the other case', async () => {
    mount(<PlatformPreview markdown={POST} platform="instagram" />);
    await settle();
    expect(byText('.hb-chip', 'Instagram').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows Instagram the characters Instagram prints', async () => {
    mount(<PlatformPreview markdown={POST} platform="Instagram" />);
    await settle();
    const stage = container.querySelector('.sr-pv__text');
    expect(stage.textContent).toContain('A firm offer.');
    expect(stage.textContent).not.toContain('**');
  });

  it('shows LinkedIn the substituted characters LinkedIn needs', async () => {
    mount(<PlatformPreview markdown={POST} platform="Instagram" />);
    await settle();
    await click(byText('.hb-chip', 'LinkedIn'));
    const stage = container.querySelector('.sr-pv__text');
    expect(stage.textContent).toContain('𝗳𝗶𝗿𝗺');
    expect(stage.textContent).not.toContain('**');
  });

  it('renders the rich document for a destination that takes HTML', async () => {
    mount(<PlatformPreview markdown={POST} platform="Email" />);
    await settle();
    expect(container.querySelector('.sr-pv__stage .sr-rt')).toBeTruthy();
    expect(container.querySelector('.sr-pv__stage strong')).toBeTruthy();
  });

  it('says the platform prints every character literally', async () => {
    mount(<PlatformPreview markdown={POST} platform="Instagram" />);
    await settle();
    expect(container.querySelector('.sr-pv__note').textContent).toContain('literally');
  });

  it('counts against the cap the platform enforces', async () => {
    mount(<PlatformPreview markdown={'x'.repeat(300)} platform="Twitter / X" />);
    await settle();
    const n = container.querySelector('.sr-pv__n');
    expect(n.textContent).toContain('300');
    expect(n.textContent).toContain('280');
    expect(n.textContent).toContain('20 over');
    expect(n.className).toContain('sr-pv__n--over');
  });

  it('does not mark a post inside the cap as over', async () => {
    mount(<PlatformPreview markdown="short" platform="Twitter / X" />);
    await settle();
    expect(container.querySelector('.sr-pv__n').className).not.toContain('--over');
  });

  /**
   * The red is a claim that the platform will truncate. It has to be true.
   *
   * `String.length` is UTF-16 code units and every character the LinkedIn shape
   * substitutes is a surrogate pair — `'𝗗𝗶𝘄𝗮𝗹𝗶'.length` is 12 for six letters —
   * so a long post with bolded runs reported roughly double for the bolded part
   * and went red inside a cap nothing would have enforced.
   */
  it('counts a substituted bold character once, as the reader sees it', async () => {
    mount(<PlatformPreview markdown={'**' + 'a'.repeat(200) + '**'} platform="LinkedIn" />);
    await settle();
    const n = container.querySelector('.sr-pv__n');
    expect(n.textContent).toContain('200');
    expect(n.textContent).not.toContain('400');
  });

  it('counts an emoji once everywhere except X, which weighs it twice', async () => {
    mount(<PlatformPreview markdown={'🎉'.repeat(10)} platform="Instagram" />);
    await settle();
    expect(container.querySelector('.sr-pv__n').textContent).toContain('10 /');

    await click(byText('.hb-chip', 'Twitter / X'));
    expect(container.querySelector('.sr-pv__n').textContent).toContain('20 /');
  });

  /**
   * WhatsApp's cap was 1,000 here against the Cloud API's — and
   * `rich_content.DESTINATIONS["whatsapp"].limit`'s — 4,096, so a 1,400-character
   * broadcast that is legal, sendable and inside the server renderer's own
   * budget was reported to the customer as 400 characters over a hard limit.
   */
  it('holds WhatsApp to the cap the Cloud API and the server renderer agree on', async () => {
    mount(<PlatformPreview markdown={'x'.repeat(1400)} platform="WhatsApp" />);
    await settle();
    const n = container.querySelector('.sr-pv__n');
    expect(n.textContent).toContain('4,096');
    expect(n.className).not.toContain('--over');
  });

  /**
   * The publish path appends the stored tags to the body, so a preview without
   * them is not the post. They read as duplicated because they are: the list was
   * extracted from the body with `re.findall(r'#\w+', text)` — hash included —
   * and the sender adds another one on the way out.
   */
  it('shows the tag block the sender appends, and counts it', async () => {
    mount(<PlatformPreview markdown={POST} platform="Instagram" tags={['#GST', '#Filing']} />);
    await settle();
    const stage = container.querySelector('.sr-pv__text').textContent;
    expect(stage).toContain('##GST ##Filing');
    expect(container.querySelector('.sr-pv__note').textContent).toContain('appends the tags');
  });

  it('adds no tag block to a destination no publish queue posts to', async () => {
    // Email and Website reach nobody through `hub_social_accounts`, so a tag
    // block on either would be a promise about a path that does not exist.
    mount(<PlatformPreview markdown={POST} platform="Email" tags={['#GST']} />);
    await settle();
    expect(container.querySelector('.sr-pv__stage').textContent).not.toContain('##GST');
  });

  /**
   * The stub is LABELLED, and labelled for what the SENDER does rather than for
   * how confident the shaping is.
   *
   * The line used to call a local shape "Kartavya's reading of the platform's
   * rules", which frames the gap as interpretation — two readings of one rule,
   * differing at the edges. It is not that: no route emits `formatted`, so
   * `publish_content` posts the raw Markdown with the tags appended, and this
   * preview sits directly above the Approve button in the Content tab. The
   * approver is entitled to be told the wire text differs, not that this one is
   * an opinion.
   */
  it('says the publish path does not send this, when nothing was served', async () => {
    mount(<PlatformPreview markdown={POST} platform="LinkedIn" />);
    await settle();
    const src = container.querySelector('.sr-pv__src').textContent;
    expect(src).toContain('browser');
    expect(src).toContain('Publishing does not send this');
    expect(src).toContain('Markdown source unchanged');
  });

  it('says so, and shows the server’s own text, once the server sends one', async () => {
    mount(<PlatformPreview markdown={POST} platform="LinkedIn"
      served={{ LinkedIn: 'exactly what will be sent' }} />);
    await settle();
    expect(container.querySelector('.sr-pv__text').textContent).toBe('exactly what will be sent');
    expect(container.querySelector('.sr-pv__src').textContent).toContain('server');
  });
});

describe('copy — the control people use twenty times a day', () => {
  it('names the platform it will copy for', async () => {
    mount(<PlatformPreview markdown={POST} platform="WhatsApp" />);
    await settle();
    const btn = byText('button', 'Copy for');
    expect(btn.textContent).toContain('WhatsApp');
    expect(btn.getAttribute('aria-label')).toContain('WhatsApp');
  });

  it('copies WhatsApp’s markup, not markdown', async () => {
    mount(<PlatformPreview markdown={POST} platform="WhatsApp" />);
    await settle();
    await click(byText('button', 'Copy for'));
    expect(written[0]).toContain('*firm*');
    expect(written[0]).not.toContain('**');
  });

  it('copies LinkedIn’s substituted characters', async () => {
    mount(<PlatformPreview markdown={POST} platform="LinkedIn" />);
    await settle();
    await click(byText('button', 'Copy for'));
    expect(written[0]).toContain('𝗳𝗶𝗿𝗺');
  });

  it('copies Instagram’s plain text', async () => {
    mount(<PlatformPreview markdown={POST} platform="Instagram" />);
    await settle();
    await click(byText('button', 'Copy for'));
    expect(written[0]).toContain('A firm offer.');
    expect(written[0]).not.toContain('*');
  });

  it('every platform is reachable by keyboard as a real button', async () => {
    mount(<PlatformPreview markdown={POST} platform="Instagram" />);
    await settle();
    const chips = [...container.querySelectorAll('.sr-pv__chips button')];
    expect(chips).toHaveLength(8);
    for (const chip of chips) {
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('aria-pressed')).toBeTruthy();
      expect(chip.textContent.trim()).not.toBe('');
    }
    expect(container.querySelector('.sr-pv__chips').getAttribute('aria-label')).toBeTruthy();
  });
});

/* ── 4 · An image nobody can diagnose is an image nobody can improve ─────── */

const IMG = { url: 'https://r2.example/signed/a.png', mime: 'image/png' };

describe('the generated image', () => {
  it('carries an accessible name rather than an empty alt', async () => {
    mount(<ImagePanel image={IMG} alt="The generated visual for this Instagram post" />);
    await settle();
    expect(container.querySelector('img').getAttribute('alt'))
      .toBe('The generated visual for this Instagram post');
  });

  it('can be enlarged, and says which state it is in', async () => {
    mount(<ImagePanel image={IMG} />);
    await settle();
    const shot = container.querySelector('.sr-ip__shot');
    expect(shot.getAttribute('aria-pressed')).toBe('false');
    expect(shot.getAttribute('aria-label')).toContain('Enlarge');

    await click(byText('button', 'View larger'));
    expect(container.querySelector('.sr-ip__shot').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.sr-ip__img').className).toContain('sr-ip__img--big');
  });

  it('shows the brief the model was actually given', async () => {
    // The whole point: the prompt is assembled server-side and is not what
    // anybody typed. Until this week it was the brief truncated to 200
    // characters behind a fixed prefix, and no screen would have shown you that.
    mount(<ImagePanel image={IMG} prompt="Warm lamplight over a Gujarati sweet counter, 35mm, no text" />);
    await settle();
    expect(container.querySelector('.sr-ip__prompt').textContent).toContain('Warm lamplight');
  });

  it('says the brief was not reported rather than showing an empty box', async () => {
    mount(<ImagePanel image={IMG} />);
    await settle();
    expect(container.querySelector('.sr-ip__prompt').textContent).toContain('did not report');
  });

  it('offers no regeneration when the caller cannot run one', async () => {
    mount(<ImagePanel image={IMG} prompt="a counter at dusk" />);
    await settle();
    expect(byText('button', 'Generate a new image')).toBeUndefined();
  });

  it('hands the edited brief back, and says what the click costs first', async () => {
    const onRegenerate = vi.fn();
    mount(<ImagePanel image={IMG} prompt="a counter at dusk" cost={5}
      onRegenerate={onRegenerate} canDirect />);
    await settle();

    // Stated BEFORE the click: there is no image-only route, so this re-runs the
    // whole brief and rewrites the copy with it.
    expect(container.querySelector('.sr-ip__refoot').textContent).toContain('rewrites the copy');
    expect(container.querySelector('.sr-ip__refoot').textContent).toContain('5 credits');

    const box = container.querySelector('.sr-ip__re textarea');
    expect(box.value).toBe('a counter at dusk');
    // Through the native setter, not `box.value =`. React caches the last value
    // it wrote on the node and skips the change event when the two match, so a
    // direct assignment types into the DOM and tells React nothing.
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
        .set.call(box, 'a counter at dusk, no text in the frame');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('button', 'Generate a new image'));
    expect(onRegenerate).toHaveBeenCalledWith('a counter at dusk, no text in the frame');
  });

  /**
   * The expensive lie. A textarea headed "Describe the image you want instead",
   * over a button that spends credits, promised something `QuickGenerate` could
   * not deliver: the model declares skill/topic/platform/tone/language/
   * with_image/extra, Pydantic drops the rest, and the route rebuilt the brief
   * from the topic — so the customer paid for a text generation, a brief
   * expansion and an image, and got a re-roll of the brief they already had.
   * Images are 79% of this product's AI spend and "the picture is wrong" is the
   * retry people repeat.
   */
  it('collects no description on a run the route cannot be told to redirect', async () => {
    mount(<ImagePanel image={IMG} prompt="a counter at dusk" cost={5}
      onRegenerate={vi.fn()} />);
    await settle();
    expect(container.querySelector('.sr-ip__re textarea')).toBeNull();
    expect(byText('button', 'Generate a new image')).toBeUndefined();
    expect(byText('button', 'Generate another image')).toBeTruthy();
    expect(container.querySelector('.sr-ip__refoot').textContent)
      .toContain('cannot be redirected');
  });

  it('re-runs without a description when it cannot carry one', async () => {
    const onRegenerate = vi.fn();
    mount(<ImagePanel image={IMG} prompt="a counter at dusk" onRegenerate={onRegenerate} />);
    await settle();
    await click(byText('button', 'Generate another image'));
    // Not `undefined` — the caller reads that as a fresh brief and blanks the
    // pane the reader is still comparing against.
    expect(onRegenerate).toHaveBeenCalledWith('');
  });

  /**
   * `_EXT_BY_MIME` exists on the server because Recraft V4 answers `image/webp`
   * and Gemini `image/jpeg`, and Recraft LEADS the ladder for both typographic
   * presets — so a festival greeting downloading as `.png` with WebP bytes is
   * the common case. R2 serves the content type the router stored, which is why
   * the blob is believed over the `mime` the route reported: `quick_generate`
   * says `image/png` whichever rung answered.
   */
  it('names the downloaded file after the bytes, not after a guess', async () => {
    const clicked = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      const el = realCreate(tag);
      if (tag === 'a') { el.click = () => clicked.push(el.download); }
      return el;
    });
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/webp' })),
    }));
    globalThis.URL.createObjectURL = () => 'blob:x';
    globalThis.URL.revokeObjectURL = () => {};

    mount(<ImagePanel image={{ url: 'https://r2.example/a', mime: 'image/png' }} />);
    await settle();
    await click(byText('button', 'Download'));
    expect(clicked[0]).toMatch(/\.webp$/);
    document.createElement.mockRestore();
  });

  it('offers a way back when the signed link has expired', async () => {
    mount(<ImagePanel image={IMG} />);
    await settle();
    await act(async () => {
      container.querySelector('img').dispatchEvent(new Event('error'));
    });
    expect(container.textContent).toContain('expired');
    expect(byText('button', 'Try loading it again')).toBeTruthy();
  });
});
