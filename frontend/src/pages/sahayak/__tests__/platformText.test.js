/**
 * The post is not the markdown. Every assertion here is about a destination
 * that will print something other than what the model wrote.
 *
 * The defect this pins: the result pane rendered markdown as formatted text on
 * the screen where somebody decides whether a post is ready, and four of the
 * eight destinations render none of it. An Instagram caption prints
 * `**Diwali**` with both pairs of asterisks; LinkedIn strips markdown and has
 * no formatting of its own; WhatsApp has markup and its bold is ONE asterisk.
 * So the screen showed bold, the platform showed punctuation, and the reader
 * found out after publishing.
 */
import { describe, it, expect } from 'vitest';
import {
  formatFor, variantsFor, platformKey, toPlain, toWhatsApp, toUnicode,
  unicodeBold, unicodeItalic, countText, tagBlock,
  PLATFORM_RENDERING, PLATFORMS,
} from '../platformText';

const POST = [
  '# Diwali offer',
  '',
  'Our **year-end** package is open. Ask about `44AD` filing.',
  '',
  '## What you get',
  '- GST reconciliation',
  '* Books closed by the 20th',
  '',
  'Read more at [our site](https://kartavaya.com).',
].join('\n');

/** Every markdown mark, as characters. If one survives, the platform prints it. */
const MARKS = ['**', '##', '](', '~~'];

