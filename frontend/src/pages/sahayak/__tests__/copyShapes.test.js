/**
 * The generated post is the deliverable, and it was handed over as source.
 *
 * "Copy text" put `result.text` on the clipboard — raw markdown. Pasted into any
 * of the places this content is written for (WhatsApp, Instagram, a LinkedIn
 * box, Gmail) that is literal `**asterisks**`, `###` and `- `, which the reader
 * strips by hand on every single run.
 *
 * These pin the two text shapes. The rich one is the rendered DOM's own
 * innerHTML and needs no transform; these are the two that do.
 */
import { describe, it, expect } from 'vitest';
import { toPlain, toWhatsApp } from '../_shared';

const SAMPLE = [
  '# Diwali offer',
  '',
  'Our **year-end** package is open. Ask about `44AD` filing.',
  '',
  '## What you get',
  '- GST reconciliation',
  '* Books closed by the 20th',
  '',
  '---',
  '',
  '1. Call us',
].join('\n');

describe('toPlain — for a destination that renders nothing', () => {
  it('removes heading marks and keeps the words', () => {
    const out = toPlain(SAMPLE);
    expect(out).toContain('Diwali offer');
    expect(out).not.toMatch(/^#/m);
  });

  it('unwraps bold rather than pasting the asterisks', () => {
    expect(toPlain('Our **year-end** package')).toBe('Our year-end package');
  });

  it('unwraps code ticks', () => {
    expect(toPlain('Ask about `44AD` filing.')).toBe('Ask about 44AD filing.');
  });

  it('turns both bullet characters into one real bullet', () => {
    const out = toPlain(SAMPLE);
    expect(out).toContain('• GST reconciliation');
    expect(out).toContain('• Books closed by the 20th');
    // `- ` and `* ` are markdown; neither should survive as itself.
    expect(out).not.toMatch(/^[-*]\s/m);
  });

  it('drops horizontal rules, which have no plain-text meaning', () => {
    expect(toPlain(SAMPLE)).not.toContain('---');
  });

  it('never leaves more than one blank line', () => {
    expect(toPlain(SAMPLE)).not.toMatch(/\n{3,}/);
  });

  it('is safe on empty and on nullish input', () => {
    expect(toPlain('')).toBe('');
    expect(toPlain(null)).toBe('');
    expect(toPlain(undefined)).toBe('');
  });
});

describe('toWhatsApp — WhatsApp is not markdown', () => {
  /**
   * The whole reason this shape exists: WhatsApp's bold is ONE asterisk.
   * `**bold**` pasted there renders as a literal asterisk wrapped around bold
   * text, which is worse than sending it plain.
   */
  it('converts double-asterisk bold to WhatsApp single-asterisk bold', () => {
    expect(toWhatsApp('Our **year-end** package')).toBe('Our *year-end* package');
  });

  it('promotes headings to bold, since WhatsApp has none', () => {
    expect(toWhatsApp('# Diwali offer')).toBe('*Diwali offer*');
    expect(toWhatsApp('### Small heading')).toBe('*Small heading*');
  });

  it('leaves no double asterisks anywhere', () => {
    expect(toWhatsApp(SAMPLE)).not.toContain('**');
  });

  it('uses real bullets, which WhatsApp does render', () => {
    expect(toWhatsApp(SAMPLE)).toContain('• GST reconciliation');
  });

  it('is safe on empty and on nullish input', () => {
    expect(toWhatsApp('')).toBe('');
    expect(toWhatsApp(null)).toBe('');
  });
});