describe('the platforms that print every character literally', () => {
  for (const platform of ['Instagram', 'Facebook', 'Twitter / X', 'Google Ads']) {
    it(`${platform} gets no markdown syntax at all`, () => {
      const out = formatFor(platform, POST);
      for (const mark of MARKS) expect(out).not.toContain(mark);
      expect(out).not.toMatch(/^#/m);
      expect(out).not.toMatch(/^[-*]\s/m);
      // The words survive; only the punctuation goes.
      expect(out).toContain('Diwali offer');
      expect(out).toContain('year-end');
      expect(out).toContain('GST reconciliation');
    });
  }

  it('keeps the address when it unwraps a link, because a caption cannot click', () => {
    const out = formatFor('Instagram', 'Read more at [our site](https://kartavaya.com).');
    expect(out).toContain('our site (https://kartavaya.com)');
  });
});

describe('WhatsApp — its bold is one asterisk, not two', () => {
  it('converts markdown bold to WhatsApp bold', () => {
    expect(toWhatsApp('Our **year-end** package')).toBe('Our *year-end* package');
  });

  it('converts markdown italic to WhatsApp italic, which is an underscore', () => {
    expect(toWhatsApp('a *soft* offer')).toBe('a _soft_ offer');
  });

  it('promotes headings to bold, since WhatsApp has none', () => {
    expect(toWhatsApp('### Small heading')).toBe('*Small heading*');
  });

  it('never leaves a double asterisk anywhere', () => {
    expect(toWhatsApp(POST)).not.toContain('**');
  });
});

describe('LinkedIn — the only way to get bold in is to substitute characters', () => {
  it('maps ASCII bold to the sans-serif bold block', () => {
    expect(unicodeBold('Diwali')).toBe('𝗗𝗶𝘄𝗮𝗹𝗶');
  });

  it('maps ASCII italic to the sans-serif italic block', () => {
    expect(unicodeItalic('soft')).toBe('𝘴𝘰𝘧𝘵');
  });

  it('leaves digits alone in italic, because Unicode has no italic digits', () => {
    // Mixing one style's digits into another is worse than plain digits: `2026`
    // must stay a readable year.
    expect(unicodeItalic('2026')).toBe('2026');
  });

  /**
   * What to do about a RUN that mixes the two is the server's decision, not this
   * file's, because this screen is labelled "as each platform will print it".
   * `rich_content._emphasise` drops such a run to bold if both were asked for
   * and to plain otherwise, on the grounds that a half-slanted `20 August` reads
   * as a font fault. This file used to slant only the letters — so the preview
   * showed one string and the post carried another for any date, amount or
   * section number in italics, which is most compliance copy.
   */
  it('drops italic entirely on a run that carries a digit, as the server does', () => {
    expect(formatFor('LinkedIn', '*20 August*')).toBe('20 August');
    expect(formatFor('LinkedIn', '*August*')).toBe('𝘈𝘶𝘨𝘶𝘴𝘵');
  });

  it('keeps a bold-italic run bold when it cannot be slanted', () => {
    expect(formatFor('LinkedIn', '***due 20 August***')).toBe(unicodeBold('due 20 August'));
  });

  it('still bolds digits, which the block does have', () => {
    expect(formatFor('LinkedIn', '**2026**')).toBe(unicodeBold('2026'));
  });

  it('bolds the heading and leaves no asterisks in the post', () => {
    const out = formatFor('LinkedIn', POST);
    expect(out).toContain('𝗗𝗶𝘄𝗮𝗹𝗶 𝗼𝗳𝗳𝗲𝗿');
    expect(out).not.toContain('**');
    expect(out).not.toMatch(/^#/m);
  });

  /**
   * The reason every branch of the mapper falls through to the original
   * character. This product ships six languages and the Mathematical
   * Alphanumeric Symbols block covers ASCII only — a lookup table would have
   * returned undefined for every Devanagari letter and rendered the whole Hindi
   * post as tofu.
   */
  it('leaves Devanagari untouched, because Unicode has no bold for it', () => {
    expect(unicodeBold('दीवाली')).toBe('दीवाली');
    expect(toUnicode('**दीवाली की शुभकामनाएं**')).toBe('दीवाली की शुभकामनाएं');
  });

  it('leaves a hashtag readable rather than substituting its letters', () => {
    // The tag is not emphasised, so it is not mapped — a substituted hashtag is
    // not the same tag on the platform.
    expect(formatFor('LinkedIn', 'Book now #DiwaliOffer')).toContain('#DiwaliOffer');
  });
});

describe('an underscore in a hashtag is not italics', () => {
  /**
   * Markdown reads `_x_` as italic and generated captions are full of tags like
   * `#diwali_sale_2026`. A naive rule eats the underscores out of the one token
   * in the post that has to survive exactly.
   */
  for (const shape of ['Instagram', 'WhatsApp', 'LinkedIn']) {
    it(`${shape} keeps #diwali_sale_2026 intact`, () => {
      expect(formatFor(shape, 'Book now #diwali_sale_2026 today')).toContain('#diwali_sale_2026');
    });
  }
});

describe('an unclosed mark cannot run away with the rest of the post', () => {
  it('leaves a dangling ** as characters instead of bolding to the end', () => {
    // A truncated generation ends mid-mark. A greedy rule would emphasise every
    // remaining line of a 2,000-character post.
    const out = formatFor('LinkedIn', 'Opening line **half a bold\nand the next line');
    expect(out).toContain('and the next line');
    expect(out).toContain('**half a bold');
  });
});

describe('the platform table is the single copy of a platform fact', () => {
  it('every platform declares a shape and a note', () => {
    for (const p of PLATFORMS) {
      expect(PLATFORM_RENDERING[p].shape).toBeTruthy();
      expect(PLATFORM_RENDERING[p].note).toBeTruthy();
    }
  });

  it('states the caps that the platform itself enforces', () => {
    expect(PLATFORM_RENDERING['Twitter / X'].charLimit).toBe(280);
    expect(PLATFORM_RENDERING.Instagram.charLimit).toBe(2200);
    expect(PLATFORM_RENDERING.LinkedIn.charLimit).toBe(3000);
  });

  /**
   * And states the SAME cap the server renderer budgets against. WhatsApp said
   * 1,000 here against `rich_content.DESTINATIONS["whatsapp"].limit` — and the
   * Cloud API's `text.body` maximum — of 4,096: a second copy of exactly the
   * fact this table exists to hold once, re-created across the frontend/backend
   * boundary instead of within one file.
   */
  it('agrees with the server renderer about WhatsApp', () => {
    expect(PLATFORM_RENDERING.WhatsApp.charLimit).toBe(4096);
  });
});

describe('counting characters, which is not counting .length', () => {
  /**
   * The red over-limit warning claims the platform will truncate. It fired on
   * posts that were inside the cap, because `String.length` is UTF-16 code
   * units and every substituted LinkedIn bold character is a surrogate pair.
   */
  it('counts a substituted character once, not twice', () => {
    expect(unicodeBold('Diwali')).toHaveLength(12);
    expect(countText(unicodeBold('Diwali'))).toBe(6);
  });

  it('counts an emoji as one character by default', () => {
    expect(countText('🎉🎉')).toBe(2);
  });

  /**
   * X publishes its own weighting: one for the ranges it lists, two for
   * everything else. That is what makes an emoji cost two characters of a tweet
   * while a Devanagari letter costs one — which matters, because this product
   * writes in six languages.
   */
  it('weighs a tweet the way X weighs it', () => {
    expect(countText('🎉', 'weighted')).toBe(2);
    expect(countText('abc', 'weighted')).toBe(3);
    expect(countText('दीवाली', 'weighted')).toBe(6);
  });

  it('survives empty and nullish input', () => {
    expect(countText('')).toBe(0);
    expect(countText(null)).toBe(0);
    expect(countText(undefined, 'weighted')).toBe(0);
  });
});

describe('the hashtag block the sender appends', () => {
  /**
   * `publish_content` builds `body + "\n\n" + " ".join(f"#{h}")`, and the stored
   * list came from `re.findall(r'#\w+', body)` — hash included. The post that
   * lands therefore carries the tags twice, the second time as `##GST`. That is
   * the sender's defect and not this file's to fix, but the preview is the
   * screen a reviewer approves from, so it shows what the sender builds.
   */
  it('reproduces the doubled hash rather than tidying it away', () => {
    expect(tagBlock(['#GST', '#Filing'])).toBe('##GST ##Filing');
  });

  it('is nothing at all when there are no tags', () => {
    expect(tagBlock([])).toBe('');
    expect(tagBlock(null)).toBe('');
    expect(tagBlock(['', '  '])).toBe('');
  });
});

describe('platformKey — the column is not written in one case', () => {
  /**
   * `/org/quick-generate` stores the form's label (`Instagram`), the seeded
   * rows carry `instagram`, and an exact-string match fell back to plain for
   * every lowercase row — the one wrong answer nothing on screen would betray,
   * because plain is also a legitimate shape.
   */
  it('matches however the row was written', () => {
    expect(platformKey('instagram')).toBe('Instagram');
    expect(platformKey('LINKEDIN')).toBe('LinkedIn');
    expect(platformKey('twitter/x')).toBe('Twitter / X');
    expect(platformKey('Google Ads')).toBe('Google Ads');
  });

  /**
   * And matches the server's OWN destination keys, which are not these labels.
   * `rich_content.DESTINATIONS` names the tightest platform exactly `"x"`, and
   * normalise-and-compare cannot get from there to `Twitter / X`. Left unmapped,
   * the day the server starts serving `formatted` its 280-character fitted tweet
   * would be dropped on the floor and that one chip would fall back to the
   * browser's shape — which applies no character budget at all — while every
   * chip beside it correctly reported `server`.
   */
  it('resolves the key the server calls the platform', () => {
    expect(platformKey('x')).toBe('Twitter / X');
    expect(platformKey('twitter')).toBe('Twitter / X');
    expect(platformKey('whatsapp_business')).toBe('WhatsApp');
  });

  it('returns null rather than guessing', () => {
    expect(platformKey('')).toBeNull();
    expect(platformKey(null)).toBeNull();
    // Real server destinations with no chip here. Null is the right answer:
    // `variantsFor` drops what it cannot label rather than putting an
    // unexplained platform on the screen.
    expect(platformKey('Threads')).toBeNull();
    expect(platformKey('google_business')).toBeNull();
    expect(platformKey('markdown')).toBeNull();
  });
});

describe('variantsFor — the server is preferred and the browser says so', () => {
  it('offers every platform', () => {
    expect(variantsFor(POST, null).map(v => v.platform)).toEqual(PLATFORMS);
  });

  it('marks a locally computed shape as local', () => {
    const v = variantsFor(POST, null).find(x => x.platform === 'LinkedIn');
    expect(v.source).toBe('local');
  });

  it('takes the server’s text verbatim and marks it as the server’s', () => {
    const v = variantsFor(POST, { LinkedIn: 'what the server will send' })
      .find(x => x.platform === 'LinkedIn');
    expect(v.text).toBe('what the server will send');
    expect(v.source).toBe('server');
  });

  it('matches the server’s key however it is cased', () => {
    const v = variantsFor(POST, { whatsapp: 'served' }).find(x => x.platform === 'WhatsApp');
    expect(v.source).toBe('server');
  });

  it('appends the sender’s tag block to a social destination', () => {
    const v = variantsFor('Filing is open.', null, ['#GST']).find(x => x.platform === 'Instagram');
    expect(v.text).toBe('Filing is open.\n\n##GST');
  });

  it('appends nothing to a destination no publish queue posts to', () => {
    const v = variantsFor('Filing is open.', null, ['#GST']).find(x => x.platform === 'Email');
    expect(v.text).toBe('Filing is open.');
  });

  it('never adds a tag block on top of what the server formatted', () => {
    // The server formatting a post is formatting the whole post. Adding to its
    // answer would be this screen inventing text the sender never wrote.
    const v = variantsFor('body', { instagram: 'the served post' }, ['#GST'])
      .find(x => x.platform === 'Instagram');
    expect(v.text).toBe('the served post');
  });

  it('ignores a platform the screen has no chip for', () => {
    // A server that grows a ninth destination must not put an unlabelled,
    // unexplained chip on an old screen.
    const out = variantsFor(POST, { Threads: 'x' });
    expect(out.every(v => v.source === 'local')).toBe(true);
    expect(out.map(v => v.platform)).not.toContain('Threads');
  });
});

describe('the shapes are safe on nothing', () => {
  for (const fn of [toPlain, toWhatsApp, toUnicode]) {
    it(`${fn.name} survives empty and nullish input`, () => {
      expect(fn('')).toBe('');
      expect(fn(null)).toBe('');
      expect(fn(undefined)).toBe('');
    });
  }
});
